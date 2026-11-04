import * as RNFS from '@dr.pogodin/react-native-fs';
import {initLlama, type ContextParams, type LlamaContext} from 'llama.rn';

import {modelStore} from '../../store';
import {acquireKeepAwake} from '../../utils/keepAwake';
import {logPerf} from '../../utils/mediaPerf';

import {abDir} from './abBench';
import {MAX_UTTERANCE_SECONDS, TOUCHED_CACHE} from './omniSpeech';

/**
 * A bench for the speech decoder alone.
 *
 * The complaint it exists to answer is a wait and a stutter, and both are
 * properties of a configuration on one device: how many cores the frame loop
 * gets, whether the projector's generator runs on the GPU, how the batch is
 * cut. None of that is answerable from a laptop, and answering it from prose is
 * how a phone ends up running a setting nobody measured.
 *
 * So every cell runs on the device, over the same three fixed texts, with the
 * same seed, and the only thing that moves between cells is the one thing the
 * cell names. Speech only — no microphone, no text completion, no playback —
 * because a reply that also listens or also thinks pays for three things at
 * once and the table then measures none of them.
 */

/** The same seed in every cell: MaskGIT varies the frame count run to run. */
export const SPEECH_BENCH_SEED = 42;

/**
 * Three texts, each one the previous with another sentence added, so a
 * one-sentence cell and a three-sentence cell differ only in how much there is
 * to say. Plain words on purpose: a number or an abbreviation makes the
 * generator emit a different frame count for reasons that are not the setting.
 */
export const SPEECH_TEXTS: Array<{len: number; text: string}> = [
  {len: 1, text: 'The park is quiet in the early morning.'},
  {
    len: 2,
    text: 'The park is quiet in the early morning. A few birds work along the fence.',
  },
  {
    len: 3,
    text: 'The park is quiet in the early morning. A few birds work along the fence. It is a good day to walk slowly.',
  },
];

type FlashAttn = 'auto' | 'on' | 'off';

/** The parts of a cell that are decided when the context is built. */
interface CellSig {
  threads: number;
  batch: number;
  flash: FlashAttn;
  mmprojGpu: boolean;
}

export interface SpeechCell {
  key: string;
  axis: 'base' | 'mmproj' | 'threads' | 'batch' | 'flash' | 'stream' | 'cache';
  label: string;
  sig: CellSig;
  /** Hand PCM out per chunk instead of one buffer at the end. */
  stream: boolean;
  /** Decode on a sequence of its own, leaving the conversation cache whole. */
  isolateSeq: boolean;
  /** Part of the short run: the axes a phone answers in a few minutes. */
  quick: boolean;
}

/**
 * What the device is configured with right now. The bench reads the store on
 * purpose: unlike the E2E matrix, whose baseline has to be a literal so a cell
 * means the same on every phone, this one measures the speech path of THIS
 * phone, and a baseline that is not what the app runs would rank settings that
 * are never used.
 */
export interface SpeechBaseline {
  threads: number;
  batch: number;
  flash: FlashAttn;
  mmprojGpu: boolean;
}

/** One reply the engine made, with every number the table is built from. */
export interface SpeechRunRow {
  cell: string;
  len: number;
  n: number;
  /** Seconds of audio the cell produced. */
  seconds: number;
  frames: number;
  chunks: number;
  /** Prefill of the tts prompt. */
  promptMs: number;
  /** The frame loop alone — the live rtf is computed from this. */
  genMs: number;
  /** Wall time of the whole call, prefill and bridge included. */
  wallMs: number;
  /** genMs / audio seconds — the number the app's own limits are judged on. */
  rtf: number | null;
  /** wallMs / audio seconds — what the listener actually waited through. */
  rtfWall: number | null;
  /** Call start to the engine's first sample. */
  firstAudioMs: number;
  /** Call start to the first chunk arriving in JS; streaming cells only. */
  firstChunkMs: number | null;
  p50Frame: number;
  p95Frame: number;
  maxFrame: number;
  stop: string;
  stage: string;
  err: string;
  isolated: boolean;
  aborted: boolean;
  error?: string;
}

