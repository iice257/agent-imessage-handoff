import { existsSync } from "node:fs";
import { activeProfile, idempotencyKey, initConfig, loadConfig, redactedConfig, saveConfig, setProfileValue, useProfile } from "./config.js";
import { currentThreadId } from "./codex.js";
import { runDoctor } from "./diagnostics.js";
import { appendEvent, readEvents, tailEvents } from "./events.js";
import { readJson, writeJson } from "./fs.js";
import { daemonStatus, markDaemon, watchdogTick } from "./daemon.js";
import { relayFetch } from "./relay.js";
import { runRepair } from "./repair.js";
import { generateRecovery } from "./recovery.js";
import { simulateFailure, simulateInbound } from "./simulator.js";
import { getStatus } from "./status.js";
import { deriveTranscript } from "./transcript.js";
import { legacyActiveThreadsPath, plusDir } from "./paths.js";
import { startDashboard } from "./dashboard.js";

export async function runCli(argv, env = process.env) {
  const parsed = parseArgs(argv);
  const [command = "help", subcommand, ...rest] = parsed.positionals;
  const context = { env };
  let result;

  switch (command) {
    case "init":
      result = commandInit(parsed, env);
      break;
    case "start":
      result = await commandStart(parsed, env, context);
      break;
    case "stop":
      result = await commandStop(parsed, env, context);
      break;
    case "status":
      result = await getStatus(env, { skipNetwork: parsed.flags["skip-network"] });
      break;
    case "doctor":
      result = await runDoctor(env, { skipNetwork: parsed.flags["skip-network"] });
      break;
    case "repair":
      result = runRepair(await runDoctor(env, { skipNetwork: true }), env, { dryRun: Boolean(parsed.flags["dry-run"]) });
      break;
    case "logs":
      result = { events: tailEvents(Number(parsed.flags.limit || 50), { env }) };
      break;
    case "transcript":
      result = { transcript: deriveTranscript(readEvents({ env })) };
      break;
    case "recover":
      result = commandRecover(parsed, env);
      break;
    case "simulate":
      result = commandSimulate(subcommand, rest, env);
      break;
    case "dashboard":
      result = await commandDashboard(parsed, env);
      break;
    case "config":
      result = commandConfig(subcommand, rest, env, parsed);
      break;
    case "upgrade":
      result = commandUpgrade(env);
      break;
    case "daemon":
      result = await commandDaemon(subcommand, env);
      break;
    case "help":
    default:
      result = help();
      break;
  }

  printResult(result, parsed.flags.json || command === "help");
}

function commandInit(parsed, env) {
  const config = initConfig({ profile: parsed.flags.profile }, env);
  appendEvent("config.init", { message: "Initialized Handoff Plus config." }, { env, profile: config.activeProfile });
  return { ok: true, stateDir: plusDir(env), config: redactedConfig(config) };
}

async function commandStart(parsed, env, context) {
  const config = initConfig({}, env);
  const { name, profile } = activeProfile(config);
  const threadId = parsed.flags.thread || currentThreadId(env);
  if (!threadId) throw new Error("CODEX_THREAD_ID is required. Run handoff start from inside a Codex thread or pass --thread=<id>.");
  const key = parsed.flags["idempotency-key"] || idempotencyKey("start", threadId);
  appendEvent("lifecycle.starting", { relayUrl: profile.apiBaseUrl, idempotencyKey: key }, { ...context, profile: name, threadId, idempotencyKey: key });

  let body = {
    id: threadId,
    paired: false,
    pairingRequired: false,
    sendblueNumber: null,
    localMessage: "iMessage Handoff is enabled in dry-run mode.",
  };
  if (profile.runtimeMode !== "dry-run") {
    body = await relayFetch(profile, `/threads/${encodeURIComponent(threadId)}`, {
      method: "POST",
      body: JSON.stringify({
        cwd: parsed.flags.cwd || env.PWD || process.cwd(),
        title: parsed.flags.title || null,
        handoffSummary: parsed.flags["handoff-summary"] || null,
      }),
    }, { ...context, profile: name, threadId, idempotencyKey: key });
  }

  updateLegacyActiveThread(env, threadId, {
    cwd: parsed.flags.cwd || process.cwd(),
    createdAt: new Date().toISOString(),
    lastStopAt: null,
    skipNextStatusSend: Boolean(body.skipNextStatusSend),
  });
  appendEvent("lifecycle.active", {
    relayUrl: profile.apiBaseUrl,
    sendblueNumber: body.sendblueNumber,
    paired: Boolean(body.paired),
    pairingRequired: Boolean(body.pairingRequired),
    idempotencyKey: key,
  }, { ...context, profile: name, threadId, idempotencyKey: key });

  const localMessage = body.localMessage || formatStartMessage(body);
  return { ok: true, codexThreadId: threadId, localMessage, relay: body };
}

