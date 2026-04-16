import type { SessionMetadata, SignalResult } from "../types";

export const detectAbandonment = (sessions: SessionMetadata[]): SignalResult[] => {
  const signals: SignalResult[] = [];
  const sorted = [...sessions].sort((left, right) => left.startTime.getTime() - right.startTime.getTime());
  const clusters: { sessionIds: string[]; windowMs: number; startTime: Date }[] = [];
  let currentCluster: { sessionIds: string[]; windowMs: number; startTime: Date } | undefined;

  for (let sessionIndex = 0; sessionIndex < sorted.length; sessionIndex++) {
    const session = sorted[sessionIndex];
    const previousSession = sessionIndex > 0 ? sorted[sessionIndex - 1] : undefined;

    if (!previousSession) {
      currentCluster = {
        sessionIds: [session.sessionId],
        windowMs: 0,
        startTime: session.startTime
      };
      continue;
    }

    if (session.startTime.getTime() - previousSession.startTime.getTime() <= 30 * 60 * 1000) {
      if (currentCluster) {
        currentCluster.sessionIds.push(session.sessionId);
        currentCluster.windowMs = session.startTime.getTime() - currentCluster.startTime.getTime();
      }
    } else {
      if (currentCluster && currentCluster.sessionIds.length > 1) clusters.push(currentCluster);
      currentCluster = {
        sessionIds: [session.sessionId],
        windowMs: 0,
        startTime: session.startTime
      };
    }
  }

  if (currentCluster && currentCluster.sessionIds.length > 1) clusters.push(currentCluster);

  for (const cluster of clusters) {
    const windowMinutes = Math.round(cluster.windowMs / 60000);
    signals.push({
      signalName: "restart-cluster",
      severity: cluster.sessionIds.length >= 5 ? "critical" : "high",
      score: -cluster.sessionIds.length,
      details: `${cluster.sessionIds.length} sessions started within ${windowMinutes} minutes`,
      examples: cluster.sessionIds.slice(0, 5)
    });
  }

  const shortSessions = sorted.filter((session: SessionMetadata) => session.userMessageCount < 3);
  const shortSessionRatio = sorted.length > 0 ? shortSessions.length / sorted.length : 0;

  if (shortSessionRatio > 0.3 && shortSessions.length >= 3) {
    signals.push({
      signalName: "high-abandonment-rate",
      severity: shortSessionRatio > 0.5 ? "critical" : "high",
      score: -Math.round(shortSessionRatio * 10),
      details: `${shortSessions.length}/${sorted.length} sessions (${Math.round(shortSessionRatio * 100)}%) had fewer than 3 user messages`,
      examples: shortSessions.slice(0, 5).map((session: SessionMetadata) => session.sessionId)
    });
  }

  return signals;
};
