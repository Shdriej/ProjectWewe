"use strict";

/* Only ever follow links back to our own pages, never to another site */
function safeNext() {
  const next = new URLSearchParams(location.search).get("next") || "";
  return /^[A-Za-z0-9_-]+\.html(\?[A-Za-z0-9_\-=&%.]*)?$/.test(next) ? next : "";
}

function goAfterLogin(user) {
  location.href = safeNext() || (user.role === "customer" ? "index.html" : "dashboard.html");
}

function selectTab(which) {
  const login = which === "login";
  $("#tab-login").setAttribute("aria-selected", String(login));
  $("#tab-register").setAttribute("aria-selected", String(!login));
  $("#login-form").hidden = !login;
  $("#register-form").hidden = login;
}

async function submit(form, errorBox, action) {
  errorBox.textContent = "";
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const result = await action();
    if (result.needsEmailConfirmation) {
      errorBox.textContent = "Account created. Check your email to confirm it, then log in.";
      button.disabled = false;
      return;
    }
    const { user } = result;
    goAfterLogin(user);
  } catch (err) {
    errorBox.textContent = err.message;
    button.disabled = false;
  }
}

$("#tab-login").addEventListener("click", () => selectTab("login"));
$("#tab-register").addEventListener("click", () => selectTab("register"));

$("#login-form").addEventListener("submit", e => {
  e.preventDefault();
  submit(e.target, $("#login-error"), () => api.login($("#login-email").value, $("#login-password").value));
});

$("#register-form").addEventListener("submit", e => {
  e.preventDefault();
  submit(e.target, $("#register-error"), () => api.register($("#reg-name").value, $("#reg-email").value, $("#reg-password").value));
});

(async function init() {
  try {
    await initApp();
    if (currentUser) goAfterLogin(currentUser);
  } catch { /* the forms still work */ }
})();
