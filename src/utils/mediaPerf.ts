/**
 * Media-turn timings, printed on every build type.
 *
 * The voice trace records only in dev and E2E, but live-camera latency has to
 * be measured on the release APK the phone actually runs, so these lines go to
 * the console — which Hermes prints to logcat — regardless of build.
 */
type PerfValue = string | number | boolean | null | undefined;

export function logPerf(event: string, data?: Record<string, PerfValue>): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  let line = `[framePerf] ${event}`;
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value !== undefined) {
      line += ` ${key}=${value}`;
    }
  }
  console.log(line);
}

/**
 * One stopwatch: every lap reports the ms since it started, so the stages of a
 * turn line up against the same origin instead of three clocks.
 */
export function startPerf(): (
  event: string,
  data?: Record<string, PerfValue>,
) => void {
  const t0 = Date.now();
  return (event, data) => logPerf(event, {ms: Date.now() - t0, ...data});
}
