# ROADMAP — `podtui`

How to use this file (humans and agents):
- Phases run **in order**. Each ends with a **Gate**: the agent stops, reports, and the human runs the manual tests.
- Tasks have IDs (`P2-T3`). Tick the box only when acceptance criteria are met and `bun run check` passes.
- "Automated tests" are written by the agent. "Manual tests for the human" are run by the maintainer; the agent prints the list at the gate and waits.
- Anything marked ⚠️ VERIFY must be checked against the real system first (see `AGENTS.md` section 0).

Phase overview

| Phase | Name | Outcome |
|---|---|---|
| 0 | Bootstrap & feasibility spike | Compiled hello-world TUI; sandbox Podman works |
| 1 | Podman client | Verified API access with fixtures and tests |
| 2 | UI shell | Layout, numbered toggling panels, containers list, Config tab |
| 3 | Detail tabs | Logs, Env, Stats, Top with red errors |
| 4 | Remaining resources & actions | Pods, images, volumes, networks, start/stop/remove |
| 5 | Bulk commands | `x` menu, previews, confirmations, prune |
| 6 | Quadlets | Quadlet list, unit state, journal, actions |
| 7 | Theme & mouse | Omarchy colors, click support |
| 8 | Polish & release | Help, errors, CI, packaging, docs |
| 9 | Post-v1 | Docker adapter, Omarchy plugin, extras |

---

## Phase 0 — Bootstrap & feasibility spike

**Goal:** prove the toolchain works end to end before building features.

