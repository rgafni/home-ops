/* Home Ops PWA: personal-link auth + google.script.run shim that talks to the Apps Script JSON API.
   The app code (copied unchanged from the Apps Script Index.html) keeps calling google.script.run. */
(function () {
  var C = window.HOMEOPS_CONFIG || {};
  var KEY = 'homeops.k';
  var token = null;

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
  } catch (e) {}
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
      body: JSON.stringify({ k: token, action: action, args: args }),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('Server error ' + r.status);
      return r.json();
    }).then(function (res) {
      if (res && res.ok) { window.__homeopsUser = res.user; return ok(res.result); }
      if (res && res.status === 401) {
        try { localStorage.removeItem(KEY); } catch (e) {}
        clearDataCache();
        token = null;
        showGate(res.error);
        return;
      }
      fail(new Error((res && res.error) || 'Unknown server error'));
    }).catch(function (e) { fail(e); });
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
