// Toast notification context provider

import {
  createContext,
  useContext,
  createSignal,
  type ParentProps,
  type Accessor,
} from "solid-js";

export interface ToastMessage {
  id: number;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toast: Accessor<ToastMessage | null>;
  showToast: (message: string, duration?: number) => void;
  clearToast: () => void;
}

const ToastContext = createContext<ToastContextValue>();

let toastIdCounter = 0;

export function ToastProvider(props: ParentProps) {
  const [toast, setToast] = createSignal<ToastMessage | null>(null);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function showToast(message: string, duration = 2000) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    const id = ++toastIdCounter;
    setToast({ id, message, duration });

    timeoutId = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
      timeoutId = null;
    }, duration);
  }

  function clearToast() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    setToast(null);
  }

  const value: ToastContextValue = {
    toast,
    showToast,
    clearToast,
  };

  return (
    <ToastContext.Provider value={value}>
      {props.children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
