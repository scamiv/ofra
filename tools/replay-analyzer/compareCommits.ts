import fs from "node:fs/promises";
import inspector from "node:inspector";
import path from "node:path";
import type { OpenFrontRuntime } from "./openfrontLoader";
import type { ReplayPerfReport } from "./types";
import type { CapturedState } from "./stateCapture";
import { installStateCapture } from "./stateCapture";
import { installStateInjection } from "./stateInjection";

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

export interface ComparisonResult {
  referenceReport: ReplayPerfReport;
  comparisonReport: ReplayPerfReport;
  referenceCommit: string;
  comparisonCommit: string;
  capturedState: CapturedState;
  injectionWarnings: string[];
  referenceCpuProfilePath?: string;
  comparisonCpuProfilePath?: string;
}

export interface RunReplayOptions {
  replayPath: string;
  gameRoot: string;
  openfront: OpenFrontRuntime;
  mapsRoot: string;
  maxTurns: number | null;
  economySampleEvery: number;
  verbose: boolean;
  cpuProfile: boolean;
  cpuProfilePath?: string;
  repoRoot: string;
}

export async function runReplayWithCapture(opts: RunReplayOptions): Promise<{
  report: ReplayPerfReport;
  capturedState: CapturedState;
  cpuProfilePath?: string;
}> {
  // Import simulation modules
  const { simulateReplay } = await import("./simulateReplay");
  const { createConsoleCapture } = await import("./consoleCapture");
  const { createEconomyTracker } = await import("./economyTracker");
  const { loadReplay } = await import("./replayLoader");
  const { summarizePlayers } = await import("./playerSummary");
  const { percentile } = await import("./utils");

  // Install state capture hooks
  const {
    cleanup,
    getCapturedState,
    captureGameStateSnapshotTick0,
    captureGameStateSnapshotTick30,
    captureRngSnapshot,
  } = installStateCapture(opts.openfront);

  // Set up CPU profiling if requested
  let profSession: inspector.Session | null = null;
  let cpuProfilePath: string | undefined = undefined;

  try {
    if (opts.cpuProfile && opts.cpuProfilePath) {
      profSession = new inspector.Session();
      profSession.connect();
      await inspectorPost(profSession, "Profiler.enable");
      await inspectorPost(profSession, "Profiler.start");
      cpuProfilePath = opts.cpuProfilePath;
    }
    const loaded = await loadReplay({
      replayPath: opts.replayPath,
      maxTurns: opts.maxTurns,
      openfront: opts.openfront
    });

    const consoleCapture = createConsoleCapture({ verbose: opts.verbose, topN: 15 });
    const economyTracker = createEconomyTracker({
      sampleEveryTurns: opts.economySampleEvery,
      topN: 12
    });

    // Progress indicator using stderr (won't be captured)
    process.stderr.write(`Simulating ${loaded.turnsToRun.length} turns...\n`);
    
    // Run simulation with capture hooks active
    const sim = await simulateReplay({
      openfront: opts.openfront,
      gameStartInfo: loaded.gameStartInfo,
      clientID: loaded.clientID,
      mapsRoot: opts.mapsRoot,
      turnsToRun: loaded.turnsToRun,
      expectedHashes: loaded.expectedHashes,
      progressEvery: 2000,
      progressLog: (...args: any[]) => process.stderr.write(args.join(' ') + '\n'),
      onGameInitialized: (game) => {
        economyTracker.init(game);
        // Capture tick 0 snapshot immediately after initialization
        process.stderr.write(`Capturing tick 0 snapshot...\n`);
        captureGameStateSnapshotTick0(game, game.ticks());
      },
      onAfterTick: ({ game, turn, conquestEvents, isLast }) => {
        economyTracker.afterTick(game, turn.turnNumber, conquestEvents, isLast);

        // Capture RNG state after each tick during spawn phase to keep deterministic streams aligned.
        // This helps when commits change the number/order of random draws early-game.
        if (game.ticks() <= 30) {
          captureRngSnapshot(game.ticks());
        }
        
        // Capture game state snapshot after spawn phase completes (around tick 30)
        if (game.ticks() === 30) {
          process.stderr.write(`Capturing tick 30 snapshot...\n`);
          captureGameStateSnapshotTick30(game, game.ticks());
        }
      },
    });
    
    process.stderr.write(`Simulation complete.\n`);

    // Calculate performance metrics
    const tickMs = {
      avg: sim.tickExecutionMsValues.reduce((a, b) => a + b, 0) / Math.max(1, sim.tickExecutionMsValues.length),
      p50: percentile(sim.tickExecutionMsValues, 0.5),
      p95: percentile(sim.tickExecutionMsValues, 0.95),
      p99: percentile(sim.tickExecutionMsValues, 0.99),
      max: Math.max(0, ...sim.tickExecutionMsValues),
    };

    const players = summarizePlayers(
      opts.openfront,
      sim.runner.game,
      sim.maxTilesBySmallID,
      economyTracker.totalsByClientId,
      loaded.goldEarnedReplayByClientId,
    );

    const PlayerType = opts.openfront.Game.PlayerType as any;
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

    return {
      report,
      capturedState: getCapturedState(),
      cpuProfilePath,
    };

  } finally {
    // Stop CPU profiling if active
    if (profSession && cpuProfilePath) {
      try {
        const cpuProfileResult = await inspectorPost<{ profile: any }>(profSession, "Profiler.stop");
        await fs.writeFile(cpuProfilePath, JSON.stringify(cpuProfileResult.profile), "utf8");
      } finally {
        profSession.disconnect();
      }
    }
    cleanup();
  }
}

