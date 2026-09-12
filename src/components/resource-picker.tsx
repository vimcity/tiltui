// Resource Picker component - modal dialog for quick resource selection with fuzzy search

import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createMemo, For, Show } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import { useListNavigation } from "@/hooks/useListNavigation";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { ModalFilterInput } from "./modal/modal-filter-input";
import { ResourceStatusDot } from "./resource-status-dot";
import { useTilt } from "../context/tilt";
import { useFocus } from "../context/focus";
import { type Resource } from "../tilt/types";
import { getGroupKey } from "./tree";
import { getEffectiveStatus } from "@/tilt/status-utils";
import { useBlinkWhenBuilding } from "@/hooks/useBlinkWhenBuilding";
import { fuzzyMatch } from "@/utils/fuzzy";

interface PickerOption {
  resource: Resource;
  group: string;
  score: number;
}

interface ResourcePickerProps {
  onClose: () => void;
}

export function ResourcePicker(props: ResourcePickerProps) {
  const theme = useTheme();
  const { state, selectResource, resetStatusFilter } = useTilt();
  const { setActivePane } = useFocus();
  const { getBlinkingColor } = useBlinkWhenBuilding({ theme });

  let scrollRef: ScrollBoxRenderable | undefined;

  const nav = useListNavigation({
    itemCount: () => flat().length,
    scrollRef: () => scrollRef,
  });

  const options = createMemo(() => {
    const needle = nav.filter();

    let resources = state.resources;
    // Filter out disabled resources if showDisabledResources is false
    if (!state.showDisabledResources) {
      resources = resources.filter((r) => !r.isDisabled);
    }

    return resources
      .map((r) => ({
        resource: r,
        group: getGroupKey(r),
        score: needle ? (fuzzyMatch(needle, r.name) ?? Infinity) : 0,
      }))
      .filter((opt) => opt.score !== Infinity)
      .sort((a, b) => a.score - b.score);
  });

  const grouped = createMemo(() => {
    const groups = new Map<string, PickerOption[]>();
    const groupOrder: string[] = [];

    for (const opt of options()) {
      if (!groups.has(opt.group)) {
        groupOrder.push(opt.group);
        groups.set(opt.group, []);
      }
      groups.get(opt.group)!.push(opt);
    }

    groupOrder.sort((a, b) => {
      if (a === "ungrouped") return 1;
      if (b === "ungrouped") return -1;
      return a.localeCompare(b);
    });

    const result: [string, PickerOption[]][] = [];
    for (const group of groupOrder) {
      const opts = groups.get(group);
      if (opts && opts.length > 0) {
        result.push([group, opts]);
      }
    }
    return result;
  });

  const flat = createMemo(() => {
    const result: PickerOption[] = [];
    for (const [_, opts] of grouped()) {
      result.push(...opts);
    }
    return result;
  });

  const selected = createMemo(() => flat()[nav.selected()]);

  function handleSelect() {
    const opt = selected();
    if (!opt) return;

    const effectiveStatus = getEffectiveStatus(opt.resource);
    if (
      state.statusFilter !== "all" &&
      effectiveStatus !== state.statusFilter
    ) {
      resetStatusFilter();
    }

    selectResource(opt.resource.name);
    setActivePane("resource");
    props.onClose();
  }

  function handleKeyboard(evt: {
    name: string;
    ctrl?: boolean;
    preventDefault: () => void;
  }) {
    if (evt.name === "up" || (evt.ctrl && evt.name === "k")) {
      evt.preventDefault();
      nav.move(-1);
      return;
    }

    if (evt.name === "down" || (evt.ctrl && evt.name === "j")) {
      evt.preventDefault();
      nav.move(1);
      return;
    }

    if (evt.name === "return") {
      evt.preventDefault();
      handleSelect();
      return;
    }
  }

  const maxHeight = 20;

  return (
    <Modal size="md" onClose={props.onClose} onKeyboard={handleKeyboard}>
      <ModalHeader title="Resources" />

      <ModalFilterInput
        onInput={(v) => nav.setFilter(v)}
        placeholder="Type to filter..."
      />

      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <text fg={theme.textMuted}>No resources found</text>
          </box>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
          maxHeight={maxHeight}
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={1}
        >
          <For each={grouped()}>
            {([group, groupOptions], groupIndex) => (
              <>
                <box paddingTop={groupIndex() > 0 ? 1 : 0} paddingLeft={1}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                    {group}
                  </text>
                </box>

                <For each={groupOptions}>
                  {(option) => {
                    const isSelected = () =>
                      option.resource.name === selected()?.resource.name;

                    return (
                      <box
                        flexDirection="row"
                        backgroundColor={
                          isSelected() ? theme.primary : undefined
                        }
                        paddingLeft={2}
                        paddingRight={2}
                        gap={1}
                      >
                        <ResourceStatusDot
                          theme={theme}
                          getBlinkingColor={getBlinkingColor}
                          resource={option.resource}
                          selected={isSelected()}
                        />
                        <text
                          flexGrow={1}
                          fg={isSelected() ? theme.background : theme.text}
                          attributes={
                            isSelected() ? TextAttributes.BOLD : undefined
                          }
                          wrapMode="none"
                          overflow="hidden"
                        >
                          {option.resource.name}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
    </Modal>
  );
}
