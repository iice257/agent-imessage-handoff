import { appendEvent } from "./events.js";
import { idempotencyKey } from "./config.js";
import { deriveTranscript } from "./transcript.js";

export function findMissedReplies(events) {
  const transcript = deriveTranscript(events);
  const missed = [];
  for (let index = 0; index < transcript.length; index += 1) {
    const item = transcript[index];
    if (item.direction !== "inbound") continue;
    const nextOutbound = transcript.slice(index + 1).find((candidate) => candidate.direction === "outbound");
    if (!nextOutbound) missed.push(item);
  }
  return missed;
}

export function generateRecovery(events, context = {}) {
  const missed = findMissedReplies(events);
  const candidates = missed.map((message) => ({
    id: idempotencyKey("recovery", `${message.at}:${message.body}`),
    threadId: message.threadId,
    inboundAt: message.at,
    prompt: [
      "Missed iMessage reply recovery candidate.",
      `Inbound at: ${message.at}`,
      `User said: ${message.body}`,
      "Use the current Codex thread context to answer this message. Do not send without approval.",
    ].join("\n"),
  }));
  for (const candidate of candidates) {
    appendEvent("recovery.candidate", {
      summary: "Generated missed-reply recovery candidate.",
      candidateId: candidate.id,
      inboundAt: candidate.inboundAt,
      prompt: candidate.prompt,
    }, { ...context, threadId: candidate.threadId, idempotencyKey: candidate.id });
  }
  return { ok: true, candidates };
}
