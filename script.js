const sideTabs = document.querySelectorAll(".side-tab");
const sidePanels = document.querySelectorAll(".side-panel");
const editorTabsEl = document.getElementById("editorTabs");
const sessionViewEl = document.getElementById("sessionView");
const fileViewerEl = document.getElementById("fileViewer");
const viewerPathEl = document.getElementById("viewerPath");
const viewerContentEl = document.getElementById("viewerContent");

const tabData = new Map([["session", { type: "session", label: "session.ai" }]]);
let activeTabId = "session";

const rootFolderName = document.getElementById("rootFolderName");
const rootPathDisplay = document.getElementById("rootPathDisplay");
const chooseRootButton = document.getElementById("chooseRootButton");
const appList = document.getElementById("appList");
const projectName = document.getElementById("projectName");
const projectStatus = document.getElementById("projectStatus");
const changeCount = document.getElementById("changeCount");
const workspaceTitle = document.getElementById("workspaceTitle");
const titleInput = document.getElementById("titleInput");
const folderInput = document.getElementById("folderInput");
const instructionInput = document.getElementById("instructionInput");
const commandHint = document.getElementById("commandHint");
const rootNode = document.getElementById("rootNode");
const nodeOne = document.getElementById("nodeOne");
const nodeTwo = document.getElementById("nodeTwo");
const nodeThree = document.getElementById("nodeThree");
const reusableFileInput = document.getElementById("reusableFileInput");
const fileList = document.getElementById("fileList");
const saveFilesButton = document.getElementById("saveFilesButton");
const fileSaveStatus = document.getElementById("fileSaveStatus");
const statusFolder = document.getElementById("statusFolder");
const processStream = document.getElementById("processStream");
const mermaidView = document.getElementById("mermaidView");
const generateDiagramButton = document.getElementById("generateDiagramButton");
const githubSettingsButton = document.getElementById("githubSettingsButton");
const githubPushButton = document.getElementById("githubPushButton");
const localRunButton = document.getElementById("localRunButton");
const engineButtons = document.querySelectorAll(".engine-option");
const engineStatus = document.getElementById("engineStatus");
const statusEngine = document.getElementById("statusEngine");

let reusableFiles = [];
let rootDirectoryHandle = null;
const appDirectoryHandles = new Map();
let awaitingChoice = false;
let recentOutputLines = [];
const CHOICE_PATTERN = /^\s*\d+[.)]\s+\S/;

function detectChoices(lines) {
  const choiceLines = lines.filter((line) => CHOICE_PATTERN.test(line));
  return choiceLines.length >= 2 ? choiceLines : null;
}

function appendChoiceBlock(choices) {
  choices.forEach((choice) => {
    const line = document.createElement("p");
    line.className = "choice-line";
    const label = document.createElement("span");
    label.textContent = "[choice]";
    line.append(label, ` ${choice.trim()}`);
    processStream.append(line);
  });
  processStream.scrollTop = processStream.scrollHeight;
}

function enterChoiceMode(choices) {
  awaitingChoice = true;
  appendChoiceBlock(choices);
  appendProcess("choice", "番号を入力して「プロンプトを実行」を押してください");
  commandHint.textContent = "番号を入力して選択してください。例: 1";
  instructionInput.value = "";
  instructionInput.placeholder = "例: 1";
  instructionInput.focus();
  document.getElementById("runInstructionButton").classList.add("awaiting-choice");
}

function exitChoiceMode() {
  awaitingChoice = false;
  recentOutputLines = [];
  instructionInput.placeholder = "";
  document.getElementById("runInstructionButton").classList.remove("awaiting-choice");
}
const STATUS_FRAMES = ["●〇〇〇", "〇●〇〇", "〇〇◎〇", "〇〇〇✕"];
let statusAnimationTimer = null;
let statusAnimationIndex = 0;
const ROOT_STATE_KEY = "codeConsoleRootState";
const ENGINE_STATE_KEY = "codeConsoleEngine";
const ENGINE_CONFIG = {
  codex: {
    label: "Codex",
    command: "codex",
    status: "Codex runner"
  },
  claude: {
    label: "Claude Code",
    command: "claude",
    status: "Claude Code runner"
  }
};
let activeEngine = localStorage.getItem(ENGINE_STATE_KEY) || "codex";

function getFileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["js", "ts", "jsx", "tsx", "mjs", "cjs"].includes(ext)) return "📄";
  if (["md", "txt", "log"].includes(ext)) return "📝";
  if (["json", "yaml", "yml", "toml"].includes(ext)) return "📋";
  if (["html", "htm"].includes(ext)) return "🌐";
  if (["css", "scss", "sass"].includes(ext)) return "🎨";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) return "🖼";
  if (["bat", "sh", "cmd", "ps1"].includes(ext)) return "⚙";
  return "📄";
}

async function readDirEntries(dirHandle) {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    entries.push({ name, handle, kind: handle.kind });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "ja");
  });
  return entries;
}

async function renderDirTree(containerEl, dirHandle) {
  containerEl.innerHTML = '<div class="tree-loading">読込中...</div>';
  let entries;
  try {
    entries = await readDirEntries(dirHandle);
  } catch {
    containerEl.innerHTML = '<div class="tree-loading">読込できませんでした</div>';
    return;
  }
  containerEl.innerHTML = "";

  for (const { name, handle, kind } of entries) {
    if (kind === "directory") {
      const wrap = document.createElement("div");
      const row = document.createElement("button");
      row.className = "tree-row child";
      row.innerHTML = `<span class="twisty">▸</span><span class="tree-icon">📁</span>${escapeHtml(name)}`;
      const subContainer = document.createElement("div");
      subContainer.style.paddingLeft = "14px";
      subContainer.style.display = "none";
      let loaded = false;
      row.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (subContainer.style.display === "none") {
          subContainer.style.display = "";
          row.querySelector(".twisty").textContent = "▾";
          if (!loaded) {
            loaded = true;
            await renderDirTree(subContainer, handle);
          }
          openDirTab(name, handle);
        } else {
          subContainer.style.display = "none";
          row.querySelector(".twisty").textContent = "▸";
        }
      });
      wrap.append(row, subContainer);
      containerEl.append(wrap);
    } else {
      const row = document.createElement("button");
      row.className = "tree-row child";
      row.innerHTML = `<span class="tree-icon">${getFileIcon(name)}</span>${escapeHtml(name)}`;
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        openFileTab(name, handle);
      });
      containerEl.append(row);
    }
  }
}

function createTabEl(tabId, label) {
  const tab = document.createElement("div");
  tab.className = "editor-tab";
  tab.dataset.tabId = tabId;
  tab.setAttribute("role", "tab");
  tab.setAttribute("tabindex", "0");
  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  const closeBtn = document.createElement("button");
  closeBtn.className = "tab-close";
  closeBtn.textContent = "×";
  closeBtn.title = "閉じる";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });
  tab.append(labelSpan, closeBtn);
  tab.addEventListener("click", () => activateTab(tabId));
  tab.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") activateTab(tabId);
  });
  return tab;
}

function activateTab(tabId) {
  activeTabId = tabId;
  editorTabsEl.querySelectorAll(".editor-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tabId === tabId);
  });
  const tab = tabData.get(tabId);
  if (!tab || tab.type === "session") {
    sessionViewEl.hidden = false;
    fileViewerEl.hidden = true;
  } else {
    sessionViewEl.hidden = true;
    fileViewerEl.hidden = false;
    loadTabContent(tab);
  }
}

function closeTab(tabId) {
  if (tabId === "session") return;
  tabData.delete(tabId);
  editorTabsEl.querySelector(`[data-tab-id="${tabId}"]`)?.remove();
  if (activeTabId === tabId) activateTab("session");
}

function openFileTab(name, fileHandle) {
  const tabId = `file:${name}`;
  if (!tabData.has(tabId)) {
    tabData.set(tabId, { type: "file", label: name, handle: fileHandle });
    editorTabsEl.append(createTabEl(tabId, name));
  } else {
    tabData.get(tabId).handle = fileHandle;
  }
  activateTab(tabId);
}

