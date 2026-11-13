import {barbers,services} from "./catalog.js";
const $ = (selector, root = document) => root.querySelector(selector);
const make = (tag, value, props = {}) => Object.assign(document.createElement(tag), {textContent:value, ...props});
const form = $("#booking-form");
const status = $("#booking-status");
const steps = [...form.querySelectorAll("fieldset")];
const serviceSelect = $("#service");
const barberList = $("#barber-list");
const timeList = $("#time-list");
const calendar = $("#calendar");
const dateFormat = new Intl.DateTimeFormat("pt-PT", {dateStyle:"full",timeZone:"UTC"});
const monthFormat = new Intl.DateTimeFormat("pt-PT", {month:"long",year:"numeric",timeZone:"UTC"});
const dayString = date => date.toISOString().slice(0,10);
const addDays = (day, n) => dayString(new Date(Date.parse(day) + n * 86400000));
const clock = n => [Math.floor(n/60), n%60].map(x=>String(x).padStart(2,"0")).join(":");
const monthStart = (day, delta = 0) => {
  const date = new Date(day);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return dayString(date);
};
let catalog, step = 0, barber, day, start, month, days, sequence = 0, pending = false;
let id = crypto.randomUUID();

async function api(path, body) {
  const today = dayString(new Date());
  if (path === "/api/catalog") return {barbers,services,day:today};
  if (path === "/api/book") {
    return {
      id:"DEMO-001", day:body.day, time:clock(body.start), emailSent:false,
      service:services.find(x=>x.id===body.service).name,
      barber:barbers.find(x=>x.id===body.barber).name
    };
  }
  const params=new URLSearchParams(path.split("?")[1]);
  const from=params.get("from");
  const offset=barbers.findIndex(x=>x.id===params.get("barber"))*15;
  const days={};
  for(let i=0;i<31;i++) {
    const day=addDays(from,i);
    if (day>addDays(today,90)) break;
    const weekday=new Date(day).getUTCDay();
    days[day]=weekday===0?[]:weekday===6?[540+offset,600+offset]:[540+offset,630+offset,870+offset,990+offset];
  }
  return {days};
}
function show(index, focus = true) {
  step = index;
  status.textContent = "";
  steps.forEach((field, i) => {field.hidden = index !== i; field.disabled = index !== i;});
  document.querySelectorAll("#booking-steps li").forEach((item, i) => {
    if (i === index) item.setAttribute("aria-current","step");
    else item.removeAttribute("aria-current");
  });
  if (focus) steps[index]?.querySelector("legend").focus();
}

function optionButton(label, action, selected = false) {
  const button = make("button", label, {type:"button", className:"choice"});
  button.setAttribute("aria-pressed", String(selected));
  button.addEventListener("click", action);
  return button;
}

function drawCalendar() {
  const offset = (new Date(month).getUTCDay() + 6) % 7;
  const end = monthStart(month,1);
  $("#month-label").textContent = monthFormat.format(new Date(month));
  $("#prev-month").disabled = month <= monthStart(catalog.day);
  $("#next-month").disabled = end > addDays(catalog.day,90);
  calendar.replaceChildren(...["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(x=>make("span",x)));
  for (let i=0;i<offset;i++) calendar.append(make("span",""));
  for (let date=month;date<end;date=addDays(date,1)) {
    const button = optionButton(String(Number(date.slice(-2))), () => {
      day = date;
      drawCalendar();
      drawTimes();
      $("#hours-heading").focus();
    },date===day);
    button.disabled = !days?.[date]?.length;
    button.setAttribute("aria-label", dateFormat.format(new Date(date)));
    calendar.append(button);
  }
}

function drawTimes() {
  timeList.replaceChildren();
  $("#hours-heading").textContent = day ? dateFormat.format(new Date(day)) : "Escolhe um dia para ver as horas";
  for (const minute of days?.[day] || []) {
    timeList.append(optionButton(clock(minute), () => {
      start = minute;
      const service = catalog.services.find(x=>x.id===serviceSelect.value);
      $("#booking-summary").textContent = service.name + " · " + barber.name + " · " +
        dateFormat.format(new Date(day)) + " às " + clock(start) + " · " + service.price + " €";
      show(3);
    }));
  }
}

async function loadMonth() {
  const current = ++sequence;
  days = null;
  day = null;
  drawCalendar();
  drawTimes();
  status.textContent = "A consultar a agenda…";
  try {
    const from = month < catalog.day ? catalog.day : month;
    const result = await api("/api/availability?" + new URLSearchParams({
      barber:barber.id, service:serviceSelect.value, from
    }));
    if (current !== sequence || step !== 2) return;
    days = result.days;
    const hasAvailability = Object.entries(days).some(([date, slots]) => date.startsWith(month.slice(0,7)) && slots.length);
    status.textContent = hasAvailability ? "" : "Sem horários disponíveis neste mês.";
    drawCalendar();
  } catch (error) {
    if (current === sequence && step === 2) status.textContent = error.message;
  }
}

function chooseService() {
  if (!serviceSelect.reportValidity()) return;
  barberList.replaceChildren(...catalog.barbers.map(person=>optionButton(person.name + "  ↗", () => {
    barber = person;
    month = monthStart(catalog.day);
    show(2);
    loadMonth();
  })));
  show(1);
}

$("#service-next").onclick = chooseService;
for (const button of document.querySelectorAll("[data-back]")) {
  button.onclick = () => {
    if (pending) return;
    sequence++;
    show(Number(button.dataset.back));
  };
}
for (const [selector, delta] of [["#prev-month",-1],["#next-month",1]]) {
  $(selector).onclick = () => {month = monthStart(month,delta); loadMonth();};
}
for (const link of document.querySelectorAll("[data-service]")) {
  link.onclick = () => {
    if (!catalog || pending) return;
    $("#booking-result").hidden = true;
    form.hidden = false;
    serviceSelect.value = link.dataset.service;
    show(0, false);
    chooseService();
  };
}

form.onsubmit = async event => {
  event.preventDefault();
  if (pending || step !== 3) return;
  pending = true;
  const submit = $("#booking-submit");
  submit.disabled = true;
  status.textContent = "A guardar a marcação…";
  try {
    const result = await api("/api/book", {id,barber:barber.id,service:serviceSelect.value,day,start,
      name:$("#client-name").value,email:$("#client-email").value});
    $("#receipt-summary").textContent = result.service + " · " + result.barber + " · " +
      dateFormat.format(new Date(result.day)) + " às " + result.time;
    $("#receipt-reference").textContent = "Referência " + result.id;
    $("#receipt-email").textContent = result.emailSent ? "Enviámos a confirmação por e-mail." :
      "A simulação terminou. Nenhuma marcação foi criada.";
    form.hidden = true;
    status.textContent = "";
    $("#booking-result").hidden = false;
    $("#receipt-title").focus();
    id = crypto.randomUUID();
    form.reset();
  } catch (error) {
    if (error.status === 409) {
      id = crypto.randomUUID();
      show(2);
      await loadMonth();
    }
    status.textContent = error.message;
  } finally {
    pending = false;
    submit.disabled = false;
  }
};

$("#booking-reset").onclick = () => {
  $("#booking-result").hidden = true;
  form.hidden = false;
  show(0);
};

async function init() {
  try {
    catalog = await api("/api/catalog");
    for (const item of catalog.services) {
      serviceSelect.append(make("option", item.name + " · " + item.price + " €", {value:item.id}));
    }
    form.hidden = false;
    show(0, false);
  } catch (error) {status.textContent = error.message || "Não foi possível abrir as marcações.";}
}
init();
