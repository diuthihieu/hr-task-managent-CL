"use client";

/** Server limit per upload (Vercel request body); bigger photos are shrunk in the browser first. */
const MAX_BYTES = 3.8 * 1024 * 1024;
const MAX_SIDE = 2560;

/**
 * Big photos / screenshots are re-encoded as JPEG (longest side up to 2560 px, lower quality if needed)
 * so they fit the upload limit. GIFs are kept as they are (animation); small images are untouched.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= MAX_BYTES || file.type === "image/gif" || typeof createImageBitmap === "undefined") return file;
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  let quality = 0.85;
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
    if (quality > 0.65) quality -= 0.1;
    else scale *= 0.75;
  }
  return file; // the server then explains that it is too large
}

/** Uploads an image for a task comment; resolves with the URL to show it inline. */
export async function uploadCommentImage(taskId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", await shrinkImage(file));
  const response = await fetch(`/api/tasks/${taskId}/comments/images`, { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new Error(body.error || `Upload failed (${response.status})`);
  return body.url;
}