function openDirTab(name, dirHandle) {
  const tabId = `dir:${name}`;
  if (!tabData.has(tabId)) {
    tabData.set(tabId, { type: "dir", label: `📁 ${name}`, handle: dirHandle });
    editorTabsEl.append(createTabEl(tabId, `📁 ${name}`));
  } else {
    tabData.get(tabId).handle = dirHandle;
  }
  activateTab(tabId);
}

async function loadTabContent(tab) {
  viewerPathEl.textContent = tab.label;
  viewerContentEl.innerHTML = '<div class="tree-loading">読込中...</div>';

  try {
    if (tab.type === "file") {
      const file = await tab.handle.getFile();
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const imgExts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"];
      if (imgExts.includes(ext)) {
        const url = URL.createObjectURL(file);
        const img = document.createElement("img");
        img.src = url;
        img.style.maxWidth = "100%";
        img.onload = () => URL.revokeObjectURL(url);
        viewerContentEl.innerHTML = "";
        viewerContentEl.append(img);
      } else {
        const text = await file.text();
        const pre = document.createElement("pre");
        pre.textContent = text;
        viewerContentEl.innerHTML = "";
        viewerContentEl.append(pre);
      }
    } else if (tab.type === "dir") {
      const entries = await readDirEntries(tab.handle);
      viewerContentEl.innerHTML = "";
      if (entries.length === 0) {
        viewerContentEl.innerHTML = '<div class="tree-loading">空のフォルダです</div>';
        return;
      }
      for (const { name, handle, kind } of entries) {
        const entry = document.createElement("div");
        entry.className = "viewer-dir-entry";
        entry.innerHTML = kind === "directory" ? `📁 ${escapeHtml(name)}` : `${getFileIcon(name)} ${escapeHtml(name)}`;
        entry.addEventListener("click", () => {
          if (kind === "directory") openDirTab(name, handle);
          else openFileTab(name, handle);
        });
        viewerContentEl.append(entry);
      }
    }
  } catch (e) {
    viewerContentEl.innerHTML = `<div class="tree-loading">読込エラー: ${escapeHtml(e.message)}</div>`;
  }
}

function saveRootState() {
  const folders = Array.from(appList.querySelectorAll(".tree-item")).map((item) => ({
    folder: item.dataset.folder,
    title: item.dataset.title
  }));
  const active = appList.querySelector(".tree-item.active");
  localStorage.setItem(
    ROOT_STATE_KEY,
    JSON.stringify({
      rootName: rootFolderName.textContent,
      folders,
      activeFolder: active?.dataset.folder || getFolderName()
    })
  );
}

function loadRootState() {
  try {
    const saved = JSON.parse(localStorage.getItem(ROOT_STATE_KEY) || "null");
    if (!saved || !Array.isArray(saved.folders) || saved.folders.length === 0) {
      return;
    }
    rootFolderName.textContent = saved.rootName || "未指定";
    renderAppFolders(saved.folders.map((item) => item.folder));
    const active = appList.querySelector(`[data-folder="${CSS.escape(saved.activeFolder)}"]`);
    if (active) {
      selectApp(active, true);
    }
    updatePathDisplay(saved.activeFolder);
    appendProcess("root", "前回のroot設定を復元しました。");
  } catch (error) {
    localStorage.removeItem(ROOT_STATE_KEY);
  }
}

sideTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    sideTabs.forEach((item) => item.classList.remove("active"));
    sidePanels.forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`${tab.dataset.sideTab}Pane`).classList.add("active");
  });
});

function setActiveSideTab(name) {
  const tab = document.querySelector(`[data-side-tab="${name}"]`);
  if (tab) {
    tab.click();
  }
}

function getFolderName() {
  const rawName = folderInput.value.trim() || "new-project";
  return rawName.replace(/[^A-Za-z0-9_-]/g, "-");
}

