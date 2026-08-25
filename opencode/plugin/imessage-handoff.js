import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// iMessage Handoff plugin for opencode.
//
// Port of the Codex Stop-hook design: when an opencode session finishes a
// turn and that session is registered for handoff, this plugin publishes the
// assistant result to the relay (which forwards it over iMessage/SMS via
// Sendblue), waits for the next iMessage reply over WebSocket, claims it, and
// injects it back into the same opencode session as a synthetic user message.

const STATE_DIR = process.env.IMESSAGE_HANDOFF_STATE_DIR
  || path.join(os.homedir(), ".config", "opencode", "skill", "imessage-handoff", ".state")
const ACTIVE_THREADS_PATH = path.join(STATE_DIR, "active-threads.json")
const CURRENT_SESSION_PATH = path.join(STATE_DIR, "current-session.json")
const CONFIG_PATH = path.join(STATE_DIR, "config.json")

const DISPLAY_BLOCK_START = "**iMessage reply**"
const INJECTION_SIGNATURES = ["User message to answer:", "[iMessage Handoff internal]"]
const WS_CONNECTING = 0
const WS_OPEN = 1
const LOCAL_INPUT_POLL_MS = 2000

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = filePath + ".tmp-" + process.pid
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8")
  fs.renameSync(tempPath, filePath)
}

function readActiveThreads() {
  const active = readJson(ACTIVE_THREADS_PATH, { threads: {} })
  return {
    threads: active && typeof active.threads === "object" && !Array.isArray(active.threads) ? active.threads : {},
  }
}

function removeThread(sessionId) {
  const active = readActiveThreads()
  if (!active.threads[sessionId]) {
    return false
  }
  delete active.threads[sessionId]
  writeJsonAtomic(ACTIVE_THREADS_PATH, active)
  return true
}

function readConfig() {
  const config = readJson(CONFIG_PATH, null)
  if (!config || !config.apiBaseUrl || !config.token) {
    throw new Error("iMessage Handoff is not configured")
  }
  const stopWaitSeconds = Number(config.stopWaitSeconds)
  return {
    apiBaseUrl: String(config.apiBaseUrl).replace(/\/+$/, ""),
    token: String(config.token),
    stopWaitSeconds: Number.isFinite(stopWaitSeconds) && stopWaitSeconds > 0 ? stopWaitSeconds : 86400,
  }
}

async function apiFetch(config, pathName, init) {
  const options = init || {}
  const headers = Object.assign(
    { "content-type": "application/json", authorization: "Bearer " + config.token },
    options.headers || {},
  )
  const response = await fetch(config.apiBaseUrl + pathName, {
    method: options.method || "GET",
    headers,
    body: options.body,
  })
  let body = {}
  const text = await response.text()
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  if (response.status < 200 || response.status >= 300) {
    const message = body && (body.error || body.message) ? body.error || body.message : response.statusText
    throw new Error("iMessage Handoff API " + response.status + ": " + message)
  }
  return body
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safePathSegment(value) {
  return (
    String(value || "reply")
      .replace(/[^A-Za-z0-9_.-]/g, "_")
      .slice(0, 120) || "reply"
  )
}

function extensionForMedia(url, contentType) {
  const normalizedType = String(contentType || "").split(";")[0].trim().toLowerCase()
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") return ".jpg"
  if (normalizedType === "image/png") return ".png"
  if (normalizedType === "image/gif") return ".gif"
  if (normalizedType === "image/webp") return ".webp"
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase()
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext
  } catch {
    // Fall through to the generic image extension.
  }
  return ".img"
}

async function downloadBinary(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error("Attachment download failed with " + response.status)
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  }
}

async function downloadReplyMedia(sessionId, reply) {
  const media = Array.isArray(reply.media) ? reply.media : []
  if (media.length === 0) {
    return []
  }
  const attachmentDir = path.join(STATE_DIR, "attachments", safePathSegment(sessionId), safePathSegment(reply.id))
  fs.mkdirSync(attachmentDir, { recursive: true })
  const downloaded = []
  for (let index = 0; index < media.length; index += 1) {
    const item = media[index]
    const url = item && typeof item.url === "string" ? item.url : ""
    if (!url) continue
    const file = await downloadBinary(url)
    const filePath = path.join(attachmentDir, `image-${index + 1}${extensionForMedia(url, file.contentType)}`)
    fs.writeFileSync(filePath, file.bytes)
    downloaded.push(filePath)
  }
  return downloaded
}

