// Creates the first system admin, and nothing else. Safe to run on every
// deploy: it is a no-op as soon as any active admin exists.
//
//   ADMIN_EMAIL=you@company.com ADMIN_NAME="Your Name" [ADMIN_PASSWORD=...] npm run admin:bootstrap
//
// ADMIN_PASSWORD is required (set it as a secret env var): credentials are
// never generated here or written to build logs. The admin must choose a new
// password at first sign-in. Remove ADMIN_PASSWORD after the first deploy.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    console.log("[bootstrap-admin] ADMIN_EMAIL not set - skipping.");
    return;
  }
  const existingAdmin = await prisma.user.findFirst({ where: { systemRole: "ADMIN", isActive: true, deletedAt: null }, select: { email: true } });
  if (existingAdmin) {
    console.log(`[bootstrap-admin] An admin already exists (${existingAdmin.email}) - nothing to do.`);
    return;
  }
  const provided = process.env.ADMIN_PASSWORD;
  if (!provided) {
    console.log("[bootstrap-admin] ADMIN_PASSWORD not set - skipping (set it as a secret env var to create the first admin).");
    return;
  }
  if ((provided.length < 8 || !/[A-Za-z]/.test(provided) || !/[0-9]/.test(provided))) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters and contain letters and numbers");
  }
  const password = provided;
  const passwordHash = await bcrypt.hash(password, 12);
  const name = process.env.ADMIN_NAME?.trim() || email.split("@")[0];

  const user = await prisma.user.upsert({
    where: { email },
    update: { systemRole: "ADMIN", isActive: true, deletedAt: null, passwordHash, mustChangePassword: true },
    create: { email, name, passwordHash, systemRole: "ADMIN", mustChangePassword: true },
  });
  await prisma.activityLog.create({
    data: { actorId: null, entityType: "user", entityId: user.id, action: "created", summary: `Bootstrap admin ${email} created` },
  });
  console.log(`[bootstrap-admin] Admin ${email} is ready.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
