/* DentalAudit — hash router
 * Hash-based so it works from file:// without a server. Only the main view
 * region is re-rendered; the sidebar and top bar persist.
 *
 * A view module looks like:
 *   DA.views.x = {
 *     nav: 'dashboard',                       // sidebar item to highlight
 *     title(params) -> string,
 *     crumbs(params) -> [{label, href?}],
 *     render(el, params),                     // write into the view container
 *     keepOnStoreChange: false                // true = don't auto re-render on data changes
 *   }
 */
DA.router = (function () {
  const routes = [];
  let current = null;
  const afterHooks = [];

  /** pattern like 'audits/:id' */
  function add(pattern, view) {
    routes.push({ parts: pattern.split('/').filter(Boolean), view: view });
  }

  function match(path) {
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (r.parts.length !== path.length) continue;
      const params = {};
      let ok = true;
      for (let j = 0; j < r.parts.length; j++) {
        const p = r.parts[j];
        if (p.charAt(0) === ':') params[p.slice(1)] = path[j];
        else if (p !== path[j]) { ok = false; break; }
      }
      if (ok) return { view: r.view, params: params };
    }
    return null;
  }

  function resolve() {
    const parsed = DA.utils.parseHash(location.hash);
    const path = parsed.path.length ? parsed.path : ['dashboard'];
    const m = match(path) || { view: DA.views.notFound, params: {} };
    m.params.query = parsed.query;
    current = m;
    render();
  }

  function render() {
    if (!current) return;
    const el = document.getElementById('view');
    DA.ui.destroyCharts();
    DA.ui.closeModal();
    const v = current.view;
    el.innerHTML = '';
    el.classList.remove('view-enter');
    void el.offsetWidth; // restart entrance animation
    el.classList.add('view-enter');
    v.render(el, current.params);
    afterHooks.forEach(function (fn) { fn(v, current.params); });
  }

  /** Re-render the current view in response to a data change. */
  function refresh(force) {
    if (current && (force || !current.view.keepOnStoreChange)) {
      const y = document.getElementById('main').scrollTop;
      render();
      document.getElementById('main').scrollTop = y;
    } else if (current) {
      afterHooks.forEach(function (fn) { fn(current.view, current.params); });
    }
  }

  function go(hash) {
    if (location.hash === hash) resolve();
    else location.hash = hash;
  }

  function onAfter(fn) { afterHooks.push(fn); }

  function start() {
    window.addEventListener('hashchange', function () {
      resolve();
      document.getElementById('main').scrollTop = 0;
    });
    resolve();
  }

  return { add: add, start: start, go: go, refresh: refresh, onAfter: onAfter, current: function () { return current; } };
})();
