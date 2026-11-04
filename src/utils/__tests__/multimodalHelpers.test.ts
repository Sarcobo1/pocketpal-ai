import {
  isVisionRepo,
  getMmprojFiles,
  isProjectionModel,
  getRecommendedProjectionModel,
  getLLMFiles,
  projectorsForLocalModel,
  projectionGapCopy,
  pairedDownloadProgress,
} from '../multimodalHelpers';
import {toLocalMediaPath} from '../multimodalPatterns';
import {ModelFile} from '../types';
import en from '../../locales/en.json';

describe('multimodalHelpers', () => {
  // Test data for model files
  const testModelFiles: ModelFile[] = [
    {
      rfilename: 'llama-3.1-8b-instruct-q4_0.gguf',
      size: 4000000000,
    },
    {
      rfilename: 'llama-3.1-8b-instruct-q5_k_m.gguf',
      size: 5000000000,
    },
    {
      rfilename: 'mmproj-llama-3.1-vision-q4_0.gguf',
      size: 100000000,
    },
    {
      rfilename: 'mmproj_llama-3.1-vision-q5_k_m.gguf',
      size: 120000000,
    },
    {
      rfilename: 'mmproj.llama-3.1-vision-q8_0.gguf',
      size: 150000000,
    },
  ];
  const testModelFilesWithDot: ModelFile[] = [
    {
      rfilename: 'llama-3.1-8b-instruct-q4_0.gguf',
      size: 4000000000,
    },
    {
      rfilename: 'mmproj.llama-3.1-vision-q8_0.gguf',
      size: 150000000,
    },
  ];

  const testModelFilesWithDash: ModelFile[] = [
    {
      rfilename: 'llama-3.1-8b-instruct-q4_0.gguf',
      size: 4000000000,
    },
    {
      rfilename: 'mmproj-llama-3.1-vision-q8_0.gguf',
      size: 150000000,
    },
  ];

  const testModelFilesWith_: ModelFile[] = [
    {
      rfilename: 'llama-3.1-8b-instruct-q4_0.gguf',
      size: 4000000000,
    },
    {
      rfilename: 'mmproj_llama-3.1-vision-q8_0.gguf',
      size: 150000000,
    },
  ];

  const nonVisionFiles: ModelFile[] = [
    {
      rfilename: 'llama-3.1-8b-instruct-q4_0.gguf',
      size: 4000000000,
    },
    {
      rfilename: 'mmprojblabblah-instruct-q5_k_m.gguf',
      size: 5000000000,
    },
  ];

  // Test isVisionRepo function
  describe('isVisionRepo', () => {
    it('returns true when repository contains mmproj files', () => {
      expect(isVisionRepo(testModelFiles)).toBe(true);
    });

    it('returns true when repository does contain mmproj files only .', () => {
      expect(isVisionRepo(testModelFilesWithDot)).toBe(true);
    });

    it('returns true when repository does contain mmproj files only -', () => {
      expect(isVisionRepo(testModelFilesWithDash)).toBe(true);
    });

    it('returns true when repository does contain mmproj files only _', () => {
      expect(isVisionRepo(testModelFilesWith_)).toBe(true);
    });

    it('returns false when repository does not contain mmproj files', () => {
      expect(isVisionRepo(nonVisionFiles)).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(isVisionRepo([])).toBe(false);
    });
  });

  // Test getMmprojFiles function
  describe('getMmprojFiles', () => {
    it('returns only mmproj files from repository', () => {
      const result = getMmprojFiles(testModelFiles);
      expect(result.length).toBe(3);
      expect(result.every(file => file.rfilename.startsWith('mmproj'))).toBe(
        true,
      );
    });

    it('returns empty array when no mmproj files exist', () => {
      expect(getMmprojFiles(nonVisionFiles).length).toBe(0);
    });

    it('returns empty array for empty input', () => {
      expect(getMmprojFiles([])).toEqual([]);
    });
  });

  // Test isProjectionModel function
  describe('isProjectionModel', () => {
    it('returns true for projection model filenames', () => {
      expect(isProjectionModel('mmproj.llama-3.1-vision-q4_0.gguf')).toBe(true);
      expect(isProjectionModel('mmproj-llama-3.1-vision-q4_0.gguf')).toBe(true);
      expect(isProjectionModel('mmproj_llama-3.1-vision-q5_k_m.gguf')).toBe(
        true,
      );
    });

    it('returns false for non-projection model filenames', () => {
      expect(isProjectionModel('llama-3.1-8b-instruct-q4_0.gguf')).toBe(false);
      expect(isProjectionModel('vision-model-q8_0.gguf')).toBe(false);
    });

    it('handles case insensitivity', () => {
      expect(isProjectionModel('MMpROJ-llama-3.1-vision-q4_0.gguf')).toBe(true);
    });
  });

  // Test getLLMFiles function
  describe('getLLMFiles', () => {
    it('returns only LLM files from repository', () => {
      const result = getLLMFiles(testModelFiles);
      expect(result.length).toBe(2);
      expect(result.every(file => !file.rfilename.startsWith('mmproj'))).toBe(
        true,
      );
    });

    it('returns all files when no mmproj files exist', () => {
      expect(getLLMFiles(nonVisionFiles).length).toBe(2);
    });

    it('returns empty array when only mmproj files exist', () => {
      const onlyVisionFiles: ModelFile[] = [
        {
          rfilename: 'mmproj-llama-3.1-vision-q4_0.gguf',
          size: 100000000,
        },
      ];
      expect(getLLMFiles(onlyVisionFiles).length).toBe(0);
    });

    it('returns empty array for empty input', () => {
      expect(getLLMFiles([])).toEqual([]);
    });
  });

  describe('getRecommendedProjectionModel', () => {
    it('returns undefined when no projection models are available', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q4_0.gguf',
        [],
      );
      expect(result).toBeUndefined();
    });

    it('returns the only available projection model when only one exists', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q4_0.gguf',
        ['mmproj-llama-3.1-vision-q5_k_m.gguf'],
      );
      expect(result).toBe('mmproj-llama-3.1-vision-q5_k_m.gguf');
    });

    it('prefers Q8_0 regardless of the LLM quant', () => {
      for (const llm of ['q4_0', 'q8_0', 'f16']) {
        expect(
          getRecommendedProjectionModel(`llama-3.1-8b-instruct-${llm}.gguf`, [
            'mmproj-llama-3.1-vision-q4_0.gguf',
            'mmproj-llama-3.1-vision-f16.gguf',
            'mmproj-llama-3.1-vision-q8_0.gguf',
          ]),
        ).toBe('mmproj-llama-3.1-vision-q8_0.gguf');
      }
    });

    it('prefers F16 when no Q8_0 projector is available', () => {
      expect(
        getRecommendedProjectionModel('llama-3.1-8b-instruct-q8_0.gguf', [
          'mmproj-llama-3.1-vision-q4_0.gguf',
          'mmproj-llama-3.1-vision-q6_k.gguf',
          'mmproj-llama-3.1-vision-f16.gguf',
        ]),
      ).toBe('mmproj-llama-3.1-vision-f16.gguf');
    });

    it('falls back to the highest-quality remaining quant', () => {
      expect(
        getRecommendedProjectionModel('llama-3.1-8b-instruct-q4_0.gguf', [
          'mmproj-llama-3.1-vision-q4_0.gguf',
          'mmproj-llama-3.1-vision-q5_k_m.gguf',
          'mmproj-llama-3.1-vision-q6_k.gguf',
        ]),
      ).toBe('mmproj-llama-3.1-vision-q6_k.gguf');
    });

    it('handles case-insensitivity in quantization levels', () => {
      expect(
        getRecommendedProjectionModel('llama-3.1-8b-instruct-q4_0.gguf', [
          'mmproj-llama-3.1-vision-Q5_K_M.gguf',
          'mmproj-llama-3.1-vision-Q8_0.gguf',
          'mmproj-llama-3.1-vision-F16.gguf',
        ]),
      ).toBe('mmproj-llama-3.1-vision-Q8_0.gguf');
    });

    it('keeps the input order when no quant is recognizable', () => {
      expect(
        getRecommendedProjectionModel('llama-3.1-8b-instruct.gguf', [
          'mmproj-llama-3.1-vision.gguf',
          'mmproj-llama-3.1-vision-copy.gguf',
        ]),
      ).toBe('mmproj-llama-3.1-vision.gguf');
    });
  });
});

