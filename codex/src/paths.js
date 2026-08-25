import os from "node:os";
import path from "node:path";

export function codexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function stateDir(env = process.env) {
  return env.IMESSAGE_HANDOFF_STATE_DIR
    || path.join(codexHome(env), "skills", "imessage-handoff", ".state");
}

export function plusDir(env = process.env) {
  return env.HANDOFF_PLUS_STATE_DIR || path.join(stateDir(env), "plus");
}

export function configPath(env = process.env) {
  return path.join(plusDir(env), "config.json");
}

export function legacyConfigPath(env = process.env) {
  return path.join(stateDir(env), "config.json");
}

export function legacyActiveThreadsPath(env = process.env) {
  return path.join(stateDir(env), "active-threads.json");
}

export function eventsPath(env = process.env) {
  return path.join(plusDir(env), "events.jsonl");
}

export function daemonPath(env = process.env) {
  return path.join(plusDir(env), "daemon.json");
}