export interface SpeechCellSummary {
  cell: string;
  axis: SpeechCell['axis'];
  label: string;
  runs: number;
  failed: number;
  /** Median over every text length. */
  medianRtf: number | null;
  medianRtfWall: number | null;
  medianFirstAudioMs: number;
  medianPromptMs: number;
  /** The worst p95 frame time any run of the cell saw. */
  worstP95Frame: number;
  audioSeconds: number;
  perLen: Array<{
    len: number;
    medianRtf: number | null;
    medianFirstAudioMs: number;
    medianWallMs: number;
  }>;
}

const sigKey = (sig: CellSig): string =>
  `${sig.mmprojGpu ? 'gpu' : 'cpu'}|t${sig.threads}|b${sig.batch}|${sig.flash}`;

const round = (value: number, digits = 2): number =>
  Number(value.toFixed(digits));

const median = (values: number[]): number | null => {
  const nums = values.filter(v => Number.isFinite(v));
  if (!nums.length) {
    return null;
  }
  const sorted = [...nums].sort((a, b) => a - b);
  return round(sorted[Math.floor(sorted.length / 2)]);
};

/**
 * The cells, one factor at a time around the device's own settings. A cell that
 * would repeat the baseline exactly is dropped rather than run twice, so the
 * table has no two rows that differ by nothing.
 */
