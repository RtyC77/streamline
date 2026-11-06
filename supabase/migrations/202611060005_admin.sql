create table private.admin_login_budget(id boolean primary key default true check(id), window_start timestamptz not null, attempts integer not null);
alter table private.admin_login_budget enable row level security;
create function public.admin_login_gate() returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into private.admin_login_budget values(true,now(),1) on conflict(id) do update set
 attempts=case when private.admin_login_budget.window_start<now()-interval '15 minutes' then 1 else private.admin_login_budget.attempts+1 end,
 window_start=case when private.admin_login_budget.window_start<now()-interval '15 minutes' then now() else private.admin_login_budget.window_start end returning attempts into n;
 return n<=20;
end; $$;
create function public.admin_list_rooms() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'created_at',r.created_at,'expires_at',r.expires_at,
 'participants',(select count(*) from public.room_members m where m.room_id=r.id and m.last_seen>now()-interval '60 seconds'),
 'transmitting',r.stream_expires_at>now() and r.broadcaster_id is not null) order by r.created_at desc),'[]'::jsonb)
 from public.rooms r where r.expires_at>now();
$$;
create function public.admin_close_room(p_room uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare old_epoch uuid; recipient uuid;
begin
 select channel_epoch into old_epoch from public.rooms where id=p_room and expires_at>now() for update;
 if not found then return false; end if;
 select user_id into recipient from public.room_members where room_id=p_room order by user_id limit 1;
 update public.rooms set expires_at=now(),broadcaster_id=null,stream_session=null,stream_expires_at=null,channel_epoch=gen_random_uuid() where id=p_room;
 update public.room_invites set expires_at=now() where room_id=p_room;
 delete from public.room_members where room_id=p_room;
 if recipient is not null then perform realtime.send('{}'::jsonb,'state-changed','room:'||p_room::text||':'||old_epoch::text||':user:'||recipient::text,true); end if;
 return true;
end; $$;
revoke all on function public.admin_login_gate(),public.admin_list_rooms(),public.admin_close_room(uuid) from public,anon,authenticated;
grant execute on function public.admin_login_gate(),public.admin_list_rooms(),public.admin_close_room(uuid) to service_role;

create index if not exists rooms_expiration_idx on public.rooms(expires_at);
create index if not exists rooms_creator_recent_idx on public.rooms(created_by,created_at);
-- Finalized rooms no longer occupy one of the three recent active slots.
create or replace function public.create_room(p_nickname text,p_client uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; token text;
begin
 if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
 if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.rooms where created_by=auth.uid() and created_at>now()-interval '1 hour' and expires_at>now())>=3 then return jsonb_build_object('error','Limite de três salas ativas criadas na última hora. Finalize uma sala ou aguarde.'); end if;
 insert into public.rooms(created_by) values(auth.uid()) returning * into r;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.room_invites values(r.id,sha256(convert_to(token,'UTF8')),r.expires_at);
 insert into public.room_members values(r.id,auth.uid(),trim(p_nickname),p_client,now());
 return private.snapshot(r.id)||jsonb_build_object('invite',token);
end; $$;
