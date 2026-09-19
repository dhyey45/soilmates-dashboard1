const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ACCESS_PASSWORD = process.env.SOILMATES_PASSWORD;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();
const failedLogins = new Map();

if (IS_PRODUCTION) app.set("trust proxy", 1);

const DATA_FILE = path.join(__dirname, "readings.json");
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
const BACKUP_DIR = path.join(__dirname, "backups");
const DASHBOARD_FILE = path.join(__dirname, "private", "dashboard.html");

for (const dir of [UPLOAD_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");

if (!ACCESS_PASSWORD) {
  console.warn("⚠️ SOILMATES_PASSWORD is not set. Login will be unavailable until you set it.");
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  }
});

app.use(express.json({ limit: "10mb" }));

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}
setInterval(cleanupSessions, 15 * 60 * 1000).unref();

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getClientKey(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function isAuthenticated(req) {
  const token = req.cookies?.soilmates_session;
  if (!token) return false;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ success: false, error: "Authentication required." });
  }
  return res.redirect("/access");
}

// Tiny cookie parser — avoids adding another dependency just for one session cookie.
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    req.cookies[key] = value;
  }
  next();
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/access", (req, res) => {
  if (isAuthenticated(req)) return res.redirect("/dashboard");
  res.sendFile(path.join(__dirname, "public", "access.html"));
});

app.post("/login", (req, res) => {
  if (!ACCESS_PASSWORD) {
    return res.status(503).json({ success: false, error: "Server password is not configured." });
  }

  const key = getClientKey(req);
  const now = Date.now();
  const record = failedLogins.get(key) || { count: 0, firstAttempt: now };
  if (now - record.firstAttempt > 5 * 60 * 1000) {
    record.count = 0;
    record.firstAttempt = now;
  }
  if (record.count >= 5) {
    return res.status(429).json({ success: false, error: "Too many attempts. Please try again in a few minutes." });
  }

  if (!safeEqual(req.body?.password, ACCESS_PASSWORD)) {
    record.count += 1;
    failedLogins.set(key, record);
    return res.status(401).json({ success: false, error: "Incorrect access password." });
  }

  failedLogins.delete(key);
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { createdAt: now, expiresAt: now + SESSION_TTL_MS });

  res.cookie("soilmates_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: SESSION_TTL_MS,
    path: "/"
  });

  res.json({ success: true, redirect: "/dashboard" });
});

app.post("/logout", (req, res) => {
  const token = req.cookies?.soilmates_session;
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", "soilmates_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
  res.json({ success: true });
});

app.get("/dashboard", requireAuth, (_req, res) => {
  res.sendFile(DASHBOARD_FILE);
});

// Everything below this line is private. Public assets remain available so the login/welcome screens can render.
app.use("/api", requireAuth);

app.use(express.static(path.join(__dirname, "public")));

function readData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("readings.json is invalid. Trying backup...");
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("readings-") && f.endsWith(".json"))
      .sort().reverse();

    for (const name of backups) {
      try {
        const backupPath = path.join(BACKUP_DIR, name);
        const data = JSON.parse(fs.readFileSync(backupPath, "utf8"));
        if (Array.isArray(data)) {
          fs.copyFileSync(backupPath, DATA_FILE);
          console.log(`Restored backup: ${name}`);
          return data;
        }
      } catch (_) {}
    }
    fs.writeFileSync(DATA_FILE, "[]", "utf8");
    return [];
  }
}

function saveData(data) {
  if (fs.existsSync(DATA_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `readings-${stamp}.json`));
    } catch (err) {
      console.error("Backup warning:", err.message);
    }
  }
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, DATA_FILE);
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

app.post("/api/upload", upload.single("photo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: "No image uploaded." });
  }
  const imageUrl = `/uploads/${req.file.filename}`;
  console.log(`Image uploaded: ${req.file.filename}`);
  res.json({ success: true, message: "Image uploaded successfully!", image_url: imageUrl });
});

app.post("/api/readings", (req, res) => {
  try {
    const {
      rover_id = "ROVER-01",
      soil_moisture,
      speed,
      temperature,
      humidity,
      nitrogen,
      phosphorus,
      potassium,
      battery,
      latitude,
      longitude,
      photo_url
    } = req.body;

    const moisture = Number(soil_moisture);
    if (!Number.isFinite(moisture)) {
      return res.status(400).json({
        success: false,
        error: "soil_moisture is required and must be a number."
      });
    }

    const reading = {
      id: Date.now(),
      rover_id,
      soil_moisture: Math.min(100, Math.max(0, moisture)),
      speed: optionalNumber(speed),
      temperature: optionalNumber(temperature),
      humidity: optionalNumber(humidity),
      nitrogen: optionalNumber(nitrogen),
      phosphorus: optionalNumber(phosphorus),
      potassium: optionalNumber(potassium),
      battery: optionalNumber(battery),
      latitude: optionalNumber(latitude),
      longitude: optionalNumber(longitude),
      photo_url: photo_url || null,
      created_at: new Date().toISOString()
    };

    const data = readData();
    data.push(reading);
    saveData(data);

    res.json({ success: true, message: "Rover telemetry stored successfully!", data: reading });
  } catch (err) {
    console.error("Reading error:", err);
    res.status(500).json({ success: false, error: "Could not store rover data." });
  }
});

app.get("/api/readings/latest", (_req, res) => {
  const data = readData();
  res.json(data.length ? data[data.length - 1] : null);
});

app.get("/api/readings", (_req, res) => {
  res.json(readData().slice(-50).reverse());
});

app.delete("/api/readings/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = readData();
    const index = data.findIndex(r => Number(r.id) === id);
    if (index === -1) return res.status(404).json({ success: false, error: "Reading not found." });
    const deleted = data[index];
    data.splice(index, 1);
    saveData(data);
    res.json({ success: true, message: "Reading deleted safely.", deleted });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ success: false, error: "Could not delete reading." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ success: true, server: "Soilmates 4.0 — Next-Gen Digital Twin", status: "online", time: new Date().toISOString() });
});

app.use((err, _req, res, _next) => {
  console.error("Server error:", err.message);
  if (err instanceof multer.MulterError) return res.status(400).json({ success: false, error: err.message });
  res.status(500).json({ success: false, error: err.message || "Server error." });
});

app.listen(PORT, () => {
  console.log("=================================");
  console.log("🚜 SOILMATES 4.0 SERVER STARTED");
  console.log("=================================");
  console.log(`🌐 http://localhost:${PORT}`);
  console.log("🔐 Password-protected command center enabled");
  console.log("📊 Soil analytics enabled");
  console.log("📷 Image upload enabled (50 MB)");
  console.log("💾 Automatic data backups enabled");
});
