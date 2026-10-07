import { randomUUID } from "node:crypto";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { ownerKeyFromContext } from "../lib/identity";
import { verifyMerchantDomain } from "../lib/monid";
import { appendEvent, createRun, getWorkflow, updateRun } from "../lib/store";
import type { WorkflowEvent, WorkflowRun } from "../lib/types";

export default defineTool({
  description: "Execute a saved workflow with Agent37. When the approved input contains merchantDomain, verify that merchant with Monid before dispatch. External execution and paid verification always require approval.",
  inputSchema: z.object({
    workflowId: z.string().min(1),
    input: z.looseObject({ merchantDomain: z.string().min(3).max(253).optional() }),
    reason: z.string().min(3).max(500),
  }),
  approval: always(),
  label: { start: ({ workflowId }) => `Start workflow ${workflowId}` },
  async execute({ workflowId, input, reason }, ctx) {
    const ownerKey = ownerKeyFromContext(ctx);
    const workflow = await getWorkflow(ownerKey, workflowId);
    if (!workflow) throw new Error("Workflow not found for this user");

    const now = new Date().toISOString();
    const runId = `run_${randomUUID()}`;
    const run: WorkflowRun = { id: runId, workflowId, ownerKey, status: "queued", input, createdAt: now, updatedAt: now };
    await createRun(run);
    const queued: WorkflowEvent = {
      id: `evt_${randomUUID()}`,
      runId,
      ownerKey,
      sequence: 1,
      type: "run.queued",
      data: { reason, workflowName: workflow.name },
      createdAt: now,
    };
    await appendEvent(queued);

    let monidVerification: Awaited<ReturnType<typeof verifyMerchantDomain>> | undefined;
    if (typeof input.merchantDomain === "string" && process.env.MONID_API_KEY) {
      monidVerification = await verifyMerchantDomain(input.merchantDomain, ctx.abortSignal);
      await appendEvent({
        id: `evt_${randomUUID()}`,
        runId,
        ownerKey,
        sequence: 2,
        type: "monid.verified",
        data: monidVerification as unknown as Record<string, unknown>,
        createdAt: new Date().toISOString(),
      });
    }

    const instanceId = process.env.AGENT37_INSTANCE_ID;
    const apiKey = process.env.AGENT37_API_KEY;
    if (!instanceId || !apiKey) {
      const blocked = await updateRun(ownerKey, runId, { status: "blocked", error: "Agent37 is not configured" });
      return { run: blocked, execution: "blocked", requiredConfiguration: ["AGENT37_INSTANCE_ID", "AGENT37_API_KEY"] };
    }

    const prompt = [
      "Execute the saved LastTime workflow exactly as defined.",
      `Workflow: ${JSON.stringify(workflow)}`,
      `Run input: ${JSON.stringify(input)}`,
      monidVerification ? `Verified merchant evidence from Monid: ${JSON.stringify(monidVerification)}` : "No merchant verification was requested for this run.",
      "Do not perform any action whose step requires approval unless approval is present in the run input.",
      "Return a concise JSON summary with completed steps, skipped steps, artifacts, and errors.",
    ].join("\n\n");
    const response = await fetch(`https://${instanceId}.agent37.app/v1/responses`, {
      method: "POST",
      headers: { "X-Agent37-Key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ input: prompt, stream: false, metadata: { lasttimeRunId: runId, workflowId, monidRunId: monidVerification?.runId } }),
      signal: ctx.abortSignal,
    });
    if (!response.ok) {
      const message = `Agent37 ${response.status}: ${(await response.text()).slice(0, 1000)}`;
      const failed = await updateRun(ownerKey, runId, { status: "failed", error: message });
      return { run: failed, execution: "live", monid: monidVerification, error: message };
    }
    const result = await response.json() as Record<string, unknown>;
    const sessionId = typeof result.session_id === "string" ? result.session_id : undefined;
    const completed = result.status === "completed";
    const updated = await updateRun(ownerKey, runId, {
      status: completed ? "completed" : "running",
      agent37SessionId: sessionId,
      output: result,
    });
    await appendEvent({
      id: `evt_${randomUUID()}`,
      runId,
      ownerKey,
      sequence: monidVerification ? 3 : 2,
      type: completed ? "agent37.completed" : "agent37.dispatched",
      data: { instanceId, sessionId, responseId: result.id },
      createdAt: new Date().toISOString(),
    });
    return {
      run: updated,
      execution: "live",
      proof: {
        agent37: { instanceId, sessionId, responseId: result.id, status: result.status },
        monid: monidVerification,
      },
      response: result,
    };
  },
});
