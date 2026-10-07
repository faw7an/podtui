# Project Guide — `podtui`

Technical orientation for humans and AI agents. Read `AGENTS.md` first.

**Legend used below**
- ✅ **Known-good**: stable, widely documented behavior.
- ⚠️ **VERIFY**: believed correct, but must be checked against the real system/library in this repo's environment before relying on it. Log the result in `docs/DECISIONS.md`.

---

## 1. What we are building

A TUI that lets you view and manage Podman resources (pods, containers, images, volumes, networks, quadlets) with logs, stats, env, config and a bulk-actions menu. See `PRD.md` for requirements and `ROADMAP.md` for the build order.

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime / bundler | Bun | `bun build --compile` produces a standalone binary |
| Language | TypeScript (strict) | |
| UI | Ink + React | ⚠️ Ink's `peerDependencies` dictate the React major version. Read them from the installed package; do not assume. |
| Testing | `bun test`, `ink-testing-library` | ⚠️ confirm `ink-testing-library` supports the installed Ink version |
| Podman access | REST over unix socket | `fetch(url, { unix: socketPath })` in Bun ⚠️ verify option name against Bun docs/types for the installed version |
| Quadlet status | `systemctl --user` / `journalctl --user` via `Bun.spawn` | |

## 3. Architecture

```
src/
  index.tsx            entry: parse CLI flags, discover socket, render <App/>
  cli.ts               flag parsing (--socket, --debug, --version, --help)
  api/
    socket.ts          socket discovery + ping
    client.ts          low-level request helper (unix socket), JSON + streaming
    demux.ts           multiplexed log stream decoder (pure, unit-tested)
    types.ts           types derived from test/fixtures/*.json
  engine/
    ContainerEngine.ts interface the UI depends on
    podman.ts          Podman implementation
    quadlet.ts         reads quadlet files + systemctl status
  ui/
    App.tsx            layout + global keys
    state/             hooks and stores (selection, panel visibility, tab)
    panels/            PodsPanel, ContainersPanel, ImagesPanel, VolumesPanel, NetworksPanel, QuadletsPanel
    detail/            LogsTab, StatsTab, EnvTab, ConfigTab, TopTab
    components/        List, TabBar, Footer, ConfirmDialog, BulkMenu, Help, StatusBar, Spinner
  theme/
    theme.ts           Theme type + default palette
    omarchy.ts         loader for the active Omarchy theme
  input/
    keys.ts            key map
    mouse.ts           SGR mouse parser (Phase 7)
  util/
    format.ts          bytes, durations, relative time (pure)
    logLevel.ts        error/warn detection (pure)
test/
  fixtures/            real recorded API responses (trimmed)
  *.test.ts(x)
scripts/
  dev-sandbox.sh       isolated podman service + seed containers
docs/
  PROJECT_GUIDE.md  DECISIONS.md  UNKNOWNS.md
```

### Layering rules
- `api/` and `engine/` must not import `react` or `ink`.
- `ui/` talks only to `ContainerEngine`. This is what makes a Docker adapter possible later.
- All colors come from `Theme`. No literal color strings in components.

### Data flow
1. `ContainerEngine` exposes list/inspect methods returning plain typed objects, plus **streams** as `AsyncIterable` or callback-with-unsubscribe (pick one in Phase 1, record in DECISIONS.md).
2. React hooks (`useContainers`, `useLogs(containerId)`, …) subscribe on mount, unsubscribe on unmount.
3. Hiding a panel or switching a tab unmounts its hook, which cancels its stream.
4. Selection is stored **by ID**, not index, so refreshes do not move the cursor.

## 4. Podman API notes

The Podman service exposes a **libpod-native REST API** and a Docker-compatible one on the same socket. We target the **libpod** one for Podman-specific resources (pods).

### Socket locations
- ✅ Rootless: `$XDG_RUNTIME_DIR/podman/podman.sock`
- ✅ Rootful: `/run/podman/podman.sock`
- ✅ podman-docker (verified from the package file list and the Podman repo): installs `/usr/bin/docker` (`exec podman "$@"`), tmpfiles links `%t/docker.sock -> %t/podman/podman.sock` for system and user, and `/etc/profile.d/podman-docker.sh`, which exports `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock` (rootful socket for root). The `docker` alias does not matter to podtui (it never shells out to `docker`); the socket links and `DOCKER_HOST` do, and discovery covers them.
- ✅ Telling Podman from Docker: `GET /libpod/_ping` is 200 on Podman and 404 on Docker, while `GET /_ping` is 200 on both (verified against Podman 5.8.4 and Docker 29.7.2).
- ✅ Enable rootless socket: `systemctl --user enable --now podman.socket`
- ✅ Run a throwaway service without systemd: `podman system service --time=0 unix:///path/to.sock`

