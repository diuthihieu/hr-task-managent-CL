// Runs once when a server instance starts (before it handles requests).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { assertSafeConfig, configWarnings } = await import("./lib/env-check");
    assertSafeConfig();
    for (const w of configWarnings(process.env)) console.warn(`[config] ${w}`);
  }
}
