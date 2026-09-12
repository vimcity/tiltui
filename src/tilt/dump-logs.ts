import { run, each, spawn, type Operation } from "effection";
import type { LogsConfig } from "../cli";
import { TiltClient } from "./client";
import LogStore from "./logstore2";
import { logLinesToString } from "./log-utils";

export async function dumpLogs(
  config: LogsConfig,
  tiltBinaryPath?: string,
): Promise<void> {
  const client = new TiltClient({
    host: config.host,
    port: config.port,
    tiltBinaryPath,
  });

  const healthy = await client.checkHealth();
  if (!healthy) {
    console.error(
      `Failed to connect to Tilt at ${config.host}:${config.port} — is Tilt running?`,
    );
    process.exit(1);
  }

  const logStore = new LogStore();
  let checkpoint = 0;

  const task = run(function* (): Operation<void> {
    const streams = yield* client.useTiltStreams();

    // Drain resource stream so the WebSocket stays healthy,
    // but we only care about logs.
    yield* spawn(function* () {
      for (const _ of yield* each(streams.resources)) {
        yield* each.next();
      }
    });

    for (const update of yield* each(streams.logs)) {
      logStore.append(update.logList);

      const showPrefix = !config.resource;
      const patch = config.resource
        ? logStore.manifestLogPatchSet(config.resource, checkpoint)
        : logStore.allLogPatchSet(checkpoint);

      checkpoint = patch.checkpoint;

      if (patch.lines.length > 0) {
        process.stdout.write(
          logLinesToString(patch.lines, showPrefix) + "\n",
        );
      }

      if (!config.follow) return;

      yield* each.next();
    }
  });

  if (config.follow) {
    const halt = () => {
      task.halt();
    };
    process.on("SIGINT", halt);
    process.on("SIGTERM", halt);
  }

  await task;
}
