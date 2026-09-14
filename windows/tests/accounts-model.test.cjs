const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../codenotch/ui/accounts-model.js');
const now=1800000000000;
const account=(id,windows,status='ok')=>({id,label:id,snapshot:{status,windows,fetched_at:now}});
test('remaining sort uses the tightest limit including extra windows, without mutating source',()=>{
 const a=account('A',[{used:.1},{used:.9}]),b=account('B',[{used:.5}]),empty=account('C',[]);
 const input=[a,empty,b];assert.deepEqual(M.sorted(input,'remaining',now).map(a=>a.id),['B','A','C']);assert.equal(input[0],a);
});
test('expired reset does not imply fresh capacity or win either sort',()=>{
 const expired=account('expired',[{used:0,resets_at:now-1}]),valid=account('valid',[{used:.9,resets_at:now+100}]);
 assert.equal(M.expired(expired.snapshot.windows[0],now),true);
 for(const mode of ['reset','remaining'])assert.equal(M.sorted([expired,valid],mode,now)[0].id,'valid');
});
test('unknown reset and non-metered data remain unknown, numeric values clamp',()=>{
 assert.equal(M.nextReset(account('x',[{used:.2,resets_at:null}]),now),Infinity);
 assert.equal(M.score(account('x',[{used:.2,count:4},{used:NaN}]),now),-1);
 assert.equal(M.remaining({used:1.2}),0);assert.equal(M.remaining({used:-.2}),100);
});
test('cached errors and aged readings are approximate while a recent healthy reading is fresh',()=>{
 assert.equal(M.stale({status:'error',fetched_at:now},now),true);
 assert.equal(M.stale({status:'ok',fetched_at:now-300001},now),true);
 assert.equal(M.stale({status:'ok',fetched_at:now},now),false);
});
