import type { Clock } from "../../src/lib/clock";

/** A Clock that always returns the same instant — for deterministic time-dependent tests. */
export function fixedClock(iso: string): Clock {
  return () => iso;
}
