# AUDIT — `podtui` (2026-10-02, branch `audit/2026-10-02`)

Independent audit of the `podtui` codebase against `AGENTS.md`, `PRD.md`, `ROADMAP.md`,
`docs/PROJECT_GUIDE.md`, `docs/LAYOUT_SPEC.md`. Method: read the code, ran it
(`bun run check`, `bun run build`, sandbox integration, pty binary smoke test),
re-recorded all fixtures from the live sandbox into `/tmp/audit-fixtures` and
diffed them recursively, and ran 5 mutation checks (each reverted, tree verified
clean). Memory was not used as evidence; every finding cites `file:line`,
command output, or a test name.

**Scoreboard: 11 PASS · 12 PASS-WITH-FIXES · 0 REWRITE · 49 MISSING (of 72).**
Scores are 0–2 per criterion a–i (`—` = not applicable). Verdicts:
PASS = meets acceptance criteria, proven by tests that fail if broken.
PASS-WITH-FIXES = works, specific listed problems. REWRITE = unsalvageable.
MISSING = not implemented (includes all of unstarted phases 3–8).

## Part 1 — Baseline (evidence)

- `bun install`: no changes. `bun run check`: **exit 0, 270 pass / 0 fail**
  (one transient single-test failure was observed once across six full runs and
  did not reproduce; suspected timing flake in the `setTimeout`-based Ink
  tests — worth watching, not yet proven),
  1.65M expects, 13 files (integration skipped without `PODTUI_INTEGRATION=1`).
  `bun run build`: 562 modules, 83 MB binary.
- Toolchain verified: Bun 1.4.2, Podman 6.1.1/API 6.1.1, ink 7.1.1 / react 19.3.0 /
  typescript 5.7.3 installed and equal to pins, satisfying Ink peerDeps
  (`react>=19.2.0`).
- Binary smoke test: piped stdin → Ink "Raw mode is not supported", **exit 0**
  (startup failure with success exit code — see R-03). Under `script` pty with
  delayed `q`: exit 0, real frame rendered, alt-screen `1049h`×1 / `1049l`×1
  (symmetric restore). First paint shows `Pods 0` (async fetch lands after mount).
- Test counts: 235 textual `test()` → 270 run (loop-generated, e.g. size matrix).
  `trivial.test.ts` asserts `1+1=2` (placeholder). `ui-layout.test.tsx` (18 tests)
  covers the superseded `Panel.tsx`, not the current render path.
- Mutations (all caught, all reverted): demux length `+1` → 13 fails;
  `allocatePanelHeights +1` → 16 fails; `panelMetrics` threshold `6→7` → 2 fails;
  `computeColumns` inverted drop order → 2 fails; `windowRows start=0` → 3 fails.
- Smell scan clean: no `any`, no `@ts-ignore`, no `console.*` in `src/`, no
  TODOs, no empty `catch`, no hex outside `theme.ts`, no `fetch(` in `ui/`, no
  react/ink in `api/`/`engine/`, all accumulations bounded.
- Fixture re-record: 18/18 files, file set identical; recursive key diff clean
  (197/197 paths on `container-inspect.json`). Only deltas are volatile sandbox
  data (container count 7 vs 6; `networks-list[0].labels` present in committed,
  absent in fresh — `types.ts:397` models it). Every UI-read field verified
  present in fresh responses. Stats math verified live (`AvgCPU`/`MemPerc` are
  fractions; `mapContainerStats` ×100 is correct).

## Phase 0 verdicts — 6 PASS, 2 PASS-WITH-FIXES

