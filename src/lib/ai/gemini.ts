import "server-only";
import { HttpError } from "../http-errors";

// Minimal Gemini API client over REST (no SDK): generateContent and
// streamGenerateContent (SSE). Configure with environment variables:
//   GEMINI_API_KEY   required - from Google AI Studio (never sent to the browser)
//   GEMINI_MODEL     optional - defaults to the rolling "gemini-flash-latest" alias
//   GEMINI_FALLBACK_MODELS optional - comma list tried when the first model is
//                    missing, rate-limited or overloaded (default below)
//   GEMINI_API_BASE  optional - override the endpoint (tests point it at a local stub)

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
export interface GenerateOptions {
  system?: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
}
export interface Usage {
  tokensIn: number | null;
  tokensOut: number | null;
}

export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiModel() {
  return process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
}

/** Configured model first, then fallbacks (deduplicated). */
export function geminiModels() {
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-2.5-flash,gemini-flash-lite-latest,gemini-2.0-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([geminiModel(), ...fallbacks])];
}

function endpoint(model: string, method: "generateContent" | "streamGenerateContent") {
  const base = (process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  return `${base}/models/${encodeURIComponent(model)}:${method}${method === "streamGenerateContent" ? "?alt=sse" : ""}`;
}

// Worth trying the next model: not found, rate-limited, overloaded or a transient server error.
const RETRYABLE = new Set([404, 429, 500, 502, 503, 504]);

/** POST to the first model that answers; falls back to the next model on retryable errors. */
async function callWithFallback(method: "generateContent" | "streamGenerateContent", init: RequestInit): Promise<{ res: Response; model: string }> {
  const models = geminiModels();
  let lastError: HttpError | null = null;
  for (const [i, model] of models.entries()) {
    let res: Response;
    try {
      res = await fetch(endpoint(model, method), init);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      console.error("[gemini] network error", model, e);
      lastError = new HttpError(502, `Could not reach the Gemini API (${(e as Error).message})`);
      continue;
    }
    if (res.ok) return { res, model };
    lastError = await failure(res, model);
    if (!RETRYABLE.has(res.status) || i === models.length - 1) break;
    console.warn(`[gemini] ${model} -> ${res.status}; trying ${models[i + 1]}`);
  }
  throw lastError ?? new HttpError(502, "The AI service is unavailable");
}

function requestInit(opts: GenerateOptions): RequestInit {
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: opts.contents,
      generationConfig: { temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxOutputTokens ?? 8192 },
    }),
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

const textOf = (r: GeminiResponse) =>
  (r.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");

/**
 * Turn a Gemini error into a message that says what to fix. Google's own
 * message is included: it never contains the key, and it's the fastest way
 * to diagnose a misconfigured key or project.
 */
async function failure(res: Response, model: string): Promise<HttpError> {
  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  const msg = (body.error?.message ?? res.statusText ?? "").slice(0, 400);
  console.error("[gemini]", model, res.status, body.error?.status, msg);
  const detail = ` [Gemini ${res.status}${body.error?.status ? ` ${body.error.status}` : ""}: ${msg}]`;
  if (res.status === 429) return new HttpError(429, `The Gemini quota for this API key is used up for now - try again in a minute, or enable billing in Google AI Studio.${detail}`);
  if (res.status === 400 && /api key/i.test(msg)) return new HttpError(503, `The Gemini API key is not valid - update GEMINI_API_KEY in Vercel and redeploy.${detail}`);
  if (res.status === 400 && /location|region|country/i.test(msg)) return new HttpError(503, `Gemini isn't available in the server's region - set the Vercel function region to one Gemini supports (e.g. sin1, iad1).${detail}`);
  if (res.status === 403) return new HttpError(503, `Google refused this API key - create it in Google AI Studio (aistudio.google.com/apikey), make sure the Generative Language API is enabled for its project, and remove IP/referrer restrictions.${detail}`);
  if (res.status === 404) return new HttpError(503, `The model "${model}" is not available for this key - set GEMINI_MODEL to a model listed in Google AI Studio.${detail}`);
  if (res.status >= 500) return new HttpError(503, `Gemini is overloaded or having trouble right now - please try again shortly.${detail}`);
  return new HttpError(502, `The AI service rejected the request.${detail}`);
}

/** One-shot generation (used for document text extraction). */
export async function generate(opts: GenerateOptions): Promise<{ text: string; model: string } & Usage> {
  const { res, model } = await callWithFallback("generateContent", requestInit(opts));
  const body = (await res.json()) as GeminiResponse;
  if (body.promptFeedback?.blockReason) throw new HttpError(400, `The AI declined this request (${body.promptFeedback.blockReason})`);
  return { text: textOf(body), model, tokensIn: body.usageMetadata?.promptTokenCount ?? null, tokensOut: body.usageMetadata?.candidatesTokenCount ?? null };
}

/** Streaming generation: yields text chunks; `usage` is filled in when the stream ends. */
export async function streamGenerate(opts: GenerateOptions, usage: Usage, signal?: AbortSignal): Promise<AsyncGenerator<string>> {
  const { res } = await callWithFallback("streamGenerateContent", { ...requestInit(opts), signal });
  if (!res.body) throw new HttpError(502, "The AI service returned an empty response");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  async function* chunks() {
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let json: GeminiResponse;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        if (json.error) throw new Error(`Gemini stream error: ${json.error.message ?? json.error.status}`);
        if (json.promptFeedback?.blockReason) throw new Error(`The AI declined this request (${json.promptFeedback.blockReason})`);
        if (json.usageMetadata) {
          usage.tokensIn = json.usageMetadata.promptTokenCount ?? usage.tokensIn;
          usage.tokensOut = json.usageMetadata.candidatesTokenCount ?? usage.tokensOut;
        }
        const text = textOf(json);
        if (text) yield text;
      }
    }
  }
  return chunks();
}
