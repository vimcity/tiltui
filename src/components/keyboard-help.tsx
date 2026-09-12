// Keyboard Help Modal - shows all keyboard shortcuts grouped by mode

import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createMemo, createResource, For } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import { useTilt } from "../context/tilt";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { keymap } from "../keymap";
import {
  formatKeyDisplay,
  type Mode,
  type KeyMapping,
} from "../keyboard/keymap-utils";

interface KeyboardHelpProps {
  onClose: () => void;
}

interface HelpGroup {
  mode: Mode;
  title: string;
  mappings: KeyMapping[];
}

export function KeyboardHelp(props: KeyboardHelpProps) {
  const theme = useTheme();
  const { client } = useTilt();

  // Fetch the tilt CLI version when the modal mounts (opens)
  const [version] = createResource(() => client.getVersion());

  let scrollRef: ScrollBoxRenderable | undefined;

  const groups = createMemo((): HelpGroup[] => {
    const modeConfig: { mode: Mode; title: string }[] = [
      { mode: "app", title: "Global" },
      { mode: "tree", title: "Tree View" },
      { mode: "resource", title: "Log View" },
    ];

    return modeConfig.map(({ mode, title }) => {
      const seen = new Set<string>();
      const mappings = keymap.filter((m) => {
        if (!m.modes.includes(mode)) return false;
        const key = `${m.command}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { mode, title, mappings };
    });
  });

  function handleKeyboard(evt: {
    name: string;
    shift?: boolean;
    preventDefault: () => void;
  }) {
    // Additional close keys beyond escape (handled by Modal)
    if (evt.name === "?" || evt.name === "q") {
      evt.preventDefault();
      props.onClose();
      return;
    }

    if (evt.name === "j" || evt.name === "down") {
      evt.preventDefault();
      scrollRef?.scrollBy(1);
    } else if (evt.name === "k" || evt.name === "up") {
      evt.preventDefault();
      scrollRef?.scrollBy(-1);
    } else if (evt.name === "g" && !evt.shift) {
      evt.preventDefault();
      scrollRef?.scrollTo(0);
    } else if (evt.name === "g" && evt.shift) {
      evt.preventDefault();
      scrollRef?.scrollTo(9999);
    }
  }

  const maxHeight = 20;

  return (
    <Modal size="md" onClose={props.onClose} onKeyboard={handleKeyboard}>
      <ModalHeader title="Keyboard Shortcuts" hint="j/k scroll · esc/q/?" />

      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
        maxHeight={maxHeight}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <For each={groups()}>
          {(group, groupIndex) => (
            <>
              <box paddingTop={groupIndex() > 0 ? 1 : 0} paddingLeft={1}>
                <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                  {group.title}
                </text>
              </box>

              <For each={group.mappings}>
                {(mapping) => (
                  <box flexDirection="row" paddingLeft={2} paddingRight={2}>
                    <box width={12}>
                      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                        {formatKeyDisplay(mapping)}
                      </text>
                    </box>
                    <text fg={theme.text} flexGrow={1}>
                      {mapping.description}
                    </text>
                  </box>
                )}
              </For>
            </>
          )}
        </For>
      </scrollbox>

      <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text fg={theme.textMuted}>
          tilt {version() ?? (version.loading ? "…" : "unknown")}
        </text>
      </box>
    </Modal>
  );
}
