import {
  contextLadder,
  forcedExtendedPlan,
  memoryBudgetFromStats,
  physicalBytesOf,
  planModelLoad,
  MIN_EXTENDED_N_CTX,
  type MemoryBudget,
  type PlanInput,
} from '../extendedRam';
import type {MemoryStats} from '../../specs/NativeHardwareInfo';

const GB = 1000 * 1000 * 1000;
const GIB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

const stats = (overrides: Partial<MemoryStats> = {}): MemoryStats => ({
  totalBytes: 8 * GB,
  availableBytes: 3 * GB,
  swapTotalBytes: 0,
  swapFreeBytes: 0,
  swapKinds: [],
  ...overrides,
});

const physicalBudget = (physicalBytes: number): MemoryBudget =>
  memoryBudgetFromStats(stats(), physicalBytes);

const swapBudget = (
  physicalBytes: number,
  swapBytes: number,
  kind = 'file',
): MemoryBudget =>
  memoryBudgetFromStats(
    stats({
      swapTotalBytes: swapBytes,
      swapFreeBytes: swapBytes,
      swapKinds: [kind],
    }),
    physicalBytes,
  );

/** Weights do not move; the context length is what buys the KV cache. */
const measureOf =
  (residentBytes: number, kvBytesPerToken: number) =>
  ({n_ctx}: {n_ctx: number}) =>
    residentBytes + n_ctx * kvBytesPerToken;

const inputFor = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  requiredBytes: 6 * GB,
  budget: physicalBudget(5 * GB),
  setting: 'auto',
  previousAttemptCrashed: false,
  n_ctx: 2048,
  n_batch: 512,
  n_ubatch: 256,
  backend: 'cpu',
  state_cache_budget_mb: 160,
  measure: measureOf(4 * GIB, 1 * MiB),
  ...overrides,
});

describe('memoryBudgetFromStats', () => {
  it('reports no virtual RAM without swap', () => {
    expect(physicalBudget(5 * GB)).toEqual({
      physicalBytes: 5 * GB,
      virtualBytes: 0,
      totalBytes: 8 * GB,
      hasVirtualRam: false,
      swapKinds: [],
    });
  });

  it('rates a swap file above zram', () => {
    // zram lives inside RAM, so a spilled page frees less than it costs.
    expect(swapBudget(5 * GB, 4 * GB, 'zram').virtualBytes).toBeLessThan(
      swapBudget(5 * GB, 4 * GB, 'file').virtualBytes,
    );
    expect(swapBudget(5 * GB, 4 * GB, 'file').virtualBytes).toBeGreaterThan(0);
  });

  it('takes the least generous kind when several are active', () => {
    const both = memoryBudgetFromStats(
      stats({
        swapTotalBytes: 4 * GB,
        swapFreeBytes: 4 * GB,
        swapKinds: ['zram', 'file'],
      }),
      5 * GB,
    );

    expect(both.virtualBytes).toBe(
      swapBudget(5 * GB, 4 * GB, 'zram').virtualBytes,
    );
  });

  it('never counts more free swap than the pool holds', () => {
    const overReported = memoryBudgetFromStats(
      stats({
        swapTotalBytes: 1 * GB,
        swapFreeBytes: 4 * GB,
        swapKinds: ['zram'],
      }),
      5 * GB,
    );

    expect(overReported.virtualBytes).toBeLessThanOrEqual(1 * GB);
  });

  it('survives a native read that failed', () => {
    const budget = memoryBudgetFromStats(null, 5 * GB);

    expect(budget.hasVirtualRam).toBe(false);
    expect(budget.totalBytes).toBe(0);
  });

  it('keeps the calibration it is given', () => {
    expect(physicalBytesOf(undefined, 2 * GB)).toBe(2 * GB);
    expect(physicalBytesOf(3 * GB, 2 * GB)).toBe(3 * GB);
    expect(physicalBytesOf(undefined, undefined)).toBe(0);
  });
});

describe('contextLadder', () => {
  it('walks down to the floor and stops there', () => {
    expect(contextLadder(3072)).toEqual([3072, 2048, 1024, MIN_EXTENDED_N_CTX]);
  });

  it('offers the floor when the user is already below it', () => {
    expect(contextLadder(256)).toEqual([MIN_EXTENDED_N_CTX]);
  });
});

