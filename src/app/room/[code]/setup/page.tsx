"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomSetup, RoundConfig } from "@/shared/types";

export default function SetupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [form, setForm] = useState<RoomSetup | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/rooms/${code}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) router.push("/");
        else setForm(data);
      });
  }, [code, router]);

  if (!form) return <div className="page">加载中…</div>;

  const set = (k: keyof RoomSetup) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const setRound = (i: number, patch: Partial<RoundConfig>) => {
    const rounds = form.rounds.map((r, j) => (j === i ? { ...r, ...patch } : r));
    setForm({ ...form, rounds });
  };

  async function save() {
    setSaving(true);
    await fetch(`/api/rooms/${code}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    router.push(`/room/${code}`);
  }

  return (
    <div className="page setup">
      <h2>赛前设置 · 房间 {code.toUpperCase()}</h2>
      <p className="hint">房间码告诉队友即可加入。以下材料会用于实时攻防分析，填得越具体，提示越准。</p>

      <label>辩题</label>
      <input value={form.topic} onChange={set("topic")} placeholder="例：数字人民币的推广利大于弊" />

      <label>我方立场</label>
      <input value={form.stance} onChange={set("stance")} placeholder="例：正方——数字人民币的推广利大于弊" />

      <label>我方立论要点（分条写）</label>
      <textarea value={form.arguments_text} onChange={set("arguments_text")} rows={4}
        placeholder={"1. 降低交易成本，提升支付效率\n2. 增强金融普惠\n3. 提升货币政策传导效率"} />

      <label>核心概念定义（每行「概念：定义」，用于监控对方歪曲定义）</label>
      <textarea value={form.definitions} onChange={set("definitions")} rows={3}
        placeholder={"数字人民币：由央行发行的法定数字货币，M0 定位\n金融普惠：……"} />

      <label>我方论据库（案例 / 数据 / 权威报告，越具体越好）</label>
      <textarea value={form.evidence} onChange={set("evidence")} rows={5}
        placeholder={"· 试点数据：截至2024年6月，数字人民币累计交易金额7万亿元\n· 案例：深圳罗湖区消费券发放……"} />

      <label>赛制环节（名称 + 时长秒数）</label>
      {form.rounds.map((r, i) => (
        <div className="round-row" key={i}>
          <input type="text" value={r.name} onChange={(e) => setRound(i, { name: e.target.value })} />
          <input type="number" min={5} value={r.secs} onChange={(e) => setRound(i, { secs: Number(e.target.value) })} />
          <button className="danger" onClick={() => setForm({ ...form, rounds: form.rounds.filter((_, j) => j !== i) })}>
            删
          </button>
        </div>
      ))}
      <button onClick={() => setForm({ ...form, rounds: [...form.rounds, { name: "新环节", secs: 120 }] })}>
        + 添加环节
      </button>

      <div className="actions">
        <button className="primary" style={{ flex: 1, padding: 14, fontSize: 16 }} disabled={saving} onClick={save}>
          保存并进入辩论面板
        </button>
      </div>
    </div>
  );
}
