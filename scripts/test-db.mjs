import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const db = new PGlite({ extensions: { pgcrypto } });
let checks = 0;
const ok = (value, message) => {
  assert.ok(value, message);
  checks++;
  console.log(`  OK ${message}`);
};
const ids = Array.from({ length: 10 }, () => randomUUID()),
  tabs = ids.map(() => randomUUID());
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema realtime;
 create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,
   is_anonymous boolean not null default false,raw_user_meta_data jsonb,
   created_at timestamptz not null default now(),last_sign_in_at timestamptz);
 grant usage on schema auth,realtime to authenticated;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
 create table realtime.test_events(payload jsonb,event text,topic text,private boolean);
 create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ insert into realtime.test_events values(payload,event,topic,private) $$;
 create table realtime.messages(extension text); alter table realtime.messages enable row level security; grant select,insert on realtime.messages to authenticated;`);
for (const [index, id] of ids.entries())
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
    [id, index === 0 ? "ropolatto77@gmail.com" : `test${index}@example.test`]);
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
await db.exec(await readFile(new URL('../supabase/migrations/202611060006_room_creator_name.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/202611060007_room_capacity.sql',import.meta.url),'utf8'));
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
  ok(entry.room.name === 'Sala de Anfitrião', 'sala recebe o apelido do criador');
  ok(entry.room.max_members === 5, 'cliente anterior continua criando sala de cinco');
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
  await admin('delete from private.attempts');
  await as(8);
  for (const capacity of [null,1,9]) ok(!!(await rpc('create_room',['Limite inválido',tabs[8],capacity])).error,'servidor recusa capacidade fora de 2 a 8');
  const small=await rpc('create_room',['Dupla',tabs[8],2]);
  ok(small.room.max_members===2,'capacidade de duas pessoas consta no snapshot');
  await as(9);ok(!(await rpc('join_room',[small.invite,'Amigo',tabs[9]])).error,'segunda pessoa entra em sala de duas');
  await as(0);ok((await rpc('join_room',[small.invite,'Excedente',tabs[0]])).error.includes('2 participantes'),'terceira pessoa recusada pelo limite específico');
  await as(8);const large=await rpc('create_room',['Grupo',tabs[8],8]);
  for(let i=0;i<7;i++){await as(i);ok(!(await rpc('join_room',[large.invite,`Pessoa ${i}`,tabs[i]])).error,'sala de oito aceita espectador autorizado');}
  await as(8);const full=await rpc('room_pulse',[large.room.id,tabs[8],null]);
  ok(full.members.length===8&&full.room.max_members===8,'sala cheia suporta criador e sete espectadores');
  await as(9);ok((await rpc('join_room',[large.invite,'Nona pessoa',tabs[9]])).error.includes('8 participantes'),'nona pessoa recusada');
  await denied(()=>db.query('update public.rooms set max_members=8 where id=$1',[small.room.id]),'participante não altera limite diretamente');
  await admin('reset role');await denied(()=>db.query('update public.rooms set max_members=9 where id=$1',[large.room.id]),'constraint impede capacidade acima de oito');
  await db.exec('set role anon');await denied(()=>rpc('create_room',['Intruso',tabs[9],8]),'anônimo sem autenticação não cria sala pela nova RPC');
  await as(8);const legacySession=await rpc('claim_stream',[large.room.id,tabs[8]]);
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/202611060008_multi_stream.sql',import.meta.url),'utf8'));
  await as(8);ok((await rpc('room_pulse',[large.room.id,tabs[8],legacySession])).streams.some(s=>s.session_id===legacySession),'migration preserva transmissão ativa anterior');
  await rpc('release_stream',[large.room.id,tabs[8],legacySession]);
  await admin('delete from private.attempts');await as(9);
  const multi=await rpc('create_room',['Multi',tabs[9],8]);
  for(const i of [0,1,2,8]){await as(i);await rpc('join_room',[multi.invite,`Pessoa ${i}`,tabs[i]]);}
  const sessions=[];
  for(const i of [9,0,1]){await as(i);sessions.push(await rpc('claim_stream',[multi.room.id,tabs[i]]));}
  await as(9);await denied(()=>rpc('claim_stream',[multi.room.id,tabs[9]]),'mesmo participante não ocupa duas transmissões');
  await as(2);await denied(()=>rpc('claim_stream',[multi.room.id,tabs[2]]),'quarta transmissão simultânea recusada');
  let multiState=await rpc('room_pulse',[multi.room.id,tabs[2],null]);ok(multiState.streams.length===3,'snapshot devolve três transmissões independentes');
  await rpc('release_stream',[multi.room.id,tabs[2],sessions[0]]);ok((await rpc('room_pulse',[multi.room.id,tabs[2],null])).streams.length===3,'espectador não encerra transmissão alheia');
  await as(9);await rpc('release_stream',[multi.room.id,tabs[9],crypto.randomUUID()]);ok((await rpc('room_pulse',[multi.room.id,tabs[9],sessions[0]])).streams.length===3,'sessão antiga não encerra transmissão atual');
  await admin('update public.room_streams set expires_at=now()-interval \'1 second\' where room_id=$1 and user_id=$2',[multi.room.id,ids[0]]);
  await as(2);const replacement=await rpc('claim_stream',[multi.room.id,tabs[2]]);ok(typeof replacement==='string','lease expirada libera vaga sem adicionar timer de banco');
  await as(9);await rpc('kick_member',[multi.room.id,tabs[9],ids[1]]);ok(!(await rpc('room_pulse',[multi.room.id,tabs[9],sessions[0]])).streams.some(s=>s.broadcaster_id===ids[1]),'expulsão remove apenas transmissão do participante');
  await as(2);await rpc('leave_room',[multi.room.id,tabs[2]]);await as(9);ok((await rpc('room_pulse',[multi.room.id,tabs[9],sessions[0]])).streams.length===1,'saída libera transmissão por cascade');
  await as(8);await denied(()=>db.query('insert into public.room_streams(room_id,user_id) values($1,$2)',[multi.room.id,ids[8]]),'cliente não insere concessão diretamente');
  await as(7);ok((await db.query('select * from public.room_streams where room_id=$1',[multi.room.id])).rows.length===0,'RLS oculta transmissões de intruso');
  await admin('update public.room_members set last_seen=now()-interval \'61 seconds\' where room_id=$1 and user_id=$2',[multi.room.id,ids[8]]);
  await as(8);await denied(()=>rpc('room_pulse',[multi.room.id,tabs[8],null]),'heartbeat não ressuscita associação expirada');
  await db.exec('reset role;set role service_role');await rpc('admin_close_room',[multi.room.id]);
  ok((await admin('select * from public.room_streams where room_id=$1',[multi.room.id])).rows.length===0,'administrador finaliza todas as transmissões da sala');
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/202611120009_room_directory.sql', import.meta.url), 'utf8'));
  await admin('delete from private.attempts');
  await as(4);
  const openRoom = await rpc('create_listed_room', ['Pública', tabs[4], 2, 'public', null]);
  const password = 'senha de teste';
  const lockedRoom = await rpc('create_listed_room', ['Privada', tabs[4], 2, 'private', password]);
  ok(openRoom.room && lockedRoom.room && !lockedRoom.invite, 'criação aceita os dois modos sem emitir convite legado');
  await as(5);
  ok(!(await rpc('join_listed_room', [openRoom.room.id, 'Visitante', tabs[5], null])).error, 'sala pública aceita entrada sem senha');
  for (const attempt of [null, 'incorreta'])
    ok((await rpc('join_listed_room', [lockedRoom.room.id, 'Visitante', tabs[5], attempt])).error?.includes('Senha'), 'sala privada recusa senha ausente ou incorreta');
  ok(!(await rpc('join_listed_room', [lockedRoom.room.id, 'Visitante', tabs[5], password])).error, 'sala privada aceita senha correta');
  await rpc('claim_stream', [lockedRoom.room.id, tabs[5]]);
  await as(6);
  ok((await rpc('join_listed_room', [lockedRoom.room.id, 'Excedente', tabs[6], password])).error?.includes('2 participantes'), 'entrada por senha respeita a capacidade');
  ok(!!(await rpc('join_listed_room', [large.room.id, 'Excedente', tabs[6], null])).error, 'UUID de sala antiga não substitui o convite');
  await db.exec('reset role; set role anon');
  const directory = await rpc('list_rooms', [50, 0]);
  const listedPrivateRoom = directory.find(room => room.id === lockedRoom.room.id);
  ok(listedPrivateRoom?.access_mode === 'private' && listedPrivateRoom.participants.some(member => member.nickname === 'Visitante' && member.sharing), 'catálogo anônimo mostra participantes e compartilhamento');
  ok(!JSON.stringify(directory).includes(password) && !JSON.stringify(directory).includes('password_hash') && !JSON.stringify(directory).includes('client_id'), 'catálogo omite credenciais e identificadores de cliente');
  await denied(() => rpc('join_listed_room', [openRoom.room.id, 'Visitante', tabs[6], null]), 'catálogo público não permite ingresso sem identidade Supabase');
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/202611120010_empty_room_timeout.sql', import.meta.url), 'utf8'));
  const vacancy = async (roomId) => (await admin(
    'select extract(epoch from vacancy_deadline-clock_timestamp()) as seconds from public.rooms where id=$1',
    [roomId],
  )).rows[0]?.seconds;
  await as(4);
  await rpc('leave_room', [openRoom.room.id, tabs[4]]);
  ok(Number(await vacancy(openRoom.room.id)) > 60, 'saída com outro participante ativo não inicia contagem de sala vazia');
  await as(5);
  await rpc('leave_room', [openRoom.room.id, tabs[5]]);
  const emptySeconds = Number(await vacancy(openRoom.room.id));
  ok(emptySeconds > 9 && emptySeconds <= 10, 'última saída inicia a janela de dez segundos');
  await as(6);
  ok(!(await rpc('join_listed_room', [openRoom.room.id, 'Voltei', tabs[6], null])).error, 'retorno durante a janela mantém a sala aberta');
  ok(Number(await vacancy(openRoom.room.id)) > 60, 'retorno cancela o prazo da sala vazia');
  await admin("update public.room_members set last_seen=now()-interval '61 seconds' where room_id=$1", [openRoom.room.id]);
  const disconnectedSeconds = Number(await vacancy(openRoom.room.id));
  ok(disconnectedSeconds > 8 && disconnectedSeconds <= 9, 'desconexão sem aviso inicia a janela ao expirar a presença');
  await admin("update public.room_members set last_seen=now()-interval '71 seconds' where room_id=$1", [openRoom.room.id]);
  await as(6);
  await rpc('leave_room', [openRoom.room.id, tabs[6]]);
  ok(Number(await vacancy(openRoom.room.id)) < 0, 'saída atrasada de membro expirado não reabre a sala');
  await as(5);
  ok(!!(await rpc('join_listed_room', [openRoom.room.id, 'Tarde', tabs[5], null])).error, 'prazo vencido impede entrada mesmo antes da limpeza');
  await db.exec('reset role; set role anon');
  ok(!(await rpc('list_rooms', [50, 0])).some(room => room.id === openRoom.room.id), 'prazo vencido oculta sala do catálogo');
  await admin('delete from public.rooms where vacancy_deadline<=statement_timestamp()');
  ok(await vacancy(openRoom.room.id) === undefined && Number(await vacancy(lockedRoom.room.id)) > 0, 'limpeza remove sala vencida e preserva sala ocupada');

  await admin("update auth.users set is_anonymous=true,email=null,email_confirmed_at=null where id=$1", [ids[9]]);
  await admin("update auth.users set last_sign_in_at=now() where id=$1", [ids[0]]);
  await db.exec(await readFile(new URL("../supabase/migrations/202611120011_accounts.sql", import.meta.url), "utf8"));
  await db.exec("set role anon");
  await denied(() => rpc("list_rooms", [25, 0]), "visitante não acessa o catálogo");
  await denied(() => rpc("join_room", [token, "Visitante", tabs[1]]), "visitante não entra por convite");
  await as(9);
  await denied(() => rpc("join_listed_room", [lockedRoom.room.id, "Legado", tabs[9], password]), "JWT anônimo legado não entra");
  const newcomer = randomUUID();
  const unverified = randomUUID();
  await admin(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
    values($1,'new@example.test',now(),'{"username":"Nova","role":"superadmin","can_create_rooms":true}'),
          ($2,'pending@example.test',null,'{"username":"Pendente"}')`, [newcomer, unverified]);
  ids.push(newcomer, unverified);
  tabs.push(randomUUID(), randomUUID());
  await denied(() => admin(`insert into auth.users(id,email,raw_user_meta_data)
    values($1,'duplicate@example.test','{"username":"NOVA"}')`, [randomUUID()]), "nome de usuário único sem distinguir maiúsculas");
  await denied(() => admin(`insert into auth.users(id,email,raw_user_meta_data)
    values($1,'other@example.test','{"username":"Rod"}')`, [randomUUID()]), "nome Rod reservado no cadastro");
  await as(11);
  await denied(() => rpc("join_listed_room", [lockedRoom.room.id, "Pendente", tabs[11], password]), "e-mail pendente não entra em sala");
  await as(10);
  const self = (await db.query("select * from public.profiles")).rows;
  ok(self.length === 1 && self[0].role === "user" && self[0].status === "active" &&
    self[0].can_create_rooms === false, "perfil próprio e permissões padrão mesmo com metadados manipulados");
  await denied(() => db.query("update public.profiles set role='superadmin'"), "perfil não permite escalada por UPDATE");
  await denied(() => rpc("create_room", ["Falso", tabs[10]]), "RPC de criação antiga exige permissão");
  await denied(() => rpc("create_listed_room", ["Falso", tabs[10], 5, "public", null]), "RPC de criação listada exige permissão");
  await denied(() => db.query("insert into public.rooms(created_by) values($1)", [newcomer]), "tabela de salas rejeita criação direta");
  await denied(() => rpc("staff_users", []), "usuário comum não lista usuários diretamente");
  await denied(() => rpc("staff_update_user", [newcomer, "grant_rooms", 0]), "usuário comum não altera permissões");
  await denied(() => rpc("bootstrap_streamlite_superadmin", [ids[0]]), "usuário comum não chama bootstrap");
  await db.exec("reset role; set role service_role");
  await denied(() => rpc("bootstrap_streamlite_superadmin", [newcomer]), "bootstrap exige UUID do e-mail definitivo");
  await rpc("bootstrap_streamlite_superadmin", [ids[0]]);
  await rpc("bootstrap_streamlite_superadmin", [ids[0]]);
  await as(0);
  const rod = (await rpc("staff_users", ["ropolatto", "active", "superadmin", 0]))[0];
  ok(rod?.username === "Rod" && rod?.can_create_rooms && rod?.last_sign_in_at, "Rod acessa o painel com dados de último login");
  ok((await rpc("staff_audit", [0])).filter(row => row.action === "bootstrap").length === 1, "bootstrap idempotente");
  await denied(() => rpc("staff_update_user", [rod.id, "block", rod.version]), "SuperAdmin não modifica a própria permissão");
  await denied(() => admin("update public.profiles set status='blocked' where id=$1", [rod.id]), "banco preserva último SuperAdmin ativo");
  await denied(() => admin("delete from auth.users where id=$1", [rod.id]), "exclusão no Auth preserva último SuperAdmin ativo");
  await as(0);
  await rpc("staff_update_user", [ids[1], "promote", 0]);
  await as(1);
  await denied(() => rpc("staff_update_user", [rod.id, "block", rod.version]), "Admin não bloqueia SuperAdmin");
  await denied(() => rpc("staff_update_user", [newcomer, "promote", 0]), "Admin não altera cargos");
  await rpc("staff_update_user", [newcomer, "grant_rooms", 0]);
  await denied(() => rpc("staff_update_user", [newcomer, "block", 0]), "versão obsoleta não sobrescreve outra alteração");
  await as(10);
  const protectedRoom = await rpc("create_listed_room", ["Nome forjado", tabs[10], 5, "private", password]);
  ok(protectedRoom.room.created_by === newcomer && protectedRoom.room.name === "Sala de Nova", "sala usa UUID e nome do perfil");
  const stream = await rpc("claim_stream", [protectedRoom.room.id, tabs[10]]);
  await as(2);
  ok(await rpc("update_own_username", ["Outro"]) === "Outro", "usuário ativo pode editar o próprio nome");
  await denied(() => rpc("update_own_username", ["Rod"]), "edição do perfil não permite assumir o nome reservado");
  await denied(() => rpc("update_own_username", ["NOVA"]), "edição do perfil mantém a unicidade");
  ok((await rpc("join_listed_room", [protectedRoom.room.id, "Forjado", tabs[2], null])).error?.includes("Senha"), "senha de sala preservada");
  const joined = await rpc("join_listed_room", [protectedRoom.room.id, "Forjado", tabs[2], password]);
  ok(joined.streams[0]?.session_id === stream && joined.members.some(m => m.user_id === ids[2] && m.nickname === "Outro"), "contas ativas entram e encontram transmissões existentes");
  await as(1);
  await rpc("staff_update_user", [newcomer, "revoke_rooms", 1]);
  await as(10);
  await denied(() => rpc("create_room", ["Nova", tabs[10], 5]), "revogação impede criação na sessão já aberta");
  ok((await rpc("room_pulse", [protectedRoom.room.id, tabs[10], stream])).streams.length === 1, "revogação preserva participação existente");
  await as(1);
  await rpc("staff_update_user", [newcomer, "block", 2]);
  const audited = (await rpc("staff_audit", [0]))[0];
  ok(audited.action === "block" && audited.previous_state.status === "active" &&
    audited.new_state.status === "blocked", "bloqueio auditado com estados anterior e posterior");
  await as(10);
  await denied(() => rpc("room_pulse", [protectedRoom.room.id, tabs[10], stream]), "bloqueio invalida heartbeat na sessão já aberta");
  await denied(() => rpc("join_listed_room", [protectedRoom.room.id, "Nova", tabs[10], password]), "bloqueio impede nova entrada");
  ok(!(await rpc("authorize_turn", [protectedRoom.room.id])), "conta bloqueada não recebe credenciais TURN");
  ok((await rpc("list_rooms", [25, 0])).length === 0 && (await db.query("select * from public.rooms")).rows.length === 0,
    "bloqueio impede catálogo e leitura direta por RLS");
  await db.query("select set_config('realtime.topic',$1,false)", [`room:${protectedRoom.room.id}:${joined.room.channel_epoch}:user:${newcomer}`]);
  await denied(() => db.query("insert into realtime.messages values('broadcast')"), "conta bloqueada não obtém autorização de sinalização");
  await as(2);
  const afterBlock = await rpc("room_pulse", [protectedRoom.room.id, tabs[2], null]);
  ok(!afterBlock.streams.length && !afterBlock.members.some(m => m.user_id === newcomer) &&
    afterBlock.room.channel_epoch !== joined.room.channel_epoch, "bloqueio remove presença e transmissões e invalida o tópico");
  await as(1);
  await rpc("staff_update_user", [newcomer, "unblock", 3]);
  await as(10);
  ok((await rpc("join_listed_room", [protectedRoom.room.id, "Nova", tabs[10], password])).members.length === 2,
    "desbloqueio recupera o acesso na mesma sessão");
  await db.exec("reset role");
  await db.exec(await readFile(new URL("../supabase/retire-temporary-admin.sql", import.meta.url), "utf8"));
  await db.exec("set role service_role");
  await denied(() => rpc("admin_login_gate", []), "login administrativo temporário removido");
  await denied(() => rpc("admin_list_rooms", []), "credencial antiga não acessa RPC administrativa");
  await as(0);
  ok((await rpc("staff_rooms", [])).some(room => room.id === protectedRoom.room.id), "Rod mantém administração das salas após a transição");
  ok(await rpc("staff_close_room", [protectedRoom.room.id]), "Rod consegue finalizar e auditar sala");
  console.log(
    `\n${checks} verificações SQL passaram em PostgreSQL WASM (PGlite). Realtime gerenciado exige teste separado.`,
  );
} finally {
  await db.close();
}
