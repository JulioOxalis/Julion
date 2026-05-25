import { requireUser, esc, formatBytes, formatDate, renderSidebar } from "./app.js";

// ── Terminal ──────────────────────────────────────────────────────────────────
function toggleTerminal() {
  const panel = document.getElementById("terminal-panel");
  if (!panel) return;
  const open = panel.classList.toggle("open");
  panel.setAttribute("aria-hidden", String(!open));
  if (open) document.getElementById("terminal-input")?.focus();
}

function appendTermLine(text, type = "result") {
  const output = document.getElementById("terminal-output");
  if (!output) return;
  const el = document.createElement("pre");
  el.className = `terminal-line terminal-line-${type}`;
  el.textContent = text;
  output.appendChild(el);
  output.scrollTop = output.scrollHeight;
}

function initTerminal() {
  const panel  = document.getElementById("terminal-panel");
  const output = document.getElementById("terminal-output");
  const input  = document.getElementById("terminal-input");
  if (!panel) return;

  appendTermLine("Welcome to Julion Terminal — type `help` for available commands.", "info");

  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const cmd = input.value.trim();
    if (!cmd) return;
    input.value = "";
    appendTermLine("julion> " + cmd, "prompt");
    if (cmd === "clear") { output.innerHTML = ""; return; }
    input.disabled = true;
    try {
      const res  = await fetch(`/api/terminal?cmd=${encodeURIComponent(cmd)}`);
      const json = await res.json();
      if (json.success) {
        if (json.data.output === "__CLEAR__") output.innerHTML = "";
        else appendTermLine(json.data.output, json.data.diff ? "diff" : (json.data.type || "result"));
      } else {
        appendTermLine("Error: " + (json.error || "unknown"), "error");
      }
    } catch {
      appendTermLine("Network error", "error");
    } finally {
      input.disabled = false;
      input.focus();
      output.scrollTop = output.scrollHeight;
    }
  });

  document.getElementById("terminal-close-btn")?.addEventListener("click", () => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  });
  document.getElementById("terminal-clear-btn")?.addEventListener("click", () => { output.innerHTML = ""; });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-action=toggle-terminal]")) toggleTerminal();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "`") { e.preventDefault(); toggleTerminal(); }
  });
}

// ── Activity feed ─────────────────────────────────────────────────────────────
async function loadActivity() {
  const listEl = document.getElementById("activity-list");
  try {
    const res  = await fetch("/api/activity");
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const { activity, totalRepos, totalSnaps } = json.data;

    // Update drive card with totals
    const driveCard = document.getElementById("drive-card");
    if (driveCard) {
      driveCard.innerHTML = `
        <h3 class="card-label">Google Drive</h3>
        <div style="display:flex;gap:24px;align-items:flex-end;margin-bottom:10px">
          <div>
            <p class="dash-stat-num">${totalRepos}</p>
            <p class="stat-detail" style="margin:0;font-size:0.8rem">Repositor${totalRepos === 1 ? "y" : "ies"}</p>
          </div>
          <div>
            <p class="dash-stat-num" style="color:#5dd8a0">${totalSnaps}</p>
            <p class="stat-detail" style="margin:0;font-size:0.8rem">Snapshot${totalSnaps === 1 ? "" : "s"}</p>
          </div>
        </div>
        <p class="stat-detail">
          <span class="badge badge-green">Connected</span>
          &nbsp;<a class="inline-link" href="/repositories">View all →</a>
        </p>`;
    }

    if (!activity.length) {
      listEl.innerHTML = `<div class="activity-item"><span style="color:rgba(247,248,251,0.35);font-size:0.85rem">No activity yet — seal your first snapshot.</span></div>`;
      return;
    }

    listEl.innerHTML = activity.map(item => `
      <a class="activity-item" href="/repository?repo=${encodeURIComponent(item.repo)}&snapshot=${encodeURIComponent(item.name)}">
        <div class="activity-icon">📦</div>
        <div class="activity-body">
          <div class="activity-snap">${esc(item.name)}</div>
          <div class="activity-repo">${esc(item.repo)}</div>
        </div>
        <div class="activity-meta">
          <div>${esc(item.sizeFormatted)}</div>
          <div>${formatDate(item.modifiedTime)}</div>
        </div>
      </a>`).join("");
  } catch {
    if (listEl) listEl.innerHTML = `<div class="activity-item"><span style="color:rgba(247,248,251,0.35);font-size:0.85rem">Could not load activity.</span></div>`;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const user = await requireUser();
  if (!user) return;

  document.getElementById("sidebar").innerHTML = renderSidebar(user, "dashboard");
  initTerminal();

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

  loadActivity();
}

init();
