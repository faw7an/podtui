# AGENTS.md — Rules for AI agents working on `podtui`

> `podtui` is a working name. A terminal UI for **Podman**, a lazydocker-style tool built for **Omarchy** (Arch Linux).
> Stack: **Bun + TypeScript + Ink (React for terminals)**, compiled with `bun build --compile`.

Read this file fully before every session. Then read `docs/PROJECT_GUIDE.md` and the current phase in `ROADMAP.md`.

---

## 0. Prime directive: do not guess

This project talks to a real Podman daemon and uses fast-moving libraries. Your training data is likely out of date or wrong about exact API shapes, library versions and flags. Therefore:

1. **Never invent** an API endpoint, JSON field, CLI flag, library function, or config key. If you did not see it in a real response, official docs, or installed source code in *this* session, it is unverified.
2. **Verify before using.** Allowed verification methods, in order of preference:
   - Call the real thing against the **sandbox Podman socket** (see section 3) and read the actual JSON. ⚠️ **`curl --unix-socket` does NOT work on this machine** (verified 2026-10-03: the socket is `LISTEN`ing and answers 200 to a raw socket request, but `curl --unix-socket` returns `HTTP:000`; `--noproxy` makes no difference). Use one of these instead:
     - `podman --url unix:///tmp/podtui-dev/podman.sock ...` (CLI; what `scripts/dev-sandbox.sh` uses), or
     - the same path the app itself uses, which is known good:
       ```bash
       timeout 20 bun -e 'const r = await fetch("http://d/_ping", { unix: "/tmp/podtui-dev/podman.sock" } as never); console.log(r.status, await r.text())'
       ```
   - Read installed package source in `node_modules/` and its `package.json` (`peerDependencies`, `exports`).
   - Read official docs (Podman API reference at docs.podman.io, Ink README, Bun docs) via web fetch if available.
3. **Record what you verified.** Save real API responses as fixtures in `test/fixtures/` (trimmed, no secrets). Types in `src/api/types.ts` must be derived from these fixtures, not from memory.
4. **If you cannot verify, say so.** Add an entry to `docs/UNKNOWNS.md` (question, what you tried, what you assumed) and ask the human. Do not silently pick a guess and move on.
5. Prefer "I don't know yet, here is how I'll find out" over a confident but unchecked answer.

## 1. Workflow rules

- Work **one phase at a time** from `ROADMAP.md`. Never start the next phase before the human approves the current gate.
- Work **one task at a time**. Mark the checkbox in `ROADMAP.md` only when the task's acceptance criteria are met and tests pass.
- Before writing code: restate the task, list the files you will touch, and list the facts you still need to verify.
- Run `bun run check` (typecheck + lint + tests) before declaring any task done. Paste the result summary.
- At the end of every phase, **stop** and print the phase's "Manual tests for the human" list. Wait for confirmation.
- Small commits, one task each, message format: `phase-N/task-ID: short description`.
- Record non-obvious choices in `docs/DECISIONS.md` (date, decision, reason).

## 2. Coding rules

- TypeScript `strict: true`. No `any` without a comment explaining why. No `// @ts-ignore`.
- Runtime is **Bun**. Use `Bun.file`, `Bun.spawn`, and `fetch(..., { unix })` where appropriate. Do not add Node-only workarounds without need.
- **Separation of layers** (see PROJECT_GUIDE section 3):
  - `src/api/` and `src/engine/` know about Podman. They never import React or Ink.
  - `src/ui/` knows about Ink. It never calls `fetch` directly; it uses the `ContainerEngine` interface through hooks.
  - Everything the UI needs from the engine goes through the `ContainerEngine` interface (so a Docker adapter can be added later).
