"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  AnalysisRecord,
  AnalysisResult,
  ContradictionResult,
  RoomSetup,
  SegmentRecord,
  Speaker,
  TimerState,
} from "@/shared/types";

type Status = { level: "ok" | "info" | "error"; msg: string } | null;

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const roomCode = code.toUpperCase();

  const [connected, setConnected] = useState(false);
  const [role, setRole] = useState<"capturer" | "viewer">("viewer");
  const [capturerTaken, setCapturerTaken] = useState(false);
  const [speaker, setSpeaker] = useState<Speaker>("opp");
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [setup, setSetup] = useState<RoomSetup | null>(null);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [partial, setPartial] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [asrReady, setAsrReady] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: AudioWorkletNode } | null>(null);
  const pcmAccRef = useRef<{ bufs: Int16Array[]; len: number }>({ bufs: [], len: 0 });
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const wantCapturerRef = useRef(false);
  const speakerRef = useRef<Speaker>("opp");

  const send = useCallback((obj: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(obj));
  }, []);

  // ---------- WebSocket ----------
  useEffect(() => {
    wantCapturerRef.current = localStorage.getItem(`capturer:${roomCode}`) === "1";
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      send({ type: "hello", room: roomCode, capturer: wantCapturerRef.current });
    };
    ws.onclose = () => {
      setConnected(false);
      setAsrReady(false);
      setMicOn(false);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case "state":
          setRole(msg.role);
          setSpeaker(msg.speaker);
          speakerRef.current = msg.speaker;
          setTimer(msg.timer);
          setSetup(msg.setup);
          setCapturerTaken(msg.capturerTaken);
          setSegments(msg.segments ?? []);
          setAnalyses(msg.analyses ?? []);
          break;
        case "role":
          setRole(msg.role);
          break;
        case "capturer":
          setCapturerTaken(msg.taken);
          break;
        case "speaker":
          setSpeaker(msg.value);
          speakerRef.current = msg.value;
          break;
        case "timer":
          setTimer({ ...msg.timer });
          break;
        case "transcript":
          setPartial(msg.text);
          break;
        case "sentence":
          setPartial("");
          setSegments((prev) => [...prev.slice(-199), { id: msg.id, speaker: msg.speaker, text: msg.text, keywords: msg.keywords ?? [], created_at: Date.now() }]);
          break;
        case "analyzing":
          if (msg.speaker === "opp") setAnalyzing(true);
          break;
        case "analysis":
          setAnalyzing(false);
          setAnalyses((prev) => [{ id: msg.id, kind: msg.kind, source_text: msg.sourceText, result: msg.result, created_at: Date.now() }, ...prev].slice(0, 50));
          break;
        case "round-end":
          setStatus({ level: "info", msg: "⏰ 本环节时间到" });
          break;
        case "status":
          if (msg.msg === "asr-ready") {
            setAsrReady(true);
            setStatus(null);
          } else if (msg.msg === "asr-closed") {
            setAsrReady(false);
          } else {
            setStatus({ level: msg.level, msg: msg.msg });
          }
          break;
      }
    };
    return () => ws.close();
  }, [roomCode, send]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [segments, partial]);

  // ---------- 音频采集 ----------
  const startMic = useCallback(async () => {
    if (audioRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule("/pcm-worklet.js");
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pcm-processor");
      node.port.onmessage = (e) => {
        const chunk = new Int16Array(e.data as ArrayBuffer);
        const acc = pcmAccRef.current;
        acc.bufs.push(chunk);
        acc.len += chunk.length;
        // 攒够 ~100ms (1600 采样) 再发，减少小帧
        if (acc.len >= 1600 && wsRef.current?.readyState === WebSocket.OPEN) {
          const merged = new Int16Array(acc.len);
          let off = 0;
          for (const b of acc.bufs) {
            merged.set(b, off);
            off += b.length;
          }
          wsRef.current.send(merged.buffer);
          acc.bufs = [];
          acc.len = 0;
        }
      };
      src.connect(node);
      audioRef.current = { ctx, stream, node };
      send({ type: "mic", action: "start" });
      setMicOn(true);
    } catch (e) {
      setStatus({ level: "error", msg: "麦克风授权失败或不可用（需要 HTTPS 环境）" });
    }
  }, [send]);

  const stopMic = useCallback(() => {
    send({ type: "mic", action: "stop" });
    if (audioRef.current) {
      audioRef.current.node.disconnect();
      audioRef.current.stream.getTracks().forEach((t) => t.stop());
      audioRef.current.ctx.close();
      audioRef.current = null;
    }
    pcmAccRef.current = { bufs: [], len: 0 };
    setMicOn(false);
    setAsrReady(false);
  }, [send]);

  const claimCapturer = () => {
    localStorage.setItem(`capturer:${roomCode}`, "1");
    send({ type: "claim" });
  };

  const setSpeakerSide = (v: Speaker) => {
    send({ type: "speaker", value: v });
  };

  const timerCtl = (action: string) => send({ type: "timer", action });

  // ---------- 渲染 ----------
  const isCapturer = role === "capturer";
  const mm = timer ? String(Math.floor(timer.remaining / 60)).padStart(2, "0") : "--";
  const ss = timer ? String(timer.remaining % 60).padStart(2, "0") : "--";
  const round = timer?.rounds[timer.index];
  const clockClass = timer && timer.remaining === 0 ? "over" : timer && timer.remaining <= 30 ? "warn" : "";
  const progress = timer && round ? (timer.remaining / round.secs) * 100 : 0;

  return (
    <div className="page">
      <div className="topbar">
        <span className={`dot ${connected ? "on" : ""}`} />
        <span>房间 {roomCode}</span>
        <span className="spacer" />
        {!isCapturer && !capturerTaken && <button onClick={claimCapturer}>成为采集端</button>}
        {isCapturer && <span style={{ color: "var(--accent)" }}>🎙 采集端</span>}
        <Link href={`/room/${roomCode}/setup`}>设置</Link>
        <a href={`/api/rooms/${roomCode}/export`}>导出</a>
      </div>

      <div className="timer-block">
        <div className="timer-round">
          {round?.name ?? "未设置环节"}（{timer ? timer.index + 1 : 0}/{timer?.rounds.length ?? 0}）
        </div>
        <div className={`timer-clock ${clockClass}`}>
          {mm}:{ss}
        </div>
        <div className="timer-progress">
          <div style={{ width: `${progress}%` }} />
        </div>
        {isCapturer && (
          <div className="timer-controls">
            {timer?.running ? (
              <button onClick={() => timerCtl("pause")}>⏸ 暂停</button>
            ) : (
              <button className="primary" onClick={() => timerCtl("start")}>▶ 开始</button>
            )}
            <button onClick={() => timerCtl("reset")}>重置</button>
            <button onClick={() => timerCtl("prev")}>上一环节</button>
            <button onClick={() => timerCtl("next")}>下一环节 →</button>
          </div>
        )}
      </div>

      {isCapturer && (
        <div className="controls">
          <div className="speaker-toggle">
            <button className={speaker === "opp" ? "active-opp" : ""} onClick={() => setSpeakerSide("opp")}>
              对方发言
            </button>
            <button className={speaker === "own" ? "active-own" : ""} onClick={() => setSpeakerSide("own")}>
              我方发言
            </button>
          </div>
          {micOn ? (
            <button className="danger" onClick={stopMic}>■ 停止收音</button>
          ) : (
            <button className="primary" onClick={startMic}>🎙 开始收音</button>
          )}
        </div>
      )}

      <div className="statusbar">
        {micOn && !asrReady && <span>正在连接语音识别…</span>}
        {micOn && asrReady && <span style={{ color: "var(--ok)" }}>● 识别中（{speaker === "opp" ? "对方" : "我方"}）</span>}
        {status && <span className={status.level === "error" ? "err" : ""}>{status.msg}</span>}
      </div>

      {partial && <div className="partial">识别中：{partial}</div>}
      {analyzing && <div className="analyzing-hint">⚡ 正在分析对方观点…</div>}

      {/* 攻防卡片流（最新在上） */}
      {analyses.map((a) =>
        a.kind === "opp" ? (
          <OppCard key={a.id} r={a.result as AnalysisResult} src={a.source_text} />
        ) : (
          <ContradictionCard key={a.id} r={a.result as ContradictionResult} src={a.source_text} />
        )
      )}
      {analyses.length === 0 && (
        <div className="analyzing-hint">等待对方发言…卡片将在这里实时出现</div>
      )}

      <details className="drawer">
        <summary>📜 完整转写（{segments.length} 句）</summary>
        <div className="body">
          {segments.map((s) => (
            <div className="transcript-line" key={s.id}>
              <span className={s.speaker === "opp" ? "who-opp" : "who-own"}>{s.speaker === "opp" ? "对方" : "我方"}：</span>
              <Highlight text={s.text} keywords={s.keywords} />
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      </details>

      {setup?.evidence && (
        <details className="drawer">
          <summary>📚 我方论据库</summary>
          <div className="body">
            <div className="evidence-text">{setup.evidence}</div>
          </div>
        </details>
      )}
    </div>
  );
}

function OppCard({ r, src }: { r: AnalysisResult; src: string }) {
  return (
    <div className="card">
      <div className="card-summary">{r.summary || r.main_claim || "对方发言"}</div>
      {r.main_claim && r.main_claim !== r.summary && <div className="card-claim">论点：{r.main_claim}</div>}
      {(r.fallacies.length > 0 || r.defense_points.length > 0) && (
        <div className="badges">
          {r.fallacies.map((f, i) => (
            <span className="badge" key={i} title={f.detail}>⚠ {f.type}</span>
          ))}
          {r.defense_points.slice(0, 2).map((d, i) => (
            <span className="badge def" key={i} title={d}>🛡 可防守</span>
          ))}
        </div>
      )}
      {r.rebuttals.length > 0 && (
        <ul className="rebuttals">
          {r.rebuttals.slice(0, 3).map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>追问 · 金句 · 详情</summary>
        {r.questions.length > 0 && (
          <>
            <b>追问：</b>
            <ul>{r.questions.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
        {r.quotes.length > 0 && (
          <>
            <b>金句：</b>
            <ul>{r.quotes.map((x, i) => <li key={i}>「{x}」</li>)}</ul>
          </>
        )}
        {r.fallacies.length > 0 && (
          <>
            <b>漏洞详解：</b>
            <ul>{r.fallacies.map((f, i) => <li key={i}>{f.type}：{f.detail}</li>)}</ul>
          </>
        )}
        {r.assumptions.length > 0 && (
          <>
            <b>隐含假设：</b>
            <ul>{r.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
        {r.evidence_refs.length > 0 && (
          <>
            <b>可引用论据：</b>
            <ul>{r.evidence_refs.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
        {r.attack_on_us.length > 0 && (
          <>
            <b>对方攻击点：</b>
            <ul>{r.attack_on_us.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
        {r.defense_points.length > 0 && (
          <>
            <b>我方可防守点：</b>
            <ul>{r.defense_points.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
      </details>
      <div className="src">{src}</div>
    </div>
  );
}

function ContradictionCard({ r, src }: { r: ContradictionResult; src: string }) {
  return (
    <div className="card contradiction">
      <div className="card-summary">⚠️ 注意：我方发言疑似前后矛盾</div>
      <ul className="rebuttals">
        {r.conflicts.map((c, i) => (
          <li key={i}>
            「{c.current}」与此前「{c.previous}」冲突：{c.note}
          </li>
        ))}
      </ul>
      <div className="src">{src}</div>
    </div>
  );
}

function Highlight({ text, keywords }: { text: string; keywords: string[] }) {
  if (!keywords.length) return <>{text}</>;
  const pattern = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "g"));
  return (
    <>
      {parts.map((p, i) => (keywords.includes(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}
