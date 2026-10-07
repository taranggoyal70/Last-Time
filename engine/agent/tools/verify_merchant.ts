import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { verifyMerchantDomain } from "../lib/monid";

export default defineTool({
  description: "Verify a merchant or vendor from its domain through Monid before trusting receipt or vendor data. This spends a small amount of the configured Monid balance and always requires approval.",
  inputSchema: z.object({
    domain: z.string().min(3).max(253),
    reason: z.string().min(3).max(300),
  }),
  approval: always(),
  label: { start: ({ domain }) => `Verify ${domain} with Monid` },
  async execute({ domain }, ctx) {
    return verifyMerchantDomain(domain, ctx.abortSignal);
  },
});
