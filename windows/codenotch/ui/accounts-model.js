/* Pure data helpers shared by the panel and its regression checks. Timestamps are epoch ms. */
(function(root){
  const windows=a=>Array.isArray(a?.snapshot?.windows)?a.snapshot.windows:[];
  const metered=w=>w.count==null && typeof w.used==='number' && Number.isFinite(w.used);
  const remaining=w=>Math.max(0,Math.min(100,(1-w.used)*100));
  const expired=(w,now)=>Number(w.resets_at)>0 && Number(w.resets_at)<=now;
  const stale=(s,now)=>(s?.status&&s.status!=='ok')||(Number(s?.fetched_at)>0 && now-Number(s.fetched_at)>300000);
  const score=(a,now)=>{
    const ws=windows(a).filter(w=>metered(w)&&!expired(w,now));
    return ws.length?Math.min(...ws.map(remaining)):-1;
  };
  const nextReset=(a,now)=>Math.min(...windows(a).map(w=>Number(w.resets_at)).filter(t=>Number.isFinite(t)&&t>now));
  const sorted=(accounts,mode,now)=>accounts.slice().sort((a,b)=>{
    const d=mode==='reset'?nextReset(a,now)-nextReset(b,now):score(b,now)-score(a,now);
    return (Number.isNaN(d)?0:d)||String(a.label||a.id).localeCompare(String(b.label||b.id));
  });
  const model={windows,metered,remaining,expired,stale,score,nextReset,sorted};
  if(typeof module!=='undefined') module.exports=model; else root.AccountsModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);
