import { appendEvent } from "./events.js";
import { classifyFailure } from "./failure.js";
import { idempotencyKey } from "./config.js";

export function simulateInbound(message, context = {}) {
  const key = context.idempotencyKey || idempotencyKey("sim_inbound", message);
  const event = appendEvent("message.inbound", {
    body: message,
    source: "simulator",
    idempotencyKey: key,
  }, { ...context, idempotencyKey: key });
  appendEvent("simulator.inbound", { message, idempotencyKey: key }, { ...context, idempotencyKey: key });
  return { ok: true, event, idempotencyKey: key };
}

export function simulateFailure(kind, context = {}) {
  const messages = {
    webhook_timeout: "Webhook unreachable: simulated timeout",
    codex_disconnect: "Codex stream disconnect: simulated socket close",
    sendblue_auth: "Sendblue auth failed: simulated unauthorized response",
  };
  const message = messages[kind] || `Simulated failure: ${kind}`;
  const key = context.idempotencyKey || idempotencyKey("sim_failure", kind);
  const category = classifyFailure(message);
  const event = appendEvent("error", { category, message, simulated: true, idempotencyKey: key }, { ...context, idempotencyKey: key });
  appendEvent("simulator.failure", { kind, category, idempotencyKey: key }, { ...context, idempotencyKey: key });
  return { ok: true, event, category, idempotencyKey: key };
}
