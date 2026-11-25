/* Microsoft Clarity (heatmaps and session recordings) for the public marketing pages.
 *
 * Loaded only on pages that already carry the Plausible script. Never on /admin, the signed-in dashboard, lessons
 * or any other page that shows private data: the path check below is a second guard behind leaving the tag out of
 * those pages. Skipped when the browser sends Global Privacy Control or Do Not Track, the same rule the page's own
 * Plausible, Google Analytics and first-party events follow. Form fields are masked in the recording.
 */
(function () {
  // The ThumbGate Clarity project. Another site's project id must never be used on thumbgate.ai.
  var CLARITY_PROJECT_ID = 'zjaflwztgq';
  var PRIVATE_PATHS = /^\/(admin|dashboard|lessons|onboarding|account|login|signin|sign-in|success|v1|api)(\/|\.html|$)/i;

  try {
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
    if (PRIVATE_PATHS.test(window.location.pathname)) return;
  } catch (_) {
    return;
  }

  // Standard Clarity install snippet.
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', CLARITY_PROJECT_ID);

  // Mask every form field in recordings, whatever the project's default mode is.
  function maskFields() {
    var fields = document.querySelectorAll('input, textarea, select');
    for (var n = 0; n < fields.length; n += 1) fields[n].setAttribute('data-clarity-mask', 'True');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maskFields);
  else maskFields();

  // One Clarity custom event per Pro checkout click, beside the Plausible checkout_start / pro_offer_click events
  // the pages already send on the same links. A delegated listener keeps it in step on every page.
  document.addEventListener('click', function (event) {
    try {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;
      var href = link.getAttribute('href') || '';
      if (!/^(https?:\/\/(www\.)?thumbgate\.ai)?\/checkout\/pro(\?|#|$)/i.test(href)) return;
      if (typeof window.clarity === 'function') window.clarity('event', 'checkout_click');
    } catch (_) { /* analytics must never break a checkout click */ }
  }, true);
})();