| Task | V | Scores (a b c d e f g h i) | Key evidence |
|---|---|---|---|
| P0-T1 repo init | PASS | 2 2 2 2 — — — — 2 | `LICENSE` exists; `tsconfig.json:7` `strict:true` + `noUncheckedIndexedAccess`; tree matches PROJECT_GUIDE §3 |
| P0-T2 deps | PWF | 1 2 2 2 — — — — 1 | Pins match installed; DECISIONS:12 logs set + TS fix. **Fix R-01:** 5 devDeps unpinned (`^`) |
| P0-T3 scripts | PASS | 2 2 2 2 — — — — 2 | `dev/check/test/build` (+`lint`); `check` exit 0 |
| P0-T4 hello app | PASS | 2 2 2 2 — 1 — — 2 | Commit `67a4325`; header/footer/`q` retained; pty smoke exit 0 |
| P0-T5 compile | PASS | 2 2 2 2 — — — — 2 | Build green twice; `react-devtools-core` hazard handled + logged |
| P0-T6 sandbox | PASS | 2 2 2 2 — — 2 — 2 | `up/down/status/seed` (`dev-sandbox.sh:30,75,92,106`); isolated `--root/--runroot`; seed matches PROJECT_GUIDE §9 incl. `API_TOKEN`; live API confirms all 6 containers labeled `podtui.test=1` |
| P0-T7 ping spike | PASS | 2 2 2 2 — 1 — — 2 | `{unix}` declared `bun-types/globals.d.ts:2031`, used `client.ts:87,151`, `tsc` clean, whole suite runs through it; absorbed into `socket.ts` |
| P0-T8 env report | PWF | 1 1 — — — — — — 2 | Podman/Bun recorded (DECISIONS:16). **Fix R-02:** terminal unnamed, truecolor + SGR mouse "not yet tested" |

## Phase 1 verdicts — 3 PASS, 5 PASS-WITH-FIXES

| Task | V | Scores | Key evidence |
|---|---|---|---|
| P1-T1 socket | PASS | 2 2 2 2 — 2 — — 2 | Order matches FR-1 (`socket.ts:18-27`); typed unreachable + fix; 9 permutation tests |
| P1-T2 client | PWF | 2 2 2 1 1 1 — — 2 | Works. **Fixes R-07/R-10:** `parseJson` empty-body `{} as T` (`client.ts:37`); external abort misreported as timeout (`:109-111`); dead `timeout` option in `streamLines` (`:131-140`); unleaked abort listener; no tests for `request`/streams |
| P1-T3 fixtures | PWF | 2 2 2 — — 2 — — 1 | Recorder works; deep diff clean. **Fix R-09:** `network-inspect.json` never recorded (jq `.Id` vs lowercase `id`); `container-stats.json` is a dead fixture from the unused singular endpoint |
| P1-T4 types | PASS | 2 2 2 2 — 2 — — 2 | Fixture-parsed (`types.test.ts`); nullables modeled; no shape mismatches |
| P1-T5 demux | PASS | 2 2 2 2 2 2 — — 2 | 23 tests incl. split frames; mutation → 13 fails; **verified live** both TTY + non-TTY return `01 00 00 00 <len32>` frames. Note: `isMultiplexedStream` tested but unused in production |
| P1-T6 interface | PWF | 1 2 2 2 1 1 **0** — 2 | Interface complete. **Finding (HIGH): dryRun prune is DESTRUCTIVE** — server ignores the body; **proved live** (seeded `audit-victim`, dryRun call deleted it, server returned `[{Id,Size}]`). P1-T6 preview requirement not met. Also: stream style unrecorded (**fix R-08**) |
| P1-T7 podman impl | PWF | 2 2 2 1 1 1 1 — 1 | Lists/inspect/actions all resources; stats math live-verified. **Fixes:** no abort path on `containerLogs` (**R-05**); `if (never)` stub generator (`:120`); `{Containers:}`-branch untested live |
| P1-T8 integration | PWF | 1 2 2 2 1 1 1 — 2 | 18/18 green; lifecycle, logs, stats, guard covered. **Fixes:** abort test never passes its `AbortController` anywhere (`integration.test.ts:59-61` — `containerLogs` takes no signal); dryRun tests assert shape only and pass while dryRun deletes; `engine.test.ts` is tautological (type literals, local lambda, never touches the impl) (**fix R-06**) |

