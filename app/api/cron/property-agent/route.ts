import { NextResponse } from "next/server";

import { runScheduledAgents } from "@/lib/agent-service";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runScheduledAgents());
  } catch (error) {
    return jsonError(error);
  }
}
