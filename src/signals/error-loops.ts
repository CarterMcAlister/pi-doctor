import { getTextFromContent, isAssistantEvent, isToolResultEvent, parseTranscriptFile } from "../parser";
import type { SignalResult, TranscriptEvent } from "../types";

interface ToolResultEntry {
  toolName: string;
  isError: boolean;
  text: string;
}

const collectToolResults = async (filePath: string): Promise<ToolResultEntry[]> => {
  const events = await parseTranscriptFile(filePath);
  const toolNamesByCallId = new Map<string, string>();
  const results: ToolResultEntry[] = [];

  for (const event of events) {
    if (isAssistantEvent(event)) {
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === "toolCall" && typeof block.id === "string") toolNamesByCallId.set(block.id, typeof block.name === "string" ? block.name : "unknown");
      }
      continue;
    }

    if (!isToolResultEvent(event) || !event.message) continue;
    const message = event.message;
    const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    const text = getTextFromContent(message.content);
    results.push({
      toolName: typeof message.toolName === "string" ? message.toolName : toolCallId ? toolNamesByCallId.get(toolCallId) ?? "unknown" : "unknown",
      isError: message.isError === true || /<tool_use_error>|error:/i.test(text),
      text
    });
  }

  return results;
};

export const detectErrorLoops = async (filePath: string, sessionId: string): Promise<SignalResult[]> => {
  const results = await collectToolResults(filePath);
  const signals: SignalResult[] = [];
  let currentFailures: ToolResultEntry[] = [];

  const flush = (): void => {
    if (currentFailures.length < 3) {
      currentFailures = [];
      return;
    }

    const toolNames = [...new Set(currentFailures.map((failure: ToolResultEntry) => failure.toolName))];
    signals.push({
      signalName: "error-loop",
      severity: currentFailures.length >= 5 ? "critical" : "high",
      score: -currentFailures.length,
      details: `${currentFailures.length} consecutive tool failures on ${toolNames.join(", ")}`,
      sessionId,
      examples: currentFailures.map((failure: ToolResultEntry) => failure.text.slice(0, 200) || "unknown error").slice(0, 3)
    });

    currentFailures = [];
  };

  for (const result of results) {
    if (result.isError) currentFailures.push(result);
    else flush();
  }

  flush();
  return signals;
};