export const buildSpeechCells = (base: SpeechBaseline): SpeechCell[] => {
  const cells: SpeechCell[] = [];
  const seen = new Set<string>();
  const add = (
    axis: SpeechCell['axis'],
    sig: CellSig,
    opts: {stream?: boolean; isolateSeq?: boolean; quick?: boolean} = {},
  ) => {
    const stream = opts.stream ?? true;
    const isolateSeq = opts.isolateSeq ?? true;
    const key = `${sigKey(sig)}|s${stream ? 1 : 0}|c${isolateSeq ? 1 : 0}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    cells.push({
      key,
      axis,
      label: key,
      sig,
      stream,
      isolateSeq,
      quick: opts.quick ?? true,
    });
  };

  add('base', base, {quick: true});

  // Projector device: the generator lives in the mmproj, so this is the axis
  // most likely to move the frame time, and the one a settings screen cannot
  // reach without reloading the model.
  for (const mmprojGpu of [true, false]) {
    add('mmproj', {...base, mmprojGpu}, {quick: true});
  }
  // Perf cores only — a little core costs the frame loop more than it saves.
  for (const threads of [2, 3, 4]) {
    add('threads', {...base, threads}, {quick: true});
  }
  // n_batch and n_ubatch together: they are one decision in the engine, and
  // splitting them into two axes would read as four settings where there are two.
  for (const batch of [128, 512, 1024]) {
    add('batch', {...base, batch});
  }
  for (const flash of ['on', 'off'] as FlashAttn[]) {
    add('flash', {...base, flash});
  }
  // The two call-level axes, on the device's own context: they cost no reload,
  // so a phone can answer them in one context.
  add('stream', base, {stream: false, quick: true});
  add('cache', base, {isolateSeq: false, quick: true});

  return cells;
};

/**
 * How long a scope will take, printed before the run so the wait is chosen
 * rather than discovered. Rough on purpose: it is a phone's speech decoder
 * being guessed at, and the number only has to be the right order of minutes.
 */
export const estimateSpeechBenchMs = (
  cells: SpeechCell[],
  runs: number,
  perRunMs = 12000,
  perContextMs = 25000,
): number => {
  const contexts = new Set(cells.map(cell => sigKey(cell.sig))).size;
  return (
    cells.length * SPEECH_TEXTS.length * runs * perRunMs +
    contexts * perContextMs
  );
};

/**
 * The projector for the active model, resolved the way the live load resolves
 * it: the file the model carries, else the projection model it names. No
 * vision preference is consulted — the speech decoder rides in this same file
 * whether or not the user lets the model look at pictures.
 */
const benchProjectorPath = async (): Promise<string | null> => {
  const model = modelStore.activeModel;
  if (!model) {
    return null;
  }
  if (model.mmprojPath) {
    return model.mmprojPath;
  }
  const {projectionModel} = modelStore.getProjectionModelStatus(model);
  if (!projectionModel) {
    return null;
  }
  return await modelStore.getModelFullPath(projectionModel);
};

/**
 * What is being measured: the loaded model's file, its projector, the settings
 * the app would have built its context with, and the baseline cell the whole
 * matrix is varied around.
 */
const resolveSpeechBenchSetup = async (): Promise<{
  modelName: string;
  filePath: string;
  projectorPath: string;
  baseParams: Omit<ContextParams, 'model'>;
  base: SpeechBaseline;
}> => {
  const model = modelStore.activeModel;
  if (!model) {
    throw new Error('no local model loaded — load the Omni model first');
  }
  const projectorPath = await benchProjectorPath();
  if (!projectorPath) {
    throw new Error(
      'this model has no paired projector file — the speech decoder lives there',
    );
  }
  const filePath = await modelStore.getModelFullPath(model);
  const baseParams = await modelStore.getEffectiveContextInitParams(filePath);
  return {
    modelName: model.name,
    filePath,
    projectorPath,
    baseParams,
    base: {
      threads: baseParams.n_threads ?? 4,
      batch: baseParams.n_batch ?? 512,
      flash: (baseParams.flash_attn_type as FlashAttn) ?? 'off',
      // The device the projector actually came up on, so the baseline cell is
      // the audio the user has been hearing rather than a guess at it.
      mmprojGpu: modelStore.multimodalDevice !== 'cpu',
    },
  };
};

interface BenchTarget {
  ctx: LlamaContext;
  /** What the engine says it loaded, kept for the run header. */
  support: {audioGen?: boolean} | null;
  mmprojGpu: boolean;
}

/**
 * One context per distinct signature. `n_threads`, `n_batch`/`n_ubatch` and
 * `flash_attn_type` are all fixed when the context is built, and a projector
 * is attached to a context, not swapped inside one — so a cell that names any
 * of those gets its own `initLlama`, exactly as the matrix runner does.
 */
const openSpeechTarget = async ({
  filePath,
  baseParams,
  sig,
  projectorPath,
  imageMaxTokens,
}: {
  filePath: string;
  baseParams: Omit<ContextParams, 'model'>;
  sig: CellSig;
  projectorPath: string;
  imageMaxTokens: number;
}): Promise<BenchTarget> => {
  const params: ContextParams = {
    ...baseParams,
    model: filePath,
    n_threads: sig.threads,
    n_batch: sig.batch,
    n_ubatch: sig.batch,
    flash_attn_type: sig.flash,
  };
  const ctx = await initLlama(params);
  let attached = false;
  try {
    attached = await ctx.initMultimodal({
      path: projectorPath,
      image_max_tokens: Math.min(imageMaxTokens, params.n_ctx ?? 2048),
      use_gpu: sig.mmprojGpu,
    });
  } catch (error) {
    await ctx.release().catch(() => undefined);
    throw new Error(
      `projector would not attach on ${sig.mmprojGpu ? 'GPU' : 'CPU'}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!attached) {
    await ctx.release().catch(() => undefined);
    throw new Error(
      `projector refused to build on ${
        sig.mmprojGpu ? 'GPU' : 'CPU'
      } — the other cell of this axis is the one this device has`,
    );
  }
  const support = await ctx.getMultimodalSupport().catch(() => null);
  if (typeof ctx.generateSpeech !== 'function') {
    await ctx.release().catch(() => undefined);
    throw new Error(
      'this build has no generateSpeech on the bridge — the llama.rn patch did not apply',
    );
  }
  return {ctx, support, mmprojGpu: sig.mmprojGpu};
};

const closeSpeechTarget = async (target: BenchTarget): Promise<void> => {
  await target.ctx.release().catch(() => undefined);
};

