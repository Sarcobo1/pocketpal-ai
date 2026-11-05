import * as RNFS from '@dr.pogodin/react-native-fs';
import {fromByteArray} from 'base64-js';
import {initLlama, type ContextParams, type LlamaContext} from 'llama.rn';

import {modelStore, ttsStore} from '../../store';
import {ModelType, type Model} from '../../utils/types';
import {acquireKeepAwake} from '../../utils/keepAwake';
import {
  closeTurnTimeline,
  logPerf,
  markTurn,
  openTurnTimeline,
} from '../../utils/mediaPerf';

import {abDir} from './abBench';
import {VOICE_ANSWER_INSTRUCTION} from './constants';
import {
  MAX_UTTERANCE_SECONDS,
  canIsolateSpeechSeq,
  modelCanVoiceReplies,
  speakWithModel,
  stopModelSpeech,
  TOUCHED_CACHE,
} from './omniSpeech';
import {speechRunMs} from './speechLevel';
import {float32PcmToWav} from './wav';

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
  axis:
    | 'base'
    | 'mmproj'
    | 'threads'
    | 'batch'
    | 'flash'
    | 'stream'
    | 'cache'
    | 'quant';
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
      // Not quick by default: an axis joins the short run only when it is named
      // as one, which is what keeps Full the longer scope rather than a synonym.
      quick: opts.quick ?? false,
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
 * The projector for one model, resolved the way the live load resolves it: the
 * file the model carries, else the projection model it names. No vision
 * preference is consulted — the speech decoder rides in this same file whether
 * or not the user lets the model look at pictures.
 */
