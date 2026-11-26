#!/usr/bin/env python3
"""Build Notile-Suite.html: the launcher and every Notile app in ONE file that runs offline
(for trust PCs where notile.co.uk is blocked by the web filter).

    python3 tools/build_offline_suite.py --apps <dir containing notile/ set-app/ chrome-card/ ortho-card/> [-o Notile-Suite.html]

Apps hosted in this repo (scan-card, dentmat, dentalaudit, smile-card, wax-card, tray-card, trauma-card, letter-card,
implantref, guide-card) are read from here; the four
apps with their own repos are read from --apps (clone them next to each other).

How it works
  * Each app's index.html is inlined (local <script src>, stylesheets, CSS url()s and <img src> become
    inline content / data URIs) and shown in an iframe via srcdoc. The page's own CSP meta, manifest,
    icons and the shared /fonts/fonts.css link are removed; fonts are embedded once and handed to each
    frame. The service worker is not used (registrations are already skipped on non-https pages).
  * A small shim at the top of each frame turns links to "/app/" into in-file navigation, and serves
    scripts an app loads lazily (DentalAudit's PDF/Word export libraries) from inline copies.
  * Each app (and each lazily loaded script) is stored deflate-compressed and base64-encoded, and unpacked
    the first time it is opened — with the browser's DecompressionStream, or a small built-in inflater on
    browsers without it. That keeps the file well under 16 MiB.
  * ImplantRef is included without its camera scanner (scan.js, ZXing, OCR model, GTIN table): it hides
    the Scan buttons when the scanner isn't present.
  * Scan Card shows its tools in frames of its own. There are no addresses to load inside one file, so it asks
    the suite for each tool's page (SUITE.page) and puts that in the frame. Its Models, Analysis and Splint pages,
    and Wax Card and Tray Card (which it opens as tabs), are in the file but have no button of their own.
Dictate (/dictate/) is left out: it needs the ~100 MB speech model served from the site.
Data entered in the file is saved by the browser for that file on that computer only.
"""
import argparse
import base64
import json
import mimetypes
import re
import sys
import zlib
from datetime import date
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]

APPS = [
    # id, name, path, (repo|None, file), options
    ('notile', 'Notile', '/notile/', ('notile', 'index.html'), {}),
    ('chart', 'Notile Chart', '/notile/chart/', ('notile', 'chart/index.html'), {}),
    ('set-app', 'Set-App', '/set-app/', ('set-app', 'index.html'), {}),
    ('set-list', 'Set-App list', '/set-app/list.html', ('set-app', 'list.html'), {'hidden': True}),
    ('chrome-card', 'Chrome Card', '/chrome-card/', ('chrome-card', 'index.html'), {}),
    ('ortho-card', 'Ortho Card', '/ortho-card/', ('ortho-card', 'index.html'), {}),
    ('scan-card', 'Scan Card', '/scan-card/', (None, 'scan-card/index.html'), {}),
    ('scan-model', 'Scan Card: Models', '/scan-card/model/', (None, 'scan-card/model/index.html'), {'hidden': True}),
    ('scan-analysis', 'Scan Card: Analysis', '/scan-card/analysis/', (None, 'scan-card/analysis/index.html'), {'hidden': True}),
    ('scan-splint', 'Scan Card: Splint', '/scan-card/splint/', (None, 'scan-card/splint/index.html'), {'hidden': True}),
    ('scan-compare', 'Scan Card: Compare', '/scan-card/compare/', (None, 'scan-card/compare/index.html'), {'hidden': True}),
    ('scan-prep', 'Scan Card: Prep check', '/scan-card/prep/', (None, 'scan-card/prep/index.html'), {'hidden': True}),
    ('scan-survey', 'Scan Card: Survey', '/scan-card/survey/', (None, 'scan-card/survey/index.html'), {'hidden': True}),
    ('dentmat', 'DentMat', '/dentmat/', (None, 'dentmat/index.html'), {}),
    ('dentalaudit', 'DentalAudit', '/dentalaudit/', (None, 'dentalaudit/index.html'),
     {'lazy': ['js/vendor/jspdf.umd.min.js', 'js/vendor/jspdf.plugin.autotable.min.js', 'js/vendor/docx.iife.min.js']}),
    ('smile-card', 'Smile Card', '/smile-card/', (None, 'smile-card/index.html'), {}),
    ('wax-card', 'Wax Card', '/wax-card/', (None, 'wax-card/index.html'), {'hidden': True}),     # opened from inside Scan Card
    ('tray-card', 'Tray Card', '/tray-card/', (None, 'tray-card/index.html'), {'hidden': True}),  # opened from inside Scan Card
    ('trauma-card', 'Trauma Card', '/trauma-card/', (None, 'trauma-card/index.html'), {}),
    ('letter-card', 'Letter Card', '/letter-card/', (None, 'letter-card/index.html'), {}),
    ('implantref', 'ImplantRef', '/implantref/', (None, 'implantref/index.html'),
     {'drop': ['src/scan.js', 'data/gtin-data.js']}),
    ('guide-card', 'Guide Card', '/guide-card/', (None, 'guide-card/index.html'), {}),
]

