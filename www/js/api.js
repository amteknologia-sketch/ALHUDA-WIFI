/* api.js — ALHUDA_D.NET "mode langsung ke router"
 * Tidak ada server/PHP/hosting. Aplikasi bicara langsung ke MikroTik RouterOS
 * API lewat plugin native TCP (Routeros.exec). Semua logika Mikhmon ada di sini.
 */

/* ---------- penyimpanan lokal ---------- */
const Store = {
  get session(){ return localStorage.getItem('ad_session')||''; }, set session(v){ localStorage.setItem('ad_session',v); },
  get appName(){ return localStorage.getItem('ad_appname')||'ALHUDA_D.NET'; }, set appName(v){ localStorage.setItem('ad_appname',v); },
  get logo(){ return localStorage.getItem('ad_logo')||''; }, set logo(v){ localStorage.setItem('ad_logo',v); },
  get theme(){ return localStorage.getItem('ad_theme')||'light'; }, set theme(v){ localStorage.setItem('ad_theme',v); },
  get footer(){ return localStorage.getItem('ad_footer')||'*Garansi voucher berlaku selama voucher aktif.'; }, set footer(v){ localStorage.setItem('ad_footer',v); },
  get vnote(){ return localStorage.getItem('ad_vnote')||'Sebelum Login :d.net Ubah Privasi ke MAC Ponsel / Perangkat'; }, set vnote(v){ localStorage.setItem('ad_vnote',v); },
  get routers(){ try{ return JSON.parse(localStorage.getItem('ad_routers')||'[]'); }catch(e){ return []; } },
  set routers(v){ localStorage.setItem('ad_routers', JSON.stringify(v)); },
  get boundUser(){ return localStorage.getItem('ad_bound')||''; }, set boundUser(v){ if(v) localStorage.setItem('ad_bound',v); else localStorage.removeItem('ad_bound'); },
  get adminOk(){ return localStorage.getItem('ad_adminok')==='1'; }, set adminOk(v){ if(v) localStorage.setItem('ad_adminok','1'); else localStorage.removeItem('ad_adminok'); },
};

/* ---------- cache (untuk mode offline / tanpa loading) ---------- */
function cacheKey(action,params){ return 'c_'+Store.session+'_'+action+'_'+JSON.stringify(params||{}); }
function cachePeek(action,params){ try{ const v=localStorage.getItem(cacheKey(action,params)); return v?JSON.parse(v):null; }catch(e){ return null; } }
async function apiCached(action,params){ const d=await api(action,params); try{ localStorage.setItem(cacheKey(action,params),JSON.stringify(d)); }catch(e){} return d; }

/* ---------- plugin native (diselesaikan saat dipakai, bukan saat awal) ---------- */
let _ros = null;
function getRouteros(){
  if(_ros) return _ros;
  const C = window.Capacitor;
  if(C && typeof C.registerPlugin === 'function'){ _ros = C.registerPlugin('Routeros'); return _ros; }
  if(C && C.Plugins && C.Plugins.Routeros){ _ros = C.Plugins.Routeros; return _ros; }
  return null;
}

function currentRouter(){ const rs=Store.routers; return rs.find(r=>r.name===Store.session) || rs[0] || null; }
function requireRouter(){ const r=currentRouter(); if(!r) throw new Error('Belum ada router. Tambahkan di menu Peraturan.'); return r; }

async function rosExec(router, commands){
  const RP = getRouteros();
  if(!RP){
    const C = window.Capacitor;
    const info = C ? ('Capacitor ada (platform='+(C.getPlatform?C.getPlatform():'?')+', keys: '+Object.keys(C).slice(0,10).join(',')+')') : 'window.Capacitor TIDAK ADA';
    throw new Error('Plugin native tak terdeteksi → '+info);
  }
  const r = await RP.exec({
    host: router.host, port: parseInt(router.port,10)||8728,
    user: router.user||'', pass: router.pass||'', timeout: 7000, commands
  });
  return r.results || [];
}
async function ros(router, command, attrs, queries){
  const res = await rosExec(router, [{ command, attrs: attrs||{}, queries: queries||{} }]);
  return res[0] || [];
}
// Ambil throughput beberapa interface dengan aman: jika satu nama tak valid, sisanya tetap jalan.
async function monTraffic(router, names){
  if(!names||!names.length) return {};
  const map={};
  try{
    const res=await rosExec(router, names.map(n=>({command:'/interface/monitor-traffic',attrs:{interface:n,once:''}})));
    names.forEach((n,i)=>{ const r=(res[i]||[])[0]||{}; map[n]={rx:+(r['rx-bits-per-second']||0), tx:+(r['tx-bits-per-second']||0)}; });
  }catch(e){
    await Promise.all(names.map(n=> rosExec(router,[{command:'/interface/monitor-traffic',attrs:{interface:n,once:''}}])
      .then(res=>{ const r=(res[0]||[])[0]||{}; map[n]={rx:+(r['rx-bits-per-second']||0), tx:+(r['tx-bits-per-second']||0)}; })
      .catch(()=>{ map[n]={rx:0,tx:0}; }) ));
  }
  return map;
}

