import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { badRequest } from "./http-errors";

export const MIN_PASSWORD_LENGTH = 8;

export function assertPasswordPolicy(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > 128) throw badRequest("Password is too long");
  // bcrypt only uses the first 72 bytes; refuse longer ones rather than ignore the rest (sign-in isn't affected).
  if (Buffer.byteLength(password, "utf8") > 72) throw badRequest("Password is too long (max 72 bytes; accented letters count as 2-3)");
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw badRequest("Password must contain letters and numbers");
  return password;
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

/** Readable one-time password for admin-created / reset accounts (must be changed at first sign-in). */
export function generateTemporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const digits = "23456789";
  let out = "";
  for (let i = 0; i < 9; i++) out += letters[randomInt(letters.length)];
  for (let i = 0; i < 3; i++) out += digits[randomInt(digits.length)];
  return out;
}

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#f97316", "#22c55e", "#ec4899", "#8b5cf6", "#14b8a6", "#eab308"];
export function randomAvatarColor() {
  return AVATAR_COLORS[randomInt(AVATAR_COLORS.length)];
}