describe('projectorsForLocalModel', () => {
  it('pairs the projector in a folder that holds one model', () => {
    expect(
      projectorsForLocalModel('LFM3-Omni-2B-Q8_0.gguf', [
        'LFM3-Omni-2B-Q8_0.gguf',
        'mmproj-LFM3-Omni-2B-Q8_0.gguf',
      ]),
    ).toEqual(['mmproj-LFM3-Omni-2B-Q8_0.gguf']);
  });

  it('keeps every projector of that family, so the quant match can choose', () => {
    expect(
      projectorsForLocalModel('LFM3-Omni-2B-Q4_K_M.gguf', [
        'LFM3-Omni-2B-Q4_K_M.gguf',
        'mmproj-LFM3-Omni-2B-Q4_0.gguf',
        'mmproj-LFM3-Omni-2B-Q8_0.gguf',
      ]).sort(),
    ).toEqual([
      'mmproj-LFM3-Omni-2B-Q4_0.gguf',
      'mmproj-LFM3-Omni-2B-Q8_0.gguf',
    ]);
  });

  it('separates families in a shared folder instead of pairing any mmproj', () => {
    expect(
      projectorsForLocalModel('LFM3-Omni-2B-Q8_0.gguf', [
        'LFM3-Omni-2B-Q8_0.gguf',
        'gemma-3n-e4b-it-f16.gguf',
        'mmproj-LFM3-Omni-2B-Q8_0.gguf',
        'mmproj-gemma-3n-e4b-it-f16.gguf',
      ]),
    ).toEqual(['mmproj-LFM3-Omni-2B-Q8_0.gguf']);
  });

  it('shares no identity in a quant tag alone', () => {
    expect(
      projectorsForLocalModel('alpha-2b-Q4_K_M.gguf', [
        'alpha-2b-Q4_K_M.gguf',
        'beta-1b-Q4_K_M.gguf',
        'mmproj-beta-1b-Q4_K_M.gguf',
      ]),
    ).toEqual([]);
  });

  it('leaves a folder without a projector empty', () => {
    expect(
      projectorsForLocalModel('LFM3-Omni-2B-Q8_0.gguf', [
        'LFM3-Omni-2B-Q8_0.gguf',
        'README.md',
      ]),
    ).toEqual([]);
  });
});

