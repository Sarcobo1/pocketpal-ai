import {ModelType} from '../../../utils/types';
import {
  SPEECH_TEXTS,
  buildSpeechCells,
  estimateSpeechBenchMs,
  speechQuantOptions,
  speechStartFindings,
  speechStartRow,
  type SpeechBaseline,
  type SpeechCell,
  type SpeechStartRow,
} from '../speechBench';

/**
 * The speech matrix, pinned without a device.
 *
 * What the matrix measures can only be answered on the phone, but whether it
 * measures the right thing is settled here: one factor per cell, the same words
 * in every cell, and no cell that repeats the baseline under a new name. A table
 * with two rows that differ by nothing is how a bench ends up arguing with
 * itself.
 */

const BASE: SpeechBaseline = {
  threads: 4,
  batch: 512,
  flash: 'off',
  mmprojGpu: true,
};

/** The context a cell has to be built to measure. */
const sigOf = (cell: SpeechCell): SpeechBaseline => ({
  threads: cell.sig.threads,
  batch: cell.sig.batch,
  flash: cell.sig.flash,
  mmprojGpu: cell.sig.mmprojGpu,
});

/** How many context-level factors separate a cell from the baseline. */
const factorsMoved = (cell: SpeechCell): number =>
  (['threads', 'batch', 'flash', 'mmprojGpu'] as const).filter(
    key => sigOf(cell)[key] !== BASE[key],
  ).length;

describe('speech bench texts', () => {
  it('are one, two and three sentences, each one the next', () => {
    expect(SPEECH_TEXTS.map(t => t.len)).toEqual([1, 2, 3]);
    // Extending the same words is the only way a longer cell measures a longer
    // reply rather than different words.
    expect(SPEECH_TEXTS[1].text.startsWith(SPEECH_TEXTS[0].text)).toBe(true);
    expect(SPEECH_TEXTS[2].text.startsWith(SPEECH_TEXTS[1].text)).toBe(true);
    SPEECH_TEXTS.forEach(item =>
      expect(item.text.match(/[.!?]/g)).toHaveLength(item.len),
    );
  });
});

describe('buildSpeechCells', () => {
  it('moves exactly one context factor per cell', () => {
    const cells = buildSpeechCells(BASE);
    expect(cells.filter(cell => cell.axis === 'base')).toHaveLength(1);
    cells.forEach(cell => {
      if (cell.axis === 'stream' || cell.axis === 'cache') {
        // The two axes that cost no reload keep the baseline context and move
        // only what the call asks for.
        expect(sigOf(cell)).toEqual(BASE);
      } else if (cell.axis !== 'base') {
        expect(factorsMoved(cell)).toBe(1);
      }
    });
  });

  it('names every axis it claims to sweep', () => {
    const axes = new Set(buildSpeechCells(BASE).map(cell => cell.axis));
    expect([...axes].sort()).toEqual(
      ['base', 'batch', 'cache', 'flash', 'mmproj', 'stream', 'threads'].sort(),
    );
  });

  it('gives each cell one answer to one question', () => {
    const keys = buildSpeechCells(BASE).map(cell => cell.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not run the baseline twice when a setting already sits on a swept value', () => {
    // This device is on 4 threads, 512 batch, flash off and the GPU projector,
    // so four of the swept cells are the baseline cell wearing their name.
    const cells = buildSpeechCells(BASE);
    const onBaselineContext = cells.filter(
      cell =>
        sigOf(cell).threads === BASE.threads &&
        sigOf(cell).batch === BASE.batch &&
        sigOf(cell).flash === BASE.flash &&
        sigOf(cell).mmprojGpu === BASE.mmprojGpu &&
        cell.stream &&
        cell.isolateSeq,
    );
    expect(onBaselineContext).toHaveLength(1);
    expect(onBaselineContext[0].axis).toBe('base');
  });

  it('measures the two call-level axes on the baseline context', () => {
    const cells = buildSpeechCells(BASE);
    expect(cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          axis: 'stream',
          stream: false,
          isolateSeq: true,
        }),
        expect.objectContaining({
          axis: 'cache',
          stream: true,
          isolateSeq: false,
        }),
      ]),
    );
    // Neither of them is worth a model reload, so neither may ask for one.
    cells
      .filter(cell => cell.axis === 'stream' || cell.axis === 'cache')
      .forEach(cell => expect(sigOf(cell)).toEqual(BASE));
  });

  it('keeps the short scope inside the axes a phone settles in minutes', () => {
    const cells = buildSpeechCells(BASE);
    const quick = cells.filter(cell => cell.quick);
    expect(quick.length).toBeLessThan(cells.length);
    expect(new Set(quick.map(cell => cell.axis))).toEqual(
      new Set(['base', 'mmproj', 'threads', 'stream', 'cache']),
    );
  });
});

