import { barbers, services } from "./catalog.js";
import { assets } from "./assets.js";

const zone = "Europe/Lisbon";
const formatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const idPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const barberById = new Map(barbers.map(x => [x.id, x]));
const serviceById = new Map(services.map(x => [x.id, x]));
const json = (value, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store" }
});
const fail = (message, status = 400) => json({ error: message }, status);
const query = (db, sql, ...args) => db.prepare(sql).bind(...args);
const addDays = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const validDay = day => typeof day === "string" && dayPattern.test(day) &&
  Number.isFinite(Date.parse(day)) && addDays(day, 0) === day;
const weekday = day => new Date(day).getUTCDay();
const clock = n => [Math.floor(n / 60), n % 60].map(x => String(x).padStart(2,"0")).join(":");
const validMinute = n => Number.isInteger(n) && n >= 0 && n <= 1440 && n % 15 === 0;

function defaults(index) {
  if (index === 0) return [];
  if (index === 6) return [[480, 840]];
  return [[540, 780], [840, 1200]];
}

function localNow() {
  const [day, time] = formatter.format(new Date()).split(" ");
  const [hour, minute] = time.split(":").map(Number);
  return { day, minute: hour * 60 + minute };
}

function allowedDay(day, now) {
  return validDay(day) && day >= now.day && day <= addDays(now.day, 90);
}

async function availability(db, url) {
  const barber = url.searchParams.get("barber");
  const service = serviceById.get(url.searchParams.get("service"));
  const from = url.searchParams.get("from");
  const now = localNow();
  if (!barberById.has(barber) || !service || !allowedDay(from, now)) return fail("Seleção inválida.");
  const through = addDays(from, 30);
  const [hours, entries] = await db.batch([
    query(db, "SELECT weekday, windows FROM working_hours WHERE barber = ?", barber),
    query(db, "SELECT day, starts, ends FROM appointments WHERE barber = ? AND day BETWEEN ? AND ? AND status != 'cancelled'", barber, from, through)
  ]);
  const windowsByWeekday = new Map(hours.results.map(x => [x.weekday, JSON.parse(x.windows)]));
  const occupiedByDay = new Map();
  for (const row of entries.results) {
    if (!occupiedByDay.has(row.day)) occupiedByDay.set(row.day, []);
    occupiedByDay.get(row.day).push(row);
  }
  const days = {};
  for (let i = 0; i < 31; i++) {
    const day = addDays(from, i);
    if (!allowedDay(day, now)) break;
    const index = weekday(day);
    const occupied = occupiedByDay.get(day) || [];
    days[day] = [];
    for (const [open, close] of windowsByWeekday.get(index) ?? defaults(index)) {
      for (let start = open; start + service.duration <= close; start += 15) {
        if (day === now.day && start <= now.minute) continue;
        if (!occupied.some(x => x.starts < start + service.duration && x.ends > start)) days[day].push(start);
      }
    }
  }
  return json({ days });
}

function receipt(row) {
  return { id: row.id, barber: barberById.get(row.barber).name, service: serviceById.get(row.service).name,
    day: row.day, time: clock(row.starts), emailSent: !!row.email_sent };
}

async function sendConfirmation(env, row) {
  if (row.email_sent || !env.RESEND_API_KEY || !env.BOOKING_FROM) return !!row.email_sent;
  const info = receipt(row);
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json",
        "Idempotency-Key": "pek-confirmation/" + row.id },
      body: JSON.stringify({ from: env.BOOKING_FROM, to: [row.email], subject: "Marcação confirmada · PEK Barbeiro",
        text: ["Olá " + row.name + ",", "", "A tua marcação está confirmada.",
          info.service + " com " + info.barber, info.day + " às " + info.time + " (hora de Lisboa)",
          "Estrada do Algueirão, 10, 2725-019 Algueirão–Mem Martins", "Referência: " + row.id].join("\n") })
    });
    if (!result.ok) return false;
    await query(env.DB, "UPDATE appointments SET email_sent = 1 WHERE id = ?", row.id).run();
    return true;
  } catch {
    return false;
  }
}

