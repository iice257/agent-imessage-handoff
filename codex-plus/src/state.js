export const STATES = new Set([
  "inactive",
  "starting",
  "active",
  "waiting_for_user",
  "waiting_for_codex",
  "expired",
  "degraded",
  "failed",
  "recovering",
]);

export function initialState() {
  return {
    state: "inactive",
    activeProfile: null,
    threadId: null,
    relayUrl: null,
    sendblueNumber: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastFailure: null,
    lastEventAt: null,
    queueDepth: 0,
  };
}

export function reduceEvent(state, event) {
  const next = { ...state, lastEventAt: event.at || state.lastEventAt };
  const payload = event.payload || {};
  if (event.profile) next.activeProfile = event.profile;
  if (event.threadId) next.threadId = event.threadId;
  if (payload.relayUrl) next.relayUrl = payload.relayUrl;
  if (payload.sendblueNumber) next.sendblueNumber = payload.sendblueNumber;

  switch (event.kind) {
    case "lifecycle.starting":
      next.state = "starting";
      break;
    case "lifecycle.active":
      next.state = "active";
      next.queueDepth = 0;
      break;
    case "lifecycle.waiting_for_user":
      next.state = "waiting_for_user";
      break;
    case "lifecycle.waiting_for_codex":
      next.state = "waiting_for_codex";
      break;
    case "lifecycle.stopped":
      return { ...initialState(), activeProfile: next.activeProfile, lastEventAt: event.at };
    case "lifecycle.expired":
      next.state = "expired";
      break;
    case "lifecycle.degraded":
      next.state = "degraded";
      break;
    case "lifecycle.failed":
    case "error":
      next.state = "failed";
      next.lastFailure = {
        at: event.at,
        category: payload.category || "unknown",
        message: payload.message || "Unknown failure",
      };
      break;
    case "lifecycle.recovering":
      next.state = "recovering";
      break;
    case "message.inbound":
      next.lastInboundAt = event.at;
      next.state = "waiting_for_codex";
      next.queueDepth += 1;
      break;
    case "message.outbound":
      next.lastOutboundAt = event.at;
      next.state = "waiting_for_user";
      next.queueDepth = Math.max(0, next.queueDepth - 1);
      break;
    case "recovery.candidate":
      next.state = "recovering";
      break;
    default:
      break;
  }
  return next;
}

export function deriveState(events) {
  return events.reduce(reduceEvent, initialState());
}
