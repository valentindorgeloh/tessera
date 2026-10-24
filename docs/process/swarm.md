# How agents build Tessera (swarm structure)

Status: in use from 2026-10-17.

From 2026-10-17, every phase is built by a swarm with fixed roles. The model follows Cursor's write-up "Agent-Schwärme und die neue Modellökonomie" (cursor.com/de/blog/agent-swarm-model-economics, 2026-07-20). Its main findings:
- Frontier intelligence is needed only at a few points: decomposition, design decisions and trade-offs.
- Once a planner has turned ambiguity into explicit instructions, cheaper models only need to follow them.
- Keeping each agent's context narrow matters more than parallelism.

This file is the process contract. `docs/PLAN.md` §10 (lanes) and the per-phase sections of `docs/contracts/ui.md` sit under it.

## Roles and models

| Role | Model and effort | Does | Never does |
|---|---|---|---|
| Root planner | the main session (Opus 5.5) | Sets the phase order and asks the user for decisions. Starts workflows, reads their results and commits at milestones. | Implement lane work. Leave a decision open for a worker. |
| Phase planner | `opus`, effort `xhigh` | Writes the phase contract (the spec is the prompt). Makes every design decision, with exact names, props, tools, file ownership and acceptance steps, and splits the work into leaf tasks. Two lanes never decide the same question. | Implement. Delegate a design decision. |
| Worker | `sonnet`, effort `high` | Builds one leaf task in the files it owns, keeps `npm run check` green for its files and reports what it did. | Redesign. Edit another lane's files, except as a deliberate core change (below). Run state-changing git. |
| Mechanical worker | `haiku` | Runs gates, greps, import-path swaps, renames and tallies. | Make any judgement call. |
| Reviewer | `sonnet` (one perspective may be `opus`) | Checks the work against the contract from an independent perspective (below) and reports findings with file:line. | Edit project files. |
| Refuter | `sonnet` | Tries to disprove one finding through one lens (reproduce it, or find a mitigating path). A finding survives only if both refuters fail. | Edit project files. |
| Adjudicator | `opus`, effort `high` | Decides findings that are high severity or where refuters disagree. | Edit project files. |
| Reconciler | `opus`, effort `high` | The neutral integrator. Resolves conflicts between lanes and mismatches with the contract, and decides which side wins against the contract. Updates the field guide at the end of a phase. | Take a lane's side without citing the contract. |

The models are pinned per role in each workflow script through `agent(..., { model, effort })`. Fable is not used while its credits are out. If it returns, it may take the phase-planner role (the article measured fewer planning tokens), never the worker role.

## The spec is the unit of work

- A worker prompt has four parts: the common rules, the field guide (injected, see below), its lane section of the contract, and its file-ownership row. Nothing else.
- When a worker finds a question the contract does not answer, it picks the documented default if one exists. Otherwise it picks the smallest choice that keeps the contract's wording true, marks it `ASSUMPTION:` in its report, and does not branch into a redesign. The reconciler or the root planner confirms or reverts each assumption.
- Contracts state every external API a lane uses, verified against the installed `.d.ts` or docs. This is the "API verification" table every phase section already has.

## Shared memory (stigmergy)

- **Field guide.** `docs/field-guide/index.md` holds surprises that shorten future agents' work. It is not a manual, and it has a hard budget of 80 lines.
  - Every workflow script passes its text through `args` and puts it in every agent prompt.
  - The reconciler adds new surprises at the end of a phase and removes entries that no longer hold, within the budget.
  - Longer notes go into `docs/field-guide/<topic>.md`, with a one-line pointer in the index.
- **Decisions.** Design decisions live in the numbered table in `docs/PLAN.md` ("Resolved design decisions", 1–28, and U1–U9) or in a phase section of `docs/contracts/ui.md`.
  - Code that depends on a numbered decision cites it in a comment as `decision N`, or `decision UN` for the user-confirmed ones.
  - The convention gate checks that every cited number exists, so a decision cannot be renumbered or deleted silently.
  - When two lanes disagree about a decision, the reconciler settles it in the document first, then in the code.

## File budget (mega-files)

- Source files under `src/` and `scripts/` have a budget of 600 lines.
- Files already over it are listed with their current length in `scripts/file-budget.json`. They may shrink but not grow; the convention gate enforces this ratchet. A new file over 600 lines fails the gate.
- Any agent that meets a bloated file flags it in its report. The phase planner then schedules a split task (a worker) before lanes add to that file. The split commits on its own.

## Core changes (no calcification)

- A worker may change shared or core code outside its files when its task needs it. Examples: a missing engine helper, or a prop on a shared component.
- It leaves a comment at the change explaining why, keeps the change minimal, lets `tsc` show the call sites it breaks, and lists the change under `core_changes` in its report.
- It fixes the call sites it owns. The reconciler fixes or assigns the rest.
- Workers re-read a file right before editing it: the Edit tool refuses a stale read, and a worker never overwrites another agent's change.

## Verification per phase

1. Gate: mechanical worker. Runs `npm run check` and greps for conflict markers.
2. Build and acceptance: a worker with the browser. Runs `next build`, then the numbered acceptance steps on a fresh database, then Frappé and Latte at 1440 and 375.
3. Review: three reviewers, each with a different perspective.
   - (a) Codebase only. It reads the code against the contract, not the workers' reports.
   - (b) Reports against the contract. It checks each worker's claims and assumptions.
   - (c) Lost behaviour and regressions. It compares with the previous commit.
   One of the three may run on `opus` when the phase changes the engine or data rules.
4. Refutation: two refuters per finding. Then the adjudicator decides findings that are high severity or split.
5. Fix rounds, at most two: workers fix confirmed findings and failed steps. Each round is re-gated and re-accepted.
6. Reconcile: the reconciler does a final cross-lane pass and updates the field guide and `docs/PLAN-STATUS.md`.
7. Commit: the root planner commits.

Live update (decision 140): the user's daily Tessera is the live app on port 3000, a production build of the last commit (docs/process/live.md). After each merged batch whose gate is green, the reconciler runs `npm run live:update` once for that commit and says so in chat, because the user's open tab reloads on its next click. Only the reconciler, or the agent the user asks, runs it; no other agent starts, stops or kills anything on port 3000. The reconciler runs it from a plain shell: without `nice` (the server would keep the nice level, so a niced shell is refused), outside the sandbox (the detached server would keep it), and with a 600 s timeout or `run_in_background` (the build takes one to two minutes; a killed update stops its build and changes nothing). A zsh `&` job runs at nice 5 and is refused. The script gives the server a clean environment, so the agent session's own settings never reach the user's app. Edits to `next.config.ts` change the live build, so a lane batches them and the reconciler announces them before the update.

## Economics

- The goal: frontier models spend their tokens only on contracts, adjudication and reconciliation, and workers carry most of the tokens.
- Each `docs/PLAN-STATUS.md` phase row records agent counts per role, so the split can be checked.
- If a phase hits a usage limit, the workflow resumes from its journal (`resumeFromRunId`). Agents that completed are not re-run.
