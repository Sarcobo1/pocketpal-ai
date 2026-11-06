import type {CompletionEngine} from '../utils/completionTypes';

/**
 * Who the right belongs to. A completion is a turn the user asked for and is
 * never cut short; `speech` is the model voicing the previous one, which a
 * queued turn may stop rather than wait behind.
 */
export type GenerationHolder = 'completion' | 'speech';

/**
 * The exclusive right to run one generation on the engine that was current
 * when it was granted. The holder stops its engine calls once `signal`
 * aborts and calls `end()` after its last write.
 */
export interface GenerationLease {
  readonly engine: CompletionEngine;
  readonly holder: GenerationHolder;
  readonly signal: AbortSignal;
  abort(): void;
  end(): void;
}

class Lease implements GenerationLease {
  private readonly controller = new AbortController();
  private ended = false;

  constructor(
    readonly engine: CompletionEngine,
    readonly holder: GenerationHolder,
    private readonly onEnd: (lease: Lease) => void,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(): void {
    this.controller.abort();
  }

  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.onEnd(this);
  }
}

/**
 * Holds at most one lease. Waiting acquirers are served in arrival order,
 * each only after the previous lease has ended.
 */
export class GenerationSlot {
  private active: Lease | null = null;
  private activeEnded: Promise<void> = Promise.resolve();
  private grantedAt = 0;
  private turnsEnded: Promise<void> = Promise.resolve();
  private queuedAcquirers = 0;

  get isBusy(): boolean {
    return this.active !== null || this.queuedAcquirers > 0;
  }

  /** Who holds the right now, or null when the context is free. */
  get holder(): GenerationHolder | null {
    return this.active?.holder ?? null;
  }

  /** How long the holder has had it, in ms — 0 when the context is free. */
  get holderMs(): number {
    return this.active === null ? 0 : Date.now() - this.grantedAt;
  }

  /**
   * Waits at most `waitMs` for an utterance in hand to release the context,
   * and then cuts it. Only a speech lease is cut: a completion ahead of this
   * one is a turn somebody asked for, and the queue already serves it first.
   *
   * `no-speech` says there was no utterance to wait for — the context may well
   * be busy with a turn, which this leaves to the queue. `waited` is the
   * speaker finishing on its own, `cut` is the stop landing, and `stuck` is a
   * stopped speaker that had not let go by the second deadline; the caller's
   * own queue still waits behind it, so nothing runs on top of it either way.
   */
  async yieldSpeech(waitMs: number): Promise<YieldOutcome> {
    const held = this.active;
    if (held?.holder !== 'speech') {
      return 'no-speech';
    }
    const released = this.activeEnded;
    if (await settledWithin(released, waitMs)) {
      return 'waited';
    }
    held.abort();
    return (await settledWithin(released, waitMs)) ? 'cut' : 'stuck';
  }

  /**
   * Resolves once every earlier acquirer has had its turn and `beforeGrant`
   * has settled; then grants a lease on `grantEngine()`, or resolves null
   * when that returns null.
   */
  async acquire(
    beforeGrant: () => Promise<unknown>,
    grantEngine: () => CompletionEngine | null,
    holder: GenerationHolder = 'completion',
  ): Promise<GenerationLease | null> {
    this.queuedAcquirers += 1;
    const previousTurnEnded = this.turnsEnded;
    let endTurn!: () => void;
    this.turnsEnded = new Promise(resolve => {
      endTurn = resolve;
    });
    try {
      await previousTurnEnded;
      await beforeGrant().catch(() => {});
    } finally {
      this.queuedAcquirers -= 1;
    }
    const engine = grantEngine();
    if (!engine) {
      endTurn();
      return null;
    }
    return this.grant(engine, holder, endTurn);
  }

  /** Grants at once, or returns null while a lease is held or acquirers wait. */
  tryAcquire(
    grantEngine: () => CompletionEngine | null,
    holder: GenerationHolder = 'completion',
  ): GenerationLease | null {
    if (this.isBusy) {
      return null;
    }
    const engine = grantEngine();
    if (!engine) {
      return null;
    }
    let endTurn!: () => void;
    this.turnsEnded = new Promise(resolve => {
      endTurn = resolve;
    });
    return this.grant(engine, holder, endTurn);
  }

  /** Aborts the held lease, if any; resolves when it has ended. */
  abortActive(): Promise<void> {
    this.active?.abort();
    return this.activeEnded;
  }

  private grant(
    engine: CompletionEngine,
    holder: GenerationHolder,
    endTurn: () => void,
  ): Lease {
    let markEnded!: () => void;
    this.activeEnded = new Promise(resolve => {
      markEnded = resolve;
    });
    const lease = new Lease(engine, holder, ended => {
      if (this.active === ended) {
        this.active = null;
      }
      markEnded();
      endTurn();
    });
    this.active = lease;
    return lease;
  }
}

/** What waiting for the context's speaker came to, in ms of patience. */
export type YieldOutcome = 'no-speech' | 'waited' | 'cut' | 'stuck';

/**
 * `true` when `released` settled inside `ms`, `false` when the deadline came
 * first. A late settle resolves nothing: the caller has already moved on, and
 * the queue it moves on to is the thing that still waits for the release.
 */
const settledWithin = (
  released: Promise<unknown>,
  ms: number,
): Promise<boolean> =>
  new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    released.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
