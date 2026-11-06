-- No secrets, external extensions or public room discovery.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Sala dos amigos',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '8 hours',
  channel_epoch uuid not null default gen_random_uuid(),
  broadcaster_id uuid references auth.users(id) on delete set null,
  stream_session uuid,
  stream_expires_at timestamptz
);
create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 24),
  client_id uuid not null,
  last_seen timestamptz not null default now(),
  primary key(room_id, user_id)
);
create index room_members_user on public.room_members(user_id);
create table public.room_invites (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null
);
create table private.attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  count integer not null
);
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;
alter table private.attempts enable row level security;
revoke all on public.rooms, public.room_members, public.room_invites from anon, authenticated;
grant select on public.rooms, public.room_members to authenticated;

create function private.is_member(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.room_members m join public.rooms r on r.id=m.room_id
    where m.room_id=p_room and m.user_id=(select auth.uid())
    and m.last_seen > now()-interval '60 seconds' and r.expires_at > now());
$$;
create policy rooms_read on public.rooms for select to authenticated using (private.is_member(id));
create policy members_read on public.room_members for select to authenticated using (private.is_member(room_id));
-- Invites intentionally have no direct read/write policy.

create function private.throttle() returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then return false; end if;
  insert into private.attempts values(auth.uid(), now(), 1)
  on conflict(user_id) do update set
    count=case when private.attempts.window_start < now()-interval '1 minute' then 1 else private.attempts.count+1 end,
    window_start=case when private.attempts.window_start < now()-interval '1 minute' then now() else private.attempts.window_start end
  returning count into n;
  return n <= 12;
end; $$;

create function private.snapshot(p_room uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('room',jsonb_build_object('id',r.id,'name',r.name,'expires_at',r.expires_at,'channel_epoch',r.channel_epoch,
    'broadcaster_id',case when r.stream_expires_at>now() then r.broadcaster_id end,
    'stream_session',case when r.stream_expires_at>now() then r.stream_session end),
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'nickname',m.nickname,'client_id',m.client_id))
      from public.room_members m where m.room_id=r.id and m.last_seen>now()-interval '60 seconds'),'[]'::jsonb))
  from public.rooms r where r.id=p_room;
$$;

