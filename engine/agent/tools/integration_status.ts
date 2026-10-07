import { defineTool } from "eve/tools";
import { z } from "zod";
import { storageMode } from "../lib/store";
import { monidStatus } from "../lib/monid";

export default defineTool({
  description: "Check which LastTime production integrations are live. Never infer connection status from a logo or workflow definition.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const instanceId = process.env.AGENT37_INSTANCE_ID;
    const apiKey = process.env.AGENT37_API_KEY;
    let agent37: Record<string, unknown> = { configured: Boolean(instanceId && apiKey), healthy: false };
    if (instanceId && apiKey) {
      try {
        const response = await fetch(`https://${instanceId}.agent37.app/v1/health`, {
          headers: { "X-Agent37-Key": apiKey },
          signal: ctx.abortSignal,
        });
        const details = response.ok ? await response.json() as Record<string, unknown> : undefined;
        agent37 = {
          configured: true,
          healthy: response.ok && details?.healthy === true,
          status: response.status,
          instanceId,
          details,
        };
      } catch (error) {
        agent37 = { configured: true, healthy: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    return {
      agent37,
      supabase: { configured: storageMode() === "supabase", mode: storageMode() },
      monid: await monidStatus(ctx.abortSignal),
      model: { provider: "OpenAI", configured: true },
    };
  },
});
