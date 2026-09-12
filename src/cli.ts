import { defineCommand, runMain } from "citty";

export interface TuiConfig {
  kind: "tui";
  spawnProcess: boolean;
  /** Everything after "up" -- passed verbatim to `tilt up`. */
  tiltArgs: string[];
  port: number;
}

const DEFAULT_TILT_PORT = 10350;

export interface LogsConfig {
  kind: "logs";
  /** Resource name to filter logs for. Empty string means all resources. */
  resource: string;
  /** Stream new logs continuously instead of dumping and exiting. */
  follow: boolean;
  host: string;
  port: number;
}

export type CLIConfig = TuiConfig | LogsConfig;

let config: CLIConfig | undefined = undefined;

const upCommand = defineCommand({
  meta: { name: "up", description: "Start tilt and connect to it" },
  run({ rawArgs }) {
    config = {
      kind: "tui",
      spawnProcess: true,
      tiltArgs: rawArgs,
      port: parsePortFromArgs(rawArgs),
    };
  },
});

const logsCommand = defineCommand({
  meta: { name: "logs", description: "Dump logs from a running tilt instance" },
  args: {
    resource: {
      type: "positional",
      description: "Resource name to filter logs for",
      required: false,
      default: "",
    },
    follow: {
      type: "boolean",
      alias: "f",
      description: "Stream new logs continuously",
      default: false,
    },
    host: {
      type: "string",
      description: "Tilt API host",
      default: "localhost",
    },
    port: {
      type: "string",
      description: "Tilt API port",
      default: "10350",
    },
  },
  run({ args }) {
    config = {
      kind: "logs",
      resource: args.resource,
      follow: args.follow,
      host: args.host,
      port: parseInt(args.port, 10),
    };
  },
});

const main = defineCommand({
  meta: {
    name: "tilt-tui",
    version: "0.3.0",
    description: "A terminal UI for Tilt",
  },
  subCommands: { up: upCommand, logs: logsCommand },
  run() {
    if (!config) {
      config = {
        kind: "tui",
        spawnProcess: false,
        tiltArgs: [],
        port: DEFAULT_TILT_PORT,
      };
    }
  },
});

export async function parseCLI(): Promise<CLIConfig> {
  await runMain(main);
  return config!;
}

function parsePortFromArgs(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && i + 1 < args.length) {
      const parsed = parseInt(args[i + 1], 10);
      if (!Number.isNaN(parsed)) return parsed;
    } else if (arg.startsWith("--port=")) {
      const parsed = parseInt(arg.slice("--port=".length), 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return DEFAULT_TILT_PORT;
}
