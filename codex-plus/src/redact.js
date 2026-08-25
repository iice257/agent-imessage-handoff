const SECRET_KEYS = /(token|secret|api[-_]?key|authorization|auth|password|credential)/i;
const PHONE_PATTERN = /(?<![A-Za-z0-9_])\+?\d[\d\s().-]{6,}\d(?![A-Za-z0-9_])/g;

export function redactPhone(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 7) {
    return String(value);
  }
  return `***${digits.slice(-4)}`;
}

export function redactText(text, options = {}) {
  let next = String(text ?? "");
  next = next.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>");
  next = next.replace(/ih_[A-Fa-f0-9]{20,}/g, "<redacted-token>");
  if (options.redactPhones !== false) {
    next = next.replace(PHONE_PATTERN, (match) => redactPhone(match));
  }
  return next;
}

export function redactValue(value, options = {}) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactText(value, options);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, options));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SECRET_KEYS.test(key)
        ? "<redacted>"
        : key === "idempotencyKey"
          ? nested
          : redactValue(nested, options);
    }
    return out;
  }
  return value;
}
