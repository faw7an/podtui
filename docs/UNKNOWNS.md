# UNKNOWNS

Questions that must be answered by checking the real system or asking the maintainer. Agents add entries; the maintainer resolves them. Do not code around an unresolved unknown with a guess.

| # | Phase | Question | What was tried | Status |
|---|---|---|---|---|
| 1 | 0 | Which terminal does the target Omarchy ship; truecolor + SGR mouse support? | not yet checked | open |
| 2 | 0 | Podman version in use and API version path to target? | Verified: 6.1.1, `/v5.0.0/libpod/` | resolved |
| 3 | 0 | Does `bun build --compile` work with the chosen Ink version (devtools dependency issue)? | Verified: yes, with react-devtools-core@6.1.2 | resolved |
| 4 | 0 | Does Bun's `fetch` `unix` option behave as expected for streaming responses? | Verified: works for JSON and streaming | resolved |
| 5 | 1 | Are log streams multiplexed for non-TTY and raw for TTY containers? Exact framing? | Verified: both multiplexed, 8-byte header | resolved |
| 6 | 1 | Stats stream format and CPU % calculation inputs | Verified: pre-calculated CPU%, MemUsage/Limit, Network, BlockIO, PIDs | resolved |
| 7 | 6 | Quadlet unit naming per file type; rootful quadlet dir | not yet checked | open |
| 8 | 7 | Where does Omarchy store the active theme palette and in what format? | not yet checked | open |
| 9 | 8 | Project name collisions (GitHub, AUR) | not yet checked | open |
| 10 | 2 | Does Ink 7.1.1 flicker or scroll when the root `height` equals the terminal `rows`? | Source reviewed (`ink.js:749-757` `isFullscreen` suppresses the trailing newline; `shouldClearTerminalForFrame` at `:89-112` special-cases exact-fullscreen frames) and verified in the non-TTY harness (`height=N` → exactly N lines, no trailing newline). **Not verified on a real TTY** — needs the human to drag-resize per LAYOUT_SPEC §10.1 | open |
| 11 | 2 | Does `alternateScreen: true` restore the screen correctly on every exit path (q, Ctrl+C, SIGTERM, crash) with Ink 7.1.1? | Ink performs symmetric `enterAlternativeScreen`/`exitAlternativeScreen` + cursor show/hide (`ink.js:700-712`, `:549-550`) and `interactive` defaults to `!isInCi && isTTY`. **Not verified on a real TTY** — the harness is non-TTY so the alt-screen branch is skipped entirely (`resolveAlternateScreenOption` requires `isTTY`) | open |
| 12 | 2 | Do Ink borders and box-drawing characters render at the exact cell widths assumed by the computed-rect arithmetic on the user's actual terminal/font? | Widths verified only against Ink's own layout maths in the harness (border included in `width`/`height`). Terminal-side cell geometry (font, line-height, ambiguous-width glyphs) is unverified | open |
