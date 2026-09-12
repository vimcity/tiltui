# Feature: Log Searching and Filtering

## Goals

- Filter logs by string or regex (fuzzy?)
- Filter logs by container in a combined log stream
- Filter logs by type: build | runtime

## Design

### Filtered LogsBuffer

- all span separators (e.g. "Web Trigger", "Initial Build", etc.) remain present when showing filtered loglines
- should highlight searched string in lines visible when filter active
- use `esc` to clear all filters

### Search Filter

- Use `/` to open search modal.
- Modal is just a text input.
- Enter to filter when modal is open
- use `/foo/` to indicate regex search, otherwise use string match (fuzz?)

### Toggle Filters

- add logs-mode commands for toggling build | runtime | all
- add logs-mode toggle command for each individual container to main palette