export async function runReplayWithInjection(
  opts: RunReplayOptions,
  capturedState: CapturedState
): Promise<{
  report: ReplayPerfReport;
  injectionWarnings: string[];
  cpuProfilePath?: string;
}> {
  // Import simulation modules
  const { simulateReplay } = await import("./simulateReplay");
  const { createConsoleCapture } = await import("./consoleCapture");
  const { createEconomyTracker } = await import("./economyTracker");
  const { loadReplay } = await import("./replayLoader");
  const { summarizePlayers } = await import("./playerSummary");
  const { percentile } = await import("./utils");

  // Install state injection hooks
  const {
    cleanup,
    warnings: injectionWarnings,
    validateGameStateSnapshotTick0,
    validateGameStateSnapshotTick30,
    restoreRngSnapshot,
  } = installStateInjection(opts.openfront, capturedState);

  // Set up CPU profiling if requested
  let profSession: inspector.Session | null = null;
  let cpuProfilePath: string | undefined = undefined;

  try {
    if (opts.cpuProfile && opts.cpuProfilePath) {
      profSession = new inspector.Session();
      profSession.connect();
      await inspectorPost(profSession, "Profiler.enable");
      await inspectorPost(profSession, "Profiler.start");
      cpuProfilePath = opts.cpuProfilePath;
    }
    const loaded = await loadReplay({
      replayPath: opts.replayPath,
      maxTurns: opts.maxTurns,
      openfront: opts.openfront
    });

    const consoleCapture = createConsoleCapture({ verbose: opts.verbose, topN: 15 });
    const economyTracker = createEconomyTracker({
      sampleEveryTurns: opts.economySampleEvery,
      topN: 12
    });

    // Progress indicator using stderr (won't be captured)
    process.stderr.write(`Simulating ${loaded.turnsToRun.length} turns with injected state...\n`);
    
    // Run simulation with injected state
    const sim = await simulateReplay({
      openfront: opts.openfront,
      gameStartInfo: loaded.gameStartInfo,
      clientID: loaded.clientID,
      mapsRoot: opts.mapsRoot,
      turnsToRun: loaded.turnsToRun,
      expectedHashes: loaded.expectedHashes,
      progressEvery: 2000,
      progressLog: (...args: any[]) => process.stderr.write(args.join(' ') + '\n'),
      onGameInitialized: (game) => {
        economyTracker.init(game);
        // Validate tick 0 snapshot
        process.stderr.write(`Validating tick 0 snapshot...\n`);
        validateGameStateSnapshotTick0(game, game.ticks());

        // Restore tick-0 RNG snapshot (pre-tick) if available.
        restoreRngSnapshot(game.ticks());
      },
      onAfterTick: ({ game, turn, conquestEvents, isLast }) => {
        economyTracker.afterTick(game, turn.turnNumber, conquestEvents, isLast);

        // Restore RNG state after each tick during spawn to align the next tick's random stream.
        if (game.ticks() <= 30) {
          restoreRngSnapshot(game.ticks());
        }
        
        // Validate tick 30 snapshot
        if (game.ticks() === 30) {
          process.stderr.write(`Validating tick 30 snapshot...\n`);
          validateGameStateSnapshotTick30(game, game.ticks());
        }
      },
    });
    
    process.stderr.write(`Simulation complete.\n`);

    // Calculate performance metrics
    const tickMs = {
      avg: sim.tickExecutionMsValues.reduce((a, b) => a + b, 0) / Math.max(1, sim.tickExecutionMsValues.length),
      p50: percentile(sim.tickExecutionMsValues, 0.5),
      p95: percentile(sim.tickExecutionMsValues, 0.95),
      p99: percentile(sim.tickExecutionMsValues, 0.99),
      max: Math.max(0, ...sim.tickExecutionMsValues),
    };

    const players = summarizePlayers(
      opts.openfront,
      sim.runner.game,
      sim.maxTilesBySmallID,
      economyTracker.totalsByClientId,
      loaded.goldEarnedReplayByClientId,
    );

    const PlayerType = opts.openfront.Game.PlayerType as any;
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

    return {
      report,
      injectionWarnings,
      cpuProfilePath,
    };

  } finally {
    // Stop CPU profiling if active
    if (profSession && cpuProfilePath) {
      try {
        const cpuProfileResult = await inspectorPost<{ profile: any }>(profSession, "Profiler.stop");
        await fs.writeFile(cpuProfilePath, JSON.stringify(cpuProfileResult.profile), "utf8");
      } finally {
        profSession.disconnect();
      }
    }
    cleanup();
  }
}

