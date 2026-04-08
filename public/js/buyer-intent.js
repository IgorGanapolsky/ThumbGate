(function(global) {
  var BUYER_EMAIL_STORAGE_KEY = 'thumbgateBuyerEmail';
  var CHECKOUT_LINK_SELECTOR = 'a[href*="/checkout/pro"]';
  var BUYER_EMAIL_SELECTOR = '[data-buyer-email]';

  function normalizeBuyerEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isValidBuyerEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeBuyerEmail(value));
  }

  function getStorage() {
    return global.localStorage && typeof global.localStorage.getItem === 'function'
      ? global.localStorage
      : null;
  }

  function getStoredBuyerEmail() {
    var storage = getStorage();
    if (!storage) {
      return '';
    }
    try {
      return normalizeBuyerEmail(storage.getItem(BUYER_EMAIL_STORAGE_KEY));
    } catch (_error) {
      return '';
    }
  }

  function storeBuyerEmail(email) {
    var storage = getStorage();
    if (!storage) {
      return false;
    }
    try {
      storage.setItem(BUYER_EMAIL_STORAGE_KEY, normalizeBuyerEmail(email));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function resolveCheckoutUrl(urlValue, email) {
    var origin = global.location && global.location.origin
      ? global.location.origin
      : 'https://thumbgate.invalid';
    var checkoutUrl = new URL(String(urlValue || '/checkout/pro'), origin);
    if (checkoutUrl.origin !== origin || checkoutUrl.pathname !== '/checkout/pro') {
      checkoutUrl = new URL('/checkout/pro', origin);
    }
    if (isValidBuyerEmail(email)) {
      checkoutUrl.searchParams.set('customer_email', normalizeBuyerEmail(email));
    } else {
      checkoutUrl.searchParams.delete('customer_email');
    }
    return checkoutUrl;
  }

  function getCheckoutLinks(selector) {
    if (!global.document || typeof global.document.querySelectorAll !== 'function') {
      return [];
    }
    return Array.from(global.document.querySelectorAll(selector || CHECKOUT_LINK_SELECTOR));
  }

  function getBaseCheckoutHref(link) {
    if (!link.dataset.baseHref) {
      link.dataset.baseHref = link.getAttribute('href') || link.href || '/checkout/pro';
    }
    return link.dataset.baseHref;
  }

  function applyBuyerEmailToCheckoutLinks(email, selector) {
    getCheckoutLinks(selector).forEach(function(link) {
      link.href = resolveCheckoutUrl(getBaseCheckoutHref(link), email).toString();
    });
  }

  function hydrateBuyerEmailInputs(email, selector) {
    if (!global.document || typeof global.document.querySelectorAll !== 'function') {
      return;
    }
    Array.from(global.document.querySelectorAll(selector || BUYER_EMAIL_SELECTOR)).forEach(function(input) {
      if (!input.value) {
        input.value = normalizeBuyerEmail(email);
      }
    });
  }

  function getNewsletterStatusElement(form) {
    if (!form) {
      return null;
    }
    return form.querySelector('[data-newsletter-status]')
      || (form.parentElement ? form.parentElement.querySelector('[data-newsletter-status]') : null);
  }

  function setNewsletterStatus(form, message, ok) {
    var statusEl = getNewsletterStatusElement(form);
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.style.color = ok ? 'var(--cyan)' : 'var(--red, #f87171)';
  }

  async function submitNewsletterSignup(email, form) {
    var action = form && form.action ? form.action : '/api/newsletter';
    var response = await fetch(action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Requested-With': 'fetch',
      },
      body: new URLSearchParams({ email: normalizeBuyerEmail(email) }).toString(),
      credentials: 'same-origin',
    });
    if (!response.ok) {
      var errorMessage = 'Unable to save your email right now.';
      try {
        var errorBody = await response.json();
        if (errorBody && errorBody.error) {
          errorMessage = errorBody.error;
        }
      } catch (_error) {
        // Keep the default error message when the response is not JSON.
      }
      throw new Error(errorMessage);
    }
    try {
      return await response.json();
    } catch (_error) {
      return { accepted: true, duplicate: false };
    }
  }

  function trackEvent(eventName, props) {
    if (typeof global.plausible === 'function') {
      global.plausible(eventName, { props: props || {} });
    }
  }

  function getEmailFromInput(input) {
    return normalizeBuyerEmail(input && input.value);
  }

  function initializeBuyerIntent(options) {
    var settings = options || {};
    var storedEmail = getStoredBuyerEmail();
    if (storedEmail) {
      hydrateBuyerEmailInputs(storedEmail, settings.emailSelector);
      applyBuyerEmailToCheckoutLinks(storedEmail, settings.checkoutSelector);
    }

    if (!global.document || typeof global.document.querySelectorAll !== 'function') {
      return;
    }

    Array.from(global.document.querySelectorAll(settings.formSelector || '[data-newsletter-form]')).forEach(function(form) {
      form.addEventListener('submit', async function(event) {
        event.preventDefault();
        var input = form.querySelector(settings.formEmailSelector || 'input[name="email"]');
        var email = getEmailFromInput(input);
        if (!isValidBuyerEmail(email)) {
          setNewsletterStatus(form, settings.invalidEmailMessage || 'Enter a valid work email.', false);
          if (input) {
            input.focus();
          }
          return;
        }

        storeBuyerEmail(email);
        hydrateBuyerEmailInputs(email, settings.emailSelector);
        applyBuyerEmailToCheckoutLinks(email, settings.checkoutSelector);

        try {
          var result = await submitNewsletterSignup(email, form);
          var successMessage = result && result.duplicate
            ? (settings.duplicateMessage || 'You are already on the list. Checkout on this device is now prefilled.')
            : (settings.successMessage || 'Saved. We will keep checkout prefilled on this device.');
          setNewsletterStatus(form, successMessage, true);
          trackEvent('newsletter_signup', {
            page: form.dataset.page || settings.page || 'homepage',
            intent: form.dataset.intent || settings.intent || 'buyer_follow_up',
          });
        } catch (error) {
          setNewsletterStatus(
            form,
            error && error.message ? error.message : 'Unable to save your email right now.',
            false
          );
        }
      });
    });
  }

  function initializeEmailCheckoutButtons(options) {
    var settings = options || {};
    if (!global.document || typeof global.document.querySelectorAll !== 'function') {
      return;
    }

    Array.from(global.document.querySelectorAll(settings.buttonSelector || '.btn-email-checkout')).forEach(function(button) {
      button.addEventListener('click', async function() {
        var form = button.closest('form');
        var input = form ? form.querySelector(settings.formEmailSelector || 'input[name="email"]') : null;
        var email = getEmailFromInput(input) || getStoredBuyerEmail();
        if (!isValidBuyerEmail(email)) {
          setNewsletterStatus(form, settings.invalidCheckoutMessage || 'Enter a valid work email before checkout.', false);
          if (input) {
            input.focus();
          }
          return;
        }

        storeBuyerEmail(email);
        hydrateBuyerEmailInputs(email, settings.emailSelector);
        applyBuyerEmailToCheckoutLinks(email, settings.checkoutSelector);
        trackEvent(settings.eventName || 'pro_checkout_email_start', settings.eventProps || { page: 'pro', intent: 'checkout' });

        try {
          await submitNewsletterSignup(email, form);
        } catch (_error) {
          // Continue to checkout even if signup persistence fails.
        }

        var checkoutLink = global.document.querySelector(settings.checkoutLinkSelector || '.btn-pro-checkout');
        if (checkoutLink) {
          global.location.assign(checkoutLink.href);
        }
      });
    });
  }

  global.ThumbGateBuyerIntent = {
    normalizeBuyerEmail: normalizeBuyerEmail,
    isValidBuyerEmail: isValidBuyerEmail,
    getStoredBuyerEmail: getStoredBuyerEmail,
    storeBuyerEmail: storeBuyerEmail,
    resolveCheckoutUrl: resolveCheckoutUrl,
    applyBuyerEmailToCheckoutLinks: applyBuyerEmailToCheckoutLinks,
    hydrateBuyerEmailInputs: hydrateBuyerEmailInputs,
    setNewsletterStatus: setNewsletterStatus,
    submitNewsletterSignup: submitNewsletterSignup,
    initializeBuyerIntent: initializeBuyerIntent,
    initializeEmailCheckoutButtons: initializeEmailCheckoutButtons,
    trackEvent: trackEvent,
  };
})(globalThis);
