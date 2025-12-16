# OpenFront Replay Analyzer

This repository runs OpenFront replays against the exact game engine version recorded in each replay’s `gitCommit`, without embedding the analyzer inside the main OpenFront repo.

## How it works

- Reads `gitCommit` from the replay JSON.
- Fetches that commit from the OpenFront repo into a local cache (`.cache/openfront/`) using `git worktree`.
- Dynamically imports the engine modules from the checked-out commit (schemas + runner).
- Replays ticks and generates an offline HTML performance report.

## Usage

Install analyzer deps:

```sh
npm install
```

Analyze a replay (auto-fetch by `gitCommit`):

```sh
npm run replay:analyze -- path/to/replay.json
```

Analyze by game id (fetches the replay JSON from the API and saves it to `replays/<id>.json`):

```sh
npm run replay:analyze -- CkWVL6Qe
```

Use an existing OpenFront checkout (no fetch):

```sh
npm run replay:analyze -- path/to/replay.json --openfrontRoot path/to/OpenFrontIO --noInstall
```

Common flags:

- `--out path/to/report.html`
- `--maxTurns 5000`
- `--economySampleEvery 10`
- `--verbose`
- `--cpuProfile` (writes `replays/out/*.cpuprofile` for the replay run)
- `--repo <git-url>` (default `https://github.com/OpenFrontIO/OpenFrontIO.git`)
- `--cacheDir <path>` (default `.cache/openfront` in this repo)
- `--apiBase <url>` (default `https://api.openfront.io`)
- `--compareAgainst <commitId>` (compare performance against a different commit)

## Cross-Commit Performance Comparison

Compare the same replay across different OpenFront commits to measure optimization impact:

```sh
npm run replay:analyze -- CkWVL6Qe --compareAgainst abc123def456789012345678901234567890abcd
```

This runs the replay **twice**:
1. On the **reference commit** (from replay's `gitCommit`) - captures player IDs and state
2. On the **comparison commit** - injects captured state for fair comparison

The generated report shows:
- Side-by-side performance metrics with deltas (avg/p95/max tick times)
- Visual tick execution graphs for both commits
- Hash mismatch detection
- Warnings about map/config differences

**Use case:** Validate that pathfinding optimizations in commit `abc123d` actually improved performance vs. the original commit `2e52c0a` that recorded the replay.

### How State Injection Works

Cross-commit replay comparison is challenging because game simulation depends heavily on random number generation (RNG), especially during the spawn phase. Even with the same replay inputs, different commits may produce different outcomes due to:

- **Player spawn positions** (if `randomSpawn` is enabled)
- **Bot placement and naming** (uses separate RNG instances)
- **Nation/NPC initialization**
- **Internal RNG state synchronization**

To enable fair performance comparison, we use **state capture and injection**:

#### 1. Reference Run (Capture Phase)

The reference commit (from replay's `gitCommit`) runs first with instrumentation:

- **Player ID capture**: Intercepts `PseudoRandom.nextID()` calls to record the sequence of player/unit IDs
- **Tick 0 snapshot**: Captures initial state immediately after game initialization:
  - Player count and IDs
  - Initial game hash
- **Tick 30 snapshot**: Captures complete game state after spawn phase:
  - All player IDs, names, types
  - Tile ownership counts per player
  - Post-spawn game hash

#### 2. Comparison Run (Injection Phase)

The comparison commit runs with injected state:

- **Player ID injection**: `PseudoRandom.nextID()` returns captured IDs **while still consuming RNG state**
  - Critical: Must call the original `nextID()` to advance internal RNG sequence
  - Returns captured ID instead of generated ID
  - Keeps all subsequent `nextInt()`, `next()`, `randElement()` calls synchronized
- **Tick 0 validation**: Compares initial game state:
  - Player count and IDs must match
  - Initial hash comparison
  - Detects initialization differences
- **Tick 30 validation**: Compares post-spawn game state:
  - Player count match
  - Tile ownership match
  - Post-spawn hash match

If validation passes, the two runs should produce identical simulation paths, making performance comparison meaningful. If validation fails, warnings indicate what diverged (spawn logic changes, map differences, etc.).

#### Why This Approach Works

By consuming RNG state during injection, we maintain the internal PRNG sequence integrity. This ensures that all random decisions **after** player ID generation (pathfinding randomness, unit placement, combat outcomes) remain synchronized between commits.

#### Limitations and Spawn Phase Divergence

**Important**: The spawn phase (ticks 0-30) uses **separate RNG instances** seeded from the game ID for:
- Player spawn position selection (`PlayerSpawner`)
- Bot spawn position and naming (`BotSpawner`)
- NPC/Nation territory expansion

These spawn executors create their own `PseudoRandom` instances that we don't intercept. As a result:

- **If spawn logic changed between commits**: The spawn phase will diverge, causing different initial game states
- **Hash mismatches starting before tick 30**: Indicates spawn phase divergence
- **Tile count differences at tick 30**: Players/bots own different territories

**Performance comparison remains valid**: Even with spawn divergence, the performance delta is real and meaningful. You're measuring how efficiently each commit processes the replay, even if the exact game states differ slightly.

**For perfect synchronization**: Both commits must have identical spawn logic. Use this tool to compare commits with only optimization changes (no spawn logic changes).

**Interpreting Results**:
- `0 hash mismatches`: ✅ Perfect sync - commits produce identical game states
- `Tick 0 hash mismatch`: ⚠️ Initialization differs (player setup or game creation changed)
- `First mismatch at tick 10-30`: ⚠️ Spawn phase diverged (performance delta valid, states differ)
- `First mismatch at tick 50+`: ⚠️ Spawn synced, later logic diverged (still useful for comparison)
- `25+ tile count warnings`: ⚠️ Significant spawn differences (expect hash mismatches)

## Analyzing CPU Profiles

The `--cpuProfile` flag generates a `.cpuprofile` file that can be analyzed with several tools:

### Chrome DevTools

Open Chrome DevTools → Performance tab → Load profile, https://developer.chrome.com/docs/devtools/performance/reference#analyze.

### speedscope

Upload your `.cpuprofile` to [speedscope.app](https://www.speedscope.app/) for an interactive flame graph visualization.

### VS Code

VS Code has built-in support for analyzing CPU profiles:

- **Built-in**: Open the `.cpuprofile` file directly in VS Code. See [VS Code Node.js Profiling docs](https://code.visualstudio.com/docs/nodejs/profiling#_analyzing-a-profile).
- **Flame Graph Extension**: Install [vscode-js-profile-flame](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-js-profile-flame) for flame graph visualization directly in the editor.

## Notes

- Reports are written to `replays/out/` by default (gitignored).

