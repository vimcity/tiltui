// PaneHeader component - consistent header for panes

import { type JSX } from "solid-js";
import { useTheme } from "@/hooks/useTheme";

interface PaneHeaderProps {
  title: string;
  color?: string;
  children?: JSX.Element;
}

export function PaneHeader(props: PaneHeaderProps) {
  const theme = useTheme();

  console.log("COLOR", props.color);

  return (
    <box
      padding={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      justifyContent="space-between"
    >
      <text fg={props.color ?? theme.primary} attributes={1} flexShrink={0}>
        {props.title}
      </text>
      {props.children}
    </box>
  );
}
