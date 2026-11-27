/**
 * Photo Card: Google Drive sorter
 *
 * Files the photos that image.canon sends to Google Drive into case folders, using the Photo Card slate
 * (the QR code photographed before each series). Each photo after a slate goes into that case, in a folder
 * for the visit ("2026-11-20 Pre-op"), until the next slate, a gap of more than 3 hours, or midnight.
 * A RAW file (.CR3) moves with the JPEG of the same name. Photos no slate covers are left where they are.
 *
 * Setting up (once):
 *   1. Go to script.google.com, press New project, delete what is there and paste in this whole file.
 *   2. Press Save, choose "setup" in the list next to Run, and press Run.
 *   3. Allow access to your Google Drive. Google warns that it hasn't verified the app, because it is your own
 *      script: press Advanced, then "Go to ... (unsafe)", then Allow.
 * It then checks for new photos every 10 minutes, with nothing left open. To stop it, choose "stop" and press Run.
 * Executions (the list icon on the left) shows what each check did.
 *
 * It runs in your own Google account and nothing is sent anywhere else. It only reads the image.canon folder,
 * and makes and fills the Photo Cases folder.
 */
var CONFIG = {
  INBOX_FOLDER: 'image.canon',   // the folder image.canon puts photos in, in My Drive
  CASES_FOLDER: 'Photo Cases',   // made in My Drive if it isn't there: a folder per case, with a folder per visit inside
  MAX_GAP_HOURS: 3,              // a slate stops covering photos after a gap this long (and at midnight)
  CAMERA: '',                    // e.g. 'R10' to leave photos from other cameras alone; blank for any camera
  EVERY_MINUTES: 10              // how often to check: 1, 5, 10, 15 or 30
};

function setup() {
  stop();
  ScriptApp.newTrigger('sortPhotos').timeBased().everyMinutes(CONFIG.EVERY_MINUTES).create();
  console.log('Photo Card will check for new photos every ' + CONFIG.EVERY_MINUTES + ' minutes.');
  sortPhotos();
}

// Never runs. Apps Script decides which permissions to ask for from the code it finds, and this line makes it ask to
// add and move files in Drive, not just read them (the sorter itself works through the Drive API below).
function driveAccess_() { DriveApp.createFolder(CONFIG.CASES_FOLDER); }

function stop() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sortPhotos') ScriptApp.deleteTrigger(t); });
}

function sortPhotos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return 'Another check is still running.';
  try {
    var out = PhotoCardSorter.run(PhotoCardSorter.driveApi(), PhotoCardSorter.scriptStore(), CONFIG);
    console.log(out);
    return out;
  } finally { lock.releaseLock(); }
}

