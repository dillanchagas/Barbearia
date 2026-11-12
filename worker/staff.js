const $ = selector => document.querySelector(selector);
const make = (tag,text,props={}) => Object.assign(document.createElement(tag),{textContent:text,...props});
const status = $("#agenda-status");
const panel = $("#agenda-panel");
const barber = $("#agenda-barber");
const date = $("#agenda-date");
const weekday = $("#weekday");
const hours = $("#hours-form");
const login = $("#team-login");
const setup = $("#team-setup");
const management = $("#team-management");
const accountsForm = $("#accounts-form");
const accountRole = $("#account-role");
const accountsStatus = $("#accounts-status");
const roleNames = {dev:"Desenvolvimento",master:"Master",barber:"Barbeiro"};
const days = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];
let catalog, agenda, viewer, resetTarget, revision=0, busy=false;
const time = n => [Math.floor(n/60),n%60].map(x=>String(x).padStart(2,"0")).join(":");
const minutes = text => text ? text.split(":").reduce((a,b)=>a*60+Number(b),0) : null;

async function api(path, body) {
  const response = await fetch(path,body ? {
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  } : {});
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error),{status:response.status});
  return data;
}

function showHours() {
  const windows = agenda?.hours[weekday.value] || [];
  ["a","b","c","d"].forEach((key,i) => {
    const value = windows[Math.floor(i/2)]?.[i%2];
    hours.elements[key].value = value === undefined ? "" : time(value);
  });
}

async function mutate(body) {
  if (busy) return;
  busy = true;
  status.textContent = "A guardar…";
  try {
    await api("/api/staff",{barber:barber.value,...body});
    await load("Alteração guardada.");
  } catch (error) {status.textContent = error.message;}
  finally {busy = false;}
}

function showEntries() {
  const list = $("#agenda-entries");
  list.replaceChildren();
  if (!agenda.entries.length) list.append(make("p","Sem marcações ou bloqueios neste dia."));
  for (const row of agenda.entries) {
    const service = catalog.services.find(x=>x.id===row.service);
    const entry = make("article","");
    const details = make("div","");
    details.append(make("strong",time(row.starts)+"–"+time(row.ends)+" · "+(service?.name||"Bloqueio")));
    if (row.name) details.append(make("p",row.name+" · "+row.email));
    details.append(make("small",row.status==="cancelled" ? "Cancelado" : row.status==="blocked" ?
      "Bloqueado" : row.email_sent ? "E-mail enviado" : "Confirmação por e-mail pendente"));
    entry.append(details);
    if (viewer.role!=="barber"&&row.status!=="cancelled") {
      const actions = make("div","",{className:"agenda-actions"});
      const cancel = make("button",row.status==="blocked" ? "Desbloquear" : "Cancelar",{type:"button",className:"choice"});
      cancel.onclick = () => {
        if (window.confirm(row.status==="blocked" ? "Retirar este bloqueio?" : "Cancelar esta marcação?")) mutate({action:"cancel",id:row.id});
      };
      actions.append(cancel);
      if (row.status==="booked"&&!row.email_sent&&agenda.emailConfigured) {
        const retry = make("button","Enviar confirmação",{type:"button",className:"choice"});
        retry.onclick=()=>mutate({action:"email",id:row.id});
        actions.append(retry);
      }
      entry.append(actions);
    }
    list.append(entry);
  }
}

async function load(message="") {
  const current = ++revision;
  panel.hidden = true;
  status.textContent = "A consultar a agenda…";
  try {
    const result = await api("/api/staff?"+new URLSearchParams({barber:barber.value,day:date.value}));
    if (current!==revision) return;
    agenda = result;
    $("#email-state").textContent = viewer.role==="barber"||agenda.emailConfigured ? "" : "O envio de e-mail ainda precisa de ser configurado.";
    showEntries();
    if(viewer.role!=="barber") showHours();
    panel.hidden = false;
    status.textContent = message;
  } catch (error) {
    if (current!==revision) return;
    if (error.status===401) await session();
    else status.textContent = error.message;
  }
}

$("#block-form").onsubmit = event => {
  event.preventDefault();
  const input = new FormData(event.currentTarget);
  mutate({action:"block",day:date.value,start:minutes(input.get("start")),end:minutes(input.get("end"))});
};
hours.onsubmit = event => {
  event.preventDefault();
  const input = new FormData(hours);
  const windows = [["a","b"],["c","d"]].map(pair=>pair.map(key=>minutes(input.get(key))));
  mutate({action:"hours",weekday:Number(weekday.value),windows:windows.filter(pair=>pair.some(x=>x!==null))});
};
barber.onchange = date.onchange = () => {if(date.value) load();};
weekday.onchange = showHours;

