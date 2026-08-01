import { NextResponse } from "next/server";

import { logoutAuthenticatedUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    return NextResponse.json(await logoutAuthenticatedUser(request));
  } catch (error) {
    return jsonError(error);
  }
}
