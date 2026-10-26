const CACHE = 'ledger-v15';
const META_CACHE = 'ledger-meta';   // survives updates: holds a copy of your reminder settings
const FILES = [
  './life-dashboard.html','./manifest.json','./icon.png','./reminder.js','./icon-192.png',
  './fonts/bricolage-700.woff2','./fonts/bricolage-800.woff2',
  './fonts/plexmono-500-latin.woff2','./fonts/plexmono-500-ext.woff2',
  './fonts/plexmono-600-latin.woff2','./fonts/plexmono-600-ext.woff2'
];
try{ importScripts('./reminder.js'); }catch(e){}

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE && k!==META_CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(
    fetch(e.request,{cache:'no-cache'}).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(e.request))
  );
});

// ---- Reminders ----
async function readMeta(){
  try{
    const c = await caches.open(META_CACHE);
    const r = await c.match('/__meta/state');
    return r ? await r.json() : null;
  }catch(e){ return null; }
}
async function writeSent(meta, day){
  try{
    meta.sent = day;
    const c = await caches.open(META_CACHE);
    await c.put('/__meta/state', new Response(JSON.stringify(meta), {headers:{'Content-Type':'application/json'}}));
  }catch(e){}
}
async function runReminder(){
  if(typeof LedgerReminder==='undefined') return;
  const meta = await readMeta();
  if(!meta) return;
  const now = new Date();
  if(!LedgerReminder.isDue(meta.reminder, now, meta.sent)) return;
  const msg = LedgerReminder.buildReminder(meta.habits, now);
  if(!msg){ await writeSent(meta, LedgerReminder.dateKey(now)); return; }   // everything done: nothing to nag about
  if(self.Notification && Notification.permission!=='granted') return;
  await self.registration.showNotification(msg.title, {
    body: msg.body, icon:'./icon.png', badge:'./icon.png', tag:'ledger-daily', renotify:false
  });
  await writeSent(meta, LedgerReminder.dateKey(now));
}
self.addEventListener('periodicsync', e=>{ if(e.tag==='ledger-reminder') e.waitUntil(runReminder()); });
self.addEventListener('message', e=>{ if(e.data && e.data.type==='check-reminder') e.waitUntil(runReminder()); });
self.addEventListener('notificationclick', e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){ if('focus' in c) return c.focus(); }
    return self.clients.openWindow('./life-dashboard.html');
  }));
});
