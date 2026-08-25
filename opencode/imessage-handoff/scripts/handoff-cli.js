#!/usr/bin/env node
const { existsSync, statSync } = require("fs");
const path = require("path");
const {
  apiFetch,
  defaultRelayUrl,
  ensureLocalInstall,
  pluginPath,
  readActiveThreads,
  readConfig,
  readCurrentSession,
  redact,
  stateDir,
  writeActiveThreads,
  writeJson,
} = require("./common.js");

// Local control CLI for iMessage Handoff on opencode. Every command supports
// --json for stable machine-readable output that the skill can parse.

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      flags[key] = valueParts.length ? valueParts.join("=") : true;
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

function resolveSessionId(flags, options) {
  if (flags.session) {
    return String(flags.session);
  }
  if (!options || !options.fallbackToLastActive) {
    const current = readCurrentSession();
    if (current && current.sessionId) {
      return current.sessionId;
    }
    return "";
  }
  const active = readActiveThreads();
  const ids = Object.keys(active.threads);
  return ids.length ? ids[ids.length - 1] : "";
}

async function commandStart(parsed) {
  const config = await ensureLocalInstall();
  const sessionId = resolveSessionId(parsed.flags, { fallbackToLastActive: false });
  if (!sessionId) {
    throw new Error(
      "No current opencode session found. The plugin records it while opencode is running; open opencode and try again, or pass --session=<id>.",
    );
  }

  const body = await apiFetch(config, "/threads/" + encodeURIComponent(sessionId), {
    method: "POST",
    body: JSON.stringify({
      cwd: parsed.flags.cwd || process.cwd(),
      title: parsed.flags.title || null,
      handoffSummary: null,
    }),
  });

  const active = readActiveThreads();
  active.threads[sessionId] = {
    cwd: parsed.flags.cwd || process.cwd(),
    createdAt: new Date().toISOString(),
    lastStopAt: null,
    paired: Boolean(body.paired),
    sendblueNumber: body.sendblueNumber || null,
  };
  writeActiveThreads(active);

  const localMessage = body.localMessage || formatStartMessage(body);
  return { ok: true, sessionId, localMessage, relay: redact(body) };
}

function formatStartMessage(body) {
  if (body.pairingRequired && body.pairingCode && body.sendblueNumber) {
    return `iMessage Handoff is enabled. Text \`${body.pairingCode}\` to \`${body.sendblueNumber}\` within 15 minutes to continue this session from iMessage.`;
  }
  if (body.sendblueNumber) {
    return `iMessage Handoff is enabled. Text ${body.sendblueNumber} to continue this session.`;
  }
  return "iMessage Handoff is enabled.";
}

async function commandStop(parsed) {
  const sessionId = resolveSessionId(parsed.flags, { fallbackToLastActive: true });
  if (!sessionId) {
    throw new Error("No session found. Pass --session=<id>.");
  }
  const active = readActiveThreads();
  if (!active.threads[sessionId]) {
    return { ok: true, sessionId, serverStopped: false, localMessage: "iMessage Handoff is stopped." };
  }
  let serverStopped = false;
  try {
    const config = readConfig();
    await apiFetch(config, "/threads/" + encodeURIComponent(sessionId) + "/stop", { method: "POST" });
    serverStopped = true;
  } catch (_error) {
    // Local takeover should still succeed even if the relay call fails.
  }
  delete active.threads[sessionId];
  writeActiveThreads(active);
  return { ok: true, sessionId, serverStopped, localMessage: "iMessage Handoff is stopped." };
}

