import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT || 4173);
const engineOrigin = process.env.EVE_ORIGIN || "http://127.0.0.1:2000";
const engineDataPath = join(fileURLToPath(new URL(".", import.meta.url)), "engine", ".data", "lasttime.json");
const receiptDataPath = join(fileURLToPath(new URL(".", import.meta.url)), "engine", ".data", "integration-receipts.json");
const instaProjectPath = join(fileURLToPath(new URL(".", import.meta.url)), ".insta", "project.json");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, ...extra };
  if (key && !key.startsWith("sb_secret_")) headers.authorization = `Bearer ${key}`;
  return headers;
}

async function supabaseHealthy() {
  if (!supabaseConfigured()) return false;
  try {
    await supabaseRows("workflows", "?select=id&limit=1");
    return true;
  } catch {
    return false;
  }
}

async function supabaseRows(table, query = "") {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return [];
  const result = await fetch(`${base}/rest/v1/${table}${query}`, {
    headers: supabaseHeaders(),
    signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) throw new Error(`Supabase ${table} ${result.status}`);
  return result.json();
}

async function loadWorkspaceData() {
  if (supabaseConfigured()) {
    const [workflows, runs, events, receipts] = await Promise.all([
      supabaseRows("workflows", "?select=*&order=updated_at.desc&limit=50"),
      supabaseRows("workflow_runs", "?select=*&order=updated_at.desc&limit=100"),
      supabaseRows("workflow_events", "?select=*&order=created_at.desc&limit=100"),
      supabaseRows("integration_receipts", "?select=*&order=created_at.desc&limit=50"),
    ]);
    return { workflows, runs, events, receipts, storage: "supabase" };
  }
  const local = await readJson(engineDataPath, { workflows: [], runs: [], events: [] });
  const receipts = await readJson(receiptDataPath, []);
  return { ...local, receipts, storage: "local" };
}

function workflowSummary(row) {
  const steps = Array.isArray(row.steps) ? row.steps : [];
  const connections = row.requiredConnections || row.required_connections || [];
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    trigger: row.trigger,
    status: row.status,
    stepCount: steps.length,
    requiredConnections: connections,
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at,
  };
}

function runSummary(row) {
  return {
    id: row.id,
    workflowId: row.workflowId || row.workflow_id,
    status: row.status,
    agent37SessionId: row.agent37SessionId || row.agent37_session_id || null,
    error: row.error || null,
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at,
  };
}

async function instaProject() {
  const project = await readJson(instaProjectPath, null);
  if (!project && !process.env.INSTACLOUD_PROJECT_ID) return null;
  return {
    id: process.env.INSTACLOUD_PROJECT_ID || project?.projectId || project?.project_id || project?.id || project?.project || null,
    branch: process.env.INSTACLOUD_BRANCH || project?.branch || "main",
  };
}

async function proxy(request, response) {
  try {
    const headers = { ...request.headers };
    delete headers.host;
    delete headers.connection;
    const init = { method: request.method, headers };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = Readable.toWeb(request);
      init.duplex = "half";
    }
    const upstream = await fetch(`${engineOrigin}${request.url}`, init);
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    if (!upstream.body) return response.end();
    Readable.fromWeb(upstream.body).pipe(response);
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "agent_engine_unavailable", message: error.message }));
  }
}

async function readiness(response) {
  try {
    const agent37Configured = Boolean(process.env.AGENT37_API_KEY && process.env.AGENT37_INSTANCE_ID);
    const monidConfigured = Boolean(process.env.MONID_API_KEY);
    const [healthResponse, infoResponse, agent37, monid, supabase, insta] = await Promise.all([
      fetch(`${engineOrigin}/eve/v1/health`),
      fetch(`${engineOrigin}/eve/v1/info`),
      agent37Configured
        ? fetch(`https://${process.env.AGENT37_INSTANCE_ID}.agent37.app/v1/health`, {
            headers: { "X-Agent37-Key": process.env.AGENT37_API_KEY },
            signal: AbortSignal.timeout(4000),
          }).then(async (result) => result.ok && (await result.json()).healthy === true).catch(() => false)
        : false,
      monidConfigured
        ? fetch("https://api.monid.ai/v1/auth/whoami", {
            headers: { authorization: `Bearer ${process.env.MONID_API_KEY}`, "X-Monid-Client": "lasttime" },
            signal: AbortSignal.timeout(4000),
          }).then((result) => result.ok).catch(() => false)
        : false,
      supabaseHealthy(),
      instaProject(),
    ]);
    const health = healthResponse.ok ? await healthResponse.json() : {};
    const info = infoResponse.ok ? await infoResponse.json() : {};
    const payload = {
      engine: health?.ok === true,
      model: info?.agent?.model?.endpoint?.connected === true,
      agent37,
      supabase,
      monid,
      instacloud: Boolean(insta?.id),
      storage: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local",
    };
    response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
  } catch (error) {
    response.writeHead(503, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ engine: false, model: false, agent37: false, supabase: false, monid: false, instacloud: false, storage: "local", error: error.message }));
  }
}

