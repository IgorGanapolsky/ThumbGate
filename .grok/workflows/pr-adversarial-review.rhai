// xAI Workflows pattern (https://x.ai/news/workflows):
// Context → parallel specialist reviewers → adversarial verify → synthesize.
// Read-only: never merge, approve, force-push, or post review comments.

let meta = #{
    name: "pr-adversarial-review",
    description: "Multi-agent PR review: context, specialist reviewers, adversarial verify, ranked findings report",
    when_to_use: "Before merge, after large PR open, or when CEO asks to review a PR thoroughly. Invoke /pr-adversarial-review with pr number or url.",
    phases: [
        #{ title: "Context", detail: "Resolve PR metadata, diff scope, CI rollup" },
        #{ title: "Review", detail: "Parallel specialists: correctness, security, tests, product claims" },
        #{ title: "Verify", detail: "Adversarial recheck — drop unverified findings" },
        #{ title: "Synthesize", detail: "Ranked findings + merge readiness board" },
    ],
};

let context_schema = #{
    "type": "object",
    "required": ["pr_ref", "title", "base_branch", "head_branch", "files_changed_summary", "ci_summary", "risk_areas", "unverified_claims"],
    "properties": #{
        "pr_ref": #{ "type": "string" },
        "title": #{ "type": "string" },
        "base_branch": #{ "type": "string" },
        "head_branch": #{ "type": "string" },
        "files_changed_summary": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "ci_summary": #{ "type": "string" },
        "risk_areas": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
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
                "required": ["id", "severity", "claim_status", "title", "evidence", "fix_hint"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "severity": #{ "type": "string", "enum": ["blocker", "high", "medium", "low", "nit"] },
                    "claim_status": #{ "type": "string", "enum": ["verified", "unverified", "refuted", "needs-test"] },
                    "title": #{ "type": "string" },
                    "detail": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "fix_hint": #{ "type": "string" },
                    "file": #{ "type": "string" },
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
        "pr_ref",
        "merge_readiness",
        "blockers",
        "ranked_findings",
        "test_gaps",
        "markdown_report",
    ],
    "properties": #{
        "title": #{ "type": "string" },
        "pr_ref": #{ "type": "string" },
        "merge_readiness": #{ "type": "string", "enum": ["ready", "blocked", "needs-changes", "unknown"] },
        "blockers": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "ranked_findings": #{
            "type": "array",
            "maxItems": 15,
            "items": #{
                "type": "object",
                "required": ["rank", "severity", "title", "evidence", "fix_hint"],
                "properties": #{
                    "rank": #{ "type": "integer" },
                    "severity": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "fix_hint": #{ "type": "string" },
                    "file": #{ "type": "string" },
                },
            },
        },
        "test_gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
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
    text += "HARD READ-ONLY RULES:\n";
    text += "- Use gh/git read-only (view, diff, checks). NEVER approve, merge, dismiss reviews, force-push, or post PR comments.\n";
    text += "- Never print secrets, PATs, tokens.\n";
    text += "- Every finding needs file:line or command output evidence. Absence is not a pass.\n";
    text += "- Label guesses UNVERIFIED. Prefer refuted over speculative.\n";
    text += "- Do not bypass branch protection in recommendations.\n";
    text
}

fn review_policy() {
    let text = "";
    text += "REVIEW POLICY (ThumbGate/coding standards):\n";
    text += "- Blockers: silent allow of dangerous tool surfaces, prose-only gates, missing tests for deny/allow paths, false completion claims, secret leaks.\n";
    text += "- Prefer differential proof: would this have caught the failure class it claims to fix?\n";
    text += "- Tests must fail closed on the bug, not only pass green.\n";
    text += "- Never recommend --admin merge or owner approval by agents.\n";
    text
}

let pr_ref = "";
let smoke = false;
if args != () {
    if args.smoke != () && args.smoke == true { smoke = true; }
    if args.pr != () { pr_ref = clean(args.pr); }
    else if args.number != () { pr_ref = clean(args.number); }
    else if args.url != () { pr_ref = clean(args.url); }
    else if args.query != () { pr_ref = clean(args.query); }
}
if pr_ref == "" {
    pr_ref = "current open PR for this repo (resolve via gh pr view / git branch)";
}

