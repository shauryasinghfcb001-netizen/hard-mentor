# Hard Mentor: demo video script (about 2 min, DRAFT)

Shoot only what exists today. Items marked "planned" are not demonstrated and must not be shown as working.

**0:00-0:15 Problem.** "A student has 4 hours and 12 weak topics. Study apps hand over a generic timetable and forget you tomorrow."

**0:15-0:45 The plan.** Screen: terminal, rule planner on the synthetic student Riya. "Hard Mentor ranks topics by mastery, marks weight and days to exam, drafts a plan, and a deterministic checker can reject it. Every plan has a why card pointing at the data row behind it."

**0:45-1:10 Memory with consent.** Riya asks to swap a hard topic. The agent cites a remembered skip pattern and refuses the swap. Then: "turn memory off" - the next plan has no remembered facts, and "forget" deletes them. (Offline H-MEM, synthetic student.)

**1:10-1:40 Model proposals, validated first.** "A model can propose a plan, and when validation is switched on we check the proposal before using it. It is checked against this student's own data: unknown topics, evidence that is missing, ambiguous or from another student, and plans over the time limit are rejected. If the proposal is rejected or the model fails, the plan falls back to the rule baseline, says so, and is not counted as a model success." Show the offline test run of `test/model-wiring.test.ts`: a stub model's bad draft replaced by the baseline, labelled "model rejected". Say plainly: validation is opt-in (`HM_PLANNER=model`), tests use a stub model and mocked inputs, and no live model was used. When validation is on, the plan card also prints the rule baseline beside the model's proposal and says which one was sent: validated, rejected with reason codes, or model error. Show that card from `test/model-compare.test.ts` output only; the stub is not a live model. Live model: planned.

**1:40-1:55 Honest status.** "Today: offline, synthetic data, tested with mocks (219 tests passing at the last run). One real Zetaris connector read was done earlier from output the owner supplied; it was not rerun. Not yet shown: the agent reading Zetaris data, a live model through Meterless / Nightshift, a working H-MEM integration. Planned."

**1:55-2:00 Close.** Name, repo.
