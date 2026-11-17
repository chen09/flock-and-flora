// Minimal typed signal used by the simulation event bus.
export class Signal<T> {
  private listeners = new Set<(payload: T) => void>();

  on(fn: (payload: T) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  off(fn: (payload: T) => void): void {
    this.listeners.delete(fn);
  }

  emit(payload: T): void {
    for (const fn of [...this.listeners]) fn(payload);
  }

  clear(): void {
    this.listeners.clear();
  }

  get count(): number {
    return this.listeners.size;
  }
}
