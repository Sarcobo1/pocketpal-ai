import {
  isVisionRepo,
  getMmprojFiles,
  isProjectionModel,
  getRecommendedProjectionModel,
  getLLMFiles,
  projectorsForLocalModel,
  projectionGapCopy,
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
    // Test case 1: Empty array of projection models
    it('returns undefined when no projection models are available', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q4_0.gguf',
        [],
      );
      expect(result).toBeUndefined();
    });

    // Test case 2: Only one projection model available
    it('returns the only available projection model when only one exists', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q4_0.gguf',
        ['mmproj-llama-3.1-vision-q5_k_m.gguf'],
      );
      expect(result).toBe('mmproj-llama-3.1-vision-q5_k_m.gguf');
    });

    // Test case 3: Exact quantization match
    it('returns the projection model with exact quantization match', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q4_0.gguf',
        [
          'mmproj-llama-3.1-vision-q5_k_m.gguf',
          'mmproj-llama-3.1-vision-q4_0.gguf',
          'mmproj-llama-3.1-vision-q8_0.gguf',
        ],
      );
      expect(result).toBe('mmproj-llama-3.1-vision-q4_0.gguf');
    });

    // Test case 4: Higher quality quantization when exact match not found
    it('returns a higher quality projection model when exact match not found', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q4_0.gguf',
        [
          'mmproj-llama-3.1-vision-q5_k_m.gguf',
          'mmproj-llama-3.1-vision-q8_0.gguf',
        ],
      );
      expect(result).toBe('mmproj-llama-3.1-vision-q5_k_m.gguf');
    });

    // Test case 5: First available when no match or higher quality found
    it('returns the first available projection model when no match or higher quality found', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q6_k.gguf',
        [
          'mmproj-llama-3.1-vision-q4_0.gguf',
          'mmproj-llama-3.1-vision-q5_k_m.gguf',
        ],
      );
      // this fails since q5 is the highest quality that should have been returned in cases of no match or higher quality found but Received: "mmproj-llama-3.1-vision-q4_0.gguf"
      expect(result).toBe('mmproj-llama-3.1-vision-q5_k_m.gguf');
    });

    // Test case 6: Case insensitivity
    it('handles case insensitivity in quantization levels', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q4_0.gguf',
        [
          'mmproj-llama-3.1-vision-q5_k_m.gguf',
          'mmproj-llama-3.1-vision-Q4.gguf',
          'mmproj-llama-3.1-vision-q8_0.gguf',
        ],
      );
      expect(result).toBe('mmproj-llama-3.1-vision-Q4.gguf');
    });

    // Test case 7: Different quantization formats
    it('handles different quantization formats correctly', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-q4.gguf', // Using dot instead of underscore
        [
          'mmproj-llama-3.1-vision-q4_0.gguf',
          'mmproj-llama-3.1-vision-q5_k_m.gguf',
        ],
      );
      expect(result).toBe('mmproj-llama-3.1-vision-q4_0.gguf');
    });

    // Test case 8: No quantization in LLM filename
    it('returns first available when LLM has no quantization in filename', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct.gguf', // No quantization
        [
          'mmproj-llama-3.1-vision-q4_0.gguf',
          'mmproj-llama-3.1-vision-q5_k_m.gguf',
          'mmproj-llama-3.1-vision-q8_0.gguf',
        ],
      );
      // this fails since q8 is the highest quality but Received: "mmproj-llama-3.1-vision-q4_0.gguf"
      expect(result).toBe('mmproj-llama-3.1-vision-q8_0.gguf');
    });

    // Test case 9: Different quantization prefixes (iq vs q)
    it('handles different quantization prefixes correctly', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-iq4_xs.gguf', // Using iq prefix
        [
          'mmproj-llama-3.1-vision-q3_0.gguf',
          'mmproj-llama-3.1-vision-Q4.gguf',
          'mmproj-llama-3.1-vision-q8_0.gguf',
        ],
      );
      expect(result).toBe('mmproj-llama-3.1-vision-Q4.gguf');
    });

    // Test case 10: Edge case with unusual quantization format
    it('handles edge cases with unusual quantization formats', () => {
      const result = getRecommendedProjectionModel(
        'llama-3.1-8b-instruct-Q4-K.gguf', // Using hyphen instead of underscore
        [
          'mmproj-llama-3.1-vision-q4_k.gguf',
          'mmproj-llama-3.1-vision-q5_k_m.gguf',
        ],
      );
      expect(result).toBe('mmproj-llama-3.1-vision-q4_k.gguf');
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
});
