#!/usr/bin/env bash
set -euo pipefail

SANDBOX_DIR="/tmp/podtui-dev"
SANDBOX_ROOT="$SANDBOX_DIR/root"
SANDBOX_RUNROOT="$SANDBOX_DIR/run"
SANDBOX_TMPDIR="$SANDBOX_DIR/tmp"
SOCKET_PATH="$SANDBOX_DIR/podman.sock"
PID_FILE="$SANDBOX_DIR/podman.pid"
# The storage flags `up` used, so `down` can address the same database even
# when the service is gone. Podman records the tmpdir in its database and
# validates it, so `down` must not guess.
FLAGS_FILE="$SANDBOX_DIR/storage-flags"
LABEL="podtui.test=1"

# Isolation: storage, run state, libpod tmp state and events all live under
# $SANDBOX_DIR. Without --tmpdir and a file events backend, the sandbox shared
# $XDG_RUNTIME_DIR/libpod/tmp and the journald event stream with the user's
# real Podman, so sandbox activity showed up in their `podman events`.
STORAGE_FLAGS=(
  --root "$SANDBOX_ROOT"
  --runroot "$SANDBOX_RUNROOT"
  --tmpdir "$SANDBOX_TMPDIR"
  --events-backend file
)
# The file events backend cannot follow logs written by the journald log
# driver (Podman: "using --follow with the journald --log-driver but without
# the journald --events-backend (file) is not supported"), so sandbox
# containers log with k8s-file. That also keeps their output out of the
# user's journal. Applied to the service only, via a sandbox containers.conf.
CONF_FILE="$SANDBOX_DIR/containers.conf"

# What sandboxes created before 2026-10-08 used.
LEGACY_STORAGE_FLAGS=(--root "$SANDBOX_ROOT" --runroot "$SANDBOX_RUNROOT")

export PODTUI_SOCKET="$SOCKET_PATH"

usage() {
  cat <<EOF
Usage: $0 {up|down|status|seed}

  up     Start isolated Podman service and seed test resources
  down   Stop service and remove sandbox directory
  status Check if service is running
  seed   (Re)seed test resources into running sandbox
EOF
}

check_podman() {
  if ! command -v podman &>/dev/null; then
    echo "ERROR: podman not found in PATH" >&2
    exit 1
  fi
}

up() {
  check_podman

  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Sandbox already running (PID: $(cat "$PID_FILE"))"
    echo "Socket: $SOCKET_PATH"
    return 0
  fi

  echo "Creating sandbox directories..."
  mkdir -p "$SANDBOX_ROOT" "$SANDBOX_RUNROOT" "$SANDBOX_TMPDIR"
  printf '%s\n' "${STORAGE_FLAGS[@]}" > "$FLAGS_FILE"
  printf '[containers]\nlog_driver = "k8s-file"\n' > "$CONF_FILE"

  echo "Starting Podman system service..."
  CONTAINERS_CONF_OVERRIDE="$CONF_FILE" setsid podman "${STORAGE_FLAGS[@]}" \
    system service --time=0 "unix://$SOCKET_PATH" >"$SANDBOX_DIR/podman.log" 2>&1 &

  PID=$!
  echo "$PID" > "$PID_FILE"

  # Wait for socket to be ready
  for i in {1..50}; do
    if podman --url "unix://$SOCKET_PATH" version &>/dev/null; then
      break
    fi
    sleep 0.2
  done

  # Give it a moment to fully stabilize
  sleep 1

  if ! podman --url "unix://$SOCKET_PATH" version &>/dev/null; then
    echo "ERROR: Podman service failed to start" >&2
    down
    exit 1
  fi

  echo "Sandbox started (PID: $PID)"
  echo "Socket: $SOCKET_PATH"
  echo "PODTUI_SOCKET=$SOCKET_PATH"

  seed
}

down() {
  # 1. Remove every pod and container. Killing only the API service leaves
  #    them running under conmon (observed: all seeded containers survived).
  #    Prefer the live API; without it, use the flags the sandbox was made with.
  if podman --url "unix://$SOCKET_PATH" version &>/dev/null; then
    echo "Removing sandbox pods and containers..."
    podman --url "unix://$SOCKET_PATH" pod rm -a -f -t 0 >/dev/null 2>&1 || true
    podman --url "unix://$SOCKET_PATH" rm -a -f -t 0 >/dev/null 2>&1 || true
  elif [[ -d "$SANDBOX_ROOT" ]]; then
    local flags=("${LEGACY_STORAGE_FLAGS[@]}")
    if [[ -f "$FLAGS_FILE" ]]; then
      mapfile -t flags < "$FLAGS_FILE"
    fi
    echo "Service not responding; removing containers directly..."
    podman "${flags[@]}" pod rm -a -f -t 0 >/dev/null 2>&1 || true
    podman "${flags[@]}" rm -a -f -t 0 >/dev/null 2>&1 || true
  fi

  # 2. Stop the API service.
  if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      echo "Stopping Podman service (PID: $PID)..."
      kill "$PID"
      wait "$PID" 2>/dev/null || true
    fi
  fi

  # 3. Delete the directory inside the user namespace: rootless storage holds
  #    files owned by sub-UIDs that a plain `rm -rf` cannot remove
  #    (observed: "Permission denied" on overlay layers).
  if [[ -d "$SANDBOX_DIR" ]]; then
    echo "Removing sandbox directory..."
    if ! podman unshare rm -rf "$SANDBOX_DIR"; then
      echo "ERROR: could not remove $SANDBOX_DIR" >&2
      exit 1
    fi
  fi

  echo "Sandbox stopped and cleaned up"
}

status() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Sandbox: RUNNING (PID: $(cat "$PID_FILE"))"
    echo "Socket: $SOCKET_PATH"
    if podman --url "unix://$SOCKET_PATH" version &>/dev/null; then
      echo "Podman API: RESPONDING"
    else
      echo "Podman API: NOT RESPONDING"
    fi
  else
    echo "Sandbox: STOPPED"
  fi
}

seed() {
  check_podman

  if ! podman --url "unix://$SOCKET_PATH" version &>/dev/null; then
    echo "ERROR: Sandbox not running. Run '$0 up' first." >&2
    exit 1
  fi

  echo "Seeding test resources..."

  # Clean existing test resources
  # Remove pods first (this removes their containers too)
  podman --url "unix://$SOCKET_PATH" pod ps --filter "label=$LABEL" -q | xargs -r podman --url "unix://$SOCKET_PATH" pod rm -f
  # Remove any remaining containers
  podman --url "unix://$SOCKET_PATH" ps -a --filter "label=$LABEL" -q | xargs -r podman --url "unix://$SOCKET_PATH" rm -f
  podman --url "unix://$SOCKET_PATH" volume ls --filter "label=$LABEL" -q | xargs -r podman --url "unix://$SOCKET_PATH" volume rm -f
  podman --url "unix://$SOCKET_PATH" network ls --filter "label=$LABEL" -q | xargs -r podman --url "unix://$SOCKET_PATH" network rm -f

  # web: long-running container with env vars (including secret-like)
  echo "  Creating 'web' container..."
  podman --url "unix://$SOCKET_PATH" run -d \
    --name web \
    --label "$LABEL" \
    -e API_TOKEN="super-secret-token-12345" \
    -e NODE_ENV=production \
    -e PORT=8080 \
    docker.io/library/nginx:alpine

  # chatty: prints a line every second
  echo "  Creating 'chatty' container..."
  podman --url "unix://$SOCKET_PATH" run -d \
    --name chatty \
    --label "$LABEL" \
    docker.io/library/alpine:latest \
    sh -c 'while true; do echo "$(date) - log line from chatty"; sleep 1; done'

  # failing: prints ERROR/WARN then exits non-zero
  echo "  Creating 'failing' container..."
  podman --url "unix://$SOCKET_PATH" run -d \
    --name failing \
    --label "$LABEL" \
    docker.io/library/alpine:latest \
    sh -c 'echo "ERROR something broke"; echo "WARN low disk"; sleep 1; exit 1'

  # tty-box: started with a TTY (tests non-multiplexed logs)
  echo "  Creating 'tty-box' container..."
  podman --url "unix://$SOCKET_PATH" run -d \
    --name tty-box \
    --label "$LABEL" \
    -t \
    docker.io/library/alpine:latest \
    sh -c 'while true; do echo "$(date) - tty output"; sleep 2; done'

  # Pod with two containers
  echo "  Creating pod 'web-pod' with two containers..."
  podman --url "unix://$SOCKET_PATH" pod create --name web-pod --label "$LABEL"
  podman --url "unix://$SOCKET_PATH" run -d \
    --pod web-pod \
    --name web-pod-frontend \
    --label "$LABEL" \
    docker.io/library/nginx:alpine
  podman --url "unix://$SOCKET_PATH" run -d \
    --pod web-pod \
    --name web-pod-backend \
    --label "$LABEL" \
    docker.io/library/alpine:latest \
    sh -c 'while true; do sleep 3600; done'

  # Named volume
  echo "  Creating volume 'test-volume'..."
  podman --url "unix://$SOCKET_PATH" volume create --label "$LABEL" test-volume

  # Custom network
  echo "  Creating network 'test-network'..."
  podman --url "unix://$SOCKET_PATH" network create --label "$LABEL" --driver bridge test-network

  echo "Seeding complete."
  echo ""
  echo "Test resources:"
  podman --url "unix://$SOCKET_PATH" ps -a --filter "label=$LABEL" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
  podman --url "unix://$SOCKET_PATH" pod ps --filter "label=$LABEL"
  podman --url "unix://$SOCKET_PATH" volume ls --filter "label=$LABEL"
  podman --url "unix://$SOCKET_PATH" network ls --filter "label=$LABEL"
}

main() {
  case "${1:-}" in
    up) up ;;
    down) down ;;
    status) status ;;
    seed) seed ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"