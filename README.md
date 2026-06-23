# y

<p align="center">
  <img src="docs/assets/y-desktop.png" alt="y desktop app showing a chat-first coding workspace" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/y-times-y/y/releases/latest/download/y-0.0.1.dmg">
    <img alt="Download for macOS" src="https://img.shields.io/badge/Download%20for-macOS-000000?style=for-the-badge&logo=apple&logoColor=white" />
  </a>
</p>

**y** is a self-modifying desktop coding-agent app.

It is built around a simple idea: software should become malleable while you use it. The main interface is a chat, but the app can reshape its own UI through a protected Modify surface. You can ask y to change how y itself works, keep the change if it renders safely, or roll it back if it does not.

y is not a new agent model. It is a local, chat-first workspace for the coding agents you already use: Claude Code, OpenAI Codex, and other CLI-native agents over time.

## Why y exists

Most coding-agent apps are fixed products. You can use them, configure them, maybe install plugins, but the product itself still belongs to someone else.

y is different. It treats the app as malleable software:

- **Chat first.** The default surface is a focused conversation, not an editor clone.
- **Self-modifying.** The Modify rail can edit the live Userland UI while the protected Kernel stays locked.
- **Local agents.** Claude Code and Codex run as official local CLIs with the user's own login.
- **Parallel work.** Chats can use isolated workspaces so agents can work in parallel without stepping on the same files.
- **Diff-gated changes.** UI changes compile, render, show a diff, and can be kept or discarded.
- **Rollback built in.** The app keeps known-good snapshots so broken UI changes can recover.

## How it works

y is split into two parts:

| Layer | What it does |
| --- | --- |
| **Protected Kernel** | Auth, local engine adapters, app state, safety rails, filesystem boundaries, terminal bridge, Modify rail, and rollback runway. |
| **Mutable Userland** | The chat UI and app surface that can be edited live by the user or by Modify. |

This split lets y feel self-modifying without giving the modification agent control over the protected core. The app can change its own interface, but the Kernel still owns the trust boundaries.

## Claude Code and Codex

y runs coding agents locally instead of proxying them through a hosted account.

- **Claude Code** uses the official Claude Code CLI.
- **Codex** uses the official Codex CLI.
- Model and effort settings stay visible in the composer.
- Multiple chats can run against different engines.
- Isolated workspaces let parallel agents work without interfering with each other.

The user's local CLI auth remains the source of truth. y orchestrates the experience; it does not replace the agent providers.

## Download

The latest macOS build is published on GitHub Releases:

<p>
  <a href="https://github.com/y-times-y/y/releases/latest/download/y-0.0.1.dmg">
    <img alt="Download y for macOS" src="https://img.shields.io/badge/Download%20y%20for-macOS-000000?style=for-the-badge&logo=apple&logoColor=white" />
  </a>
</p>

Current release target: **macOS Apple Silicon**.

## Development

```bash
cd app
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm typecheck
pnpm test:ui
```

Build a local macOS bundle:

```bash
pnpm build:mac
```

The generated app artifacts are written to `app/dist/` and are intentionally not committed.

## Privacy and analytics

y keeps the coding workflow local. Project files, terminal commands, and agent prompts are not sent to y's product analytics.

Product analytics are for app usage health: sign-in state, feature usage, feedback, and missing-brick requests. Missing-brick reports are structured and should describe the missing capability, not the user's private prompt or source code.

## Status

y is under active development. The current focus is launch-readiness for macOS: packaging, auth, analytics, local app-state durability, and the self-modifying Modify workflow.

## License

MIT. See [LICENSE](LICENSE).
