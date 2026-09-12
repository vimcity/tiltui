import { Commands } from "./commands";
import { KeyMapping } from "./keyboard/keymap-utils";

// Declarative keymap configuration
// Defines all keyboard shortcuts and their associated commands
export const keymap: KeyMapping[] = [
  // App-level commands
  {
    modes: ["app"],
    key: "p",
    modifiers: { ctrl: true },
    command: Commands.PALETTE_OPEN,
    description: "palette",
    showInHelpAs: "commands",
  },

  {
    modes: ["app"],
    key: "space",
    command: Commands.RESOURCE_PICKER_OPEN,
    description: "resource picker",
    showInHelpAs: "resources",
  },
  {
    modes: ["app"],
    key: "q",
    command: Commands.APP_QUIT,
    description: "quit",
  },
  {
    modes: ["app"],
    key: "c",
    modifiers: { ctrl: true },
    command: Commands.APP_QUIT,
    description: "quit",
  },
  {
    modes: ["app"],
    key: "e",
    modifiers: { ctrl: true },
    command: Commands.SIDEBAR_TOGGLE,
    description: "sidebar",
  },
  {
    modes: ["app"],
    key: "b",
    command: Commands.SIDEBAR_TOGGLE,
    description: "sidebar",
    showInHelpAs: "sidebar",
  },
  {
    modes: ["app"],
    key: "tab",
    command: Commands.RESOURCE_NEXT,
    description: "switch service",
    showInHelpAs: "switch service",
  },
  {
    modes: ["app"],
    key: "tab",
    modifiers: { shift: true },
    command: Commands.RESOURCE_PREV,
    description: "switch service",
  },
  {
    modes: ["app"],
    key: "h",
    command: Commands.FOCUS_PREV,
    description: "sidebar",
  },
  {
    modes: ["app"],
    key: "l",
    command: Commands.FOCUS_NEXT,
    description: "logs",
  },
  {
    modes: ["app"],
    key: "?", 
    command: Commands.HELP_OPEN,
    description: "keyboard help",
    showInHelpAs: "help",
  },
  {
    modes: ["app"],
    key: "w",
    command: Commands.ENGINE_INFO_OPEN,
    description: "watcher info",
  },
  {
    modes: ["app"],
    key: "i",
    command: Commands.RESOURCE_INFO_OPEN,
    description: "resource info",
  },

  // Shared navigation (tree + resource)
  {
    modes: ["tree", "resource"],
    key: "j",
    command: Commands.NAV_DOWN,
    description: "down",
  },
  {
    modes: ["tree", "resource"],
    key: "down",
    command: Commands.NAV_DOWN,
    description: "down",
  },
  {
    modes: ["tree", "resource"],
    key: "k",
    command: Commands.NAV_UP,
    description: "up",
  }, // Combined with j
  {
    modes: ["tree", "resource"],
    key: "up",
    command: Commands.NAV_UP,
    description: "up",
  },
  {
    modes: ["tree", "resource"],
    key: "g",
    command: Commands.NAV_TOP,
    description: "top",
  },
  {
    modes: ["tree", "resource"],
    key: "g",
    modifiers: { shift: true },
    command: Commands.NAV_BOTTOM,
    description: "bottom",
  }, // Combined with g

  // Tree-specific
  {
    modes: ["tree"],
    key: "return",
    command: Commands.TREE_SELECT,
    description: "select",
  },
  {
    modes: ["tree"],
    key: "d",
    command: Commands.TREE_TOGGLE_DISABLED,
    description: "toggle disabled",
  },
  {
    modes: ["tree"],
    key: "f",
    command: Commands.STATUS_FILTER_CYCLE,
    description: "status filter",
    showInHelpAs: "filter",
  },
  {
    modes: ["tree"],
    key: "escape",
    command: Commands.STATUS_FILTER_RESET,
    description: "reset status filter",
  },
  {
    modes: ["tree", "resource"],
    key: "r",
    command: Commands.RELOAD_RESOURCE,
    description: "trigger reload",
    showInHelpAs: "trigger",
  },
  // Ctrl-d is reserved for vim-style half-page scrolling. Resource disabling
  // remains available through the tree's plain `d` binding.
  {
    modes: ["resource"],
    key: "d",
    modifiers: { ctrl: true },
    command: Commands.SCROLL_PAGEDOWN,
    description: "half page down",
  },
  {
    modes: ["resource"],
    key: "u",
    modifiers: { ctrl: true },
    command: Commands.SCROLL_PAGEUP,
    description: "half page up",
  },

  // Resource-specific
  {
    modes: ["resource"],
    key: "left",
    command: Commands.SCROLL_LEFT,
    description: "left",
  },
  {
    modes: ["resource"],
    key: "right",
    command: Commands.SCROLL_RIGHT,
    description: "right",
  },
  {
    modes: ["resource"],
    key: "pageup",
    command: Commands.SCROLL_PAGEUP,
    description: "half page up",
  },
  {
    modes: ["resource"],
    key: "pagedown",
    command: Commands.SCROLL_PAGEDOWN,
    description: "half page down",
  },
  {
    modes: ["resource"],
    key: "f",
    modifiers: { ctrl: true },
    command: Commands.SCROLL_PAGEDOWN,
    description: "half page down",
  },
  {
    modes: ["resource"],
    key: "b",
    modifiers: { ctrl: true },
    command: Commands.SCROLL_PAGEUP,
    description: "half page up",
  },
  {
    modes: ["resource"],
    key: "s",
    command: Commands.SCROLL_FOLLOW,
    description: "autoscroll logs",
    showInHelpAs: "autoscroll",
  },
  {
    modes: ["resource"],
    key: "t",
    command: Commands.TOGGLE_TIMESTAMPS,
    description: "toggle timestamps",
    showInHelpAs: "timestamps",
  },
  {
    modes: ["resource"],
    key: "u",
    modifiers: {
      ctrl: true,
    },
    command: Commands.CLEAR_LOGS,
    description: "clear logs",
  },
  {
    modes: ["resource"],
    key: "/",
    command: Commands.LOG_SEARCH_OPEN,
    description: "search logs",
    showInHelpAs: "search",
  },
  {
    modes: ["resource"],
    key: "escape",
    command: Commands.LOG_SEARCH_CLEAR,
    description: "clear search",
  },
];

/** Apply command-to-key overrides from user configuration. */
export function applyKeymapOverrides(
  overrides: Record<string, string[]>,
): void {
  for (const [command, keys] of Object.entries(overrides)) {
    const mappings = keymap.filter((mapping) => mapping.command === command);
    if (mappings.length === 0) continue;

    for (const mapping of mappings) {
      const index = keymap.indexOf(mapping);
      if (index >= 0) keymap.splice(index, 1);
    }

    for (const keySpec of keys) {
      const parts = keySpec.toLowerCase().split("+");
      const key = parts.pop();
      if (!key) continue;
      const template = mappings[0];
      keymap.push({
        ...template,
        key,
        modifiers: {
          ctrl: parts.includes("ctrl"),
          shift: parts.includes("shift"),
        },
      });
    }
  }
}
