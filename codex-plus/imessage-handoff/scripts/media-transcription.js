const { basename, extname } = require("path");
const { readFileSync } = require("fs");

const AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".ogg", ".wav", ".webm"]);

function isAudioAttachment(filePath) {
  return AUDIO_EXTENSIONS.has(extname(String(filePath || "")).toLowerCase());
}

function transcriptionSettings(config) {
  const provider = String(
    process.env.IMESSAGE_HANDOFF_TRANSCRIPTION_PROVIDER
      || config.transcriptionProvider
      || "",
  ).trim().toLowerCase();
  if (!provider || provider === "off" || provider === "none") {
    return null;
  }
  if (provider !== "groq") {
    return { provider, error: "Unsupported transcription provider: " + provider };
  }
  return {
    provider,
    apiKey: String(process.env.IMESSAGE_HANDOFF_GROQ_API_KEY || process.env.GROQ_API_KEY || config.groqApiKey || "").trim(),
    model: String(process.env.IMESSAGE_HANDOFF_GROQ_TRANSCRIPTION_MODEL || config.groqTranscriptionModel || "whisper-large-v3-turbo").trim(),
    baseUrl: String(process.env.IMESSAGE_HANDOFF_GROQ_API_BASE_URL || config.groqApiBaseUrl || "https://api.groq.com/openai/v1").replace(/\/+$/, ""),
    language: String(process.env.IMESSAGE_HANDOFF_TRANSCRIPTION_LANGUAGE || config.transcriptionLanguage || "").trim(),
  };
}

async function transcribeAttachments(config, attachmentPaths) {
  const settings = transcriptionSettings(config || {});
  if (!settings) {
    return [];
  }
  const audioPaths = (Array.isArray(attachmentPaths) ? attachmentPaths : []).filter(isAudioAttachment);
  if (audioPaths.length === 0) {
    return [];
  }
  if (settings.error) {
    return audioPaths.map((filePath) => ({ filePath, error: settings.error }));
  }
  if (!settings.apiKey) {
    return audioPaths.map((filePath) => ({ filePath, error: "Groq transcription is enabled but no API key is configured." }));
  }

  const transcripts = [];
  for (const filePath of audioPaths) {
    try {
      transcripts.push({ filePath, text: await transcribeFile(settings, filePath) });
    } catch (error) {
      transcripts.push({ filePath, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return transcripts;
}

async function transcribeFile(settings, filePath) {
  if (process.env.IMESSAGE_HANDOFF_MOCK_TRANSCRIPTIONS_FILE) {
    const mock = JSON.parse(readFileSync(process.env.IMESSAGE_HANDOFF_MOCK_TRANSCRIPTIONS_FILE, "utf8"));
    const value = mock[filePath] || mock[basename(filePath)];
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value.text === "string") {
      return value.text;
    }
    throw new Error("No mock transcript for " + basename(filePath));
  }

  if (typeof fetch !== "function" || typeof FormData !== "function" || typeof Blob !== "function") {
    throw new Error("This Node runtime cannot send multipart transcription requests.");
  }

  const form = new FormData();
  form.append("model", settings.model || "whisper-large-v3-turbo");
  form.append("response_format", "json");
  if (settings.language) {
    form.append("language", settings.language);
  }
  form.append("file", new Blob([readFileSync(filePath)]), basename(filePath));

  const response = await fetch(settings.baseUrl + "/audio/transcriptions", {
    method: "POST",
    headers: { authorization: "Bearer " + settings.apiKey },
    body: form,
  });
  const text = await response.text();
  let body = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    const message = body.error && body.error.message ? body.error.message : response.statusText || "Groq transcription failed.";
    throw new Error("Groq transcription HTTP " + response.status + ": " + message);
  }
  if (!body || typeof body.text !== "string") {
    throw new Error("Groq transcription response did not include text.");
  }
  return body.text.trim();
}

module.exports = {
  isAudioAttachment,
  transcribeAttachments,
  transcriptionSettings,
};
