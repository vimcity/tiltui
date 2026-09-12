// Tilt API Client - TypeScript translation from Go

import { parseArgs } from "util";
import type {
  APIViewResponse,
  APILogList,
  APIButton,
  APIInputStatus,
  APIFileWatchList,
} from "./api-types";
import type { Resource, LogEntry } from "./types";
import { resourceFromAPIResource as convertResource } from "./types";
import {
  resource,
  createSignal,
  action,
  call,
  type Operation,
  type Stream,
  type Signal,
} from "effection";
import { runTiltCli, TiltBinaryNotFoundError, TiltCliError } from "./tilt-cli";

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 10350;

export interface TiltClientOptions {
  host?: string;
  port?: number;
  /** Override path to the tilt binary (otherwise discovered on PATH) */
  tiltBinaryPath?: string;
}

export interface ResourcesUpdate {
  resources: Resource[];
}

export interface ButtonsUpdate {
  buttons: APIButton[];
}

export interface SessionUpdate {
  tiltStartTime: string;
}

/** @deprecated Use ResourcesUpdate instead */
export type TiltData = ResourcesUpdate;

/** Logs update from WebSocket */
export interface LogsUpdate {
  logList: APILogList;
  /** Parsed log entries keyed by resource name */
  entries: Map<string, LogEntry[]>;
}

/** Combined streams returned by useTiltStreams() */
export interface TiltStreams {
  resources: Stream<ResourcesUpdate, void>;
  buttons: Stream<ButtonsUpdate, void>;
  logs: Stream<LogsUpdate, void>;
  session: Stream<SessionUpdate, void>;
}

/** Narrow types for tilt dump engine output (unstable format, keep minimal). */
export interface EngineDumpManifest {
  name: string;
  resourceDependencies: string[] | null;
}

export interface EngineDumpManifestTarget {
  manifest: EngineDumpManifest;
}

export interface EngineDump {
  desiredTiltfilePath?: string;
  manifestTargets: Record<string, EngineDumpManifestTarget>;
}

export class TiltClient {
  private baseURL: string;
  private wsURL: string;
  private host: string;
  private port: number;
  // Optional override path to the tilt binary; falls back to PATH discovery.
  private tiltBinaryPath?: string;
  // Tilt-Token session cookie, issued by the server when loading the root page.
  // Required (since ~tilt v0.37) to authenticate API and WebSocket requests.
  private sessionCookie: string | null = null;

  constructor(options: TiltClientOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.tiltBinaryPath = options.tiltBinaryPath;
    this.baseURL = `http://${this.host}:${this.port}`;
    this.wsURL = `ws://${this.host}:${this.port}`;
  }

  /**
   * Set an override path to the tilt binary. Useful when the path is loaded
   * asynchronously (e.g. from user settings) after the client is constructed.
   */
  setTiltBinaryPath(path: string | undefined): void {
    this.tiltBinaryPath = path;
  }

  /**
   * Fetch the Tilt-Token session cookie from the server's root page.
   * Newer Tilt versions require this cookie on API and WebSocket requests.
   * The value is cached after the first successful fetch.
   */
  private async getSessionCookie(): Promise<string> {
    if (this.sessionCookie) {
      return this.sessionCookie;
    }

    const response = await fetch(`${this.baseURL}/`);
    if (!response.ok) {
      throw new Error(`Failed to get session cookie: ${response.status}`);
    }

    const setCookie = response.headers.get("set-cookie");
    const match = setCookie?.match(/Tilt-Token=([^;]+)/);
    if (!match) {
      throw new Error("No Tilt-Token cookie in server response");
    }

    this.sessionCookie = `Tilt-Token=${match[1]}`;
    return this.sessionCookie;
  }

  /**
   * Get the websocket token for authentication
   */
  private async getWebsocketToken(): Promise<string> {
    const cookie = await this.getSessionCookie();
    const response = await fetch(`${this.baseURL}/api/websocket_token`, {
      headers: { Cookie: cookie },
    });
    if (!response.ok) {
      throw new Error(`Failed to get websocket token: ${response.status}`);
    }
    return response.text();
  }

