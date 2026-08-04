// GSD Review + HF Context Course Units 1–5 as parallel specialist lanes.
// Read-only. Use before claiming a context/skills/hooks PR is done.

let meta = #{
    name: "context-engineering-pr-check",
    description: "Parallel GSD/Ralph review of skills, MCP, workflows, multi-agent, and hooks against HF Context Course",
    when_to_use: "After context-engineering or gate/skill/workflow PRs. /context-engineering-pr-check",
    phases: [
        #{ title: "Capture", detail: "PR scope and changed context surfaces" },
        #{ title: "Lanes", detail: "Units 1–5 specialists in parallel" },
        #{ title: "Verify", detail: "Adversarial recheck" },
        #{ title: "Review", detail: "GSD review board + Ralph promote readiness" },
    ],
};

let capture_schema = #{
    "type": "object",
    "required": ["pr_ref", "changed_surfaces", "gsd_stage", "unverified_claims"],
    "properties": #{
        "pr_ref": #{ "type": "string" },
        "changed_surfaces": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "gsd_stage": #{ "type": "string" },
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
                    "severity": #{ "type": "string", "enum": ["blocker", "high", "medium", "low", "info"] },
                    "claim_status": #{ "type": "string", "enum": ["verified", "unverified", "refuted", "ok"] },
                    "title": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "fix_hint": #{ "type": "string" },
                },
            },
        },
        "residual_uncertainty": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 8 },
    },
};

let board_schema = #{
    "type": "object",
    "required": ["title", "gsd_review", "ralph_ready", "blockers", "ranked_findings", "markdown_report"],
    "properties": #{
        "title": #{ "type": "string" },
        "gsd_review": #{ "type": "string", "enum": ["pass", "needs-changes", "blocked"] },
        "ralph_ready": #{ "type": "boolean" },
        "blockers": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "ranked_findings": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["rank", "severity", "title", "evidence"],
                "properties": #{
                    "rank": #{ "type": "integer" },
                    "severity": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                },
            },
        },
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

fn safety() {
    let t = "";
    t += "READ-ONLY. No merge, approve, send mail, or vault thrash of other agents.\n";
    t += "Evidence = file paths + command output. Prose gates without tool surfaces = FAIL.\n";
    t += "HF course units: 1 skills, 2 MCP, 3 plugins/workflows, 4 subagents, 5 hooks.\n";
    t
}

let pr_ref = "current PR or branch";
let smoke = false;
if args != () {
    if args.smoke == true { smoke = true; }
    if args.pr != () { pr_ref = clean(args.pr); }
    else if args.query != () { pr_ref = clean(args.query); }
}

phase("Capture");
let cap = agent(
    "You are GSD Capture for context engineering.\n" + safety() +
    "PR/ref: " + json_encode(pr_ref) + "\n" +
    "List changed skills, MCP, workflows, hooks, docs. Set gsd_stage=review.\n",
    #{ label: "capture", capability_mode: "read-only", output_schema: capture_schema },
);
let capture = #{ pr_ref: pr_ref, changed_surfaces: [], gsd_stage: "review", unverified_claims: ["UNVERIFIED capture"] };
if cap != () && cap.success && cap.output != () { capture = cap.output; }

phase("Lanes");
let lanes = [
    #{ id: "u1-skills", brief: "Unit 1: SKILL.md shape, triggers, one failure class, no secrets." },
    #{ id: "u2-mcp", brief: "Unit 2: MCP tools side-effects, allowlists, gate coverage for mutations." },
    #{ id: "u3-workflows", brief: "Unit 3: workflows have verify phase; smoke/full; no silent ship." },
    #{ id: "u4-subagents", brief: "Unit 4: Linear/vault ownership; no lock steal; scoped prompts." },
    #{ id: "u5-hooks", brief: "Unit 5: matchable gate surfaces; hard floor; deny/allow/FP tests; live probes." },
];
if smoke {
    lanes = [#{ id: "u5-hooks", brief: "Smoke: hooks/gates only — matchable + hard floor + tests." }];
}

let jobs = [];
for lane in lanes {
    let p = "Specialist " + lane.id + ".\n" + safety() +
        "Capture: " + json_encode(capture) + "\n" +
        "Brief: " + lane.brief + "\nSet lane=" + lane.id + ".\n";
    jobs.push(#{ prompt: p, label: "lane:" + lane.id, capability_mode: "read-only", output_schema: lane_schema });
}
let reviews = parallel(jobs);

phase("Verify");
let vjobs = [];
let i = 0;
for review in reviews {
    let lid = lanes[i].id;
    let cand = #{ lane: lid, findings: [], residual_uncertainty: ["UNVERIFIED"] };
    if review != () && review.success && review.output != () { cand = review.output; }
    vjobs.push(#{
        prompt: "Adversarial verify lane " + lid + ".\n" + safety() + "Candidate: " + json_encode(cand) + "\n",
        label: "verify:" + lid,
        capability_mode: "read-only",
        output_schema: lane_schema,
    });
    i += 1;
}
let verified = parallel(vjobs);

phase("Review");
let synth = agent(
    "GSD Review synthesizer + Ralph readiness.\n" + safety() +
    "Capture: " + json_encode(capture) + "\nVerified: " + json_encode(verified) + "\n" +
    "ralph_ready=true only if hooks/skills have matchable enforcement where irreversible.\n",
    #{ label: "gsd-review", capability_mode: "read-only", output_schema: board_schema },
);

if synth == () || !synth.success || synth.output == () {
    let fb = "# Context Engineering PR Check - DEGRADED\n";
    let path = write_scratch_file("context-engineering-pr-check-report.md", fb);
    complete(#{ path: path, status: "degraded", report: fb });
}

let report = synth.output;
let md = report.markdown_report;
if md == () || clean(md) == "" { md = "# Context Engineering PR Check\n(empty report)\n"; }
let path = write_scratch_file("context-engineering-pr-check-report.md", md);
complete(#{
    path: path,
    status: "complete",
    gsd_review: report.gsd_review,
    ralph_ready: report.ralph_ready,
    blockers: report.blockers,
    ranked_findings: report.ranked_findings,
    report: md,
    smoke: smoke,
    invocation: "/context-engineering-pr-check",
});
