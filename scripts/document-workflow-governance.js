'use strict';

function buildDocumentWorkflowPlan(options = {}) {
  const provider = options.provider || 'secure_content_layer';
  const workflow = options.workflow || 'document_intake_routing';

  return {
    workflow,
    provider,
    steps: [
      'discover eligible folders through approved connector scope',
      'extract document metadata inside sandbox',
      'classify document type with structured output',
      'route document to approved destination',
      'write audit event for every read, extraction, decision, and route',
    ],
    zeroTrust: {
      leastPrivilegeScopes: true,
      credentialsOutsideSandbox: true,
      noRawDocumentExportByDefault: true,
      perFolderApproval: true,
    },
    requiredEvidence: [
      'connector scope',
      'source document id',
      'classification result',
      'route destination',
      'audit event id',
      'sandbox manifest',
    ],
    gates: [
      'block routing when connector scope is missing',
      'block raw content export unless explicitly approved',
      'block completion claims without audit event id',
      'require human review for legal, financial, medical, or HR documents',
    ],
  };
}

function evaluateDocumentWorkflowRun(run = {}) {
  const issues = [];
  if (!run.connectorScope) issues.push('missing_connector_scope');
  if (!run.sourceDocumentId) issues.push('missing_source_document_id');
  if (!run.classification) issues.push('missing_classification');
  if (!run.routeDestination) issues.push('missing_route_destination');
  if (!run.auditEventId) issues.push('missing_audit_event_id');
  if (!run.sandboxManifest) issues.push('missing_sandbox_manifest');
  if (run.rawExport && !run.rawExportApproved) issues.push('raw_export_requires_approval');
  if (['legal', 'financial', 'medical', 'hr'].includes(String(run.classification).toLowerCase()) && !run.humanReviewed) {
    issues.push('sensitive_document_human_review_required');
  }

  return {
    decision: issues.length ? 'deny' : 'allow',
    issues,
  };
}

module.exports = {
  buildDocumentWorkflowPlan,
  evaluateDocumentWorkflowRun,
};
