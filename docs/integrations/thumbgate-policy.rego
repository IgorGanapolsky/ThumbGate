# Generated from ThumbGate gate configs (config/gates/*.json). Do not edit by hand.
# Input shape: { "tool": "Bash", "command": "rm -rf /" }
# allow == false whenever any deny rule matches; the deny set carries the reasons.
# NOTE: OPA uses RE2 regex — ThumbGate patterns using PCRE lookaround (?!,(?=) or
#       backreferences are emitted as TODO comments for manual translation.

package thumbgate.authz

import future.keywords.contains
import future.keywords.if
import future.keywords.in

default allow := false

allow if {
	count(deny) == 0
}

# gate: edit-console-log-commit  (code-edit / critical)
deny contains msg if {
	input.tool in {"Edit", "Write"}
	regex.match(`console\.log\(.*password|console\.log\(.*secret|console\.log\(.*token|console\.log\(.*api.?key`, input.command)
	msg := "Logging a secret value to console is blocked. Remove the log or redact the value."
}

# gate: db-drop-table-production  (db-write / critical)
# TODO(manual): pattern uses PCRE lookaround/backrefs unsupported by RE2 — translate by hand:
#   DROP\s+TABLE(?!.*test|.*tmp|.*temp|.*_test|.*staging)

# gate: db-delete-without-where  (db-write / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`DELETE\s+FROM\s+\w+\s*;|DELETE\s+FROM\s+\w+\s*$`, input.command)
	msg := "DELETE without a WHERE clause deletes all rows. Add a WHERE clause or use TRUNCATE deliberately."
}

# gate: local-only-git-writes  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`^(git\s+(add|commit|push|tag)|gh\s+pr\s+|gh\s+release\s+create|npm\s+publish|yarn\s+publish|pnpm\s+publish)`, input.command)
	msg := "User requested local-only work. Git writes, PR operations, and release actions are blocked."
}

# gate: raw-gh-auto-merge-blocked  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`gh\s+pr\s+merge\b[^\n]*--auto`, input.command)
	msg := "Raw GitHub auto-merge is blocked. Use npm run pr:manage after all critical quality checks have terminal success."
}

# gate: task-scope-required  (default / critical)
# TODO(manual): pattern uses PCRE lookaround/backrefs unsupported by RE2 — translate by hand:
#   ^(git\s+(add|commit|push)|gh\s+pr\s+(create|merge)|gh\s+api\b(?=.*(?:/pulls\b|repos/[^\s]+/[^\s]+/pulls\b))(?=.*(?:-f\b|--field\b|-F\b|--raw-field\b|--method\s+POST\b|-X\s+POST\b))|gh\s+release\s+create|git\s+tag\b|npm\s+publish|yarn\s+publish|pnpm\s+publish)

# gate: task-scope-edit-boundary  (default / critical)
deny contains msg if {
	input.tool in {"Edit", "Write", "MultiEdit"}
	regex.match(`.*`, input.command)
	msg := "Edits outside the declared task scope are blocked once a task scope is active."
}

# gate: protected-file-approval-required  (default / critical)
deny contains msg if {
	input.tool in {"Edit", "Write", "MultiEdit", "Bash"}
	regex.match(`.*`, input.command)
	msg := "Protected files require explicit approval before editing or publishing."
}

# gate: gh-pr-create-restricted  (default / high)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`gh\s+pr\s+create`, input.command)
	msg := "PR creation requires explicit 'pr_create_allowed' satisfaction with evidence of user permission."
}

# gate: gh-api-pr-create-restricted  (default / high)
# TODO(manual): pattern uses PCRE lookaround/backrefs unsupported by RE2 — translate by hand:
#   gh\s+api\b(?=.*(?:/pulls\b|repos/[^\s]+/[^\s]+/pulls\b))(?=.*(?:-f\b|--field\b|-F\b|--raw-field\b|--method\s+POST\b|-X\s+POST\b))

# gate: gh-pr-merge-restricted  (default / high)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`gh\s+pr\s+merge`, input.command)
	msg := "PR merging requires explicit 'pr_merge_allowed' satisfaction with evidence of user permission."
}

# gate: branch-governance-required  (default / critical)
# TODO(manual): pattern uses PCRE lookaround/backrefs unsupported by RE2 — translate by hand:
#   ^(gh\s+pr\s+(create|merge)|gh\s+api\b(?=.*(?:/pulls\b|repos/[^\s]+/[^\s]+/pulls\b))(?=.*(?:-f\b|--field\b|-F\b|--raw-field\b|--method\s+POST\b|-X\s+POST\b))|gh\s+release\s+create|git\s+tag\b|npm\s+publish|yarn\s+publish|pnpm\s+publish)

# gate: release-readiness-required  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`^(gh\s+release\s+create|git\s+tag\b|npm\s+publish|yarn\s+publish|pnpm\s+publish)`, input.command)
	msg := "Release and publish actions require a releasable mainline commit and a matching version plan."
}

# gate: admin-merge-bypass-blocked  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`gh\s+pr\s+merge.*--admin`, input.command)
	msg := "Admin merge bypass is blocked. Use the merge queue or normal protected-branch flow."
}