async function commandStatus(parsed) {
  const active = readActiveThreads();
  const sessionId = resolveSessionId(parsed.flags, { fallbackToLastActive: false })
    || Object.keys(active.threads)[0]
    || "";
  const thread = sessionId ? active.threads[sessionId] : null;
  let relayThread = null;
  if (sessionId) {
    try {
      const config = readConfig();
      relayThread = await apiFetch(config, "/threads/" + encodeURIComponent(sessionId));
    } catch (error) {
      relayThread = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    ok: true,
    sessionId: sessionId || null,
    active: Boolean(thread),
    thread: redact(thread),
    relay: redact(relayThread),
    nextAction: thread
      ? "Waiting for iMessage replies."
      : "Not running. Start handoff to continue this session from iMessage.",
  };
}

async function commandDoctor() {
  const checks = [];
  function check(name, status, message) {
    checks.push({ name, status, message });
  }

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  check(
    "node",
    nodeMajor >= 22 ? "ok" : "fail",
    `Node ${process.versions.node}; WebSocket requires Node 22+.`,
  );

  const plugin = pluginPath();
  const pluginOk = plugin && existsSync(plugin);
  check("plugin", pluginOk ? "ok" : "fail", pluginOk ? plugin : "Missing ~/.config/opencode/plugins/imessage-handoff.js");

  let config;
  try {
    config = readConfig();
    check("config", "ok", stateDir);
  } catch (error) {
    check("config", "warn", error instanceof Error ? error.message : String(error));
  }

  try {
    const response = await fetch(config ? config.apiBaseUrl : defaultRelayUrl + "/health");
    check("relay", response.ok ? "ok" : "fail", `${response.status} from ${config ? config.apiBaseUrl : defaultRelayUrl}`);
  } catch (error) {
    check("relay", "fail", error instanceof Error ? error.message : String(error));
  }

  const failed = checks.filter((item) => item.status === "fail");
  const warnings = checks.filter((item) => item.status === "warn");
  return {
    ok: failed.length === 0,
    checks,
    failed: failed.map((item) => item.name),
    warnings: warnings.map((item) => item.name),
    ready: failed.length === 0 && warnings.length === 0,
    nextAction: failed.length
      ? "Fix the failing checks above, then run start again."
      : warnings.length
        ? "Start handoff to create config."
        : "All checks passed.",
  };
}

function commandConfig(subcommand, rest, parsed) {
  const { readJson, writeJson: writeJsonFile, configPath } = require("./common.js");
  const ensure = () => {
    if (!existsSync(configPath)) {
      throw new Error("No config yet. Run start once first.");
    }
    return readJson(configPath, {});
  };
  if (subcommand === "get" || !subcommand) {
    return { ok: true, config: redact(ensure()) };
  }
  if (subcommand === "set") {
    const [key, ...valueParts] = rest;
    if (!key || !valueParts.length) {
      throw new Error("Usage: handoff-cli.js config set <key> <value>");
    }
    const config = ensure();
    const value = valueParts.join(" ");
    if (/token/i.test(key)) {
      throw new Error("Use `config reset-token` instead of setting tokens manually.");
    }
    config[key] = key === "stopWaitSeconds" ? Number(value) : String(value).replace(/\/+$/, "");
    writeJsonFile(configPath, config);
    return { ok: true, config: redact(config) };
  }
  if (subcommand === "reset-token") {
    const { createInstallToken } = require("./common.js");
    const config = ensure();
    return createInstallToken(config.apiBaseUrl).then((token) => {
      writeJsonFile(configPath, Object.assign({}, config, { token }));
      return { ok: true, message: "Install token reset. Start handoff again and re-pair your phone." };
    });
  }
  throw new Error("Usage: handoff-cli.js config get|set|reset-token");
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.localMessage) console.log(result.localMessage);
  else if (result.message) console.log(result.message);
  else if (result.checks) {
    for (const item of result.checks) console.log(`${item.status.toUpperCase()} ${item.name}: ${item.message}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

function help() {
  return {
    usage: "handoff-cli.js <start|stop|status|doctor|config> [--session=<id>] [--json]",
    commands: [
      "start [--session=<id>] [--title=<t>]",
      "stop [--session=<id>]",
      "status [--session=<id>]",
      "doctor",
      "config get | config set <key> <value> | config reset-token",
    ],
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [command, subcommand, ...rest] = parsed.positionals;
  let result;
  switch (command) {
    case "start":
      result = await commandStart(parsed);
      break;
    case "stop":
      result = await commandStop(parsed);
      break;
    case "status":
      result = await commandStatus(parsed);
      break;
    case "doctor":
      result = await commandDoctor();
      break;
    case "config":
      result = await commandConfig(subcommand, rest, parsed);
      break;
    case "help":
    default:
      result = help();
      break;
  }
  printResult(result, Boolean(parsed.flags.json) || command === undefined);
}

main().then(
  () => process.exit(0),
  (error) => {
    const payload = { ok: false, error: error instanceof Error ? error.message : String(error) };
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.error(payload.error);
    }
    process.exit(1);
  },
);
