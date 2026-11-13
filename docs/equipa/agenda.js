import {barbers} from "../catalog.js";
const barber=document.querySelector("#barber");
const day=document.querySelector("#day");
const status=document.querySelector("#status");
const entries=document.querySelector("#agenda-entries");
const plans=new Map();
const today=new Date();
day.valueAsDate=today;
barber.replaceChildren(...barbers.map(({id,name})=>new Option(name,id)));
function schedule() {
  const key=barber.value+":"+day.value;
  if(!plans.has(key)) {
    const offset=barber.selectedIndex*15;
    plans.set(key,day.value===today.toISOString().slice(0,10)?[
      {start:540+offset,end:585+offset,title:"Corte degradê",client:"Cliente de exemplo 01"},
      {start:660+offset,end:720+offset,title:"Cabelo e barba",client:"Cliente de exemplo 02"},
      {start:870+offset,end:900+offset,title:"Barba completa",client:"Cliente de exemplo 03"}
    ]:[]);
  }
  return plans.get(key);
}
const clock=n=>[Math.floor(n/60),n%60].map(v=>String(v).padStart(2,"0")).join(":");
function render() {
  const slots=schedule();
  entries.replaceChildren();
  if(!slots.length) entries.textContent="Sem marcações de demonstração neste dia.";
  for(const slot of [...slots].sort((a,b)=>a.start-b.start)) {
    const row=document.createElement("article");
    const details=document.createElement("div");
    const title=document.createElement("strong");
    title.textContent=clock(slot.start)+"–"+clock(slot.end)+" · "+slot.title;
    const name=document.createElement("p");
    name.textContent=slot.client;
    details.append(title,name);
    const button=document.createElement("button");
    button.type="button";
    button.className="choice";
    button.textContent=slot.client?"Cancelar":"Desbloquear";
    button.onclick=()=>{
      slots.splice(slots.indexOf(slot),1);
      render();
      status.textContent="Alteração aplicada nesta demonstração.";
    };
    row.append(details,button);
    entries.append(row);
  }
}
barber.onchange=day.onchange=()=>{status.textContent="";render();};
document.querySelector("#block").onsubmit=event=>{
  event.preventDefault();
  if(!day.value) {day.reportValidity();return;}
  const data=new FormData(event.currentTarget);
  const minutes=value=>value.split(":").map(Number).reduce((h,m)=>h*60+m);
  const start=minutes(data.get("start"));
  const end=minutes(data.get("end"));
  const slots=schedule();
  if(start>=end||slots.some(x=>start<x.end&&end>x.start)) {
    status.textContent="Escolhe um período livre com início anterior ao fim.";
    return;
  }
  slots.push({start,end,title:"Período bloqueado",client:""});
  render();
  status.textContent="Período bloqueado nesta demonstração.";
};
render();
