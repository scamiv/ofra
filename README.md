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

