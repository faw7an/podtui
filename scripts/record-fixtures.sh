#!/usr/bin/env bash
#
# Record real Podman API responses into test/fixtures/ for the offline test
# suite. Every call is a GET, so this script never mutates the daemon it points
# at — but it will happily read your real containers if you point it at your real
# socket, so export PODTUI_SOCKET at the sandbox path (dev-sandbox.sh does).
#
#   PODTUI_SOCKET=/tmp/podtui-dev/podman.sock scripts/record-fixtures.sh
#   FIXTURE_DIR=/tmp/somewhere scripts/record-fixtures.sh   # dry run elsewhere
#
# Transport note: this used to be built on `curl --unix-socket`, which does not
# work on this machine (returns HTTP:000 against a socket that a raw connect
# proves is listening). It now goes through scripts/api-get.ts, which uses the
# same `fetch(..., { unix })` path as the app.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOCKET_PATH="${PODTUI_SOCKET:-/tmp/podtui-dev/podman.sock}"
FIXTURE_DIR="${FIXTURE_DIR:-$SCRIPT_DIR/../test/fixtures}"
export PODTUI_SOCKET="$SOCKET_PATH"

API_GET=(bun "$SCRIPT_DIR/api-get.ts")

mkdir -p "$FIXTURE_DIR"

echo "Recording fixtures from $SOCKET_PATH"
echo "Output directory: $FIXTURE_DIR"

# Fail loudly if the socket is not reachable before writing anything.
if ! "${API_GET[@]}" /version > /dev/null; then
  echo "ERROR: cannot reach $SOCKET_PATH (is dev-sandbox.sh running?)" >&2
  exit 1
fi

fetch_json() {
  local endpoint="$1"
  local filename="$2"
  local query="${3:-}"

  local url="$endpoint"
  if [[ -n "$query" ]]; then
    url="${endpoint}?${query}"
  fi

  printf '  %-34s -> %s\n' "$url" "$filename"
  if "${API_GET[@]}" "$url" | jq '.' > "$FIXTURE_DIR/$filename"; then
    return 0
  fi
  echo "    FAILED: $url" >&2
  return 1
}

fetch_raw() {
  local endpoint="$1"
  local filename="$2"
  local query="${3:-}"

  local url="$endpoint"
  if [[ -n "$query" ]]; then
    url="${endpoint}?${query}"
  fi

  printf '  %-34s -> %s\n' "$url" "$filename"
  if "${API_GET[@]}" "$url" > "$FIXTURE_DIR/$filename"; then
    echo "    ($(wc -c < "$FIXTURE_DIR/$filename") bytes)"
    return 0
  fi
  echo "    FAILED: $url" >&2
  return 1
}

json_field() {
  # json_field <endpoint> <jq-filter>
  "${API_GET[@]}" "$1" | jq -r "$2"
}

echo
echo "Version & info"
fetch_json "/version" "version.json"
fetch_json "/info" "info.json"

echo
echo "Containers"
fetch_json "/containers/json" "containers-list.json" "all=true"
fetch_json "/containers/json" "containers-list-running.json" "all=false"

# The list endpoint reports capital `Id` for containers, pods and images, but
# networks use a lowercase `id`. Getting this wrong is why network-inspect.json
# was never recorded at all: the lookup returned empty and the fetch was skipped.
CONTAINER_ID="$(json_field "/containers/json?all=true" '.[0].Id // empty')"
if [[ -n "$CONTAINER_ID" ]]; then
  fetch_json "/containers/${CONTAINER_ID}/json" "container-inspect.json"
  fetch_json "/containers/${CONTAINER_ID}/top" "container-top.json"
  fetch_raw "/containers/${CONTAINER_ID}/logs" "container-logs-multiplexed.bin" \
    "stdout=true&stderr=true&tail=10&timestamps=true"
fi

RUNNING_ID="$(json_field "/containers/json?all=false" '.[0].Id // empty')"
if [[ -n "$RUNNING_ID" ]]; then
  fetch_raw "/containers/${RUNNING_ID}/logs" "container-logs-running-multiplexed.bin" \
    "stdout=true&stderr=true&tail=5&timestamps=true"
fi

# Multi-container stats, used by test/types.test.ts. The old per-container
# `/containers/{id}/stats` fetch wrote container-stats.json, which no test read;
# that file has been removed rather than kept as dead weight.
fetch_json "/containers/stats" "containers-stats.json" "stream=false"

echo
echo "Pods"
fetch_json "/pods/json" "pods-list.json"
POD_ID="$(json_field "/pods/json" '.[0].Id // empty')"
if [[ -n "$POD_ID" ]]; then
  fetch_json "/pods/${POD_ID}/json" "pod-inspect.json"
fi

echo
echo "Images"
fetch_json "/images/json" "images-list.json"
IMAGE_ID="$(json_field "/images/json" '.[0].Id // empty')"
if [[ -n "$IMAGE_ID" ]]; then
  fetch_json "/images/${IMAGE_ID}/json" "image-inspect.json"
  fetch_json "/images/${IMAGE_ID}/history" "image-history.json"
fi

echo
echo "Volumes"
fetch_json "/volumes/json" "volumes-list.json"
VOLUME_NAME="$(json_field "/volumes/json" '.[0].Name // empty')"
if [[ -n "$VOLUME_NAME" ]]; then
  fetch_json "/volumes/${VOLUME_NAME}/json" "volume-inspect.json"
fi

echo
echo "Networks"
fetch_json "/networks/json" "networks-list.json"
NETWORK_ID="$(json_field "/networks/json" '.[0].id // empty')"   # lowercase id
if [[ -n "$NETWORK_ID" ]]; then
  fetch_json "/networks/${NETWORK_ID}/json" "network-inspect.json"
else
  echo "  WARNING: no network id found; network-inspect.json not recorded" >&2
fi

echo
echo "Events"
# Non-mutating: a 3s sample only. An idle sandbox emits nothing in that window
# (libpod's `sync` events arrive in bursts, not continuously), so an empty
# sample is expected and the file is removed rather than left as a zero-byte
# fixture that a test would then have to special-case.
if "${API_GET[@]}" "/events?stream=true" --duration 3000 | head -5 | jq -c '.' \
  > "$FIXTURE_DIR/events-sample.jsonl" 2>/dev/null && [[ -s "$FIXTURE_DIR/events-sample.jsonl" ]]; then
  echo "  saved events-sample.jsonl"
else
  echo "  no events during the 3s sample (idle daemon) — skipped"
  rm -f "$FIXTURE_DIR/events-sample.jsonl"
fi

echo
echo "Done. Fixtures in $FIXTURE_DIR:"
ls -la "$FIXTURE_DIR"