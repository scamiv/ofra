export function usage(): string {
  return [
    "Replay performance analyzer",
    "",
    "Usage:",
    "  npx tsx tools/replay-analyzer/analyzeReplay.ts <replay.json|gameID> [--out <report.html>] [--maxTurns <n>] [--economySampleEvery <n>] [--verbose]",
    "",
    "OpenFront source selection:",
    "  --openfrontRoot <path>     Use an existing OpenFront checkout (skips fetching).",
    "  --repo <git-url>           Git remote to fetch from (default: https://github.com/OpenFrontIO/OpenFrontIO.git).",
    "  --cacheDir <path>          Where to cache fetched commits (default: .cache/openfront).",
    "  --noInstall                Skip `npm ci` in the fetched checkout (will likely fail if deps are missing).",
    "",
    "Replay fetching:",
    "  --apiBase <url>            Fetch replay by id from this API (default: https://api.openfront.io).",
    "",
    "Profiling:",
    "  --cpuProfile               Write a V8 CPU profile (.cpuprofile) for the replay run.",
    "",
    "Notes:",
    "  - Accepts OpenFront GameRecord / PartialGameRecord JSON.",
    "  - Runs the same tick engine used by the worker (GameRunner) and records per-tick execution time.",
    "  - Economy series are computed from in-engine Stats + gold balances and sampled every N turns to keep report size reasonable.",
  ].join("\n");
}

export function parseArgs(argv: string[]): {
  replayPath: string | null;
  outPath: string | null;
  maxTurns: number | null;
  economySampleEvery: number;
  help: boolean;
  verbose: boolean;
  openfrontRoot: string | null;
  repoUrl: string;
  cacheDir: string | null;
  install: boolean;
  apiBase: string;
  cpuProfile: boolean;
} {
  let replayPath: string | null = null;
  let outPath: string | null = null;
  let maxTurns: number | null = null;
  let economySampleEvery = 10;
  let help = false;
  let verbose = false;
  let openfrontRoot: string | null = null;
  let repoUrl = "https://github.com/OpenFrontIO/OpenFrontIO.git";
  let cacheDir: string | null = null;
  let install = true;
  let apiBase = "https://api.openfront.io";
  let cpuProfile = false;

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }
    if (arg === "--out") {
      outPath = args.shift() ?? null;
      continue;
    }
    if (arg === "--openfrontRoot") {
      openfrontRoot = args.shift() ?? null;
      continue;
    }
    if (arg === "--repo") {
      const v = args.shift();
      if (!v) throw new Error("Missing value for --repo");
      repoUrl = v;
      continue;
    }
    if (arg === "--cacheDir") {
      cacheDir = args.shift() ?? null;
      continue;
    }
    if (arg === "--noInstall") {
      install = false;
      continue;
    }
    if (arg === "--apiBase") {
      apiBase = args.shift() ?? "";
      if (!apiBase) throw new Error("Missing value for --apiBase");
      continue;
    }
    if (arg === "--cpuProfile") {
      cpuProfile = true;
      continue;
    }
    if (arg === "--maxTurns") {
      const value = args.shift();
      maxTurns = value ? Number.parseInt(value, 10) : NaN;
      if (!Number.isFinite(maxTurns)) {
        throw new Error(`Invalid --maxTurns: ${value ?? ""}`);
      }
      continue;
    }
    if (arg === "--economySampleEvery") {
      const value = args.shift();
      economySampleEvery = value ? Number.parseInt(value, 10) : NaN;
      if (!Number.isFinite(economySampleEvery) || economySampleEvery <= 0) {
        throw new Error(`Invalid --economySampleEvery: ${value ?? ""}`);
      }
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    if (replayPath === null) {
      replayPath = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return {
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
  };
}
