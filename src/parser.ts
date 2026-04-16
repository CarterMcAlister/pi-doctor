import fs from "node:fs";
import readline from "node:readline";
import { INTERRUPT_PATTERN, META_MESSAGE_PATTERNS } from "./constants";
import type { MessageContentBlock, TranscriptEvent, ToolUseEntry } from "./types";

export const isMessageEntry = (event: TranscriptEvent): boolean => event?.type === "message" && Boolean(event?.message);
export const getMessageRole = (event: TranscriptEvent): string | undefined => event?.message?.role;
export const isUserEvent = (event: TranscriptEvent): boolean => isMessageEntry(event) && getMessageRole(event) === "user";
export const isAssistantEvent = (event: TranscriptEvent): boolean => isMessageEntry(event) && getMessageRole(event) === "assistant";
export const isToolResultEvent = (event: TranscriptEvent): boolean => isMessageEntry(event) && getMessageRole(event) === "toolResult";

export const parseTranscriptFile = async (filePath: string): Promise<TranscriptEvent[]> => {
  const events: TranscriptEvent[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  for await (const line of lineReader) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as TranscriptEvent);
    } catch {
    }
  }

  return events;
};

export const getSessionHeader = (events: TranscriptEvent[]): TranscriptEvent | undefined =>
  events.find((event: TranscriptEvent) => event?.type === "session");

export const getTextFromContent = (content: string | MessageContentBlock[] | undefined): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block: MessageContentBlock) => {
      if (!block || typeof block !== "object") return "";
      if (block.type === "text" && typeof block.text === "string") return block.text;
      if (block.type === "thinking" && typeof block.thinking === "string") return block.thinking;
      if (typeof block.content === "string") return block.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

export const extractUserMessages = (events: TranscriptEvent[]): string[] => {
  const messages: string[] = [];

  for (const event of events) {
    if (!isUserEvent(event)) continue;
    const content = getTextFromContent(event.message?.content).trim();
    if (!content) continue;
    if (content.length > 2000) continue;
    if (META_MESSAGE_PATTERNS.some((pattern) => pattern.test(content))) continue;
    messages.push(content);
  }

  return messages;
};

export const extractToolUses = (events: TranscriptEvent[]): ToolUseEntry[] => {
  const toolUses: ToolUseEntry[] = [];

  for (const event of events) {
    if (!isAssistantEvent(event)) continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type !== "toolCall") continue;
      toolUses.push({
        id: typeof block.id === "string" ? block.id : undefined,
        name: typeof block.name === "string" ? block.name : undefined,
        input: block.arguments ?? block.input ?? {}
      });
    }
  }

  return toolUses;
};

export const extractToolErrors = (events: TranscriptEvent[]): number => {
  let errorCount = 0;

  for (const event of events) {
    if (!isToolResultEvent(event)) continue;
    if (event.message?.isError === true) {
      errorCount++;
      continue;
    }

    const text = getTextFromContent(event.message?.content);
    if (/<tool_use_error>|tool error|isError":true/i.test(text)) errorCount++;
  }

  return errorCount;
};

export const countInterrupts = (events: TranscriptEvent[]): number => {
  let count = 0;

  for (const event of events) {
    if (!isUserEvent(event)) continue;
    const content = getTextFromContent(event.message?.content);
    if (INTERRUPT_PATTERN.test(content)) count++;
  }

  return count;
};

export const getSessionTimeRange = (events: TranscriptEvent[]): { start: Date; end: Date } => {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const event of events) {
    if (!event?.timestamp) continue;
    const time = new Date(event.timestamp).getTime();
    if (Number.isNaN(time)) continue;
    if (time < earliest) earliest = time;
    if (time > latest) latest = time;
  }

  return {
    start: new Date(earliest === Number.POSITIVE_INFINITY ? 0 : earliest),
    end: new Date(latest === Number.NEGATIVE_INFINITY ? 0 : latest)
  };
};
