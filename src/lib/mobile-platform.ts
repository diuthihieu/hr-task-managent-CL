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
