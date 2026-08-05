// xAI Workflows pattern for ThumbGate product reliability:
// Inventory live wall → parallel defect classes → adversarial verify → action board.
// Read-only: does not edit gates, settings, or send mail. Reports only.

let meta = #{
    name: "thumbgate-enforcement-audit",
    description: "Audit whether ThumbGate gates actually fire: hooks, match surfaces, prose inert gates, outbound/spend walls",
    when_to_use: "After enforcement incidents, before claiming 'gates work', session hygiene, or AGENT-259 class bugs. /thumbgate-enforcement-audit",
    phases: [
        #{ title: "Inventory", detail: "Live hooks, runtime binaries, auto-promoted stores, recent denials" },
        #{ title: "Lanes", detail: "Parallel: matchGate, force-promote prose, hook wiring, outbound/spend matrix" },
        #{ title: "Verify", detail: "Adversarial recheck with live probes where safe" },
        #{ title: "Synthesize", detail: "Ranked fix list + TRUE/FALSE ledger" },
    ],
};

let inventory_schema = #{
    "type": "object",
    "required": ["surfaces_examined", "hook_summary", "runtime_paths", "gate_store_paths", "recent_deny_samples", "unverified_claims"],
    "properties": #{
        "surfaces_examined": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "hook_summary": #{ "type": "string" },
        "runtime_paths": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "gate_store_paths": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
        "recent_deny_samples": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
        "projects_of_interest": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "unverified_claims": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
    },
};

let lane_schema = #{
    "type": "object",
    "required": ["lane", "findings", "residual_uncertainty"],
    "properties": #{
        "lane": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["id", "severity", "claim_status", "title", "evidence", "next_action"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "severity": #{ "type": "string", "enum": ["blocker", "high", "medium", "low", "info"] },
                    "claim_status": #{ "type": "string", "enum": ["verified", "unverified", "refuted", "fixed-pending-merge"] },
                    "title": #{ "type": "string" },
                    "detail": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "next_action": #{ "type": "string" },
                },
            },
        },
        "residual_uncertainty": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 8 },
    },
};

let board_schema = #{
    "type": "object",
    "required": [
        "title",
        "true_false_ledger",
        "top_actions",
        "live_wall_status",
        "product_gaps",
        "markdown_report",
    ],
    "properties": #{
        "title": #{ "type": "string" },
        "true_false_ledger": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["claim", "verdict", "evidence"],
                "properties": #{
                    "claim": #{ "type": "string" },
                    "verdict": #{ "type": "string", "enum": ["TRUE", "FALSE", "PARTIAL", "UNVERIFIED"] },
                    "evidence": #{ "type": "string" },
                },
            },
        },
        "top_actions": #{
            "type": "array",
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["rank", "action", "owner", "why_now", "evidence"],
                "properties": #{
                    "rank": #{ "type": "integer" },
                    "action": #{ "type": "string" },
                    "owner": #{ "type": "string" },
                    "why_now": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                },
            },
        },
        "live_wall_status": #{ "type": "string" },
        "product_gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "markdown_report": #{ "type": "string" },
    },
};

fn clean(value) {
    if type_of(value) == "string" {
        value.trim();
        value
    } else {
        ""
    }
}

fn safety_rules() {
    let text = "";
    text += "HARD RULES:\n";
    text += "- Prefer read-only. Safe probe: pipe synthetic tool JSON to gate-check / outbound-email-guard / spend-guard (no real email, no real spend).\n";
    text += "- NEVER send email, never call Gmail send APIs, never approve PRs, never disable hooks.\n";
    text += "- Never print secrets from Keychain or env.\n";
    text += "- Absence of denials in a log is NOT proof the wall works — run a live probe.\n";
    text += "- Prose-pattern gates with lastFiredAt null are FAILING, not healthy.\n";
    text
}

fn audit_corpus() {
    let text = "";
    text += "BOUNDED CORPUS:\n";
    text += "- ~/.claude/settings.json PreToolUse\n";
    text += "- Project settings: <repo>/.claude/settings.local.json (especially Resume)\n";
    text += "- ~/.grok/hooks/*.json\n";
    text += "- ~/.thumbgate/bin/outbound-email-guard.js, thumbgate-spend-guard.js\n";
    text += "- ~/.thumbgate/runtime/node_modules/thumbgate/ (gate-check binary)\n";
    text += "- ~/.thumbgate/auto-promoted-gates.json and projects/*/auto-promoted-gates.json\n";
    text += "- ~/.thumbgate/gate-stats.json, gate-events-log.jsonl, receipts/email-guard/\n";
    text += "- Repo: scripts/gates-engine.js matchGate/buildMatchSurfaces, scripts/auto-promote-gates.js, config/gates/default.json\n";
    text += "- PR #3219 / branch fix/gate-match-mcp-outbound-email if present\n";
    text
}

fn audit_policy() {
    let text = "";
    text += "FAILURE CLASSES TO HUNT (AGENT-259):\n";
    text += "1. matchGate only uses toolInput.command → MCP tools invisible\n";
    text += "2. force-promote stores English prose as regex → never fires\n";
    text += "3. PreToolUse missing gate-check (only spend or only outbound)\n";
    text += "4. Python Gmail messages().send vs messages/send path mismatch\n";
    text += "5. Free-tier soft-allow hiding denies\n";
    text += "6. Claiming 'protected' without live probe evidence\n";
    text
}

