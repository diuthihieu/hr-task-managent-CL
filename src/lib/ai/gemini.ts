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
  /**
   * How long this call may take in total, across retries and fallback models.
   * Must fit the calling route's maxDuration. Default 50 s (fits 60 s routes);
   * routes with maxDuration = 120 pass ROUTE_120_BUDGET.
   */
  timeBudgetMs?: number;
}

/** Time budget for routes that declare maxDuration = 120. */
export const ROUTE_120_BUDGET = 100_000;

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
    const res = await fetch(`${apiBase()}/models?pageSize=1000`, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! }, signal: AbortSignal.timeout(5000) });
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
/**
 * Time budgets. Gemini sometimes accepts a request and then sits on it; without
 * a budget the function runs into the platform limit and the user gets a bare
 * 504. A streamed answer must *start* (first data event) within the budget and
 * may then run as long as it needs; a one-shot answer must be complete within
 * it (it only arrives once fully written). Every budget stays under the calling
 * route's maxDuration. One model may use at most `attempt`, so a hung model
 * still leaves time for a fallback.
 */
const STREAM_BUDGET = { total: Number(process.env.GEMINI_DEADLINE_MS) || 50_000, attempt: Number(process.env.GEMINI_ATTEMPT_MS) || 35_000 };
const oneShotBudget = (total = 50_000) => ({ total, attempt: Math.round(total * 0.8) });
/** Not worth starting an attempt (or a retry pause) with less time than this left. */
const minAttempt = (total: number) => Math.min(5_000, total / 5);

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms + Math.round(Math.random() * 400));
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    });
  });

/**
 * Waits, under the attempt's timer, until the answer has really started: the
 * first data event of a stream (Google can send 200 headers and then stall), or
 * the whole body of a one-shot answer. Returns an equivalent Response to read.
 */
async function started(res: Response, stream: boolean, ctrl: AbortController): Promise<Response> {
  if (!stream) return new Response(await res.text(), { status: res.status, headers: res.headers });
  if (!res.body) return res;
  const reader = res.body.getReader();
  const first = await reader.read();
  let sentFirst = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        if (first.done) return controller.close();
        return controller.enqueue(first.value);
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      ctrl.abort();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, headers: res.headers });
}

/**
 * POST to the first model that answers. Overload errors (503 "high demand")
 * are retried on the same model with a growing pause, then the next model is
 * tried; if every configured model fails, the key's other Flash models are
 * tried too. Google sheds load per model, so another model often answers.
 */
