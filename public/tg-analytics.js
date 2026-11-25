// Shared event helper for thumbgate.ai. Fires to GA4 and Plausible when present.
(function () {
  function tgTrack(name, params) {
    var p = params || {};
    try {
      if (typeof window.gtag === 'function') window.gtag('event', name, p);
    } catch (e) {}
    try {
      if (typeof window.plausible === 'function') window.plausible(name, { props: p });
    } catch (e) {}
  }

  function tgUtm() {
    var out = {};
    try {
      var stored = sessionStorage.getItem('tg_utm');
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    try {
      var q = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
        var v = q.get(k);
        if (v) out[k] = v;
      });
      if (Object.keys(out).length) sessionStorage.setItem('tg_utm', JSON.stringify(out));
    } catch (e) {}
    return out;
  }

  window.tgTrack = tgTrack;
  window.tgUtm = tgUtm;
})();