async function integrationProof(response) {
  const instanceId = process.env.AGENT37_INSTANCE_ID;
  const agent37Key = process.env.AGENT37_API_KEY;
  const monidKey = process.env.MONID_API_KEY;
  const [agent37Result, monidResult] = await Promise.allSettled([
    instanceId && agent37Key
      ? fetch(`https://${instanceId}.agent37.app/v1/sessions?limit=5`, {
          headers: { "X-Agent37-Key": agent37Key },
          signal: AbortSignal.timeout(5000),
        }).then(async (result) => ({ ok: result.ok, payload: result.ok ? await result.json() : {} }))
      : Promise.resolve({ ok: false, payload: {} }),
    monidKey
      ? fetch("https://api.monid.ai/v1/runs?limit=5", {
          headers: { authorization: `Bearer ${monidKey}`, "X-Monid-Client": "lasttime" },
          signal: AbortSignal.timeout(5000),
        }).then(async (result) => ({ ok: result.ok, payload: result.ok ? await result.json() : {} }))
      : Promise.resolve({ ok: false, payload: {} }),
  ]);
  const agent37Value = agent37Result.status === "fulfilled" ? agent37Result.value : { ok: false, payload: {} };
  const monidValue = monidResult.status === "fulfilled" ? monidResult.value : { ok: false, payload: {} };
  const sessions = Array.isArray(agent37Value.payload?.data) ? agent37Value.payload.data : [];
  const runs = Array.isArray(monidValue.payload?.items) ? monidValue.payload.items : [];
  const [insta, workspace, supabase] = await Promise.all([
    instaProject(),
    loadWorkspaceData().catch(() => ({ receipts: [] })),
    supabaseHealthy(),
  ]);
  const payload = {
    generatedAt: new Date().toISOString(),
    agent37: {
      connected: agent37Value.ok,
      instanceId: instanceId || null,
      sessions: sessions.slice(0, 5).map((session) => ({
        id: session.id,
        title: session.title,
        preview: session.preview,
        lastActive: session.last_active,
        messageCount: session.message_count,
      })),
    },
    monid: {
      connected: monidValue.ok,
      runs: runs.slice(0, 5).map((run) => ({
        id: run.id || run.runId,
        status: run.status,
        provider: run.provider,
        endpoint: run.endpoint,
        createdAt: run.createdAt || run.created_at,
        cost: run.cost,
      })),
    },
    supabase: {
      connected: supabase,
      storage: supabase ? "production" : "local fallback",
    },
    instacloud: {
      connected: Boolean(insta?.id),
      projectId: insta?.id || null,
      branch: insta?.branch || null,
      receipts: Array.isArray(workspace.receipts)
        ? workspace.receipts.filter((receipt) => receipt.provider === "instacloud").slice(0, 5)
        : [],
    },
  };
  response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function workspaceSummary(response) {
  try {
    const data = await loadWorkspaceData();
    const workflows = (Array.isArray(data.workflows) ? data.workflows : []).map(workflowSummary);
    const runs = (Array.isArray(data.runs) ? data.runs : []).map(runSummary);
    const events = (Array.isArray(data.events) ? data.events : []).slice(0, 30).map((event) => ({
      id: event.id,
      runId: event.runId || event.run_id,
      type: event.type,
      createdAt: event.createdAt || event.created_at,
    }));
    const completedRuns = runs.filter((run) => run.status === "completed").length;
    const activeWorkflows = workflows.filter((workflow) => ["ready", "draft"].includes(workflow.status)).length;
    response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      storage: data.storage,
      metrics: { activeWorkflows, completedRuns, waitingRuns: runs.filter((run) => run.status === "waiting_for_approval").length },
      workflows,
      runs,
      events,
    }));
  } catch (error) {
    response.writeHead(503, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "workspace_unavailable", message: error.message }));
  }
}

