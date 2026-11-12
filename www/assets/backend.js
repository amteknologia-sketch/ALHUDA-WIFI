/* ALHUDA_D.NET — "server" di dalam aplikasi.
 * Berbicara langsung ke API MikroTik (8728) lewat plugin native RosSocket.
 * Pengaturan bersama (header, paket, wifi, pemberitahuan, kode admin, banner)
 * disimpan DI MIKROTIK (System > Scripts, nama ALHUDA_*), sehingga semua HP
 * yang memakai aplikasi ini melihat data yang sama.
 * Koneksi router (IP/port/user/password) disimpan di HP masing-masing.
 */
(function (root) {
  'use strict';

  var DEF_ROUTER = { host: '10.10.10.1', port: 8728, user: 'zakas', pass: 'zakas', timeout: 6000 };
  function defShared() {
    return {
      session_name: 'ALHUDA_D.NET', hotspot_name: 'ALHUDA_D.NET', currency: 'Rp', dns: 'd.net',
      traffic_iface: 'Internet', excluded_ifaces: [],
      header: 'ALHUDA_D.NET', site_title: 'DAYAH AL-HUDA MALIKUSSALEH',
      banner_ver: 0, announcements: [],
      login_hint: 'Diketik, jangan di-Paste > Klik hubungkan',
      mac_note: 'Sebelum login mohon ubah dulu MAC address ke MAC ponsel/perangkat. Nonaktifkan jika pengguna iPhone.',
      ups_note: 'Modem/router dilengkapi dengan UPS, tetap bisa internetan walaupun listrik padam, bisa bertahan 3-10 jam.',
      footer: ['Property Of DAMAS.Media_Centre Tahun 2026', 'Dayah Al-Huda Malikussaleh', 'Desain Aplikasi : Tgk. Khairuddin Zakas, S.Pd'],
      auto_hotspot_login: true,
      packages: [],
      wifi: [
        { name: 'ALHUDA_D.NET', location: 'Bilek 9, Bilek 10, Bilek 11', recommended: true, band5g: false },
        { name: 'ALHUDA_D.NET', location: 'Bilek 1, Bilek 2', recommended: true, band5g: true },
        { name: 'Bilek 1', location: 'Bilek 1', recommended: true, band5g: true }
      ],
      admin_hash: ''
    };
  }

  /* ---------- MD5 (byte string) untuk login RouterOS lama ---------- */
  function hexMD5(s) {
    function add(x, y) { var l = (x & 0xFFFF) + (y & 0xFFFF); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xFFFF); }
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    var K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21], x = [], i, j, n = s.length;
    for (i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    for (i = 0; i < n * 8; i += 8) x[i >> 5] |= (s.charCodeAt(i / 8) & 255) << (i % 32);
    x[(n * 8) >> 5] |= 0x80 << ((n * 8) % 32);
    x[(((n * 8 + 64) >>> 9) << 4) + 14] = n * 8;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (i = 0; i < x.length; i += 16) {
      var A = a, B = b, C = c, D = d;
      for (j = 0; j < 64; j++) {
        var f, g, r = j >> 4;
        if (r === 0) { f = (B & C) | (~B & D); g = j; } else if (r === 1) { f = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
        else if (r === 2) { f = B ^ C ^ D; g = (3 * j + 5) % 16; } else { f = C ^ (B | ~D); g = (7 * j) % 16; }
        var t = D; D = C; C = B; B = add(B, rol(add(add(A, f), add(K[j], x[i + g] | 0)), S[(r << 2) | (j & 3)])); A = t;
      }
      a = add(a, A); b = add(b, B); c = add(c, C); d = add(d, D);
    }
    var hex = '', w = [a, b, c, d];
    for (i = 0; i < 16; i++) hex += ('0' + ((w[i >> 2] >>> ((i % 4) * 8)) & 255).toString(16)).slice(-2);
    return hex;
  }
  function hashCode(code) {
    var msg = 'alhuda-dnet:' + code;
    var subtle = root.crypto && root.crypto.subtle;
    if (subtle && root.TextEncoder) {
      return subtle.digest('SHA-256', new TextEncoder().encode(msg)).then(function (buf) {
        return 'sha256:' + Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      });
    }
    return Promise.resolve('md5:' + hexMD5(unescape(encodeURIComponent(msg))));
  }
  function checkCode(code, stored) {
    if (!stored) return Promise.resolve(code === 'Zakas11');
    if (stored.indexOf('md5:') === 0) return Promise.resolve(stored === 'md5:' + hexMD5(unescape(encodeURIComponent('alhuda-dnet:' + code))));
    return hashCode(code).then(function (h) { return h === stored; });
  }

  /* ---------- Klien RouterOS ---------- */
  function RouterDown(msg) { this.ok = false; this.error = msg; this.offline_router = true; this.network = true; }
  function Trap(msg) { this.ok = false; this.error = 'MikroTik: ' + msg; this.trap = msg; }

  function RosClient(transport, cfgFn) {
    this.tr = transport; this.cfgFn = cfgFn; this.id = null; this.chain = Promise.resolve();
  }
  RosClient.prototype._raw = function (words) {
    var self = this;
    return self.tr.talk({ id: self.id, words: words }).then(function (r) {
      var rows = [], done = {}, trap = '';
      (r.sentences || []).forEach(function (s) {
        var type = s[0], at = {};
        for (var i = 1; i < s.length; i++) {
          var w = s[i];
          if (w.charAt(0) === '=') { var p = w.indexOf('=', 1); if (p < 0) at[w.slice(1)] = ''; else at[w.slice(1, p)] = w.slice(p + 1); }
        }
        if (type === '!re') rows.push(at);
        else if (type === '!trap') trap = at.message || 'Perintah gagal';
        else if (type === '!fatal') { self.id = null; trap = 'MikroTik memutus koneksi'; }
        else if (type === '!done') done = at;
      });
      return { rows: rows, done: done, trap: trap };
    }, function (e) { self.id = null; throw new RouterDown(e && e.message ? e.message : String(e)); });
  };
  RosClient.prototype._open = function () {
    var self = this, c = self.cfgFn();
    return self.tr.connect({ host: c.host, port: +c.port || 8728, timeout: +c.timeout || 6000 }).then(function (r) {
      self.id = r.id;
      return self._raw(['/login', '=name=' + c.user, '=password=' + c.pass]);
    }, function (e) { throw new RouterDown(e && e.message ? e.message : 'Tidak dapat terhubung ke MikroTik ' + c.host); })
      .then(function (r) {
        if (r.done.ret) { // RouterOS < 6.43
          var chal = '', h = r.done.ret;
          for (var i = 0; i < h.length; i += 2) chal += String.fromCharCode(parseInt(h.substr(i, 2), 16));
          return self._raw(['/login', '=name=' + c.user, '=response=00' + hexMD5('\x00' + c.pass + chal)]);
        }
        return r;
      }).then(function (r) {
        if (r.trap) { self.close(); throw new RouterDown('Login API ditolak: ' + r.trap); }
      });
  };
  RosClient.prototype.close = function () {
    if (this.id != null) { try { this.tr.close({ id: this.id }); } catch (e) {} }
    this.id = null;
  };
  /** Kirim perintah berurutan (satu soket, satu antrean) */
  RosClient.prototype.talk = function (cmd, args, query) {
    var self = this;
    var words = [cmd];
    Object.keys(args || {}).forEach(function (k) { var v = args[k]; words.push('=' + k + '=' + (v === true ? '' : v)); });
    (query || []).forEach(function (q) { words.push('?' + q); });
    var job = self.chain.then(function () {
      return (self.id == null ? self._open() : Promise.resolve()).then(function () { return self._raw(words); });
    });
    self.chain = job.catch(function () {});
    return job;
  };
  RosClient.prototype.q = function (cmd, args, query) {
    return this.talk(cmd, args, query).then(function (r) { if (r.trap) throw new Trap(r.trap); return r.rows; });
  };
  RosClient.prototype.exec = function (cmd, args, query) {
    return this.talk(cmd, args, query).then(function (r) { if (r.trap) throw new Trap(r.trap); return r.done; });
  };

  /* ---------- Waktu RouterOS ---------- */
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function rosTs(date, time) {
    date = String(date || '').trim().toLowerCase(); var y, m, d, x;
    if ((x = date.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/))) { m = MON[x[1]]; d = +x[2]; y = +x[3]; }
    else if ((x = date.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
    else return null;
    if (!m) return null;
    var t = String(time || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/) || [0, 0, 0, 0];
    return Date.UTC(y, m - 1, d, +t[1], +t[2], +(t[3] || 0)) / 1000;
  }
  function findDateTime(text) {
    var x = String(text || '').match(/([a-z]{3}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}:\d{2})/i);
    return x ? rosTs(x[1], x[2]) : null;
  }
  function rosDuration(v) {
    v = String(v || '').trim().toLowerCase(); if (!v) return 0;
    var sec = 0, t = v.match(/(\d{1,2}):(\d{2}):(\d{2})$/);
    if (t) { sec += t[1] * 3600 + t[2] * 60 + +t[3]; v = v.slice(0, -t[0].length); }
    var mul = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 }, re = /(\d+)\s*([wdhms])/g, p;
    while ((p = re.exec(v))) sec += p[1] * mul[p[2]];
    return sec;
  }
  function fmtTs(ts) {
    var d = new Date(ts * 1000); function z(n) { return ('0' + n).slice(-2); }
    return z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes());
  }
  function profileValidity(p) {
    if (!p || !p['on-login']) return 0;
    var x = p['on-login'].match(/\(\s*"([^"]*)"\s*\)/);
    if (!x) return 0;
    var parts = x[1].split(',');
    return parts[3] ? rosDuration(parts[3]) : 0;
  }
  function validIp(ip) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || '')); }

  /* ---------- Backend ---------- */
  function Backend(transport, store) {
    var self = this;
    self.store = store;
    self.router = Object.assign({}, DEF_ROUTER, store.get('router') || {});
    self.ros = new RosClient(transport, function () { return self.router; });
    self.tr = transport;
    self.shared = Object.assign(defShared(), (store.get('shared') || {}));
    self.bannerData = store.get('banner') || '';
    self.admin = false;
    self.myIp = '';
    self.sharedLoadedAt = 0;
    if (transport.localIp) transport.localIp().then(function (r) { self.myIp = r.ip || ''; }, function () {});
  }

  /* --- Penyimpanan bersama di /system/script (dipecah per 3000 karakter) --- */
  var CHUNK = 3000;
  Backend.prototype.loadBlob = function (name) {
    var ros = this.ros, parts = [];
    function next(i) {
      return ros.q('/system/script/print', { '.proplist': 'name,source' }, ['name=' + name + '_' + i]).then(function (r) {
        if (!r.length) return parts.length ? parts.join('') : null;
        parts.push(r[0].source || '');
        return i < 99 ? next(i + 1) : parts.join('');
      });
    }
    return next(0);
  };
  Backend.prototype.saveBlob = function (name, text) {
    var ros = this.ros, chunks = [];
    for (var i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
    if (!chunks.length) chunks.push('');
    function put(i) {
      if (i >= chunks.length) return trim(i);
      var nm = name + '_' + i;
      return ros.q('/system/script/print', { '.proplist': '.id,name' }, ['name=' + nm]).then(function (r) {
        if (r.length) return ros.exec('/system/script/set', { '.id': r[0]['.id'], source: chunks[i] });
        return ros.exec('/system/script/add', { name: nm, source: chunks[i], comment: 'Data aplikasi ALHUDA_D.NET - jangan dihapus' });
      }).then(function () { return put(i + 1); });
    }
    function trim(i) {
      return ros.q('/system/script/print', { '.proplist': '.id,name' }, ['name=' + name + '_' + i]).then(function (r) {
        if (!r.length) return true;
        return ros.exec('/system/script/remove', { '.id': r[0]['.id'] }).then(function () { return trim(i + 1); });
      });
    }
    return put(0);
  };
  Backend.prototype.removeBlob = function (name) {
    var ros = this.ros;
    function rm(i) {
      return ros.q('/system/script/print', { '.proplist': '.id,name' }, ['name=' + name + '_' + i]).then(function (r) {
        if (!r.length) return true;
        return ros.exec('/system/script/remove', { '.id': r[0]['.id'] }).then(function () { return rm(i + 1); });
      });
    }
    return rm(0);
  };

  Backend.prototype.syncShared = function (force) {
    var self = this;
    if (!force && Date.now() - self.sharedLoadedAt < 30000) return Promise.resolve(self.shared);
    return self.loadBlob('ALHUDA_CFG').then(function (txt) {
      var s = null;
      if (txt) { try { s = JSON.parse(txt); } catch (e) { s = null; } }
      self.shared = Object.assign(defShared(), s || {});
      self.store.set('shared', self.shared);
      self.sharedLoadedAt = Date.now();
      if ((self.shared.banner_ver || 0) !== (self.store.get('banner_ver') || 0)) {
        if (!self.shared.banner_ver) { self.bannerData = ''; self.store.set('banner', ''); self.store.set('banner_ver', 0); return self.shared; }
        return self.loadBlob('ALHUDA_BANNER').then(function (b) {
          self.bannerData = b || ''; self.store.set('banner', self.bannerData); self.store.set('banner_ver', self.shared.banner_ver);
          return self.shared;
        });
      }
      return self.shared;
    });
  };
  Backend.prototype.saveShared = function () {
    var self = this;
    return self.saveBlob('ALHUDA_CFG', JSON.stringify(self.shared)).then(function () {
      self.store.set('shared', self.shared); self.sharedLoadedAt = Date.now();
    });
  };
  Backend.prototype.loadNotif = function () {
    return this.loadBlob('ALHUDA_NOTIF').then(function (t) { try { return JSON.parse(t) || []; } catch (e) { return []; } });
  };
  Backend.prototype.saveNotif = function (list) { return this.saveBlob('ALHUDA_NOTIF', JSON.stringify(list.slice(0, 100))); };

  /* --- Data akun --- */
  Backend.prototype.findUser = function (name) {
    return this.ros.q('/ip/hotspot/user/print', {}, ['name=' + name]).then(function (r) { return r[0] || null; });
  };
  function sessRow(a) {
    return { id: a['.id'] || '', server: a.server || '-', ip: a.address || '-', mac: a['mac-address'] || '-', uptime: a.uptime || '-',
      bytes_in: +(a['bytes-in'] || 0), bytes_out: +(a['bytes-out'] || 0) };
  }
  Backend.prototype.routerNow = function () {
    return this.ros.q('/system/clock/print').then(function (c) {
      return (c[0] && rosTs(c[0].date, c[0].time)) || Math.floor(Date.now() / 1000);
    });
  };
  Backend.prototype.expiry = function (u, profile, now) {
    return this.ros.q('/system/scheduler/print', {}, ['name=' + u.name]).catch(function () { return []; }).then(function (sch) {
      var start = null, end = null, src = '';
      if (sch.length) {
        var s = sch[0];
        start = rosTs(s['start-date'], s['start-time']);
        if (s['next-run']) { var p = s['next-run'].trim().split(/\s+/); end = rosTs(p[0], p[1]); }
        if (start && !end && s.interval) end = start + rosDuration(s.interval);
        src = 'scheduler';
      }
      if (!end) { end = findDateTime(u.comment); if (end) src = 'comment'; }
      if (end && !start) { var v = profileValidity(profile); if (v > 0) start = end - v; }
      if (!end) return null;
      var pct = null;
      if (start && end > start) pct = Math.max(0, Math.min(100, (now - start) / (end - start) * 100));
      else if (now >= end) pct = 100;
      return { start: start ? fmtTs(start) : null, end: fmtTs(end), pct: pct == null ? null : Math.round(pct * 10) / 10,
        remaining: Math.max(0, end - now), expired: now >= end, source: src };
    });
  };
  Backend.prototype.summary = function (name, ip) {
    var self = this, ros = self.ros;
    return self.findUser(name).then(function (u) {
      if (!u) return { ok: true, status: 'notfound', message: 'Username tidak tersedia.' };
      var profile, sessions, now;
      return ros.q('/ip/hotspot/user/profile/print', {}, ['name=' + (u.profile || 'default')]).then(function (p) {
        profile = p[0] || null;
        return ros.q('/ip/hotspot/active/print', {}, ['user=' + u.name]);
      }).then(function (act) {
        sessions = act.map(sessRow);
        return self.routerNow();
      }).then(function (n) { now = n; return self.expiry(u, profile, now); }).then(function (exp) {
        var lim = profile && /^\d+$/.test(profile['shared-users'] || '') ? +profile['shared-users'] : (profile ? 0 : 1);
        var mine = !!ip && sessions.some(function (s) { return s.ip === ip; });
        var bytes = +(u['bytes-in'] || 0) + +(u['bytes-out'] || 0);
        sessions.forEach(function (s) { bytes += s.bytes_in + s.bytes_out; });
        var status = 'ok', msg = '';
        if (u.disabled === 'true') { status = 'disabled'; msg = 'Username ini sedang dinonaktifkan. Hubungi admin.'; }
        else if (exp && exp.expired) { status = 'expired'; msg = 'Masa berlaku username ini sudah habis.'; }
        else if (lim > 0 && sessions.length >= lim && !mine) {
          status = 'overlimit';
          msg = 'Username benar, tetapi sedang online melebihi batas (' + sessions.length + '/' + lim + '). Kemungkinan dipakai perangkat lain.';
        }
        return { ok: true, status: status, message: msg,
          user: { name: u.name, profile: u.profile || '', comment: u.comment || '', limit: lim, online: sessions.length, bytes: bytes, mine: mine },
          expiry: exp, sessions: sessions };
      });
    });
  };

  Backend.prototype.publicConfig = function () {
    var s = this.shared, c = {};
    ['session_name', 'hotspot_name', 'currency', 'dns', 'header', 'site_title', 'login_hint', 'mac_note', 'ups_note', 'footer', 'packages', 'wifi', 'auto_hotspot_login', 'banner_ver']
      .forEach(function (k) { c[k] = s[k]; });
    c.announcements = (s.announcements || []).filter(function (a) { return a.active && String(a.text).trim(); });
    c.banner = this.bannerData || '';
    c.client_ip = this.myIp || '-';
    c.updated = JSON.stringify([s, c.banner.length]).length + ':' + (s.banner_ver || 0);
    return c;
  };

  function need(v, msg) { if (!v) throw { ok: false, error: msg }; }
  function requireAdmin(self) { if (!self.admin) throw { ok: false, error: 'Akses ditolak. Masukkan kode aktivasi admin.' }; }

  /* --- Pintu masuk: sama dengan nama aksi api.php versi web --- */
  Backend.prototype.call = function (action, body) {
    var self = this;
    body = body || {};
    return Promise.resolve().then(function () { return self['a_' + action] ? self['a_' + action](body) : Promise.reject({ ok: false, error: 'Aksi tidak dikenal' }); })
      .then(function (r) { return r; }, function (e) {
        if (e instanceof RouterDown || e instanceof Trap) throw Object.assign({}, e);
        if (e && e.error) throw e;
        throw { ok: false, error: (e && e.message) || String(e) };
      });
  };

  var B = Backend.prototype;
  B.a_config = function () {
    var self = this;
    return self.syncShared().then(function () { return { ok: true, config: self.publicConfig() }; });
  };
  B.a_check = function (b) {
    var n = String(b.username || '').trim(); need(n, 'Masukkan username terlebih dahulu.');
    return this.summary(n, validIp(b.ip) ? b.ip : this.myIp);
  };
  B.a_connect = function (b) {
    var self = this, n = String(b.username || '').trim(); need(n, 'Masukkan username terlebih dahulu.');
    var ip = self.myIp;
    return self.summary(n, ip).then(function (r) {
      if (r.status !== 'ok') return r;
      r.login = { method: 'none' };
      if (r.user.mine) { r.login = { method: 'already' }; return r; }
      if (!self.shared.auto_hotspot_login) return r;
      if (!ip) { r.login = { method: 'form', url: 'http://' + self.shared.dns + '/login' }; return r; }
      return self.ros.q('/ip/hotspot/host/print', {}, ['address=' + ip]).then(function (h) {
        if (!h.length || !h[0]['mac-address']) { r.login = { method: 'form', url: 'http://' + self.shared.dns + '/login' }; return r; }
        return self.ros.exec('/ip/hotspot/active/login', { user: r.user.name, password: r.user.name, 'mac-address': h[0]['mac-address'], ip: ip })
          .then(function () { r.login = { method: 'api' }; return r; },
            function (e) { r.login = { method: 'form', url: 'http://' + self.shared.dns + '/login', note: e.error }; return r; });
      });
    });
  };
  B.a_kick = function (b) {
    var self = this, ros = self.ros; need(b.id, 'ID sesi kosong.');
    var a;
    return ros.q('/ip/hotspot/active/print', {}, ['.id=' + b.id]).then(function (r) {
      if (!r.length) throw { ok: false, error: 'Sesi sudah tidak aktif.' };
      a = r[0];
      if (!self.admin && a.user !== b.username) throw { ok: false, error: 'Sesi ini bukan milik username tersebut.' };
      return ros.exec('/ip/hotspot/active/remove', { '.id': b.id });
    }).then(function () {
      if (!a['mac-address']) return [];
      return ros.q('/ip/hotspot/cookie/print', {}, ['mac-address=' + a['mac-address']]);
    }).then(function (cs) {
      return cs.reduce(function (p, c) { return p.then(function () { return ros.exec('/ip/hotspot/cookie/remove', { '.id': c['.id'] }).catch(function () {}); }); }, Promise.resolve());
    }).then(function () { return { ok: true, message: 'Perangkat ' + (a['mac-address'] || '') + ' berhasil dikeluarkan.' }; });
  };
  B.a_logout = function (b) {
    var ros = this.ros, ip = validIp(b.ip) ? b.ip : this.myIp, n = 0;
    return ros.q('/ip/hotspot/active/print', {}, ['user=' + b.username]).then(function (act) {
      return act.filter(function (a) { return ip && a.address === ip; }).reduce(function (p, a) {
        return p.then(function () { n++; return ros.exec('/ip/hotspot/active/remove', { '.id': a['.id'] }); });
      }, Promise.resolve());
    }).then(function () { return { ok: true, removed: n }; });
  };
  B.a_info = function () {
    var self = this, ros = self.ros, s = self.shared, res = { ok: true };
    return self.syncShared().then(function () {
      return ros.q('/ip/hotspot/user/print', { '.proplist': 'name,bytes-in,bytes-out' });
    }).then(function (users) {
      res.users = users.length;
      res.total_bytes = users.reduce(function (t, u) { return t + +(u['bytes-in'] || 0) + +(u['bytes-out'] || 0); }, 0);
      return ros.q('/ip/hotspot/active/print', { '.proplist': 'user,bytes-in,bytes-out' });
    }).then(function (act) {
      res.active = act.length;
      res.active_bytes = act.reduce(function (t, a) { return t + +(a['bytes-in'] || 0) + +(a['bytes-out'] || 0); }, 0);
      res.total_bytes += res.active_bytes;
      s = self.shared;
      res.traffic = { iface: s.traffic_iface, rx: 0, tx: 0, error: '' };
      return ros.q('/interface/monitor-traffic', { 'interface': s.traffic_iface, once: true }).then(function (m) {
        if (m[0]) { res.traffic.rx = +m[0]['rx-bits-per-second']; res.traffic.tx = +m[0]['tx-bits-per-second']; }
      }, function () { res.traffic.error = 'Interface "' + s.traffic_iface + '" tidak ditemukan'; });
    }).then(function () {
      return ros.q('/interface/print', { '.proplist': 'name,type,running,disabled' });
    }).then(function (ifs) {
      var names = ifs.filter(function (i) { return i.running !== 'false' && i.disabled !== 'true' && (s.excluded_ifaces || []).indexOf(i.name) < 0; })
        .map(function (i) { return i.name; });
      var top = [], chunks = [];
      for (var k = 0; k < names.length; k += 40) chunks.push(names.slice(k, k + 40));
      return chunks.reduce(function (p, ch) {
        return p.then(function () {
          return ros.q('/interface/monitor-traffic', { 'interface': ch.join(','), once: true }).then(function (m) {
            m.forEach(function (x) { top.push({ name: x.name, rx: +x['rx-bits-per-second'], tx: +x['tx-bits-per-second'] }); });
          }, function () {});
        });
      }, Promise.resolve()).then(function () {
        top.sort(function (a, b) { return (b.rx + b.tx) - (a.rx + a.tx); });
        res.top = top.slice(0, 5);
      });
    }).then(function () { return ros.q('/system/identity/print'); }).then(function (id) {
      res.identity = id[0] ? id[0].name : '';
      res.time = new Date().toISOString();
      return res;
    });
  };
  B.a_userdetail = function (b) {
    var self = this, ros = self.ros, n = String(b.username || '').trim(); need(n, 'Masukkan username.');
    var r, leases = {}, rates = {}, hosts = {};
    return self.summary(n, self.myIp).then(function (x) {
      r = x; if (r.status === 'notfound') return null;
      // pemantauan: dianggap melebihi batas hanya jika jumlah online > batas
      if (r.status === 'overlimit' && r.user.online <= r.user.limit) { r.status = 'ok'; r.message = ''; }
      return ros.q('/ip/dhcp-server/lease/print', { '.proplist': 'mac-address,host-name' }).catch(function () { return []; }).then(function (ls) {
        ls.forEach(function (l) { if (l['mac-address']) leases[l['mac-address'].toUpperCase()] = l['host-name'] || ''; });
        return ros.q('/queue/simple/print', { '.proplist': 'name,target,rate' }).catch(function () { return []; });
      }).then(function (qs) {
        qs.forEach(function (q) {
          if (!q.target || !q.rate) return;
          var ipq = q.target.split(',')[0].split('/')[0], p = q.rate.split('/');
          rates[ipq] = { up: +p[0], down: +(p[1] || 0) };
        });
        // kecepatan: dari antrean hotspot; jika tidak ada, dihitung dari selisih byte sesi aktif
        var nowMs = Date.now(); self.prevSess = self.prevSess || {};
        r.sessions.forEach(function (s) {
          var prev = self.prevSess[s.id], rate = rates[s.ip] || null;
          if (!rate && prev && nowMs - prev.t > 500) {
            var dt = (nowMs - prev.t) / 1000;
            rate = { down: Math.max(0, (s.bytes_out - prev.out) * 8 / dt), up: Math.max(0, (s.bytes_in - prev.inb) * 8 / dt), calc: true };
          }
          self.prevSess[s.id] = { t: nowMs, inb: s.bytes_in, out: s.bytes_out };
          s.device = leases[s.mac.toUpperCase()] || '-';
          s.rate = rate;
        });
        return ros.q('/ip/hotspot/host/print', { '.proplist': 'mac-address,address,server' }).catch(function () { return []; });
      }).then(function (hs) {
        hs.forEach(function (h) { hosts[(h['mac-address'] || '').toUpperCase()] = h; });
        return ros.q('/ip/hotspot/cookie/print', {}, ['user=' + r.user.name]);
      }).then(function (cs) {
        r.cookies = cs.map(function (c) {
          var mac = (c['mac-address'] || '').toUpperCase(), h = hosts[mac] || {};
          return { server: h.server || c.domain || '-', ip: h.address || '-', mac: c['mac-address'] || '-', device: leases[mac] || '-', expires: c['expires-in'] || '-' };
        });
      });
    }).then(function () { return r; });
  };
  B.a_rename = function (b) {
    var self = this, ros = self.ros;
    var old = String(b.username || '').trim(), nw = String(b.newname || '').trim(), conf = String(b.confirm || '').trim();
    need(old && nw, 'Username lama dan baru wajib diisi.');
    need(nw === conf, 'Username baru dan ulangan tidak sama.');
    need(/^[A-Za-z0-9._@\-]{1,64}$/.test(nw), 'Username baru hanya boleh huruf, angka, titik, garis bawah, @ dan tanda minus.');
    need(nw !== old, 'Username baru sama dengan yang lama.');
    var u;
    return self.findUser(old).then(function (x) {
      u = x; if (!u) throw { ok: false, error: 'Username tidak tersedia.' };
      return self.findUser(nw);
    }).then(function (exists) {
      if (exists) throw { ok: false, error: 'Username "' + nw + '" sudah dipakai. Pilih yang lain.' };
      var set = { '.id': u['.id'], name: nw };
      if (u.password === undefined || u.password === old) set.password = nw;
      return ros.exec('/ip/hotspot/user/set', set);
    }).then(function () { return ros.q('/system/scheduler/print', {}, ['name=' + old]); })
      .then(function (sc) { return sc.reduce(function (p, x) { return p.then(function () { return ros.exec('/system/scheduler/set', { '.id': x['.id'], name: nw }); }); }, Promise.resolve()); })
      .then(function () { return ros.q('/ip/hotspot/cookie/print', {}, ['user=' + old]); })
      .then(function (cs) { return cs.reduce(function (p, c) { return p.then(function () { return ros.exec('/ip/hotspot/cookie/remove', { '.id': c['.id'] }).catch(function () {}); }); }, Promise.resolve()); })
      .then(function () { return ros.q('/ip/hotspot/active/print', {}, ['user=' + old]); })
      .then(function (as) { return as.reduce(function (p, a) { return p.then(function () { return ros.exec('/ip/hotspot/active/remove', { '.id': a['.id'] }).catch(function () {}); }); }, Promise.resolve()); })
      .then(function () { return self.loadNotif(); })
      .then(function (list) {
        var d = new Date(); function z(n) { return ('0' + n).slice(-2); }
        list.unshift({ time: z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()),
          type: 'rename', old: old, 'new': nw, ip: self.myIp, read: false });
        return self.saveNotif(list).catch(function () {});
      })
      .then(function () { return { ok: true, message: 'Username berhasil diubah dari "' + old + '" menjadi "' + nw + '". Silakan login ulang dengan username baru.' }; });
  };

  /* --- Admin --- */
  B.a_admin_status = function () {
    var self = this;
    if (!self.admin) return { ok: true, admin: false, unread: 0 };
    return self.loadNotif().then(function (l) { return { ok: true, admin: true, unread: l.filter(function (n) { return !n.read; }).length }; },
      function () { return { ok: true, admin: true, unread: 0 }; });
  };
  B.a_admin_login = function (b) {
    var self = this;
    // ambil kode admin terbaru dari router; jika router tak terjangkau pakai salinan terakhir
    return self.syncShared(true).catch(function () {}).then(function () { return checkCode(String(b.code || ''), self.shared.admin_hash); })
      .then(function (ok) {
        if (!ok) throw { ok: false, error: 'Kode aktivasi salah.' };
        self.admin = true; return { ok: true };
      });
  };
  B.a_admin_logout = function () { this.admin = false; return { ok: true }; };
  B.a_admin_get = function () {
    requireAdmin(this);
    var self = this;
    return self.syncShared(true).catch(function () {}).then(function () { return self.loadNotif().catch(function () { return []; }); }).then(function (n) {
      var c = JSON.parse(JSON.stringify(self.shared)); delete c.admin_hash;
      c.router = { host: self.router.host, port: self.router.port, user: self.router.user, pass: '', has_pass: !!self.router.pass };
      c.notifications = n;
      c.banner = self.bannerData || '';
      return { ok: true, settings: c };
    });
  };
  B.a_admin_save = function (b) {
    requireAdmin(this);
    var self = this, inn = b.settings || {}, s = self.shared;
    // koneksi router: hanya di HP ini
    if (inn.router) {
      var r = inn.router;
      if (r.host) self.router.host = String(r.host).trim();
      if (r.port) self.router.port = parseInt(r.port, 10) || 8728;
      if (r.user) self.router.user = String(r.user).trim();
      if (r.pass) self.router.pass = r.pass;
      self.store.set('router', self.router);
      self.ros.close();
    }
    ['session_name', 'hotspot_name', 'currency', 'dns', 'traffic_iface', 'header', 'site_title', 'login_hint', 'mac_note', 'ups_note']
      .forEach(function (k) { if (inn[k] !== undefined) s[k] = String(inn[k]).trim(); });
    if (inn.auto_hotspot_login !== undefined) s.auto_hotspot_login = !!inn.auto_hotspot_login;
    if (inn.excluded_ifaces) s.excluded_ifaces = inn.excluded_ifaces.map(String);
    if (inn.footer) s.footer = inn.footer.map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (inn.announcements) s.announcements = inn.announcements.filter(function (a) { return String(a.text || '').trim(); })
      .map(function (a) { return { text: String(a.text).trim(), active: !!a.active, type: ['info', 'warn', 'danger'].indexOf(a.type) >= 0 ? a.type : 'info' }; });
    if (inn.packages) s.packages = inn.packages.filter(function (p) { return String(p.name || '').trim(); })
      .map(function (p) { return { name: String(p.name).trim(), devices: String(p.devices || '').trim(), price: String(p.price || '').replace(/[^0-9]/g, ''), note: String(p.note || '').trim() }; });
    if (inn.wifi) s.wifi = inn.wifi.filter(function (w) { return String(w.name || '').trim(); })
      .map(function (w) { return { name: String(w.name).trim(), location: String(w.location || '').trim(), recommended: !!w.recommended, band5g: !!w.band5g }; });
    var p = Promise.resolve();
    if (inn.banner === '' && s.banner_ver) {
      s.banner_ver = 0; self.bannerData = ''; self.store.set('banner', ''); self.store.set('banner_ver', 0);
      p = self.removeBlob('ALHUDA_BANNER');
    }
    return p.then(function () {
      if (!s.admin_hash) return hashCode('Zakas11').then(function (h) { s.admin_hash = h; });
    }).then(function () { return self.saveShared(); }).then(function () { return { ok: true, message: 'Pengaturan tersimpan (di MikroTik).' }; });
  };
  B.a_admin_code = function (b) {
    requireAdmin(this);
    var self = this;
    return checkCode(String(b.old || ''), self.shared.admin_hash).then(function (ok) {
      if (!ok) throw { ok: false, error: 'Kode lama salah.' };
      if (String(b['new'] || '').length < 4) throw { ok: false, error: 'Kode baru minimal 4 karakter.' };
      if (b['new'] !== b.confirm) throw { ok: false, error: 'Ulangi kode baru tidak sama.' };
      return hashCode(b['new']);
    }).then(function (h) { self.shared.admin_hash = h; return self.saveShared(); })
      .then(function () { return { ok: true, message: 'Kode aktivasi admin berhasil diubah (berlaku di semua HP).' }; });
  };
  B.a_admin_upload = function (b) {
    requireAdmin(this);
    var self = this, data = String(b.dataUrl || '');
    if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(data)) throw { ok: false, error: 'File harus gambar JPG, JPEG atau PNG.' };
    if (data.length > 300000) throw { ok: false, error: 'Gambar terlalu besar setelah dikompres.' };
    return self.saveBlob('ALHUDA_BANNER', data).then(function () {
      self.shared.banner_ver = Date.now();
      self.bannerData = data; self.store.set('banner', data); self.store.set('banner_ver', self.shared.banner_ver);
      return self.saveShared();
    }).then(function () { return { ok: true, banner: data }; });
  };
  B.a_admin_ifaces = function () {
    requireAdmin(this);
    return this.ros.q('/interface/print', { '.proplist': 'name,type,running' }).then(function (l) {
      return { ok: true, interfaces: l.map(function (i) { return { name: i.name, type: i.type || '', running: i.running === 'true' }; }) };
    });
  };
  B.a_admin_test = function () {
    requireAdmin(this);
    var ros = this.ros, out = { ok: true };
    return ros.q('/system/identity/print').then(function (id) {
      out.identity = id[0] ? id[0].name : ''; return ros.q('/system/resource/print');
    }).then(function (r) {
      out.version = r[0] ? r[0].version : ''; out.board = r[0] ? r[0]['board-name'] || '' : ''; out.uptime = r[0] ? r[0].uptime : '';
      return ros.q('/ip/hotspot/print', { '.proplist': 'name,interface,profile' });
    }).then(function (s) { out.servers = s; return out; });
  };
  B.a_admin_notif = function (b) {
    requireAdmin(this);
    var self = this;
    return self.loadNotif().then(function (l) {
      if (b.op === 'read') l.forEach(function (n) { n.read = true; });
      if (b.op === 'clear') l = [];
      return self.saveNotif(l);
    }).then(function () { return { ok: true }; });
  };

  root.AlhudaBackend = Backend;
  root.AlhudaHexMD5 = hexMD5;
})(typeof window !== 'undefined' ? window : globalThis);
