// Error fallback UI component that allows quitting when errors occur

import { onCleanup, onMount } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { defaultTheme } from "../theme/theme";
import type { KeyEvent } from "@opentui/core";

interface ErrorFallbackProps {
  error: unknown;
  reset: () => void;
}

export function ErrorFallback(props: ErrorFallbackProps) {
  const renderer = useRenderer();
  const theme = defaultTheme;

  const handleKey = (key: KeyEvent) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      process.exit(1);
    }
    if (key.name === "r") {
      props.reset();
    }
  };

  onMount(() => {
    renderer.keyInput.on("keypress", handleKey);
  });
  onCleanup(() => renderer.keyInput.off("keypress", handleKey));

  const err = props.error;
  const errorMessage =
    err instanceof Error ? err.message : String(err) || "Unknown error";
  const errorStack =
    err instanceof Error
      ? err.stack?.split("\n").slice(0, 8).join("\n") || ""
      : "";

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.background}
      padding={2}
    >
      <box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
      >
        <text>
          <red>
            <bold>Application Error</bold>
          </red>
        </text>
        <text> </text>
        <text>
          <dim>A component threw an error and the app cannot continue.</dim>
        </text>
        <text> </text>
        <box
          borderStyle="single"
          borderColor={theme.error}
          padding={1}
          width="80%"
          maxHeight={12}
        >
          <text>
            <red>{errorMessage}</red>
          </text>
        </box>
        <text> </text>
        <box
          borderStyle="single"
          borderColor={theme.border}
          padding={1}
          width="80%"
          maxHeight={10}
        >
          <text>
            <dim>{errorStack}</dim>
          </text>
        </box>
        <text> </text>
        <text>
          <dim>Press </dim>
          <bold>q</bold>
          <dim> or </dim>
          <bold>Ctrl+C</bold>
          <dim> to quit</dim>
        </text>
        <text>
          <dim>Press </dim>
          <bold>r</bold>
          <dim> to attempt recovery</dim>
        </text>
      </box>
    </box>
  );
}
