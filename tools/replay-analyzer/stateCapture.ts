import crypto from "node:crypto";
import type { OpenFrontRuntime } from "./openfrontLoader";

export interface CapturedState {
  // Player ID assignments from reference run
  playerIdSequence: string[];  // IDs in order they were generated

  // RNG snapshots (PseudoRandom internal state), keyed by game tick.
  // Tick 0 is captured immediately after game initialization (before any ticks execute).
  // Subsequent ticks are captured after each tick executes.
  rngSnapshotsByTick?: Record<number, Array<{ seed: number; index: number; state: any }>>;

  // Spawn assignments captured during GameRunner.init (random spawn + bot spawn).
  // Keyed by PlayerInfo.id (string) so we can override spawn tiles even if spawn algorithms change between commits.
  spawnAssignmentsByPlayerId?: Record<
    string,
    { tile: number; x: number; y: number; name: string; type: string }
  >;

  // Map validation
  mapDataHash: string;
  nationManifest: Array<{ name: string; coords: [number, number] }>;

  // Config snapshot for diff detection
  configValues: Record<string, unknown>;

  // Game state snapshots at key points
  gameStateSnapshotTick0: {
    tick: number;
    playerCount: number;
    playerIds: string[];
    hash: number | null;
  } | null;
  
  gameStateSnapshotTick30: {
    tick: number;
    playersWithTiles: Array<{
      id: string;
      name: string;
      type: string;
      tileCount: number;
      tiles: Array<{ x: number; y: number }>;
    }>;
    hash: number | null;
  } | null;
}