function accountEditor(target=null) {
  resetTarget=target;
  accountsForm.reset();
  const username=accountsForm.elements.username;
  username.value=target?.username||"";
  username.readOnly=!!target;
  accountRole.closest("label").hidden=!!target;
  $("#account-barber-label").hidden=!!target||accountRole.value==="master";
  $("#accounts-title").textContent=target?"Alterar palavra-passe de "+target.username:"Criar conta";
  $("#account-save").textContent=target?"Guardar palavra-passe":"Criar conta";
  $("#account-reset-back").hidden=!target;
  if(target) accountsForm.elements.password.focus();
}

async function listAccounts() {
  try {
    const {accounts}=await api("/api/team/accounts");
    const list=$("#accounts-list");
    list.replaceChildren();
    for(const account of accounts) {
      const row=make("article","",{className:"team-account"});
      const label=roleNames[account.role];
      const person=catalog.barbers.find(x=>x.id===account.barber)?.name;
      row.append(make("strong",account.username),make("span",person?label+" · "+person:label));
      if(account.role==="barber"||(account.role==="master"&&viewer.role==="dev")) {
        const actions=make("div","",{className:"agenda-actions"});
        const reset=make("button","Alterar palavra-passe",{type:"button",className:"choice"});
        reset.onclick=()=>accountEditor(account);
        const remove=make("button","Remover acesso",{type:"button",className:"choice"});
        remove.onclick=async()=>{
          if(!window.confirm("Remover o acesso de "+account.username+"?"))return;
          try {
            await api("/api/team/accounts",{action:"remove",username:account.username});
            accountEditor();
            await listAccounts();
            accountsStatus.textContent="Acesso removido.";
          } catch(error){accountsStatus.textContent=error.message;}
        };
        actions.append(reset,remove);
        row.append(actions);
      }
      list.append(row);
    }
  } catch(error){accountsStatus.textContent=error.message;}
}

accountRole.onchange=()=>{$("#account-barber-label").hidden=accountRole.value==="master";};
$("#account-reset-back").onclick=()=>accountEditor();
accountsForm.onsubmit=async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(accountsForm));
  const button=$("#account-save");
  button.disabled=true;
  accountsStatus.textContent="A guardar…";
  try {
    await api("/api/team/accounts",{...data,action:resetTarget?"reset":"create"});
    accountsStatus.textContent=resetTarget?"Palavra-passe atualizada.":"Conta criada.";
    accountEditor();
    await listAccounts();
  } catch(error){accountsStatus.textContent=error.message;}
  finally{button.disabled=false;}
};

async function showAccount(account) {
  viewer=account;
  login.hidden=setup.hidden=true;
  $("#team-session").hidden=false;
  $("#team-user").textContent=account.username+" · "+roleNames[account.role];
  catalog ||= await api("/api/catalog");
  const managers=account.role!=="barber";
  const people=managers?catalog.barbers:catalog.barbers.filter(x=>x.id===account.barber);
  barber.replaceChildren(...people.map(x=>make("option",x.name,{value:x.id})));
  barber.disabled=!managers;
  weekday.replaceChildren(...days.map((x,i)=>make("option",x,{value:i})));
  date.value=catalog.day;
  weekday.value=new Date(catalog.day).getUTCDay();
  $("#agenda-tools").hidden=!managers;
  management.hidden=!managers;
  if(managers) {
    const roles=account.role==="dev"?["barber","master"]:["barber"];
    accountRole.replaceChildren(...roles.map(x=>make("option",roleNames[x],{value:x})));
    $("#account-barber").replaceChildren(...catalog.barbers.map(x=>make("option",x.name,{value:x.id})));
    accountsStatus.textContent="";
    accountEditor();
    await listAccounts();
  }
  await load();
}

async function session() {
  revision++;
  viewer=null;
  panel.hidden=management.hidden=$("#team-session").hidden=true;
  $("#agenda-entries").replaceChildren();
  $("#accounts-list").replaceChildren();
  status.textContent="A verificar acesso…";
  try {
    const result=await api("/api/team/session");
    if(result.account) await showAccount(result.account);
    else {
      setup.hidden=!result.setup;
      login.hidden=result.setup;
      status.textContent="";
    }
  } catch(error){status.textContent=error.message;}
}

for(const [form,action] of [[login,"login"],[setup,"setup"]]) {
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector("button");
    button.disabled=true;
    status.textContent="A validar o acesso…";
    try {
      const {account}=await api("/api/team/"+action,Object.fromEntries(new FormData(form)));
      form.reset();
      await showAccount(account);
    } catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  };
}

$("#team-logout").onclick=async()=>{
  try {
    await api("/api/team/logout",{});
    await session();
  } catch(error){status.textContent=error.message;}
};
session();
