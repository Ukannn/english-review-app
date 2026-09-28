/** Only foreground, engaged time counts. Waiting for AI/network never counts. */
export class ActiveTime {
  private lastTick: number;
  private lastInteraction: number;
  constructor(now = Date.now()) { this.lastTick = now; this.lastInteraction = now; }
  interact(now = Date.now()) { this.lastInteraction = now; }
  tick(eligible: boolean, now = Date.now()): number {
    const start = this.lastTick;
    this.lastTick = now;
    if (!eligible) return 0;
    return Math.max(0, Math.min(now, this.lastInteraction + 60_000) - start) / 1000;
  }
}
