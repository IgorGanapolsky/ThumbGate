(function () {
  'use strict';
  var selected = new URL(window.location.href).searchParams.get('project');
  if (selected === 'all') selected = null;
  var selectedDir = selected ? new URL(window.location.href).searchParams.get('projectDir') : null;
  var loading = null;
  function url(input) {
    var target = new URL(input, window.location.origin);
    if (target.origin !== window.location.origin) return target.href;
    if (selected) target.searchParams.set('project', selected);
    if (selected && selectedDir) target.searchParams.set('projectDir', selectedDir);
    return target.pathname + target.search + target.hash;
  }
  function mount() {
    if (document.getElementById('projectSwitcher')) return;
    var container = document.createElement('section');
    container.id = 'projectOverview';
    container.className = 'container';
    container.style.cssText = 'padding:12px 20px;max-width:1200px;margin:auto';
    var bar = document.createElement('div'); bar.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap';
    var label = document.createElement('label');
    label.htmlFor = 'projectSwitcher'; label.textContent = 'Project'; label.style.cssText = 'font-weight:600';
    var select = document.createElement('select');
    select.id = 'projectSwitcher'; select.style.cssText = 'padding:8px;min-width:260px;max-width:100%;background:var(--bg-raised,#18181b);color:var(--text,#fafafa);border:1px solid var(--border,#444);border-radius:6px';
    var all = document.createElement('option'); all.value = ''; all.textContent = 'All projects (account-wide, not one project)'; select.appendChild(all);
    if (selected) { var pending = document.createElement('option'); pending.value = selected; pending.textContent = 'Selected project'; select.appendChild(pending); select.value = selected; }
    select.addEventListener('change', function () { var next = new URL(window.location.href); next.searchParams.delete('projectDir'); if (select.value) next.searchParams.set('project', select.value); else next.searchParams.delete('project'); window.location.assign(next.href); });
    var status = document.createElement('span'); status.id = 'projectStatus'; status.setAttribute('role', 'status'); status.style.cssText = 'color:var(--text-muted,#a1a1aa)';
    var cards = document.createElement('div'); cards.id = 'projectCards'; cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:12px';
    var sharedGates = document.createElement('p'); sharedGates.id = 'projectGlobalGates'; sharedGates.style.cssText = 'margin:8px 0 0;color:var(--text-muted,#a1a1aa);font-size:13px';
    bar.append(label, select, status);
    container.append(bar, sharedGates, cards);
    // The dashboard's top bar is a <nav class="app-top-nav">, not a <header>: anchor under it so the switcher never lands above the site nav.
    var anchor = document.querySelector('.app-top-nav') || document.querySelector('header');
    if (anchor) anchor.after(container); else document.body.prepend(container);
  }
  function hasActivity(project) {
    if (project.empty === true) return false;
    var c = project.counts || {};
    return Boolean(c.feedback || c.lessons || c.gates || c.blocks || c.warns || c.toolCalls || c.agents);
  }
  function refresh(headers) {
    mount();
    if (loading) return loading;
    loading = fetch('/v1/projects', { credentials: 'include', headers: headers || {} }).then(function (response) { if (!response.ok) throw new Error('Projects unavailable'); return response.json(); }).then(function (data) {
      var select = document.getElementById('projectSwitcher');
      while (select.options.length > 1) select.remove(1);
      var projects = Array.isArray(data.projects) ? data.projects : [];
      if (selected && !projects.some(function (project) { return project.projectKey === selected; })) projects.push({ projectKey: selected, projectName: 'Project with no recorded activity', counts: {} });
      // Leftover identities with nothing recorded are not worth a pick: hide them and say how many.
      var shown = projects.filter(function (project) { return hasActivity(project) || project.projectKey === selected; });
      var hidden = projects.length - shown.length;
      shown.forEach(function (project) { var option = document.createElement('option'); option.value = project.projectKey; var f = (project.counts || {}).feedback || 0; option.textContent = project.projectName + ' · ' + f + ' feedback'; select.appendChild(option); });
      select.value = selected || '';
      var current = projects.find(function (project) { return project.projectKey === selected; });
      var hiddenNote = hidden > 0 ? ' ' + hidden + ' project' + (hidden === 1 ? '' : 's') + ' with no recorded activity hidden.' : '';
      document.getElementById('projectStatus').textContent = current ? current.projectName : 'Account-wide view: mixes every project and store. Pick a project for its own numbers.' + hiddenNote;
      document.getElementById('projectGlobalGates').textContent = (data.globalGateCount || 0) + ' global gates shared across projects';
      var cards = document.getElementById('projectCards'); cards.replaceChildren();
      if (!selected) shown.forEach(function (project) {
        var card = document.createElement('a'); card.href = '?project=' + encodeURIComponent(project.projectKey); card.style.cssText = 'display:flex;flex-direction:column;gap:4px;border:1px solid var(--border,#444);border-radius:8px;padding:12px;color:inherit;min-width:0;text-decoration:none';
        var title = document.createElement('strong'); title.textContent = project.projectName;
        var counts = document.createElement('div'); var c = project.counts || {}; counts.style.cssText = 'font-size:13px'; counts.textContent = (c.feedback || 0) + ' feedback · ' + (c.lessons || 0) + ' lessons · ' + (c.gates || 0) + ' active gates · ' + (c.blocks || 0) + ' blocks · ' + (c.warns || 0) + ' warnings · ' + (c.toolCalls || 0) + ' tool calls · ' + (c.agents || 0) + ' agents';
        var activity = document.createElement('small'); activity.style.cssText = 'color:var(--text-muted,#a1a1aa)'; activity.textContent = project.lastActivity ? 'Last activity ' + new Date(project.lastActivity).toLocaleString() : 'No recorded activity';
        card.append(title, counts, activity); cards.appendChild(card);
      });
    }).catch(function () { document.getElementById('projectStatus').textContent = 'Project list unavailable'; }).finally(function () { loading = null; });
    return loading;
  }
  function unavailable(data) {
    if (!selected) return;
    var mapping = { team: ['tab-team'], settingsStatus: ['tab-settings'], templateLibrary: ['tab-templates'], analytics: ['tab-enterprise', 'chatPanel'], readiness: ['tab-ai-inventory'], predictive: ['tab-generated'], tokenSavings: ['tokenSavingsPanel'] };
    (data.unavailableMetrics || []).forEach(function (metric) {
      (mapping[metric] || []).forEach(function (id) {
        var container = document.getElementById(id);
        if (!container) return;
        Array.from(container.children).forEach(function (child) { if (!child.classList.contains('project-unavailable-message')) { child.hidden = true; child.style.display = 'none'; } });
        if (!container.querySelector('.project-unavailable-message')) { var message = document.createElement('p'); message.className = 'project-unavailable-message'; message.textContent = 'Unavailable for this project'; container.appendChild(message); }
      });
    });
  }
  document.addEventListener('click', function (event) {
    var anchor = event.target.closest && event.target.closest('a[href]');
    if (!anchor || !selected) return;
    var target = new URL(anchor.href, location.href);
    if (target.origin === location.origin && /^\/(dashboard|lessons)(\/|$)/.test(target.pathname)) anchor.href = url(target.href);
  }, true);
  window.ThumbGateProjects = { url: url, refresh: refresh, unavailable: unavailable, selected: selected };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
