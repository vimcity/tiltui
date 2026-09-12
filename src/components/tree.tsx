// Tree component - resource list with grouping (sidebar)

import {
  createSignal,
  createMemo,
  createEffect,
  on,
  For,
  Show,
  type Accessor,
  createSelector,
} from "solid-js";
import { type ScrollBoxRenderable, type RGBA } from "@opentui/core";
import { createStore } from "solid-js/store";
import { useTilt } from "../context/tilt";
import { useFocus } from "../context/focus";
import { useKeyHandler } from "../keyboard/useKeyHandler";
import {
  type Theme,
  statusColor,
  formatBuildDuration,
  formatDuration,
  focusBorder,
} from "../theme/theme";
import { useTheme } from "@/hooks/useTheme";
import { Header } from "./header";
import { PaneHeader } from "./pane-header";
import { type Resource, ResourceStatus } from "../tilt/types";
import { Commands } from "@/commands";
import { getEffectiveStatus, runtimeReadinessDurationMs } from "@/tilt/status-utils";
import { useBlinkWhenBuilding } from "@/hooks/useBlinkWhenBuilding";
import { StatusCounts } from "./status-counts";
import { truncate } from "@/utils/truncate";

interface TreeNode {
  type: "group" | "resource";
  groupName?: string;
  resource?: Resource;
  expanded?: boolean;
  childCount?: number;
  depth: number;
}

// Keep expansion choices while the sidebar is temporarily unmounted.
const [expandedGroups, setExpandedGroups] = createStore<Record<string, boolean>>(
  {},
);

// Group resources by labels
function getGroupKey(r: Resource): string {
  if (!r.raw) return "ungrouped";

  const labels = r.raw.metadata.labels ?? {};
  if (Object.keys(labels).length === 0) return "ungrouped";

  // Priority keys for grouping
  const priorityKeys = [
    "app",
    "app.kubernetes.io/name",
    "app.kubernetes.io/component",
    "component",
    "service",
    "tilt.dev/resource",
  ];

  for (const key of priorityKeys) {
    if (labels[key]) return labels[key];
  }

  // Fall back to first label value
  for (const val of Object.values(labels)) {
    if (val) return val;
  }

  return "ungrouped";
}

function buildTreeNodes(
  resources: Resource[],
  expandedGroups: Record<string, boolean>,
): TreeNode[] {
  const nodes: TreeNode[] = [];
  const grouped = new Map<string, number[]>();
  const groupOrder: string[] = [];

  // Group resources
  resources.forEach((r, i) => {
    const key = getGroupKey(r);
    if (!grouped.has(key)) {
      groupOrder.push(key);
      grouped.set(key, []);
    }
    grouped.get(key)!.push(i);
  });

  // Sort groups (ungrouped at end)
  groupOrder.sort((a, b) => {
    if (a === "ungrouped") return 1;
    if (b === "ungrouped") return -1;
    return a.localeCompare(b);
  });

  // Build nodes
  for (const groupKey of groupOrder) {
    const indices = grouped.get(groupKey)!;

    // Check if any resources in this group are enabled
    const hasEnabledResources = indices.some(
      (idx) => !resources[idx].isDisabled,
    );

    // Service logs are the primary view; utility groups stay collapsed until
    // the user explicitly opens them.
    const defaultExpanded = groupKey === "service" && hasEnabledResources;
    const expanded = expandedGroups[groupKey] ?? defaultExpanded;

    nodes.push({
      type: "group",
      groupName: groupKey,
      expanded,
      childCount: indices.length,
      depth: 0,
    });

    if (expanded) {
      for (const idx of indices) {
        nodes.push({
          type: "resource",
          resource: resources[idx],
          depth: 1,
        });
      }
    }
  }

  return nodes;
}

// Export getGroupKey for use by resource picker
export { getGroupKey };

