#!/usr/bin/env bash
# Build, smoke-test and package one release binary.
#
#   scripts/build-release.sh <arch> [version]
#     arch     x64 | arm64              (Linux targets only)
#     version  e.g. 0.1.0               (default: package.json "version")
#
# Output: dist/podtui (the binary) and
#         dist/release/podtui-<version>-linux-<arch>.tar.gz
#
# Used by .github/workflows/ci.yml and release.yml, and runnable locally, so
# the release build is the one that was tested.
#
# Build flags:
#   --target=bun-linux-<arch>   cross-compiles; the target runtime is
#                               downloaded by Bun (verified for arm64 on x64)
#   --no-compile-autoload-dotenv / --no-compile-autoload-bunfig
#       A compiled Bun binary otherwise loads .env and bunfig.toml from the
#       directory it is RUN in (verified: a .env with PODTUI_SOCKET in the
#       current directory redirected the binary to that socket). A tool that
#       can stop and delete containers must not change behaviour based on
#       whatever project directory the user happens to be in.
set -euo pipefail

ARCH="${1:-}"
case "$ARCH" in
  x64 | arm64) ;;
  *)
    echo "usage: $0 <x64|arm64> [version]" >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/.."
VERSION="${2:-$(bun -e 'console.log(require("./package.json").version)')}"
NAME="podtui-${VERSION}-linux-${ARCH}"

echo "==> Building $NAME"
rm -rf dist
mkdir -p dist/release
bun build --compile \
  --target="bun-linux-${ARCH}" \
  --no-compile-autoload-dotenv \
  --no-compile-autoload-bunfig \
  src/index.tsx --outfile dist/podtui

case "$(uname -m)" in
  x86_64) HOST_ARCH=x64 ;;
  aarch64 | arm64) HOST_ARCH=arm64 ;;
  *) HOST_ARCH=unknown ;;
esac

fail() {
  echo "SMOKE TEST FAILED: $*" >&2
  exit 1
}

if [[ "$HOST_ARCH" == "$ARCH" ]]; then
  echo "==> Smoke-testing the binary"

  # 1. Runs at all, and --help works without a TTY or a socket.
  out=$(dist/podtui --help) || fail "--help exited non-zero"
  [[ "$out" == *"podtui - terminal UI for Podman"* ]] || fail "--help output unexpected: $out"

  # 1b. It reports the version it is being released as (bundled from
  #     package.json at build time; run from / so no package.json is nearby).
  out=$(cd / && "$OLDPWD/dist/podtui" --version) || fail "--version exited non-zero"
  [[ "$out" == "podtui $VERSION" ]] || fail "--version printed '$out', expected 'podtui $VERSION'"

  # 2. The bundled app code runs: a missing socket is a clean, readable error
  #    with exit 1 (no stack trace), in an empty environment.
  set +e
  err=$(env -i dist/podtui --socket /nonexistent/podtui-smoke.sock 2>&1 >/dev/null)
  code=$?
  set -e
  [[ $code -eq 1 ]] || fail "missing socket exited $code, expected 1"
  [[ "$err" == *"No Podman at /nonexistent/podtui-smoke.sock"* ]] || fail "missing-socket message unexpected: $err"
  [[ "$err" != *"    at "* ]] || fail "stack trace printed: $err"

  # 3. A .env in the current directory is ignored.
  tmp=$(mktemp -d)
  printf 'PODTUI_SOCKET=/from-a-dotenv.sock\n' > "$tmp/.env"
  bin="$PWD/dist/podtui"
  set +e
  # Empty environment and no flag: if the .env were loaded, discovery would
  # name /from-a-dotenv.sock as the PODTUI_SOCKET it tried.
  err=$(cd "$tmp" && env -i XDG_RUNTIME_DIR=/nonexistent "$bin" 2>&1 >/dev/null)
  set -e
  rm -rf "$tmp"
  [[ "$err" != *"from-a-dotenv"* ]] || fail ".env in the working directory was loaded: $err"

  # 4. Optional: no Bun on the machine (a clean distro image), if a container
  #    engine is available and SMOKE_CONTAINER=1.
  if [[ "${SMOKE_CONTAINER:-0}" == "1" ]]; then
    engine=$(command -v podman || command -v docker || true)
    [[ -n "$engine" ]] || fail "SMOKE_CONTAINER=1 but neither podman nor docker is installed"
    echo "==> Smoke-testing in a clean debian:stable-slim container (no Bun) via $engine"
    out=$("$engine" run --rm -v "$PWD/dist:/opt/podtui:ro,Z" docker.io/library/debian:stable-slim \
      /opt/podtui/podtui --help) || fail "binary did not run in a clean container"
    [[ "$out" == *"podtui - terminal UI for Podman"* ]] || fail "clean-container --help output unexpected"
  fi
else
  echo "==> Skipping smoke test: built for $ARCH on a $HOST_ARCH host"
fi

echo "==> Packaging"
stage="dist/stage/$NAME"
mkdir -p "$stage"
cp dist/podtui LICENSE "$stage/"
tar -C dist/stage -czf "dist/release/$NAME.tar.gz" "$NAME"
rm -rf dist/stage
ls -l "dist/release/$NAME.tar.gz"
