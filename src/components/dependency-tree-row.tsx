import { Show } from "solid-js";
import type { Theme } from "@/theme/theme";
import type { BlinkWhenBuildingResult } from "@/hooks/useBlinkWhenBuilding";
import type { DependencyTreeLine } from "@/tilt/engine-dump-deps";
import type { Resource } from "@/tilt/types";
import { ResourceStatusDot } from "./resource-status-dot";

export interface DependencyTreeRowProps {
  theme: Theme;
  line: DependencyTreeLine;
  resource: Resource | undefined;
  getBlinkingColor: BlinkWhenBuildingResult["getBlinkingColor"];
}

export function DependencyTreeRow(props: DependencyTreeRowProps) {
  return (
    <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={2}>
      <text fg={props.theme.text} wrapMode="none" overflow="hidden">
        {props.line.textLeft || " "}
      </text>

      <Show when={props.line.textRight}>
        <text fg={props.theme.text} wrapMode="none" overflow="hidden">
          {props.line.textRight || " "}
        </text>
      </Show>

      <Show when={props.line.resourceName}>
        <ResourceStatusDot
          theme={props.theme}
          getBlinkingColor={props.getBlinkingColor}
          resource={props.resource}
        />
      </Show>
    </box>
  );
}
