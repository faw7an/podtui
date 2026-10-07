# PRD — `podtui` (working name)

A keyboard- and mouse-friendly terminal UI for Podman, in the spirit of lazydocker, designed first for **Omarchy**.

Status: Draft v0.1 · License: MIT (open source) · Target platform: Omarchy / Arch Linux, x86_64 (others later)

---

## 1. Problem

Omarchy ships a Docker TUI (lazydocker). Podman users have no equivalent that is polished, Podman-native and theme-aware:

- lazydocker can talk to Podman through the Docker-compatible socket, but it has no first-class pods or quadlets.
- `podman-tui` exists (Go) but has a different look and feel, and does not follow the Omarchy theme.
- Newer projects (e.g. Dockmate) exist but are young.

Before building, the maintainer should have tried `podman-tui` and lazydocker (with `DOCKER_HOST` pointed at the Podman socket) and confirmed the gap below is real.

## 2. Goal

One screen where a Podman user can see everything running, read logs, inspect config/env/stats, and run common cleanup commands — without remembering CLI flags.

### Success criteria for v1
- Installs as a single binary; launches in under 1 second on a typical machine.
- A user can find a failing container and see its error in red within 3 keypresses.
- Colors follow the active Omarchy theme.
- Works rootless by default (the Omarchy default case).
- No destructive action can run without an explicit confirmation naming what will be removed.

## 3. Users

| User | Needs |
|---|---|
| Omarchy developer running dev databases/services in Podman | quick status, logs, restart, cleanup |
| Homelab user with quadlets (systemd-managed containers) | see quadlet units and their service state next to containers |
| Docker-to-Podman migrant | lazydocker-like muscle memory |
| Contributor | small, readable TypeScript codebase |

## 4. Scope

### In scope for v1
1. **Panels**, each numbered, toggleable (press the number, or click the panel title once mouse support lands):
   1. Pods  2. Containers  3. Images  4. Volumes  5. Networks  6. Quadlets
2. **Detail pane** for the selected item with tabs: **Logs · Stats · Env · Config · Top** (tabs adapt per resource type; e.g. images have Config/Layers).
3. **Logs**: live follow, scrollback, search/filter, error lines red and warnings yellow, timestamps toggle, pause/resume.
4. **Stats**: live CPU, memory, network, block I/O for the selected container.
5. **Env**: environment variables, sorted, with secret-looking values masked until revealed.
6. **Config**: formatted, syntax-colored inspect output (collapsible sections).
7. **Actions** on the selected item: start, stop, restart, kill, remove (with confirm), for pods as well as containers.
8. **Bulk commands menu** (`x`): stop all containers, remove stopped containers, prune images, prune volumes, prune networks, remove all (forced; double confirm). Each shows a preview count before running.
9. **Pods** as first-class: list pods, member containers, pod-level actions.
10. **Quadlets**: list quadlet files (`.container`, `.pod`, `.volume`, `.network`, `.kube`, …), show the generated unit's state via `systemctl --user`, start/stop/restart the unit, view the unit's journal.
11. **Omarchy theming**: read the active theme's colors; fall back to a built-in palette.
12. **Rootless/rootful**: auto-detect the socket; `--socket` override; clear message if the socket is not running, including the command to start it.
13. **Filter** (`/`) in any list; **help** (`?`) overlay listing all keys.
14. **Mouse**: click to focus a panel, select a row, toggle a panel via its title number, switch tabs; scroll wheel in logs.

### Out of scope for v1 (parking lot)
- Docker adapter (post-v1; design for it via the `ContainerEngine` interface).
- Creating/running new containers from a form, building images, compose editing.
- Remote Podman machines / SSH.
- Windows/macOS support.
- Omarchy plugin/menu integration (post-v1, see Roadmap Phase 9).
- Registry search/pull UI (candidate for v1.1).

## 5. Functional requirements

IDs are referenced by the roadmap and tests.

