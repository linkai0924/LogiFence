import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { RoundConfig, RoomSetup, SegmentRecord, AnalysisRecord, Speaker } from "../shared/types";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "logifence.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  topic TEXT NOT NULL DEFAULT '',
  stance TEXT NOT NULL DEFAULT '',
  arguments_text TEXT NOT NULL DEFAULT '',
  definitions TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  rounds TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_text TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_room ON segments(room, id);
CREATE INDEX IF NOT EXISTS idx_analyses_room ON analyses(room, id);
`);

export const DEFAULT_ROUNDS: RoundConfig[] = [
  { name: "立论 · 正方", secs: 180 },
  { name: "立论 · 反方", secs: 180 },
  { name: "质询 · 反方质询正方", secs: 120 },
  { name: "质询 · 正方质询反方", secs: 120 },
  { name: "自由辩论", secs: 300 },
  { name: "结辩 · 反方", secs: 180 },
  { name: "结辩 · 正方", secs: 180 },
];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoom(): string {
  const code = Array.from(crypto.randomBytes(6))
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("");
  db.prepare(
    "INSERT INTO rooms (code, rounds, created_at) VALUES (?, ?, ?)"
  ).run(code, JSON.stringify(DEFAULT_ROUNDS), Date.now());
  return code;
}

interface RoomRow {
  code: string;
  topic: string;
  stance: string;
  arguments_text: string;
  definitions: string;
  evidence: string;
  rounds: string;
}

export function getRoom(code: string): RoomSetup | null {
  const row = db.prepare("SELECT * FROM rooms WHERE code = ?").get(code.toUpperCase()) as RoomRow | undefined;
  if (!row) return null;
  return {
    topic: row.topic,
    stance: row.stance,
    arguments_text: row.arguments_text,
    definitions: row.definitions,
    evidence: row.evidence,
    rounds: safeParse(row.rounds, DEFAULT_ROUNDS),
  };
}

export function roomExists(code: string): boolean {
  return !!db.prepare("SELECT code FROM rooms WHERE code = ?").get(code.toUpperCase());
}

export function updateRoom(code: string, setup: Partial<RoomSetup>): void {
  const cur = getRoom(code);
  if (!cur) return;
  const next = { ...cur, ...setup };
  db.prepare(
    "UPDATE rooms SET topic=?, stance=?, arguments_text=?, definitions=?, evidence=?, rounds=? WHERE code=?"
  ).run(
    next.topic,
    next.stance,
    next.arguments_text,
    next.definitions,
    next.evidence,
    JSON.stringify(next.rounds),
    code.toUpperCase()
  );
}

export function addSegment(room: string, speaker: Speaker, text: string, keywords: string[]): number {
  const r = db
    .prepare("INSERT INTO segments (room, speaker, text, keywords, created_at) VALUES (?,?,?,?,?)")
    .run(room, speaker, text, JSON.stringify(keywords), Date.now());
  return Number(r.lastInsertRowid);
}

export function addAnalysis(room: string, kind: "opp" | "own", sourceText: string, result: unknown): number {
  const r = db
    .prepare("INSERT INTO analyses (room, kind, source_text, result, created_at) VALUES (?,?,?,?,?)")
    .run(room, kind, sourceText, JSON.stringify(result), Date.now());
  return Number(r.lastInsertRowid);
}

export function recentSegments(room: string, limit = 60): SegmentRecord[] {
  const rows = db
    .prepare("SELECT * FROM segments WHERE room = ? ORDER BY id DESC LIMIT ?")
    .all(room, limit) as any[];
  return rows.reverse().map((r) => ({
    id: r.id,
    speaker: r.speaker,
    text: r.text,
    keywords: safeParse(r.keywords, []),
    created_at: r.created_at,
  }));
}

export function recentAnalyses(room: string, limit = 20): AnalysisRecord[] {
  const rows = db
    .prepare("SELECT * FROM analyses WHERE room = ? ORDER BY id DESC LIMIT ?")
    .all(room, limit) as any[];
  return rows.reverse().map((r) => ({
    id: r.id,
    kind: r.kind,
    source_text: r.source_text,
    result: safeParse(r.result, {}) as AnalysisRecord["result"],
    created_at: r.created_at,
  }));
}

export function ownHistory(room: string, limit = 40): string {
  const rows = db
    .prepare("SELECT text FROM segments WHERE room = ? AND speaker = 'own' ORDER BY id DESC LIMIT ?")
    .all(room, limit) as any[];
  return rows.reverse().map((r) => r.text).join("。");
}

export function recentContext(room: string, limit = 8): string {
  const rows = db
    .prepare("SELECT speaker, text FROM segments WHERE room = ? ORDER BY id DESC LIMIT ?")
    .all(room, limit) as any[];
  return rows
    .reverse()
    .map((r) => `${r.speaker === "opp" ? "对方" : "我方"}：${r.text}`)
    .join("\n");
}

/** 从「核心概念定义」文本中提取概念关键词（每行 “概念：定义”） */
export function definitionKeywords(definitions: string): string[] {
  return definitions
    .split(/\r?\n/)
    .map((l) => l.split(/[:：=]/)[0].trim())
    .filter((k) => k.length >= 2 && k.length <= 12);
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
