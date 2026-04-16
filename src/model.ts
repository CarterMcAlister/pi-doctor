import fs from "node:fs";
import path from "node:path";
import { GUIDANCE_FILE, MODEL_DIR, MODEL_FILE } from "./constants";
import { findLatestSession } from "./indexer";
import { detectBehavioralSignals } from "./signals/behavioral";
import { detectErrorLoops } from "./signals/error-loops";
import { analyzeSessionSentiment, sentimentToSignals } from "./signals/sentiment";
import { detectThrashing } from "./signals/thrashing";
import { detectToolInefficiency } from "./signals/tool-efficiency";
import type { AnalysisReport, CheckResult, SavedModel, SavedModelProject, SignalResult } from "./types";

const getModelDir = (projectRoot?: string): string => path.join(projectRoot ?? process.cwd(), MODEL_DIR);

export const saveModel = (report: AnalysisReport, projectRoot?: string): string => {
  const modelDir = getModelDir(projectRoot);
  fs.mkdirSync(modelDir, { recursive: true });

  const signalBaselines: Record<string, number> = {};
  for (const signal of report.topSignals) signalBaselines[signal.signalName] = (signalBaselines[signal.signalName] ?? 0) + 1;

  const projects: SavedModelProject[] = report.projects.map((project) => {
    const signalFrequency: Record<string, number> = {};
    for (const signal of project.signals) signalFrequency[signal.signalName] = (signalFrequency[signal.signalName] ?? 0) + 1;

    return {
      projectPath: project.projectPath,
      sessionCount: project.sessionCount,
      overallScore: project.overallScore,
      signalFrequency,
      topIssues: [...project.signals].sort((left, right) => left.score - right.score).slice(0, 5).map((signal) => signal.details),
      suggestions: []
    };
  });

  const model: SavedModel = {
    version: 1,
    savedAt: new Date().toISOString(),
    totalSessions: report.totalSessions,
    totalProjects: report.totalProjects,
    signalBaselines,
    projects,
    globalSuggestions: report.suggestions
  };

  fs.writeFileSync(path.join(modelDir, MODEL_FILE), JSON.stringify(model, null, 2));
  fs.writeFileSync(path.join(modelDir, GUIDANCE_FILE), buildGuidanceDoc(model));
  return modelDir;
};

export const loadModel = (projectRoot?: string): SavedModel | undefined => {
  const modelPath = path.join(getModelDir(projectRoot), MODEL_FILE);
  if (!fs.existsSync(modelPath)) return undefined;
  return JSON.parse(fs.readFileSync(modelPath, "utf-8")) as SavedModel;
};

const buildGuidanceDoc = (model: SavedModel): string => {
  const lines: string[] = [];
  lines.push("# Pi Doctor Session Guidance");
  lines.push("");
  lines.push(`Based on analysis of ${model.totalSessions} sessions across ${model.totalProjects} projects.`);
  lines.push(`Last updated: ${model.savedAt}`);
  lines.push("");
  lines.push("## Known Issues");
  lines.push("");
  for (const suggestion of model.globalSuggestions) lines.push(`- ${suggestion}`);
  lines.push("");
  lines.push("## Rules for This Session");
  lines.push("");
  lines.push("If you notice yourself exhibiting any of these patterns, stop and course-correct:");
  lines.push("");

  const hasSignal = (name: string): boolean => (model.signalBaselines[name] ?? 0) > 0;
  if (hasSignal("edit-thrashing")) lines.push("- Stop re-editing the same file repeatedly. Read the full file, plan your changes, then make one complete edit.");
  if (hasSignal("error-loop")) lines.push("- Stop retrying the same failing command. After 2 consecutive tool failures, change your approach entirely.");
  if (hasSignal("correction-heavy") || hasSignal("negative-sentiment")) lines.push("- Stop and re-read the user’s message when they correct you.");
  if (hasSignal("keep-going-loop")) lines.push("- Do not stop early. Complete the full task before presenting results.");
  if (hasSignal("negative-drift")) lines.push("- Re-check the original requirements every few turns.");
  if (hasSignal("rapid-corrections")) lines.push("- Double-check your output before presenting it.");
  if (hasSignal("repeated-instructions")) lines.push("- Follow through on instructions fully. Users should not need to repeat themselves.");
  if (hasSignal("excessive-exploration")) lines.push("- Act sooner. Read enough to orient yourself, then make the first useful change.");
  lines.push("");
  return lines.join("\n");
};

const buildSessionGuidance = (signals: SignalResult[], savedModel?: SavedModel): string[] => {
  const guidance: string[] = [];
  const signalNames = new Set(signals.map((signal) => signal.signalName));

  if (signalNames.has("edit-thrashing")) guidance.push("You are re-editing the same file repeatedly. Stop, re-read the file and the user request, then make one complete change.");
  if (signalNames.has("error-loop")) guidance.push("You are in an error loop. Change your approach instead of retrying the same failing tool.");
  if (signalNames.has("correction-heavy")) guidance.push("The user is frequently correcting you. Re-read their last message carefully before proceeding.");
  if (signalNames.has("keep-going-loop")) guidance.push("The user keeps asking you to continue. Finish the full task before stopping.");
  if (signalNames.has("negative-drift")) guidance.push("This session is drifting. Re-read the original request and narrow back to the goal.");
  if (signalNames.has("rapid-corrections")) guidance.push("The user is correcting you immediately. Slow down and verify your output before presenting it.");
  if (signalNames.has("repeated-instructions")) guidance.push("The user is repeating themselves. Re-read the conversation history and follow the missed instruction.");
  if (signalNames.has("negative-sentiment") || signalNames.has("extreme-frustration")) guidance.push("The user appears frustrated. Focus on getting the next step right and avoid guesswork.");
  if (signalNames.has("user-interrupts")) guidance.push("The user interrupted the current direction. Stop and confirm the real goal before continuing.");

  if (savedModel) {
    const knownBadSignals = Object.keys(savedModel.signalBaselines ?? {});
    const matchingHistorical = signals.filter((signal: SignalResult) => knownBadSignals.includes(signal.signalName));
    if (matchingHistorical.length > 0) {
      guidance.push(`This session is repeating known historical issues: ${matchingHistorical.map((signal) => signal.signalName).join(", ")}. Check .pi-doctor/guidance.md.`);
    }
  }

  return guidance;
};

export const checkSession = async (sessionFilePath: string, sessionId: string, savedModel?: SavedModel): Promise<CheckResult> => {
  const signals: SignalResult[] = [];
  signals.push(...sentimentToSignals(await analyzeSessionSentiment(sessionFilePath, sessionId)));
  signals.push(...(await detectThrashing(sessionFilePath, sessionId)));
  signals.push(...(await detectErrorLoops(sessionFilePath, sessionId)));
  signals.push(...(await detectToolInefficiency(sessionFilePath, sessionId)));
  signals.push(...(await detectBehavioralSignals(sessionFilePath, sessionId)));

  return {
    sessionId,
    isHealthy: signals.filter((signal) => signal.severity === "critical" || signal.severity === "high").length === 0,
    activeSignals: signals,
    guidance: buildSessionGuidance(signals, savedModel)
  };
};

export { findLatestSession };