- No new dependency without checking: (a) is it needed, (b) maintained, (c) works under `bun build --compile`, (d) license is compatible with MIT. Log it in `docs/DECISIONS.md`.
- Pin dependency versions (no `^` for `ink` and `react`). Check Ink's `peerDependencies` to choose the matching React major version. Do not assume.
- Handle every error path in the UI: show a readable message, never crash with a stack trace on screen unless `--debug` is set.
- Never block the render loop. Streams (logs, stats, events) must be cancellable and cleaned up on unmount/panel hide/quit.
- Keep components small. Pure functions for formatting/parsing (these are the easiest to unit test).

## 3. Safety rules (this tool can delete things)

The app has destructive actions (remove, prune). A bug during development can destroy the human's real containers.

- **During development and tests, only ever connect to the sandbox Podman**, never the human's real one. Start it with `scripts/dev-sandbox.sh` (isolated `--root`/`--runroot`/`--tmpdir` and a file events backend, all under `/tmp/podtui-dev`). Tests that run real prunes/removals use their own throwaway service under `/tmp/podtui-test/` (`test/helpers/throwawayPodman.ts`). The app reads the socket from `--socket <path>` or `PODTUI_SOCKET`; dev scripts must set this.
- Automated tests must **never** call prune/remove against the default socket. Add a guard: if the socket path is not under `/tmp/podtui-dev` or `/tmp/podtui-test`, destructive calls in tests throw.
- Every destructive action in the UI requires a confirmation dialog that names exactly what will be removed (count and names).
- Do not run `podman system reset`, `podman system prune --all`, or `rm -rf` outside `/tmp/podtui-*` for any reason.

## 4. Testing rules

- Test runner: `bun test`. UI tests use `ink-testing-library` (verify it is compatible with the installed Ink version before relying on it).
- Pure logic (log demux, ANSI/level coloring, formatting, theme parsing, socket discovery) must have unit tests written **with** the code.
- Engine tests run against recorded fixtures by default and against the sandbox socket when `PODTUI_INTEGRATION=1`.
- A bug fix starts with a failing test that reproduces it.
- Do not weaken or delete a failing test to make it pass. If a test is wrong, explain why and ask.

## 5. Commands (update this list when scripts change; do not assume others exist)

| Command | Purpose |
|---|---|
| `bun install` | install deps (needs the Bun pinned in `package.json` `packageManager`, currently 1.4.2: `bun.lock` is lockfileVersion 2 and Bun 1.3.x cannot read it) |
| `bun run dev` | run the TUI from source against the sandbox socket |
| `bun run check` | typecheck + lint + unit tests |
| `bun test` | tests only |
| `bun run build` | compile the standalone binary to `dist/podtui` (never loads `.env`/`bunfig.toml` from the working directory) |
| `scripts/build-release.sh <x64\|arm64> [version]` | the release build: compile, smoke-test (set `SMOKE_CONTAINER=1` to also run it in a clean container with no Bun), package `dist/release/podtui-<version>-linux-<arch>.tar.gz`. CI and releases run exactly this |
| `install.sh` | end-user installer (`curl … \| sh`): newest release, checksum-verified, test-run before it replaces anything, into `~/.local/bin`. Tested by `test/install-script.test.ts` |
| `git tag vX.Y.Z && git push origin vX.Y.Z` | publish a GitHub Release (`.github/workflows/release.yml`); the tag must equal `v` + package.json `version` |
| `scripts/dev-sandbox.sh` | start/stop an isolated sandbox Podman + seed containers |

If a script listed here does not exist yet, creating it is part of Phase 0; do not pretend it exists.

## 6. When you are stuck or something contradicts these docs

Stop and ask. Contradictions between `PRD.md`, `ROADMAP.md`, `PROJECT_GUIDE.md` and reality are reported to the human, not resolved silently. Reality (what the real socket returns) wins over memory and over assumptions in these docs, and the docs should then be corrected.

## 7. Definition of done for any task

- [ ] Acceptance criteria in `ROADMAP.md` met
- [ ] Unit tests added/updated and passing
- [ ] `bun run check` passes
- [ ] No unverified API/field/flag used (or logged in `UNKNOWNS.md`)
- [ ] Streams/handles cleaned up
- [ ] Docs updated if behavior or commands changed
