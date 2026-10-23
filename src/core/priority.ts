// Weak-topic priority and mastery update, exactly as specified in the
// blueprint (section 6, feature 5). Pure functions, no I/O.

export interface TopicState {
  topicId: string; // e.g. "physics:electrostatics"
  subject: string;
  name: string;
  mastery: number; // 0..1
  marksWeight: number; // relative exam weight, 0..1
  sourceRow: string; // id of the data row this came from (why card link)
  /** latest quiz that changed this mastery, when the data source keeps a quiz log */
  lastQuiz?: { quizId: string; takenAt: string; correct: number; total: number; ref: string };
}

export interface RankedTopic extends TopicState {
  priority: number;
  urgency: number;
}

export const MASTERED_AT = 0.85;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function urgency(daysToExam: number): number {
  return 1 + 30 / Math.max(daysToExam, 1);
}

export function priority(mastery: number, marksWeight: number, daysToExam: number): number {
  return (1 - clamp01(mastery)) * marksWeight * urgency(daysToExam);
}

/** m = 0.7·m + 0.3·score, score in 0..1. */
export function updateMastery(mastery: number, score: number): number {
  return clamp01(0.7 * clamp01(mastery) + 0.3 * clamp01(score));
}

/** Initial mastery is the diagnostic score, or 0.5 when the topic was not covered. */
export function initialMastery(diagnosticScore?: number): number {
  return diagnosticScore === undefined ? 0.5 : clamp01(diagnosticScore);
}

export function rankTopics(topics: TopicState[], daysToExam: number): RankedTopic[] {
  const u = urgency(daysToExam);
  return topics
    .map((t) => ({ ...t, urgency: u, priority: priority(t.mastery, t.marksWeight, daysToExam) }))
    .sort((a, b) => b.priority - a.priority || a.topicId.localeCompare(b.topicId));
}
