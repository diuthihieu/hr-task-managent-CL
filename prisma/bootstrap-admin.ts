// Creates the first system admin, and nothing else. Safe to run on every
// deploy: it is a no-op as soon as any active admin exists.
//
//   ADMIN_EMAIL=you@company.com ADMIN_NAME="Your Name" [ADMIN_PASSWORD=...] npm run admin:bootstrap
//
// If ADMIN_PASSWORD is omitted a temporary password is generated and printed
// once. Either way the admin must choose a new password at first sign-in.
// Remove ADMIN_PASSWORD from your environment after the first deploy.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

function tempPassword() {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const b = randomBytes(12);
  let s = "";
  for (let i = 0; i < 9; i++) s += letters[b[i] % letters.length];
  for (let i = 9; i < 12; i++) s += String(2 + (b[i] % 8));
  return s;
}

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
  if (provided !== undefined && (provided.length < 8 || !/[A-Za-z]/.test(provided) || !/[0-9]/.test(provided))) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters and contain letters and numbers");
  }
  const password = provided || tempPassword();
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
  if (!provided) console.log(`[bootstrap-admin] Temporary password (shown once): ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
