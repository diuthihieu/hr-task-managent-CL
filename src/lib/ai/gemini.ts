import "server-only";
import { HttpError } from "../http-errors";

// Minimal Gemini API client over REST (no SDK): generateContent and
// streamGenerateContent (SSE). Configure with environment variables:
//   GEMINI_API_KEY   required - from Google AI Studio (never sent to the browser)
//   GEMINI_MODEL     optional - defaults to the rolling "gemini-flash-latest" alias
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

function endpoint(method: "generateContent" | "streamGenerateContent") {
  const base = (process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  return `${base}/models/${encodeURIComponent(geminiModel())}:${method}${method === "streamGenerateContent" ? "?alt=sse" : ""}`;
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

async function failure(res: Response): Promise<HttpError> {
  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  const msg = body.error?.message ?? res.statusText;
  console.error("[gemini]", res.status, msg);
  if (res.status === 429) return new HttpError(429, "The AI quota is exhausted for now - please try again in a minute");
  if (res.status === 400 && /api key/i.test(msg)) return new HttpError(503, "The Gemini API key was rejected - check GEMINI_API_KEY");
  if (res.status === 404) return new HttpError(503, `The AI model "${geminiModel()}" is not available - check GEMINI_MODEL`);
  return new HttpError(502, "The AI service returned an error - please try again");
}

/** One-shot generation (used for document text extraction). */
export async function generate(opts: GenerateOptions): Promise<{ text: string } & Usage> {
  const res = await fetch(endpoint("generateContent"), requestInit(opts));
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as GeminiResponse;
  if (body.promptFeedback?.blockReason) throw new HttpError(400, "The AI declined this request");
  return { text: textOf(body), tokensIn: body.usageMetadata?.promptTokenCount ?? null, tokensOut: body.usageMetadata?.candidatesTokenCount ?? null };
}

/** Streaming generation: yields text chunks; `usage` is filled in when the stream ends. */
export async function streamGenerate(opts: GenerateOptions, usage: Usage, signal?: AbortSignal): Promise<AsyncGenerator<string>> {
  const res = await fetch(endpoint("streamGenerateContent"), { ...requestInit(opts), signal });
  if (!res.ok || !res.body) throw await failure(res);
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
