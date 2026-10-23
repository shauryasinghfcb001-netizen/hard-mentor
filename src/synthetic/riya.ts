// SYNTHETIC DATA. "Riya" is a fictional CBSE Class 12 student invented for the
// Hard Mentor demo. No field here describes a real person.

export const RIYA = {
  studentId: "riya",
  synthetic: true,
  name: "Riya (fictional)",
  class: 12,
  stream: "PCM",
  dailyStudyHours: 3,
  toughness: 2,
} as const;

export const RIYA_EVENING_SKIP_PATTERN = {
  content: "Riya skipped her evening Electrostatics session twice this week and switched to Organic Chemistry instead when the problems felt hard.",
  subject: "physics",
  topic: "electrostatics",
  source: "synthetic:riya-seed",
  synthetic: true,
};

export const RIYA_PATTERN_QUERY = "Does Riya skip Electrostatics in the evening?";

// Local stand-in for the Zetaris tables (quiz mastery + syllabus marks weight)
// until federation is wired. Weights are synthetic placeholders, not the
// official CBSE weightage. sourceRow ids let the why card point at a row.
export const RIYA_TOPICS = [
  { topicId: "physics:electrostatics", subject: "physics", name: "Electrostatics", mastery: 0.35, marksWeight: 0.8, sourceRow: "fixture:riya_topics#1" },
  { topicId: "chemistry:organic", subject: "chemistry", name: "Organic Chemistry", mastery: 0.6, marksWeight: 0.6, sourceRow: "fixture:riya_topics#2" },
  { topicId: "maths:integrals", subject: "maths", name: "Integrals", mastery: 0.5, marksWeight: 0.7, sourceRow: "fixture:riya_topics#3" },
  { topicId: "physics:optics", subject: "physics", name: "Optics", mastery: 0.9, marksWeight: 0.7, sourceRow: "fixture:riya_topics#4" },
];

export const RIYA_DAYS_TO_EXAM = 120;

export const RIYA_SWAP_REQUEST = "Can I do Organic Chemistry today instead of Electrostatics? Electrostatics problems feel too hard.";