describe('estimateSpeechBenchMs', () => {
  it('grows with the runs and with the cells', () => {
    const cells = buildSpeechCells(BASE);
    const quick = cells.filter(cell => cell.quick);
    expect(estimateSpeechBenchMs(quick, 10)).toBeGreaterThan(
      estimateSpeechBenchMs(quick, 5),
    );
    expect(estimateSpeechBenchMs(cells, 5)).toBeGreaterThan(
      estimateSpeechBenchMs(quick, 5),
    );
  });

  it('counts one context load per distinct signature, not per cell', () => {
    const quick = buildSpeechCells(BASE).filter(cell => cell.quick);
    const contexts = new Set(quick.map(cell => JSON.stringify(sigOf(cell))))
      .size;
    // Cells that share a context must not each be charged a model load.
    expect(
      estimateSpeechBenchMs(quick, 1, 1000, 100000) -
        estimateSpeechBenchMs(quick, 1, 1000, 0),
    ).toBe(contexts * 100000);
  });
});

/** One entry of the model list, with only the fields the run reads. */
const file = (
  id: string,
  filename: string,
  over: Partial<Parameters<typeof speechQuantOptions>[0][number]> = {},
) => ({
  id,
  filename,
  size: 1_000_000_000,
  isDownloaded: true,
  modelType: ModelType.LLM as ModelType | undefined,
  ...over,
});

describe('speechQuantOptions', () => {
  it('splits what the phone holds into the two lists a pair is picked from', () => {
    const options = speechQuantOptions([
      file('q4', 'lfm3-omni-2b-Q4_K_M.gguf'),
      file('q8', 'lfm3-omni-2b-Q8_0.gguf'),
      file('plain', 'untyped-model.gguf', {modelType: undefined}),
      file('proj', 'lfm3-mmproj-F16.gguf', {modelType: ModelType.PROJECTION}),
      file('draft', 'draft-1.5b.gguf', {modelType: ModelType.DRAFT}),
    ]);

    // The quant is the whole label, the extension is noise, and a draft model
    // is not something a reply can be voiced with.
    expect(options.texts.map(option => option.label)).toEqual([
      'lfm3-omni-2b-Q4_K_M',
      'lfm3-omni-2b-Q8_0',
      'untyped-model',
    ]);
    expect(options.projectors.map(option => option.label)).toEqual([
      'lfm3-mmproj-F16',
    ]);
  });

  it('leaves a file that is not on the device out of both lists', () => {
    const options = speechQuantOptions([
      file('gone', 'not-downloaded.gguf', {isDownloaded: false}),
      file('here', 'mmproj-here.gguf', {modelType: ModelType.PROJECTION}),
    ]);

    // The run compares what can actually be loaded here; a file that would have
    // to be downloaded first is not a comparison.
    expect(options.texts).toEqual([]);
    expect(options.projectors.map(option => option.id)).toEqual(['here']);
  });
});

/**
 * A reply is a set of marks and a handful of engine numbers, so which stage is
 * which mark is the whole of what the table claims. Got it wrong, the table
 * still fills up — with a wait attributed to the wrong half of the turn, which
 * is how an optimization ends up aimed at a stage that was never slow.
 */
