import { NextResponse } from "next/server";

/** Android app id (mobile/android/app/build.gradle). */
const ANDROID_PACKAGE = "vn.woli.app";
/**
 * SHA-256 fingerprint of the certificate that signs the Android app (public - it is in every APK).
 * ANDROID_CERT_SHA256 (comma list) replaces it, e.g. after moving to a new key or Play App Signing.
 */
const DEFAULT_CERTS = ["22:6F:61:3D:A6:9F:9B:DD:46:50:88:02:F2:6E:AA:C0:A3:F8:7F:69:11:65:21:EE:D6:90:72:F0:BD:7C:35:3B"];

/**
 * Digital Asset Links: tells Chrome that the woli Android app may show this site full screen (Trusted
 * Web Activity, no address bar) and open its links. Public by design.
 */
export function GET() {
  const certs = (process.env.ANDROID_CERT_SHA256?.split(",") ?? DEFAULT_CERTS).map((c) => c.trim().toUpperCase()).filter((c) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(c));
  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: certs },
    },
  ];
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
