import { NextResponse } from "next/server";
import { getRoom, recentSegments, recentAnalyses } from "@/server/db";
import type { AnalysisResult, ContradictionResult } from "@/shared/types";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const room = getRoom(code);
  if (!room) return NextResponse.json({ error: "房间不存在" }, { status: 404 });

  const lines: string[] = [];
  lines.push(`# 辩论记录 · 房间 ${code.toUpperCase()}`);
  lines.push("");
  lines.push(`- 辩题：${room.topic || "（未填写）"}`);
  lines.push(`- 我方立场：${room.stance || "（未填写）"}`);
  lines.push("");
  lines.push(`## 全程转写`);
  lines.push("");
  for (const s of recentSegments(code.toUpperCase(), 100000)) {
    const t = new Date(s.created_at).toLocaleTimeString("zh-CN", { hour12: false });
    lines.push(`- [${t}] **${s.speaker === "opp" ? "对方" : "我方"}**：${s.text}`);
  }
  lines.push("");
  lines.push(`## 攻防分析记录`);
  lines.push("");
  for (const a of recentAnalyses(code.toUpperCase(), 100000)) {
    const t = new Date(a.created_at).toLocaleTimeString("zh-CN", { hour12: false });
    if (a.kind === "opp") {
      const r = a.result as AnalysisResult;
      lines.push(`### [${t}] ${r.summary || "对方片段"}`);
      lines.push(`> ${a.source_text}`);
      if (r.fallacies?.length) lines.push(`- 漏洞：${r.fallacies.map((f) => `${f.type}（${f.detail}）`).join("；")}`);
      if (r.rebuttals?.length) lines.push(`- 反驳：${r.rebuttals.join("；")}`);
      if (r.questions?.length) lines.push(`- 追问：${r.questions.join("；")}`);
      if (r.quotes?.length) lines.push(`- 金句：${r.quotes.join("；")}`);
    } else {
      const r = a.result as ContradictionResult;
      lines.push(`### [${t}] ⚠️ 我方前后矛盾提醒`);
      for (const c of r.conflicts ?? []) lines.push(`- 「${c.current}」与「${c.previous}」：${c.note}`);
    }
    lines.push("");
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="debate-${code.toUpperCase()}.md"`,
    },
  });
}
