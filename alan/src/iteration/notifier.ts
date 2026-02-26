/**
 * Telegram Notifier — sends iteration progress notifications.
 */
import type { IterationResult, IterationSummary, Hypothesis } from './types.js';

export class Notifier {
  private botToken: string;
  private chatId: string;

  constructor({ botToken, chatId }: { botToken: string; chatId: string }) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  /**
   * Send a raw text message via Telegram. Silent on failure.
   */
  async notify(message: string): Promise<void> {
    try {
      await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: message,
            parse_mode: 'HTML',
          }),
        },
      );
    } catch {
      // Silent — notifications are best-effort
    }
  }

  /**
   * Notify that an iteration has started.
   */
  async iterationStarted(
    iteration: number,
    hypothesis: Hypothesis,
  ): Promise<void> {
    const msg = [
      `\u{1F504} <b>Iteration ${iteration} started</b>`,
      `Target: ${hypothesis.targetDimension.replace(/_/g, ' ')}`,
      `Tier: ${hypothesis.tier}`,
      `Description: ${hypothesis.description}`,
    ].join('\n');

    await this.notify(msg);
  }

  /**
   * Notify that an iteration has completed.
   */
  async iterationCompleted(result: IterationResult): Promise<void> {
    const icon = result.committed ? '\u2705' : '\u274C';
    const action = result.committed ? 'committed' : 'reverted';
    const sign = result.improvement >= 0 ? '+' : '';

    const msg = [
      `${icon} <b>Iteration ${result.iteration} ${action}</b>`,
      `Score: ${result.beforeScore.toFixed(2)} \u2192 ${result.afterScore.toFixed(2)} (${sign}${result.improvement.toFixed(3)})`,
    ].join('\n');

    await this.notify(msg);
  }

  /**
   * Send a final summary of all iterations.
   */
  async summarize(summary: IterationSummary): Promise<void> {
    const sign = summary.totalImprovement >= 0 ? '+' : '';

    const msg = [
      `\u{1F4CA} <b>Iteration complete</b>`,
      `${summary.totalIterations} iteration(s)`,
      `${summary.startScore.toFixed(2)} \u2192 ${summary.endScore.toFixed(2)} (${sign}${summary.totalImprovement.toFixed(3)})`,
      `Reason: ${summary.stoppedReason}`,
    ].join('\n');

    await this.notify(msg);
  }
}
