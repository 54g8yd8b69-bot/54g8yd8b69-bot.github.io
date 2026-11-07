/* DentalAudit — derived metrics
 * Pure functions over audit objects. Nothing here touches the DOM or storage.
 *
 * Compliance is calculated per criterion as met / (met + not met);
 * "N/A" answers are excluded from the denominator, as in standard clinical audit practice.
 */
DA.metrics = (function () {
  const U = DA.utils;

  const STATUS = {
    active:     { label: 'Active',            tone: 'neutral', order: 1 },
    collecting: { label: 'Data collection',   tone: 'blue',    order: 2 },
    analysis:   { label: 'Analysis',          tone: 'violet',  order: 3 },
    action:     { label: 'Action planning',   tone: 'amber',   order: 4 },
    completed:  { label: 'Completed',         tone: 'green',   order: 5 }
  };
  const STATUS_KEYS = Object.keys(STATUS);       // the live workflow (drafts sit outside it)
  const DRAFT = { label: 'Draft', tone: 'draft', order: 0 };

  function statusMeta(key) {
    if (key === 'draft') return DRAFT;
    if (key === 'planning') return STATUS.active; // legacy v1 value
    return STATUS[key] || { label: key || 'Unknown', tone: 'neutral', order: 9 };
  }

  function isDraft(a) { return a.status === 'draft'; }
  /** Live and not yet completed. Drafts are not counted as active audits. */
  function isActive(a) { return a.status !== 'completed' && a.status !== 'draft'; }
  /** Everything except drafts — the set used for metrics, charts and reports. */
  function live(audits) { return audits.filter(function (a) { return !isDraft(a); }); }

  /**
   * Find the previous cycle's result for a criterion: by parentCriterionId,
   * falling back to position for audits created before criterion linking.
   */
  function previousResult(prevResults, criterion, index) {
    if (!prevResults) return null;
    if (criterion.parentCriterionId) {
      const hit = prevResults.find(function (r) { return r.criterion.id === criterion.parentCriterionId; });
      if (hit) return hit;
    }
    return prevResults[index] || null;
  }

  /** Per-criterion counts and compliance. */
  function criterionResults(audit) {
    return (audit.criteria || []).map(function (c) {
      let met = 0, notMet = 0, na = 0;
      // Only completed records count; drafts are excluded until submitted.
      DA.collection.completedRecords(audit).forEach(function (cs) {
        const r = cs.results ? cs.results[c.id] : null;
        if (r === 'met') met++;
        else if (r === 'not_met') notMet++;
        else if (r === 'na') na++;
      });
      const applicable = met + notMet;
      return {
        criterion: c,
        met: met, notMet: notMet, na: na, applicable: applicable,
        compliance: applicable ? (met / applicable) * 100 : null,
        target: Number(c.target) || 0
      };
    });
  }

  /** Overall audit compliance = pooled met / applicable across all criteria. */
  function compliance(audit) {
    let met = 0, applicable = 0;
    criterionResults(audit).forEach(function (r) { met += r.met; applicable += r.applicable; });
    return applicable ? (met / applicable) * 100 : null;
  }

  /** Mean of the criterion targets — the audit's overall standard. */
  function target(audit) {
    const t = (audit.criteria || []).map(function (c) { return Number(c.target) || 0; });
    return t.length ? t.reduce(function (s, n) { return s + n; }, 0) / t.length : 0;
  }

  /** 'good' | 'warning' | 'critical' | 'none' — compliance vs target with amber margin. */
  function rag(value, tgt, margin) {
    if (value === null || value === undefined) return 'none';
    const m = margin === undefined ? (DA.store ? DA.store.getSettings().amberMargin : 10) : margin;
    if (value >= tgt) return 'good';
    if (value >= tgt - m) return 'warning';
    return 'critical';
  }

  function ragLabel(r) {
    return { good: 'Meets target', warning: 'Near target', critical: 'Below target', none: 'No data' }[r];
  }

  function progress(audit) {
    const n = DA.collection.completedRecords(audit).length;
    const target = Math.max(1, Number(audit.targetSampleSize) || 1);
    return Math.min(100, (n / target) * 100);
  }

  function isReauditDue(audit, windowDays) {
    if (audit.status !== 'completed' || !audit.reauditDate) return false;
    const w = windowDays === undefined ? 30 : windowDays;
    const d = U.daysUntil(audit.reauditDate);
    // A completed audit that already has a follow-up cycle is no longer "due".
    const hasChild = DA.store.getAudits().some(function (x) { return x.parentId === audit.id; });
    return !hasChild && d !== null && d <= w;
  }

  /** Items needing attention: active audit deadlines and upcoming re-audits. */
  function deadlines(audits, windowDays) {
    const w = windowDays || 45;
    const items = [];
    live(audits).forEach(function (a) {
      const due = dueDateFor(a);
      if (isActive(a) && due) {
        const d = U.daysUntil(due);
        if (d !== null && d <= w) {
          items.push({ audit: a, date: due, days: d, kind: nextStepFor(a) });
        }
      }
      if (isReauditDue(a, w)) {
        items.push({ audit: a, date: a.reauditDate, days: U.daysUntil(a.reauditDate), kind: 'Re-audit (cycle ' + ((a.cycle || 1) + 1) + ')' });
      }
    });
    return items.sort(function (x, y) { return x.days - y.days; });
  }

  /** The date the current stage is working towards. */
  function dueDateFor(a) {
    if (a.status === 'completed') return a.reauditDate || null;
    if ((a.status === 'active' || a.status === 'collecting') && a.collectionEndDate) return a.collectionEndDate;
    return a.targetCompletionDate || null;
  }

  function nextStepFor(a) {
    switch (a.status) {
      case 'active': return DA.collection.hasForm(a) ? 'Begin data collection' : 'Design data collection form';
      case 'collecting': return 'Complete data collection (' + DA.collection.completedRecords(a).length + '/' + a.targetSampleSize + ')';
      case 'analysis': return 'Finish analysis';
      case 'action': return 'Agree action plan';
      default: return 'Review';
    }
  }

  function summary(all) {
    const audits = live(all);
    const withData = audits.map(compliance).filter(function (v) { return v !== null; });
    return {
      active: audits.filter(isActive).length,
      completed: audits.filter(function (a) { return a.status === 'completed'; }).length,
      avgCompliance: withData.length ? withData.reduce(function (s, n) { return s + n; }, 0) / withData.length : null,
      auditsWithData: withData.length,
      reauditsDue: audits.filter(function (a) { return isReauditDue(a, 30); }).length,
      totalCases: audits.reduce(function (s, a) { return s + DA.collection.completedRecords(a).length; }, 0),
      drafts: all.filter(isDraft).length
    };
  }

  /** Monthly pooled compliance for one or many audits: [{label, value, n}] */
  function monthlyTrend(audits) {
    const buckets = {};
    audits.forEach(function (a) {
      DA.collection.completedRecords(a).forEach(function (cs) {
        const d = U.toDate(cs.collectionDate);
        if (!d) return;
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        const b = buckets[key] || (buckets[key] = { met: 0, app: 0, n: 0, date: new Date(d.getFullYear(), d.getMonth(), 1) });
        b.n++;
        Object.keys(cs.results || {}).forEach(function (k) {
          const r = cs.results[k];
          if (r === 'met') { b.met++; b.app++; }
          else if (r === 'not_met') { b.app++; }
        });
      });
    });
    return Object.keys(buckets).sort().map(function (k) {
      const b = buckets[k];
      return {
        key: k,
        label: b.date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        value: b.app ? (b.met / b.app) * 100 : null,
        n: b.n
      };
    });
  }

  return {
    STATUS, STATUS_KEYS, statusMeta, isActive, isDraft, live, previousResult, dueDateFor, criterionResults, compliance, target,
    rag, ragLabel, progress, isReauditDue, deadlines, nextStepFor, summary, monthlyTrend
  };
})();
