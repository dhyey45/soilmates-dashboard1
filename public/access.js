const form = document.getElementById("loginForm");
const password = document.getElementById("password");
const toggle = document.getElementById("togglePassword");
const button = document.getElementById("loginButton");
const error = document.getElementById("loginError");

password.addEventListener("input", () => {
  error.textContent = "";
  password.classList.remove("invalid");
});

toggle.addEventListener("click", () => {
  const showing = password.type === "text";
  password.type = showing ? "password" : "text";
  toggle.textContent = showing ? "◉" : "◌";
  toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = password.value.trim();
  if (!value) {
    error.textContent = "Please enter the access password.";
    password.classList.add("invalid");
    password.focus();
    return;
  }

  button.disabled = true;
  button.classList.add("loading");
  error.textContent = "";

  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: value })
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Incorrect password.");
    }

    document.querySelector(".access-card").classList.add("unlocking");
    setTimeout(() => {
      window.location.href = result.redirect || "/dashboard";
    }, 450);
  } catch (err) {
    error.textContent = err.message;
    password.classList.add("invalid");
    password.select();
    button.disabled = false;
    button.classList.remove("loading");
  }
});