# Apps on the site that are not put in the file (see the note at the top).
LEFT_OUT = ['/dictate/']

warnings = []


def pack(text):
    """Raw-deflate (RFC 1951) and base64, unpacked in the page by unz()."""
    c = zlib.compressobj(9, zlib.DEFLATED, -15, 9)
    return base64.b64encode(c.compress(text.encode('utf-8')) + c.flush()).decode()


# Raw inflate for browsers without DecompressionStream('deflate-raw') (checked against zlib in tests).
INFLATE_JS = r'''function inflateRaw(src){var out=new Uint8Array(Math.max(1024,src.length*4)),op=0,bb=0,bc=0,ip=0;
function bits(n){while(bc<n){bb|=src[ip++]<<bc;bc+=8}var v=bb&((1<<n)-1);bb>>>=n;bc-=n;return v}
function grow(n){if(op+n>out.length){var o=new Uint8Array(Math.max(out.length*2,op+n));o.set(out);out=o}}
function build(L,n){var c=new Uint16Array(16),s=new Uint16Array(n),f=new Uint16Array(16),i;for(i=0;i<n;i++)c[L[i]]++;c[0]=0;for(i=1;i<16;i++)f[i]=f[i-1]+c[i-1];for(i=0;i<n;i++)if(L[i])s[f[L[i]]++]=i;return{c:c,s:s}}
function dec(h){var code=0,first=0,idx=0;for(var l=1;l<16;l++){code|=bits(1);var k=h.c[l];if(code-k<first)return h.s[idx+code-first];idx+=k;first=(first+k)<<1;code<<=1}throw new Error('bad data')}
var LB=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],LE=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],
DB=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],DE=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],
OR=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],last,i,lh,dh;
do{last=bits(1);var t=bits(2);
if(t===0){bb=0;bc=0;var n=src[ip]|src[ip+1]<<8;ip+=4;grow(n);out.set(src.subarray(ip,ip+n),op);op+=n;ip+=n;continue}
if(t===1){var fl=new Uint8Array(288);for(i=0;i<288;i++)fl[i]=i<144?8:i<256?9:i<280?7:8;lh=build(fl,288);var fd=new Uint8Array(30).fill(5);dh=build(fd,30)}
else if(t===2){var hl=bits(5)+257,hd=bits(5)+1,hc=bits(4)+4,cl=new Uint8Array(19);for(i=0;i<hc;i++)cl[OR[i]]=bits(3);var ch=build(cl,19),ln=new Uint8Array(hl+hd);
for(i=0;i<hl+hd;){var sy=dec(ch);if(sy<16)ln[i++]=sy;else{var r,v=0;if(sy===16){v=ln[i-1];r=3+bits(2)}else if(sy===17)r=3+bits(3);else r=11+bits(7);while(r--)ln[i++]=v}}
lh=build(ln.subarray(0,hl),hl);dh=build(ln.subarray(hl),hd)}else throw new Error('bad block');
for(;;){var s=dec(lh);if(s<256){grow(1);out[op++]=s}else if(s===256)break;else{s-=257;var len=LB[s]+bits(LE[s]),ds=dec(dh),d=DB[ds]+bits(DE[ds]);grow(len);for(var k=0;k<len;k++){out[op]=out[op-d];op++}}}
}while(!last);return out.subarray(0,op)}'''


def data_uri(path):
    mime = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
    if path.suffix == '.woff2':
        mime = 'font/woff2'
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()


def resolve(ref, base_dir):
    """Map a src/href to a file: '/x' is site-rooted, 'x' is relative to the app's folder."""
    ref = ref.split('#')[0].split('?')[0]
    if not ref or re.match(r'^(data:|https?:|blob:|mailto:|tel:|javascript:|\$\{|\'|\+)', ref):
        return None
    p = (SITE / ref.lstrip('/')) if ref.startswith('/') else (base_dir / ref)
    return p if p.is_file() else None