phase("Context");

let ctx_prompt = "You are the PR context scout.\n";
ctx_prompt += safety_rules();
ctx_prompt += review_policy();
ctx_prompt += "PR ref: " + json_encode(pr_ref) + "\n";
ctx_prompt += "Resolve the PR number/url, title, base/head, file list summary, and CI rollup via gh/git read-only.\n";
ctx_prompt += "Name risk areas (auth, gates, money, email, hooks, deploy). Return only the schema.\n";

let ctx_result = agent(ctx_prompt, #{
    label: "context:pr",
    capability_mode: "read-only",
    output_schema: context_schema,
});

let context = #{
    pr_ref: pr_ref,
    title: "",
    base_branch: "main",
    head_branch: "",
    files_changed_summary: [],
    ci_summary: "UNVERIFIED",
    risk_areas: [],
    unverified_claims: ["UNVERIFIED: context agent failed"],
};
if ctx_result != () && ctx_result.success && ctx_result.output != () {
    context = ctx_result.output;
}

phase("Review");

let lanes = [
    #{ id: "correctness", brief: "Logic bugs, off-by-one, wrong match surfaces, API contract breaks, silent no-ops." },
    #{ id: "security-safety", brief: "Authz, secret handling, destructive git, email/send surfaces, always-approve bypass, branch protection." },
    #{ id: "tests-proof", brief: "Missing regression tests for claimed fixes; tests that cannot fail; coverage of deny/allow matrix." },
    #{ id: "product-claims", brief: "PR body overclaims vs code; completion claim contract; deploy/live claims without evidence." },
];
if smoke {
    lanes = [
        #{ id: "correctness", brief: "Smoke: top 5 correctness risks only from diff summary." },
    ];
    log("Smoke mode: one review lane.");
}

let review_jobs = [];
for lane in lanes {
    let prompt = "You are the specialist reviewer for lane " + lane.id + ".\n";
    prompt += safety_rules();
    prompt += review_policy();
    prompt += "Context: " + json_encode(context) + "\n";
    prompt += "Lane: " + lane.brief + "\n";
    prompt += "Read the actual diff for cited files. Cap 8 findings. Set lane=" + lane.id + ".\n";
    review_jobs.push(#{
        prompt: prompt,
        label: "review:" + lane.id,
        capability_mode: "read-only",
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
    prompt += "Candidate findings: " + json_encode(candidate) + "\n";
    prompt += "Reopen the cited files/diff. Keep only verified findings. Refute hand-wavy claims. Cap 8. Set lane=" + lane_id + ".\n";
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

let synth = "You are the final PR review synthesizer.\n";
synth += safety_rules();
synth += review_policy();
synth += "Context: " + json_encode(context) + "\n";
synth += "Verified lanes: " + json_encode(verified) + "\n";
synth += "Produce merge_readiness and ranked findings. markdown_report mirrors structure. No merge actions.\n";

let synthesis = agent(synth, #{
    label: "synthesize:pr-board",
    capability_mode: "read-only",
    output_schema: board_schema,
});

if synthesis == () || !synthesis.success || synthesis.output == () {
    let fallback = "# PR Adversarial Review - DEGRADED\n\nSynthesizer failed. Re-run with higher agent_budget.\n";
    let fallback_path = write_scratch_file("pr-adversarial-review-report.md", fallback);
    complete(#{ path: fallback_path, status: "degraded", report: fallback });
}

let report = synthesis.output;
let markdown_report = "# PR Adversarial Review - DEGRADED\n";
if report.markdown_report != () && clean(report.markdown_report) != "" {
    markdown_report = report.markdown_report;
}
let report_path = write_scratch_file("pr-adversarial-review-report.md", markdown_report);
complete(#{
    path: report_path,
    status: "complete",
    title: report.title,
    pr_ref: report.pr_ref,
    merge_readiness: report.merge_readiness,
    blockers: report.blockers,
    ranked_findings: report.ranked_findings,
    test_gaps: report.test_gaps,
    report: markdown_report,
    smoke: smoke,
    invocation: "/pr-adversarial-review",
});