describe('toLocalMediaPath', () => {
  it('drops the scheme llama.rn strips from a url field', () => {
    expect(toLocalMediaPath('file:///data/cache/turn.wav')).toBe(
      '/data/cache/turn.wav',
    );
  });

  it('leaves a plain path untouched', () => {
    expect(toLocalMediaPath('/data/cache/turn.wav')).toBe(
      '/data/cache/turn.wav',
    );
  });
});

describe('projectionGapCopy', () => {
  // The real English copy, so a renamed or missing key fails here rather than
  // as a crash on a phone.
  const l10n = en;

  it('names the file to download', () => {
    expect(
      projectionGapCopy(
        {kind: 'download', filename: 'mmproj-LFM3-Omni-2B-Q8_0.gguf'},
        l10n,
      ),
    ).toContain('mmproj-LFM3-Omni-2B-Q8_0.gguf');
  });

  it('points an import at its folder', () => {
    expect(projectionGapCopy({kind: 'folder'}, l10n)).toContain('mmproj');
  });

  it('names the file the engine refused', () => {
    expect(
      projectionGapCopy(
        {kind: 'attach', filename: 'mmproj-gemma-3n-e4b-it-f16.gguf'},
        l10n,
      ),
    ).toContain('mmproj-gemma-3n-e4b-it-f16.gguf');
  });

  it('says nothing when there is no gap to report', () => {
    expect(projectionGapCopy({kind: 'none'}, l10n)).toBeUndefined();
  });

  it('interpolates every placeholder the copy declares', () => {
    for (const gap of [
      {kind: 'download', filename: 'a.gguf'},
      {kind: 'attach', filename: 'b.gguf'},
    ] as const) {
      expect(projectionGapCopy(gap, l10n)).not.toContain('{{file}}');
    }
  });

  describe('pairedDownloadProgress', () => {
    it('weights the pair by bytes, not by file count', () => {
      // 1.6 GB of weights arrived and half of a 400 MB projector: nine tenths
      // of the pair, which is what the listener waited for.
      expect(
        pairedDownloadProgress([
          {bytes: 1_600_000_000, done: true, progress: 100},
          {bytes: 400_000_000, done: false, progress: 50},
        ]),
      ).toBe(90);
    });

    it('reads as finished only when every file of it is', () => {
      const llm = {bytes: 1_600_000_000, done: true, progress: 100};
      expect(pairedDownloadProgress([llm])).toBe(100);
      expect(
        pairedDownloadProgress([
          llm,
          {bytes: 400_000_000, done: false, progress: 0},
        ]),
      ).toBe(80);
    });

    it('counts nothing for a pair that has not started', () => {
      expect(pairedDownloadProgress([])).toBe(0);
      // A file whose size is still being fetched cannot carry a weight.
      expect(
        pairedDownloadProgress([{bytes: 0, done: false, progress: 40}]),
      ).toBe(0);
    });

    it('never reads past the end', () => {
      expect(
        pairedDownloadProgress([{bytes: 100, done: false, progress: 130}]),
      ).toBe(100);
    });
  });
});
