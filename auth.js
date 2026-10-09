/* Home Ops PWA: personal-link auth + google.script.run shim that talks to the Apps Script JSON API.
   The app code (copied unchanged from the Apps Script Index.html) keeps calling google.script.run. */
(function () {
  var C = window.HOMEOPS_CONFIG || {};
  var KEY = 'homeops.k';
  var SKEY = 'homeops.s';      // 30-day sign-in session (random; the server keeps only its hash)
  var DKEY = 'homeops.dev';    // random id for this phone/browser (for the private device log)
  var token = null, session = null, device = '';

  // 1) Read the link token once (?k=… or #k=…; a #k= link never reaches any server), save it on this phone,
  //    and strip it from the address bar and the history entry. The page sends no Referer (meta referrer).
  try {
    var u = new URL(location.href);
    var k = u.searchParams.get('k');
    var hk = /(?:^#|&)k=([A-Za-z0-9_-]{16,128})/.exec(u.hash || '');
    if (!k && hk) k = hk[1];
    if (k || hk) {
      localStorage.setItem(KEY, k);
      u.searchParams.delete('k');
      var h = (u.hash || '').replace(/(^#|&)k=[^&]*/, '$1').replace(/^#&/, '#').replace(/^#$/, '');
      history.replaceState(null, '', u.pathname + (u.search || '') + h);
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
  }
  window.__homeopsForget = function () { try { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); localStorage.removeItem('homeops.sexp'); } catch (e) {} clearDataCache(); location.reload(); };

  function call(action, args, ok, fail) {
    if (!token) { showGate(); return; }               // nothing is sent without a link
    if (!C.API_URL || C.API_URL.indexOf('__') === 0) { fail(new Error('Setup isn\u2019t finished (API URL missing)')); return; }
    fetch(C.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // "simple" request: no CORS preflight
      body: JSON.stringify({ k: token, s: session || undefined, d: device || undefined, dl: deviceLabel(), action: action, args: args }),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('Server error ' + r.status);
      return r.json();
    }).then(function (res) {
      if (res && res.ok) { window.__homeopsUser = res.user; return ok(res.result); }
      if (res && res.status === 428) {        // Google sign-in needed (Roni's link only)
        try { localStorage.removeItem(SKEY); localStorage.setItem('homeops.si', '1'); } catch (e) {}
        session = null;
        clearDataCache();
        showSignin(res.signin || {}, res.error);
        return;
      }
      if (res && res.status === 401) {
        try { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); localStorage.removeItem('homeops.sexp'); } catch (e) {}
        clearDataCache();
        token = null;
        showGate(res.error);
        return;
      }
      fail(new Error((res && res.error) || 'Unknown server error'));
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
        '<button type="submit" class="si__btn">Continue</button></form>';
      document.body.appendChild(box);
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

  /* ---- Install banner: real "Install app" when Chrome offers it, else a one-line hint ---- */
  var DISMISS = 'homeops.installDismissed';
  var deferred = null, hintTimer = null;
  function standalone() {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  function dismissed() { try { return localStorage.getItem(DISMISS) === '1'; } catch (e) { return false; } }
  function removeBanner() { var b = $('installBar'); if (b) b.remove(); }
  var IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var SHARE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  var PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  var DOTS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg>';
  /* Step-by-step "add to Home Screen" sheet (iPhone/iPad Safari has no install prompt; some Android browsers don't either). */
  function showHow() {
    var old = $('installHowSheet'); if (old) old.remove();
    var bg = document.createElement('div');
    bg.id = 'installHowSheet'; bg.className = 'ihow-bg';
    var steps = IOS
      ? ['Tap the Share button ' + SHARE_SVG + ' in the Safari toolbar.', 'Scroll down and tap <b>Add to Home Screen</b> ' + PLUS_SVG + '.', 'Tap <b>Add</b>. Gafni House now opens from your Home Screen like an app.']
      : ['Tap the menu ' + DOTS_SVG + ' at the top right of the browser.', 'Tap <b>Install app</b> or <b>Add to Home screen</b>.', 'Tap <b>Install</b>. Gafni House now opens from your home screen like an app.'];
    bg.innerHTML = '<div class="ihow" role="dialog" aria-modal="true" aria-labelledby="ihowTitle"><div class="ihow__handle"></div>' +
      '<h3 id="ihowTitle">Add Gafni House to your ' + (IOS ? 'Home Screen' : 'home screen') + '</h3><ol>' +
      steps.map(function (t) { return '<li><span>' + t + '</span></li>'; }).join('') + '</ol>' +
      '<button type="button" class="ihow__ok" id="ihowOk">Got it</button></div>';
    document.body.appendChild(bg);
    function close() { bg.remove(); }
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    $('ihowOk').addEventListener('click', close);
    setTimeout(function () { try { $('ihowOk').focus(); } catch (e) {} }, 50);
  }
  function showBanner(mode) {
    if (standalone() || dismissed()) return;
    var app = $('app');
    if (!app || app.hidden) { setTimeout(function () { showBanner(mode); }, 400); return; }
    removeBanner();
    var bar = document.createElement('div');
    bar.id = 'installBar';
    bar.className = 'inst inst--' + mode;
    bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Install app');
    var icon = '<span class="inst__icon" aria-hidden="true"><img src="icons/icon-192.png" alt=""></span>';
    if (mode === 'prompt') {
      bar.innerHTML = icon + '<span class="inst__text">Install the app<small>Opens from your home screen</small></span>' +
        '<button type="button" class="inst__btn" id="installBtn">Install</button>' +
        '<button type="button" class="inst__x" id="installX" aria-label="Dismiss">\u2715</button>';
    } else {
      bar.innerHTML = icon + '<span class="inst__text">Install the app' +
        '<small>' + (IOS ? 'Share \u2192 Add to Home Screen' : 'Menu \u22ee \u2192 Add to Home screen') + '</small></span>' +
        '<button type="button" class="inst__btn" id="installHow">How</button>' +
        '<button type="button" class="inst__x" id="installX" aria-label="Dismiss">\u2715</button>';
    }
    app.insertBefore(bar, app.firstChild);
    var x = $('installX');
    x.addEventListener('click', function () { try { localStorage.setItem(DISMISS, '1'); } catch (e) {} removeBanner(); });
    var how = $('installHow');
    if (how) how.addEventListener('click', showHow);
    var btn = $('installBtn');
    if (btn) btn.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function (c) { if (c && c.outcome === 'accepted') removeBanner(); deferred = null; });
    });
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    clearTimeout(hintTimer);
    showBanner('prompt');
  });
  window.addEventListener('appinstalled', function () {
    try { localStorage.setItem(DISMISS, '1'); } catch (e) {}
    deferred = null; removeBanner();
  });
  window.addEventListener('load', function () {
    // If Chrome hasn't offered the install prompt after a few seconds, show the manual hint on phones.
    hintTimer = setTimeout(function () {
      if (!deferred && token && /android|iphone|ipad|ipod/i.test(navigator.userAgent)) showBanner('hint');
    }, 6000);
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
