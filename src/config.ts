/**
 * Runtime configuration read from the environment.
 *
 * Kept separate from the UI so the rules are pure functions and unit-testable
 * without mounting anything. Anything read from `process.env` belongs here
 * rather than inline in a component, because a bad value must degrade to a
 * safe default instead of reaching `setInterval`.
 */

/** Poll cadence when nothing valid is configured (FR-2 polling fallback). */
export const DEFAULT_POLL_MS = 5000;

/**
 * Floor for the poll interval. Below this the app would hammer the daemon; the
 * value is clamped rather than rejected so a too-eager setting still works.
 */
export const MIN_POLL_MS = 250;

/** Ceiling, so a typo cannot freeze the UI indefinitely. */
export const MAX_POLL_MS = 60_000;

/**
 * Resolve the poll interval from a raw environment value.
 *
 * Unset, blank, non-numeric and non-finite values fall back to the default;
 * everything else is clamped into `[MIN_POLL_MS, MAX_POLL_MS]`.
 */
export function resolvePollMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_POLL_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_MS;

  const truncated = Math.trunc(parsed);
  if (truncated < MIN_POLL_MS) return MIN_POLL_MS;
  if (truncated > MAX_POLL_MS) return MAX_POLL_MS;
  return truncated;
}