const benchProjectorPath = async (model: Model): Promise<string | null> => {
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
 * The engine settings a set of context params stands for, in the shape a cell
 * sweeps. `mmprojGpu` comes from the store rather than the params because the
 * projector's device is decided when it attaches, not when the context is built
 * — and the cell has to measure the device the user has been hearing.
 */
const baselineOf = (
  baseParams: Omit<ContextParams, 'model'>,
): SpeechBaseline => ({
  threads: baseParams.n_threads ?? 4,
  batch: baseParams.n_batch ?? 512,
  flash: (baseParams.flash_attn_type as FlashAttn) ?? 'off',
  mmprojGpu: modelStore.multimodalDevice !== 'cpu',
});

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
  const projectorPath = await benchProjectorPath(model);
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
    base: baselineOf(baseParams),
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
  onAudio,
}: {
  ctx: LlamaContext;
  cell: SpeechCell;
  text: string;
  len: number;
  n: number;
  /** Hands the whole buffer to the caller — only a non-streaming cell has one. */
  onAudio?: (samples: Float32Array, sampleRate: number) => void;
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
    if (onAudio && out.pcm.length > 0) {
      onAudio(out.pcm, out.sampleRate);
    }
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

/** Where a quantization run leaves the audio it voiced, for a laptop to play. */
const quantDir = `${abDir}/speech-quant`;

/** A frame this quiet is not the decoder saying something. */
const QUANT_VOICED_FLOOR = 0.05;

export interface SpeechFileOption {
  id: string;
  /** The filename without its extension — the quant is the whole label. */
  label: string;
  bytes: number;
}

type HeldModel = Pick<
  Model,
  'id' | 'filename' | 'size' | 'modelType' | 'isDownloaded'
>;

/**
 * What this phone already holds, split the way the run needs it.
 *
 * Downloading a second quant is not the bench's job: it compares the files that
 * are on the device, because the only Q8_0 worth measuring against Q4 is the one
 * the user can actually load here.
 */
export const speechQuantOptions = (
  models: HeldModel[],
): {texts: SpeechFileOption[]; projectors: SpeechFileOption[]} => {
  const held = models.filter(model => model.isDownloaded);
  const options = (list: HeldModel[]) =>
    list
      .map(model => ({
        id: model.id,
        label: model.filename.replace(/\.gguf$/i, ''),
        bytes: model.size,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  return {
    texts: options(
      held.filter(
        model =>
          model.modelType !== ModelType.PROJECTION &&
          model.modelType !== ModelType.DRAFT,
      ),
    ),
    projectors: options(
      held.filter(model => model.modelType === ModelType.PROJECTION),
    ),
  };
};

const fileTail = (path: string): string => path.split('/').pop() ?? path;

const shortLabel = (name: string): string =>
  fileTail(name).replace(/\.gguf$/i, '');

/** A cell key is a filename here too, so it has to survive both. */
const safeName = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * The same words out of two different weights.
 *
 * Whether Q4 is worth it over Q8_0 is two questions with one answer each: how
 * much faster the frame loop ran, and whether the voice still sounds like the
 * model rather than the quant. Only the first is a number the phone can print,
 * so the run writes the audio next to the table and the second question is
 * answered by an ear.
 *
 * Nothing about the engine settings moves here: each file is measured on the
 * device's own baseline, so the difference in the table is the difference in
 * the weights.
 */
export const runSpeechQuantBench = async ({
  textIds,
  projectorIds = [],
  runs = 5,
  isCancelled,
  onLine,
}: {
  textIds: string[];
  projectorIds?: string[];
  runs?: number;
  isCancelled?: () => boolean;
  onLine?: (line: string) => void;
}): Promise<{
  rows: SpeechRunRow[];
  summary: SpeechCellSummary[];
  wavs: string[];
  dump: string;
}> => {
  const say = (line: string) => {
    console.log(`[speech-bench] ${line}`);
    onLine?.(line);
  };
  const cancelled = () => isCancelled?.() === true;

  const pick = (id: string, what: string): Model => {
    const model = modelStore.models.find(m => m.id === id);
    if (!model) {
      throw new Error(`the ${what} ${id} is not in the model list`);
    }
    return model;
  };
  if (!textIds.length) {
    throw new Error('pick at least one text model to compare');
  }
  const texts = textIds.map(id => pick(id, 'model'));
  const projectors = projectorIds.map(id => pick(id, 'projector'));
  const combos = texts.flatMap<{text: Model; projector: Model | null}>(text =>
    projectors.length
      ? projectors.map(projector => ({text, projector}))
      : [{text, projector: null}],
  );

  say(
    `quant run: ${combos.length} file pair(s) × ${SPEECH_TEXTS.length} texts × ${runs} runs, every pair on the device's own engine settings`,
  );

  await modelStore.enterBenchmarkMode();
  const releaseWake = acquireKeepAwake();
  const rows: SpeechRunRow[] = [];
  const summary: SpeechCellSummary[] = [];
  const wavs: string[] = [];

  try {
    for (const combo of combos) {
      if (cancelled()) {
        say('stopped before a pair');
        break;
      }
      const filePath = await modelStore.getModelFullPath(combo.text);
      const projectorPath = combo.projector
        ? await modelStore.getModelFullPath(combo.projector)
        : await benchProjectorPath(combo.text);
      if (!projectorPath) {
        say(
          `${shortLabel(combo.text.filename)} skipped — nothing is paired with it to decode audio`,
        );
        continue;
      }
      const label = `${shortLabel(combo.text.filename)}+${shortLabel(
        projectorPath,
      )}`;
      const baseParams =
        await modelStore.getEffectiveContextInitParams(filePath);
      const sig = baselineOf(baseParams);
      // Not streamed: the buffer this run hands back is the thing that gets
      // listened to, and the frame loop does the same work either way.
      const cell: SpeechCell = {
        key: label,
        axis: 'quant',
        label,
        sig,
        stream: false,
        // The context this row builds spreads `baseParams`, so it has the slots
        // the setting gives it and no more: asking a one-slot context for a
        // second is a failed prefill, not a slower speech decoder.
        isolateSeq: canIsolateSpeechSeq(baseParams.n_parallel),
        quick: true,
      };
      let target: BenchTarget | null = null;
      const opened = Date.now();
      const captured: Array<{pcm: Float32Array; rate: number}> = [];
      try {
        target = await openSpeechTarget({
          filePath,
          baseParams,
          sig,
          projectorPath,
          imageMaxTokens: modelStore.contextInitParams.image_max_tokens ?? 512,
        });
        say(
          `${label} loaded in ${Date.now() - opened}ms sig=${sigKey(sig)} audioGen=${
            target.support?.audioGen === true ? 'yes' : 'NO'
          }`,
        );
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
              onAudio:
                item.len === 2 && n === 1
                  ? (pcm, rate) => {
                      captured.push({pcm, rate});
                    }
                  : undefined,
            });
            rows.push(row);
            say(
              `${label} s${item.len}#${n} rtf=${row.rtf ?? '-'} first=${
                row.firstAudioMs
              }ms prefill=${row.promptMs}ms frames=${row.frames} p95f=${
                row.p95Frame
              }ms stop=${row.stop}${row.error ? ` ERR ${row.error}` : ''}`,
            );
          }
        }
      } catch (error) {
        // A pair that will not load is the answer to a question too: this phone
        // cannot run that file, and saying which one failed is the evidence.
        say(
          `${label} stopped ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        if (target) {
          await closeSpeechTarget(target);
        }
      }

      const clip = captured[0];
      if (clip) {
        await RNFS.mkdir(quantDir).catch(() => undefined);
        const wavPath = `${quantDir}/${safeName(label)}.wav`;
        const voicedMs = speechRunMs(clip.pcm, QUANT_VOICED_FLOOR);
        logPerf('speech.quant.audio', {
          cell: label,
          rate: clip.rate,
          samples: clip.pcm.length,
          ms: Math.round((clip.pcm.length / clip.rate) * 1000),
          voicedMs,
        });
        await RNFS.writeFile(
          wavPath,
          fromByteArray(float32PcmToWav(clip.pcm, clip.rate)),
          'base64',
        )
          .then(() => {
            wavs.push(wavPath);
            say(`${label} audio → ${wavPath} (voiced ${voicedMs}ms)`);
          })
          .catch(err =>
            console.warn(
              `[speech-bench] ${label} audio dump failed: ${String(err)}`,
            ),
          );
      }
      const of = summarizeCell(cell, rows);
      summary.push(of);
      say(`pair done ${tableLine(of)}`);
      logPerf('speech.quant.cell', {
        cell: label,
        rtf: of.medianRtf ?? -1,
        firstAudio: of.medianFirstAudioMs,
        prefill: of.medianPromptMs,
        p95Frame: of.worstP95Frame,
        failed: of.failed,
        audio: of.audioSeconds,
      });
    }
  } finally {
    releaseWake();
    modelStore.exitBenchmarkMode();
  }

  say('---- quant table (median of every length, fastest first) ----');
  [...summary]
    .sort((a, b) => (a.medianRtf ?? 99) - (b.medianRtf ?? 99))
    .forEach(row => say(tableLine(row)));
  if (wavs.length) {
    say(`listen to them: ${wavs.map(fileTail).join(', ')} in ${quantDir}`);
  }

  const dump = `${abDir}/speech-quant-${Date.now()}.json`;
  await RNFS.mkdir(abDir).catch(() => undefined);
  await RNFS.writeFile(
    dump,
    JSON.stringify(
      {
        scope: 'quant',
        runs,
        pairs: summary.map(row => row.cell),
        wavs,
        rows,
        summary,
      },
      null,
      1,
    ),
  )
    .then(() => say(`saved ${dump}`))
    .catch(err =>
      console.warn('[speech-bench] quant dump failed:', String(err)),
    );

  return {rows, summary, wavs, dump};
};

/**
 * Where the wait for a spoken reply actually is, measured on the reply rather
 * than reasoned about.
 *
 * Two questions have been argued in prose long enough, and one build can settle
 * both: does the engine hand the audio over in pieces at all, and does the
 * speech pass start only once the text of the reply is finished? The answer to
 * the first is `chunks` and the gap between the engine's first sample and its
 * last; the answer to the second is where `speech` lands against `reply`. Both
 * come from the same six moments of one turn, so this runs the app's real path —
 * the store's streaming handle, the real template, the real player — over a
 * fixed question and prints those moments for every reply.
 *
 * It runs the question twice, with the fast start off and then on, because the
 * fix and the measurement have to be compared in one sitting on one phone, and
 * the wait they differ by is the whole argument for the setting.
 */

/** The question every reply answers, asked the way a spoken turn asks it. */
const START_QUESTION = 'What makes a garden path last?';

/** Enough for two spoken sentences, short enough that no reply runs away. */
const START_N_PREDICT = 90;

/** How many sentences a reply said, from the punctuation it closed with. */
const countSentences = (text: string): number =>
  (text.match(/[.!?]/g) ?? []).length;

export interface SpeechStartRow {
  /** Whether the device voice was allowed to say the first sentence. */
  fastStart: boolean;
  n: number;
  chars: number;
  sentences: number;
  // Every one of these is milliseconds since the turn opened, which in a real
  // voice turn is the end of the speaker's sentence — so `firstPlayMs` is read
  // directly as the wait the listener felt.
  /** First token of the text reply. */
  textStartMs: number;
  /** The text reply finished. */
  textEndMs: number;
  /** The speech pass was asked for. */
  genCallMs: number;
  /** The engine's first sample reached the app. */
  firstChunkMs: number;
  /** The first sound reached the ear. */
  firstPlayMs: number;
  /** The engine handed its last sample over. */
  lastChunkMs: number;
  /** What the engine itself reported about how the audio arrived. */
  chunks: number;
  stream: string;
  native: string;
  rtf: string;
  firstAudioMs: number;
  genMs: number;
  /** `genCall - textEnd`: the wait the fast start exists to remove. -1 unknown. */
  waitTextMs: number;
  error?: string;
}

/**
 * One turn's marks and numbers, in the shape the table prints. Pure so the two
 * verdicts can be pinned without a phone: which stage is which mark is exactly
 * the thing a bench gets silently wrong.
 */
export const speechStartRow = ({
  fastStart,
  n,
  chars,
  sentences,
  marks,
  info,
}: {
  fastStart: boolean;
  n: number;
  chars: number;
  sentences: number;
  marks: Record<string, number>;
  info: Record<string, string | number | boolean | null | undefined>;
}): SpeechStartRow => {
  const num = (key: string): number => {
    const value = info[key];
    if (typeof value === 'number') {
      return value;
    }
    return typeof value === 'string' ? Number(value) || 0 : 0;
  };
  const textEnd = marks.reply ?? -1;
  const genCall = marks.speech ?? -1;
  return {
    fastStart,
    n,
    chars,
    sentences,
    textStartMs: marks.ttft ?? -1,
    textEndMs: textEnd,
    genCallMs: genCall,
    firstChunkMs: marks.audioOut ?? -1,
    firstPlayMs: marks.firstSound ?? -1,
    lastChunkMs: marks.audioLast ?? -1,
    chunks: num('chunks'),
    stream: String(info.stream ?? '-'),
    native: String(info.native ?? '-'),
    rtf: String(info.rtf ?? '-'),
    firstAudioMs: num('firstAudioMs'),
    genMs: num('genMs'),
    waitTextMs: textEnd >= 0 && genCall >= 0 ? genCall - textEnd : -1,
  };
};

export interface SpeechStartFindings {
  rows: number;
  /** (a) Does in-reply streaming work? */
  streaming: 'works' | 'broken' | 'off';
  /** (b) Is the speech pass only asked for once the text is whole? */
  speechAskedAfterText: 'yes' | 'no' | 'unknown';
  /** Does the listener hear anything before the text is whole? */
  soundBeforeText: 'yes' | 'no' | 'mixed' | 'unknown';
  medianTtfaMs: number | null;
  medianWaitTextMs: number | null;
  medianChunks: number | null;
  medianFirstAudioMs: number | null;
  medianGenMs: number | null;
}

export const speechStartFindings = (
  rows: SpeechStartRow[],
): SpeechStartFindings => {
  const ok = rows.filter(row => !row.error);
  const streamed = ok.filter(row => row.stream === 'on');
  const med = (values: number[]): number | null =>
    values.length ? median(values) : null;
  // The two numbers a streaming reply is judged on: it arrived in pieces, and
  // the first piece came long before the last one did. One piece and the flag
  // did nothing; a first piece at the end of the generation is a whole clip
  // wearing a stream's name.
  const streaming: SpeechStartFindings['streaming'] = !streamed.length
    ? 'off'
    : (med(streamed.map(row => row.chunks)) ?? 0) > 1 &&
        (med(streamed.map(row => row.firstAudioMs)) ?? 0) <
          (med(streamed.map(row => row.genMs)) ?? 0)
      ? 'works'
      : 'broken';
  const waits = ok.filter(
    row => row.textEndMs >= 0 && row.genCallMs >= 0 && row.waitTextMs >= 0,
  );
  const early = ok.filter(row => row.firstPlayMs >= 0 && row.textEndMs >= 0);
  return {
    rows: ok.length,
    streaming,
    // The two halves of the same complaint: the engine is only asked once the
    // text is whole, and — with the fast start — the ear can still have been
    // given something before it was.
    speechAskedAfterText: !waits.length
      ? 'unknown'
      : waits.every(row => row.genCallMs >= row.textEndMs)
        ? 'yes'
        : 'no',
    soundBeforeText: !early.length
      ? 'unknown'
      : early.every(row => row.firstPlayMs < row.textEndMs)
        ? 'yes'
        : early.some(row => row.firstPlayMs < row.textEndMs)
          ? 'mixed'
          : 'no',
    medianTtfaMs: med(ok.map(row => row.firstPlayMs).filter(v => v >= 0)),
    medianWaitTextMs: med(waits.map(row => row.waitTextMs)),
    medianChunks: med(streamed.map(row => row.chunks)),
    medianFirstAudioMs: med(streamed.map(row => row.firstAudioMs)),
    medianGenMs: med(streamed.map(row => row.genMs)),
  };
};

/** One reply, on one line, in the order the listener met them. */
const startLine = (row: SpeechStartRow): string =>
  `${row.fastStart ? 'on' : 'off'}#${row.n} chars=${row.chars} sent=${
    row.sentences
  } text ${row.textStartMs}→${row.textEndMs} speech=${row.genCallMs} chunk=${
    row.firstChunkMs
  } play=${row.firstPlayMs} last=${row.lastChunkMs} chunks=${row.chunks} ` +
  `stream=${row.stream} native=${row.native} rtf=${row.rtf} ` +
  `firstAudio=${row.firstAudioMs}ms gen=${row.genMs}ms waitText=${
    row.waitTextMs
  }ms${row.error ? ` ERR ${row.error}` : ''}`;

const findingsLine = (phase: string, f: SpeechStartFindings): string =>
  `${phase} n=${f.rows} (a)streaming=${f.streaming} chunks=${
    f.medianChunks
  } firstAudio=${f.medianFirstAudioMs}ms gen=${f.medianGenMs}ms ` +
  `(b)speechAfterText=${f.speechAskedAfterText} soundBeforeText=${
    f.soundBeforeText
  } waitText=${f.medianWaitTextMs}ms ttfa=${f.medianTtfaMs}ms`;

/**
 * Five replies, twice: once with the model's own voice saying everything after
 * the text is whole, once with the device voice saying the first sentence as
 * soon as it exists.
 *
 * The store's handle is driven rather than `speakWithModel` called directly,
 * because the thing being measured is when the first sound lands relative to the
 * text — and that decision lives in the handle. Every context state is put back
 * the way it was found, and the context is cleared between replies so that one
 * reply is not charged with the prefix the one before it left.
 */
export const runSpeechStartBench = async ({
  replies = 5,
  isCancelled,
  onLine,
}: {
  replies?: number;
  isCancelled?: () => boolean;
  onLine?: (line: string) => void;
} = {}): Promise<{rows: SpeechStartRow[]; dump: string}> => {
  const say = (line: string) => {
    console.log(`[speech-bench] ${line}`);
    onLine?.(line);
  };
  const ctx = modelStore.context;
  if (!ctx) {
    throw new Error('no loaded context — open the Omni model in a chat first');
  }
  if (typeof ctx.generateSpeech !== 'function') {
    throw new Error(
      'this build has no generateSpeech on the bridge — the llama.rn patch did not apply',
    );
  }
  if (!(await modelCanVoiceReplies())) {
    throw new Error('this model has no voice on this build — nothing to time');
  }

  const wasActive = ttsStore.voiceOutputActive;
  const wasFast = ttsStore.speechFastStart;
  // The speak promise of the reply in flight, so the turn waits for its own
  // audio instead of racing the store's fire-and-forget finalize.
  const pending: Array<Promise<unknown>> = [];
  ttsStore.setModelVoice({
    speak: (text, onFirstPiece) => {
      const said = speakWithModel(text, onFirstPiece);
      pending.push(said);
      return said;
    },
    stop: () => stopModelSpeech(),
  });
  ttsStore.setVoiceOutputActive(true);

  const rows: SpeechStartRow[] = [];
  const releaseWake = acquireKeepAwake();
  const dump = `${abDir}/speech-start-${Date.now()}.json`;

  try {
    say(
      `speech start: ${replies} replies x2 phases · stream=${
        ttsStore.streamSpeech ? 'on' : 'off'
      } jitter=${ttsStore.speechJitterSeconds}s preset=${
        ttsStore.speechPreset
      }`,
    );
    for (const fastStart of [false, true]) {
      ttsStore.setSpeechFastStart(fastStart);
      const phase = fastStart ? 'fast start ON' : 'fast start OFF';
      say(`---- speech start: ${phase} ----`);
      for (let n = 1; n <= replies; n++) {
        if (isCancelled?.()) {
          break;
        }
        pending.length = 0;
        const id = `speech-start-${fastStart ? 'on' : 'off'}-${n}`;
        const text = {value: ''};
        let error = '';
        openTurnTimeline();
        markTurn('endpoint');
        try {
          // Cold, every time: a reply that re-used the last one's prefix would
          // not be paying what a first spoken answer pays.
          await ctx.clearCache(true);
          ttsStore.onAssistantMessageStart(id);
          await ctx.completion(
            {
              messages: [
                {role: 'system', content: VOICE_ANSWER_INSTRUCTION},
                {role: 'user', content: START_QUESTION},
              ],
              n_predict: START_N_PREDICT,
              temperature: 0,
            },
            data => {
              const token = data?.token ?? data?.content ?? '';
              if (!token) {
                return;
              }
              if (!text.value) {
                markTurn('ttft');
              }
              text.value += token;
              ttsStore.onAssistantMessageChunk(id, token);
            },
          );
          markTurn('reply');
          ttsStore.onAssistantMessageComplete(id, text.value);
          // The handle speaks on its own schedule; the turn's own audio is what
          // has to be waited out before the marks mean anything.
          await pending[0];
        } catch (err) {
          error = String(err).slice(0, 160);
        }
        const {marks, info} = closeTurnTimeline({start: id});
        const row = speechStartRow({
          fastStart,
          n,
          chars: text.value.length,
          sentences: countSentences(text.value),
          marks,
          info,
        });
        if (error) {
          row.error = error;
        }
        rows.push(row);
        say(startLine(row));
      }
      const mine = rows.filter(row => row.fastStart === fastStart);
      say(findingsLine(phase, speechStartFindings(mine)));
    }
  } finally {
    await Promise.allSettled(pending);
    ttsStore.setModelVoice(null);
    ttsStore.setVoiceOutputActive(wasActive);
    ttsStore.setSpeechFastStart(wasFast);
    releaseWake();
  }

  const off = speechStartFindings(rows.filter(row => !row.fastStart));
  const on = speechStartFindings(rows.filter(row => row.fastStart));
  say('---- speech start verdict ----');
  say(`(a) in-reply streaming: ${on.streaming} / ${off.streaming}`);
  say(
    `(b) speech asked only after the text: ${on.speechAskedAfterText} / ${off.speechAskedAfterText} ` +
      `— first sound before the text ended: ${on.soundBeforeText} / ${off.soundBeforeText}`,
  );
  say(
    `time to first audio: off ${off.medianTtfaMs}ms → on ${on.medianTtfaMs}ms ` +
      `(waited on text ${off.medianWaitTextMs}ms → ${on.medianWaitTextMs}ms)`,
  );

  await RNFS.mkdir(abDir).catch(() => undefined);
  await RNFS.writeFile(
    dump,
    JSON.stringify(
      {
        scope: 'start',
        replies,
        question: START_QUESTION,
        stream: ttsStore.streamSpeech,
        jitterSeconds: ttsStore.speechJitterSeconds,
        preset: ttsStore.speechPreset,
        findings: {off, on},
        rows,
      },
      null,
      1,
    ),
  )
    .then(() => say(`saved ${dump}`))
    .catch(err =>
      console.warn('[speech-bench] start dump failed:', String(err)),
    );

  return {rows, dump};
};
