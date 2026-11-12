create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_.-]{2,24}$'),
  role text not null default 'user' check (role in ('user','admin','superadmin')),
  status text not null default 'active' check (status in ('active','blocked')),
  can_create_rooms boolean not null default false,
  version bigint not null default 0
);
create unique index profiles_username_unique on public.profiles (lower(username));

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_id uuid not null,
  actor_name text not null,
  target_name text not null,
  action text not null,
  created_at timestamptz not null default now(),
  previous_state jsonb not null,
  new_state jsonb not null
);
alter table public.profiles enable row level security;
alter table public.admin_audit_logs enable row level security;
revoke all on public.profiles,public.admin_audit_logs from public,anon,authenticated,service_role;
grant select on public.profiles to authenticated;

create function private.create_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare name text := btrim(new.raw_user_meta_data->>'username');
begin
  if new.is_anonymous or new.email is null then return new; end if;
  if name is null or name !~ '^[A-Za-z0-9_.-]{2,24}$' then
    raise exception 'Use um nome de usuário de 2 a 24 caracteres.';
  end if;
  if lower(name)='rod' and lower(new.email)<>'ropolatto77@gmail.com' then
    raise exception 'Nome de usuário reservado.';
  end if;
  insert into public.profiles(id,username) values(new.id,name);
  return new;
end; $$;
create trigger streamlite_profile_created after insert on auth.users
for each row execute function private.create_profile();

insert into public.profiles(id,username)
select id,'u_'||substr(replace(id::text,'-',''),1,22)
from auth.users where not is_anonymous and email is not null;

create function private.active_account() returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.profiles p join auth.users u using(id)
    where p.id=(select auth.uid()) and p.status='active'
      and u.email is not null and u.email_confirmed_at is not null and not u.is_anonymous
  );
$$;
create policy own_profile on public.profiles for select to authenticated
using (id=(select auth.uid()));

-- FOR SHARE serializes protected mutations with grants, revocations and blocking.
create function private.require_account(p_create boolean default false) returns text
language plpgsql security definer set search_path='' as $$
declare account public.profiles;
begin
  select p.* into account from public.profiles p where p.id=auth.uid() for share;
  if not private.active_account() or account.status is distinct from 'active' then
    raise exception 'Conta bloqueada ou e-mail não confirmado.' using errcode='42501';
  end if;
  if p_create and not account.can_create_rooms then
    raise exception 'Você ainda não possui autorização para criar salas. Entre em contato com um administrador.' using errcode='42501';
  end if;
  return account.username;
end; $$;

create function private.staff_role() returns text
language plpgsql stable security definer set search_path='' as $$
declare account_role text;
begin
  select role into account_role from public.profiles where id=auth.uid();
  if account_role is null or account_role='user' or not private.active_account() then
    raise exception 'Acesso administrativo restrito.' using errcode='42501';
  end if;
  return account_role;
end; $$;

create function public.staff_users(
  p_search text default '', p_status text default '', p_role text default '', p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.staff_role();
  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id),'[]'::jsonb)
  into result from (
    select p.*,u.email,u.created_at,u.last_sign_in_at,u.email_confirmed_at
    from public.profiles p join auth.users u using(id)
    where (coalesce(p_status,'')='' or p.status=p_status)
      and (coalesce(p_role,'')='' or p.role=p_role)
      and (strpos(lower(p.username),lower(left(coalesce(p_search,''),254)))>0
        or strpos(lower(u.email),lower(left(coalesce(p_search,''),254)))>0)
    order by u.created_at desc,p.id limit 26 offset greatest(0,p_offset)
  ) page;
  return result;
end; $$;