## Phase 2 verdicts — 2 PASS, 5 PASS-WITH-FIXES, 1 MISSING

| Task | V | Scores | Key evidence |
|---|---|---|---|
| P2-T1 theme | PASS | 2 2 2 2 — 1 — — 2 | All 17 roles incl. `selectionBg/Fg` |
| P2-T2 shell | PWF | 1 2 2 2 1 2 — 2 2 | All present + matrix-verified. **Fix:** no status bar (footer carries errors) |
| P2-T3 toggle | PWF | 1 2 2 2 — 1 1 2 2 | Toggle/titles/last-refusal pass. **Fix R-13:** `fetchAll` fetches all five lists unconditionally — FR-3 "hidden panels do not poll" violated; no call-counter test |
| P2-T4 focus | PASS | 2 2 2 2 — 2 — 2 2 | Tab/Shift+Tab over visible panes, accent border in captures |
| P2-T5 list | PWF | 1 2 1 2 — 1 — 1 2 | Colors + nav work. **Fix R-15:** no `useContainers`, no `/` filter, selection by **index** not ID, no healthy/unhealthy |
| P2-T6 refresh | PWF | 1 1 2 2 1 1 — 1 2 | 5s poll works + cleaned up. **Fix R-14:** interval hardcoded, no event stream (FR-2 stream-first), by-index stability |
| P2-T7 detail tabs | MISSING | 0 — — — — 0 — — — | `activeTab: 0` hardcoded (`build.ts:179`); no switching, no Config/inspect rendering |
| P2-T8 footer/help | PWF | 1 2 2 2 — 2 — — 2 | Footer + priority-drop + errors tested. **Fix R-17:** no `?` overlay |

### LAYOUT_SPEC §9 matrix (criterion h for P2-T2..T4)

4,000-case adversarial sweep (1–400 cols × 1–120 rows × 5 visible-sets × 5 foci ×
4 zooms × fullscreen): **0 violations** of invariants 1 (inside body), 2 (no
overlap), 3 (exact sums + contiguity), 5 (something visible). `renderFrame`
sweep incl. 320×100, 400×120, empty-visible: **ALL EXACT** rows×cols (invariant
4). Invariants 6–8 covered by tested code paths. The layout core is the
strongest part of the codebase.

## Phases 3–8 — all 48 tasks MISSING (verified by grep + empty dirs)

P3 (10): no logLevel/masker/sparkline/ring/search; only engine fetch params,
`LogFrame` type, and static tab labels exist. `src/ui/detail/` empty. P4 (7): no
`s/S/r/K/d` bindings, no `ConfirmDialog`, no cross-links (engine methods exist,
zero UI callers). P5 (6): no `BulkMenu`, no `x`, no prune UI. P6 (6): no
`engine/quadlet.ts`, no `systemctl`/`Bun.spawn` in `src/` (deliberate
placeholder only). P7 (9): `src/input/` + `src/ui/theme/` empty; no omarchy
loader, no mouse. P8 (10): no `src/cli.ts`, no flags, no `.github/`, no
README/CONTRIBUTING/PKGBUILD. Phase 9: ideas only, deferred by design.

## Recommendation: A) KEEP and fix

Against the overhaul triggers: **(i)** 49/72 MISSING looks damning until split —
48 are *unstarted roadmap phases* (no code to be unsalvageable), and of the 24
implemented tasks there are **0 REWRITE** and 1 MISSING (P2-T7). The "broken
code" signal is ~0%. **(ii)** Layering verified clean: no react/ink in
`api/`/`engine/`, no `fetch(` in `ui/`, `ContainerEngine` boundary intact, pure
logic separated and mutation-proven. **(iii)** Phase 0 spike passes end to end.
Overhauling would discard the two strongest assets (engine client + layout
core) to re-earn identical behavior. The correct action is bounded remediation
below, then building phases 3+ on top.

## Remediation plan (ordered; smallest correct change each)

