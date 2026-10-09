/* install.js: one "Install app" flow shared by Roni's web apps (same file in every repo).
   Load it in <head> (after any link-token script):
     <script src="install.js" data-name="Gafni House" data-ns="homeops" data-token-key="homeops.k"></script>
   API: AppInstall.mode() -> 'standalone' | 'prompt' | 'chrome' | 'handoff' | 'steps'
        AppInstall.visible()  true unless running as the installed app (or just installed / snoozed)
        AppInstall.install()  the right thing for this browser (call from a tap)
        AppInstall.onChange(fn), AppInstall.snooze(days), AppInstall.handedOff
   Privacy: a personal link token only ever goes into an intent:// URL that Android handles on the phone itself
   (it is never fetched, logged or sent anywhere). The "?ih=1" marker that rides along carries no data. */
(function () {
  if (window.AppInstall) return;
  var S = document.currentScript || {}, D = (S.dataset || {});
  var NAME = D.name || document.title || 'this app', NS = (D.ns || 'app') + '.install', TOKEN_KEY = D.tokenKey || '';
  var ua = navigator.userAgent || '';
  var ANDROID = /Android/i.test(ua);
  var IOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // In-app browsers / WebViews (no install menu there): Android WebView "; wv)", old-style "Version/4.0 Chrome/",
  // Facebook, Instagram, LINE, Snapchat, TikTok, X/Twitter, LinkedIn, Google app, Telegram, WeChat, KakaoTalk, Pinterest.
  var IN_APP = /; wv\)|\bwv\b|FBAN|FBAV|FB_IAB|FBIOS|Instagram|\bLine\/|Snapchat|musical_ly|BytedanceWebview|TikTok|Twitter|LinkedInApp|\bGSA\/|Telegram|MicroMessenger|KAKAOTALK|Pinterest|WhatsApp/i.test(ua) ||
    (ANDROID && /Version\/\d+(\.\d+)* Chrome\//.test(ua));
  var OTHER_BROWSER = /SamsungBrowser|Firefox|FxiOS|EdgA|EdgiOS|OPR\/|OPiOS|Opera|UCBrowser|YaBrowser|DuckDuckGo|Brave|MiuiBrowser|HuaweiBrowser|CriOS/i.test(ua);
  var REAL_CHROME_ANDROID = ANDROID && /Chrome\/\d+/.test(ua) && !IN_APP && !OTHER_BROWSER;
  var IOS_SAFARI = IOS && /Safari\//.test(ua) && !IN_APP && !OTHER_BROWSER;
  var deferred = null, prompted = false, listeners = [], t0 = Date.now();

  // Arrived here from the "Open in Chrome" hand-off? Remember it and drop the marker from the address bar.
  var handedOff = false;
  try {
    var u0 = new URL(location.href);
    if (u0.searchParams.get('ih') === '1') {
      handedOff = true; u0.searchParams.delete('ih');
      history.replaceState(history.state, '', u0.pathname + (u0.search || '') + u0.hash);
    }
  } catch (e) {}

  function get(k) { try { return localStorage.getItem(NS + '.' + k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(NS + '.' + k); else localStorage.setItem(NS + '.' + k, v); } catch (e) {} }
  function standalone() {
    return (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches ||
      matchMedia('(display-mode: minimal-ui)').matches)) || navigator.standalone === true;
  }
  function until(k) { var v = +get(k) || 0; return v > Date.now(); }
  function emit() { listeners.forEach(function (f) { try { f(mode()); } catch (e) {} }); }

  function mode() {
    if (standalone()) return 'standalone';
    if (deferred) return 'prompt';
    if (ANDROID && (IN_APP || OTHER_BROWSER || !REAL_CHROME_ANDROID)) return 'handoff';
    if (REAL_CHROME_ANDROID) return 'chrome';      // Chrome, prompt not offered (yet): Custom Tab, or already installed
    return 'steps';                                  // iPhone / iPad / desktop / anything else
  }
  function visible() {
    if (standalone()) return false;
    if (until('installed') && !deferred) return false;
    if (until('snooze') && !handedOff) return false;
    return true;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e; prompted = true; set('installed', null); emit();
  });
  window.addEventListener('appinstalled', function () {
    deferred = null; set('installed', String(Date.now() + 30 * 864e5)); emit(); closeSheet();
  });
  if (window.matchMedia) try { matchMedia('(display-mode: standalone)').addEventListener('change', emit); } catch (e) {}

  /* Page address for the hand-off. The token is put back into the #fragment (it was stripped from the bar on load). */
  function pageUrl(withMarker) {
    var u = new URL(location.href);
    if (withMarker) u.searchParams.set('ih', '1'); else u.searchParams.delete('ih');
    var tok = null;
    try { tok = TOKEN_KEY ? localStorage.getItem(TOKEN_KEY) : null; } catch (e) {}
    if (tok && /^[A-Za-z0-9_-]{16,128}$/.test(tok)) u.hash = 'k=' + tok;
    return u;
  }
  function intentUrl() {
    var u = pageUrl(true);
    return 'intent://' + u.host + u.pathname + u.search + u.hash + '#Intent;scheme=https;package=com.android.chrome;end';
  }
  function openInChrome() {
    var href = intentUrl();
    // If Android takes over, this page goes to the background. Still showing after a moment = the app blocked it.
    setTimeout(function () { if (!document.hidden) showSheet('inapp'); }, 1600);
    location.href = href;           // handled by Android on the phone; never requested from any server
  }

  function install() {
    if (deferred) {
      var e = deferred; deferred = null;
      try {
        e.prompt();
        (e.userChoice || Promise.resolve({})).then(function (c) {
          if (c && c.outcome === 'accepted') set('installed', String(Date.now() + 30 * 864e5));
          emit();
        });
      } catch (x) { showSheet(); }
      emit();
      return;
    }
    var m = mode();
    if (m === 'handoff') return openInChrome();
    if (m === 'chrome') {
      // Chrome may still be getting ready (the prompt arrives a moment after load). Wait briefly, then decide.
      var wait = Math.max(0, 2500 - (Date.now() - t0));
      var go = function () {
        if (deferred) return install();
        if (handedOff || prompted) return showSheet();   // surely real Chrome: show the 2 steps
        openInChrome();                            // probably a Custom Tab inside a chat app
      };
      if (!wait) return go();
      var fired = false, tm = 0;
      var onb = function () { setTimeout(fin, 0); };
      var fin = function () { if (fired) return; fired = true; clearTimeout(tm); window.removeEventListener('beforeinstallprompt', onb); go(); };
      tm = setTimeout(fin, wait);
      window.addEventListener('beforeinstallprompt', onb);
      return;
    }
    showSheet();
  }

  /* ---- 2-line help sheet ---- */
  var I = {
    dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4" fill="none"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none"/></svg>'
  };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function steps(kind) {
    if (kind === 'inapp' && ANDROID) return ['Tap ' + I.dots + ' at the top and pick <b>Open in Chrome</b> (or <b>Open in browser</b>).',
      'In Chrome, tap <b>Install app</b>. Or copy the link below and paste it in Chrome.'];
    if (IOS && !IOS_SAFARI) return ['Open this page in <b>Safari</b> (tap ' + I.dots + ' or the compass, then <b>Open in Safari</b>).',
      'In Safari, tap Share ' + I.share + ' then <b>Add to Home Screen</b>.'];
    if (IOS) return ['Tap Share ' + I.share + ' at the bottom of Safari.', 'Tap <b>Add to Home Screen</b>, then <b>Add</b>.'];
    if (ANDROID) return ['Tap ' + I.dots + ' at the top right of Chrome.', 'Tap <b>Add to Home screen</b>, then <b>Install</b>.'];
    return ['Open the browser menu ' + I.dots + '.', 'Choose <b>Install app</b> (or <b>Add to Home screen</b>).'];
  }
  function closeSheet() { var o = document.getElementById('aiSheet'); if (o) o.remove(); }
  function copyLink(btn) {
    var link = pageUrl(false).href, done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy link'; }, 1800); };
    try { navigator.clipboard.writeText(link).then(done, fallback); } catch (e) { fallback(); }
    function fallback() { var t = document.createElement('textarea'); t.value = link; t.setAttribute('readonly', ''); t.className = 'ai-off';
      document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) {} t.remove(); }
  }
  function showSheet(kind) {
    closeSheet();
    var inapp = kind === 'inapp' || (IOS && !IOS_SAFARI);
    var bg = document.createElement('div');
    bg.id = 'aiSheet'; bg.className = 'ai-bg';
    bg.innerHTML = '<div class="ai-sheet" role="dialog" aria-modal="true" aria-labelledby="aiTitle"><div class="ai-handle"></div>' +
      '<h3 id="aiTitle">Install ' + esc(NAME) + '</h3><ol class="ai-steps">' +
      steps(kind).map(function (t) { return '<li><span>' + t + '</span></li>'; }).join('') + '</ol>' +
      '<div class="ai-row">' + (inapp ? '<button type="button" class="ai-btn ai-btn--ghost" id="aiCopy">Copy link</button>' : '') +
      '<button type="button" class="ai-btn" id="aiOk">Got it</button></div></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', function (e) { if (e.target === bg) closeSheet(); });
    document.getElementById('aiOk').addEventListener('click', closeSheet);
    var c = document.getElementById('aiCopy'); if (c) c.addEventListener('click', function () { copyLink(c); });
    setTimeout(function () { try { document.getElementById('aiOk').focus(); } catch (e) {} }, 50);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  window.AppInstall = {
    mode: mode, visible: visible, install: install, showSheet: showSheet, intentUrl: intentUrl, handedOff: handedOff,
    android: ANDROID, ios: IOS, inApp: IN_APP,
    onChange: function (f) { listeners.push(f); },
    snooze: function (days) { set('snooze', String(Date.now() + (days || 7) * 864e5)); emit(); }
  };
})();