async function requestJson(request, limit = 64_000) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw new Error("Request body is too large");
  }
  return body ? JSON.parse(body) : {};
}

async function saveIntegrationReceipt(receipt) {
  if (supabaseConfigured()) {
    const base = process.env.SUPABASE_URL.replace(/\/$/, "");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await fetch(`${base}/rest/v1/integration_receipts`, {
      method: "POST",
      headers: supabaseHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(receipt),
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) throw new Error(`Supabase integration_receipts ${result.status}`);
    return;
  }
  const receipts = await readJson(receiptDataPath, []);
  receipts.unshift(receipt);
  await writeJsonAtomic(receiptDataPath, receipts.slice(0, 100));
}

async function scheduledWake(request, response) {
  const secret = process.env.INSTA_CRON_SECRET;
  if (!secret) {
    response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    return response.end(JSON.stringify({ error: "instacloud_cron_not_configured" }));
  }
  if (request.headers.authorization !== `Bearer ${secret}`) {
    response.writeHead(401, { "content-type": "application/json; charset=utf-8" });
    return response.end(JSON.stringify({ error: "unauthorized" }));
  }
  try {
    const input = await requestJson(request);
    if (typeof input.workflowId !== "string" || !input.workflowId) throw new Error("workflowId is required");
    const data = await loadWorkspaceData();
    const workflow = (data.workflows || []).find((candidate) => candidate.id === input.workflowId);
    if (!workflow) throw new Error("Workflow not found");
    const instanceId = process.env.AGENT37_INSTANCE_ID;
    const apiKey = process.env.AGENT37_API_KEY;
    if (!instanceId || !apiKey) throw new Error("Agent37 is not configured");
    const upstream = await fetch(`https://${instanceId}.agent37.app/v1/responses`, {
      method: "POST",
      headers: { "X-Agent37-Key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        input: `InstaCloud scheduled this LastTime workflow. Execute only the approved workflow and return a concise JSON result.\n\nWorkflow: ${JSON.stringify(workflowSummary(workflow))}\n\nRun input: ${JSON.stringify(input.input || {})}`,
        stream: false,
        metadata: { lasttimeTrigger: "instacloud-cron", workflowId: input.workflowId },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) throw new Error(`Agent37 ${upstream.status}`);
    const result = await upstream.json();
    const receipt = {
      id: `receipt_${randomUUID()}`,
      provider: "instacloud",
      external_id: result.id || result.session_id || null,
      kind: "scheduled_wake",
      status: result.status || "dispatched",
      metadata: { workflowId: input.workflowId, agent37SessionId: result.session_id || null },
      created_at: new Date().toISOString(),
    };
    await saveIntegrationReceipt(receipt);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, proof: receipt }));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "scheduled_wake_failed", message: error.message }));
  }
}

async function serveStatic(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const productRoutes = new Set(["/", "/app", "/teach", "/workflows", "/activity", "/connections"]);
  const relativePath = productRoutes.has(requestPath) ? "index.html" : requestPath.replace(/^\/+/, "");
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..")) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  let filePath = join(root, normalized);
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = join(filePath, "index.html");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mime[extname(filePath)] || "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

createServer((request, response) => {
  if (request.url === "/api/readiness" && request.method === "GET") return readiness(response);
  if (request.url === "/api/integration-proof" && request.method === "GET") return integrationProof(response);
  if (request.url === "/api/workspace" && request.method === "GET") return workspaceSummary(response);
  if (request.url === "/api/instacloud/wake" && request.method === "POST") return scheduledWake(request, response);
  if (request.url?.startsWith("/eve/")) return proxy(request, response);
  return serveStatic(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`LastTime web: http://0.0.0.0:${port}`);
  console.log(`Agent proxy: ${engineOrigin}`);
});
