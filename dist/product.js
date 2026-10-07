(() => {
  const pages = {
    "/": "dashboard",
    "/app": "dashboard",
    "/teach": "teach",
    "/workflows": "workflows",
    "/activity": "activity",
    "/connections": "connections",
  };
  let workspace = null;
  let readiness = null;
  let proof = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
  const shortId = (value) => value ? `${String(value).slice(0, 8)}…${String(value).slice(-5)}` : "none yet";
  const niceDate = (value) => {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "Unknown" : new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  };
  const currentPage = () => pages[location.pathname] || "dashboard";

  async function getJson(path) {
    const response = await fetch(path, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response.json();
  }

  function latestRunFor(workflowId) {
    return workspace?.runs?.find((run) => run.workflowId === workflowId);
  }

  function renderDashboard() {
    if (!workspace) return;
    document.querySelector("#metricWorkflows").textContent = String(workspace.metrics.activeWorkflows);
    document.querySelector("#metricRuns").textContent = String(workspace.metrics.completedRuns);
    document.querySelector("#metricWaiting").textContent = String(workspace.metrics.waitingRuns);
    document.querySelector("#metricStorage").textContent = workspace.storage === "supabase" ? "Supabase" : "Local setup";
    const list = document.querySelector("#dashboardWorkflows");
    list.classList.remove("loading-list");
    if (!workspace.workflows.length) {
      list.innerHTML = `<div class="honest-empty"><div class="person peach awake"><i></i><i></i><b></b></div><div><b>Your crew has a clean desk.</b><p>Teach one real workflow and it will appear here with every future run.</p><a href="/teach" data-route>Teach the first workflow →</a></div></div>`;
      bindRouteLinks(list);
      return;
    }
    list.innerHTML = workspace.workflows.slice(0, 4).map((workflow) => {
      const run = latestRunFor(workflow.id);
      return `<article class="routine-row"><div class="routine-glyph">${workflow.status === "ready" ? "✓" : "…"}</div><div><b>${escapeHtml(workflow.name)}</b><small>${escapeHtml(workflow.trigger || "Manual trigger")}</small></div><span>${workflow.stepCount} steps</span><em class="status-${escapeHtml(workflow.status)}">${escapeHtml(workflow.status)}</em><time>${run ? niceDate(run.updatedAt) : "Not run yet"}</time></article>`;
    }).join("");
  }

  function renderWorkflows() {
    if (!workspace) return;
    const table = document.querySelector("#workflowTable");
    table.classList.remove("loading-list");
    if (!workspace.workflows.length) {
      table.innerHTML = `<div class="wide-empty"><span>01</span><div><b>No saved workflows yet</b><p>The product does not invent activity. Teach a real routine and its trigger, steps, status, and runs will appear here.</p></div><a class="paper-button primary" href="/teach" data-route>Teach one now →</a></div>`;
      bindRouteLinks(table);
      return;
    }
    table.innerHTML = workspace.workflows.map((workflow) => {
      const run = latestRunFor(workflow.id);
      return `<article><div><b>${escapeHtml(workflow.name)}</b><small>${escapeHtml(workflow.goal)}</small></div><span>${escapeHtml(workflow.trigger || "Manual")}</span><span>${workflow.stepCount}</span><em class="status-${escapeHtml(workflow.status)}">${escapeHtml(workflow.status)}</em><time>${run ? niceDate(run.updatedAt) : "Never"}</time></article>`;
    }).join("");
  }

  function proofCard(mark, title, detail, state, className = "") {
    return `<article class="${className}"><i>${escapeHtml(mark)}</i><div><span>${escapeHtml(title)}</span><b>${escapeHtml(detail)}</b></div><em>${escapeHtml(state)}</em></article>`;
  }

  function renderProof() {
    if (!proof) return;
    const agentSession = proof.agent37?.sessions?.[0];
    const monidRun = proof.monid?.runs?.[0];
    const instaReceipt = proof.instacloud?.receipts?.[0];
    document.querySelector("#activityProof").innerHTML = [
      proofCard("A37", "Agent37", agentSession ? `session ${shortId(agentSession.id)}` : "No run receipt", agentSession ? "verified" : "waiting", proof.agent37?.connected ? "connected" : ""),
      proofCard("M", "Monid", monidRun ? `${monidRun.provider}${monidRun.endpoint}` : "No verification receipt", monidRun?.status?.toLowerCase() || "waiting", proof.monid?.connected ? "connected" : ""),
      proofCard("⌁", "Supabase", proof.supabase?.connected ? "Workflow database" : "Local fallback", proof.supabase?.connected ? "connected" : "setup", proof.supabase?.connected ? "connected" : ""),
      proofCard("I", "InstaCloud", instaReceipt ? `wake ${shortId(instaReceipt.external_id || instaReceipt.id)}` : (proof.instacloud?.projectId ? `project ${shortId(proof.instacloud.projectId)}` : "No linked project"), instaReceipt ? "verified" : (proof.instacloud?.connected ? "linked" : "setup"), proof.instacloud?.connected ? "connected" : ""),
    ].join("");
  }

  function renderActivity() {
    if (!workspace) return;
    const timeline = document.querySelector("#activityTimeline");
    timeline.classList.remove("loading-list");
    const entries = [
      ...workspace.runs.map((run) => ({ id: run.id, type: `run.${run.status}`, createdAt: run.updatedAt, proof: run.agent37SessionId })),
      ...workspace.events,
    ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20);
    if (!entries.length) {
      timeline.innerHTML = `<div class="wide-empty compact"><span>0</span><div><b>No workflow events yet</b><p>Provider receipts above are live. Workflow events will appear after your first learned routine runs.</p></div></div>`;
      return;
    }
    timeline.innerHTML = entries.map((entry, index) => `<article><i>${String(index + 1).padStart(2, "0")}</i><div><b>${escapeHtml(entry.type.replaceAll(".", " · "))}</b><small>${entry.proof ? `Agent37 ${shortId(entry.proof)}` : `event ${shortId(entry.id)}`}</small></div><time>${niceDate(entry.createdAt)}</time></article>`).join("");
  }

  function renderConnections() {
    if (!readiness) return;
    const states = {
      engine: readiness.engine && readiness.model,
      agent37: readiness.agent37,
      supabase: readiness.supabase,
      monid: readiness.monid,
      instacloud: readiness.instacloud,
    };
    Object.entries(states).forEach(([key, connected]) => {
      const card = document.querySelector(`[data-connection="${key}"]`);
      if (!card) return;
      card.classList.toggle("connected", Boolean(connected));
      card.classList.toggle("not-connected", !connected);
      card.querySelector("em").textContent = connected ? "connected" : (key === "engine" && readiness.engine ? "model login needed" : "setup needed");
    });
  }

  async function refreshData() {
    const results = await Promise.allSettled([
      getJson("/api/workspace"),
      getJson("/api/readiness"),
      getJson("/api/integration-proof"),
    ]);
    if (results[0].status === "fulfilled") workspace = results[0].value;
    if (results[1].status === "fulfilled") readiness = results[1].value;
    if (results[2].status === "fulfilled") proof = results[2].value;
    renderDashboard();
    renderWorkflows();
    renderActivity();
    renderProof();
    renderConnections();
  }

  function route() {
    const page = currentPage();
    document.body.classList.toggle("product-mode", page !== "teach");
    document.querySelectorAll("[data-page]").forEach((element) => { element.hidden = element.dataset.page !== page; });
    document.querySelectorAll(".product-nav a").forEach((link) => link.classList.toggle("active", new URL(link.href).pathname === location.pathname || (location.pathname === "/" && new URL(link.href).pathname === "/app")));
    if (page !== "teach") refreshData();
    if (page === "teach") {
      const recipe = new URLSearchParams(location.search).get("recipe");
      if (recipe) setTimeout(() => document.querySelector(`.task-option[data-task="${CSS.escape(recipe)}"]`)?.click(), 0);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function bindRouteLinks(root = document) {
    root.querySelectorAll("[data-route]").forEach((link) => {
      if (link.dataset.routerBound) return;
      link.dataset.routerBound = "true";
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin) return;
        event.preventDefault();
        history.pushState({}, "", `${url.pathname}${url.search}`);
        route();
      });
    });
  }

  bindRouteLinks();
  document.querySelector("#refreshActivity")?.addEventListener("click", refreshData);
  document.querySelector("#refreshConnections")?.addEventListener("click", refreshData);
  window.addEventListener("popstate", route);
  route();
})();
