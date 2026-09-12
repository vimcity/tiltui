import { defaultTheme } from "@/theme/theme";
import { getEffectiveStatus } from "@/tilt/status-utils";
import { Resource, ResourceStatus } from "@/tilt/types";
import { createMemo, For, Show } from "solid-js";

interface StatusItem {
  icon: string;
  text: string;
  color: string;
}

interface StatusCountsProps {
  narrow: boolean;
  theme: typeof defaultTheme;
  resources: Resource[];
  activeProfile?: string | null;
}

interface StatusCounts {
  healthy: number;
  totalEnabled: number;
  pending: number;
  unhealthy: number;
  warning: number;
  disabled: number;
}

function hasWarning(r: Resource): boolean {
  if (!r.raw) return false;
  const buildHistory = r.raw.status.buildHistory;
  if (buildHistory && buildHistory.length > 0) {
    const lastBuild = buildHistory[0];
    return (lastBuild.warnings?.length ?? 0) > 0 && !lastBuild.error;
  }
  return false;
}

function calculateCounts(resources: Resource[]): StatusCounts {
  const counts: StatusCounts = {
    healthy: 0,
    totalEnabled: 0,
    pending: 0,
    unhealthy: 0,
    warning: 0,
    disabled: 0,
  };

  for (const r of resources) {
    if (r.isDisabled) {
      counts.disabled++;
      continue;
    }

    if (hasWarning(r)) {
      counts.warning++;
      counts.totalEnabled++;
    }

    const status = getEffectiveStatus(r);
    switch (status) {
      case ResourceStatus.Unhealthy:
        counts.unhealthy++;
        counts.totalEnabled++;
        break;
      case ResourceStatus.Pending:
      case ResourceStatus.Building:
        counts.pending++;
        counts.totalEnabled++;
        break;
      case ResourceStatus.Healthy:
        counts.healthy++;
        counts.totalEnabled++;
        break;
    }
  }

  return counts;
}
export function StatusCounts(props: StatusCountsProps) {
  const counts = createMemo(() => calculateCounts(props.resources));
  const theme = props.theme;

  const statusItems = createMemo((): StatusItem[] => {
    const items: StatusItem[] = [];
    const c = counts();

    if (c.unhealthy > 0) {
      items.push({ icon: "✗", text: `${c.unhealthy}`, color: theme.error });
    }
    if (c.warning > 0) {
      items.push({ icon: "!", text: `${c.warning}`, color: theme.warning });
    }
    if (c.pending > 0) {
      items.push({ icon: "●", text: `${c.pending}`, color: theme.textMuted });
    }
    if (c.totalEnabled > 0) {
      items.push({
        icon: "✓",
        text: `${c.healthy}/${c.totalEnabled}`,
        color: theme.success,
      });
    }

    // only show disabled resources if there's no active profile.
    // profiles cause lots of resources to be disabled
    if (!props.activeProfile && c.disabled > 0) {
      items.push({ icon: "⊘", text: `${c.disabled}`, color: theme.textMuted });
    }

    return items;
  });

  const separator = props.narrow ? " " : "  ";
  return (
    <box flexDirection="row" flexShrink={0}>
      <For each={statusItems()}>
        {(item, index) => (
          <>
            <Show when={index() > 0}>
              <text fg={props.theme.textMuted}>{separator}</text>
            </Show>
            <text fg={item.color}>{item.icon}</text>
            <text fg={props.theme.text}> {item.text}</text>
          </>
        )}
      </For>
    </box>
  );
}
