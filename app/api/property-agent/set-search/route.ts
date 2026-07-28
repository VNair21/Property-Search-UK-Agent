import { NextResponse } from "next/server";

import { configureAndStartAgent } from "@/lib/agent-service";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const response = await configureAndStartAgent(body);
    return NextResponse.json(response);
  } catch (error) {
    return jsonError(error);
  }
}
