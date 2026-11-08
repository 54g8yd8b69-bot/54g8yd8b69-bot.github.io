#!/usr/bin/env python3
"""Monthly link check for Guide Card.

    python3 guide-card/tools/check_links.py            check every link, compare with the last run, write the report
    python3 guide-card/tools/check_links.py --only bsp-bpe,iacsd     check just these records

Writes guide-card/data/link-report.md (read this) and guide-card/data/link-state.json (kept for next month's comparison).
GitHub runs it on the 1st of each month (.github/workflows/guide-card-links.yml); the run turns red if a link newly breaks.

How results are read
  OK            the page answered normally.
  MOVED         the link now redirects somewhere new: check the new page is still the same document, then update the URL.
  CHANGED       the page or PDF content differs from last month: may be a new edition, or only a cosmetic web-page change.
  UNCONFIRMED   the publisher refused an automated request (401/403/429, common for doi.org publishers) or timed out.
                This is NOT a dead link; open it in a browser if it matters.
  BROKEN        404/410 or the site no longer exists: find the new location or move the record to the pending list.
Uses only the Python standard library.
"""
import argparse, hashlib, json, re, socket, ssl, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

GC = Path(__file__).resolve().parents[1]
DATA = GC / 'data' / 'guide-card.json'
STATE = GC / 'data' / 'link-state.json'
REPORT = GC / 'data' / 'link-report.md'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GuideCardLinkCheck/1.0'
MAX = 4_000_000


def links(d, only=None):
    out = []
    for r in d['refs']:
        if only and r['id'] not in only:
            continue
        out.append((r['id'], 'main link', r['url']))
        for x in r.get('links', []):
            out.append((r['id'], x['label'], x['url']))
        for x in r.get('parts', []):
            if x.get('url'):
                out.append((r['id'], x['label'], x['url']))
    return out


