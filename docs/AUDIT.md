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

---

## Part 4 progress (updated 2026-10-03)

Items completed on `audit/2026-10-02`, in the approved order. Each was
verified by a test that fails without the change.

| ID | Item | Status | Proving test |
|---|---|---|---|
| R-00 | Check flake eliminated | done | 30 consecutive `bun run check` green; 15/15 loaded runs (was 30/30 failing) |
| R-04 | Prune previews never destroy | done | `test/prune-safety.test.ts` (7) |
| R-05 | Abortable log streams, read as bytes | done | `test/log-stream.test.ts` (4) |
| R-12 | Selection by item id | done | `test/selection.test.ts` (9) |
| R-13 | Hidden panels do not fetch | done | `test/refresh.test.ts` (7) |
| R-06 | Behavioural engine tests + guard fix | done | `test/engine.test.ts` (23) |
| R-07 | request/stream timeout, abort, errors | done | `test/client-requests.test.ts` (16) |
| R-16 | Detail TabBar + Config inspect | done | `test/detail.test.ts` (14) |
| R-17 | `?` help overlay | done | `test/help.test.ts` (8) |

Suite: **356 pass / 0 fail** with `PODTUI_INTEGRATION=1`; build compiles.

### Bugs found and fixed during Part 4

- `pruneContainers/Images/Volumes/Networks(sock, true)` really pruned
  (server ignores the body). Previews are now list/inspect-only.
- `containerLogs` had no `signal`; aborting timed out after 30s. Now abortable,
  and log payloads are read as bytes instead of via a newline-splitting text
  round-trip.
- Index-based selection jumped to a different item when a refresh removed a row
  above the cursor.
- Hidden panels were still fetched on every tick.
- `isSandboxSocket` used `includes()`, so `/etc/tmp/podtui-dev/...` passed the
  destructive-test guard.
- Every `AbortError` was reported as "Request timeout".
- Streams reported a dead socket as an opaque `unknown` TypeError.
- `StreamOptions.timeout` was declared and never read.
- Two guessed API fields (`NetworkListItem.containers`,
  `NetworkSettings.Networks`) — both caught by `tsc`; neither shipped.

### ROADMAP status after Part 4

Ticked (automated criteria verified): **P2-T1**, **P2-T3**, **P2-T4**.

Still unticked, with the exact gap:

| Task | Remaining gap |
|---|---|
| P2-T2 | Defined as the chrome rows (header-right clock + footer-right error slot) via a LAYOUT_SPEC §3 amendment; no dedicated row by design. Ticked. |
| P2-T5 | Done 2026-10-04: `/` filters the focused list (all six, per-panel queries), healthy/unhealthy suffix from a live-verified mapping, hook deliberately not created (documented). Ticked. |
| P2-T6 | Poll interval is now configurable via `PODTUI_POLL_MS` (R-14), but FR-2's preferred event stream is verified-available and deliberately not adopted yet — the decision record in DECISIONS.md lists exactly what is still unverified |
| P2-T7 | Done 2026-10-04: `Space` folds all sections, `PgUp`/`PgDn` scroll, keys coloured. Ticked. |
| P2-T8 | Done 2026-10-04: base/detail/filter hint contexts derived from UI state, no-drift vs KEYMAP. Ticked. |

Phase 1 boxes stay unticked: the audit verified the work exists, but several
task criteria are still unmet (P1-T2 timeout/abort now covered but the
`{} as T` empty-body case remains; P1-T3 never records `network-inspect.json`;
P1-T7/P1-T8 mapper unit tests and a real
abort assertion are still missing).

## Resume point

**Where to continue:** the hygiene batch, then the roadmap from Phase 3.

Order:

1. **R-11** delete dead `src/ui/panels/Panel.tsx` + `src/ui/components/Box.tsx`
   and migrate or delete the stale `test/ui-layout.test.tsx` (S).
2. **R-10** `parseJson` empty-body handling in `src/api/client.ts` (S).
3. **R-14** configurable poll interval + record the stream-vs-poll decision
   (S) — unblocks ticking P2-T6.
4. **R-01** pin the 5 unpinned devDependencies (S).
5. **R-09** fix `scripts/record-fixtures.sh` so `network-inspect.json` is
   recorded; drop or justify the dead `container-stats.json` (S).
