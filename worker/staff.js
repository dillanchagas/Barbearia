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
const activate = $("#team-activate");
const mfa = $("#team-mfa");
const recovery = $("#team-recovery");
const inviteBox = $("#team-invite");
const management = $("#team-management");
const operationsPanel = $("#operations");
const operationsForm = $("#operations-filter");
const euros = new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR"});
const accountsForm = $("#accounts-form");
const accountRole = $("#account-role");
const accountsStatus = $("#accounts-status");
const roleNames = {dev:"Desenvolvimento",master:"Master",barber:"Barbeiro"};
const days = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];
let catalog, agenda, viewer, challenge, revision=0, busy=false;
let inviteToken=new URLSearchParams(location.hash.slice(1)).get("convite");
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
    if (body.action==="complete") await loadOperations();
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
    details.append(make("small",row.completed_at ? "Concluído" : row.status==="cancelled" ? "Cancelado" : row.status==="blocked" ?
      "Bloqueado" : row.email_sent ? "E-mail enviado" : "Confirmação por e-mail pendente"));
    entry.append(details);
    if (viewer.role!=="barber"&&row.status!=="cancelled"&&!row.completed_at) {
      const actions = make("div","",{className:"agenda-actions"});
      const cancel = make("button",row.status==="blocked" ? "Desbloquear" : "Cancelar",{type:"button",className:"choice"});
      cancel.onclick = () => {
        if (window.confirm(row.status==="blocked" ? "Retirar este bloqueio?" : "Cancelar esta marcação?")) mutate({action:"cancel",id:row.id});
      };
      actions.append(cancel);
      if (row.status==="booked"&&(date.value<catalog.day||(date.value===catalog.day&&row.ends<=catalog.minute))) {
        const complete=make("button","Concluir serviço",{type:"button",className:"choice"});
        complete.onclick=()=>{
          if(window.confirm("Registar este serviço como concluído?")) mutate({action:"complete",id:row.id});
        };
        actions.append(complete);
      }
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

function accountEditor() {
  accountsForm.reset();
  $("#account-barber-label").hidden=accountRole.value==="master";
}

function showInvite(result,username) {
  const link=new URL("/equipa",location.origin);
  link.hash=new URLSearchParams({convite:result.token});
  $("#team-invite-url").value=link.href;
  $("#team-invite-note").textContent="Partilha em privado com "+username+". O convite vale 24 horas e pode ser usado uma vez.";
  inviteBox.hidden=false;
  $("#team-invite-url").focus();
  $("#team-invite-url").select();
}

function closeInvite() {
  inviteBox.hidden=true;
  $("#team-invite-url").value="";
}

$("#team-invite-close").onclick=closeInvite;
$("#team-invite-copy").onclick=async()=>{
  const input=$("#team-invite-url");
  try {
    await navigator.clipboard.writeText(input.value);
    accountsStatus.textContent="Ligação copiada.";
  } catch {
    input.select();
    accountsStatus.textContent="Copia a ligação selecionada.";
  }
};

async function resendInvite(account) {
  if (!window.confirm("Gerar um novo convite para "+account.username+"? O acesso atual será revogado.")) return;
  try {
    const result=await api("/api/team/accounts",{action:"reinvite",username:account.username});
    showInvite(result,account.username);
    await listAccounts();
  } catch(error){accountsStatus.textContent=error.message;}
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
      if(account.invite_expires) row.append(make("small",account.invite_expires*1000>Date.now()?"Convite pendente":"Convite expirado"));
      if(account.role==="barber"||(account.role==="master"&&viewer.role==="dev")) {
        const actions=make("div","",{className:"agenda-actions"});
        const reset=make("button","Gerar novo convite",{type:"button",className:"choice"});
        reset.onclick=()=>resendInvite(account);
        const remove=make("button","Remover acesso",{type:"button",className:"choice"});
        remove.onclick=async()=>{
          if(!window.confirm("Remover o acesso de "+account.username+"?"))return;
          try {
            await api("/api/team/accounts",{action:"remove",username:account.username});
            closeInvite();
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
accountsForm.onsubmit=async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(accountsForm));
  const button=$("#account-save");
  button.disabled=true;
  accountsStatus.textContent="A guardar…";
  try {
    const result=await api("/api/team/accounts",{...data,action:"invite"});
    accountsStatus.textContent="Convite criado.";
    showInvite(result,data.username.trim().toLowerCase());
    accountEditor();
    await listAccounts();
  } catch(error){accountsStatus.textContent=error.message;}
  finally{button.disabled=false;}
};

let operationsRequest=0;
async function loadOperations(message="") {
  const current=++operationsRequest;
  const notice=$("#operations-status");
  notice.textContent="A consultar…";
  try {
    const filters=new URLSearchParams(new FormData(operationsForm));
    const {stats,clients}=await api("/api/operations?"+filters);
    if(current!==operationsRequest||operationsPanel.hidden) return;
    $("#operations-stats").replaceChildren(...catalog.barbers.map(person=>{
      const row=stats.find(x=>x.barber===person.id);
      const card=make("article","");
      card.append(make("h3",person.name),make("p",(row?.total||0)+" marcações · "+(row?.completed||0)+
        " concluídas · "+(row?.cancelled||0)+" canceladas"),make("p",euros.format((row?.cents||0)/100)+" em serviços concluídos"));
      return card;
    }));
    const list=$("#operations-clients");
    list.replaceChildren();
    if(!clients.length) list.append(make("p","Sem clientes para esta pesquisa."));
    for(const client of clients) {
      const row=make("article","",{className:"team-account"});
      const available=Math.floor(client.completed/10)-client.rewards;
      row.append(make("strong",client.name),make("span",client.email),make("span",
        client.total+" marcações · "+client.completed+" concluídas · "+available+" recompensas disponíveis"),
        make("small","Última marcação em "+client.last_day));
      if(available>0) {
        const redeem=make("button","Registar resgate",{type:"button",className:"choice"});
        redeem.onclick=async()=>{
          if(!window.confirm("Registar a utilização de uma recompensa?")) return;
          redeem.disabled=true;
          try {
            await api("/api/operations",{email:client.email});
            await loadOperations("Recompensa utilizada.");
          } catch(error){notice.textContent=error.message;redeem.disabled=false;}
        };
        row.append(redeem);
      }
      list.append(row);
    }
    notice.textContent=message;
  } catch(error) {
    if(current===operationsRequest) notice.textContent=error.message;
  }
}
operationsForm.onsubmit=event=>{event.preventDefault();loadOperations();};

async function showAccount(account) {
  viewer=account;
  login.hidden=setup.hidden=activate.hidden=mfa.hidden=recovery.hidden=true;
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
  operationsPanel.hidden=!managers;
  if(managers) {
    operationsForm.elements.month.value=catalog.day.slice(0,7);
    loadOperations();
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
  operationsRequest++;
  operationsPanel.hidden=true;
  $("#operations-clients").replaceChildren();
  $("#operations-stats").replaceChildren();
  panel.hidden=management.hidden=$("#team-session").hidden=true;
  login.hidden=setup.hidden=activate.hidden=mfa.hidden=recovery.hidden=true;
  challenge=null;
  $("#mfa-setup-key").value=$("#recovery-code").value="";
  closeInvite();
  $("#agenda-entries").replaceChildren();
  $("#accounts-list").replaceChildren();
  status.textContent="A verificar acesso…";
  try {
    if (inviteToken) {
      activate.hidden=false;
      status.textContent="";
      return;
    }
    const result=await api("/api/team/session");
    if(result.account) await showAccount(result.account);
    else {
      setup.hidden=!result.setup;
      login.hidden=result.setup;
      status.textContent="";
    }
  } catch(error){status.textContent=error.message;}
}

async function handleAccess(result) {
  login.hidden=setup.hidden=activate.hidden=mfa.hidden=recovery.hidden=true;
  status.textContent="";
  if(result.mfa) {
    challenge=result.challenge;
    $("#mfa-setup-key").value=result.setupKey||"";
    $("#mfa-enrollment").hidden=!result.setupKey;
    mfa.hidden=false;
    mfa.elements.code.focus();
    return;
  }
  challenge=null;
  $("#mfa-setup-key").value="";
  if(result.recoveryCode) {
    $("#recovery-code").value=result.recoveryCode;
    recovery.hidden=false;
    $("#recovery-done").onclick=()=>{
      $("#recovery-code").value="";
      return showAccount(result.account);
    };
    return;
  }
  await showAccount(result.account);
}

$("#mfa-back").onclick=()=>session();
for(const [form,action] of [[login,"login"],[setup,"setup"],[activate,"activate"],[mfa,"mfa"]]) {
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector("button");
    button.disabled=true;
    status.textContent="A validar o acesso…";
    try {
      const data=Object.fromEntries(new FormData(form));
      if(action==="activate") data.token=inviteToken;
      if(action==="mfa") data.challenge=challenge;
      const result=await api("/api/team/"+action,data);
      if(action==="activate") {
        inviteToken=null;
        history.replaceState(null,"",location.pathname);
      }
      form.reset();
      await handleAccess(result);
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
