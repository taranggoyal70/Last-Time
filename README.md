# LASTTIME

**Show it once. Get your afternoon back.**

LASTTIME watches a person complete an annoying workflow once, captures the semantic actions and judgment behind it, and compiles those actions into a persistent agent skill.

The experience is a playful, realistic workbench rather than an abstract AI dashboard. Users can try a clearly labeled stage recipe or describe their own workflow, record how often it repeats and how long it takes, and see a grounded monthly time-recovery estimate before teaching the live agent.

The stage demo uses expense reconciliation as the default wedge:

1. The user demonstrates how to process one receipt.
2. A small visible crew learns the inputs, decisions, and finished result.
3. The crew carries the work through mail, a card record, and the report.
4. One genuine edge case pauses for human judgment.
5. The answer becomes policy, the run resumes, and a completed CSV is produced.

The built-in scenarios are clearly bounded stage fixtures. A custom user-described routine takes the real product path: it opens a dedicated durable Eve conversation, interviews the user for a concrete example, saves the resulting typed workflow, and only dispatches a future Agent37 run after explicit approval. The interface has a live readiness checklist for the runtime, OpenAI model, Agent37, Supabase, and Monid; incomplete setup is visible and actionable rather than hidden.

## Run locally

From this directory, start the durable agent and the web app in separate terminals:

```bash
npm run dev:engine
npm run dev:web
```

Open <http://localhost:4173/app>. The product is still one fast web app, but it has real startup-style routes:

- `/app` — honest daily dashboard and time-saved metrics
- `/teach` — the playful 20-second demo and live teaching flow
- `/workflows` — saved workflow library
- `/activity` — workflow events and sponsor receipts
- `/connections` — live integration readiness

Use **Quick Demo** on `/teach` for the stage sequence, or type a custom workflow to use the live agent engine.

Before the live path can call a model, run `npm exec -- eve dev` from `engine/` and enter `/login` in Eve's interactive UI. Copy `engine/.env.example` to your local environment and configure Agent37, Supabase, Monid, and the InstaCloud wake secret there; never place secrets in the browser bundle.

## Demo controls

- **Quick Demo** runs a deterministic, explicitly labeled stage fixture.
- **Teach your own workflow** starts a durable agent onboarding session and persists a real workflow.
- Frequency and time-cost inputs produce a transparent monthly impact estimate.
- Click the engine-status pill for live integration readiness and the next setup action.
- **Reset** or `R` returns to the opening state.
- `M` toggles sound.
- The final **Download report.csv** button creates a real twelve-row export.

## Sponsor architecture

- **Agent37**: persistent worker runtime and scheduled execution
- **OpenAI**: receipt understanding and action-to-skill compilation
- **Supabase**: workflow events, memory, run state, and artifacts
- **Monid**: live merchant and entity verification, with paid run IDs retained as evidence
- **InstaCloud**: deploys the complete product and schedules secure wake-ups for recurring workflows

## Product runtime

- Eve provides durable, resumable learning sessions and streams real agent events to the UI.
- Learned workflows, workflow runs, and run events persist to a local atomic JSON store during development and automatically use Supabase when its server credentials are present.
- `start_workflow_run` is a typed, approval-gated tool that calls Agent37's live API; it returns a blocked state when Agent37 is not configured instead of fabricating output.
- Approved workflow inputs with a `merchantDomain` are verified through Monid before Agent37 receives the run. The result returns both provider IDs as a proof receipt.
- `/api/integration-proof` reads recent sessions and verification runs directly from Agent37 and Monid, exposing IDs and status without exposing credentials.
- `/api/workspace` reads the user's real workflows, runs, and events. It uses Supabase when configured and the atomic local store during development.
- `/api/instacloud/wake` is a server-only, secret-protected endpoint for an InstaCloud cron trigger. It dispatches an actual Agent37 run and stores the resulting proof receipt.
- The browser checks the runtime and model connection on load, and disables the live path when setup is incomplete.

## Supabase setup

Create a Supabase project, then run [`supabase/migrations/20261007221500_initial_lasttime.sql`](supabase/migrations/20261007221500_initial_lasttime.sql) in the SQL editor. The migration creates:

- `workflows`
- `workflow_runs`
- `workflow_events`
- `integration_receipts`

It includes foreign keys, composite indexes, ownership constraints, updated-at triggers, row-level security, and authenticated-owner policies. Set `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` in `engine/.env.local`. The UI marks Supabase connected only after it can successfully query the schema.

## InstaCloud deployment

The root [`Dockerfile`](Dockerfile) builds the Eve runtime and launches it together with the product server through [`start.mjs`](start.mjs). After linking an InstaCloud project with the official CLI, deploy this directory and configure the same server-side variables used locally.

For recurring jobs, point an InstaCloud schedule at `POST /api/instacloud/wake` with the `x-lasttime-cron-secret` header matching `INSTA_CRON_SECRET`. The endpoint accepts a real `workflowId`; it never substitutes a hardcoded demo workflow.

## Security note

`npm audit` currently reports one high-severity transitive `undici` advisory through the Eve/`just-bash` build toolchain. npm's automatic recommendation is a major Eve downgrade, so it is intentionally not applied to this hackathon build. Recheck and upgrade the upstream packages before a public production launch.
