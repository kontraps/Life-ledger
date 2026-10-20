/* Shared reminder logic. Used by the page AND the service worker, so both agree on
   when a reminder is due and what it says. No DOM access in here. */
(function(root){
  const pad2 = n => String(n).padStart(2,'0');
  const dateKey = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

  // "20:30" -> 1230 minutes after midnight (null if it isn't a valid time)
  function minutesOf(t){
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t||''));
    if(!m) return null;
    const h = +m[1], mi = +m[2];
    return (h>23 || mi>59) ? null : h*60+mi;
  }
  function formatTime(t){
    const mins = minutesOf(t); if(mins===null) return '';
    const h = Math.floor(mins/60), m = mins%60;
    return ((h%12)||12) + ':' + pad2(m) + ' ' + (h<12?'AM':'PM');
  }
  // Streak counted the same way as the app: alive until midnight even if today isn't ticked yet
  function streakOf(h, now){
    const done = new Set(h.doneDates||[]);
    const d = new Date(now);
    if(!done.has(dateKey(d))) d.setDate(d.getDate()-1);
    let s = 0;
    while(done.has(dateKey(d))){ s++; d.setDate(d.getDate()-1); }
    return s;
  }
  // Due = switched on, time has passed today, and not already sent today
  function isDue(rem, now, sentDate){
    if(!rem || !rem.on) return false;
    const at = minutesOf(rem.time); if(at===null) return false;
    if(sentDate === dateKey(now)) return false;
    return now.getHours()*60 + now.getMinutes() >= at;
  }
  function buildReminder(habits, now){
    const key = dateKey(now);
    const pending = (habits||[]).filter(h=>!(h.doneDates||[]).includes(key));
    if(!pending.length) return null;
    const hot = pending.map(h=>({h, s:streakOf(h, now)})).filter(x=>x.s>=2).sort((a,b)=>b.s-a.s)[0];
    if(hot){
      const more = pending.length-1;
      return {
        title: `Keep your ${hot.s}-day streak 🔥`,
        body: `${hot.h.name} is still open today.` + (more ? ` ${more} more habit${more>1?'s':''} to go.` : '')
      };
    }
    if(pending.length===1) return {title:'One habit left today', body:`${pending[0].name} is still open.`};
    return {title:`${pending.length} habits left today`, body: pending.slice(0,3).map(h=>h.name).join(', ') + (pending.length>3?'…':'')};
  }
  root.LedgerReminder = {dateKey, minutesOf, formatTime, streakOf, isDue, buildReminder};
})(typeof self!=='undefined' ? self : this);
