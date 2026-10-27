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
  // ---- Habit schedules (shared by the page and the service worker) ----
  // A habit with no `sched` is daily, exactly as before. Other shapes:
  //   {type:'days', days:[1,3,5]}   specific weekdays (0 = Sunday)
  //   {type:'weekly', n:3}          any n days each week (Monday to Sunday)
  // `pauses` is [{from, to?}] (YYYY-MM-DD). Days inside a pause never count as missed.
  const keyToDate = k => { const [y,m,d] = String(k).split('-').map(Number); return new Date(y, m-1, d, 12); };
  const schedOf = h => {
    const s = (h && h.sched) || {};
    if(s.type === 'days' && Array.isArray(s.days) && s.days.length) return {type:'days', days:s.days};
    if(s.type === 'weekly' && s.n >= 1 && s.n <= 7) return {type:'weekly', n:Math.floor(s.n)};
    return {type:'daily'};
  };
  const isPausedOn = (h, key) => (h.pauses||[]).some(p => key >= p.from && (!p.to || key <= p.to));
  const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return x; };
  function weekCount(h, date){
    const start = mondayOf(date), done = new Set(h.doneDates||[]);
    let n = 0;
    for(let i=0;i<7;i++){ const d = new Date(start); d.setDate(start.getDate()+i); if(done.has(dateKey(d))) n++; }
    return n;
  }
  // Could this habit be done on that day? (weekly habits can be done any day)
  function isScheduledOn(h, date){
    if(!h || h.archived) return false;
    if(isPausedOn(h, dateKey(date))) return false;
    const s = schedOf(h);
    return s.type === 'days' ? s.days.includes(date.getDay()) : true;
  }
  const isActiveNow = (h, now) => !!h && !h.archived && !isPausedOn(h, dateKey(now));
  function pendingToday(h, now){
    if(!isScheduledOn(h, now)) return false;
    if((h.doneDates||[]).includes(dateKey(now))) return false;
    const s = schedOf(h);
    return s.type === 'weekly' ? weekCount(h, now) < s.n : true;
  }
  const earliest = h => (h.doneDates||[]).length ? [...h.doneDates].sort()[0] : null;
  // Current streak. Days (or weeks, for weekly habits) in a row; off days and paused days are skipped, never counted as misses.
  function streakOf(h, now){
    const done = new Set(h.doneDates||[]), s = schedOf(h), first = earliest(h);
    if(!first) return 0;
    if(s.type === 'weekly'){
      const d = mondayOf(now); let run = 0;
      if(weekCount(h, d) < s.n) d.setDate(d.getDate()-7);        // this week is still open
      for(let i=0;i<530;i++){ if(weekCount(h, d) >= s.n){ run++; d.setDate(d.getDate()-7); } else break; }
      return run;
    }
    const d = new Date(now); d.setHours(12,0,0,0);
    if(!done.has(dateKey(d)) && isScheduledOn(h, d)) d.setDate(d.getDate()-1);   // alive until midnight
    let run = 0;
    for(let i=0;i<3700 && dateKey(d) >= first;i++){
      const k = dateKey(d);
      if(done.has(k)) run++;
      else if(isScheduledOn(h, d)) break;
      d.setDate(d.getDate()-1);
    }
    return run;
  }
  function bestStreakOf(h, now){
    const done = new Set(h.doneDates||[]), s = schedOf(h), first = earliest(h);
    if(!first) return 0;
    let best = 0, run = 0;
    if(s.type === 'weekly'){
      const d = mondayOf(keyToDate(first)), end = mondayOf(now);
      for(let i=0;i<530 && d <= end;i++){
        if(weekCount(h, d) >= s.n){ run++; best = Math.max(best, run); } else if(d < end) run = 0;
        d.setDate(d.getDate()+7);
      }
      return best;
    }
    const d = keyToDate(first), end = new Date(now); end.setHours(12,0,0,0);
    for(let i=0;i<3700 && d <= end;i++){
      const k = dateKey(d);
      if(done.has(k)){ run++; best = Math.max(best, run); }
      else if(isScheduledOn({...h, archived:false}, d) && dateKey(d) !== dateKey(end)) run = 0;
      d.setDate(d.getDate()+1);
    }
    return best;
  }
  // How consistent over the last `win` days. `missed` counts scheduled days before today with no tick.
  function consistencyOf(h, now, win){
    win = win || 30;
    const done = new Set(h.doneDates||[]), s = schedOf(h);
    const today = new Date(now); today.setHours(12,0,0,0);
    let due = 0, hit = 0, missed = 0;
    if(s.type === 'weekly'){
      due = Math.max(1, Math.round(s.n * win / 7));
      for(let i=0;i<win;i++){ const d = new Date(today); d.setDate(today.getDate()-i); if(done.has(dateKey(d))) hit++; }
      hit = Math.min(hit, due);
      return {done:hit, due, missed:Math.max(0, due-hit), pct:Math.round(hit/due*100), unit:'planned'};
    }
    for(let i=0;i<win;i++){
      const d = new Date(today); d.setDate(today.getDate()-i);
      const k = dateKey(d);
      if(h.created && k < h.created) continue;                 // before the habit existed
      if(!isScheduledOn(h, d)) continue;
      due++;
      if(done.has(k)) hit++; else if(i > 0) missed++;
    }
    return {done:hit, due, missed, pct: due ? Math.round(hit/due*100) : 0, unit:'scheduled'};
  }
  function scheduleLabel(h){
    const s = schedOf(h), N = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    if(s.type === 'weekly') return s.n + (s.n === 1 ? ' day' : ' days') + ' a week';
    if(s.type === 'days'){
      const d = [...s.days].sort((a,b)=>a-b).join('');
      if(d === '12345') return 'Weekdays';
      if(d === '06') return 'Weekends';
      if(s.days.length === 7) return 'Every day';
      return [...s.days].sort((a,b)=>((a+6)%7)-((b+6)%7)).map(i=>N[i]).join(' ');
    }
    return 'Every day';
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
    const pending = (habits||[]).filter(h=>pendingToday(h, now));
    if(!pending.length) return null;
    const hot = pending.map(h=>({h, s:streakOf(h, now)})).filter(x=>x.s>=2).sort((a,b)=>b.s-a.s)[0];
    if(hot){
      const more = pending.length-1;
      return {
        title: `Keep your ${hot.s}-${schedOf(hot.h).type === 'weekly' ? 'week' : 'day'} streak 🔥`,
        body: `${hot.h.name} is still open today.` + (more ? ` ${more} more habit${more>1?'s':''} to go.` : '')
      };
    }
    if(pending.length===1) return {title:'One habit left today', body:`${pending[0].name} is still open.`};
    return {title:`${pending.length} habits left today`, body: pending.slice(0,3).map(h=>h.name).join(', ') + (pending.length>3?'…':'')};
  }
  root.LedgerReminder = {dateKey, minutesOf, formatTime, streakOf, bestStreakOf, consistencyOf, scheduleLabel, schedOf, isScheduledOn, isActiveNow, isPausedOn, pendingToday, weekCount, isDue, buildReminder};
})(typeof self!=='undefined' ? self : this);
