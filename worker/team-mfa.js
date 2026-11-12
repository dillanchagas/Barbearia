const teamTokenPattern = /^[a-f0-9]{64}$/;
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function mfaBytes(value) {
  return Uint8Array.from(value.match(/../g), x => Number.parseInt(x,16));
}

function base32Encode(bytes) {
  let buffer=0, bits=0, encoded="";
  for (const byte of bytes) {
    buffer=(buffer<<8)|byte;
    bits+=8;
    while(bits>=5) {
      bits-=5;
      encoded+=base32Alphabet[(buffer>>bits)&31];
    }
  }
  return bits ? encoded+base32Alphabet[(buffer<<(5-bits))&31] : encoded;
}

function mfaKey(env) {
  if (!teamTokenPattern.test(env.TEAM_MFA_KEY || "")) throw new Error("Missing MFA key");
  return crypto.subtle.importKey("raw",mfaBytes(env.TEAM_MFA_KEY),"AES-GCM",false,["encrypt","decrypt"]);
}

async function sealMfa(env,bytes,accountId) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode(accountId)},await mfaKey(env),bytes);
  return hex(iv)+hex(encrypted);
}

async function openMfa(env,value,accountId) {
  return crypto.subtle.decrypt({name:"AES-GCM",iv:mfaBytes(value.slice(0,24)),additionalData:encoder.encode(accountId)},
    await mfaKey(env),mfaBytes(value.slice(24)));
}

async function matchingMfaStep(bytes,code,now) {
  const key=await crypto.subtle.importKey("raw",bytes,{name:"HMAC",hash:"SHA-1"},false,["sign"]);
  const step=Math.floor(now/30);
  for (const offset of [0,-1,1]) {
    const counter=new DataView(new ArrayBuffer(8));
    counter.setBigUint64(0,BigInt(step+offset));
    const signature=new DataView(await crypto.subtle.sign("HMAC",key,counter));
    const position=signature.getUint8(signature.byteLength-1)&15;
    const expected=String((signature.getUint32(position)&0x7fffffff)%1000000).padStart(6,"0");
    if (equalHash(expected,code)) return step+offset;
  }
  return null;
}

async function beginTeamMfa(env,account) {
  const db=env.DB;
  const token=random(32);
  const secret=account.mfa_secret?null:crypto.getRandomValues(new Uint8Array(20));
  const encrypted=secret?await sealMfa(env,secret,account.id):null;
  const now=epoch();
  const [, insertion]=await db.batch([
    query(db,"DELETE FROM team_challenges WHERE expires<=?",now),
    query(db,`INSERT INTO team_challenges (token_hash,account,password_hash,expires,enrollment_secret)
      SELECT ?,id,password_hash,?,? FROM team_accounts WHERE id=? AND password_hash=? AND invite_hash IS NULL
      RETURNING account`,await digest(token),now+300,encrypted,account.id,account.password_hash)
  ]);
  if (!insertion.results.length) return fail("Inicia sessão novamente.",401);
  return json({mfa:true,challenge:token,setupKey:secret?base32Encode(secret):null});
}

async function verifyTeamMfa(env,body) {
  const {challenge}=body;
  const code=typeof body.code==="string"?body.code.trim().toLowerCase():"";
  if (typeof challenge!=="string" || !teamTokenPattern.test(challenge) ||
      !/^(?:\d{6}|[a-f0-9]{32})$/.test(code)) return fail("Introduz um código válido.");
  const db=env.DB;
  const tokenHash=await digest(challenge);
  const now=epoch();
  const claimed=await query(db,`UPDATE team_challenges SET attempts=attempts+1
    WHERE token_hash=? AND expires>? AND attempts<5 RETURNING *`,tokenHash,now).first();
  if (!claimed) return fail("O pedido expirou ou atingiu o limite de tentativas. Entra novamente.",410);
  const account=await query(db,`SELECT * FROM team_accounts WHERE id=? AND password_hash=? AND invite_hash IS NULL`,
    claimed.account,claimed.password_hash).first();
  if (!account || account.role==="barber" || (!!claimed.enrollment_secret===!!account.mfa_secret)) {
    return fail("Inicia sessão novamente.",410);
  }
  const attemptKey=await digest("mfa:"+account.id);
  const limit=await query(db,`INSERT INTO team_attempts VALUES (?,1,?)
    ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires<=? THEN 1 ELSE attempts+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING attempts`,
    attemptKey,now+900,now,now).first();
  if (limit.attempts>12) return fail("Demasiadas tentativas. Tenta novamente mais tarde.",429);
  const enrolling=!!claimed.enrollment_secret;
  const recovery=code.length===32;
  const recoveryMatch=recovery && !enrolling && equalHash(await digest(code),account.recovery_hash||"");
  const step=recovery?null:await matchingMfaStep(
    await openMfa(env,claimed.enrollment_secret||account.mfa_secret,account.id),code,now);
  if (!recoveryMatch && (step===null || step<=account.mfa_step)) return fail("Código incorreto ou já utilizado.",401);

  const newRecovery=enrolling||recovery?random(16):null;
  const secret=claimed.enrollment_secret||account.mfa_secret;
  const [result]=await db.batch([query(db,`UPDATE team_accounts SET mfa_secret=?,mfa_step=?,recovery_hash=?
    WHERE id=? AND password_hash=? AND invite_hash IS NULL AND mfa_secret IS ? AND mfa_step=? AND recovery_hash IS ?
    AND EXISTS (SELECT 1 FROM team_challenges WHERE token_hash=? AND expires>?)
    RETURNING id,username,role,barber,password_hash`,
    secret,step??account.mfa_step,newRecovery?await digest(newRecovery):account.recovery_hash,
    account.id,account.password_hash,account.mfa_secret,account.mfa_step,account.recovery_hash,tokenHash,epoch()),
    query(db,"DELETE FROM team_challenges WHERE token_hash=?",tokenHash)]);
  const updated=result.results[0];
  if (!updated) return fail("O código já foi utilizado. Entra novamente.",410);
  await query(db,"DELETE FROM team_attempts WHERE id=?",attemptKey).run();
  return startTeamSession(db,updated,true,newRecovery);
}
