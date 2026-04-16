import { CORRECTION_PATTERNS, INTERRUPT_PATTERN, KEEP_GOING_PATTERNS, META_MESSAGE_PATTERNS } from "../constants";
import { getTextFromContent, isAssistantEvent, isUserEvent, parseTranscriptFile } from "../parser";
import type { ConversationTurn, SignalResult, TranscriptEvent, UserTurn } from "../types";

const isMetaContent = (content: string): boolean => META_MESSAGE_PATTERNS.some((pattern) => pattern.test(content));

const extractConversationTurns = (events: TranscriptEvent[]): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];

  for (const event of events) {
    if (!event?.timestamp) continue;
    const timestamp = new Date(event.timestamp).getTime();
    if (Number.isNaN(timestamp)) continue;

    if (isUserEvent(event)) {
      const content = getTextFromContent(event.message?.content).trim();
      if (!content) continue;
      const isInterrupt = INTERRUPT_PATTERN.test(content);
      turns.push({
        type: "user",
        timestamp,
        contentLength: content.length,
        isInterrupt,
        content
      });
      continue;
    }

    if (isAssistantEvent(event)) {
      const content = Array.isArray(event.message?.content) ? event.message.content : [];
      const totalLength = content.reduce((sum: number, block) => {
        if (block?.type === "text" && typeof block.text === "string") return sum + block.text.length;
        return sum;
      }, 0);

      turns.push({
        type: "assistant",
        timestamp,
        contentLength: totalLength,
        isInterrupt: false,
        content: ""
      });
    }
  }

  return turns.sort((left, right) => left.timestamp - right.timestamp);
};

const extractUserTurns = (turns: ConversationTurn[]): UserTurn[] =>
  turns
    .filter(
      (turn: ConversationTurn) =>
        turn.type === "user" &&
        !turn.isInterrupt &&
        turn.content.length > 0 &&
        turn.content.length < 2000 &&
        !isMetaContent(turn.content)
    )
    .map((turn: ConversationTurn, index: number) => ({
      content: turn.content,
      timestamp: turn.timestamp,
      index
    }));

const wordSet = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(Boolean)
  );