  /**
   * Get the WebSocket URL with authentication token plus the session cookie
   * header required to open the connection.
   * This is an Effection operation that fetches both tokens.
   */
  private *getWebSocketAuth(): Operation<{ url: string; cookie: string }> {
    const cookie: string = yield* call(() => this.getSessionCookie());
    const token: string = yield* call(() => this.getWebsocketToken());
    return {
      url: `${this.wsURL}/ws/view?csrf=${encodeURIComponent(token)}`,
      cookie,
    };
  }

  /**
   * Create two subscription-based streams from a single WebSocket connection.
   *
   * Returns an Operation that yields TiltStreams with:
   * - `resources`: Subscription for resource/button updates
   * - `logs`: Subscription for log updates
   *
   * Both subscriptions share the same WebSocket connection. The connection
   * is automatically closed when the operation's scope exits (structured concurrency).
   *
   * Usage with Effection:
   * ```
   * const streams = yield* client.useTiltStreams();
   *
   * yield* spawn(function*() {
   *   for (const update of yield* each(streams.resources)) {
   *     // handle resources serially
   *     yield* each.next();
   *   }
   * });
   *
   * yield* spawn(function*() {
   *   for (const update of yield* each(streams.logs)) {
   *     // handle logs serially
   *     yield* each.next();
   *   }
   * });
   *
   * yield* suspend(); // keep alive until scope exits
   * ```
   */
  *useTiltStreams(): Operation<TiltStreams> {
    const { url: wsURL, cookie } = yield* this.getWebSocketAuth();

    return yield* resource<TiltStreams>(function* (provide) {
      // Create two signals - one for resources, one for logs
      const resourcesSignal: Signal<ResourcesUpdate, void> = createSignal<
        ResourcesUpdate,
        void
      >();
      const logsSignal: Signal<LogsUpdate, void> = createSignal<
        LogsUpdate,
        void
      >();
      const buttonsSignal: Signal<ButtonsUpdate, void> = createSignal<
        ButtonsUpdate,
        void
      >();
      const sessionSignal: Signal<SessionUpdate, void> = createSignal<
        SessionUpdate,
        void
      >();

      // Bun's WebSocket supports a headers option (not in the DOM lib types,
      // which win the global type when "DOM" is in tsconfig lib). Cast the
      // constructor to Bun's signature so we can send the Tilt-Token cookie.
      const BunWebSocket = WebSocket as unknown as new (
        url: string,
        options: Bun.WebSocketOptions,
      ) => WebSocket;
      const ws = new BunWebSocket(wsURL, {
        headers: { Cookie: cookie },
      });

      ws.onmessage = (event) => {
        try {
          const viewResp: APIViewResponse = JSON.parse(event.data);

          if (viewResp.uiSession?.status.tiltfileKey) {
            console.log(
              "USING TILTFILE",
              viewResp.uiSession?.status.tiltfileKey,
            );
          }

          if (viewResp.uiSession?.status.tiltStartTime) {
            sessionSignal.send({
              tiltStartTime: viewResp.uiSession.status.tiltStartTime,
            });
          }

          if (viewResp.uiResources) {
            const resources = viewResp.uiResources.map(convertResource);
            resourcesSignal.send({
              resources,
            });
          }

          if (viewResp.uiButtons) {
            buttonsSignal.send({
              buttons: viewResp.uiButtons,
            });
          }

          // Send logs update if logList is present
          if (viewResp.logList) {
            const entries = parseLogList(viewResp.logList);
            logsSignal.send({
              logList: viewResp.logList,
              entries,
            });
          }
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };

      ws.onerror = () => {
        console.error("WebSocket error");
      };

      ws.onclose = () => {
        resourcesSignal.close();
        buttonsSignal.close();
        logsSignal.close();
        sessionSignal.close();
      };

      yield* waitForWebSocketOpen(ws);

      try {
        // Provide all subscriptions to the caller
        yield* provide({
          resources: resourcesSignal,
          buttons: buttonsSignal,
          logs: logsSignal,
          session: sessionSignal,
        });
      } finally {
        // Cleanup: close WebSocket when scope exits
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
      }
    });
  }

  async getTiltArgs(): Promise<Record<string, string | boolean | undefined>> {
    try {
      // EDITOR=cat so tilt dumps the temp file instead of opening an editor
      const { stdout } = await runTiltCli({
        args: ["args", "--host", this.host, "--port", String(this.port)],
        env: { EDITOR: "cat" },
        binaryPath: this.tiltBinaryPath,
      });

      // tilt args are on second line of output
      const argsLine = stdout.split("\n")[1];
      const args = argsLine.split(" ");

      // TODO: expected args as config?
      const tiltArgs = parseArgs({
        args,
        strict: false,
        options: {
          environment: { type: "string" },
          profile: { type: "string" },
        },
      });

      return {
        environment: tiltArgs.values.environment,
        profile: tiltArgs.values.profile,
      };
    } catch (e) {
      if (e instanceof TiltBinaryNotFoundError || e instanceof TiltCliError) {
        console.error(e.message);
      } else {
        console.error("error parsing tilt args", e);
      }
      return {};
    }
  }

  /**
   * Get the tilt CLI version string (e.g. "v0.35.0, built 2025-06-13").
   * Returns null if the tilt binary is unavailable or the command fails.
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await runTiltCli({
        args: ["version"],
        binaryPath: this.tiltBinaryPath,
      });
      return stdout.trim() || null;
    } catch (e) {
      if (e instanceof TiltBinaryNotFoundError || e instanceof TiltCliError) {
        console.error(e.message);
      } else {
        console.error("error getting tilt version", e);
      }
      return null;
    }
  }

  /**
   * Trigger a resource rebuild
   */
  async triggerResource(
    resourceName: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const body = JSON.stringify({
      manifest_names: [resourceName],
      build_reason: 16,
    });

    const cookie = await this.getSessionCookie();
    const response = await fetch(`${this.baseURL}/api/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to trigger resource: ${response.status}`);
    }
  }