async function book(env, body) {
  const { id, barber, day, start } = body;
  const service = serviceById.get(body.service);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const now = localNow();
  if (typeof id !== "string" || !idPattern.test(id) || !barberById.has(barber) || !service ||
      !validDay(day) || !validMinute(start) || name.length < 2 || name.length > 100 ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Confirma os dados da marcação.");
  const db = env.DB;
  const existing = await query(db, "SELECT * FROM appointments WHERE id = ?", id).first();
  if (existing) {
    if (existing.status !== "booked" || existing.email !== email || existing.name !== name ||
        existing.barber !== barber || existing.day !== day || existing.starts !== start ||
        existing.service !== service.id) return fail("Esta referência já foi utilizada.", 409);
    return json(receipt(existing));
  }
  if (!allowedDay(day, now) || (day === now.day && start <= now.minute)) return fail("Este horário já passou.", 409);
  const index = weekday(day);
  const end = start + service.duration;
  const schedule = await query(db, "SELECT windows FROM working_hours WHERE barber = ? AND weekday = ?", barber, index).first();
  if (!(schedule ? JSON.parse(schedule.windows) : defaults(index)).some(([a,b]) => a <= start && end <= b)) {
    return fail("Este horário deixou de estar disponível.", 409);
  }
  const created = await query(db, `INSERT INTO appointments (id, barber, day, starts, ends, service, name, email, status)
    SELECT ?,?,?,?,?,?,?,?,'booked'
    WHERE COALESCE((SELECT windows FROM working_hours WHERE barber = ? AND weekday = ?), '') = ?
    AND NOT EXISTS (SELECT 1 FROM appointments WHERE barber = ? AND day = ? AND status != 'cancelled' AND starts < ? AND ends > ?)
    ON CONFLICT(id) DO NOTHING RETURNING *`,
    id, barber, day, start, end, service.id, name, email, barber, index, schedule?.windows ?? "", barber, day, end, start).first();
  if (!created) {
    const sameRequest = await query(db, "SELECT id FROM appointments WHERE id = ?", id).first();
    if (sameRequest) return book(env, body);
    return fail("O horário já não está disponível. Escolhe outra hora.", 409);
  }
  created.email_sent = await sendConfirmation(env, created);
  return json(receipt(created), 201);
}

async function agenda(env, url, method, body, viewer) {
  const db = env.DB;
  const barber = method === "GET" ? url.searchParams.get("barber") : body.barber;
  if (viewer.role === "barber" && (method !== "GET" || barber !== viewer.barber)) {
    return fail("Só podes consultar a tua agenda.", 403);
  }
  if (!barberById.has(barber)) return fail("Escolhe um barbeiro.");
  if (method === "GET") {
    const day = url.searchParams.get("day");
    if (!validDay(day)) return fail("Escolhe uma data válida.");
    const entriesQuery = query(db, "SELECT id, starts, ends, service, name, email, status, email_sent FROM appointments WHERE barber = ? AND day = ? ORDER BY starts", barber, day);
    if (viewer.role === "barber") return json({entries:(await entriesQuery.all()).results.filter(row=>row.service)});
    const [entries, hours] = await db.batch([
      entriesQuery,
      query(db, "SELECT weekday, windows FROM working_hours WHERE barber = ?", barber)
    ]);
    const saved = new Map(hours.results.map(x => [x.weekday, JSON.parse(x.windows)]));
    return json({ entries: entries.results, hours: Array.from({length:7}, (_, i) => saved.get(i) ?? defaults(i)),
      emailConfigured: !!env.RESEND_API_KEY && !!env.BOOKING_FROM });
  }
  if (body.action === "hours") {
    const { windows, weekday: index } = body;
    if (!Number.isInteger(index) || index < 0 || index > 6 || !Array.isArray(windows) || windows.length > 2 ||
        !windows.every((pair, i) => Array.isArray(pair) && pair.length === 2 &&
          pair.every(validMinute) && pair[0] < pair[1] && (!i || windows[i-1][1] <= pair[0]))) {
      return fail("Indica até dois períodos válidos, em intervalos de 15 minutos.");
    }
    await query(db, "INSERT INTO working_hours VALUES (?,?,?) ON CONFLICT(barber,weekday) DO UPDATE SET windows=excluded.windows",
      barber, index, JSON.stringify(windows)).run();
    return json({ ok: true });
  }
  if (body.action === "block") {
    const { day, start, end } = body;
    if (!validDay(day) || !validMinute(start) || !validMinute(end) || start >= end) return fail("Indica um período válido.");
    const blocked = await query(db, `INSERT INTO appointments (id,barber,day,starts,ends,status)
      SELECT ?,?,?,?,?,'blocked' WHERE NOT EXISTS
      (SELECT 1 FROM appointments WHERE barber = ? AND day = ? AND status != 'cancelled' AND starts < ? AND ends > ?) RETURNING id`,
      crypto.randomUUID(), barber, day, start, end, barber, day, end, start).first();
    return blocked ? json({ ok: true }) : fail("Já existe uma marcação ou bloqueio nesse período.", 409);
  }
  if (body.action === "cancel") {
    const row = await query(db, "UPDATE appointments SET status='cancelled' WHERE id=? AND barber=? AND status!='cancelled' RETURNING id",
      String(body.id), barber).first();
    return row ? json({ ok: true }) : fail("Registo indisponível.", 404);
  }
  if (body.action === "email") {
    const row = await query(db, "SELECT * FROM appointments WHERE id=? AND barber=? AND status='booked'",
      String(body.id), barber).first();
    return row && await sendConfirmation(env, row) ? json({ ok: true }) : fail("Não foi possível enviar o e-mail.", 503);
  }
  return fail("Operação inválida.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;
    const headers = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };
    if (pathname in assets && (method === "GET" || method === "HEAD")) {
      const [contentType, body] = assets[pathname];
      return new Response(method === "HEAD" ? null : body, {
        headers: { ...headers, "Content-Type": contentType, "Cache-Control": "no-cache" }
      });
    }
    if (!pathname.startsWith("/api/")) return new Response("Página indisponível.", { status: 404 });
    if (method === "POST" && (request.headers.get("origin") !== url.origin ||
        !request.headers.get("content-type")?.startsWith("application/json"))) return fail("Pedido inválido.", 403);
    try {
      if (pathname === "/api/catalog" && method === "GET") return json({ barbers, services, ...localNow() });
      if (pathname === "/api/availability" && method === "GET") return await availability(env.DB, url);
      if (pathname === "/api/book" && method === "POST") return await book(env, await request.json() || {});
      if (pathname.startsWith("/api/team/")) return await teamAuth(request,env,url);
      if (pathname === "/api/staff" && (method === "GET" || method === "POST")) {
        const viewer = await sessionAccount(request,env.DB);
        if (!viewer) return fail("Entra com a tua conta da equipa.",401);
        return await agenda(env,url,method,method === "POST" ? await request.json() || {} : {},viewer);
      }
      return fail("Página indisponível.", 404);
    } catch (error) {
      if (error instanceof SyntaxError) return fail("Pedido inválido.");
      console.error(error.name, String(error.message).slice(0,180));
      return fail("A agenda está temporariamente indisponível. Tenta novamente.", 503);
    }
  }
};