const jaccardSimilarity = (textA: string, textB: string): number => {
  const setA = wordSet(textA);
  const setB = wordSet(textB);
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const word of setA) {
    if (setB.has(word)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
};

const detectCorrectionPatterns = (userTurns: UserTurn[]): number =>
  userTurns.filter((turn: UserTurn) => CORRECTION_PATTERNS.some((pattern) => pattern.test(turn.content))).length;

const detectKeepGoingLoops = (userTurns: UserTurn[]): number =>
  userTurns.filter((turn: UserTurn) => KEEP_GOING_PATTERNS.some((pattern) => pattern.test(turn.content.trim()))).length;

const detectRepetition = (userTurns: UserTurn[]): { messageA: string; messageB: string; similarity: number }[] => {
  const repeats: { messageA: string; messageB: string; similarity: number }[] = [];

  for (let outerIndex = 0; outerIndex < userTurns.length; outerIndex++) {
    for (let innerIndex = outerIndex + 1; innerIndex < Math.min(outerIndex + 5, userTurns.length); innerIndex++) {
      const similarity = jaccardSimilarity(userTurns[outerIndex].content, userTurns[innerIndex].content);
      if (similarity >= 0.6) {
        repeats.push({
          messageA: userTurns[outerIndex].content,
          messageB: userTurns[innerIndex].content,
          similarity
        });
      }
    }
  }

  return repeats;
};

const detectSentimentDrift = (userTurns: UserTurn[]): { driftScore: number; isNegativeDrift: boolean } => {
  if (userTurns.length < 4) return { driftScore: 0, isNegativeDrift: false };

  const midpoint = Math.floor(userTurns.length / 2);
  const firstHalf = userTurns.slice(0, midpoint);
  const secondHalf = userTurns.slice(midpoint);
  const avgLength = (turns: UserTurn[]): number => turns.reduce((sum: number, turn: UserTurn) => sum + turn.content.length, 0) / turns.length;
  const correctionRate = (turns: UserTurn[]): number =>
    turns.filter((turn: UserTurn) => CORRECTION_PATTERNS.some((pattern) => pattern.test(turn.content))).length / turns.length;

  const firstHalfAvgLength = avgLength(firstHalf);
  const secondHalfAvgLength = avgLength(secondHalf);
  const firstCorrectionRate = correctionRate(firstHalf);
  const secondCorrectionRate = correctionRate(secondHalf);
  const lengthShrinkage = firstHalfAvgLength > 0 ? (firstHalfAvgLength - secondHalfAvgLength) / firstHalfAvgLength : 0;
  const correctionIncrease = secondCorrectionRate - firstCorrectionRate;
  const driftScore = lengthShrinkage * 5 + correctionIncrease * 10;

  return {
    driftScore,
    isNegativeDrift: driftScore > 2
  };
};

const detectFollowUpVelocity = (turns: ConversationTurn[]): { fastFollowUps: number; averageResponseMs: number } => {
  let fastFollowUps = 0;
  let totalResponseMs = 0;
  let responseCount = 0;

  for (let turnIndex = 1; turnIndex < turns.length; turnIndex++) {
    const currentTurn = turns[turnIndex];
    const previousTurn = turns[turnIndex - 1];
    if (currentTurn.type !== "user" || previousTurn.type !== "assistant") continue;
    if (!currentTurn.content || isMetaContent(currentTurn.content)) continue;

    const responseTimeMs = currentTurn.timestamp - previousTurn.timestamp;
    if (responseTimeMs < 10000 && responseTimeMs > 0) fastFollowUps++;
    if (responseTimeMs > 0 && responseTimeMs < 3600000) {
      totalResponseMs += responseTimeMs;
      responseCount++;
    }
  }

  return {
    fastFollowUps,
    averageResponseMs: responseCount > 0 ? totalResponseMs / responseCount : 0
  };
};

export const detectBehavioralSignals = async (filePath: string, sessionId: string): Promise<SignalResult[]> => {
  const turns = extractConversationTurns(await parseTranscriptFile(filePath));
  const userTurns = extractUserTurns(turns);
  const signals: SignalResult[] = [];

  if (userTurns.length === 0) return signals;

  const correctionCount = detectCorrectionPatterns(userTurns);
  const correctionRate = correctionCount / userTurns.length;
  if (correctionCount >= 2 && correctionRate > 0.2) {
    signals.push({
      signalName: "correction-heavy",
      severity: correctionRate > 0.4 ? "critical" : "high",
      score: -Math.round(correctionCount * 3),
      details: `${correctionCount}/${userTurns.length} user messages (${Math.round(correctionRate * 100)}%) were corrections`,
      sessionId,
      examples: userTurns
        .filter((turn: UserTurn) => CORRECTION_PATTERNS.some((pattern) => pattern.test(turn.content)))
        .slice(0, 5)
        .map((turn: UserTurn) => turn.content.slice(0, 80))
    });
  }

  const keepGoingCount = detectKeepGoingLoops(userTurns);
  if (keepGoingCount >= 2) {
    signals.push({
      signalName: "keep-going-loop",
      severity: keepGoingCount >= 4 ? "high" : "medium",
      score: -keepGoingCount * 2,
      details: `User said keep going or equivalent ${keepGoingCount} time(s)`,
      sessionId,
      examples: userTurns
        .filter((turn: UserTurn) => KEEP_GOING_PATTERNS.some((pattern) => pattern.test(turn.content.trim())))
        .slice(0, 3)
        .map((turn: UserTurn) => turn.content.slice(0, 80))
    });
  }

  const repetitions = detectRepetition(userTurns);
  if (repetitions.length >= 2) {
    signals.push({
      signalName: "repeated-instructions",
      severity: repetitions.length >= 4 ? "critical" : "high",
      score: -repetitions.length * 3,
      details: `User repeated similar instructions ${repetitions.length} time(s)`,
      sessionId,
      examples: repetitions
        .slice(0, 3)
        .map((repetition) => `\"${repetition.messageA.slice(0, 60)}\" ~ \"${repetition.messageB.slice(0, 60)}\" (${Math.round(repetition.similarity * 100)}%)`)
    });
  }

  const { driftScore, isNegativeDrift } = detectSentimentDrift(userTurns);
  if (isNegativeDrift) {
    signals.push({
      signalName: "negative-drift",
      severity: driftScore > 5 ? "high" : "medium",
      score: -Math.round(driftScore * 2),
      details: `User messages became shorter and more corrective over the session (drift: ${driftScore.toFixed(1)})`,
      sessionId
    });
  }

  const { fastFollowUps } = detectFollowUpVelocity(turns);
  if (fastFollowUps >= 3) {
    signals.push({
      signalName: "rapid-corrections",
      severity: fastFollowUps >= 5 ? "high" : "medium",
      score: -fastFollowUps * 2,
      details: `${fastFollowUps} user messages arrived within 10 seconds of assistant output`,
      sessionId
    });
  }

  const userTurnCount = turns.filter((turn: ConversationTurn) => turn.type === "user").length;
  const assistantTurnCount = turns.filter((turn: ConversationTurn) => turn.type === "assistant").length;
  if (assistantTurnCount > 0 && userTurnCount > 0) {
    const turnRatio = userTurnCount / assistantTurnCount;
    if (turnRatio > 1.5 && userTurnCount >= 5) {
      signals.push({
        signalName: "high-turn-ratio",
        severity: turnRatio > 2.5 ? "high" : "medium",
        score: -Math.round(turnRatio * 2),
        details: `Turn ratio: ${turnRatio.toFixed(1)} user messages per assistant response`,
        sessionId
      });
    }
  }

  return signals;
};
