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
}

export interface SkillStep {
  action: string;
  tool?: string;
  args?: Record<string, unknown>;
  expectedOutcome: string;
}

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
