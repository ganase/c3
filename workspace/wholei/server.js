import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const publicDir = path.join(root, "public");
const projectsDir = path.join(root, "projects");
const port = Number(process.env.PORT || 4173);

const textExtensions = new Set([
  ".md", ".txt", ".csv", ".json", ".yaml", ".yml", ".html", ".css",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".cs", ".go", ".rs",
  ".rb", ".php", ".sql", ".xml", ".log"
]);

await fs.mkdir(projectsDir, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`WHOLEI running at http://localhost:${port}`);
});

export { server };

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/projects") {
    sendJson(res, 200, { projects: await listProjects() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const body = await readBody(req);
    const project = await createProject(body.name || "untitled");
    sendJson(res, 201, { project });
    return;
  }

  const analyzeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/analyze$/);
  if (req.method === "POST" && analyzeMatch) {
    const project = await analyzeProject(analyzeMatch[1]);
    sendJson(res, 200, { project });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "text/plain; charset=utf-8", "Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    send(res, 200, contentType(filePath), data);
  } catch {
    send(res, 404, "text/plain; charset=utf-8", "Not found");
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(data));
}

function send(res, status, type, data) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
}

async function listProjects() {
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(projectsDir, entry.name);
    const manifest = await readJson(path.join(dir, "wholei.project.json"));
    if (!manifest.id) continue;
    projects.push({
      id: entry.name,
      name: manifest.name || entry.name,
      path: dir,
      sourcePath: path.join(dir, "source"),
      vaultPath: dir,
      obsidianUrl: `obsidian://open?path=${encodeURIComponent(dir)}`,
      updatedAt: manifest.updatedAt || manifest.createdAt || null,
      lastRunAt: manifest.lastRunAt || null,
      outputs: await projectOutputs(dir)
    });
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function createProject(name) {
  const cleanName = String(name).trim().slice(0, 80) || "untitled";
  const id = slugify(cleanName);
  const dir = path.join(projectsDir, id);
  const sourceDir = path.join(dir, "source");
  const mapDir = path.join(dir, "00_wholei_map");
  const obsidianDir = path.join(dir, ".obsidian");

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(mapDir, { recursive: true });
  await fs.mkdir(obsidianDir, { recursive: true });

  const now = new Date().toISOString();
  const manifest = { id, name: cleanName, createdAt: now, updatedAt: now, sourcePath: sourceDir, vaultPath: dir };

  await fs.writeFile(path.join(dir, "wholei.project.json"), JSON.stringify(manifest, null, 2));
  await writeObsidianConfig(dir);
  await fs.writeFile(path.join(dir, "README.md"), [
    `# ${cleanName}`,
    "",
    "1. このフォルダを Obsidian vault として開きます。",
    "2. 関連ファイルを `source` フォルダへ保存します。",
    "3. WHOLEI の画面で「処理開始」を押します。",
    "4. `WHOLEI.md`、`network.svg`、`WHOLEI.pptx` と `00_wholei_map` のノートを確認します。",
    ""
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(mapDir, "WHOLEI overview.md"), [
    "# WHOLEI overview",
    "",
    "このフォルダは WHOLEI が生成します。処理後、source 内のファイル同士の関係性ノートがここに作成されます。",
    "",
    "[[WHOLEI]]"
  ].join("\n"), "utf8");

  return (await listProjects()).find((project) => project.id === id);
}

async function writeObsidianConfig(dir) {
  const obsidianDir = path.join(dir, ".obsidian");
  await fs.mkdir(obsidianDir, { recursive: true });
  await fs.writeFile(path.join(obsidianDir, "app.json"), JSON.stringify({
    alwaysUpdateLinks: true,
    newFileLocation: "folder",
    newFileFolderPath: "00_wholei_map",
    showUnsupportedFiles: true,
    attachmentFolderPath: "source"
  }, null, 2), "utf8");
  await fs.writeFile(path.join(obsidianDir, "core-plugins.json"), JSON.stringify([
    "file-explorer", "global-search", "switcher", "graph", "backlink",
    "outgoing-link", "tag-pane", "page-preview"
  ], null, 2), "utf8");
  await fs.writeFile(path.join(obsidianDir, "graph.json"), JSON.stringify({
    "collapse-filter": false,
    search: "",
    showTags: true,
    showAttachments: true,
    hideUnresolved: false,
    showOrphans: true,
    "collapse-color-groups": false,
    colorGroups: [
      { query: "path:00_wholei_map", color: { a: 1, rgb: 2035551 } },
      { query: "path:source", color: { a: 1, rgb: 8426365 } }
    ],
    "collapse-display": false,
    showArrow: true,
    textFadeMultiplier: -0.4,
    nodeSizeMultiplier: 1.15,
    lineSizeMultiplier: 1.2
  }, null, 2), "utf8");
}

function slugify(value) {
  const base = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48) || "project";
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

async function analyzeProject(id) {
  const dir = path.join(projectsDir, path.basename(id));
  const manifest = await readJson(path.join(dir, "wholei.project.json"));
  if (!manifest.id) throw new Error("Project not found");

  await writeObsidianConfig(dir);
  const files = await collectFiles(path.join(dir, "source"));
  const nodes = [];
  for (const filePath of files) {
    const relative = path.relative(path.join(dir, "source"), filePath).replaceAll("\\", "/");
    const ext = path.extname(filePath).toLowerCase();
    const text = textExtensions.has(ext) ? await readTextPreview(filePath) : "";
    nodes.push({
      id: hash(relative),
      title: path.basename(relative),
      relative,
      ext: ext || "file",
      words: keywords(`${relative}\n${text}`),
      text
    });
  }

  const edges = buildEdges(nodes).map((edge) => ({ ...edge, reason: displayReason(edge) }));
  const graph = layoutGraph(nodes, edges);

  await fs.writeFile(path.join(dir, "network.json"), JSON.stringify({ nodes: nodes.map(stripText), edges }, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "network.svg"), renderSvg(graph), "utf8");
  await writeObsidianNotes(dir, nodes, edges);
  await fs.writeFile(path.join(dir, "WHOLEI.md"), renderWholeiMarkdown(manifest, nodes, edges), "utf8");
  await createPptx(path.join(dir, "WHOLEI.pptx"), manifest, graph, nodes, edges);

  manifest.lastRunAt = new Date().toISOString();
  manifest.updatedAt = manifest.lastRunAt;
  await fs.writeFile(path.join(dir, "wholei.project.json"), JSON.stringify(manifest, null, 2), "utf8");
  return (await listProjects()).find((project) => project.id === id);
}

function stripText(node) {
  const { text, ...rest } = node;
  return rest;
}

async function collectFiles(dir) {
  const found = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".obsidian" || entry.name === "00_wholei_map") continue;
        await walk(full);
      } else {
        found.push(full);
      }
    }
  }
  try {
    await walk(dir);
  } catch {
    return [];
  }
  return found.sort((a, b) => a.localeCompare(b));
}

