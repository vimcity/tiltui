// Main App component

import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { TiltProvider, useTilt } from "./context/tilt";
import { FocusProvider, useFocus } from "./context/focus";
import { ToastProvider } from "./context/toast";
import { Toast } from "./components/toast";
import { setGlobalRenderer } from "./global-renderer";
import { Header } from "./components/header";
import { Tree } from "./components/tree";
import { ResourceView } from "./components/resourceview";
import {
  CommandPalette,
  type PaletteOption,
} from "./components/command-palette";
import { ResourcePicker } from "./components/resource-picker";
import { KeyboardHelp } from "./components/keyboard-help";
import { ButtonFormModal } from "./components/button-form-modal";
import { EngineInfo } from "./components/engine-info";
import { ResourceInfoModal } from "./components/resource-info-modal";
import { useTheme } from "./hooks/useTheme";
import { useKeyHandler } from "./keyboard/useKeyHandler";
import { Commands } from "./commands";
import { KeyEvent } from "@opentui/core";
import type { APIButton } from "./tilt/api-types";

function AppContent() {
  const renderer = useRenderer();

  // Register renderer globally for emergency cleanup
  onMount(() => {
    setGlobalRenderer(renderer);
  });
  onCleanup(() => {
    setGlobalRenderer(null);
  });

  // set up debug console activation
  const debugKeyHandler = (key: KeyEvent) => {
    // Toggle with backtick key
    if (key.name === "`") {
      renderer.console.toggle();
    }
  };
  renderer.keyInput.on("keypress", debugKeyHandler);
  onCleanup(() => renderer.keyInput.off("keypress", debugKeyHandler));

  const {
    cyclePane,
    sidebarVisible,
    toggleSidebar,
    activeModal,
    openModal,
    closeModal,
    isModalOpen,
  } = useFocus();
  const { client, state, triggerResource, selectRelativeResource } = useTilt();
  const theme = useTheme();

  // A sidebar toggle changes the framebuffer's origin and leaves old cells
  // visible unless the renderer is explicitly flushed.
  createEffect(() => {
    sidebarVisible();
    renderer.requestRender();
  });

  // Button being configured in the form modal
  const [formButton, setFormButton] = createSignal<APIButton | null>(null);

  // Execute a command from the palette or keyboard
  function executeCommand(command: string) {
    switch (command) {
      case Commands.APP_QUIT:
        renderer.destroy();
        process.exit(0);
      case Commands.SIDEBAR_TOGGLE:
        toggleSidebar();
        break;
      case Commands.FOCUS_NEXT:
        cyclePane(1);
        break;
      case Commands.FOCUS_PREV:
        cyclePane(-1);
        break;
      case Commands.RESOURCE_NEXT:
        selectRelativeResource(1);
        break;
      case Commands.RESOURCE_PREV:
        selectRelativeResource(-1);
        break;
      case Commands.PALETTE_OPEN:
        openModal("palette");
        break;
      case Commands.RESOURCE_PICKER_OPEN:
        openModal("resourcePicker");
        break;
      case Commands.HELP_OPEN:
        openModal("help");
        break;
      case Commands.ENGINE_INFO_OPEN:
        openModal("engineInfo");
        break;
      case Commands.RESOURCE_INFO_OPEN:
        if (state.selectedResource) {
          openModal("resourceInfo");
        }
        break;
      case Commands.RELOAD_RESOURCE:
        if (state.selectedResource) {
          triggerResource(state.selectedResource);
        }
        break;
    }
  }

  // App-level keyboard handling (disabled when any modal is open)
  useKeyHandler("app", executeCommand, () => !isModalOpen());

  // Handle palette selection
  function handlePaletteSelect(option: PaletteOption) {
    if (option.command) {
      executeCommand(option.command);
    }
  }

  // Palette hands off a button that needs a form
  function handleButtonForm(button: APIButton) {
    setFormButton(button);
    openModal("buttonForm");
  }

  // Form submit: click the button with collected input values
  async function handleFormSubmit(
    button: APIButton,
    inputValues: Record<string, string | boolean>,
  ) {
    try {
      await client.clickButton(button, inputValues);
    } catch (err) {
      console.error("Failed to click button:", err);
    }
    closeModal();
    setFormButton(null);
  }

  function handleFormClose() {
    closeModal();
    setFormButton(null);
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.background}
    >
      {/* Main content: Tree (sidebar) + ResourceView */}
      <box flexDirection="row" flexGrow={1}>
        <Show when={sidebarVisible()}>
          <Tree />
        </Show>
        <ResourceView />
      </box>

      {/* Command Palette overlay */}
      <Show when={activeModal() === "palette"}>
        <CommandPalette
          onClose={() => closeModal()}
          onSelect={handlePaletteSelect}
          onButtonForm={handleButtonForm}
        />
      </Show>

      {/* Resource Picker overlay */}
      <Show when={activeModal() === "resourcePicker"}>
        <ResourcePicker onClose={() => closeModal()} />
      </Show>

      {/* Keyboard Help overlay */}
      <Show when={activeModal() === "help"}>
        <KeyboardHelp onClose={() => closeModal()} />
      </Show>

      {/* Button Form Modal overlay */}
      <Show when={activeModal() === "buttonForm" && formButton()}>
        <ButtonFormModal
          button={formButton()!}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
        />
      </Show>

      {/* Engine Info overlay */}
      <Show when={activeModal() === "engineInfo"}>
        <EngineInfo onClose={() => closeModal()} />
      </Show>

      {/* Resource Info overlay */}
      <Show when={activeModal() === "resourceInfo" && state.selectedResource}>
        <ResourceInfoModal
          resourceName={state.selectedResource!}
          onClose={() => closeModal()}
        />
      </Show>

      {/* Header - only shown when sidebar is hidden */}
      <Show when={!sidebarVisible()}>
        <box flexShrink={0}>
          <Header />
        </box>
      </Show>
    </box>
  );
}

export interface AppProps {
  host?: string;
  port?: number;
}

export function App(props: AppProps) {
  return (
    <TiltProvider host={props.host} port={props.port}>
      <FocusProvider>
        <ToastProvider>
          <AppContent />
          <Toast />
        </ToastProvider>
      </FocusProvider>
    </TiltProvider>
  );
}