async function commandStop(parsed, env, context) {
  const config = loadConfig(env);
  const { name, profile } = activeProfile(config);
  const threadId = parsed.flags.thread || currentThreadId(env) || deriveLastThread(env);
  if (!threadId) throw new Error("No active thread found. Pass --thread=<id>.");
  const key = parsed.flags["idempotency-key"] || idempotencyKey("stop", threadId);
  let serverStopped = false;
  if (profile.runtimeMode !== "dry-run" && profile.apiBaseUrl && profile.token) {
    await relayFetch(profile, `/threads/${encodeURIComponent(threadId)}/stop`, { method: "POST" }, { ...context, profile: name, threadId, idempotencyKey: key });
    serverStopped = true;
  }
  removeLegacyActiveThread(env, threadId);
  appendEvent("lifecycle.stopped", { serverStopped, idempotencyKey: key }, { ...context, profile: name, threadId, idempotencyKey: key });
  return { ok: true, codexThreadIds: [threadId], serverStopped, localMessage: "iMessage Handoff is stopped." };
}

function commandRecover(parsed, env) {
  const result = generateRecovery(readEvents({ env }), { env });
  if (parsed.flags.send && !(parsed.flags.yes || parsed.flags.json)) {
    throw new Error("Recovery sends require --yes. This command generated candidates only.");
  }
  return { ...result, sent: false, sendRequiresConfirmation: true };
}

function commandSimulate(subcommand, rest, env) {
  if (subcommand === "inbound") {
    return simulateInbound(rest.join(" ").trim(), { env, threadId: currentThreadId(env) || deriveLastThread(env) });
  }
  if (subcommand === "failure") {
    return simulateFailure(rest[0] || "unknown", { env, threadId: currentThreadId(env) || deriveLastThread(env) });
  }
  throw new Error("Usage: handoff simulate inbound \"message\" | handoff simulate failure <kind>");
}

async function commandDashboard(parsed, env) {
  const { url } = await startDashboard(env, { port: parsed.flags.port });
  return { ok: true, url, message: `Handoff dashboard is running at ${url}` };
}

function commandConfig(subcommand, rest, env, parsed) {
  const config = initConfig({}, env);
  if (subcommand === "get" || !subcommand) return { ok: true, config: redactedConfig(config) };
  if (subcommand === "profiles") return { ok: true, activeProfile: config.activeProfile, profiles: Object.keys(config.profiles) };
  if (subcommand === "use") {
    const next = useProfile(config, rest[0]);
    saveConfig(next, env);
    appendEvent("config.profile_used", { profile: rest[0] }, { env, profile: rest[0] });
    return { ok: true, activeProfile: next.activeProfile };
  }
  if (subcommand === "set") {
    const [key, ...valueParts] = rest;
    if (!key || !valueParts.length) throw new Error("Usage: handoff config set <key> <value> [--profile=name]");
    const profileName = parsed.flags.profile || config.activeProfile;
    const value = coerceValue(valueParts.join(" "));
    const next = setProfileValue(config, profileName, key, value);
    saveConfig(next, env);
    appendEvent("config.updated", { profile: profileName, key, value: key.toLowerCase().includes("token") ? "<redacted>" : value }, { env, profile: profileName });
    return { ok: true, config: redactedConfig(next) };
  }
  throw new Error("Usage: handoff config get|set|profiles|use");
}