async function readTextPreview(filePath) {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("utf8").replace(/\u0000/g, "").slice(0, 120000);
}

function keywords(text) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "this", "that", "have", "not", "are", "was", "were",
    "する", "した", "ます", "です", "こと", "これ", "ため", "から", "ある", "いる", "ない", "として",
    "ファイル", "データ", "資料", "関連", "内容", "確認", "対応", "作成", "年度", "情報"
  ]);
  const matches = text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const counts = new Map();
  for (const word of matches) {
    if (stop.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 28)
    .map(([word]) => word);
}

function buildEdges(nodes) {
  const edges = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const shared = a.words.filter((word) => b.words.includes(word));
      const nameMention =
        a.text.toLowerCase().includes(path.parse(b.title).name.toLowerCase()) ||
        b.text.toLowerCase().includes(path.parse(a.title).name.toLowerCase());
      const sameExt = a.ext === b.ext && a.ext !== "file";
      const score = shared.length + (nameMention ? 3 : 0) + (sameExt ? 1 : 0);
      if (score > 0) {
        edges.push({
          source: a.id,
          target: b.id,
          score,
          reason: nameMention ? "ファイル名参照 + 共通語彙" : sameExt && !shared.length ? "同種ファイル" : "共通語彙",
          shared: shared.slice(0, 8)
        });
      }
    }
  }
  return edges.sort((a, b) => b.score - a.score).slice(0, Math.max(40, nodes.length * 3));
}

