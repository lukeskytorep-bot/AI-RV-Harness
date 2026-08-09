import type { AppSettings } from "../types";

export class SettingsSaveQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly save: (settings: AppSettings) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  enqueue(settings: AppSettings): void {
    const snapshot = structuredClone(settings);
    this.tail = this.tail
      .catch(() => undefined)
      .then(() => this.save(snapshot))
      .catch((error) => this.onError(error));
  }

  async idle(): Promise<void> {
    await this.tail;
  }
}
