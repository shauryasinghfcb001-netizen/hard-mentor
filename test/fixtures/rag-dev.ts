// Dev questions for the textbook-routing and chapter-grounding fixes
// (2026-10-23). Synthetic. Written separately from eval/heldout-cases.json and
// eval/frozen-v2-cases.json; none of these strings appear there. Same author
// as the code: they show the mechanisms work, not that unseen wording is
// handled.

// Valid Ch 1 questions: must route to a doubt, be answered, and cite an accepted chunk.
export const DEV_VALID: { q: string; accept: string[] }[] = [
  { q: "What force acts between unlike charges?", accept: ["phy12-1-2", "phy12-1-6"] },
  { q: "Why do two electric field lines never meet?", accept: ["phy12-1-9"] },
  { q: "Can charge be created from nothing?", accept: ["phy12-1-4", "phy12-1-2"] },
  { q: "What does electric flux measure?", accept: ["phy12-1-10"] },
  { q: "Where is the charge on an insulator?", accept: ["phy12-1-3"] },
  { q: "How does a dipole field decay far away?", accept: ["phy12-1-11"] },
  { q: "What is the expression for the field of a point charge?", accept: ["phy12-1-8"] },
  { q: "unit of electric flux", accept: ["phy12-1-10"] },
  { q: "Gauss law for a closed surface with no charge inside", accept: ["phy12-1-13"] },
  { q: "dipole torque in uniform field", accept: ["phy12-1-12"] },
  { q: "Principle of superposition kya hai", accept: ["phy12-1-7"] },
  { q: "Do metals conduct charge easily?", accept: ["phy12-1-3"] },
  { q: "What is the field of a uniformly charged spherical shell outside it?", accept: ["phy12-1-14"] },
  { q: "Explain what a point charge is and Coulomb's constant", accept: ["phy12-1-6"] },
  { q: "Define dipole moment", accept: ["phy12-1-11"] },
];

// Same-chapter-vocabulary questions the notes do NOT support: must not be answered.
export const DEV_OUT: string[] = [
  "What is the potential energy of two point charges?",
  "How is potential energy stored in an electric field?",
  "Explain the potential at a point due to a dipole",
  "What is the work done to move a charge in a field?",
  "How does a capacitor store charge?",
  "What happens to the field inside a dielectric slab?",
  "What is the drift velocity of charges in a wire?",
  "State Ampere's circuital law",
  "Explain electromagnetic induction",
  "What is the wavelength of light?",
  "What is the speed of light?",
  "Explain Newton's third law",
  "What is the mass of a proton?",
  "How do I solve a quadratic equation?",
];

// Study-planning questions that look like textbook questions: must not become doubts.
export const DEV_PLAN: string[] = [
  "Can I revise Gauss's law after dinner?",
  "What should I study first tonight?",
  "Do I have enough time for Optics this week?",
  "How many hours do I need for Electrostatics?",
  "Where should I begin today?",
  "Is it okay to take a break now?",
];

// Known limits, not asserted: single-letter symbols such as "e" are dropped by the tokenizer,
// so "How much is e in coulombs?" cannot find the quantisation note.
export const KNOWN_LIMITS: string[] = ["How much is e in coulombs?"];
