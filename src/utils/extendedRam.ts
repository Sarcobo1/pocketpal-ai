import {CacheType} from './types';
import {isCacheTypeVSafe, type BackendType} from './flashAttnCompatibility';
import type {MemoryStats} from '../specs/NativeHardwareInfo';

/**
 * What the user allows the app to do when a model is too big for physical RAM.
 *
 * - 'auto': spill into virtual RAM when needed, and say so before loading
 * - 'on':   same, without asking
 * - 'off':  never change the load parameters — the old warn-then-hope behaviour
 */
export type ExtendedRamSetting = 'auto' | 'on' | 'off';

export type MemoryPlanMode = 'normal' | 'extended' | 'refuse';

export type MemoryPlanReason =
  /** Inside the calibrated physical ceiling. */
  | 'fits_physical'
  /** Needed backing store and the phone has it. */
  | 'virtual_ram'
  /** No backing store, but file-backed weights alone keep the load alive. */
  | 'file_backed'
  /** Too big and the phone offers nowhere to spill. */
  | 'no_backing_store'
  /** Spilling would still not fit, even at the smallest context. */
  | 'beyond_backing_store'
  /** The user turned backing store off. */
  | 'disabled_by_setting'
  /** No backing store, and this model already killed the app once. */
  | 'crash_without_backing_store';

/** How much of a spilled page's physical RAM one byte of backing store frees. */
const GAIN_BY_KIND: Record<string, number> = {
  // zram lives *inside* RAM, compressed: a page moved there is smaller but
  // still resident, so it frees less than a byte on flash.
  zram: 0.6,
  // A swap file or partition is real spare capacity on storage.
  file: 0.7,
  partition: 0.7,
};
/** Used when /proc/swaps could not be read but SwapTotal says swap exists. */
const UNKNOWN_KIND_GAIN = 0.5;
/** The rest of the system is swapping too; we do not get the whole pool. */
const SYSTEM_RESERVE = 0.75;

/** Below this there is no useful conversation left to have. */
export const MIN_EXTENDED_N_CTX = 512;

export interface MemoryBudget {
  /** Largest load the physical RAM is known to carry (calibrated). */
  physicalBytes: number;
  /** Extra capacity the backing store is credited with; 0 when there is none. */
  virtualBytes: number;
  totalBytes: number;
  hasVirtualRam: boolean;
  swapKinds: string[];
}

export const physicalBytesOf = (
  largestSuccessfulLoad?: number,
  availableMemoryCeiling?: number,
): number => Math.max(largestSuccessfulLoad ?? 0, availableMemoryCeiling ?? 0);

/** Turn native counters plus the calibration into a load budget. */
export const memoryBudgetFromStats = (
  stats: MemoryStats | null,
  physicalCeilingBytes: number,
): MemoryBudget => {
  const total = stats?.totalBytes ?? 0;
  const swapTotal = stats?.swapTotalBytes ?? 0;
  const swapFree = Math.min(stats?.swapFreeBytes ?? 0, swapTotal);
  const swapKinds = stats?.swapKinds ?? [];

  if (swapTotal <= 0 || swapFree <= 0) {
    return {
      physicalBytes: physicalCeilingBytes,
      virtualBytes: 0,
      totalBytes: total,
      hasVirtualRam: false,
      swapKinds: [],
    };
  }

  // Several devices can be active at once (zram plus a swap partition); the
  // least generous one decides, so a compressed pool is never over-counted.
  const gains = swapKinds.map(kind => GAIN_BY_KIND[kind] ?? UNKNOWN_KIND_GAIN);
  const gain = gains.length ? Math.min(...gains) : UNKNOWN_KIND_GAIN;

  return {
    physicalBytes: physicalCeilingBytes,
    virtualBytes: swapFree * SYSTEM_RESERVE * gain,
    totalBytes: total,
    hasVirtualRam: true,
    swapKinds,
  };
};

/**
 * The init parameters that make an oversized load survivable. Each one trades
 * speed for residency:
 * - mmap on: weights stay file-backed, so the kernel can drop pages instead of
 *   being forced to hand them to the low-memory killer
 * - mlock off: do not demand that the whole model be resident
 * - repack off: repacked weights are an anonymous copy that cannot be paged
 * - quantized KV (only where flash attention can carry it): the cache is the
 *   part that grows while you talk, and it is anonymous memory
 */
export interface ExtendedRamParams {
  use_mmap: true;
  use_mlock: false;
  no_extra_bufts: true;
  flash_attn_type: 'on' | 'off';
  cache_type_k: CacheType;
  cache_type_v: CacheType;
  n_ctx: number;
  n_batch: number;
  n_ubatch: number;
  state_cache_budget_mb: number;
}

export interface MemoryPlan {
  mode: MemoryPlanMode;
  reason: MemoryPlanReason;
  budget: MemoryBudget;
  /** Requirement at the parameters this plan ends up using. */
  requiredBytes: number;
  params?: ExtendedRamParams;
}

