import { Commands } from "@/commands";
import type { Pane } from "../context/focus";
import { keymap } from "@/keymap";

export type Command = (typeof Commands)[keyof typeof Commands];

// Modes - extends Pane with app-level mode
export type Mode = Pane | "app"; // "tree" | "resource" | "app"

export interface KeyMapping {
  modes: Mode[];
  key: string;
  modifiers?: {
    shift?: boolean;
    ctrl?: boolean;
  };
  command: Command;
  description: string;
  showInHelpAs?: string; // Default true
}

// Helper: get mappings visible in help for a mode
export function getHelpMappingsForMode(mode: Mode): KeyMapping[] {
  return keymap.filter((m) => m.modes.includes(mode) && !!m.showInHelpAs);
}

// Helper: format key for display (^e for ctrl+e, Q for shift+q)
export function formatKeyDisplay(mapping: KeyMapping): string {
  let display = mapping.key;
  if (mapping.modifiers?.ctrl) {
    display = `^${display}`;
  }
  if (mapping.modifiers?.shift) {
    display = display.toUpperCase();
  }
  // Handle special keys
  if (display === "return") display = "Enter";
  if (display === "tab") display = "Tab";
  return display;
}

// Help item for footer display
export interface HelpItem {
  keys: string;
  text: string;
}

// Helper: get combined key displays for footer (e.g., "j/k" for up/down)
export function getHelpItemsForMode(mode: Mode): HelpItem[] {
  const modeBindings = getHelpMappingsForMode(mode);
  const appBindings = getHelpMappingsForMode("app");

  // Define combined displays for related commands
  const combinedKeys: Record<string, string> = {
    [Commands.NAV_DOWN]: "j/k", // Combine NAV_DOWN and NAV_UP
    [Commands.NAV_TOP]: "g/G", // Combine NAV_TOP and NAV_BOTTOM
    [Commands.SCROLL_LEFT]: "h/l", // Combine SCROLL_LEFT and SCROLL_RIGHT
    [Commands.RESOURCE_NEXT]: "Tab", // Combine next/previous service
  };

  // Commands to skip (they're combined with another)
  const skipCommands = new Set<Command>([
    Commands.NAV_UP,
    Commands.NAV_BOTTOM,
    Commands.SCROLL_RIGHT,
    Commands.RESOURCE_PREV,
    Commands.FOCUS_PREV,
    Commands.FOCUS_NEXT,
  ]);

  const seen = new Set<string>();
  const items: HelpItem[] = [];

  for (const mapping of [...modeBindings, ...appBindings]) {
    if (seen.has(mapping.command) || skipCommands.has(mapping.command)) {
      continue;
    }

    seen.add(mapping.command);

    items.push({
      keys: combinedKeys[mapping.command] ?? formatKeyDisplay(mapping),
      text: mapping.showInHelpAs ?? mapping.description,
    });
  }

  return items;
}
