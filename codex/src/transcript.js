export function deriveTranscript(events) {
  return events.flatMap((event) => {
    const payload = event.payload || {};
    if (event.kind === "message.inbound") {
      return [{
        at: event.at,
        direction: "inbound",
        threadId: event.threadId,
        body: payload.body || "",
        source: payload.source || "unknown",
      }];
    }
    if (event.kind === "message.outbound") {
      return [{
        at: event.at,
        direction: "outbound",
        threadId: event.threadId,
        body: payload.body || "",
        source: payload.source || "codex",
      }];
    }
    if (event.kind === "error" || event.kind.startsWith("diagnostic.") || event.kind.startsWith("recovery.")) {
      return [{
        at: event.at,
        direction: "system",
        threadId: event.threadId,
        body: payload.message || payload.summary || event.kind,
        source: event.kind,
      }];
    }
    return [];
  });
}