function displayReason(edge) {
  return edge.reason || "共通語彙";
}

function layoutGraph(nodes, edges) {
  const width = 1100;
  const height = 680;
  const radius = Math.min(width, height) * 0.36;
  const cx = width / 2;
  const cy = height / 2;
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + edge.score);
    degree.set(edge.target, (degree.get(edge.target) || 0) + edge.score);
  }
  const placed = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
    const pull = Math.min(0.2, (degree.get(node.id) || 0) / 100);
    return {
      ...node,
      x: cx + Math.cos(angle) * radius * (1 - pull),
      y: cy + Math.sin(angle) * radius * (1 - pull),
      degree: degree.get(node.id) || 0
    };
  });
  return { width, height, nodes: placed, edges };
}

function renderSvg(graph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const lines = graph.edges.map((edge) => {
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    if (!a || !b) return "";
    const opacity = Math.min(0.75, 0.18 + edge.score * 0.08);
    return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#52707f" stroke-width="${Math.min(5, 1 + edge.score * 0.45)}" opacity="${opacity.toFixed(2)}"/>`;
  }).join("\n");
  const nodes = graph.nodes.map((node) => {
    const r = Math.min(34, 16 + node.degree);
    return `<g>
  <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${r}" fill="#f6f2e8" stroke="#1e4f5f" stroke-width="3"/>
  <text x="${node.x.toFixed(1)}" y="${(node.y + r + 18).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#13252d">${escapeXml(truncate(node.title, 24))}</text>
</g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${graph.width} ${graph.height}" width="${graph.width}" height="${graph.height}">
<rect width="100%" height="100%" fill="#fbfaf6"/>
<text x="42" y="58" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#13252d">WHOLEI Relationship Network</text>
<text x="42" y="90" font-family="Arial, sans-serif" font-size="16" fill="#4d626b">source フォルダから生成した関連性ネットワーク</text>
${lines}
${nodes}
</svg>`;
}

async function writeObsidianNotes(dir, nodes, edges) {
  const mapDir = path.join(dir, "00_wholei_map");
  await fs.mkdir(mapDir, { recursive: true });
  const related = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    related.get(edge.source)?.push(edge);
    related.get(edge.target)?.push({ ...edge, source: edge.target, target: edge.source });
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const links = (related.get(node.id) || [])
      .slice(0, 12)
      .map((edge) => {
        const other = nodeById.get(edge.target);
        const signal = edge.shared.join(", ") || edge.reason;
        return other ? `- [[${noteName(other)}]]: ${edge.reason} / ${signal}` : "";
      })
      .filter(Boolean);
    await fs.writeFile(path.join(mapDir, `${safeFileName(noteName(node))}.md`), [
      `# ${node.title}`,
      "",
      `Source: \`source/${node.relative}\``,
      "",
      "## 関連ファイル",
      links.length ? links.join("\n") : "- まだ強い関係は検出されていません。",
      "",
      "## キーワード",
      node.words.map((word) => `#${word.replace(/[^\p{L}\p{N}_-]/gu, "")}`).slice(0, 12).join(" "),
      ""
    ].join("\n"), "utf8");
  }
}

function renderWholeiMarkdown(manifest, nodes, edges) {
  const topEdges = edges.slice(0, 12).map((edge) => {
    const a = nodes.find((node) => node.id === edge.source);
    const b = nodes.find((node) => node.id === edge.target);
    return `| ${a?.title || edge.source} | ${b?.title || edge.target} | ${edge.score} | ${edge.reason} | ${edge.shared.join(", ")} |`;
  });
  return [
    `# WHOLEI: ${manifest.name}`,
    "",
    `生成日時: ${new Date().toLocaleString("ja-JP")}`,
    "",
    "## ネットワーク図",
    "",
    "![[network.svg]]",
    "",
    "## サマリー",
    "",
    `- Source ファイル数: ${nodes.length}`,
    `- 検出した関係数: ${edges.length}`,
    "- Obsidian Graph 用ノート: `00_wholei_map`",
    "- プレゼン資料: `WHOLEI.pptx`",
    "",
    "## Obsidian ノート",
    "",
    ...(nodes.length ? nodes.map((node) => `- [[${noteName(node)}]]: \`source/${node.relative}\``) : ["- `source` フォルダにファイルを追加してから処理を実行してください。"]),
    "",
    "## 強い関係",
    "",
    "| ファイル A | ファイル B | スコア | 根拠 | 共通信号 |",
    "|---|---|---:|---|---|",
    ...(topEdges.length ? topEdges : ["| - | - | - | - | - |"]),
    "",
    "## 確認方法",
    "",
    "このフォルダを Obsidian vault として開き、Graph view を確認します。WHOLEI が生成したノートは、共通語彙、明示的なファイル名参照、ファイル種別にもとづいてリンクされています。",
    ""
  ].join("\n");
}

async function createPptx(outputPath, manifest, graph, nodes, edges) {
  const tempDir = path.join(root, ".tmp-pptx", crypto.randomBytes(4).toString("hex"));
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(path.join(tempDir, "ppt", "slides"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "ppt", "_rels"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "_rels"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "docProps"), { recursive: true });

  const slides = [
    slideXml("WHOLEI 関係性レポート", manifest.name, [
      "フォルダ内の資料を、Obsidian で追跡できる知識ネットワークへ変換しました。",
      `Source ファイル ${nodes.length} 件 / 検出した関係 ${edges.length} 件`
    ]),
    networkSlideXml(graph),
    slideXml("主要な関係シグナル", "重みの高いリンク", edges.slice(0, 8).map((edge) => {
      const a = nodes.find((node) => node.id === edge.source)?.title || "A";
      const b = nodes.find((node) => node.id === edge.target)?.title || "B";
      return `${a} -> ${b}: ${edge.shared.slice(0, 4).join(", ") || edge.reason}`;
    })),
    slideXml("確認ワークフロー", "Obsidian + WHOLEI outputs", [
      "案件フォルダを Obsidian vault として開きます。",
      "Graph view と WHOLEI.md で関係性を確認します。",
      "この PPTX を使ってフォルダ構造と関係性を視覚的に説明します。"
    ])
  ];

  for (let i = 0; i < slides.length; i += 1) {
    await fs.writeFile(path.join(tempDir, "ppt", "slides", `slide${i + 1}.xml`), slides[i], "utf8");
  }
  await fs.writeFile(path.join(tempDir, "[Content_Types].xml"), contentTypes(slides.length), "utf8");
  await fs.writeFile(path.join(tempDir, "_rels", ".rels"), rootRels(), "utf8");
  await fs.writeFile(path.join(tempDir, "ppt", "_rels", "presentation.xml.rels"), presentationRels(slides.length), "utf8");
  await fs.writeFile(path.join(tempDir, "ppt", "presentation.xml"), presentationXml(slides.length), "utf8");
  await fs.writeFile(path.join(tempDir, "docProps", "core.xml"), coreXml(manifest.name), "utf8");
  await fs.writeFile(path.join(tempDir, "docProps", "app.xml"), appXml(slides.length), "utf8");

  await fs.rm(outputPath, { force: true });
  await zipDirectory(tempDir, outputPath);
  await fs.rm(tempDir, { recursive: true, force: true });
}

function slideXml(title, subtitle, bullets) {
  return wrapSlide([
    textBox(title, 520000, 520000, 8200000, 620000, 34, true),
    textBox(subtitle, 520000, 1220000, 8200000, 420000, 18, false, "52707F"),
    ...bullets.slice(0, 8).map((bullet, i) => textBox(`• ${bullet}`, 760000, 1900000 + i * 480000, 8200000, 360000, 16, false))
  ].join(""));
}

function networkSlideXml(graph) {
  const sx = 7600000 / graph.width;
  const sy = 4200000 / graph.height;
  const ox = 900000;
  const oy = 1320000;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const shapes = [textBox("ネットワーク図", 520000, 420000, 8200000, 560000, 30, true)];
  for (const edge of graph.edges.slice(0, 28)) {
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    if (!a || !b) continue;
    shapes.push(lineShape(ox + a.x * sx, oy + a.y * sy, ox + b.x * sx, oy + b.y * sy, Math.min(32000, 9000 + edge.score * 5000)));
  }
  for (const node of graph.nodes.slice(0, 28)) {
    const r = Math.min(360000, 180000 + node.degree * 22000);
    shapes.push(ellipseShape(ox + node.x * sx - r / 2, oy + node.y * sy - r / 2, r, r, node.title));
  }
  return wrapSlide(shapes.join(""));
}

function wrapSlide(content) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FBFAF6"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${content}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

let shapeId = 10;
function textBox(text, x, y, cx, cy, size, bold = false, color = "13252D") {
  shapeId += 1;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="Text ${shapeId}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="${size * 100}"${bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${escapeXml(text)}</a:t></a:r><a:endParaRPr lang="ja-JP" sz="${size * 100}"/></a:p></p:txBody></p:sp>`;
}

function lineShape(x1, y1, x2, y2, width) {
  shapeId += 1;
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const cx = Math.abs(x2 - x1) || 1;
  const cy = Math.abs(y2 - y1) || 1;
  const flipH = x2 < x1 ? ' flipH="1"' : "";
  const flipV = y2 < y1 ? ' flipV="1"' : "";
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${shapeId}" name="Connector ${shapeId}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flipH}${flipV}><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${Math.round(width)}"><a:solidFill><a:srgbClr val="52707F"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
}

