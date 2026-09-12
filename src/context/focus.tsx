// Focus management context provider

import {
  createContext,
  useContext,
  createSignal,
  type ParentProps,
} from "solid-js";
import { createStore } from "solid-js/store";

export type Pane = "tree" | "resource";

export type ModalState =
  | "none"
  | "palette"
  | "resourcePicker"
  | "help"
  | "logSearch"
  | "buttonForm"
  | "engineInfo"
  | "resourceInfo";

interface FocusState {
  activePane: Pane;
}

interface FocusContextValue {
  state: FocusState;
  setActivePane: (pane: Pane) => void;
  cyclePane: (direction?: 1 | -1) => void;
  sidebarVisible: () => boolean;
  toggleSidebar: () => void;
  activeModal: () => ModalState;
  openModal: (modal: ModalState) => void;
  closeModal: () => void;
  isModalOpen: () => boolean;
}

const FocusContext = createContext<FocusContextValue>();

export function FocusProvider(props: ParentProps) {
  const [state, setState] = createStore<FocusState>({
    activePane: "tree",
  });

  const [activeModal, setActiveModal] = createSignal<ModalState>("none");
  const [sidebarOpen, setSidebarOpen] = createSignal(true);

  function setActivePane(pane: Pane) {
    setState("activePane", pane);
  }

  function cyclePane(direction: 1 | -1 = 1) {
    setState("activePane", (current) => {
      const next =
        direction === 1
          ? current === "tree"
            ? "resource"
            : "tree"
          : current === "resource"
            ? "tree"
            : "resource";
      // Expand sidebar when focusing tree
      if (next === "tree" && !sidebarOpen()) {
        setSidebarOpen(true);
      }
      return next;
    });
  }

  function sidebarVisible() {
    return sidebarOpen();
  }

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const newValue = !prev;
      if (newValue) {
        // When showing sidebar, focus tree
        setState("activePane", "tree");
      } else {
        // When hiding sidebar, focus resource pane since tree is no longer visible
        setState("activePane", "resource");
      }
      return newValue;
    });
  }

  function openModal(modal: ModalState) {
    setActiveModal(modal);
  }

  function closeModal() {
    setActiveModal("none");
  }

  function isModalOpen() {
    return activeModal() !== "none";
  }

  const value: FocusContextValue = {
    state,
    setActivePane,
    cyclePane,
    sidebarVisible,
    toggleSidebar,
    activeModal,
    openModal,
    closeModal,
    isModalOpen,
  };

  return (
    <FocusContext.Provider value={value}>
      {props.children}
    </FocusContext.Provider>
  );
}

export function useFocus() {
  const context = useContext(FocusContext);
  if (!context) {
    throw new Error("useFocus must be used within a FocusProvider");
  }
  return context;
}
