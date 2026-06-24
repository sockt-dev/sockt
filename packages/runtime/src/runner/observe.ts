import type { ExecutionContext } from "../types.ts";
import type { ActResult } from "./act.ts";

export function observePhase(ctx: ExecutionContext, actionResult: ActResult): string {
  let observation: string;

  if (actionResult.toolResult) {
    const { success, output, error } = actionResult.toolResult;
    if (success) {
      observation = `Tool execution successful. Output: ${typeof output === "string" ? output : JSON.stringify(output)}`;
    } else {
      observation = `Tool execution failed. Error: ${error}`;
    }
  } else if (actionResult.llmOutput) {
    observation = actionResult.llmOutput;
  } else {
    observation = "No result produced.";
  }

  ctx.messages.push({
    role: "user",
    content: `Observation: ${observation}`,
  });

  return observation;
}
