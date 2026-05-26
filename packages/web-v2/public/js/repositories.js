import { requireUser, esc, formatDate, renderSidebar, showError } from "./app.js";

async function init() {
  const user = await requireUser();
  if (!user) return;

  document.getElementById("sidebar").innerHTML = renderSidebar(user, "repositories");

  const grid = document.getElementById("repo-grid");

  try {
    const res  = await fetch("/api/repositories");
    const json = await res.json();

    if (!json.success) {
      showError(document.getElementById("repo-table-wrap"),
        json.error === "Google Drive not connected"
          ? "Google Drive is not connected. <a href='/api/auth/google'>Connect now</a>"
          : "Failed to load repositories.");
      return;
    }

    const repos = json.data;
    if (!repos.length) {
      grid.innerHTML = `<div class="empty-cell" style="grid-column:1/-1;padding:32px 0;text-align:center;color:rgba(241,245,249,0.35)">No repositories found. Run <code>julion seal --deposit --repository my-repo</code> to create one.</div>`;
      return;
    }

    grid.innerHTML = repos
      .map(
        (r) => `<a class="repo-card" href="/repository?repo=${encodeURIComponent(r.name)}">
          <div class="repo-card-icon">&#128230;</div>
          <div class="repo-card-name">${esc(r.name)}</div>
          <div class="repo-card-meta">
            <span>&#128197; ${formatDate(r.modifiedTime)}</span>
          </div>
        </a>`
      )
      .join("");

    // Wire search filter
    const searchInput = document.getElementById("repo-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const q = searchInput.value.toLowerCase().trim();
        grid.querySelectorAll(".repo-card").forEach(card => {
          const name = (card.querySelector(".repo-card-name")?.textContent || "").toLowerCase();
          card.style.display = !q || name.includes(q) ? "" : "none";
        });
      });
    }
  } catch (err) {
    showError(document.getElementById("repo-table-wrap"), "Failed to load repositories.");
  }
}

init();
