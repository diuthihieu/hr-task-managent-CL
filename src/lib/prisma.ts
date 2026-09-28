import { PrismaClient } from "@prisma/client";

// Large columns are left out of every query unless a query selects them
// explicitly (workspace logos, knowledge-doc text, user avatars).
const makeClient = () =>
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    omit: { workspace: { logoData: true }, knowledgeDoc: { text: true }, user: { avatarData: true }, attachment: { extractedText: true } },
  });

type Client = ReturnType<typeof makeClient>;
const globalForPrisma = globalThis as unknown as { prisma?: Client };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
