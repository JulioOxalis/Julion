import { requireUser, esc, renderSidebar } from "./app.js";

async function init() {
  const user = await requireUser();
  if (!user) return;

  document.getElementById("sidebar").innerHTML = renderSidebar(user, "settings");

  const grid = document.getElementById("settings-grid");

  // Check Drive connection by fetching repos
  let driveConnected = false;
  let repoCount = 0;
  try {
    const res  = await fetch("/api/repositories");
    const json = await res.json();
    driveConnected = json.success;
    repoCount = json.success ? (json.data?.length || 0) : 0;
  } catch { /* no-op */ }

  const avatar = user.picture
    ? `<img class="avatar-lg" src="${esc(user.picture)}" alt="${esc(user.name || "")}" loading="lazy"/>`
    : `<div class="avatar-lg avatar-fallback">${(user.name || user.email)[0].toUpperCase()}</div>`;

  const driveStatus = driveConnected
    ? `<span class="settings-badge-connected">&#10003; Connected</span>`
    : `<span class="settings-badge-disconnected">&#10007; Not connected</span>`;

  grid.innerHTML = `
    <!-- Account section -->
    <div class="info-card">
      <p class="settings-section-label">Account</p>
      <div class="settings-profile-row">
        ${avatar}
        <div>
          <p class="settings-profile-name">${esc(user.name || user.email)}</p>
          <p class="settings-profile-email">${esc(user.email)}</p>
        </div>
      </div>
    </div>

    <!-- Google Drive section -->
    <div class="info-card">
      <p class="settings-section-label">Google Drive</p>
      <div class="settings-row">
        <span class="settings-row-label">Connection status</span>
        ${driveStatus}
      </div>
      <div class="settings-row">
        <span class="settings-row-label">Repositories</span>
        <span class="settings-row-value">${driveConnected ? repoCount + " repositor" + (repoCount === 1 ? "y" : "ies") : "—"}</span>
      </div>
      <div class="settings-row">
        <span class="settings-row-label">Root folder</span>
        <span class="settings-row-value">JULION/</span>
      </div>
      <div class="settings-row" style="border-bottom:none;padding-bottom:0">
        <span class="settings-row-label">${driveConnected ? "Reconnect Google Drive" : "Connect Google Drive"}</span>
        <a href="/api/auth/google" class="settings-action-btn" style="text-decoration:none">
          ${driveConnected ? "Reconnect" : "Connect"}
        </a>
      </div>
    </div>

    <!-- CLI section -->
    <div class="info-card">
      <p class="settings-section-label">CLI Quick Reference</p>
      <div class="settings-row">
        <span class="settings-row-label">Connect Drive</span>
        <span class="settings-row-value" style="font-family:monospace;font-size:0.8rem">julion connect google --website</span>
      </div>
      <div class="settings-row">
        <span class="settings-row-label">Create snapshot</span>
        <span class="settings-row-value" style="font-family:monospace;font-size:0.8rem">julion seal --ultra --deposit</span>
      </div>
      <div class="settings-row">
        <span class="settings-row-label">Named repository</span>
        <span class="settings-row-value" style="font-family:monospace;font-size:0.8rem">julion seal --deposit --repository my-app</span>
      </div>
      <div class="settings-row">
        <span class="settings-row-label">Fetch snapshot</span>
        <span class="settings-row-value" style="font-family:monospace;font-size:0.8rem">julion fetch my-app snapshot.on -o ./out</span>
      </div>
    </div>

    <!-- Danger zone -->
    <div class="info-card">
      <p class="settings-section-label">Account Actions</p>
      <div class="settings-row" style="border-bottom:none;padding-bottom:0">
        <div>
          <p class="settings-row-label">Sign out</p>
          <p class="settings-row-value" style="margin-top:3px">Sign out of your Julion account</p>
        </div>
        <form method="post" action="/api/auth/logout">
          <button class="settings-action-btn settings-action-btn-danger" type="submit">Sign out</button>
        </form>
      </div>
    </div>`;
}

init();