export function installStateCapture(openfront: OpenFrontRuntime): {
  cleanup: () => void;
  getCapturedState: () => CapturedState;
  captureGameStateSnapshotTick0: (game: any, tick: number) => void;
  captureGameStateSnapshotTick30: (game: any, tick: number) => void;
  captureRngSnapshot: (tick: number) => void;
} {
  const capturedIds: string[] = [];
  let mapDataHash = "";
  let nationManifest: Array<{ name: string; coords: [number, number] }> = [];
  const configValues: Record<string, unknown> = {};
  let gameStateSnapshotTick0: CapturedState['gameStateSnapshotTick0'] = null;
  let gameStateSnapshotTick30: CapturedState['gameStateSnapshotTick30'] = null;
  const rngSnapshotsByTick: Record<number, Array<{ seed: number; index: number; state: any }>> = {};
  const spawnAssignmentsByPlayerId: Record<
    string,
    { tile: number; x: number; y: number; name: string; type: string }
  > = {};
  
  // Track original functions for cleanup
  const originals: Array<{ obj: any; prop: string; value: any }> = [];

  function captureRngSnapshot(tick: number) {
    // This depends on our checkout-time patch to OpenFront's src/core/PseudoRandom.ts.
    try {
      const regKey = Symbol.for("replay-analyzer.openfront.PseudoRandom.registry");
      const reg = (globalThis as any)[regKey] as undefined | { bySeed?: Map<number, any[]> };
      const bySeed = reg?.bySeed;
      if (!bySeed) return;

      const snap: Array<{ seed: number; index: number; state: any }> = [];
      for (const [seed, list] of bySeed.entries()) {
        for (let index = 0; index < list.length; index++) {
          const rng = list[index];
          const stateFn = rng?.__replayAnalyzerGetState;
          if (typeof stateFn !== "function") continue;
          const state = stateFn.call(rng);
          snap.push({ seed, index, state });
        }
      }
      rngSnapshotsByTick[tick] = snap;
    } catch {
      // best-effort
    }
  }

  // 1. Patch PseudoRandom.nextID to capture player IDs
  if (openfront.PseudoRandom) {
    const originalNextID = openfront.PseudoRandom.prototype.nextID;
    originals.push({ 
      obj: openfront.PseudoRandom.prototype, 
      prop: 'nextID', 
      value: originalNextID 
    });

    openfront.PseudoRandom.prototype.nextID = function(this: any) {
      const id = originalNextID.call(this);
      capturedIds.push(id);
      return id;
    };
  }

  // 1b. Patch GameRunner.init to capture SpawnExecution tiles during initialization.
  // This is where random spawn decisions are made (PlayerSpawner/BotSpawner).
  try {
    const GameRunnerClass = (openfront as any)?.GameRunner?.GameRunner;
    if (GameRunnerClass?.prototype?.init) {
      const originalInit = GameRunnerClass.prototype.init;
      originals.push({ obj: GameRunnerClass.prototype, prop: "init", value: originalInit });

      GameRunnerClass.prototype.init = function patchedInit(this: any) {
        const game = this.game;
        const originalAddExecution = game?.addExecution;
        if (typeof originalAddExecution !== "function") {
          return originalInit.call(this);
        }

        game.addExecution = function patchedAddExecution(this: any, ...execs: any[]) {
          for (const ex of execs) {
            if (ex?.constructor?.name !== "SpawnExecution") continue;
            const pi = ex.playerInfo;
            const id = pi?.id;
            if (typeof id !== "string") continue;
            const tile = ex.tile;
            if (typeof tile !== "number") continue;
            try {
              const cell = game.cell(tile);
              spawnAssignmentsByPlayerId[id] = {
                tile,
                x: cell?.x ?? game.x(tile),
                y: cell?.y ?? game.y(tile),
                name: String(pi?.name ?? ""),
                type: String(pi?.playerType ?? ""),
              };
            } catch {
              // ignore
            }
          }
          return originalAddExecution.apply(this, execs);
        };

        try {
          return originalInit.call(this);
        } finally {
          game.addExecution = originalAddExecution;
        }
      };
    }
  } catch {
    // best-effort
  }

  // 2. Patch loadTerrainMap to capture map data
  if (openfront.loadTerrainMap) {
    const originalLoadTerrainMap = openfront.loadTerrainMap;
    originals.push({ 
      obj: openfront, 
      prop: 'loadTerrainMap', 
      value: originalLoadTerrainMap 
    });

    openfront.loadTerrainMap = async function(this: any, map: any, size: any, loader: any) {
      const result = await originalLoadTerrainMap.call(this, map, size, loader);

      // Capture map data hash and nation manifest
      try {
        const manifest = await loader.getMapData(map).manifest();
        
        // Compute hash of map binary data
        if (result.gameMap) {
          const mapBuffer = result.gameMap instanceof Uint8Array ? result.gameMap : new Uint8Array(0);
          mapDataHash = crypto.createHash("sha256").update(mapBuffer).digest("hex");
        }

        // Capture nation manifest
        if (manifest?.nations) {
          nationManifest = manifest.nations.map((n: any) => ({
            name: n.name,
            coords: n.coordinates as [number, number],
          }));
        }
      } catch (e) {
        console.warn("Could not capture map data for state snapshot:", e);
      }

      return result;
    };
  }

  // 3. Patch getConfig to capture configuration
  if (openfront.getConfig) {
    const originalGetConfig = openfront.getConfig;
    originals.push({ 
      obj: openfront, 
      prop: 'getConfig', 
      value: originalGetConfig 
    });

    openfront.getConfig = async function(this: any, gameConfig: any, userSettings?: any, isReplay?: boolean) {
      const config = await originalGetConfig.call(this, gameConfig, userSettings, isReplay);

      // Capture key config values that affect simulation
      Object.assign(configValues, {
        gameMap: config.gameConfig?.()?.gameMap,
        gameMapSize: config.gameConfig?.()?.gameMapSize,
        difficulty: config.gameConfig?.()?.difficulty,
        disableNPCs: config.gameConfig?.()?.disableNPCs,
        bots: config.gameConfig?.()?.bots,
        infiniteGold: config.gameConfig?.()?.infiniteGold,
        infiniteTroops: config.gameConfig?.()?.infiniteTroops,
        donateGold: config.gameConfig?.()?.donateGold,
        donateTroops: config.gameConfig?.()?.donateTroops,
        instantBuild: config.gameConfig?.()?.instantBuild,
        randomSpawn: config.gameConfig?.()?.randomSpawn,
        gameMode: config.gameConfig?.()?.gameMode,
        playerTeams: config.gameConfig?.()?.playerTeams,
      });

      return config;
    };
  }

  return {
    cleanup: () => {
      // Restore all original functions
      for (const { obj, prop, value } of originals) {
        obj[prop] = value;
      }
    },
    getCapturedState: () => ({
      playerIdSequence: [...capturedIds],
      rngSnapshotsByTick: { ...rngSnapshotsByTick },
      spawnAssignmentsByPlayerId: { ...spawnAssignmentsByPlayerId },
      mapDataHash,
      nationManifest: [...nationManifest],
      configValues: { ...configValues },
      gameStateSnapshotTick0,
      gameStateSnapshotTick30,
    }),
    captureGameStateSnapshotTick0: (game: any, tick: number) => {
      try {
        const allPlayers: any[] = Array.from(game.allPlayers());
        
        gameStateSnapshotTick0 = {
          tick,
          playerCount: allPlayers.length,
          playerIds: allPlayers.map((p: any) => p.id()),
          hash: typeof game.hash === 'function' ? game.hash() : null,
        };

        // Capture initial RNG state before any ticks execute.
        captureRngSnapshot(tick);
        
        process.stderr.write(`  ✓ Captured tick 0: ${allPlayers.length} players, hash=${gameStateSnapshotTick0.hash}\n`);
      } catch (e) {
        process.stderr.write(`  ✗ Failed to capture tick 0 snapshot: ${e}\n`);
        if (e instanceof Error) {
          process.stderr.write(`    Stack: ${e.stack}\n`);
        }
      }
    },
    captureGameStateSnapshotTick30: (game: any, tick: number) => {
      try {
        const playersWithTiles: Array<{
          id: string;
          name: string;
          type: string;
          tileCount: number;
          tiles: Array<{ x: number; y: number }>;
        }> = [];
        
        // Capture all players and their tiles
        for (const player of game.allPlayers()) {
          const tiles = player.tiles();
          // tiles() returns a Set, convert to array
          const tilesArray = Array.from(tiles);
          playersWithTiles.push({
            id: player.id(),
            name: player.name(),
            type: String(player.type()),
            tileCount: tilesArray.length,
            tiles: tilesArray.slice(0, 100).map((tileRef: any) => {
              const cell = game.cell(tileRef);
              return { x: cell.x, y: cell.y };
            }),
          });
        }

        gameStateSnapshotTick30 = {
          tick,
          playersWithTiles,
          hash: typeof game.hash === 'function' ? game.hash() : null,
        };

        // Also capture RNG state at this tick (useful if spawn completes here).
        captureRngSnapshot(tick);
        
        // Log success to stderr (won't be captured by consoleCapture)
        process.stderr.write(`  ✓ Captured tick 30: ${playersWithTiles.length} players, hash=${gameStateSnapshotTick30.hash}\n`);
      } catch (e) {
        // Use stderr so it's not captured by consoleCapture
        process.stderr.write(`  ✗ Failed to capture tick 30 snapshot: ${e}\n`);
        if (e instanceof Error) {
          process.stderr.write(`    Stack: ${e.stack}\n`);
        }
      }
    },
    captureRngSnapshot,
  };
}
