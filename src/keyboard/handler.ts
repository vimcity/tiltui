// Keyboard event handler
// Maps key events to commands based on current mode

import { keymap } from "../keymap";
import { Mode, Command } from "./keymap-utils";

export interface KeyEvent {
  name: string;
  shift?: boolean;
  ctrl?: boolean;
  preventDefault: () => void;
}

/**
 * Handle a keyboard event and return the matching command (if any)
 * @param event - The keyboard event from useKeyboard
 * @param mode - The current mode to match against
 * @returns The matched command, or null if no match
 */
export function handleKeyEvent(
  event: KeyEvent,
  mode: Mode,
  modalOpen: boolean,
): Command | null {
  // don't execute any focusable mode commands when a modal is open
  if (modalOpen && mode !== "app") {
    return null;
  }

  const mapping = keymap.find(
    (m) =>
      m.modes.includes(mode) &&
      m.key === event.name &&
      (m.modifiers?.shift ?? false) === (event.shift ?? false) &&
      (m.modifiers?.ctrl ?? false) === (event.ctrl ?? false),
  );

  if (mapping) {
    event.preventDefault();
    return mapping.command;
  }

  return null;
}