/** One speech call, measured. Never throws: a failure is a row with `error`. */
const runSpeechOnce = async ({
  ctx,
  cell,
  text,
  len,
  n,
}: {
  ctx: LlamaContext;
  cell: SpeechCell;
  text: string;
  len: number;
  n: number;
}): Promise<SpeechRunRow> => {
  const started = Date.now();
  let firstChunkMs: number | null = null;
  try {
    const out = await ctx.generateSpeech(
      {
        text,
        maxSeconds: MAX_UTTERANCE_SECONDS,
        seed: SPEECH_BENCH_SEED,
        ...(cell.stream ? {stream: true} : {}),
        ...(cell.isolateSeq ? {isolateSeq: true} : {}),
      },
      cell.stream
        ? () => {
            // The first arrival in JS, which is the number a listener feels:
            // the engine's own firstAudioMs is ahead of it by whatever the
            // bridge and the thread hop cost.
            if (firstChunkMs === null) {
              firstChunkMs = Date.now() - started;
            }
          }
        : undefined,
    );
    const wallMs = Date.now() - started;
    const audioMs = out.seconds * 1000;
    const rtf = audioMs > 0 ? out.genMs / audioMs : null;
    return {
      cell: cell.key,
      len,
      n,
      seconds: round(out.seconds),
      frames: out.frames,
      chunks: out.chunks,
      promptMs: Math.round(out.promptMs),
      genMs: Math.round(out.genMs),
      wallMs,
      rtf: rtf === null ? null : round(rtf),
      rtfWall: rtf === null ? null : round(wallMs / audioMs),
      firstAudioMs: Math.round(out.firstAudioMs),
      firstChunkMs,
      p50Frame: round(out.frameP50Ms, 1),
      p95Frame: round(out.frameP95Ms, 1),
      maxFrame: round(out.frameMaxMs, 1),
      stop: out.stopReason,
      stage: out.stage,
      err: out.error.slice(0, 160),
      isolated: out.seqIsolated === true,
      aborted: out.aborted,
    };
  } catch (error) {
    return {
      cell: cell.key,
      len,
      n,
      seconds: 0,
      frames: 0,
      chunks: 0,
      promptMs: 0,
      genMs: 0,
      wallMs: Date.now() - started,
      rtf: null,
      rtfWall: null,
      firstAudioMs: 0,
      firstChunkMs: firstChunkMs ?? null,
      p50Frame: 0,
      p95Frame: 0,
      maxFrame: 0,
      stop: 'failed',
      stage: 'bench',
      err: '',
      isolated: false,
      aborted: false,
      error: String(error).slice(0, 200),
    };
  }
};

const summarizeCell = (
  cell: SpeechCell,
  rows: SpeechRunRow[],
): SpeechCellSummary => {
  const mine = rows.filter(row => row.cell === cell.key);
  const ok = mine.filter(row => !row.error && row.seconds > 0);
  return {
    cell: cell.key,
    axis: cell.axis,
    label: cell.label,
    runs: mine.length,
    failed: mine.length - ok.length,
    medianRtf: median(ok.map(row => row.rtf ?? NaN)),
    medianRtfWall: median(ok.map(row => row.rtfWall ?? NaN)),
    medianFirstAudioMs: median(ok.map(row => row.firstAudioMs)) ?? 0,
    medianPromptMs: median(ok.map(row => row.promptMs)) ?? 0,
    worstP95Frame: ok.reduce((worst, row) => Math.max(worst, row.p95Frame), 0),
    audioSeconds: round(
      ok.reduce((sum, row) => sum + row.seconds, 0),
      1,
    ),
    perLen: [1, 2, 3].map(len => {
      const of = ok.filter(row => row.len === len);
      return {
        len,
        medianRtf: median(of.map(row => row.rtf ?? NaN)),
        medianFirstAudioMs: median(of.map(row => row.firstAudioMs)) ?? 0,
        medianWallMs: median(of.map(row => row.wallMs)) ?? 0,
      };
    }),
  };
};

const tableLine = (row: SpeechCellSummary): string =>
  `${row.cell} rtf=${row.medianRtf ?? '-'} wall=${
    row.medianRtfWall ?? '-'
  } first=${row.medianFirstAudioMs}ms prefill=${row.medianPromptMs}ms ` +
  `p95f=${row.worstP95Frame}ms ok=${row.runs - row.failed}/${row.runs} ` +
  `s1=${row.perLen[0].medianRtf ?? '-'}/s2=${
    row.perLen[1].medianRtf ?? '-'
  }/s3=${row.perLen[2].medianRtf ?? '-'}`;

