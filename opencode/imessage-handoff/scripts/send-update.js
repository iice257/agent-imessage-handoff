#!/usr/bin/env node
const { apiFetch, readActiveThreads, readConfig } = require("./common.js");

// Called by the agent during longer iMessage handoff tasks to reassure the
// iMessage user that work is still moving. Uses the same status endpoint the
// plugin uses, but marks the thread as "working" instead of "stopped".

function readArg(name) {
  const prefix = "--" + name + "=";
  const match = process.argv.find(function findArg(arg) {
    return arg.indexOf(prefix) === 0;
  });
  return match ? match.slice(prefix.length) : "";
}

async function main() {
  let sessionId = readArg("session-id") || process.env.IMESSAGE_HANDOFF_SESSION_ID || "";
  if (!sessionId) {
    const active = readActiveThreads();
    const ids = Object.keys(active.threads);
    sessionId = ids.length ? ids[ids.length - 1] : "";
  }
  const message = readArg("message").trim();
  if (!sessionId.trim()) {
    throw new Error("A session id is required.");
  }
  if (!message) {
    throw new Error("A progress update message is required.");
  }

  const config = readConfig();
  const result = await apiFetch(config, "/threads/" + encodeURIComponent(sessionId.trim()) + "/status", {
    method: "POST",
    body: JSON.stringify({
      cwd: process.cwd(),
      lastAssistantMessage: message,
      status: "working",
      createdAt: new Date().toISOString(),
    }),
  });

  console.log(JSON.stringify({
    ok: true,
    notification: result.notification || null,
  }, null, 2));
}

main().catch(function onError(error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
