import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";
import { ASRSession } from "./asr";
import { analyzeOpponent, analyzeOwn } from "./analyzer";
import * as db from "./db";
import type { RoundConfig, Speaker, TimerState } from "../shared/types";

interface Client {
  id: string;
  ws: WebSocket;
  role: "capturer" | "viewer";
}

interface PendingBuf {
  parts: string[];
  since: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
}

class RoomRuntime {
  clients = new Set<Client>();
  speaker: Speaker = "opp";
  asr: ASRSession | null = null;
  timer: TimerState;
  private tickHandle: NodeJS.Timeout | null = null;
  private pending: Record<Speaker, PendingBuf> = {
    opp: { parts: [], since: 0, timer: null, busy: false },
    own: { parts: [], since: 0, timer: null, busy: false },
  };

  constructor(public code: string) {
    const setup = db.getRoom(code);
    const rounds = setup?.rounds?.length ? setup.rounds : db.DEFAULT_ROUNDS;
    this.timer = { rounds, index: 0, remaining: rounds[0]?.secs ?? 0, running: false };
  }

  broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
    }
  }

  capturer(): Client | undefined {
    return [...this.clients].find((c) => c.role === "capturer");
  }

  sendCapturerState() {
    this.broadcast({ type: "capturer", taken: !!this.capturer() });
  }

  // ---------- 计时 ----------
  setRounds(rounds: RoundConfig[]) {
    this.stopTick();
    this.timer = {
      rounds,
      index: 0,
      remaining: rounds[0]?.secs ?? 0,
      running: false,
    };
    this.broadcastTimer();
  }

  timerAction(action: string, index?: number) {
    const t = this.timer;
    switch (action) {
      case "start":
        if (t.remaining > 0) {
          t.running = true;
          this.startTick();
        }
        break;
      case "pause":
        t.running = false;
        this.stopTick();
        break;
      case "reset":
        t.running = false;
        this.stopTick();
        t.remaining = t.rounds[t.index]?.secs ?? 0;
        break;
      case "next":
        this.gotoRound(t.index + 1);
        return;
      case "prev":
        this.gotoRound(t.index - 1);
        return;
      case "goto":
        this.gotoRound(index ?? t.index);
        return;
    }
    this.broadcastTimer();
  }

  private gotoRound(i: number) {
    const t = this.timer;
    if (i < 0 || i >= t.rounds.length) return;
    t.running = false;
    this.stopTick();
    t.index = i;
    t.remaining = t.rounds[i].secs;
    this.broadcastTimer();
  }

  private startTick() {
    this.stopTick();
    this.tickHandle = setInterval(() => {
      const t = this.timer;
      if (!t.running) return;
      t.remaining = Math.max(0, t.remaining - 1);
      this.broadcastTimer();
      if (t.remaining === 0) {
        t.running = false;
        this.stopTick();
        this.broadcast({ type: "round-end", index: t.index });
      }
    }, 1000);
  }

  private stopTick() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  broadcastTimer() {
    this.broadcast({ type: "timer", timer: this.timer });
  }

  // ---------- 转写 & 分析 ----------
  onFinalSentence(speaker: Speaker, text: string) {
    const setup = db.getRoom(this.code);
    const keys = setup ? db.definitionKeywords(setup.definitions) : [];
    const hit = keys.filter((k) => text.includes(k));
    const id = db.addSegment(this.code, speaker, text, hit);
    this.broadcast({ type: "sentence", id, speaker, text, keywords: hit });

    const buf = this.pending[speaker];
    buf.parts.push(text);
    if (buf.since === 0) buf.since = Date.now();
    const joined = buf.parts.join("");
    if (joined.length >= 50) {
      this.flush(speaker);
    } else if (!buf.timer) {
      buf.timer = setTimeout(() => this.flush(speaker), 6000);
    }
  }

  private async flush(speaker: Speaker) {
    const buf = this.pending[speaker];
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = null;
    if (buf.busy || buf.parts.length === 0) return;
    const chunk = buf.parts.join("。");
    buf.parts = [];
    buf.since = 0;
    buf.busy = true;
    try {
      const setup = db.getRoom(this.code);
      if (!setup) return;
      if (speaker === "opp") {
        this.broadcast({ type: "analyzing", speaker });
        const result = await analyzeOpponent({
          setup,
          chunk,
          context: db.recentContext(this.code, 8),
        });
        if (result) {
          const id = db.addAnalysis(this.code, "opp", chunk, result);
          this.broadcast({ type: "analysis", id, kind: "opp", sourceText: chunk, result });
        }
      } else {
        const result = await analyzeOwn({
          topic: setup.topic,
          stance: setup.stance,
          chunk,
          ownHistory: db.ownHistory(this.code, 40),
        });
        if (result && !result.consistent && result.conflicts.length > 0) {
          const id = db.addAnalysis(this.code, "own", chunk, result);
          this.broadcast({ type: "analysis", id, kind: "own", sourceText: chunk, result });
        }
      }
    } finally {
      buf.busy = false;
      // busy 期间又攒了内容则继续
      if (buf.parts.length > 0) this.flush(speaker);
    }
  }

  // ---------- ASR ----------
  startMic(client: Client) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      this.sendTo(client, { type: "status", level: "error", msg: "服务端未配置 DASHSCOPE_API_KEY，无法语音识别" });
      return;
    }
    if (this.asr) this.asr.close();
    this.asr = new ASRSession(apiKey, {
      onReady: () => this.broadcast({ type: "status", level: "ok", msg: "asr-ready" }),
      onPartial: (text) => this.broadcast({ type: "transcript", speaker: this.speaker, text }),
      onFinal: (text) => {
        this.broadcast({ type: "transcript", speaker: this.speaker, text: "" });
        this.onFinalSentence(this.speaker, text);
      },
      onError: (msg) => this.broadcast({ type: "status", level: "error", msg }),
      onClosed: () => {
        this.asr = null;
        this.broadcast({ type: "status", level: "info", msg: "asr-closed" });
      },
    });
  }

  stopMic() {
    if (this.asr) {
      this.asr.finish();
      this.asr = null;
    }
  }

  sendTo(client: Client, msg: unknown) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg));
  }

  destroyIfEmpty() {
    if (this.clients.size === 0) {
      this.stopMic();
      this.stopTick();
      runtimes.delete(this.code);
    }
  }
}

