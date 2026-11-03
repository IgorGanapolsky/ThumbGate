# Institutional Memory Layer with Upvote/Downvote (Steal)

## Steal Source
YouTube: "How to Build an AI Operating System" (FSX5FJS9PQ, timestamps 21:12-24:18)

## Problem
Operational knowledge is trapped in individual heads. When a team member leaves or forgets a lesson, the same mistakes repeat. No systematic capture → recall → refine loop.

## Pattern Stolen

### 1. Connect Fragmented Workflows
Unify ideation, execution, and review into a single operating system so delays and dependencies are visible across departments.

### 2. Force-Capture Operational Lessons
Set up a system that captures daily problems and solutions from people on the ground. Not optional. Automatic.

### 3. Upvote/Downvote Feedback Loop
When someone inputs a new project idea, the memory layer automatically flags historical pitfalls ("Last time we built X, these 3 things went wrong"). Team members vote up/down whether that rule applies globally or locally.

## How ThumbGate Applies It

This is **literally ThumbGate's core feedback-to-enforcement pipeline** — we just need to formalize the upvote/downvote component:

1. **Capture**: `thumbgate__capture_feedback` logs thumbs up/down with context
2. **Enforce**: `thumbgate__search_lessons` recalls relevant lessons before tool calls
3. **Refine**: `thumbgate__reflect_on_feedback` runs post-mortem on failures
4. **Distribute**: Lessons promoted to prevention rules via `thumbgate__prevention_rules`

### What we add: the upvote/downvote gate

`scripts/institutional-memory.js`:
- `submitLesson(lesson, context)` — force-captures to `.claude/memory/feedback/`
- `recallLessons(query, scope)` — recalls relevant lessons before task execution
- `upvoteLesson(lessonId)` / `downvoteLesson(lessonId)` — refines the signal
- `shouldProceed(task, lessons)` — pre-action gate that checks for "STOP" lessons

```javascript
// Example: before a git reset --hard, check if any lesson says "STOP"
const lessons = recallLessons('git reset --hard');
if (lessons.some(l => l.severity === 'STOP')) {
  console.log('BLOCKED: Historical lesson says this caused data loss 3 times');
  process.exit(1);
}
```

### Memory schema
```json
{
  "id": "lesson_001",
  "type": "mistake",
  "scope": "git_operations",
  "severity": "BLOCK",  // STOP, WARN, INFO
  "trigger": "git reset --hard",
  "context": "Lost 3 hours of uncommitted work on feat/auth branch",
  "resolution": "Use git worktree instead of checkout -f",
  "votes": { "up": 12, "down": 2 },
  "confidence": 0.86,
}
```

## Pro Value
Pro adds:
- Cross-project lesson sharing (team-wide memory layer)
- Confidence-weighted voting (senior votes count more)
- Automated lesson promotion (votes → prevention rules)
- Natural language lesson search via local embeddings

**Steal command**: `npx thumbgate init` → select "institutional-memory-pack"
