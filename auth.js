/* Home Ops PWA: personal-link auth + google.script.run shim that talks to the Apps Script JSON API.
   The app code (copied unchanged from the Apps Script Index.html) keeps calling google.script.run. */
(function () {
  var C = window.HOMEOPS_CONFIG || {};
  var KEY = 'homeops.k';
  var SKEY = 'homeops.s';      // 30-day sign-in session (random; the server keeps only its hash)
  var DKEY = 'homeops.dev';    // random id for this phone/browser (for the private device log)
  var token = null, session = null, device = '';

  // 1) Read the link token once (?k=… or #k=…; a #k= link never reaches any server) and save it on this phone.
  //    iPhone/iPad Safari (not yet installed): the token STAYS in the address bar as #k=… and the page links a
  //    manifest without start_url, so "Add to Home Screen" saves this exact URL and the icon opens with the token
  //    (Home Screen apps get their own storage on iOS, so the icon can't read what Safari saved).
  //    Everywhere else (Android, desktop, the installed app itself) it is stripped from the address bar.
  var UA = navigator.userAgent || '';
  var IOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var STANDALONE = navigator.standalone === true || !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var KEEP_IN_HASH = IOS && !STANDALONE;
  function fnvq(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
  var launchK = '';
  // No cookie copy of the link (it would ride along on every request). Clear any left by an earlier build or test.
  try { var CKP = (location.pathname || '/').replace(/[^\/]*$/, '') || '/'; ['/', CKP].forEach(function (pp) { document.cookie = 'homeops_k=; Max-Age=0; Path=' + pp + '; SameSite=Strict; Secure'; }); } catch (e) {}
  function skip(tk) { try { if (tk) localStorage.setItem('homeops.kskip', fnvq('homeops:' + tk)); } catch (e) {} }
  try {
    var u = new URL(location.href);
    var k = u.searchParams.get('k');
    var hk = /(?:^#|&)k=([A-Za-z0-9_-]{16,128})/.exec(u.hash || '');
    if (!k && hk) k = hk[1];
    if (hk) launchK = hk[1];
    if (k && !/^[A-Za-z0-9_-]{16,128}$/.test(k)) k = null;
    // An iPhone Home Screen icon re-opens with the #k= it was saved with. If someone pasted their own link in the app
    // ("Not you?"), that old icon link is skipped from then on (only a one-way hash of it is kept).
    // The same goes for an old link the server turned down, and for one replaced on the paste-your-link screen.
    if (k && localStorage.getItem('homeops.kskip') === fnvq('homeops:' + k)) k = null;
    var prevK = localStorage.getItem(KEY);
    if (k && prevK && k !== prevK) localStorage.setItem('homeops.kprev', prevK);   // kept until the new link is confirmed
    if (k && k !== prevK) {
      // A different person's link: it replaces the saved one; the old person's sign-in session and data cache go too.
      localStorage.removeItem(SKEY); localStorage.removeItem('homeops.sexp');
      localStorage.setItem('homeops.switched', '1');
    }
    if (k) localStorage.setItem(KEY, k);
    var saved = localStorage.getItem(KEY);
    var rest = (u.hash || '').replace(/(^#|&)k=[^&]*/, '$1').replace(/^#&/, '#').replace(/^#$/, '');
    u.searchParams.delete('k');
    if (KEEP_IN_HASH && saved) {
      // #k=<token>[&rest]: never sent to any server (fragments stay on the phone), saved by Add to Home Screen.
      var want = u.pathname + (u.search || '') + '#k=' + saved + (rest ? '&' + rest.slice(1) : '');
      if (want !== location.pathname + location.search + location.hash) history.replaceState(null, '', want);
    } else if (k || hk || /[?&]k=/.test(location.search)) {
      history.replaceState(null, '', u.pathname + (u.search || '') + rest);
    }
    if (KEEP_IN_HASH) {
      var ml = document.querySelector('link[rel="manifest"]');
      if (ml) ml.setAttribute('href', 'manifest-ios.json');   // no start_url → the Home Screen icon opens the URL above
    }
    token = localStorage.getItem(KEY);
    session = localStorage.getItem(SKEY);
    device = localStorage.getItem(DKEY) || '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(device)) {
      var a = new Uint8Array(16); crypto.getRandomValues(a);
      device = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem(DKEY, device);
    }
  } catch (e) {}
  function deviceLabel() {
    var ua = navigator.userAgent || '';
    var os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android'
      : /mac os/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : /linux|cros/i.test(ua) ? 'Linux' : 'Other';
    var br = /edg\//i.test(ua) ? 'Edge' : /samsungbrowser/i.test(ua) ? 'Samsung' : /firefox|fxios/i.test(ua) ? 'Firefox'
      : /crios|chrome/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Browser';
    var app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? ' app' : '';
    return os + ' \u00b7 ' + br + app;
  }
  // Short id for the per-link data cache: a one-way hash, so no part of the token shows up in key names.
  function fnv(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
  window.__homeopsKeyId = token ? fnv('homeops:' + token) : '';
  function clearDataCache(keepId) {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('homeops.data.') !== 0) return;
        if (keepId && k.slice(-(keepId.length + 1)) === '.' + keepId) return;
        localStorage.removeItem(k);
      });
    } catch (e) {}
  }
  // Phone cache hygiene: drop data cached for any other (old/rotated) link; if this link needs Google
  // sign-in and there's no live session, drop the cache too so nothing private is painted before the server says no.
  try {
    var SEXP = 'homeops.sexp', SIN = 'homeops.si';
    var today = new Date().toISOString().slice(0, 10);
    if (session && (localStorage.getItem(SEXP) || '9999') < today) { localStorage.removeItem(SKEY); session = null; }
    if (localStorage.getItem(SIN) === '1' && !session) clearDataCache();
    else clearDataCache(window.__homeopsKeyId || '-none-');
  } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function showGate(msg) {
    var g = $('gate');
    if (!g) { document.addEventListener('DOMContentLoaded', function () { showGate(msg); }); return; }
    g.hidden = false;
    var m = $('gateMsg');
    if (m) { m.textContent = msg || ''; m.hidden = !msg; }
    wirePaste();
  }
  /* "Paste your link": fixes an installed icon that has no link (e.g. an iPhone icon added before this fix) without
     reinstalling. Accepts the whole link or just the k=… part. Checked with the server before it's saved; a wrong
     link shows nothing but an error. */
  function linkToken(text) {
    var t = String(text || '').trim();
    var m = /[?#&]k=([A-Za-z0-9_-]{16,128})/.exec(t);
    if (m) return m[1];
    m = /^k=([A-Za-z0-9_-]{16,128})$/.exec(t) || /^([A-Za-z0-9_-]{16,128})$/.exec(t);
    return m ? m[1] : '';
  }
  var pasteWired = false;
  function wirePaste() {
    var f = $('gateForm'); if (!f || pasteWired) return;
    pasteWired = true;
    var inp = $('gateLink'), btn = $('gateGo'), m = $('gateMsg');
    function say(t) { m.textContent = t; m.hidden = !t; }
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var tk = linkToken(inp.value);
      if (!tk) { say('That doesn\u2019t look like your link. Paste your whole personal link.'); return; }
      if (!C.API_URL || C.API_URL.indexOf('__') === 0) { say('Setup isn\u2019t finished.'); return; }
      btn.disabled = true; say('');
      fetch(C.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
        body: JSON.stringify({ k: tk, d: device || undefined, dl: deviceLabel(), action: 'ping', args: [] }) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          btn.disabled = false;
          if (res && (res.ok || res.status === 428)) {           // 428 = right link, Google sign-in comes next
            try { localStorage.setItem(KEY, tk); localStorage.removeItem(SKEY); localStorage.removeItem('homeops.kprev'); } catch (e) {}
            if (launchK && launchK !== tk) skip(launchK);   // an old link on the Home Screen icon no longer overrides this one
            inp.value = '';
            if (KEEP_IN_HASH) location.replace(location.pathname + '#k=' + tk); else location.reload();
            return;
          }
          say(res && res.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'That link didn\u2019t work. Ask for a new link.');
        })
        .catch(function () { btn.disabled = false; say('No connection. Try again.'); });
    });
  }
  /* "Not you? Paste your link" (profile sheet): checks the pasted link with the server, then swaps it in.
     Never shows any saved link. Resolves { ok, person } or { ok: false, error }. */
  window.__homeopsUseLink = function (text) {
    var tk = linkToken(text);
    if (!tk) return Promise.resolve({ ok: false, error: 'That doesn\u2019t look like a link. Paste your whole personal link.' });
    if (tk === token) return Promise.resolve({ ok: false, error: 'That\u2019s the link you\u2019re already using.' });
    return fetch(C.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify({ k: tk, d: device || undefined, dl: deviceLabel(), action: 'ping', args: [] }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!(res && (res.ok || res.status === 428))) return { ok: false, error: res && res.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'That link didn\u2019t work. Ask for a new link.' };
        try {
          if (launchK && launchK !== tk) skip(launchK);
          localStorage.removeItem('homeops.kprev');
          localStorage.setItem(KEY, tk); localStorage.removeItem(SKEY); localStorage.removeItem('homeops.sexp');
          localStorage.setItem('homeops.switched', '1');
        } catch (e) {}
        clearDataCache();
        var who = (res.user && res.user.person) || '';
        setTimeout(function () { if (KEEP_IN_HASH) location.replace(location.pathname + '#k=' + tk); else location.reload(); }, 50);
        return { ok: true, person: who };
      })
      .catch(function () { return { ok: false, error: 'No connection. Try again.' }; });
  };
  // A new #k= link opened in a tab that already shows the app only changes the hash (no reload): pick it up here.
  window.addEventListener('hashchange', function () {
    var m = /(?:^#|&)k=([A-Za-z0-9_-]{16,128})/.exec(location.hash || '');
    if (!m || m[1] === token) return;
    try {
      if (localStorage.getItem('homeops.kskip') === fnvq('homeops:' + m[1])) {   // a link already turned down or replaced
        history.replaceState(null, '', location.pathname + location.search + (KEEP_IN_HASH && token ? '#k=' + token : ''));
        return;
      }
      if (localStorage.getItem(KEY) === m[1]) { location.reload(); return; }
      if (localStorage.getItem(KEY)) localStorage.setItem('homeops.kprev', localStorage.getItem(KEY));   // kept until the new link is confirmed
      localStorage.setItem(KEY, m[1]); localStorage.removeItem(SKEY); localStorage.removeItem('homeops.sexp');
      localStorage.setItem('homeops.switched', '1'); localStorage.removeItem('homeops.kskip');
    } catch (e) {}
    location.reload();
  });
  // Chrome and the installed Android app share this storage: if a link was opened in another window, follow it here too.
  // (iPhone Safari keeps the link in the address bar, so the old link there is swapped first; otherwise the reload
  // would save it again and two tabs would flip back and forth.)
  function followLink(cur) {
    if (KEEP_IN_HASH) location.replace(location.pathname + location.search + '#k=' + cur);   // hash-only: hashchange reloads
    else location.reload();
  }
  window.addEventListener('storage', function (e) { if (e.key === KEY && e.newValue && e.newValue !== token) followLink(e.newValue); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    try { var cur = localStorage.getItem(KEY); if (cur && token && cur !== token) followLink(cur); } catch (e) {}
  });
  window.__homeopsForget = function () { try { localStorage.removeItem('homeops.kprev'); localStorage.removeItem(KEY); localStorage.removeItem(SKEY); localStorage.removeItem('homeops.sexp'); } catch (e) {} clearDataCache(); location.reload(); };

  // Read-only calls are retried (twice, with a short pause) when Google's redirect hiccups and hands back the
  // plain "Home Ops API" page instead of JSON. Writes are never retried, so nothing is saved twice.
  var READ_ONLY = /^(get[A-Z]|ping$)/;
  function call(action, args, ok, fail, attempt) {
    attempt = attempt || 0;
    if (!token) { showGate(); return; }               // nothing is sent without a link
    if (!C.API_URL || C.API_URL.indexOf('__') === 0) { fail(new Error('Setup isn\u2019t finished (API URL missing)')); return; }
    fetch(C.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // "simple" request: no CORS preflight
      body: JSON.stringify({ k: token, s: session || undefined, d: device || undefined, dl: deviceLabel(), action: action, args: args }),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) { var se = new Error('Server error ' + r.status); se.status = r.status; throw se; }
      return r.text();
    }).then(function (txt) {
      var res;
      try { res = JSON.parse(txt); } catch (e) {
        if (READ_ONLY.test(action) && attempt < 2) {
          setTimeout(function () { call(action, args, ok, fail, attempt + 1); }, 1500 * (attempt + 1));
          return;
        }
        throw new Error('The server answered oddly. Try again.');
      }
      if (res && res.ok) { window.__homeopsUser = res.user; try { localStorage.removeItem('homeops.kprev'); } catch (e) {} return ok(res.result); }
      if (res && res.status === 428) {        // Google sign-in needed (the owner's link only)
        try { localStorage.removeItem(SKEY); localStorage.setItem('homeops.si', '1'); } catch (e) {}
        session = null;
        clearDataCache();
        showSignin(res.signin || {}, res.error);
        return;
      }
      if (res && res.status === 401) {
        // The server says this link is not valid. Don't let it come back from the address bar or an icon, and if a
        // link that worked before was replaced by it, go back to that one instead of asking.
        skip(token);
        var prev = null; try { prev = localStorage.getItem('homeops.kprev'); localStorage.removeItem('homeops.kprev'); } catch (e) {}
        if (prev && prev !== token) {
          try { localStorage.setItem(KEY, prev); localStorage.removeItem(SKEY); localStorage.removeItem('homeops.sexp'); } catch (e) {}
          clearDataCache();
          if (KEEP_IN_HASH) location.replace(location.pathname + '#k=' + prev); else location.reload();
          return;
        }
        try { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); localStorage.removeItem('homeops.sexp'); } catch (e) {}
        clearDataCache();
        token = null;
        showGate(res.error);
        return;
      }
      var er = new Error((res && res.error) || 'Unknown server error'); er.status = (res && res.status) || 0; fail(er);   // status lets the save queue tell 'refused' from 'try again'
    }).catch(function (e) { fail(e); });
  }

  /* ---- Google sign-in screen (only ever shown after the server answers 428) ---- */
  var signinShown = false;
  function post(action, args) {
    return fetch(C.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify({ k: token, d: device || undefined, dl: deviceLabel(), action: action, args: args }) })
      .then(function (r) { if (!r.ok) throw new Error('Server error ' + r.status); return r.json(); });
  }
  function signedIn(res, msgEl) {
    if (res && res.ok && res.result && res.result.session) {
      try { localStorage.setItem(SKEY, res.result.session); localStorage.setItem('homeops.sexp', res.result.exp || ''); } catch (e) {}
      location.reload();
      return;
    }
    if (res && res.status === 401) { window.__homeopsForget(); return; }
    msgEl.textContent = (res && res.error) || 'That didn\u2019t work. Try again.';
    msgEl.hidden = false;
  }
  function showSignin(cfg, msg) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { showSignin(cfg, msg); }); return; }
    var box = $('signin');
    if (!box) {
      box = document.createElement('div');
      box.id = 'signin';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Sign in');
      box.innerHTML = '<img src="icons/icon-192.png" alt="">' +
        '<h1>Gafni House</h1>' +
        '<p class="si__sub">Sign in with Google to open your page. You\u2019ll stay signed in on this phone for 30 days.</p>' +
        '<div id="gsiBtn" class="si__gsi"></div>' +
        '<div id="signinMsg" class="si__msg" role="alert" hidden></div>' +
        '<button type="button" id="recLink" class="si__link">Use a recovery code</button>' +
        '<form id="recForm" class="si__rec" hidden autocomplete="off">' +
        '<input id="recCode" class="si__input" type="password" inputmode="text" autocomplete="one-time-code" placeholder="Recovery code" aria-label="Recovery code">' +
        '<button type="submit" class="si__btn">Continue</button></form>' +
        '<button type="button" id="siChrome" class="si__link" hidden>Open in Chrome</button>';
      document.body.appendChild(box);
      var sc0 = $('siChrome'), AI0 = window.AppInstall;
      if (sc0 && AI0 && AI0.mode() === 'handoff') { sc0.hidden = false; sc0.addEventListener('click', function () { AI0.install(); }); }
      var msgEl = $('signinMsg');
      $('recLink').addEventListener('click', function () { $('recForm').hidden = false; $('recLink').hidden = true; $('recCode').focus(); });
      $('recForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var code = $('recCode').value.trim();
        if (!code) return;
        msgEl.hidden = true;
        post('recover', [{ code: code }]).then(function (r) { signedIn(r, msgEl); })
          .catch(function () { msgEl.textContent = 'No connection. Try again.'; msgEl.hidden = false; });
      });
    }
    var m = $('signinMsg');
    if (msg && !/^Sign in with Google to continue/.test(msg)) { m.textContent = msg; m.hidden = false; }
    var gate = $('gate'); if (gate) gate.hidden = true;
    box.hidden = false;
    if (signinShown) return;
    signinShown = true;
    if (!cfg.clientId) return;
    var run = window.google && window.google.script;      // keep our google.script.run shim
    var sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = function () {
      if (run && window.google && !window.google.script) window.google.script = run;
      try {
        google.accounts.id.initialize({ client_id: cfg.clientId, auto_select: false, ux_mode: 'popup', itp_support: true,
          callback: function (resp) {
            post('signIn', [{ idToken: resp && resp.credential }]).then(function (r) { signedIn(r, m); })
              .catch(function () { m.textContent = 'No connection. Try again.'; m.hidden = false; });
          } });
        google.accounts.id.renderButton($('gsiBtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 300 });
      } catch (e) { m.textContent = 'Google sign-in didn\u2019t load. Use your recovery code.'; m.hidden = false; }
    };
    sc.onerror = function () { m.textContent = 'Google sign-in didn\u2019t load. Check your connection.'; m.hidden = false; };
    document.head.appendChild(sc);
  }

  function makeRunner(ok, fail) {
    var base = {
      withSuccessHandler: function (f) { return makeRunner(f, fail); },
      withFailureHandler: function (f) { return makeRunner(ok, f); },
      withUserObject: function () { return makeRunner(ok, fail); }
    };
    return new Proxy(base, {
      get: function (t, k) {
        if (k in t) return t[k];
        if (typeof k !== 'string') return undefined;
        return function () { call(k, [].slice.call(arguments), ok || function () {}, fail || function () {}); };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = { run: makeRunner() };

  if (!token) showGate();

  /* ---- Install banner (install.js decides HOW: Chrome's one-tap prompt, hand-off from an in-app browser to
     Chrome, or a 2-step sheet). Shown at the top of the app whenever it's open in a browser, never in the app. ---- */
  function $i() { return window.AppInstall; }
  function removeBanner() { var b = $('installBar'); if (b) b.remove(); }
  function renderBanner() {
    var AI = $i();
    if (!AI || !token || !AI.visible()) { removeBanner(); return; }
    var app = $('app');
    if (!app || app.hidden) { setTimeout(renderBanner, 400); return; }
    var sub = AI.mode() === 'handoff' ? 'Opens in Chrome first' : 'Opens like an app';
    var bar = $('installBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'installBar';
      bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Install app');
      bar.innerHTML = '<span class="inst__icon" aria-hidden="true"><img src="icons/icon-192.png" alt=""></span>' +
        '<span class="inst__text">Get the app<small id="installSub"></small></span>' +
        '<button type="button" class="inst__btn" id="installBtn">Install app</button>' +
        '<button type="button" class="inst__x" id="installX" aria-label="Not now">\u2715</button>';
      app.insertBefore(bar, app.firstChild);
      $('installX').addEventListener('click', function () { AI.snooze(7); removeBanner(); });
      $('installBtn').addEventListener('click', function () { AI.install(); });
    }
    bar.className = 'inst inst--' + AI.mode() + (AI.handedOff ? ' inst--hi' : '');
    $('installSub').textContent = AI.handedOff && AI.mode() === 'prompt' ? 'Now tap Install app' : sub;
  }
  function startBanner() {
    var AI = $i(); if (!AI) return;
    AI.onChange(renderBanner);
    renderBanner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startBanner); else startBanner();

  /* Updates: the service worker is re-checked on every open and whenever the app comes back to the front; when a
     new version takes over (or the page was answered from the offline copy and a newer one arrived), a small
     "Updated · tap to refresh" pill shows. */
  function showUpdated() {
    if (!document.body || document.getElementById('updBar')) return;
    var b = document.createElement('button');
    b.id = 'updBar'; b.type = 'button'; b.textContent = 'Updated \u00b7 tap to refresh';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top, 0px));z-index:95;' +
      'min-height:44px;padding:0 18px;border:0;border-radius:999px;background:#1D2B4F;color:#fff;font:700 15px/1 Manrope,system-ui,sans-serif;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.25)';
    b.addEventListener('click', function () { location.reload(); });
    document.body.appendChild(b);
  }
  window.__homeopsShowUpdated = showUpdated;
  if ('serviceWorker' in navigator) {
    var hadCtl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (hadCtl) showUpdated(); hadCtl = true; });
    navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'homeops-updated') showUpdated(); });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        try { reg.update(); } catch (e) {}
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { try { reg.update(); } catch (e) {} } });
      }).catch(function () {});
    });
  }
})();
