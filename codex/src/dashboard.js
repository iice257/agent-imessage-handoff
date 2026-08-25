import http from "node:http";
import { getStatus } from "./status.js";
import { readEvents } from "./events.js";
import { deriveTranscript } from "./transcript.js";
import { loadConfig, redactedConfig } from "./config.js";

export function dashboardHtml(model) {
  const events = model.events.slice(-100);
  const transcript = model.transcript.slice(-30);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Handoff Dashboard</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#f7f7f4;color:#191a1c}
    header{padding:24px 32px;background:#202124;color:white}
    main{display:grid;grid-template-columns:320px 1fr;gap:24px;padding:24px}
    section{background:white;border:1px solid #deded8;border-radius:8px;padding:18px}
    h1,h2{margin:0 0 12px}
    pre{white-space:pre-wrap;overflow:auto;background:#f2f2ee;padding:12px;border-radius:6px}
    .timeline{display:grid;gap:10px}
    .item{border-left:3px solid #386641;padding-left:10px}
    button{border:1px solid #202124;background:white;border-radius:6px;padding:8px 10px;cursor:pointer}
    @media(max-width:800px){main{grid-template-columns:1fr;padding:14px}header{padding:18px}}
  </style>
</head>
<body>
  <header><h1>Handoff Dashboard</h1><div>${escapeHtml(model.status.state)} · ${escapeHtml(model.status.profile)}</div></header>
  <main>
    <section>
      <h2>Status</h2>
      <pre>${escapeHtml(JSON.stringify(model.status, null, 2))}</pre>
      <h2>Config</h2>
      <pre>${escapeHtml(JSON.stringify(model.config, null, 2))}</pre>
      <button onclick="navigator.clipboard.writeText(document.getElementById('recovery').textContent)">Copy recovery prompt</button>
    </section>
    <section>
      <h2>Latest Messages</h2>
      <div class="timeline">${transcript.map((item) => `<div class="item"><strong>${escapeHtml(item.direction)}</strong> ${escapeHtml(item.at)}<br>${escapeHtml(item.body)}</div>`).join("") || "No transcript events yet."}</div>
      <h2>Events</h2>
      <pre>${escapeHtml(events.map((event) => `${event.at} ${event.kind}`).join("\n"))}</pre>
      <pre id="recovery" hidden>${escapeHtml(model.recoveryPrompt)}</pre>
    </section>
  </main>
</body>
</html>`;
}

export async function dashboardModel(env = process.env) {
  const events = readEvents({ env });
  const status = await getStatus(env, { skipNetwork: true });
  const transcript = deriveTranscript(events);
  return {
    status,
    events,
    transcript,
    config: redactedConfig(loadConfig(env)),
    recoveryPrompt: transcript.filter((item) => item.direction === "inbound").slice(-1)[0]?.body || "",
  };
}

export async function startDashboard(env = process.env, options = {}) {
  const port = Number(options.port || env.HANDOFF_DASHBOARD_PORT || 4673);
  const host = "127.0.0.1";
  const server = http.createServer(async (_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(dashboardHtml(await dashboardModel(env)));
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  return { server, url: `http://${host}:${port}` };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
