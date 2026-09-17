"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function createRoom() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/rooms", { method: "POST" });
      const data = await r.json();
      router.push(`/room/${data.code}/setup`);
    } catch {
      setErr("创建失败，请重试");
      setBusy(false);
    }
  }

  async function joinRoom() {
    const c = code.trim().toUpperCase();
    if (c.length !== 6) {
      setErr("请输入 6 位房间码");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/rooms/${c}`);
      if (!r.ok) {
        setErr("房间不存在，请检查房间码");
        setBusy(false);
        return;
      }
      router.push(`/room/${c}`);
    } catch {
      setErr("网络错误，请重试");
      setBusy(false);
    }
  }

  return (
    <div className="page home">
      <h1>LogiFence</h1>
      <p className="sub">实时辩论辅助系统 · 语音转写 · 漏洞识别 · 攻防提示</p>
      <div className="box">
        <button className="primary" style={{ width: "100%", padding: 14, fontSize: 17 }} disabled={busy} onClick={createRoom}>
          创建辩论房间
        </button>
      </div>
      <div className="box">
        <input
          className="code-input"
          placeholder="房间码"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && joinRoom()}
        />
        <button style={{ width: "100%", marginTop: 10, padding: 12 }} disabled={busy} onClick={joinRoom}>
          加入房间
        </button>
      </div>
      {err && <p style={{ color: "var(--opp)" }}>{err}</p>}
    </div>
  );
}
