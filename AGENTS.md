# Agents

## Coding Guildelines

## Typescript Constraints

- never use `any`. if you find you need to, try other methods, or pause and discuss
- Don't use any browser-specific types or interfaces. node types only

## Typescript Style

- Comments: Minimal comments, NO JSDoc. Only use comments to explain WHY something was done, not to describe what it's doing.
- Naming: camelCase for variables/functions, PascalCase for classes/interfaces, UPPER_CASE for constants
- Types: Strict TypeScript, use interfaces for options/configs, explicit return types for public APIs
- Formatting: Prettier
- Imports: Use explicit imports, group by: built-ins, external deps, internal modules

## Bun Guildelines

This project uses bun as its runtime, not nodejs or browser.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## BUN APIs

- if unsure if any node types are supported in bun, read the Bun API docs in `node_modules/bun-types/docs/**.md`.
- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.
- browser apis like `requestAnimationFrame` are not available.

## Testing the TUI

This app is a TUI, and as such won't be able to show output on stdout.

- use `bun dev` to start the app
- use `tmux capture-pane` to run tui tests.
- use a unique tmux session name to prevent conflicts with user-sessions.
- in order to see console output, you'll need to run the app with `SHOW_CONSOLE=true` env var.
- you can also run the app without the console open and use the "`" key to open the console at any time.
- Reproduce the issue in a test case. Do NOT start fixing without a reproducible test case.
  Use debug logs to see what is actually happening. DO NOT GUESS.
