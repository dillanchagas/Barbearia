const teamCookie = "__Host-pek_team";
const sessionSeconds = 43200;
const encoder = new TextEncoder();
const hex = value => Array.from(new Uint8Array(value), n=>n.toString(16).padStart(2,"0")).join("");
const random = size => hex(crypto.getRandomValues(new Uint8Array(size)));
const digest = async value => hex(await crypto.subtle.digest("SHA-256",encoder.encode(value)));
const epoch = () => Math.floor(Date.now()/1000);
const tokenFrom = request => (request.headers.get("cookie") || "").match(/(?:^|;\s*)__Host-pek_team=([0-9a-f]{64})(?:;|$)/)?.[1];
const makeCookie = (value, seconds) => teamCookie+"="+value+"; Path=/; Max-Age="+seconds+"; HttpOnly; Secure; SameSite=Strict";
const accountView = row => ({username:row.username,role:row.role,barber:row.barber});

async function passwordHash(password,salt) {
  const key = await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:encoder.encode(salt),iterations:100000},key,256));
}

function equalHash(first,second) {
  let diff=first.length^second.length;
  for(let i=0;i<first.length;i++) diff |= first.charCodeAt(i)^second.charCodeAt(i);
  return diff===0;
}

async function sessionAccount(request,db) {
  const token=tokenFrom(request);
  if(!token) return null;
  return query(db,`SELECT a.id,a.username,a.role,a.barber FROM team_accounts a
    JOIN team_sessions s ON s.account=a.id WHERE s.token_hash=? AND s.expires>?`,
    await digest(token),epoch()).first();
}

function teamResponse(value,cookie,status=200) {
  const response=json(value,status);
  response.headers.set("Set-Cookie",cookie);
  return response;
}

async function startTeamSession(db, account) {
  const token=random(32);
  const [, insertion]=await db.batch([
    query(db,"DELETE FROM team_sessions WHERE expires <= ?",epoch()),
    query(db,`INSERT INTO team_sessions SELECT ?,id,? FROM team_accounts
      WHERE id=? AND (? IS NULL OR password_hash=?) RETURNING account`,
      await digest(token),epoch()+sessionSeconds,account.id,account.password_hash??null,account.password_hash??null)
  ]);
  if(!insertion.results.length) return fail("Utilizador ou palavra-passe inválidos.",401);
  return teamResponse({account:accountView(account)},makeCookie(token,sessionSeconds));
}

function credentials(body) {
  const username=typeof body.username==="string"?body.username.trim().toLowerCase():"";
  const password=typeof body.password==="string"?body.password:"";
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)&&password.length>=12&&password.length<=128
    ? {username,password} : null;
}

async function setupAllowed(request,env) {
  const email=request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if(!email||!request.headers.get("oai-authenticated-user-id")||
     email!==(env.STAFF_EMAILS||"").split(",")[0].trim().toLowerCase()) return false;
  return !await query(env.DB,"SELECT id FROM team_accounts WHERE role='dev'").first();
}

async function createTeamAccount(db, data, role, barber=null) {
  const salt=random(24);
  return query(db,`INSERT INTO team_accounts (id,username,role,barber,salt,password_hash)
    VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id,username,role,barber`,
    crypto.randomUUID(),data.username,role,barber,salt,await passwordHash(data.password,salt)).first();
}

