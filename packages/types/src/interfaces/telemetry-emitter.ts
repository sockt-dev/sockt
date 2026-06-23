export interface TelemetryEmitter {
  emit(event: { type: string; taskId?: string; tenantId: string; data: Record<string, unknown> }): void;
  flush(): Promise<void>;
}
