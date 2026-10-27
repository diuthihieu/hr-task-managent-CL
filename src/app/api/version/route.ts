import { NextResponse } from "next/server";

/** The deployed build's id (public, not secret): clients compare it with the one they loaded. */
export function GET() {
  return NextResponse.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
