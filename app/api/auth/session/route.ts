import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    return NextResponse.json({ user: await getAuthenticatedUser(request) });
  } catch (error) {
    return jsonError(error);
  }
}
