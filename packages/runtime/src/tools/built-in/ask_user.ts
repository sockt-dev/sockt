import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";

// Listed in the registry purely so plan.ts's tool-name grounding (see plan.ts)
// accepts "ask_user" as a valid step tool and doesn't strip it out. The
// handler below is never actually invoked — agent-runner.ts intercepts
// step.tool === "ask_user" before the ACT phase and returns a "needs_input"
// outcome directly, since asking a human isn't a tool call with a return
// value the agent can observe and keep going from in the same run.
export const askUserDefinition: ToolDefinition = {
  name: "ask_user",
  description: "Ask the human who requested this task a clarifying question when the task can't proceed without more information. Use sparingly — only when truly blocked, not to defer routine decisions.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The specific question to ask, phrased so a non-technical requester can answer it." },
    },
    required: ["question"],
  },
};

export const askUserHandler: ToolHandler = async () => {
  throw new Error("ask_user should be intercepted by agent-runner before execution, not invoked as a tool call");
};
