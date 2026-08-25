import { existsSync } from "node:fs";
import { appendEvent } from "./events.js";
import { initConfig, idempotencyKey } from "./config.js";
import { daemonPath } from "./paths.js";
import { readJson, writeJson } from "./fs.js";

export function planRepair(doctor) {
  const actions = [];
  const byName = Object.fromEntries(doctor.checks.map((item) => [item.name, item]));
  if (byName.config?.status === "warn") actions.push({ name: "regenerate_config", policy: "safe_auto", description: "Create config from defaults and legacy state when available." });
  if (byName.codex_hook?.status === "warn") actions.push({ name: "repair_hook", policy: "manual", description: "Ask the skill to install or repair the Codex Stop hook." });
  if (byName.relay_reachable?.status === "fail") actions.push({ name: "reregister_relay", policy: "confirm", description: "Retry relay registration for the active thread." });
  if (byName.local_state?.status === "fail") actions.push({ name: "mark_recovering", policy: "safe_auto", description: "Mark local handoff state as recovering." });
  if (!actions.length) actions.push({ name: "none", policy: "unsupported", description: "No repairable issues were detected." });
  return actions;
}

export function runRepair(doctor, env = process.env, options = {}) {
  const actions = planRepair(doctor);
  const applied = [];
  for (const action of actions) {
    const key = idempotencyKey("repair", action.name);
    if (action.policy === "safe_auto" && !options.dryRun) {
      if (action.name === "regenerate_config") initConfig({}, env);
      if (action.name === "mark_recovering") appendEvent("lifecycle.recovering", { message: "Repair marked local state recovering.", idempotencyKey: key }, { env, idempotencyKey: key });
      applied.push(action.name);
    }
    appendEvent("repair.action", { ...action, applied: applied.includes(action.name), idempotencyKey: key }, { env, idempotencyKey: key });
  }
  if (!existsSync(daemonPath(env)) && !options.dryRun) {
    writeJson(daemonPath(env), readJson(daemonPath(env), { running: false, updatedAt: new Date().toISOString() }));
  }
  return { ok: true, dryRun: Boolean(options.dryRun), actions, applied };
}
