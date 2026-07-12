import { ExecutionTrace } from "../trace/execution-trace.ts";
import type { SkillFile, SkillStep } from "../types.ts";
import { scoreRelevance } from "./matcher.ts";

export class SkillCompiler {
  constructor(private readonly outputDir: string) {}

  async compile(trace: ExecutionTrace): Promise<SkillFile> {
    const steps = trace
      .getSteps()
      .filter((s) => s.phase === "act" && s.toolCall)
      .map(
        (s): SkillStep => ({
          action: s.action,
          tool: s.toolCall?.name,
          args: s.toolCall?.arguments,
          expectedOutcome: typeof s.output === "string" ? s.output : JSON.stringify(s.output ?? ""),
        }),
      );

    const skill: SkillFile = {
      name: this.generateName(trace),
      description: `Compiled from task ${trace.taskId}`,
      steps,
      preconditions: [],
      successCriteria: [],
      compiledFrom: trace.taskId,
      compiledAt: new Date().toISOString(),
    };

    const filePath = `${this.outputDir}/${skill.name}.skill`;
    await Bun.write(filePath, JSON.stringify(skill, null, 2));
    return skill;
  }

  /** Loads exactly one skill by name — used by the output gate when
   * task.targetSkill is set (a deterministic pick, no relevance scoring
   * needed since create_task already named the skill). Null on a missing
   * file or parse error rather than throwing, matching findRelevant's
   * best-effort behavior. */
  async loadByName(name: string): Promise<SkillFile | null> {
    try {
      const content = await Bun.file(`${this.outputDir}/${name}.skill`).text();
      return JSON.parse(content) as SkillFile;
    } catch {
      return null;
    }
  }

  async findRelevant(description: string, limit = 3): Promise<SkillFile[]> {
    const glob = new Bun.Glob("*.skill");
    const scored: { skill: SkillFile; score: number }[] = [];

    for await (const path of glob.scan(this.outputDir)) {
      try {
        const content = await Bun.file(`${this.outputDir}/${path}`).text();
        const skill = JSON.parse(content) as SkillFile;
        const score = scoreRelevance(description, skill.description);
        if (score > 0) {
          scored.push({ skill, score });
        }
      } catch {
        continue;
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.skill);
  }

  private generateName(trace: ExecutionTrace): string {
    return `skill-${trace.taskId.slice(0, 8)}-${Date.now()}`;
  }
}
