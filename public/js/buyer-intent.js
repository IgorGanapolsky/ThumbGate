(function(global) {
  var BUYER_EMAIL_STORAGE_KEY = 'thumbgateBuyerEmail';
  var CHECKOUT_LINK_SELECTOR = 'a[href*="/checkout/pro"], a[href*="/go/pro"]';
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
    var isHostedProRoute = checkoutUrl.origin === origin
      && (checkoutUrl.pathname === '/checkout/pro' || checkoutUrl.pathname === '/go/pro');
    if (!isHostedProRoute) {
      checkoutUrl = new URL('/checkout/pro', origin);
    }
    checkoutUrl.pathname = '/checkout/pro';
    checkoutUrl.searchParams.set('confirm', '1');
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

  function normalizeInteger(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  function bucketDwellMs(value) {
    var ms = normalizeInteger(value) || 0;
    if (ms < 10000) return 'under_10s';
    if (ms < 30000) return '10s_to_30s';
    if (ms < 60000) return '30s_to_60s';
    if (ms < 180000) return '1m_to_3m';
    return 'over_3m';
  }

  function bucketScrollPercent(value) {
    var pct = normalizeInteger(value);
    if (pct === null) return 'unknown';
    if (pct < 25) return 'under_25';
    if (pct < 50) return '25_to_49';
    if (pct < 75) return '50_to_74';
    if (pct < 100) return '75_to_99';
    return '100';
  }

  function initializeBehaviorAnalytics(options) {
    var settings = options || {};
    var sendTelemetry = typeof settings.sendTelemetry === 'function'
      ? settings.sendTelemetry
      : function() {};
    var state = {
      startedAt: Date.now(),
      maxScrollPercent: 0,
      lastVisibleSection: settings.initialSectionId || null,
      emailFocused: false,
      emailCaptured: false,
      sectionSeen: Object.create(null),
      ctaSeen: Object.create(null),
      exitSent: false,
    };

    function emit(eventType, extra) {
      sendTelemetry(eventType, Object.assign({
        pageType: settings.pageType || 'marketing',
        page: settings.pagePath || (global.location ? global.location.pathname : null),
        landingPath: settings.landingPath || (global.location ? global.location.pathname : null),
      }, extra || {}));
    }

    function observeTargets(targets, callback, threshold) {
      if (!global.IntersectionObserver || !Array.isArray(targets) || !targets.length || !global.document) {
        return null;
      }
      var observer = new global.IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          callback(entry.target);
        });
      }, { threshold: threshold || 0.45 });

      targets.forEach(function(target) {
        if (target && target.element) {
          observer.observe(target.element);
        }
      });
      return observer;
    }

    function resolveTargets(items) {
      if (!global.document || typeof global.document.querySelector !== 'function') {
        return [];
      }
      return (items || []).map(function(item) {
        var element = global.document.querySelector(item.selector);
        if (!element) return null;
        return Object.assign({ element: element }, item);
      }).filter(Boolean);
    }

    function markEmailCaptured() {
      state.emailCaptured = true;
    }

    var sectionTargets = resolveTargets(settings.sections);
    observeTargets(sectionTargets, function(target) {
      var sectionId = target.sectionId || target.id || target.selector || 'unknown';
      state.lastVisibleSection = sectionId;
      if (state.sectionSeen[sectionId]) return;
      state.sectionSeen[sectionId] = true;
      emit('section_view', {
        sectionId: sectionId,
        sectionLabel: target.sectionLabel || sectionId,
      });
    }, 0.35);

    var ctaTargets = resolveTargets(settings.ctaImpressions);
    observeTargets(ctaTargets, function(target) {
      var ctaId = target.ctaId || target.selector || 'unknown_cta';
      if (state.ctaSeen[ctaId]) return;
      state.ctaSeen[ctaId] = true;
      emit('cta_impression', {
        ctaId: ctaId,
        ctaPlacement: target.ctaPlacement || null,
        planId: target.planId || null,
      });
    }, 0.6);

    if (global.addEventListener) {
      global.addEventListener('scroll', function() {
        if (!global.document || !global.document.documentElement) return;
        var docHeight = global.document.documentElement.scrollHeight - (global.innerHeight || 0);
        if (docHeight <= 0) {
          state.maxScrollPercent = 100;
          return;
        }
        var nextPercent = Math.max(0, Math.min(100, Math.round(((global.scrollY || 0) / docHeight) * 100)));
        if (nextPercent > state.maxScrollPercent) {
          state.maxScrollPercent = nextPercent;
        }
      }, { passive: true });
    }

    if (global.document && typeof global.document.querySelectorAll === 'function') {
      var emailSelector = settings.emailSelector || '[data-buyer-email]';
      Array.from(global.document.querySelectorAll(emailSelector)).forEach(function(input) {
        input.addEventListener('focus', function() {
          if (state.emailFocused) return;
          state.emailFocused = true;
          emit('buyer_email_focus', {
            ctaId: settings.emailCtaId || 'buyer_email',
            ctaPlacement: settings.emailCtaPlacement || null,
          });
        });
      });

      Array.from(global.document.querySelectorAll(settings.newsletterFormSelector || '[data-newsletter-form]')).forEach(function(form) {
        form.addEventListener('submit', function() {
          var input = form.querySelector(settings.formEmailSelector || 'input[name="email"]');
          if (isValidBuyerEmail(getEmailFromInput(input))) {
            markEmailCaptured();
          }
        });
      });
    }

    function sendExitSignals() {
      if (state.exitSent) return;
      state.exitSent = true;
      var engagementMs = Math.max(0, Date.now() - state.startedAt);
      emit('page_exit', {
        lastVisibleSection: state.lastVisibleSection || 'unknown',
        engagementMs: engagementMs,
        dwellBucket: bucketDwellMs(engagementMs),
        maxScrollPercent: state.maxScrollPercent,
        scrollBucket: bucketScrollPercent(state.maxScrollPercent),
        buyerEmailFocused: state.emailFocused,
        buyerEmailCaptured: state.emailCaptured,
      });
      if (state.emailFocused && !state.emailCaptured) {
        emit('buyer_email_abandon', {
          lastVisibleSection: state.lastVisibleSection || 'unknown',
          engagementMs: engagementMs,
          dwellBucket: bucketDwellMs(engagementMs),
        });
      }
    }

    if (global.addEventListener) {
      global.addEventListener('pagehide', sendExitSignals);
      global.addEventListener('beforeunload', sendExitSignals);
    }

    return {
      markEmailCaptured: markEmailCaptured,
      sendExitSignals: sendExitSignals,
    };
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
    initializeBehaviorAnalytics: initializeBehaviorAnalytics,
    bucketDwellMs: bucketDwellMs,
    bucketScrollPercent: bucketScrollPercent,
  };
})(globalThis);
