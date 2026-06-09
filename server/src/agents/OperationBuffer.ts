interface BufferEntry {
  timestamp: number;
  byteSize: number;
  connectionCount: number;
}

export class OperationBuffer {
  private readonly windowMs = 90_000;
  private entries: BufferEntry[] = [];

  record(byteSize: number, connectionCount: number): void {
    const now = Date.now();
    this.entries.push({ timestamp: now, byteSize, connectionCount });
    const cutoff = now - this.windowMs;
    this.entries = this.entries.filter(e => e.timestamp >= cutoff);
  }

  opsInWindow(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    return this.entries.filter(e => e.timestamp >= cutoff).length;
  }

  velocityRatio(): number {
    const recentOps = this.opsInWindow(30_000);
    const olderOps = this.opsInWindow(60_000) - recentOps;
    if (olderOps === 0) return recentOps > 0 ? 1 : 0;
    return recentOps / olderOps;
  }

  totalOpsInWindow(): number {
    return this.opsInWindow(60_000);
  }

  detectRepeatEdit(): boolean {
    const recent = this.entries.filter(e => e.timestamp >= Date.now() - 60_000);
    if (recent.length < 6) return false;

    const sizes = recent.slice(-6).map(e => e.byteSize);
    const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;

    let alternations = 0;
    for (let i = 1; i < sizes.length; i++) {
      if ((sizes[i - 1] > avg) !== (sizes[i] > avg)) alternations++;
    }

    // 4+ alternations out of 5 transitions = oscillating large/small = stuck pattern
    return alternations >= 4;
  }
}