describe('planModelLoad', () => {
  it('leaves a model that fits in RAM alone', () => {
    const plan = planModelLoad(
      inputFor({requiredBytes: 4 * GB, budget: physicalBudget(5 * GB)}),
    );

    expect(plan.mode).toBe('normal');
    expect(plan.reason).toBe('fits_physical');
    expect(plan.params).toBeUndefined();
  });

  it('keeps an oversized model file-backed when there is no swap to borrow', () => {
    const plan = planModelLoad(inputFor());

    expect(plan.mode).toBe('extended');
    expect(plan.reason).toBe('file_backed');
    expect(plan.budget.virtualBytes).toBe(0);
    expect(plan.params).toMatchObject({use_mmap: true, use_mlock: false});
  });

  it('refuses when not even the pages that must stay resident fit', () => {
    const plan = planModelLoad(
      inputFor({measure: measureOf(100 * GIB, 1 * MiB)}),
    );

    expect(plan.mode).toBe('refuse');
    expect(plan.reason).toBe('no_backing_store');
    expect(plan.requiredBytes).toBe(6 * GB);
  });

  it('names the crash when the model already killed the app once', () => {
    const plan = planModelLoad(
      inputFor({
        previousAttemptCrashed: true,
        measure: measureOf(100 * GIB, 1 * MiB),
      }),
    );

    expect(plan.reason).toBe('crash_without_backing_store');
  });

  it('refuses when the user turned virtual RAM off', () => {
    const plan = planModelLoad(
      inputFor({setting: 'off', budget: swapBudget(5 * GB, 4 * GB, 'zram')}),
    );

    expect(plan.mode).toBe('refuse');
    expect(plan.reason).toBe('disabled_by_setting');
  });

  it('loads from virtual RAM with cheaper parameters', () => {
    const budget = swapBudget(5 * GB, 8 * GB);
    const plan = planModelLoad(inputFor({budget}));

    expect(plan.mode).toBe('extended');
    expect(plan.reason).toBe('virtual_ram');
    expect(plan.params).toMatchObject({
      use_mmap: true,
      use_mlock: false,
      no_extra_bufts: true,
      n_ctx: 2048,
      state_cache_budget_mb: 64,
    });
    expect(plan.requiredBytes).toBeLessThanOrEqual(
      budget.physicalBytes + budget.virtualBytes,
    );
  });

  it('shrinks the context until the model fits', () => {
    const budget = swapBudget(5 * GB, 2 * GB, 'zram');
    const plan = planModelLoad(inputFor({budget}));

    expect(plan.mode).toBe('extended');
    expect(plan.params!.n_ctx).toBeLessThan(2048);
    // A batch bigger than the context it feeds is refused by llama.cpp.
    expect(plan.params!.n_batch).toBeLessThanOrEqual(plan.params!.n_ctx);
    expect(plan.params!.n_ubatch).toBeLessThanOrEqual(plan.params!.n_batch);
  });

  it('refuses when even the smallest context will not fit', () => {
    const plan = planModelLoad(
      inputFor({
        budget: swapBudget(1 * GB, 1 * GB, 'zram'),
        measure: measureOf(100 * GIB, 1 * MiB),
      }),
    );

    expect(plan.mode).toBe('refuse');
    expect(plan.reason).toBe('beyond_backing_store');
    expect(plan.requiredBytes).toBe(100 * GIB + MIN_EXTENDED_N_CTX * MiB);
  });

  it('keeps f16 caches where flash attention cannot quantize', () => {
    const budget = swapBudget(5 * GB, 8 * GB);
    const opencl = planModelLoad(inputFor({budget, backend: 'opencl'}));
    const cpu = planModelLoad(inputFor({budget, backend: 'cpu'}));

    expect(opencl.params).toMatchObject({
      flash_attn_type: 'off',
      cache_type_v: 'f16',
    });
    expect(cpu.params).toMatchObject({
      flash_attn_type: 'on',
      cache_type_v: 'q8_0',
    });
  });

  it('will not retry the load that just killed the app', () => {
    const fits = inputFor({requiredBytes: 4 * GB});
    const noSwap = planModelLoad({
      ...fits,
      previousAttemptCrashed: true,
    });
    const withSwap = planModelLoad({
      ...fits,
      previousAttemptCrashed: true,
      budget: swapBudget(5 * GB, 4 * GB),
    });

    // Same verdict as an oversized model: the user's own parameters are out.
    expect(noSwap.mode).toBe('extended');
    expect(noSwap.reason).toBe('file_backed');
    expect(withSwap.mode).toBe('extended');
    expect(withSwap.reason).toBe('virtual_ram');
  });
});

describe('forcedExtendedPlan', () => {
  it('offers the cheapest layout with nowhere to spill', () => {
    const plan = forcedExtendedPlan(inputFor());

    expect(plan?.mode).toBe('extended');
    expect(plan?.params).toMatchObject({use_mmap: true, use_mlock: false});
  });

  it('respects a user who switched virtual RAM off', () => {
    expect(forcedExtendedPlan(inputFor({setting: 'off'}))).toBeUndefined();
  });
});
