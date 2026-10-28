import { PrismaClient } from "@prisma/client";

// Large columns are left out of every query unless a query selects them
// explicitly (workspace logos, knowledge-doc text, user avatars).
const makeBase = () =>
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    omit: { workspace: { logoData: true }, knowledgeDoc: { text: true }, user: { avatarData: true }, attachment: { extractedText: true } },
  });

type PushRow = { id?: string; userId: string; type: string; title: string; body?: string | null; data?: unknown; link?: string | null; actorId?: string | null };
/** Every notification the app writes is also sent as Web Push (src/lib/push.ts), wherever it is created. */
function queue(base: PrismaClient, rows: PushRow[]) {
  if (!rows.length || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  void import("./push").then((m) => m.queuePush(base, rows)).catch((e) => console.error("[push] queue failed", e));
}
const makeClient = () => {
  const base = makeBase();
  return base.$extends({
    query: {
      notification: {
        async create({ args, query }) {
          const row = await query(args);
          const d = args.data as unknown as PushRow;
          queue(base, [{ ...d, id: (row as { id?: string }).id }]);
          return row;
        },
        async createMany({ args, query }) {
          const res = await query(args);
          queue(base, (Array.isArray(args.data) ? args.data : [args.data]) as unknown as PushRow[]);
          return res;
        },
      },
    },
  });
};

// A query-only extension leaves every model's shape unchanged, so the app keeps the plain client's
// types (Prisma.TransactionClient and friends stay assignable) while running the extended client.
type Client = ReturnType<typeof makeBase>;
const globalForPrisma = globalThis as unknown as { prisma?: Client };

export const prisma = globalForPrisma.prisma ?? (makeClient() as unknown as Client);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
