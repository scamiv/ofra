import crypto from "node:crypto";
import type { CapturedState } from "./stateCapture";
import type { OpenFrontRuntime } from "./openfrontLoader";

export interface InjectionResult {
  cleanup: () => void;
  warnings: string[];
  validateGameStateSnapshotTick0: (game: any, tick: number) => void;
  validateGameStateSnapshotTick30: (game: any, tick: number) => void;
  restoreRngSnapshot: (tick: number) => void;
}

export function installStateInjection(
  openfront: OpenFrontRuntime,
  capturedState: CapturedState
): InjectionResult {
  const warnings: string[] = [];
  let idIndex = 0;

  // Track original functions for cleanup
  const originals: Array<{ obj: any; prop: string; value: any }> = [];

  // 1. Patch PseudoRandom.nextID to return captured IDs in sequence
  if (openfront.PseudoRandom) {
    const originalNextID = openfront.PseudoRandom.prototype.nextID;
    originals.push({ 
      obj: openfront.PseudoRandom.prototype, 
      prop: 'nextID', 
      value: originalNextID 
    });

    openfront.PseudoRandom.prototype.nextID = function(this: any) {
      // CRITICAL: Always call the original to consume the RNG state
      // This keeps the internal PRNG sequence synchronized
      const generatedID = originalNextID.call(this);
      
      // Return captured ID if available, otherwise use the generated one
      if (idIndex < capturedState.playerIdSequence.length) {
        return capturedState.playerIdSequence[idIndex++];
      }
      
      // Fall back to generated ID for any IDs beyond captured (e.g., new bots)
      const extraIds = idIndex - capturedState.playerIdSequence.length + 1;
      if (extraIds === 1) {
        warnings.push(
          `Generated additional IDs beyond captured state (${capturedState.playerIdSequence.length} captured). ` +
          `This may cause desync if bot spawning behavior changed.`
        );
      }
      idIndex++;
      return generatedID;
    };
  } else {
    warnings.push("PseudoRandom not available - cannot inject player IDs (old commit version?)");
  }

  // 1b. Patch GameRunner.init to override SpawnExecution tiles from reference capture.
  // This is the most robust way to keep spawn deterministic even when spawn logic changes between commits.
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

        const spawnMap = capturedState.spawnAssignmentsByPlayerId ?? {};
        game.addExecution = function patchedAddExecution(this: any, ...execs: any[]) {
          for (const ex of execs) {
            if (ex?.constructor?.name !== "SpawnExecution") continue;
            const pi = ex.playerInfo;
            const id = pi?.id;
            if (typeof id !== "string") continue;
            const ref = spawnMap[id];
            if (!ref) continue;
            try {
              // tile is readonly in TS but writable at runtime
              ex.tile = ref.tile;
              // Keep names aligned for nicer diffs; gameplay doesn't depend on it but it's cheap.
              if (pi && typeof pi === "object") {
                pi.name = ref.name;
              }
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

  function restoreRngSnapshot(tick: number) {
    const snaps = capturedState.rngSnapshotsByTick?.[tick];
    if (!snaps || snaps.length === 0) return;

    try {
      const regKey = Symbol.for("replay-analyzer.openfront.PseudoRandom.registry");
      const reg = (globalThis as any)[regKey] as undefined | { bySeed?: Map<number, any[]> };
      const bySeed = reg?.bySeed;
      if (!bySeed) return;

      for (const s of snaps) {
        const list = bySeed.get(s.seed);
        const rng = list?.[s.index];
        const setFn = rng?.__replayAnalyzerSetState;
        if (typeof setFn === "function") {
          setFn.call(rng, s.state);
        }
      }
    } catch (e) {
      warnings.push(`Failed to restore RNG snapshot at tick ${tick}: ${e}`);
    }
  }

  // 2. Patch loadTerrainMap to validate map data
  if (openfront.loadTerrainMap) {
    const originalLoadTerrainMap = openfront.loadTerrainMap;
    originals.push({ 
      obj: openfront, 
      prop: 'loadTerrainMap', 
      value: originalLoadTerrainMap 
    });

    openfront.loadTerrainMap = async function(this: any, map: any, size: any, loader: any) {
      const result = await originalLoadTerrainMap.call(this, map, size, loader);

      // Validate against captured state
      try {
        const manifest = await loader.getMapData(map).manifest();

        // Check nation count and positions
        const currentNations = manifest?.nations?.map((n: any) => ({
          name: n.name,
          coords: n.coordinates as [number, number],
        })) || [];

        if (capturedState.nationManifest.length !== currentNations.length) {
          warnings.push(
            `Nation count mismatch: reference had ${capturedState.nationManifest.length}, ` +
            `current has ${currentNations.length}`
          );
        } else {
          // Check each nation matches
          for (let i = 0; i < capturedState.nationManifest.length; i++) {
            const ref = capturedState.nationManifest[i];
            const curr = currentNations[i];
            if (ref.name !== curr.name ||
                ref.coords[0] !== curr.coords[0] ||
                ref.coords[1] !== curr.coords[1]) {
              warnings.push(
                `Nation ${i} mismatch: reference "${ref.name}" at [${ref.coords}], ` +
                `current "${curr.name}" at [${curr.coords}]`
              );
            }
          }
        }

        // Check map data hash
        if (capturedState.mapDataHash && result.gameMap) {
          const mapBuffer = result.gameMap instanceof Uint8Array ? result.gameMap : new Uint8Array(0);
          const currentHash = crypto.createHash("sha256").update(mapBuffer).digest("hex");

          if (currentHash !== capturedState.mapDataHash) {
            warnings.push(
              `Map data hash mismatch - terrain changes detected. ` +
              `This will cause simulation divergence.`
            );
          }
        }

      } catch (e) {
        warnings.push(`Could not validate map data: ${e}`);
      }

      return result;
    };
  }

  // 3. Patch getConfig to report configuration differences
  if (openfront.getConfig) {
    const originalGetConfig = openfront.getConfig;
    originals.push({ 
      obj: openfront, 
      prop: 'getConfig', 
      value: originalGetConfig 
    });

    openfront.getConfig = async function(this: any, gameConfig: any, userSettings?: any, isReplay?: boolean) {
      const config = await originalGetConfig.call(this, gameConfig, userSettings, isReplay);

      // Compare config values
      const currentValues = {
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
      };

      for (const [key, refValue] of Object.entries(capturedState.configValues)) {
        const currValue = (currentValues as any)[key];
        if (JSON.stringify(refValue) !== JSON.stringify(currValue)) {
          warnings.push(
            `Config difference in ${key}: reference=${JSON.stringify(refValue)}, current=${JSON.stringify(currValue)}`
          );
        }
      }

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
    warnings,
    validateGameStateSnapshotTick0: (game: any, tick: number) => {
      if (!capturedState.gameStateSnapshotTick0) {
        warnings.push("No tick 0 snapshot captured from reference run");
        process.stderr.write(`  ✗ No tick 0 snapshot found\n`);
        return;
      }

      const snapshot = capturedState.gameStateSnapshotTick0;
      if (snapshot.tick !== tick) {
        warnings.push(`Tick 0 snapshot tick mismatch: expected ${snapshot.tick}, got ${tick}`);
      }
      
      try {
        const allPlayers: any[] = Array.from(game.allPlayers());
        const currentPlayerCount = allPlayers.length;
        const currentPlayerIds = allPlayers.map((p: any) => p.id());
        const currentHash = typeof game.hash === 'function' ? game.hash() : null;
        
        if (currentPlayerCount !== snapshot.playerCount) {
          warnings.push(
            `Tick 0: Player count mismatch - reference had ${snapshot.playerCount}, current has ${currentPlayerCount}`
          );
        }
        
        // Check if player IDs match
        const missingIds = snapshot.playerIds.filter(id => !currentPlayerIds.includes(id));
        const extraIds = currentPlayerIds.filter(id => !snapshot.playerIds.includes(id));
        
        if (missingIds.length > 0 || extraIds.length > 0) {
          warnings.push(
            `Tick 0: Player ID mismatch - ${missingIds.length} missing, ${extraIds.length} extra`
          );
        }
        
        if (snapshot.hash !== null && currentHash !== null && snapshot.hash !== currentHash) {
          warnings.push(
            `Tick 0: Hash mismatch - reference=${snapshot.hash}, current=${currentHash}`
          );
        }
        
        process.stderr.write(`  ✓ Validated tick 0: ${currentPlayerCount} players, hash=${currentHash}\n`);
      } catch (e) {
        warnings.push(`Failed to validate tick 0 snapshot: ${e}`);
      }
    },
    validateGameStateSnapshotTick30: (game: any, tick: number) => {
      if (!capturedState.gameStateSnapshotTick30) {
        warnings.push("No tick 30 snapshot captured from reference run");
        process.stderr.write(`  ✗ No tick 30 snapshot found\n`);
        return;
      }

      const snapshot = capturedState.gameStateSnapshotTick30;
      if (snapshot.tick !== tick) {
        warnings.push(`Tick 30 snapshot tick mismatch: expected ${snapshot.tick}, got ${tick}`);
      }
      
      process.stderr.write(`  ✓ Validating tick 30: ${snapshot.playersWithTiles.length} players, hash=${snapshot.hash}\n`);

      try {
        // Compare player counts
        const currentPlayers: any[] = Array.from(game.allPlayers());
        if (currentPlayers.length !== snapshot.playersWithTiles.length) {
          warnings.push(
            `Player count mismatch at tick ${tick}: ` +
            `reference had ${snapshot.playersWithTiles.length}, current has ${currentPlayers.length}`
          );
        }

        // Compare each player's tile ownership
        const currentPlayerMap = new Map<string, any>();
        for (const player of currentPlayers) {
          currentPlayerMap.set(player.id(), player);
        }

        for (const refPlayer of snapshot.playersWithTiles) {
          const currPlayer = currentPlayerMap.get(refPlayer.id);
          if (!currPlayer) {
            warnings.push(`Player ${refPlayer.id} (${refPlayer.name}) missing in current run`);
            continue;
          }

          // tiles() returns a Set, convert to array to get length
          const currTiles = currPlayer.tiles();
          const currTileCount = Array.from(currTiles).length;
          if (currTileCount !== refPlayer.tileCount) {
            warnings.push(
              `Tile count mismatch for player ${refPlayer.name}: ` +
              `reference had ${refPlayer.tileCount}, current has ${currTileCount}`
            );
          }
        }

        // Compare game hash
        if (snapshot.hash !== null && typeof game.hash === 'function') {
          const currentHash = game.hash();
          if (currentHash !== snapshot.hash) {
            warnings.push(
              `Game hash mismatch at tick ${tick}: ` +
              `reference=${snapshot.hash}, current=${currentHash}. ` +
              `Spawn phase diverged between commits.`
            );
          }
        }
      } catch (e) {
        warnings.push(`Failed to validate game state snapshot: ${e}`);
      }
    },
    restoreRngSnapshot,
  };
}
