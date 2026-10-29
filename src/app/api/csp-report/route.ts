import { rateLimitByIp } from "@/lib/rate-limit";

// Content-Security-Policy violation reports (src/proxy.ts, Report-Only for now).
// Public and fed by anyone, so: POST only, small bodies, short fields, one log
// line of JSON (no newlines or control characters from the sender), nothing stored.
// Not wrapped in route() on purpose: browsers send no session with reports.

const MAX_BYTES = 8 * 1024;
const FIELDS = ["document-uri", "documentURL", "violated-directive", "effective-directive", "effectiveDirective", "blocked-uri", "blockedURL", "source-file", "sourceFile", "line-number", "lineNumber", "disposition"];

async function readCapped(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const short = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 200) : undefined);

export async function POST(req: Request) {
  const text = await readCapped(req);
  if (text === null) return new Response(null, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  // Same answer either way; over the limit, reports are just not logged.
  if (!(await rateLimitByIp(req, "csp-report", 60, 60_000, { key: "csp-report:any", limit: 600, windowMs: 60_000 }))) return new Response(null, { status: 204 });
  // application/csp-report: { "csp-report": {...} }; application/reports+json: [{ type, body }].
  const reports = Array.isArray(parsed) ? parsed.slice(0, 10).map((r) => (r as { body?: unknown })?.body) : [(parsed as { "csp-report"?: unknown })?.["csp-report"]];
  for (const r of reports) {
    if (!r || typeof r !== "object") continue;
    const entry = Object.fromEntries(FIELDS.map((f) => [f, short((r as Record<string, unknown>)[f])]).filter(([, v]) => v !== undefined));
    console.warn(JSON.stringify({ csp: entry }));
  }
  return new Response(null, { status: 204 });
}
