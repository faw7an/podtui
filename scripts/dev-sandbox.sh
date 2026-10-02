#!/usr/bin/env bash
set -euo pipefail

SANDBOX_ROOT="/tmp/podtui-dev/root"
SANDBOX_RUNROOT="/tmp/podtui-dev/run"
SOCKET_PATH="/tmp/podtui-dev/podman.sock"
PID_FILE="/tmp/podtui-dev/podman.pid"
LABEL="podtui.test=1"

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
  mkdir -p "$SANDBOX_ROOT" "$SANDBOX_RUNROOT"

  echo "Starting Podman system service..."
  setsid podman \
    --root "$SANDBOX_ROOT" \
    --runroot "$SANDBOX_RUNROOT" \
    system service --time=0 "unix://$SOCKET_PATH" >/tmp/podtui-dev/podman.log 2>&1 &

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
  if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      echo "Stopping Podman service (PID: $PID)..."
      kill "$PID"
      wait "$PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  echo "Removing sandbox directory..."
  rm -rf /tmp/podtui-dev

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