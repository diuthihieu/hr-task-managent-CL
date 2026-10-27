import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who / where an AI call comes from, for the token report in the system admin overview.
 * `route()` (src/lib/authz.ts) opens a context per API request with the route; `requireUser` fills in
 * the user. Calls outside a request (scheduled agent work...) are recorded as "background".
 */
export interface AiCallContext {
  feature: string;
  userId: string | null;
}

const storage = new AsyncLocalStorage<AiCallContext>();

/** "/api/tasks/3f2b.../comments/9a1c.../task-suggestion" -> "/api/tasks/:id/comments/:id/task-suggestion". */
export function featureOfPath(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:n")
    .slice(0, 160);
}

export function runWithAiContext<T>(ctx: AiCallContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The current request's context (a mutable object, so `requireUser` can add the user later). */
export function currentAiContext(): AiCallContext | undefined {
  return storage.getStore();
}

export function setAiContextUser(userId: string) {
  const ctx = storage.getStore();
  if (ctx) ctx.userId = userId;
}

/**
 * Writes one usage row. Never throws and never delays the answer: a failed write is only logged.
 * Token counts only - the prompt and the answer are not stored here.
 */
export function recordAiUsage(o: { workspaceId: string | null; model: string | null; tokensIn: number | null; tokensOut: number | null; ctx?: AiCallContext }) {
  const ctx = o.ctx ?? storage.getStore();
  void (async () => {
    try {
      const { prisma } = await import("../prisma");
      await prisma.aiUsageEvent.create({
        data: {
          workspaceId: o.workspaceId,
          userId: ctx?.userId ?? null,
          feature: ctx?.feature ?? "background",
          model: o.model?.slice(0, 80) ?? null,
          tokensIn: Math.max(0, o.tokensIn ?? 0),
          tokensOut: Math.max(0, o.tokensOut ?? 0),
        },
      });
    } catch (error) {
      console.error("[ai-usage] could not record usage", error);
    }
  })();
}
