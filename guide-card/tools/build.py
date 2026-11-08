#!/usr/bin/env python3
"""Build Guide Card from its data and source files.

    python3 guide-card/tools/build.py               check the data, then write guide-card/index.html (the notile.co.uk copy)
    python3 guide-card/tools/build.py --check       check the data and that index.html is up to date; change nothing
    python3 guide-card/tools/build.py --standalone OUT.html
                                                    also write a copy with no site links (for the Claude artifact)

Edit guide-card/data/guide-card.json to add or change records; field guide in guide-card/data/README.md.
The build stops with a list of problems if a record is incomplete or uses an unknown value.
"""
import json, re, sys, argparse
from datetime import date
from pathlib import Path

GC = Path(__file__).resolve().parents[1]
DATA = GC / 'data' / 'guide-card.json'

# long (editing) names -> short names used inside the app
KEYS = {'id': 'id', 'title': 't', 'short': 's', 'publisher': 'p', 'year': 'y', 'edition': 'ed', 'type': 'ty', 'measure': 'm',
        'specialties': 'sp', 'topic': 'tp', 'group': 'grp', 'population': 'pop', 'aliases': 'al', 'jurisdiction': 'j', 'nation': 'nat',
        'ukRelevance': 'uk', 'status': 'st', 'useWhen': 'u', 'url': 'url', 'links': 'x', 'parts': 'ch', 'related': 'rel', 'access': 'acc',
        'note': 'note', 'keyPoints': 'pts', 'tool': 'tool', 'checked': 'ck', 'recheckBy': 'rc', 'reviewNote': 'rv', 'suiteLinks': 'suite'}
REQUIRED = ['id', 'title', 'short', 'publisher', 'type', 'specialties', 'topic', 'aliases', 'jurisdiction', 'useWhen', 'url', 'checked']
TOOLS = {'iotn', 'bsp', 'bpe', 'mronj', 'anticoag', 'rdiotn'}
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
URL = re.compile(r'^https://[^\s"<>]+$')


def validate(d):
    errs = []
    V = d['vocab']
    sec_specs = {s['id']: s for s in d['sections']}
    ids = [r.get('id') for r in d['refs']]
    seen = set()
    for i, r in enumerate(d['refs']):
        rid = r.get('id') or f'record #{i + 1}'
        e = lambda m: errs.append(f'{rid}: {m}')
        for k in r:
            if k not in KEYS:
                e(f'unknown field "{k}"')
        for k in REQUIRED:
            if r.get(k) in (None, '', []):
                e(f'missing "{k}"')
        if r.get('id') in seen:
            e('duplicate id')
        seen.add(r.get('id'))
        if r.get('id') and not re.match(r'^[a-z0-9][a-z0-9-]*$', r['id']):
            e('id must be lower-case letters, numbers and hyphens')
        if r.get('type') and r['type'] not in V['types']:
            e(f'type "{r["type"]}" is not one of {sorted(V["types"])}')
        if r.get('jurisdiction') and r['jurisdiction'] not in V['jurisdictions']:
            e(f'jurisdiction "{r["jurisdiction"]}" is not one of {sorted(V["jurisdictions"])}')
        if r.get('jurisdiction') == 'LOCAL' and not r.get('nation'):
            e('LOCAL records need "nation"')
        if r.get('status') and r['status'] not in V['statuses']:
            e(f'status "{r["status"]}" is not one of {sorted(V["statuses"])}')
        if r.get('measure') and r['measure'] not in V['measures']:
            e(f'measure "{r["measure"]}" is not one of {sorted(V["measures"])}')
        for s in r.get('specialties', []):
            if s not in V['specialties']:
                e(f'specialty "{s}" is not one of {sorted(V["specialties"])}')
        if r.get('year') is not None and not (isinstance(r['year'], int) and 1900 <= r['year'] <= 2100):
            e('year must be a whole number')
        for k in ('checked', 'recheckBy'):
            if r.get(k) and not DATE.match(r[k]):
                e(f'{k} must be YYYY-MM-DD')
        urls = [r.get('url')] + [x.get('url') for x in r.get('links', [])] + [x.get('url') for x in r.get('parts', []) if x.get('url')]
        for u in urls:
            if u and not URL.match(u):
                e(f'link must start https:// — {u}')
        for x in r.get('links', []):
            if not x.get('label') or not x.get('url'):
                e('each link needs "label" and "url"')
        for x in r.get('parts', []):
            if not x.get('label'):
                e('each part needs "label"')
        for x in r.get('suiteLinks', []):
            if not x.get('label') or not str(x.get('path', '')).startswith('/'):
                e('each suite link needs "label" and a "path" starting with /')
        for rel in r.get('related', []):
            if rel not in ids:
                e(f'related id "{rel}" does not exist')
        if r.get('tool') and r['tool'] not in TOOLS:
            e(f'tool must be one of {sorted(TOOLS)}')
        if not isinstance(r.get('aliases', []), list) or not isinstance(r.get('specialties', []), list):
            e('aliases and specialties must be lists')
        # topic group must be one the record's section lists
        sp0 = (r.get('specialties') or [None])[0]
        sec = next((s for s in d['sections'] if sp0 in s['specialties']), d['sections'][0])
        if r.get('group') and r['group'] not in sec.get('groups', []):
            e(f'group "{r["group"]}" is not listed for section "{sec["label"]}" (choose from {sec.get("groups", [])})')
        if sec.get('groups') and not r.get('group'):
            e(f'section "{sec["label"]}" is grouped by topic: add "group" (one of {sec["groups"]})')
    for s in d['sections']:
        for sp in s['specialties']:
            if sp not in V['specialties']:
                errs.append(f'section {s["id"]}: unknown specialty {sp}')
    for p in d.get('defaultPins', []):
        k, _, v = p.partition(':')
        if not ((k == 'r' and v in ids) or (k == 't' and v in TOOLS)):
            errs.append(f'defaultPins: "{p}" is not r:<record id> or t:<tool id>')
    for p in d.get('pending', []):
        if not p.get('name') or not p.get('reason'):
            errs.append(f'pending item needs "name" and "reason": {p}')
    return errs


