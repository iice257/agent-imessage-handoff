import { activeProfile, loadConfig } from "./config.js";
import { runDoctor } from "./diagnostics.js";
import { readEvents } from "./events.js";
import { deriveState } from "./state.js";

export async function getStatus(env = process.env, options = {}) {
  const config = loadConfig(env);
  const { name, profile } = activeProfile(config);
  const events = readEvents({ env });
  const state = deriveState(events);
  const doctor = await runDoctor(env, { skipNetwork: options.skipNetwork });
  const failed = doctor.checks.filter((item) => item.status === "fail");
  const warnings = doctor.checks.filter((item) => item.status === "warn");
  let nextAction = "No action needed.";
  if (!profile.apiBaseUrl && profile.runtimeMode !== "dry-run") nextAction = "Set relay URL with handoff config set apiBaseUrl <url>.";
  else if (!profile.token) nextAction = "Set token with handoff config set token <token> or run handoff upgrade from legacy state.";
  else if (failed.length) nextAction = `Run handoff doctor and fix ${failed[0].name}.`;
  else if (warnings.length) nextAction = `Review warning: ${warnings[0].name}.`;
  else if (state.state === "inactive") nextAction = "Run handoff start from a Codex thread.";
  return {
    active: !["inactive", "failed", "expired"].includes(state.state),
    state: state.state,
    profile: name,
    relayUrl: profile.apiBaseUrl || null,
    runtimeMode: profile.runtimeMode,
    threadId: state.threadId,
    sendblueNumber: state.sendblueNumber,
    lastInboundAt: state.lastInboundAt,
    lastOutboundAt: state.lastOutboundAt,
    lastFailure: state.lastFailure,
    credentials: { tokenPresent: Boolean(profile.token), tokenExpired: "unknown" },
    diagnostics: {
      ok: doctor.ok,
      pass: doctor.checks.filter((item) => item.status === "pass").length,
      warn: warnings.length,
      fail: failed.length,
      unknown: doctor.checks.filter((item) => item.status === "unknown").length,
      notSupported: doctor.checks.filter((item) => item.status === "not_supported").length,
    },
    nextAction,
  };
}