let focus = "full enforcement audit";
let smoke = false;
let project = "";
if args != () {
    if args.smoke != () && args.smoke == true { smoke = true; }
    if args.focus != () { focus = clean(args.focus); }
    if args.project != () { project = clean(args.project); }
}
if project == "" {
    project = "/Users/igorganapolsky/workspace/git/igor/Resume";
}

phase("Inventory");

let inv = "You are the ThumbGate enforcement inventory scout.\n";
inv += safety_rules();
inv += audit_corpus();
inv += audit_policy();
inv += "Focus: " + json_encode(focus) + "\n";
inv += "Primary project path: " + json_encode(project) + "\n";
inv += "List hooks, runtime binaries mtimes, auto-promoted gate counts, recent deny samples from logs/receipts. Return schema only.\n";

let inv_result = agent(inv, #{
    label: "inventory:enforcement",
    capability_mode: "read-only",
    output_schema: inventory_schema,
});

let inventory = #{
    surfaces_examined: [],
    hook_summary: "UNVERIFIED",
    runtime_paths: [],
    gate_store_paths: [],
    recent_deny_samples: [],
    projects_of_interest: [project],
    unverified_claims: ["UNVERIFIED: inventory failed"],
};
if inv_result != () && inv_result.success && inv_result.output != () {
    inventory = inv_result.output;
}

phase("Lanes");

let lanes = [
    #{ id: "match-surfaces", brief: "Does matchGate/buildMatchSurfaces include tool names for MCP? Prove with code cite + probe." },
    #{ id: "prose-gates", brief: "Auto-promoted/force-promote inert prose patterns; lastFiredAt null census; quarantine status." },
    #{ id: "hook-wiring", brief: "Claude global + project + Grok hooks: gate-check, spend, outbound present and ordered." },
    #{ id: "outbound-matrix", brief: "Live probe matrix: send_message, send_draft, messages/send curl, messages().send python, create_draft allow." },
];
if smoke {
    lanes = [
        #{ id: "outbound-matrix", brief: "Smoke: run or report last known outbound deny/allow matrix only." },
    ];
    log("Smoke mode: outbound matrix only.");
}

let review_jobs = [];
for lane in lanes {
    let prompt = "You are the specialist for lane " + lane.id + ".\n";
    prompt += safety_rules();
    prompt += audit_corpus();
    prompt += audit_policy();
    prompt += "Inventory: " + json_encode(inventory) + "\n";
    prompt += "Lane: " + lane.brief + "\n";
    prompt += "For outbound-matrix, prefer executing safe synthetic stdin probes to gate-check/outbound guard (no real mail).\n";
    prompt += "Cap 8 findings. Set lane=" + lane.id + ".\n";
    let mode = "read-only";
    if lane.id == "outbound-matrix" {
        mode = "execute";
    }
    review_jobs.push(#{
        prompt: prompt,
        label: "lane:" + lane.id,
        capability_mode: mode,
        output_schema: lane_schema,
    });
}
let reviews = parallel(review_jobs);

phase("Verify");

let verify_jobs = [];
let review_index = 0;
for review in reviews {
    let lane_id = lanes[review_index].id;
    let candidate = #{ lane: lane_id, findings: [], residual_uncertainty: ["UNVERIFIED: review failed"] };
    if review != () && review.success && review.output != () {
        candidate = review.output;
    }
    let prompt = "You are the adversarial verifier for lane " + lane_id + ".\n";
    prompt += safety_rules();
    prompt += audit_corpus();
    prompt += "Candidate: " + json_encode(candidate) + "\n";
    prompt += "Refute claims without path/probe evidence. Cap 8. Set lane=" + lane_id + ".\n";
    verify_jobs.push(#{
        prompt: prompt,
        label: "verify:" + lane_id,
        capability_mode: "read-only",
        output_schema: lane_schema,
    });
    review_index += 1;
}
let verified = parallel(verify_jobs);

phase("Synthesize");

let synth = "You are the enforcement TRUE/FALSE ledger synthesizer.\n";
synth += safety_rules();
synth += audit_policy();
synth += "Inventory: " + json_encode(inventory) + "\n";
synth += "Verified lanes: " + json_encode(verified) + "\n";
synth += "Produce true_false_ledger (must include: live wall wired, MCP match works, prose gates inert class, outbound python shape, PR merge status if known), top_actions, product_gaps. No mutations.\n";

let synthesis = agent(synth, #{
    label: "synthesize:enforcement-board",
    capability_mode: "read-only",
    output_schema: board_schema,
});

if synthesis == () || !synthesis.success || synthesis.output == () {
    let fallback = "# ThumbGate Enforcement Audit - DEGRADED\n\nSynthesizer failed.\n";
    let fallback_path = write_scratch_file("thumbgate-enforcement-audit-report.md", fallback);
    complete(#{ path: fallback_path, status: "degraded", report: fallback });
}

let report = synthesis.output;
let markdown_report = "# ThumbGate Enforcement Audit - DEGRADED\n";
if report.markdown_report != () && clean(report.markdown_report) != "" {
    markdown_report = report.markdown_report;
}
let report_path = write_scratch_file("thumbgate-enforcement-audit-report.md", markdown_report);
complete(#{
    path: report_path,
    status: "complete",
    title: report.title,
    true_false_ledger: report.true_false_ledger,
    top_actions: report.top_actions,
    live_wall_status: report.live_wall_status,
    product_gaps: report.product_gaps,
    report: markdown_report,
    smoke: smoke,
    project: project,
    invocation: "/thumbgate-enforcement-audit",
});
