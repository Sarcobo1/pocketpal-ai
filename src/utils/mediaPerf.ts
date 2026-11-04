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

/** A stage of the turn: where it landed, in ms since the turn opened. */
type TurnMark = [stage: string, at: number];

/**
 * The one turn being measured. Voice mode runs a single turn at a time, and a
 * typed chat turn opens none — so marks made outside a voice turn fall on the
 * floor instead of landing on the next spoken turn's line.
 */
let turn: {
  t0: number;
  marks: TurnMark[];
  info: Record<string, PerfValue>;
} | null = null;

/**
 * Start measuring one voice turn. Call it where the app decides the user has
 * finished speaking: everything after this is work the listener waits for, and
 * the number they feel is the one from here to the first sound.
 */
export function openTurnTimeline(): void {
  turn = {t0: Date.now(), marks: [], info: {}};
}

/**
 * Note that a stage happened. The first note of a name wins, because a stage
 * like `ttft` is a moment and a streaming callback runs it a thousand times.
 */
export function markTurn(stage: string): void {
  if (!turn || turn.marks.some(mark => mark[0] === stage)) {
    return;
  }
  turn.marks.push([stage, Date.now() - turn.t0]);
}

/**
 * Note a stage that is defined by its last occurrence rather than its first —
 * the last chunk of a reply, where a lap counter would say nothing. It keeps the
 * same origin, so it lines up with the marks around it.
 */
export function markTurnLast(stage: string): void {
  if (!turn) {
    return;
  }
  const at = Date.now() - turn.t0;
  const existing = turn.marks.findIndex(mark => mark[0] === stage);
  if (existing < 0) {
    turn.marks.push([stage, at]);
  } else {
    turn.marks[existing] = [stage, at];
  }
}

/**
 * Put a number measured elsewhere — an engine timing that arrives in a result
 * rather than as a moment — on the turn's line, so one logcat grep holds the
 * whole turn instead of three lines that have to be matched up by hand.
 */
export function addTurnInfo(data: Record<string, PerfValue>): void {
  if (turn) {
    turn.info = {...turn.info, ...data};
  }
}

/** A stage of a turn and the numbers measured elsewhere about it. */
export interface TurnRecord {
  /** Each stage as ms since the turn opened. */
  marks: Record<string, number>;
  /** The numbers the turn carried, including `toFirstAudio`. */
  info: Record<string, PerfValue>;
}

/**
 * Print the turn as one line: each stage as the ms since the stage before it,
 * in the order they actually landed, so the numbers add up to the wait.
 *
 * `toFirstAudio` is the number the whole optimization is judged by, and the
 * stages overlap on purpose — speech starts before the text has finished — so
 * it is measured from the two marks themselves rather than from the sum.
 *
 * The stages and the numbers come back as well: a bench that runs the same turn
 * on purpose needs one reply as data, not as a line to read back off logcat.
 */
export function closeTurnTimeline(
  extra?: Record<string, PerfValue>,
): TurnRecord {
  const done = turn;
  turn = null;
  const empty: TurnRecord = {marks: {}, info: {}};
  if (!done) {
    return empty;
  }
  const marks = [...done.marks].sort((a, b) => a[1] - b[1]);
  const at = (stage: string): number | undefined =>
    marks.find(mark => mark[0] === stage)?.[1];
  const offsets: Record<string, number> = {};
  for (const [stage, offset] of marks) {
    offsets[stage] = offset;
  }
  const data: Record<string, PerfValue> = {};
  let prev = 0;
  for (const [stage, offset] of marks) {
    data[stage] = offset - prev;
    prev = offset;
  }
  const endpoint = at('endpoint');
  // The first sound, when there was one: `firstAudio` is the engine's first
  // sample, which reaches the ear a jitter buffer later, and the buffer is
  // exactly the wait being measured.
  const firstSound = at('firstSound') ?? at('firstAudio');
  const toFirstAudio =
    firstSound === undefined ? undefined : firstSound - (endpoint ?? 0);
  const info = {...done.info, ...extra, toFirstAudio};
  logPerf('turn.timeline', {
    ...info,
    ...data,
    span: Date.now() - done.t0,
  });
  return {marks: offsets, info};
}
