import { ValidationError } from './errors.js';

/**
 * Duration handling. Internally the system always uses integer minutes;
 * human formats ("1h30m", "90m", "1.5h", "45") are parsed only at the boundary.
 */

const COMBINED = /^(\d+)\s*h(?:\s*(\d+)\s*m?)?$/i;
const MINUTES_ONLY = /^(\d+)\s*(?:m|min|minutes?)?$/i;
const HOURS_DECIMAL = /^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/i;

export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 24 * 60; // sanity cap: one day

/**
 * Parses a human-friendly duration into whole minutes.
 * Accepted examples: "1h30m", "1h 30m", "90m", "90 min", "90", "1.5h", "45m".
 */
export function parseDurationMinutes(input: string): number {
  const value = input.trim().toLowerCase();
  if (value.length === 0) {
    throw new ValidationError('Duration is empty.');
  }

  const combined = COMBINED.exec(value);
  if (combined) {
    const hours = Number(combined[1]);
    const minutes = combined[2] ? Number(combined[2]) : 0;
    return finish(hours * 60 + minutes, input);
  }

  const minutesOnly = MINUTES_ONLY.exec(value);
  if (minutesOnly && minutesOnly[1] !== undefined && minutesOnly[1] !== '') {
    return finish(Number(minutesOnly[1]), input);
  }

  const hoursDecimal = HOURS_DECIMAL.exec(value);
  if (hoursDecimal && hoursDecimal[1] !== undefined && hoursDecimal[1] !== '') {
    const hours = Number(hoursDecimal[1]);
    return finish(Math.round(hours * 60), input);
  }

  // Bare number like "90" is handled by MINUTES_ONLY; anything else is invalid.
  throw new ValidationError(
    `Cannot parse duration "${input}". Use forms like "1h30m", "90m", "90", or "1.5h".`,
  );
}

function finish(minutes: number, input: string): number {
  if (!Number.isInteger(minutes)) {
    throw new ValidationError(`Duration "${input}" does not resolve to whole minutes.`);
  }
  if (minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) {
    throw new ValidationError(
      `Duration "${input}" must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`,
    );
  }
  return minutes;
}

/** Formats whole minutes as "Xh Ym" (e.g. 90 -> "1h 30m", 45 -> "45m"). */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Minutes -> seconds (Tempo and Jira APIs use seconds). */
export function minutesToSeconds(minutes: number): number {
  return minutes * 60;
}

/** Seconds -> minutes (must be a whole number of minutes). */
export function secondsToMinutes(seconds: number): number {
  const minutes = Math.round(seconds / 60);
  if (minutes * 60 !== seconds) {
    throw new ValidationError(`Duration ${seconds}s is not a whole number of minutes.`);
  }
  return minutes;
}
