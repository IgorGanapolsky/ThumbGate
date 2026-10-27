function syncTeamPolicyAndThreatPacks({ orgId }) {
  // Mock function returning active CURATED_THREAT_PACKS and customRules
  return {
    CURATED_THREAT_PACKS: ['core-identity-protection', 'cloud-infrastructure-rules'],
    customRules: ['no-plaintext-secrets', 'enforce-tls-1.2']
  };
}

function exportTeamPolicyAsPreventionRulesMarkdown({ orgId }) {
  const { CURATED_THREAT_PACKS, customRules } = syncTeamPolicyAndThreatPacks({ orgId });

  let markdown = '# Prevention Rules\n\n';

  if (CURATED_THREAT_PACKS && CURATED_THREAT_PACKS.length > 0) {
    markdown += '## Curated Threat Packs\n';
    markdown += CURATED_THREAT_PACKS.map((pack) => `- ${pack}`).join('\n');
    markdown += '\n\n';
  }

  if (customRules && customRules.length > 0) {
    markdown += '## Custom Rules\n';
    markdown += customRules.map((rule) => `- ${rule}`).join('\n');
    markdown += '\n\n';
  }

  return markdown.trim() + '\n';
}

module.exports = {
  syncTeamPolicyAndThreatPacks,
  exportTeamPolicyAsPreventionRulesMarkdown
};
