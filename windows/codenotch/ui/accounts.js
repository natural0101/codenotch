'use strict';
const M=window.AccountsModel,invoke=window.__TAURI__.core.invoke,listen=window.__TAURI__.event.listen;
const $=id=>document.getElementById(id), t=(en,ru)=>lang==='ru'?ru:en;
let lang='en',accounts=[],refreshing=false,refreshTimer=null;
const sort=$('sort');try{sort.value=localStorage.getItem('codenotch.accounts.sort')==='reset'?'reset':'remaining';}catch{}
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=String(text);return node;}
function date(value){return new Date(Number(value)).toLocaleString(lang==='ru'?'ru-RU':'en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function error(e){$('error').textContent=t('Could not update accounts: ','Не удалось обновить аккаунты: ')+String(e?.message||e);$('error').hidden=false;}
function copy(){document.documentElement.lang=lang;document.title=t('Codex accounts','Аккаунты Codex');$('title').textContent=t('Accounts','Аккаунты');$('subtitle').textContent=t('Codex limits across your local profiles.','Лимиты Codex в ваших локальных профилях.');$('refresh').textContent=refreshing?t('Refreshing…','Обновление…'):t('Refresh','Обновить');$('sort-label').textContent=t('Sort by','Сортировка');$('sort-remaining').textContent=t('Most remaining','Больше остаток');$('sort-reset').textContent=t('Nearest reset','Ближайший сброс');$('empty').textContent=t('No Codex profiles found. Sign in with Codex in your default profile or an additional ~/.codex-* profile, then refresh.','Профили Codex не найдены. Войдите через Codex в основном профиле или дополнительном профиле ~/.codex-*, затем обновите данные.');$('footnote').textContent=t('Remaining sort uses the tightest available limit. ~ marks cached or estimated readings, including a reset awaiting confirmation. The primary account is the default profile; it does not identify a running Codex session.','Сортировка по остатку учитывает самый строгий доступный лимит. ~ означает сохранённые или расчётные данные, в том числе сброс без подтверждения. Основной аккаунт — профиль по умолчанию, а не указание на запущенный сеанс Codex.');$('accounts').setAttribute('aria-label',t('Codex accounts','Аккаунты Codex'));}
function render(){
  copy();const now=Date.now(),fragment=document.createDocumentFragment();
  for(const a of M.sorted(accounts,sort.value,now)){
    const s=a.snapshot||{},article=el('article','account'),head=el('div','account-head'),identity=el('div');
    identity.append(el('h2','',a.label||a.email||t('Codex profile','Профиль Codex')));
    if(a.email&&a.email!==a.label)identity.append(el('p','email',a.email));head.append(identity);
    if(a.active)head.append(el('span','badge',t('Primary account','Основной аккаунт')));article.append(head);
    const ws=M.windows(a),metrics=el('div','metrics');
    for(const w of ws){
      const item=el('section','metric'),approx=M.stale(s,now)||M.expired(w,now)||w.derived;
      const label=String(w.label||w.id||'');
      const localized=lang==='ru'?label.replace(/5h limit|5[- ]Hour Limit|5-hour Limit|Current session/gi,'Лимит на 5 часов').replace(/Weekly Limit|Weekly limit/gi,'Недельный лимит'):label;
      item.append(el('div','metric-label',(w.group?w.group+' · ':'')+localized));
      const value=el('div','value');
      if(M.metered(w)){const pct=M.remaining(w);value.append(el('span','',(approx?'~':'')+Math.round(pct)+'%'),el('small','',t('remaining','осталось')));item.append(value);const track=el('div','track'),fill=el('div','fill');fill.style.width=pct+'%';fill.style.background=pct<=20?'#ed9386':pct<=50?'#d3c17b':'#83c9aa';track.append(fill);item.append(track);}
      else{value.textContent=w.count!=null?String(w.count):'—';item.append(value);}
      item.append(el('div','reset',Number(w.resets_at)>0?(M.expired(w,now)?t('Reset awaiting update','Сброс: ожидаем обновления'):t('Resets ','Сброс ')+date(w.resets_at)):t('Reset time unavailable','Время сброса недоступно')));metrics.append(item);
    }
    if(ws.length)article.append(metrics);
    if(!ws.length||s.status==='needsAuth'||s.status==='error'||s.status==='stale')article.append(el('p','status',s.status==='needsAuth'?t('Sign in to this Codex profile again.','Войдите в этот профиль Codex повторно.'):s.note||t('Waiting for the first reading.','Ожидаем первых данных.')));
    article.append(el('div','updated',Number(s.fetched_at)>0?(M.stale(s,now)?'~ ':'')+t('Updated ','Обновлено ')+date(s.fetched_at):t('No readings yet','Данных пока нет')));fragment.append(article);
  }
  // Only replace cards: refresh and sort retain their DOM identity and keyboard focus.
  $('accounts').replaceChildren(fragment);$('empty').hidden=accounts.length>0;$('count').textContent=String(accounts.length);
}
sort.addEventListener('change',()=>{try{localStorage.setItem('codenotch.accounts.sort',sort.value);}catch{}render();});
function endRefresh(){refreshing=false;clearTimeout(refreshTimer);$('refresh').disabled=false;copy();}
$('refresh').addEventListener('click',async()=>{
  if(refreshing)return;refreshing=true;$('refresh').disabled=true;$('error').hidden=true;copy();
  refreshTimer=setTimeout(()=>{endRefresh();error(t('The refresh is still pending. Cached readings remain visible.','Обновление ещё не завершено. Показаны сохранённые данные.'));},60000);
  try{await invoke('refresh_usage');}catch(e){endRefresh();error(e);}
});
async function boot(){try{await listen('codex_accounts',e=>{if(Array.isArray(e.payload)){accounts=e.payload;endRefresh();render();}});await listen('state',e=>{lang=e.payload?.lang_resolved==='ru'?'ru':'en';render();});const state=await invoke('get_state');lang=state?.lang_resolved==='ru'?'ru':'en';const result=await invoke('get_codex_accounts');accounts=Array.isArray(result)?result:[];render();}catch(e){render();error(e);}}
boot();setInterval(render,30000);
