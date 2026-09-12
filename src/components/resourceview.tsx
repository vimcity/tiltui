// ResourceView component - main content pane for selected resource
// Uses LogBufferView for high-performance log rendering with FrameBuffer

import { createSignal, createMemo, Show, createEffect, on } from "solid-js";
import { useTilt } from "../context/tilt";
import { useFocus } from "../context/focus";
import { useToast } from "../context/toast";
import { useKeyHandler } from "../keyboard/useKeyHandler";
import { Commands } from "../commands";
import { focusBorder } from "../theme/theme";
import { useTheme } from "@/hooks/useTheme";
import { PaneHeader } from "./pane-header";
import { Footer } from "./footer";
import { LogBufferView, type LogBufferViewRef } from "./log-buffer-view";
import { LogSearchModal, type LogSearchFilter } from "./log-search-modal";

export function ResourceView() {
  const {
    state,
    logStore,
    triggerResource,
    toggleResourceDisable,
    activeLogFilterNames,
    disableClipboardCopy,
  } = useTilt();
  const { state: focusState, activeModal, openModal, closeModal } = useFocus();
  const { showToast } = useToast();
  const theme = useTheme();

  // Local state
  const [autoScroll, setAutoScroll] = createSignal(true);
  const [showTimestamps, setShowTimestamps] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isFiltering, setIsFiltering] = createSignal(false);
  const [matchCount, setMatchCount] = createSignal(0);

  // Reference to LogBufferView for scroll control
  let logBufferRef: LogBufferViewRef | null = null;

  const isFocused = createMemo(() => focusState.activePane === "resource");

  // Create LogBufferView - returns [Component, Ref] tuple
  const [LogView, logRef] = LogBufferView({
    logStore,
    manifestName: () => state.selectedResource,
    theme,
    showTimestamps,
    onAutoScrollChange: setAutoScroll,
    onTextCopied: () => {
      if (!disableClipboardCopy()) showToast("Copied to clipboard");
    },
    disableClipboardCopy,
  });

  // Store ref for keyboard handlers
  logBufferRef = logRef;

  // Keyboard handling - only active when focused
  useKeyHandler(
    "resource",
    (command) => {
      switch (command) {
        case Commands.NAV_DOWN:
          logBufferRef?.scrollBy(1);
          break;
        case Commands.NAV_UP:
          logBufferRef?.scrollBy(-1);
          break;
        case Commands.NAV_TOP:
          logBufferRef?.scrollToTop();
          break;
        case Commands.NAV_BOTTOM:
          logBufferRef?.scrollToBottom();
          break;
        case Commands.SCROLL_PAGEUP:
          logBufferRef?.scrollBy(-Math.floor((logBufferRef?.height ?? 20) / 2));
          break;
        case Commands.SCROLL_PAGEDOWN:
          logBufferRef?.scrollBy(Math.floor((logBufferRef?.height ?? 20) / 2));
          break;
        case Commands.SCROLL_FOLLOW:
          logBufferRef?.toggleAutoScroll();
          break;
        case Commands.TOGGLE_TIMESTAMPS:
          setShowTimestamps((s) => !s);
          break;
        case Commands.RESOURCE_DISABLE_TOGGLE: {
          if (state.selectedResource) {
            toggleResourceDisable(state.selectedResource);
          }
          break;
        }
        case Commands.RELOAD_RESOURCE: {
          if (state.selectedResource) {
            triggerResource(state.selectedResource);
          }
          break;
        }
        case Commands.CLEAR_LOGS: {
          // Clear logs is now handled by removing spans in logstore2
          // For now, this is a no-op - can implement later if needed
          break;
        }
        case Commands.LOG_SEARCH_OPEN: {
          openModal("logSearch");
          break;
        }
        case Commands.LOG_SEARCH_CLEAR: {
          // Clear search filter with escape
          if (logBufferRef?.isFiltering) {
            logBufferRef.clearSearchFilter();
            setSearchQuery("");
            setIsFiltering(false);
            setMatchCount(0);
          }
          break;
        }
      }
    },
    // Disable keyboard handling when search modal is open
    () => isFocused() && activeModal() !== "logSearch",
  );

  // Handle search submission from modal
  function handleSearch(filter: LogSearchFilter | null) {
    if (filter) {
      logBufferRef?.setSearchFilter(filter);
      setSearchQuery(filter.query);
      setIsFiltering(true);
      // Update match count after filter is applied
      setTimeout(() => {
        setMatchCount(logBufferRef?.matchCount ?? 0);
      }, 0);
    } else {
      logBufferRef?.clearSearchFilter();
      setSearchQuery("");
      setIsFiltering(false);
      setMatchCount(0);
    }
  }

  // Clear search when resource changes
  createEffect(
    on(
      () => state.selectedResource,
      () => {
        if (isFiltering()) {
          logBufferRef?.clearSearchFilter();
          setSearchQuery("");
          setIsFiltering(false);
          setMatchCount(0);
        }
      },
    ),
  );

  return (
    <box
      flexDirection="column"
      backgroundColor={theme.background}
      flexGrow={1}
      margin={0}
      paddingLeft={isFocused() ? 0 : 1}
      {...focusBorder(theme, isFocused())}
    >
      {/* Sticky header */}
      <PaneHeader title={`Logs: ${state.selectedResource ?? ""}`}>
        <Show when={activeLogFilterNames().length > 0}>
          <text fg={theme.accent} flexShrink={0}>
            {" "}
            [logFilters: {activeLogFilterNames().join(", ")}]
          </text>
        </Show>
        <Show when={isFiltering()}>
          <text fg={theme.primary} flexShrink={0}>
            {" "}
            [/{searchQuery()}/: {matchCount()} matches]
          </text>
        </Show>
        <Show when={autoScroll()}>
          <text fg={theme.success} flexShrink={0}>
            {" "}
            [autoscroll]
          </text>
        </Show>
        <Show when={!showTimestamps()}>
          <text fg={theme.textMuted} flexShrink={0}>
            {" "}
            [no timestamps]
          </text>
        </Show>
      </PaneHeader>

      {/* Logs buffer */}
      <box marginLeft={2} flexGrow={1}>
        <Show
          when={state.selectedResource}
          fallback={
            <text fg={theme.textMuted}>Select a resource to view logs.</text>
          }
        >
          <LogView />
        </Show>
      </box>

      {/* Sticky footer */}
      <box flexShrink={0}>
        <Footer />
      </box>

      {/* Log Search Modal overlay */}
      <Show when={activeModal() === "logSearch"}>
        <LogSearchModal
          onClose={() => closeModal()}
          onSearch={handleSearch}
          initialQuery={searchQuery()}
        />
      </Show>
    </box>
  );
}
