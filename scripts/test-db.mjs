import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const db = new PGlite();
let checks = 0;
const ok = (value, message) => {
  assert.ok(value, message);
  checks++;
  console.log(`  OK ${message}`);
};
const ids = Array.from({ length: 8 }, () => randomUUID()),
  tabs = ids.map(() => randomUUID());
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema realtime;
 create table auth.users(id uuid primary key); grant usage on schema auth,realtime to authenticated;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
 create table realtime.test_events(payload jsonb,event text,topic text,private boolean);
 create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ insert into realtime.test_events values(payload,event,topic,private) $$;
 create table realtime.messages(extension text); alter table realtime.messages enable row level security; grant select,insert on realtime.messages to authenticated;`);
for (const id of ids) await db.query("insert into auth.users values($1)", [id]);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/202611050001_rooms.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/202611050002_turn.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL(
      "../supabase/migrations/202611060003_reduce_room_churn.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL(
      "../supabase/migrations/202611060004_host_kick.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(await readFile(new URL('../supabase/migrations/202611060005_admin.sql',import.meta.url),'utf8'));
async function as(i) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[i] ?? "",
  ]);
  await db.exec("set role authenticated");
}
async function admin(sql, args = []) {
  await db.exec("reset role");
  return db.query(sql, args);
}
async function rpc(name, args) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
}
async function denied(work, label) {
  let error = false;
  try {
    await work();
  } catch {
    error = true;
  }
  ok(error, label);
}
try {
  await as(0);
  const entry = await rpc("create_room", ["Anfitrião", tabs[0]]);
  const room = entry.room.id,
    token = entry.invite;
  ok(/^[a-f0-9]{64}$/.test(token), "convite imprevisível gerado");
  ok(entry.members.length === 1, "criador associado à sala");
  ok(
    (await db.query("select * from public.rooms")).rows.length === 1,
    "membro autorizado lê sala",
  );
  await denied(
    () => db.query("select * from public.room_invites"),
    "convites não podem ser lidos diretamente",
  );
  await denied(
    () => db.query("update public.rooms set name='invadida'"),
    "cliente não altera salas diretamente",
  );
  await denied(
    () => db.query("select private.snapshot($1)", [room]),
    "helper privilegiado não é executável pelo cliente",
  );
  await as(1);
  ok(
    (await db.query("select * from public.rooms")).rows.length === 0,
    "não membro não descobre salas",
  );
  ok(
    (await db.query("select * from public.room_members")).rows.length === 0,
    "não membro não lê participantes",
  );
  await denied(
    () => rpc("claim_stream", [room, tabs[1]]),
    "ID da sala não autoriza transmissão",
  );
  const bad = await rpc("join_room", ["a".repeat(64), "Intruso", tabs[1]]);
  ok(!!bad.error, "convite inválido não autoriza");
  for (let i = 1; i < 5; i++) {
    await as(i);
    const result = await rpc("join_room", [token, `Amigo ${i}`, tabs[i]]);
    ok(!result.error, `participante ${i + 1} autorizado`);
    ok(
      result.room.channel_epoch === entry.room.channel_epoch,
      "entrada preserva geração e evita reassinar os canais",
    );
  }
  const events = (await admin("select * from realtime.test_events")).rows;
  ok(
    events.length === 4 &&
      events.every(
        (e) => e.private === true && Object.keys(e.payload).length === 0,
      ),
    "entrada envia um único aviso privado sem dados pessoais",
  );
  await admin(
    "update public.room_members set last_seen=now()-interval '61 seconds' where room_id=$1 and user_id=$2",
    [room, ids[4]],
  );
  await as(0);
  ok(
    !!(await rpc("join_room", [token, "Outra aba", randomUUID()])).error,
    "entrada de outra aba continua recusada após limpeza",
  );
  ok(
    (await rpc("room_pulse", [room, tabs[0], null])).room.channel_epoch !==
      entry.room.channel_epoch,
    "limpeza revoga geração mesmo quando a entrada é recusada",
  );
  await as(4);
  ok(
    !(await rpc("join_room", [token, "Amigo 4", tabs[4]])).error,
    "participante pode revalidar convite após limpeza",
  );
  await as(5);
  ok(
    !!(await rpc("join_room", [token, "Excedente", tabs[5]])).error,
    "sexto participante recusado",
  );
  await as(0);
  ok(
    !!(await rpc("join_room", [token, "Outra aba", randomUUID()])).error,
    "aba concorrente recusada",
  );
  const sid = await rpc("claim_stream", [room, tabs[0]]);
  ok(typeof sid === "string", "primeira transmissão concedida");
  await as(1);
  await denied(
    () => rpc("claim_stream", [room, tabs[1]]),
    "segundo transmissor recusado",
  );
  await rpc("release_stream", [room, tabs[1], sid]);
  ok(
    (await rpc("room_pulse", [room, tabs[1], null])).room.stream_session ===
      sid,
    "espectador não encerra transmissão alheia",
  );
  await as(0);
  await rpc("release_stream", [room, tabs[0], randomUUID()]);
  ok(
    (await rpc("room_pulse", [room, tabs[0], null])).room.stream_session ===
      sid,
    "sessão antiga não encerra a atual",
  );
  const currentEpoch = (await rpc("room_pulse", [room, tabs[0], null])).room
    .channel_epoch;
  const topic = `room:${room}:${currentEpoch}:user:${ids[0]}`;
  await db.query("select set_config('realtime.topic',$1,false)", [topic]);
  ok(
    (await db.query("select private.topic_access($1,true) as allowed", [topic]))
      .rows[0].allowed,
    "remetente publica apenas no próprio canal",
  );
  await db.query("insert into realtime.messages values('broadcast')");
  checks++;
  console.log("  OK RLS autoriza broadcast do remetente");
  await as(1);
  ok(
    (
      await db.query("select private.topic_access($1,false) as allowed", [
        topic,
      ])
    ).rows[0].allowed,
    "membro recebe sinalização de outro membro",
  );
  await db.query("select set_config('realtime.topic',$1,false)", [topic]);
  ok(
    (await db.query("select * from realtime.messages")).rows.length === 1,
    "RLS autoriza recebimento por membro",
  );
  await denied(
    () => db.query("insert into realtime.messages values('broadcast')"),
    "RLS bloqueia falsificação de remetente",
  );
  await as(6);
  await db.query("select set_config('realtime.topic',$1,false)", [topic]);
  ok(
    (await db.query("select * from realtime.messages")).rows.length === 0,
    "RLS bloqueia recebimento de intruso",
  );
  await denied(
    () => db.query("insert into realtime.messages values('presence')"),
    "RLS bloqueia Presence de intruso",
  );
  await as(0);
  await rpc("release_stream", [room, tabs[0], sid]);
  ok(
    !(await rpc("room_pulse", [room, tabs[0], null])).room.stream_session,
    "parada remove transmissão",
  );
  const sid2 = await rpc("claim_stream", [room, tabs[0]]);
  await admin(
    "update public.rooms set stream_expires_at=now()+interval '15 seconds' where id=$1",
    [room],
  );
  const before = (
    await admin("select stream_expires_at from public.rooms where id=$1", [
      room,
    ])
  ).rows[0].stream_expires_at;
  await as(0);
  await rpc("room_pulse", [room, tabs[0], null]);
  const after = (
    await admin("select stream_expires_at from public.rooms where id=$1", [
      room,
    ])
  ).rows[0].stream_expires_at;
  ok(
    String(before) === String(after),
    "heartbeat sem sessão ativa não renova captura encerrada",
  );
  await as(0);
  await rpc("room_pulse", [room, tabs[0], sid2]);
  ok(
    new Date(
      (
        await admin("select stream_expires_at from public.rooms where id=$1", [
          room,
        ])
      ).rows[0].stream_expires_at,
    ) > new Date(after),
    "heartbeat com sessão renova concessão",
  );
  await admin(
    "update public.rooms set stream_expires_at=now()-interval '1 second' where id=$1",
    [room],
  );
  await as(1);
  ok(
    typeof (await rpc("claim_stream", [room, tabs[1]])) === "string",
    "transmissão expirada pode ser substituída",
  );
  await rpc("leave_room", [room, tabs[1]]);
  await denied(
    () => rpc("room_pulse", [room, tabs[1], null]),
    "saída remove associação",
  );
  await as(0);
  ok(
    !(
      await db.query("select private.topic_access($1,false) as allowed", [
        topic,
      ])
    ).rows[0].allowed,
    "saída troca o tópico para impedir reutilização da autorização em cache",
  );
  ok(
    await rpc("authorize_turn", [room]),
    "TURN autorizado apenas para membro ativo",
  );
  await as(7);
  ok(!(await rpc("authorize_turn", [room])), "TURN recusado para intruso");
  await as(5);
  ok(
    !(await rpc("join_room", [token, "Novo amigo", tabs[5]])).error,
    "vaga liberada pode ser preenchida",
  );
  await admin(
    "update public.room_members set last_seen=now()-interval '61 seconds' where room_id=$1 and user_id=$2",
    [room, ids[2]],
  );
  await as(2);
  ok(
    (await db.query("select * from public.rooms")).rows.length === 0,
    "associação sem heartbeat não autoriza leitura",
  );
  await as(6);
  ok(
    !(await rpc("join_room", [token, "Reconectado", tabs[6]])).error,
    "associação inativa é removida para liberar vaga",
  );
  await as(2);
  await denied(
    () => rpc("room_pulse", [room, tabs[2], null]),
    "participante removido precisa validar convite novamente",
  );
  await as(3);
  const moderated = await rpc("create_room", ["Host", tabs[3]]);
  const moderatedId = moderated.room.id;
  ok(
    moderated.room.created_by === ids[3],
    "snapshot identifica o criador como host",
  );
  await as(4);
  await rpc("join_room", [moderated.invite, "Visitante", tabs[4]]);
  await denied(
    () => rpc("kick_member", [moderatedId, tabs[4], ids[3]]),
    "participante não expulsa o host",
  );
  await rpc("claim_stream", [moderatedId, tabs[4]]);
  await as(5);
  await denied(
    () => rpc("kick_member", [moderatedId, tabs[5], ids[4]]),
    "intruso não expulsa participantes",
  );
  await as(3);
  await denied(
    () => rpc("kick_member", [moderatedId, tabs[3], ids[3]]),
    "host não se expulsa pelo controle de moderação",
  );
  const kicked = await rpc("kick_member", [moderatedId, tabs[3], ids[4]]);
  ok(
    kicked.members.length === 1 &&
      !kicked.room.broadcaster_id &&
      !kicked.room.stream_session,
    "expulsão remove associação e encerra a transmissão do alvo",
  );
  ok(
    kicked.room.channel_epoch !== moderated.room.channel_epoch,
    "expulsão troca geração de autorização",
  );
  await as(4);
  await denied(
    () => rpc("room_pulse", [moderatedId, tabs[4], null]),
    "expulso não consegue renovar participação",
  );
  ok(
    (await db.query("select id from public.rooms where id=$1", [moderatedId]))
      .rows.length === 0,
    "RLS bloqueia leitura pelo expulso",
  );
  ok(
    !(await rpc("join_room", [moderated.invite, "Visitante", tabs[4]])).error,
    "expulsão permite reentrada mediante convite válido",
  );
  await as(7);
  let limited = false;
  for (let i = 0; i < 13; i++) {
    const r = await rpc("join_room", ["b".repeat(64), "Tentativa", tabs[7]]);
    if (r.error.includes("Muitas")) limited = true;
  }
  ok(limited, "tentativas de convite inválido persistem no limitador");
  await admin(
    "update public.rooms set expires_at=now()-interval '1 second' where id=$1",
    [room],
  );
  await as(0);
  ok(
    (await db.query("select * from public.rooms")).rows.length === 0,
    "sala expirada não é legível",
  );
  await denied(
    () => rpc("room_pulse", [room, tabs[0], null]),
    "sala expirada não é renovável",
  );
  await as(1);
  ok(
    !!(await rpc("join_room", [token, "Expirada", tabs[1]])).error,
    "convite de sala expirada é recusado",
  );
  await db.exec("reset role; set role anon");
  await denied(
    () => rpc("create_room", ["Sem login", randomUUID()]),
    "usuário sem autenticação não executa RPC",
  );
  await as(0);
  await denied(()=>rpc('admin_list_rooms',[]),'participante não lista salas globalmente');
  const first=await rpc('create_room',['Admin teste A',tabs[0]]);const second=await rpc('create_room',['Admin teste B',tabs[0]]);const third=await rpc('create_room',['Admin teste C',tabs[0]]);
  ok(!first.error&&!second.error&&!third.error,'permite três salas recentes ativas');
  ok(!!(await rpc('create_room',['Excedente',tabs[0]])).error,'quarta sala ativa é recusada');
  await denied(()=>rpc('admin_close_room',[first.room.id]),'cliente não finaliza sala pela RPC administrativa');
  await db.exec('reset role; set role service_role');
  const listed=await rpc('admin_list_rooms',[]);ok(listed.some(r=>r.id===first.room.id),'administrador lista salas ativas');
  ok(await rpc('admin_close_room',[first.room.id]),'administrador finaliza sala');
  ok(!await rpc('admin_close_room',[first.room.id]),'finalização é idempotente');
  ok(!(await rpc('admin_list_rooms',[])).some(r=>r.id===first.room.id),'sala finalizada sai da lista');
  for(let i=0;i<20;i++)ok(await rpc('admin_login_gate',[]),'tentativa administrativa dentro do limite');
  ok(!await rpc('admin_login_gate',[]),'limite de login persiste no banco');
  await as(0);await denied(()=>rpc('room_pulse',[first.room.id,tabs[0],null]),'sala finalizada não renova participação');
  ok(!!(await rpc('join_room',[first.invite,'Teste',tabs[0]])).error,'convite da sala finalizada é invalidado');
  ok(!(await rpc('create_room',['Vaga liberada',tabs[0]])).error,'sala finalizada libera cota de criação');
  console.log(
    `\n${checks} verificações SQL passaram em PostgreSQL WASM (PGlite). Realtime gerenciado exige teste separado.`,
  );
} finally {
  await db.close();
}