def inline_css(css, css_dir):
    def rep(m):
        ref = m.group(2)
        p = resolve(ref, css_dir)
        if not p:
            return m.group(0)
        return f'url({data_uri(p)})'
    return re.sub(r'url\((["\']?)([^)"\']+)\1\)', rep, css)


def script_safe(js):
    return re.sub(r'</(script)', r'<\\/\1', js, flags=re.I)


def shim(app_id, lazy):
    lazy_js = ''
    if lazy:
        lazy_js = ("var L=P.SUITE.lazy&&P.SUITE.lazy[" + json.dumps(app_id) + "];if(L){var D=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');"
                   "Object.defineProperty(HTMLScriptElement.prototype,'src',{configurable:true,get:D.get,set:function(v){var k=String(v).replace(/^\\.\\//,'');"
                   "if(L[k]){v=URL.createObjectURL(new Blob([L[k]],{type:'text/javascript'}))}D.set.call(this,v)}})}\n")
    return ("<script>(function(){try{var P=parent;if(!P||P===window||!P.SUITE)return;\nwindow.__SUITE_APP=" + json.dumps(app_id) + ";P.SUITE.fonts(window);\n" + lazy_js +
            "document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');\n"
            "if(h&&h.charAt(0)==='/'&&h.charAt(1)!=='/'){e.preventDefault();e.stopPropagation();P.SUITE.go(h)}},true);}catch(_){}})();<\\/script>\n").replace('<\\/script>', '</script>')


