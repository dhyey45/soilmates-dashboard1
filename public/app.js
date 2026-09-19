
let moistureChart;
let lastDataSignature = "";
let lastValues = {};

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  const n = num(v, min);
  return Math.min(max, Math.max(min, n));
}

function stageFor(value) {
  const n = clamp(value, 0, 100);
  if (n <= 20) return { title: "Critical / Very Dry", icon: "🔴", advice: "Immediate irrigation required.", cls: "critical" };
  if (n <= 35) return { title: "Low", icon: "🟠", advice: "Irrigation recommended soon.", cls: "low" };
  if (n <= 60) return { title: "Optimal", icon: "🟢", advice: "Moisture level is good — no irrigation needed.", cls: "optimal" };
  if (n <= 75) return { title: "High", icon: "🔵", advice: "Avoid irrigation; monitor soil.", cls: "high" };
  return { title: "Very Wet", icon: "🔴", advice: "Stop irrigation — risk of waterlogging.", cls: "wet" };
}

function formatTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setText(id, value, flash = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.textContent !== String(value)) {
    el.textContent = value;
    if (flash) {
      el.classList.remove("value-updated");
      void el.offsetWidth;
      el.classList.add("value-updated");
    }
  }
}

function setBar(id, value, max = 100) {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = clamp((num(value, 0) / max) * 100, 0, 100);
  el.style.width = `${pct}%`;
}

function buildTicks(groupId, max, step) {
  const group = document.getElementById(groupId);
  if (!group || group.children.length) return;
  const cx = 160, cy = 178, r1 = 94, r2 = 82;
  for (let value = 0; value <= max; value += step) {
    const angle = Math.PI + (value / max) * Math.PI;
    const x1 = cx + Math.cos(angle) * r1;
    const y1 = cy + Math.sin(angle) * r1;
    const x2 = cx + Math.cos(angle) * r2;
    const y2 = cy + Math.sin(angle) * r2;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    group.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const tx = cx + Math.cos(angle) * 70;
    const ty = cy + Math.sin(angle) * 70 + 3;
    label.setAttribute("x", tx); label.setAttribute("y", ty);
    label.textContent = value;
    group.appendChild(label);
  }
}

function setGauge(prefix, value, max) {
  const raw = num(value);
  const hasValue = raw != null;
  const safe = hasValue ? clamp(raw, 0, max) : 0;
  const ratio = safe / max;
  const angle = -90 + ratio * 180;

  const needle = document.getElementById(`${prefix}Needle`);
  const progress = document.getElementById(`${prefix === "speed" ? "speed" : "temp"}Progress`);

  if (needle) needle.style.transform = `rotate(${angle}deg)`;
  if (progress) progress.style.strokeDashoffset = String(100 - ratio * 100);

  if (prefix === "speed") {
    setText("speedValue", hasValue ? safe.toFixed(1) : "--", true);
    setText("speedCard", hasValue ? safe.toFixed(1) : "--", true);
    setText("speedState", hasValue ? "LIVE" : "WAITING");
    setBar("speedBar", safe, max);
  } else {
    setText("tempGaugeValue", hasValue ? safe.toFixed(1) : "--", true);
    setText("temperature", hasValue ? `${safe.toFixed(1)}°C` : "--°C", true);
    setText("tempState", hasValue ? "LIVE" : "WAITING");
  }
}

function updateRecommendation(latest) {
  const box = document.getElementById("recommendation");
  if (!latest || !box) return;

  const s = stageFor(latest.soil_moisture);
  box.className = `recommendation ${s.cls} reveal tilt-enabled`;
  setText("recIcon", s.icon);
  setText("stage", s.title);
  setText("advice", s.advice);
}

function updateCards(latest) {
  if (!latest) return;

  const moisture = clamp(latest.soil_moisture, 0, 100);
  const humidity = clamp(latest.humidity, 0, 100);
  const battery = clamp(latest.battery, 0, 100);

  setText("moisture", `${moisture}%`, true);
  setText("humidity", latest.humidity != null ? `${humidity}%` : "--%", true);
  setText("battery", latest.battery != null ? `${battery}%` : "--%", true);

  setBar("moistureBar", moisture);
  setBar("humidityBar", humidity);
  setBar("batteryBar", battery);
}

function updateNPK(latest) {
  const fields = [
    ["nitrogen", "nitrogenValue", "nitrogenBar"],
    ["phosphorus", "phosphorusValue", "phosphorusBar"],
    ["potassium", "potassiumValue", "potassiumBar"]
  ];

  fields.forEach(([key, valueId, barId]) => {
    const value = latest?.[key];
    const n = num(value);
    setText(valueId, n == null ? "--%" : `${clamp(n, 0, 100).toFixed(0)}%`, true);
    if (n != null) setBar(barId, n);
  });
}

