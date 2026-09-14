(function(root){
 'use strict';const M=root.AccountsModel;
 const icons={sort:'M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4',settings:'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.73v.52a2 2 0 0 1-1 1.73l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.73v-.52a2 2 0 0 1 1-1.73l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',refresh:'M3 12a9 9 0 0 1 15.35-6.35L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.35 6.35L3 16m0 5v-5h5',clock:'M20.75 12a8.75 8.75 0 1 1-17.5 0 8.75 8.75 0 0 1 17.5 0M12 7v5l3.25 2',chevron:'m6 9 6 6 6-6'};
 function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
 function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('focusable','false');svg.setAttribute('aria-hidden','true');const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',icons[name]);svg.append(p);return svg;}
 function button(name,title,action){const n=node('button','cd-icon');n.type='button';n.title=title;n.setAttribute('aria-label',title);n.append(icon(name));n.addEventListener('click',action);return n;}
 function weekly(a){return M.windows(a).find(w=>!w.group&&w.count==null&&/weekly|week|7d/i.test(w.id+' '+w.label)&&!/spark|review/i.test(w.id+' '+w.label))||null;}
 function ordered(accounts,sort,now){const projected=accounts.map(a=>({...a,snapshot:{...a.snapshot,windows:weekly(a)?[weekly(a)]:[]}}));return M.sorted(projected,sort,now).map(p=>accounts.find(a=>a.id===p.id));}
 function render(host,o){
  const ru=o.lang==='ru',t=(a,b)=>ru?b:a,now=Date.now(),prefs=o.preferences||{},fragment=document.createDocumentFragment(),content=node('div','cd-content');
  if(prefs.showHeader||prefs.showActions){
   const header=node('div','cd-header');
   if(prefs.showHeader)header.append(node('span','cd-brand','CODEX'),node('span','cd-count',o.accounts.length));
   header.append(node('span','cd-spacer'));
   if(prefs.showActions)header.append(button('sort',t('Sort: ','Сортировка: ')+(o.sort==='reset'?t('weekly reset','сброс недели'):t('weekly remaining','остаток недели')),o.sortChange),button('settings',t('Settings','Настройки'),o.settings));
   content.append(header);
  }
  const list=node('div','cd-list');
  if(!o.accounts.length)list.append(node('div','cd-empty',t('Sign in to Codex to see your accounts.','Войдите в Codex, чтобы увидеть аккаунты.')));
  for(const a of ordered(o.accounts,o.sort,now)){
   const w=weekly(a),s=a.snapshot||{},row=node('div','cd-row'+(prefs.showActive&&a.active?' active':'')+(prefs.showReset?' has-reset':'')),line=node('div','cd-line'),identity=a.email||a.label||'Codex',name=node('span','cd-name',String(identity).split('@')[0]);
   const pct=w&&M.metered(w)?M.remaining(w):null,approx=w&&(M.stale(s,now)||M.expired(w,now)||w.derived),color=pct==null?'#a3a3a3':pct<=0?'#ff4d40':pct<25?'#ff5921':pct<65?'#ffdc00':'#32c759';
   let status=t('Weekly remaining','Остаток недельного лимита');
   if(s.status==='needsAuth')status=t('Sign in to this profile again. Cached reading.','Войдите в этот профиль повторно. Сохранённые данные.');
   else if(s.status==='error')status=t('Could not refresh. Cached reading.','Не удалось обновить. Сохранённые данные.');
   else if(approx)status=t('Approximate cached reading; refresh pending.','Приблизительные сохранённые данные; ожидается обновление.');
   else if(!w)status=t('Weekly limit unavailable','Недельный лимит недоступен');
   if(s.note)status+=' '+s.note;
   name.title=identity+' · '+status;row.title=name.title;row.setAttribute('aria-label',name.title);
   const bar=node('div','cd-bar'),fill=node('div','cd-fill');fill.style.width=(pct==null?0:pct)+'%';fill.style.background=color;bar.append(fill);
   const value=node('span','cd-percent',pct==null?'—':(approx?'~':'')+Math.round(pct)+'%');value.style.color=color;value.title=status;
   line.append(name);
   const knownPlan=a.plan||(/^(free|plus|pro|team|business|enterprise|edu)\s*·/i.exec(s.note||'')||[])[1];
   if(prefs.showPlan&&knownPlan){const plan=node('span','cd-plan',String(knownPlan).toUpperCase());plan.title=t('Plan','Тариф');line.append(plan);}
   line.append(bar,value);
   const extras=M.windows(a).filter(x=>x!==w);
   if(prefs.showExtras&&extras.length){const disclosure=node('button','cd-expand');disclosure.append(icon('chevron'));disclosure.type='button';disclosure.title=t('Other limits','Другие лимиты');disclosure.setAttribute('aria-label',disclosure.title);disclosure.setAttribute('aria-expanded',String(o.expanded.has(a.id)));disclosure.addEventListener('click',()=>o.expand(a.id));line.append(disclosure);}
   row.append(line);
   if(prefs.showReset){
    const meta=node('div','cd-meta');meta.append(icon('clock'));let reset='—';
    if(w&&Number(w.resets_at)>0)reset=M.expired(w,now)?t('Awaiting reset','Ожидаем сброса'):new Date(w.resets_at).toLocaleString(ru?'ru-RU':'en-GB',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    meta.append(node('span','',s.status==='needsAuth'?t('Sign in again','Войдите повторно'):reset));meta.title=t('Weekly reset','Сброс недельного лимита');row.append(meta);
   }
   list.append(row);
   if(prefs.showExtras&&o.expanded.has(a.id)&&extras.length){const detail=node('div','cd-extra');for(const x of extras){const approximate=M.stale(s,now)||M.expired(x,now)||x.derived;const entry=node('div','cd-extra-line');entry.append(node('span','',(x.group?x.group+' · ':'')+(ru?String(x.label||x.id).replace(/5h limit|5-hour limit/gi,'5 часов').replace(/weekly limit/gi,'Неделя'):x.label||x.id)),node('span','',M.metered(x)?(approximate?'~':'')+Math.round(M.remaining(x))+'%':'—'));detail.append(entry);}list.append(detail);}
  }
  content.append(list);
  if(prefs.showUpdated||prefs.showActions){
   const footer=node('div','cd-footer');footer.append(node('span','cd-spacer'));
   if(prefs.showUpdated){const updated=Math.max(0,...o.accounts.map(a=>Number(a.snapshot?.fetched_at)||0)),time=node('span','cd-time',updated?new Date(updated).toLocaleTimeString(ru?'ru-RU':'en-GB',{hour:'2-digit',minute:'2-digit'}):'—');time.title=t('Last reading','Последние данные');footer.append(time);}
   if(prefs.showActions){const refresh=button('refresh',t('Refresh limits','Обновить лимиты'),o.refresh);refresh.disabled=o.refreshing;footer.append(refresh);}content.append(footer);
  }
  fragment.append(content);host.replaceChildren(fragment);
 }
 root.CodexDrawer={render,weekly,ordered};
})(window);
