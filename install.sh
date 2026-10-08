#!/bin/sh
# podtui installer — downloads a release binary, verifies its SHA256 checksum
# and installs it. No root needed.
#
#   curl -fsSL https://raw.githubusercontent.com/faw7an/podtui/main/install.sh | sh
#
# Options (environment variables):
#   PODTUI_VERSION      version to install, e.g. 0.1.0 or v0.1.0
#                       (default: the newest release, pre-releases included)
#   PODTUI_INSTALL_DIR  where to put the binary (default: $HOME/.local/bin)
#
# Testing hooks (used by test/install-script.test.ts):
#   PODTUI_REPO, PODTUI_API_URL, PODTUI_DOWNLOAD_BASE
set -eu

REPO="${PODTUI_REPO:-faw7an/podtui}"
INSTALL_DIR="${PODTUI_INSTALL_DIR:-${HOME:?HOME is not set}/.local/bin}"
# The "latest release" endpoint skips pre-releases, and every 0.x release is
# one, so list releases instead (newest first) and take the first.
API_URL="${PODTUI_API_URL:-https://api.github.com/repos/$REPO/releases?per_page=1}"
DOWNLOAD_BASE="${PODTUI_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download}"

say() { printf 'podtui-install: %s\n' "$*" >&2; }
die() {
  say "error: $*"
  exit 1
}

# --- downloader --------------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "curl or wget is required"
fi

# --- checksum tool -----------------------------------------------------------
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  die "sha256sum or shasum is required to verify the download"
fi

# --- platform ----------------------------------------------------------------
os=$(uname -s)
[ "$os" = "Linux" ] || die "podtui ships Linux binaries only (this system is $os). See the README to build from source."
machine=$(uname -m)
case "$machine" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) die "unsupported CPU architecture: $machine (supported: x86_64, aarch64)" ;;
esac

tmp=$(mktemp -d 2>/dev/null || mktemp -d -t podtui)
[ -n "$tmp" ] && [ -d "$tmp" ] || die "could not create a temporary directory"
trap 'rm -rf "$tmp"' EXIT INT TERM

# --- version -----------------------------------------------------------------
if [ -n "${PODTUI_VERSION:-}" ]; then
  version="${PODTUI_VERSION#v}"
else
  say "finding the newest release of $REPO"
  fetch "$API_URL" "$tmp/releases.json" || die "could not query $API_URL"
  tag=$(grep -o '"tag_name": *"[^"]*"' "$tmp/releases.json" | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
  [ -n "$tag" ] || die "no podtui release has been published yet"
  version="${tag#v}"
fi
# The version becomes part of URLs and paths: allow only version characters.
case "$version" in
  "" | *[!0-9A-Za-z.-]*) die "invalid version: '$version'" ;;
esac

name="podtui-${version}-linux-${arch}"
base="$DOWNLOAD_BASE/v${version}"

# --- download and verify -----------------------------------------------------
say "downloading $name"
fetch "$base/$name.tar.gz" "$tmp/$name.tar.gz" || die "could not download $base/$name.tar.gz (does release v$version exist for $arch?)"
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || die "could not download $base/SHA256SUMS"

expected=$(grep " $name.tar.gz\$" "$tmp/SHA256SUMS" | cut -d ' ' -f 1 | head -n 1)
[ -n "$expected" ] || die "SHA256SUMS has no entry for $name.tar.gz"
actual=$(sha256 "$tmp/$name.tar.gz")
[ "$expected" = "$actual" ] || die "checksum mismatch for $name.tar.gz (expected $expected, got $actual); nothing was installed"
say "checksum verified"

# --- install -----------------------------------------------------------------
tar -xzf "$tmp/$name.tar.gz" -C "$tmp" || die "could not unpack $name.tar.gz"
[ -f "$tmp/$name/podtui" ] || die "the archive does not contain $name/podtui"

mkdir -p "$INSTALL_DIR" || die "could not create $INSTALL_DIR"
# Stage next to the target, prove the new binary runs, THEN rename over the
# old one: an existing podtui is replaced atomically and is never swapped for
# a binary that cannot run here.
staged="$INSTALL_DIR/.podtui.new"
cp "$tmp/$name/podtui" "$staged" || die "could not write to $INSTALL_DIR"
chmod 755 "$staged"
if ! installed=$("$staged" --version 2>/dev/null); then
  rm -f "$staged"
  hint=""
  if [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; then
    hint=" This looks like a musl-based system (e.g. Alpine); podtui binaries need glibc."
  fi
  die "the downloaded binary does not run on this system, so nothing was installed.$hint"
fi
mv -f "$staged" "$INSTALL_DIR/podtui"
say "installed $installed to $INSTALL_DIR/podtui"

# --- next steps --------------------------------------------------------------
case ":${PATH:-}:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    say "note: $INSTALL_DIR is not on your PATH. Add it, e.g.:"
    say "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.bashrc"
    ;;
esac
if ! command -v podman >/dev/null 2>&1; then
  say "note: podman is not installed; podtui needs Podman to talk to."
fi
say "podtui uses the Podman API socket. If it is not running yet:"
say "  systemctl --user enable --now podman.socket"
say "then run: podtui"
