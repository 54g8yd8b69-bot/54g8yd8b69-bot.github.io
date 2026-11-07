/* DentalAudit — shared utilities
 * Plain scripts (no ES modules) so the app runs straight from file://.
 * Everything hangs off a single global namespace: window.DA
 */
window.DA = window.DA || {};

DA.utils = (function () {
  const DAY = 86400000;

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Escape text for safe insertion into HTML strings. */
  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toDate(v) {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d) ? null : d;
  }

  function fmtDate(v, opts) {
    const d = toDate(v);
    if (!d) return '—';
    return d.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtDateShort(v) {
    return fmtDate(v, { day: 'numeric', month: 'short' });
  }

  /** ISO yyyy-mm-dd for <input type="date"> */
  function isoDay(v) {
    const d = toDate(v) || new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function startOfDay(v) {
    const d = toDate(v) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** Whole days from today until the given date (negative = past). */
  function daysUntil(v) {
    const d = toDate(v);
    if (!d) return null;
    return Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
  }

  function relTime(v) {
    const d = toDate(v);
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    const hrs = Math.round(min / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    const days = Math.round(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    return fmtDate(d);
  }

  function dueLabel(v) {
    const n = daysUntil(v);
    if (n === null) return '—';
    if (n < -1) return Math.abs(n) + ' days overdue';
    if (n === -1) return '1 day overdue';
    if (n === 0) return 'Due today';
    if (n === 1) return 'Due tomorrow';
    return 'In ' + n + ' days';
  }

  function addDays(v, n) {
    const d = toDate(v) || new Date();
    return new Date(d.getTime() + n * DAY);
  }

  function pct(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n) + '%';
  }

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (p) { return p.charAt(0).toUpperCase(); })
      .join('') || '?';
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /** Deterministic PRNG (mulberry32) so seeded demo data is stable. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Parse "#/audits/abc?tab=x" → { path: ['audits','abc'], query: {tab:'x'} } */
  function parseHash(hash) {
    const raw = (hash || '').replace(/^#\/?/, '');
    const [p, q] = raw.split('?');
    const path = (p || '').split('/').filter(Boolean).map(decodeURIComponent);
    const query = {};
    (q || '').split('&').filter(Boolean).forEach(function (kv) {
      const [k, v] = kv.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { path: path, query: query };
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function slug(s) {
    return String(s || 'audit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  }

  return {
    DAY, uid, esc, toDate, fmtDate, fmtDateShort, isoDay, daysUntil, relTime, dueLabel,
    addDays, pct, initials, debounce, rng, parseHash, download, csvCell, slug, startOfDay
  };
})();
