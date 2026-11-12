/* ALHUDA_D.NET — Portal Hotspot (Dayah Al-Huda Malikussaleh) */
(function () {
  'use strict';

  /* ===== Batas indikator ===== */
  var GB = 1024 * 1024 * 1024;
  var LIM = {
    userData:  { max: 500 * GB, warn: 400 * GB, danger: 450 * GB },
    totalData: { max: 30000 * GB, warn: 25000 * GB, danger: 28000 * GB },
    active:    { max: 100, warn: 70, danger: 90 },
    traffic:   { max: 200e6, warn: 150e6, danger: 180e6 },
    iface:     { max: 40e6, warn: 30e6, danger: 35e6 },
    expiry:    { warn: 70, danger: 90 }
  };

  /* ===== Koneksi langsung ke MikroTik lewat plugin native (APK) ===== */
  var Cap = window.Capacitor;
  var transport = null;
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
  var view = document.getElementById('view');
  var state = { config: null, tab: 'beranda', timers: [], admin: false, adminData: null, ifaces: null };

  /* ===== Util ===== */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmtBytes(b) {
    b = +b || 0;
    if (b >= 1024 * GB) return (b / (1024 * GB)).toFixed(2) + ' TB';
    if (b >= GB) return (b / GB).toFixed(2) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  }
  function fmtGB(b) { return (b / GB).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' GB'; }
  function fmtBps(v) {
    v = +v || 0;
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' Mbps';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + ' kbps';
    return v.toFixed(0) + ' bps';
  }
  function fmtMoney(n) {
    var cur = (state.config && state.config.currency) || 'Rp';
    n = parseInt(n, 10);
    if (isNaN(n)) return '-';
    return cur + ' ' + n.toLocaleString('id-ID');
  }
  function fmtDur(s) {
    s = Math.max(0, Math.floor(s));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return d + ' hari ' + h + ' jam';
    if (h) return h + ' jam ' + m + ' menit';
    return m + ' menit';
  }
  function fmtUptime(u) {
    if (!u || u === '-') return '-';
    return String(u).replace(/(\d+)w/, '$1 mgg ').replace(/(\d+)d/, '$1 hr ').replace(/(\d+)h/, '$1 jam ').replace(/(\d+)m(?!s)/, '$1 mnt ').replace(/(\d+)s/, '$1 dtk').trim();
  }
  function level(v, warn, danger) { return v >= danger ? 'red' : v >= warn ? 'yellow' : ''; }

  function meter(label, value, lim, valueText, footL, footR) {
    var pct = Math.max(0, Math.min(100, value / lim.max * 100));
    return '<div class="meter"><div class="meter-head"><span class="k">' + esc(label) + '</span><span class="v">' + esc(valueText) + '</span></div>' +
      '<div class="track"><div class="fill ' + level(value, lim.warn, lim.danger) + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="meter-foot"><span>' + (footL || '') + '</span><span>' + (footR || '') + '</span></div></div>';
  }
  function expiryMeter(exp) {
    if (!exp) return '<div class="meter"><div class="meter-head"><span class="k">Kadaluarsa</span><span class="v">—</span></div><div class="muted">Belum ada masa berlaku (belum login pertama / tanpa batas waktu).</div></div>';
    var pct = exp.pct == null ? 0 : exp.pct;
    var cls = level(pct, LIM.expiry.warn, LIM.expiry.danger);
    var right = exp.expired ? '<b style="color:var(--bad)">Sudah kadaluarsa</b>' : 'Sisa ' + fmtDur(exp.remaining);
    return '<div class="meter"><div class="meter-head"><span class="k">Kadaluarsa</span><span class="v">' + (exp.pct == null ? '' : pct.toFixed(1) + '%') + '</span></div>' +
      '<div class="track"><div class="fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<div class="meter-foot"><span>' + esc(exp.start || '?') + ' – ' + esc(exp.end) + '</span><span>' + right + '</span></div></div>';
  }

  var toastT;
  function toast(msg, type) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show ' + (type || '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 3500);
  }

  /* ===== Penyimpanan lokal (agar bisa dibuka offline) ===== */
  function cacheSet(k, v) { try { localStorage.setItem('ahd_' + k, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {} }
  function cacheGet(k) { try { var x = JSON.parse(localStorage.getItem('ahd_' + k)); return x || null; } catch (e) { return null; } }
  function staleNote(c) {
    if (!c) return '';
    return '<div class="stale">Mode offline — data terakhir ' + new Date(c.t).toLocaleString('id-ID') + '</div>';
  }

  /* ===== Panggilan API ===== */
  function api(action, body) {
    return backend.call(action, body).then(function (j) {
      setOnline(true);
      return j;
    }, function (e) {
      e = e || { error: 'Terjadi kesalahan' };
      if (e.offline_router) { setOnline(false); e.error = 'MikroTik tidak terjangkau. Pastikan HP tersambung ke wifi ' + ((state.config && state.config.hotspot_name) || 'hotspot') + '. (' + e.error + ')'; }
      throw e;
    });
  }
  /** Kecilkan gambar banner sebelum disimpan ke MikroTik */
  function compressImage(file) {
    return new Promise(function (ok, no) {
      var fr = new FileReader();
      fr.onerror = function () { no({ error: 'Gagal membaca gambar' }); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { no({ error: 'File bukan gambar yang valid' }); };
        img.onload = function () {
          var W = 800, H = 300, cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          var sc = Math.max(W / img.width, H / img.height), w = img.width * sc, h = img.height * sc;
          cv.getContext('2d').drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
          var q = 0.72, out = cv.toDataURL('image/jpeg', q);
          while (out.length > 90000 && q > 0.3) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
          ok(out);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  /** Ambil data: jaringan dulu, jika gagal pakai cache lokal */
  function load(key, action, body) {
    return api(action, body).then(function (j) { cacheSet(key, j); return { data: j, fresh: true }; }, function (e) {
      var c = cacheGet(key);
      if (c && (e.network || e.offline_router)) return { data: c.v, fresh: false, cache: c, error: e };
      throw e;
    });
  }

  function setOnline(on) {
    document.getElementById('netBadge').hidden = !!on;
  }
  window.addEventListener('online', function () { setOnline(true); refresh(); });
  window.addEventListener('offline', function () { setOnline(false); });

  /* ===== Konfigurasi umum ===== */
  function applyConfig(c) {
    state.config = c;
    $('#headerText').textContent = c.header || 'ALHUDA_D.NET';
    $('#siteTitle').textContent = c.site_title || 'DAYAH AL-HUDA MALIKUSSALEH';
    document.title = c.site_title || 'DAYAH AL-HUDA MALIKUSSALEH';
  }
  function loadConfig() {
    return load('config', 'config').then(function (r) { applyConfig(r.data.config); return r; }, function (e) {
      if (!state.config) applyConfig({});
      throw e;
    });
  }

  /* ===== Navigasi ===== */
  function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }
  function every(ms, fn) { state.timers.push(setInterval(function () { if (!document.hidden) fn(); }, ms)); }

  function route() {
    var h = (location.hash || '#beranda').slice(1).split('?')[0];
    if (!PAGES[h]) h = 'beranda';
    state.tab = h;
    $all('.bottomnav a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-tab') === h); });
    clearTimers();
    window.scrollTo(0, 0);
    PAGES[h]();
  }
  window.addEventListener('hashchange', route);

  function refresh() {
    var b = document.getElementById('refreshBtn');
    b.classList.add('spin');
    try { localStorage.removeItem('ahd_info_fresh'); } catch (e) {}
    loadConfig().catch(function () {}).then(function () {
      route();
      setTimeout(function () { b.classList.remove('spin'); }, 600);
    });
  }
  document.getElementById('refreshBtn').addEventListener('click', refresh);

  /* ===== Sesi login user (portal) ===== */
  function getUser() { var c = cacheGet('user'); return c ? c.v : null; }
  function setUser(name) { if (name) cacheSet('user', name); else { try { localStorage.removeItem('ahd_user'); localStorage.removeItem('ahd_acct'); } catch (e) {} } renderUserBar(); }
  function renderUserBar() {
    var u = getUser(), bar = document.getElementById('userBar');
    if (u) { bar.hidden = false; bar.innerHTML = '👤 <b>' + esc(u) + '</b> &nbsp;·&nbsp; terhubung'; }
    else bar.hidden = true;
  }

  function sessionsHTML(list, username, withRate) {
    if (!list || !list.length) return '<div class="muted" style="margin-top:8px">Tidak ada perangkat yang online.</div>';
    return list.map(function (s) {
      var rate = '';
      if (withRate) {
        rate = '<div class="ratebox"><div><span>↓</span><span>' + (s.rate ? fmtBps(s.rate.down) : '–') + '</span></div><div><span>↑</span><span>' + (s.rate ? fmtBps(s.rate.up) : '–') + '</span></div></div>';
      }
      return '<div class="sess"><div class="kv">' +
        '<span>Server</span><span>' + esc(s.server) + '</span>' +
        '<span>IP</span><span>' + esc(s.ip) + '</span>' +
        '<span>MAC Address</span><span>' + esc(s.mac) + '</span>' +
        (withRate ? '<span>Terkoneksi</span><span>' + esc(fmtUptime(s.uptime)) + '</span><span>Perangkat</span><span>' + esc(s.device || '-') + '</span><span>Lalu lintas</span><span>' + fmtBytes(s.bytes_in + s.bytes_out) + '</span>' : '') +
        '</div><div class="side">' + rate +
        '<button class="btn danger sm" data-kick="' + esc(s.id) + '" data-user="' + esc(username) + '">Keluarkan</button></div></div>';
    }).join('');
  }

  function bindKick(root, after) {
    $all('[data-kick]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Keluarkan perangkat ini dari internet?')) return;
        b.disabled = true;
        api('kick', { username: b.getAttribute('data-user'), id: b.getAttribute('data-kick') }).then(function (j) {
          toast(j.message, 'ok'); after && after();
        }, function (e) { b.disabled = false; toast(e.error || 'Gagal', 'err'); });
      });
    });
  }

  /* ===================== BERANDA ===================== */
  function pageBeranda() {
    var c = state.config || {};
    var u = getUser();
    var ann = (c.announcements || []).map(function (a) { return '<div class="ann ' + esc(a.type || 'info') + '">' + esc(a.text) + '</div>'; }).join('');
    var banner = c.banner ? esc(c.banner) : 'assets/banner.svg';
    var footer = (c.footer || []).map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('');

    view.innerHTML =
      '<div class="hero-logo"><img src="assets/logo.svg" alt="Logo"><h1>' + esc(c.site_title || 'DAYAH AL-HUDA MALIKUSSALEH') + '</h1></div>' +
      ann +
      '<div class="server-line">Server Hotspot : <b>' + esc(c.hotspot_name || '-') + '</b> &nbsp;|&nbsp; IP : <b>' + esc(c.client_ip || '-') + '</b></div>' +
      '<img class="banner" src="' + banner + '" alt="Banner" onerror="this.src=\'assets/banner.svg\'">' +
      '<div id="acct"></div>' +
      '<div class="footer">' + footer + '</div>';

    if (u) renderAccount(u); else renderLoginForm();
  }

  function renderLoginForm(prefill) {
    var c = state.config || {};
    var box = $('#acct');
    box.innerHTML =
      '<div class="card"><form id="loginForm" autocomplete="off">' +
      '<label class="lbl" for="uname">Masukkan Username (Username = Password)</label>' +
      '<input id="uname" class="input big" name="username" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="kode voucher" value="' + esc(prefill || '') + '" required>' +
      '<div class="hint">' + esc(c.login_hint || 'Diketik, jangan di-Paste > Klik hubungkan') + '</div>' +
      '<button class="btn primary block" id="loginBtn" type="submit">HUBUNGKAN</button>' +
      '<div id="loginMsg"></div></form>' +
      '<div class="note"><span class="ic">📱</span><span>' + esc(c.mac_note || '') + '</span></div>' +
      '<div class="note"><span class="ic">🔋</span><span>' + esc(c.ups_note || '') + '</span></div></div>';

    $('#loginForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = $('#uname').value.replace(/\s+/g, '');
      if (!name) { toast('Masukkan username terlebih dahulu', 'err'); return; }
      var btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'MENGHUBUNGKAN…';
      api('connect', { username: name }).then(function (j) {
        btn.disabled = false; btn.textContent = 'HUBUNGKAN';
        handleLoginResult(j, name);
      }, function (e) {
        btn.disabled = false; btn.textContent = 'HUBUNGKAN';
        $('#loginMsg').innerHTML = '<div class="alert err"><b>Gagal terhubung</b>' + esc(e.error || 'Terjadi kesalahan') + '</div>';
      });
    });
  }

  function handleLoginResult(j, name) {
    var msg = $('#loginMsg');
    if (j.status === 'notfound') {
      msg.innerHTML = '<div class="alert err"><b>Username tidak tersedia</b>Periksa kembali kode yang Anda ketik.</div>';
      toast('Username tidak tersedia', 'err'); return;
    }
    if (j.status === 'disabled' || j.status === 'expired') {
      msg.innerHTML = '<div class="alert err"><b>Tidak bisa login</b>' + esc(j.message) + '</div>'; return;
    }
    if (j.status === 'overlimit') {
      msg.innerHTML = '<div class="alert warn"><b>Online melebihi batas</b>' + esc(j.message) +
        '<div style="margin-top:10px"><button type="button" class="btn sm" id="seeOnline">Lihat Username Online</button></div><div id="onlineList" hidden></div></div>';
      $('#seeOnline').addEventListener('click', function () {
        var l = $('#onlineList'); l.hidden = !l.hidden;
        l.innerHTML = sessionsHTML(j.sessions, j.user.name, false);
        bindKick(l, function () { msg.innerHTML = '<div class="alert ok">Perangkat sudah dikeluarkan. Silakan tekan HUBUNGKAN lagi.</div>'; });
      });
      return;
    }
    // berhasil
    cacheSet('acct', j);
    var lg = j.login || {};
    if (lg.method === 'form' && lg.url) submitHotspotForm(lg.url, j.user.name);
    setUser(j.user.name);
    toast(lg.method === 'already' ? 'Perangkat ini sudah terhubung' : 'Login berhasil, selamat berinternet!', 'ok');
    renderAccount(j.user.name, j);
  }

  /** Kirim login ke halaman hotspot router (http://d.net/login) jika API tidak bisa login otomatis */
  function submitHotspotForm(url, name) {
    var f = document.createElement('form');
    f.method = 'post'; f.action = url; f.target = 'hsframe';
    [['username', name], ['password', name], ['dst', ''], ['popup', 'false']].forEach(function (p) {
      var i = document.createElement('input'); i.type = 'hidden'; i.name = p[0]; i.value = p[1]; f.appendChild(i);
    });
    document.body.appendChild(f); f.submit(); setTimeout(function () { f.remove(); }, 3000);
  }

  function renderAccount(name, data) {
    var box = $('#acct');
    if (!box) return;
    renderUserBar();
    var draw = function (j, cache) {
      if (!$('#acct')) return;
      if (j.status === 'notfound') { setUser(null); renderLoginForm(); $('#loginMsg').innerHTML = '<div class="alert err"><b>Username tidak tersedia</b>Username "' + esc(name) + '" sudah tidak ada atau telah diubah.</div>'; return; }
      var u = j.user;
      var warn = '';
      if (j.status === 'overlimit') warn = '<div class="alert warn"><b>Online melebihi batas</b>' + esc(j.message) + '</div>';
      if (j.status === 'expired' || j.status === 'disabled') warn = '<div class="alert err">' + esc(j.message) + '</div>';
      $('#acct').innerHTML = (cache ? staleNote(cache) : '') +
        '<div class="card">' + warn +
        '<h3>Akun: ' + esc(u.name) + (u.profile ? ' <span class="tag">' + esc(u.profile) + '</span>' : '') + '</h3>' +
        meter('Penggunaan Data', u.bytes, LIM.userData, fmtBytes(u.bytes), '0', '500 GB') +
        expiryMeter(j.expiry) +
        '<div class="stat"><div><div class="k" style="font-weight:600">User Online dengan username</div><div class="muted">' + esc(u.name) + (u.limit ? ' · batas ' + u.limit + ' perangkat' : '') + '</div></div><div class="bignum">' + u.online + '</div></div>' +
        '<div class="row wrap" style="margin-top:12px"><button class="btn grow" id="seeOnline">Lihat Username Online</button><button class="btn danger grow" id="logoutBtn">Log Out</button></div>' +
        '<div id="onlineList" hidden></div></div>';
      $('#seeOnline').addEventListener('click', function () {
        var l = $('#onlineList'); l.hidden = !l.hidden;
        l.innerHTML = sessionsHTML(j.sessions, u.name, false);
        bindKick(l, function () { renderAccount(name); });
      });
      $('#logoutBtn').addEventListener('click', function () {
        if (!confirm('Log out dari akun ' + u.name + '?')) return;
        api('logout', { username: u.name }).catch(function () {}).then(function () {
          setUser(null); toast('Anda telah log out'); renderLoginForm(u.name);
        });
      });
    };
    if (data) { draw(data); }
    else {
      var c = cacheGet('acct');
      if (c && c.v.user && c.v.user.name === name) draw(c.v, c);
      else box.innerHTML = '<div class="card"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    }
    var fetchNow = function () {
      api('check', { username: name }).then(function (j) { cacheSet('acct', j); draw(j); }, function (e) {
        var c2 = cacheGet('acct');
        if (c2 && c2.v.user && c2.v.user.name === name) draw(c2.v, c2);
        else $('#acct').innerHTML = '<div class="alert err">' + esc(e.error || 'Gagal memuat data akun') + '</div>';
      });
    };
    if (!data) fetchNow();
    every(20000, fetchNow);
  }

  /* ===================== INFORMASI ===================== */
  function pageInformasi() {
    view.innerHTML =
      '<h2 class="title">📊 Penggunaan</h2><div id="infoUse" class="card"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>' +
      '<h2 class="title">🔥 Interface Padat</h2><div id="infoIf" class="card"><div class="skeleton"></div><div class="skeleton"></div></div>' +
      '<h2 class="title">👤 Indikator Username</h2><div class="card"><form id="udForm" class="row"><input id="udName" class="input grow" placeholder="Masukkan username" autocapitalize="off" spellcheck="false" value="' + esc(getUser() || '') + '"><button class="btn primary">Cari</button></form></div><div id="udBox"></div>';

    var draw = function (r) {
      var d = r.data;
      var t = d.traffic || { rx: 0, tx: 0 };
      var tt = t.rx + t.tx;
      var c = state.config || {};
      $('#infoUse').innerHTML = (r.fresh ? '' : staleNote(r.cache)) +
        '<div class="muted">' + esc(c.session_name || '') + (d.identity ? ' · ' + esc(d.identity) : '') + '</div>' +
        meter('Total Data', d.total_bytes, LIM.totalData, fmtGB(d.total_bytes), d.users + ' user', '30.000 GB') +
        meter('Hotspot Aktif', d.active, LIM.active, d.active + ' Online', 'Lalu lintas sesi aktif: ' + fmtBytes(d.active_bytes), '100 Online') +
        meter('Lalu Lintas (' + (t.iface || '-') + ')', tt, LIM.traffic, fmtBps(tt), '↓ ' + fmtBps(t.rx) + ' &nbsp; ↑ ' + fmtBps(t.tx), '200 Mbps') +
        (t.error ? '<div class="alert warn">' + esc(t.error) + ' — ubah di menu Peraturan.</div>' : '');
      var top = d.top || [];
      $('#infoIf').innerHTML = top.length ? top.map(function (i, n) {
        var v = i.rx + i.tx;
        return meter((n + 1) + '. ' + i.name, v, LIM.iface, fmtBps(v), '↓ ' + fmtBps(i.rx) + ' &nbsp; ↑ ' + fmtBps(i.tx), '40 Mbps');
      }).join('') : '<div class="empty">Belum ada data interface.</div>';
    };
    var fetchInfo = function () {
      load('info', 'info').then(draw, function (e) {
        $('#infoUse').innerHTML = '<div class="alert err">' + esc(e.error || 'Gagal memuat') + '</div>';
        $('#infoIf').innerHTML = '';
      });
    };
    var c = cacheGet('info');
    if (c) draw({ data: c.v, fresh: true });
    fetchInfo();
    every(5000, fetchInfo);

    $('#udForm').addEventListener('submit', function (e) { e.preventDefault(); userDetail($('#udName').value.trim()); });
    if (getUser()) userDetail(getUser());
  }

  function userDetail(name, keepTimer) {
    var box = $('#udBox');
    if (!name) { box.innerHTML = ''; return; }
    if (!keepTimer) box.innerHTML = '<div class="card"><div class="skeleton"></div><div class="skeleton"></div></div>';
    load('ud_' + name, 'userdetail', { username: name }).then(function (r) {
      var j = r.data;
      if (!$('#udBox')) return;
      if (j.status === 'notfound') { box.innerHTML = '<div class="alert err"><b>Username tidak tersedia</b>"' + esc(name) + '" tidak ditemukan di MikroTik.</div>'; return; }
      var u = j.user;
      box.innerHTML = (r.fresh ? '' : staleNote(r.cache)) +
        '<div class="card"><h3>Daftar Online — ' + esc(u.name) + ' <span class="tag">' + u.online + (u.limit ? '/' + u.limit : '') + '</span></h3>' +
        (j.status === 'overlimit' ? '<div class="alert warn">' + esc(j.message) + '</div>' : '') +
        sessionsHTML(j.sessions, u.name, true) + '</div>' +
        '<div class="card"><h3>Daftar Cookie</h3>' + cookiesHTML(j.cookies) + '</div>' +
        '<div class="card"><h3>Penggunaan & Masa Berlaku</h3>' +
        meter('Penggunaan Data', u.bytes, LIM.userData, fmtBytes(u.bytes), '0', '500 GB') + expiryMeter(j.expiry) +
        '<button class="btn gold block" id="editUserBtn" style="margin-top:8px">✏️ Edit Username</button><div id="editBox"></div></div>';
      bindKick(box, function () { userDetail(name); });
      $('#editUserBtn').addEventListener('click', function () { renameForm(u.name); });
    }, function (e) { box.innerHTML = '<div class="alert err">' + esc(e.error || 'Gagal memuat') + '</div>'; });
    if (!keepTimer) {
      // perbarui kecepatan per sesi berkala
      state.timers.push(setInterval(function () {
        if (!document.hidden && $('#udBox') && !$('#editForm')) userDetail(name, true);
      }, 8000));
    }
  }

  function cookiesHTML(list) {
    if (!list || !list.length) return '<div class="muted">Tidak ada cookie tersimpan.</div>';
    return list.map(function (c) {
      return '<div class="sess"><div class="kv"><span>Server</span><span>' + esc(c.server) + '</span><span>IP</span><span>' + esc(c.ip) +
        '</span><span>MAC Address</span><span>' + esc(c.mac) + '</span><span>Perangkat</span><span>' + esc(c.device) + '</span><span>Berlaku</span><span>' + esc(fmtUptime(c.expires)) + '</span></div></div>';
    }).join('');
  }

  function renameForm(old) {
    var b = $('#editBox');
    b.innerHTML = '<form id="editForm" style="margin-top:12px">' +
      '<div class="field"><label class="lbl">Username lama</label><input class="input" value="' + esc(old) + '" disabled></div>' +
      '<div class="field"><label class="lbl">Username baru</label><input class="input" id="nn1" autocapitalize="off" spellcheck="false" required></div>' +
      '<div class="field"><label class="lbl">Masukkan lagi username baru</label><input class="input" id="nn2" autocapitalize="off" spellcheck="false" required></div>' +
      '<div class="muted" style="margin-bottom:10px">Password otomatis ikut berubah (username = password). Semua perangkat yang sedang online dengan username lama akan dikeluarkan.</div>' +
      '<div class="row"><button class="btn primary grow">Simpan</button><button type="button" class="btn grow" id="cancelEdit">Batal</button></div></form>';
    $('#cancelEdit').addEventListener('click', function () { b.innerHTML = ''; });
    $('#editForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var n1 = $('#nn1').value.trim(), n2 = $('#nn2').value.trim();
      if (n1 !== n2) { toast('Username baru tidak sama', 'err'); return; }
      if (!confirm('Ubah username "' + old + '" menjadi "' + n1 + '"?')) return;
      api('rename', { username: old, newname: n1, confirm: n2 }).then(function (j) {
        toast('Username berhasil diubah', 'ok');
        if (getUser() === old) setUser(null);
        $('#udName').value = n1;
        b.innerHTML = '<div class="alert ok">' + esc(j.message) + '</div>';
        setTimeout(function () { userDetail(n1); }, 1500);
      }, function (err) { toast(err.error || 'Gagal', 'err'); });
    });
  }

  /* ===================== PAKET ===================== */
  function pagePaket() {
    var list = (state.config && state.config.packages) || [];
    view.innerHTML = '<h2 class="title">📦 Paket & Harga</h2>' + (list.length ? list.map(function (p) {
      return '<div class="card pkg"><div class="ic">📶</div><div class="grow"><div style="font-weight:700;font-size:16px">' + esc(p.name) + '</div>' +
        '<div class="muted">Jumlah perangkat yang bisa terhubung: <b>' + esc(p.devices || '-') + '</b></div>' + (p.note ? '<div class="muted">' + esc(p.note) + '</div>' : '') +
        '</div><div class="price">' + fmtMoney(p.price) + '</div></div>';
    }).join('') : '<div class="card empty">Belum ada paket.<br><small>Admin dapat menambahkan paket di menu Peraturan.</small></div>');
  }

  /* ===================== WIFI ===================== */
  function pageWifi() {
    var list = (state.config && state.config.wifi) || [];
    view.innerHTML = '<h2 class="title">📡 Daftar Wifi Tersedia</h2>' + (list.length ? list.map(function (w, i) {
      var tags = (w.recommended ? '<span class="tag">Disarankan</span>' : '') + (w.band5g ? '<span class="tag g">5G</span>' : '<span class="tag" style="background:#eef0ee;color:#555">2.4G</span>');
      return '<div class="card pkg"><div class="ic">' + (i + 1) + '</div><div class="grow"><div style="font-weight:700;font-size:16px">' + esc(w.name) + '</div>' +
        '<div class="muted">Lokasi : ' + esc(w.location || '-') + '</div><div class="tags">' + tags + '</div></div></div>';
    }).join('') : '<div class="card empty">Belum ada daftar wifi.</div>');
  }

  /* ===================== PERATURAN (ADMIN) ===================== */
  function pagePeraturan() {
    view.innerHTML = '<div class="card"><div class="skeleton"></div></div>';
    api('admin_status').then(function (j) {
      state.admin = j.admin;
      if (j.admin) loadAdmin(); else adminGate();
    }, function (e) {
      view.innerHTML = '<div class="card empty">Menu Peraturan membutuhkan koneksi ke MikroTik.<br><small>' + esc(e.error || '') + '</small></div>';
    });
  }

  function adminGate() {
    view.innerHTML = '<h2 class="title">🔐 Peraturan</h2><div class="card"><p class="muted" style="margin-top:0">Menu ini hanya untuk admin. Masukkan kode aktivasi.</p>' +
      '<form id="gate"><input type="password" class="input big" id="code" placeholder="Kode aktivasi" autocomplete="current-password" required>' +
      '<button class="btn primary block" style="margin-top:12px">MASUK</button><div id="gateMsg"></div></form></div>';
    $('#gate').addEventListener('submit', function (e) {
      e.preventDefault();
      api('admin_login', { code: $('#code').value }).then(function () { toast('Akses admin diberikan', 'ok'); loadAdmin(); }, function (err) {
        $('#gateMsg').innerHTML = '<div class="alert err">' + esc(err.error || 'Kode salah') + '</div>';
      });
    });
  }

  function loadAdmin() {
    api('admin_get').then(function (j) {
      state.adminData = j.settings;
      renderAdmin();
      api('admin_ifaces').then(function (x) { state.ifaces = x.interfaces; renderIfaceSec(); }, function (e) {
        state.ifaces = null; renderIfaceSec(e.error);
      });
    }, function (e) { if (e.error && /ditolak/.test(e.error)) adminGate(); else view.innerHTML = '<div class="alert err">' + esc(e.error) + '</div>'; });
  }

  function inputF(label, key, val, type, ph) {
    return '<div class="field"><label class="lbl">' + esc(label) + '</label><input class="input" data-k="' + key + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" placeholder="' + esc(ph || '') + '"></div>';
  }

  function renderAdmin() {
    var s = state.adminData;
    var unread = (s.notifications || []).filter(function (n) { return !n.read; }).length;
    $('#notifDot').hidden = !unread;
    view.innerHTML =
      '<h2 class="title">⚙️ Peraturan <span class="muted" style="font-weight:400">(admin)</span></h2>' +

      '<details class="sec" ' + (unread ? 'open' : '') + '><summary><span>🔔 Pemberitahuan Admin' + (unread ? '<span class="badge">' + unread + '</span>' : '') + '</span></summary><div class="body" id="notifBody"></div></details>' +

      '<details class="sec"><summary>🖧 Koneksi MikroTik</summary><div class="body"><div class="grid2">' +
      inputF('IP MikroTik', 'router.host', s.router.host) + inputF('Port API', 'router.port', s.router.port, 'number') +
      inputF('Username API', 'router.user', s.router.user) + inputF('Password API', 'router.pass', '', 'password', s.router.has_pass ? '•••• (biarkan kosong jika tidak diubah)' : '') +
      '</div><div class="muted" style="margin-bottom:10px">Koneksi ini hanya tersimpan di HP ini. Pengaturan lain di bawah disimpan di MikroTik dan berlaku untuk semua HP.</div><button class="btn" id="testBtn">Tes Koneksi</button><div id="testMsg"></div></div></details>' +

      '<details class="sec"><summary>🏷️ Umum</summary><div class="body"><div class="grid2">' +
      inputF('Nama Sesi', 'session_name', s.session_name) + inputF('Nama Hotspot', 'hotspot_name', s.hotspot_name) +
      inputF('Mata Uang', 'currency', s.currency) + inputF('Nama DNS', 'dns', s.dns) + '</div>' +
      '<label class="chk"><input type="checkbox" data-k="auto_hotspot_login" ' + (s.auto_hotspot_login ? 'checked' : '') + '> Login hotspot otomatis saat user menekan HUBUNGKAN di portal</label></div></details>' +

      '<details class="sec"><summary>🖼️ Tampilan Beranda</summary><div class="body">' +
      inputF('Header', 'header', s.header) + inputF('Nama Dayah (judul & ikon web)', 'site_title', s.site_title) +
      '<div class="field"><label class="lbl">Banner (jpg / jpeg / png)</label><img class="banner" id="bnPrev" src="' + esc(s.banner || 'assets/banner.svg') + '" style="margin-bottom:8px">' +
      '<div class="row"><input type="file" id="bnFile" accept="image/jpeg,image/png,image/webp,image/gif" class="grow"><button class="btn sm danger" id="bnDel">Pakai bawaan</button></div></div>' +
      inputF('Tulisan petunjuk login', 'login_hint', s.login_hint) +
      '<div class="field"><label class="lbl">Catatan MAC address</label><textarea class="input" data-k="mac_note">' + esc(s.mac_note) + '</textarea></div>' +
      '<div class="field"><label class="lbl">Catatan UPS / listrik</label><textarea class="input" data-k="ups_note">' + esc(s.ups_note) + '</textarea></div>' +
      '<div class="field"><label class="lbl">Teks bawah halaman (satu baris per baris)</label><textarea class="input" data-k="footer">' + esc((s.footer || []).join('\n')) + '</textarea></div>' +
      '</div></details>' +

      '<details class="sec"><summary>📢 Pemberitahuan di Beranda</summary><div class="body"><div id="annList"></div><button class="btn sm" id="annAdd">+ Tambah pemberitahuan</button></div></details>' +

      '<details class="sec"><summary>📈 Lalu Lintas & Interface</summary><div class="body" id="ifSec"><div class="skeleton"></div></div></details>' +

      '<details class="sec"><summary>📦 Paket (harga)</summary><div class="body"><div id="pkgList"></div><button class="btn sm" id="pkgAdd">+ Tambah paket</button></div></details>' +

      '<details class="sec"><summary>📡 Daftar Wifi</summary><div class="body"><div id="wifiList"></div><button class="btn sm" id="wifiAdd">+ Tambah wifi</button></div></details>' +

      '<details class="sec"><summary>🔑 Kode Aktivasi Admin</summary><div class="body"><form id="codeForm">' +
      '<div class="field"><label class="lbl">Kode lama</label><input type="password" class="input" id="c0" required></div>' +
      '<div class="grid2"><div class="field"><label class="lbl">Kode baru</label><input type="password" class="input" id="c1" required></div>' +
      '<div class="field"><label class="lbl">Ulangi kode baru</label><input type="password" class="input" id="c2" required></div></div>' +
      '<button class="btn">Ubah Kode</button></form></div></details>' +

      '<div class="savebar"><button class="btn primary grow" id="saveAll">💾 SIMPAN SEMUA</button><button class="btn" id="adminOut">Keluar</button></div>';

    renderNotif(); renderAnn(); renderPkg(); renderWifi(); renderIfaceSec();

    $('#testBtn').addEventListener('click', function () {
      var m = $('#testMsg'); m.innerHTML = '<div class="muted">Menghubungi MikroTik… (simpan dulu jika IP/password diubah)</div>';
      api('admin_test').then(function (j) {
        m.innerHTML = '<div class="alert ok"><b>Terhubung ✔</b>' + esc(j.identity) + ' · RouterOS ' + esc(j.version) + ' · ' + esc(j.board) + ' · uptime ' + esc(j.uptime) +
          '<br>Server hotspot: ' + esc((j.servers || []).map(function (x) { return x.name + ' (' + x.interface + ')'; }).join(', ') || '-') + '</div>';
      }, function (e) { m.innerHTML = '<div class="alert err"><b>Gagal</b>' + esc(e.error) + '</div>'; });
    });
    $('#bnFile').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      toast('Menyimpan banner ke MikroTik…');
      compressImage(f).then(function (data) { return api('admin_upload', { dataUrl: data }); }).then(function (j) {
        state.adminData.banner = j.banner; $('#bnPrev').src = j.banner; toast('Banner diperbarui', 'ok'); loadConfig().catch(function () {});
      }, function (e) { toast(e.error || 'Gagal unggah', 'err'); });
    });
    $('#bnDel').addEventListener('click', function () { state.adminData.banner = ''; $('#bnPrev').src = 'assets/banner.svg'; toast('Banner bawaan dipakai setelah disimpan'); });
    $('#annAdd').addEventListener('click', function () { collectLists(); s.announcements.push({ text: '', type: 'info', active: true }); renderAnn(); });
    $('#pkgAdd').addEventListener('click', function () { collectLists(); s.packages.push({ name: '', devices: '1', price: '', note: '' }); renderPkg(); });
    $('#wifiAdd').addEventListener('click', function () { collectLists(); s.wifi.push({ name: '', location: '', recommended: false, band5g: false }); renderWifi(); });
    $('#saveAll').addEventListener('click', saveAdmin);
    $('#adminOut').addEventListener('click', function () { api('admin_logout').then(function () { toast('Keluar dari admin'); $('#notifDot').hidden = true; adminGate(); }); });
    $('#codeForm').addEventListener('submit', function (e) {
      e.preventDefault();
      api('admin_code', { old: $('#c0').value, 'new': $('#c1').value, confirm: $('#c2').value }).then(function (j) { toast(j.message, 'ok'); e.target.reset(); }, function (err) { toast(err.error, 'err'); });
    });
  }

  function renderNotif() {
    var s = state.adminData, b = $('#notifBody');
    var list = s.notifications || [];
    b.innerHTML = list.length ? list.map(function (n) {
      return '<div class="notif ' + (n.read ? '' : 'unread') + '">✏️ <b>' + esc(n.time) + '</b> — Username <b>' + esc(n.old) + '</b> diubah menjadi <b>' + esc(n.new) + '</b>' + (n.ip ? ' <span class="muted">(dari ' + esc(n.ip) + ')</span>' : '') + '</div>';
    }).join('') + '<div class="row"><button class="btn sm" id="nRead">Tandai sudah dibaca</button><button class="btn sm danger" id="nClear">Hapus semua</button></div>'
      : '<div class="muted">Belum ada pemberitahuan.</div>';
    if (list.length) {
      $('#nRead').addEventListener('click', function () { api('admin_notif', { op: 'read' }).then(function () { list.forEach(function (n) { n.read = true; }); renderAdmin(); }); });
      $('#nClear').addEventListener('click', function () { if (confirm('Hapus semua pemberitahuan?')) api('admin_notif', { op: 'clear' }).then(function () { s.notifications = []; renderAdmin(); }); });
    }
  }

  function renderAnn() {
    var s = state.adminData;
    $('#annList').innerHTML = (s.announcements || []).map(function (a, i) {
      return '<div class="item" data-ann="' + i + '"><textarea class="input" data-f="text" placeholder="Isi pemberitahuan">' + esc(a.text) + '</textarea>' +
        '<div class="row wrap" style="margin-top:8px"><select class="input" data-f="type" style="width:auto">' +
        [['info', 'Info (biru)'], ['warn', 'Peringatan (kuning)'], ['danger', 'Penting (merah)']].map(function (o) { return '<option value="' + o[0] + '"' + (a.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select><label class="chk"><input type="checkbox" data-f="active" ' + (a.active ? 'checked' : '') + '> Tampilkan</label><span class="grow"></span><button class="btn sm danger" data-del="ann" data-i="' + i + '">Hapus</button></div></div>';
    }).join('') || '<div class="muted" style="margin-bottom:10px">Belum ada pemberitahuan.</div>';
    bindDel('ann', 'announcements', renderAnn);
  }
  function renderPkg() {
    var s = state.adminData;
    $('#pkgList').innerHTML = (s.packages || []).map(function (p, i) {
      return '<div class="item" data-pkg="' + i + '"><div class="grid2">' +
        '<div><label class="lbl">Paket</label><input class="input" data-f="name" value="' + esc(p.name) + '" placeholder="mis. 1 Bulan"></div>' +
        '<div><label class="lbl">Jumlah perangkat</label><input class="input" data-f="devices" value="' + esc(p.devices) + '" placeholder="mis. 2"></div>' +
        '<div><label class="lbl">Harga (' + esc(s.currency) + ')</label><input class="input" data-f="price" inputmode="numeric" value="' + esc(p.price) + '" placeholder="mis. 50000"></div>' +
        '<div><label class="lbl">Keterangan (opsional)</label><input class="input" data-f="note" value="' + esc(p.note || '') + '"></div></div>' +
        '<div class="row" style="margin-top:8px;justify-content:flex-end"><button class="btn sm danger" data-del="pkg" data-i="' + i + '">Hapus</button></div></div>';
    }).join('') || '<div class="muted" style="margin-bottom:10px">Belum ada paket.</div>';
    bindDel('pkg', 'packages', renderPkg);
  }
  function renderWifi() {
    var s = state.adminData;
    $('#wifiList').innerHTML = (s.wifi || []).map(function (w, i) {
      return '<div class="item" data-wifi="' + i + '"><div class="grid2">' +
        '<div><label class="lbl">Nama Wifi (SSID)</label><input class="input" data-f="name" value="' + esc(w.name) + '"></div>' +
        '<div><label class="lbl">Lokasi</label><input class="input" data-f="location" value="' + esc(w.location) + '"></div></div>' +
        '<div class="row wrap" style="margin-top:8px"><label class="chk"><input type="checkbox" data-f="recommended" ' + (w.recommended ? 'checked' : '') + '> Disarankan</label>' +
        '<label class="chk"><input type="checkbox" data-f="band5g" ' + (w.band5g ? 'checked' : '') + '> 5G</label><span class="grow"></span><button class="btn sm danger" data-del="wifi" data-i="' + i + '">Hapus</button></div></div>';
    }).join('') || '<div class="muted" style="margin-bottom:10px">Belum ada wifi.</div>';
    bindDel('wifi', 'wifi', renderWifi);
  }
  function bindDel(kind, key, rerender) {
    $all('[data-del="' + kind + '"]').forEach(function (b) {
      b.addEventListener('click', function () { collectLists(); state.adminData[key].splice(+b.getAttribute('data-i'), 1); rerender(); });
    });
  }

  function renderIfaceSec(err) {
    var box = $('#ifSec'); if (!box) return;
    var s = state.adminData;
    var list = state.ifaces;
    if (!list) {
      box.innerHTML = (err ? '<div class="alert warn">Daftar interface tidak bisa diambil: ' + esc(err) + '</div>' : '<div class="skeleton"></div>') +
        inputF('Antar Muka Lalu Lintas', 'traffic_iface', s.traffic_iface);
      return;
    }
    var names = list.map(function (i) { return i.name; });
    if (names.indexOf(s.traffic_iface) < 0) names.unshift(s.traffic_iface);
    box.innerHTML = '<div class="field"><label class="lbl">Antar Muka Lalu Lintas (indikator 200 Mbps)</label><select class="input" data-k="traffic_iface">' +
      names.map(function (n) { return '<option' + (n === s.traffic_iface ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>' +
      '<label class="lbl">Kecualikan dari "Interface Padat" (boleh lebih dari 1)</label><div class="chips">' +
      list.map(function (i) {
        return '<label><input type="checkbox" data-ex value="' + esc(i.name) + '"' + ((s.excluded_ifaces || []).indexOf(i.name) >= 0 ? ' checked' : '') + '>' + esc(i.name) + (i.running ? '' : ' <span class="muted">(mati)</span>') + '</label>';
      }).join('') + '</div>';
  }

  function collectLists() {
    var s = state.adminData;
    var grab = function (attr) {
      return $all('[data-' + attr + ']').map(function (row) {
        var o = {};
        $all('[data-f]', row).forEach(function (el) { o[el.getAttribute('data-f')] = el.type === 'checkbox' ? el.checked : el.value; });
        return o;
      });
    };
    if ($('#annList')) s.announcements = grab('ann');
    if ($('#pkgList')) s.packages = grab('pkg');
    if ($('#wifiList')) s.wifi = grab('wifi');
  }

  function saveAdmin() {
    collectLists();
    var s = state.adminData;
    var out = { router: {}, announcements: s.announcements, packages: s.packages, wifi: s.wifi, banner: s.banner };
    $all('[data-k]').forEach(function (el) {
      var k = el.getAttribute('data-k'), v = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'footer') v = v.split('\n');
      if (k.indexOf('router.') === 0) out.router[k.slice(7)] = v; else out[k] = v;
    });
    if ($('[data-ex]')) out.excluded_ifaces = $all('[data-ex]').filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    var b = $('#saveAll'); b.disabled = true;
    api('admin_save', { settings: out }).then(function (j) {
      b.disabled = false; toast(j.message, 'ok');
      loadConfig().catch(function () {});
      api('admin_get').then(function (x) { state.adminData = x.settings; });
    }, function (e) { b.disabled = false; toast(e.error || 'Gagal menyimpan', 'err'); });
  }

  var PAGES = { beranda: pageBeranda, informasi: pageInformasi, paket: pagePaket, wifi: pageWifi, peraturan: pagePeraturan };

  /* ===== Mulai ===== */
  // ?u=username dikirim dari halaman alogin.html router setelah login berhasil
  var m = location.search.match(/[?&]u=([^&]+)/);
  if (m) { setUser(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + location.hash); }
  renderUserBar();
  var cc = cacheGet('config');
  if (cc) applyConfig(cc.v.config);
  setOnline(navigator.onLine !== false);
  if (cc) route();
  loadConfig().then(function (r) {
    // render ulang hanya jika belum tampil atau pengaturan berubah
    if (!cc || (r.fresh && r.data.config.updated !== cc.v.config.updated && state.tab !== 'peraturan')) route();
  }, function () { if (!cc) route(); });
  api('admin_status').then(function (j) { $('#notifDot').hidden = !(j.admin && j.unread); }).catch(function () {});

})();
