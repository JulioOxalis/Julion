// ── Shared app utilities ─────────────────────────────────────────────────────

export async function getUser() {
  try {
    const res  = await fetch("/api/auth/me");
    const json = await res.json();
    return json.success ? json.data : null;
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getUser();
  if (!user) { window.location.href = "/"; return null; }
  return user;
}

export function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n) return "0 B";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

export function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function renderSidebar(user, active) {
  const avatar = user.picture
    ? `<img class="avatar avatar-sm" src="${esc(user.picture)}" alt="${esc(user.name || "")}" loading="lazy"/>`
    : `<div class="avatar avatar-sm avatar-fallback" aria-hidden="true">${(user.name || user.email)[0].toUpperCase()}</div>`;

  return `
    <nav class="sidebar" aria-label="Main navigation">
      <div class="sidebar-logo">JULION</div>
      <div class="nav-links" role="list">
        <a href="/dashboard"    class="nav-link${active === "dashboard"    ? " nav-link-active" : ""}" aria-current="${active === "dashboard"    ? "page" : "false"}">Overview</a>
        <a href="/repositories" class="nav-link${active === "repositories" ? " nav-link-active" : ""}" aria-current="${active === "repositories" ? "page" : "false"}">Repositories</a>
        <button class="sidebar-terminal-btn" data-action="toggle-terminal" title="Toggle terminal (Ctrl+\`)">⌘ Terminal</button>
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          ${avatar}
          <div class="sidebar-user-info">
            <span class="sidebar-user-name">${esc(user.name || user.email)}</span>
            <span class="sidebar-user-email">${esc(user.email)}</span>
          </div>
        </div>
        <form method="post" action="/api/auth/logout">
          <button class="logout-btn" type="submit">Log out</button>
        </form>
      </div>
    </nav>`;
}

export function showError(container, msg) {
  container.innerHTML = `<div class="empty-state"><p>${esc(msg)}</p></div>`;
}