export interface PlanInput {
  /** Requirement under the user's own settings. */
  requiredBytes: number;
  budget: MemoryBudget;
  setting: ExtendedRamSetting;
  /** The last attempt to load this model left the process dead mid-load. */
  previousAttemptCrashed: boolean;
  n_ctx: number;
  n_batch: number;
  n_ubatch: number;
  backend: BackendType;
  state_cache_budget_mb: number;
  /** Re-measure the model at a candidate parameter set. */
  measure: (candidate: ExtendedRamParams) => number;
}

const candidateFor = (
  n_ctx: number,
  input: PlanInput,
  quantizedKV: boolean,
): ExtendedRamParams => {
  const n_batch = Math.min(input.n_batch, n_ctx);
  return {
    use_mmap: true,
    use_mlock: false,
    no_extra_bufts: true,
    flash_attn_type: quantizedKV ? 'on' : 'off',
    cache_type_k: quantizedKV ? CacheType.Q8_0 : CacheType.F16,
    cache_type_v: quantizedKV ? CacheType.Q8_0 : CacheType.F16,
    n_ctx,
    n_batch,
    n_ubatch: Math.min(input.n_ubatch, n_batch),
    state_cache_budget_mb: Math.min(input.state_cache_budget_mb, 64),
  };
};

/** n_ctx values to try, largest first: the user's own, then down to the floor. */
export const contextLadder = (n_ctx: number): number[] => {
  const steps = new Set<number>([Math.max(n_ctx, MIN_EXTENDED_N_CTX)]);
  let power = 1;
  while (power * 2 <= n_ctx) {
    power *= 2;
  }
  for (; power >= MIN_EXTENDED_N_CTX; power /= 2) {
    steps.add(power);
  }
  return [...steps].sort((a, b) => b - a);
};

const refuse = (
  input: PlanInput,
  reason: MemoryPlanReason,
  requiredBytes: number,
): MemoryPlan => ({
  mode: 'refuse',
  reason,
  budget: input.budget,
  requiredBytes,
});

/**
 * The cheapest layout that fits physical RAM plus backing store, largest
 * context first. When nothing fits, the smallest candidate still comes back —
 * it is the best available offer, and the caller decides whether to take it.
 */
const cheapestExtended = (input: PlanInput) => {
  const capacity = input.budget.physicalBytes + input.budget.virtualBytes;
  // A quantized KV cache only holds if this backend can run flash attention;
  // llama.cpp refuses the combination outright, which is the crash we are
  // trying to avoid, so fall back to f16 rather than push it.
  const quantizedKV = isCacheTypeVSafe(
    CacheType.Q8_0,
    'on',
    input.backend,
  ).safe;

  let best: {params: ExtendedRamParams; needed: number} | undefined;
  for (const n_ctx of contextLadder(input.n_ctx)) {
    const params = candidateFor(n_ctx, input, quantizedKV);
    const needed = input.measure(params);
    if (!best || needed < best.needed) {
      best = {params, needed};
    }
    if (needed <= capacity) {
      return {fits: true, ...best};
    }
  }
  return {fits: false, ...best!};
};

/**
 * Decide how to load a model without gambling on a process kill: keep the
 * current parameters, spill into virtual RAM with a cheaper layout, or stop.
 */
export const planModelLoad = (input: PlanInput): MemoryPlan => {
  const {requiredBytes, budget} = input;

  if (requiredBytes <= budget.physicalBytes && !input.previousAttemptCrashed) {
    return {
      mode: 'normal',
      reason: 'fits_physical',
      budget,
      requiredBytes,
    };
  }

  if (input.setting === 'off') {
    return refuse(input, 'disabled_by_setting', requiredBytes);
  }

  if (!budget.hasVirtualRam) {
    // No backing store to spill into, but mmap on its own still rescues an
    // oversized load: read-only weights are clean file pages, and the kernel
    // reclaims those rather than killing the process. Offer that layout before
    // telling the user the model is out of reach.
    const rescue = cheapestExtended(input);
    if (rescue.fits) {
      return {
        mode: 'extended',
        reason: 'file_backed',
        budget,
        requiredBytes: rescue.needed,
        params: rescue.params,
      };
    }
    return refuse(
      input,
      input.previousAttemptCrashed
        ? 'crash_without_backing_store'
        : 'no_backing_store',
      input.requiredBytes,
    );
  }

  const offer = cheapestExtended(input);
  if (offer.fits) {
    return {
      mode: 'extended',
      reason: 'virtual_ram',
      budget,
      requiredBytes: offer.needed,
      params: offer.params,
    };
  }
  return refuse(input, 'beyond_backing_store', offer.needed);
};

/**
 * The spill, asked for as the answer to a failure rather than to a forecast:
 * the load already ran out of memory, so take the cheapest layout whatever the
 * budget says. Undefined only when the user has backing store turned off.
 */
export const forcedExtendedPlan = (
  input: PlanInput,
): MemoryPlan | undefined => {
  if (input.setting === 'off') {
    return undefined;
  }
  const offer = cheapestExtended(input);
  return {
    mode: 'extended',
    reason: 'virtual_ram',
    budget: input.budget,
    requiredBytes: offer.needed,
    params: offer.params,
  };
};