export function Tree() {
  const {
    state,
    selectResource,
    triggerResource,
    toggleResourceDisable,
    cycleStatusFilter,
    resetStatusFilter,
    toggleShowDisabledResources,
  } = useTilt();
  const { state: focusState, setActivePane } = useFocus();
  const theme = useTheme();

  const [cursor, setCursor] = createSignal(0);
  const isSelected = createSelector(cursor);

  let scrollRef: ScrollBoxRenderable | undefined;

  const { opacity, getBlinkingColor } = useBlinkWhenBuilding({ theme });

  // Consolidated memo: filter resources and build tree nodes in one pass
  // Avoids intermediate memo overhead from chained dependencies
  const nodes = createMemo(() => {
    const filter = state.statusFilter;
    let resources =
      filter === "all"
        ? state.resources
        : state.resources.filter((r) => getEffectiveStatus(r) === filter);

    // Filter out disabled resources if showDisabledResources is false
    if (!state.showDisabledResources) {
      resources = resources.filter((r) => !r.isDisabled);
    }

    return buildTreeNodes(resources, expandedGroups);
  });

  // Derived: count of filtered resources for header display
  const filteredResourceCount = createMemo(() => {
    const filter = state.statusFilter;
    let resources =
      filter === "all"
        ? state.resources
        : state.resources.filter((r) => getEffectiveStatus(r) === filter);

    // Filter out disabled resources if showDisabledResources is false
    if (!state.showDisabledResources) {
      resources = resources.filter((r) => !r.isDisabled);
    }

    return resources.length;
  });

  // Reset cursor when filter changes
  createEffect(
    on(
      () => state.statusFilter,
      () => {
        setCursor(0);
      },
    ),
  );

  // Auto-expand group and set cursor when resource is selected externally (e.g., from picker)
  createEffect(
    on(
      () => state.selectedResource,
      (name) => {
        if (!name) return null;
        const resource = state.resources.find((r) => r.name === name);
        if (resource) {
          const groupKey = getGroupKey(resource);
          // Expand the group first
          setExpandedGroups(groupKey, true);

          // Find the cursor position for this resource in the nodes list
          // Need to rebuild nodes with the expanded group to find correct index
          const filter = state.statusFilter;
          let filtered =
            filter === "all"
              ? state.resources
              : state.resources.filter((r) => getEffectiveStatus(r) === filter);

          // Filter out disabled resources if showDisabledResources is false
          if (!state.showDisabledResources) {
            filtered = filtered.filter((r) => !r.isDisabled);
          }

          const updatedNodes = buildTreeNodes(filtered, {
            ...expandedGroups,
            [groupKey]: true,
          });
          const nodeIndex = updatedNodes.findIndex(
            (n) => n.type === "resource" && n.resource?.name === name,
          );
          if (nodeIndex !== -1) {
            setCursor(nodeIndex);
          }
        }
      },
    ),
  );

  const isFocused = createMemo(() => focusState.activePane === "tree");

  // Calculate the row position for a given cursor index
  // Group Height: 1(content)
  // Node Height: 2(content) + 1(marginBottom)
  function getRowPosition(cursorIndex: number): {
    top: number;
    height: number;
  } {
    const nodeList = nodes();
    let row = 0;
    for (let i = 0; i < cursorIndex && i < nodeList.length; i++) {
      row += nodeList[i].type === "group" ? 1 : 3;
    }
    const height = nodeList[cursorIndex]?.type === "group" ? 1 : 2;
    return { top: row, height };
  }

  // Scroll to keep cursor visible when it changes
  createEffect(
    on(cursor, (cursorIndex) => {
      if (!scrollRef) return null;

      const { top: itemTop, height: itemHeight } = getRowPosition(cursorIndex);
      const scrollTop = scrollRef.scrollTop;
      // Use viewport.height for the visible area, not scrollRef.height (total content height)
      const visibleRows = scrollRef.viewport.height ?? 10;

      // Scroll up if item is above viewport
      if (itemTop < scrollTop) {
        scrollRef.scrollTo(itemTop);
      }
      // Scroll down if item is below viewport
      else if (itemTop + itemHeight > scrollTop + visibleRows) {
        scrollRef.scrollTo(itemTop + itemHeight - visibleRows);
      }
    }),
  );

  const toggleGroup = () => {
    const node = nodes()[cursor()];
    if (node?.type === "group" && node.groupName) {
      setExpandedGroups(node.groupName, !node.expanded);
    }
  };

  const selectResourceAtCursor = (switchToResourcePane: boolean) => {
    const node = nodes()[cursor()];
    if (node?.type === "resource" && node.resource) {
      selectResource(node.resource.name);

      if (switchToResourcePane) {
        setActivePane("resource");
      }
    }
  };

  // Keyboard handling - only active when focused
  useKeyHandler(
    "tree",
    (command) => {
      switch (command) {
        case Commands.NAV_DOWN:
          setCursor((c) => Math.min(c + 1, nodes().length - 1));
          selectResourceAtCursor(false);
          break;
        case Commands.NAV_UP:
          setCursor((c) => Math.max(c - 1, 0));
          selectResourceAtCursor(false);
          break;
        case Commands.NAV_TOP:
          setCursor(0);
          selectResourceAtCursor(false);
          break;
        case Commands.NAV_BOTTOM:
          setCursor(nodes().length - 1);
          selectResourceAtCursor(false);
          break;
        case Commands.TREE_SELECT: {
          toggleGroup();
          selectResourceAtCursor(true);
          break;
        }
        case Commands.RELOAD_RESOURCE: {
          const currentNode = nodes()[cursor()];
          if (currentNode?.type === "resource" && currentNode.resource) {
            triggerResource(currentNode.resource.name);
          }
          selectResourceAtCursor(false);
          break;
        }
        case Commands.RESOURCE_DISABLE_TOGGLE: {
          const currentNode = nodes()[cursor()];
          if (currentNode?.type === "resource" && currentNode.resource) {
            toggleResourceDisable(currentNode.resource.name);
          }
          break;
        }
        case Commands.TREE_TOGGLE_DISABLED:
          toggleShowDisabledResources();
          break;
        case Commands.STATUS_FILTER_CYCLE:
          cycleStatusFilter();
          break;
        case Commands.STATUS_FILTER_RESET:
          if (state.statusFilter !== "all") {
            resetStatusFilter();
          }
          break;
      }
    },
    isFocused,
  );

  return (
    <box
      flexDirection="column"
      backgroundColor={theme.contentPane}
      flexGrow={0}
      flexShrink={0}
      margin={0}
      width={30}
      paddingLeft={isFocused() ? 0 : 1}
      {...focusBorder(theme, isFocused())}
    >
      <PaneHeader
        title={
          state.statusFilter === "all"
            ? "All Resources"
            : `[${state.statusFilter}]`
        }
        color={statusColor(theme, state.statusFilter)}
      >
        <Show when={state.showDisabledResources}>
          <text fg={theme.textMuted}>[⊘]</text>
        </Show>
        <StatusCounts
          narrow={true}
          resources={state.resources}
          activeProfile={state.activeProfile}
          theme={theme}
        />
      </PaneHeader>

      {/* Tree content */}
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
        paddingLeft={1}
        flexGrow={1}
        stickyScroll={false}
      >
        <For each={nodes()}>
          {(node, index) => {
            const isItemSelected = createMemo(() => isSelected(index()));

            if (node.type === "group") {
              return (
                <GroupNode
                  node={node}
                  isSelected={isItemSelected()}
                  theme={theme}
                />
              );
            } else {
              return (
                <ResourceNode
                  node={node}
                  isSelected={isItemSelected()}
                  isFocused={isFocused()}
                  theme={theme}
                  opacity={opacity}
                  getBlinkingColor={getBlinkingColor}
                />
              );
            }
          }}
        </For>
      </scrollbox>

      {/* Header at bottom of sidebar */}
      <Header narrow={true} />
    </box>
  );
}

