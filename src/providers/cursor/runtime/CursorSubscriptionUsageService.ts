import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  ProviderSubscriptionUsageService,
  ProviderSubscriptionUsageSnapshot,
  ProviderSubscriptionUsageWindow,
} from '../../../core/providers/types';
import { probeCursorUsage } from './probeCursorUsage';

export type CursorUsageProbe = (
  host: ProviderHost,
  signal?: AbortSignal,
) => Promise<readonly [ProviderSubscriptionUsageWindow, ProviderSubscriptionUsageWindow] | null>;

export class CursorSubscriptionUsageService implements ProviderSubscriptionUsageService {
  private snapshot: ProviderSubscriptionUsageSnapshot = {
    status: 'idle',
    windows: [],
  };
  private readonly listeners = new Set<(snapshot: ProviderSubscriptionUsageSnapshot) => void>();
  private inFlight: Promise<ProviderSubscriptionUsageSnapshot> | null = null;
  private abortController: AbortController | null = null;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly host: ProviderHost,
    private readonly probe: CursorUsageProbe = probeCursorUsage,
  ) {}

  getSnapshot(): ProviderSubscriptionUsageSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: ProviderSubscriptionUsageSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  refresh(): Promise<ProviderSubscriptionUsageSnapshot> {
    if (this.disposed) {
      return Promise.resolve(this.snapshot);
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    const requestGeneration = ++this.generation;
    const controller = new AbortController();
    this.abortController = controller;
    this.#setSnapshot({
      status: 'loading',
      windows: this.snapshot.windows,
      updatedAt: this.snapshot.updatedAt,
    });

    const flight = (async (): Promise<ProviderSubscriptionUsageSnapshot> => {
      try {
        const windows = await this.probe(this.host, controller.signal);
        if (this.disposed || requestGeneration !== this.generation) {
          return this.snapshot;
        }
        this.#setSnapshot(
          windows
            ? { status: 'ready', windows, updatedAt: Date.now() }
            : { status: 'unavailable', windows: [], updatedAt: Date.now() },
        );
        return this.snapshot;
      } catch {
        if (this.disposed || requestGeneration !== this.generation || controller.signal.aborted) {
          return this.snapshot;
        }
        this.#setSnapshot({
          status: 'unavailable',
          windows: [],
          updatedAt: Date.now(),
        });
        return this.snapshot;
      } finally {
        if (this.abortController === controller) {
          this.abortController = null;
          this.inFlight = null;
        }
      }
    })();

    this.inFlight = flight;
    return flight;
  }

  abortInFlight(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.inFlight = null;
    if (this.snapshot.status === 'loading') {
      this.snapshot = this.snapshot.windows.length === 2
        ? { status: 'ready', windows: this.snapshot.windows, updatedAt: this.snapshot.updatedAt }
        : { status: 'idle', windows: [] };
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.abortInFlight();
    this.listeners.clear();
  }

  #setSnapshot(next: ProviderSubscriptionUsageSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
