# Replay Analyzer

Generates an offline HTML report with per-tick performance graphs by replaying a `GameRecord` / `PartialGameRecord` JSON through the same tick engine used in the worker (`GameRunner`).

## Usage

```sh
npm install
npm run replay:analyze -- path/to/replay.json
```

You can also pass a game id instead of a file path (it will fetch the replay JSON from the API and save it to `replays/<id>.json`):

```sh
npm run replay:analyze -- CkWVL6Qe
```

Options:

- `--out path/to/report.html`
- `--maxTurns 5000`
- `--economySampleEvery 10` (sample economy series every N turns; set to `1` for per-tick fidelity)
- `--verbose` (prints worker `console.*` noise instead of summarizing it)
- `--cpuProfile` (writes `replays/out/*.cpuprofile` for the replay run)
- `--openfrontRoot path/to/OpenFrontIO` (skip fetching; use local checkout)
- `--repo <git-url>` (default `https://github.com/OpenFrontIO/OpenFrontIO.git`)
- `--cacheDir path/to/cache` (default `.cache/openfront` in this repo)
- `--noInstall` (skip `npm ci` in the fetched checkout)
- `--apiBase <url>` (default `https://api.openfront.io`)

By default it reads `gitCommit` from the replay, fetches that exact OpenFront commit into `.cache/openfront/`, dynamically imports the engine from that checkout, and writes the report to `replays/out/`.

## Local smoke test (no fetch)

If you already have an OpenFront checkout on disk (with `node_modules/` present), you can skip fetching:

```sh
npm run replay:analyze -- replays/CkWVL6Qe.json --openfrontRoot path/to/OpenFrontIO --noInstall --maxTurns 50
```