def inline_app(app_id, html_path, opts):
    base = html_path.parent
    html = html_path.read_text(encoding='utf-8')
    drop = set(opts.get('drop', []))
    # remove things that make no sense offline or would fight the bundle
    html = re.sub(r'<meta[^>]+http-equiv=["\']Content-Security-Policy["\'][^>]*>\s*', '', html, flags=re.I)
    html = re.sub(r'<link[^>]+rel=["\'](?:manifest|icon|apple-touch-icon)["\'][^>]*>\s*', '', html, flags=re.I)
    html = re.sub(r'<link[^>]+href=["\']/fonts/fonts\.css["\'][^>]*>\s*', '', html, flags=re.I)

    def rep_css(m):
        p = resolve(m.group(1), base)
        if not p:
            warnings.append(f'{app_id}: stylesheet not found {m.group(1)}')
            return m.group(0)
        return '<style>\n' + inline_css(p.read_text(encoding='utf-8'), p.parent) + '\n</style>'
    html = re.sub(r'<link[^>]+rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)["\'][^>]*>', rep_css, html, flags=re.I)
    html = re.sub(r'<link[^>]+href=["\']([^"\']+\.css)["\'][^>]*rel=["\']stylesheet["\'][^>]*>', rep_css, html, flags=re.I)

    def rep_js(m):
        src = m.group(1)
        if src.split('?')[0] in drop:
            return ''
        p = resolve(src, base)
        if not p:
            warnings.append(f'{app_id}: script not found {src}')
            return m.group(0)
        return '<script>\n' + script_safe(p.read_text(encoding='utf-8')) + '\n</script>'
    html = re.sub(r'<script[^>]*\ssrc=["\']([^"\']+)["\'][^>]*>\s*</script>', rep_js, html, flags=re.I)

    def rep_img(m):
        p = resolve(m.group(2), base)
        return m.group(1) + data_uri(p) + m.group(3) if p else m.group(0)
    html = re.sub(r'(<img\b[^>]*?\ssrc=["\'])([^"\']+)(["\'])', rep_img, html, flags=re.I)

    # inline <style> blocks may reference fonts/images by URL
    html = re.sub(r'(<style[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + inline_css(m.group(2), base) + m.group(3), html, flags=re.S | re.I)

    m = re.search(r'<head[^>]*>', html, flags=re.I)
    if not m:
        sys.exit(f'{app_id}: no <head>')
    html = html[:m.end()] + '\n' + shim(app_id, bool(opts.get('lazy'))) + html[m.end():]
    lazy = {}
    for rel in opts.get('lazy', []):
        p = base / rel
        if not p.is_file():
            sys.exit(f'{app_id}: lazy script missing {rel}')
        lazy[rel] = p.read_text(encoding='utf-8')
    return html, lazy


def fonts():
    css = (SITE / 'fonts/fonts.css').read_text(encoding='utf-8')
    out = []
    for m in re.finditer(r"@font-face\{font-family:'([^']+)';font-style:(\w+);font-weight:(\d+);[^}]*?url\(/fonts/([^)]+)\)", css):
        out.append({'f': m.group(1), 's': m.group(2), 'w': m.group(3), 'd': base64.b64encode((SITE / 'fonts' / m.group(4)).read_bytes()).decode()})
    return out


def launcher(apps_shown):
    src = (SITE / 'index.html').read_text(encoding='utf-8')
    style = re.search(r'<style>(.*?)</style>', src, re.S).group(1)
    nav = re.search(r'<nav class="apps"[^>]*>.*?</nav>', src, re.S).group(0)
    for href in LEFT_OUT:  # tiles for apps that cannot work from a single file are taken off the launcher
        nav, n = re.subn(r'\s*<a class="app" href="' + re.escape(href) + r'".*?</a>', '', nav, count=1, flags=re.S)
        if n:
            warnings.append(f'launcher tile {href} left out')
    hrefs = re.findall(r'<a class="app" href="([^"]+)"', nav)
    missing = [h for h in hrefs if h not in {a[2] for a in apps_shown}]
    if missing:
        sys.exit(f'launcher links to apps not in the bundle: {missing}')
    head = re.search(r'<h1>.*?</p>', src, re.S).group(0)
    footer = re.search(r'<footer>.*?</footer>', src, re.S).group(0)
    return style, head, nav, footer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apps', required=True, help='folder containing the notile, set-app, chrome-card and ortho-card repos')
    ap.add_argument('-o', '--out', default='Notile-Suite.html')
    a = ap.parse_args()
    apps_dir = Path(a.apps).resolve()

    app_js, lazy_js, names = {}, {}, {}
    for app_id, name, path, (repo, rel), opts in APPS:
        f = (apps_dir / repo / rel) if repo else (SITE / rel)
        if not f.is_file():
            sys.exit(f'missing {f}')
        html, lazy = inline_app(app_id, f, opts)
        app_js[app_id] = {'path': path, 'z': pack(html)}
        if lazy:
            lazy_js[app_id] = {k: pack(v) for k, v in lazy.items()}
        names[app_id] = (name, opts.get('hidden', False))

    style, head, nav, footer = launcher(APPS)
    built = date.today().isoformat()
    # U+FFFD (used literally by docx's UTF-8 decoder) is written as a JSON escape: same value at runtime,
    # but the file stays free of replacement characters that upload checks treat as corruption.
    J = lambda o: script_safe(json.dumps(o, ensure_ascii=False, separators=(',', ':')).replace('\ufffd', '\\ufffd'))
    out = f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>Notile</title>
<style>{style}
html,body{{height:100%}}
#home[hidden],#view[hidden]{{display:none}}
#view{{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg)}}
#bar{{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--line);background:var(--card);flex:0 0 auto;overflow-x:auto}}
#bar button{{font:inherit;font-size:.9rem;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:5px 12px;cursor:pointer;white-space:nowrap}}
#bar button:hover{{border-color:var(--teal)}}
#bar button.on{{background:var(--navy);border-color:var(--navy);color:var(--card)}}
#bar .home{{font-weight:600}}
#frames{{position:relative;flex:1 1 auto}}
#frames iframe{{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}}
#frames iframe[hidden]{{display:none}}
#opening{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.95rem}}
#opening[hidden]{{display:none}}
.offline{{margin:28px 0 0;font-size:.9rem;color:var(--muted)}}
</style>
</head>
<body>
<main id="home">
{head}
{nav}
<p class="offline">Offline copy (built {built}): everything in this one file runs without the internet. Drafts and settings save in this browser on this computer only. ImplantRef's camera scanner is not included in this copy.</p>
{footer}
</main>
<div id="view" hidden><div id="bar" role="toolbar" aria-label="Apps"></div><div id="frames"><div id="opening" hidden>Opening…</div></div></div>
<script>
var APPS={J(app_js)};
var LAZY={J(lazy_js)};
var FONTS={J(fonts())};
var NAMES={J({k: v[0] for k, v in names.items()})};
var HIDDEN={J([k for k, v in names.items() if v[1]])};
var bufs=null;
{INFLATE_JS}
function b64u8(s){{var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}}
function slowUnz(u){{return new TextDecoder('utf-8').decode(inflateRaw(u))}}
/* unpack one stored app / script: the browser's own decompressor when it has one, else inflateRaw */
function unz(s){{var u=b64u8(s);
  try{{if(typeof DecompressionStream==='function')return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text().catch(function(){{return slowUnz(u)}})}}catch(e){{}}
  return new Promise(function(res){{res(slowUnz(u))}})}}
var ready={{}};
function unpack(id){{if(ready[id])return ready[id];var a=APPS[id],L=LAZY[id]||{{}},keys=Object.keys(L);
  ready[id]=Promise.all([unz(a.z)].concat(keys.map(function(k){{return unz(L[k])}}))).then(function(r){{
    a.html=r[0];if(keys.length){{SUITE.lazy[id]={{}};keys.forEach(function(k,i){{SUITE.lazy[id][k]=r[i+1]}})}}return a.html}});
  return ready[id]}}
function fontBufs(){{if(bufs)return bufs;bufs=FONTS.map(function(f){{var b=atob(f.d),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return {{f:f.f,s:f.s,w:f.w,b:u.buffer}}}});return bufs}}
function route(path){{var h=path.split('#'),p=h[0];
  for(var id in APPS)if(APPS[id].path===p)return {{id:id,hash:h[1]||''}};
  p=p.replace(/index\\.html$/,'');if(p.slice(-1)!=='/')p+='/';
  for(var id2 in APPS)if(APPS[id2].path===p)return {{id:id2,hash:h[1]||''}};return null}}
var frames={{}},current=null;
window.SUITE={{
  lazy:{{}},
  fonts:function(w){{try{{fontBufs().forEach(function(f){{var ff=new w.FontFace(f.f,f.b.slice(0),{{style:f.s,weight:f.w}});w.document.fonts.add(ff);ff.load().catch(function(){{}})}})}}catch(e){{}}}},
  /* the page of an app in this file, for an app that shows others in frames of its own (Scan Card) */
  page:function(path){{var r=route(path);return r?unpack(r.id):Promise.reject(new Error('Not in this file: '+path))}},
  go:function(path){{if(path==='/'||path===''){{location.hash='';return}}var r=route(path);if(!r)return;location.hash=r.id+(r.hash?'/'+r.hash:'')}}
}};
function show(id,sub){{var home=document.getElementById('home'),view=document.getElementById('view');
  if(!id||!APPS[id]){{home.hidden=false;view.hidden=true;current=null;document.title='Notile';return}}
  home.hidden=true;view.hidden=false;current=id;document.title=NAMES[id]+' · Notile';
  var f=frames[id],op=document.getElementById('opening');
  if(!f){{f=document.createElement('iframe');f.title=NAMES[id];f.setAttribute('allow','clipboard-read; clipboard-write');
    if(sub)f.addEventListener('load',function(){{try{{f.contentWindow.location.hash=sub}}catch(e){{}}}},{{once:true}});
    frames[id]=f;f.hidden=true;op.textContent='Opening '+NAMES[id]+'…';op.hidden=false;
    unpack(id).then(function(html){{f.srcdoc=html;document.getElementById('frames').appendChild(f);if(current===id){{f.hidden=false;op.hidden=true}}}},
      function(e){{op.textContent='Could not open '+NAMES[id]+' in this browser ('+(e&&e.message||e)+').'}})}}
  else if(sub){{try{{f.contentWindow.location.hash=sub}}catch(e){{}}}}
  for(var k in frames)frames[k].hidden=(k!==id)||!f.parentNode;
  if(f.parentNode)op.hidden=true;
  [].forEach.call(document.querySelectorAll('#bar button[data-id]'),function(b){{b.classList.toggle('on',b.dataset.id===id)}})}}
(function(){{var bar=document.getElementById('bar');
  var h=document.createElement('button');h.className='home';h.textContent='← All apps';h.onclick=function(){{location.hash=''}};bar.appendChild(h);
  Object.keys(APPS).forEach(function(id){{if(HIDDEN.indexOf(id)>=0)return;var b=document.createElement('button');b.dataset.id=id;b.textContent=NAMES[id];b.onclick=function(){{location.hash=id}};bar.appendChild(b)}});
  document.querySelectorAll('#home a.app').forEach(function(a){{a.addEventListener('click',function(e){{e.preventDefault();SUITE.go(a.getAttribute('href'))}})}});}})();
function fromHash(){{var h=location.hash.slice(1),i=h.indexOf('/');show(i<0?h:h.slice(0,i),i<0?'':h.slice(i+1))}}
addEventListener('hashchange',fromHash);fromHash();
</script>
</body>
</html>
'''
    Path(a.out).write_text(out, encoding='utf-8')
    for w in warnings:
        print('WARNING', w)
    print(f'Wrote {a.out} ({len(out.encode()) / 1e6:.1f} MB, {len(app_js)} apps)')


if __name__ == '__main__':
    main()
