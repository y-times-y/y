# y desktop app

This folder contains the Electron + React + TypeScript desktop app for **y**.

For the product overview, screenshots, download link, and architecture summary, read the root [README](../README.md).

## Development

```bash
pnpm install
pnpm dev
```

## Checks

```bash
pnpm typecheck
pnpm test:ui
```

## Build

```bash
pnpm build:mac
```

Generated release artifacts are written to `app/dist/` and are intentionally ignored by git.
