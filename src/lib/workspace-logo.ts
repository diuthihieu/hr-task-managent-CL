import { HttpError } from "./http-errors";

export const MAX_LOGO_BYTES = 256 * 1024;

/** Sniff the real image type from magic bytes (never trust the client's Content-Type). */
export function sniffLogoType(buf: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && String.fromCharCode(...buf.slice(0, 4)) === "RIFF" && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function assertLogo(buf: Uint8Array) {
  if (!buf.length) throw new HttpError(400, "Logo file is empty");
  if (buf.length > MAX_LOGO_BYTES) throw new HttpError(413, "Logo is too large (max 256 KB)");
  const type = sniffLogoType(buf);
  if (!type) throw new HttpError(400, "Logo must be a PNG, JPEG or WebP image");
  return type;
}

/** Cache-busting URL for a workspace logo (public, by slug, so link previews can load it). */
export function workspaceLogoUrl(w: { slug: string; logoUpdatedAt: Date | null }) {
  return w.logoUpdatedAt ? `/api/public/workspace-logo/${w.slug}?v=${w.logoUpdatedAt.getTime()}` : null;
}