async function attemptLogin(request,db,data) {
  if(!data) return fail("Utilizador ou palavra-passe inválidos.",401);
  const ip=request.headers.get("cf-connecting-ip")||"unknown";
  const now=epoch();
  const increment=`INSERT INTO team_attempts VALUES (?,1,?)
    ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires<=? THEN 1 ELSE attempts+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING attempts`;
  const keys=await Promise.all([digest("ip:"+ip),digest("user:"+data.username)]);
  const limits=await db.batch(keys.map(key=>query(db,increment,key,now+900,now,now)));
  if(limits[0].results[0].attempts>40||limits[1].results[0].attempts>10) return fail("Demasiadas tentativas. Tenta novamente mais tarde.",429);
  const account=await query(db,"SELECT * FROM team_accounts WHERE username=?",data.username).first();
  const calculated=await passwordHash(data.password,account?.salt||"0".repeat(48));
  if(!equalHash(calculated,account?.password_hash||"0".repeat(64))||!account) {
    return fail("Utilizador ou palavra-passe inválidos.",401);
  }
  await db.batch([
    query(db,"DELETE FROM team_attempts WHERE expires <= ?",now),
    query(db,"DELETE FROM team_attempts WHERE id=?",keys[1])
  ]);
  return startTeamSession(db,account);
}

async function teamAuth(request,env,url) {
  const {pathname}=url;
  const db=env.DB;
  const method=request.method;
  if(pathname==="/api/team/session"&&method==="GET") {
    const account=await sessionAccount(request,db);
    return json({account:account?accountView(account):null,setup:!account&&await setupAllowed(request,env)});
  }
  if(method==="POST"&&pathname==="/api/team/logout") {
    const token=tokenFrom(request);
    if(token) await query(db,"DELETE FROM team_sessions WHERE token_hash=?",await digest(token)).run();
    return teamResponse({ok:true},makeCookie("",0));
  }
  if(method==="POST"&&pathname==="/api/team/login") return attemptLogin(request,db,credentials(await request.json()||{}));
  if(method==="POST"&&pathname==="/api/team/setup") {
    if(!await setupAllowed(request,env)) return fail("Configuração indisponível.",403);
    const data=credentials(await request.json()||{});
    if(!data) return fail("Usa um utilizador válido e uma palavra-passe com pelo menos 12 caracteres.");
    const account=await createTeamAccount(db,data,"dev");
    return account?startTeamSession(db,account):fail("A conta de desenvolvimento já existe.",409);
  }
  if(pathname!=="/api/team/accounts") return fail("Página indisponível.",404);
  const viewer=await sessionAccount(request,db);
  if(!viewer||viewer.role==="barber") return fail("Acesso reservado à gestão.",403);
  if(method==="GET") {
    const result=await query(db,"SELECT username,role,barber FROM team_accounts ORDER BY role,username").all();
    return json({accounts:result.results});
  }
  if(method!=="POST") return fail("Operação inválida.",405);
  const body=await request.json()||{};
  const data=credentials(body);
  if(body.action==="remove"||body.action==="reset") {
    const target=await query(db,"SELECT id,role FROM team_accounts WHERE username=?",String(body.username)).first();
    if(!target||target.role==="dev"||(target.role==="master"&&viewer.role!=="dev")) return fail("Conta indisponível.",404);
    if(body.action==="remove") {
      await db.batch([query(db,"DELETE FROM team_sessions WHERE account=?",target.id),
        query(db,"DELETE FROM team_accounts WHERE id=?",target.id)]);
    } else {
      if(!data) return fail("A palavra-passe deve ter entre 12 e 128 caracteres.");
      const salt=random(24);
      await db.batch([query(db,"UPDATE team_accounts SET salt=?,password_hash=? WHERE id=?",
        salt,await passwordHash(data.password,salt),target.id),
        query(db,"DELETE FROM team_sessions WHERE account=?",target.id)]);
    }
    return json({ok:true});
  }
  if(!data) return fail("Usa um utilizador válido e uma palavra-passe com pelo menos 12 caracteres.");
  const role=body.role;
  if((role!=="master"&&role!=="barber")||(role==="master"&&viewer.role!=="dev")||
     (role==="barber"&&!barberById.has(body.barber))) return fail("Escolhe um perfil válido.",403);
  const result=await createTeamAccount(db,data,role,role==="barber"?body.barber:null);
  return result?json({account:accountView(result)},201):fail("O utilizador ou perfil já tem uma conta.",409);
}
