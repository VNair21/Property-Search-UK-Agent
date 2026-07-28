import { NextResponse } from "next/server";

import { AppError, messageFromUnknown } from "./errors";

export function jsonError(error: unknown): NextResponse {
  const status = error instanceof AppError ? error.status : 500;
  return NextResponse.json(
    {
      detail: messageFromUnknown(error),
    },
    { status },
  );
}
