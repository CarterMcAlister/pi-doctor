import { detectAbandonment } from "./signals/abandonment";
import { detectBehavioralSignals } from "./signals/behavioral";
import { detectErrorLoops } from "./signals/error-loops";
import { analyzeSessionSentiment, sentimentToSignals } from "./signals/sentiment";
import { detectThrashing } from "./signals/thrashing";
import { detectToolInefficiency } from "./signals/tool-efficiency";
import { generateSuggestions } from "./suggestions";
import { indexAllProjects } from "./indexer";
import type { AnalysisReport, ProgressCallback, ProjectAnalysis, ProjectMetadata } from "./types";

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

export const analyzeProject = async (project: ProjectMetadata): Promise<ProjectAnalysis> => {
  const signals = [];
  signals.push(...detectAbandonment(project.sessions));

  for (const session of project.sessions) {
    const sentiment = await analyzeSessionSentiment(session.filePath, session.sessionId);
    signals.push(...sentimentToSignals(sentiment));
    signals.push(...(await detectThrashing(session.filePath, session.sessionId)));
    signals.push(...(await detectErrorLoops(session.filePath, session.sessionId)));
    signals.push(...(await detectToolInefficiency(session.filePath, session.sessionId)));
    signals.push(...(await detectBehavioralSignals(session.filePath, session.sessionId)));
  }

  signals.sort((left, right) => left.score - right.score);
  const overallScore =
    signals.length > 0
      ? signals.reduce((sum, signal) => sum + signal.score * (SEVERITY_WEIGHTS[signal.severity] ?? 1), 0) / project.totalSessions
      : 0;

  return {
    projectName: project.projectPath,
    projectPath: project.projectPath,
    sessionCount: project.totalSessions,
    signals,
    overallScore
  };
};

export const generateReport = async (projectFilter?: string, onProgress?: ProgressCallback): Promise<AnalysisReport> => {
  const projects = await indexAllProjects(projectFilter);
  const projectAnalyses: ProjectAnalysis[] = [];

  for (let projectIndex = 0; projectIndex < projects.length; projectIndex++) {
    const project = projects[projectIndex];
    onProgress?.(projectIndex + 1, projects.length, project.projectPath);
    projectAnalyses.push(await analyzeProject(project));
  }

  projectAnalyses.sort((left, right) => left.overallScore - right.overallScore);
  const topSignals = projectAnalyses
    .flatMap((projectAnalysis) => projectAnalysis.signals)
    .sort((left, right) => left.score - right.score)
    .slice(0, 20);
  const suggestions = generateSuggestions(projectAnalyses);

  return {
    generatedAt: new Date(),
    totalSessions: projects.reduce((sum: number, project: ProjectMetadata) => sum + project.totalSessions, 0),
    totalProjects: projects.length,
    projects: projectAnalyses,
    topSignals,
    suggestions
  };
};

export const formatReportMarkdown = (report: AnalysisReport): string => {
  const lines: string[] = [];
  lines.push("# Pi Doctor Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt.toISOString()}  `);
  lines.push(`Projects: ${report.totalProjects} | Sessions: ${report.totalSessions}`);
  lines.push("");
  lines.push("## Top Signals");
  lines.push("");

  if (report.topSignals.length === 0) {
    lines.push("No significant signals detected.");
  } else {
    for (const signal of report.topSignals.slice(0, 15)) {
      lines.push(`- [${signal.severity.toUpperCase()}] ${signal.signalName}: ${signal.details}`);
      if (signal.examples?.length) {
        for (const example of signal.examples.slice(0, 3)) {
          const truncated = example.length > 120 ? `${example.slice(0, 120)}...` : example;
          lines.push(`  - \`${truncated}\``);
        }
      }
    }
  }

  lines.push("");
  lines.push("## Projects (worst first)");
  lines.push("");

  for (const project of report.projects.slice(0, 10)) {
    lines.push(`### ${project.projectName} (${project.sessionCount} sessions, score: ${project.overallScore.toFixed(1)})`);
    lines.push("");
    if (project.signals.length === 0) {
      lines.push("No significant signals.");
    } else {
      const byType = new Map<string, typeof project.signals>();
      for (const signal of project.signals) {
        const existing = byType.get(signal.signalName) ?? [];
        existing.push(signal);
        byType.set(signal.signalName, existing);
      }
      for (const [signalName, signalList] of byType) {
        const worstScore = Math.min(...signalList.map((signal) => signal.score));
        lines.push(`- ${signalName} x${signalList.length} (worst: ${worstScore})`);
      }
    }
    lines.push("");
  }

  if (report.suggestions.length > 0) {
    lines.push("## Suggested AGENTS.md Rules");
    lines.push("");
    for (const suggestion of report.suggestions) lines.push(`- ${suggestion}`);
    lines.push("");
  }

  return lines.join("\n");
};

export const formatReportJson = (report: AnalysisReport): string => JSON.stringify(report, null, 2);
