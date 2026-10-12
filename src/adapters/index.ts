import { IPosAdapter } from "./types";
import { CloverAdapter } from "./CloverAdapter";

export class PosAdapterRegistry {
  private static adapters: Map<string, IPosAdapter> = new Map([
    ["clover", new CloverAdapter()],
  ]);

  static get(posType: string): IPosAdapter {
    const adapter = this.adapters.get(posType.toLowerCase());
    if (!adapter) {
      throw new Error(`Unsupported or unconfigured POS adapter: ${posType}`);
    }
    return adapter;
  }

  static isSupported(posType: string): boolean {
    return this.adapters.has(posType.toLowerCase());
  }

  static getSupportedTypes(): string[] {
    return Array.from(this.adapters.keys());
  }
}
