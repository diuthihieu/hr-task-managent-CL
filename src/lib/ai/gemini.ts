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
  /** Ask for a JSON response (application/json). */
  json?: boolean;
  /**
   * Workspace whose content is sent. Required: AI only runs where a workspace
   * admin switched it on. `null` only for content-free platform checks.
   */
  workspaceId: string | null;
}

/** Workspace admins opt in to AI (it sends workspace content to Google Gemini). */
export async function assertWorkspaceAi(workspaceId: string | null) {
  if (!workspaceId) return;
  const { prisma } = await import("../prisma");
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiEnabled: true } });
  if (!ws?.aiEnabled) throw new HttpError(403, "AI is turned off for this workspace - a workspace admin can switch it on in Settings", "ai_disabled");
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
// Worth retrying the same model after a pause: overload / transient server errors.
const TRANSIENT = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = (process.env.GEMINI_RETRY_DELAYS_MS ?? "1500,4000")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);
const MAX_MODELS = 6;

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms + Math.round(Math.random() * 400));
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    });
  });

/**
 * POST to the first model that answers. Overload errors (503 "high demand")
 * are retried on the same model with a growing pause, then the next model is
 * tried; if every configured model fails, the key's other Flash models are
 * tried too. Google sheds load per model, so another model often answers.
 */
async function callWithFallback(method: "generateContent" | "streamGenerateContent", init: RequestInit): Promise<{ res: Response; model: string }> {
  const tried: { model: string; status: number | string; error: HttpError }[] = [];
  const attempt = async (model: string, retries: number[]): Promise<Response | null> => {
    for (let i = 0; ; i++) {
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
      if (TRANSIENT.has(res.status) && i < retries.length) {
        await res.body?.cancel().catch(() => {});
        console.warn(`[gemini] ${model} -> ${res.status}; retrying in ${retries[i]} ms`);
        await sleep(retries[i], init.signal);
        continue;
      }
      tried.push({ model, status: res.status, error: await failure(res, model) });
      return null;
    }
  };

  const configured = geminiModels();
  for (const [i, model] of configured.entries()) {
    // Full retries on the first model; one quick retry on the others keeps the total wait reasonable.
    const res = await attempt(model, i === 0 ? RETRY_DELAYS_MS : RETRY_DELAYS_MS.slice(0, 1));
    if (res) return { res, model };
    const last = tried[tried.length - 1];
    if (typeof last.status === "number" && !RETRYABLE.has(last.status)) throw last.error;
  }
  // Every configured model failed: try the other Flash models this key can use.
  const already = new Set(tried.map((t) => t.model));
  const extra = (await discoverModels()).filter((m) => !already.has(m)).slice(0, Math.max(0, MAX_MODELS - configured.length) || 2);
  for (const model of extra) {
    const res = await attempt(model, RETRY_DELAYS_MS.slice(0, 1));
    if (res) {
      console.warn(`[gemini] configured models unavailable; answered by discovered model ${model}. Set GEMINI_MODEL=${model} to use it first.`);
      return { res, model };
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
      generationConfig: { temperature: opts.temperature ?? 0.3, maxOutputTokens: opts.maxOutputTokens ?? 8192, ...(opts.json ? { responseMimeType: "application/json" } : {}) },
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
  if (res.status >= 500)
    return new HttpError(
      503,
      `Google's Gemini servers are overloaded right now (every model we tried was busy, after automatic retries). This is on Google's side - please try again in a few minutes. Free-tier keys are the first to be turned away at busy times; enabling billing on the key in Google AI Studio usually avoids it.${detail}`
    );
  return new HttpError(502, `The AI service rejected the request.${detail}`);
}

/** One-shot generation (used for document text extraction). */
export async function generate(opts: GenerateOptions): Promise<{ text: string; model: string } & Usage> {
  await assertWorkspaceAi(opts.workspaceId);
  const { res, model } = await callWithFallback("generateContent", requestInit(opts));
  const body = (await res.json()) as GeminiResponse;
  if (body.promptFeedback?.blockReason) throw new HttpError(400, `The AI declined this request (${body.promptFeedback.blockReason})`);
  return { text: textOf(body), model, tokensIn: body.usageMetadata?.promptTokenCount ?? null, tokensOut: body.usageMetadata?.candidatesTokenCount ?? null };
}

/** Streaming generation: yields text chunks; `usage` is filled in when the stream ends. */
export async function streamGenerate(opts: GenerateOptions, usage: Usage, signal?: AbortSignal): Promise<AsyncGenerator<string>> {
  await assertWorkspaceAi(opts.workspaceId);
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

/** Parse a JSON answer, tolerating code fences or text around the object. */
export function parseJsonAnswer<T>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  for (const candidate of [cleaned, cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next shape
    }
  }
  return null;
}
