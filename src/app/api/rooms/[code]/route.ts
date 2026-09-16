import { NextResponse } from "next/server";
import { getRoom, updateRoom } from "@/server/db";
import { updateLiveRounds } from "@/server/ws";
import type { RoomSetup } from "@/shared/types";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const room = getRoom(code);
  if (!room) return NextResponse.json({ error: "房间不存在" }, { status: 404 });
  return NextResponse.json(room);
}

export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = (await req.json()) as Partial<RoomSetup>;
  if (!getRoom(code)) return NextResponse.json({ error: "房间不存在" }, { status: 404 });
  const rounds = Array.isArray(body.rounds)
    ? body.rounds
        .map((r) => ({ name: String(r.name ?? "").slice(0, 30), secs: Math.max(5, Math.min(3600, Number(r.secs) || 60)) }))
        .filter((r) => r.name)
    : undefined;
  updateRoom(code, {
    topic: String(body.topic ?? "").slice(0, 500),
    stance: String(body.stance ?? "").slice(0, 1000),
    arguments_text: String(body.arguments_text ?? "").slice(0, 3000),
    definitions: String(body.definitions ?? "").slice(0, 2000),
    evidence: String(body.evidence ?? "").slice(0, 5000),
    ...(rounds ? { rounds } : {}),
  });
  if (rounds) updateLiveRounds(code, rounds);
  return NextResponse.json({ ok: true });
}
