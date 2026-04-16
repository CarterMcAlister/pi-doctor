import { EDIT_TOOL_NAMES, READ_TOOL_NAMES } from "../constants";
import { extractToolUses, parseTranscriptFile } from "../parser";
import type { SignalResult } from "../types";

export const detectToolInefficiency = async (filePath: string, sessionId: string): Promise<SignalResult[]> => {
  const toolUses = extractToolUses(await parseTranscriptFile(filePath));
  let readCount = 0;
  let editCount = 0;

  for (const toolUse of toolUses) {
    const toolName = toolUse.name?.toLowerCase() ?? "";
    if (READ_TOOL_NAMES.some((candidate) => toolName.includes(candidate.toLowerCase()))) readCount++;
    if (EDIT_TOOL_NAMES.some((candidate) => toolName.includes(candidate.toLowerCase()))) editCount++;
  }

  if (editCount > 0) {
    const ratio = readCount / editCount;
    if (ratio >= 10) {
      return [
        {
          signalName: "excessive-exploration",
          severity: ratio >= 20 ? "high" : "medium",
          score: -Math.round(ratio),
          details: `Read-to-edit ratio: ${ratio.toFixed(1)}:1 (${readCount} reads, ${editCount} edits)`,
          sessionId
        }
      ];
    }

    return [];
  }

  if (readCount > 20) {
    return [
      {
        signalName: "read-only-session",
        severity: "medium",
        score: -5,
        details: `${readCount} read operations with zero edits`,
        sessionId
      }
    ];
  }

  return [];
};
