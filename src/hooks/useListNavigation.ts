// Shared hook for filterable list navigation in modals
// Handles store, move/wrap, scroll sync, and filter reset

import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, on } from "solid-js";
import { createStore } from "solid-js/store";

interface ListNavigationOptions {
  // Total number of items in the flat list
  itemCount: () => number;
  // Ref to the scrollbox for scroll sync
  scrollRef: () => ScrollBoxRenderable | undefined;
  // Height of each item in rows (default 1)
  itemHeight?: number;
  // Max visible items before scrolling (default 10)
  visibleItems?: number;
}

interface ListNavigationResult {
  selected: () => number;
  filter: () => string;
  setFilter: (value: string) => void;
  move: (direction: number) => void;
  setSelected: (index: number) => void;
}

export function useListNavigation(
  options: ListNavigationOptions,
): ListNavigationResult {
  const itemHeight = options.itemHeight ?? 1;
  const visibleItems = options.visibleItems ?? 10;

  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
  });

  // Reset selection when filter changes
  createEffect(
    on(
      () => store.filter,
      () => setStore("selected", 0),
    ),
  );

  function move(direction: number) {
    const count = options.itemCount();
    if (count === 0) return;

    let next = store.selected + direction;
    if (next < 0) next = count - 1;
    if (next >= count) next = 0;
    setStore("selected", next);

    const scrollRef = options.scrollRef();
    if (scrollRef) {
      const scrollTop = scrollRef.scrollTop;
      const itemTop = next * itemHeight;

      if (itemTop < scrollTop) {
        scrollRef.scrollTo(itemTop);
      } else if (itemTop >= scrollTop + visibleItems) {
        scrollRef.scrollTo(itemTop - visibleItems + 1);
      }
    }
  }

  function setFilter(value: string) {
    setStore("filter", value.trim());
  }

  function setSelected(index: number) {
    setStore("selected", index);
  }

  return {
    selected: () => store.selected,
    filter: () => store.filter,
    setFilter,
    move,
    setSelected,
  };
}
