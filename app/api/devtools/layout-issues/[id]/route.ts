import { NextResponse } from "next/server";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";

export async function GET() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

export async function DELETE() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
