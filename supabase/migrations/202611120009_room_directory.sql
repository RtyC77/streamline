create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.rooms add column access_mode text not null default 'invite'
  check (access_mode in ('invite','public','private'));
create table private.room_passwords (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null
);
revoke all on private.room_passwords from public,anon,authenticated;

create function public.create_listed_room(p_nickname text,p_client uuid,p_max_members integer,p_access text,p_password text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; rid uuid;
begin
  if p_access is null or p_access not in ('public','private') then
    return jsonb_build_object('error','Escolha uma sala pública ou privada.');
  end if;
  if p_access='private' and (p_password is null or char_length(trim(p_password))<4 or octet_length(p_password)>72) then
    return jsonb_build_object('error','Use uma senha de pelo menos 4 caracteres e até 72 bytes.');
  end if;
  result:=public.create_room(p_nickname,p_client,p_max_members);
  if result ? 'error' then return result; end if;
  rid:=(result->'room'->>'id')::uuid;
  update public.rooms set access_mode=p_access where id=rid;
  delete from public.room_invites where room_id=rid;
  if p_access='private' then
    insert into private.room_passwords values(rid,extensions.crypt(p_password,extensions.gen_salt('bf',10)));
  end if;
  return result - 'invite';
end;
$$;

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
    from public.rooms r where r.expires_at>now() and (
      (p_room is not null and r.id=p_room and r.access_mode<>'invite') or
      (p_room is null and r.access_mode='invite' and exists(select 1 from public.room_invites i
        where i.room_id=r.id and i.token_hash=sha256(convert_to(p_invite,'UTF8')) and i.expires_at>now()))
    ) for update of r;
  if rid is null then return jsonb_build_object('error','Sala ou convite inválido ou expirado.'); end if;
  if access_mode='private' then
    select password_hash into secret from private.room_passwords where room_id=rid;
    if secret is null or p_password is null or octet_length(p_password)>72
      or extensions.crypt(p_password,secret) is distinct from secret then
      return jsonb_build_object('error','Senha da sala incorreta.');
    end if;
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

revoke execute on function private.admit_room(text,uuid,text,text,uuid) from public,anon,authenticated;

create or replace function public.join_room(p_invite text,p_nickname text,p_client uuid)
returns jsonb language sql security definer set search_path='' as $$
  select private.admit_room(p_invite,null,null,p_nickname,p_client);
$$;

create function public.join_listed_room(p_room uuid,p_nickname text,p_client uuid,p_password text)
returns jsonb language sql security definer set search_path='' as $$
  select private.admit_room(null,p_room,p_password,p_nickname,p_client);
$$;

create function public.list_rooms(p_limit integer default 25,p_offset integer default 0)
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
    from public.rooms r where r.expires_at>now()
    order by r.created_at desc,r.id
    limit greatest(1,least(coalesce(p_limit,25),50)) offset greatest(0,coalesce(p_offset,0))
  ) listing;
$$;

revoke execute on function public.create_listed_room(text,uuid,integer,text,text),public.join_listed_room(uuid,text,uuid,text),public.list_rooms(integer,integer) from public,anon;
grant execute on function public.create_listed_room(text,uuid,integer,text,text),public.join_listed_room(uuid,text,uuid,text) to authenticated;
grant execute on function public.list_rooms(integer,integer) to anon,authenticated;
notify pgrst, 'reload schema';
