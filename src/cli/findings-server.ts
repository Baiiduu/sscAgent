import path from "node:path"
import { toFindingDetail, toFindingListItem } from "../finding/derive"
import { SQLiteFindingStore } from "../finding/store"

const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 8787

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const store = new SQLiteFindingStore({
    filepath: options.databasePath,
  })

  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: async (request) => handleRequest(request, store),
  })

  console.log(`Findings server listening on http://${server.hostname}:${server.port}`)
  console.log(`Database: ${options.databasePath}`)
}

async function handleRequest(request: Request, store: SQLiteFindingStore) {
  const url = new URL(request.url)

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, { status: 405 })
  }

  if (url.pathname === "/") {
    return html(INDEX_HTML)
  }

  if (url.pathname === "/api/findings") {
    const findings = store.list()
    const items = findings.map((finding) => toFindingListItem(finding, store.events(finding.id)))
    return json({ findings: items })
  }

  const detailMatch = url.pathname.match(/^\/api\/findings\/([^/]+)$/)
  if (detailMatch) {
    const finding = store.get(decodeURIComponent(detailMatch[1]))
    if (!finding) return json({ error: "Finding not found" }, { status: 404 })
    return json(toFindingDetail(finding, store.events(finding.id)))
  }

  if (url.pathname === "/api/health") {
    return json({ ok: true })
  }

  return json({ error: "Not found" }, { status: 404 })
}

