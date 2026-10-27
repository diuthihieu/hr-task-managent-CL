/**
 * Images in task comments are task attachments shown inline. In a comment's HTML they appear only as
 * <img src="/api/attachments/<id>/download?inline=1"> (same-origin, permission-checked download);
 * external image URLs are never kept, so a comment cannot load tracking pixels or other sites' files.
 */
export const COMMENT_IMAGE_SRC = /^\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download\?inline=1$/i;

export const commentImageUrl = (attachmentId: string) => `/api/attachments/${attachmentId}/download?inline=1`;

/** Attachment ids referenced by <img> tags in a comment body (before sanitizing). */
export function commentImageIds(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const hit = COMMENT_IMAGE_SRC.exec(m[1].replace(/&amp;/g, "&"));
    if (hit) ids.add(hit[1].toLowerCase());
  }
  return [...ids];
}

/** Image types a comment accepts (checked again on the server from the file's first bytes). */
export const COMMENT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
