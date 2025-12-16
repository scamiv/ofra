import fs from "node:fs/promises";
import inspector from "node:inspector";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs, usage } from "./args";
import { createConsoleCapture } from "./consoleCapture";
import { createEconomyTracker } from "./economyTracker";
import { checkoutOpenFrontCommit, ensureGameDepsInstalled } from "./openfrontCheckout";
import { loadOpenFrontRuntime } from "./openfrontLoader";
import { summarizePlayers } from "./playerSummary";
import { loadReplay } from "./replayLoader";
import { reportHtml } from "./reportHtml";
import { simulateReplay } from "./simulateReplay";
import type { ReplayPerfReport } from "./types";
import { percentile } from "./utils";

// Some core code uses global performance.
if (globalThis.performance === undefined) {
  (globalThis as unknown as { performance: typeof performance }).performance = performance;
}

async function extractReplayGitCommit(absoluteReplayPath: string): Promise<string | null> {
  const raw = await fs.readFile(absoluteReplayPath, "utf8");
  const json = JSON.parse(raw.replace(/^\uFEFF/, ""));
  return typeof json?.gitCommit === "string" ? json.gitCommit : null;
}

const replayIdRegex = /^[a-zA-Z0-9]{8}$/;
async function resolveReplayInputToPath(opts: {
  replayInput: string;
  apiBase: string;
  repoRoot: string;
  log?: (msg: string) => void;
}): Promise<string> {
  const log = opts.log ?? (() => {});
  const asPath = path.resolve(process.cwd(), opts.replayInput);
  try {
    await fs.access(asPath);
    return asPath;
  } catch {
    // continue
  }

  if (!replayIdRegex.test(opts.replayInput)) {
    throw new Error(`Replay not found on disk and not a valid gameID: ${opts.replayInput}`);
  }

  const apiBase = opts.apiBase.replace(/\/+$/, "");
  const url = `${apiBase}/game/${opts.replayInput}`;
  log(`fetching replay: ${url}`);
  const res = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to fetch replay ${opts.replayInput} (${res.status} ${res.statusText}): ${text}`);
  }

  const outDir = path.join(opts.repoRoot, "replays");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${opts.replayInput}.json`);
  await fs.writeFile(outPath, text, "utf8");
  return outPath;
}

async function firstExistingPath(paths: string[]): Promise<string> {
  for (const p of paths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // continue
    }
  }
  throw new Error(`File not found (tried):\n${paths.map((p) => `- ${p}`).join("\n")}`);
}

function inspectorPost<T>(
  session: inspector.Session,
  method: string,
  params: Record<string, any> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, params, (err, result) => {
      if (err) reject(err);
      else resolve(result as T);
    });
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const analyzerRoot = path.resolve(__dirname);
const repoRoot = path.resolve(analyzerRoot, "../..");

const {
  replayPath,
  outPath,
  maxTurns,
  economySampleEvery,
  help,
  verbose,
  openfrontRoot,
  repoUrl,
  cacheDir,
  install,
  apiBase,
  cpuProfile,
  compareAgainst,
} = parseArgs(process.argv.slice(2));
if (help || !replayPath) {
  console.log(usage());
  process.exit(help ? 0 : 1);
}

const rawLog = console.log.bind(console);

const absoluteReplayPath = await resolveReplayInputToPath({
  replayInput: replayPath,
  apiBase,
  repoRoot,
  log: rawLog,
});
const replayGitCommit = await extractReplayGitCommit(absoluteReplayPath);
if (replayGitCommit !== null && !/^[0-9a-f]{40}$/i.test(replayGitCommit)) {
  throw new Error(`Invalid replay gitCommit (expected 40-hex SHA): ${replayGitCommit}`);
}

