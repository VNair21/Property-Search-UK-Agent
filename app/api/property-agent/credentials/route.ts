import { NextResponse } from "next/server";

import { saveAgentCredentials } from "@/lib/agent-service";
import { getAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);
    return NextResponse.json(await saveAgentCredentials(await request.json(), user.id));
  } catch (error) {
    return jsonError(error);
  }
}
