export type MobilePlatform = "ios" | "android" | "other";

/** iPhone / iPad (iPadOS reports a Mac user agent, but has touch) / Android / anything else. */
export function detectPlatform(ua: string, maxTouchPoints = 0): MobilePlatform {
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** iOS browsers other than Safari (Chrome, Firefox, Edge, and in-app browsers such as Zalo or Facebook). */
export function isIosOtherBrowser(ua: string): boolean {
  return /CriOS|FxiOS|EdgiOS|FBAN|FBAV|Instagram|Zalo|Line\//i.test(ua);
}

/** "1.2.0" is newer than "1.1.9" (a leading "v" and prerelease suffixes are ignored). */
export function newerVersion(a: string, b: string): boolean {
  const n = (v: string) => v.replace(/^v/, "").replace(/-.*$/, "").split(".").map((x) => Number(x) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