function commandUpgrade(env) {
  const config = initConfig({}, env);
  const active = existsSync(legacyActiveThreadsPath(env)) ? readJson(legacyActiveThreadsPath(env), { threads: {} }) : { threads: {} };
  appendEvent("upgrade.legacy_state", {
    message: "Migrated legacy iMessage Handoff state references.",
    activeThreadCount: Object.keys(active.threads || {}).length,
  }, { env, profile: config.activeProfile });
  return { ok: true, config: redactedConfig(config), activeThreadCount: Object.keys(active.threads || {}).length };
}

async function commandDaemon(subcommand, env) {
  if (subcommand === "status") return { ok: true, daemon: daemonStatus(env) };
  if (subcommand === "start") return { ok: true, daemon: markDaemon(true, env) };
  if (subcommand === "stop") return { ok: true, daemon: markDaemon(false, env) };
  if (subcommand === "watchdog") return watchdogTick(env);
  throw new Error("Usage: handoff daemon status|start|stop|watchdog");
}

function updateLegacyActiveThread(env, threadId, value) {
  const active = readJson(legacyActiveThreadsPath(env), { threads: {} }) || { threads: {} };
  active.threads = active.threads && typeof active.threads === "object" ? active.threads : {};
  active.threads[threadId] = value;
  writeJson(legacyActiveThreadsPath(env), active);
}

function removeLegacyActiveThread(env, threadId) {
  const active = readJson(legacyActiveThreadsPath(env), { threads: {} }) || { threads: {} };
  active.threads = active.threads && typeof active.threads === "object" ? active.threads : {};
  delete active.threads[threadId];
  writeJson(legacyActiveThreadsPath(env), active);
}

function deriveLastThread(env) {
  const events = readEvents({ env }).filter((event) => event.threadId);
  return events.at(-1)?.threadId || "";
}

function formatStartMessage(body) {
  if (body.pairingRequired && body.pairingCode && body.sendblueNumber) {
    return `iMessage Handoff is enabled. Text \`${body.pairingCode}\` to \`${body.sendblueNumber}\` within 15 minutes to continue this thread from iMessage.`;
  }
  if (body.sendblueNumber) {
    return `iMessage Handoff is enabled. Text ${body.sendblueNumber} to continue this thread.`;
  }
  return "iMessage Handoff is enabled.";
}

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

function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.localMessage) console.log(result.localMessage);
  else if (result.message) console.log(result.message);
  else if (result.url) console.log(result.url);
  else if (result.checks) {
    for (const item of result.checks) console.log(`${item.status.toUpperCase()} ${item.name}: ${item.message}`);
  } else if (result.events) {
    for (const event of result.events) console.log(`${event.at} ${event.kind} ${event.threadId || ""}`.trim());
  } else if (result.transcript) {
    for (const item of result.transcript) console.log(`${item.at} ${item.direction}: ${item.body}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

function help() {
  return {
    usage: "handoff <init|start|stop|status|doctor|repair|logs|transcript|recover|simulate|dashboard|config|upgrade>",
    commands: [
      "handoff init",
      "handoff start",
      "handoff stop",
      "handoff status",
      "handoff doctor",
      "handoff repair",
      "handoff logs",
      "handoff transcript",
      "handoff recover",
      "handoff simulate inbound \"message\"",
      "handoff simulate failure webhook_timeout",
      "handoff dashboard",
      "handoff config get",
      "handoff config set <key> <value>",
      "handoff config profiles",
      "handoff config use <profile>",
      "handoff upgrade",
    ],
  };
}
