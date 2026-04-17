'use strict';

/**
 * scripts/mailer/index.js — public entry point for the mailer module.
 */

const { sendEmail, sendTrialWelcomeEmail, renderTrialWelcomeBodies } = require('./resend-mailer');

module.exports = {
  sendEmail,
  sendTrialWelcomeEmail,
  renderTrialWelcomeBodies,
};
