import crypto from "node:crypto";
import { appendLine, readLines } from "./fs.js";
import { eventsPath } from "./paths.js";
import { redactValue } from "./redact.js";

export function makeEvent(kind, payload = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  return {
    id: options.id || `evt_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    at: now,
    kind,
    profile: options.profile || payload.profile || null,
    threadId: options.threadId || payload.threadId || null,
    idempotencyKey: options.idempotencyKey || payload.idempotencyKey || null,
    payload: redactValue(payload),
  };
}

export function appendEvent(kind, payload = {}, options = {}) {
  const event = makeEvent(kind, payload, options);
  appendLine(options.path || eventsPath(options.env), JSON.stringify(event));
  return event;
}

export function readEvents(options = {}) {
  return readLines(options.path || eventsPath(options.env)).map((line) => JSON.parse(line));
}

export function tailEvents(limit = 50, options = {}) {
  const events = readEvents(options);
  return events.slice(Math.max(0, events.length - limit));
}
