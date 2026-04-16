import { CORRECTION_PATTERNS, INTERRUPT_PATTERN } from "./constants";
import { getTextFromContent, isAssistantEvent, isToolResultEvent, isUserEvent, parseTranscriptFile } from "./parser";
import type { AnalysisReport, SessionTimeline, SignalResult, TurnHealth, TurnHealthColor } from "./types";

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  cyan: "\u001b[36m"
} as const;

const colorize = (text: string, color: keyof typeof ANSI): string => `${ANSI[color] ?? ""}${text}${ANSI.reset}`;
const truncate = (value: string, length = 100): string => (value.length > length ? `${value.slice(0, length)}…` : value);

const summarizeSignals = (signals: SignalResult[]): string => {
  if (signals.length === 0) return "No active issues detected.";
  const counts = new Map<string, number>();
  for (const signal of signals) counts.set(signal.signalName, (counts.get(signal.signalName) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => `${name}${count > 1 ? ` x${count}` : ""}`).join(", ");
};

export const buildSessionTimeline = async (filePath: string): Promise<SessionTimeline> => {
  const events = await parseTranscriptFile(filePath);
  const turns: TurnHealth[] = [];
  let turnIndex = 0;
  let assistantCount = 0;
  let userCount = 0;
  let toolCallCount = 0;
  let toolErrorCount = 0;

  for (const event of events) {
    if (isUserEvent(event)) {
      const content = getTextFromContent(event.message?.content).trim();
      if (!content) continue;
      userCount++;

      if (INTERRUPT_PATTERN.test(content)) {
        turns.push({ index: turnIndex++, type: "interrupt", health: "red", reason: "user interrupted" });
      } else if (CORRECTION_PATTERNS.some((pattern) => pattern.test(content))) {
        turns.push({ index: turnIndex++, type: "correction", health: "yellow", reason: "user correction", snippet: truncate(content, 60) });
      } else {
        turns.push({ index: turnIndex++, type: "user", health: "neutral", reason: "user prompt", snippet: truncate(content, 60) });
      }
      continue;
    }

    if (isAssistantEvent(event)) {
      assistantCount++;
      const content = Array.isArray(event.message?.content) ? event.message.content : [];
      const text = content
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n")
        .trim();
      const toolCalls = content.filter((block) => block?.type === "toolCall").length;
      toolCallCount += toolCalls;
      turns.push({
        index: turnIndex++,
        type: "assistant",
        health: toolCalls > 0 ? "green" : "neutral",
        reason: toolCalls > 0 ? `${toolCalls} tool call(s)` : "assistant response",
        snippet: text ? truncate(text, 60) : undefined
      });
      continue;
    }

    if (isToolResultEvent(event) && event.message?.isError === true) {
      toolErrorCount++;
      const text = getTextFromContent(event.message?.content).trim();
      turns.push({
        index: turnIndex++,
        type: "tool-error",
        health: "red",
        reason: typeof event.message?.toolName === "string" ? `${event.message.toolName} failed` : "tool failure",
        snippet: text ? truncate(text, 60) : undefined
      });
    }
  }

  const weights: Record<TurnHealthColor, number> = { green: 1, neutral: 0.75, yellow: 0.4, red: 0 };
  const healthPercentage =
    turns.length === 0 ? 100 : Math.round((turns.reduce((sum: number, turn: TurnHealth) => sum + weights[turn.health], 0) / turns.length) * 100);

  return {
    turns,
    healthPercentage,
    summary: `${assistantCount} assistant turns, ${userCount} user turns, ${toolCallCount} tool calls, ${toolErrorCount} tool errors`
  };
};

export const renderTimeline = (turns: TurnHealth[], maxWidth = 60): string => {
  if (turns.length === 0) return "";

  const sampledTurns =
    turns.length <= maxWidth
      ? turns
      : Array.from({ length: maxWidth }, (_, index) => turns[Math.floor((index / maxWidth) * turns.length)]);

  return sampledTurns
    .map((turn: TurnHealth) => {
      if (turn.health === "green") return colorize("█", "green");
      if (turn.health === "yellow") return colorize("█", "yellow");
      if (turn.health === "red") return colorize("█", "red");
      return `${ANSI.dim}•${ANSI.reset}`;
    })
    .join("");
};

export const renderHealthBar = (percentage: number): string => {
  const filled = Math.max(0, Math.min(30, Math.round((percentage / 100) * 30)));
  const empty = 30 - filled;
  const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
  if (percentage >= 80) return colorize(bar, "green");
  if (percentage >= 60) return colorize(bar, "yellow");
  return colorize(bar, "red");
};

export const renderCheckOutput = (
  sessionId: string,
  turns: TurnHealth[],
  healthPercentage: number,
  summary: string,
  activeSignals: SignalResult[],
  guidance: string[]
): string => {
  const lines: string[] = [];
  lines.push(`${ANSI.bold}Pi Doctor: Session Check${ANSI.reset}`);
  lines.push(`Session: ${colorize(sessionId, "cyan")}`);
  lines.push(`Health: ${renderHealthBar(healthPercentage)} ${healthPercentage}%`);
  lines.push(`Timeline: ${renderTimeline(turns)}`);
  lines.push(`Summary: ${summary}`);
  lines.push("");

  if (activeSignals.length === 0) {
    lines.push(colorize("No active signals detected.", "green"));
  } else {
    lines.push(`${ANSI.bold}Signals${ANSI.reset}`);
    for (const signal of [...activeSignals].sort((left, right) => left.score - right.score)) {
      const color: keyof typeof ANSI = signal.severity === "critical" || signal.severity === "high" ? "red" : signal.severity === "medium" ? "yellow" : "green";
      lines.push(`- ${colorize(signal.signalName, color)}: ${signal.details}`);
      for (const example of signal.examples ?? []) lines.push(`  · ${truncate(example, 120)}`);
    }
  }

  lines.push("");
  if (guidance.length > 0) {
    lines.push(`${ANSI.bold}Guidance${ANSI.reset}`);
    for (const item of guidance) lines.push(`- ${item}`);
  } else {
    lines.push(`${ANSI.bold}Guidance${ANSI.reset}`);
    lines.push(`- ${summarizeSignals(activeSignals)}`);
  }

  return lines.join("\n");
};

export const renderAnalyzeOutput = async (report: AnalysisReport): Promise<string> => {
  const lines: string[] = [];
  lines.push(`${ANSI.bold}Pi Doctor Report${ANSI.reset}`);
  lines.push(`Generated: ${report.generatedAt.toISOString()}`);
  lines.push(`Projects: ${report.totalProjects} | Sessions: ${report.totalSessions}`);
  lines.push("");

  lines.push(`${ANSI.bold}Top Signals${ANSI.reset}`);
  if (report.topSignals.length === 0) {
    lines.push(colorize("No significant signals detected.", "green"));
  } else {
    for (const signal of report.topSignals.slice(0, 10)) {
      lines.push(`- ${signal.signalName} (${signal.severity}): ${signal.details}`);
    }
  }

  lines.push("");
  lines.push(`${ANSI.bold}Projects${ANSI.reset}`);
  for (const project of report.projects.slice(0, 10)) {
    lines.push(`- ${project.projectName} — ${project.sessionCount} sessions, score ${project.overallScore.toFixed(1)}`);
  }

  lines.push("");
  lines.push(`${ANSI.bold}Suggested Rules${ANSI.reset}`);
  if (report.suggestions.length === 0) {
    lines.push(colorize("No additional rules suggested.", "green"));
  } else {
    for (const suggestion of report.suggestions) lines.push(`- ${suggestion}`);
  }

  return lines.join("\n");
};
