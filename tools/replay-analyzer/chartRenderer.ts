// Chart rendering logic for replay analyzer HTML reports
// This file is compiled to JavaScript and included in the HTML report

interface ReplayPerfReport {
  meta: {
    gameID: string;
    replayPath?: string;
    apiBase: string;
    replayGitCommit?: string;
    map: string;
    mapSize: string;
    numTurns: number;
    numTicksSimulated: number;
    unknownClientIds: {
      total: number;
      withNonMarkIntents: number;
      markOnly: number;
      samples: Array<{
        clientID: string;
        firstSeenTurn: number;
        hasNonMarkIntent: boolean;
      }>;
    };
    generatedAt: string;
  };
  summary: {
    tickExecutionMs: {
      avg: number;
      max: number;
      p50: number;
      p95: number;
      p99: number;
    };
    intents: {
      total: number;
      avgPerTurn: number;
    };
    hashChecks: {
      compared: number;
      mismatches: number;
    };
    warnings: {
      total: number;
      missingClientId: {
        total: number;
        top: Array<{ clientID: string; count: number }>;
      };
      missingTargetId: {
        total: number;
        top: Array<{ targetID: string; count: number }>;
      };
      other: {
        top: Array<{ message: string; count: number }>;
      };
    };
    logs: {
      total: number;
      log: { top: Array<{ message: string; count: number }> };
      info: { top: Array<{ message: string; count: number }> };
    };
  };
  samples: Array<{
    turnNumber: number;
    tickExecutionMs: number;
    intents: number;
    aliveHumans: number;
    connectedAliveHumans: number;
    spawnedHumans: number;
  }>;
  economy: {
    sampleEveryTurns: number;
    turns: number[];
    players: Array<{
      clientID: string;
      displayName: string;
    }>;
    top: {
      earnedTrade: string[];
      earnedTrain: string[];
      earnedConquer: string[];
      earnedOther: string[];
      spentTotal: string[];
      sentGoldDonations: string[];
      receivedGoldDonations: string[];
      sentTroopDonations: string[];
      receivedTroopDonations: string[];
    };
    seriesByClientId: Record<string, Record<string, number[]>>;
    goldSourceSeriesByClientId: Record<string, Record<string, number[]>>;
    troopSourceSeriesByClientId: Record<string, Record<string, number[]>>;
  };
  players: Array<{
    clientID?: string;
    name: string;
    displayName?: string;
    type: string;
    isAlive: boolean;
    isDisconnected: boolean;
    tilesOwned: number;
    tilesOwnedMax: number;
    troops: number;
    gold: number;
    goldEarnedTotal?: number;
    goldEarnedTradeTotal?: number;
    goldEarnedTrainTotal?: number;
    goldEarnedConquerTotal?: number;
    goldEarnedOtherTotal?: number;
    goldSpentTotal?: number;
    goldLostConquestTotal?: number;
    goldEarnedReplayTotal?: number;
    unitsOwned: Record<string, number>;
  }>;
}

declare const d3: any;

const report: ReplayPerfReport = JSON.parse(document.getElementById("report-data")!.textContent!);
const tooltip = document.getElementById("tooltip")!;

// Timeline state
let timelineStartTurn = 1;
let timelineEndTurn = report.meta.numTicksSimulated;
let timelineInitialized = false;

const fmtMs = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "n/a");
const fmtInt = (n: number) => (Number.isFinite(n) ? String(Math.round(n)) : "n/a");
const fmtGold = (n: number) => (Number.isFinite(n) ? String(Math.round(n / 1000)) : "n/a");

function addKpi(label: string, value: string, sub?: string) {
  const el = document.createElement("div");
  el.className = "kpi";
  el.innerHTML =
    '<div class="label">' + label + '</div>' +
    '<div class="value">' + value + '</div>' +
    (sub ? '<div class="sub">' + sub + '</div>' : "");
  return el;
}

function showTooltip(x: number, y: number, html: string) {
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
  tooltip.innerHTML = html;
  tooltip.style.display = "block";
}

function hideTooltip() {
  tooltip.style.display = "none";
}

