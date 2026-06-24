import type { TokenUsage } from "@sockt/types";
import type { TaskOutcome, TraceStep } from "../types.ts";

export class ExecutionTrace {
  private steps: TraceStep[] = [];
  private outcome: TaskOutcome | null = null;
  private readonly startTime: number;

  constructor(
    public readonly taskId: string,
    public readonly agentId: string,
  ) {
    this.startTime = performance.now();
  }

  addStep(step: TraceStep): void {
    this.steps.push(step);
  }

  getSteps(): TraceStep[] {
    return [...this.steps];
  }

  getDuration(): number {
    return Math.round(performance.now() - this.startTime);
  }

  getTokenUsage(): TokenUsage {
    let promptTokens = 0;
    let completionTokens = 0;

    for (const step of this.steps) {
      if (step.tokenUsage) {
        promptTokens += step.tokenUsage.promptTokens;
        completionTokens += step.tokenUsage.completionTokens;
      }
    }

    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
  }

  isSuccessful(): boolean {
    return this.outcome?.status === "completed";
  }

  setOutcome(outcome: TaskOutcome): void {
    this.outcome = outcome;
  }

  getOutcome(): TaskOutcome | null {
    return this.outcome;
  }

  toJSON(): object {
    return {
      taskId: this.taskId,
      agentId: this.agentId,
      steps: this.steps,
      outcome: this.outcome,
      durationMs: this.getDuration(),
      tokenUsage: this.getTokenUsage(),
    };
  }
}
