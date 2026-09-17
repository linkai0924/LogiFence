export type Speaker = "opp" | "own";

export interface RoundConfig {
  name: string;
  secs: number;
}

export interface TimerState {
  rounds: RoundConfig[];
  index: number;
  remaining: number;
  running: boolean;
}

export interface Fallacy {
  type: string;
  detail: string;
}

export interface AnalysisResult {
  summary: string;
  main_claim: string;
  arguments: string[];
  assumptions: string[];
  fallacies: Fallacy[];
  attack_on_us: string[];
  defense_points: string[];
  rebuttals: string[];
  questions: string[];
  quotes: string[];
  evidence_refs: string[];
}

export interface ContradictionResult {
  consistent: boolean;
  conflicts: { current: string; previous: string; note: string }[];
}

export interface RoomSetup {
  topic: string;
  stance: string;
  arguments_text: string;
  definitions: string;
  evidence: string;
  rounds: RoundConfig[];
}

export interface SegmentRecord {
  id: number;
  speaker: Speaker;
  text: string;
  keywords: string[];
  created_at: number;
}

export interface AnalysisRecord {
  id: number;
  kind: "opp" | "own";
  source_text: string;
  result: AnalysisResult | ContradictionResult;
  created_at: number;
}
