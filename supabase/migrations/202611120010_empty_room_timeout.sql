-- Membership expires after 60 seconds without a heartbeat. The room
-- remains available for ten seconds after the last active member is gone.
alter table public.rooms
  add column vacancy_deadline timestamptz not null default (now()+interval '10 seconds');

update public.rooms r
set vacancy_deadline = coalesce(
  (select max(m.last_seen)+interval '70 seconds' from public.room_members m where m.room_id=r.id),
  now()+interval '10 seconds'
);

create index rooms_vacancy_deadline_idx on public.rooms(vacancy_deadline);

-- Room RPCs lock the room before modifying membership. Update the deadline
-- in the same transaction so admission and expiry are serialized.
create function private.refresh_room_vacancy_deadline() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  rid uuid;
  latest timestamptz;
  checked_at timestamptz := clock_timestamp();
begin
  rid := case when tg_op='DELETE' then old.room_id else new.room_id end;
  select max(last_seen) into latest from public.room_members where room_id=rid;

  if tg_op='DELETE' and (latest is null or latest<=checked_at-interval '60 seconds') then
    -- Removing an expired lease must not restart the countdown.
    if old.last_seen>checked_at-interval '60 seconds' then
      update public.rooms set vacancy_deadline=checked_at+interval '10 seconds' where id=rid;
    end if;
    return null;
  end if;

  update public.rooms set vacancy_deadline=latest+interval '70 seconds' where id=rid;
  return null;
end; $$;

revoke execute on function private.refresh_room_vacancy_deadline() from public,anon,authenticated;

create trigger room_members_vacancy_deadline
after insert or update of last_seen or delete on public.room_members
for each row execute function private.refresh_room_vacancy_deadline();

create or replace function private.admit_room(p_invite text,p_room uuid,p_password text,p_nickname text,p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rid uuid; previous_epoch uuid; existing public.room_members; removed integer; recipient uuid; capacity integer; access_mode text; secret text;
begin
  if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
  if p_room is null and (p_invite is null or p_invite !~ '^[a-f0-9]{64}$') then
    return jsonb_build_object('error','Convite inválido ou expirado.');
  end if;
  if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
  select r.id,r.channel_epoch,r.max_members,r.access_mode into rid,previous_epoch,capacity,access_mode
    from public.rooms r where r.expires_at>now() and r.vacancy_deadline>clock_timestamp() and (
      (p_room is not null and r.id=p_room and r.access_mode<>'invite') or
      (p_room is null and r.access_mode='invite' and exists(select 1 from public.room_invites i
        where i.room_id=r.id and i.token_hash=sha256(convert_to(p_invite,'UTF8')) and i.expires_at>now()))
    ) for update of r;
  if rid is null or not exists (select 1 from public.rooms where id=rid and vacancy_deadline>clock_timestamp()) then return jsonb_build_object('error','Sala ou convite inválido ou expirado.'); end if;
  if access_mode='private' then
    select password_hash into secret from private.room_passwords where room_id=rid;
    if secret is null or p_password is null or octet_length(p_password)>72
      or extensions.crypt(p_password,secret) is distinct from secret then
      return jsonb_build_object('error','Senha da sala incorreta.');
    end if;
  end if;
  if not exists (select 1 from public.rooms where id=rid and vacancy_deadline>clock_timestamp()) then
    return jsonb_build_object('error','Sala ou convite inválido ou expirado.');
  end if;
  delete from public.room_members where room_id=rid and last_seen<=now()-interval '60 seconds';
  get diagnostics removed = row_count;
  if removed>0 then update public.rooms set channel_epoch=gen_random_uuid() where id=rid; end if;
  select * into existing from public.room_members where room_id=rid and user_id=auth.uid();
  if existing.user_id is not null and existing.client_id<>p_client then return jsonb_build_object('error','Esta sala já está aberta em outra aba. Feche-a e aguarde até um minuto.'); end if;
  if existing.user_id is null and (select count(*) from public.room_members where room_id=rid)>=capacity then return jsonb_build_object('error',format('A sala está cheia. O limite é de %s participantes.',capacity)); end if;
  insert into public.room_members values(rid,auth.uid(),trim(p_nickname),p_client,now())
    on conflict(room_id,user_id) do update set nickname=excluded.nickname,last_seen=now();
  -- One empty server hint, not one broadcast per row/member. Existing clients
  -- already listen to this topic. They reread the authoritative state via RPC.
  if existing.user_id is null or removed>0 or existing.nickname<>trim(p_nickname) then
    select user_id into recipient from public.room_members where room_id=rid and user_id<>auth.uid() order by user_id limit 1;
    if recipient is not null then
      perform realtime.send('{}'::jsonb,'state-changed','room:'||rid::text||':'||previous_epoch::text||':user:'||recipient::text,true);
    end if;
  end if;
  return private.snapshot(rid);
end; $$;

create or replace function public.list_rooms(p_limit integer default 25,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(listing) order by listing.created_at desc, listing.id),'[]'::jsonb)
  from (
    select r.id,r.name,r.access_mode,r.max_members,r.created_at,
      coalesce((
        select jsonb_agg(jsonb_build_object('nickname',m.nickname,'sharing',exists(
          select 1 from public.room_streams s where s.room_id=r.id and s.user_id=m.user_id and s.expires_at>now()
        )) order by m.nickname,m.user_id)
        from public.room_members m where m.room_id=r.id and m.last_seen>now()-interval '60 seconds'
      ),'[]'::jsonb) as participants
    from public.rooms r where r.expires_at>now() and r.vacancy_deadline>statement_timestamp()
    order by r.created_at desc,r.id
    limit greatest(1,least(coalesce(p_limit,25),50)) offset greatest(0,coalesce(p_offset,0))
  ) listing;
$$;

create or replace function public.admin_list_rooms() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'created_at',r.created_at,'expires_at',r.expires_at,
 'participants',(select count(*) from public.room_members m where m.room_id=r.id and m.last_seen>now()-interval '60 seconds'),
 'transmitting',exists(select 1 from public.room_streams s where s.room_id=r.id and s.expires_at>now())) order by r.created_at desc),'[]'::jsonb)
 from public.rooms r where r.expires_at>now() and r.vacancy_deadline>statement_timestamp();
$$;

create or replace function public.create_room(p_nickname text,p_client uuid,p_max_members integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; token text;
begin
 if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
 if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
 if p_max_members is null or p_max_members not between 2 and 8 then return jsonb_build_object('error','Escolha um limite de 2 a 8 pessoas.'); end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.rooms where created_by=auth.uid() and created_at>now()-interval '1 hour' and expires_at>now() and vacancy_deadline>statement_timestamp())>=3 then return jsonb_build_object('error','Limite de três salas ativas criadas na última hora. Finalize uma sala ou aguarde.'); end if;
 insert into public.rooms(created_by,name,max_members) values(auth.uid(),'Sala de '||trim(p_nickname),p_max_members) returning * into r;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.room_invites values(r.id,sha256(convert_to(token,'UTF8')),r.expires_at);
 insert into public.room_members values(r.id,auth.uid(),trim(p_nickname),p_client,now());
 return private.snapshot(r.id)||jsonb_build_object('invite',token);
end; $$;

notify pgrst, 'reload schema';
