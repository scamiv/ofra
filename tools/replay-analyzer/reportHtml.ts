import type { ReplayPerfReport } from "./types";

export function reportHtml(d3Source: string, report: ReplayPerfReport): string {
  const safeJson = JSON.stringify(report).replace(/</g, "\\u003c");
  const title = `OpenFront Replay Perf Report - ${report.meta.gameID}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        margin: 0;
        background: #0b1220;
        color: #e5e7eb;
      }
      header { padding: 18px 22px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      header h1 { margin: 0 0 6px 0; font-size: 18px; }
      header .meta { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; opacity: 0.85; }
      main { padding: 16px 22px 40px; margin: 0 auto; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
      @media (min-width: 900px) { .grid { grid-template-columns: 1fr 1fr; } }
      .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px 12px 8px; }
      .card h2 { margin: 0 0 10px 0; font-size: 14px; }
      .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
      .kpi { padding: 10px 12px; border-radius: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); }
      .kpi .label { font-size: 12px; opacity: 0.8; }
      .kpi .value { font-size: 18px; font-weight: 700; margin-top: 2px; }
      .kpi .sub { font-size: 12px; opacity: 0.75; margin-top: 2px; }
      .chart { width: 100%; height: 260px; }
      .axis path, .axis line { stroke: rgba(255,255,255,0.18); }
      .axis text { fill: rgba(229,231,235,0.8); font-size: 11px; }
      .gridline line { stroke: rgba(255,255,255,0.06); }
      .tooltip { position: fixed; pointer-events: none; background: rgba(0,0,0,0.85); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 8px 10px; font-size: 12px; line-height: 1.35; transform: translate(10px, 10px); display: none; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 12px; vertical-align: top; }
      th { opacity: 0.85; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .muted { opacity: 0.75; }
      .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 0 0 10px; font-size: 12px; }
      .controls label { display: inline-flex; gap: 6px; align-items: center; }
      .controls input[type="text"] { background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.10); color: #e5e7eb; border-radius: 8px; padding: 6px 8px; min-width: 220px; }
    </style>
  </head>
  <body>
    <header>
      <h1>${title}</h1>
      <div class="meta">
        replay: ${report.meta.replayPath}<br/>
        git: ${report.meta.replayGitCommit ?? "n/a"}<br/>
        map: ${report.meta.map} (${report.meta.mapSize}) | turns: ${report.meta.numTurns} | simulated: ${report.meta.numTicksSimulated}<br/>
        unknown clientIDs: ${report.meta.unknownClientIds.total} (non-mark: ${report.meta.unknownClientIds.withNonMarkIntents}, mark-only: ${report.meta.unknownClientIds.markOnly})<br/>
        generated: ${report.meta.generatedAt}
      </div>
    </header>
    <main>
      <div class="card">
        <h2>Summary</h2>
        <div id="summary" class="summary"></div>
      </div>

      <div class="card" style="margin-top: 14px;">
        <h2>Diagnostics</h2>
        <div id="diagnostics" class="muted"></div>
      </div>

      <div class="grid" style="margin-top: 14px;">
        <div class="card">
          <h2>Tick execution time (ms)</h2>
          <div id="chart-tick-ms" class="chart"></div>
        </div>
        <div class="card">
          <h2>Intents per tick</h2>
          <div id="chart-intents" class="chart"></div>
        </div>
        <div class="card">
          <h2>Players alive (humans)</h2>
          <div id="chart-players" class="chart"></div>
        </div>
        <div class="card">
          <h2>🗺️ Tiles owned over time</h2>
          <div id="chart-tiles-owned" class="chart"></div>
        </div>
        <div class="card">
          <h2>🗺️ Peak tiles owned</h2>
          <div id="chart-tiles" class="chart"></div>
        </div>
      </div>

      <div class="grid" style="margin-top: 14px;">
        <!-- Income Sources -->
        <div class="card">
          <h2>💰 Gold earned: trade ships (K)</h2>
          <div id="chart-gold-earned-trade" class="chart"></div>
        </div>
        <div class="card">
          <h2>🚂 Gold earned: rail/trains (K)</h2>
          <div id="chart-gold-earned-train" class="chart"></div>
        </div>
        <div class="card">
          <h2>⚔️ Gold earned: conquest/war (K)</h2>
          <div id="chart-gold-earned-conquer" class="chart"></div>
        </div>
        <div class="card">
          <h2>📊 Gold income sources breakdown (K)</h2>
          <div id="chart-gold-sources" class="chart"></div>
        </div>
        <div class="card">
          <h2>👥 Troop sources breakdown</h2>
          <div id="chart-troop-sources" class="chart"></div>
        </div>

        <!-- Spending & Balance -->
        <div class="card">
          <h2>💸 Gold spent: total (K)</h2>
          <div id="chart-gold-spent-total" class="chart"></div>
        </div>
        <div class="card">
          <h2>⚖️ Gold earned: other (residual) (K)</h2>
          <div id="chart-gold-earned-other" class="chart"></div>
        </div>

        <!-- Diplomatic Activity -->
        <div class="card">
          <h2>🤝 Gold donations sent (K)</h2>
          <div id="chart-gold-donations-sent" class="chart"></div>
        </div>
        <div class="card">
          <h2>🎁 Gold donations received (K)</h2>
          <div id="chart-gold-donations-received" class="chart"></div>
        </div>
        <div class="card">
          <h2>👥 Troop donations sent</h2>
          <div id="chart-troop-donations-sent" class="chart"></div>
        </div>
        <div class="card">
          <h2>🛡️ Troop donations received</h2>
          <div id="chart-troop-donations-received" class="chart"></div>
        </div>

      </div>

      <div class="card" style="margin-top: 14px;">
        <h2>Players</h2>
        <div class="muted" style="font-size: 12px; margin: 0 0 10px;">
          Economy totals come from per-tick gold deltas (engine stats + balance changes), sampled every <span class="mono">${report.economy.sampleEveryTurns}</span> turns.
        </div>
        <div class="controls muted">
          <label><input type="checkbox" id="show-humans" checked /> Humans</label>
          <label><input type="checkbox" id="show-bots" /> Bots</label>
          <label><input type="checkbox" id="show-npcs" /> NPCs</label>
          <input type="text" id="player-search" placeholder="filter name / clientID" class="mono" />
        </div>
        <div style="overflow:auto;">
          <table id="players-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Type</th>
                <th>State</th>
                <th>Tiles (end)</th>
                <th>Tiles (max)</th>
                <th>Troops</th>
                <th>Gold (end)</th>
                <th>Earned (total)</th>
                <th>Earned (trade)</th>
                <th>Earned (rail)</th>
                <th>Earned (conquer)</th>
                <th>Earned (other)</th>
                <th>Spent (total)</th>
                <th>Lost (conquest)</th>
                <th>Earned (replay)</th>
                <th>Units</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </main>

    <div id="tooltip" class="tooltip"></div>
    <script>${d3Source}</script>
    <script id="report-data" type="application/json">${safeJson}</script>
    <script>
      const report = JSON.parse(document.getElementById("report-data").textContent);
      const tooltip = document.getElementById("tooltip");
      const fmtMs = (n) => (Number.isFinite(n) ? n.toFixed(3) : "n/a");
      const fmtInt = (n) => (Number.isFinite(n) ? String(Math.round(n)) : "n/a");

      function addKpi(label, value, sub) {
        const el = document.createElement("div");
        el.className = "kpi";
        el.innerHTML =
          '<div class="label">' + label + '</div>' +
          '<div class="value">' + value + '</div>' +
          (sub ? '<div class="sub">' + sub + '</div>' : "");
        return el;
      }

      function showTooltip(x, y, html) {
        tooltip.style.left = x + "px";
        tooltip.style.top = y + "px";
        tooltip.innerHTML = html;
        tooltip.style.display = "block";
      }
      function hideTooltip() { tooltip.style.display = "none"; }

      function renderSummary() {
        const s = report.summary;
        const root = document.getElementById("summary");
        root.innerHTML = "";
        root.appendChild(addKpi("Avg tick execution", fmtMs(s.tickExecutionMs.avg) + " ms", "p50 " + fmtMs(s.tickExecutionMs.p50) + " | p95 " + fmtMs(s.tickExecutionMs.p95) + " | p99 " + fmtMs(s.tickExecutionMs.p99)));
        root.appendChild(addKpi("Max tick execution", fmtMs(s.tickExecutionMs.max) + " ms", ""));
        root.appendChild(addKpi("Total intents", fmtInt(s.intents.total), "avg/tick " + fmtMs(s.intents.avgPerTurn)));
        root.appendChild(addKpi("Hash checks", fmtInt(s.hashChecks.compared) + " compared", fmtInt(s.hashChecks.mismatches) + " mismatches"));
        root.appendChild(addKpi("Warnings", fmtInt(s.warnings.total), "missing client " + fmtInt(s.warnings.missingClientId.total) + " | missing target " + fmtInt(s.warnings.missingTargetId.total)));
      }

      function escapeHtml(s) {
        return String(s)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }

      function renderDiagnostics() {
        const root = document.getElementById("diagnostics");
        if (!root) return;
        const unknown = report.meta.unknownClientIds;
        const w = report.summary.warnings;
        const l = report.summary.logs;

        const parts = [];
        if (unknown.total > 0) {
          const rows = unknown.samples.map((x) => {
            const label = x.clientID + " @turn " + x.firstSeenTurn + (x.hasNonMarkIntent ? " (has intents)" : " (mark-only)");
            return "<li class='mono'>" + escapeHtml(label) + "</li>";
          }).join("");
          parts.push("<div><strong>Unknown clientIDs</strong> <span class='mono'>(" + fmtInt(unknown.total) + ")</span></div>");
          parts.push("<ul style='margin: 6px 0 12px 18px; padding: 0;'>" + rows + "</ul>");
        }

        function warnTable(title, rows) {
          if (!rows || rows.length === 0) return "";
          const tr = rows.map((r) => "<tr><td class='mono'>" + escapeHtml(r.id) + "</td><td class='mono'>" + fmtInt(r.count) + "</td></tr>").join("");
          return (
            "<div style='margin-top: 10px;'><strong>" + escapeHtml(title) + "</strong></div>" +
            "<table style='margin-top: 6px;'><thead><tr><th>ID</th><th>Count</th></tr></thead><tbody>" + tr + "</tbody></table>"
          );
        }

        const missingClientRows = w.missingClientId.top.map((x) => ({ id: x.clientID, count: x.count }));
        const missingTargetRows = w.missingTargetId.top.map((x) => ({ id: x.targetID, count: x.count }));
        parts.push(warnTable("Missing player for clientID", missingClientRows));
        parts.push(warnTable("Missing target player ID", missingTargetRows));

        if (w.other.top.length > 0) {
          const tr = w.other.top
            .map((x) => "<tr><td class='mono'>" + escapeHtml(x.message) + "</td><td class='mono'>" + fmtInt(x.count) + "</td></tr>")
            .join("");
          parts.push(
            "<div style='margin-top: 10px;'><strong>Other warnings</strong></div>" +
            "<table style='margin-top: 6px;'><thead><tr><th>Message</th><th>Count</th></tr></thead><tbody>" + tr + "</tbody></table>",
          );
        }

        function msgTable(title, items) {
          if (!items || items.length === 0) return "";
          const tr = items
            .map((x) => "<tr><td class='mono'>" + escapeHtml(x.message) + "</td><td class='mono'>" + fmtInt(x.count) + "</td></tr>")
            .join("");
          return (
            "<div style='margin-top: 10px;'><strong>" + escapeHtml(title) + "</strong></div>" +
            "<table style='margin-top: 6px;'><thead><tr><th>Message</th><th>Count</th></tr></thead><tbody>" + tr + "</tbody></table>"
          );
        }

        if (l.total > 0) {
          parts.push("<div style='margin-top: 10px;'><strong>Console output</strong> <span class='mono'>(" + fmtInt(l.total) + ")</span></div>");
          parts.push(msgTable("console.log (top)", l.log.top));
          parts.push(msgTable("console.info (top)", l.info.top));
        }

        root.innerHTML = parts.join("");
      }

      function renderLineChart(targetId, series, opts) {
        const target = document.getElementById(targetId);
        target.innerHTML = "";
        const w = target.clientWidth;
        const h = target.clientHeight;
        const margin = { top: 10, right: 14, bottom: 28, left: 46 };
        const innerW = w - margin.left - margin.right;
        const innerH = h - margin.top - margin.bottom;

        const svg = d3.select(target).append("svg").attr("width", w).attr("height", h);
        const g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        const x = d3.scaleLinear().domain(d3.extent(series, (d) => d.x)).range([0, innerW]);
        const yMax = d3.max(series, (d) => d.y) || 0;
        const y = d3.scaleLinear().domain([0, yMax * 1.05]).range([innerH, 0]).nice();

        g.append("g").attr("class", "gridline").call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(""));
        g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
        g.append("g").attr("class", "axis").attr("transform", "translate(0," + innerH + ")").call(d3.axisBottom(x).ticks(6));

        const line = d3.line().x((d) => x(d.x)).y((d) => y(d.y));
        g.append("path").datum(series).attr("fill", "none").attr("stroke", opts.color).attr("stroke-width", 2).attr("d", line);

        const focus = g.append("g").style("display", "none");
        focus.append("line").attr("y1", 0).attr("y2", innerH).attr("stroke", "rgba(255,255,255,0.18)");
        focus.append("circle").attr("r", 4).attr("fill", opts.color).attr("stroke", "#0b1220").attr("stroke-width", 2);

        const bisect = d3.bisector((d) => d.x).left;

        svg.append("rect")
          .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
          .attr("width", innerW).attr("height", innerH).attr("fill", "transparent")
          .on("mouseenter", () => focus.style("display", null))
          .on("mouseleave", () => { focus.style("display", "none"); hideTooltip(); })
          .on("mousemove", (event) => {
            const [mx] = d3.pointer(event);
            const x0 = x.invert(mx);
            let i = bisect(series, x0, 1);
            if (i >= series.length) i = series.length - 1;
            const a = series[i - 1];
            const b = series[i];
            const d = !b ? a : (x0 - a.x > b.x - x0 ? b : a);

            focus.select("line").attr("transform", "translate(" + x(d.x) + ",0)");
            focus.select("circle").attr("transform", "translate(" + x(d.x) + "," + y(d.y) + ")");
            showTooltip(event.clientX, event.clientY, opts.tooltipHtml(d));
          });
      }

      function renderMultiLineChart(targetId, xValues, lines, opts) {
        const target = document.getElementById(targetId);
        if (!target) {
          console.warn("Chart target element not found: " + targetId);
          return;
        }
        target.innerHTML = "";
        if (!xValues || xValues.length === 0 || !lines || lines.length === 0) {
          target.innerHTML = "<div class='muted' style='font-size:12px;'>no data</div>";
          return;
        }

        const w = target.clientWidth;
        const h = target.clientHeight;
        const margin = { top: 10, right: 14, bottom: 28, left: 54 };
        const innerW = w - margin.left - margin.right;
        const innerH = h - margin.top - margin.bottom;

        const svg = d3.select(target).append("svg").attr("width", w).attr("height", h);
        const g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        const x = d3.scaleLinear().domain(d3.extent(xValues)).range([0, innerW]);
        const yMax = d3.max(lines, (s) => d3.max(s.ys || [], (v) => v) || 0) || 0;
        const y = d3.scaleLinear().domain([0, yMax * 1.05]).range([innerH, 0]).nice();

        g.append("g").attr("class", "gridline").call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(""));
        g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
        g.append("g").attr("class", "axis").attr("transform", "translate(0," + innerH + ")").call(d3.axisBottom(x).ticks(6));

        const line = d3.line().x((d) => x(d.x)).y((d) => y(d.y));
        for (const s of lines) {
          const data = xValues.map((turn, i) => ({ x: turn, y: (s.ys && Number.isFinite(s.ys[i]) ? s.ys[i] : 0) }));
          g.append("path")
            .datum(data)
            .attr("fill", "none")
            .attr("stroke", s.color)
            .attr("stroke-width", 2)
            .attr("opacity", 0.95)
            .attr("d", line);
        }

        const legend = g.append("g").attr("transform", "translate(0,0)");
        const legendItems = lines.slice(0, 10);
        legendItems.forEach((s, idx) => {
          const y0 = idx * 14;
          legend.append("rect").attr("x", 0).attr("y", y0 + 1).attr("width", 10).attr("height", 10).attr("fill", s.color);
          legend.append("text").attr("x", 14).attr("y", y0 + 10).attr("fill", "rgba(229,231,235,0.85)").attr("font-size", 11).text(s.label);
        });

        const bisect = d3.bisector((d) => d).left;

        const focus = g.append("g").style("display", "none");
        focus.append("line").attr("y1", 0).attr("y2", innerH).attr("stroke", "rgba(255,255,255,0.18)");
        const dots = focus.selectAll("circle").data(lines).enter().append("circle")
          .attr("r", 3.5)
          .attr("fill", (d) => d.color)
          .attr("stroke", "#0b1220")
          .attr("stroke-width", 2);

        svg.append("rect")
          .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
          .attr("width", innerW).attr("height", innerH).attr("fill", "transparent")
          .on("mouseenter", () => focus.style("display", null))
          .on("mouseleave", () => { focus.style("display", "none"); hideTooltip(); })
          .on("mousemove", (event) => {
            const [mx] = d3.pointer(event);
            const turn = x.invert(mx);
            let i = bisect(xValues, turn, 1);
            if (i >= xValues.length) i = xValues.length - 1;
            const a = xValues[Math.max(0, i - 1)];
            const b = xValues[i] ?? a;
            const idx = (b !== a && (turn - a > b - turn)) ? i : (i - 1);
            const idxClamped = Math.max(0, Math.min(xValues.length - 1, idx));
            const t = xValues[idxClamped];

            focus.select("line").attr("transform", "translate(" + x(t) + ",0)");
            dots
              .attr("cx", x(t))
              .attr("cy", (d) => y((d.ys && Number.isFinite(d.ys[idxClamped]) ? d.ys[idxClamped] : 0)));

            const rows = lines
              .map((d) => ({ label: d.label, value: (d.ys && Number.isFinite(d.ys[idxClamped]) ? d.ys[idxClamped] : 0), color: d.color }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 12)
              .map((r) => "<div><span style='display:inline-block;width:10px;height:10px;border-radius:2px;background:" + r.color + ";margin-right:6px;'></span>" + escapeHtml(r.label) + " <span class='mono'>" + fmtInt(r.value) + "</span></div>")
              .join("");

            showTooltip(event.clientX, event.clientY, "<div>turn <span class='mono'>" + fmtInt(t) + "</span></div><div style='margin-top:6px;'>" + rows + "</div>");
          });
      }

      function renderBarChart(targetId, bars, opts) {
        const target = document.getElementById(targetId);
        target.innerHTML = "";
        const w = target.clientWidth;
        const h = target.clientHeight;
        const margin = { top: 10, right: 14, bottom: 90, left: 46 };
        const innerW = w - margin.left - margin.right;
        const innerH = h - margin.top - margin.bottom;

        const svg = d3.select(target).append("svg").attr("width", w).attr("height", h);
        const g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        const x = d3.scaleBand().domain(bars.map((d) => d.label)).range([0, innerW]).padding(0.15);
        const yMax = d3.max(bars, (d) => d.value) || 0;
        const y = d3.scaleLinear().domain([0, yMax * 1.1]).range([innerH, 0]).nice();

        g.append("g").attr("class", "gridline").call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(""));
        g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
        g.append("g").attr("class", "axis").attr("transform", "translate(0," + innerH + ")").call(d3.axisBottom(x))
          .selectAll("text").attr("text-anchor", "end").attr("transform", "rotate(-35)").attr("dx", "-0.4em").attr("dy", "0.4em");

        g.selectAll("rect.bar").data(bars).enter().append("rect")
          .attr("class", "bar")
          .attr("x", (d) => x(d.label))
          .attr("y", (d) => y(d.value))
          .attr("width", x.bandwidth())
          .attr("height", (d) => innerH - y(d.value))
          .attr("fill", opts.color)
          .on("mouseenter", (event, d) => showTooltip(event.clientX, event.clientY, opts.tooltipHtml(d)))
          .on("mouseleave", () => hideTooltip());
      }

      function renderPlayersTable() {
        const tbody = document.querySelector("#players-table tbody");
        tbody.innerHTML = "";

        const showHumans = document.getElementById("show-humans")?.checked ?? true;
        const showBots = document.getElementById("show-bots")?.checked ?? false;
        const showNpcs = document.getElementById("show-npcs")?.checked ?? false;
        const query = (document.getElementById("player-search")?.value ?? "").trim().toLowerCase();

        const allowed = new Set();
        if (showHumans) allowed.add("HUMAN");
        if (showBots) allowed.add("BOT");
        if (showNpcs) allowed.add("FAKEHUMAN");

        const filtered = report.players
          .filter((p) => allowed.has(p.type))
          .filter((p) => {
            if (!query) return true;
            const name = (p.displayName || p.name || "").toLowerCase();
            const cid = (p.clientID || "").toLowerCase();
            return name.includes(query) || cid.includes(query);
          })
          .sort((a, b) => (b.tilesOwnedMax - a.tilesOwnedMax) || (b.tilesOwned - a.tilesOwned));

        for (const p of filtered) {
          const units = Object.entries(p.unitsOwned).sort((a, b) => b[1] - a[1]).map(([t, c]) => t + ": " + c).join(", ");
          const tr = document.createElement("tr");
          tr.innerHTML =
            "<td><div><strong>" + (p.displayName || p.name) + "</strong></div><div class='mono muted'>" + (p.clientID ?? "null") + "</div></td>" +
            "<td class='mono'>" + p.type + "</td>" +
            "<td>" + (p.isAlive ? "alive" : "dead") + (p.isDisconnected ? " | disconnected" : "") + "</td>" +
            "<td class='mono'>" + p.tilesOwned + "</td>" +
            "<td class='mono'>" + p.tilesOwnedMax + "</td>" +
            "<td class='mono'>" + p.troops + "</td>" +
            "<td class='mono'>" + p.gold + "</td>" +
            "<td class='mono'>" + (p.goldEarnedTotal ?? "—") + "</td>" +
            "<td class='mono'>" + (p.goldEarnedTradeTotal ?? "—") + "</td>" +
            "<td class='mono'>" + (p.goldEarnedTrainTotal ?? "—") + "</td>" +
            "<td class='mono'>" + (p.goldEarnedConquerTotal ?? "—") + "</td>" +
            "<td class='mono'>" + (p.goldEarnedOtherTotal ?? "—") + "</td>" +
            "<td class='mono'>" + (p.goldSpentTotal ?? "—") + "</td>" +
            "<td class='mono'>" + (p.goldLostConquestTotal ?? "—") + "</td>" +
            "<td class='mono'>" + (p.goldEarnedReplayTotal ?? "—") + "</td>" +
            "<td class='muted'>" + (units || "—") + "</td>";
          tbody.appendChild(tr);
        }
      }

      function renderAll() {
        renderSummary();
        renderDiagnostics();
        const s = report.samples;
        renderLineChart("chart-tick-ms", s.map((d) => ({ x: d.turnNumber, y: d.tickExecutionMs })), {
          color: "#60a5fa",
          tooltipHtml: (d) => "turn <span class='mono'>" + d.x + "</span><br/>tick execution <span class='mono'>" + fmtMs(d.y) + " ms</span>",
        });
        renderLineChart("chart-intents", s.map((d) => ({ x: d.turnNumber, y: d.intents })), {
          color: "#fbbf24",
          tooltipHtml: (d) => "turn <span class='mono'>" + d.x + "</span><br/>intents <span class='mono'>" + fmtInt(d.y) + "</span>",
        });
        renderLineChart("chart-players", s.map((d) => ({ x: d.turnNumber, y: d.aliveHumans })), {
          color: "#34d399",
          tooltipHtml: (d) => {
            const sample = report.samples.find((x) => x.turnNumber === d.x);
            const extra = sample ? ("<br/>connected alive <span class='mono'>" + sample.connectedAliveHumans + "</span><br/>spawned <span class='mono'>" + sample.spawnedHumans + "</span>") : "";
            return "turn <span class='mono'>" + d.x + "</span><br/>alive humans <span class='mono'>" + fmtInt(d.y) + "</span>" + extra;
          },
        });

        const humans = report.players.filter((p) => p.type === "HUMAN");
        const bars = humans
          .map((p) => ({
            label: p.displayName || p.name,
            value: p.tilesOwnedMax,
            tilesEnd: p.tilesOwned,
            tilesMax: p.tilesOwnedMax,
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 30);
        renderBarChart("chart-tiles", bars, {
          color: "#a78bfa",
          tooltipHtml: (d) =>
            "<strong>" +
            d.label +
            "</strong><br/>tiles max <span class='mono'>" +
            d.tilesMax +
            "</span><br/>tiles end <span class='mono'>" +
            d.tilesEnd +
            "</span>",
        });

        const econ = report.economy;
        if (econ && econ.turns && econ.turns.length > 0 && econ.players && econ.players.length > 0) {
          const labelByClientId = new Map(econ.players.map((p) => [p.clientID, p.displayName]));
          const colors = d3.schemeTableau10 || ["#60a5fa", "#fbbf24", "#34d399", "#a78bfa", "#fb7185", "#22c55e", "#f97316", "#e879f9", "#38bdf8", "#facc15"];
          const mkLines = (metric, ids) => (ids || []).map((cid, idx) => ({
            id: cid,
            label: labelByClientId.get(cid) || cid,
            color: colors[idx % colors.length],
            ys: (econ.seriesByClientId && econ.seriesByClientId[cid] && econ.seriesByClientId[cid][metric]) ? econ.seriesByClientId[cid][metric] : [],
          }));

          // Create aggregated lines from detailed gold sources
          const aggregateGoldSources = (filterFn, topIds) => {
            return (topIds || []).map((cid, idx) => {
              const result = {
                id: cid,
                label: labelByClientId.get(cid) || cid,
                color: colors[idx % colors.length],
                ys: []
              };
              for (let turnIdx = 0; turnIdx < econ.turns.length; turnIdx++) {
                let total = 0;
                if (econ.goldSourceSeriesByClientId[cid]) {
                  const sourceData = econ.goldSourceSeriesByClientId[cid];
                  for (const func in sourceData) {
                    if (filterFn(func) && sourceData[func][turnIdx] !== undefined) {
                      total += sourceData[func][turnIdx];
                    }
                  }
                }
                result.ys.push(total);
              }
              return result;
            });
          };

          renderMultiLineChart("chart-gold-earned-trade", econ.turns, aggregateGoldSources(
            (func) => func.includes('TradeShip'), econ.top.earnedTrade), {});
          renderMultiLineChart("chart-gold-earned-train", econ.turns, aggregateGoldSources(
            (func) => func.includes('StopHandler') || func.includes('TrainStation'), econ.top.earnedTrain), {});
          renderMultiLineChart("chart-gold-earned-conquer", econ.turns, aggregateGoldSources(
            (func) => func.includes('conquer'), econ.top.earnedConquer), {});
          renderMultiLineChart("chart-gold-earned-other", econ.turns, aggregateGoldSources(
            (func) => !func.includes('TradeShip') && !func.includes('StopHandler') && !func.includes('TrainStation') && !func.includes('conquer') && !func.includes('Troop') && !func.includes('ConstructionExecution') && !func.includes('donateGold'), econ.top.earnedOther), {});
          renderMultiLineChart("chart-gold-spent-total", econ.turns, mkLines("spentTotal", econ.top.spentTotal), {});

          renderMultiLineChart("chart-gold-donations-sent", econ.turns, mkLines("sentGoldDonations", econ.top.sentGoldDonations), {});
          renderMultiLineChart("chart-gold-donations-received", econ.turns, mkLines("receivedGoldDonations", econ.top.receivedGoldDonations), {});
          renderMultiLineChart("chart-troop-donations-sent", econ.turns, mkLines("sentTroopDonations", econ.top.sentTroopDonations), {});
          renderMultiLineChart("chart-troop-donations-received", econ.turns, mkLines("receivedTroopDonations", econ.top.receivedTroopDonations), {});
          renderMultiLineChart("chart-tiles-owned", econ.turns, mkLines("tilesOwned", Object.keys(econ.seriesByClientId)), {});

          // Render gold sources by function (raw function names for maximum detail)
          if (econ.goldSourceSeriesByClientId) {
            const allFunctions = new Set();
            for (const clientId of Object.keys(econ.goldSourceSeriesByClientId)) {
              for (const func of Object.keys(econ.goldSourceSeriesByClientId[clientId])) {
                // Only include gold-related sources, exclude troop donations and construction
                if (!func.includes('Troop') && !func.includes('ConstructionExecution')) {
                  allFunctions.add(func);
                }
              }
            }

            const sourceLines = Array.from(allFunctions).map((func, idx) => ({
              id: func,
              label: func,
              color: colors[idx % colors.length],
              ys: econ.turns.map((_, turnIdx) => {
                let total = 0;
                for (const clientId of Object.keys(econ.goldSourceSeriesByClientId)) {
                  const series = econ.goldSourceSeriesByClientId[clientId][func];
                  if (series && series[turnIdx] !== undefined) {
                    total += series[turnIdx];
                  }
                }
                return total;
              }),
            }));

            renderMultiLineChart("chart-gold-sources", econ.turns, sourceLines, {});
          }

          // Render troop sources by function
          if (econ.troopSourceSeriesByClientId) {
            const allTroopFunctions = new Set();
            for (const clientId of Object.keys(econ.troopSourceSeriesByClientId)) {
              for (const func of Object.keys(econ.troopSourceSeriesByClientId[clientId])) {
                allTroopFunctions.add(func);
              }
            }

            const troopSourceLines = Array.from(allTroopFunctions).map((func, idx) => ({
              id: func,
              label: func,
              color: colors[idx % colors.length],
              ys: econ.turns.map((_, turnIdx) => {
                let total = 0;
                for (const clientId of Object.keys(econ.troopSourceSeriesByClientId)) {
                  const series = econ.troopSourceSeriesByClientId[clientId][func];
                  if (series && series[turnIdx] !== undefined) {
                    total += series[turnIdx];
                  }
                }
                return total;
              }),
            }));

            renderMultiLineChart("chart-troop-sources", econ.turns, troopSourceLines, {});
          }
        }

        renderPlayersTable();
      }

      let controlsInitialized = false;
      function initControls() {
        if (controlsInitialized) return;
        controlsInitialized = true;

        const reRenderTable = () => renderPlayersTable();
        for (const id of ["show-humans", "show-bots", "show-npcs"]) {
          document.getElementById(id)?.addEventListener("change", reRenderTable, { passive: true });
        }
        document.getElementById("player-search")?.addEventListener("input", reRenderTable, { passive: true });
      }

      renderAll();
      initControls();
      window.addEventListener("resize", () => renderAll(), { passive: true });
    </script>
  </body>
</html>`;
}

