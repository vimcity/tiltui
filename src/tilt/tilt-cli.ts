export class TiltBinaryNotFoundError extends Error {
  constructor() {
    super("unable to locate tilt binary in your environment");
    this.name = "TiltBinaryNotFoundError";
  }
}

export class TiltCliError extends Error {
  constructor(
    public readonly args: string[],
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`tilt ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`);
    this.name = "TiltCliError";
  }
}

export const TILT_ENV = {
  TILT_DISABLE_ANALYTICS: "true",
  DO_NOT_TRACK: "true",
  TILT_ATTACH_REUSE_CLUSTER_IMAGES: "1",
} as const;

const SAFE_ENV_PREFIXES = ["TILT_", "KUBECONFIG"] as const;
const SAFE_ENV_NAMES = [
  "HOME",
  "PATH",
  "SHELL",
  "TERM",
  "USER",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
] as const;

export function createTiltEnvironment(
  extraEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const name of SAFE_ENV_NAMES) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      SAFE_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      env[name] = value;
    }
  }

  return {
    ...env,
    ...TILT_ENV,
    ...extraEnv,
  };
}

/**
 * Resolve the tilt binary path. If an explicit override is provided, it is
 * used directly (verified to exist); otherwise the binary is discovered on PATH.
 */
export function resolveTiltBinary(override?: string): string {
  if (override) {
    const resolved = Bun.which(override);
    if (!resolved) {
      throw new TiltBinaryNotFoundError();
    }
    return resolved;
  }

  const binary = Bun.which("tilt");
  if (!binary) {
    throw new TiltBinaryNotFoundError();
  }
  return binary;
}

interface RunTiltCliOptions {
  args: string[];
  env?: Record<string, string>;
  /** Optional override path to the tilt binary. */
  binaryPath?: string;
}

interface TiltCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn the tilt CLI, collect stdout/stderr, and assert a zero exit code.
 * Throws TiltBinaryNotFoundError if tilt is not on PATH.
 * Throws TiltCliError on non-zero exit.
 */
export async function runTiltCli(
  options: RunTiltCliOptions,
): Promise<TiltCliResult> {
  const binary = resolveTiltBinary(options.binaryPath);

  const proc = Bun.spawn([binary, ...options.args], {
    env: createTiltEnvironment(options.env),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new TiltCliError(options.args, exitCode, stderr);
  }

  return { stdout, stderr, exitCode };
}
