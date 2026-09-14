(function(root){
 'use strict';
 const invoke=(cmd,args)=>root.__TAURI__.core.invoke(cmd,args);
 const state={services:null,memory:null,focus:null,focusDraft:null,section:'now',search:'',folder:'',document:null,service:null,adding:false,configure:false,error:'',status:'',busy:false,serviceDraft:{name:'',url:'',description:''},pathDraft:null};
 let host,options,panel,generation=0,fieldIndex=0;const loading=new Map(),revisions={};
 const t=(en,ru)=>options.lang==='ru'?ru:en;
 function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
 function button(text,fn){const b=el('button','lib-button',text);b.type='button';b.disabled=state.busy;b.addEventListener('click',fn);return b;}
 function changed(){options.changed?.();}
 function field(placeholder,value,update,multiline=false){const input=el(multiline?'textarea':'input','lib-field');input.dataset.focus=placeholder;input.readOnly=state.busy;input.placeholder=placeholder;input.setAttribute('aria-label',placeholder);input.value=value||'';if(multiline)input.rows=4;input.addEventListener('input',()=>update(input.value));input.addEventListener('focus',()=>options.onEditing?.(true));input.addEventListener('blur',()=>options.onEditing?.(false));return input;}
 function focusSnapshot(){const a=document.activeElement;return a&&panel?.contains(a)&&a.dataset.focus?{key:a.dataset.focus,start:a.selectionStart,end:a.selectionEnd}:null;}
 function restoreFocus(f){if(!f)return;const a=[...panel.querySelectorAll('[data-focus]')].find(n=>n.dataset.focus===f.key);if(a){a.focus();if(f.start!=null&&a.setSelectionRange)a.setSelectionRange(f.start,f.end);}}
 async function run(cmd,args,done){
  if(state.busy)return;state.busy=true;state.error='';state.status='';const token=generation;draw();
  try{const result=await invoke(cmd,args);const key={set_focus:'focus',set_memory_root:'memory',add_service:'services',delete_service:'services',get_memory:'memory'}[cmd];if(key)revisions[key]=(revisions[key]||0)+1;if(token===generation||/^(set_focus|set_memory_root|add_service|delete_service)$/.test(cmd))done?.(result);}
  catch(e){if(token===generation)state.error=String(e?.message||e);}
  finally{state.busy=false;draw();}
 }
 function load(key,cmd,section){
  if(loading.has(cmd))return loading.get(cmd);
  const revision=revisions[key]||0;const request=invoke(cmd).then(v=>{if((revisions[key]||0)!==revision)return;state[key]=v;if(options?.section===section)draw();}).catch(e=>{if(options?.section===section){state.error=String(e?.message||e);draw();}}).finally(()=>loading.delete(cmd));
  loading.set(cmd,request);return request;
 }
 async function copy(text){const token=generation;try{await navigator.clipboard.writeText(text);if(token===generation)state.status=t('Copied','Скопировано');}catch{if(token===generation)state.status=t('Select and copy the text','Выделите текст и скопируйте');}if(token===generation)draw();}
 function draw(){if(!host||!options)return;const focus=focusSnapshot(),p=el('section','cn-module');if(state.error){const e=el('div','lib-error',state.error);e.setAttribute('role','alert');p.append(e);}if(state.status)p.append(el('div','lib-status',state.status));if(options.section==='services')services(p);else memory(p);host.replaceChildren(p);panel=p;restoreFocus(focus);changed();}
 function services(p){
  if(state.adding){const form=el('form','lib-form');form.append(field(t('Name','Название'),state.serviceDraft.name,v=>state.serviceDraft.name=v),field('https://…',state.serviceDraft.url,v=>state.serviceDraft.url=v),field(t('Purpose and instructions','Назначение и инструкция'),state.serviceDraft.description,v=>state.serviceDraft.description=v,true));
   const actions=el('div','lib-actions'),save=el('button','lib-button',t('Save','Сохранить'));save.type='submit';save.disabled=state.busy;actions.append(save,button(t('Cancel','Отмена'),()=>{state.adding=false;draw();}));form.append(actions);form.addEventListener('submit',e=>{e.preventDefault();run('add_service',{...state.serviceDraft},rows=>{state.services=rows;state.adding=false;state.serviceDraft={name:'',url:'',description:''};});});p.append(form);return;}
  if(state.service){const s=state.service;p.append(button('‹ '+t('Services','Сервисы'),()=>{state.service=null;draw();}),el('div','lib-title',s.name),el('div','lib-meta',s.url),el('div','lib-description',s.description));const actions=el('div','lib-actions');actions.append(button(t('Copy address','Копировать адрес'),()=>copy(s.url)),button(t('Delete','Удалить'),()=>run('delete_service',{id:s.id},rows=>{state.services=rows;state.service=null;})));p.append(actions);return;}
  const search=field(t('Find a service','Найти сервис'),state.search,v=>{state.search=v;filter();});p.append(search);const list=el('div','lib-body');p.append(list);
  function filter(){list.replaceChildren();const rows=(state.services||[]).filter(s=>(s.name+' '+s.description).toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));for(const s of rows){const row=button('',()=>{state.service=s;draw();});row.classList.add('lib-row');row.style.display='block';row.style.width='100%';row.append(el('span','lib-title',s.name),el('span','lib-meta',s.description||s.url));list.append(row);}if(!rows.length)list.append(el('p','cn-empty',state.services?t('Add the services you use.','Добавьте сервисы, которыми пользуетесь.'):t('Loading…','Загрузка…')));changed();}filter();
  p.append(button('+ '+t('Add service','Добавить сервис'),()=>{state.adding=true;draw();}),el('div','lib-meta',t('Local addresses and instructions.','Локальные адреса и инструкции.')));
 }
 function memory(p){
  const nav=el('nav','lib-tabs');for(const [id,en,ru] of [['now','Now','Сейчас'],['recent','Recent','Последнее'],['knowledge','Knowledge','Знания']]){const b=button(t(en,ru),()=>{generation++;state.section=id;state.document=null;state.configure=false;draw();});b.setAttribute('aria-pressed',String(state.section===id));nav.append(b);}p.append(nav);
  if(state.configure){const f=el('form','lib-form');f.append(field(t('Folder with Markdown notes','Папка с Markdown-заметками'),state.pathDraft??state.memory?.root,v=>state.pathDraft=v));const save=el('button','lib-button',t('Connect folder','Подключить папку'));save.type='submit';save.disabled=state.busy;f.append(save);f.addEventListener('submit',e=>{e.preventDefault();run('set_memory_root',{path:state.pathDraft??state.memory?.root??''},result=>{state.memory=result;state.configure=false;state.folder='';});});p.append(f);return;}
  if(state.section==='now'){const f=el('form','lib-form');f.append(field(t('What matters now?','Что сейчас важно?'),state.focusDraft??state.focus??'',v=>state.focusDraft=v,true));const b=el('button','lib-button',t('Save focus','Сохранить фокус'));b.type='submit';b.disabled=state.busy;f.append(b);f.addEventListener('submit',e=>{e.preventDefault();run('set_focus',{text:state.focusDraft??state.focus??''},text=>{state.focus=text;state.focusDraft=null;state.status=t('Saved locally','Сохранено локально');});});p.append(f,el('p','cn-empty',t('Your local focus.','Ваш текущий фокус, сохранённый на этом ПК.')));return;}
  if(state.document){p.append(button('‹ '+t('Back','Назад'),()=>{state.document=null;draw();}),el('div','lib-title',state.document.title),el('div','lib-meta',state.document.id));const body=el('div','lib-body');body.append(el('pre','lib-read',state.document.text));p.append(body);return;}
  if(!state.memory?.available){p.append(el('p','cn-empty',state.memory?.error||t('Connect a folder with your Markdown notes.','Подключите папку со своими Markdown-заметками.')),button(t('Choose folder path','Указать папку'),()=>{state.configure=true;draw();}));return;}
  const list=el('div','lib-body');
  if(state.section==='recent'){for(const doc of [...state.memory.documents].sort((a,b)=>b.modified-a.modified).slice(0,30))appendDoc(list,doc,true);}
  else {const search=field(t('Search titles and paths','Поиск по названиям и путям'),state.search,v=>{state.search=v;fillKnowledge();});p.append(search);if(state.folder)p.append(button('‹ '+state.folder,()=>{state.folder=state.folder.split('/').slice(0,-1).join('/');draw();}));fillKnowledge();}
  function fillKnowledge(){list.replaceChildren();const q=state.search.toLocaleLowerCase(),folders=new Set();for(const d of state.memory.documents){if(q){if((d.title+' '+d.id).toLocaleLowerCase().includes(q))appendDoc(list,d,false);continue;}const prefix=state.folder?state.folder+'/':'';if(!d.id.startsWith(prefix))continue;const rest=d.id.slice(prefix.length);if(rest.includes('/'))folders.add(rest.split('/')[0]);else appendDoc(list,d,false);}for(const folder of [...folders].sort().reverse())list.prepend(button('› '+folder,()=>{state.folder=state.folder?state.folder+'/'+folder:folder;draw();}));changed();}
  p.append(list);if(!state.memory.documents.length)p.append(el('p','cn-empty',t('No Markdown files in this folder.','В этой папке нет Markdown-файлов.')));if(state.memory.truncated)p.append(el('div','lib-meta',t('Showing a limited index.','Показана ограниченная часть файлов.')));p.append(button(t('Refresh','Обновить'),()=>run('get_memory',{},v=>state.memory=v)),button(t('Change folder','Сменить папку'),()=>{state.configure=true;draw();}));
 }
 function appendDoc(list,doc,date){const b=button('',()=>run('read_memory',{id:doc.id},v=>state.document=v));b.classList.add('lib-row');b.style.display='block';b.style.width='100%';b.append(el('span','lib-title',doc.title),el('span','lib-meta',date?new Date(doc.modified).toLocaleString(options.lang==='ru'?'ru-RU':'en-GB'):doc.id));list.append(b);}
 function render(target,o){
  const switched=options&&options.section!==o.section;if(switched){generation++;state.error='';state.status='';}
  host=target;options=o;draw();
  if(o.section==='services'&&state.services===null)load('services','get_services','services');
  if(o.section==='memory'){if(state.focus===null)load('focus','get_focus','memory');if(state.memory===null)load('memory','get_memory','memory');}
 }
 root.CodenotchLibrary={render};
})(window);