### Endpoints we expect to use ⚠️ VERIFY EACH against the live sandbox socket before coding against it
Base: `http://d/v<apiVersion>/libpod/...` (a version-less `/libpod/...` path may also work; check). Check the official Podman REST API reference (docs.podman.io) for the exact current paths and parameters.

⚠️ **`curl --unix-socket` does not work on this machine** (verified 2026-10-03: returns `HTTP:000` against a socket that a raw connect proves is listening and answering 200). Two methods that do work:

```bash
# CLI (what scripts/dev-sandbox.sh uses)
podman --url unix:///tmp/podtui-dev/podman.sock ps -a

# Raw JSON over the socket — the same path the app uses
timeout 20 bun -e 'const r = await fetch("http://d/_ping", { unix: "/tmp/podtui-dev/podman.sock" } as never); console.log(r.status, await r.text())'
```

| Purpose | Believed endpoint |
|---|---|
| ping / version | `GET /_ping`, `GET /libpod/version` |
| list containers | `GET /libpod/containers/json?all=true` |
| inspect container | `GET /libpod/containers/{id}/json` |
| container logs | `GET /libpod/containers/{id}/logs?stdout=true&stderr=true&follow=true&tail=N&timestamps=true` |
| container stats | `GET /libpod/containers/stats?containers={id}&stream=true` |
| container top | `GET /libpod/containers/{id}/top` |
| start / stop / restart / kill | `POST /libpod/containers/{id}/start|stop|restart|kill` |
| remove | `DELETE /libpod/containers/{id}?force=...` |
| list pods | `GET /libpod/pods/json` |
| pod actions | `POST /libpod/pods/{id}/start|stop|restart|kill`, `DELETE /libpod/pods/{id}` |
| images | `GET /libpod/images/json`, `DELETE /libpod/images/{id}` |
| volumes | `GET /libpod/volumes/json`, `DELETE /libpod/volumes/{name}` |
| networks | `GET /libpod/networks/json`, `DELETE /libpod/networks/{name}` |
| prune | `POST /libpod/containers/prune`, `/libpod/images/prune`, `/libpod/volumes/prune`, `/libpod/networks/prune` |
| events | `GET /libpod/events?stream=true` |

### Streams
- ⚠️ Logs for containers **without a TTY** are typically returned as a *multiplexed* stream: each frame has an 8-byte header (1 byte stream type, 3 zero bytes, 4-byte big-endian payload length) followed by the payload. Containers **with a TTY** return raw bytes. Verify with both kinds of container and implement `api/demux.ts` with unit tests for split frames (a frame header or payload may be split across network chunks).
- ⚠️ Stats and events are streams of JSON objects. Verify whether they are newline-delimited and what the exact field names are, using real output saved as fixtures.

### Data shape rule
Do **not** write `types.ts` from memory. Record real responses to `test/fixtures/` via `scripts/record-fixtures.sh` against the sandbox, then derive types. Fields can be null/absent depending on state; model that.

## 5. Quadlets

- ✅ Quadlet files are systemd-style unit files with Podman-specific sections. Rootless location: `~/.config/containers/systemd/`. Common extensions: `.container`, `.pod`, `.volume`, `.network`, `.kube`, `.image`, `.build`.
- ⚠️ The generated systemd service name follows a naming convention per file type (e.g. `foo.container` → `foo.service`; other types may add a suffix like `-volume` or `-network`). Verify by running `systemctl --user list-units` / `systemctl --user cat <unit>` on a real quadlet in the sandbox. Do not hard-code the mapping until confirmed.
- ⚠️ Some Podman versions also provide quadlet management commands. Check `podman quadlet --help` on the installed version before depending on them; reading files + `systemctl --user` is the baseline.
- After editing quadlet files a `systemctl --user daemon-reload` is needed (⚠️ verify behavior).

## 6. Omarchy integration

