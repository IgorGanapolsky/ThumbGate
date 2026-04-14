---
phase: 03-governance-into-subway
plan: 04
type: execute
wave: 3
depends_on: [3-03]
files_modified:
  - /Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/gov-sync-report.md
autonomous: true
requirements: [GOV-06]

must_haves:
  truths:
    - "proof/governance-into-subway/gov-sync-report.md exists in the ThumbGate repo (not in Subway)"
    - "The proof report shows all 4 governance scripts operational with test pass counts"
    - "The proof report shows npm run test:governance exit 0 with count of tests passed"
    - "The proof report records the final ThumbGate node-runner count (must be >= 60 — no regression)"
    - "All 6 governance files exist in Subway at .claude/scripts/feedback/"
    - "The REQUIREMENTS.md GOV-01 through GOV-06 can all be marked complete based on evidence in the report"
  artifacts:
    - path: "/Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/gov-sync-report.md"
      provides: "Phase 3 proof report — evidence for GOV-01 through GOV-06"
      contains: "gov-sync-report"
  key_links:
    - from: "/Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/gov-sync-report.md"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/"
      via: "Report documents scripts ported and test results run from Subway"
      pattern: "GOV-0[1-6]"
---

<objective>
Generate the Phase 3 proof report in the ThumbGate repo, documenting all governance feature evidence and test results. Mark all GOV requirements complete in REQUIREMENTS.md.

Purpose: GOV-06 requires a proof report with evidence. The report is committed in ThumbGate (not Subway, which is gitignored via .git/info/exclude). This final Wave 3 plan certifies the phase is done.

Output:
- proof/governance-into-subway/gov-sync-report.md (in ThumbGate repo)
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/planning/PROJECT.md
@docs/planning/ROADMAP.md
@docs/planning/STATE.md
@docs/planning/phases/03-governance-into-subway/3-RESEARCH.md

Prior plan summaries (for evidence collection):
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/phases/03-governance-into-subway/3-01-SUMMARY.md
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/phases/03-governance-into-subway/3-02-SUMMARY.md
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/phases/03-governance-into-subway/3-03-SUMMARY.md