def fingerprint(body, ctype):
    if 'pdf' in ctype or body[:5] == b'%PDF-':
        return hashlib.sha256(body).hexdigest()[:16]
    t = body.decode('utf-8', 'ignore')
    t = re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>', ' ', t)
    t = re.sub(r'(?s)<[^>]+>', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return hashlib.sha256(t.encode()).hexdigest()[:16]


def check(url, tries=2):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/pdf,*/*;q=0.8', 'Accept-Language': 'en-GB,en;q=0.8'})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=25, context=ssl.create_default_context()) as r:
                body = r.read(MAX)
                return {'code': r.status, 'final': r.geturl(), 'fp': fingerprint(body, r.headers.get('Content-Type', ''))}
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 405, 406, 429, 451, 999) or 300 <= e.code < 400 or e.code >= 500:
                if e.code >= 500 and attempt + 1 < tries:
                    time.sleep(3)
                    continue
                return {'code': e.code, 'final': e.geturl() or url, 'kind': 'unconfirmed'}
            return {'code': e.code, 'final': e.geturl() or url, 'kind': 'broken'}
        except urllib.error.URLError as e:
            reason = e.reason
            if isinstance(reason, socket.gaierror):
                return {'code': 0, 'final': url, 'kind': 'broken', 'err': 'site not found (DNS)'}
            if attempt + 1 < tries:
                time.sleep(3)
                continue
            return {'code': 0, 'final': url, 'kind': 'unconfirmed', 'err': str(reason)[:80]}
        except (socket.timeout, TimeoutError, ConnectionError, ssl.SSLError) as e:
            if attempt + 1 < tries:
                time.sleep(3)
                continue
            return {'code': 0, 'final': url, 'kind': 'unconfirmed', 'err': type(e).__name__}
    return {'code': 0, 'final': url, 'kind': 'unconfirmed'}


# Journal-article links (DOIs, PubMed, publisher article pages) are fixed publications: their pages change cosmetically
# and redirect with cookie/session tokens, so only breakage is reported for them, not "moved" or "changed".
ARTICLE = re.compile(r'^https://(doi\.org|pubmed\.ncbi\.nlm\.nih\.gov|(www\.)?ncbi\.nlm\.nih\.gov/pmc|link\.springer\.com|(www\.)?nature\.com/articles|'
                     r'onlinelibrary\.wiley\.com|(www\.)?sciencedirect\.com|(www\.)?tandfonline\.com|academic\.oup\.com|journals\.sagepub\.com|'
                     r'(www\.)?cambridge\.org/core|(www\.)?jendodon\.com|(www\.)?thejpd\.org|bmcoralhealth\.biomedcentral\.com)')


def norm(u):
    # compare addresses without query strings (publishers add session tokens) or trailing slashes
    return re.split(r'[?#]', u)[0].rstrip('/').replace('http://', 'https://').replace('://www.', '://')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()
    d = json.loads(DATA.read_text())
    only = set(a.only.split(',')) if a.only else None
    items = links(d, only)
    urls = sorted({u for _, _, u in items})
    prev = json.loads(STATE.read_text()) if STATE.exists() else {}
    print(f'Checking {len(urls)} links from {len({i for i, _, _ in items})} records…', flush=True)
    with ThreadPoolExecutor(a.workers) as ex:
        res = dict(zip(urls, ex.map(check, urls)))

    rows = {k: [] for k in ('broken', 'new_broken', 'moved', 'changed', 'unconfirmed', 'ok', 'recovered')}
    state = dict(prev) if only else {}
    for u in urls:
        r, p = res[u], prev.get(u, {})
        who = [f'{i} ({lbl})' if lbl != 'main link' else i for i, lbl, uu in items if uu == u]
        kind = r.get('kind') or 'ok'
        entry = {'kind': kind, 'code': r['code'], 'final': r['final'], 'fp': r.get('fp') or p.get('fp'), 'checked': date.today().isoformat(),
                 'since': p.get('since') if p.get('kind') == kind else date.today().isoformat()}
        state[u] = entry
        line = (u, who, r, p)
        if kind == 'broken':
            rows['broken'].append(line)
            if p.get('kind') != 'broken':
                rows['new_broken'].append(line)
        elif kind == 'unconfirmed':
            rows['unconfirmed'].append(line)
        else:
            if p.get('kind') == 'broken':
                rows['recovered'].append(line)
            if ARTICLE.match(u):
                rows['ok'].append(line)
            elif p.get('kind') == 'ok' and p.get('final') and norm(r['final']) != norm(p['final']):
                rows['moved'].append(line)
            elif p.get('kind') == 'ok' and p.get('fp') and r.get('fp') and p['fp'] != r['fp']:
                rows['changed'].append(line)
            else:
                rows['ok'].append(line)

    t = date.today().isoformat()
    md = [f'# Guide Card link report — {t}', '',
          f'{len(urls)} links checked. Broken: **{len(rows["broken"])}** ({len(rows["new_broken"])} new) · moved: **{len(rows["moved"])}** · '
          f'content changed: **{len(rows["changed"])}** · unconfirmed (blocked or timed out, not dead): {len(rows["unconfirmed"])} · OK: {len(rows["ok"])}', '']
    if not prev:
        md += ['_First run: nothing to compare with yet, so no page is reported as moved or changed. Next month’s run will compare against this one._', '']

    def section(title, key, note, fmt):
        if rows[key]:
            md.extend([f'## {title} ({len(rows[key])})', '', note, ''])
            md.extend(fmt(*x) for x in rows[key])
            md.append('')
    section('Broken', 'broken', 'Find the new location and update the record, or move it to the pending list if the document is gone.',
            lambda u, who, r, p: f'- {", ".join(who)} — HTTP {r["code"] or r.get("err", "")} — {u}' + (' **(new this month)**' if p.get('kind') != 'broken' else f' (since {p.get("since", "?")})'))
    section('Moved (now redirects somewhere new)', 'moved', 'Open the new address: if it is the same document, update the URL in guide-card.json.',
            lambda u, who, r, p: f'- {", ".join(who)} — {u} → {r["final"]}')
    section('Content changed since last check', 'changed', 'Could be a new edition (re-check the record, its year/edition and status) or only a cosmetic page change. PDFs changing usually matter.',
            lambda u, who, r, p: f'- {", ".join(who)} — {u}')
    section('Working again', 'recovered', '', lambda u, who, r, p: f'- {", ".join(who)} — {u}')
    section('Unconfirmed (publisher blocked the check or it timed out — not a dead link)', 'unconfirmed', 'Open in a browser only if it matters; these are expected for many doi.org links.',
            lambda u, who, r, p: f'- {", ".join(who)} — HTTP {r["code"] or r.get("err", "timeout")} — {u}')
    REPORT.write_text('\n'.join(md) + '\n')
    STATE.write_text(json.dumps(dict(sorted(state.items())), indent=1) + '\n')
    print('\n'.join(md[:3]))
    print(f'Report: {REPORT}')
    if rows['new_broken']:
        sys.exit(f'{len(rows["new_broken"])} link(s) newly broken — see the report.')


if __name__ == '__main__':
    main()
