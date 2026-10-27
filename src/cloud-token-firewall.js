function auditZeroClickFailureCaptureAndAutoRulePromotion({ toolName, command, exitCode, repeatCount }) {
  if (exitCode !== 0 && repeatCount >= 2) {
    return {
      decision: 'deny',
      ruleId: 'cloud_token_zero_click_failure',
      reason: 'Repeated tool failure detected'
    };
  }
  return null;
}

module.exports = {
  auditZeroClickFailureCaptureAndAutoRulePromotion
};
