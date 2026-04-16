import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PI_SESSIONS_DIR } from "./constants";
import {
  countInterrupts,
  extractToolErrors,
  extractToolUses,
  extractUserMessages,
  getSessionHeader,
  getSessionTimeRange,
  isAssistantEvent,
  parseTranscriptFile
} from "./parser";
import type { ProjectMetadata, SessionMetadata } from "./types";

export const getProjectsDir = (): string => path.join(os.homedir(), PI_SESSIONS_DIR);

export const discoverProjects = (projectsDir: string): string[] => {
  if (!fs.existsSync(projectsDir)) return [];

  return fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
};

export const discoverSessions = (projectDir: string): string[] => {
  if (!fs.existsSync(projectDir)) return [];

  return fs
    .readdirSync(projectDir, { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith(".jsonl"))
    .map((dirent) => dirent.name);
};

export const buildSessionMetadata = async (filePath: string, directoryName: string): Promise<SessionMetadata> => {
  const events = await parseTranscriptFile(filePath);
  const header = getSessionHeader(events);
  const userMessages = extractUserMessages(events);
  const toolUses = extractToolUses(events);
  const toolErrorCount = extractToolErrors(events);
  const interruptCount = countInterrupts(events);
  const { start, end } = getSessionTimeRange(events);
  const assistantMessageCount = events.filter(isAssistantEvent).length;
  const fileName = path.basename(filePath);
  const sessionId = typeof header?.id === "string" ? header.id : fileName.replace(/\.jsonl$/, "");
  const projectPath = typeof header?.cwd === "string" ? header.cwd : directoryName;

  return {
    sessionId,
    projectPath,
    projectName: projectPath,
    directoryName,
    fileName,
    filePath,
    startTime: start,
    endTime: end,
    userMessageCount: userMessages.length,
    assistantMessageCount,
    toolCallCount: toolUses.length,
    toolErrorCount,
    interruptCount
  };
};

export const indexAllProjects = async (projectFilter?: string): Promise<ProjectMetadata[]> => {
  const projectsDir = getProjectsDir();
  const projectDirs = discoverProjects(projectsDir);
  const projects: ProjectMetadata[] = [];

  for (const directoryName of projectDirs) {
    const projectDir = path.join(projectsDir, directoryName);
    const sessionFiles = discoverSessions(projectDir);
    if (sessionFiles.length === 0) continue;

    const sessions: SessionMetadata[] = [];
    for (const sessionFile of sessionFiles) {
      const filePath = path.join(projectDir, sessionFile);
      try {
        sessions.push(await buildSessionMetadata(filePath, directoryName));
      } catch {
      }
    }

    if (sessions.length === 0) continue;
    sessions.sort((left, right) => left.startTime.getTime() - right.startTime.getTime());

    const projectPath = sessions[0]?.projectPath ?? directoryName;
    if (projectFilter && !projectPath.includes(projectFilter) && !directoryName.includes(projectFilter)) continue;

    projects.push({
      projectPath,
      projectName: projectPath,
      directoryName,
      sessions,
      totalSessions: sessions.length
    });
  }

  projects.sort((left, right) => right.totalSessions - left.totalSessions);
  return projects;
};

export const findLatestSession = async (projectFilter?: string): Promise<{ filePath: string; sessionId: string } | undefined> => {
  const projects = await indexAllProjects(projectFilter);
  let latest: SessionMetadata | undefined;

  for (const project of projects) {
    for (const session of project.sessions) {
      if (!latest || session.endTime.getTime() > latest.endTime.getTime()) latest = session;
    }
  }

  if (!latest) return undefined;

  return {
    filePath: latest.filePath,
    sessionId: latest.sessionId
  };
};

export const resolveSessionFile = async (
  sessionArg: string,
  projectFilter?: string
): Promise<{ filePath: string; sessionId: string } | undefined> => {
  if (sessionArg.includes("/") || sessionArg.endsWith(".jsonl")) {
    const filePath = path.resolve(sessionArg);
    if (!fs.existsSync(filePath)) return undefined;
    const metadata = await buildSessionMetadata(filePath, path.basename(path.dirname(filePath)));
    return {
      filePath,
      sessionId: metadata.sessionId
    };
  }

  const projects = await indexAllProjects(projectFilter);
  const matches: SessionMetadata[] = [];

  for (const project of projects) {
    for (const session of project.sessions) {
      const basename = session.fileName.replace(/\.jsonl$/, "");
      if (
        session.sessionId === sessionArg ||
        basename === sessionArg ||
        basename.endsWith(`_${sessionArg}`) ||
        session.sessionId.startsWith(sessionArg) ||
        basename.startsWith(sessionArg)
      ) {
        matches.push(session);
      }
    }
  }

  matches.sort((left, right) => right.endTime.getTime() - left.endTime.getTime());
  const match = matches[0];
  if (!match) return undefined;

  return {
    filePath: match.filePath,
    sessionId: match.sessionId
  };
};
