import { EDIT_TOOL_NAMES } from "../constants";
import { extractToolUses, parseTranscriptFile } from "../parser";
import type { SignalResult } from "../types";

const extractFilePath = (input: Record<string, unknown>): string | undefined => {
  for (const key of ["file_path", "path", "filePath", "target_file", "file", "filepath"] as const) {
    const value = input[key];
    if (typeof value === "string") return value;
  }

  if (Array.isArray(input.paths)) {
    const firstPath = input.paths.find((value: unknown) => typeof value === "string");
    if (typeof firstPath === "string") return firstPath;
  }

  return undefined;
};

export const detectThrashing = async (filePath: string, sessionId: string): Promise<SignalResult[]> => {
  const toolUses = extractToolUses(await parseTranscriptFile(filePath));
  const editCounts = new Map<string, { filePath: string; editCount: number; toolNames: string[] }>();

  for (const toolUse of toolUses) {
    const toolName = toolUse.name?.toLowerCase() ?? "";
    if (!EDIT_TOOL_NAMES.some((candidate) => toolName.includes(candidate.toLowerCase()))) continue;

    const targetPath = extractFilePath(toolUse.input);
    if (!targetPath) continue;

    const existing = editCounts.get(targetPath);
    if (existing) {
      existing.editCount++;
      if (toolUse.name && !existing.toolNames.includes(toolUse.name)) existing.toolNames.push(toolUse.name);
    } else {
      editCounts.set(targetPath, {
        filePath: targetPath,
        editCount: 1,
        toolNames: toolUse.name ? [toolUse.name] : []
      });
    }
  }

  const thrashingFiles = [...editCounts.values()]
    .filter((fileEditInfo) => fileEditInfo.editCount >= 5)
    .sort((left, right) => right.editCount - left.editCount);

  if (thrashingFiles.length === 0) return [];

  const worstFile = thrashingFiles[0];
  const totalThrashingEdits = thrashingFiles.reduce((sum: number, fileEditInfo) => sum + fileEditInfo.editCount, 0);

  return [
    {
      signalName: "edit-thrashing",
      severity: worstFile.editCount >= 20 ? "critical" : worstFile.editCount >= 10 ? "high" : "medium",
      score: -totalThrashingEdits,
      details: `${thrashingFiles.length} file(s) edited 5+ times. Worst: ${worstFile.filePath} (${worstFile.editCount}x)`,
      sessionId,
      examples: thrashingFiles.slice(0, 5).map((fileEditInfo) => `${fileEditInfo.filePath} (${fileEditInfo.editCount}x)`)
    }
  ];
};