function updateFileStatus(text) {
  fileSaveStatus.textContent = text;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

function appendProcess(tag, text) {
  const line = document.createElement("p");
  const label = document.createElement("span");
  label.textContent = `[${tag}]`;
  line.append(label, ` ${text}`);
  processStream.append(line);
  scrollProcessToLatest(line);
}

function scrollProcessToLatest(line) {
  processStream.scrollTop = processStream.scrollHeight;
  requestAnimationFrame(() => {
    processStream.scrollTop = processStream.scrollHeight;
    line.scrollIntoView({ block: "end", inline: "nearest" });
  });
}

function setOptionalText(element, text) {
  if (element) {
    element.textContent = text;
  }
}

function stopStatusAnimation(finalText) {
  if (statusAnimationTimer) {
    clearInterval(statusAnimationTimer);
    statusAnimationTimer = null;
  }
  if (finalText) {
    projectStatus.textContent = finalText;
  }
}

function startStatusAnimation(label) {
  stopStatusAnimation();
  statusAnimationIndex = 0;
  projectStatus.textContent = `${STATUS_FRAMES[statusAnimationIndex]} ${label}`;
  statusAnimationTimer = setInterval(() => {
    statusAnimationIndex = (statusAnimationIndex + 1) % STATUS_FRAMES.length;
    projectStatus.textContent = `${STATUS_FRAMES[statusAnimationIndex]} ${label}`;
  }, 180);
}

function getEngine() {
  return ENGINE_CONFIG[activeEngine] || ENGINE_CONFIG.codex;
}

function setEngine(engineName) {
  activeEngine = ENGINE_CONFIG[engineName] ? engineName : "codex";
  const engine = getEngine();

  engineButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.engine === activeEngine);
  });
  setOptionalText(engineStatus, engine.status);
  setOptionalText(statusEngine, engine.label);
  localStorage.setItem(ENGINE_STATE_KEY, activeEngine);
  appendProcess("engine", `${engine.label} を選択しました。`);
}

function getDisplayPath(folder = getFolderName()) {
  const root = rootFolderName.textContent === "未指定" ? "root未指定" : rootFolderName.textContent;
  return `${root} / ${folder}`;
}

function updatePathDisplay(folder = getFolderName()) {
  const path = getDisplayPath(folder);
  rootPathDisplay.textContent = path;
  fileSaveStatus.textContent = `保存先: ${path}/`;
  return path;
}

function runOperation(kind, prompt) {
  const engine = getEngine();
  startStatusAnimation(`${engine.label} 実行中`);
  appendProcess(kind, `[${engine.label}] ${prompt}`);
  appendProcess("runner", `${engine.command} adapter -> ${getDisplayPath()}`);
  appendProcess("prompt", `対象: ${getDisplayPath()}`);
}

async function executeCli(prompt) {
  const engine = getEngine();
  startStatusAnimation(`${engine.label} CLI 実行中`);
  appendProcess("cli", `POST /api/run -> ${engine.label}`);

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        engine: activeEngine,
        folder: getFolderName(),
        prompt
      })
    });
    if (!response.ok || !response.body) {
      const result = await response.json();
      appendProcess("err", result.error || `HTTP ${response.status}`);
      stopStatusAnimation("CLI エラー");
      changeCount.textContent = "check log";
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      lines.filter(Boolean).forEach((line) => {
        const message = JSON.parse(line);

        if (message.type === "start") {
          appendProcess("cwd", message.cwd || getDisplayPath());
          appendProcess("cmd", message.command || engine.command);
          return;
        }

        if (message.type === "stdout") {
          const outputLines = message.text.split(/\r?\n/).filter(Boolean);
          outputLines.forEach((outputLine) => {
            appendProcess("out", outputLine);
            recentOutputLines.push(outputLine);
            if (recentOutputLines.length > 30) recentOutputLines.shift();
          });
          if (!awaitingChoice) {
            const choices = detectChoices(recentOutputLines);
            if (choices) {
              enterChoiceMode(choices);
            }
          }
          return;
        }

        if (message.type === "stderr" || message.type === "error") {
          message.text.split(/\r?\n/).filter(Boolean).forEach((outputLine) => appendProcess("err", outputLine));
          if (message.type === "error") {
            stopStatusAnimation("CLI エラー");
            changeCount.textContent = "check log";
          }
          return;
        }

        if (message.type === "close") {
          stopStatusAnimation(message.ok ? "CLI 完了" : "CLI エラー");
          changeCount.textContent = message.ok ? "updated" : "check log";
          if (!awaitingChoice) {
            recentOutputLines = [];
          }
        }
      });
    }
  } catch (error) {
    appendProcess("cli", "ローカルサーバーに接続できません。run.bat で起動してください。");
    appendProcess("err", error.message);
    stopStatusAnimation("接続待ち");
  }
}

