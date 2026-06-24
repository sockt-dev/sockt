import { rename } from "node:fs/promises";

export class CheckpointStore {
  private offsets = new Map<string, number>();
  private flushing: Promise<void> | null = null;

  constructor(private readonly path: string) {}

  getOffset(filePath: string): number {
    return this.offsets.get(filePath) ?? 0;
  }

  setOffset(filePath: string, offset: number): void {
    this.offsets.set(filePath, offset);
  }

  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    this.flushing = this.doFlush();
    await this.flushing;
    this.flushing = null;
  }

  private async doFlush(): Promise<void> {
    const data = Object.fromEntries(this.offsets);
    const tmpPath = this.path + ".tmp";
    await Bun.write(tmpPath, JSON.stringify(data));
    await rename(tmpPath, this.path);
  }

  async load(): Promise<void> {
    try {
      const file = Bun.file(this.path);
      if (!(await file.exists())) return;
      const data = await file.json();
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        this.offsets = new Map();
        return;
      }
      this.offsets = new Map(Object.entries(data));
    } catch {
      this.offsets = new Map();
    }
  }
}
