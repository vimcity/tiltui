// Footer component - context-aware help
// Dynamically generates help text from keymap

import { createMemo, For } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useFocus } from "../context/focus";
import { useTheme } from "@/hooks/useTheme";
import { getHelpItemsForMode } from "../keyboard/keymap-utils";

export function Footer() {
  const { state, sidebarVisible } = useFocus();
  const theme = useTheme();
  const dimensions = useTerminalDimensions();

  // The sidebar is a fixed 30-column pane with no outer margins.
  const resourceViewWidth = createMemo(() => {
    const terminalWidth = dimensions().width;
    if (sidebarVisible()) {
      return terminalWidth - 30; // Subtract sidebar width
    }
    return terminalWidth;
  });

  // Get help items dynamically from keymap
  const allHelpItems = createMemo(() => getHelpItemsForMode(state.activePane));

  // Filter help items based on available width
  const helpItems = createMemo(() => {
    const items = allHelpItems();
    const width = resourceViewWidth();

    // When ResourceView is narrow (< 80 chars), show only the help shortcut
    if (width < 80) {
      return items.filter((item) => item.text === "help");
    }

    return items;
  });

  return (
    <box
      padding={1}
      paddingBottom={0}
      paddingLeft={2}
      paddingRight={2}
      flexShrink={0}
      flexDirection="row"
    >
      <For each={helpItems()}>
        {(item, index) => (
          <>
            {index() > 0 && <text fg={theme.textMuted} wrapMode="none"> · </text>}
            <text fg={theme.primary} wrapMode="none">{item.keys}</text>
            <text fg={theme.textMuted} wrapMode="none"> {item.text}</text>
          </>
        )}
      </For>
    </box>
  );
}
