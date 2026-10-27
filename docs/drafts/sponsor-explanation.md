# Sponsor explanation (DRAFT)

Short, factual. Nothing here claims a live integration.

**Zetaris (data).** One connector-runner read of Zetaris was done earlier. Its real connector output was supplied by the owner and was not rerun here (historical, no log in this repo). The study-data connector is built to that observed contract and fails closed with no CSV fallback, but it is tested only against a fake fetch. The agent does not use Zetaris in the product yet: its default study source is a local CSV. Using Zetaris from the agent is planned. `docs/HANDOFF.md` (lines 7, 23, 76) words this differently and was not edited.

**Meterless / Nightshift (model runtime).** The adapter follows the Meterless Runtime provider contract and is tested only against mocked HTTP. No live Meterless or Nightshift call has been demonstrated. A live model call is planned.

**H-MEM (memory).** Per-student memory (remember, list, forget, on/off) works offline on synthetic students. A working H-MEM integration has not been demonstrated.

**What we built on top.** A planner with a deterministic checker. Model-proposed plans can be validated before use: `plannerFromEnv` with `HM_PLANNER=model` turns validation on, while `createModelPlanner` is lenient by default. A rejected proposal or a model error falls back to the rule baseline, labelled in the plan and the trace, and is not counted as model success. Topic and time rules reuse the existing checker. Tested with a stub model and mocked inputs only (219 tests passing at the last run); no live model has been used. With validation on, the plan card shows the rule baseline beside the model proposal and its status (validated, rejected with reason codes, or model error); with it off the output is unchanged. The chat CLI shows it when `HM_PLANNER=model` and a model can be built from the environment; otherwise it says so and uses the rule planner (tested with an injected stub model only). Not done: the conversation does not call `runModelProposal`, rejected drafts get no revision feedback, and validation is off by default.
