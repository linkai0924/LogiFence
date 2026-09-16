import OpenAI from "openai";
import type { AnalysisResult, ContradictionResult, RoomSetup } from "../shared/types";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || "",
      baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
      timeout: 25000,
      maxRetries: 1,
    });
  }
  return client;
}

function model(): string {
  return process.env.LLM_MODEL || "deepseek-chat";
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

const OPP_SYSTEM = `你是一名辩论赛实时攻防教练。输入是对方辩手发言的实时语音转写片段（可能有错别字，请自行纠正理解）。结合我方赛前材料，输出严格的 JSON 对象，字段全部必须存在：
{
  "summary": "对方这段话的一句话摘要，不超过30字",
  "main_claim": "对方核心论点，不超过30字，没有则为空字符串",
  "arguments": ["主要论据，每条不超过20字"],
  "assumptions": ["隐含假设，每条不超过20字"],
  "fallacies": [{"type": "谬误类型", "detail": "一句话指出问题，不超过30字"}],
  "attack_on_us": ["对我方立场构成的攻击点，每条不超过20字"],
  "defense_points": ["我方可防守要点，每条不超过20字"],
  "rebuttals": ["反驳角度，最多3条，每条不超过25字，要犀利直接、拿来就能说"],
  "questions": ["追问对方的问题，最多2个，要短"],
  "quotes": ["可直接说出口的反驳金句，最多2句，朗朗上口，不超过25字"],
  "evidence_refs": ["从我方论据库中可引用的条目关键词"]
}
谬误类型仅从以下选择：偷换概念、因果谬误、以偏概全、循环论证、稻草人谬误、诉诸情感、虚假两难、数据误导、滑坡谬误、其他。没有对应内容就留空数组。只输出 JSON，不要输出任何其他文字。`;

const OWN_SYSTEM = `你在检查我方辩手最新发言是否与之前的我方陈述自相矛盾。输出严格 JSON：
{"consistent": true, "conflicts": [{"current": "本次的说法", "previous": "之前的说法", "note": "矛盾点一句话"}]}
没有矛盾时 consistent 为 true 且 conflicts 为空数组。只输出 JSON，不要输出任何其他文字。`;

export async function analyzeOpponent(opts: {
  setup: RoomSetup;
  chunk: string;
  context: string;
}): Promise<AnalysisResult | null> {
  const { setup, chunk, context } = opts;
  const user = [
    `【辩题】${trunc(setup.topic, 200)}`,
    `【我方立场】${trunc(setup.stance, 300)}`,
    `【我方立论要点】${trunc(setup.arguments_text, 800)}`,
    `【核心概念定义】${trunc(setup.definitions, 500)}`,
    `【我方论据库】${trunc(setup.evidence, 1000)}`,
    `【最近发言上下文】\n${trunc(context, 600)}`,
    `【对方最新发言片段】\n${chunk}`,
  ].join("\n");
  try {
    const r = await getClient().chat.completions.create({
      model: model(),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: OPP_SYSTEM },
        { role: "user", content: user },
      ],
    });
    const text = r.choices[0]?.message?.content ?? "";
    return normalizeAnalysis(JSON.parse(text));
  } catch (e) {
    console.error("[analyzer] opp analysis failed:", e);
    return null;
  }
}

export async function analyzeOwn(opts: {
  topic: string;
  stance: string;
  chunk: string;
  ownHistory: string;
}): Promise<ContradictionResult | null> {
  const { topic, stance, chunk, ownHistory } = opts;
  const user = [
    `【辩题】${trunc(topic, 200)}`,
    `【我方立场】${trunc(stance, 300)}`,
    `【我方此前陈述】\n${trunc(ownHistory, 3000)}`,
    `【我方最新发言】\n${chunk}`,
  ].join("\n");
  try {
    const r = await getClient().chat.completions.create({
      model: model(),
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: OWN_SYSTEM },
        { role: "user", content: user },
      ],
    });
    const text = r.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text);
    return {
      consistent: !!parsed.consistent,
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    };
  } catch (e) {
    console.error("[analyzer] own analysis failed:", e);
    return null;
  }
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

function normalizeAnalysis(raw: any): AnalysisResult {
  return {
    summary: String(raw?.summary ?? ""),
    main_claim: String(raw?.main_claim ?? ""),
    arguments: arr(raw?.arguments),
    assumptions: arr(raw?.assumptions),
    fallacies: Array.isArray(raw?.fallacies)
      ? raw.fallacies.map((f: any) => ({ type: String(f?.type ?? "其他"), detail: String(f?.detail ?? "") }))
      : [],
    attack_on_us: arr(raw?.attack_on_us),
    defense_points: arr(raw?.defense_points),
    rebuttals: arr(raw?.rebuttals),
    questions: arr(raw?.questions),
    quotes: arr(raw?.quotes),
    evidence_refs: arr(raw?.evidence_refs),
  };
}