create function public.create_room(p_nickname text,p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; token text;
begin
  if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
  if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
  -- Serialize creation per account, including concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if (select count(*) from public.rooms where created_by=auth.uid() and created_at>now()-interval '1 hour') >= 3 then
    return jsonb_build_object('error','Limite de três salas por hora. Tente novamente mais tarde.'); end if;
  insert into public.rooms(created_by) values(auth.uid()) returning * into r;
  -- Two CSPRNG UUIDs supply 244 random bits. Only the SHA-256 digest is persisted.
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
  insert into public.room_invites values(r.id,sha256(convert_to(token,'UTF8')),r.expires_at);
  insert into public.room_members values(r.id,auth.uid(),trim(p_nickname),p_client,now());
  return private.snapshot(r.id) || jsonb_build_object('invite',token);
end; $$;

create function public.join_room(p_invite text,p_nickname text,p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rid uuid; existing public.room_members; removed integer;
begin
  -- Return errors rather than raise: failed invite attempts must commit the throttle.
  if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
  if p_invite is null or p_invite !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Convite inválido ou expirado.'); end if;
  if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
  select r.id into rid from public.rooms r join public.room_invites i on i.room_id=r.id
    where i.token_hash=sha256(convert_to(p_invite,'UTF8')) and i.expires_at>now() and r.expires_at>now() for update of r;
  if rid is null then return jsonb_build_object('error','Convite inválido ou expirado.'); end if;
  delete from public.room_members where room_id=rid and last_seen<=now()-interval '60 seconds';
  get diagnostics removed = row_count;
  select * into existing from public.room_members where room_id=rid and user_id=auth.uid();
  if existing.user_id is not null and existing.client_id<>p_client then return jsonb_build_object('error','Esta sala já está aberta em outra aba. Feche-a e aguarde até um minuto.'); end if;
  if existing.user_id is null and (select count(*) from public.room_members where room_id=rid)>=5 then return jsonb_build_object('error','A sala está cheia. O limite é de cinco participantes.'); end if;
  insert into public.room_members values(rid,auth.uid(),trim(p_nickname),p_client,now())
    on conflict(room_id,user_id) do update set nickname=excluded.nickname,last_seen=now();
  if existing.user_id is null or removed>0 then update public.rooms set channel_epoch=gen_random_uuid() where id=rid; end if;
  return private.snapshot(rid);
end; $$;

create function private.touch(p_room uuid,p_client uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.rooms where id=p_room and expires_at>now() for update;
  if not found then raise exception 'A sala expirou. Crie uma nova sala.'; end if;
  update public.room_members set last_seen=now() where room_id=p_room and user_id=auth.uid() and client_id=p_client;
  if not found then raise exception 'Sua participação expirou. Entre novamente pelo convite.'; end if;
end; $$;

create function public.room_pulse(p_room uuid,p_client uuid,p_session uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  perform private.touch(p_room,p_client);
  delete from public.room_members where room_id=p_room and last_seen<=now()-interval '60 seconds';
  get diagnostics removed = row_count;
  if removed>0 then update public.rooms set channel_epoch=gen_random_uuid() where id=p_room; end if;
  update public.rooms set stream_expires_at=now()+interval '35 seconds'
    where id=p_room and broadcaster_id=auth.uid() and stream_session=p_session and stream_expires_at>now();
  return private.snapshot(p_room);
end; $$;
create function public.claim_stream(p_room uuid,p_client uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid := gen_random_uuid();
begin
  perform private.touch(p_room,p_client);
  if exists(select 1 from public.rooms where id=p_room and stream_expires_at>now()) then raise exception 'Já existe uma transmissão ativa nesta sala.'; end if;
  update public.rooms set broadcaster_id=auth.uid(),stream_session=sid,stream_expires_at=now()+interval '35 seconds' where id=p_room;
  return sid;
end; $$;
create function public.release_stream(p_room uuid,p_client uuid,p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.touch(p_room,p_client);
  update public.rooms set broadcaster_id=null,stream_session=null,stream_expires_at=null
    where id=p_room and broadcaster_id=auth.uid() and stream_session=p_session;
end; $$;
create function public.leave_room(p_room uuid,p_client uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.rooms where id=p_room for update;
  if not exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and client_id=p_client) then return; end if;
  update public.rooms set broadcaster_id=null,stream_session=null,stream_expires_at=null where id=p_room and broadcaster_id=auth.uid();
  delete from public.room_members where room_id=p_room and user_id=auth.uid() and client_id=p_client;
  update public.rooms set channel_epoch=gen_random_uuid() where id=p_room;
end; $$;

-- Topic: room:<room uuid>:<epoch uuid>:user:<sender uuid>. Sender identity comes from the
-- authorized topic, never a claimed sender field inside a client payload.
create function private.topic_access(p_topic text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare parts text[] := string_to_array(p_topic,':'); rid uuid; sender uuid;
begin
  if array_length(parts,1)<>5 or parts[1]<>'room' or parts[4]<>'user' then return false; end if;
  begin rid:=parts[2]::uuid; sender:=parts[5]::uuid; exception when invalid_text_representation then return false; end;
  return private.is_member(rid) and (not p_write or sender=auth.uid())
    and exists(select 1 from public.rooms where id=rid and channel_epoch::text=parts[3])
    and exists(select 1 from public.room_members where room_id=rid and user_id=sender and last_seen>now()-interval '60 seconds');
end; $$;
create policy streamlite_receive on realtime.messages for select to authenticated
  using (extension in ('broadcast','presence') and private.topic_access((select realtime.topic()),false));
create policy streamlite_send on realtime.messages for insert to authenticated
  with check (extension in ('broadcast','presence') and private.topic_access((select realtime.topic()),true));

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_member(uuid),private.topic_access(text,boolean) to authenticated;
revoke execute on function public.create_room(text,uuid),public.join_room(text,text,uuid),public.room_pulse(uuid,uuid,uuid),public.claim_stream(uuid,uuid),public.release_stream(uuid,uuid,uuid),public.leave_room(uuid,uuid) from public,anon;
grant execute on function public.create_room(text,uuid),public.join_room(text,text,uuid),public.room_pulse(uuid,uuid,uuid),public.claim_stream(uuid,uuid),public.release_stream(uuid,uuid,uuid),public.leave_room(uuid,uuid) to authenticated;