function renderFileList() {
  if (reusableFiles.length === 0) {
    fileList.innerHTML = "<li>未選択</li>";
    updatePathDisplay();
    return;
  }

  fileList.innerHTML = reusableFiles
    .map((file) => {
      const safeName = escapeHtml(file.name);
      const safeFolder = escapeHtml(getFolderName());
      return `<li>${safeName} → ${safeFolder}/${safeName}</li>`;
    })
    .join("");
  updatePathDisplay();
}

function selectApp(item, keepExpanded = false) {
  stopStatusAnimation();
  const wasActive = item.classList.contains("active");
  document.querySelectorAll(".tree-item").forEach((treeItem) => treeItem.classList.remove("active"));
  item.classList.add("active");
  if (!keepExpanded) {
    item.classList.toggle("expanded", wasActive ? !item.classList.contains("expanded") : true);
  }

  const twisty = item.querySelector(".twisty");
  if (twisty) {
    twisty.textContent = item.classList.contains("expanded") ? "▾" : "▸";
  }

  const title = item.dataset.title || item.querySelector("strong")?.textContent || "アプリ";
  const folder = item.dataset.folder || item.querySelector("strong")?.textContent || "app";

  titleInput.value = title;
  folderInput.value = folder;
  statusFolder.textContent = folder;
  updatePathDisplay(folder);
  rootNode.textContent = folder;
  projectName.textContent = title;
  projectStatus.textContent = "読込済み";
  changeCount.textContent = "0 files";
  workspaceTitle.textContent = title;
  setOptionalText(nodeOne, "目的");
  setOptionalText(nodeTwo, "影響");
  setOptionalText(nodeThree, "確認");
  commandHint.textContent = "このフォルダで続けます。";
  renderFileList();
  saveRootState();
  appendProcess("folder", `${folder} を選択しました。`);

  const dirHandle = appDirectoryHandles.get(folder);
  const childrenEl = item.querySelector(".tree-children");
  if (dirHandle && childrenEl) {
    renderDirTree(childrenEl, dirHandle);
  }
}

function renderAppFolders(folders) {
  appList.innerHTML = folders
    .map((folder, index) => {
      const safeFolder = escapeHtml(folder);
      const title = folder
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
      return `
        <div class="tree-item${index === 0 ? " active expanded" : ""}" data-title="${escapeHtml(title)}" data-folder="${safeFolder}">
          <button class="tree-row app-item">
            <span class="twisty">${index === 0 ? "▾" : "▸"}</span>
            <span class="tree-icon">📁</span>
            <strong>${safeFolder}</strong>
          </button>
          <div class="tree-children">
            <button class="tree-row child"><span class="tree-icon">📄</span> README.md</button>
            <button class="tree-row child"><span class="tree-icon">📄</span> DESIGN.md</button>
            <button class="tree-row child"><span class="tree-icon">📁</span> src</button>
          </div>
        </div>
      `;
    })
    .join("");

  appList.querySelectorAll(".tree-item").forEach((item) => {
    item.querySelector(".app-item").addEventListener("click", () => selectApp(item));
    item.querySelectorAll(".child").forEach((child) => {
      child.addEventListener("click", (event) => {
        event.stopPropagation();
        appendProcess("file", `${item.dataset.folder}/${child.textContent.trim()} を選択しました。`);
      });
    });
  });

  const firstApp = appList.querySelector(".tree-item");
  if (firstApp) {
    selectApp(firstApp, true);
  }
}

