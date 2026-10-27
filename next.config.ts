import type { NextConfig } from "next";

// Baseline browser hardening for every response. Kept compatible with the app
// as built: our own PDF preview frames an API route (frame-ancestors 'self'),
// and routes that serve user files set their own stricter CSP.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  // Browsers ignore HSTS over plain http (local development); on HTTPS it pins the site to TLS.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/**
 * Identifies this build. The browser keeps the value it loaded with; /api/version answers with the
 * deployed one, so the installed phone app (and open tabs) notice a new deploy and reload into it.
 */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_ID || `local-${Date.now()}`;

const nextConfig: NextConfig = {
  output: "standalone",
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@fontsource/noto-sans/files/noto-sans-vietnamese-400-normal.woff"],
  },
  poweredByHeader: false,
  // SMTP needs the real Node net/tls stack; bundling nodemailer breaks the handshake.
  serverExternalPackages: ["nodemailer"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must be re-checked on every load so a new one is picked up right away.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
  // Keep Turbopack inside this repository when a parent directory happens to
  // contain an unrelated lockfile (common on developer workstations).
  turbopack: { root: process.cwd() },
};

export default nextConfig;
