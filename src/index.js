'use strict';

const feedbackLoop = require('../scripts/feedback-loop');
const {
  HermesPlatformProtocol,
  ProtocolError,
  CONSEQUENTIAL_ACTIONS,
  VALID_APPROVAL_SURFACES,
  INVALID_APPROVAL_SURFACES,
  THREAD_MODES,
  FORBIDDEN_IDENTITIES,
  isNamedIdentity,
} = require('./hermes-platform-protocol');
const { HermesSyncPlane } = require('./hermes-sync-plane');
const {
  IdeaBrowserConnector,
  ToolTier,
  DEFAULT_READ_ONLY_TOOLS,
  DEFAULT_MUTATING_TOOLS,
} = require('./integrations/ideabrowser-connector');

// The package entry point is the production surface for `thumbgate`.
// The hosted-Hermes identity/lifecycle/approval gates are exported here so
// callers instantiate them from the public API rather than reaching into
// module paths. See docs: hosted Hermes requests route through
// HermesPlatformProtocol for turn lifecycle + approvals, and through
// HermesSyncPlane for the authorized-shape read path.
module.exports = Object.assign({}, feedbackLoop, {
  HermesPlatformProtocol,
  HermesSyncPlane,
  ProtocolError,
  CONSEQUENTIAL_ACTIONS,
  VALID_APPROVAL_SURFACES,
  INVALID_APPROVAL_SURFACES,
  THREAD_MODES,
  FORBIDDEN_IDENTITIES,
  isNamedIdentity,
  IdeaBrowserConnector,
  ToolTier,
  DEFAULT_READ_ONLY_TOOLS,
  DEFAULT_MUTATING_TOOLS,
});
