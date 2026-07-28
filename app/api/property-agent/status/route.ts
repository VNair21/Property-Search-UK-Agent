import { NextResponse } from "next/server";

import { getAgentStatus } from "@/lib/agent-service";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getAgentStatus());
  } catch (error) {
    return jsonError(error);
  }
}
