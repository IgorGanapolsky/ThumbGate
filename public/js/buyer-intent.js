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
      return;
    }
    global.plausible = global.plausible || function() {
      (global.plausible.q = global.plausible.q || []).push(arguments);
    };
    if (typeof global.plausible === 'function') {
      global.plausible(eventName, { props: props || {} });
    }
  }

  function getCurrentPathname() {
    return global.location && global.location.pathname
      ? global.location.pathname.replace(/\/$/, '') || '/'
      : '/';
  }

  function normalizePlacement(pathname) {
    return String(pathname || '/')
      .replace(/\.html$/, '')
      .replace(/^\//, '')
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'home';
  }

  function isRevenueAssistEligible(pathname) {
    var path = String(pathname || '/');
    if (path === '/checkout/pro' || path.indexOf('/go/pro') === 0) return false;
    if (path === '/' || path === '/guide' || path === '/guide.html') return true;
    if (path === '/dashboard' || path === '/dashboard.html') return true;
    if (path === '/learn' || path === '/learn.html' || path.indexOf('/learn/') === 0) return true;
    if (path === '/lessons' || path === '/lessons.html') return true;
    if (path === '/ai-malpractice-prevention' || path === '/ai-malpractice-prevention.html') return true;
    if (path.indexOf('/guides/') === 0) return true;
    return false;
  }

  function appendCampaignParams(href, params) {
    var origin = global.location && global.location.origin
      ? global.location.origin
      : 'https://thumbgate.ai';
    var url = new URL(href, origin);
    Object.keys(params || {}).forEach(function(key) {
      if (params[key] !== null && params[key] !== undefined) {
        url.searchParams.set(key, params[key]);
      }
    });
    return url.toString();
  }

  function injectRevenueAssistStyles() {
    if (!global.document || global.document.getElementById('thumbgate-revenue-assist-style')) {
      return;
    }
    var style = global.document.createElement('style');
    style.id = 'thumbgate-revenue-assist-style';
    style.textContent = [
      '[data-thumbgate-revenue-assist]{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:min(360px,calc(100vw - 32px));background:#0f172a;color:#f8fafc;border:1px solid rgba(148,163,184,.35);border-radius:8px;box-shadow:0 20px 60px rgba(2,6,23,.38);font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:14px}',
      '[data-thumbgate-revenue-assist] strong{display:block;font-size:15px;margin:0 0 5px}',
      '[data-thumbgate-revenue-assist] p{margin:0 0 10px;color:#cbd5e1}',
      '[data-thumbgate-revenue-assist] nav{display:flex;gap:8px;flex-wrap:wrap}',
      '[data-thumbgate-revenue-assist] a,[data-thumbgate-revenue-assist] button{border-radius:6px;border:1px solid rgba(148,163,184,.45);padding:8px 10px;font-weight:700;text-decoration:none;cursor:pointer}',
      '[data-thumbgate-revenue-assist] a:first-child{background:#22d3ee;color:#082f49;border-color:#22d3ee}',
      '[data-thumbgate-revenue-assist] a:nth-child(2){background:#f8fafc;color:#0f172a;border-color:#f8fafc}',
      '[data-thumbgate-revenue-assist] button{background:transparent;color:#cbd5e1}',
      '[data-thumbgate-abandon-survey]{position:fixed;right:18px;bottom:18px;z-index:2147483001;width:min(380px,calc(100vw - 32px));background:#111827;color:#f9fafb;border:1px solid rgba(148,163,184,.4);border-radius:8px;box-shadow:0 20px 60px rgba(2,6,23,.42);font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:14px}',
      '[data-thumbgate-abandon-survey] strong{display:block;font-size:15px;margin-bottom:8px}',
      '[data-thumbgate-abandon-survey] div{display:grid;gap:7px}',
      '[data-thumbgate-abandon-survey] button{border-radius:6px;border:1px solid rgba(148,163,184,.45);background:#1f2937;color:#f9fafb;padding:8px 10px;text-align:left;cursor:pointer}',
      '@media (max-width:640px){[data-thumbgate-revenue-assist],[data-thumbgate-abandon-survey]{right:12px;bottom:12px;width:calc(100vw - 24px)}}'
    ].join('');
    global.document.head.appendChild(style);
  }

  function initializeRevenueAssist(options) {
    var settings = options || {};
    if (!global.document || typeof global.document.querySelector !== 'function') return null;
    if (global.document.querySelector('[data-revenue-assist="off"]')) return null;
    if (global.document.querySelector('[data-thumbgate-revenue-assist]')) return null;

    var pathname = settings.pathname || getCurrentPathname();
    if (!isRevenueAssistEligible(pathname)) return null;

    injectRevenueAssistStyles();

    var placement = settings.placement || normalizePlacement(pathname);
    var campaign = settings.campaign || 'high_traffic_pages';
    var proHref = appendCampaignParams(settings.proHref || '/checkout/pro', {
      confirm: '1',
      utm_source: 'owned_site',
      utm_medium: 'sticky_cta',
      utm_campaign: campaign,
      cta_id: 'assist_pro_checkout',
      cta_placement: placement,
      plan_id: 'pro',
    });
    var diagnosticHref = appendCampaignParams(settings.diagnosticHref || 'https://buy.stripe.com/00w14neyUcXA5pL5e33sI0e', {
      utm_source: 'owned_site',
      utm_medium: 'sticky_cta',
      utm_campaign: campaign,
      cta_id: 'assist_workflow_diagnostic',
      cta_placement: placement,
      client_reference_id: 'thumbgate_assist_' + placement,
    });

    var panel = global.document.createElement('aside');
    panel.setAttribute('data-thumbgate-revenue-assist', placement);
    panel.setAttribute('aria-label', 'ThumbGate paid help');
    panel.innerHTML = [
      '<strong>Stop the repeated agent failure?</strong>',
      '<p>Use Pro for self-serve proof, or buy the diagnostic when one workflow is already costing time.</p>',
      '<nav>',
      '<a data-assist-cta="assist_pro_checkout" href="' + proHref + '">Get Pro</a>',
      '<a data-assist-cta="assist_workflow_diagnostic" href="' + diagnosticHref + '" rel="nofollow">Pay $499 diagnostic</a>',
      '<button type="button" data-assist-dismiss>Not now</button>',
      '</nav>'
    ].join('');

    panel.querySelectorAll('[data-assist-cta]').forEach(function(link) {
      link.addEventListener('click', function() {
        try {
          global.sessionStorage.setItem('thumbgateRevenueAssistCheckoutSeen', '1');
        } catch (_error) {}
        trackEvent('assist_cta_click', {
          ctaId: link.getAttribute('data-assist-cta'),
          ctaPlacement: placement,
          page: pathname,
        });
      });
    });

    var dismissButton = panel.querySelector('[data-assist-dismiss]');
    if (dismissButton) {
      dismissButton.addEventListener('click', function() {
        trackEvent('assist_cta_dismiss', {
          ctaPlacement: placement,
          page: pathname,
        });
        panel.remove();
        showAbandonSurvey('cta_dismiss');
      });
    }

    global.document.body.appendChild(panel);
    trackEvent('assist_cta_impression', {
      ctaPlacement: placement,
      page: pathname,
    });

    function wasSurveyShown() {
      try {
        return global.sessionStorage.getItem('thumbgateRevenueAssistSurveyShown') === '1';
      } catch (_error) {
        return false;
      }
    }

    function markSurveyShown() {
      try {
        global.sessionStorage.setItem('thumbgateRevenueAssistSurveyShown', '1');
      } catch (_error) {}
    }

    function checkoutWasSeen() {
      try {
        return global.sessionStorage.getItem('thumbgateRevenueAssistCheckoutSeen') === '1';
      } catch (_error) {
        return false;
      }
    }

    function showAbandonSurvey(trigger) {
      if (wasSurveyShown() || checkoutWasSeen() || global.document.querySelector('[data-thumbgate-abandon-survey]')) {
        return;
      }
      markSurveyShown();
      var survey = global.document.createElement('aside');
      survey.setAttribute('data-thumbgate-abandon-survey', trigger || 'unknown');
      survey.setAttribute('aria-label', 'ThumbGate checkout feedback');
      survey.innerHTML = [
        '<strong>What stopped you from buying today?</strong>',
        '<div>',
        '<button type="button" data-abandon-reason="fit_unclear">Not sure it fits my agent stack</button>',
        '<button type="button" data-abandon-reason="need_proof">Need proof before paying</button>',
        '<button type="button" data-abandon-reason="price_scope_unclear">Price or scope is unclear</button>',
        '<button type="button" data-abandon-reason="researching">Just researching</button>',
        '</div>'
      ].join('');
      survey.querySelectorAll('[data-abandon-reason]').forEach(function(button) {
        button.addEventListener('click', function() {
          trackEvent('checkout_abandon_reason', {
            reason: button.getAttribute('data-abandon-reason'),
            trigger: trigger || 'unknown',
            ctaPlacement: placement,
            page: pathname,
          });
          survey.remove();
        });
      });
      global.document.body.appendChild(survey);
      trackEvent('checkout_abandon_prompt', {
        trigger: trigger || 'unknown',
        ctaPlacement: placement,
        page: pathname,
      });
    }

    if (global.setTimeout) {
      global.setTimeout(function() {
        showAbandonSurvey('dwell_45s');
      }, settings.surveyDelayMs || 45000);
    }
    if (global.document && global.document.addEventListener) {
      global.document.addEventListener('mouseleave', function(event) {
        if (event && event.clientY <= 0) {
          showAbandonSurvey('exit_intent');
        }
      });
    }

    return {
      panel: panel,
      showAbandonSurvey: showAbandonSurvey,
      placement: placement,
    };
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
    initializeRevenueAssist: initializeRevenueAssist,
    isRevenueAssistEligible: isRevenueAssistEligible,
    trackEvent: trackEvent,
    initializeBehaviorAnalytics: initializeBehaviorAnalytics,
    bucketDwellMs: bucketDwellMs,
    bucketScrollPercent: bucketScrollPercent,
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function() {
        initializeRevenueAssist();
      });
    } else {
      initializeRevenueAssist();
    }
  }
})(globalThis);