function ellipseShape(x, y, cx, cy, label) {
  shapeId += 1;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="Node ${shapeId}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="F6F2E8"/></a:solidFill><a:ln w="22000"><a:solidFill><a:srgbClr val="1E4F5F"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ja-JP" sz="900"><a:solidFill><a:srgbClr val="13252D"/></a:solidFill></a:rPr><a:t>${escapeXml(truncate(label, 16))}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function contentTypes(count) {
  const slideOverrides = Array.from({ length: count }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slideOverrides}</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function presentationRels(count) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`;
}

function presentationXml(count) {
  const ids = Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function coreXml(title) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>WHOLEI</dc:creator><cp:lastModifiedBy>WHOLEI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function appXml(count) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>WHOLEI</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${count}</Slides></Properties>`;
}

async function zipDirectory(sourceDir, outputPath) {
  const files = await collectZipFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const filePath of files) {
    const data = await fs.readFile(filePath);
    const name = path.relative(sourceDir, filePath).replaceAll("\\", "/");
    const nameBuffer = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBuffer, data);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await fs.writeFile(outputPath, Buffer.concat([...localParts, ...centralParts, end]));
}

async function collectZipFiles(dir) {
  const files = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(dir);
  return files.sort((a, b) => a.localeCompare(b));
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function projectOutputs(dir) {
  const names = ["WHOLEI.md", "WHOLEI.pptx", "network.svg", "network.json"];
  const outputs = {};
  for (const name of names) {
    try {
      await fs.access(path.join(dir, name));
      outputs[name] = path.join(dir, name);
    } catch {
      outputs[name] = null;
    }
  }
  return outputs;
}

function hash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function noteName(node) {
  return `WHOLEI - ${node.title}`;
}

function safeFileName(value) {
  return value.replace(/[<>:"/\\|?*]/g, "_").slice(0, 120);
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
