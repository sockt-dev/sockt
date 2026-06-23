import { toJSONSchema } from "zod/v4/core";
import { join } from "node:path";
import {
  TaskSchema,
  TaskCreateSchema,
  TaskPatchSchema,
  MemoryEntrySchema,
  RetrievalQuerySchema,
  RetrievalResultSchema,
  LlmConfigSchema,
  LlmMessageSchema,
  LlmRequestSchema,
  LlmResponseSchema,
  TokenUsageSchema,
  ToolCallSchema,
  InboundMessageSchema,
  OutboundMessageSchema,
  AttachmentSchema,
  CadvpEventSchema,
  CadvpStatsSchema,
  ApprovalRequestSchema,
  ApprovalDecisionSchema,
} from "../src/index.ts";

const OUTPUT_DIR = join(import.meta.dir, "../../../schemas");

const schemas = {
  "task.json": TaskSchema,
  "task-create.json": TaskCreateSchema,
  "task-patch.json": TaskPatchSchema,
  "memory-entry.json": MemoryEntrySchema,
  "retrieval-query.json": RetrievalQuerySchema,
  "retrieval-result.json": RetrievalResultSchema,
  "llm-config.json": LlmConfigSchema,
  "llm-message.json": LlmMessageSchema,
  "llm-request.json": LlmRequestSchema,
  "llm-response.json": LlmResponseSchema,
  "token-usage.json": TokenUsageSchema,
  "tool-call.json": ToolCallSchema,
  "inbound-message.json": InboundMessageSchema,
  "outbound-message.json": OutboundMessageSchema,
  "attachment.json": AttachmentSchema,
  "cadvp-event.json": CadvpEventSchema,
  "cadvp-stats.json": CadvpStatsSchema,
  "approval-request.json": ApprovalRequestSchema,
  "approval-decision.json": ApprovalDecisionSchema,
} as const;

async function main() {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const [filename, schema] of Object.entries(schemas)) {
    const jsonSchema = toJSONSchema(schema);
    const filePath = join(OUTPUT_DIR, filename);
    await Bun.write(filePath, JSON.stringify(jsonSchema, null, 2) + "\n");
    console.log(`  wrote ${filename}`);
  }

  console.log(`\nGenerated ${Object.keys(schemas).length} JSON schemas to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Schema generation failed:", err);
  process.exit(1);
});
