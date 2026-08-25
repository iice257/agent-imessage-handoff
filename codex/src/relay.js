import { appendEvent } from "./events.js";
import { classifyFailure } from "./failure.js";

export async function relayFetch(profile, pathName, init = {}, context = {}) {
  if (!profile.apiBaseUrl) {
    throw new Error("Active profile is missing apiBaseUrl.");
  }
  if (!profile.token) {
    throw new Error("Active profile is missing token.");
  }
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${profile.token}`,
    ...(init.headers || {}),
  };
  const url = `${String(profile.apiBaseUrl).replace(/\/+$/, "")}${pathName}`;
  appendEvent("relay.request", {
    method: init.method || "GET",
    path: pathName,
    idempotencyKey: context.idempotencyKey,
  }, context);
  const response = await fetch(url, { ...init, headers });
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
    const message = body.error || body.message || `Relay HTTP ${response.status}`;
    appendEvent("error", {
      category: classifyFailure(message),
      message,
      status: response.status,
      path: pathName,
    }, context);
    throw new Error(message);
  }
  appendEvent("relay.response", {
    method: init.method || "GET",
    path: pathName,
    status: response.status,
  }, context);
  return body;
}

export async function relayHealth(profile, timeoutMs = 2500) {
  if (!profile.apiBaseUrl) {
    return { reachable: false, reason: "missing_api_base_url" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${String(profile.apiBaseUrl).replace(/\/+$/, "")}/health`, { signal: controller.signal });
    return { reachable: response.ok, status: response.status };
  } catch (error) {
    return { reachable: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
