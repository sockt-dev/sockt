export const MemoryCategory = {
  Fact: "fact",
  Decision: "decision",
  Preference: "preference",
  Procedure: "procedure",
  Context: "context",
} as const;
export type MemoryCategory = (typeof MemoryCategory)[keyof typeof MemoryCategory];
export const MEMORY_CATEGORY_VALUES = Object.values(MemoryCategory) as [MemoryCategory, ...MemoryCategory[]];
