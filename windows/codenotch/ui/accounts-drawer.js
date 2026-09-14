(function(root){
 'use strict';const M=root.AccountsModel;
 const icons={sort:'M5 3v10m-3-3 3 3 3-3M11 13V3m-3 3 3-3 3 3',settings:'M6 2h4l.5 2 2 .8 1.5 3.2-1.5 3.2-2 .8-.5 2H6l-.5-2-2-.8L2 8l1.5-3.2 2-.8Z M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0',refresh:'M13 6a5 5 0 0 0-8-2L2 6m0-4v4h4M3 10a5 5 0 0 0 8 2l3-2m0 4v-4h-4',clock:'M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0M8 4v4l3 2'};
 function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
 function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('aria-hidden','true');const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',icons[name]);svg.append(p);return svg;}
 function button(name,title,action){const n=node('button','cd-icon');n.type='button';n.title=title;n.setAttribute('aria-label',title);n.append(icon(name));n.addEventListener('click',action);return n;}
 function weekly(a){return M.windows(a).find(w=>!w.group&&w.count==null&&/weekly|week|7d/i.test(w.id+' '+w.label)&&!/spark|review/i.test(w.id+' '+w.label))||null;}
 function ordered(accounts,sort,now){const projected=accounts.map(a=>({...a,snapshot:{...a.snapshot,windows:weekly(a)?[weekly(a)]:[]}}));return M.sorted(projected,sort,now).map(p=>accounts.find(a=>a.id===p.id));}
 function render(host,o){
  const ru=o.lang==='ru',t=(a,b)=>ru?b:a,now=Date.now(),fragment=document.createDocumentFragment();
  const header=node('div','cd-header');header.append(node('span','cd-brand','CODEX'),node('span','cd-count',o.accounts.length),node('span','cd-spacer'));
  header.append(button('sort',t('Sort: ','Сортировка: ')+(o.sort==='reset'?t('weekly reset','сброс недели'):t('weekly remaining','остаток недели')),o.sortChange),button('settings',t('Settings','Настройки'),o.settings));fragment.append(header);
  const list=node('div','cd-list');
  if(!o.accounts.length)list.append(node('div','cd-empty',t('Sign in to Codex to see your accounts.','Войдите в Codex, чтобы увидеть аккаунты.')));
  for(const a of ordered(o.accounts,o.sort,now)){
   const w=weekly(a),s=a.snapshot||{},row=node('div','cd-row'+(a.active?' active':'')),line=node('div','cd-line'),name=node('span','cd-name',String(a.email||a.label||'Codex').split('@')[0]);name.title=a.email||a.label||'Codex';
   const bar=node('div','cd-bar'),fill=node('div','cd-fill'),pct=w&&M.metered(w)?M.remaining(w):null,approx=w&&(M.stale(s,now)||M.expired(w,now)||w.derived),color=pct==null?'#a3a3a3':pct<=0?'#ff4d40':pct<25?'#ff5921':pct<65?'#ffdc00':'#32c759';
   fill.style.width=(pct==null?0:pct)+'%';fill.style.background=color;bar.append(fill);const value=node('span','cd-percent',pct==null?'—':(approx?'~':'')+Math.round(pct)+'%');value.style.color=color;value.title=t('Weekly remaining','Остаток недельного лимита');
   const knownPlan=a.plan||(/^(free|plus|pro|team|business|enterprise|edu)\s*·/i.exec(s.note||'')||[])[1];const plan=node('span','cd-plan',knownPlan?String(knownPlan).toUpperCase():'—');plan.title=t('Plan','Тариф');line.append(name,plan,bar,value);row.append(line);
   const meta=node('div','cd-meta');meta.append(icon('clock'));
   let reset='—';if(w&&Number(w.resets_at)>0)reset=M.expired(w,now)?t('Awaiting reset','Ожидаем сброса'):new Date(w.resets_at).toLocaleString(ru?'ru-RU':'en-GB',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
   meta.append(node('span','',s.status==='needsAuth'?t('Sign in again','Войдите повторно'):reset));meta.title=t('Weekly reset','Сброс недельного лимита');const subscription=node('span','cd-subscription','▦ —');subscription.title=t('Subscription end unknown','Дата окончания подписки недоступна');const credits=node('span','cd-credits','↻ —');credits.title=t('Reset credits unknown','Доступные сбросы неизвестны');meta.append(subscription,credits);
   const extras=M.windows(a).filter(x=>x!==w);if(extras.length){const disclosure=node('button','cd-expand',o.expanded.has(a.id)?'⌃':'⌄');disclosure.type='button';disclosure.title=t('Other limits','Другие лимиты');disclosure.setAttribute('aria-label',disclosure.title);disclosure.setAttribute('aria-expanded',String(o.expanded.has(a.id)));disclosure.addEventListener('click',()=>o.expand(a.id));meta.append(disclosure);}row.append(meta);list.append(row);
   if(o.expanded.has(a.id)&&extras.length){const detail=node('div','cd-extra');for(const x of extras){const approxExtra=M.stale(s,now)||M.expired(x,now)||x.derived;const entry=node('div','cd-extra-line');entry.append(node('span','',(x.group?x.group+' · ':'')+(ru?String(x.label||x.id).replace(/5h limit|5-hour limit/gi,'5 часов').replace(/weekly limit/gi,'Неделя'):x.label||x.id)),node('span','',M.metered(x)?(approxExtra?'~':'')+Math.round(M.remaining(x))+'%':'—'));detail.append(entry);}list.append(detail);}
  }
  fragment.append(list);const footer=node('div','cd-footer'),updated=Math.max(0,...o.accounts.map(a=>Number(a.snapshot?.fetched_at)||0));const time=node('span','cd-time',updated?new Date(updated).toLocaleTimeString(ru?'ru-RU':'en-GB',{hour:'2-digit',minute:'2-digit'}):'—');time.title=t('Last reading','Последние данные');footer.append(node('span','cd-spacer'),time);const refresh=button('refresh',t('Refresh limits','Обновить лимиты'),o.refresh);refresh.disabled=o.refreshing;footer.append(refresh);fragment.append(footer);host.replaceChildren(fragment);
 }
 root.CodexDrawer={render,weekly,ordered};
})(window);