async function chooseRootFolder() {
  if (!window.showDirectoryPicker) {
    rootFolderName.textContent = "モックルート";
    rootDirectoryHandle = null;
    appDirectoryHandles.clear();
    renderAppFolders(["code-console", "booking-app", "form-checker"]);
    appendProcess("root", "ルート指定の代わりにモック一覧を表示しました。");
    return;
  }

  try {
    const rootHandle = await window.showDirectoryPicker();
    rootDirectoryHandle = rootHandle;
    const folders = [];
    appDirectoryHandles.clear();

    for await (const [name, handle] of rootHandle.entries()) {
      if (handle.kind === "directory") {
        folders.push(name);
        appDirectoryHandles.set(name, handle);
      }
    }

    rootFolderName.textContent = rootHandle.name;
    renderAppFolders(folders.length > 0 ? folders : ["new-project"]);
    appendProcess("root", `${rootHandle.name} を読み込みました。`);
  } catch (error) {
    rootFolderName.textContent = "未指定";
    appendProcess("root", "ルート指定をキャンセルしました。");
  }
}

function createNewProject() {
  stopStatusAnimation();
  titleInput.value = "";
  folderInput.value = "";
  projectName.textContent = "新規";
  projectStatus.textContent = "未実行";
  changeCount.textContent = "0 files";
  workspaceTitle.textContent = "新しい作業";
  instructionInput.value = "";
  commandHint.textContent = "プロンプトを入力してください。";
  rootNode.textContent = "new-project";
  setOptionalText(nodeOne, "タイトル");
  setOptionalText(nodeTwo, "フォルダ");
  setOptionalText(nodeThree, "要件");
  appendProcess("new", "新規作成を開始しました。");
  appendProcess("next", "タイトル、フォルダ名、プロンプトを入力してください。");
  renderFileList();
  updatePathDisplay();
  setActiveSideTab("status");
}

function openExistingProject() {
  setActiveSideTab("folders");
  appendProcess("open", "フォルダペインに切り替えました。既存フォルダを選択してください。");
}

async function runInstruction() {
  const instruction = instructionInput.value.trim();
  const title = titleInput.value.trim();
  const folder = getFolderName();
  const engine = getEngine();

  folderInput.value = folder;
  statusFolder.textContent = folder;
  updatePathDisplay(folder);

  if (!instruction) {
    commandHint.textContent = "プロンプトを入力してください。";
    instructionInput.focus();
    return;
  }

  projectName.textContent = title || "新規";
  exitChoiceMode();
  startStatusAnimation(`${engine.label} 確認中`);
  changeCount.textContent = "確認中";
  commandHint.textContent = "処理を開始しました。";
  instructionInput.value = "";
  rootNode.textContent = folder;
  setOptionalText(nodeOne, "目的抽出");
  setOptionalText(nodeTwo, "影響確認");
  setOptionalText(nodeThree, "方針確認");
  appendProcess("input", instruction);
  appendProcess("runner", `${engine.command} adapter -> prompt`);
  appendProcess("確認", "入力内容を受け取りました。");
  appendProcess("図式化", "目的、影響、確認事項をステータスペインに反映しました。");
  appendProcess("方針", `${folder}/ に作業する前提で整理しています。`);
  appendProcess("待機", "承認後に編集と記録へ進みます。");
  renderFileList();
  setActiveSideTab("status");
  await executeCli(instruction);
}

