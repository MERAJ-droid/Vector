import { generateText } from '../ai/client';
import { OperationBuffer } from './OperationBuffer';

export interface GuardianPayload {
  type: 'stuck' | 'velocity_drop';
  message: string;
  actionLabel?: string;
  actionType?: string;
  versionNumber?: number;
}

export class CodeGuardianAgent {
  private readonly buffer = new OperationBuffer();
  private intervalId: NodeJS.Timeout | null = null;
  private lastStuckInsightAt = 0;
  private lastVelocityInsightAt = 0;
  private tokenBudget = 50_000;

  private readonly EVAL_INTERVAL_MS = 15_000;
  private readonly COOLDOWN_MS = 3 * 60_000;
  private readonly TOKENS_PER_CALL = 800;
  private readonly VELOCITY_DROP_THRESHOLD = 0.2;
  private readonly MIN_OPS_FOR_VELOCITY = 10;

  constructor(
    private readonly roomName: string,
    private readonly broadcast: (payload: GuardianPayload) => void,
    private readonly createCheckpoint: () => Promise<number | null>
  ) {}

  recordUpdate(byteSize: number, connectionCount: number): void {
    this.buffer.record(byteSize, connectionCount);
  }

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.evaluate().catch(() => {});
    }, this.EVAL_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private canFireInsight(type: 'stuck' | 'velocity_drop'): boolean {
    const lastAt = type === 'stuck' ? this.lastStuckInsightAt : this.lastVelocityInsightAt;
    return (
      Date.now() - lastAt >= this.COOLDOWN_MS &&
      this.tokenBudget >= this.TOKENS_PER_CALL
    );
  }

  private async evaluate(): Promise<void> {
    const totalOps = this.buffer.totalOpsInWindow();
    const isStuck = this.buffer.detectRepeatEdit() && totalOps > 0;
    const velocityRatio = this.buffer.velocityRatio();
    const velocityDrop =
      velocityRatio < this.VELOCITY_DROP_THRESHOLD &&
      totalOps >= this.MIN_OPS_FOR_VELOCITY;

    if (!isStuck && !velocityDrop) return;

    // Tier 3: proactive checkpoint on velocity drop (no AI call needed)
    let checkpointVersionNumber: number | null = null;
    if (velocityDrop) {
      try {
        checkpointVersionNumber = await this.createCheckpoint();
      } catch {
        // checkpoint failure is non-fatal
      }
    }

    const insightType = isStuck ? 'stuck' : 'velocity_drop';
    if (!this.canFireInsight(insightType)) return;

    // Tier 2: single short AI call to phrase the message naturally
    if (insightType === 'stuck') this.lastStuckInsightAt = Date.now();
    else this.lastVelocityInsightAt = Date.now();
    this.tokenBudget -= this.TOKENS_PER_CALL;

    const description = isStuck
      ? 'A collaborator appears to be rewriting the same code region repeatedly.'
      : `Editing activity has dropped significantly. Velocity ratio: ${velocityRatio.toFixed(2)}. A checkpoint was automatically saved.`;

    try {
      const message = await generateText(
        'You are a coding assistant. Reply with ONLY a single plain-English sentence of at most 10 words. No emoji, no hashtags, no markdown, no punctuation at the end.',
        description,
        60
      );

      this.broadcast({
        type: isStuck ? 'stuck' : 'velocity_drop',
        message: message.trim() || description,
        ...(velocityDrop && {
          actionLabel: 'View checkpoint',
          actionType: 'view-version',
          ...(checkpointVersionNumber !== null && { versionNumber: checkpointVersionNumber }),
        }),
      });

      console.log(`[Guardian] "${this.roomName}" ${isStuck ? 'stuck' : 'velocity_drop'} insight sent`);
    } catch {
      // AI unavailable — token budget already consumed, no insight sent
    }
  }
}