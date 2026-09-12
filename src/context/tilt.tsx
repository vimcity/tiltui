import {
  createContext,
  useContext,
  onMount,
  onCleanup,
  type ParentProps,
  createSignal,
  batch,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  run,
  each,
  spawn,
  sleep,
  type Task,
  type Operation,
  all,
  call,
} from "effection";
import { TiltClient } from "../tilt/client";
import {
  type Resource,
  type APIButton,
  type ButtonAction,
  buttonActionFromAPIButton,
  isDisableToggleButton,
  ResourceStatus,
} from "../tilt/types";
import LogStore from "../tilt/logstore2";
import type { ConnectionStatus } from "../theme/theme";
import { loadUserSettings } from "../config/user-settings";
import { applyKeymapOverrides } from "../keymap";

export type StatusFilter =
  | "all"
  | (typeof ResourceStatus)[keyof typeof ResourceStatus];
const FILTER_ORDER: StatusFilter[] = [
  "all",
  ResourceStatus.Healthy,
  ResourceStatus.Unhealthy,
  ResourceStatus.Building,
  ResourceStatus.Pending,
];

interface TiltState {
  connectionStatus: ConnectionStatus;
  namespace: string | null;
  activeProfile: string | null;
  resources: Resource[];
  globalButtons: ButtonAction[];
  selectedResource: string | null;
  statusFilter: StatusFilter;
  showDisabledResources: boolean;
  tiltArgs: Record<string, string | boolean | undefined>;
  tiltStartTime: string | null;
}

interface TiltContextValue {
  state: TiltState;
  client: TiltClient;
  logStore: LogStore;
  selectResource: (name: string) => void;
  selectRelativeResource: (direction: 1 | -1) => void;
  triggerResource: (name: string) => Promise<void>;
  toggleResourceDisable: (name: string) => Promise<void>;
  cycleStatusFilter: () => void;
  resetStatusFilter: () => void;
  toggleShowDisabledResources: () => void;
  /** Names of active log filters from user config */
  activeLogFilterNames: () => string[];
  /** Whether log selection clipboard writes are disabled. */
  disableClipboardCopy: () => boolean;
}

const TiltContext = createContext<TiltContextValue>();

