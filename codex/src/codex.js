import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { codexHome } from "./paths.js";

export function currentThreadId(env = process.env) {
  return env.CODEX_THREAD_ID || "";
}

export function hookStatus(env = process.env) {
  const home = codexHome(env);
  const configToml = path.join(home, "config.toml");
  const hooksJson = path.join(home, "hooks.json");
  const configText = existsSync(configToml) ? readFileSync(configToml, "utf8") : "";
  const hooksText = existsSync(hooksJson) ? readFileSync(hooksJson, "utf8") : "";
  const codexHooksEnabled = /\[features\][\s\S]*?codex_hooks\s*=\s*true/.test(configText);
  const normalizedHooks = hooksText.replace(/\\+/g, "/");
  const stopHookInstalled = normalizedHooks.includes("/imessage-handoff/scripts/publish-stop.js")
    || normalizedHooks.includes("/imessage-handoff/scripts/run-publish-stop.cmd")
    || normalizedHooks.includes("/scripts/publish-stop.js")
    || normalizedHooks.includes("/bin/handoff.mjs");
  return { codexHooksEnabled, stopHookInstalled, ready: codexHooksEnabled && stopHookInstalled, configToml, hooksJson };
}

export function latestSessionReadable(env = process.env) {
  const sessionLog = env.IMESSAGE_HANDOFF_SESSION_LOG || env.CODEX_SESSION_LOG || "";
  return {
    supported: Boolean(sessionLog),
    path: sessionLog || null,
    readable: sessionLog ? existsSync(sessionLog) : false,
  };
}