function updatePhoto(latest) {
  const box = document.getElementById("photoBox");
  if (!box) return;

  if (latest?.photo_url) {
    box.classList.add("scanning");
    box.innerHTML = "";

    const img = document.createElement("img");
    img.src = latest.photo_url;
    img.alt = "Latest rover field photo";

    img.onload = () => {
      setTimeout(() => box.classList.remove("scanning"), 1200);
    };

    box.appendChild(img);
  }
}

function formatCoordinate(value, digits = 5) {
  const n = num(value);
  return n == null ? null : n.toFixed(digits);
}

function formatLocation(reading) {
  const lat = formatCoordinate(reading?.latitude);
  const lon = formatCoordinate(reading?.longitude);
  if (lat == null || lon == null) return "--";
  return `${lat}, ${lon}`;
}

function updateTable(readings) {
  const body = document.getElementById("readingsBody");
  if (!body) return;

  if (!readings.length) {
    body.innerHTML = `<tr><td colspan="7">No readings yet.</td></tr>`;
    return;
  }

  body.innerHTML = readings.map(r => {
    const speed = num(r.speed);
    const n = num(r.nitrogen), p = num(r.phosphorus), k = num(r.potassium);
    const npk = [n, p, k].every(v => v != null) ? `${n}/${p}/${k}` : "--";
    const location = formatLocation(r);

    return `<tr>
      <td>${formatTime(r.created_at)}</td>
      <td>${speed == null ? "--" : `${speed.toFixed(1)} km/h`}</td>
      <td>${num(r.soil_moisture, 0)}%</td>
      <td>${r.temperature == null ? "--" : `${num(r.temperature, 0)}°C`}</td>
      <td>${npk}</td>
      <td>${r.battery == null ? "--" : `${num(r.battery, 0)}%`}</td>
      <td class="location-cell" title="${location}">${location}</td>
    </tr>`;
  }).join("");
}

function updateChart(readings) {
  const chronological = [...readings].reverse();
  const labels = chronological.map(r => formatTime(r.created_at));
  const values = chronological.map(r => clamp(r.soil_moisture, 0, 100));
  const ctx = document.getElementById("moistureChart");

  if (!ctx || typeof Chart === "undefined") return;

  if (moistureChart) moistureChart.destroy();

  const context = ctx.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 360);
  gradient.addColorStop(0, "rgba(141,255,177,.16)");
  gradient.addColorStop(1, "rgba(141,255,177,0)");

  moistureChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Soil Moisture %",
        data: values,
        borderWidth: 2.5,
        tension: .42,
        pointRadius: 2.5,
        pointHoverRadius: 7,
        fill: true,
        backgroundColor: gradient,
        borderColor: "#dfe7e1",
        pointBackgroundColor: "#f2f5f3",
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 900,
        easing: "easeOutQuart"
      },
      interaction: {
        intersect: false,
        mode: "index"
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: "rgba(255,255,255,.055)" },
          ticks: {
            color: "#7f8a83",
            callback: v => `${v}%`
          }
        },
        x: {
          grid: { color: "rgba(255,255,255,.025)" },
          ticks: { color: "#7f8a83" }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: "#aeb8b2",
            usePointStyle: true,
            padding: 18
          }
        },
        tooltip: {
          backgroundColor: "rgba(5,8,6,.88)",
          borderColor: "rgba(141,255,177,.18)",
          borderWidth: 1,
          titleColor: "#f4f8f5",
          bodyColor: "#c6d2ca",
          displayColors: false,
          callbacks: {
            label: ctx => ` Soil Moisture: ${ctx.parsed.y}%`
          }
        }
      }
    }
  });
}

