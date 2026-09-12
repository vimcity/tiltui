// Toast notification component - displays temporary messages

import { Show } from "solid-js";
import { useTheme } from "../hooks/useTheme";
import { useToast } from "../context/toast";

export function Toast() {
  const theme = useTheme();
  const { toast } = useToast();

  return (
    <Show when={toast()}>
      <box
        position="absolute"
        top={1}
        left="50%"
        marginLeft={-15}
        width={30}
        height={3}
        backgroundColor={theme.primary}
        justifyContent="center"
        padding={1}
      >
        <text fg={theme.background}>{toast()!.message}</text>
      </box>
    </Show>
  );
}