export interface SpeechBenchResult {
  rows: SpeechRunRow[];
  summary: SpeechCellSummary[];
  dump: string;
  base: SpeechBaseline;
  mmproj: string;
}

/**
 * The whole matrix. One context per distinct signature, every cell of that
 * context run back to back, and a cancel that lands between runs so a phone
 * that is heating up or a table that is already answered can be stopped without
 * killing the app.
 */
export const runSpeechBench = async ({
  scope = 'quick',
  runs = 5,
  isCancelled,
  onLine,
}: {
  scope?: 'quick' | 'full';
  runs?: number;
  isCancelled?: () => boolean;
  onLine?: (line: string) => void;
}): Promise<SpeechBenchResult> => {
  const say = (line: string) => {
    console.log(`[speech-bench] ${line}`);
    onLine?.(line);
  };

  const {modelName, filePath, projectorPath, baseParams, base} =
    await resolveSpeechBenchSetup();

  const all = buildSpeechCells(base);
  const cells = scope === 'quick' ? all.filter(cell => cell.quick) : all;
  const bySig = new Map<string, SpeechCell[]>();
  for (const cell of cells) {
    const key = sigKey(cell.sig);
    bySig.set(key, [...(bySig.get(key) ?? []), cell]);
  }

  say(
    `model=${modelName} projector=${
      projectorPath.split('/').pop() ?? projectorPath
    } base=${sigKey(base)} cells=${cells.length} contexts=${
      bySig.size
    } runs=${runs} texts=3 eta=${Math.round(
      estimateSpeechBenchMs(cells, runs) / 60000,
    )}min`,
  );

  // The live context holds the model in RAM twice if it stays loaded, and a
  // voice session would be answering turns while the table is being measured.
  await modelStore.enterBenchmarkMode();
  const releaseWake = acquireKeepAwake();
  const rows: SpeechRunRow[] = [];
  const cancelled = () => isCancelled?.() === true;

  try {
    for (const [key, group] of bySig) {
      if (cancelled()) {
        say(`stopped before ${key}`);
        break;
      }
      const opened = Date.now();
      let target: BenchTarget | null = null;
      try {
        target = await openSpeechTarget({
          filePath,
          baseParams,
          sig: group[0].sig,
          projectorPath,
          imageMaxTokens: modelStore.contextInitParams.image_max_tokens ?? 512,
        });
        say(
          `${key} loaded in ${Date.now() - opened}ms audioGen=${
            target.support?.audioGen === true ? 'yes' : 'NO'
          }`,
        );
        for (const cell of group) {
          for (const item of SPEECH_TEXTS) {
            for (let n = 1; n <= runs; n++) {
              if (cancelled()) {
                break;
              }
              const row = await runSpeechOnce({
                ctx: target.ctx,
                cell,
                text: item.text,
                len: item.len,
                n,
              });
              rows.push(row);
              say(
                `${cell.key} s${item.len}#${n} rtf=${row.rtf ?? '-'} ` +
                  `first=${row.firstAudioMs}ms chunk=${
                    row.firstChunkMs ?? '-'
                  }ms prefill=${row.promptMs}ms gen=${row.genMs}ms ` +
                  `wall=${row.wallMs}ms frames=${row.frames} p95f=${
                    row.p95Frame
                  }ms stop=${row.stop}${row.error ? ` ERR ${row.error}` : ''}`,
              );
            }
            if (cancelled()) {
              break;
            }
          }
          const summary = summarizeCell(cell, rows);
          say(`cell done ${tableLine(summary)}`);
          logPerf('speech.bench.cell', {
            cell: summary.cell,
            rtf: summary.medianRtf ?? -1,
            firstAudio: summary.medianFirstAudioMs,
            prefill: summary.medianPromptMs,
            p95Frame: summary.worstP95Frame,
            failed: summary.failed,
            audio: summary.audioSeconds,
          });
          if (cancelled()) {
            break;
          }
        }
      } catch (error) {
        // A context that will not build is a result in itself: this device does
        // not have that setting, and the row that says so is the evidence.
        say(
          `${key} stopped ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        if (target) {
          await closeSpeechTarget(target);
        }
      }
    }
  } finally {
    releaseWake();
    modelStore.exitBenchmarkMode();
  }

  const summary = cells
    .map(cell => summarizeCell(cell, rows))
    .filter(row => row.runs > 0);

  say('---- speech table (median of every length) ----');
  [...summary]
    .sort((a, b) => (a.medianRtf ?? 99) - (b.medianRtf ?? 99))
    .forEach(row => say(tableLine(row)));

  const dump = `${abDir}/speech-${Date.now()}.json`;
  await RNFS.mkdir(abDir).catch(() => undefined);
  await RNFS.writeFile(
    dump,
    JSON.stringify(
      {
        base,
        scope,
        runs,
        model: modelName,
        mmproj: projectorPath,
        texts: SPEECH_TEXTS,
        rows,
        summary,
      },
      null,
      1,
    ),
  )
    .then(() => say(`saved ${dump}`))
    .catch(err =>
      console.warn('[speech-bench] results dump failed:', String(err)),
    );

  return {rows, summary, dump, base, mmproj: projectorPath};
};

/** The turn the probe measures: a fixed prefix, then the reply it produced. */
const PROBE_PROMPT =
  'You are a concise assistant.\nUser: What makes a garden path last?\nAssistant:';

/**
 * A raw-prompt completion, timed the way the live turn is timed: wall to the
 * first token, and what the engine blames the rest on. `prompt_ms` is the
 * prefill it actually paid, which is the number that falls when a prefix cache
 * survives, and `cache_n` says how many tokens it re-used to make it fall.
 */
const timedCompletion = async (
  ctx: LlamaContext,
  prompt: string,
): Promise<{
  ttftMs: number;
  promptMs: number;
  cacheN: number;
  text: string;
}> => {
  const started = Date.now();
  let ttftMs = -1;
  let streamed = '';
  const result = await ctx.completion(
    {prompt, n_predict: 24, temperature: 0},
    data => {
      const token = data?.token ?? data?.content ?? '';
      if (ttftMs < 0 && token) {
        ttftMs = Date.now() - started;
      }
      streamed += token;
    },
  );
  return {
    ttftMs: ttftMs < 0 ? Date.now() - started : ttftMs,
    promptMs: Math.round(result?.timings?.prompt_ms ?? 0),
    cacheN: result?.timings?.cache_n ?? 0,
    text: result?.text ?? streamed,
  };
};

export interface CacheProbeRow {
  isolateSeq: boolean;
  n: number;
  /** First completion of the prefix: nothing cached, so this is the floor. */
  coldTtftMs: number;
  coldPromptMs: number;
  /** Speech of a fixed sentence, on the way the cell asks for it. */
  speechMs: number;
  speechSeconds: number;
  speechStop: string;
  /** The next turn: the number the prefix cache is supposed to protect. */
  nextTtftMs: number;
  nextPromptMs: number;
  /** Tokens the engine says it re-used. The whole answer is this number. */
  cacheN: number;
  cleared: boolean;
  error?: string;
}

/**
 * Does the conversation survive a spoken reply?
 *
 * The utterance used to be decoded over the conversation's own positions, so
 * the next turn re-prefilled everything it had already said. The bridge can now
 * put the utterance on a sequence of its own and drop only that. This measures
 * the difference where it is claimed: prompt the model, speak, prompt it again,
 * and read the time to first token and the tokens the engine re-used.
 */
export const runSpeechCacheProbe = async ({
  runs = 3,
  isCancelled,
  onLine,
}: {
  runs?: number;
  isCancelled?: () => boolean;
  onLine?: (line: string) => void;
} = {}): Promise<{rows: CacheProbeRow[]; dump: string}> => {
  const say = (line: string) => {
    console.log(`[speech-bench] ${line}`);
    onLine?.(line);
  };
  const {filePath, projectorPath, baseParams, base} =
    await resolveSpeechBenchSetup();

  await modelStore.enterBenchmarkMode();
  const releaseWake = acquireKeepAwake();
  const rows: CacheProbeRow[] = [];
  let target: BenchTarget | null = null;

  try {
    target = await openSpeechTarget({
      filePath,
      baseParams,
      sig: base,
      projectorPath,
      imageMaxTokens: modelStore.contextInitParams.image_max_tokens ?? 512,
    });
    const ctx = target.ctx;

    // Off first, so the table reads before and then after.
    for (const isolateSeq of [false, true]) {
      for (let n = 1; n <= runs; n++) {
        if (isCancelled?.()) {
          break;
        }
        const row: CacheProbeRow = {
          isolateSeq,
          n,
          coldTtftMs: 0,
          coldPromptMs: 0,
          speechMs: 0,
          speechSeconds: 0,
          speechStop: '',
          nextTtftMs: 0,
          nextPromptMs: 0,
          cacheN: 0,
          cleared: false,
        };
        try {
          await ctx.clearCache(true);
          const cold = await timedCompletion(ctx, PROBE_PROMPT);
          row.coldTtftMs = cold.ttftMs;
          row.coldPromptMs = cold.promptMs;
          const turnText = `${PROBE_PROMPT} ${cold.text}`;

          const speechStarted = Date.now();
          // Whole buffer, no callback: this probe is about the cache, and a
          // stream with nobody listening would measure the bridge instead.
          const speech = await ctx.generateSpeech({
            text: SPEECH_TEXTS[1].text,
            maxSeconds: MAX_UTTERANCE_SECONDS,
            seed: SPEECH_BENCH_SEED,
            ...(isolateSeq ? {isolateSeq: true} : {}),
          });
          row.speechMs = Date.now() - speechStarted;
          row.speechSeconds = round(speech.seconds);
          row.speechStop = speech.stopReason;

          // What the live path does with a cache the utterance ran over.
          const cleared =
            speech.seqIsolated !== true && TOUCHED_CACHE.has(speech.stopReason);
          if (cleared) {
            await ctx.clearCache(true);
          }
          row.cleared = cleared;

          const next = await timedCompletion(ctx, turnText);
          row.nextTtftMs = next.ttftMs;
          row.nextPromptMs = next.promptMs;
          row.cacheN = next.cacheN;
        } catch (error) {
          row.error = String(error).slice(0, 200);
        }
        rows.push(row);
        say(
          `cache iso=${isolateSeq ? 'on' : 'off'} #${n} speech=${
            row.speechMs
          }ms/${row.speechSeconds}s stop=${row.speechStop} cleared=${
            row.cleared ? 'YES' : 'no'
          } cold ttft=${row.coldTtftMs}ms/prefill=${
            row.coldPromptMs
          }ms next ttft=${row.nextTtftMs}ms/prefill=${
            row.nextPromptMs
          }ms cached=${row.cacheN}${row.error ? ` ERR ${row.error}` : ''}`,
        );
      }
    }
  } finally {
    if (target) {
      await closeSpeechTarget(target);
    }
    releaseWake();
    modelStore.exitBenchmarkMode();
  }

  const dump = `${abDir}/speech-cache-${Date.now()}.json`;
  const ok = rows.filter(row => !row.error);
  say('---- next-turn cache table ----');
  for (const isolateSeq of [false, true]) {
    const mine = ok.filter(row => row.isolateSeq === isolateSeq);
    if (!mine.length) {
      continue;
    }
    say(
      `iso=${isolateSeq ? 'on' : 'off'} n=${mine.length} ` +
        `next ttft=${median(mine.map(row => row.nextTtftMs)) ?? '-'}ms ` +
        `prefill=${median(mine.map(row => row.nextPromptMs)) ?? '-'}ms ` +
        `cached=${median(mine.map(row => row.cacheN)) ?? '-'} ` +
        `(cold prefill ${
          median(mine.map(row => row.coldPromptMs)) ?? '-'
        }ms, cleared ${mine.filter(row => row.cleared).length}/${mine.length})`,
    );
  }

  await RNFS.mkdir(abDir).catch(() => undefined);
  await RNFS.writeFile(dump, JSON.stringify({base, rows}, null, 1))
    .then(() => say(`saved ${dump}`))
    .catch(err =>
      console.warn('[speech-bench] cache probe dump failed:', String(err)),
    );

  return {rows, dump};
};
