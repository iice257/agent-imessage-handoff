const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const skillDir = path.resolve(__dirname, "..");
const stateDir = process.env.IMESSAGE_HANDOFF_STATE_DIR || path.join(skillDir, ".state");
const configPath = path.join(stateDir, "config.json");
const activeThreadsPath = path.join(stateDir, "active-threads.json");
const currentSessionPath = path.join(stateDir, "current-session.json");
const defaultRelayUrl = process.env.IMESSAGE_HANDOFF_RELAY_URL || "https://imessage-handoff.kingsley-codex.workers.dev";

// Shared helpers for the local skill scripts. Plain Node files with no
// dependencies so they run anywhere opencode runs.

function ensureStateDirs() {
  mkdirSync(stateDir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  // Atomic-ish writes keep hook state from being corrupted if a process exits
  // while updating config or active-threads.json.
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + ".tmp-" + process.pid;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tempPath, filePath);
}

function readNumber(configValue, envValue, fallback) {
  const raw = envValue !== undefined && envValue !== null ? envValue : configValue;
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readConfig() {
  ensureStateDirs();
  if (existsSync(configPath)) {
    const config = readJson(configPath, null);
    if (!config || !config.apiBaseUrl || !config.token) {
      throw new Error("iMessage Handoff config is missing apiBaseUrl or token: " + configPath);
    }
    return {
      apiBaseUrl: String(config.apiBaseUrl).replace(/\/+$/, ""),
      token: String(config.token),
      stopWaitSeconds: readNumber(config.stopWaitSeconds, process.env.IMESSAGE_HANDOFF_STOP_WAIT_SECONDS, 86400),
    };
  }

  const apiBaseUrl = process.env.IMESSAGE_HANDOFF_API_BASE_URL
    ? process.env.IMESSAGE_HANDOFF_API_BASE_URL.replace(/\/+$/, "")
    : "";
  const token = process.env.IMESSAGE_HANDOFF_TOKEN;
  if (apiBaseUrl && token) {
    const config = { apiBaseUrl, token };
    writeJson(configPath, config);
    return {
      apiBaseUrl: config.apiBaseUrl,
      token: config.token,
      stopWaitSeconds: readNumber(undefined, process.env.IMESSAGE_HANDOFF_STOP_WAIT_SECONDS, 86400),
    };
  }

  throw new Error("iMessage Handoff config not found. Run `handoff-cli.js start` once to create " + configPath + ".");
}

async function createInstallToken(apiBaseUrl) {
  const response = await httpFetch(apiBaseUrl + "/installations", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const body = response.text.trim() ? JSON.parse(response.text) : {};
  if (response.status < 200 || response.status >= 300 || typeof body.token !== "string" || !body.token.trim()) {
    throw new Error("iMessage Handoff relay did not return an install token from " + apiBaseUrl + "/installations.");
  }
  return body.token.trim();
}

async function ensureLocalInstall() {
  // First use defaults to the hosted relay; switch any time with:
  //   handoff-cli.js config set apiBaseUrl https://<your-worker-url>
  const existingConfig = existsSync(configPath) ? readJson(configPath, null) : null;
  const apiBaseUrl = String(process.env.IMESSAGE_HANDOFF_API_BASE_URL || existingConfig?.apiBaseUrl || defaultRelayUrl).replace(/\/+$/, "");
  const token = existingConfig && typeof existingConfig.token === "string" && existingConfig.token.trim()
    ? existingConfig.token.trim()
    : process.env.IMESSAGE_HANDOFF_TOKEN
      ? String(process.env.IMESSAGE_HANDOFF_TOKEN).trim()
      : await createInstallToken(apiBaseUrl);

  writeJson(configPath, {
    apiBaseUrl,
    token,
    stopWaitSeconds: readNumber(existingConfig?.stopWaitSeconds, process.env.IMESSAGE_HANDOFF_STOP_WAIT_SECONDS, 86400),
  });
  return readConfig();
}

async function apiFetch(config, pathName, init) {
  const options = init || {};
  const headers = Object.assign({
    "content-type": "application/json",
    authorization: "Bearer " + config.token,
  }, options.headers || {});
  const requestUrl = config.apiBaseUrl + pathName;
  const response = await httpFetch(requestUrl, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });
  let body = {};
  let parsedJson = false;
  if (response.text.trim()) {
    try {
      body = JSON.parse(response.text);
      parsedJson = true;
    } catch (_error) {
      body = { raw: response.text };
    }
  }
  if (response.status < 200 || response.status >= 300) {
    const message = body && (body.error || body.message)
      ? body.error || body.message
      : response.statusText;
    const endpointHint = parsedJson ? "" : " at " + requestUrl;
    throw new Error("iMessage Handoff API " + response.status + endpointHint + ": " + message);
  }
  return body;
}

function httpFetch(requestUrl, options) {
  if (typeof fetch === "function") {
    return fetch(requestUrl, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    }).then(async function toSimpleResponse(response) {
      return {
        status: response.status,
        statusText: response.statusText,
        text: await response.text(),
      };
    });
  }

  return new Promise(function requestPromise(resolve, reject) {
    const parsed = new URL(requestUrl);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method,
      headers: options.headers,
    }, function onResponse(response) {
      const chunks = [];
      response.on("data", function onData(chunk) {
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", function onEnd() {
        resolve({
          status: response.statusCode || 0,
          statusText: response.statusMessage || "",
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", reject);
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

function readActiveThreads() {
  ensureStateDirs();
  if (!existsSync(activeThreadsPath)) {
    return { threads: {} };
  }
  const active = readJson(activeThreadsPath, { threads: {} });
  return Object.assign({}, active, {
    threads: active && typeof active.threads === "object" && !Array.isArray(active.threads)
      ? active.threads
      : {},
  });
}

function writeActiveThreads(active) {
  writeJson(activeThreadsPath, Object.assign({}, active, {
    threads: active && typeof active.threads === "object" && !Array.isArray(active.threads)
      ? active.threads
      : {},
  }));
}

function readCurrentSession() {
  return readJson(currentSessionPath, null);
}

function pluginPath() {
  const home = os.homedir();
  const candidates = [
    process.env.IMESSAGE_HANDOFF_PLUGIN_PATH,
    path.join(home, ".config", "opencode", "plugins", "imessage-handoff.js"),
    path.join(home, ".config", "opencode", "plugin", "imessage-handoff.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[1];
}

function redact(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  const clone = Object.assign({}, value);
  if (clone.token) {
    clone.token = "<redacted>";
  }
  if (clone.authorization) {
    clone.authorization = "<redacted>";
  }
  if (clone.sendblueNumber) {
    clone.sendblueNumber = String(clone.sendblueNumber).slice(0, -4).replace(/./g, "*") + String(clone.sendblueNumber).slice(-4);
  }
  return clone;
}

module.exports = {
  activeThreadsPath,
  apiFetch,
  createInstallToken,
  currentSessionPath,
  defaultRelayUrl,
  ensureLocalInstall,
  ensureStateDirs,
  httpFetch,
  pluginPath,
  readActiveThreads,
  readConfig,
  readCurrentSession,
  readJson,
  redact,
  skillDir,
  stateDir,
  writeActiveThreads,
  writeJson,
};
