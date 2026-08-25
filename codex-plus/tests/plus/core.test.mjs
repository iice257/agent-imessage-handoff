import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { initConfig, loadConfig, setProfileValue } from "../../src/config.js";
import { appendEvent, readEvents } from "../../src/events.js";
import { classifyFailure } from "../../src/failure.js";
import { redactValue } from "../../src/redact.js";
import { deriveState } from "../../src/state.js";
import { deriveTranscript } from "../../src/transcript.js";
import { simulateFailure, simulateInbound } from "../../src/simulator.js";
import { generateRecovery } from "../../src/recovery.js";
import { runDoctor } from "../../src/diagnostics.js";

function tempEnv() {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "handoff-plus-test-"));
  return {
    ...process.env,
    IMESSAGE_HANDOFF_STATE_DIR: stateDir,
    CODEX_HOME: path.join(stateDir, "codex-home"),
    CODEX_THREAD_ID: "thread-test-1",
  };
}

test("config initializes profiles and migrates legacy config", () => {
  const env = tempEnv();
  writeFileSync(path.join(env.IMESSAGE_HANDOFF_STATE_DIR, "config.json"), JSON.stringify({
    apiBaseUrl: "https://relay.example.test",
    token: "ih_1234567890abcdef1234567890abcdef",
    stopWaitSeconds: 42,
  }));
  const config = initConfig({}, env);
  assert.equal(config.activeProfile, "personal");
  assert.equal(config.profiles.personal.apiBaseUrl, "https://relay.example.test");
  assert.equal(config.profiles.personal.stopWaitSeconds, 42);

  const next = setProfileValue(config, "test", "runtimeMode", "dry-run");
  assert.equal(next.profiles.test.runtimeMode, "dry-run");
});

test("event replay derives state and transcript", () => {
  const env = tempEnv();
  appendEvent("lifecycle.starting", { relayUrl: "https://relay.example.test" }, { env, profile: "test", threadId: "thread-test-1" });
  appendEvent("lifecycle.active", { sendblueNumber: "+12345678900" }, { env, profile: "test", threadId: "thread-test-1" });
  appendEvent("message.inbound", { body: "what did I miss?", source: "simulator" }, { env, threadId: "thread-test-1" });
  const events = readEvents({ env });
  const state = deriveState(events);
  assert.equal(state.state, "waiting_for_codex");
  assert.equal(state.lastInboundAt, events.at(-1).at);
  assert.equal(state.sendblueNumber, "***8900");
  assert.deepEqual(deriveTranscript(events).map((item) => item.direction), ["inbound"]);
});

test("redaction removes secrets and phone details", () => {
  const redacted = redactValue({
    token: "ih_1234567890abcdef1234567890abcdef",
    authorization: "Bearer ih_1234567890abcdef1234567890abcdef",
    phone: "+1 (234) 567-8900",
  });
  assert.equal(redacted.token, "<redacted>");
  assert.equal(redacted.authorization, "<redacted>");
  assert.equal(redacted.phone, "***8900");
});

test("failure classifier maps known failures", () => {
  assert.equal(classifyFailure("Sendblue API returned HTTP 401 unauthorized"), "sendblue_auth");
  assert.equal(classifyFailure("webhook unreachable timeout"), "webhook_unreachable");
  assert.equal(classifyFailure("Codex stream disconnect socket closed"), "codex_stream_disconnect");
  assert.equal(classifyFailure("Thread not found 404"), "thread_not_found");
});

test("simulator logs inbound and failure events", () => {
  const env = tempEnv();
  simulateInbound("hello", { env, threadId: "thread-test-1" });
  const failure = simulateFailure("webhook_timeout", { env, threadId: "thread-test-1" });
  const events = readEvents({ env });
  assert.equal(events.some((event) => event.kind === "message.inbound"), true);
  assert.equal(failure.category, "webhook_unreachable");
});

test("recovery creates candidate for missed inbound", () => {
  const env = tempEnv();
  appendEvent("message.inbound", { body: "please continue", source: "simulator" }, { env, threadId: "thread-test-1" });
  const result = generateRecovery(readEvents({ env }), { env });
  assert.equal(result.candidates.length, 1);
  assert.match(result.candidates[0].prompt, /please continue/);
});

test("doctor reports check severities", async () => {
  const env = tempEnv();
  initConfig({ profile: "dry-run" }, env);
  const doctor = await runDoctor(env, { skipNetwork: true });
  assert.equal(doctor.checks.some((item) => item.status === "pass"), true);
  assert.equal(doctor.checks.every((item) => ["pass", "warn", "fail", "unknown", "not_supported"].includes(item.status)), true);
});

test("CLI supports init, config, simulate, status, repair, recover", () => {
  const env = tempEnv();
  const cli = path.resolve("bin/handoff.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, "--json"], { env, encoding: "utf8" });
  assert.equal(run("init", "--profile=dry-run").status, 0);
  assert.equal(JSON.parse(run("config", "profiles").stdout).activeProfile, "dry-run");
  assert.equal(run("simulate", "inbound", "what did I miss?").status, 0);
  assert.equal(JSON.parse(run("status", "--skip-network").stdout).state, "waiting_for_codex");
  assert.equal(JSON.parse(run("repair", "--dry-run").stdout).dryRun, true);
  assert.equal(JSON.parse(run("recover").stdout).candidates.length, 1);
});
