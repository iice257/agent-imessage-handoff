export const FAILURE_CATEGORIES = new Set([
  "sendblue_auth",
  "sendblue_plan_limit",
  "webhook_unreachable",
  "tunnel_dead",
  "codex_stream_disconnect",
  "codex_rate_limited",
  "thread_not_found",
  "message_parse_error",
  "unknown",
]);

export function classifyFailure(input) {
  const text = String(input?.message || input?.error || input || "").toLowerCase();
  if (/sendblue/.test(text) && /(401|403|unauthori[sz]ed|auth|credential|secret|api key)/.test(text)) return "sendblue_auth";
  if (/sendblue/.test(text) && /(plan|quota|limit|free|trial|billing|429)/.test(text)) return "sendblue_plan_limit";
  if (/(webhook|callback)/.test(text) && /(unreachable|timeout|404|502|503|network|failed)/.test(text)) return "webhook_unreachable";
  if (/(tunnel|ngrok|cloudflared)/.test(text) && /(dead|closed|offline|unreachable|timeout|failed)/.test(text)) return "tunnel_dead";
  if (/(codex|websocket|stream)/.test(text) && /(disconnect|closed|econnreset|broken pipe|socket)/.test(text)) return "codex_stream_disconnect";
  if (/codex/.test(text) && /(rate|quota|429|limit)/.test(text)) return "codex_rate_limited";
  if (/(thread).*(not found|missing|unknown|404)/.test(text) || /(not found).*(thread)/.test(text)) return "thread_not_found";
  if (/(parse|json|invalid body|malformed|syntaxerror)/.test(text)) return "message_parse_error";
  return "unknown";
}