describe('speechStartRow', () => {
  const row = (
    marks: Record<string, number>,
    info: Record<string, string | number | boolean> = {},
  ) =>
    speechStartRow({
      fastStart: false,
      n: 1,
      chars: 120,
      sentences: 2,
      marks,
      info,
    });

  it('reads each stage off the mark that means it', () => {
    const r = row(
      {
        endpoint: 0,
        ttft: 400,
        reply: 2600,
        speech: 2650,
        audioOut: 2900,
        firstSound: 3000,
        audioLast: 5100,
      },
      {
        chunks: 18,
        stream: 'on',
        native: 'used',
        rtf: '0.9',
        firstAudioMs: 250,
        genMs: 2450,
      },
    );

    expect(r.textStartMs).toBe(400);
    expect(r.textEndMs).toBe(2600);
    expect(r.genCallMs).toBe(2650);
    expect(r.firstChunkMs).toBe(2900);
    expect(r.firstPlayMs).toBe(3000);
    expect(r.lastChunkMs).toBe(5100);
    expect(r.chunks).toBe(18);
    expect(r.firstAudioMs).toBe(250);
    // The wait the fast start exists to remove, measured on the turn itself.
    expect(r.waitTextMs).toBe(50);
  });

  it('leaves a stage that never landed unknown rather than at the opening', () => {
    const r = row({ttft: 400, reply: 2600});

    // A missing mark read as 0 would say "the first sound was immediate" — the
    // exact opposite of what a reply that never spoke shows.
    expect(r.firstPlayMs).toBe(-1);
    expect(r.genCallMs).toBe(-1);
    expect(r.lastChunkMs).toBe(-1);
    expect(r.chunks).toBe(0);
    expect(r.stream).toBe('-');
    expect(r.waitTextMs).toBe(-1);
  });
});

describe('speechStartFindings', () => {
  const base: SpeechStartRow = {
    fastStart: false,
    n: 1,
    chars: 120,
    sentences: 2,
    textStartMs: 400,
    textEndMs: 2600,
    genCallMs: 2650,
    firstChunkMs: 2900,
    firstPlayMs: 3000,
    lastChunkMs: 5100,
    chunks: 18,
    stream: 'on',
    native: 'used',
    rtf: '0.9',
    firstAudioMs: 250,
    genMs: 2450,
    waitTextMs: 50,
  };
  const at = (over: Partial<SpeechStartRow> = {}): SpeechStartRow => ({
    ...base,
    ...over,
  });

  it('accepts a stream only when the pieces arrive as it makes them', () => {
    expect(speechStartFindings([at()]).streaming).toBe('works');
    // One callback for the whole reply is a clip wearing a stream's name, and a
    // first piece at the end of the generation is the same thing measured by
    // time rather than by count.
    expect(speechStartFindings([at({chunks: 1})]).streaming).toBe('broken');
    expect(speechStartFindings([at({firstAudioMs: 2500})]).streaming).toBe(
      'broken',
    );
    expect(
      speechStartFindings([at({stream: 'off', native: 'off', chunks: 0})])
        .streaming,
    ).toBe('off');
  });

  it('separates when the engine is asked from when the ear is given', () => {
    // Without the fast start both are true: the speech waits for the text, and
    // nothing is audible before the text is whole.
    expect(speechStartFindings([at()]).speechAskedAfterText).toBe('yes');
    expect(speechStartFindings([at()]).soundBeforeText).toBe('no');

    // With it, the engine is still asked after the text — the context is busy —
    // but the device voice already spoke.
    expect(
      speechStartFindings([at({genCallMs: 2590})]).speechAskedAfterText,
    ).toBe('no');
    expect(speechStartFindings([at({firstPlayMs: 900})]).soundBeforeText).toBe(
      'yes',
    );
    expect(
      speechStartFindings([at(), at({n: 2, firstPlayMs: 900})]).soundBeforeText,
    ).toBe('mixed');
  });

  it('says nothing about replies that did not run', () => {
    const f = speechStartFindings([
      at({error: 'aborted'}),
      at({n: 2, firstPlayMs: -1, textEndMs: -1, waitTextMs: -1}),
    ]);

    // A reply that failed is not evidence, and a stage the turn never reached is
    // not a measurement — the verdicts that need either stay unknown instead of
    // answering off the one row that has the number.
    expect(f.rows).toBe(1);
    expect(f.speechAskedAfterText).toBe('unknown');
    expect(f.soundBeforeText).toBe('unknown');
    expect(f.medianTtfaMs).toBeNull();
    expect(f.medianWaitTextMs).toBeNull();
  });
});
