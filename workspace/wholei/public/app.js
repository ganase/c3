const form = document.querySelector("#projectForm");
const nameInput = document.querySelector("#projectName");
const statusEl = document.querySelector("#status");
const listEl = document.querySelector("#projectList");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    setStatus("案件名を入力してください。", true);
    return;
  }
  setStatus("案件フォルダと Obsidian 初期設定を作成しています。");
  await request("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
  nameInput.value = "";
  setStatus("作成しました。Source フォルダに関連ファイルを保存できます。");
  await loadProjects();
});

listEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='analyze']");
  if (!button) return;
  button.disabled = true;
  setStatus("解析中です。ネットワーク図、WHOLEI.md、PPTX、Obsidian ノートを生成しています。");
  try {
    await request(`/api/projects/${button.dataset.id}/analyze`, { method: "POST" });
    setStatus("生成が完了しました。案件フォルダ内の出力ファイルを確認してください。");
    await loadProjects();
  } finally {
    button.disabled = false;
  }
});

await loadProjects();

async function loadProjects() {
  const data = await request("/api/projects");
  listEl.innerHTML = "";
  if (!data.projects.length) {
    listEl.innerHTML = `<div class="project"><div><h3>案件はまだありません</h3><p class="project-meta">案件を作成すると、Obsidian vault と Source フォルダがここに表示されます。</p></div></div>`;
    return;
  }
  for (const project of data.projects) {
    const article = document.createElement("article");
    article.className = "project";
    article.innerHTML = `
      <div>
        <h3>${escapeHtml(project.name)}</h3>
        <div class="project-meta">最終生成: ${project.lastRunAt ? formatDate(project.lastRunAt) : "未実行"}</div>
        <div class="project-paths">
          <span>Vault: ${escapeHtml(project.vaultPath)}</span>
          <span>Source: ${escapeHtml(project.sourcePath)}</span>
          <span>WHOLEI.md: ${escapeHtml(project.outputs["WHOLEI.md"] || "未生成")}</span>
          <span>PPTX: ${escapeHtml(project.outputs["WHOLEI.pptx"] || "未生成")}</span>
          <span>Network SVG: ${escapeHtml(project.outputs["network.svg"] || "未生成")}</span>
        </div>
      </div>
      <div class="project-actions">
        <a class="button secondary" href="${escapeHtml(project.obsidianUrl)}">Obsidian</a>
        <button class="button primary" type="button" data-action="analyze" data-id="${escapeHtml(project.id)}">処理開始</button>
      </div>
    `;
    listEl.append(article);
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "処理に失敗しました。", true);
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#9d3b32" : "";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
