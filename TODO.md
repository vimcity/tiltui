# BUGS

- resource tree
  - when you're on a selected resource node, and the node list changes (based on active filters), the logs view doesn't update. e.g. select a node that's currently building while the building filter is active. that node will disappear and be replaced with the next building resource, and the logs won't update.
  - up should circle around to bottom of tree when already at top, and same for down.
- logs
  - log clearing doens't work
- resource picker search doens't prioritize exact match.

# ROADMAP

- self-updating tui client
  - ci releases
- Mouse selection in logs-view
- UI Unit tests
- ui improvements
  - animate log content replacement to make it obvious that log content changed
- split pane
- favorites
- log clearing
- user config
  - mutable keymap
- status line
  - show AWS SSO session info
- toast messages
  - on text selection
  - on resource failed
  - on all resources complete

- tilt snapshots (load/save)
- collapse/expand all in tree-view
