import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { createRedisClient } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const redis = createRedisClient();
    const pong = await redis.ping();
    return NextResponse.json({
      status: "ok",
      redis: pong === "PONG" ? "ok" : "error",
    });
  } catch (error) {
    return jsonError(error);
  }
}
