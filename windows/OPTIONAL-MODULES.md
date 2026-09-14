# Optional drawer modules

Windows 0.5.0 keeps the account drawer minimal by default. Enable individual sections in Settings → Notch: Tasks, Services, Memory. Tabs appear only when another section is enabled. Quota headings, reset times, plan, additional limits and action buttons remain independently optional.

## Implemented

- Tasks: local checklist, Enter to add, click to edit, Enter/Escape to save/cancel, completion and restore, drag reorder, context-menu deletion. Drafts survive drawer changes. `%APPDATA%/codenotch/todos.json` uses atomic replacement; invalid files are preserved.
- Services: a user-managed local catalogue of names, HTTP(S) addresses and purpose/instructions; search, details, copy address, deletion.
- Memory: local current focus plus Recent and Knowledge views over an explicitly selected Markdown directory. Folder navigation, title/path search and plain-text reading. A missing knowledge folder is shown as unconfigured.
- Hover does not take keyboard focus. Explicit text entry enables focus and holds the drawer open until editing ends or the window loses focus.

## Reference and scope

`nglain/codex-account-monitor` implements Codex, Services, Todos and Memory in `Sources/Features/DrawerTabs.swift`. Its Todos are a checklist, not a calendar with dates/reminders. Memory is backed by that installation's Context MCP and knowledge directory.

This Windows adaptation uses local Rust storage and a Markdown reader. It does not copy another machine's credentials, remote-service clients or Context MCP installation. Services do not yet verify balances or connection health; focus is local and has no expiry or automatic agent injection. These are separate follow-up integrations, not active features.

## Verification criteria

- Rust tests cover checklist persistence, failed replacement, input limits and memory path boundaries.
- UI tests cover optional controls, CRUD command wiring, drafts, async responses, module changes and focus behavior.
- Installed application must accept a task through the real input, persist it, expose the optional tabs, and retain minimal mode when sections are disabled.
- Installed binary must match the release build; the remote main commit must match the local commit.