function updateTimelineDisplay() {
  const display = document.getElementById("timeline-range-display")!;
  if (timelineStartTurn === 1 && timelineEndTurn === report.meta.numTurns) {
    display.textContent = "All turns";
  } else {
    display.textContent = `Turns ${timelineStartTurn} - ${timelineEndTurn}`;
  }
}

function filterSamplesByTimeline(samples: Array<{ turnNumber: number; [key: string]: any }>) {
  return samples.filter(d => d.turnNumber >= timelineStartTurn && d.turnNumber <= timelineEndTurn);
}

function filterEconomyDataByTimeline(turns: number[], seriesData: Record<string, Record<string, number[]>>) {
  const startIdx = turns.findIndex(t => t >= timelineStartTurn);
  let endIdx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i] <= timelineEndTurn) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    return { filteredTurns: [], filteredSeries: {} };
  }

  const filteredTurns = turns.slice(startIdx, endIdx + 1);
  const filteredSeries: Record<string, Record<string, number[]>> = {};

  for (const [clientId, series] of Object.entries(seriesData)) {
    filteredSeries[clientId] = {};
    for (const [metric, values] of Object.entries(series)) {
      filteredSeries[clientId][metric] = values.slice(startIdx, endIdx + 1);
    }
  }

  return { filteredTurns, filteredSeries };
}

function calculateFilteredPlayerStats() {
  const econ = report.economy;
  if (!econ || !econ.turns || econ.turns.length === 0 || !econ.players || econ.players.length === 0) {
    return report.players; // Return original data if no economy data
  }

  const { filteredTurns, filteredSeries } = filterEconomyDataByTimeline(econ.turns, econ.seriesByClientId);
  const isTimelineFiltered = timelineStartTurn !== 1 || timelineEndTurn !== report.meta.numTicksSimulated;

  if (!isTimelineFiltered) {
    return report.players; // Return original data if timeline shows full range
  }

  const labelByClientId = new Map(econ.players.map((p) => [p.clientID, p.displayName]));

  // Create filtered stats for each player
  return report.players.map((player) => {
    const clientId = player.clientID;
    if (!clientId || !filteredSeries[clientId]) {
      // Return original player data if no series data available
      return player;
    }

    const series = filteredSeries[clientId];

    // Calculate sums for the filtered period
    const sumSeries = (seriesName: string) => {
      const data = series[seriesName];
      return data ? data.reduce((sum, val) => sum + val, 0) : 0;
    };

    // Get final/max values for the filtered period
    const tilesOwned = series.tilesOwned;
    const tilesOwnedEnd = tilesOwned ? tilesOwned[tilesOwned.length - 1] : player.tilesOwned;
    const tilesOwnedMax = tilesOwned ? Math.max(...tilesOwned) : player.tilesOwnedMax;

    // Calculate earned/spent totals for filtered period
    const goldEarnedTradeTotal = sumSeries("earnedTrade");
    const goldEarnedTrainTotal = sumSeries("earnedTrain");
    const goldEarnedConquerTotal = sumSeries("earnedConquer");
    const goldEarnedOtherTotal = sumSeries("earnedOther");
    const goldSpentTotal = sumSeries("spentTotal");
    const goldLostConquestTotal = sumSeries("lostConquest");
    const goldEarnedTotal = goldEarnedTradeTotal + goldEarnedTrainTotal + goldEarnedConquerTotal + goldEarnedOtherTotal;

    return {
      ...player,
      // Update timeline-dependent fields
      tilesOwned: tilesOwnedEnd,
      tilesOwnedMax: tilesOwnedMax,
      goldEarnedTotal: goldEarnedTotal,
      goldEarnedTradeTotal: goldEarnedTradeTotal,
      goldEarnedTrainTotal: goldEarnedTrainTotal,
      goldEarnedConquerTotal: goldEarnedConquerTotal,
      goldEarnedOtherTotal: goldEarnedOtherTotal,
      goldSpentTotal: goldSpentTotal,
      goldLostConquestTotal: goldLostConquestTotal,
      // Keep other fields as-is since we don't have time-series data for them
      // (troops, gold, unitsOwned, etc.)
    };
  });
}