// Handle comparison mode
if (compareAgainst) {
  if (!replayGitCommit) {
    throw new Error("Cannot compare commits: replay missing gitCommit. Replay must be recorded with a git commit.");
  }
  if (!/^[0-9a-f]{40}$/i.test(compareAgainst)) {
    throw new Error(`Invalid --compareAgainst commit (expected 40-hex SHA): ${compareAgainst}`);
  }

  const { compareCommits } = await import("./compareCommits");
  const { comparisonReportHtml } = await import("./reportHtml");

  const comparison = await compareCommits(
    absoluteReplayPath,
    replayGitCommit,
    compareAgainst,
    {
      maxTurns,
      economySampleEvery,
      verbose,
      cpuProfile,
      repoUrl,
      cacheDir,
      install,
      apiBase,
      repoRoot,
    }
  );

  // Generate comparison report
  const d3Path = await firstExistingPath([
    path.join(repoRoot, "node_modules", "d3", "dist", "d3.min.js"),
    // Use reference commit's d3 since we're already using that checkout
    path.join(path.dirname(comparison.referenceReport.meta.replayPath), "../../node_modules", "d3", "dist", "d3.min.js"),
  ]);

  const d3Source = await fs.readFile(d3Path, "utf8");
  const defaultOutDir = path.join(repoRoot, "replays", "out");
  await fs.mkdir(defaultOutDir, { recursive: true });

  const replayBase = path.basename(absoluteReplayPath).replace(/[^a-zA-Z0-9_.-]+/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  
  const refCommitShort = replayGitCommit.substring(0, 8);
  const cmpCommitShort = compareAgainst.substring(0, 8);

  // Write individual reference report
  const referenceReportPath = path.join(
    defaultOutDir,
    `${replayBase}.${timestamp}.ref-${refCommitShort}.report.html`,
  );
  const referenceHtml = reportHtml(d3Source, comparison.referenceReport);
  await fs.writeFile(referenceReportPath, referenceHtml, "utf8");

  // Write individual comparison report
  const comparisonReportPath = path.join(
    defaultOutDir,
    `${replayBase}.${timestamp}.cmp-${cmpCommitShort}.report.html`,
  );
  const comparisonIndividualHtml = reportHtml(d3Source, comparison.comparisonReport);
  await fs.writeFile(comparisonReportPath, comparisonIndividualHtml, "utf8");

  // Write side-by-side comparison report
  const comparisonSummaryPath = outPath 
    ? path.resolve(process.cwd(), outPath) 
    : path.join(defaultOutDir, `${replayBase}.${timestamp}.comparison.html`);
  const comparisonSummaryHtml = comparisonReportHtml(d3Source, comparison);
  await fs.writeFile(comparisonSummaryPath, comparisonSummaryHtml, "utf8");

  process.stderr.write("\n");
  process.stderr.write("=".repeat(80) + "\n");
  process.stderr.write("COMPARISON RESULTS\n");
  process.stderr.write("=".repeat(80) + "\n");
  process.stderr.write(`Reference  (${refCommitShort}): ${comparison.referenceReport.summary.tickExecutionMs.avg.toFixed(2)}ms avg tick\n`);
  process.stderr.write(`Comparison (${cmpCommitShort}): ${comparison.comparisonReport.summary.tickExecutionMs.avg.toFixed(2)}ms avg tick\n`);
  
  const delta = comparison.comparisonReport.summary.tickExecutionMs.avg - comparison.referenceReport.summary.tickExecutionMs.avg;
  const deltaPercent = (delta / comparison.referenceReport.summary.tickExecutionMs.avg) * 100;
  const sign = delta >= 0 ? '+' : '';
  process.stderr.write(`Delta: ${sign}${delta.toFixed(2)}ms (${sign}${deltaPercent.toFixed(1)}%)\n`);
  
  process.stderr.write("\n");
  process.stderr.write(`Reports generated:\n`);
  process.stderr.write(`  Reference:  ${referenceReportPath}\n`);
  process.stderr.write(`  Comparison: ${comparisonReportPath}\n`);
  process.stderr.write(`  Summary:    ${comparisonSummaryPath}\n`);
  
  if (comparison.referenceCpuProfilePath || comparison.comparisonCpuProfilePath) {
    process.stderr.write(`\n`);
    process.stderr.write(`CPU Profiles:\n`);
    if (comparison.referenceCpuProfilePath) {
      process.stderr.write(`  Reference:  ${comparison.referenceCpuProfilePath}\n`);
    }
    if (comparison.comparisonCpuProfilePath) {
      process.stderr.write(`  Comparison: ${comparison.comparisonCpuProfilePath}\n`);
    }
  }
  process.stderr.write("=".repeat(80) + "\n");

  process.exit(0);
}

const gameRoot =
  openfrontRoot ??
  (replayGitCommit
    ? (
        await checkoutOpenFrontCommit({
          repoUrl,
          commit: replayGitCommit,
          cacheDir: cacheDir ? path.resolve(process.cwd(), cacheDir) : path.join(repoRoot, ".cache", "openfront"),
          log: rawLog,
        })
      ).gameRoot
    : null);

if (!gameRoot) {
  throw new Error("Replay missing gitCommit; pass --openfrontRoot or fix the replay JSON.");
}

if (install) {
  await ensureGameDepsInstalled({ gameRoot, log: rawLog });
}

const openfront = await loadOpenFrontRuntime(gameRoot);
const mapsRoot = path.join(gameRoot, "resources", "maps");
const d3Path = await firstExistingPath([
  path.join(repoRoot, "node_modules", "d3", "dist", "d3.min.js"),
  path.join(gameRoot, "node_modules", "d3", "dist", "d3.min.js"),
]);

const loaded = await loadReplay({ replayPath: absoluteReplayPath, maxTurns, openfront });

const consoleCapture = createConsoleCapture({ verbose, topN: 15 });
const economyTracker = createEconomyTracker({ sampleEveryTurns: economySampleEvery, topN: 12 });

const defaultOutDir = path.join(repoRoot, "replays", "out");
await fs.mkdir(defaultOutDir, { recursive: true });

const replayBase = path.basename(loaded.absoluteReplayPath).replace(/[^a-zA-Z0-9_.-]+/g, "_");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const profileOutPath = path.join(defaultOutDir, `${replayBase}.${timestamp}.cpuprofile`);

let sim!: Awaited<ReturnType<typeof simulateReplay>>;
let elapsedMs = 0;
let cpuProfileResult: any = null;
let profSession: inspector.Session | null = null;
try {
  if (cpuProfile) {
    profSession = new inspector.Session();
    profSession.connect();
    await inspectorPost(profSession, "Profiler.enable");
    await inspectorPost(profSession, "Profiler.start");
  }

  sim = await simulateReplay({
    openfront,
    gameStartInfo: loaded.gameStartInfo,
    clientID: loaded.clientID,
    mapsRoot,
    turnsToRun: loaded.turnsToRun,
    expectedHashes: loaded.expectedHashes,
    progressEvery: 2000,
    progressLog: rawLog,
    onGameInitialized: (game) => economyTracker.init(game),
    onAfterTick: ({ game, turn, conquestEvents, isLast }) => {
      economyTracker.afterTick(game, turn.turnNumber, conquestEvents, isLast);
    },
  });
  elapsedMs = sim.elapsedMs;
} finally {
  if (profSession) {
    try {
      cpuProfileResult = await inspectorPost<{ profile: any }>(profSession, "Profiler.stop");
      await fs.writeFile(profileOutPath, JSON.stringify(cpuProfileResult.profile), "utf8");
      rawLog(`cpu profile: ${profileOutPath}`);
    } finally {
      profSession.disconnect();
    }
  }
  consoleCapture.restore();
}

const tickMs = {
  avg: sim.tickExecutionMsValues.reduce((a, b) => a + b, 0) / Math.max(1, sim.tickExecutionMsValues.length),
  p50: percentile(sim.tickExecutionMsValues, 0.5),
  p95: percentile(sim.tickExecutionMsValues, 0.95),
  p99: percentile(sim.tickExecutionMsValues, 0.99),
  max: Math.max(0, ...sim.tickExecutionMsValues),
};

const players = summarizePlayers(
  openfront,
  sim.runner.game,
  sim.maxTilesBySmallID,
  economyTracker.totalsByClientId,
  loaded.goldEarnedReplayByClientId,
);

const PlayerType = openfront.Game.PlayerType as any;
const playersMeta = {
  total: players.length,
  humans: players.filter((p) => p.type === String(PlayerType.Human)).length,
  bots: players.filter((p) => p.type === String(PlayerType.Bot)).length,
  fakeHumans: players.filter((p) => p.type === String(PlayerType.FakeHuman)).length,
};

const { warnings, logs } = consoleCapture.summarize();

const report: ReplayPerfReport = {
  meta: {
    generatedAt: new Date().toISOString(),
    replayPath: loaded.absoluteReplayPath,
    gameID: loaded.gameStartInfo.gameID,
    replayGitCommit: loaded.replayGitCommit,
    map: String(loaded.gameStartInfo.config.gameMap),
    mapSize: String(loaded.gameStartInfo.config.gameMapSize),
    numTurns: loaded.expandedTurns.length,
    numTicksSimulated: loaded.turnsToRun.length,
    players: playersMeta,
    unknownClientIds: {
      total: loaded.unknownClientIds.length,
      withNonMarkIntents: loaded.unknownClientIds.filter((x) => x.hasNonMarkIntent).length,
      markOnly: loaded.unknownClientIds.filter((x) => !x.hasNonMarkIntent).length,
      samples: loaded.unknownClientIds.slice(0, 40),
    },
  },
  summary: {
    tickExecutionMs: tickMs,
    intents: {
      total: sim.totalIntents,
      avgPerTurn: sim.totalIntents / Math.max(1, loaded.turnsToRun.length),
      byType: sim.intentsByType,
    },
    hashChecks: {
      expectedHashes: loaded.expectedHashes.size,
      compared: sim.hashesCompared,
      mismatches: sim.hashMismatches,
      mismatchSamples: sim.hashMismatchSamples,
    },
    warnings,
    logs,
  },
  samples: sim.samples,
  players,
  economy: economyTracker.buildReport(),
};

const d3Source = await fs.readFile(d3Path, "utf8");
const defaultOutPath = path.join(
  defaultOutDir,
  `${replayBase}.${timestamp}.report.html`,
);
const finalOutPath = outPath ? path.resolve(process.cwd(), outPath) : defaultOutPath;
await fs.writeFile(finalOutPath, reportHtml(d3Source, report), "utf8");

console.log("");
console.log(`done: simulated ${loaded.turnsToRun.length} turns in ${Math.round(elapsedMs)}ms`);
console.log(`report: ${finalOutPath}`);
