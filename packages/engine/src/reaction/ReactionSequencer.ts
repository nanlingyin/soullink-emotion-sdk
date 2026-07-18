import { scaleFACSFromNeutral } from "../facs/FACSUtils";
import type { PartialFACSLikeState } from "../facs/FACSLikeState";
import { evaluateExpressionTimeline, getTimelineDuration } from "../expression/ExpressionTimeline";
import type { RuntimeExpression } from "../expression/EmotionArchetype";

export class ReactionSequencer {
  private expression: RuntimeExpression | null = null;
  private startedAt = 0;

  start(expression: RuntimeExpression, timeSeconds: number) {
    this.expression = expression;
    this.startedAt = timeSeconds;
  }

  reset() {
    this.expression = null;
    this.startedAt = 0;
  }

  get currentExpression(): RuntimeExpression | null {
    return this.expression;
  }

  get duration(): number {
    return this.expression ? getTimelineDuration(this.expression.timeline) : 0;
  }

  elapsed(timeSeconds: number): number {
    return Math.max(0, timeSeconds - this.startedAt);
  }

  isComplete(timeSeconds: number): boolean {
    return Boolean(this.expression && this.elapsed(timeSeconds) >= this.duration);
  }

  evaluate(timeSeconds: number): PartialFACSLikeState {
    if (!this.expression) return {};
    return evaluateExpressionTimeline(this.expression.timeline, this.elapsed(timeSeconds));
  }

  hold(weight = 0.86): PartialFACSLikeState {
    return this.expression ? scaleFACSFromNeutral(this.expression.peakFACS, weight) : {};
  }
}
