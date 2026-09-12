# Plan: Input Forms for Button Actions

## Overview

When a user selects a button action from the command palette, if that button has `inputs` (non-hidden), the palette closes and a **ButtonFormModal** opens in its place. The form renders fields driven by `APIInputSpec[]`, supports Tab cycling between fields, and submits the collected values via the existing `client.clickButton(button, inputValues)` API. Buttons with `requiresConfirmation` but no inputs will get a simple confirmation modal.

As a prerequisite, the existing per-modal boolean signals are refactored into a single `ModalState` enum signal, which simplifies adding the new modal and fixes existing issues.

## Current State

- Buttons with inputs always use **default values** -- there is no UI to collect user input (`command-palette.tsx:193` calls `client.clickButton(opt.button)` with no `inputValues`).
- `requiresConfirmation` on `APIButtonSpec` is never checked.
- The `client.clickButton()` method already fully supports all 4 input types (`text`, `bool`, `hidden`, `choice`) with an `inputValues` parameter.
- Modal state lives in `FocusContext` as 4 independent `createSignal<boolean>` pairs -- nothing enforces mutual exclusivity.
- `handler.ts:23` has a misleading parameter name `paletteOpen` that actually receives a combined "any modal open" boolean.
- `useKeyHandler.ts:29` aggregates 3 of 4 modal signals (`logSearchOpen` is excluded) which may be an inconsistency.

## Files Unchanged

| File | Why |
|------|-----|
| `src/tilt/client.ts` | `clickButton(button, inputValues)` already accepts arbitrary `inputValues` -- no changes needed |
| `src/tilt/api-types.ts` | Types are complete (`APIInputSpec`, `APIInputStatus`, etc.) |
| `src/tilt/types.ts` | `ButtonAction.inputs` already carries `APIInputSpec[]` |

---

## Step 1: Refactor Modal State to Single Enum

Replace 4 independent boolean signals with a single `ModalState` enum signal. This enforces mutual exclusivity, simplifies guards, and makes adding the button form modal trivial.

### 1a. Define `ModalState` and refactor `FocusContext`

**File:** `src/context/focus.tsx`

Define a union type for all modal states:
```typescript
export type ModalState =
  | "none"
  | "palette"
  | "resourcePicker"
  | "help"
  | "logSearch"
  | "buttonForm";
```

Replace the 4 signal pairs:
```typescript
// BEFORE (4 signals, 8 members on context)
const [paletteOpen, setPaletteOpen] = createSignal(false);
const [resourcePickerOpen, setResourcePickerOpen] = createSignal(false);
const [helpOpen, setHelpOpen] = createSignal(false);
const [logSearchOpen, setLogSearchOpen] = createSignal(false);

// AFTER (1 signal, 2 members on context)
const [activeModal, setActiveModal] = createSignal<ModalState>("none");
```

Add derived convenience helpers:
```typescript
function openModal(modal: ModalState) {
  setActiveModal(modal);
}
function closeModal() {
  setActiveModal("none");
}
function isModalOpen() {
  return activeModal() !== "none";
}
```

Simplify `FocusContextValue` interface:
```typescript
// BEFORE
interface FocusContextValue {
  // ...pane stuff...
  paletteOpen: () => boolean;
  setPaletteOpen: Setter<boolean>;
  resourcePickerOpen: () => boolean;
  setResourcePickerOpen: Setter<boolean>;
  helpOpen: () => boolean;
  setHelpOpen: Setter<boolean>;
  logSearchOpen: () => boolean;
  setLogSearchOpen: Setter<boolean>;
}

// AFTER
interface FocusContextValue {
  // ...pane stuff...
  activeModal: () => ModalState;
  openModal: (modal: ModalState) => void;
  closeModal: () => void;
  isModalOpen: () => boolean;
}
```

### 1b. Update `app.tsx`

**File:** `src/app.tsx`

**Destructuring:** Replace 8 signal destructures with the new API:
```typescript
// BEFORE
const { paletteOpen, setPaletteOpen, resourcePickerOpen, setResourcePickerOpen, helpOpen, setHelpOpen, logSearchOpen } = useFocus();

// AFTER
const { activeModal, openModal, closeModal, isModalOpen } = useFocus();
```

