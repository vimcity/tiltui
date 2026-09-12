// Button Form Modal - collects input values before executing a button action
// Renders text fields, checkboxes, and choice selects driven by APIInputSpec

import { TextAttributes } from "@opentui/core";
import type { InputRenderable } from "@opentui/core";
import { createEffect, createSignal, createMemo, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { useTheme } from "@/hooks/useTheme";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import type { APIButton } from "../tilt/api-types";
import type { APIInputSpec } from "../tilt/api-types";

interface ButtonFormModalProps {
  button: APIButton;
  onClose: () => void;
  onSubmit: (
    button: APIButton,
    inputValues: Record<string, string | boolean>,
  ) => void;
}

function isVisibleInput(spec: APIInputSpec): boolean {
  return !!(spec.text || spec.bool || spec.choice);
}

function getInputType(spec: APIInputSpec): "text" | "bool" | "choice" {
  if (spec.bool) return "bool";
  if (spec.choice) return "choice";
  return "text";
}

function getDefaultValue(spec: APIInputSpec): string | boolean {
  if (spec.bool) return spec.bool.defaultValue ?? false;
  if (spec.choice) return spec.choice.choices?.[0] ?? "";
  if (spec.text) return spec.text.defaultValue ?? "";
  return "";
}

export function ButtonFormModal(props: ButtonFormModalProps) {
  const theme = useTheme();
  const allInputs = () => props.button.spec.inputs ?? [];
  const visibleInputs = createMemo(() => allInputs().filter(isVisibleInput));
  const isConfirmationOnly = createMemo(
    () =>
      visibleInputs().length === 0 && props.button.spec.requiresConfirmation,
  );

  const [focusIndex, setFocusIndex] = createSignal(0);

  const initialValues: Record<string, string | boolean> = {};
  for (const spec of allInputs()) {
    if (spec.hidden) {
      initialValues[spec.name] = spec.hidden.value ?? "";
    } else {
      initialValues[spec.name] = getDefaultValue(spec);
    }
  }
  const [values, setValues] = createStore(initialValues);

  const choiceIndices: Record<string, number> = {};
  for (const spec of allInputs()) {
    if (spec.choice) {
      choiceIndices[spec.name] = 0;
    }
  }
  const [choiceIdx, setChoiceIdx] = createStore(choiceIndices);

  const inputRefs: Record<string, InputRenderable> = {};

  function focusField(index: number) {
    const fields = visibleInputs();
    if (fields.length === 0) return;
    const clamped = ((index % fields.length) + fields.length) % fields.length;
    setFocusIndex(clamped);

    const field = fields[clamped];
    if (field.text) {
      setTimeout(() => inputRefs[field.name]?.focus(), 10);
    }
  }

  createEffect(() => {
    focusField(0);
  });

  function handleSubmit() {
    const result: Record<string, string | boolean> = {};
    for (const spec of allInputs()) {
      result[spec.name] = values[spec.name];
    }
    props.onSubmit(props.button, result);
  }

  const focusedField = createMemo(() => visibleInputs()[focusIndex()]);

  function handleKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean; preventDefault: () => void }) {
    if (evt.name === "tab") {
      evt.preventDefault();
      if (evt.shift) {
        focusField(focusIndex() - 1);
      } else {
        focusField(focusIndex() + 1);
      }
      return;
    }

    if (evt.name === "return") {
      evt.preventDefault();
      handleSubmit();
      return;
    }

    const field = focusedField();
    if (!field) return;

    if (evt.name === "space" && field.bool) {
      evt.preventDefault();
      setValues(field.name, !values[field.name]);
      return;
    }

    if (field.choice && field.choice.choices && field.choice.choices.length > 0) {
      const choices = field.choice.choices;
      const currentIdx = choiceIdx[field.name] ?? 0;

      if (evt.name === "up" || (evt.ctrl && evt.name === "k")) {
        evt.preventDefault();
        const next =
          ((currentIdx - 1) % choices.length + choices.length) %
          choices.length;
        setChoiceIdx(field.name, next);
        setValues(field.name, choices[next]);
        return;
      }
      if (evt.name === "down" || (evt.ctrl && evt.name === "j")) {
        evt.preventDefault();
        const next = (currentIdx + 1) % choices.length;
        setChoiceIdx(field.name, next);
        setValues(field.name, choices[next]);
        return;
      }
    }
  }

  function renderField(spec: APIInputSpec, index: number) {
    const isFocused = () => focusIndex() === index;
    const label = spec.label || spec.name;
    const type = getInputType(spec);

    return (
      <box flexDirection="column" paddingLeft={2} paddingRight={2}>
        <text
          fg={isFocused() ? theme.primary : theme.textMuted}
          attributes={isFocused() ? TextAttributes.BOLD : undefined}
        >
          {label}
        </text>

        <Show when={type === "text"}>
          <box>
            <input
              ref={(r: InputRenderable) => {
                inputRefs[spec.name] = r;
              }}
              value={values[spec.name] as string}
              onInput={(v: string) => setValues(spec.name, v)}
              focused={isFocused()}
              focusedBackgroundColor={theme.background}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              placeholder={spec.text?.placeholder ?? ""}
            />
          </box>
        </Show>

        <Show when={type === "bool"}>
          <text
            fg={isFocused() ? theme.text : theme.textMuted}
            attributes={isFocused() ? TextAttributes.BOLD : undefined}
          >
            {values[spec.name] ? "[x]" : "[ ]"}{" "}
            {values[spec.name] ? "enabled" : "disabled"}
            {isFocused() ? "  (space to toggle)" : ""}
          </text>
        </Show>

        <Show when={type === "choice"}>
          <box flexDirection="row">
            <For each={spec.choice?.choices ?? []}>
              {(choice) => {
                const isChosen = () => values[spec.name] === choice;
                return (
                  <box
                    backgroundColor={
                      isChosen()
                        ? isFocused()
                          ? theme.primary
                          : theme.border
                        : undefined
                    }
                  >
                    <text
                      fg={
                        isChosen()
                          ? isFocused()
                            ? theme.background
                            : theme.text
                          : theme.textMuted
                      }
                      attributes={isChosen() ? TextAttributes.BOLD : undefined}
                    >
                      {" "}
                      {choice}{" "}
                    </text>
                  </box>
                );
              }}
            </For>
            <Show when={isFocused()}>
              <text fg={theme.textMuted}> (up/down)</text>
            </Show>
          </box>
        </Show>
      </box>
    );
  }

  // Confirmation-only modal (no visible inputs)
  if (isConfirmationOnly()) {
    return (
      <Modal size="sm" onClose={props.onClose} onKeyboard={handleKeyboard}>
        <ModalHeader title={`Confirm: ${props.button.spec.text}`} />

        <box paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={theme.text}>Are you sure you want to run this action?</text>
        </box>

        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="row"
          justifyContent="space-between"
        >
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            Enter to confirm
          </text>
          <text fg={theme.textMuted}>Esc to cancel</text>
        </box>
      </Modal>
    );
  }

  // Full form modal
  return (
    <Modal size="md" onClose={props.onClose} onKeyboard={handleKeyboard}>
      <ModalHeader title={props.button.spec.text} />

      <For each={visibleInputs()}>
        {(spec, i) => (
          <box paddingTop={1}>{renderField(spec, i())}</box>
        )}
      </For>

      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          Enter to submit
        </text>
        <text fg={theme.textMuted}>Tab to cycle fields</text>
      </box>
    </Modal>
  );
}
