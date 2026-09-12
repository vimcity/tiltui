import { createMemo, For, Show, createSignal, createEffect } from "solid-js";
import { useTilt } from "../context/tilt";
import {
  connectionStatusIcon,
  connectionStatusColor,
  connectionStatusText,
} from "../theme/theme";
import { useTheme } from "@/hooks/useTheme";
import { ResourceStatus, type Resource } from "../tilt/types";
import { getEffectiveStatus } from "@/tilt/status-utils";
import { StatusCounts } from "./status-counts";

function formatUptime(startTime: string | null): string {
  if (!startTime) return "";

  const start = new Date(startTime);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

interface HeaderProps {
  narrow?: boolean;
}

export function Header(props: HeaderProps) {
  const { state, client } = useTilt();
  const theme = useTheme();

  const isNarrow = () => props.narrow ?? false;

  const connectionIcon = createMemo(() =>
    connectionStatusIcon(state.connectionStatus),
  );
  const connectionColor = createMemo(() =>
    connectionStatusColor(theme, state.connectionStatus),
  );
  const uptimeColor = createMemo(() => theme.textMuted);
  const connectionText = createMemo(() =>
    connectionStatusText(state.connectionStatus),
  );

  // Update uptime every second when tiltStartTime is available
  const [uptime, setUptime] = createSignal("");
  createEffect(() => {
    if (state.tiltStartTime) {
      setUptime(formatUptime(state.tiltStartTime));
      const interval = setInterval(() => {
        setUptime(formatUptime(state.tiltStartTime));
      }, 1000);
      return () => clearInterval(interval);
    }
  });

  // Build connection status text
  const connectionStatusLine = createMemo(() => {
    const baseStatus = `${connectionIcon()} ${state.connectionStatus === "connected" ? (state.namespace ?? connectionText()) : connectionText()}`;
    return baseStatus;
  });

  // Narrow mode: stacked vertical layout for sidebar
  if (isNarrow()) {
    return (
      <box
        flexDirection="row"
        padding={0}
        paddingLeft={1}
        paddingRight={1}
        flexShrink={0}
        justifyContent="space-between"
      >
        <text fg={connectionColor()} attributes={1}>
          {connectionStatusLine()}
        </text>
        <Show when={state.connectionStatus === "connected"}>
          <text fg={uptimeColor()}>{uptime() ?? ""}</text>
        </Show>
      </box>
    );
  }

  // Wide mode: horizontal layout for full-width header
  return (
    <box
      backgroundColor={theme.contentPane}
      marginLeft={1}
      marginRight={1}
      marginTop={0}
      marginBottom={1}
      padding={1}
      paddingLeft={2}
      paddingRight={2}
      flexShrink={0}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <box flexDirection="row">
          <text fg={connectionColor()} attributes={1}>
            {connectionStatusLine()}
          </text>
          <Show when={state.connectionStatus === "connected"}>
            <text fg={uptimeColor()}> {uptime() ?? ""}</text>
          </Show>
        </box>
        <StatusCounts
          narrow={false}
          resources={state.resources}
          theme={theme}
        />
      </box>
    </box>
  );
}
