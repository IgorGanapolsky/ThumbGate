---
expect:
  taskId: string
  goal: string
  status: [completed, failed, partial, escalated]
---

Task outcome recorded: {{input.taskId}} ({{input.status}}).
