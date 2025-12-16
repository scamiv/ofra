import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function tryPatchPseudoRandomForReplayAnalyzer(gameRoot: string): Promise<void> {
  const pseudoRandomPath = path.join(gameRoot, "src", "core", "PseudoRandom.ts");
  try {
    const original = await fs.readFile(pseudoRandomPath, "utf8");
    if (original.includes("replay-analyzer: PseudoRandom instrumentation")) {
      return;
    }

    // Very small file; do simple, robust string edits with clear failure modes.
    let next = original;

    // 1) Ensure seedrandom is created with state enabled.
    // We intentionally only touch the exact constructor assignment line to avoid surprising diffs.
    next = next.replace(
      'this.rng = seedrandom(String(seed));',
      'this.rng = seedrandom(String(seed), { state: true });',
    );

    if (next === original) {
      // If the exact match failed, do not attempt a risky patch.
      return;
    }

    // 2) Inject registry helpers after the seedrandom import.
    const importMarker = 'import seedrandom from "seedrandom";\n';
    if (!next.includes(importMarker)) return;
    next = next.replace(
      importMarker,
      importMarker +
        "\n" +
        "// replay-analyzer: PseudoRandom instrumentation (state capture + restore)\n" +
        'const __REPLAY_ANALYZER_PRNG_REGISTRY_KEY = Symbol.for("replay-analyzer.openfront.PseudoRandom.registry");\n' +
        "type __ReplayAnalyzerRegistry = { bySeed: Map<number, any[]> };\n" +
        "function __replayAnalyzerRegistry(): __ReplayAnalyzerRegistry {\n" +
        "  const g = globalThis as any;\n" +
        "  if (!g[__REPLAY_ANALYZER_PRNG_REGISTRY_KEY]) {\n" +
        "    g[__REPLAY_ANALYZER_PRNG_REGISTRY_KEY] = { bySeed: new Map<number, any[]>() } as __ReplayAnalyzerRegistry;\n" +
        "  }\n" +
        "  return g[__REPLAY_ANALYZER_PRNG_REGISTRY_KEY] as __ReplayAnalyzerRegistry;\n" +
        "}\n" +
        "export function __replayAnalyzerResetPseudoRandomRegistry(): void {\n" +
        "  const g = globalThis as any;\n" +
        "  g[__REPLAY_ANALYZER_PRNG_REGISTRY_KEY] = { bySeed: new Map<number, any[]>() } as __ReplayAnalyzerRegistry;\n" +
        "}\n",
    );

    // 3) Register instances and expose getState/setState helpers.
    // Insert right after the seedrandom assignment in the constructor.
    next = next.replace(
      'this.rng = seedrandom(String(seed), { state: true });',
      'this.rng = seedrandom(String(seed), { state: true });\n' +
        "\n" +
        "    const reg = __replayAnalyzerRegistry();\n" +
        "    const list = reg.bySeed.get(seed) ?? [];\n" +
        "    const index = list.length;\n" +
        "    list.push(this);\n" +
        "    reg.bySeed.set(seed, list);\n" +
        "    (this as any).__replayAnalyzer = { seed, index };\n",
    );

    // Add methods before class closing brace.
    // We match the shuffleArray method end (stable in known commits) and insert methods after it.
    const shuffleEndMarker =
      "  shuffleArray<T>(array: T[]): T[] {\n" +
      "    const result = [...array];\n" +
      "    for (let i = result.length - 1; i > 0; i--) {\n" +
      "      const j = this.nextInt(0, i + 1);\n" +
      "      [result[i], result[j]] = [result[j], result[i]];\n" +
      "    }\n" +
      "    return result;\n" +
      "  }\n";
    if (!next.includes(shuffleEndMarker)) return;
    next = next.replace(
      shuffleEndMarker,
      shuffleEndMarker +
        "\n" +
        "  // replay-analyzer: expose seedrandom internal state so we can snapshot/restore determinism across commits.\n" +
        "  __replayAnalyzerMeta(): { seed: number; index: number } | null {\n" +
        "    return (this as any).__replayAnalyzer ?? null;\n" +
        "  }\n" +
        "\n" +
        "  __replayAnalyzerGetState(): any {\n" +
        "    const fn = (this.rng as any).state;\n" +
        "    return typeof fn === \"function\" ? fn.call(this.rng) : null;\n" +
        "  }\n" +
        "\n" +
        "  __replayAnalyzerSetState(state: any): void {\n" +
        "    // seedrandom supports restoring from state via options.state\n" +
        "    this.rng = seedrandom(\"\", { state } as any) as any;\n" +
        "  }\n",
    );

    await fs.writeFile(pseudoRandomPath, next, "utf8");
  } catch {
    // Best-effort; if patching fails, determinism capture will degrade gracefully.
  }
}

function run(
  exe: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: opts.shell ?? false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${exe} ${args.join(" ")} failed (code ${code})\n${stderr}`));
    });
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export type CheckoutOptions = {
  repoUrl: string;
  commit: string;
  cacheDir: string;
  log?: (msg: string) => void;
};

export async function checkoutOpenFrontCommit(opts: CheckoutOptions): Promise<{ gameRoot: string }> {
  const log = opts.log ?? (() => {});
  const cacheDir = path.resolve(opts.cacheDir);
  const repoDir = path.join(cacheDir, "repo");
  const worktreesDir = path.join(cacheDir, "worktrees");
  const gameRoot = path.join(worktreesDir, opts.commit);

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(worktreesDir, { recursive: true });

  if (!(await pathExists(path.join(repoDir, ".git")))) {
    log(`cloning OpenFront repo: ${opts.repoUrl}`);
    await run("git", ["clone", "--filter=blob:none", "--no-checkout", opts.repoUrl, repoDir]);
  }

  // Check if worktree already exists (commit already cached)
  const worktreeExists = await pathExists(gameRoot);
  
  if (worktreeExists) {
    log(`using cached commit: ${opts.commit}`);
  } else {
    // Only fetch if we need to create a new worktree
    log(`fetching commit: ${opts.commit}`);
    await run("git", ["-C", repoDir, "fetch", "--depth", "1", "origin", opts.commit]);
    
    log(`creating worktree: ${gameRoot}`);
    await run("git", ["-C", repoDir, "worktree", "add", "--force", gameRoot, opts.commit]);
  }

  // Ensure determinism hooks are available for state capture/injection.
  await tryPatchPseudoRandomForReplayAnalyzer(gameRoot);

  return { gameRoot };
}

export async function ensureGameDepsInstalled(opts: {
  gameRoot: string;
  log?: (msg: string) => void;
}): Promise<void> {
  const log = opts.log ?? (() => {});
  const nodeModules = path.join(opts.gameRoot, "node_modules");
  if (await pathExists(nodeModules)) return;

  log(`installing deps in ${opts.gameRoot}`);

  // When invoked via `npm run`, this points at npm-cli.js. Running it via `node` avoids Windows .cmd issues.
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    await run(process.execPath, [npmExecPath, "ci"], { cwd: opts.gameRoot });
    return;
  }

  await run("npm", ["ci"], { cwd: opts.gameRoot, shell: process.platform === "win32" });
}