/* ---------- util ---------- */
const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const pad2 = n => String(n).padStart(2,'0');
function dayLabel(d){ return `${MON[d.getMonth()]}/${pad2(d.getDate())}/${d.getFullYear()}`; }
function monLabel(d){ return `${MON[d.getMonth()]}${d.getFullYear()}`; }
function rMoney(cur,n){ n=+n||0; const indo=/^(rp|idr)$/i.test(cur||''); return (cur||'')+' '+(indo?n.toLocaleString('id-ID'):n.toLocaleString('en-US',{minimumFractionDigits:2})); }
function profMeta(p){
  const parts=String(p['on-login']||'').split(',');
  return { id:p['.id']||'', name:p.name||'', 'shared-users':p['shared-users']||'1', 'rate-limit':p['rate-limit']||'',
    expmode:parts[1]||'', price:(parts[2]||'0').trim(), validity:parts[3]||'', selling:(parts[4]||'0').trim(), lock:parts[6]||'' };
}
function rpick(set,n){ let s=''; for(let i=0;i<n;i++) s+=set[Math.floor(Math.random()*set.length)]; return s; }
const _N='0123456789',_LC='abcdefghijklmnopqrstuvwxyz',_UC='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const randN=n=>rpick(_N,n), randLC=n=>rpick(_LC,n), randUC=n=>rpick(_UC,n),
      randULC=n=>rpick(_UC+_LC,n), randNLC=n=>rpick(_N+_LC,n), randNUC=n=>rpick(_N+_UC,n), randNULC=n=>rpick(_N+_UC+_LC,n);
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

