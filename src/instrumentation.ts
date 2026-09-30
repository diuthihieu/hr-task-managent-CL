// Runs once when a server instance starts (before it handles requests).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { assertSafeConfig } = await import("./lib/env-check");
    assertSafeConfig();
  }
}