function initTimelineControls() {
  if (timelineInitialized) return;
  timelineInitialized = true;

  const startInput = document.getElementById("timeline-start") as HTMLInputElement;
  const endInput = document.getElementById("timeline-end") as HTMLInputElement;
  const resetButton = document.getElementById("timeline-reset") as HTMLButtonElement;

  if (!startInput || !endInput || !resetButton) return;

  // Set initial values
  startInput.min = "1";
  startInput.max = report.meta.numTicksSimulated.toString();
  startInput.value = timelineStartTurn.toString();

  endInput.min = "1";
  endInput.max = report.meta.numTicksSimulated.toString();
  endInput.value = timelineEndTurn.toString();

  updateTimelineDisplay();

  const updateTimeline = () => {
    const newStart = parseInt(startInput.value);
    const newEnd = parseInt(endInput.value);

    // Ensure start <= end
    if (newStart > newEnd) {
      if (startInput === document.activeElement) {
        endInput.value = newStart.toString();
        timelineEndTurn = newStart;
      } else {
        startInput.value = newEnd.toString();
        timelineStartTurn = newEnd;
      }
    } else {
      timelineStartTurn = newStart;
      timelineEndTurn = newEnd;
    }

    updateTimelineDisplay();
    renderAll();
  };

  const resetTimeline = () => {
    timelineStartTurn = 1;
    timelineEndTurn = report.meta.numTicksSimulated;
    startInput.value = timelineStartTurn.toString();
    endInput.value = timelineEndTurn.toString();
    updateTimelineDisplay();
    renderAll();
  };

  startInput.addEventListener("input", updateTimeline);
  endInput.addEventListener("input", updateTimeline);
  resetButton.addEventListener("click", resetTimeline);
}

function renderSummary() {
  const s = report.summary;
  const root = document.getElementById("summary")!;
  root.innerHTML = "";
  root.appendChild(addKpi("Avg tick execution", fmtMs(s.tickExecutionMs.avg) + " ms", "p50 " + fmtMs(s.tickExecutionMs.p50) + " | p95 " + fmtMs(s.tickExecutionMs.p95) + " | p99 " + fmtMs(s.tickExecutionMs.p99)));
  root.appendChild(addKpi("Max tick execution", fmtMs(s.tickExecutionMs.max) + " ms", ""));
  root.appendChild(addKpi("Total intents", fmtInt(s.intents.total), "avg/tick " + fmtMs(s.intents.avgPerTurn)));
  root.appendChild(addKpi("Hash checks", fmtInt(s.hashChecks.compared) + " compared", fmtInt(s.hashChecks.mismatches) + " mismatches"));
  root.appendChild(addKpi("Warnings", fmtInt(s.warnings.total), "missing client " + fmtInt(s.warnings.missingClientId.total) + " | missing target " + fmtInt(s.warnings.missingTargetId.total)));
}