const runtimes = new Map<string, RoomRuntime>();

function getRuntime(code: string): RoomRuntime | null {
  if (!db.roomExists(code)) return null;
  let rt = runtimes.get(code);
  if (!rt) {
    rt = new RoomRuntime(code);
    runtimes.set(code, rt);
  }
  return rt;
}

/** 供 API 路由调用：设置更新后同步运行中的房间 */
export function updateLiveRounds(code: string, rounds: RoundConfig[]) {
  runtimes.get(code.toUpperCase())?.setRounds(rounds);
}

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {}
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    }
    // 其他路径（如 Next HMR）交给 Next 自己的 upgrade 监听
  });

  wss.on("connection", (ws) => {
    let client: Client | null = null;
    let room: RoomRuntime | null = null;

    ws.on("message", (raw, isBinary) => {
      if (isBinary) {
        // 采集端音频帧
        if (room && client?.role === "capturer" && room.asr) {
          room.asr.sendAudio(Buffer.from(raw as Buffer));
        }
        return;
      }
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      handleMessage(msg);
    });

    function handleMessage(msg: any) {
      switch (msg.type) {
        case "hello": {
          const code = String(msg.room ?? "").toUpperCase();
          const rt = getRuntime(code);
          if (!rt) {
            ws.send(JSON.stringify({ type: "status", level: "error", msg: "房间不存在" }));
            return;
          }
          room = rt;
          const wantCapturer = !!msg.capturer;
          const role = wantCapturer && !rt.capturer() ? "capturer" : "viewer";
          client = { id: crypto.randomUUID(), ws, role };
          rt.clients.add(client);
          const setup = db.getRoom(code)!;
          rt.sendTo(client, {
            type: "state",
            role,
            speaker: rt.speaker,
            timer: rt.timer,
            setup,
            capturerTaken: !!rt.capturer(),
            segments: db.recentSegments(code, 60),
            analyses: db.recentAnalyses(code, 20),
          });
          rt.sendCapturerState();
          break;
        }
        case "claim": {
          if (!room || !client) break;
          if (!room.capturer()) {
            client.role = "capturer";
            room.sendTo(client, { type: "role", role: "capturer" });
            room.sendCapturerState();
          }
          break;
        }
        case "speaker": {
          if (!room || client?.role !== "capturer") break;
          room.speaker = msg.value === "own" ? "own" : "opp";
          room.broadcast({ type: "speaker", value: room.speaker });
          break;
        }
        case "mic": {
          if (!room || client?.role !== "capturer") break;
          if (msg.action === "start") room.startMic(client);
          else room.stopMic();
          break;
        }
        case "timer": {
          if (!room || client?.role !== "capturer") break;
          room.timerAction(String(msg.action ?? ""), msg.index);
          break;
        }
      }
    }

    ws.on("close", () => {
      if (room && client) {
        room.clients.delete(client);
        if (client.role === "capturer") {
          room.stopMic();
          room.sendCapturerState();
        }
        room.destroyIfEmpty();
      }
    });
  });
}