create function public.staff_audit(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.staff_role();
  select coalesce(jsonb_agg(to_jsonb(page) order by page.id desc),'[]'::jsonb)
  into result from (
    select * from public.admin_audit_logs order by id desc limit 26 offset greatest(0,p_offset)
  ) page;
  return result;
end; $$;

-- Serialize administrative writes, including concurrent attempts to remove the last SuperAdmin.
create function private.lock_profiles() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(1837106112,11);
  return null;
end; $$;
create trigger profiles_write_lock before insert or update or delete on public.profiles
for each statement execute function private.lock_profiles();

create function private.keep_superadmin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.role='superadmin' and old.status='active'
    and (tg_op='DELETE' or new.role<>'superadmin' or new.status<>'active')
    and not exists (
      select 1 from public.profiles p join auth.users u using(id)
      where p.id<>old.id and p.role='superadmin' and p.status='active'
        and u.email_confirmed_at is not null and not u.is_anonymous
    ) then
    raise exception 'O último SuperAdmin ativo deve ser mantido.' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger profiles_keep_superadmin before update or delete on public.profiles
for each row execute function private.keep_superadmin();

create function public.update_own_username(p_username text) returns text
language plpgsql security definer set search_path='' as $$
declare name text := btrim(p_username); previous text;
begin
  perform pg_advisory_xact_lock(1837106112,11);
  previous := private.require_account();
  if name is null or name !~ '^[A-Za-z0-9_.-]{2,24}$' then
    raise exception 'Use de 2 a 24 letras, números, pontos, hífens ou sublinhados.';
  end if;
  if name=previous then return name; end if;
  if lower(name)='rod' or lower(previous)='rod' then
    raise exception 'O nome Rod está reservado para a conta definitiva.';
  end if;
  update public.profiles set username=name,version=version+1 where id=auth.uid();
  return name;
exception when unique_violation then
  raise exception 'Esse nome de usuário já está em uso.';
end; $$;

create function public.staff_update_user(p_id uuid,p_action text,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; previous public.profiles; updated public.profiles; affected record;
begin
  perform pg_advisory_xact_lock(1837106112,11);
  perform private.staff_role();
  select * into actor from public.profiles where id=auth.uid();
  select * into previous from public.profiles where id=p_id for update;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  if actor.id=p_id or (actor.role='admin' and (
    previous.role='superadmin' or p_action in ('promote','demote')
      or (p_action in ('block','unblock') and previous.role<>'user')
  )) then
    raise exception 'Operação não autorizada.' using errcode='42501';
  end if;
  if previous.version is distinct from p_version then
    raise exception 'A conta foi alterada. Atualize a lista e tente novamente.';
  end if;

  updated := previous;
  case p_action
    when 'grant_rooms' then updated.can_create_rooms := true;
    when 'revoke_rooms' then updated.can_create_rooms := false;
    when 'block' then updated.status := 'blocked';
    when 'unblock' then updated.status := 'active';
    when 'promote' then
      if previous.role<>'user' then raise exception 'Cargo inválido para promoção.'; end if;
      updated.role := 'admin';
    when 'demote' then
      if previous.role<>'admin' then raise exception 'Cargo inválido para rebaixamento.'; end if;
      updated.role := 'user';
    else raise exception 'Ação inválida.';
  end case;
  if updated=previous then return; end if;
  update public.profiles set role=updated.role,status=updated.status,
    can_create_rooms=updated.can_create_rooms,version=version+1 where id=p_id;
  if p_action='block' then
    for affected in
      select r.id,r.channel_epoch from public.rooms r join public.room_members m on m.room_id=r.id
      where m.user_id=p_id order by r.id for update of r
    loop
      delete from public.room_members where room_id=affected.id and user_id=p_id;
      update public.rooms set channel_epoch=gen_random_uuid() where id=affected.id;
      perform realtime.send('{}'::jsonb,'state-changed',
        'room:'||affected.id::text||':'||affected.channel_epoch::text||':user:'||p_id::text,true);
    end loop;
  end if;
  insert into public.admin_audit_logs(actor_id,target_id,actor_name,target_name,action,previous_state,new_state)
  values(actor.id,p_id,actor.username,previous.username,p_action,
    to_jsonb(previous)-array['id','username','version'],to_jsonb(updated)-array['id','username','version']);
end; $$;

create function public.bootstrap_streamlite_superadmin(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare previous public.profiles; updated public.profiles;
begin
  perform pg_advisory_xact_lock(1837106112,11);
  if not exists (
    select 1 from auth.users where id=p_id and lower(email)='ropolatto77@gmail.com'
      and email_confirmed_at is not null and not is_anonymous
  ) then raise exception 'Conta definitiva verificada não encontrada.'; end if;
  select * into strict previous from public.profiles where id=p_id for update;
  if previous.username='Rod' and previous.role='superadmin' and previous.status='active'
    and previous.can_create_rooms then return; end if;
  update public.profiles set username='Rod',role='superadmin',status='active',
    can_create_rooms=true,version=version+1 where id=p_id returning * into updated;
  insert into public.admin_audit_logs(actor_id,target_id,actor_name,target_name,action,previous_state,new_state)
  values(p_id,p_id,'Inicialização administrativa','Rod','bootstrap',
    to_jsonb(previous)-array['id','version'],to_jsonb(updated)-array['id','version']);
end; $$;

create function public.staff_rooms() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.staff_role()<>'superadmin' then raise exception 'Acesso restrito.' using errcode='42501'; end if;
  return public.admin_list_rooms();
end; $$;

create function public.staff_close_room(p_room uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor_name text; owner_id uuid; owner_name text;
begin
  perform pg_advisory_xact_lock(1837106112,11);
  if private.staff_role()<>'superadmin' then raise exception 'Acesso restrito.' using errcode='42501'; end if;
  select r.created_by,coalesce(p.username,r.name) into owner_id,owner_name
  from public.rooms r left join public.profiles p on p.id=r.created_by where r.id=p_room for update of r;
  if not public.admin_close_room(p_room) then return false; end if;
  select username into actor_name from public.profiles where id=auth.uid();
  insert into public.admin_audit_logs(actor_id,target_id,actor_name,target_name,action,previous_state,new_state)
  values(auth.uid(),owner_id,actor_name,owner_name,'close_room',
    jsonb_build_object('room_id',p_room,'status','active'),jsonb_build_object('room_id',p_room,'status','closed'));
  return true;
end; $$;

revoke execute on function private.create_profile(),private.active_account(),private.require_account(boolean),
  private.staff_role(),private.lock_profiles(),private.keep_superadmin() from public,anon,authenticated;
revoke execute on function public.staff_users(text,text,text,integer),public.staff_audit(integer),
  public.staff_update_user(uuid,text,bigint),public.staff_rooms(),public.staff_close_room(uuid),
  public.update_own_username(text),public.bootstrap_streamlite_superadmin(uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_users(text,text,text,integer),public.staff_audit(integer),
  public.staff_update_user(uuid,text,bigint),public.staff_rooms(),public.staff_close_room(uuid),
  public.update_own_username(text) to authenticated;
grant execute on function public.bootstrap_streamlite_superadmin(uuid) to service_role;

-- Remove memberships of legacy guests at cutover and rotate their room topics.
do $$
declare rid uuid;
begin
  for rid in
    select r.id from public.rooms r where exists (
      select 1 from public.room_members m left join public.profiles p on p.id=m.user_id
      where m.room_id=r.id and p.id is null
    ) order by r.id for update
  loop
    delete from public.room_members m where m.room_id=rid
      and not exists(select 1 from public.profiles p where p.id=m.user_id);
    update public.rooms set channel_epoch=gen_random_uuid() where id=rid;
  end loop;
end; $$;


create or replace function public.create_room(p_nickname text,p_client uuid,p_max_members integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; token text;
begin
 p_nickname := private.require_account(true);
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

create or replace function private.admit_room(p_invite text,p_room uuid,p_password text,p_nickname text,p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rid uuid; previous_epoch uuid; existing public.room_members; removed integer; recipient uuid; capacity integer; access_mode text; secret text;
begin
  p_nickname := private.require_account();
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

create or replace function private.touch(p_room uuid,p_client uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_account();
 perform 1 from public.rooms where id=p_room and expires_at>now() for update;
 if not found then raise exception 'A sala expirou. Crie uma nova sala.'; end if;
 update public.room_members set last_seen=now() where room_id=p_room and user_id=auth.uid() and client_id=p_client and last_seen>now()-interval '60 seconds';
 if not found then raise exception 'Sua participação expirou. Entre novamente pelo convite.'; end if;
end; $$;

create or replace function private.is_member(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.active_account() and exists(select 1 from public.room_members m join public.rooms r on r.id=m.room_id
    where m.room_id=p_room and m.user_id=(select auth.uid())
    and m.last_seen > now()-interval '60 seconds' and r.expires_at > now());
$$;

create or replace function public.leave_room(p_room uuid,p_client uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_account();
  perform 1 from public.rooms where id=p_room for update;
  if not exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and client_id=p_client) then return; end if;
  update public.rooms set broadcaster_id=null,stream_session=null,stream_expires_at=null where id=p_room and broadcaster_id=auth.uid();
  delete from public.room_members where room_id=p_room and user_id=auth.uid() and client_id=p_client;
  update public.rooms set channel_epoch=gen_random_uuid() where id=p_room;
end; $$;

create or replace function public.authorize_turn(p_room uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not private.active_account() or not private.throttle() then return false; end if;
  return private.is_member(p_room);
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
    from public.rooms r where (select private.active_account()) and r.expires_at>now() and r.vacancy_deadline>statement_timestamp()
    order by r.created_at desc,r.id
    limit greatest(1,least(coalesce(p_limit,25),50)) offset greatest(0,coalesce(p_offset,0))
  ) listing;
$$;

revoke execute on function public.list_rooms(integer,integer) from public,anon;
notify pgrst, 'reload schema';
