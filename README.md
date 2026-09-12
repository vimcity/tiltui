# Tilt TUI

<img width="3292" height="1996" alt="image" src="https://github.com/user-attachments/assets/5cc3f81e-0a7a-4dbc-8ef6-a83f3c2a5d65" />

## Requirements

- [Bun](https://bun.sh/)
- [Tilt](https://tilt.dev/)
- A running Tilt instance, or a project with a `Tiltfile`

## Running

Install dependencies and start the development TUI:

```bash
bun install
bun dev
```

To have the TUI start Tilt itself:

```bash
bun dev up
```

Compile a binary for the current platform:

```bash
bun run build:binary:single
```

## Using

Press `?` for the complete context-aware shortcut list.

The complete, context-aware keybinding list is available in the TUI with `?`.
Keybindings can also be customized through the configuration file below.

Log timestamps from the application are preserved. TUI-added timestamps are off
by default because most structured application logs already include them.

## Configuration

Tilt TUI loads optional settings from:

```text
~/.config/tilt-tui/config.json
```

### Log filters

```json
{
  "logFilters": {
    "health-checks": [
      "GET /health",
      "GET /readiness"
    ],
    "debug-logs": [
      "^DEBUG:",
      "\\[debug\\]"
    ]
  },
  "disableClipboardCopy": true
}
```

Filters use JavaScript regular-expression syntax. Active filters are shown in
the log-view header. Set `disableClipboardCopy` to prevent selected logs from
being copied to the system clipboard or through OSC52.

### Keybindings

Override bindings by command name. Keys may use `ctrl+` and/or `shift+`:

```json
{
  "keybindings": {
    "nav.down": ["j"],
    "nav.up": ["k"],
    "logs.scroll.pagedown": ["ctrl+d"],
    "logs.scroll.pageup": ["ctrl+u"]
  }
}
```

Overrides replace the default keys for that command.

## Development

```bash
bun run typecheck
bun test
bun run debug
```

The debug command starts Bun's inspector. Open the printed URL in a browser or
use the backtick key to toggle the in-app debug console.