| ID | Item | Files | Effort | Risk | Proving test | Depends |
|---|---|---|---|---|---|---|
| R-04 | **dryRun prune is destructive** — gate `prune*` behind `isSandboxSocket`, or implement a true preview (list stopped/dangling via list-calls, no POST) | `engine/podman.ts`, `test/integration.test.ts` | M | HIGH (safety) | dryRun test seeds a stopped container, asserts it still exists + preview names it | — (blocks all P5 work) |
| R-05 | Abort path for `containerLogs` (accept `AbortSignal`, plumb to `streamLines`, cancel reader) | `engine/podman.ts`, `api/client.ts` | M | med | integration: pass controller, abort mid-stream, assert prompt return | — (blocks P3 tabs) |
| R-12 | Selection by ID (FR-2): store selected id per panel, resolve index at render | `layoutReducer.ts`, `App.tsx`, `view/build.ts` | M | med | reorder/shrink-list test keeps cursor on same id | — (blocks P3) |
| R-13 | Hidden panels don't fetch (gate `fetchAll` on visible set) | `ui/App.tsx` | S | low | mock-engine call-counter test (as P2-T3 requires) | — |
| R-06 | Replace `engine.test.ts` tautologies with behavioral tests (real `isSandboxSocket`, fixture-driven mapper tests) | `test/engine.test.ts` | S | low | tests fail if impl changes | — |
| R-07 | Tests for `request`/`streamLines` (timeout, abort, error mapping); fix timeout message; use-or-remove dead `timeout` option | `api/client.ts`, `test/client.test.ts` | S | low | abort mid-request → `EngineError`, not hang | — |
| R-16 | Detail TabBar + Config inspect-JSON rendering (the 1 MISSING in built work) | `ui/detail/*`, `ui/view/*`, `App.tsx` | M | med | fixture-based render + tab-switch tests | R-12 |
| R-15 | `useContainers` hook (or documented decision), healthy/unhealthy suffix, `/` filter | `ui/`, `App.tsx` | M | low | filter-narrows + selection-preserved tests | R-12 |
| R-17 | `?` help overlay | `ui/`, `App.tsx` | S | low | overlay renders key table; Esc closes | — |
| R-11 | Delete dead `Panel.tsx`/`Box.tsx`; migrate or delete stale `ui-layout.test.tsx` | `ui/panels/`, `ui/components/`, `test/` | S | low | `rg` shows no imports; `check` green | — |
| R-14 | Configurable poll interval + record stream-vs-poll decision (FR-2/P2-T6) | `ui/App.tsx`, `docs/DECISIONS.md` | S | low | env override changes interval in test | R-08 |
| R-10 | `parseJson` empty-body handling (throw or typed empty, not `{} as T`) | `api/client.ts`, `test/client.test.ts` | S | low | empty DELETE body test | — |
| R-08 | Record stream-style decision in DECISIONS.md | `docs/DECISIONS.md` | S | none | entry exists | — |
| R-09 | Fix recorder `network-inspect` (lowercase `id`); remove or justify dead `container-stats.json` | `scripts/record-fixtures.sh`, `test/fixtures/` | S | low | recorder emits the file; suite still green | — |
| R-01 | Pin 5 unpinned devDeps | `package.json` | S | low | no `^` in file; fresh `bun install` identical | — |
| R-02 | Complete P0-T8: terminal name, truecolor gradient, SGR mouse log | `docs/DECISIONS.md` | S | none | entries with outputs | — |
| R-03 | Non-zero exit when raw mode unavailable | `src/index.tsx` | S | low | piped-stdin run exits ≠0 | — |
| R-18 | Verify Ctrl+C restore path (pty test or documented manual) | `test/` or manual | S | low | pty kill test or checklist sign-off | — |

Open UNKNOWNS carried forward: #10–#15 (TTY resize flicker, alt-screen restore
on quit/Ctrl+C, zero-size mid-resize, NO_COLOR behavior, zero-width-panel
fallback semantics, `useWindowSize` zero-reporting).
