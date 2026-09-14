(function(root){
 'use strict';
 const invoke=(cmd,args)=>root.__TAURI__.core.invoke(cmd,args);
 const state={todos:[],loaded:false,loading:false,draft:'',editing:null,editDraft:'',completed:false,error:'',busy:false,drag:null};
 let host=null,context=null,panel=null;
 const t=(en,ru)=>context?.lang==='ru'?ru:en;
 function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
 function editing(on){context?.onEditing?.(on);}
 function notify(){context?.changed?.();}
 function draw(){if(host&&context?.section==='todos')drawTodos();}
 async function read(){
  if(state.loading)return;state.loading=true;
  try{const result=await invoke('get_todos');state.todos=Array.isArray(result)?result:[];state.loaded=true;}
  catch(e){state.error=String(e?.message||e);}finally{state.loading=false;draw();notify();}
 }
 async function mutate(cmd,args,onSuccess){
  if(state.busy)return;state.busy=true;state.error='';draw();
  try{await invoke(cmd,args);onSuccess?.();await read();}
  catch(e){state.error=String(e?.message||e);}
  finally{state.busy=false;draw();notify();}
 }
 function retainFocus(){
  const active=document.activeElement;
  if(!active||!panel?.contains(active))return null;
  return {key:active.dataset.focus,start:active.selectionStart,end:active.selectionEnd};
 }
 function restoreFocus(focus){
  if(!focus?.key)return;
  const target=panel.querySelector('[data-focus="'+focus.key+'"]');
  if(target){target.focus();if(typeof target.setSelectionRange==='function'&&focus.start!=null)target.setSelectionRange(focus.start,focus.end);}
 }
 function drawTodos(){
  const focus=retainFocus(),p=el('section','cn-module cn-todos');p.setAttribute('aria-label',t('Todos','Дела'));
  const form=el('form','cn-add'),input=el('input','cn-input');input.type='text';input.maxLength=2000;input.value=state.draft;input.placeholder=t('Add a task…','Добавить дело…');input.setAttribute('aria-label',input.placeholder);input.dataset.focus='add';
  input.addEventListener('focus',()=>editing(true));input.addEventListener('blur',()=>editing(state.editing!=null));
  input.addEventListener('input',()=>{state.draft=input.value;});
  form.addEventListener('submit',e=>{e.preventDefault();const text=state.draft.trim();if(!text||state.busy)return;mutate('add_todo',{text},()=>{state.draft='';});});form.append(input);p.append(form);
  if(state.error){const error=el('div','cn-error',state.error);error.setAttribute('role','alert');p.append(error);}
  if(!state.loaded&&!state.error)p.append(el('p','cn-empty',t('Loading…','Загрузка…')));
  const list=el('div','cn-todo-list'),active=state.todos.filter(a=>!a.completed),done=state.todos.filter(a=>a.completed);
  function appendTodo(a){
   const row=el('div','cn-todo'+(a.completed?' done':''));row.draggable=state.editing!==a.id;row.dataset.id=a.id;
   const check=el('input','cn-check');check.type='checkbox';check.checked=!!a.completed;check.disabled=state.busy;check.setAttribute('aria-label',t('Complete: ','Завершить: ')+a.text);
   check.addEventListener('change',()=>mutate('update_todo',{id:a.id,text:null,completed:check.checked}));row.append(check);
   if(state.editing===a.id){
    const edit=el('input','cn-edit');edit.type='text';edit.maxLength=2000;edit.value=state.editDraft;edit.dataset.focus='edit';edit.setAttribute('aria-label',t('Edit task','Изменить дело'));
    edit.addEventListener('input',()=>{state.editDraft=edit.value;});
    edit.addEventListener('focus',()=>editing(true));
    edit.addEventListener('keydown',e=>{
     if(e.key==='Escape'){e.preventDefault();state.editing=null;state.editDraft='';editing(false);draw();notify();}
     if(e.key==='Enter'){e.preventDefault();const text=state.editDraft.trim();if(!text||state.busy)return;mutate('update_todo',{id:a.id,text,completed:null},()=>{state.editing=null;state.editDraft='';editing(false);});}
    });row.append(edit);
   }else{
    const label=el('button','cn-todo-text',a.text);label.type='button';label.title=t('Click to edit · Right-click to delete','Нажмите для правки · Правой кнопкой для удаления');label.disabled=state.busy;
    label.addEventListener('click',()=>{state.editing=a.id;state.editDraft=a.text;editing(true);draw();panel.querySelector('[data-focus="edit"]')?.focus();notify();});row.append(label);
   }
   row.addEventListener('contextmenu',e=>{e.preventDefault();if(state.busy)return;showDelete(row,a);});
   row.addEventListener('dragstart',e=>{if(state.editing){e.preventDefault();return;}state.drag=a.id;e.dataTransfer?.setData('text/plain',a.id);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';editing(true);});
   row.addEventListener('dragover',e=>{if(state.drag&&state.drag!==a.id)e.preventDefault();});
   row.addEventListener('drop',e=>{e.preventDefault();const from=state.drag;state.drag=null;editing(false);if(!from||from===a.id)return;const ids=state.todos.map(x=>x.id),index=ids.indexOf(from);if(index<0)return;ids.splice(index,1);ids.splice(ids.indexOf(a.id),0,from);mutate('reorder_todos',{ids});});
   row.addEventListener('dragend',()=>{state.drag=null;editing(state.editing!=null);});list.append(row);
  }
  active.forEach(appendTodo);
  if(state.loaded&&!active.length)list.append(el('p','cn-empty',t('No open tasks','Открытых дел нет')));
  if(done.length){const toggle=el('button','cn-completed',(state.completed?'⌃ ':'⌄ ')+t('Completed','Завершённые')+' · '+done.length);toggle.type='button';toggle.setAttribute('aria-expanded',String(state.completed));toggle.addEventListener('click',()=>{state.completed=!state.completed;draw();notify();});list.append(toggle);if(state.completed)done.forEach(appendTodo);}
  p.append(list);host.replaceChildren(p);panel=p;restoreFocus(focus);
 }
 function showDelete(row,a){
  panel.querySelector('.cn-delete-menu')?.remove();const menu=el('div','cn-delete-menu'),remove=el('button','cn-delete',t('Delete task','Удалить дело'));remove.type='button';
  remove.addEventListener('click',()=>{editing(false);mutate('delete_todo',{id:a.id},()=>{if(state.editing===a.id){state.editing=null;state.editDraft='';}});});
  const cancel=el('button','cn-cancel',t('Cancel','Отмена'));cancel.type='button';cancel.addEventListener('click',()=>{menu.remove();editing(state.editing!=null);notify();});menu.append(remove,cancel);row.append(menu);editing(true);remove.focus();notify();
 }
 function render(target,o){
  host=target;context=o;
  if(o.section==='todos'){drawTodos();if(!state.loaded&&!state.loading)read();return;}
  if(root.CodenotchLibrary){root.CodenotchLibrary.render(target,o);return;}
  const p=el('section','cn-module');p.append(el('p','cn-empty',t('Loading…','Загрузка…')));host.replaceChildren(p);panel=p;
 }
 root.CodenotchModules={render};
})(window);
