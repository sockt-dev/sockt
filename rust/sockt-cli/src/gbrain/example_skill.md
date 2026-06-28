# Example Skill: Status Report

## Trigger

When asked "what's the status?" or similar status inquiry.

## Steps

1. Check all active integrations for connectivity
2. Query recent task completion rate
3. Identify any blocked or escalated tasks
4. Compose a summary message

## Output Format

Post a threaded message in the requesting channel with:
- Overall health indicator (green/yellow/red)
- Active task count
- Any items requiring attention

## Approval Required

No — this is an informational read-only operation.