export async function compareCommits(
  replayPath: string,
  referenceCommit: string,
  comparisonCommit: string,
  opts: {
    maxTurns: number | null;
    economySampleEvery: number;
    verbose: boolean;
    cpuProfile: boolean;
    repoUrl: string;
    cacheDir: string | null;
    install: boolean;
    apiBase: string;
    repoRoot: string;
  }
): Promise<ComparisonResult> {
  const { checkoutOpenFrontCommit } = await import("./openfrontCheckout");
  const { loadOpenFrontRuntime } = await import("./openfrontLoader");

  process.stderr.write("\n");
  process.stderr.write("=".repeat(80) + "\n");
  process.stderr.write(`REFERENCE RUN: commit ${referenceCommit.substring(0, 8)}\n`);
  process.stderr.write("=".repeat(80) + "\n");

  // Run reference commit and capture state
  const { gameRoot: referenceGameRoot } = await checkoutOpenFrontCommit({
    repoUrl: opts.repoUrl,
    commit: referenceCommit,
    cacheDir: opts.cacheDir ? path.resolve(process.cwd(), opts.cacheDir) : path.join(opts.repoRoot, ".cache", "openfront"),
    log: console.log,
  });

  if (opts.install) {
    const { ensureGameDepsInstalled: installDeps } = await import("./openfrontCheckout");
    await (installDeps as any)({ gameRoot: referenceGameRoot, log: console.log });
  }

  // Load with state capture enabled for reference run
  process.stderr.write("Loading OpenFront runtime...\n");
  const referenceOpenfront = await loadOpenFrontRuntime(referenceGameRoot, { enableStateCapture: true });
  const mapsRoot = path.join(referenceGameRoot, "resources", "maps");

  // Generate CPU profile paths if needed
  let referenceCpuProfilePath: string | undefined;
  let comparisonCpuProfilePath: string | undefined;
  
  if (opts.cpuProfile) {
    const defaultOutDir = path.join(opts.repoRoot, "replays", "out");
    await fs.mkdir(defaultOutDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const replayBase = path.basename(replayPath).replace(/[^a-zA-Z0-9_.-]+/g, "_");
    
    referenceCpuProfilePath = path.join(
      defaultOutDir,
      `${replayBase}.${timestamp}.ref-${referenceCommit.substring(0, 8)}.cpuprofile`
    );
    comparisonCpuProfilePath = path.join(
      defaultOutDir,
      `${replayBase}.${timestamp}.cmp-${comparisonCommit.substring(0, 8)}.cpuprofile`
    );
  }

  const { report: referenceReport, capturedState, cpuProfilePath: refProfileWritten } = await runReplayWithCapture({
    replayPath,
    gameRoot: referenceGameRoot,
    openfront: referenceOpenfront,
    mapsRoot,
    maxTurns: opts.maxTurns,
    economySampleEvery: opts.economySampleEvery,
    verbose: opts.verbose,
    cpuProfile: opts.cpuProfile,
    cpuProfilePath: referenceCpuProfilePath,
    repoRoot: opts.repoRoot,
  });

  process.stderr.write("\n");
  process.stderr.write("=".repeat(80) + "\n");
  process.stderr.write(`REFERENCE COMPLETE: Captured ${capturedState.playerIdSequence.length} player IDs\n`);
  process.stderr.write("=".repeat(80) + "\n");
  process.stderr.write("\n");
  process.stderr.write("=".repeat(80) + "\n");
  process.stderr.write(`COMPARISON RUN: commit ${comparisonCommit.substring(0, 8)}\n`);
  process.stderr.write("=".repeat(80) + "\n");

  // Run comparison commit with injected state
  const { gameRoot: comparisonGameRoot } = await checkoutOpenFrontCommit({
    repoUrl: opts.repoUrl,
    commit: comparisonCommit,
    cacheDir: opts.cacheDir ? path.resolve(process.cwd(), opts.cacheDir) : path.join(opts.repoRoot, ".cache", "openfront"),
    log: console.log,
  });

  if (opts.install) {
    const { ensureGameDepsInstalled: installDeps } = await import("./openfrontCheckout");
    await (installDeps as any)({ gameRoot: comparisonGameRoot, log: console.log });
  }

  // Load with state capture enabled for comparison run (for injection)
  process.stderr.write("Loading OpenFront runtime...\n");
  const comparisonOpenfront = await loadOpenFrontRuntime(comparisonGameRoot, { enableStateCapture: true });

  const { report: comparisonReport, injectionWarnings, cpuProfilePath: cmpProfileWritten } = await runReplayWithInjection({
    replayPath,
    gameRoot: comparisonGameRoot,
    openfront: comparisonOpenfront,
    mapsRoot,
    maxTurns: opts.maxTurns,
    economySampleEvery: opts.economySampleEvery,
    verbose: opts.verbose,
    cpuProfile: opts.cpuProfile,
    cpuProfilePath: comparisonCpuProfilePath,
    repoRoot: opts.repoRoot,
  }, capturedState);

  process.stderr.write("\n");
  process.stderr.write("=".repeat(80) + "\n");
  process.stderr.write(`COMPARISON COMPLETE\n`);
  
  // Display state injection warnings
  if (injectionWarnings.length > 0) {
    process.stderr.write(`⚠️  ${injectionWarnings.length} state injection warning(s):\n`);
    for (const warning of injectionWarnings) {
      process.stderr.write(`   - ${warning}\n`);
    }
  }
  
  // Display hash mismatch info
  const refHashInfo = referenceReport.summary.hashChecks;
  const cmpHashInfo = comparisonReport.summary.hashChecks;
  
  process.stderr.write(`\nHash Check Results:\n`);
  process.stderr.write(`  Reference:  ${refHashInfo.compared} compared, ${refHashInfo.mismatches} mismatches\n`);
  process.stderr.write(`  Comparison: ${cmpHashInfo.compared} compared, ${cmpHashInfo.mismatches} mismatches\n`);
  
  if (cmpHashInfo.mismatchSamples && cmpHashInfo.mismatchSamples.length > 0) {
    const firstMismatchTick = cmpHashInfo.mismatchSamples[0]?.tick;
    process.stderr.write(`\nFirst hash mismatches in comparison run:\n`);
    for (const sample of cmpHashInfo.mismatchSamples.slice(0, 5)) {
      process.stderr.write(`  Tick ${sample.tick}: expected=${sample.expected}, actual=${sample.actual}\n`);
    }
    
    if (firstMismatchTick && firstMismatchTick < 30) {
      process.stderr.write(`\n⚠️  Divergence started at tick ${firstMismatchTick} (before spawn phase completes).\n`);
      process.stderr.write(`   This indicates spawn logic or early-game behavior changed between commits.\n`);
      process.stderr.write(`   Performance comparison is still valid, but game states differ.\n`);
    } else if (cmpHashInfo.mismatches === 0) {
      process.stderr.write(`\n✅ Perfect synchronization! Game states match exactly.\n`);
    }
  } else if (cmpHashInfo.mismatches === 0) {
    process.stderr.write(`\n✅ Perfect synchronization! No hash mismatches detected.\n`);
  }
  
  process.stderr.write("=".repeat(80) + "\n");

  return {
    referenceReport,
    comparisonReport,
    referenceCommit,
    comparisonCommit,
    capturedState,
    injectionWarnings,
    referenceCpuProfilePath: refProfileWritten,
    comparisonCpuProfilePath: cmpProfileWritten,
  };
}