**`executeCommand()`:** Replace setter calls:
```typescript
// BEFORE
case Commands.PALETTE_OPEN: setPaletteOpen(true); break;
case Commands.RESOURCE_PICKER_OPEN: setResourcePickerOpen(true); break;
case Commands.HELP_OPEN: setHelpOpen(true); break;

// AFTER
case Commands.PALETTE_OPEN: openModal("palette"); break;
case Commands.RESOURCE_PICKER_OPEN: openModal("resourcePicker"); break;
case Commands.HELP_OPEN: openModal("help"); break;
```

**Keyboard suppression guard:**
```typescript
// BEFORE
useKeyHandler("app", executeCommand, () =>
  !paletteOpen() && !resourcePickerOpen() && !helpOpen() && !logSearchOpen()
);

// AFTER
useKeyHandler("app", executeCommand, () => !isModalOpen());
```

**Modal `<Show>` blocks:**
```tsx
// BEFORE
<Show when={paletteOpen()}>
<Show when={resourcePickerOpen()}>
<Show when={helpOpen()}>

// AFTER
<Show when={activeModal() === "palette"}>
<Show when={activeModal() === "resourcePicker"}>
<Show when={activeModal() === "help"}>
```

**`onClose` callbacks:**
```tsx
// BEFORE
onClose={() => setPaletteOpen(false)}

// AFTER
onClose={() => closeModal()}
```

### 1c. Update `resourceview.tsx`

**File:** `src/components/resourceview.tsx`

Same pattern -- replace `logSearchOpen`/`setLogSearchOpen` usage:
```typescript
// BEFORE
const { logSearchOpen, setLogSearchOpen } = useFocus();
// opens: setLogSearchOpen(true)
// closes: setLogSearchOpen(false)
// guard: !logSearchOpen()
// render: <Show when={logSearchOpen()}>

// AFTER
const { activeModal, openModal, closeModal } = useFocus();
// opens: openModal("logSearch")
// closes: closeModal()
// guard: activeModal() !== "logSearch"
// render: <Show when={activeModal() === "logSearch"}>
```

### 1d. Update `useKeyHandler.ts`

**File:** `src/keyboard/useKeyHandler.ts`

Replace 3-signal aggregation with a single call:
```typescript
// BEFORE
const { paletteOpen, resourcePickerOpen, helpOpen } = useFocus();
const modalOpen = paletteOpen() || resourcePickerOpen() || helpOpen();

// AFTER
const { isModalOpen } = useFocus();
const modalOpen = isModalOpen();
```

This also fixes the inconsistency where `logSearchOpen` was excluded from the aggregation.

### 1e. Rename parameter in `handler.ts`

**File:** `src/keyboard/handler.ts`

Rename the misleading parameter:
```typescript
// BEFORE
export function handleKeyEvent(event: KeyEvent, mode: Mode, paletteOpen: boolean): Command | null {
  if (paletteOpen && mode !== "app") { return null; }

// AFTER
export function handleKeyEvent(event: KeyEvent, mode: Mode, modalOpen: boolean): Command | null {
  if (modalOpen && mode !== "app") { return null; }
```

---

## Step 2: Modify Command Palette Selection Logic

**File:** `src/components/command-palette.tsx`

### 2a. Add `onButtonForm` callback prop

```typescript
interface CommandPaletteProps {
  onClose: () => void;
  onSelect: (option: PaletteOption) => void;
  onButtonForm: (button: APIButton) => void;  // NEW
}
```

### 2b. Add helper to detect visible inputs

```typescript
function hasVisibleInputs(button: APIButton): boolean {
  return (button.spec.inputs ?? []).some(
    (input) => input.text || input.bool || input.choice,
  );
}
```

### 2c. Update `handleSelect()` branching

In `handleSelect()` (around line 190), when `opt.button` is present:

```typescript
if (opt.button) {
  const needsForm = hasVisibleInputs(opt.button);
  const needsConfirmation = opt.button.spec.requiresConfirmation && !needsForm;

  if (needsForm || needsConfirmation) {
    // Close palette and hand off to form modal
    props.onClose();
    props.onButtonForm(opt.button);
  } else {
    // No inputs, no confirmation -- click immediately (existing behavior)
    const updatedButton = await client.clickButton(opt.button);
    opt.button = updatedButton;
    props.onClose();
  }
  return;
}
```

---

## Step 3: Create ButtonFormModal Component

**File:** `src/components/button-form-modal.tsx` (NEW)

### 3a. Props interface

```typescript
interface ButtonFormModalProps {
  button: APIButton;
  onClose: () => void;
  onSubmit: (button: APIButton, inputValues: Record<string, string | boolean>) => void;
}
```

### 3b. Rendering logic driven by `APIInputSpec`

For each input in `button.spec.inputs`:

| `APIInputSpec` field | Rendered as | Widget |
|-----|-----|-----|
| `text` | Text field | `<input>` with `value`, `placeholder`, `onInput` |
| `bool` | Checkbox | Custom `<text>` showing `[x]` / `[ ]`, toggled on Space/Enter |
| `choice` | Select list | `<select>` with choices as options |
| `hidden` | Not rendered | Value taken from `spec.hidden.value` silently |

### 3c. Layout

```
┌─────────────────────────────────────┐
│  Button Name                   esc  │
│                                     │
│  Label 1:                           │
│  [text input field           ]      │
│                                     │
│  Label 2:                           │
│  [x] Enable dry run                 │
│                                     │
│  Label 3:                           │
│  < Option A | Option B | Option C > │
│                                     │
│  [Submit]              tab: cycle   │
└─────────────────────────────────────┘
```

- Same absolute-positioned overlay pattern as CommandPalette: `position="absolute"`, `top={2}`, `left="50%"`, `marginLeft={-30}`, `width={60}`
- Same theme colors from `defaultTheme`

### 3d. Confirmation-only variant

For `requiresConfirmation` buttons with NO visible inputs:

```
┌─────────────────────────────────────┐
│  Confirm: Button Name          esc  │
│                                     │
│  Are you sure you want to run this? │
│                                     │
│  [Confirm]           [Cancel]       │
└─────────────────────────────────────┘
```
- Enter to confirm, Escape to cancel

### 3e. Internal state management

```typescript
const [focusIndex, setFocusIndex] = createSignal(0);
const [values, setValues] = createStore<Record<string, string | boolean>>({});
```

- Initialize `values` from each `APIInputSpec`'s default value on mount
- `focusIndex` tracks which visible field is active (0-indexed over non-hidden inputs)
- Hidden inputs are excluded from the focus cycle

### 3f. Keyboard handling (via `useKeyboard`)

| Key | Action |
|-----|--------|
| `Tab` | Advance `focusIndex` to next visible field (wrap around) |
| `Shift+Tab` | Move `focusIndex` to previous visible field (wrap around) |
| `Enter` | If on last field or on Submit: submit form. If on a `choice` select: confirm selection within the select. |
| `Escape` | Close modal without submitting |
| `Space` | Toggle bool checkbox when focused on a bool field |
| Up/Down | Navigate within a `choice` `<select>` when that field is focused |

### 3g. Focus management

Use the `focused` prop on `<input>` and `<select>` elements, driven by `focusIndex()`:

```tsx
<input
  focused={focusIndex() === fieldIndex}
  value={values[spec.name]}
  onInput={(v) => setValues(spec.name, v)}
  placeholder={spec.text?.placeholder ?? ""}
/>
```

For bool fields (custom, not a native `<input>`):
```tsx
<box>
  <text
    fg={focusIndex() === fieldIndex ? theme.primary : theme.text}
  >
    {values[spec.name] ? "[x]" : "[ ]"} {spec.label || spec.name}
  </text>
</box>
```
When `focusIndex` matches, Space/Enter toggles the value via `useKeyboard`.

For choice fields:
```tsx
<select
  options={spec.choice.choices.map(c => ({ name: c, value: c }))}
  focused={focusIndex() === fieldIndex}
  onSelect={(_, opt) => setValues(spec.name, opt.value)}
  height={Math.min(spec.choice.choices.length, 5)}
/>
```

