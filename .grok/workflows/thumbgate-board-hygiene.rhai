let meta = #{
    name: "thumbgate-board-hygiene",
    description: "Classify ThumbGate open Issues+PRs, drain BEHIND Dependabot, never approve",
    when_to_use: "Holdup screenshot of /issues or /pulls, 18 open PRs, 4 open issues, Dependabot 4/4 wall. /thumbgate-board-hygiene",
    phases: [
        #{ title: "Inventory", detail: "Classify every open PR and Issue" },
        #{ title: "Act", detail: "update-branch / pr-manage / comment — never approve" },
        #{ title: "Verify", detail: "Refuse approve/--admin/--auto; cite actions" },
    ],
};

let inventory_schema = #{
    "type": "object",
    "required": ["behind", "dirty", "ready", "issues_open", "holdup"],
    "properties": #{
        "behind": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "dirty": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "ready": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "issues_open": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
        "holdup": #{ "type": "string" },
    },
};

let act_schema = #{
    "type": "object",
    "required": ["actions", "approved_any"],
    "properties": #{
        "actions": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
        "approved_any": #{ "type": "boolean" },
    },
};

if (args != () && args.smoke == true) {
    complete(#{ summary: "smoke", holdup: "BEHIND Dependabot after Trunk land" });
}

phase("Inventory");
let inv = agent(
    "Use gh pr list and gh issue list on IgorGanapolsky/ThumbGate. Classify each open PR as behind/ready/dirty/pending/trunk_queued. Classify each open Issue as eci_pause/implement/umbrella. The GitHub 4/4 badge is not mergeable. Set holdup to the real blocker in one sentence. Do not approve. Do not merge.",
    #{ label: "inventory", capability_mode: "read-only", output_schema: inventory_schema }
);
if (inv == () || inv.success != true) {
    complete(#{ summary: "inventory failed", ok: false });
}

phase("Act");
let act = agent(
    "Run `node scripts/thumbgate-board-loop.js --apply --json` from the ThumbGate repo (isolated worktree if the primary is leased). At most one gh pr update-branch and one pr-manager submit. Comment Issues with the board-loop marker if unmarked. NEVER gh pr review --approve, NEVER --admin, NEVER gh pr merge --auto. Set approved_any=false. List actions taken.",
    #{ label: "act", capability_mode: "execute", output_schema: act_schema }
);

phase("Verify");
if (act == () || act.success != true || act.output.approved_any == true) {
    complete(#{ summary: "act refused or approved_any", ok: false });
}
complete(#{
    summary: "board loop ticked",
    holdup: inv.output.holdup,
    actions: act.output.actions,
    ok: true,
});
