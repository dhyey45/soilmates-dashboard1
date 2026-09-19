const launch = document.getElementById("dashboardButton");
const bootText = document.getElementById("bootText");
const bootPercent = document.getElementById("bootPercent");

const messages = [
  "CALIBRATING SENSOR MATRIX",
  "CONNECTING ROVER TELEMETRY",
  "LOADING FIELD ANALYTICS",
  "VERIFYING SOIL INTELLIGENCE",
  "SYSTEM READY"
];

function createParticles() {
  const host = document.querySelector(".intro-particles");
  if (!host) return;
  for (let i = 0; i < 38; i++) {
    const p = document.createElement("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${Math.random() * 100}%`;
    p.style.animationDelay = `${Math.random() * 4}s`;
    p.style.animationDuration = `${3 + Math.random() * 5}s`;
    host.appendChild(p);
  }
}

createParticles();

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
  launch.disabled = true;
  document.getElementById("introScreen").classList.add("hide");
  setTimeout(() => {
    window.location.href = "/access";
  }, 900);
});
