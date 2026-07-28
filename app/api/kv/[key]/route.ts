import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { jsonError } from "@/lib/http";
import { createRedisClient } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  try {
    const { key } = await context.params;
    const redis = createRedisClient();
    const value = await redis.getString(key);
    if (value === null) {
      return NextResponse.json({ detail: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ key, value });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  try {
    const { key } = await context.params;
    const body = (await request.json()) as { value?: unknown };
    const value = String(body.value ?? "");
    const redis = createRedisClient();
    await redis.setString(key, value);

    return NextResponse.json({ key, value });
  } catch (error) {
    return jsonError(error);
  }
}
