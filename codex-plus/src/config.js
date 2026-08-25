import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { ensureDir, readJson, writeJson } from "./fs.js";
import { configPath, legacyConfigPath, plusDir } from "./paths.js";
import { redactValue } from "./redact.js";

const DEFAULT_PROFILES = {
  personal: { runtimeMode: "confirm-send", apiBaseUrl: "", token: "", stopWaitSeconds: 86400, redactPhones: true },
  test: { runtimeMode: "dry-run", apiBaseUrl: "", token: "test-token", stopWaitSeconds: 5, redactPhones: true },
  production: { runtimeMode: "confirm-send", apiBaseUrl: "", token: "", stopWaitSeconds: 86400, redactPhones: true },
  "dry-run": { runtimeMode: "dry-run", apiBaseUrl: "", token: "dry-run-token", stopWaitSeconds: 5, redactPhones: true },
};

export function defaultConfig() {
  return {
    version: 1,
    activeProfile: "personal",
    profiles: structuredClone(DEFAULT_PROFILES),
  };
}

export function loadConfig(env = process.env) {
  const filePath = configPath(env);
  if (!existsSync(filePath)) {
    return applyEnv(defaultConfig(), env);
  }
  const config = { ...defaultConfig(), ...readJson(filePath, defaultConfig()) };
  config.profiles = { ...DEFAULT_PROFILES, ...(config.profiles || {}) };
  return applyEnv(config, env);
}

export function saveConfig(config, env = process.env) {
  ensureDir(plusDir(env));
  writeJson(configPath(env), config);
  return config;
}

export function initConfig(options = {}, env = process.env) {
  const existing = readJson(configPath(env), null);
  const config = existing || defaultConfig();
  const legacy = readJson(legacyConfigPath(env), null);
  if (legacy?.apiBaseUrl || legacy?.token) {
    config.profiles.personal = {
      ...config.profiles.personal,
      apiBaseUrl: legacy.apiBaseUrl || config.profiles.personal.apiBaseUrl,
      token: legacy.token || config.profiles.personal.token,
      stopWaitSeconds: legacy.stopWaitSeconds ?? config.profiles.personal.stopWaitSeconds,
    };
  }
  if (options.profile) {
    config.activeProfile = options.profile;
  }
  saveConfig(config, env);
  return config;
}

export function activeProfile(config) {
  const name = config.activeProfile || "personal";
  const profile = config.profiles?.[name] || DEFAULT_PROFILES.personal;
  return { name, profile };
}

export function setProfileValue(config, profileName, key, value) {
  const next = structuredClone(config);
  next.profiles[profileName] = { ...(next.profiles[profileName] || DEFAULT_PROFILES.personal), [key]: value };
  return next;
}

export function useProfile(config, profileName) {
  if (!config.profiles?.[profileName]) {
    throw new Error(`Unknown profile: ${profileName}`);
  }
  return { ...config, activeProfile: profileName };
}

export function redactedConfig(config) {
  return redactValue(config);
}

export function idempotencyKey(prefix, seed = "") {
  return `${prefix}_${crypto.createHash("sha256").update(`${Date.now()}:${process.pid}:${seed}:${crypto.randomUUID()}`).digest("hex").slice(0, 20)}`;
}

function applyEnv(config, env) {
  const next = structuredClone(config);
  const { name } = activeProfile(next);
  next.profiles[name] = {
    ...next.profiles[name],
    apiBaseUrl: env.HANDOFF_API_BASE_URL || env.IMESSAGE_HANDOFF_API_BASE_URL || next.profiles[name].apiBaseUrl,
    token: env.HANDOFF_TOKEN || env.IMESSAGE_HANDOFF_TOKEN || next.profiles[name].token,
    runtimeMode: env.HANDOFF_RUNTIME_MODE || next.profiles[name].runtimeMode,
  };
  return next;
}
