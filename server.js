const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.CODEUI_PORT || 5173);
const HOST = process.env.CODEUI_HOST || "127.0.0.1";
const APP_ROOT = __dirname;
const WORK_ROOT = path.resolve(process.env.CODEUI_ROOT || APP_ROOT);
const MAX_BODY_SIZE = 1024 * 1024;
const CLI_TIMEOUT_MS = Number(process.env.CODEUI_CLI_TIMEOUT_MS || 600000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function getCodexArgs() {
  const args = (process.env.CODEUI_CODEX_ARGS || "exec --skip-git-repo-check --sandbox workspace-write").split(" ").filter(Boolean);
  if (args.includes("exec") && !args.includes("--skip-git-repo-check")) {
    args.push("--skip-git-repo-check");
  }
  if (args.includes("exec") && !args.includes("--sandbox") && !args.some((arg) => arg.startsWith("--sandbox="))) {
    args.push("--sandbox", "workspace-write");
  }
  return args;
}

const ENGINE_COMMANDS = {
  codex: {
    command: process.env.CODEUI_CODEX_COMMAND || "codex",
    args: getCodexArgs()
  },
  claude: {
    command: process.env.CODEUI_CLAUDE_COMMAND || "claude",
    args: (process.env.CODEUI_CLAUDE_ARGS || "-p").split(" ").filter(Boolean)
  }
};

function quoteWindowsArg(value) {
  const text = String(value);
  if (!/[ \t"&|<>^]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

function buildSpawnConfig(engine, prompt) {
  if (process.platform === "win32") {
    const commandLine = [engine.command, ...engine.args, prompt].map(quoteWindowsArg).join(" ");
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
      display: `${engine.command} ${engine.args.join(" ")}`.trim()
    };
  }

  return {
    command: engine.command,
    args: [...engine.args, prompt],
    display: `${engine.command} ${engine.args.join(" ")}`.trim()
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(APP_ROOT, `.${requestedPath}`);

  if (!filePath.startsWith(APP_ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(new Error("Invalid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function resolveWorkDir(folder) {
  const safeFolder = String(folder || "").replace(/[^A-Za-z0-9_-]/g, "-") || "new-project";
  const workDir = path.resolve(WORK_ROOT, safeFolder);

  if (!workDir.startsWith(WORK_ROOT)) {
    throw new Error("Invalid work directory.");
  }

  fs.mkdirSync(workDir, { recursive: true });
  return workDir;
}

async function handleRun(request, response) {
  try {
    const body = await readJson(request);
    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      sendJson(response, 400, { ok: false, error: "Prompt is required." });
      return;
    }

    const engine = ENGINE_COMMANDS[body.engine] || ENGINE_COMMANDS.codex;
    const workDir = resolveWorkDir(body.folder);
    const spawnConfig = buildSpawnConfig(engine, prompt);
    const commandText = spawnConfig.display;

    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no"
    });

    const send = (payload) => {
      response.write(`${JSON.stringify(payload)}\n`);
    };

    send({ type: "start", command: commandText, cwd: workDir });

    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: workDir,
      shell: false,
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timeout = setTimeout(() => {
      send({
        type: "stderr",
        text: `Process timed out after ${Math.round(CLI_TIMEOUT_MS / 1000)} seconds. The task may still be too large for one run; try a smaller prompt or increase CODEUI_CLI_TIMEOUT_MS.`
      });
      child.kill();
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      send({ type: "stdout", text: chunk.toString() });
    });
    child.stderr.on("data", (chunk) => {
      send({ type: "stderr", text: chunk.toString() });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      send({ type: "error", text: error.message });
      send({ type: "close", ok: false, code: null });
      response.end();
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      send({ type: "close", ok: code === 0, code });
      response.end();
    });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/run") {
    handleRun(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    sendStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

let activePort = PORT;
let attemptsLeft = 10;

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
    console.log(`Port ${activePort} is already in use. Trying ${activePort + 1}...`);
    activePort += 1;
    attemptsLeft -= 1;
    server.listen(activePort, HOST);
    return;
  }

  console.error(error);
  process.exit(1);
});

server.on("listening", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : activePort;
  console.log(`Code UI: http://${HOST}:${port}/`);
  console.log(`Work root: ${WORK_ROOT}`);
  console.log("Codex command:", ENGINE_COMMANDS.codex.command, ENGINE_COMMANDS.codex.args.join(" "));
  console.log("Claude command:", ENGINE_COMMANDS.claude.command, ENGINE_COMMANDS.claude.args.join(" "));
});

server.listen(activePort, HOST);
