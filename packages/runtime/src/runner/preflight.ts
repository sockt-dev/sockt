import type { AgentConfig, Task } from "@sockt/types";
import type { TaskOutcome } from "../types.ts";

// Matches the growth lead-generation intent, whether or not create_task
// tagged the subtask with skill: "lead-generation" explicitly.
const LEAD_GEN_PATTERN = /\b(lead(s| list| gen(eration)?)?|prospect(s|ing)?|contact list|scrape .*compan)/i;

/**
 * A growth lead-generation task with no search API key configured cannot
 * honestly produce a real lead list — web_search would silently fall back
 * to DuckDuckGo scraping or fail outright, and the model would be tempted
 * to invent plausible-looking contacts instead (exactly what
 * lead_provenance, verification/checks.ts, exists to catch after the
 * fact). Catching it before any LLM call runs is cheaper and more honest
 * than catching it after generation. Returns a short-circuit outcome when
 * the task can't be honestly attempted, else null. Called at the very top
 * of AgentRunner.runLoop, before skill injection or any LLM call.
 */
export function preflightCheck(agent: AgentConfig, task: Task): TaskOutcome | null {
  if (agent.department !== "growth") return null;

  const isLeadGen = task.targetSkill === "lead-generation" || LEAD_GEN_PATTERN.test(task.description);
  if (!isLeadGen) return null;

  const hasSearchKey = Boolean(process.env.TAVILY_API_KEY || process.env.BRAVE_SEARCH_API_KEY);
  if (hasSearchKey) return null;

  if (process.env.GROWTH_REQUIRE_SEARCH_API === "false") return null;

  return {
    status: "needs_input",
    question:
      "I can't generate a real lead list: no search API key is configured (TAVILY_API_KEY or BRAVE_SEARCH_API_KEY). " +
      "Configure one and reply here, or tell me to produce a search plan instead of actual leads.",
  };
}