var PhotoCardSorter = (function () {
  var FOLDER = 'application/vnd.google-apps.folder';
  var STAGES = { pre: 'Pre-op', during: 'During treatment', post: 'Post-op', review: 'Review' };
  var MIN = 60000, HOUR = 3600000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayOf(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  // camera time "2026:11:20 10:00:20" (no time zone) as a plain number, so gaps and days work whatever the zone
  function captureTime(f) {
    var s = f.imageMediaMetadata && f.imageMediaMetadata.time, m = s && /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
  }
  function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled'; }
  function dec(s) { return decodeURIComponent(String(s).replace(/\+/g, ' ')); }
  // the slate's QR holds a Photo Card link: https://…/photo-card/#case=<id>&n=<name>&l=<label>&s=<stage>
  function parseSlate(txt) {
    var m = /^https?:\/\/[^\/#?]+\/photo-card\/?#(.+)$/.exec(String(txt || ''));
    if (!m) return null;
    var p = {};
    m[1].split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { p[dec(kv.slice(0, i))] = dec(kv.slice(i + 1)); } catch (e) {} } });
    if (!p['case'] || !/^[a-z0-9]{4,20}$/i.test(p['case'])) return null;
    return { id: p['case'], name: (p.n || 'Case').slice(0, 60), label: (p.l || '').slice(0, 60), stage: STAGES[p.s] ? p.s : 'pre' };
  }
  function readSlate(bytes, libs) {
    if (!bytes || bytes.length < 4) return null;
    var u = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) u[i] = bytes[i] & 255;
    if (u[0] !== 0xFF || u[1] !== 0xD8) { console.warn('Preview was not a JPEG, so it could not be checked for a slate.'); return null; }
    var img = libs.jpegDecode(u, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true });
    var r = libs.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    return r ? parseSlate(r.data) : null;
  }

  function run(api, store, cfg, opts) {
    opts = opts || {};
    var clock = opts.now || function () { return Date.now(); }, started = clock(), budget = opts.budgetMs || 4.5 * MIN;
    var libs = opts.libs || PhotoCardLibs();
    var gap = (cfg.MAX_GAP_HOURS || 3) * HOUR;

    // the image.canon folder, and Photo Cases (made if missing)
    var inbox = store.get('inboxId');
    if (inbox && !api.exists(inbox)) inbox = null;
    if (!inbox) {
      var found = api.list("name = '" + api.q(cfg.INBOX_FOLDER) + "' and mimeType = '" + FOLDER + "' and 'root' in parents and trashed = false")
        .concat(api.list("name = '" + api.q(cfg.INBOX_FOLDER) + "' and mimeType = '" + FOLDER + "' and trashed = false"));
      if (!found.length) return 'No folder called "' + cfg.INBOX_FOLDER + '" in Drive yet. It appears when image.canon first sends photos to Drive.';
      inbox = found[0].id; store.set('inboxId', inbox);
    }
    var root = store.get('casesId');
    if (root && !api.exists(root)) root = null;
    if (!root) {
      var r0 = api.list("name = '" + api.q(cfg.CASES_FOLDER) + "' and mimeType = '" + FOLDER + "' and 'root' in parents and trashed = false");
      root = r0.length ? r0[0].id : api.create(cfg.CASES_FOLDER, 'root', {}).id;
      store.set('casesId', root);
    }

    // new files in the inbox, paired by name so IMG_0001.CR3 travels with IMG_0001.JPG
    var files = api.list("'" + inbox + "' in parents and trashed = false").filter(function (f) {
      return f.mimeType !== FOLDER && !(f.properties && f.properties.pcState);
    });
    var groups = {};
    files.forEach(function (f) { var k = f.name.replace(/\.[^.]+$/, '').toLowerCase(); (groups[k] = groups[k] || []).push(f); });
    var now = clock(), items = [], left = 0, skipped = 0;
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], main = g.filter(function (f) { return /^image\/(jpeg|png|heic|heif|webp)$/.test(f.mimeType); })[0];
      var age = now - Math.max.apply(null, g.map(function (f) { return Date.parse(f.createdTime) || 0; }));
      if (!main) { if (age > 2 * HOUR) { g.forEach(function (f) { api.update(f.id, { pcState: 'skipped' }); }); skipped += g.length; } else left += g.length; return; }
      var t = captureTime(main);
      if (!t) { if (age < 30 * MIN) { left += g.length; return; } t = Date.parse(main.createdTime); } // Drive hasn't read the photo's details yet
      var model = main.imageMediaMetadata ? [main.imageMediaMetadata.cameraMake, main.imageMediaMetadata.cameraModel].join(' ') : '';
      if (cfg.CAMERA && model.toLowerCase().indexOf(cfg.CAMERA.toLowerCase()) < 0) { g.forEach(function (f) { api.update(f.id, { pcState: 'skipped' }); }); skipped += g.length; return; }
      items.push({ t: t, day: dayOf(t), main: main, files: g, age: age });
    });
    items.sort(function (a, b) { return a.t - b.t || (a.main.name < b.main.name ? -1 : 1); });

    var slates = store.getJSON('slates', []), folders = {}, filed = 0, slatesFound = 0, cases = {};
    function visitFolder(s, day) {
      var key = s.id + '|' + day + '|' + s.stage;
      if (folders[key]) return folders[key];
      var cf = folders['case|' + s.id];
      if (!cf) {
        var c = api.list("'" + root + "' in parents and properties has { key='pcCase' and value='" + api.q(s.id) + "' } and trashed = false");
        cf = c.length ? c[0].id : api.create(safeName(s.name + (s.label ? ' - ' + s.label : '')), root, { pcCase: s.id }).id;
        folders['case|' + s.id] = cf;
      }
      var vn = day + ' ' + STAGES[s.stage], v = api.list("'" + cf + "' in parents and name = '" + api.q(vn) + "' and mimeType = '" + FOLDER + "' and trashed = false");
      return (folders[key] = v.length ? v[0].id : api.create(vn, cf, {}).id);
    }
    function move(it, s, state) {
      var to = visitFolder(s, it.day);
      it.files.forEach(function (f) { api.update(f.id, { pcState: state, pcCase: s.id }, to, (f.parents || [inbox]).join(',')); });
      cases[s.id] = 1;
    }

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (clock() - started > budget) { left += items.slice(i).reduce(function (n, x) { return n + x.files.length; }, 0); break; }
      var slate = null, p = it.main.properties || {};
      if (p.pcQr !== 'no') {
        var bytes = api.thumb(it.main);
        if (!bytes && it.age < 30 * MIN) { // no preview yet: stop here so nothing is filed past a slate that can't be read yet
          left += items.slice(i).reduce(function (n, x) { return n + x.files.length; }, 0); break;
        }
        try { slate = readSlate(bytes, libs); } catch (e) { console.warn('Could not read ' + it.main.name + ': ' + e.message); }
      }
      if (slate) {
        slates = slates.filter(function (x) { return !(x.id === slate.id && x.t === it.t); });
        var s = { t: it.t, last: it.t, day: it.day, id: slate.id, name: slate.name, label: slate.label, stage: slate.stage };
        slates.push(s); slatesFound++;
        move(it, s, 'slate');
        continue;
      }
      // the latest slate before this photo, the same day, within the gap
      var cover = null;
      for (var j = slates.length - 1; j >= 0; j--) { var x = slates[j]; if (x.t <= it.t && x.day === it.day) { if (cover === null || x.t > cover.t) cover = x; } }
      if (cover && it.t - cover.last <= gap) {
        move(it, cover, 'filed');
        if (it.t > cover.last) cover.last = it.t;
        filed++;
      } else if (it.age > 2 * HOUR) {
        it.files.forEach(function (f) { api.update(f.id, { pcState: 'skipped', pcQr: 'no' }); }); skipped += it.files.length;
      } else {
        if (p.pcQr !== 'no') api.update(it.main.id, { pcQr: 'no' });
        left += it.files.length;
      }
      slates.sort(function (a, b) { return a.t - b.t; });
    }
    slates.sort(function (a, b) { return a.t - b.t; });
    store.setJSON('slates', slates.slice(-40));
    var n = Object.keys(cases).length;
    return ['Filed ' + filed + ' photo' + (filed === 1 ? '' : 's') + ' into ' + n + ' case' + (n === 1 ? '' : 's') + ' (' + slatesFound + ' slate' + (slatesFound === 1 ? '' : 's') + ' found).',
      left ? left + ' file' + (left === 1 ? '' : 's') + ' waiting for a slate or for Drive to finish processing.' : '',
      skipped ? skipped + ' file' + (skipped === 1 ? '' : 's') + ' with no slate left in place.' : ''].filter(Boolean).join(' ');
  }

  // Drive through its REST API, with the script's own access
  function driveApi() {
    var base = 'https://www.googleapis.com/drive/v3/files';
    var FIELDS = 'nextPageToken,files(id,name,mimeType,createdTime,size,parents,properties,thumbnailLink,imageMediaMetadata(time,cameraMake,cameraModel))';
    function call(method, url, body) {
      var o = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
      if (body) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
      var r = UrlFetchApp.fetch(url, o), code = r.getResponseCode();
      if (code === 404) return null;
      if (code >= 300) throw new Error('Drive said ' + code + ': ' + r.getContentText().slice(0, 300));
      return JSON.parse(r.getContentText() || '{}');
    }
    return {
      q: function (s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); },
      list: function (query, max, fields) {
        var out = [], tok = '';
        do {
          var r = call('get', base + '?pageSize=' + (max || 1000) + '&fields=' + encodeURIComponent(fields ? 'files(' + fields + ')' : FIELDS) + '&q=' + encodeURIComponent(query) + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
          out = out.concat((r && r.files) || []); tok = !max && r && r.nextPageToken;
        } while (tok);
        return out;
      },
      exists: function (id) { var r = call('get', base + '/' + id + '?fields=id,trashed'); return !!(r && !r.trashed); },
      create: function (name, parent, props) { return call('post', base + '?fields=id', { name: name, mimeType: FOLDER, parents: [parent], properties: props || {} }); },
      update: function (id, props, add, remove) {
        return call('patch', base + '/' + id + '?fields=id' + (add ? '&addParents=' + add : '') + (remove ? '&removeParents=' + remove : ''), { properties: props });
      },
      thumb: function (f) {
        if (!f.thumbnailLink) return null;
        var url = f.thumbnailLink.replace(/=s\d+[^\/=]*$/, '') + '=s1200';
        var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Accept: 'image/jpeg' }, muteHttpExceptions: true });
        return r.getResponseCode() === 200 ? r.getBlob().getBytes() : null;
      }
    };
  }
  function scriptStore() {
    var sp = PropertiesService.getScriptProperties();
    return {
      get: function (k) { return sp.getProperty(k); },
      set: function (k, v) { sp.setProperty(k, v); },
      getJSON: function (k, d) { try { var v = sp.getProperty(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
      setJSON: function (k, v) { sp.setProperty(k, JSON.stringify(v)); }
    };
  }
  return { run: run, driveApi: driveApi, scriptStore: scriptStore, parseSlate: parseSlate, readSlate: readSlate };
})();
