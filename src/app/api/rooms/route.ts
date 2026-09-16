import { NextResponse } from "next/server";
import { createRoom } from "@/server/db";

export async function POST() {
  const code = createRoom();
  return NextResponse.json({ code });
}
