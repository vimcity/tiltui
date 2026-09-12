// Log Search Modal - simple text input for filtering logs
// Supports string match and regex search (using /pattern/ syntax)

import { createSignal } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { ModalFilterInput } from "./modal/modal-filter-input";
import type { LogSearchFilter } from "./log-buffer";
import { parseSearchQuery } from "../utils/log-search-utils";

interface LogSearchModalProps {
  onClose: () => void;
  onSearch: (filter: LogSearchFilter | null) => void;
  initialQuery?: string;
}

export function LogSearchModal(props: LogSearchModalProps) {
  const theme = useTheme();
  const [query, setQuery] = createSignal(props.initialQuery ?? "");
  const [error, setError] = createSignal<string | null>(null);

  function handleSearch() {
    const filter = parseSearchQuery(query());
    if (filter?.isRegex && !filter.regex) {
      setError("Invalid regex pattern");
      return;
    }
    setError(null);
    props.onSearch(filter);
    props.onClose();
  }

  function handleKeyboard(evt: { name: string; preventDefault: () => void }) {
    if (evt.name === "return") {
      evt.preventDefault();
      handleSearch();
      return;
    }
  }

  return (
    <Modal size="sm" onClose={props.onClose} onKeyboard={handleKeyboard}>
      <ModalHeader title="Search Logs" />

      <box paddingLeft={2} paddingRight={2}>
        <text fg={theme.textMuted}>Use /regex/ for regex search</text>
      </box>

      <ModalFilterInput
        initialValue={props.initialQuery}
        onInput={(v) => {
          setQuery(v);
          setError(null);
        }}
        placeholder="Search..."
      />

      {error() && (
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={theme.error}>{error()}</text>
        </box>
      )}

      <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text fg={theme.textMuted}>Enter to search</text>
      </box>
    </Modal>
  );
}

export { parseSearchQuery } from "../utils/log-search-utils";
export type { LogSearchFilter };
