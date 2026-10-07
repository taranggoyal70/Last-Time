const MONID_API_ORIGIN = "https://api.monid.ai";

type MonidRun = {
  id?: string;
  runId?: string;
  status?: string;
  cost?: { value?: number; currency?: string };
  output?: {
    data?: {
      name?: string;
      legalName?: string;
      domain?: string;
      description?: string;
      location?: string;
      companyType?: string;
      metrics?: { employees?: string; employeesCount?: number };
    };
  };
  error?: unknown;
};

async function monidRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = process.env.MONID_API_KEY;
  if (!apiKey) throw new Error("Monid is not configured");
  const response = await fetch(`${MONID_API_ORIGIN}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-monid-client": "lasttime",
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string }; message?: string };
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || `Monid ${response.status}`);
  }
  return payload;
}

export async function monidStatus(signal?: AbortSignal) {
  if (!process.env.MONID_API_KEY) return { configured: false, healthy: false };
  try {
    const identity = await monidRequest<Record<string, unknown>>("/v1/auth/whoami", { signal });
    return { configured: true, healthy: true, identity };
  } catch (error) {
    return {
      configured: true,
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function verifyMerchantDomain(domain: string, signal?: AbortSignal) {
  const normalizedDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!normalizedDomain) throw new Error("A merchant domain is required");
  const run = await monidRequest<MonidRun>("/v1/run", {
    method: "POST",
    signal,
    body: JSON.stringify({
      provider: "hunterio",
      endpoint: "/companies/find",
      input: { queryParams: { domain: normalizedDomain } },
    }),
  });
  const company = run.output?.data;
  return {
    provider: "hunterio",
    endpoint: "/companies/find",
    runId: run.runId || run.id,
    status: run.status,
    cost: run.cost,
    merchant: company ? {
      name: company.name,
      legalName: company.legalName,
      domain: company.domain,
      description: company.description,
      location: company.location,
      companyType: company.companyType,
      employees: company.metrics?.employees,
      employeesCount: company.metrics?.employeesCount,
    } : null,
  };
}
