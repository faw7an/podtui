#!/usr/bin/env bash
set -euo pipefail

SOCKET_PATH="${PODTUI_SOCKET:-/tmp/podtui-dev/podman.sock}"
FIXTURE_DIR="$(dirname "$0")/../test/fixtures"
BASE_URL="http://d/v5.0.0/libpod"

mkdir -p "$FIXTURE_DIR"

echo "Recording fixtures from $SOCKET_PATH..."
echo "Output directory: $FIXTURE_DIR"

# Helper function to fetch and save JSON
fetch_json() {
  local endpoint="$1"
  local filename="$2"
  local query="${3:-}"
  
  local url="${BASE_URL}${endpoint}"
  if [[ -n "$query" ]]; then
    url="${url}?${query}"
  fi
  
  echo "  Fetching $endpoint..."
  
  if curl --silent --fail --unix-socket "$SOCKET_PATH" "$url" | jq '.' > "$FIXTURE_DIR/$filename"; then
    echo "    Saved $filename"
  else
    echo "    FAILED: $endpoint"
    return 1
  fi
}

# Helper to fetch raw binary (for logs)
fetch_raw() {
  local endpoint="$1"
  local filename="$2"
  local query="${3:-}"
  
  local url="${BASE_URL}${endpoint}"
  if [[ -n "$query" ]]; then
    url="${url}?${query}"
  fi
  
  echo "  Fetching raw $endpoint..."
  
  if curl --silent --fail --unix-socket "$SOCKET_PATH" "$url" > "$FIXTURE_DIR/$filename"; then
    echo "    Saved $filename ($(wc -c < "$FIXTURE_DIR/$filename") bytes)"
  else
    echo "    FAILED: $endpoint"
    return 1
  fi
}

# Version & info
fetch_json "/version" "version.json"
fetch_json "/info" "info.json"

# Containers
fetch_json "/containers/json" "containers-list.json" "all=true"
fetch_json "/containers/json" "containers-list-running.json" "all=false"

# Get first container ID for inspect
CONTAINER_ID=$(curl --silent --unix-socket "$SOCKET_PATH" "${BASE_URL}/containers/json?all=true" | jq -r '.[0].Id // empty')
if [[ -n "$CONTAINER_ID" ]]; then
  fetch_json "/containers/${CONTAINER_ID}/json" "container-inspect.json"
  fetch_json "/containers/${CONTAINER_ID}/top" "container-top.json"
  fetch_raw "/containers/${CONTAINER_ID}/logs" "container-logs-multiplexed.bin" "stdout=true&stderr=true&tail=10&timestamps=true"
  fetch_json "/containers/${CONTAINER_ID}/stats" "container-stats.json" "stream=false"
fi

# Find a running container for logs streaming test
RUNNING_ID=$(curl --silent --unix-socket "$SOCKET_PATH" "${BASE_URL}/containers/json?all=false" | jq -r '.[0].Id // empty')
if [[ -n "$RUNNING_ID" ]]; then
  fetch_raw "/containers/${RUNNING_ID}/logs" "container-logs-running-multiplexed.bin" "stdout=true&stderr=true&tail=5&timestamps=true"
fi

# Pods
fetch_json "/pods/json" "pods-list.json"
POD_ID=$(curl --silent --unix-socket "$SOCKET_PATH" "${BASE_URL}/pods/json" | jq -r '.[0].Id // empty')
if [[ -n "$POD_ID" ]]; then
  fetch_json "/pods/${POD_ID}/json" "pod-inspect.json"
fi

# Images
fetch_json "/images/json" "images-list.json"
IMAGE_ID=$(curl --silent --unix-socket "$SOCKET_PATH" "${BASE_URL}/images/json" | jq -r '.[0].Id // empty')
if [[ -n "$IMAGE_ID" ]]; then
  fetch_json "/images/${IMAGE_ID}/json" "image-inspect.json"
  fetch_json "/images/${IMAGE_ID}/history" "image-history.json"
fi

# Volumes
fetch_json "/volumes/json" "volumes-list.json"
VOLUME_NAME=$(curl --silent --unix-socket "$SOCKET_PATH" "${BASE_URL}/volumes/json" | jq -r '.[0].Name // empty')
if [[ -n "$VOLUME_NAME" ]]; then
  fetch_json "/volumes/${VOLUME_NAME}/json" "volume-inspect.json"
fi

# Networks
fetch_json "/networks/json" "networks-list.json"
NETWORK_ID=$(curl --silent --unix-socket "$SOCKET_PATH" "${BASE_URL}/networks/json" | jq -r '.[0].Id // empty')
if [[ -n "$NETWORK_ID" ]]; then
  fetch_json "/networks/${NETWORK_ID}/json" "network-inspect.json"
fi

# Events (just a quick sample with timeout)
echo "  Fetching events (2s sample)..."
timeout 2 curl --silent --unix-socket "$SOCKET_PATH" "${BASE_URL}/events?stream=true" 2>/dev/null | head -5 | jq -c '.' > "$FIXTURE_DIR/events-sample.jsonl" 2>/dev/null || true
if [[ -s "$FIXTURE_DIR/events-sample.jsonl" ]]; then
  echo "    Saved events-sample.jsonl"
else
  echo "    No events captured"
  rm -f "$FIXTURE_DIR/events-sample.jsonl"
fi

# Stats for multiple containers
fetch_json "/containers/stats" "containers-stats.json" "stream=false"

echo ""
echo "Done! Fixtures saved to $FIXTURE_DIR"
ls -la "$FIXTURE_DIR"