  /**
   * Format a date for Tilt API (requires exactly 6 decimal places for microseconds)
   * e.g., "2024-01-15T10:30:00.000000Z"
   *
   * see https://github.com/tilt-dev/tilt/blob/master/web/src/tiltApi.ts#L6
   */
  private formatApiTime(date: Date): string {
    const iso = date.toISOString(); // "2024-01-15T10:30:00.123Z"
    // Replace milliseconds (.123Z) with microseconds (.123000Z)
    return iso.replace(/\.(\d{3})Z$/, ".$1000Z");
  }

  /**
   * Click a UI button
   * @param button - The full APIButton object (includes resourceVersion needed for updates)
   * @param inputValues - Optional input values for buttons with inputs
   * @returns The updated APIButton with new resourceVersion
   */
  async clickButton(
    button: APIButton,
    inputValues: Record<string, any> = {},
    signal?: AbortSignal,
  ): Promise<APIButton> {
    // Build input statuses from the button's input specs and provided values
    const inputStatuses: APIInputStatus[] = [];
    for (const spec of button.spec.inputs ?? []) {
      const name = spec.name;
      const value = inputValues[name];
      const defined = value !== undefined;

      const status: APIInputStatus = { name };

      if (spec.text) {
        status.text = {
          value: defined ? value : (spec.text.defaultValue ?? ""),
        };
      } else if (spec.bool) {
        status.bool = {
          value: (defined ? value : spec.bool.defaultValue) === true,
        };
      } else if (spec.hidden) {
        // Allow overriding hidden input values (needed for disable toggle)
        status.hidden = { value: defined ? value : (spec.hidden.value ?? "") };
      } else if (spec.choice) {
        status.choice = {
          value: defined ? value : (spec.choice.choices?.[0] ?? ""),
        };
      }

      inputStatuses.push(status);
    }

    // Construct payload with full metadata (including resourceVersion) and updated status
    const payload = {
      metadata: { ...button.metadata },
      status: {
        ...button.status,
        lastClickedAt: this.formatApiTime(new Date()),
        inputs: inputStatuses,
      },
    };

    const response = await fetch(
      `${this.baseURL}/proxy/apis/tilt.dev/v1alpha1/uibuttons/${button.metadata.name}/status`,
      {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: await this.getSessionCookie(),
        },
        body: JSON.stringify(payload),
        signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to click button: ${response.status} - ${text}`);
    }

    // Return the updated button with new resourceVersion from server
    const updatedButton: APIButton = await response.json();

    return updatedButton;
  }

  /**
   * Check if Tilt server is running
   */
  async checkHealth(signal?: AbortSignal): Promise<boolean> {
    try {
      const cookie = await this.getSessionCookie();
      const response = await fetch(`${this.baseURL}/api/view`, {
        headers: { Cookie: cookie },
        signal,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch all FileWatch resources via the tilt CLI
   */
  async getFileWatches(): Promise<APIFileWatchList> {
    const { stdout } = await runTiltCli({
      args: [
        "get",
        "filewatches",
        "-o",
        "json",
        "--host",
        this.host,
        "--port",
        String(this.port),
      ],
      binaryPath: this.tiltBinaryPath,
    });
    const parsed = JSON.parse(stdout);
    return { items: parsed.items ?? [] };
  }

  /**
   * Fetch the engine state via tilt dump engine CLI.
   * Returns a narrowly typed subset of the unstable dump format.
   */
  async dumpEngine(): Promise<EngineDump> {
    const { stdout } = await runTiltCli({
      args: [
        "dump",
        "engine",
        "--host",
        this.host,
        "--port",
        String(this.port),
      ],
      binaryPath: this.tiltBinaryPath,
    });

    const parsed = JSON.parse(stdout);
    const rawTargets: Record<string, Record<string, unknown>> =
      parsed.ManifestTargets ?? {};
    const manifestTargets: EngineDump["manifestTargets"] = {};
    for (const [key, val] of Object.entries(rawTargets)) {
      const m = val.Manifest as Record<string, unknown> | undefined;
      manifestTargets[key] = {
        manifest: {
          name: (m?.Name as string) ?? key,
          resourceDependencies:
            (m?.ResourceDependencies as string[] | null) ?? null,
        },
      };
    }
    return {
      desiredTiltfilePath: parsed.DesiredTiltfilePath,
      manifestTargets,
    };
  }

  /**
   * Open a URL in the default browser
   */
  async openUrl(url: string): Promise<void> {
    const { spawn, which } = await import("bun");

    let cmd: string;
    if (process.platform === "darwin") {
      cmd = "open";
    } else if (process.platform === "win32") {
      cmd = "start";
    } else {
      cmd = which("xdg-open") ? "xdg-open" : "wslview";
    }

    try {
      const proc = spawn([cmd, url], { stdout: "ignore", stderr: "pipe" });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        console.error(
          `Failed to open URL "${url}": ${cmd} exited with code ${exitCode}${
            stderr ? `: ${stderr.trim()}` : ""
          }`,
        );
      }
    } catch (err) {
      console.error(`Failed to open URL "${url}" with ${cmd}:`, err);
    }
  }
}

/**
 * Wait for a WebSocket to open using action() for callback-style API.
 */
function waitForWebSocketOpen(ws: WebSocket): Operation<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return {
      *[Symbol.iterator]() {
        return;
      },
    };
  }

  return action<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("WebSocket failed to connect"));
    };

    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before opening"));
    };

    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);

    // Return cleanup function for when operation is halted
    return cleanup;
  });
}

/**
 * Parse a LogList from the WebSocket into LogEntry objects grouped by resource name.
 * Returns a Map where keys are resource names and values are arrays of log entries.
 */
export function parseLogList(logList: APILogList): Map<string, LogEntry[]> {
  const result = new Map<string, LogEntry[]>();

  if (!logList.segments || !logList.spans) {
    return result;
  }

  // Build span to manifest mapping
  const spanToManifest = new Map<string, string>();
  for (const [spanId, span] of Object.entries(logList.spans)) {
    if (span?.manifestName) {
      spanToManifest.set(spanId, span.manifestName);
    }
  }

  // Parse segments into LogEntry objects grouped by resource
  for (const seg of logList.segments) {
    if (!seg.spanId) {
      console.warn("no spanid for segment", seg);
      continue;
    }

    const resourceName = spanToManifest.get(seg.spanId) ?? "";

    const entry: LogEntry = {
      timestamp: new Date(seg.time),
      spanId: seg.spanId,
      level: seg.level,
      text: seg.text.replace(/\n$/, ""),
      source: resourceName,
    };

    const existing = result.get(resourceName) ?? [];
    existing.push(entry);
    result.set(resourceName, existing);
  }

  return result;
}
