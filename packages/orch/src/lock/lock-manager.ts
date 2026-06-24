export class LockManager {
  private locks = new Map<string, Set<string>>();

  acquire(agentId: string, taskId: string): boolean {
    const agentLocks = this.locks.get(agentId) ?? new Set();
    agentLocks.add(taskId);
    this.locks.set(agentId, agentLocks);
    return true;
  }

  release(agentId: string, taskId: string): void {
    const agentLocks = this.locks.get(agentId);
    if (agentLocks) {
      agentLocks.delete(taskId);
      if (agentLocks.size === 0) this.locks.delete(agentId);
    }
  }

  isAtCapacity(agentId: string, maxConcurrent: number): boolean {
    const agentLocks = this.locks.get(agentId);
    return (agentLocks?.size ?? 0) >= maxConcurrent;
  }

  getActiveLocks(): Map<string, Set<string>> {
    return this.locks;
  }
}