function sanitizeAssistantMessage(value) {
  // The previous response may include the local-only display block from an
  // iMessage prompt. Strip it before sending the answer back to iMessage.
  if (typeof value !== "string") {
    return null
  }
  const text = value
    .replace(/^(?:>\s*)?(?:🟢\s*)?(?:\*\*iMessage reply\*\*|iMessage reply:)\s*\n(?:>.*(?:\n|$))*\s*/gm, "")
    .trim()
  return text || null
}

function quoteHandoffLine(line) {
  return "> " + (line || "\u00a0")
}

function attachmentLines(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return []
  }
  return ["Attached images:", ...paths.map((filePath, index) => `${index + 1}. ${filePath}`)]
}

function continuationForReply(sendUpdateCommand, reply) {
  // This becomes the next user message in the session. The visible block gives
  // local context while "User message to answer:" carries the real prompt.
  const body = String(reply.body || "")
  const lines = body ? body.split(/\r?\n/) : []
  const visibleHandoffMessage = lines
    .map(quoteHandoffLine)
    .concat(attachmentLines(reply.attachmentPaths).map(quoteHandoffLine))
    .join("\n")
  const userMessageParts = [body, attachmentLines(reply.attachmentPaths).join("\n")].filter(Boolean)
  if (reply.attachmentError) {
    userMessageParts.push("Attached images could not be downloaded: " + reply.attachmentError)
  }

  return [
    "Treat the following iMessage reply exactly as if the user typed it directly in this chat.",
    "Answer normally and focus on the user's request; delivery details are not relevant unless the user asks about them.",
    "Your answer will be sent to the user's phone as plain text over iMessage: no markdown tables, headers, code fences, or links; structure with short lines, dashes, and blank lines, and keep it compact.",
    "If the work may take more than a few minutes, send the iMessage user a very brief progress update every few minutes by running this command with a one- or two-sentence update:",
    sendUpdateCommand,
    "Use progress updates sparingly; they are only to reassure the user during longer tasks.",
    "If the reply asks to stop handoff, run: node scripts/handoff-cli.js stop --json",
    "Start your assistant response with the local display block below exactly as shown, then a blank line, then the substantive answer, code changes, or work summary you would normally give the user.",
    "The blockquote is visible in the local session; the handoff plugin removes this leading display block before sending the answer back over iMessage.",
    "Do not otherwise repeat or paraphrase the iMessage reply.",
    "",
    "Local display block to render:",
    DISPLAY_BLOCK_START,
    visibleHandoffMessage,
    "",
    "User message to answer:",
    userMessageParts.join("\n\n"),
  ].join("\n")
}

function continuationForLocalTakeover() {
  return [
    "Treat the following note exactly as if the user typed it directly in this chat.",
    "iMessage Handoff was active, but the user has sent a message locally in opencode.",
    "Start your assistant response with this friendly note, then a blank line, then continue normally:",
    "\"Got it - I'll turn off iMessage Handoff since you're back here in opencode.\"",
    "[iMessage Handoff internal]",
  ].join("\n")
}

