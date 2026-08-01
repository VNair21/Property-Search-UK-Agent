import { after, NextResponse } from "next/server";

import { configureAndStartAgent, runScheduledAgentForUser } from "@/lib/agent-service";
import { getAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);
    const body = await request.json();
    const response = await configureAndStartAgent(body, user.id);
    after(async () => {
      try {
        await runScheduledAgentForUser(user.id);
      } catch (error) {
        console.error("Initial property search failed", error);
      }
    });
    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
