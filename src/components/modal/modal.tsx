// Shared modal shell - provides consistent positioning, background, and escape-to-close

import { type JSX } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/hooks/useTheme";

export type ModalSize = "sm" | "md" | "lg";

export const SIZE_CONFIG: Record<
  ModalSize,
  { width: number; marginLeft: number }
> = {
  sm: { width: 50, marginLeft: -25 },
  md: { width: 60, marginLeft: -30 },
  lg: { width: 100, marginLeft: -50 },
};

interface ModalProps {
  size?: ModalSize;
  onClose: () => void;
  children: JSX.Element;
  // Allow modals to handle additional keys alongside escape
  onKeyboard?: (evt: Parameters<Parameters<typeof useKeyboard>[0]>[0]) => void;
}

export function Modal(props: ModalProps) {
  const theme = useTheme();
  const config = () => SIZE_CONFIG[props.size ?? "md"];

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault();
      props.onClose();
      return;
    }
    props.onKeyboard?.(evt);
  });

  return (
    <box
      position="absolute"
      top={2}
      left="50%"
      marginLeft={config().marginLeft}
      width={config().width}
      backgroundColor={theme.contentPane}
      border={false}
      flexDirection="column"
    >
      {props.children}
    </box>
  );
}
