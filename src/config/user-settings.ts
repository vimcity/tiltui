// User Settings - loads and manages user configuration from ~/.config/tilt-tui/config.json

import { homedir } from "os";
import { join } from "path";

/**
 * Log filter configuration - maps filter name to array of regex patterns.
 * Each pattern is matched against log line text.
 */
export interface LogFilters {
  [name: string]: string[];
}

/**
 * User settings loaded from config file.
 */
export interface UserSettings {
  /** Named log filters with regex patterns to ignore matching log lines */
  logFilters?: LogFilters;
  /** Override path to the tilt binary (otherwise discovered on PATH) */
  tiltBinaryPath?: string;
  /** Disable copying selected logs to local clipboard sinks. */
  disableClipboardCopy?: boolean;
  /** Replace default key bindings by command name. */
  keybindings?: Record<string, string[]>;
}

/**
 * Compiled log filters with pre-built RegExp objects for performance.
 */
export interface CompiledLogFilters {
  /** Filter name for display */
  name: string;
  /** Compiled regex patterns */
  patterns: RegExp[];
}

/**
 * Runtime representation of user settings with compiled regexes.
 */
export interface RuntimeSettings {
  /** Original settings from config file */
  raw: UserSettings;
  /** Compiled log filters ready for matching */
  logFilters: CompiledLogFilters[];
  /** Names of active log filters for display */
  activeFilterNames: string[];
  /** Override path to the tilt binary, if configured */
  tiltBinaryPath?: string;
  /** Disable copying selected logs to local clipboard sinks. */
  disableClipboardCopy: boolean;
  keybindings: Record<string, string[]>;
}

const CONFIG_DIR = ".config/tilt-tui";
const CONFIG_FILE = "config.json";

/**
 * Get the full path to the config file.
 */
export function getConfigPath(): string {
  return join(homedir(), CONFIG_DIR, CONFIG_FILE);
}

/**
 * Load user settings from the config file.
 * Returns default empty settings if file doesn't exist or is invalid.
 */
export async function loadUserSettings(): Promise<RuntimeSettings> {
  const configPath = getConfigPath();

  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();

    if (!exists) {
      console.log(`Config file not found at ${configPath}, using defaults`);
      return createDefaultSettings();
    }

    const content = await file.text();
    const settings = JSON.parse(content) as UserSettings;

    return compileSettings(settings);
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
    return createDefaultSettings();
  }
}

/**
 * Create default empty settings.
 */
function createDefaultSettings(): RuntimeSettings {
  return {
    raw: {},
    logFilters: [],
    activeFilterNames: [],
    disableClipboardCopy: false,
    keybindings: {},
  };
}

/**
 * Compile raw settings into runtime settings with pre-built RegExp objects.
 */
function compileSettings(settings: UserSettings): RuntimeSettings {
  const logFilters: CompiledLogFilters[] = [];
  const activeFilterNames: string[] = [];

  if (settings.logFilters) {
    for (const [name, patterns] of Object.entries(settings.logFilters)) {
      const compiledPatterns: RegExp[] = [];

      for (const pattern of patterns) {
        try {
          compiledPatterns.push(new RegExp(pattern));
        } catch (error) {
          console.error(
            `Invalid regex pattern "${pattern}" in filter "${name}":`,
            error,
          );
        }
      }

      if (compiledPatterns.length > 0) {
        logFilters.push({ name, patterns: compiledPatterns });
        activeFilterNames.push(name);
      }
    }
  }

  return {
    raw: settings,
    logFilters,
    activeFilterNames,
    tiltBinaryPath: settings.tiltBinaryPath,
    disableClipboardCopy: settings.disableClipboardCopy === true,
    keybindings: settings.keybindings ?? {},
  };
}

/**
 * Check if a log line text matches any of the compiled filters.
 * Returns true if the line should be filtered (ignored).
 */
export function shouldFilterLogLine(
  text: string,
  filters: CompiledLogFilters[],
): boolean {
  for (const filter of filters) {
    for (const pattern of filter.patterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
  }
  return false;
}