export const ImessageHandoffPlugin = async ({ client }) => {
  const loops = new Set()
  const waits = new Map() // sessionId -> { baseline, sawLocalInput } for sessions blocked on iMessage
  let lastTrackedSessionId = ""

  function log(level, message) {
    void Promise.resolve(
      client.app.log({ body: { service: "imessage-handoff", level, message } }),
    ).catch(() => {})
  }

  function trackCurrentSession(sessionId) {
    if (!sessionId || sessionId === lastTrackedSessionId) {
      return
    }
    lastTrackedSessionId = sessionId
    try {
      writeJsonAtomic(CURRENT_SESSION_PATH, {
        sessionId,
        updatedAt: new Date().toISOString(),
      })
    } catch {
      // Best effort; CLI falls back to --session=<id>.
    }
  }

  function messageText(entry) {
    if (!entry || !Array.isArray(entry.parts)) {
      return ""
    }
    return entry.parts
      .filter((part) => part && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
  }

  function isInjectedText(text) {
    return INJECTION_SIGNATURES.some((signature) => text.includes(signature))
  }

  async function listMessages(sessionId) {
    const response = await client.session.messages({ path: { id: sessionId } })
    return Array.isArray(response.data) ? response.data : []
  }

  function latestUserBaseline(entries) {
    let baseline = 0
    for (const entry of entries) {
      if (entry.info && entry.info.role === "user") {
        const created = entry.info.time && Number(entry.info.time.created)
        if (Number.isFinite(created) && created > baseline) {
          baseline = created
        }
      }
    }
    return baseline
  }

  function hasPendingLocalInput(entries, baseline) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (!entry.info || entry.info.role !== "user") {
        continue
      }
      const created = entry.info.time && Number(entry.info.time.created)
      if (Number.isFinite(created) && created <= baseline) {
        break
      }
      if (!isInjectedText(messageText(entry))) {
        return true
      }
    }
    return false
  }

  function lastAssistantText(entries) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry.info && entry.info.role === "assistant") {
        return sanitizeAssistantMessage(messageText(entry))
      }
    }
    return null
  }

  function threadEventsUrl(config, sessionId) {
    const url = new URL(config.apiBaseUrl)
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
    url.pathname = "/threads/" + encodeURIComponent(sessionId) + "/events"
    url.searchParams.set("token", config.token)
    return url.toString()
  }

  function waitForReply(config, sessionId) {
    // Keep a socket open while waiting. A reply-pending event wakes the wait;
    // local keyboard input wins over iMessage (same rule as the Codex hook).
    const payload = JSON.stringify({
      type: "stop-hook-connected",
      threadId: sessionId,
      sentAt: new Date().toISOString(),
    })

    return new Promise(function waitForReplyPromise(resolve) {
      let settled = false
      let socket
      const deadline = Date.now() + config.stopWaitSeconds * 1000

      function finish(value) {
        if (settled) {
          return
        }
        settled = true
        clearInterval(pollTimer)
        try {
          if (socket && (socket.readyState === WS_CONNECTING || socket.readyState === WS_OPEN)) {
            socket.close(1000, "handoff wait finished")
          }
        } catch {
          // Ignore close races.
        }
        resolve(value)
      }

      if (typeof WebSocket !== "function") {
        finish(null)
        return
      }

      try {
        socket = new WebSocket(threadEventsUrl(config, sessionId))
      } catch {
        finish(null)
        return
      }

      socket.addEventListener("open", () => {
        try {
          socket.send(payload)
        } catch {
          // Ignore send races.
        }
      })
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data || "{}"))
          if (message && message.type === "reply-pending" && message.replyId) {
            finish(String(message.replyId))
          }
        } catch {
          // Ignore malformed socket messages.
        }
      })
      socket.addEventListener("error", () => {})
      socket.addEventListener("close", () => {
        finish(null)
      })

      const pollTimer = setInterval(() => {
        if (Date.now() >= deadline) {
          finish(null)
          return
        }
        if (!readActiveThreads().threads[sessionId]) {
          finish(null)
          return
        }
        if (waits.get(sessionId)?.sawLocalInput) {
          finish("__local_takeover__")
          return
        }
        if (socket.readyState !== WS_OPEN && socket.readyState !== WS_CONNECTING) {
          finish(null)
        }
      }, LOCAL_INPUT_POLL_MS)
    })
  }

  async function runTurnLoop(sessionId) {
    let config
    try {
      config = readConfig()
    } catch {
      return
    }

    const sendUpdateCommand =
      "node " +
      JSON.stringify(
        path.join(os.homedir(), ".config", "opencode", "skill", "imessage-handoff", "scripts", "send-update.js"),
      ) +
      ' --message="Brief progress update here"'

    try {
      for (;;) {
        const thread = readActiveThreads().threads[sessionId]
        if (!thread) {
          return
        }

        const entries = await listMessages(sessionId)
        const baseline = latestUserBaseline(entries)
        waits.set(sessionId, { baseline, sawLocalInput: false })

        await apiFetch(config, "/threads/" + encodeURIComponent(sessionId) + "/status", {
          method: "POST",
          body: JSON.stringify({
            cwd: thread.cwd || process.cwd(),
            lastAssistantMessage: lastAssistantText(entries),
            generatedImages: [],
            status: "stopped",
            createdAt: new Date().toISOString(),
          }),
        })

        if (!readActiveThreads().threads[sessionId]) {
          waits.delete(sessionId)
          return
        }

        const result = await waitForReply(config, sessionId)
        waits.delete(sessionId)

        if (!result) {
          // Timed out or handoff stopped while waiting. Loop exits; the next
          // session.idle re-arms the wait if the thread is still active.
          return
        }
        if (result === "__local_takeover__") {
          removeThread(sessionId)
          await client.session.prompt({
            path: { id: sessionId },
            body: { parts: [{ type: "text", text: continuationForLocalTakeover() }] },
          })
          return
        }

        const claimed = await apiFetch(
          config,
          "/threads/" + encodeURIComponent(sessionId) + "/replies/" + encodeURIComponent(result) + "/claim",
          { method: "POST" },
        )
        const reply = claimed && claimed.reply ? claimed.reply : null
        if (!reply) {
          log("warn", "Claimed reply could not be read; ending wait.")
          return
        }

        let prepared = { ...reply, attachmentPaths: [] }
        try {
          prepared.attachmentPaths = await downloadReplyMedia(sessionId, reply)
        } catch (error) {
          prepared.attachmentError = error instanceof Error ? error.message : String(error)
        }

        await sleep(150)
        const freshEntries = await listMessages(sessionId)
        if (hasPendingLocalInput(freshEntries, baseline)) {
          removeThread(sessionId)
          await client.session.prompt({
            path: { id: sessionId },
            body: { parts: [{ type: "text", text: continuationForLocalTakeover() }] },
          })
          return
        }

        await client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: "text", text: continuationForReply(sendUpdateCommand, prepared) }] },
        })
      }
    } catch (error) {
      waits.delete(sessionId)
      log("error", "Turn loop failed: " + (error instanceof Error ? error.message : String(error)))
    }
  }

  function maybeRunLoop(sessionId) {
    if (!sessionId || loops.has(sessionId)) {
      return
    }
    if (!readActiveThreads().threads[sessionId]) {
      return
    }
    loops.add(sessionId)
    void runTurnLoop(sessionId)
      .catch(() => {})
      .finally(() => loops.delete(sessionId))
  }

  function checkWaitingSession(sessionId) {
    // A user message just landed in a session blocked on iMessage. If it was
    // typed locally (not injected by us), local input takes over.
    const wait = waits.get(sessionId)
    if (!wait || wait.sawLocalInput) {
      return
    }
    void listMessages(sessionId)
      .then((entries) => {
        if (hasPendingLocalInput(entries, wait.baseline)) {
          wait.sawLocalInput = true
        }
      })
      .catch(() => {})
  }

  return {
    event: async ({ event }) => {
      try {
        const properties = event.properties || {}
        const sessionId = properties.sessionID || (properties.info && properties.info.sessionID) || ""
        trackCurrentSession(typeof sessionId === "string" ? sessionId : "")

        if (event.type === "session.idle") {
          maybeRunLoop(properties.sessionID)
        }
        if (event.type === "session.deleted" && properties.info && properties.info.id) {
          removeThread(properties.info.id)
          waits.delete(properties.info.id)
        }
        if (event.type === "message.updated" && properties.info && properties.info.role === "user") {
          checkWaitingSession(properties.info.sessionID)
        }
      } catch {
        // Event handling must never break the host.
      }
    },
  }
}

export default ImessageHandoffPlugin