async function saveDiagramToProject(folder, content) {
  let projectHandle = appDirectoryHandles.get(folder);
  if (!projectHandle && rootDirectoryHandle) {
    projectHandle = await rootDirectoryHandle.getDirectoryHandle(folder, { create: true });
    appDirectoryHandles.set(folder, projectHandle);
  }
  if (!projectHandle) {
    appendProcess("save", `${getDisplayPath(folder)}/architecture.mmd に保存予定です。`);
    return;
  }

  const fileHandle = await projectHandle.getFileHandle("architecture.mmd", { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  appendProcess("save", `${getDisplayPath(folder)}/architecture.mmd に保存しました。`);
}

async function generateDiagram() {
  stopStatusAnimation();
  const folder = getFolderName();
  const title = titleInput.value.trim() || folder;
  const engine = getEngine();
  const diagram = `flowchart LR
  User[User] --> UI[Browser UI]
  UI --> Session[${title}]
  Session --> Files[${folder}/ files]
  Session --> Agent[${engine.label}]
  Agent --> CLI[CLI Runner]
  CLI --> Result[README / architecture.mmd]`;

  mermaidView.textContent = diagram;
  rootNode.textContent = folder;
  setOptionalText(nodeOne, "UI");
  setOptionalText(nodeTwo, "AI Agent");
  setOptionalText(nodeThree, "CLI Runner");
  projectStatus.textContent = "図式化済み";
  appendProcess("diagram", `${engine.label} 向けのシステム構成図を作成しました。`);
  await saveDiagramToProject(folder, diagram);
  setActiveSideTab("status");
}

function handleReusableFileChange() {
  reusableFiles = Array.from(reusableFileInput.files).filter((file) =>
    file.name.toLowerCase().endsWith(".md")
  );
  renderFileList();
  appendProcess("files", `${reusableFiles.length} 件のMarkdownを選択しました。`);
}

async function saveReusableFiles() {
  stopStatusAnimation();
  const folder = getFolderName();
  folderInput.value = folder;

  if (reusableFiles.length === 0) {
    updateFileStatus("Markdownファイルを選択してください。");
    appendProcess("files", "保存するMarkdownがありません。");
    return;
  }

  if (!window.showDirectoryPicker) {
    updateFileStatus(`保存予定: ${folder}/ に ${reusableFiles.length} 件`);
    appendProcess("files", `${folder}/ に保存予定として表示しました。`);
    return;
  }

  try {
    const rootHandle = await window.showDirectoryPicker();
    const projectHandle = await rootHandle.getDirectoryHandle(folder, { create: true });

    for (const file of reusableFiles) {
      const fileHandle = await projectHandle.getFileHandle(file.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(await file.text());
      await writable.close();
    }

    projectStatus.textContent = "保存済み";
    changeCount.textContent = `${reusableFiles.length} files`;
    updateFileStatus(`保存済み: ${folder}/`);
    appendProcess("files", `${folder}/ に共有ファイルを保存しました。`);
  } catch (error) {
    updateFileStatus("保存をキャンセルしました。");
    appendProcess("files", "保存をキャンセルしました。");
  }
}

document.getElementById("newProjectButton").addEventListener("click", createNewProject);
document.getElementById("openProjectButton").addEventListener("click", openExistingProject);
document.getElementById("runInstructionButton").addEventListener("click", runInstruction);
generateDiagramButton.addEventListener("click", generateDiagram);
engineButtons.forEach((button) => {
  button.addEventListener("click", () => setEngine(button.dataset.engine));
});
githubSettingsButton.addEventListener("click", () => {
  runOperation("github", "GitHub接続設定プロンプトを送信しました。リポジトリURL、認証状態、既定ブランチを確認します。");
});
githubPushButton.addEventListener("click", () => {
  runOperation("push", "コードPushプロンプトを送信しました。差分確認、commit、pushの順に進めます。");
});
localRunButton.addEventListener("click", () => {
  runOperation("local", "ローカル実行プロンプトを送信しました。既存セッション内の共通実行モジュールで起動します。");
});
document.getElementById("reloadViewerButton").addEventListener("click", () => {
  const tab = tabData.get(activeTabId);
  if (tab && tab.type !== "session") loadTabContent(tab);
});
editorTabsEl.querySelector('[data-tab-id="session"]').addEventListener("click", () => activateTab("session"));
chooseRootButton.addEventListener("click", chooseRootFolder);
reusableFileInput.addEventListener("change", handleReusableFileChange);
folderInput.addEventListener("input", renderFileList);
saveFilesButton.addEventListener("click", saveReusableFiles);
appList.querySelectorAll(".tree-item").forEach((item) => {
  item.querySelector(".app-item").addEventListener("click", () => selectApp(item));
  item.querySelectorAll(".child").forEach((child) => {
    child.addEventListener("click", (event) => {
      event.stopPropagation();
      appendProcess("file", `${item.dataset.folder}/${child.textContent.trim()} を選択しました。`);
    });
  });
});

setEngine(activeEngine);
loadRootState();
