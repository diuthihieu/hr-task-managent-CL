import "server-only";
import { HttpError } from "../http-errors";
import { rankModels, type ListedModel } from "./models";

// Minimal Gemini API client over REST (no SDK): generateContent and
// streamGenerateContent (SSE). Configure with environment variables:
//   GEMINI_API_KEY   required - from Google AI Studio (never sent to the browser)
//   GEMINI_MODEL     optional - defaults to DEFAULT_MODEL below
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

// Google retires model ids regularly (a retired id answers 404 and names its
// replacement). Defaults follow the ids Google currently points to; if all of
// them are gone, the model list of the API key is read and the newest Flash
// model is used, so a retirement doesn't take the assistant down.
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_FALLBACKS = "gemini-flash-latest,gemini-3.5-flash,gemini-flash-lite-latest";

export function geminiModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/** The model that last answered - tried first next time (per server instance). */
let workingModel: string | null = null;

/** Configured model first, then fallbacks (deduplicated). */
export function geminiModels() {
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? DEFAULT_FALLBACKS)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...(workingModel ? [workingModel] : []), geminiModel(), ...fallbacks])];
}

function apiBase() {
  return (process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
}

function endpoint(model: string, method: "generateContent" | "streamGenerateContent") {
  return `${apiBase()}/models/${encodeURIComponent(model)}:${method}${method === "streamGenerateContent" ? "?alt=sse" : ""}`;
}

async function discoverModels(): Promise<string[]> {
  try {
    const res = await fetch(`${apiBase()}/models?pageSize=1000`, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! } });
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: ListedModel[] };
    return rankModels(body.models ?? []);
  } catch {
    return [];
  }
}

// Worth trying the next model: not found, rate-limited, overloaded or a transient server error.
const RETRYABLE = new Set([404, 429, 500, 502, 503, 504]);

/** POST to the first model that answers; falls back to the next model on retryable errors. */
async function callWithFallback(method: "generateContent" | "streamGenerateContent", init: RequestInit): Promise<{ res: Response; model: string }> {
  const tried: { model: string; status: number | string; error: HttpError }[] = [];
  const attempt = async (model: string): Promise<Response | null> => {
    let res: Response;
    try {
      res = await fetch(endpoint(model, method), init);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      console.error("[gemini] network error", model, e);
      tried.push({ model, status: "network", error: new HttpError(502, `Could not reach the Gemini API (${(e as Error).message})`) });
      return null;
    }
    if (res.ok) {
      workingModel = model;
      return res;
    }
    tried.push({ model, status: res.status, error: await failure(res, model) });
    return null;
  };

  for (const model of geminiModels()) {
    const res = await attempt(model);
    if (res) return { res, model };
    const last = tried[tried.length - 1];
    if (typeof last.status === "number" && !RETRYABLE.has(last.status)) throw last.error;
  }
  // Every configured model failed: ask the API which models this key can use.
  if (tried.some((t) => t.status === 404)) {
    const already = new Set(tried.map((t) => t.model));
    for (const model of (await discoverModels()).filter((m) => !already.has(m)).slice(0, 4)) {
      const res = await attempt(model);
      if (res) {
        console.warn(`[gemini] configured models unavailable; using discovered model ${model}. Set GEMINI_MODEL=${model} to skip discovery.`);
        return { res, model };
      }
    }
  }
  if (workingModel && tried.some((t) => t.model === workingModel)) workingModel = null;
  // Report the most useful error: a quota/permission/server problem says more than "model not found".
  const best = tried.find((t) => t.status !== 404) ?? tried[tried.length - 1];
  const summary = tried.map((t) => `${t.model}: ${t.status}`).join(", ");
  throw new HttpError(best?.error.status ?? 502, `${best?.error.message ?? "The AI service is unavailable"} (tried ${summary})`);
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
