jest.unmock('../../store');

import {runInAction} from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ContextParams} from 'llama.rn';

import NativeHardwareInfo from '../../specs/NativeHardwareInfo';
import type {MemoryStats} from '../../specs/NativeHardwareInfo';
import {basicModel} from '../../../jest/fixtures/models';
import {Model} from '../../utils/types';
import {modelStore} from '..';
import {LOAD_ATTEMPT_KEY} from '../ModelStore';

const getMemoryStats = NativeHardwareInfo.getMemoryStats as jest.Mock;

const GB = 1000 * 1000 * 1000;

// The fixture has no GGUF metadata, so its requirement is size × 1.2: 2.4 GB
// for a 2 GB file. The ceiling below is deliberately under that.
const MODEL_BYTES = 2.4 * GB;
const PHYSICAL_BYTES = 1 * GB;

const stats = (overrides: Partial<MemoryStats> = {}): MemoryStats => ({
  totalBytes: 8 * GB,
  availableBytes: 3 * GB,
  swapTotalBytes: 0,
  swapFreeBytes: 0,
  swapKinds: [],
  ...overrides,
});

const withSwap = (bytes: number, kind = 'file') =>
  stats({swapTotalBytes: bytes, swapFreeBytes: bytes, swapKinds: [kind]});

const planFor = (model: Model) =>
  (modelStore as any).buildMemoryPlan(model, undefined, undefined);

const forcedPlanFor = (model: Model) =>
  (modelStore as any).forcedMemoryPlan(model, undefined, undefined);

