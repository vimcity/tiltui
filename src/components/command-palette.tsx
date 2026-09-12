// Command Palette component - filterable command list with grouping

import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createMemo, For, Show, untrack } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import { useListNavigation } from "@/hooks/useListNavigation";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { ModalFilterInput } from "./modal/modal-filter-input";
import { useTilt } from "../context/tilt";
import { useFocus } from "../context/focus";
import {
  getHelpMappingsForMode,
  formatKeyDisplay,
  type Command,
} from "../keyboard/keymap-utils";
import { Commands } from "../commands";
import type { APIButton } from "../tilt/types";
import type { APIInputSpec } from "../tilt/api-types";
import { truncate } from "../utils/truncate";

export interface PaletteOption {
  title: string;
  value: string;
  description?: string;
  category: string;
  command?: Command;
  url?: string;
  button?: APIButton;
}

function hasVisibleInputs(button: APIButton): boolean {
  return (button.spec.inputs ?? []).some(
    (input: APIInputSpec) => input.text || input.bool || input.choice,
  );
}

interface CommandPaletteProps {
  onClose: () => void;
  onSelect: (option: PaletteOption) => void;
  onButtonForm: (button: APIButton) => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const theme = useTheme();
  const { state: tiltState, client } = useTilt();
  const { state: focusState } = useFocus();

  let scrollRef: ScrollBoxRenderable | undefined;

  // Capture options once on mount using untrack to avoid reactive dependencies
  const initialOptions = untrack(() => {
    const result: PaletteOption[] = [];
    const selectedResource = tiltState.resources.find(
      (r) => r.name === tiltState.selectedResource,
    );

    if (selectedResource) {
      for (const endpoint of selectedResource.endpoints) {
        const hasName = endpoint.name && endpoint.name !== endpoint.url;
        result.push({
          title: hasName ? endpoint.name : endpoint.url,
          value: `link:${endpoint.url}`,
          description: hasName ? endpoint.url : undefined,
          category: "Links",
          url: endpoint.url,
        });
      }

      for (const button of selectedResource.buttons) {
        if (!button.disabled) {
          result.push({
            title: button.text,
            value: `button:${button.name}`,
            description: `${selectedResource.name}`,
            category: "Actions",
            button: button.raw,
          });
        }
      }

      result.push({
        title: "Resource info",
        value: `command:${Commands.RESOURCE_INFO_OPEN}`,
        description: "i",
        category: "Actions",
        command: Commands.RESOURCE_INFO_OPEN,
      });
    }

    // Global actions are always available regardless of selected resource
    for (const button of tiltState.globalButtons) {
      if (!button.disabled) {
        result.push({
          title: button.text,
          value: `button:${button.name}`,
          description: button.name,
          category: "Global Actions",
          button: button.raw,
        });
      }
    }

    const appBindings = getHelpMappingsForMode("app").concat({
      modes: ["app"],
      description: "exit",
      key: "x",
      command: "app.quit",
    });

    const modeBindings = getHelpMappingsForMode(focusState.activePane);
    for (const mapping of appBindings.concat(modeBindings)) {
      result.push({
        title: mapping.description,
        value: `command:${mapping.command}`,
        description: formatKeyDisplay(mapping),
        category: "Commands",
        command: mapping.command,
      });
    }

    return result;
  });

  const options = () => initialOptions;

  const nav = useListNavigation({
    itemCount: () => flat().length,
    scrollRef: () => scrollRef,
  });

  const filtered = createMemo(() => {
    const needle = nav.filter().toLowerCase();
    if (!needle) return options();

    return options().filter(
      (opt) =>
        opt.title.toLowerCase().includes(needle) ||
        opt.category.toLowerCase().includes(needle) ||
        (opt.description?.toLowerCase().includes(needle) ?? false),
    );
  });

  const grouped = createMemo(() => {
    const groups = new Map<string, PaletteOption[]>();
    const categoryOrder = ["Links", "Actions", "Global Actions", "Commands"];

    for (const opt of filtered()) {
      const existing = groups.get(opt.category) ?? [];
      existing.push(opt);
      groups.set(opt.category, existing);
    }

    const result: [string, PaletteOption[]][] = [];
    for (const cat of categoryOrder) {
      const opts = groups.get(cat);
      if (opts && opts.length > 0) {
        result.push([cat, opts]);
      }
    }
    return result;
  });

  const flat = createMemo(() => {
    const result: PaletteOption[] = [];
    for (const [_, opts] of grouped()) {
      result.push(...opts);
    }
    return result;
  });

  const selected = createMemo(() => flat()[nav.selected()]);

  async function handleSelect() {
    const opt = selected();
    if (!opt) return;

    if (opt.url) {
      client.openUrl(opt.url);
      props.onClose();
    } else if (opt.button) {
      const needsForm = hasVisibleInputs(opt.button);
      const needsConfirmation =
        opt.button.spec.requiresConfirmation && !needsForm;

      if (needsForm || needsConfirmation) {
        props.onClose();
        props.onButtonForm(opt.button);
      } else {
        try {
          const updatedButton = await client.clickButton(opt.button);
          opt.button = updatedButton;
        } catch (err) {
          console.error("Failed to click button:", err);
        }
        props.onClose();
      }
    } else if (opt.command) {
      props.onSelect(opt);
      props.onClose();
    }
  }

  function handleKeyboard(evt: {
    name: string;
    ctrl?: boolean;
    preventDefault: () => void;
  }) {
    if (evt.name === "up" || (evt.ctrl && evt.name === "k")) {
      evt.preventDefault();
      nav.move(-1);
      return;
    }

    if (evt.name === "down" || (evt.ctrl && evt.name === "j")) {
      evt.preventDefault();
      nav.move(1);
      return;
    }

    if (evt.name === "return") {
      evt.preventDefault();
      handleSelect();
      return;
    }
  }

  const maxHeight = 20;

  return (
    <Modal size="md" onClose={props.onClose} onKeyboard={handleKeyboard}>
      <ModalHeader title="Commands" />

      <ModalFilterInput
        onInput={(v) => nav.setFilter(v)}
        placeholder="Type to filter..."
      />

      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <text fg={theme.textMuted}>No results found</text>
          </box>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
          maxHeight={maxHeight}
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={1}
        >
          <For each={grouped()}>
            {([category, categoryOptions], groupIndex) => (
              <>
                <box paddingTop={groupIndex() > 0 ? 1 : 0} paddingLeft={1}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                    {category}
                  </text>
                </box>

                <For each={categoryOptions}>
                  {(option) => {
                    const isSelected = () => option.value === selected()?.value;

                    return (
                      <box
                        flexDirection="row"
                        backgroundColor={
                          isSelected() ? theme.primary : undefined
                        }
                        paddingLeft={2}
                        paddingRight={2}
                        justifyContent="space-between"
                      >
                        <text fg={isSelected() ? theme.background : theme.text}>
                          {option.title}
                        </text>
                        <Show when={option.description}>
                          <text
                            style={{
                              fg: isSelected()
                                ? theme.background
                                : theme.textMuted,
                            }}
                          >
                            {" "}
                            {truncate(option.description!, 20)}
                          </text>
                        </Show>
                      </box>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
    </Modal>
  );
}
