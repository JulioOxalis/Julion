import { requireUser, esc, formatDate, renderSidebar, showError } from "./app.js";

async function init() {
  const user = await requireUser();
  if (!user) return;

  document.getElementById("sidebar").innerHTML = renderSidebar(user, "repositories");

  const tbody = document.getElementById("repo-tbody");

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
      tbody.innerHTML = `<tr><td colspan="2" class="empty-cell">No repositories found. Run <code>julion seal --deposit --repository my-repo</code> to create one.</td></tr>`;
      return;
    }

    tbody.innerHTML = repos
      .map(
        (r) => `<tr>
          <td><a class="table-link" href="/repository?repo=${encodeURIComponent(r.name)}">${esc(r.name)}</a></td>
          <td>${formatDate(r.modifiedTime)}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    showError(document.getElementById("repo-table-wrap"), "Failed to load repositories.");
  }
}

init();