function createIntroParticles() {
  const field = document.querySelector(".intro-particles");
  if (!field || field.children.length) return;

  const count = window.innerWidth < 600 ? 35 : 75;

  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "intro-particle";
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${55 + Math.random() * 50}%`;
    p.style.setProperty("--duration", `${5 + Math.random() * 9}s`);
    p.style.setProperty("--delay", `${Math.random() * 6}s`);
    p.style.setProperty("--drift", `${(Math.random() - .5) * 220}px`);
    field.appendChild(p);
  }
}

function setupCursorSystem() {
  const mouseGlow = document.querySelector(".mouse-glow");
  if (!mouseGlow || window.matchMedia("(max-width: 600px)").matches) return;

  let mouseX = innerWidth / 2;
  let mouseY = innerHeight / 2;
  let currentX = mouseX;
  let currentY = mouseY;

  document.addEventListener("mousemove", e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    document.body.style.setProperty("--cursor-x", `${mouseX}px`);
    document.body.style.setProperty("--cursor-y", `${mouseY}px`);
  });

  function animate() {
    currentX += (mouseX - currentX) * .10;
    currentY += (mouseY - currentY) * .10;

    mouseGlow.style.left = `${currentX}px`;
    mouseGlow.style.top = `${currentY}px`;

    requestAnimationFrame(animate);
  }

  animate();
}

function setupTilt() {
  if (window.matchMedia("(max-width: 700px)").matches) return;

  const cards = document.querySelectorAll(".tilt-enabled");

  cards.forEach(card => {
    card.addEventListener("pointermove", e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;

      const rotateY = (x - .5) * 5;
      const rotateX = (.5 - y) * 5;

      card.style.setProperty("--mx", `${x * 100}%`);
      card.style.setProperty("--my", `${y * 100}%`);

      if (card.classList.contains("card") || card.classList.contains("hero")) {
        card.style.transform =
          `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-7px)`;
      }
    });

    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
      card.style.setProperty("--mx", "50%");
      card.style.setProperty("--my", "50%");
    });
  });
}

function setupIntro() {
  const intro = document.getElementById("introScreen");
  const launch = document.getElementById("dashboardButton");
  const bootText = document.getElementById("bootText");
  const bootPercent = document.getElementById("bootPercent");

  if (!intro || !launch) return;

  createIntroParticles();

  const messages = [
    "CALIBRATING SENSOR MATRIX",
    "CONNECTING ROVER TELEMETRY",
    "LOADING FIELD ANALYTICS",
    "VERIFYING SOIL INTELLIGENCE",
    "SYSTEM READY"
  ];

  let progress = 0;

  const bootTimer = setInterval(() => {
    progress += Math.floor(Math.random() * 5) + 2;

    if (progress >= 100) {
      progress = 100;
      clearInterval(bootTimer);

      launch.disabled = false;
      launch.classList.add("ready");
      bootText.textContent = messages[4];
    } else {
      const index = Math.min(messages.length - 2, Math.floor(progress / 25));
      bootText.textContent = messages[index];
    }

    bootPercent.textContent = `${progress}%`;
  }, 120);

  launch.addEventListener("click", () => {
    intro.classList.add("hide");

    setTimeout(() => {
      intro.style.display = "none";
      document.body.classList.add("dashboard-entered");
    }, 1100);
  });
}

function setupUpload() {
  const form = document.getElementById("uploadForm");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();

    const input = document.getElementById("photoInput");
    const msg = document.getElementById("uploadMessage");

    if (!input.files[0]) return;

    const formData = new FormData();
    formData.append("photo", input.files[0]);

    msg.textContent = "Uploading field image...";

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });

      const result = await res.json();

      if (!res.ok) throw new Error(result.error || "Upload failed.");

      msg.textContent = "✓ Field image synchronized";
      input.value = "";

      await refreshDashboard();
    } catch (err) {
      msg.textContent = `✕ ${err.message}`;
    }
  });
}

function setupFilePreview() {
  const input = document.getElementById("photoInput");
  const box = document.getElementById("photoBox");

  if (!input || !box) return;

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);

    box.innerHTML = "";
    box.classList.add("scanning");

    const img = document.createElement("img");
    img.src = url;
    img.alt = "Selected field image preview";

    img.onload = () => {
      setTimeout(() => box.classList.remove("scanning"), 1200);
    };

    box.appendChild(img);
  });
}

function setOnlineState(isOnline) {
  const status = document.querySelector(".status");
  if (!status) return;

  status.classList.toggle("offline", !isOnline);
  const label = status.querySelector("span");

  if (label) label.textContent = isOnline ? "ROVER ONLINE" : "ROVER OFFLINE";
}

async function refreshDashboard() {
  try {
    const [latestRes, readingsRes] = await Promise.all([
      fetch("/api/readings/latest", { cache: "no-store" }),
      fetch("/api/readings", { cache: "no-store" })
    ]);

    if (!latestRes.ok || !readingsRes.ok) {
      throw new Error("API unavailable");
    }

    const latest = await latestRes.json();
    const readings = await readingsRes.json();

    setOnlineState(true);

    if (latest) {
      updateCards(latest);
      updateRecommendation(latest);
      updateNPK(latest);
      updatePhoto(latest);
      setGauge("speed", latest.speed, 40);
      setGauge("temp", latest.temperature, 80);
    }

    const signature = JSON.stringify(readings);

    if (signature !== lastDataSignature) {
      updateTable(readings);
      updateChart(readings);
      lastDataSignature = signature;
    }

    setText(
      "lastSync",
      `SYNC ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })}`
    );
  } catch (err) {
    console.error("Dashboard refresh error:", err);
    setOnlineState(false);
    setText("lastSync", "OFFLINE");
    setText("speedState", "OFFLINE");
    setText("tempState", "OFFLINE");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  buildTicks("speedTicks", 40, 5);
  buildTicks("tempTicks", 80, 10);

  setupCursorSystem();
  setupTilt();
  setupIntro();
  setupUpload();
  setupFilePreview();

  refreshDashboard();
  setInterval(refreshDashboard, 3000);
});
