import { readJson, writeJson } from "./fs.js";
import { daemonPath } from "./paths.js";
import { appendEvent, readEvents } from "./events.js";
import { getStatus } from "./status.js";

export function daemonStatus(env = process.env) {
  return readJson(daemonPath(env), { running: false, pid: null, updatedAt: null });
}

export async function watchdogTick(env = process.env, options = {}) {
  const status = await getStatus(env, { skipNetwork: true });
  const timeoutMinutes = Number(options.timeoutMinutes || env.HANDOFF_WATCHDOG_MINUTES || 5);
  const events = readEvents({ env });
  const lastInbound = status.lastInboundAt ? Date.parse(status.lastInboundAt) : 0;
  const lastOutbound = status.lastOutboundAt ? Date.parse(status.lastOutboundAt) : 0;
  const now = Date.now();
  if (lastInbound > lastOutbound && now - lastInbound > timeoutMinutes * 60 * 1000) {
    appendEvent("lifecycle.degraded", {
      message: `Inbound message has no outbound response after ${timeoutMinutes} minutes.`,
      lastInboundAt: status.lastInboundAt,
      eventCount: events.length,
    }, { env, threadId: status.threadId });
    return { ok: false, degraded: true };
  }
  return { ok: true, degraded: false };
}

export function markDaemon(running, env = process.env) {
  const value = { running, pid: running ? process.pid : null, updatedAt: new Date().toISOString() };
  writeJson(daemonPath(env), value);
  appendEvent("daemon.status", value, { env });
  return value;
}
