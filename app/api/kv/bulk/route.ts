import { NextResponse } from "next/server";

import { ValidationError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { createRedisClient } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body) || !isRecord(body.values)) {
      throw new ValidationError("Request body must include a values object.");
    }

    const entries = Object.entries(body.values).map(([key, value]) => [key, String(value)] as const);
    if (entries.length === 0) {
      throw new ValidationError("No values provided.");
    }

    const redis = createRedisClient();
    await redis.pipeline(entries.map(([key, value]) => ["SET", key, value]));

    return NextResponse.json({ saved: entries.length });
  } catch (error) {
    return jsonError(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