6. **R-03** non-zero exit when raw mode is unavailable (S).
7. ~~**R-18**~~ — satisfied by manual check 5 (see sign-off); only `kill -TERM`
   and crash restore remain, tracked in UNKNOWNS #11.
8. ~~**R-02**~~ — done: Ghostty identified, truecolor smooth by eye, SGR mouse verified from pasted `ESC[<0;84;26M/m` pairs; P0-T8 ticked.
9. **R-08** record the stream-style decision (S).
10. Remaining manual-gated Phase 2 gaps: P2-T2 status bar, P2-T5 filter +
    healthy/unhealthy, P2-T7 collapse/colour keys, P2-T8 context-sensitive
    footer.
11. Then resume the roadmap at **Phase 3 — detail tabs** (P3-T1..T10), which the
    audit confirmed is entirely unstarted.

Do not start Phase 3 work before the maintainer has run the manual checklist and
confirmed the stop-point items below.

---

## Manual sign-off — 2026-10-03

Verdict: **all 11 numbered manual items passed** on the maintainer's real
terminal, driving the app against the sandbox socket
(`/tmp/podtui-dev/podman.sock`). This includes the mid-resize flicker watch that
no automated test can cover.

| # | Check | Result |
|---|---|---|
| 1 | Resize large → tiny → large: no overlap, cut-off rows or leftover cells; centered too-small message | pass |
| 2 | Toggle panels `1`-`6`: expand/shrink immediately; hiding the last visible panel refused | pass |
| 3 | `z` zooms and restores; selection preserved | pass |
| 4 | Narrow (~60 cols): single panel, `Enter` opens detail, `Esc` returns | pass |
| 5 | `q` **and** `Ctrl+C` both restore the screen, cursor and shell echo | pass |
| 6 | Cursor stays on `web` after a container above it is removed (R-12) | pass |
| 7 | Hidden Volumes panel does not update until re-shown (R-13) | pass |
| 8 | `[` `]` cycle the detail tab strip; Config shows State/Config/Host/Network; unimplemented tabs say so (R-16) | pass |
| 9 | `?` overlay lists every binding; `Esc` closes it (R-17) | pass |
| 10 | `API_TOKEN` renders as `********`; the value appears nowhere (R-16) | pass |
| 11 | Rapid resize through tiny sizes: too-small message, no panic (UNKNOWN #15) | pass |

Unknowns closed by these checks: **#10** (Ink fullscreen-frame flicker/scroll),
**#12** (box-drawing cell geometry on the real terminal and font), **#13**
(real-TTY resize flicker / leftover cells), **#14** (alt-screen restore on `q`).

**R-18 is satisfied** by check 5: screen, cursor and echo all restore on
Ctrl+C. Note there is still no explicit SIGINT handler in app code — Ink's
default exit path covers it. `kill -TERM` and crash restore remain unverified
and stay in UNKNOWNS #11.

**No ROADMAP boxes were ticked as a result of this.** P2-T5, P2-T6, P2-T7 and
P2-T8 keep their unticked boxes: the human verified the behaviour that exists,
but their unimplemented criteria (`/` filter, healthy/unhealthy suffix,
configurable poll interval, per-field colouring, context-sensitive footer) are
still missing, so the Phase 2 gate is **not** passed.

---

## Corrections — review 2026-10-08

Two claims above were wrong; both were re-measured live on Podman 5.8.4 and
fixed on branch `fix/review-2026-10-08` (details in DECISIONS.md):

- Part 1 says "`AvgCPU`/`MemPerc` are fractions; `mapContainerStats` ×100 is
  correct". **They are percentages.** `podman stats` showed 123.80% CPU /
  0.11% memory while the API returned `AvgCPU` 123.78 / `MemPerc` 0.105; the
  ×100 is removed (`test/stats.test.ts`).
- R-04 / the 2026-10-03 DECISIONS entry say volume prune removes only
  anonymous volumes. **It removes every volume no container references,
  named ones included** (preview said 1, prune removed 3). All four prune
  previews were rebuilt from the Podman source and are now proved against
  the real prune (`test/prune-contract.test.ts`).

ROADMAP after the review: P0-T1..T8 and P1-T1..T8 ticked (criteria met,
tests green incl. integration). P2-T6 stays open (FR-2 prefers the event
stream, which is verified available but not adopted). The Phase 1 and
Phase 2 **gates** still need the maintainer's manual tests.

