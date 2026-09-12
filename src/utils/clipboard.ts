/**
 * Clipboard utility that uses subprocess-based copy to bypass OSC 52 size limits.
 *
 * OSC 52 clipboard sequences are unreliable for large payloads when going through
 * terminal multiplexers (tmux) and certain terminal emulators. This module detects
 * the platform and uses the most reliable clipboard mechanism available.
 */

let resolvedCommand: string[] | null | undefined;

function detectClipboardCommand(): string[] | null {
  if (resolvedCommand !== undefined) return resolvedCommand;

  const isWSL =
    process.env.WSL_DISTRO_NAME !== undefined ||
    process.env.WSLENV !== undefined;

  if (isWSL) {
    resolvedCommand = ["clip.exe"];
    return resolvedCommand;
  }

  if (process.env.WAYLAND_DISPLAY) {
    resolvedCommand = ["wl-copy"];
    return resolvedCommand;
  }

  if (process.env.DISPLAY) {
    resolvedCommand = ["xclip", "-selection", "clipboard"];
    return resolvedCommand;
  }

  if (process.platform === "darwin") {
    resolvedCommand = ["pbcopy"];
    return resolvedCommand;
  }

  resolvedCommand = null;
  return null;
}

/**
 * Copy text to the system clipboard using a subprocess.
 * Returns true if the copy succeeded, false if no clipboard command is available
 * or the command failed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const cmd = detectClipboardCommand();
  if (!cmd) return false;

  try {
    const proc = Bun.spawn(cmd, {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });
    proc.stdin.write(text);
    proc.stdin.end();
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}
