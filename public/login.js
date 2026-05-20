const form = document.querySelector("#loginForm");
const message = document.querySelector("#loginMessage");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    message.textContent = "Invalid email or password.";
    return;
  }

  window.location.href = "/";
});