### 3h. Submit flow

1. Collect all `values` from the store
2. For hidden inputs, include `spec.hidden.value` in the values map
3. Call `props.onSubmit(props.button, values)`
4. `onSubmit` handler (in `app.tsx`) calls `client.clickButton(button, values)` and closes the form

---

## Step 4: Wire Up in App

**File:** `src/app.tsx`

### 4a. Add button state signal

```typescript
const [formButton, setFormButton] = createSignal<APIButton | null>(null);
```

### 4b. Palette-to-form transition callback

```typescript
function handleButtonForm(button: APIButton) {
  setFormButton(button);
  openModal("buttonForm");
}
```

Pass `onButtonForm={handleButtonForm}` to `<CommandPalette>`.

### 4c. Form submit handler

```typescript
async function handleFormSubmit(button: APIButton, inputValues: Record<string, string | boolean>) {
  try {
    await client.clickButton(button, inputValues);
  } catch (err) {
    console.error("Failed to click button:", err);
  }
  closeModal();
  setFormButton(null);
}
```

### 4d. Mount the modal

```tsx
<Show when={activeModal() === "buttonForm" && formButton()}>
  <ButtonFormModal
    button={formButton()!}
    onClose={() => { closeModal(); setFormButton(null); }}
    onSubmit={handleFormSubmit}
  />
</Show>
```

No additional keyboard suppression changes needed -- Step 1 already replaced the guard with `!isModalOpen()`, which covers all enum values including `"buttonForm"`.

---

## Edge Cases

| Case | Handling |
|------|----------|
| Button with ONLY hidden inputs | No form shown -- click immediately with hidden defaults (same as today) |
| Button with mix of hidden + visible inputs | Form shows only visible inputs; hidden values included silently on submit |
| Button with `requiresConfirmation` AND inputs | Show the full input form (confirmation is implicit in submitting the form) |
| Button with `requiresConfirmation` and NO visible inputs | Show confirmation-only modal (Enter to confirm, Escape to cancel) |
| Empty `choices` array on a `choice` input | Render as disabled/empty select, or skip the field |
| Button clicked again while form is open | Can't happen -- palette is closed before form opens; enum enforces single modal |
| `bool` input with custom `trueString`/`falseString` | Store the boolean in form state; `client.clickButton` handles bool->string conversion server-side |
| Opening any modal while another is open | Enum naturally closes the previous one (single signal assignment) |

## Testing Strategy

- **Unit test** `button-form-modal.tsx` field rendering: given various `APIInputSpec[]` configurations, verify the correct fields are rendered
- **Integration test** via tmux: open palette, select a button with inputs, verify form appears, fill in values, submit, verify API call is made with correct values
- **Regression test** the modal enum refactor: verify all existing modals still open/close correctly after the refactor
- Follow the `AGENTS.md` guideline: reproduce in a test case before implementing fixes

## Summary of Changes

### Step 1 -- Modal state refactor (prerequisite)
1. **`src/context/focus.tsx`** -- Replace 4 boolean signal pairs with `ModalState` enum and `activeModal`/`openModal`/`closeModal`/`isModalOpen`
2. **`src/app.tsx`** -- Use new modal API for palette, resourcePicker, help; simplify keyboard guard to `!isModalOpen()`
3. **`src/components/resourceview.tsx`** -- Use new modal API for logSearch
4. **`src/keyboard/useKeyHandler.ts`** -- Replace 3-signal aggregation with `isModalOpen()`
5. **`src/keyboard/handler.ts`** -- Rename `paletteOpen` parameter to `modalOpen`

### Step 2 -- Command palette changes
6. **`src/components/command-palette.tsx`** -- Add `onButtonForm` prop; detect visible inputs/confirmation; defer to form

### Steps 3-4 -- New modal
7. **`src/components/button-form-modal.tsx`** (NEW) -- Form modal rendering all `APIInputSpec` field types with Tab cycling
8. **`src/app.tsx`** -- Mount form modal, wire `formButton` signal, add palette-to-form transition