def short(r):
    o = {}
    for k, v in r.items():
        if k == 'links':
            v = [[x['label'], x['url']] for x in v]
        elif k == 'parts':
            v = [[x['label'], x['url']] if x.get('url') else [x['label']] for x in v]
        elif k == 'suiteLinks':
            v = [[x['label'], x['path']] for x in v]
        o[KEYS[k]] = v
    return o


def build(d, site=True):
    src = GC / 'src'
    J = lambda x: json.dumps(x, ensure_ascii=False, separators=(',', ':'))
    last = max(r['checked'] for r in d['refs'])
    data_js = '\n'.join([
        '/* ===== Generated from guide-card/data/guide-card.json by tools/build.py — edit the JSON, not this ===== */',
        f'const CK = {J(last)};',
        f'const RECHECK_MONTHS = {int(d.get("recheckMonths", 12))};',
        f'const TYPES = {J(d["vocab"]["types"])};',
        f'const JURIS = {J(d["vocab"]["jurisdictions"])};',
        f'const STATUS = {J(d["vocab"]["statuses"])};',
        f'const MEASURES = {J(d["vocab"]["measures"])};',
        f'const SPECS = {J(d["vocab"]["specialties"])};',
        f'const SECTIONS = {J(d["sections"])};',
        f'const DEFAULT_PINS = {J(d.get("defaultPins", []))};',
        'const REFS = [\n' + ',\n'.join(J(short(r)) for r in d['refs']) + '\n];',
        f'const PENDING = {J(d.get("pending", []))};',
    ])
    nice = date.fromisoformat(last).strftime('%-d %B %Y')
    html = (src / 'shell.html').read_text()
    rep = {
        '/*CSS*/': (src / 'style.css').read_text(),
        '/*DATA*/': data_js,
        '/*APP*/': (src / 'app.js').read_text(),
        '/*TOOLS*/': (src / 'tools.js').read_text(),
        '<!--LAST_CHECKED-->': nice,
    }
    if site:
        csp = ("default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; "
               "img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'none'; "
               "object-src 'none'; upgrade-insecure-requests")
        rep['<!--SITE_HEAD-->'] = '\n'.join([
            f'<meta http-equiv="Content-Security-Policy" content="{csp}">',
            '<meta name="referrer" content="no-referrer">',
            '<meta name="description" content="Guide Card: UK restorative dentistry guidelines, classifications and tools, with links to every source. Runs and saves on your own device.">',
            '<link rel="manifest" href="manifest.webmanifest">',
            '<meta name="theme-color" content="#0B2E4A">',
            '<link rel="icon" href="/icons/icon-192.png">',
            '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
            '<meta name="apple-mobile-web-app-title" content="Guide Card">',
            '<link rel="stylesheet" href="/fonts/fonts.css">'])
        rep['<!--HOME_OPEN-->'] = '<a class="homelink" href="/" title="Back to all apps">'
        rep['<!--HOME_CLOSE-->'] = '</a>'
    else:
        rep['<!--SITE_HEAD-->'] = ''
        rep['<!--HOME_OPEN-->'] = ''
        rep['<!--HOME_CLOSE-->'] = ''
    for k, v in rep.items():
        assert html.count(k) == 1, k
        html = html.replace(k, v)
    return html


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--standalone')
    a = ap.parse_args()
    try:
        d = json.loads(DATA.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        sys.exit(f'guide-card.json is not valid JSON: line {e.lineno}, column {e.colno}: {e.msg}\n'
                 '(Common causes: a missing comma between fields or records, or a comma after the last item.)')
    errs = validate(d)
    if errs:
        sys.exit('Guide Card data has problems:\n  - ' + '\n  - '.join(errs))
    html = build(d, site=True)
    out = GC / 'index.html'
    if a.check:
        if not out.exists() or out.read_text() != html:
            sys.exit('guide-card/index.html is out of date: run python3 guide-card/tools/build.py')
        print(f'OK: {len(d["refs"])} records valid; index.html up to date')
        return
    out.write_text(html)
    print(f'Wrote {out} ({len(html):,} bytes, {len(d["refs"])} records)')
    if a.standalone:
        Path(a.standalone).write_text(build(d, site=False))
        print(f'Wrote {a.standalone}')


if __name__ == '__main__':
    main()