export function TiltProvider(
  props: ParentProps<{ host?: string; port?: number }>,
) {
  const client = new TiltClient({ host: props.host, port: props.port });

  const logStore = new LogStore();

  // Track active log filter names for display
  const [activeLogFilterNames, setActiveLogFilterNames] = createSignal<
    string[]
  >([]);
  const [disableClipboardCopy, setDisableClipboardCopy] = createSignal(false);

  const [state, setState] = createStore<TiltState>({
    connectionStatus: "connecting",
    namespace: null,
    activeProfile: null,
    resources: [],
    globalButtons: [],
    selectedResource: null,
    statusFilter: "all",
    showDisabledResources: false,
    tiltArgs: {},
    tiltStartTime: null,
  });

  // Task handle for the main Effection operation
  let mainTask: Task<void> | null = null;

  /**
   * Update resources in the store.
   * This is called for each WebSocket message, processed serially.
   */
  function updateResources(updatedResources: Resource[]) {
    setState(
      produce((s) => {
        s.connectionStatus = "connected";
        s.resources = updatedResources.reduce(
          (existingResources, updatedResource) => {
            const existingResourceIndex = existingResources.findIndex(
              (existingResource) =>
                existingResource.name === updatedResource.name,
            );

            if (existingResourceIndex > -1) {
              const existingResource = existingResources[existingResourceIndex];
              const buttons = mergeButtons(
                existingResource.buttons,
                updatedResource.buttons,
              );

              existingResources[existingResourceIndex] = {
                ...existingResource,
                ...updatedResource,
                // buttons can get blanked out by resource updates, so make sure we merge updated buttons in
                buttons,
              };
              return existingResources;
            }

            return [...existingResources, updatedResource];
          },
          [...s.resources],
        );

        // Auto-select first resource if none selected
        if (!s.selectedResource && s.resources.length > 0) {
          s.selectedResource = s.resources[0].name;
        }
      }),
    );
  }

  function mergeButtons(target: ButtonAction[], source: ButtonAction[]) {
    return source.reduce(
      (existingButtons, updatedButton) => {
        const existingButtonIndex = existingButtons.findIndex(
          (existingButton) => existingButton.name === updatedButton.name,
        );

        if (existingButtonIndex > -1) {
          existingButtons[existingButtonIndex] = updatedButton;
          return existingButtons;
        }

        return [...existingButtons, updatedButton];
      },
      [...target],
    );
  }

  function updateButtons(buttons: APIButton[]) {
    setState(
      produce((s) => {
        const { resources } = s;

        const buttonMap = new Map<string, ButtonAction[]>();
        const globalBtns: ButtonAction[] = [];

        for (const btn of buttons) {
          const componentType = btn.spec.location?.componentType;
          if (componentType === "Resource") {
            const resourceName = btn.spec.location?.componentID ?? "";
            if (resourceName) {
              const existing = buttonMap.get(resourceName) ?? [];
              existing.push(buttonActionFromAPIButton(btn));
              buttonMap.set(resourceName, existing);
            }
          } else if (componentType === "Global") {
            globalBtns.push(buttonActionFromAPIButton(btn));
          }
        }

        for (const resource of resources) {
          const btns = buttonMap.get(resource.name);
          if (btns) {
            // buttons can get blanked out by resource updates, so make sure we merge updated buttons in
            resource.buttons = mergeButtons(resource.buttons, btns);
          }
        }

        if (globalBtns.length > 0) {
          s.globalButtons = mergeButtons(s.globalButtons, globalBtns);
        }
      }),
    );
  }

  /**
   * Main Effection operation that manages the WebSocket connection.
   * Handles reconnection and processes messages serially using `each()`.
   *
   * Uses useTiltStreams() to get two subscriptions from one WebSocket:
   * - resources: for resource/button updates
   * - logs: for log updates (replaces polling)
   */
  function* mainOperation(): Operation<void> {
    while (true) {
      setState("connectionStatus", "connecting");

      try {
        // Get all streams from a single WebSocket connection
        const { resources, buttons, logs, session } =
          yield* client.useTiltStreams();

        batch(() => {
          setState("connectionStatus", "connected");
          setState("resources", []);
          setState("globalButtons", []);
          setState("tiltStartTime", null);
        });
        logStore.clear();

        // Spawn all consumers concurrently first so no messages are dropped
        // When WebSocket disconnects, all streams close and tasks complete
        const resourcesTask = yield* spawn(function* () {
          for (const update of yield* each(resources)) {
            updateResources(update.resources);
            yield* each.next();
          }
        });

        const buttonsTask = yield* spawn(function* () {
          for (const update of yield* each(buttons)) {
            updateButtons(update.buttons);
            yield* each.next();
          }
        });

        const logsTask = yield* spawn(function* () {
          for (const update of yield* each(logs)) {
            logStore.append(update.logList);
            yield* each.next();
          }
        });

        const sessionTask = yield* spawn(function* () {
          for (const update of yield* each(session)) {
            setState("tiltStartTime", update.tiltStartTime);
            yield* each.next();
          }
        });

        // Fetch tilt args in the background (non-blocking)
        yield* spawn(function* () {
          const tiltArgs = yield* call(() => client.getTiltArgs());
          batch(() => {
            setState("tiltArgs", tiltArgs);
            if (tiltArgs.environment) {
              setState("namespace", String(tiltArgs.environment));
            }
            if (tiltArgs.profile) {
              setState("activeProfile", String(tiltArgs.profile));
            }
          });
        });

        // Wait for all streams to close (indicates WebSocket disconnect)
        // When this returns, the scope exits and all tasks are automatically cleaned up
        yield* all([resourcesTask, buttonsTask, logsTask, sessionTask]);

        // Stream closed normally - reconnect
        console.warn("WebSocket stream closed, reconnecting...");
      } catch (err) {
        console.error("WebSocket error:", err);
      }

      // Connection lost or errored - leave state intact until reconnect
      setState("connectionStatus", "disconnected");
      yield* sleep(3000);
    }
  }

  function selectResource(name: string) {
    setState("selectedResource", name);
  }

  function selectRelativeResource(direction: 1 | -1) {
    const resources = state.resources.filter((resource) => !resource.isDisabled);
    if (resources.length === 0) return;

    const currentIndex = resources.findIndex(
      (resource) => resource.name === state.selectedResource,
    );
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + direction + resources.length) % resources.length;
    selectResource(resources[nextIndex].name);
  }

  function cycleStatusFilter() {
    setState("statusFilter", (current) => {
      const idx = FILTER_ORDER.indexOf(current);
      return FILTER_ORDER[(idx + 1) % FILTER_ORDER.length];
    });
  }

  function resetStatusFilter() {
    setState("statusFilter", "all");
  }

  function toggleShowDisabledResources() {
    setState("showDisabledResources", (current) => !current);
  }

  async function triggerResource(name: string) {
    try {
      await client.triggerResource(name);
    } catch (err) {
      console.error("Failed to trigger resource:", err);
    }
  }

  async function toggleResourceDisable(name: string) {
    const resourceIndex = state.resources.findIndex((r) => r.name === name);
    if (resourceIndex === -1) {
      console.error(`Resource not found: ${name}`);
      return;
    }

    const resource = state.resources[resourceIndex];
    const button = resource.buttons.find(isDisableToggleButton);
    if (!button) {
      console.error(`No disable toggle button found for resource: ${name}`);
      return;
    }

    try {
      // The button's hidden "action" input already has the correct value set by Tilt:
      // - "on" when resource is enabled (click to disable)
      // - "off" when resource is disabled (click to enable)
      // So we don't need to override it - just click the button with its existing values
      const updatedButton = await client.clickButton(button.raw, {});

      // Update the button in the store with the new resourceVersion
      // This prevents 409 Conflict errors on subsequent clicks before WebSocket updates
      setState(
        "resources",
        resourceIndex,
        "disableToggleButton",
        updatedButton,
      );
    } catch (err) {
      console.error(`Failed to toggle disable for resource ${name}:`, err);
    }
  }

  onMount(async () => {
    // Load user settings and configure log filters
    try {
      const settings = await loadUserSettings();
      if (settings.tiltBinaryPath) {
        client.setTiltBinaryPath(settings.tiltBinaryPath);
        console.log(`Using tilt binary override: ${settings.tiltBinaryPath}`);
      }
      if (settings.logFilters.length > 0) {
        logStore.setLogFilters(settings.logFilters);
        setActiveLogFilterNames(settings.activeFilterNames);
        console.log(
          `Loaded ${settings.logFilters.length} log filters from config`,
        );
      }
      setDisableClipboardCopy(settings.disableClipboardCopy);
      applyKeymapOverrides(settings.keybindings);
    } catch (error) {
      console.error("Failed to load user settings:", error);
    }

    // Start the main Effection operation using run()
    // run() embeds Effection into existing async code
    mainTask = run(mainOperation);
  });

  onCleanup(async () => {
    // Halt the main task - this will close the WebSocket via structured concurrency
    if (mainTask) {
      // halt() returns a Future - we must observe it to ensure shutdown completes
      await mainTask.halt();
    }
  });

  const value: TiltContextValue = {
    state,
    client,
    logStore,
    selectResource,
    selectRelativeResource,
    triggerResource,
    toggleResourceDisable,
    cycleStatusFilter,
    resetStatusFilter,
    toggleShowDisabledResources,
    activeLogFilterNames,
    disableClipboardCopy,
  };

  return (
    <TiltContext.Provider value={value}>{props.children}</TiltContext.Provider>
  );
}

export function useTilt() {
  const context = useContext(TiltContext);
  if (!context) {
    throw new Error("useTilt must be used within a TiltProvider");
  }
  return context;
}
