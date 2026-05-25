import { requireUser, esc, renderSidebar } from "./app.js";

async function init() {
  const user = await requireUser();
  if (!user) return;

  // Render sidebar
  document.getElementById("sidebar").innerHTML = renderSidebar(user, "dashboard");

  // Render profile card
  const avatar = user.picture
    ? `<img class="avatar" src="${esc(user.picture)}" alt="${esc(user.name || "")}" width="56" height="56" loading="lazy"/>`
    : `<div class="avatar avatar-fallback" aria-hidden="true">${(user.name || user.email)[0].toUpperCase()}</div>`;

  document.getElementById("profile-card").innerHTML = `
    <div class="profile-row">
      ${avatar}
      <div>
        <h2 style="font-size:1.1rem;font-weight:700;margin:0 0 4px">${esc(user.name || user.email)}</h2>
        <p class="status-text" style="margin:0;font-size:0.82rem">${esc(user.email)}</p>
      </div>
    </div>`;

  document.getElementById("page-subtitle").textContent =
    "Welcome back, " + (user.name ? user.name.split(" ")[0] : user.email);

  // Fetch repo count
  try {
    const res   = await fetch("/api/repositories");
    const json  = await res.json();
    const repos = json.success ? json.data : [];
    const count = repos.length;

    document.getElementById("drive-card").innerHTML = `
      <h3 class="card-label">Google Drive</h3>
      <p class="dash-stat-num">${count}</p>
      <p class="stat-detail">
        <span class="badge badge-green">Connected</span>
        &nbsp;<a class="inline-link" href="/repositories">${count === 1 ? "1 repository" : count + " repositories"} &rarr;</a>
      </p>`;
  } catch {
    document.getElementById("drive-card").innerHTML = `
      <h3 class="card-label">Google Drive</h3>
      <p><span class="badge">Not connected</span> Link your Drive to start depositing snapshots.</p>
      <div class="button-row"><a class="button" href="/api/auth/google">Connect Google Drive</a></div>`;
  }
}

init();
