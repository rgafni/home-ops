/* Home Ops PWA: personal-link auth + google.script.run shim that talks to the Apps Script JSON API.
   The app code (copied unchanged from the Apps Script Index.html) keeps calling google.script.run. */
(function () {
  var C = window.HOMEOPS_CONFIG || {};
  var KEY = 'homeops.k';
  var SKEY = 'homeops.s';      // 30-day sign-in session (random; the server keeps only its hash)
  var DKEY = 'homeops.dev';    // random id for this phone/browser (for the private device log)
  var token = null, session = null, device = '';

  // 1) Read ?k=<token> once, save it, and strip it from the address bar.
  try {
    var u = new URL(location.href);
    var k = u.searchParams.get('k');
    if (k) {
      localStorage.setItem(KEY, k);
      u.searchParams.delete('k');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
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
  // Short id for the per-link data cache (the full token never leaves localStorage/HTTPS).
  window.__homeopsKeyId = token ? token.slice(0, 6) : '';
  function clearDataCache() {
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('homeops.data.') === 0) localStorage.removeItem(k); });
    } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }
  function showGate(msg) {
    var g = $('gate');
    if (!g) { document.addEventListener('DOMContentLoaded', function () { showGate(msg); }); return; }
    g.hidden = false;
    var m = $('gateMsg');
    if (m) { m.textContent = msg || ''; m.hidden = !msg; }
  }
  window.__homeopsForget = function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); };

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
        try { localStorage.removeItem(SKEY); } catch (e) {}
        session = null;
        clearDataCache();
        showSignin(res.signin || {}, res.error);
        return;
      }
      if (res && res.status === 401) {
        try { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); } catch (e) {}
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
      try { localStorage.setItem(SKEY, res.result.session); } catch (e) {}
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
  function showBanner(mode) {
    if (standalone() || dismissed()) return;
    var app = $('app');
    if (!app || app.hidden) { setTimeout(function () { showBanner(mode); }, 400); return; }
    removeBanner();
    var bar = document.createElement('div');
    bar.id = 'installBar';
    bar.className = 'inst inst--' + mode;
    if (mode === 'prompt') {
      bar.innerHTML = '<span class="inst__icon" aria-hidden="true"><img src="icons/icon-192.png" alt=""></span>' +
        '<span class="inst__text">Get Gafni House on your home screen</span>' +
        '<button type="button" class="inst__btn" id="installBtn">Install app</button>' +
        '<button type="button" class="inst__x" id="installX" aria-label="Dismiss">\u2715</button>';
    } else {
      var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      bar.innerHTML = '<span class="inst__text">' + (ios ? 'Tap Share, then Add to Home Screen' : 'Tap \u22ee then Add to Home screen') + '</span>' +
        '<button type="button" class="inst__x" id="installX" aria-label="Dismiss">\u2715</button>';
    }
    app.insertBefore(bar, app.firstChild);
    var x = $('installX');
    x.addEventListener('click', function () { try { localStorage.setItem(DISMISS, '1'); } catch (e) {} removeBanner(); });
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
