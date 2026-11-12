'use strict';

/**
 * scripts/mailer/index.js — public entry point for the mailer module.
 */

const {
  sendEmail,
  sendTrialWelcomeEmail,
  sendNewsletterWelcomeEmail,
  sendSignupWelcomeEmail,
  dispatchSignupWelcomeEmail,
  isBlockedSignupWelcomeRecipient,
  renderTrialWelcomeBodies,
  renderNewsletterWelcomeBodies,
  renderSignupWelcomeBodies,
} = require('./resend-mailer');

module.exports = {
  sendEmail,
  sendTrialWelcomeEmail,
  sendNewsletterWelcomeEmail,
  sendSignupWelcomeEmail,
  dispatchSignupWelcomeEmail,
  isBlockedSignupWelcomeRecipient,
  renderTrialWelcomeBodies,
  renderNewsletterWelcomeBodies,
  renderSignupWelcomeBodies,
};
