/* ALHUDA_D.NET — Aplikasi hotspot MikroTik (Dayah Al-Huda Malikussaleh) */
(function () {
  'use strict';

  /* ===== Batas indikator ===== */
  var GB = 1024 * 1024 * 1024;
  var LIM = {
    totalData: { max: 30000 * GB, warn: 25000 * GB, danger: 28000 * GB },
    active:    { max: 100, warn: 70, danger: 90 },
    traffic:   { max: 200e6, warn: 150e6, danger: 180e6 },
    iface:     { max: 40e6, warn: 30e6, danger: 35e6 },
    expiry:    { warn: 70, danger: 90 },
    speedBar:  20e6   // skala bar kecepatan per perangkat
  };

  /* ===== Koneksi langsung ke MikroTik lewat plugin native ===== */
  var Cap = window.Capacitor, transport = null;
  if (Cap && (!Cap.isNativePlatform || Cap.isNativePlatform())) {
    transport = Cap.registerPlugin ? Cap.registerPlugin('RosSocket') : (Cap.Plugins && Cap.Plugins.RosSocket);
  }
  if (!transport) transport = window.DEV_TRANSPORT || {
    connect: function () { return Promise.reject(new Error('Koneksi MikroTik hanya tersedia di aplikasi Android (APK).')); },
    talk: function () { return Promise.reject(new Error('Tidak terhubung')); },
    close: function () { return Promise.resolve(); },
    localIp: function () { return Promise.resolve({ ip: '' }); }
  };
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('ahb_' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('ahb_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var backend = new window.AlhudaBackend(transport, store);
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var LN = isNative && Cap.registerPlugin ? Cap.registerPlugin('LocalNotifications') : null;

  /* ===== Tema ===== */
  var THEMES = [
    { id: 'terang', name: 'Terang', hdr: '#ffffff', acc: '#0e6b52' },
    { id: 'biru', name: 'Biru', hdr: '#1747a6', acc: '#5b9bff' },
    { id: 'hijau', name: 'Hijau', hdr: '#0b4a37', acc: '#c9a24a' },
    { id: 'pink', name: 'Pink', hdr: '#b0275f', acc: '#ff8fbf' },
    { id: 'gelap', name: 'Gelap', hdr: '#111816', acc: '#3ccf8e' }
  ];
  function themeOf(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return THEMES[2]; }
  function applyTheme(id) {
    var t = themeOf(id);
    document.documentElement.setAttribute('data-theme', t.id);
    store.set('theme', t.id);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t.hdr);
    // ikon jam/baterai gelap untuk tema terang, putih untuk tema lain
    if (transport.setSystemBars) transport.setSystemBars({ darkIcons: t.id === 'terang' }).catch(function () {});
  }
  /* Header & latar menembus ke area jam (status bar) */
  var insetTries = 0;
  function applyInsets() {
    if (!transport.insets) return;
    transport.insets().then(function (r) {
      var root = document.documentElement.style;
      if (r.top > 0) root.setProperty('--sat', r.top + 'px');
      root.setProperty('--sab', (r.bottom || 0) + 'px');
      if (!r.top && insetTries++ < 15) setTimeout(applyInsets, 300);
    }, function () {});
  }
  applyTheme(store.get('theme') || 'hijau');
  applyInsets();
  window.addEventListener('resize', function () { insetTries = 0; setTimeout(applyInsets, 200); });

  /* ===== Notifikasi kadaluarsa (1 hari sebelum habis) ===== */
  function notifId(name) { var h = 7; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 2000000000; return h + 1; }
  function cancelReminder(name) {
    store.set('remind_key', '');
    if (LN && name) LN.cancel({ notifications: [{ id: notifId(name) }] }).catch(function () {});
  }
  function scheduleReminder(name, exp) {
    if (!LN || !exp || exp.expired || !exp.end) return;
    var key = name + '|' + exp.end;
    if (store.get('remind_key') === key) return; // sudah dijadwalkan untuk masa berlaku ini
    var endMs = Date.now() + exp.remaining * 1000, at = endMs - 86400000, soon = at <= Date.now();
    var body = soon
      ? 'Masa berlaku username ' + name + ' tersisa ' + Math.max(1, Math.round(exp.remaining / 3600)) + ' jam lagi (berakhir ' + exp.end + '). Segera perpanjang paket.'
      : 'Masa berlaku username ' + name + ' tersisa 1 hari lagi (berakhir ' + exp.end + '). Segera perpanjang paket.';
    store.set('remind_key', key);
    LN.checkPermissions().then(function (p) { return p.display === 'granted' ? p : LN.requestPermissions(); }).then(function (p) {
      if (p.display !== 'granted') { store.set('remind_key', ''); return; }
      var id = notifId(name);
      return LN.cancel({ notifications: [{ id: id }] }).catch(function () {}).then(function () {
        return LN.schedule({ notifications: [{
          id: id, title: '⏰ Kadaluarsa tinggal 1 hari', body: body,
          schedule: { at: new Date(soon ? Date.now() + 3000 : at), allowWhileIdle: true }
        }] });
      });
    }).catch(function () { store.set('remind_key', ''); });
  }

  var view = document.getElementById('view');
  var state = { config: null, page: 'home', timers: [], adminData: null, ifaces: null, expEnd: null, exp: null };

  /* ===== Ikon ===== */
  var IC = {
    edit: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 17.3V20h2.7l8-8-2.7-2.7-8 8zM19.7 7a1 1 0 0 0 0-1.4l-1.3-1.3a1 1 0 0 0-1.4 0l-1.6 1.6 2.7 2.7z"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-8v-2h8V5h-8z"/><path fill="currentColor" d="M9.6 7.6 11 9l-2 2h7v2H9l2 2-1.4 1.4L5.2 12z"/></svg>',
    data: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3C7 3 3 4.6 3 6.5v11C3 19.4 7 21 12 21s9-1.6 9-3.5v-11C21 4.6 17 3 12 3zm0 2c4.4 0 7 1.2 7 1.5S16.4 8 12 8 5 6.8 5 6.5 7.6 5 12 5zm0 14c-4.4 0-7-1.2-7-1.5v-2.3c1.6.9 4.2 1.3 7 1.3s5.4-.4 7-1.3v2.3c0 .3-2.6 1.5-7 1.5zm0-5c-4.4 0-7-1.2-7-1.5V10.2C6.6 11 9.2 11.5 12 11.5s5.4-.5 7-1.3v2.3c0 .3-2.6 1.5-7 1.5z"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.2-4.5-2.7z"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M11 4h2v12l4-4 1.4 1.4L12 19.8l-6.4-6.4L7 12l4 4z"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M11 20h2V8l4 4 1.4-1.4L12 4.2l-6.4 6.4L7 12l4-4z"/></svg>'
  };

  /* ===== Util ===== */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function num(v, d) { return v.toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: 0 }); }
  function fmtBytes(b) {
    b = +b || 0;
    if (b >= 1024 * GB) return num(b / (1024 * GB), 2) + ' TB';
    if (b >= GB) return num(b / GB, 2) + ' GB';
    if (b >= 1048576) return num(b / 1048576, 1) + ' MB';
    if (b >= 1024) return num(b / 1024, 0) + ' KB';
    return b + ' B';
  }
  function fmtMbps(v) { v = (+v || 0) / 1e6; return num(v, v >= 10 ? 1 : 2) + ' Mbps'; }
  function bytesParts(b) { var s = fmtBytes(b).split(' '); return { n: s[0], u: s[1] }; }
  function fmtGB(b) { return num(b / GB, 2) + ' GB'; }
  function fmtBps(v) {
    v = +v || 0;
    if (v >= 1e6) return num(v / 1e6, v >= 1e7 ? 1 : 2) + ' Mbps';
    if (v >= 1e3) return num(v / 1e3, 0) + ' kbps';
    return '0 Mbps';
  }
  function fmtUptime(u) {
    if (!u || u === '-') return '-';
    return String(u).replace(/(\d+)w/, '$1 mgg ').replace(/(\d+)d/, '$1 hr ').replace(/(\d+)h/, '$1 jam ').replace(/(\d+)m(?!s)/, '$1 mnt ').replace(/(\d+)s/, '$1 dtk').trim();
  }
  function level(v, warn, danger) { return v >= danger ? 'red' : v >= warn ? 'yellow' : ''; }
  function pad(n) { return ('0' + n).slice(-2); }

  function meter(label, value, lim, valueText, footL, footR) {
    var pct = Math.max(0, Math.min(100, value / lim.max * 100));
    return '<div class="meter"><div class="meter-head"><span class="k">' + label + '</span><span class="v">' + esc(valueText) + '</span></div>' +
      '<div class="track"><div class="fill ' + level(value, lim.warn, lim.danger) + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="meter-foot"><span>' + (footL || '') + '</span><span>' + (footR || '') + '</span></div></div>';
  }

  var toastT;
  function toast(msg, type) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show ' + (type || '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  /* ===== Cache lokal (offline) ===== */
  function cacheSet(k, v) { try { localStorage.setItem('ahd_' + k, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {} }
  function cacheGet(k) { try { return JSON.parse(localStorage.getItem('ahd_' + k)) || null; } catch (e) { return null; } }
  function staleNote(c) { return c ? '<div class="stale">Offline — data terakhir ' + new Date(c.t).toLocaleString('id-ID') + '</div>' : ''; }

  /* ===== API ===== */
  function setOnline(on) { $('#netDot').classList.toggle('off', !on); }
  function api(action, body) {
    return backend.call(action, body).then(function (j) { setOnline(true); return j; }, function (e) {
      e = e || { error: 'Terjadi kesalahan' };
      if (e.offline_router) { setOnline(false); e.error = 'MikroTik tidak terjangkau. Pastikan HP tersambung ke wifi ' + ((state.config && state.config.hotspot_name) || 'hotspot') + '.'; }
      throw e;
    });
  }
  function load(key, action, body) {
    return api(action, body).then(function (j) { cacheSet(key, j); return { data: j, fresh: true }; }, function (e) {
      var c = cacheGet(key);
      if (c && (e.network || e.offline_router)) return { data: c.v, fresh: false, cache: c, error: e };
      throw e;
    });
  }

  function applyConfig(c) {
    state.config = c || {};
    $('#headerText').textContent = state.config.header || 'ALHUDA_D.NET';
    $('#siteTitle').textContent = state.config.site_title || 'DAYAH AL-HUDA MALIKUSSALEH';
    document.title = state.config.site_title || 'DAYAH AL-HUDA MALIKUSSALEH';
  }
  function loadConfig() {
    return load('config', 'config').then(function (r) { applyConfig(r.data.config); return r; });
  }

  /* ===== Navigasi (Beranda <-> Peraturan) ===== */
  function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }
  function every(ms, fn) { state.timers.push(setInterval(function () { if (!document.hidden) fn(); }, ms)); }
  function route() {
    var p = (location.hash || '').slice(1) === 'peraturan' ? 'peraturan' : 'home';
    state.page = p;
    $('#icGear').hidden = p === 'peraturan';
    $('#icClose').hidden = p !== 'peraturan';
    clearTimers();
    window.scrollTo(0, 0);
    if (p === 'peraturan') pagePeraturan(); else pageHome();
  }
  window.addEventListener('hashchange', route);
  $('#settingsBtn').addEventListener('click', function () {
    if (state.page === 'peraturan') { if (history.length > 1 && location.hash === '#peraturan') history.back(); else location.hash = ''; }
    else location.hash = 'peraturan';
  });

  /* ===== Username tersimpan ===== */
  function getUser() { return store.get('username') || ''; }
  function setUser(n) { store.set('username', n || ''); }

  /* ================= HALAMAN UTAMA ================= */
  function pageHome() {
    view.innerHTML =
      '<div class="sec-title">Penggunaan<span class="pill" id="identity">—</span></div>' +
      '<div class="card" id="use"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>' +
      '<div class="sec-title">Username</div><div id="acct"></div><div id="userArea"></div>' +
      '<div class="sec-title">Interface Padat<span class="pill">5 terbesar</span></div>' +
      '<div class="card" id="ifc"><div class="skeleton"></div><div class="skeleton"></div></div>' +
      '<div class="footer">Property Of DAMAS.Media_Centre Tahun 2026 · Dayah Al-Huda Malikussaleh<br>Desain Aplikasi : Tgk. Khairuddin Zakas, S.Pd</div>';

    var c = cacheGet('info'); if (c) drawInfo({ data: c.v, fresh: true });
    fetchInfo(); every(5000, fetchInfo);
    renderAccount();
    every(1000, tickCountdown);
  }

  function fetchInfo() {
    load('info', 'info').then(drawInfo, function (e) {
      if ($('#use')) $('#use').innerHTML = '<div class="alert err" style="margin:0">' + esc(e.error || 'Gagal memuat') + '</div>';
      if ($('#ifc')) $('#ifc').innerHTML = '<div class="empty">Data belum tersedia.</div>';
    });
  }
  function drawInfo(r) {
    var d = r.data; if (!$('#use')) return;
    var t = d.traffic || { rx: 0, tx: 0 }, tt = t.rx + t.tx;
    $('#identity').textContent = d.identity || (state.config && state.config.session_name) || '—';
    $('#use').innerHTML = (r.fresh ? '' : staleNote(r.cache)) +
      meter('Total Data', d.total_bytes, LIM.totalData, fmtGB(d.total_bytes), d.users + ' user terdaftar', 'maks 30.000 GB') +
      meter('Hotspot Aktif', d.active, LIM.active, d.active + ' Online', 'sesi aktif ' + fmtBytes(d.active_bytes), 'maks 100') +
      meter('Lalu Lintas <span class="muted">(' + esc(t.iface || '-') + ')</span>', tt, LIM.traffic, fmtBps(tt), '↓ ' + fmtBps(t.rx) + ' &nbsp; ↑ ' + fmtBps(t.tx), 'maks 200 Mbps') +
      (t.error ? '<div class="alert warn" style="margin:8px 0 0">' + esc(t.error) + '</div>' : '');
    var top = d.top || [];
    $('#ifc').innerHTML = top.length ? top.map(function (i, n) {
      var v = i.rx + i.tx;
      return meter('<span class="rank">' + (n + 1) + '</span>' + esc(i.name), v, LIM.iface, fmtBps(v), '↓ ' + fmtBps(i.rx) + ' &nbsp; ↑ ' + fmtBps(i.tx), 'maks 40 Mbps');
    }).join('') : '<div class="empty">Belum ada data interface.</div>';
  }

  /* ----- Kotak username ----- */
  function renderAccount() {
    var u = getUser();
    $('#userArea').innerHTML = '';
    state.exp = null; state.expEnd = null;
    if (!u) return renderUserInput();
    var c = cacheGet('ud_' + u);
    if (c) drawUser(c.v, c); else $('#acct').innerHTML = '<div class="card"><div class="skeleton"></div><div class="skeleton"></div></div>';
    fetchUser(u);
    every(3000, function () { if (getUser() === u && $('#userArea')) fetchUser(u); });
  }

  function renderUserInput(msg) {
    $('#userArea').innerHTML = '';
    $('#acct').innerHTML = '<div class="card"><form id="uForm" autocomplete="off">' +
      '<label class="lbl" for="uname">Masukkan Username</label>' +
      '<input id="uname" class="input big" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="username / kode voucher" required>' +
      '<div class="muted" style="text-align:center;margin:8px 0 12px">Username akan disimpan di aplikasi ini.</div>' +
      '<button class="btn primary block" id="uBtn">Lihat Akun</button>' +
      (msg ? '<div class="alert err" style="margin:12px 0 0">' + msg + '</div>' : '') + '</form></div>';
    $('#uForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = $('#uname').value.replace(/\s+/g, '');
      if (!n) return;
      var b = $('#uBtn'); b.disabled = true; b.textContent = 'Memeriksa…';
      api('userdetail', { username: n }).then(function (j) {
        if (j.status === 'notfound') { renderUserInput('<b>Username tidak tersedia</b>Periksa kembali username yang Anda ketik.'); return; }
        cacheSet('ud_' + j.user.name, j);
        setUser(j.user.name);
        toast('Username tersimpan', 'ok');
        clearTimers(); pageHome();
      }, function (err) { b.disabled = false; b.textContent = 'Lihat Akun'; toast(err.error || 'Gagal', 'err'); });
    });
  }

  function fetchUser(u) {
    load('ud_' + u, 'userdetail', { username: u }).then(function (r) {
      if (getUser() !== u) return;
      if (r.data.status === 'notfound') {
        setUser(''); renderUserInput('<b>Username tidak tersedia</b>"' + esc(u) + '" sudah tidak ada atau telah diubah.'); return;
      }
      drawUser(r.data, r.fresh ? null : r.cache);
    }, function (e) { if (!cacheGet('ud_' + u)) $('#acct').innerHTML = '<div class="alert err">' + esc(e.error || 'Gagal memuat') + '</div>'; });
  }

  function drawUser(j, cache) {
    if (!$('#acct')) return;
    var u = j.user;
    var st = j.status === 'overlimit' ? '<span class="badge warn">Melebihi batas</span>' :
      j.status === 'expired' ? '<span class="badge bad">Kadaluarsa</span>' :
      j.status === 'disabled' ? '<span class="badge bad">Nonaktif</span>' : '';
    $('#acct').innerHTML = (cache ? staleNote(cache) : '') +
      '<div class="card user-card"><div class="avatar">' + esc(u.name.charAt(0).toUpperCase()) + '</div>' +
      '<div class="grow"><div class="user-name">' + esc(u.name) + '</div>' +
      '<span class="badge">' + esc(u.profile || 'default') + '</span> <span class="badge">' + u.online + (u.limit ? '/' + u.limit : '') + ' online</span> ' + st + '</div></div>' +
      (j.status === 'overlimit' ? '<div class="alert warn"><b>Online melebihi batas</b>' + esc(j.message) + ' Keluarkan perangkat yang tidak dikenal di Daftar Online.</div>' : '') +
      '<div class="grid2">' +
      '<button class="act edit" id="editBtn"><span class="ic">' + IC.edit + '</span><span><b>Edit Username</b><small>Ganti username</small></span></button>' +
      '<button class="act out" id="outBtn"><span class="ic">' + IC.out + '</span><span><b>Keluar</b><small>Ganti akun</small></span></button></div>';
    $('#editBtn').addEventListener('click', function () { renameSheet(u.name); });
    $('#outBtn').addEventListener('click', function () {
      if (!confirm('Keluar dari username ' + u.name + '?\nAnda bisa memasukkan username lain.')) return;
      cancelReminder(u.name); setUser(''); clearTimers(); pageHome(); toast('Silakan masukkan username lain');
    });

    // Penggunaan & Kadaluarsa
    var bp = bytesParts(u.bytes);
    state.exp = j.expiry;
    state.expEnd = j.expiry && !j.expiry.expired ? Date.now() + j.expiry.remaining * 1000 : null;
    var pct = j.expiry && j.expiry.pct != null ? j.expiry.pct : 0;
    var ecls = pct >= LIM.expiry.danger ? 'bad' : pct >= LIM.expiry.warn ? 'warn' : '';
    var lastDay = j.expiry && !j.expiry.expired && j.expiry.remaining <= 86400;
    if (!cache) scheduleReminder(u.name, j.expiry);
    $('#userArea').innerHTML =
      (lastDay ? '<div class="alert remind"><span class="bell">🔔</span><span><b>Masa berlaku tinggal kurang dari 1 hari</b>Username ' + esc(u.name) + ' berakhir ' + esc(j.expiry.end) + '. Segera perpanjang paket agar internet tidak terputus.</span></div>' : '') +
      '<div class="grid2">' +
      '<div class="tile usage"><div class="t">' + IC.data + 'Penggunaan</div><div class="big">' + esc(bp.n) + '<small>' + esc(bp.u) + '</small></div><div class="sub">Download + Upload</div></div>' +
      '<div class="tile exp ' + ecls + '" id="expTile"><div class="t">' + IC.clock + 'Kadaluarsa</div>' + expiryInner() + '</div>' +
      '</div>' +
      '<div class="sec-title">Daftar Online<span class="pill"><i class="live"></i> langsung</span></div>' +
      '<div class="card">' + sessionsHTML(j.sessions, u.name) + '</div>' +
      '<div class="sec-title">Daftar Cookie<span class="pill">' + (j.cookies || []).length + '</span></div>' +
      '<div class="card">' + cookiesHTML(j.cookies) + '</div>';
    bindKick($('#userArea'), function () { fetchUser(u.name); });
  }

  function expiryInner() {
    var e = state.exp;
    if (!e) return '<div class="big" style="font-size:22px">Tanpa batas</div><div class="sub">Belum ada masa berlaku</div>';
    if (e.expired || !state.expEnd) return '<div class="big" style="font-size:24px;color:var(--bad)">Habis</div><div class="sub">Berakhir ' + esc(e.end) + '</div>';
    var rem = Math.max(0, Math.floor((state.expEnd - Date.now()) / 1000));
    var d = Math.floor(rem / 86400), h = Math.floor(rem % 86400 / 3600), m = Math.floor(rem % 3600 / 60), s = rem % 60;
    return '<div class="big" id="expDays">' + d + '<small>Hari</small></div>' +
      '<div class="clock" id="expClock">' + pad(h) + ':' + pad(m) + ':' + pad(s) + '</div>' +
      '<div class="sub">s/d ' + esc(e.end) + '</div>';
  }
  function tickCountdown() {
    if (!state.expEnd || !$('#expTile')) return;
    var rem = Math.max(0, Math.floor((state.expEnd - Date.now()) / 1000));
    if (rem === 0) { state.exp.expired = true; }
    var el = $('#expTile'); el.innerHTML = el.querySelector('.t').outerHTML + expiryInner();
  }

  function speedBox(r) {
    var dn = r ? r.down : null, up = r ? r.up : null;
    function w(v) { return v == null ? 0 : Math.min(100, Math.sqrt(v / LIM.speedBar) * 100).toFixed(0); }
    return '<div class="speed">' +
      '<div class="dn"><div class="ln"><span class="lb">' + IC.down + 'DOWN</span><span class="val">' + (dn == null ? '…' : fmtMbps(dn)) + '</span></div><div class="bar"><i style="width:' + w(dn) + '%"></i></div></div>' +
      '<div class="upl" style="margin-top:6px"><div class="ln"><span class="lb">' + IC.up + 'UP</span><span class="val">' + (up == null ? '…' : fmtMbps(up)) + '</span></div><div class="bar"><i style="width:' + w(up) + '%"></i></div></div>' +
      '</div>';
  }
  function sessionsHTML(list, username) {
    if (!list || !list.length) return '<div class="empty">Tidak ada perangkat yang online.</div>';
    return list.map(function (s) {
      return '<div class="sess"><div class="kv">' +
        '<span>Server</span><span>' + esc(s.server) + '</span>' +
        '<span>IP</span><span>' + esc(s.ip) + '</span>' +
        '<span>MAC</span><span>' + esc(s.mac) + '</span>' +
        '<span>Terkoneksi</span><span>' + esc(fmtUptime(s.uptime)) + '</span>' +
        '<span>Perangkat</span><span>' + esc(s.device || '-') + '</span>' +
        '<span>Lalu lintas</span><span>' + fmtBytes(s.bytes_in + s.bytes_out) + '</span>' +
        '</div><div class="side">' + speedBox(s.rate) +
        '<button class="btn danger sm" data-kick="' + esc(s.id) + '" data-user="' + esc(username) + '">Keluarkan</button></div></div>';
    }).join('');
  }
  function cookiesHTML(list) {
    if (!list || !list.length) return '<div class="empty">Tidak ada cookie tersimpan.</div>';
    return list.map(function (c) {
      return '<div class="sess"><div class="kv"><span>Server</span><span>' + esc(c.server) + '</span><span>IP</span><span>' + esc(c.ip) +
        '</span><span>MAC</span><span>' + esc(c.mac) + '</span><span>Perangkat</span><span>' + esc(c.device) + '</span><span>Berlaku</span><span>' + esc(fmtUptime(c.expires)) + '</span></div></div>';
    }).join('');
  }
  function bindKick(root, after) {
    $all('[data-kick]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Keluarkan perangkat ini dari internet?')) return;
        b.disabled = true;
        api('kick', { username: b.getAttribute('data-user'), id: b.getAttribute('data-kick') }).then(function (j) { toast(j.message, 'ok'); after && after(); },
          function (e) { b.disabled = false; toast(e.error || 'Gagal', 'err'); });
      });
    });
  }

  /* ----- Edit username (lembar bawah) ----- */
  function openSheet(html) { $('#sheetCard').innerHTML = html; $('#sheet').hidden = false; }
  function closeSheet() { $('#sheet').hidden = true; $('#sheetCard').innerHTML = ''; }
  $('#sheet').addEventListener('click', function (e) { if (e.target.id === 'sheet') closeSheet(); });

  function renameSheet(old) {
    openSheet('<h3>Edit Username</h3><div class="muted" style="margin-bottom:14px">Password ikut berubah (username = password). Perangkat yang sedang online dengan username lama akan dikeluarkan.</div>' +
      '<form id="rnForm"><div class="field"><label class="lbl">Username lama</label><input class="input" value="' + esc(old) + '" disabled></div>' +
      '<div class="field"><label class="lbl">Username baru</label><input class="input" id="nn1" autocapitalize="off" spellcheck="false" required></div>' +
      '<div class="field"><label class="lbl">Masukkan lagi username baru</label><input class="input" id="nn2" autocapitalize="off" spellcheck="false" required></div>' +
      '<div class="grid2" style="margin:4px 0 0"><button type="button" class="btn" id="rnCancel">Batal</button><button class="btn primary" id="rnSave">Simpan</button></div></form>');
    $('#nn1').focus();
    $('#rnCancel').addEventListener('click', closeSheet);
    $('#rnForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var n1 = $('#nn1').value.trim(), n2 = $('#nn2').value.trim();
      if (n1 !== n2) { toast('Username baru tidak sama', 'err'); return; }
      var b = $('#rnSave'); b.disabled = true;
      api('rename', { username: old, newname: n1, confirm: n2 }).then(function () {
        closeSheet(); cancelReminder(old); setUser(n1); toast('Username diubah menjadi ' + n1, 'ok'); clearTimers(); pageHome();
      }, function (err) { b.disabled = false; toast(err.error || 'Gagal', 'err'); });
    });
  }

  /* ----- Pilih tema ----- */
  function themeSheet() {
    var cur = store.get('theme') || 'hijau';
    openSheet('<h3>Tema Aplikasi</h3><div class="muted">Warna header ikut sampai ke area jam.</div><div class="themes">' +
      THEMES.map(function (t) {
        return '<button class="th' + (t.id === cur ? ' on' : '') + '" data-th="' + t.id + '"><span class="sw" style="background:' + t.hdr + '"><i style="background:' + t.acc + '"></i></span>' + t.name + '</button>';
      }).join('') + '</div><button class="btn block" id="thClose" style="margin-top:16px">Selesai</button>');
    $all('[data-th]').forEach(function (b) {
      b.addEventListener('click', function () {
        applyTheme(b.getAttribute('data-th'));
        $all('[data-th]').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    $('#thClose').addEventListener('click', closeSheet);
  }
  $('#themeBtn').addEventListener('click', themeSheet);

  /* ================= PERATURAN (ADMIN) ================= */
  function pagePeraturan() {
    view.innerHTML = '<div class="card"><div class="skeleton"></div></div>';
    api('admin_status').then(function (j) { if (j.admin) loadAdmin(); else adminGate(); }, function () { adminGate(); });
  }
  function adminGate() {
    view.innerHTML = '<div class="sec-title">Peraturan</div><div class="card"><div class="muted" style="margin-bottom:12px">Khusus admin. Masukkan kode aktivasi.</div>' +
      '<form id="gate"><input type="password" class="input big" id="code" placeholder="Kode aktivasi" required>' +
      '<button class="btn primary block" style="margin-top:12px">Masuk</button><div id="gateMsg"></div></form></div>';
    $('#gate').addEventListener('submit', function (e) {
      e.preventDefault();
      api('admin_login', { code: $('#code').value }).then(function () { toast('Akses admin diberikan', 'ok'); loadAdmin(); },
        function (err) { $('#gateMsg').innerHTML = '<div class="alert err" style="margin:12px 0 0">' + esc(err.error || 'Kode salah') + '</div>'; });
    });
  }
  function loadAdmin() {
    api('admin_get').then(function (j) {
      state.adminData = j.settings; renderAdmin();
      api('admin_ifaces').then(function (x) { state.ifaces = x.interfaces; renderIfaceSec(); }, function (e) { state.ifaces = null; renderIfaceSec(e.error); });
    }, function (e) { view.innerHTML = '<div class="alert err">' + esc(e.error) + '</div>'; });
  }
  function inputF(label, key, val, type, ph) {
    return '<div class="field"><label class="lbl">' + esc(label) + '</label><input class="input" data-k="' + key + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" placeholder="' + esc(ph || '') + '"></div>';
  }
  function renderAdmin() {
    var s = state.adminData;
    var unread = (s.notifications || []).filter(function (n) { return !n.read; }).length;
    $('#notifDot').hidden = !unread;
    view.innerHTML = '<div class="sec-title">Peraturan<span class="pill">admin</span></div>' +
      '<details class="sec" ' + (unread ? 'open' : '') + '><summary><span>🔔 Pemberitahuan' + (unread ? '<span class="nbadge">' + unread + '</span>' : '') + '</span></summary><div class="body" id="notifBody"></div></details>' +
      '<details class="sec"><summary>🖧 Koneksi MikroTik</summary><div class="body"><div class="g2">' +
      inputF('IP MikroTik', 'router.host', s.router.host) + inputF('Port API', 'router.port', s.router.port, 'number') +
      inputF('Username API', 'router.user', s.router.user) + inputF('Password API', 'router.pass', '', 'password', s.router.has_pass ? '•••• (kosongkan jika tetap)' : '') +
      '</div><div class="muted" style="margin-bottom:10px">Koneksi ini hanya tersimpan di HP ini.</div><button class="btn sm" id="testBtn">Tes Koneksi</button><div id="testMsg"></div></div></details>' +
      '<details class="sec"><summary>🏷️ Umum</summary><div class="body"><div class="g2">' +
      inputF('Header', 'header', s.header) + inputF('Nama Dayah', 'site_title', s.site_title) +
      inputF('Nama Sesi', 'session_name', s.session_name) + inputF('Nama Hotspot', 'hotspot_name', s.hotspot_name) + '</div></div></details>' +
      '<details class="sec"><summary>📈 Lalu Lintas &amp; Interface</summary><div class="body" id="ifSec"><div class="skeleton"></div></div></details>' +
      '<details class="sec"><summary>🔑 Kode Aktivasi Admin</summary><div class="body"><form id="codeForm">' +
      '<div class="field"><label class="lbl">Kode lama</label><input type="password" class="input" id="c0" required></div>' +
      '<div class="g2"><div class="field"><label class="lbl">Kode baru</label><input type="password" class="input" id="c1" required></div>' +
      '<div class="field"><label class="lbl">Ulangi kode baru</label><input type="password" class="input" id="c2" required></div></div>' +
      '<button class="btn sm">Ubah Kode</button></form></div></details>' +
      '<div class="savebar"><button class="btn primary grow" id="saveAll">Simpan</button><button class="btn" id="adminOut">Keluar Admin</button></div>';

    renderNotif(); renderIfaceSec();
    $('#testBtn').addEventListener('click', function () {
      var m = $('#testMsg'); m.innerHTML = '<div class="muted" style="margin-top:8px">Menghubungi MikroTik… (simpan dulu jika IP/password diubah)</div>';
      api('admin_test').then(function (j) {
        m.innerHTML = '<div class="alert ok" style="margin:10px 0 0"><b>Terhubung ✔</b>' + esc(j.identity) + ' · RouterOS ' + esc(j.version) + ' · ' + esc(j.board) + ' · uptime ' + esc(j.uptime) + '</div>';
      }, function (e) { m.innerHTML = '<div class="alert err" style="margin:10px 0 0"><b>Gagal</b>' + esc(e.error) + '</div>'; });
    });
    $('#saveAll').addEventListener('click', saveAdmin);
    $('#adminOut').addEventListener('click', function () { api('admin_logout').then(function () { $('#notifDot').hidden = true; location.hash = ''; toast('Keluar dari admin'); }); });
    $('#codeForm').addEventListener('submit', function (e) {
      e.preventDefault();
      api('admin_code', { old: $('#c0').value, 'new': $('#c1').value, confirm: $('#c2').value }).then(function (j) { toast(j.message, 'ok'); e.target.reset(); }, function (err) { toast(err.error, 'err'); });
    });
  }
  function renderNotif() {
    var s = state.adminData, b = $('#notifBody'), list = s.notifications || [];
    b.innerHTML = list.length ? list.map(function (n) {
      return '<div class="notif ' + (n.read ? '' : 'unread') + '">✏️ <b>' + esc(n.time) + '</b> — Username <b>' + esc(n.old) + '</b> diubah menjadi <b>' + esc(n['new']) + '</b></div>';
    }).join('') + '<div class="row"><button class="btn sm" id="nRead">Tandai dibaca</button><button class="btn sm danger" id="nClear">Hapus semua</button></div>'
      : '<div class="muted">Belum ada pemberitahuan.</div>';
    if (list.length) {
      $('#nRead').addEventListener('click', function () { api('admin_notif', { op: 'read' }).then(function () { list.forEach(function (n) { n.read = true; }); renderAdmin(); }); });
      $('#nClear').addEventListener('click', function () { if (confirm('Hapus semua pemberitahuan?')) api('admin_notif', { op: 'clear' }).then(function () { s.notifications = []; renderAdmin(); }); });
    }
  }
  function renderIfaceSec(err) {
    var box = $('#ifSec'); if (!box) return;
    var s = state.adminData, list = state.ifaces;
    if (!list) { box.innerHTML = (err ? '<div class="alert warn">Daftar interface tidak bisa diambil: ' + esc(err) + '</div>' : '<div class="skeleton"></div>') + inputF('Antar Muka Lalu Lintas', 'traffic_iface', s.traffic_iface); return; }
    var names = list.map(function (i) { return i.name; });
    if (names.indexOf(s.traffic_iface) < 0) names.unshift(s.traffic_iface);
    box.innerHTML = '<div class="field"><label class="lbl">Antar Muka Lalu Lintas</label><select class="input" data-k="traffic_iface">' +
      names.map(function (n) { return '<option' + (n === s.traffic_iface ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>' +
      '<label class="lbl">Kecualikan dari Interface Padat (boleh lebih dari 1)</label><div class="chips">' +
      list.map(function (i) { return '<label><input type="checkbox" data-ex value="' + esc(i.name) + '"' + ((s.excluded_ifaces || []).indexOf(i.name) >= 0 ? ' checked' : '') + '>' + esc(i.name) + '</label>'; }).join('') + '</div>';
  }
  function saveAdmin() {
    var out = { router: {} };
    $all('[data-k]').forEach(function (el) {
      var k = el.getAttribute('data-k'), v = el.value;
      if (k.indexOf('router.') === 0) out.router[k.slice(7)] = v; else out[k] = v;
    });
    if ($('[data-ex]')) out.excluded_ifaces = $all('[data-ex]').filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    var b = $('#saveAll'); b.disabled = true;
    api('admin_save', { settings: out }).then(function (j) {
      b.disabled = false; toast(j.message, 'ok'); loadConfig().catch(function () {});
    }, function (e) { b.disabled = false; toast(e.error || 'Gagal menyimpan', 'err'); });
  }

  /* ===== Mulai ===== */
  var cc = cacheGet('config');
  if (cc) applyConfig(cc.v.config); else applyConfig({});
  loadConfig().catch(function () {});
  route();
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.page === 'home') fetchInfo(); });
})();
