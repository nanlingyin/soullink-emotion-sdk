import type { CharacterState } from "./CharacterState";

export class CharacterStateMachine {
  private state: CharacterState = "IDLE";
  private enteredAt = 0;

  get current(): CharacterState {
    return this.state;
  }

  get phaseStartedAt(): number {
    return this.enteredAt;
  }

  transition(next: CharacterState, timeSeconds: number, force = false) {
    if (this.state === next && !force) return;
    this.state = next;
    this.enteredAt = timeSeconds;
  }

  reset(timeSeconds = 0) {
    this.state = "IDLE";
    this.enteredAt = timeSeconds;
  }

  elapsed(timeSeconds: number): number {
    return Math.max(0, timeSeconds - this.enteredAt);
  }
}