async function callWithFallback(method: "generateContent" | "streamGenerateContent", init: RequestInit, timeBudgetMs?: number, startBudget?: { total: number; attempt: number }): Promise<{ res: Response; model: string }> {
  const budget = startBudget ?? (method === "streamGenerateContent" ? STREAM_BUDGET : oneShotBudget(timeBudgetMs));
  const caller = init.signal ?? null;
  const tried: { model: string; status: number | string; error: HttpError }[] = [];
  const deadline = Date.now() + budget.total;
  const left = () => deadline - Date.now();
  const MIN_ATTEMPT_MS = minAttempt(budget.total);
  const attempt = async (model: string, retries: number[]): Promise<Response | null> => {
    for (let i = 0; ; i++) {
      if (left() < MIN_ATTEMPT_MS) return null;
      // Our own controller per attempt: the caller's Stop still aborts it, and the
      // timer can be cleared once the answer has started (a stream may then run on).
      const ctrl = new AbortController();
      const onCallerAbort = () => ctrl.abort();
      caller?.addEventListener("abort", onCallerAbort);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, Math.min(budget.attempt, left()));
      let res: Response;
      try {
        res = await fetch(endpoint(model, method), { ...init, signal: ctrl.signal });
        if (res.ok) res = await started(res, method === "streamGenerateContent", ctrl);
      } catch (e) {
        clearTimeout(timer);
        caller?.removeEventListener("abort", onCallerAbort);
        // The caller gave up (user pressed Stop / closed the page): stop here.
        if (caller?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        if (timedOut) {
          console.warn(`[gemini] ${model} did not answer in time`);
          tried.push({ model, status: "timeout", error: new HttpError(504, "Gemini is taking too long to answer right now - please try again in a moment, or ask a narrower question / attach a smaller file") });
          return null;
        }
        console.error("[gemini] network error", model, e);
        tried.push({ model, status: "network", error: new HttpError(502, `Could not reach the Gemini API (${(e as Error).message})`) });
        return null;
      }
      clearTimeout(timer);
      if (!res.ok) caller?.removeEventListener("abort", onCallerAbort);
      if (res.ok) {
        workingModel = model;
        return res;
      }
      if (TRANSIENT.has(res.status) && i < retries.length && left() > retries[i] + MIN_ATTEMPT_MS) {
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
    if (last && typeof last.status === "number" && !RETRYABLE.has(last.status)) throw last.error;
    if (left() < MIN_ATTEMPT_MS) break;
  }
  // Every configured model failed: try the other Flash models this key can use.
  const already = new Set(tried.map((t) => t.model));
  const extra = (left() < MIN_ATTEMPT_MS ? [] : await discoverModels()).filter((m) => !already.has(m)).slice(0, Math.max(0, MAX_MODELS - configured.length) || 2);
  for (const model of extra) {
    const res = await attempt(model, RETRY_DELAYS_MS.slice(0, 1));
    if (res) {
      console.warn(`[gemini] configured models unavailable; answered by discovered model ${model}. Set GEMINI_MODEL=${model} to use it first.`);
      return { res, model };
    }
  }
  if (workingModel && tried.some((t) => t.model === workingModel && t.status !== "timeout")) workingModel = null;
  if (!tried.length || tried.every((t) => t.status === "timeout"))
    throw new HttpError(504, `Gemini is taking too long to answer right now (no reply within ${Math.round(budget.total / 1000)} s). Please try again in a moment, or ask a narrower question / attach a smaller file.`);
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

/**
 * Long calls (routes with maxDuration 120) are streamed and collected here:
 * only the *start* of the answer is bound by a per-model limit, so a slow but
 * healthy model (busy periods, thinking models) can finish its answer instead
 * of being cut off and replaced. The whole call still ends within the budget
 * with a clear 504 rather than the platform killing the function.
 */
async function generateCollected(opts: GenerateOptions, total: number): Promise<{ text: string; model: string } & Usage> {
  const deadline = Date.now() + total;
  const start = { total: Math.min(Math.round(total * 0.6), STREAM_BUDGET.total), attempt: Math.min(STREAM_BUDGET.attempt, Math.round(total * 0.45)) };
  const ctrl = new AbortController();
  const { res, model } = await callWithFallback("streamGenerateContent", { ...requestInit(opts), signal: ctrl.signal }, undefined, start);
  if (!res.body) throw new HttpError(502, "The AI service returned an empty response");
  const timer = setTimeout(() => ctrl.abort(), Math.max(1_000, deadline - Date.now()));
  const usage: Usage = { tokensIn: null, tokensOut: null };
  let text = "";
  try {
    for await (const chunk of readStream(res.body, usage)) text += chunk;
  } catch (e) {
    if (ctrl.signal.aborted) throw new HttpError(504, `Gemini is taking too long to answer right now (${model} did not finish within ${Math.round(total / 1000)} s). Please try again in a moment, or ask for something shorter.`);
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, (e as Error).message || "The AI answer was interrupted");
  } finally {
    clearTimeout(timer);
  }
  return { text, model, ...usage };
}

/** One-shot generation. Calls with a long budget (> 60 s) are streamed and collected. */
export async function generate(opts: GenerateOptions): Promise<{ text: string; model: string } & Usage> {
  await assertWorkspaceAi(opts.workspaceId);
  if ((opts.timeBudgetMs ?? 0) > 60_000) return generateCollected(opts, opts.timeBudgetMs!);
  const { res, model } = await callWithFallback("generateContent", requestInit(opts), opts.timeBudgetMs);
  const body = (await res.json()) as GeminiResponse;
  if (body.promptFeedback?.blockReason) throw new HttpError(400, `The AI declined this request (${body.promptFeedback.blockReason})`);
  return { text: textOf(body), model, tokensIn: body.usageMetadata?.promptTokenCount ?? null, tokensOut: body.usageMetadata?.candidatesTokenCount ?? null };
}

/** Streaming generation: yields text chunks; `usage` is filled in when the stream ends. */
export async function streamGenerate(opts: GenerateOptions, usage: Usage, signal?: AbortSignal): Promise<AsyncGenerator<string>> {
  await assertWorkspaceAi(opts.workspaceId);
  const { res } = await callWithFallback("streamGenerateContent", { ...requestInit(opts), signal });
  if (!res.body) throw new HttpError(502, "The AI service returned an empty response");
  return readStream(res.body, usage);
}

/** Parse Gemini's SSE stream into text chunks; fills `usage` from the final event. */
async function* readStream(stream: ReadableStream<Uint8Array>, usage: Usage): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
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
