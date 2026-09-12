import type { Subprocess } from "bun";
import { createTiltEnvironment, resolveTiltBinary } from "./tilt-cli";

let tiltProcess: Subprocess | null = null;

export async function isTiltRunning(
  port: number,
  binaryPath?: string,
): Promise<boolean> {
  let binary: string;
  try {
    binary = resolveTiltBinary(binaryPath);
  } catch {
    return false;
  }

  const proc = Bun.spawn(
    [binary, "get", "uiresources", "--port", String(port)],
    {
      stdout: "ignore",
      stderr: "ignore",
      env: createTiltEnvironment(),
    },
  );

  const exitCode = await proc.exited;
  return exitCode === 0;
}

/**
 * Check whether a TCP port already has a listener, regardless of what's
 * occupying it. Unlike isTiltRunning, this detects non-tilt services (e.g. a
 * port-forward from another tilt instance) squatting on the port.
 */
export async function isPortInUse(
  port: number,
  host = "localhost",
): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname: host,
      port,
      socket: {
        data() {},
        error() {},
      },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

export class TiltStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiltStartError";
  }
}

/**
 * Spawn `tilt up` as a child process. Args are passed through verbatim.
 *
 * Resolves once tilt has survived the initial startup window without crashing.
 * Rejects with a TiltStartError (including tilt's stderr) if tilt exits early,
 * which most commonly happens when the port is already in use.
 */
export async function startTiltProcess(
  tiltArgs: string[],
  port: number,
  binaryPath?: string,
): Promise<void> {
  const binary = resolveTiltBinary(binaryPath);
  const hasPort = tiltArgs.some(
    (arg) => arg === "--port" || arg.startsWith("--port="),
  );
  const portArgs = hasPort ? [] : ["--port", String(port)];
  const args = [binary, "up", ...portArgs, ...tiltArgs];

  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "pipe",
    env: createTiltEnvironment(),
  });
  tiltProcess = proc;

  const cleanup = () => {
    if (tiltProcess && !tiltProcess.killed) {
      tiltProcess.kill("SIGTERM");
      tiltProcess = null;
    }
  };

  process.on("exit", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  // Give tilt a brief window to fail fast (e.g. "address already in use").
  // If it's still alive after the timeout, assume a successful start.
  const STARTUP_GRACE_MS = 1500;
  const exited = await Promise.race([
    proc.exited.then((code) => ({ exited: true as const, code })),
    Bun.sleep(STARTUP_GRACE_MS).then(() => ({ exited: false as const })),
  ]);

  if (exited.exited) {
    const stderr = (await new Response(proc.stderr).text()).trim();
    tiltProcess = null;
    const detail = stderr || `tilt exited with code ${exited.code}`;
    throw new TiltStartError(detail);
  }
}