# gate: loop-abuse-prevention  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`loop\s+\d+\s+.*(curl|wget|rm\s+-rf|git\s+push|gh\s+pr)`, input.command)
	msg := "High-risk command detected inside a loop. Scheduled tasks must not perform egress or destructive writes without explicit approval."
}

# gate: push-without-thread-check  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`git\s+push`, input.command)
	msg := "Check PR review threads (reviewThreads first:50) before pushing. Use satisfy_gate('pr_threads_checked', 'evidence') to bypass."
}

# gate: package-lock-reset  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`git\s+checkout\s+\S+\s+--\s+package-lock\.json`, input.command)
	msg := "Never reset package-lock.json from another branch. Run npm install instead."
}

# gate: force-push  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`git\s+push\s+(--force|-f)`, input.command)
	msg := "Force push blocked. This is destructive and irreversible."
}

# gate: git-reset-hard  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`(?:^|[;&|]\s*)git\s+reset\s+--hard\b`, input.command)
	msg := "git reset --hard is blocked because it can destroy uncommitted work. Stash or use a non-destructive restore path with explicit user approval."
}

# gate: git-clean-force  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`(?:^|[;&|]\s*)git\s+clean\s+(?:-[^\s]*f[^\s]*|--force)\b`, input.command)
	msg := "git clean --force is blocked because it can delete untracked user work. Inventory files and get explicit approval before destructive cleanup."
}

# gate: protected-branch-push  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`git\s+push\s+(?:\S+\s+)?(?:develop|main|master)\b`, input.command)
	msg := "Direct push to protected branch. Use feature branches and PRs."
}

# gate: rm-rf-home-or-root  (default / critical)
# TODO(manual): pattern uses PCRE lookaround/backrefs unsupported by RE2 — translate by hand:
#   (?:^|[;&|]\s*)rm\s+-(?=[^\s]*r)(?=[^\s]*f)[^\s]+\s+(?:/|/\*|~(?:/[^\s]*)?|\$HOME(?:/[^\s]*)?)(?:\s|$)

# gate: blocked-npx-content  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`.*`, input.command)
	msg := "Blocked npx execution by content hash. Renaming the binary does not bypass this gate."
}

# gate: mcp-sql-delete-block  (default / critical)
deny contains msg if {
	input.tool == "delete_record"
	regex.match(`.*`, input.command)
	msg := "SQL MCP delete_record requires explicit task scope. Destructive database operations must be scoped to prevent accidental data loss."
}

# gate: mcp-sql-bulk-update-warn  (default / critical)
deny contains msg if {
	input.tool == "update_record"
	regex.match(`(?:WHERE\s+1\s*=\s*1|WHERE\s+true|WITHOUT\s+WHERE)`, input.command)
	msg := "SQL MCP bulk update without a safe WHERE clause. This could modify all records in the table."
}

# gate: self-protect-config  (default / critical)
deny contains msg if {
	input.tool in {"Edit", "Write", "MultiEdit"}
	regex.match(`(?:config/gates/|config/budget\.json|\.thumbgate/|thumbgate\.json)`, input.command)
	msg := "Self-protection: agent cannot modify ThumbGate configuration, gate rules, or budget settings."
}

# gate: self-protect-kill  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`(?:kill|pkill|killall)\s+.*(?:thumbgate|gates-engine|budget-enforcer)`, input.command)
	msg := "Self-protection: agent cannot terminate ThumbGate processes."
}

# gate: self-protect-env-override  (default / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`(?:export|unset)\s+(?:THUMBGATE_|LANEKEEP_)`, input.command)
	msg := "Self-protection: agent cannot modify ThumbGate environment variables."
}

# gate: self-protect-hooks-disable  (default / critical)
deny contains msg if {
	input.tool in {"Edit", "Write", "Bash"}
	regex.match(`(?:settings\.json|settings\.local\.json).*(?:hooks|PreToolUse|PostToolUse)`, input.command)
	msg := "Self-protection: agent cannot modify hook registrations."
}

# gate: deploy-force-push-main  (deploy / critical)
# TODO(manual): pattern uses PCRE lookaround/backrefs unsupported by RE2 — translate by hand:
#   git\s+push\s+.*--force(?!-with-lease)|git\s+push\s+--force(?!-with-lease).*main|git\s+push\s+--force(?!-with-lease).*master

# gate: deploy-skip-ci  (deploy / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`--no-verify|--no-gpg-sign|-c\s+commit\.gpgsign=false`, input.command)
	msg := "Bypassing commit hooks or signing is blocked. Fix the underlying issue instead."
}

# gate: deploy-env-secret-exposure  (deploy / critical)
deny contains msg if {
	input.tool in {"Bash", "Edit", "Write"}
	regex.match(`(?:ANTHROPIC_API_KEY|STRIPE_SECRET|JWT_SECRET|DATABASE_URL|RAILWAY_TOKEN)\s*=`, input.command)
	msg := "Secret value detected in command or file edit. Use environment variables or secret managers instead."
}

# gate: routine-no-direct-main-write  (routine / critical)
deny contains msg if {
	input.tool == "Bash"
	regex.match(`git\s+(commit|push)\b.*\b(main|master)\b|git\s+checkout\s+(main|master)\s*&&`, input.command)
	msg := "Unattended routines must create feature branches and PRs. Direct writes to protected branches are blocked."
}
