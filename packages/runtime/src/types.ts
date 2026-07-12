import type {
  AgentConfig,
  Task,
  LlmClient,
  LlmMessage,
  HitlGate,
  ModelSelector,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "@sockt/types";
import type { ExecutionTrace } from "./trace/execution-trace.ts";
import type { ToolRegistry } from "./tools/registry.ts";

// ─── Task Outcome ────────────────────────────────────────────────────────────

export type TaskOutcome =
  | { status: "completed"; output: string }
  | { status: "escalated"; reason: string }
  | { status: "blocked"; dependency: string }
  | { status: "needs_input"; question: string };

// ─── Execution Context ───────────────────────────────────────────────────────

export interface ExecutionContext {
  agent: AgentConfig;
  task: Task;
  messages: LlmMessage[];
  trace: ExecutionTrace;
  budgetRemaining: number;
  signal: AbortSignal;
  /** Skills findRelevant() matched against the task description, set once in
   * runLoop after the existing findRelevant() call (previously the result
   * was only used for injectSkillContext and then discarded). Used by the
   * output gate (see verification/output-gate.ts) to pick which skill's
   * `checks` apply when the task has no explicit targetSkill. */
  matchedSkills: SkillFile[];
  /** One entry per failed output-gate attempt, appended by AgentRunner and
   * consumed by planPhase/reflectPhase so the next attempt actually sees why
   * the previous one failed — planPhase trims context to the system prompt
   * only by default (PLAN_CONTEXT_MESSAGES=0), so without this the feedback
   * would never reach the model. */
  gateFeedback: string[];
}

// ─── Agent Runner Config ─────────────────────────────────────────────────────

export interface AgentRunnerConfig {
  llmClient: LlmClient;
  toolRegistry: ToolRegistry;
  orchBaseUrl: string;
  hitlGate?: HitlGate;
  modelSelector?: ModelSelector;
  skillsDir?: string;
  maxPlanSteps?: number;
  reflectionEnabled?: boolean;
  /** Append-only JSONL path — one line per finished task with the full ExecutionTrace. Unset = no persistence. */
  traceLogPath?: string;
  /** Passed to this runner's internal HttpOrchClient — see its apiToken doc. */
  orchApiToken?: string;
  /** Default true. When false, finalizeCompletion skips the output gate
   * entirely and every completion is accepted as-is — see
   * verification/output-gate.ts and docs/ARCHITECTURE.md's output gate
   * section. Resolved from OUTPUT_GATE_ENABLED in serve.ts. */
  outputGateEnabled?: boolean;
}

// ─── Docker Sandbox Config ───────────────────────────────────────────────────

export interface DockerSandboxConfig {
  socketPath?: string;
  networkName?: string;
  defaultImage?: string;
  volumeBasePath?: string;
}

// ─── Tool Types ──────────────────────────────────────────────────────────────

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

// ─── Skill Types ─────────────────────────────────────────────────────────────

export interface SkillFile {
  name: string;
  description: string;
  steps: SkillStep[];
  preconditions: string[];
  successCriteria: string[];
  compiledFrom: string;
  compiledAt: string;
  /** Machine-readable enforcement of successCriteria — see
   * verification/output-gate.ts and verification/checks.ts. Optional: a
   * successCriteria entry with no matching check (by criterion text) falls
   * into GateResult.humanReview rather than blocking. */
  checks?: SkillCheck[];
}

export interface SkillStep {
  action: string;
  tool?: string;
  args?: Record<string, unknown>;
  expectedOutcome: string;
}

// ─── Output Verification Gate: skill checks ─────────────────────────────────

export type SkillCheckSeverity = "block" | "warn";

export type SkillCheck = { criterion: string; severity?: SkillCheckSeverity } & (
  | { type: "section_present"; heading: string; minChars?: number }
  | { type: "regex_present"; pattern: string; flags?: string; message?: string }
  | { type: "regex_absent"; pattern: string; flags?: string; message?: string }
  | { type: "max_words"; limit: number; scope?: "whole" | "per_section" }
  | { type: "count_range"; pattern: string; flags?: string; min?: number; max?: number }
  | { type: "lead_provenance" }
  | { type: "computed_number"; labelPattern: string }
  | { type: "metric_sourcing" }
  | { type: "grounded_quotes"; minQuotes?: number }
  | { type: "evidence_citation"; claimPattern: string; minOverlapTokens?: number }
  | { type: "human_review" }
);

// ─── Trace Types ─────────────────────────────────────────────────────────────

export interface TraceStep {
  phase: "plan" | "act" | "observe" | "reflect";
  action: string;
  input?: unknown;
  output?: unknown;
  toolCall?: ToolCall;
  tokenUsage?: TokenUsage;
  durationMs: number;
  timestamp: string;
}

// ─── Internal Runner Types ───────────────────────────────────────────────────

export interface PlanStep {
  description: string;
  tool?: string;
  args?: Record<string, unknown>;
}

export interface PlanResult {
  steps: PlanStep[];
  tokenUsage?: TokenUsage;
}

export interface ReflectionResult {
  complete: boolean;
  output?: string;
  escalate?: boolean;
  reason?: string;
  tokenUsage?: TokenUsage;
}
