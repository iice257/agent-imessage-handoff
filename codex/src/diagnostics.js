import { existsSync } from "node:fs";
import { activeProfile, loadConfig } from "./config.js";
import { hookStatus, currentThreadId, latestSessionReadable } from "./codex.js";
import { readEvents } from "./events.js";
import { relayHealth } from "./relay.js";
import { deriveState } from "./state.js";
import { configPath, eventsPath } from "./paths.js";

export function check(name, status, message, details = {}) {
  return { name, status, message, details };
}

export async function runDoctor(env = process.env, options = {}) {
  const config = loadConfig(env);
  const { name, profile } = activeProfile(config);
  const events = readEvents({ env });
  const state = deriveState(events);
  const hooks = hookStatus(env);
  const session = latestSessionReadable(env);
  const relay = options.skipNetwork || profile.runtimeMode === "dry-run"
    ? { reachable: null, reason: "skipped" }
    : await relayHealth(profile);
  const checks = [
    check("cli", "pass", "handoff CLI is installed in this package."),
    check("config", existsSync(configPath(env)) ? "pass" : "warn", existsSync(configPath(env)) ? "Config exists." : "Config will be created by handoff init.", { path: configPath(env) }),
    check("profile", profile ? "pass" : "fail", `Active profile is ${name}.`),
    check("credentials", profile.token ? "pass" : "fail", profile.token ? "Token is present." : "Active profile has no token."),
    check("relay_url", profile.apiBaseUrl ? "pass" : (profile.runtimeMode === "dry-run" ? "warn" : "fail"), profile.apiBaseUrl ? "Relay URL is configured." : "Relay URL is missing."),
    check("relay_reachable", relay.reachable === true ? "pass" : relay.reachable === false ? "fail" : "unknown", relay.reachable === true ? "Relay health endpoint is reachable." : `Relay reachability ${relay.reason || "unknown"}.`, relay),
    check("codex_thread", currentThreadId(env) ? "pass" : "unknown", currentThreadId(env) ? "CODEX_THREAD_ID is present." : "No current CODEX_THREAD_ID in this process."),
    check("codex_hook", hooks.ready ? "pass" : "warn", hooks.ready ? "Codex Stop hook appears ready." : "Codex Stop hook is not fully ready.", hooks),
    check("event_log", existsSync(eventsPath(env)) ? "pass" : "warn", existsSync(eventsPath(env)) ? "Event log is readable." : "Event log has not been created yet.", { path: eventsPath(env), events: events.length }),
    check("session_log", session.readable ? "pass" : session.supported ? "fail" : "not_supported", session.readable ? "Latest transcript source is readable." : session.supported ? "Configured session log is not readable." : "Codex session log path is not exposed here.", session),
    check("local_state", state.state === "failed" ? "fail" : "pass", `Derived local state is ${state.state}.`, state),
  ];
  return { ok: !checks.some((item) => item.status === "fail"), profile: name, checks, state };
}
