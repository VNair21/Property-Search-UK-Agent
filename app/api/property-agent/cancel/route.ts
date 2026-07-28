import { NextResponse } from "next/server";

import { cancelAgent } from "@/lib/agent-service";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    return NextResponse.json(await cancelAgent());
  } catch (error) {
    return jsonError(error);
  }
}