describe('ModelStore virtual RAM', () => {
  let model: Model;
  let createLlamaContext: jest.Mock;

  beforeEach(async () => {
    await AsyncStorage.clear();
    model = {...basicModel, id: 'oversized/model.gguf', isDownloaded: true};
    modelStore.setExtendedRamSetting('auto');
    runInAction(() => {
      modelStore.contextInitParams.devices = ['cpu'];
      modelStore.availableMemoryCeiling = undefined;
      modelStore.largestSuccessfulLoad = PHYSICAL_BYTES;
      modelStore.lastCrashedModelId = undefined;
      modelStore.memoryStats = null;
    });
    createLlamaContext = jest.fn();
    (modelStore as any).createLlamaContext = createLlamaContext;
    // A phone with nothing to borrow, unless a test says otherwise.
    getMemoryStats.mockResolvedValue(stats());
  });

  describe('memoryBudget', () => {
    it('has nothing to say before the counters have been read', async () => {
      expect(modelStore.memoryBudget).toBeUndefined();
    });

    it('reads the backing store the phone actually offers', async () => {
      getMemoryStats.mockResolvedValue(withSwap(4 * GB));

      await modelStore.refreshMemoryStats();

      const budget = modelStore.memoryBudget!;
      expect(budget.hasVirtualRam).toBe(true);
      expect(budget.physicalBytes).toBe(PHYSICAL_BYTES);
      // Only the free half-ish of the pool, and only at the zram/file rate.
      expect(budget.virtualBytes).toBeCloseTo(4 * GB * 0.75 * 0.7, -6);
    });

    it('keeps working when the native read fails', async () => {
      getMemoryStats.mockRejectedValue(new Error('no /proc/meminfo'));

      await expect(modelStore.refreshMemoryStats()).resolves.toBeNull();
      expect(modelStore.memoryBudget).toBeUndefined();
    });
  });

  describe('planning a load', () => {
    it('borrows virtual RAM instead of crashing', async () => {
      getMemoryStats.mockResolvedValue(withSwap(4 * GB));

      const plan = await planFor(model);

      expect(plan.mode).toBe('extended');
      expect(plan.reason).toBe('virtual_ram');
      // Weights stay in the file and the user keeps the context they asked for.
      expect(plan.params).toMatchObject({
        use_mmap: true,
        use_mlock: false,
        no_extra_bufts: true,
        n_ctx: modelStore.contextInitParams.n_ctx,
      });
    });

    it('keeps the weights file-backed when the phone has no swap', async () => {
      getMemoryStats.mockResolvedValue(stats());

      const plan = await planFor(model);

      expect(plan.mode).toBe('refuse');
      expect(plan.reason).toBe('no_backing_store');
      expect(plan.requiredBytes).toBeCloseTo(MODEL_BYTES, -6);
    });

    it('never loads a model that just closed the app with its own parameters', async () => {
      getMemoryStats.mockResolvedValue(stats());
      runInAction(() => {
        // Even a model inside the ceiling gets the second look: the ceiling is
        // a forecast, and the app dying mid-load outranks it.
        modelStore.largestSuccessfulLoad = 4 * GB;
        modelStore.lastCrashedModelId = model.id;
      });

      const plan = await planFor(model);

      expect(plan.mode).toBe('extended');
      expect(plan.reason).toBe('file_backed');
    });

    it('leaves a model that fits in RAM exactly as the user configured it', async () => {
      getMemoryStats.mockResolvedValue(stats());
      runInAction(() => {
        modelStore.largestSuccessfulLoad = 4 * GB;
      });

      const plan = await planFor(model);

      expect(plan.mode).toBe('normal');
      expect(plan.params).toBeUndefined();
    });

    it('does nothing behind the back of a user who turned it off', async () => {
      getMemoryStats.mockResolvedValue(withSwap(4 * GB));
      modelStore.setExtendedRamSetting('off');

      await expect(planFor(model)).resolves.toMatchObject({
        reason: 'disabled_by_setting',
      });
      await expect(forcedPlanFor(model)).resolves.toBeUndefined();
    });
  });

  describe('recovering a load that died mid-flight', () => {
    it('adopts a marker the previous process left behind', async () => {
      await AsyncStorage.setItem(
        LOAD_ATTEMPT_KEY,
        JSON.stringify({modelId: model.id, ts: Date.now()}),
      );

      await (modelStore as any).adoptLoadCrashMarker();

      expect(modelStore.lastCrashedModelId).toBe(model.id);
      // Consumed, so a later launch does not blame the same model twice.
      await expect(AsyncStorage.getItem(LOAD_ATTEMPT_KEY)).resolves.toBeNull();
    });

    it('ignores a marker older than the app could have been killed by', async () => {
      await AsyncStorage.setItem(
        LOAD_ATTEMPT_KEY,
        JSON.stringify({modelId: model.id, ts: Date.now() - 60 * 60 * 1000}),
      );

      await (modelStore as any).adoptLoadCrashMarker();

      expect(modelStore.lastCrashedModelId).toBeUndefined();
    });

    it('clears the marker once the context is up', async () => {
      await (modelStore as any).markLoadAttempt(model.id);
      await expect(AsyncStorage.getItem(LOAD_ATTEMPT_KEY)).resolves.toContain(
        model.id,
      );

      await (modelStore as any).clearLoadAttempt();
      await expect(AsyncStorage.getItem(LOAD_ATTEMPT_KEY)).resolves.toBeNull();
    });
  });

  describe('loading with a fallback', () => {
    const baseSettings = {
      use_mmap: false,
      n_ctx: 2048,
    } as unknown as Omit<ContextParams, 'model'>;
    const normalPlan = {
      mode: 'normal',
      reason: 'fits_physical',
      requiredBytes: MODEL_BYTES,
    };

    it('retries once from backing store when the load runs out of memory', async () => {
      getMemoryStats.mockResolvedValue(withSwap(4 * GB));
      createLlamaContext
        .mockRejectedValueOnce(new Error('ggml_alloc_buffer: out of memory'))
        .mockResolvedValueOnce({id: 'retry'});

      const loaded = await (modelStore as any).loadWithMemoryFallback(
        '/path/to/model.gguf',
        baseSettings,
        normalPlan,
        model,
      );

      expect(createLlamaContext).toHaveBeenCalledTimes(2);
      expect(loaded.ctx).toEqual({id: 'retry'});
      expect(loaded.settings).toMatchObject({
        use_mmap: true,
        use_mlock: false,
        no_extra_bufts: true,
      });
      expect(loaded.plan.mode).toBe('extended');
    });

    it('passes an unrelated failure straight back', async () => {
      createLlamaContext.mockRejectedValueOnce(
        new Error('chat template is invalid'),
      );

      await expect(
        (modelStore as any).loadWithMemoryFallback(
          '/path/to/model.gguf',
          baseSettings,
          normalPlan,
          model,
        ),
      ).rejects.toThrow('chat template is invalid');
      expect(createLlamaContext).toHaveBeenCalledTimes(1);
    });

    it('does not retry when the user refused to spill', async () => {
      modelStore.setExtendedRamSetting('off');
      createLlamaContext.mockRejectedValueOnce(new Error('out of memory'));

      await expect(
        (modelStore as any).loadWithMemoryFallback(
          '/path/to/model.gguf',
          baseSettings,
          normalPlan,
          model,
        ),
      ).rejects.toThrow('out of memory');
      expect(createLlamaContext).toHaveBeenCalledTimes(1);
    });

    it('uses the plan it was given without asking the phone again', async () => {
      const extendedPlan = {
        mode: 'extended',
        reason: 'virtual_ram',
        requiredBytes: MODEL_BYTES,
        params: {
          use_mmap: true,
          use_mlock: false,
          no_extra_bufts: true,
          flash_attn_type: 'on',
          cache_type_k: 'q8_0',
          cache_type_v: 'q8_0',
          n_ctx: 512,
          n_batch: 512,
          n_ubatch: 256,
          state_cache_budget_mb: 64,
        },
      };
      createLlamaContext.mockResolvedValueOnce({id: 'first'});

      const loaded = await (modelStore as any).loadWithMemoryFallback(
        '/path/to/model.gguf',
        baseSettings,
        extendedPlan,
        model,
      );

      expect(createLlamaContext).toHaveBeenCalledTimes(1);
      expect(createLlamaContext.mock.calls[0][1]).toMatchObject({
        use_mmap: true,
        n_ctx: 512,
      });
      expect(loaded.settings.use_mmap).toBe(true);
    });
  });
});