function escapeHtml(s: string) {
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

  const parts: string[] = [];
  if (unknown.total > 0) {
    const rows = unknown.samples.map((x) => {
      const label = x.clientID + " @turn " + x.firstSeenTurn + (x.hasNonMarkIntent ? " (has intents)" : " (mark-only)");
      return "<li class='mono'>" + escapeHtml(label) + "</li>";
    }).join("");
    parts.push("<div><strong>Unknown clientIDs</strong> <span class='mono'>(" + fmtInt(unknown.total) + ")</span></div>");
    parts.push("<ul style='margin: 6px 0 12px 18px; padding: 0;'>" + rows + "</ul>");
  }

  function warnTable(title: string, rows: Array<{ id: string; count: number }>) {
    if (!rows || rows.length === 0) return "";
    const tr = rows.map((r) => "<tr><td class='mono'>" + escapeHtml(r.id) + "</td><td class='mono'>" + fmtInt(r.count) + "</tr>").join("");
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

  function msgTable(title: string, items: Array<{ message: string; count: number }>) {
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

function renderLineChart(targetId: string, series: Array<{ x: number; y: number }>, opts: { color: string; tooltipHtml: (d: { x: number; y: number }) => string }) {
  const target = document.getElementById(targetId)!;
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

  const bisect = d3.bisector((d: { x: number; y: number }) => d.x).left;

  svg.append("rect")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
    .attr("width", innerW).attr("height", innerH).attr("fill", "transparent")
    .on("mouseenter", () => focus.style("display", null))
    .on("mouseleave", () => { focus.style("display", "none"); hideTooltip(); })
    .on("mousemove", (event: MouseEvent) => {
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

function renderMultiLineChart(targetId: string, xValues: number[], lines: Array<{ id: string; label: string; color: string; ys: number[] }>, opts: { valueFormatter?: (n: number) => string }) {
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

  const bisect = d3.bisector((d: number) => d).left;

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
    .on("mousemove", (event: MouseEvent) => {
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

      const formatter = opts.valueFormatter || fmtInt;
      const rows = lines
        .map((d) => ({ label: d.label, value: (d.ys && Number.isFinite(d.ys[idxClamped]) ? d.ys[idxClamped] : 0), color: d.color }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12)
        .map((r) => "<div><span style='display:inline-block;width:10px;height:10px;border-radius:2px;background:" + r.color + ";margin-right:6px;'></span>" + escapeHtml(r.label) + " <span class='mono'>" + formatter(r.value) + "</span></div>")
        .join("");

      showTooltip(event.clientX, event.clientY, "<div>turn <span class='mono'>" + fmtInt(t) + "</span></div><div style='margin-top:6px;'>" + rows + "</div>");
    });
}

function renderBarChart(targetId: string, bars: Array<{ label: string; value: number; tilesEnd: number; tilesMax: number }>, opts: { color: string; tooltipHtml: (d: { label: string; value: number; tilesEnd: number; tilesMax: number }) => string }) {
  const target = document.getElementById(targetId)!;
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
    .attr("x", (d) => x(d.label)!)
    .attr("y", (d) => y(d.value))
    .attr("width", x.bandwidth())
    .attr("height", (d) => innerH - y(d.value))
    .attr("fill", opts.color)
    .on("mouseenter", (event: MouseEvent, d: { label: string; value: number; tilesEnd: number; tilesMax: number }) => showTooltip(event.clientX, event.clientY, opts.tooltipHtml(d)))
    .on("mouseleave", () => hideTooltip());
}

function renderPlayersTable() {
  const tbody = document.querySelector("#players-table tbody") as HTMLTableSectionElement;
  tbody.innerHTML = "";

  const showHumans = (document.getElementById("show-humans") as HTMLInputElement)?.checked ?? true;
  const showBots = (document.getElementById("show-bots") as HTMLInputElement)?.checked ?? false;
  const showNpcs = (document.getElementById("show-npcs") as HTMLInputElement)?.checked ?? false;
  const query = ((document.getElementById("player-search") as HTMLInputElement)?.value ?? "").trim().toLowerCase();

  const allowed = new Set<string>();
  if (showHumans) allowed.add("HUMAN");
  if (showBots) allowed.add("BOT");
  if (showNpcs) allowed.add("FAKEHUMAN");

  // Use filtered player stats when timeline is active
  const playersData = calculateFilteredPlayerStats();

  // Update header info to show timeline filtering status
  const headerInfo = document.getElementById("players-header-info")!;
  const isTimelineFiltered = timelineStartTurn !== 1 || timelineEndTurn !== report.meta.numTicksSimulated;
  const baseText = `Economy totals come from per-tick gold deltas (engine stats + balance changes), sampled every <span class="mono">${report.economy.sampleEveryTurns}</span> turns.`;
  const timelineNote = isTimelineFiltered ? ` <span class="mono" style="color: #fbbf24;">Showing data for turns ${timelineStartTurn}-${timelineEndTurn} only.</span>` : "";
  headerInfo.innerHTML = baseText + timelineNote;

  const filtered = playersData
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
  const s = filterSamplesByTimeline(report.samples);
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
    const { filteredTurns, filteredSeries } = filterEconomyDataByTimeline(econ.turns, econ.seriesByClientId);
    const labelByClientId = new Map(econ.players.map((p) => [p.clientID, p.displayName]));
    const colors = d3.schemeTableau10 || ["#60a5fa", "#fbbf24", "#34d399", "#a78bfa", "#fb7185", "#22c55e", "#f97316", "#e879f9", "#38bdf8", "#facc15"];
    const mkLines = (metric: string, ids: string[]) => (ids || []).map((cid, idx) => ({
      id: cid,
      label: labelByClientId.get(cid) || cid,
      color: colors[idx % colors.length],
      ys: (filteredSeries && filteredSeries[cid] && filteredSeries[cid][metric]) ? filteredSeries[cid][metric] : [],
    }));

    // Create aggregated lines from detailed gold sources
    const aggregateGoldSources = (filterFn: (func: string) => boolean, topIds: string[]) => {
      return (topIds || []).map((cid, idx) => {
        const result = {
          id: cid,
          label: labelByClientId.get(cid) || cid,
          color: colors[idx % colors.length],
          ys: [] as number[]
        };
        for (let turnIdx = 0; turnIdx < filteredTurns.length; turnIdx++) {
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

    renderMultiLineChart("chart-gold-earned-trade", filteredTurns, aggregateGoldSources(
      (func) => func.includes('TradeShip'), econ.top.earnedTrade), { valueFormatter: fmtGold });
    renderMultiLineChart("chart-gold-earned-train", filteredTurns, aggregateGoldSources(
      (func) => func.includes('StopHandler') || func.includes('TrainStation'), econ.top.earnedTrain), { valueFormatter: fmtGold });
    renderMultiLineChart("chart-gold-earned-conquer", filteredTurns, aggregateGoldSources(
      (func) => func.includes('conquer'), econ.top.earnedConquer), { valueFormatter: fmtGold });
    renderMultiLineChart("chart-gold-earned-other", filteredTurns, aggregateGoldSources(
      (func) => !func.includes('TradeShip') && !func.includes('StopHandler') && !func.includes('TrainStation') && !func.includes('conquer') && !func.includes('Troop') && !func.includes('ConstructionExecution') && !func.includes('donateGold'), econ.top.earnedOther), { valueFormatter: fmtGold });
    renderMultiLineChart("chart-gold-spent-total", filteredTurns, mkLines("spentTotal", econ.top.spentTotal), { valueFormatter: fmtGold });

    renderMultiLineChart("chart-gold-donations-sent", filteredTurns, mkLines("sentGoldDonations", econ.top.sentGoldDonations), { valueFormatter: fmtGold });
    renderMultiLineChart("chart-gold-donations-received", filteredTurns, mkLines("receivedGoldDonations", econ.top.receivedGoldDonations), { valueFormatter: fmtGold });
    renderMultiLineChart("chart-troop-donations-sent", filteredTurns, mkLines("sentTroopDonations", econ.top.sentTroopDonations), {});
    renderMultiLineChart("chart-troop-donations-received", filteredTurns, mkLines("receivedTroopDonations", econ.top.receivedTroopDonations), {});
    renderMultiLineChart("chart-tiles-owned", filteredTurns, mkLines("tilesOwned", Object.keys(filteredSeries)), {});

    // Render gold sources by function (raw function names for maximum detail)
    if (econ.goldSourceSeriesByClientId && filteredTurns.length > 0) {
      const allFunctions = new Set<string>();
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
        ys: filteredTurns.map((_, turnIdx) => {
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

      renderMultiLineChart("chart-gold-sources", filteredTurns, sourceLines, { valueFormatter: fmtGold });
    }

    // Render troop sources by function
    if (econ.troopSourceSeriesByClientId && filteredTurns.length > 0) {
      const allTroopFunctions = new Set<string>();
      for (const clientId of Object.keys(econ.troopSourceSeriesByClientId)) {
        for (const func of Object.keys(econ.troopSourceSeriesByClientId[clientId])) {
          allTroopFunctions.add(func);
        }
      }

      const troopSourceLines = Array.from(allTroopFunctions).map((func, idx) => ({
        id: func,
        label: func,
        color: colors[idx % colors.length],
        ys: filteredTurns.map((_, turnIdx) => {
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

      renderMultiLineChart("chart-troop-sources", filteredTurns, troopSourceLines, {});
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
initTimelineControls();
window.addEventListener("resize", () => renderAll(), { passive: true });
