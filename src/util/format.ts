/** SI units (10^3) to match what `podman images` prints: 64.3MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / 1000 ** i;
  return `${i === 0 ? value.toFixed(0) : value.toFixed(1)}${units[i]}`;
}

/** Shorten `docker.io/library/nginx:alpine` -> `nginx:alpine`. */
export function shortenImageName(name: string): string {
  return name.replace(/^docker\.io\/library\//, "").replace(/^docker\.io\//, "");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative age, coarse on purpose: a status column is at most ~8 cells wide,
 * so `2h` / `5m` / `3d` is all that can ever be shown.
 */
export function formatAge(fromMs: number, nowMs: number): string {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) return "";
  const delta = nowMs - fromMs;
  if (delta < 0) return "now";
  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  return `${Math.floor(delta / DAY)}d`;
}

/** Podman timestamps are RFC3339 strings (verified in test/fixtures). */
export function parsePodmanTime(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    // Images report unix SECONDS; containers/pods use strings.
    return value > 1e12 ? value : value * 1000;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export type Tone = "ok" | "warn" | "error" | "info" | "dim";

/**
 * Status text always carries a symbol as well as a colour, so meaning survives
 * `NO_COLOR` and 16-colour terminals (LAYOUT_SPEC §6).
 */
export function statusGlyph(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "●";
    case "warn":
      return "◐";
    case "error":
      return "✖";
    case "info":
      return "○";
    default:
      return "·";
  }
}

/** Map a raw Podman state string to a tone. Only real API values. */
export function toneForState(state: string): Tone {
  switch (state.toLowerCase()) {
    case "running":
    case "up":
    case "ready":
      return "ok";
    case "paused":
    case "created":
    case "restarting":
    case "pending":
    case "degraded":
      return "warn";
    case "exited":
    case "dead":
    case "stopped":
    case "error":
      return "error";
    default:
      return "dim";
  }
}

export interface HealthSuffix {
  /** Appended to the state text, e.g. `"· healthy"`. Empty when there is none. */
  suffix: string;
  /** Overrides the row tone when present. */
  tone?: Tone;
}

/**
 * Health suffix for container rows, read from the list endpoint's `Status`
 * field (P2-T5). Verified live 2026-10-04: `"healthy"`, `"unhealthy"`, or `""`
 * when the container has no healthcheck. An unhealthy container forces the
 * error tone whatever its lifecycle state — `running` + `unhealthy` must read
 * as a problem. Unrecognized values pass through unstyled: displaying what the
 * API sent is honest, inventing a colour for it is not.
 */
export function healthSuffix(status: string | undefined | null): HealthSuffix {
  if (status === undefined || status === null || status === "") return { suffix: "" };
  if (status === "healthy") return { suffix: "· healthy" };
  if (status === "unhealthy") return { suffix: "· unhealthy", tone: "error" };
  return { suffix: `· ${status}` };
}

/** `● running` — glyph plus text, never colour alone. */
export function statusText(state: string): { text: string; tone: Tone } {
  const lower = state.toLowerCase();
  const tone = toneForState(lower);
  // Podman reports container status as e.g. "Up 3 hours"; keep it short.
  const label =
    lower === "running" || lower === "up"
      ? "running"
      : lower === "exited"
        ? "exited"
        : state.length > 0 ? state : "unknown";
  return { text: `${statusGlyph(tone)} ${label}`, tone };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Log line timestamp in local time, `2026-10-08 09:46:07`: second precision
 * and a date, because a follow buffer can span days. Podman's own value
 * carries nanoseconds; they would cost 10 cells for no reading benefit.
 */
export function formatLogTimestamp(d: Date): string {
  if (Number.isNaN(d.getTime())) return "????-??-?? ??:??:??";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
