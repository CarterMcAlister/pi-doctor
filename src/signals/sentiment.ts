import Sentiment from "sentiment";
import { SENTINEL_CUSTOM_TOKENS } from "../constants";
import { countInterrupts, extractUserMessages, parseTranscriptFile } from "../parser";
import type { SessionSentiment, SessionSentimentScore, SignalResult } from "../types";

const analyzer = new Sentiment();
const customScoring: Record<string, number> = {};

for (const [phrase, score] of Object.entries(SENTINEL_CUSTOM_TOKENS)) {
  for (const word of phrase.split(" ")) {
    if (customScoring[word] === undefined || score < customScoring[word]) customScoring[word] = score;
  }
}

const scoreMessage = (message: string): SessionSentimentScore => {
  const result = analyzer.analyze(message, { extras: customScoring });
  return {
    score: result.score,
    comparative: result.comparative,
    positive: result.positive,
    negative: result.negative,
    message
  };
};

export const analyzeSessionSentiment = async (filePath: string, sessionId: string): Promise<SessionSentiment> => {
  const events = await parseTranscriptFile(filePath);
  const messageScores = extractUserMessages(events).map(scoreMessage);
  const scores = messageScores.map((entry: SessionSentimentScore) => entry.score);

  return {
    sessionId,
    averageScore: scores.length > 0 ? scores.reduce((sum: number, score: number) => sum + score, 0) / scores.length : 0,
    worstScore: scores.length > 0 ? Math.min(...scores) : 0,
    messageScores,
    interruptCount: countInterrupts(events),
    frustrationMessages: messageScores.filter((entry: SessionSentimentScore) => entry.score < -2).map((entry: SessionSentimentScore) => entry.message)
  };
};

export const sentimentToSignals = (sessionSentiment: SessionSentiment): SignalResult[] => {
  const signals: SignalResult[] = [];

  if (sessionSentiment.averageScore < -1) {
    signals.push({
      signalName: "negative-sentiment",
      severity: sessionSentiment.averageScore < -3 ? "critical" : sessionSentiment.averageScore < -2 ? "high" : "medium",
      score: sessionSentiment.averageScore,
      details: `Average sentiment score: ${sessionSentiment.averageScore.toFixed(2)} across ${sessionSentiment.messageScores.length} messages`,
      sessionId: sessionSentiment.sessionId,
      examples: sessionSentiment.frustrationMessages.slice(0, 5)
    });
  }

  if (sessionSentiment.interruptCount > 0) {
    signals.push({
      signalName: "user-interrupts",
      severity: sessionSentiment.interruptCount >= 3 ? "critical" : "high",
      score: -sessionSentiment.interruptCount * 2,
      details: `User interrupted the agent ${sessionSentiment.interruptCount} time(s)`,
      sessionId: sessionSentiment.sessionId
    });
  }

  if (sessionSentiment.worstScore < -5) {
    signals.push({
      signalName: "extreme-frustration",
      severity: "critical",
      score: sessionSentiment.worstScore,
      details: `Worst single message score: ${sessionSentiment.worstScore}`,
      sessionId: sessionSentiment.sessionId,
      examples: sessionSentiment.frustrationMessages.slice(0, 3)
    });
  }

  return signals;
};
