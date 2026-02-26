import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

class SentryExampleAPIError extends Error {
  constructor() {
    super("Sentry Example API Route Error");
    this.name = "SentryExampleAPIError";
  }
}

export function GET() {
  throw new SentryExampleAPIError();
  return NextResponse.json({ data: "Testing Sentry Error..." });
}