/* ===================================================================
   api(action, params) — antarmuka yang dipakai seluruh halaman UI
=================================================================== */
async function api(action, params={}){
  const r = (['sessions'].includes(action)) ? null : null; // router diambil per-aksi
  switch(action){

  case 'sessions':
    return Store.routers.map(x=>({ session:x.name, hotspot:x.hotspot||x.name, ip:(x.host+':'+(x.port||8728)),
      currency:x.currency||'Rp', iface:x.iface||'' }));

  case 'connect': {
    const rt = Store.routers.find(x=>x.name===(params.session||Store.session)) || requireRouter();
    const id = await ros(rt,'/system/identity/print');
    return { connected:true, name:(id[0]&&id[0].name)||'', hotspot:rt.hotspot, currency:rt.currency };
  }
  case 'ping': {
    const rt = Store.routers.find(x=>x.name===(params.session||Store.session)) || requireRouter();
    const t0=Date.now();
    await ros(rt,'/system/identity/print');
    return { host:rt.host, port:parseInt(rt.port,10)||8728, ms:Date.now()-t0 };
  }

  case 'dashboard': {
    const rt=requireRouter(); const now=new Date();
    const res = await rosExec(rt,[
      {command:'/system/resource/print'},
      {command:'/system/routerboard/print'},
      {command:'/system/clock/print'},
      {command:'/ip/hotspot/active/print', attrs:{'.proplist':'.id'}},
      {command:'/ip/hotspot/user/print',   attrs:{'.proplist':'.id'}},
      {command:'/system/script/print', queries:{source:dayLabel(now)}},
      {command:'/system/script/print', queries:{owner:monLabel(now)}},
    ]);
    const rsc=res[0][0]||{}, rb=res[1][0]||{}, clk=res[2][0]||{};
    const sum = arr => arr.reduce((a,s)=>a+(parseFloat((s.name||'').split('-|-')[3])||0),0);
    const cur=rt.currency||'Rp';
    const sumT=sum(res[5]), sumM=sum(res[6]);
    return {
      boardname:rsc['board-name']||'-', model:rb.model||rsc['board-name']||'-', version:rsc.version||'-',
      cpu:(rsc['cpu-load']||'0')+'%', cpu_raw:parseInt(rsc['cpu-load']||0,10),
      freemem:+(rsc['free-memory']||0), totalmem:+(rsc['total-memory']||0), freehdd:+(rsc['free-hdd-space']||0),
      uptime:rsc.uptime||'-', datetime:((clk.date||'')+' '+(clk.time||'')),
      active:res[3].length, users:res[4].length, currency:cur,
      income_today:{ vcr:res[5].length, sum:sumT, text:res[5].length+'vcr : '+rMoney(cur,sumT) },
      income_month:{ vcr:res[6].length, sum:sumM, text:res[6].length+'vcr : '+rMoney(cur,sumM) },
    };
  }

  case 'interfaces': {
    const rt=requireRouter(); const ifs=await ros(rt,'/interface/print');
    return ifs.map(i=>({name:i.name||'', type:i.type||'', running:i.running||'false'}));
  }

  case 'traffic': {
    const rt=requireRouter(); let iface=params.iface||rt.iface;
    const mon=async(ifc)=>{ const t=await ros(rt,'/interface/monitor-traffic',{interface:ifc,once:''}); return { iface:ifc, rx_bps:+((t[0]||{})['rx-bits-per-second']||0), tx_bps:+((t[0]||{})['tx-bits-per-second']||0) }; };
    if(!iface || /^\d+$/.test(iface)){ const ifs=await ros(rt,'/interface/print');
      if(/^\d+$/.test(iface)&&ifs[+iface-1]) iface=ifs[+iface-1].name; else if(ifs[0]) iface=ifs[0].name; }
    try{ return await mon(iface); }
    catch(e){ try{ const ifs=await ros(rt,'/interface/print'); if(ifs[0]) return await mon(ifs[0].name); }catch(_){}
      return { iface, rx_bps:0, tx_bps:0 }; }
  }

  case 'active': {
    const rt=requireRouter(); const rows=await ros(rt,'/ip/hotspot/active/print');
    return rows.map(a=>{ const bin=+(a['bytes-in']||0), bout=+(a['bytes-out']||0);
      return { id:a['.id']||'', user:a.user||'', server:a.server||'', address:a.address||'', mac:a['mac-address']||'',
        bytes_in:bin, bytes_out:bout, download:bout, upload:bin, total:bin+bout,
        uptime:a.uptime||'', login_by:a['login-by']||'', comment:a.comment||'' }; });
  }

  case 'activeusage': {
    const rt=requireRouter();
    const rows=await ros(rt,'/ip/hotspot/active/print',{'.proplist':'user,bytes-in,bytes-out'});
    return rows.map(a=>({ user:a.user||'?', bin:+(a['bytes-in']||0), bout:+(a['bytes-out']||0) }));
  }

  case 'userinfo': {
    const rt=requireRouter(); const name=params.name;
    const u=(await ros(rt,'/ip/hotspot/user/print',{},{name}))[0];
    if(!u) throw new Error('Kode voucer / user tidak ditemukan: '+name);
    let shared=1;
    try{ const pr=(await ros(rt,'/ip/hotspot/user/profile/print',{'.proplist':'name,shared-users'},{name:u.profile||'default'}))[0];
      if(pr&&pr['shared-users']) shared=parseInt(pr['shared-users'],10)||1; }catch(e){}
    return { id:u['.id']||'', name:u.name||'', profile:u.profile||'', comment:u.comment||'',
      bytesIn:+(u['bytes-in']||0), bytesOut:+(u['bytes-out']||0), uptime:u.uptime||'',
      limitUptime:u['limit-uptime']||'', disabled:(u.disabled==='true'), shared };
  }

  case 'useractive': {
    const rt=requireRouter(); const name=params.name;
    const [rows,leases]=await Promise.all([
      ros(rt,'/ip/hotspot/active/print',{},{user:name}),
      ros(rt,'/ip/dhcp-server/lease/print',{'.proplist':'mac-address,host-name'}).catch(()=>[]),
    ]);
    const hn={}; leases.forEach(l=>{ const m=(l['mac-address']||'').toLowerCase(); if(m) hn[m]=l['host-name']||''; });
    return rows.map(a=>({ id:a['.id']||'', server:a.server||'', address:a.address||'', mac:a['mac-address']||'',
      host:hn[(a['mac-address']||'').toLowerCase()]||'', uptime:a.uptime||'', bin:+(a['bytes-in']||0), bout:+(a['bytes-out']||0) }));
  }

  case 'usercookies': {
    const rt=requireRouter(); const name=params.name;
    const [ck,act,leases]=await Promise.all([
      ros(rt,'/ip/hotspot/cookie/print',{},{user:name}),
      ros(rt,'/ip/hotspot/active/print',{},{user:name}),
      ros(rt,'/ip/dhcp-server/lease/print',{'.proplist':'mac-address,host-name'}).catch(()=>[]),
    ]);
    const hn={}; leases.forEach(l=>{ const m=(l['mac-address']||'').toLowerCase(); if(m) hn[m]=l['host-name']||''; });
    const am={}; act.forEach(a=>{ const m=(a['mac-address']||'').toLowerCase(); am[m]={server:a.server||'',address:a.address||'',bytes:(+(a['bytes-in']||0))+(+(a['bytes-out']||0))}; });
    return ck.map(c=>{ const m=(c['mac-address']||'').toLowerCase(); const on=am[m];
      return { id:c['.id']||'', mac:c['mac-address']||'', host:hn[m]||'', server:(on&&on.server)||'', address:(on&&on.address)||'',
        data:(on?on.bytes:null), expires:c['expires-in']||'', online:!!on }; });
  }

  case 'renameuser': {
    const rt=requireRouter(); const id=params.id, name=(params.name||'').trim();
    if(!name) throw new Error('Nama baru wajib diisi.');
    const dup=await ros(rt,'/ip/hotspot/user/print',{'.proplist':'.id,name'},{name});
    if(dup.some(d=>d['.id']!==id)) throw new Error('Nama "'+name+'" sudah dipakai.');
    await ros(rt,'/ip/hotspot/user/set',{'.id':id, name, password:name});
    return { name };
  }

  case 'home': {
    const rt=requireRouter(); const now=new Date(); const cur=rt.currency||'Rp';
    const b1=await rosExec(rt,[
      {command:'/system/resource/print'},
      {command:'/system/routerboard/print'},
      {command:'/system/clock/print'},
      {command:'/system/health/print'},
      {command:'/ip/hotspot/active/print', attrs:{'.proplist':'.id,server'}},
      {command:'/ip/hotspot/user/print', attrs:{'.proplist':'name,bytes-in,bytes-out'}},
      {command:'/system/script/print', queries:{source:dayLabel(now)}},
      {command:'/system/script/print', queries:{owner:monLabel(now)}},
      {command:'/ip/hotspot/print'},
      {command:'/interface/print'},
    ]);
    const rsc=b1[0][0]||{}, rb=b1[1][0]||{}, clk=b1[2][0]||{}, health=b1[3]||[], actives=b1[4]||[], users=b1[5]||[], today=b1[6]||[], month=b1[7]||[], servers=b1[8]||[], ifaces=b1[9]||[];
    let temp=null;
    health.forEach(h=>{ if((h.name==='temperature'||h.name==='cpu-temperature'||h.name==='board-temperature')&&h.value!=null) temp=parseFloat(h.value); if(h.temperature!=null) temp=parseFloat(h.temperature); if(h['cpu-temperature']!=null) temp=parseFloat(h['cpu-temperature']); });
    const sum=arr=>arr.reduce((a,s)=>a+(parseFloat((s.name||'').split('-|-')[3])||0),0);
    const countBy={}; actives.forEach(x=>{const s=x.server||'?';countBy[s]=(countBy[s]||0)+1;});
    const tu=users.map(u=>({name:u.name||'?', total:(+(u['bytes-in']||0))+(+(u['bytes-out']||0))})).sort((a,b)=>b.total-a.total).slice(0,20);
    const tif=rt.iface; const tifo=ifaces.find(i=>i.name===tif)||{};
    const dataBytes=(+(tifo['rx-byte']||0))+(+(tifo['tx-byte']||0));
    const userDataBytes=users.reduce((a,u)=>a+(+(u['bytes-in']||0))+(+(u['bytes-out']||0)),0);
    // monitor traffic (tahan-error: interface tak valid dilewati, tidak menggagalkan semua)
    const validSet=new Set(ifaces.map(i=>i.name));
    const srvList=servers.filter(s=>s.interface && validSet.has(s.interface));
    const excl=new Set([tif].concat(rt.exclude||[]));
    const ifList=ifaces.filter(i=>i.name && !excl.has(i.name));
    const names=Array.from(new Set(srvList.map(s=>s.interface).concat(ifList.map(i=>i.name))));
    const trafMap=await monTraffic(rt,names);
    const srvStats=srvList.map(s=>({name:s.name, active:countBy[s.name]||0, rx_bps:(trafMap[s.interface]||{}).rx||0, tx_bps:(trafMap[s.interface]||{}).tx||0})).sort((a,b)=>b.active-a.active);
    const ifStats=ifList.map(i=>{ const t=trafMap[i.name]||{rx:0,tx:0}; const rb=+(i['rx-byte']||0), tb=+(i['tx-byte']||0);
      return {name:i.name, rx_bps:t.rx, tx_bps:t.tx, total:t.rx+t.tx, bytes:rb+tb}; }).sort((a,b)=> (b.total-a.total)|| (b.bytes-a.bytes)).slice(0,5);
    return {
      device:{ boardname:rsc['board-name']||'-', model:rb.model||rsc['board-name']||'-', version:rsc.version||'-', uptime:rsc.uptime||'-', datetime:((clk.date||'')+' '+(clk.time||'')) },
      cpu_raw:parseInt(rsc['cpu-load']||0,10), cpu:(rsc['cpu-load']||'0')+'%',
      freemem:+(rsc['free-memory']||0), totalmem:+(rsc['total-memory']||0),
      temp, dataBytes, userDataBytes, active:actives.length, users:users.length, currency:cur,
      income_today:sum(today), income_month:sum(month),
      servers:srvStats, interfaces:ifStats, topusers:tu, trafficIface:tif,
    };
  }

  case 'dirs': {
    const rt=requireRouter(); const rows=await ros(rt,'/file/print',{'.proplist':'name,type'});
    const dirs=rows.filter(f=>/directory/i.test(f.type||'')).map(f=>f.name).filter(Boolean);
    return dirs;
  }

  case 'serverstats': {
    const rt=requireRouter();
    const a=await rosExec(rt,[
      {command:'/ip/hotspot/print'},
      {command:'/ip/hotspot/active/print', attrs:{'.proplist':'server'}},
    ]);
    const servers=a[0]||[]; const actives=a[1]||[];
    const countBy={}; actives.forEach(x=>{ const s=x.server||'?'; countBy[s]=(countBy[s]||0)+1; });
    const cmds=servers.map(s=>({command:'/interface/monitor-traffic', attrs:{interface:s.interface||'', once:''}}));
    let traf=[]; if(cmds.length) traf=await rosExec(rt,cmds);
    const list=servers.map((s,i)=>({ name:s.name||'?', interface:s.interface||'', active:countBy[s.name]||0,
      rx_bps:+(((traf[i]||[])[0]||{})['rx-bits-per-second']||0), tx_bps:+(((traf[i]||[])[0]||{})['tx-bits-per-second']||0) }));
    list.sort((x,y)=>y.active-x.active);
    return list;
  }

  case 'sysinfo': {
    const rt=requireRouter();
    const res=await rosExec(rt,[
      {command:'/system/identity/print'},
      {command:'/system/resource/print'},
      {command:'/system/routerboard/print'},
    ]);
    const id=res[0][0]||{}, rsc=res[1][0]||{}, rb=res[2][0]||{};
    return { identity:id.name||'-', version:rsc.version||'-', model:rb.model||rsc['board-name']||'-',
      cpu:(rsc['cpu-load']||'0')+'%', cpu_raw:parseInt(rsc['cpu-load']||0,10),
      freemem:+(rsc['free-memory']||0), totalmem:+(rsc['total-memory']||0), uptime:rsc.uptime||'-',
      freehdd:+(rsc['free-hdd-space']||0) };
  }

  case 'serverprofiles': {
    const rt=requireRouter(); const rows=await ros(rt,'/ip/hotspot/profile/print');
    return rows.map(p=>({ id:p['.id']||'', name:p.name||'', 'hotspot-address':p['hotspot-address']||'', 'dns-name':p['dns-name']||'',
      'html-directory':p['html-directory']||'', 'login-by':p['login-by']||'' }));
  }
  case 'editserverprofile': {
    const rt=requireRouter(); const set={'.id':params.id};
    ['dns-name','html-directory','login-by','hotspot-address'].forEach(k=>{ if(params[k]!==undefined && params[k]!=='') set[k]=params[k]; });
    await ros(rt,'/ip/hotspot/profile/set',set); return null;
  }

  case 'files': {
    const rt=requireRouter(); const rows=await ros(rt,'/file/print');
    return rows.map(f=>({ id:f['.id']||'', name:f.name||'', type:f.type||'', size:+(f.size||0) }));
  }
  case 'delfile': {
    const rt=requireRouter(); await ros(rt,'/file/remove',{'.id':params.id}); return null;
  }

  case 'reboot': {
    const rt=requireRouter(); await ros(rt,'/system/reboot'); return null;
  }

  case 'logpengguna': {
    const rt=requireRouter();
    const rows=(await ros(rt,'/log/print')).reverse();
    const out=[];
    for(const r2 of rows){
      const msg=r2.message||''; const tp=r2.topics||'';
      if(!/hotspot/i.test(tp) && !/logged (in|out)|login|logout/i.test(msg)) continue;
      if(!/logged (in|out)|login|logout/i.test(msg)) continue;
      out.push({time:r2.time||'', message:msg});
    }
    return out.slice(0,200);
  }
  case 'kick': {
    const rt=requireRouter(); const id=params.id;
    const g=await ros(rt,'/ip/hotspot/active/print',{'.proplist':'.id,user'},{'.id':id});
    const user=(g[0]||{}).user;
    if(user){ const ck=await ros(rt,'/ip/hotspot/cookie/print',{'.proplist':'.id'},{user}); if(ck[0]) await ros(rt,'/ip/hotspot/cookie/remove',{'.id':ck[0]['.id']}); }
    await ros(rt,'/ip/hotspot/active/remove',{'.id':id});
    return null;
  }

  case 'servers': {
    const rt=requireRouter(); const s=await ros(rt,'/ip/hotspot/print',{'.proplist':'name'});
    return ['all'].concat(s.map(x=>x.name).filter(Boolean));
  }

  case 'users': {
    const rt=requireRouter(); let q={};
    if(params.comment) q={comment:params.comment};
    else if(params.profile && params.profile!=='all') q={profile:params.profile};
    const rows=await ros(rt,'/ip/hotspot/user/print',{},q);
    return rows.map(x=>({ id:x['.id']||'', name:x.name||'', password:x.password||'', profile:x.profile||'', server:x.server||'',
      comment:x.comment||'', mac:x['mac-address']||'', uptime:x.uptime||'', bytes_in:+(x['bytes-in']||0), bytes_out:+(x['bytes-out']||0),
      disabled:(x.disabled==='true'), limit_uptime:x['limit-uptime']||'' }));
  }

  case 'adduser': {
    const rt=requireRouter(); const name=(params.name||'').trim();
    if(!name) throw new Error('Nama user wajib diisi.');
    await ros(rt,'/ip/hotspot/user/add',{ server:params.server||'all', name, password:name, profile:params.profile||'default',
      disabled:'no', 'limit-uptime':'0', 'limit-bytes-total':'0', comment:'vc-'+(params.comment||'') });
    return { name, password:name, profile:params.profile, comment:params.comment||'' };
  }

  case 'generate': {
    const rt=requireRouter();
    const qty=Math.max(1,Math.min(500, parseInt(params.qty,10)||1));
    let userl=parseInt(params.length,10)||4; if(userl<3)userl=3; if(userl>8)userl=8;
    const prefix=params.prefix||'', char=params.char||'lower', profile=params.profile||'default', server=params.server||'all';
    const now=new Date(); const datecode=`${pad2(now.getMonth()+1)}.${pad2(now.getDate())}.${String(now.getFullYear()).slice(-2)}`;
    const commt='vc-'+randInt(100,999)+'-'+datecode+'-'+(params.comment||'');
    const aShuf=['','',1,2,2,3,3,4]; const shuf=userl-(aShuf[userl]||0);
    const names=[];
    for(let i=0;i<qty;i++){
      let nm;
      if(char==='num') nm=prefix+randN(userl);
      else if(char==='mix') nm=prefix+randNLC(userl);
      else if(char==='mix1') nm=prefix+randNUC(userl);
      else if(char==='mix2') nm=prefix+randNULC(userl);
      else { let base = char==='upper'?randUC(shuf) : char==='upplow'?randULC(shuf) : randLC(shuf);
        let sfx = userl===3?randN(1) : (userl===4||userl===5)?randN(2) : (userl===6||userl===7)?randN(3) : randN(4);
        nm=prefix+base+sfx; }
      names.push(nm);
    }
    const cmds=names.map(nm=>({command:'/ip/hotspot/user/add', attrs:{ server, name:nm, password:nm, profile,
      'limit-uptime':'0','limit-bytes-total':'0', comment:commt }}));
    await rosExec(rt,cmds);
    return { users:names, profile, comment:params.comment||'', batch:commt };
  }

  case 'deluser': {
    const rt=requireRouter();
    let ids=params.id; ids=Array.isArray(ids)?ids:String(ids).split('~').filter(Boolean);
    for(const id of ids){
      const g=await ros(rt,'/ip/hotspot/user/print',{'.proplist':'.id,name'},{'.id':id});
      const name=(g[0]||{}).name;
      if(name){
        const info=await rosExec(rt,[
          {command:'/system/script/print', attrs:{'.proplist':'.id'}, queries:{name}},
          {command:'/system/scheduler/print', attrs:{'.proplist':'.id'}, queries:{name}},
        ]);
        if(info[0][0]) await ros(rt,'/system/script/remove',{'.id':info[0][0]['.id']});
        if(info[1][0]) await ros(rt,'/system/scheduler/remove',{'.id':info[1][0]['.id']});
      }
      await ros(rt,'/ip/hotspot/user/remove',{'.id':id});
    }
    return null;
  }

  case 'toggleuser': {
    const rt=requireRouter();
    await ros(rt,'/ip/hotspot/user/set',{'.id':params.id, disabled:(params.disabled==='yes'?'yes':'no')});
    return null;
  }
  case 'edituser': {
    const rt=requireRouter(); const set={'.id':params.id};
    if(params.profile!==undefined) set.profile=params.profile;
    if(params.comment!==undefined){
      const g=await ros(rt,'/ip/hotspot/user/print',{'.proplist':'.id,comment'},{'.id':params.id});
      const old=(g[0]||{}).comment||'vc-'; const pfx=(old.slice(0,3)==='up-')?'up-':'vc-';
      set.comment=pfx+params.comment;
    }
    await ros(rt,'/ip/hotspot/user/set',set);
    return null;
  }

  case 'profiles': {
    const rt=requireRouter(); const cur=rt.currency||'Rp';
    const rows=await ros(rt,'/ip/hotspot/user/profile/print');
    return rows.map(p=>{ const m=profMeta(p); m.price_text=rMoney(cur,m.price); return m; });
  }

  case 'addprofile': {
    const rt=requireRouter();
    const name=(params.name||'').trim().replace(/\s+/g,'-'); if(!name) throw new Error('Nama profil wajib diisi.');
    const sharedusers=params.sharedusers||'1', ratelimit=params.ratelimit||'', expmode=params.expmode||'0';
    const validity=params.validity||'', price=(params.price===''||params.price==null)?'0':params.price,
          sprice=(params.sprice===''||params.sprice==null)?'0':params.sprice, pool=params.pool||'none', parent=params.parent||'none',
          getlock=params.lock||'Disable';
    const lock=(getlock==='Enable')?'; [:local mac $"mac-address"; /ip hotspot user set mac-address=$mac [find where name=$user]]':'';
    const record=`; :local mac $"mac-address"; :local time [/system clock get time ]; /system script add name="$date-|-$time-|-$user-|-${price}-|-$address-|-$mac-|-${validity}-|-${name}-|-$comment" owner="$month$year" source="$date" comment="mikhmon"`;
    let onlogin=`:put (",${expmode},${price},${validity},${sprice},,${getlock},"); {:local comment [ /ip hotspot user get [/ip hotspot user find where name="$user"] comment]; :local ucode [:pic $comment 0 2]; :if ($ucode = "vc" or $ucode = "up" or $comment = "") do={ :local date [ /system clock get date ];:local year [ :pick $date 7 11 ];:local month [ :pick $date 0 3 ]; /sys sch add name="$user" disable=no start-date=$date interval="${validity}"; :delay 5s; :local exp [ /sys sch get [ /sys sch find where name="$user" ] next-run]; :local getxp [len $exp]; :if ($getxp = 15) do={ :local d [:pic $exp 0 6]; :local t [:pic $exp 7 16]; :local s ("/"); :local exp ("$d$s$year $t"); /ip hotspot user set comment="$exp" [find where name="$user"];}; :if ($getxp = 8) do={ /ip hotspot user set comment="$date $exp" [find where name="$user"];}; :if ($getxp > 15) do={ /ip hotspot user set comment="$exp" [find where name="$user"];};:delay 5s; /sys sch remove [find where name="$user"]`;
    let mode='remove';
    if(expmode==='rem'){ onlogin+=lock+'}}'; mode='remove'; }
    else if(expmode==='ntf'){ onlogin+=lock+'}}'; mode='set limit-uptime=1s'; }
    else if(expmode==='remc'){ onlogin+=record+lock+'}}'; mode='remove'; }
    else if(expmode==='ntfc'){ onlogin+=record+lock+'}}'; mode='set limit-uptime=1s'; }
    else if(expmode==='0' && price!==''){ onlogin=`:put (",,${price},,,noexp,${getlock},")`+lock; }
    else { onlogin=''; }
    const bgservice=`:local dateint do={:local montharray ( "jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec" );:local days [ :pick $d 4 6 ];:local month [ :pick $d 0 3 ];:local year [ :pick $d 7 11 ];:local monthint ([ :find $montharray $month]);:local month ($monthint + 1);:if ( [len $month] = 1) do={:local zero ("0");:return [:tonum ("$year$zero$month$days")];} else={:return [:tonum ("$year$month$days")];}}; :local timeint do={ :local hours [ :pick $t 0 2 ]; :local minutes [ :pick $t 3 5 ]; :return ($hours * 60 + $minutes) ; }; :local date [ /system clock get date ]; :local time [ /system clock get time ]; :local today [$dateint d=$date] ; :local curtime [$timeint t=$time] ; :foreach i in [ /ip hotspot user find where profile="${name}" ] do={ :local comment [ /ip hotspot user get $i comment]; :local name [ /ip hotspot user get $i name]; :local gettime [:pic $comment 12 20]; :if ([:pic $comment 3] = "/" and [:pic $comment 6] = "/") do={:local expd [$dateint d=$comment] ; :local expt [$timeint t=$gettime] ; :if (($expd < $today and $expt < $curtime) or ($expd < $today and $expt > $curtime) or ($expd = $today and $expt < $curtime)) do={ [ /ip hotspot user ${mode} $i ]; [ /ip hotspot active remove [find where user=$name] ];}}}`;
    const randStart='0'+randInt(1,5)+':'+randInt(10,59)+':'+randInt(10,59);
    const randIntv='00:02:'+randInt(10,59);
    await ros(rt,'/ip/hotspot/user/profile/add',{ name, 'address-pool':pool, 'rate-limit':ratelimit, 'shared-users':sharedusers,
      'status-autorefresh':'1m', 'on-login':onlogin, 'parent-queue':parent });
    if(expmode!=='0' && expmode!==''){
      await ros(rt,'/system/scheduler/add',{ name, 'start-time':randStart, interval:randIntv, 'on-event':bgservice, disabled:'no', comment:'Monitor Profile '+name });
    }
    return { name };
  }

  case 'delprofile': {
    const rt=requireRouter(); const id=params.id;
    const g=await ros(rt,'/ip/hotspot/user/profile/print',{'.proplist':'.id,name'},{'.id':id});
    const name=(g[0]||{}).name;
    if(name){ const sch=await ros(rt,'/system/scheduler/print',{'.proplist':'.id'},{name}); if(sch[0]) await ros(rt,'/system/scheduler/remove',{'.id':sch[0]['.id']}); }
    await ros(rt,'/ip/hotspot/user/profile/remove',{'.id':id});
    return null;
  }

  case 'log': {
    const rt=requireRouter();
    const rows=(await ros(rt,'/log/print')).reverse();
    const hs=rows.filter(r=>/hotspot/i.test(r.topics||''));
    const use=hs.length?hs:rows;
    return use.slice(0,200).map(r=>({time:r.time||'', message:r.message||'', topics:r.topics||''}));
  }

  case 'cookies': {
    const rt=requireRouter(); const rows=await ros(rt,'/ip/hotspot/cookie/print');
    return rows.map(c=>({id:c['.id']||'', user:c.user||'', mac:c['mac-address']||'', domain:c.domain||'', expires:c['expires-in']||''}));
  }
  case 'delcookie': {
    const rt=requireRouter(); await ros(rt,'/ip/hotspot/cookie/remove',{'.id':params.id}); return null;
  }

  case 'report': {
    const rt=requireRouter(); const cur=rt.currency||'Rp';
    let q, label;
    if(params.month){ q={owner:String(params.month).toLowerCase()}; label=q.owner; }
    else if(params.day){ q={source:String(params.day).toLowerCase()}; label=q.source; }
    else if(params.which==='last'){ const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); label=monLabel(d); q={owner:label}; }
    else { label=monLabel(new Date()); q={owner:label}; }
    const rows=await ros(rt,'/system/script/print',{},q);
    const list=[]; let total=0;
    for(const s of rows){ const n=String(s.name||'').split('-|-'); if(n.length<9) continue; const price=parseFloat(n[3])||0; total+=price;
      list.push({date:n[0],time:n[1],user:n[2],price,profile:n[7],comment:n[8]}); }
    list.sort((a,b)=> (Date.parse(b.date+' '+b.time)||0) - (Date.parse(a.date+' '+a.time)||0));
    return { label, rows:list, count:list.length, total, total_text:rMoney(cur,total), currency:cur };
  }

  default:
    throw new Error('Aksi tidak dikenal: '+action);
  }
}

/* ---------- CRUD router lokal (dipakai halaman Peraturan) ---------- */
function routerUpsert(obj){
  const rs=Store.routers; const i=rs.findIndex(x=>x.name===obj.name);
  if(i>=0) rs[i]=Object.assign({},rs[i],obj); else rs.push(obj);
  Store.routers=rs;
}
function routerDelete(name){ Store.routers=Store.routers.filter(x=>x.name!==name); if(Store.session===name) Store.session=(Store.routers[0]||{}).name||''; }