function GroupNode(props: {
  node: TreeNode;
  isSelected: boolean;
  theme: Theme;
}) {
  const expandIcon = () => (props.node.expanded ? "▼" : "▶");
  const displayText = () =>
    `${expandIcon()} ${props.node.groupName} (${props.node.childCount})`;

  return (
    <box
      paddingLeft={1}
      flexDirection="row"
      backgroundColor={props.isSelected ? props.theme.primary : undefined}
    >
      <text
        fg={props.isSelected ? props.theme.background : props.theme.primary}
        attributes={1}
        wrapMode="none"
      >
        {displayText()}
      </text>
    </box>
  );
}

function ResourceNode(props: {
  node: TreeNode;
  isSelected: boolean;
  isFocused: boolean;
  theme: Theme;
  // Blink animation lifted from parent - single interval for all resources
  opacity: Accessor<number>;
  getBlinkingColor: (
    status: ResourceStatus,
    isBuilding: boolean,
    isDisabled?: boolean,
  ) => string | RGBA;
}) {
  const r = () => props.node.resource!;
  const isDisabled = () => r().isDisabled;

  // Runtime status color for line 1 border (muted if disabled)
  const runtimeColor = () =>
    props.getBlinkingColor(r().runtimeStatus, r().isBuilding, isDisabled());

  // Build status color for line 2 border (muted if disabled)
  const buildColor = () =>
    props.getBlinkingColor(r().updateStatus, r().isBuilding, isDisabled());

  const buildDuration = createMemo(() => {
    if (!r().raw?.status.buildHistory?.length) return "";
    const lastBuild = r().raw!.status.buildHistory![0];
    return formatBuildDuration(lastBuild.startTime, lastBuild.finishTime);
  });

  const readinessDuration = createMemo(() => {
    const ms = runtimeReadinessDurationMs(r().raw);
    return ms === undefined ? "" : formatDuration(ms);
  });

  const subheading = createMemo(() => {
    const parts: string[] = [];
    if (readinessDuration()) parts.push(`ready ${readinessDuration()}`);
    if (buildDuration()) parts.push(`build ${buildDuration()}`);
    return parts.join(" · ") || "—";
  });

  // Text color: muted when disabled, otherwise normal
  const nameColor = createMemo(() => {
    if (props.isSelected) return props.theme.background;
    return isDisabled() ? props.theme.textMuted : props.theme.text;
  });

  const subheadingColor = createMemo(() => {
    if (props.isSelected) return props.theme.background;
    return props.theme.textMuted; // Always muted for subheading
  });

  const backgroundColor = createMemo(() => {
    if (props.isSelected && props.isFocused) {
      return props.theme.primary;
    }

    if (props.isSelected) {
      return props.theme.secondary;
    }

    return undefined;
  });

  return (
    <box
      flexDirection="column"
      marginLeft={1}
      marginBottom={1}
      backgroundColor={backgroundColor()}
    >
      {/* Line 1: Resource name + runtime readiness duration - runtime status border */}
      <box flexDirection="row" justifyContent="flex-start" gap={1}>
        <text bg={runtimeColor()}> </text>
        <text
          fg={nameColor()}
          attributes={props.isSelected ? 1 : 0}
          wrapMode="none"
        >
          {truncate(r().name, 18)}
        </text>

      </box>

      {/* Line 2: Timestamp + duration - build status border */}
      <box flexDirection="row" justifyContent="flex-start" gap={1}>
        <text bg={buildColor()}> </text>
        <text fg={subheadingColor()} wrapMode="none">
          {subheading()}
        </text>
      </box>
    </box>
  );
}
