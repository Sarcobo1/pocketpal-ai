import {ModelType} from '../../../utils/types';
import {
  SPEECH_TEXTS,
  buildSpeechCells,
  estimateSpeechBenchMs,
  speechQuantOptions,
  type SpeechBaseline,
  type SpeechCell,
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
