import {ApiServerStore} from '../ApiServerStore';
import {modelStore} from '../ModelStore';

jest.mock('../ModelStore', () => {
  const mockModelStore: any = {
    models: [
      {
        id: 'test-model-1',
        name: 'Qwen2.5-3B-Instruct',
        isDownloaded: true,
        size: 1_800_000_000,
      },
    ],
    context: null as any,
    activeModelId: undefined as string | undefined,
    initContext: jest.fn(async (m: any) => {
      mockModelStore.activeModelId = m.id;
      mockModelStore.context = {
        completion: jest.fn(async () => ({
          text: 'Salom! Men tayyorman.',
          timings: {prompt_n: 5, predicted_n: 6},
          stopped_limit: false,
        })),
      };
    }),
    releaseContext: jest.fn(async () => {
      mockModelStore.context = undefined;
      mockModelStore.activeModelId = undefined;
    }),
  };
  return {modelStore: mockModelStore};
});

describe('ApiServerStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (modelStore as any).context = undefined;
    (modelStore as any).activeModelId = undefined;
  });

  it('requires a downloaded model before deploying', async () => {
    const store = new ApiServerStore();
    const res = await store.start();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no_model');
  });

  it('auto-unloads model after 10 minutes of inactivity and reloads on new request', async () => {
    jest.useFakeTimers();
    const store = new ApiServerStore();
    store.setDeployedModel(modelStore.models[0]!);

    const startRes = await store.start();
    expect(startRes.ok).toBe(true);
    expect(store.isRunning).toBe(true);
    expect(modelStore.initContext).toHaveBeenCalledTimes(1);
    expect(store.isModelInRam).toBe(true);

    // Advance 10 minutes (600 seconds)
    jest.advanceTimersByTime(600 * 1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(modelStore.releaseContext).toHaveBeenCalledTimes(1);
    expect(store.isModelInRam).toBe(false);

    // Simulate incoming request reloading from storage
    await store.loadIntoRamManually();
    expect(modelStore.initContext).toHaveBeenCalledTimes(2);
    expect(store.isModelInRam).toBe(true);

    await store.stop();
    jest.useRealTimers();
  });
});
