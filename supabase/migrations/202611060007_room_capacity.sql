-- Existing rooms and older clients retain the five-person limit.
alter table public.rooms add column max_members integer not null default 5 check(max_members between 2 and 8);

create or replace function private.snapshot(p_room uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('room',jsonb_build_object('id',r.id,'name',r.name,'max_members',r.max_members,'created_by',r.created_by,'expires_at',r.expires_at,'channel_epoch',r.channel_epoch,
    'broadcaster_id',case when r.stream_expires_at>now() then r.broadcaster_id end,
    'stream_session',case when r.stream_expires_at>now() then r.stream_session end),
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'nickname',m.nickname,'client_id',m.client_id))
      from public.room_members m where m.room_id=r.id and m.last_seen>now()-interval '60 seconds'),'[]'::jsonb))
  from public.rooms r where r.id=p_room;
$$;

-- Store the creator's nickname in the room name so every participant sees it.
create or replace function public.create_room(p_nickname text,p_client uuid,p_max_members integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; token text;
begin
 if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
 if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
 if p_max_members is null or p_max_members not between 2 and 8 then return jsonb_build_object('error','Escolha um limite de 2 a 8 pessoas.'); end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.rooms where created_by=auth.uid() and created_at>now()-interval '1 hour' and expires_at>now())>=3 then return jsonb_build_object('error','Limite de três salas ativas criadas na última hora. Finalize uma sala ou aguarde.'); end if;
 insert into public.rooms(created_by,name,max_members) values(auth.uid(),'Sala de '||trim(p_nickname),p_max_members) returning * into r;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.room_invites values(r.id,sha256(convert_to(token,'UTF8')),r.expires_at);
 insert into public.room_members values(r.id,auth.uid(),trim(p_nickname),p_client,now());
 return private.snapshot(r.id)||jsonb_build_object('invite',token);
end; $$;

revoke execute on function public.create_room(text,uuid,integer) from public,anon;
grant execute on function public.create_room(text,uuid,integer) to authenticated;

-- Preserve the exact old RPC signature without ambiguous default arguments.
create or replace function public.create_room(p_nickname text,p_client uuid) returns jsonb
language sql security definer set search_path='' as $$
 select public.create_room(p_nickname,p_client,5);
$$;

-- Additive, backwards-compatible. Keep the epoch on admission; revoke cached
-- authorization by rotating it only when an association is actually removed.
create or replace function public.join_room(p_invite text,p_nickname text,p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rid uuid; previous_epoch uuid; existing public.room_members; removed integer; recipient uuid; capacity integer;
begin
  if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
  if p_invite is null or p_invite !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Convite inválido ou expirado.'); end if;
  if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
  select r.id,r.channel_epoch,r.max_members into rid,previous_epoch,capacity from public.rooms r join public.room_invites i on i.room_id=r.id
    where i.token_hash=sha256(convert_to(p_invite,'UTF8')) and i.expires_at>now() and r.expires_at>now() for update of r;
  if rid is null then return jsonb_build_object('error','Convite inválido ou expirado.'); end if;
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
revoke execute on function public.join_room(text,text,uuid) from public,anon;
grant execute on function public.join_room(text,text,uuid) to authenticated;

notify pgrst, 'reload schema';

