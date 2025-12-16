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

## Notes

- Fetching requires `git` and network access to the OpenFront Git remote (and auth if the repo is private).
- Reports are written to `replays/out/` by default (gitignored).