function parseArgs(args: string[]) {
  const dataDir = path.resolve(readArg(args, "--data-dir") ?? process.env.AGENT_DATA_DIR ?? ".agent-data")
  const databasePath = path.resolve(readArg(args, "--db") ?? process.env.FINDINGS_DB ?? path.join(dataDir, "session.sqlite"))
  const host = readArg(args, "--host") ?? process.env.FINDINGS_HOST ?? DEFAULT_HOST
  const port = Number(readArg(args, "--port") ?? process.env.FINDINGS_PORT ?? DEFAULT_PORT)

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${port}`)
  }

  return {
    dataDir,
    databasePath,
    host,
    port,
  }
}

function readArg(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  return args[index + 1]
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  })
}

function html(body: string) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  })
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SSC Agent Findings</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d8dde6;
      --text: #1f2933;
      --muted: #697586;
      --accent: #1769aa;
      --accent-soft: #e8f2fb;
      --danger: #b42318;
      --warning: #a15c07;
      --ok: #067647;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
    }
    header {
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 650;
    }
    main {
      height: calc(100vh - 52px);
      display: grid;
      grid-template-columns: minmax(280px, 34vw) 1fr;
    }
    aside {
      border-right: 1px solid var(--line);
      background: var(--panel);
      overflow: auto;
    }
    section {
      overflow: auto;
      padding: 18px;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
    }
    .list-head {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 14px 14px 10px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .list-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      font-weight: 650;
    }
    .finding-list {
      display: flex;
      flex-direction: column;
    }
    .finding-item {
      width: 100%;
      min-height: 88px;
      padding: 12px 14px;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .finding-item:hover,
    .finding-item.active {
      background: var(--accent-soft);
    }
    .finding-title {
      font-weight: 650;
      line-height: 1.35;
      margin-bottom: 7px;
    }
    .row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 7px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid var(--line);
      color: var(--muted);
      background: #fff;
      font-size: 12px;
      line-height: 1.2;
    }
    .pill.high,
    .pill.critical {
      color: var(--danger);
      border-color: #f2b8b5;
      background: #fff3f2;
    }
    .pill.medium {
      color: var(--warning);
      border-color: #f5d9a8;
      background: #fff8eb;
    }
    .pill.fixed,
    .pill.verified_impact {
      color: var(--ok);
      border-color: #a9e5c4;
      background: #effbf4;
    }
    .detail-shell {
      max-width: 1040px;
      margin: 0 auto;
    }
    .empty {
      min-height: 240px;
      display: grid;
      place-items: center;
      color: var(--muted);
      border: 1px dashed var(--line);
      background: var(--panel);
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      margin-bottom: 14px;
    }
    .panel-body {
      padding: 14px;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 20px;
      line-height: 1.25;
    }
    h3 {
      margin: 0 0 10px;
      font-size: 13px;
      text-transform: uppercase;
      color: var(--muted);
      letter-spacing: 0;
    }
    dl {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 8px 12px;
      margin: 0;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
    li + li {
      margin-top: 5px;
    }
    .event {
      border-top: 1px solid var(--line);
      padding: 12px 14px;
    }
    .event:first-child {
      border-top: 0;
    }
    .event-summary {
      margin: 8px 0;
      line-height: 1.45;
    }
    pre {
      max-height: 280px;
      overflow: auto;
      margin: 8px 0 0;
      padding: 10px;
      border-radius: 4px;
      background: #111827;
      color: #e5e7eb;
      font-size: 12px;
      line-height: 1.45;
    }
    @media (max-width: 820px) {
      main {
        height: auto;
        grid-template-columns: 1fr;
      }
      aside {
        max-height: 42vh;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
      section {
        min-height: 58vh;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>SSC Agent Findings</h1>
    <div class="meta" id="updated">Loading...</div>
  </header>
  <main>
    <aside>
      <div class="list-head">
        <div class="list-title">
          <span>Findings</span>
          <span class="meta" id="count">0</span>
        </div>
      </div>
      <div class="finding-list" id="finding-list"></div>
    </aside>
    <section>
      <div class="detail-shell" id="detail">
        <div class="empty">Select a finding.</div>
      </div>
    </section>
  </main>
  <script>
    let selectedID = null;
    let findings = [];

    async function loadFindings() {
      const response = await fetch("/api/findings");
      const data = await response.json();
      findings = data.findings || [];
      if (!selectedID && findings.length > 0) selectedID = findings[0].id;
      renderList();
      document.getElementById("count").textContent = String(findings.length);
      document.getElementById("updated").textContent = "Updated " + new Date().toLocaleTimeString();
      if (selectedID) await loadDetail(selectedID);
    }

    async function loadDetail(id) {
      selectedID = id;
      renderList();
      const response = await fetch("/api/findings/" + encodeURIComponent(id));
      if (!response.ok) {
        document.getElementById("detail").innerHTML = '<div class="empty">Finding not found.</div>';
        return;
      }
      renderDetail(await response.json());
    }

    function renderList() {
      const root = document.getElementById("finding-list");
      if (findings.length === 0) {
        root.innerHTML = '<div class="empty" style="border:0;border-radius:0;">No findings recorded yet.</div>';
        return;
      }
      root.innerHTML = findings.map((item) => {
        const subject = item.packageName || item.filePath || item.purl || item.stableKey;
        const selected = item.id === selectedID ? " active" : "";
        return '<button class="finding-item' + selected + '" onclick="loadDetail(\\'' + escapeJS(item.id) + '\\')">' +
          '<div class="finding-title">' + escapeHTML(item.title) + '</div>' +
          '<div class="row">' +
            pill(item.severity || "unknown") +
            pill(item.kind) +
            pill(item.projection.conclusion) +
          '</div>' +
          '<div class="meta" style="margin-top:7px;">' + escapeHTML(item.primaryIdentifier || subject || "") + '</div>' +
          '<div class="meta">' + item.eventCount + ' events</div>' +
        '</button>';
      }).join("");
    }

    function renderDetail(data) {
      const finding = data.finding;
      const projection = data.projection;
      const events = data.events || [];
      document.getElementById("detail").innerHTML =
        '<div class="panel"><div class="panel-body">' +
          '<h2>' + escapeHTML(finding.title) + '</h2>' +
          '<div class="row">' +
            pill(finding.severity || "unknown") +
            pill(finding.kind) +
            pill(projection.conclusion) +
            pill(projection.confidence + " confidence") +
          '</div>' +
        '</div></div>' +
        infoPanel(finding) +
        projectionPanel(projection) +
        eventsPanel(events);
    }

    function infoPanel(finding) {
      const rows = [
        ["Stable key", finding.stableKey],
        ["Identifier", finding.primaryIdentifier],
        ["Package", finding.packageName],
        ["PURL", finding.purl],
        ["File", finding.filePath],
        ["Session", finding.sessionID],
        ["Run", finding.runID],
      ].filter((row) => row[1]);
      return '<div class="panel"><div class="panel-body"><h3>Finding</h3><dl>' +
        rows.map((row) => '<dt>' + escapeHTML(row[0]) + '</dt><dd>' + escapeHTML(String(row[1])) + '</dd>').join("") +
        '</dl></div></div>';
    }

    function projectionPanel(projection) {
      return '<div class="panel"><div class="panel-body"><h3>Derived View</h3>' +
        '<div class="row" style="margin-bottom:12px;">' + pill(projection.conclusion) + pill(projection.confidence + " confidence") + '</div>' +
        '<h3>Reasons</h3>' + list(projection.reasons) +
        '<h3 style="margin-top:14px;">Gaps</h3>' + list(projection.gaps) +
        '</div></div>';
    }

    function eventsPanel(events) {
      return '<div class="panel"><div class="panel-body"><h3>Events</h3></div>' +
        events.map((event) =>
          '<div class="event">' +
            '<div class="row">' + pill(event.type) + pill(event.source) + '<span class="meta">' + new Date(event.createdAt).toLocaleString() + '</span></div>' +
            '<div class="event-summary">' + escapeHTML(event.summary) + '</div>' +
            (event.artifactPath ? '<div class="meta">Artifact: ' + escapeHTML(event.artifactPath) + '</div>' : '') +
            (event.data === undefined ? '' : '<pre>' + escapeHTML(JSON.stringify(event.data, null, 2)) + '</pre>') +
          '</div>'
        ).join("") +
        '</div>';
    }

    function list(items) {
      if (!items || items.length === 0) return '<div class="meta">None</div>';
      return '<ul>' + items.map((item) => '<li>' + escapeHTML(item) + '</li>').join("") + '</ul>';
    }

    function pill(value) {
      const text = String(value || "unknown");
      return '<span class="pill ' + escapeHTML(text) + '">' + escapeHTML(text.replace(/_/g, " ")) + '</span>';
    }

    function escapeHTML(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }

    function escapeJS(value) {
      return String(value ?? "").replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'");
    }

    loadFindings().catch((error) => {
      document.getElementById("detail").innerHTML = '<div class="empty">' + escapeHTML(error.message) + '</div>';
    });
    setInterval(() => loadFindings().catch(() => undefined), 3000);
  </script>
</body>
</html>`;

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