| ID | Requirement |
|---|---|
| FR-1 | On start, discover the Podman socket: `--socket`, `PODTUI_SOCKET` (both explicit: used or fail, never a fallback), then the first working one of `CONTAINER_HOST`, `DOCKER_HOST` (set by podman-docker), `$XDG_RUNTIME_DIR/podman/podman.sock`, `/run/podman/podman.sock`, and podman-docker's `$XDG_RUNTIME_DIR/docker.sock` / `/run/docker.sock` links. `unix://` URIs are accepted. Each candidate must answer `GET /libpod/_ping` (a Docker daemon does not, and is never used). If none works, show a help message listing every candidate with the reason it was rejected and the command to enable the socket (amended 2026-10-08, see DECISIONS). |
| FR-2 | Refresh lists using the event stream when available, with a polling fallback. UI must not flicker on refresh and must keep selection stable by ID. |
| FR-3 | Panels 1–6 toggle with number keys. Hidden panels do not poll or stream. At least one panel must remain visible. |
| FR-4 | The detail pane shows tabs for the selected item. `[` / `]` or clicking switches tabs. Streams start when a tab is shown and stop when hidden. |
| FR-5 | Log lines containing error indicators render red; warnings yellow. Matching rules are configurable constants, unit-tested. ANSI escape codes in the log are preserved or safely stripped (decide in Phase 3, record in DECISIONS.md). |
| FR-6 | Every destructive action opens a confirm dialog listing exactly what will be affected. Default focus is "Cancel". |
| FR-7 | The bulk menu is opened with `x` and navigated with arrows/Enter/Esc. |
| FR-8 | Errors from the API are shown in a status bar or dialog with a readable message; the app does not crash. |
| FR-9 | Colors derive from a theme object; no hard-coded color values in components. |
| FR-10 | Quit with `q` or Ctrl+C restores the terminal (cursor, raw mode, mouse reporting off) in every exit path, including crashes. |
| FR-11 | `--version`, `--help`, `--socket`, `--debug` CLI flags. |

## 6. Non-functional requirements

- **Performance:** handle 200 containers and a log stream of 1,000 lines/second without UI freezes (cap scrollback buffer, e.g. 5,000 lines, configurable).
- **Reliability:** streams reconnect or show "disconnected"; no unbounded memory growth.
- **Portability:** single compiled binary via Bun; no runtime Node/Bun required for end users.
- **Terminal compatibility:** works in Omarchy's default terminal (verify which one in your version) and any modern truecolor terminal; degrade gracefully without mouse support.
- **Code quality:** strict TypeScript, tests for all pure logic, CI on every PR.
- **Open source hygiene:** MIT license, CONTRIBUTING.md, issue templates, README with install instructions and a GIF.

## 7. UX principles

1. Keyboard-first, mouse as an enhancement.
2. Always show the available keys in a footer bar.
3. Color means something: red = error/stopped-unexpectedly, yellow = warning/paused, green = healthy/running, dim = informational.
4. Never make the user wonder whether something is loading, empty, or failed.
5. Confirm destruction, never confirm navigation.

## 8. Keybindings (initial proposal; finalize in Phase 2)

| Key | Action |
|---|---|
| `1`–`6` | toggle panel visibility |
| `Tab` / `Shift+Tab` | move focus between visible panels |
| `↑↓` / `j k` | move selection / scroll |
| `[` `]` | previous/next detail tab |
| `Enter` | focus the detail pane |
| `/` | filter list or search logs |
| `s` `S` | start / stop |
| `r` | restart |
| `d` | remove (confirm) |
| `x` | bulk commands menu |
| `?` | help |
| `q` | quit |

## 9. Open questions (answer before or during the phase noted)

- Which terminal emulator does the target Omarchy version ship, and does it support SGR mouse reporting and truecolor? (Phase 0)
- Where exactly does Omarchy store the active theme palette, and in what format? (Phase 7; the agent must inspect a real install)
- Which Podman major version does the maintainer run, and which API version path will we target? (Phase 0/1)
- Project name and namespace (the working name `podtui` may collide with existing projects). (before Phase 8)

## 10. Risks

| Risk | Mitigation |
|---|---|
| Ink has no native mouse support | Keyboard-first design; isolated `input/mouse.ts` parser, built in Phase 7 with a feature flag |
| `bun build --compile` + Ink issues | Phase 0 spike proves compile before anything else is built |
| Podman API shapes differ between versions | Fixtures from real responses; target the libpod API; document the supported Podman range |
| Dev work destroys real containers | Sandbox Podman, test guards (see AGENTS.md section 3) |
| AI agent hallucinates APIs | AGENTS.md verification rules, fixtures, UNKNOWNS.md, phase gates |
| Log flood freezes UI | Ring buffer, batched rendering (e.g. flush at ≤ 20 fps) |
