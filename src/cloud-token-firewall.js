function buildCiGithubActionsPreToolUseWorkflowYaml({ orgId, apiBaseUrl }) {
  return `name: ThumbGate B2B CI Enforcement

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  thumbgate-policy-sync:
    name: Enforce Pre-Tool Use Policy Sync
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Sync Policy
        run: |
          curl -X POST "${apiBaseUrl}/v1/cloud/policy-sync" \\
            -H "Authorization: Bearer \${{ secrets.THUMBGATE_CI_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "orgId": "${orgId}",
              "threatPacks": ["AWS", "SOC2", "Git/DB"]
            }'
`;
}

module.exports = {
  buildCiGithubActionsPreToolUseWorkflowYaml
};