Proof report format reference:
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/automation/report.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Run all governance verification commands and generate proof report</name>
  <files>
    /Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/gov-sync-report.md
  </files>
  <action>
    STEP 1 — Run all verification commands and capture actual output:

    1. Verify all 6 governance scripts exist in Subway:
       ls /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/
       Capture: file list

    2. Verify all 4 config files exist:
       ls /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/
       ls /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/
       Capture: file lists

    3. Run governance test suite in Subway and capture exact output:
       cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npm run test:governance -- --no-coverage 2>&1
       Capture: full output including test counts and pass/fail

    4. Run ThumbGate npm test and capture test counts:
       cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && npm test 2>&1
       Capture: node-runner count, pass/fail

    5. Budget guard smoke test (GOV-01 evidence):
       THUMBGATE_FEEDBACK_DIR=/tmp/gov-proof-budget THUMBGATE_MONTHLY_BUDGET_USD=10 node -e "
         const { addSpend, getBudgetStatus } = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard');
         addSpend({ amountUsd: 0.25, source: 'proof-test', note: 'GOV-01 verify' });
         const s = getBudgetStatus();
         console.log(JSON.stringify(s, null, 2));
       "
       Capture: JSON output (shows month, totalUsd, budgetUsd, remainingUsd)

    6. Budget overspend rejection (GOV-01 evidence):
       THUMBGATE_FEEDBACK_DIR=/tmp/gov-proof-over THUMBGATE_MONTHLY_BUDGET_USD=0.10 node -e "
         const { addSpend } = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard');
         try {
           addSpend({ amountUsd: 0.20, source: 'proof-test' });
           console.log('UNEXPECTED: no error');
         } catch (e) {
           console.log('EXPECTED ERROR:', e.message);
         }
       "
       Capture: error message confirming Budget exceeded

    7. Intent router smoke test (GOV-02 evidence):
       node -e "
         const { planIntent } = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router');
         const r = planIntent({ bundleId: 'default-v1', mcpProfile: 'default', intentId: 'publish_dpo_training_data', approved: false });
         console.log(JSON.stringify(r, null, 2));
       "
       Capture: result showing status and checkpoint details
       Note: if publish_dpo_training_data is not a valid intentId in default-v1.json, read the actual
       bundle first and use a valid intentId from it.

    8. ContextFS smoke test (GOV-03 evidence):
       THUMBGATE_FEEDBACK_DIR=/tmp/gov-proof-ctx node -e "
         const { constructContextPack } = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs');
         console.log('constructContextPack:', typeof constructContextPack);
       "
       Capture: "function" confirmation

    9. Verify self-healing-check DEFAULT_CHECKS correctness (GOV-04 evidence):
       node -e "
         const sc = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/self-healing-check');
         const checks = sc.DEFAULT_CHECKS || sc.getDefaultChecks?.() || [];
         console.log('checks:', checks.map(c => c.name));
       "
       Capture: array of check names (should be budget_status, lint_check, format_check, test_ci)

    STEP 2 — Create directory and write proof report:

    mkdir -p /Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/

    Write /Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/gov-sync-report.md
    using the ACTUAL output captured in Step 1 — no placeholders, no invented numbers.

    Report format (follow proof/automation/report.md style):

    ```markdown
    # Governance into Subway — Proof Report

    **Generated:** {actual UTC timestamp}
    **Phase:** 03-governance-into-subway
    **ThumbGate baseline test count:** 60 node-runner tests (must not regress)

    ## Requirements Coverage

    | Requirement | Status | Evidence |
    |-------------|--------|---------|
    | GOV-01 | PASS | budget-guard.js operational; $0.25 spend adds correctly; $10.01 spend rejected |
    | GOV-02 | PASS | intent-router.js + mcp-policy.js load; planIntent returns checkpoint_required/ready |
    | GOV-03 | PASS | contextfs.js loads; constructContextPack is a function |
    | GOV-04 | PASS | self-heal.js + self-healing-check.js load; DEFAULT_CHECKS has Subway-adapted checks |
    | GOV-05 | PASS | {N} Jest governance tests pass across 5 test files |
    | GOV-06 | PASS | This report |

    ## Scripts Ported to Subway

    {actual ls output}

    ## Config Files Ported

    {actual ls output for .claude/config/}

    ## Test Results: Subway Governance Tests

    {actual npm run test:governance output}

    ## Test Results: ThumbGate Baseline (Regression Check)

    {actual npm test output — must show 60 node-runner tests}

    ## Smoke Test Evidence

    ### GOV-01: Budget Guard
    {actual addSpend output}
    {actual overspend error output}

    ### GOV-02: Intent Router
    {actual planIntent output}

    ### GOV-03: ContextFS
    {actual constructContextPack typeof output}

    ### GOV-04: Self-Healing Check
    {actual DEFAULT_CHECKS names output}

    ## Path Surgery Verification

    All 6 scripts use PROJECT_ROOT = path.join(__dirname, '..', '..', '..') resolving to Subway_RN_Demo/.

    ## Notes

    - Subway scripts are gitignored via .git/info/exclude — commits and proofs live in ThumbGate repo
    - Policy bundle tool names are ThumbGate-origin; update to Subway-specific tools in future cleanup
    - Lock timeout increased to timeoutMs:30000, staleMs:60000 for concurrent agent safety
    ```

    STEP 3 — Update REQUIREMENTS.md in ThumbGate to mark GOV-01 through GOV-06 complete:

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/REQUIREMENTS.md

    In the "Governance into Subway" section, change:
      - [ ] **GOV-01** → - [x] **GOV-01**
      - [ ] **GOV-02** → - [x] **GOV-02**
      - [ ] **GOV-03** → - [x] **GOV-03**
      - [ ] **GOV-04** → - [x] **GOV-04**
      - [ ] **GOV-05** → - [x] **GOV-05**
      - [ ] **GOV-06** → - [x] **GOV-06**

    Also update the Traceability table — change all GOV rows from "Pending" to "Complete".

    Write the updated REQUIREMENTS.md.

    STEP 4 — Update ROADMAP.md to mark Phase 3 complete:

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/ROADMAP.md

    In the progress table, update Phase 3 row:
      | 3. Governance into Subway | 0/TBD | Not started | - |
    to:
      | 3. Governance into Subway | 4/4 | Complete | {today's date} |

    Update the Phase 3 checkbox:
      - [ ] **Phase 3: Governance into Subway** → - [x] **Phase 3: Governance into Subway**

    Write the updated ROADMAP.md.

    STEP 5 — Update STATE.md:

    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/STATE.md

    Update "Current Position" to reflect Phase 3 complete.
    Add to Decisions section:
      - [Phase 03-governance-into-subway]: All 6 governance scripts ported to Subway with zero new npm deps; 5 Jest test files passing; proof committed in ThumbGate/proof/governance-into-subway/

    Write updated STATE.md.

    STEP 6 — Commit all proof artifacts to ThumbGate repo (NOT Subway):
      cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate
      git add proof/governance-into-subway/gov-sync-report.md docs/planning/REQUIREMENTS.md docs/planning/ROADMAP.md docs/planning/STATE.md
      git commit -m "feat(03-governance-into-subway): phase 3 complete — proof report + GOV-01..06 marked done"
  </action>
  <verify>
    # Proof report exists in ThumbGate repo
    ls /Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/gov-sync-report.md
    Expected: file exists

    # Report contains actual evidence (not placeholders)
    grep -c "PASS\|GOV-0[1-6]" /Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/gov-sync-report.md
    Expected: >= 6 (one line per GOV requirement)

    grep "\[x\]" /Users/ganapolsky_i/workspace/git/igor/ThumbGate/proof/governance-into-subway/gov-sync-report.md
    Expected: 0 (report uses PASS, not checkboxes — checkboxes are in REQUIREMENTS.md)

    # REQUIREMENTS.md has all GOV requirements checked
    grep "\[x\].*GOV-0" /Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/REQUIREMENTS.md | wc -l
    Expected: 6

    # ROADMAP.md shows Phase 3 complete
    grep "Governance into Subway.*Complete" /Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/ROADMAP.md
    Expected: 1 matching line

    # Proof report committed in ThumbGate
    cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && git log --oneline -3 | head -3
    Expected: most recent commit mentions governance or phase 3

    # Proof is in ThumbGate, not in Subway (Subway scripts are gitignored)
    cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && git status --short | grep "proof/"
    Expected: no output (proof is not tracked in Subway)
  </verify>
  <done>
    - proof/governance-into-subway/gov-sync-report.md exists with real evidence (no placeholders)
    - REQUIREMENTS.md: GOV-01 through GOV-06 all marked [x] complete
    - ROADMAP.md: Phase 3 row shows 4/4 complete with today's date
    - STATE.md: reflects Phase 3 completion
    - All proof artifacts committed to ThumbGate repo
    - Proof does NOT appear in Subway git status (gitignored correctly)
  </done>
</task>

</tasks>

<verification>
Complete Phase 3 verification:

1. All 6 scripts in Subway:
   ls /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/
   Expected: 6 files: budget-guard.js, contextfs.js, intent-router.js, mcp-policy.js, self-heal.js, self-healing-check.js

2. All governance tests pass:
   cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npm run test:governance -- --no-coverage 2>&1 | tail -5
   Expected: 0 failures

3. ThumbGate baseline intact:
   cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && npm test 2>&1 | tail -5
   Expected: 60 node-runner tests, exits 0

4. Proof report committed:
   cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && git log --oneline -1
   Expected: commit mentioning governance or GOV

5. All GOV requirements marked complete:
   grep -c "\[x\].*GOV" /Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/REQUIREMENTS.md
   Expected: 6
</verification>

<success_criteria>
1. proof/governance-into-subway/gov-sync-report.md exists with actual (not placeholder) evidence for all 6 GOV requirements
2. REQUIREMENTS.md shows [x] for GOV-01, GOV-02, GOV-03, GOV-04, GOV-05, GOV-06
3. ROADMAP.md Phase 3 marked complete with 4/4 plans
4. All artifacts committed to ThumbGate repo (not Subway)
5. ThumbGate npm test exits 0 with 60 node-runner tests (unchanged from baseline)
</success_criteria>

<output>
After completion, create /Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/phases/03-governance-into-subway/3-04-SUMMARY.md
</output>
