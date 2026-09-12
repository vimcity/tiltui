# Feature: User Settings V1

## Goals

- Allow customization of the UI with a config file in the users ~/.config/tilt-tui/config.json
- filter/ignore log messages based on regexes

## Design

- config.json format

```json
{
  "logFilters": {
    "ignoreFlagd": ["^[flagd]"]
}
```

- read at app start
- when appending log lines to the logstore in `LogStore.append`, drop any entries that match any of the log filters.
- display on the resourceview header which logFilters are currently loaded. show `logFilters` keys from config.
