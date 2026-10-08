# podtui

[![CI](https://github.com/faw7an/podtui/actions/workflows/ci.yml/badge.svg)](https://github.com/faw7an/podtui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A fast, keyboard-driven terminal UI for [Podman](https://podman.io)**, in the spirit of
[lazydocker](https://github.com/jesseduffield/lazydocker), built first for
[Omarchy](https://omarchy.org) and Arch Linux.

One screen shows your pods, containers, images, volumes and networks, with details for whatever
you select. You don't need to remember a single `podman` flag.

```
▲ podtui   1 Pods  2 Containers  3 Images  4 Volumes  5 Networks  6 Quadlets
╭─[1] Pods 1                           ╮╭─[2] Containers 7                     ╮
│  NAME                   STATUS    CNT││  NAME         STATUS    IMAGE    AGE │
│▸ web-pod                ● running 3  ││▸ web          ● running nginx:a… now │
│                                      ││  chatty       ● running alpine:… now │
│                                      ││  failing      ✖ exited  alpine:… now │
│                                      ││  tty-box      ● running alpine:… now │
│                                      ││  8983d20a0f1… ● running          now │
│                                      ││  web-pod-fro… ● running nginx:a… now │
└──────────────────────────────────────┘└───────────────────────────── ↓1 more ┘
▸ 3 Images (2)                          ▸ 4 Volumes (1)
▸ 5 Networks (2)                        ▸ 6 Quadlets (0)
╭─web · running                                                                ╮
│Logs Stats Env Config Top                                                     │
│# State                                                                       │
│Name         web                                                              │
│Status       running                                                          │
│Running      true                                                             │
│ExitCode     0                                                                │
│StartedAt    2026-10-08T03:04:39.174299269+03:00                              │
│# Config                                                                      │
│Image        docker.io/library/nginx:alpine                                   │
└──────────────────────────────────────────────────────────────────── ↓12 more ┘
1-6 panel  Tab focus  ↑↓jk move  Enter inspect  z zoom  ? help  q quit
```
<sub>A real 80×24 frame, captured from a running Podman with `scripts/capture-after.tsx`. In a
terminal it is in colour: running is green, exited is red.</sub>

---

## Why podtui?

Podman is the default container engine on many Linux systems, but its terminal tooling lags behind
Docker's:

- **lazydocker** can talk to Podman through the Docker-compatible socket, but it doesn't understand
  **pods** or **quadlets** (systemd-managed containers).
- **podman-tui** exists, but it looks and feels different and doesn't follow your desktop theme.
- The `podman` CLI is powerful but verbose. Finding *which* container failed and *why* usually
  takes several commands.

podtui is **Podman-native**. It speaks Podman's own API (libpod), so pods and quadlets are
first-class citizens. It is designed so that:

- you can find a failing container and see its error **within three keypresses**,
- it runs **rootless** by default (the normal Podman setup),
- nothing destructive ever happens without a confirmation that **names exactly what will be
  removed**,
- its colours will follow your Omarchy theme (planned).

## Status

podtui is in **early development (v0.x)**. It lists and inspects everything, and can start,
stop, restart, kill and remove containers and pods and remove images, volumes and networks.
Every remove and kill asks first and names exactly what it affects; images, volumes and
networks are never force-removed.

| Works today | Coming next |
|---|---|
| Six numbered panels (pods, containers, images, volumes, networks, quadlets), each can be shown or hidden | |
| **Quadlets**: unit state from systemd, the file, the generated unit, live journal; start / stop / restart, reload systemd | |
| Live refresh (every 5 s by default) that keeps your cursor on the same item | |
| Follows your **Omarchy theme** live (`T` reloads); readable status colours on light and dark themes; 256-colour fallback | |
| Container **Config** tab: formatted inspect output, foldable sections | Mouse support |
| Container **Logs** tab: live follow, pause, search, errors red / warnings yellow, errors-only, timestamps, wrap | |
| Pod (members), image (history, users), volume (users) and network (subnets, members) detail views | |
| **Stats** (live CPU with a 1-minute sparkline, memory, net, block, PIDs), **Env** (secrets masked until `v`) and **Top** (process list, every 2 s) tabs | |
| `/` filter in every list, `?` help overlay, `z` zoom |  |
| Start / stop / restart / kill / remove with confirm dialogs that name every target |  |
| Bulk menu (`x`): stop all, prune containers/images/volumes/networks, remove all — each previews exactly what it touches |  |
| Adapts to any terminal size, from 40×10 up |  |
| Works with **podman-docker** setups, and never connects to a Docker daemon by mistake |  |

The full plan is in [ROADMAP.md](ROADMAP.md).

---

## Requirements

- **Linux** on **x86_64** or **arm64**, with glibc. That covers Arch, Fedora, Debian, Ubuntu and
  most others. musl-based distributions such as Alpine are not supported yet, and the installer
  tells you if you're on one.
- **Podman**, with its **API socket** running (see [Set up Podman](#set-up-podman)).
- A terminal at least **40×10**. A truecolor terminal looks best (Ghostty, Kitty, Alacritty,
  WezTerm, GNOME Terminal, …).

You do **not** need Bun or Node.js: the release binary is self-contained.

## Install

### Quick install (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/faw7an/podtui/main/install.sh | sh
```

The script:

1. picks the right binary for your CPU (x86_64 or arm64),
2. downloads it from the newest [GitHub Release](https://github.com/faw7an/podtui/releases)
   (pre-releases included, so v0.x versions work),
3. **verifies its SHA256 checksum**, and installs nothing if it doesn't match,
4. checks that the binary actually runs on your system,
5. installs it to `~/.local/bin/podtui` (no `sudo`), replacing an older version atomically.

It's a short, readable POSIX shell script; [read it first](install.sh) if you prefer. Options:

```sh
# a specific version
curl -fsSL https://raw.githubusercontent.com/faw7an/podtui/main/install.sh | PODTUI_VERSION=0.1.0 sh

# a different directory
curl -fsSL https://raw.githubusercontent.com/faw7an/podtui/main/install.sh | PODTUI_INSTALL_DIR=/usr/local/bin sh
```

If `~/.local/bin` is not on your `PATH`, the installer tells you what to add.

### Manual download

Each [release](https://github.com/faw7an/podtui/releases) has `podtui-<version>-linux-x64.tar.gz`,
`podtui-<version>-linux-arm64.tar.gz` and a `SHA256SUMS` file:

```sh
VERSION=0.1.0 ARCH=x64          # or ARCH=arm64
curl -fLO https://github.com/faw7an/podtui/releases/download/v$VERSION/podtui-$VERSION-linux-$ARCH.tar.gz
curl -fLO https://github.com/faw7an/podtui/releases/download/v$VERSION/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf podtui-$VERSION-linux-$ARCH.tar.gz
install -m 755 podtui-$VERSION-linux-$ARCH/podtui ~/.local/bin/podtui
```

### From source

Requires [Bun](https://bun.sh) **1.4.2** (the version pinned in `package.json`; older Bun can't
read the lockfile).

```sh
git clone https://github.com/faw7an/podtui.git
cd podtui
bun install
bun run build          # → dist/podtui
```

### Update and uninstall

Run the installer again to update. To uninstall, delete the binary:

```sh
rm ~/.local/bin/podtui
```

podtui writes no config or cache files.

---

## Set up Podman

podtui talks to Podman's REST API over a unix socket. For a normal (rootless) setup, turn the
socket on once:

```sh
systemctl --user enable --now podman.socket
```

Then just run:

```sh
podtui
```

For **rootful** Podman (`sudo podman …`), the socket is `/run/podman/podman.sock`. Enable it with
`sudo systemctl enable --now podman.socket` and run `sudo podtui`, or point podtui at it
explicitly.

### How podtui finds the socket

It uses the first of these that is a **working Podman socket**:

| # | Source | Notes |
|---|---|---|
| 1 | `--socket <path>` | used or reported, never skipped |
| 2 | `PODTUI_SOCKET` | used or reported, never skipped |
| 3 | `CONTAINER_HOST` | Podman's own variable |
| 4 | `DOCKER_HOST` | set by **podman-docker** to the Podman socket |
| 5 | `$XDG_RUNTIME_DIR/podman/podman.sock` | rootless Podman |
| 6 | `/run/podman/podman.sock` | rootful Podman |
| 7 | `$XDG_RUNTIME_DIR/docker.sock` | podman-docker's link to the Podman socket |
| 8 | `/run/docker.sock` | podman-docker's system link |

Paths and `unix://` URIs both work (`--socket unix:///run/podman/podman.sock`). Each candidate is
checked with Podman's own `/libpod/_ping`. A **real Docker daemon is detected and skipped**, so on
a machine with both Docker and Podman installed, podtui still finds Podman. If nothing works,
podtui lists every place it looked, says why each was rejected, and gives the command to fix it.

### podman-docker

If you use `podman-docker` (the package that makes `docker` an alias for `podman`), podtui works
as-is. It picks up the `DOCKER_HOST` and `docker.sock` links that podman-docker sets up. The
`docker` command alias itself doesn't matter, because podtui never runs `docker` or `podman`; it
talks to the API directly.

---

## Usage

```
podtui [--socket <path>]
podtui --version | --help
```

| Option / variable | Meaning |
|---|---|
| `--socket <path>` | Podman socket to use (path or `unix://` URI) |
| `--version`, `-v` | print the version |
| `--help`, `-h` | print usage |
| `PODTUI_SOCKET` | same as `--socket` |
| `PODTUI_POLL_MS` | refresh interval in milliseconds (default 5000, clamped to 250–60000) |

podtui uses the terminal's alternate screen, so your scrollback is untouched. Quitting with `q`,
Ctrl+C or a `SIGTERM` restores the terminal.

### Keys

| Key | Action |
|---|---|
| `1-6` | toggle panel |
| `Tab` | focus next panel |
| `z` | zoom panel |
| `↑↓jk` | move selection |
| `/` | filter list / search logs |
| `Ctrl+U` | clear filter line |
| `c` | jump to container |
| `Space` | fold sections |
| `PgUp/PgDn` | scroll detail/logs |
| `Enter` | open detail |
| `[ ]` | detail tab |
| `p` | pause/resume logs |
| `g G` | logs: oldest / live end |
| `n N` | logs: next/prev match |
| `e` | logs: errors only |
| `t` | logs: timestamps |
| `w` | logs: wrap lines |
| `v` | env: reveal secrets |
| `Esc` | back / close |
| `s` | start |
| `S` | stop |
| `r` | restart |
| `K` | kill (asks first) |
| `d` | remove (asks first) |
| `x` | bulk: prune, stop, remove |
| `R` | quadlets: reload systemd |
| `T` | reload Omarchy theme |
| `?` | help |
| `q` | quit |

Press `?` inside podtui for the same list. Both come from one key map in the code.

---

## Troubleshooting

**"No running Podman socket found."**
Start the socket: `systemctl --user enable --now podman.socket`. podtui prints every place it
looked and why each was rejected.

**"… /run/podman/podman.sock … permission denied"**
That's the rootful socket, and it's only readable by root. Use rootless Podman (above), or run
`sudo podtui`.

**"… Docker daemon, not Podman"**
The socket you pointed at is a real Docker daemon. podtui needs Podman's API. Unset or fix
`DOCKER_HOST`, or pass `--socket` with a Podman socket.

**"podtui needs an interactive terminal"**
Run it directly in a terminal, not through a pipe or a CI log.

**The installer says the binary doesn't run (Alpine / musl)**
Release binaries need glibc. Build from source on that system for now.

**macOS?**
Not yet. On macOS, Podman runs inside a VM and the socket lives elsewhere. You can try a
from-source build with `--socket <path printed by podman machine start>`, but it's untested. See
[UNKNOWNS.md #18](docs/UNKNOWNS.md).

---

## Development

podtui is written in **TypeScript** with **[Ink](https://github.com/vadimdemedes/ink)** (React
for terminals) on **[Bun](https://bun.sh)**, and compiled to a single binary with
`bun build --compile`.

```sh
bun install
scripts/dev-sandbox.sh up      # an isolated, throwaway Podman with test containers
bun run dev                    # run podtui from source against the sandbox
bun run check                  # typecheck + lint + tests
PODTUI_INTEGRATION=1 bun test  # also run the tests that talk to real Podman
scripts/dev-sandbox.sh down    # remove the sandbox completely
```

Development never touches your real containers. `bun run dev` is pinned to the sandbox under
`/tmp/podtui-dev`, and refuses to start if the sandbox isn't running. Tests that really delete
things run against their own throwaway Podman under `/tmp/podtui-test`.

Before contributing, read [AGENTS.md](AGENTS.md) (project rules: verify against the real API,
never guess), [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) (architecture) and
[ROADMAP.md](ROADMAP.md) (what's next). Decisions and the evidence behind them are logged in
[docs/DECISIONS.md](docs/DECISIONS.md).

### Releasing

1. Set `"version"` in `package.json` (e.g. `0.1.0`), commit, merge to `main`.
2. `git tag v0.1.0 && git push origin v0.1.0`

[The release workflow](.github/workflows/release.yml) checks that the tag matches
`package.json`, runs all checks, builds and smoke-tests x64 and arm64 binaries on native runners,
and publishes them with `SHA256SUMS`. Versions below 1.0.0 are published as pre-releases.

## License

[MIT](LICENSE)
