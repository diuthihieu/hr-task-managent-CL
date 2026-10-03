export interface IntakeModelResponse {
  type?: unknown;
  message?: unknown;
  draft?: unknown;
}

function objectCandidate(text: string): IntakeModelResponse | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as IntakeModelResponse;
      if (typeof parsed === "string") {
        const nested = JSON.parse(parsed) as unknown;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as IntakeModelResponse;
      }
    } catch {
      // Recover the user-facing message below when the model's wrapper is malformed.
    }
  }
  return null;
}

/** Read a JSON string property without trusting the rest of a possibly malformed/truncated object. */
function stringProperty(text: string, property: string): string | null {
  const marker = new RegExp(`(?:"${property}"|'${property}')\\s*:\\s*(["'])`, "i").exec(text);
  if (!marker || marker.index === undefined) return null;
  const quote = marker[1];
  let escaped = false;
  let raw = "";
  for (let index = marker.index + marker[0].length; index < text.length; index++) {
    const char = text[index];
    if (!escaped && char === quote) break;
    if (!escaped && char === "\\") {
      escaped = true;
      raw += char;
      continue;
    }
    escaped = false;
    raw += char;
  }
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

export function parseIntakeModelResponse(text: string): IntakeModelResponse | null {
  const parsed = objectCandidate(text);
  if (parsed) return parsed;
  const message = stringProperty(text, "message");
  if (!message) return null;
  const type = stringProperty(text, "type");
  return { type, message };
}

/** Last line of defence for the UI: schema keys and escaped newlines are never shown as chat prose. */
export function naturalIntakeMessage(text: string, fallback: string): string {
  const parsed = parseIntakeModelResponse(text);
  const candidate = typeof parsed?.message === "string" ? parsed.message : text;
  const normalized = candidate.replace(/\\n/g, "\n").replace(/\\r/g, "").trim();
  if (!normalized || (/^\s*[{[]/.test(normalized) && /["'](?:type|message|answer)["']\s*:/.test(normalized))) return fallback;
  return normalized;
}
