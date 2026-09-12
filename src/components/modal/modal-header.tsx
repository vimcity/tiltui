// Shared modal header - consistent title + dismiss hint

import { TextAttributes } from "@opentui/core";
import { useTheme } from "@/hooks/useTheme";

interface ModalHeaderProps {
  title: string;
  hint?: string;
}

export function ModalHeader(props: ModalHeaderProps) {
  const theme = useTheme();

  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={theme.textMuted}>{props.hint ?? "esc"}</text>
    </box>
  );
}