- ⚠️ Omarchy keeps the active theme under `~/.config/omarchy/current/theme/` (believed). **The agent must list that directory on a real Omarchy install and report the actual file names and formats** before writing `theme/omarchy.ts`. Likely candidates are a terminal-config file (e.g. Alacritty/Kitty/Ghostty) containing the palette. Do not assume a `colors.toml`.
- Theme changes at runtime: first version re-reads the theme on startup and on `t` (manual reload). Watching the file is a stretch goal.
- Always keep a built-in fallback palette so the app works off Omarchy.
- ⚠️ Which terminal Omarchy ships and its mouse/truecolor support: check, record in DECISIONS.md.

## 7. Ink notes

- ⚠️ Ink v-specific: check the installed version's README for `useInput`, `useStdout`, `useApp`, `Box`, `Text`, `useFocus` APIs and for how to read terminal size and handle resize.
- Ink does **not** provide mouse events. Plan: write `input/mouse.ts` that enables SGR mouse reporting by writing the appropriate DEC private mode sequences to stdout, reads sequences from stdin, parses them into `{x, y, button, type}`, and disables mouse reporting on every exit path. ⚠️ Verify sequences against the xterm control sequences documentation, and confirm Ink's own stdin handling does not swallow or mis-render them.
- Rendering large logs: do not render the entire buffer. Render a window (visible height) of lines from a ring buffer. Throttle state updates.
- Test UI with `ink-testing-library`: assert on `lastFrame()` text for layout, focus, and tab switching; use fixtures for data.

## 8. Build & distribution

- Dev: `bun run dev` (sandbox socket).
- Compile: `bun build --compile src/index.tsx --outfile dist/podtui` ⚠️ verify flags for the installed Bun version.
- ⚠️ Known class of issue: Ink may reference an optional dev-only dependency (`react-devtools-core`) that the bundler tries to resolve and fails on. If `bun build` complains about it, resolve by installing it as a devDependency or marking it external, whichever works; record in DECISIONS.md.
- Distribution plan: GitHub Releases binary, then an AUR `PKGBUILD` (`podtui-bin`), then optional Omarchy integration.

## 9. Dev sandbox (mandatory for development)

`scripts/dev-sandbox.sh` must:
1. Create `/tmp/podtui-dev/{root,run}`.
2. Start `podman --root /tmp/podtui-dev/root --runroot /tmp/podtui-dev/run system service --time=0 unix:///tmp/podtui-dev/podman.sock` in the background (⚠️ verify flags on the installed Podman; rootless Podman may need extra settings such as a custom `--storage-driver`).
3. Seed resources, all labeled `podtui.test=1`:
   - `web` — a long-running container (e.g. nginx or a sleep loop) with env vars including one that looks secret (`API_TOKEN=...`)
   - `chatty` — prints a line every second (log streaming)
   - `failing` — prints `ERROR something broke` and `WARN low disk` lines then exits non-zero
   - `tty-box` — started with a TTY (tests non-multiplexed logs)
   - a pod with two containers
   - a named volume and a custom network
   - a quadlet file in a sandbox config dir (⚠️ quadlets need the real user systemd; seed these only in the manual quadlet test, not in the sandbox script)
4. Provide `down` to stop the service and delete `/tmp/podtui-dev`.

If rootless sandboxing proves impossible on the machine, stop and ask the human; do **not** fall back to the real socket for destructive tests.

## 10. Conventions

- Files: `camelCase.ts`, components `PascalCase.tsx`.
- Named exports, no default exports (except where a tool requires them).
- No barrel files deeper than one level.
- Errors: engine methods throw typed `EngineError { kind: 'unreachable'|'notFound'|'conflict'|'unknown', message }`. UI maps them to messages.
- Time: store timestamps as `Date` or epoch ms internally; format only at the edge.
- Log format helper functions are pure and live in `util/`.

## 11. Glossary

- **Pod**: Podman's group of containers sharing namespaces (similar to a Kubernetes pod).
- **Quadlet**: systemd-integrated way to declare containers/pods/volumes/networks in unit-like files.
- **Rootless**: Podman running as a regular user (default on Omarchy-style setups).
- **libpod API**: Podman's native REST API, as opposed to its Docker-compatible one.
- **Multiplexed stream**: one stream carrying stdout and stderr, framed with headers.

## 12. Companion files the agent must maintain

- `docs/DECISIONS.md` — dated list of decisions and verified facts.
- `docs/UNKNOWNS.md` — questions the agent could not verify; the human resolves them.
