// Shared modal filter input - styled text input with auto-focus and empty-value workaround

import type { InputRenderable } from "@opentui/core";
import { createEffect } from "solid-js";
import { useTheme } from "@/hooks/useTheme";

interface ModalFilterInputProps {
  onInput: (value: string) => void;
  placeholder?: string;
  initialValue?: string;
  ref?: (r: InputRenderable) => void;
}

export function ModalFilterInput(props: ModalFilterInputProps) {
  const theme = useTheme();
  let inputRef: InputRenderable | undefined;

  // Auto-focus on mount
  createEffect(() => {
    setTimeout(() => inputRef?.focus(), 10);
  });

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <input
        ref={(r: InputRenderable) => {
          inputRef = r;
          props.ref?.(r);
        }}
        value={props.initialValue}
        onContentChange={() => {
          // Workaround: input doesn't fire onInput when cleared via backspace to empty
          if (inputRef?.value === "") {
            props.onInput("");
          }
        }}
        onInput={(e: string) => {
          props.onInput(e);
        }}
        focusedBackgroundColor={theme.background}
        cursorColor={theme.primary}
        focusedTextColor={theme.text}
        placeholder={props.placeholder ?? "Type to filter..."}
      />
    </box>
  );
}
