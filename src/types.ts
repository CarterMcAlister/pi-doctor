export type Severity = "critical" | "high" | "medium" | "low";
export type TurnHealthColor = "green" | "yellow" | "red" | "neutral";

export interface MessageContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  input?: Record<string, unknown>;
  content?: string;
  [key: string]: unknown;
}

export interface PiMessage {
  role: string;
  content?: string | MessageContentBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
  [key: string]: unknown;
}

export interface TranscriptEvent {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  cwd?: string;
  version?: number;
  message?: PiMessage;
  [key: string]: unknown;
}

export interface ToolUseEntry {
  id?: string;
  name?: string;
  input: Record<string, unknown>;
}

export interface SignalResult {
  signalName: string;
  severity: Severity;
  score: number;
  details: string;
  sessionId?: string;
  examples?: string[];
}

export interface SessionMetadata {
  sessionId: string;
  projectPath: string;
  projectName: string;
  directoryName: string;
  fileName: string;
  filePath: string;
  startTime: Date;
  endTime: Date;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  interruptCount: number;
}

export interface ProjectMetadata {
  projectPath: string;
  projectName: string;
  directoryName: string;
  sessions: SessionMetadata[];
  totalSessions: number;
}

export interface ProjectAnalysis {
  projectName: string;
  projectPath: string;
  sessionCount: number;
  signals: SignalResult[];
  overallScore: number;
}

export interface AnalysisReport {
  generatedAt: Date;
  totalSessions: number;
  totalProjects: number;
  projects: ProjectAnalysis[];
  topSignals: SignalResult[];
  suggestions: string[];
}

export interface SessionSentimentScore {
  score: number;
  comparative: number;
  positive: string[];
  negative: string[];
  message: string;
}

export interface SessionSentiment {
  sessionId: string;
  averageScore: number;
  worstScore: number;
  messageScores: SessionSentimentScore[];
  interruptCount: number;
  frustrationMessages: string[];
}

export interface SavedModelProject {
  projectPath: string;
  sessionCount: number;
  overallScore: number;
  signalFrequency: Record<string, number>;
  topIssues: string[];
  suggestions: string[];
}

export interface SavedModel {
  version: number;
  savedAt: string;
  totalSessions: number;
  totalProjects: number;
  signalBaselines: Record<string, number>;
  projects: SavedModelProject[];
  globalSuggestions: string[];
}

export interface CheckResult {
  sessionId: string;
  isHealthy: boolean;
  activeSignals: SignalResult[];
  guidance: string[];
}

export interface ConversationTurn {
  type: "user" | "assistant";
  timestamp: number;
  contentLength: number;
  isInterrupt: boolean;
  content: string;
}

export interface UserTurn {
  content: string;
  timestamp: number;
  index: number;
}

export interface TurnHealth {
  index: number;
  type: string;
  health: TurnHealthColor;
  reason: string;
  snippet?: string;
}

export interface SessionTimeline {
  turns: TurnHealth[];
  healthPercentage: number;
  summary: string;
}

export interface ProgressCallback {
  (current: number, total: number, projectName: string): void;
}