- [x] **P0-T1** Initialize repo: `package.json`, `tsconfig.json` (strict), `.gitignore`, MIT `LICENSE`, empty folder structure from PROJECT_GUIDE section 3, copy `AGENTS.md`, `PRD.md`, `ROADMAP.md`, `docs/*`.
- [x] **P0-T2** Install Bun-compatible deps: `ink`, `react` (version matching Ink's peerDependencies ⚠️ VERIFY), `typescript`, `@types/react`, `ink-testing-library`. Pin versions. Log them in DECISIONS.md.
- [x] **P0-T3** Scripts in `package.json`: `dev`, `check`, `test`, `build` (see AGENTS.md section 5).
- [x] **P0-T4** Hello-world Ink app: header, a box, a footer, exits cleanly on `q`.
- [x] **P0-T5** Compile it with `bun build --compile` and run the binary. Resolve any bundling errors (⚠️ e.g. optional devtools dependency); log the fix.
- [x] **P0-T6** `scripts/dev-sandbox.sh` with `up` / `down` / `status`. Seed resources listed in PROJECT_GUIDE section 9 (except quadlets).
- [x] **P0-T7** Socket ping spike: a tiny script that pings the sandbox socket using Bun's unix-socket fetch and prints the Podman version. ⚠️ VERIFY the fetch option and the endpoint.
- [x] **P0-T8** Environment report in `docs/DECISIONS.md`: Podman version, Bun version, terminal emulator in use, truecolor and mouse-reporting support (test by printing a color gradient and logging raw mouse sequences).

**Automated tests:** `bun run check` passes with one trivial test; CI-ready script exits 0.

**Manual tests for the human**
1. `./scripts/dev-sandbox.sh up` then `podman --url unix:///tmp/podtui-dev/podman.sock ps -a` shows the seeded containers and your normal `podman ps` does **not** show them (isolation check).
2. `bun run dev` shows the hello screen; press `q`; terminal is restored (cursor visible, typing echoes).
3. Run `dist/podtui` on the same machine: same behavior.
4. Resize the terminal while it runs: no crash.

**Gate:** compiled binary runs; sandbox is isolated; environment report written. If compile fails and cannot be fixed, stop and reconsider the stack (see PRD risks).

---

## Phase 1 — Podman client

**Goal:** a typed, tested engine layer. No UI work in this phase.

- [x] **P1-T1** `api/socket.ts`: discovery order per FR-1; returns path or a typed "unreachable" result containing the suggested fix command. Unit tests with env var and temp-file permutations.
- [x] **P1-T2** `api/client.ts`: `get`, `post`, `delete` helpers over the unix socket with JSON parsing, timeouts, and error mapping to `EngineError`. Streaming helper that yields chunks and supports abort.
- [x] **P1-T3** `scripts/record-fixtures.sh`: save real responses (list/inspect containers, pods, images, volumes, networks, top, a short stats sample, version) from the sandbox into `test/fixtures/`. Trim volatile fields only if documented.
- [x] **P1-T4** `api/types.ts`: types derived from the fixtures. Fields that can be missing/null are modeled as such. Add a test that parses every fixture through the mappers without throwing.
- [x] **P1-T5** `api/demux.ts`: multiplexed log frame decoder. Unit tests: single frame, multiple frames in one chunk, header split across chunks, payload split across chunks, zero-length frame, stderr vs stdout tagging. ⚠️ VERIFY framing against a real non-TTY container's log response; verify TTY containers return raw data.
- [x] **P1-T6** `engine/ContainerEngine.ts` interface: list/inspect for each resource, `streamLogs`, `streamStats`, `streamEvents`, `top`, actions (start/stop/restart/kill/remove), prune methods with a **dry-run/preview** function returning what would be removed. Decide stream style (AsyncIterable vs callback) and record in DECISIONS.md.
- [x] **P1-T7** `engine/podman.ts`: implement list/inspect/top/actions for containers and pods first; map raw API objects to UI-facing models (`Container`, `Pod`, …) in dedicated mapper functions (pure, tested against fixtures).
- [x] **P1-T8** Integration tests (run only with `PODTUI_INTEGRATION=1` against the sandbox): start/stop/restart `web`, stream logs from `chatty` for 3 lines then abort cleanly, confirm the stream handle is released. Destructive-call guard from AGENTS.md section 3 implemented and tested.

**Automated tests:** all above unit tests green; integration tests green against sandbox.

**Manual tests for the human**
1. Run the fixture recorder; open 2–3 fixture files and sanity-check they look like real data from your machine.
2. Run the integration suite; afterwards confirm with `podman ps -a` (default socket) that nothing of yours changed.
3. Stop the sandbox mid-test; confirm the app/engine reports "unreachable" instead of hanging.

**Gate:** engine layer green; fixtures committed; UNKNOWNS.md contains no unresolved Phase 1 items.

---

## Phase 2 — UI shell

**Goal:** the lazydocker-like frame with numbered, toggleable panels.

- [x] **P2-T1** `theme/theme.ts`: `Theme` type + default palette (semantic colors: ok, warn, error, dim, accent, border, selectionBg, selectionFg).
- [x] **P2-T2** Layout: left column of panels, right detail pane, footer key hints, status bar. Handles terminal resize and a minimum size message ("terminal too small").
- [x] **P2-T3** Panel visibility: `1`–`6` toggle (FR-3). Each panel title shows its number, e.g. `[2] Containers`. At least one visible panel enforced. Hidden panels do not fetch or poll (assert in a test via a mock engine call counter).
- [x] **P2-T4** Focus: `Tab`/`Shift+Tab` cycles visible panels; focused panel has a highlighted border.
- [x] **P2-T5** `useContainers` hook + Containers panel: list with state color (running green, exited red/dim, paused yellow), healthy/unhealthy suffix, selection by ID, `↑↓`/`j k`, `/` filter.
- [ ] **P2-T6** Refresh strategy (FR-2): event stream if verified, else polling at a configurable interval; no flicker; selection stable.
- [x] **P2-T7** Detail pane with `TabBar`; Config tab renders formatted inspect JSON: key/value with colors, collapsible sections, scrollable.
- [x] **P2-T8** Footer shows context-sensitive key hints. `?` opens a help overlay (can be minimal now).

**Automated tests (ink-testing-library + mock engine):** toggling hides/shows panels; focus order skips hidden panels; selection survives a list refresh that reorders items; filter narrows list; Config tab renders fixture data without crashing; tiny terminal shows the size message.

**Manual tests for the human**
1. Launch against the sandbox. Press `2`, `1`, `3`... panels hide/show; try hiding all (the last one must refuse).
2. Select `failing` (exited) — it appears red/dim; `web` appears green.
3. In another terminal run `podman --url unix:///tmp/podtui-dev/podman.sock stop web`; the UI updates within the refresh interval without the cursor jumping.
4. Press `/`, type `ch`; only `chatty` remains; `Esc` clears.
5. Switch to the Config tab; scroll long output; collapse/expand a section.
6. Quit with `q` and with Ctrl+C: the terminal is clean both times.

**Gate:** all manual tests pass; screenshots saved to `docs/screenshots/phase2/`.

---

## Phase 3 — Detail tabs: Logs, Env, Stats, Top

**Goal:** the features you actually open the tool for.

- [x] **P3-T1** `util/logLevel.ts`: pure function classifying a line as `error | warn | info | debug | unknown` (rules documented in the file, e.g. keywords `ERROR`, `FATAL`, `panic`, `Exception`, `level=error`, JSON `"level":"error"`). Table-driven unit tests, including false-positive cases (e.g. a word like "terror").
- [x] **P3-T2** Logs tab: follow mode, ring buffer (default 5,000 lines), windowed rendering, throttled updates (≤ ~20 fps), pause/resume key, scroll with `↑↓`/`PgUp`/`PgDn`/`g`/`G`, "new lines below" indicator when scrolled up.
- [x] **P3-T3** Log coloring: error lines red, warn lines yellow, timestamps dim; stderr vs stdout indicator optional. Decide and record how raw ANSI codes in logs are handled (strip vs pass-through) (FR-5).
- [x] **P3-T4** Log search: `/` search with highlight, `n`/`N` next/previous match; level filter toggle (`e` = errors only).
- [x] **P3-T5** Timestamps toggle (`t`) and line wrap toggle (`w`).
- [x] **P3-T6** Env tab: sorted key/value; names plain, values colored; masks values whose key matches secret-like patterns (`TOKEN`, `SECRET`, `PASSWORD`, `KEY`) until `v` reveals; unit-tested masker.
- [x] **P3-T7** Stats tab: live CPU %, memory used/limit, network rx/tx, block I/O, PIDs; small sparkline history (last ~60 samples). ⚠️ VERIFY field names and how CPU % must be computed from the stats samples; unit-test the calculation with fixture samples.
- [x] **P3-T8** Top tab: process table from `top`; column alignment; refresh interval.
- [ ] **P3-T9** Stream lifecycle: switching tab, selection, hiding the panel, or quitting aborts the stream. Test with a mock engine that tracks open/close counts.
- [ ] **P3-T10** Empty/error states: no logs yet, container not running (stats/top show a friendly message), stream disconnected.

**Automated tests:** logLevel table tests; masker tests; stats math tests; log buffer ring tests (overflow drops oldest, memory bounded); stream open/close counter test; Logs tab snapshot with red line present.

**Manual tests for the human**
1. Select `chatty`, Logs tab: lines flow smoothly. Press pause; flow stops; resume; catches up. Scroll up; "new lines below" appears.
2. Select `failing`: `ERROR` line is **red**, `WARN` line is **yellow**. Toggle errors-only (`e`).
3. Search for a word; matches highlight; `n` jumps.
4. `tty-box`: logs show correctly (non-multiplexed).
5. Env tab on `web`: `API_TOKEN` masked; `v` reveals.
6. Stats tab on a busy container (run `podman --url ... exec web sh -c 'yes > /dev/null'` for a few seconds): CPU rises; stop it and CPU falls. Compare numbers with `podman stats --no-stream` against the sandbox (rough agreement).
7. Rapidly switch between containers 20 times: no crash, no memory ballooning (watch with `top`/`btop`).
8. Stop the selected container while viewing logs: UI shows ended/disconnected state, not a hang.

**Gate:** manual tests pass; performance sanity: flood test (a container printing ~1,000 lines/s) does not freeze keyboard response.

---

## Phase 4 — Remaining resources & actions

**Goal:** panels 1, 3, 4, 5 and per-item actions.

- [ ] **P4-T1** Pods panel: name, status, container count, infra info. Selecting a pod shows Config and a member-container list; pod actions start/stop/restart/kill/remove.
- [ ] **P4-T2** Images panel: repo:tag, size, age, dangling marker; Config tab; layers/history view ⚠️ VERIFY the history endpoint; remove action.
- [ ] **P4-T3** Volumes panel: name, driver, mountpoint, in-use indicator ⚠️ VERIFY how "in use" is determined; remove action.
- [ ] **P4-T4** Networks panel: name, driver, subnet, connected containers; remove action.
- [ ] **P4-T5** Container actions: `s` start, `S` stop, `r` restart, `K` kill, `d` remove, all via engine; busy indicator while pending; errors surface in the status bar.
- [ ] **P4-T6** `ConfirmDialog` component: lists exactly what will be affected, default focus on Cancel, `y`/`n`/Enter/Esc (FR-6). Used by every remove action.
- [ ] **P4-T7** Cross-links: from a pod, jump to its containers; from a container, show its pod/image/volumes/networks as read-only info in Config.

**Automated tests:** each action calls the right engine method with the right ID; confirm dialog blocks the call until confirmed; cancel does nothing; error from engine shows a message and the app stays alive; panels render fixture data.

**Manual tests for the human**
1. Pod: stop and start the sandbox pod from the UI; verify with `podman --url ... pod ps`.
2. Try to remove a running container: the dialog states it; confirm; behavior matches what Podman allows (error or forced, as designed) — no crash.
3. Remove an unused volume; try a volume in use: sensible message.
4. Image panel sorts/filters sensibly; remove an unused image.
5. Press `Esc` in every dialog: nothing destructive happens.

**Gate:** all panels 1–5 functional; confirm dialogs verified manually.

---

## Phase 5 — Bulk commands menu

**Goal:** the `x` menu from the original mock.

- [ ] **P5-T1** `BulkMenu` component: modal list navigated with arrows, `Enter` to select, `Esc` to close; footer shows keys.
- [ ] **P5-T2** Commands: stop all containers; remove stopped containers; prune dangling images; prune unused volumes; prune unused networks; remove all containers (forced). Each is defined in a data table (id, label, risk level, preview function, execute function).
- [ ] **P5-T3** Preview step: before executing, call the engine's preview function and show "This will remove N items: …" (first 10 names + "and M more"). If N = 0 show "Nothing to do".
- [ ] **P5-T4** Risk levels: low = single confirm; high ("remove all containers", forced) = type the word `delete` to confirm.
- [ ] **P5-T5** Progress and result summary: "Removed 3 containers, reclaimed 120 MB" (⚠️ VERIFY what the prune responses actually return); partial failures listed.
- [ ] **P5-T6** Context-aware entries: the menu can show panel-specific commands first (e.g. on the Volumes panel, "prune volumes" first).

**Automated tests:** preview counts match mock engine data; high-risk flow requires the typed word; Esc at any stage aborts without calling execute; partial-failure rendering.

**Manual tests for the human** (sandbox only!)
1. `x` → "remove stopped containers": preview lists exactly the exited ones (compare with `podman --url ... ps -a --filter status=exited`). Confirm; they disappear.
2. Re-seed with `scripts/dev-sandbox.sh seed`; run prune images/volumes/networks and compare counts with the CLI equivalents.
3. "Remove all (forced)": typing anything but `delete` does nothing.
4. Confirm your **real** Podman resources are untouched.

**Gate:** destructive flows verified; guard rails confirmed.

---

## Phase 6 — Quadlets

**Goal:** panel 6.

- [ ] **P6-T1** `engine/quadlet.ts`: read quadlet directory (rootless default; rootful path ⚠️ VERIFY), parse file type and name; list with type icon/label.
- [ ] **P6-T2** Unit mapping: determine each quadlet's systemd unit name and state via `systemctl --user` ⚠️ VERIFY naming rules by testing each file type; unit-test the mapping with real examples.
- [ ] **P6-T3** Detail tabs: **File** (raw quadlet content, syntax-colored sections), **Unit** (`systemctl --user cat/status`), **Journal** (`journalctl --user -u <unit> -f`, streamed, same coloring as Logs).
- [ ] **P6-T4** Actions: start/stop/restart unit; "reload systemd" (daemon-reload) with a clear label. Confirm for stop/restart of running units.
- [ ] **P6-T5** Link quadlet → container (if the container is running, offer to jump to it).
- [ ] **P6-T6** Graceful behavior when systemd user session or the quadlet dir does not exist (friendly empty state, explains where quadlets live).

**Automated tests:** parser tests on sample quadlet files of each type; mapping tests; mock `Bun.spawn` for systemctl/journalctl; empty-state rendering.

**Manual tests for the human** (uses your real user systemd — be careful)
1. Create a harmless test quadlet (e.g. a `hello.container` running a sleep) in `~/.config/containers/systemd/`, run `systemctl --user daemon-reload`.
2. It appears in panel 6 with the right state; start it from the UI; verify with `systemctl --user status`.
3. Journal tab shows live output; errors red.
4. Stop and delete it; remove the file; confirm the UI reflects it.

**Gate:** quadlet flow works on a real Omarchy session; test quadlet removed afterward.

---

## Phase 7 — Omarchy theme & mouse

**Goal:** make it feel native; make clicking work.

### Theme
- [ ] **P7-T1** Inspect `~/.config/omarchy/current/theme/` on a real install; write the findings (file names, formats, sample content) into DECISIONS.md. ⚠️ Do not write the loader before this is done.
- [ ] **P7-T2** `theme/omarchy.ts`: parse the discovered palette format into `Theme`; unit tests using copies of real theme files saved as fixtures (at least 2 different Omarchy themes).
- [ ] **P7-T3** Map palette colors to semantic roles (error→red, ok→green, warn→yellow, accent, border, selection) with sensible contrast; fallback to default if any role is missing.
- [ ] **P7-T4** Reload on `T` (and on startup). Stretch: watch the theme path for changes.
- [ ] **P7-T5** Truecolor vs 256-color degradation.

### Mouse
- [ ] **P7-T6** `input/mouse.ts`: enable SGR mouse reporting, parse press/release/wheel/motion events into typed events, disable on all exit paths (normal quit, Ctrl+C, uncaught exception, SIGTERM). Unit tests with raw sequence samples. ⚠️ VERIFY sequences in xterm control docs and against your terminal's real output.
- [ ] **P7-T7** Hit-testing: components register their screen rectangles; clicks resolve to `{panelId, rowIndex}` / tab / title-number. Handle terminal resize.
- [ ] **P7-T8** Click actions: panel title number toggles; row click selects; tab click switches; wheel scrolls logs/lists; click outside a modal does nothing.
- [ ] **P7-T9** `--no-mouse` flag and graceful behavior if stdin sequences are not supported.

**Automated tests:** theme parsing fixtures; semantic mapping tests; mouse parser table tests; hit-test geometry tests; cleanup-on-exit test (mock stdout records the disable sequence).

**Manual tests for the human**
1. Switch Omarchy theme (via Omarchy's theme menu), press `T` in the app: colors change to match; try 3 themes including a light one if available; errors remain readable (red on the background).
2. Click panel title `[3]` to hide/show; click rows; click tabs; scroll wheel in logs.
3. Quit by Ctrl+C then by `q` then by `kill` from another terminal: after each, mouse works normally in the shell (no garbage characters on click).
4. Run with `--no-mouse`.

**Gate:** native look verified on at least 3 themes; mouse cleanup verified.

---

## Phase 8 — Polish & release

- [ ] **P8-T1** CLI: `--help`, `--version`, `--socket`, `--debug` (writes a log file; never prints stack traces over the UI otherwise) (FR-11).
- [ ] **P8-T2** Complete `?` help overlay generated from the same key map used by the app (single source of truth, tested).
- [ ] **P8-T3** First-run experience: if the socket is not running, full-screen guide with exact commands (`systemctl --user enable --now podman.socket`) and a retry key.
- [ ] **P8-T4** Config file (optional): `~/.config/podtui/config.toml|json` for refresh interval, log buffer size, log-level rules, default tab. ⚠️ choose a format, record in DECISIONS.md.
- [ ] **P8-T5** Performance pass: profile with 200 containers (script to create them in the sandbox) and the log flood test; fix hot spots.
- [ ] **P8-T6** Accessibility/readability: never rely on color alone (state words accompany colors).
- [x] **P8-T7** CI (GitHub Actions): install Bun, `bun run check`, build binary, upload artifact. Integration tests optional/manual.
- [ ] **P8-T8** Packaging: GitHub Release binary; `PKGBUILD` for AUR (`podtui-bin`) ⚠️ verify AUR packaging guidelines; checksums.
- [ ] **P8-T9** Docs: README (what, install, usage, key table, screenshots/GIF), CONTRIBUTING.md (sandbox workflow, AGENTS.md note for AI-assisted PRs), issue/PR templates, CODE_OF_CONDUCT, SECURITY.md.
- [ ] **P8-T10** Name check: search GitHub/AUR for collisions; finalize name; rename across repo.

**Manual tests for the human**
1. Fresh machine/VM (or clean user): install the released binary, run with socket disabled: guide appears; follow it; app works.
2. Full smoke test: every key in the help overlay does what it says.
3. Run for 30 minutes with a log flood: memory stable.
4. Another person (friend/community) installs from the README only, without your help, and reports friction.

**Gate:** v1.0.0 tag.

---

## Phase 9 — Post-v1 ideas (do not start without a new PRD section)

- Docker adapter implementing `ContainerEngine`.
- macOS support: discover the `podman machine` API socket (and podman-mac-helper's `/var/run/docker.sock`), darwin release binary. ⚠️ VERIFY on a real Mac first, see UNKNOWNS #18. Development and the sandbox stay Linux-only.
- Omarchy plugin / launcher binding (e.g. a menu entry and keybinding) — ⚠️ research Omarchy's extension points first.
- Registry search & image pull; run-container form; `podman-compose` project grouping; healthcheck history; image vulnerability scan summary; export logs to file; multi-select for bulk delete; remote machines.

---

## Master manual checklist (before each release)

- [ ] Sandbox isolation intact; real Podman untouched by dev/test runs
- [ ] Rootless works; rootful works with `--socket`
- [ ] Every destructive action confirms and names its targets
- [ ] Red errors visible in logs on at least 3 Omarchy themes
- [ ] Terminal fully restored after quit, Ctrl+C, SIGTERM, crash
- [ ] Resize mid-stream does not corrupt the layout
- [ ] Socket disappears mid-run: app shows disconnected, recovers when it returns
- [ ] 200 containers: scrolling and filtering stay responsive
- [ ] Binary runs on a machine without Bun installed
