-- One lease per broadcaster, at most three live leases per room.
create table public.room_streams (
 room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid not null,
 session_id uuid not null unique default gen_random_uuid(),
 expires_at timestamptz not null default now()+interval '35 seconds',
 primary key(room_id,user_id),
 foreign key(room_id,user_id) references public.room_members(room_id,user_id) on delete cascade
);
alter table public.room_streams enable row level security;
revoke all on public.room_streams from anon,authenticated;
grant select on public.room_streams to authenticated;
create policy streams_read on public.room_streams for select to authenticated using(private.is_member(room_id));
-- Preserve an existing live transmission across the migration.
insert into public.room_streams(room_id,user_id,session_id,expires_at)
 select r.id,r.broadcaster_id,r.stream_session,r.stream_expires_at from public.rooms r
 join public.room_members m on m.room_id=r.id and m.user_id=r.broadcaster_id
 where r.expires_at>now() and r.stream_expires_at>now() and r.stream_session is not null and m.last_seen>now()-interval '60 seconds';
update public.rooms set broadcaster_id=null,stream_session=null,stream_expires_at=null;

create or replace function private.snapshot(p_room uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('room',jsonb_build_object('id',r.id,'name',r.name,'max_members',r.max_members,'created_by',r.created_by,
 'expires_at',r.expires_at,'channel_epoch',r.channel_epoch,'broadcaster_id',null,'stream_session',null),
 'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'nickname',m.nickname,'client_id',m.client_id)) from public.room_members m
 where m.room_id=r.id and m.last_seen>now()-interval '60 seconds'),'[]'::jsonb),
 'streams',coalesce((select jsonb_agg(jsonb_build_object('broadcaster_id',s.user_id,'session_id',s.session_id) order by s.user_id)
 from public.room_streams s join public.room_members m on m.room_id=s.room_id and m.user_id=s.user_id
 where s.room_id=r.id and s.expires_at>now() and m.last_seen>now()-interval '60 seconds'),'[]'::jsonb))
 from public.rooms r where r.id=p_room;
$$;

create or replace function private.touch(p_room uuid,p_client uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.rooms where id=p_room and expires_at>now() for update;
 if not found then raise exception 'A sala expirou. Crie uma nova sala.'; end if;
 update public.room_members set last_seen=now() where room_id=p_room and user_id=auth.uid() and client_id=p_client and last_seen>now()-interval '60 seconds';
 if not found then raise exception 'Sua participação expirou. Entre novamente pelo convite.'; end if;
end; $$;

create or replace function public.room_pulse(p_room uuid,p_client uuid,p_session uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 perform private.touch(p_room,p_client);
 delete from public.room_members where room_id=p_room and last_seen<=now()-interval '60 seconds';
 get diagnostics removed=row_count;
 if removed>0 then update public.rooms set channel_epoch=gen_random_uuid() where id=p_room; end if;
 delete from public.room_streams where room_id=p_room and expires_at<=now();
 update public.room_streams set expires_at=now()+interval '35 seconds' where room_id=p_room and user_id=auth.uid() and session_id=p_session and expires_at>now();
 return private.snapshot(p_room);
end; $$;

create or replace function public.claim_stream(p_room uuid,p_client uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 -- touch locks the room: concurrent claimers cannot exceed the three-slot limit.
 perform private.touch(p_room,p_client);
 delete from public.room_streams where room_id=p_room and expires_at<=now();
 if exists(select 1 from public.room_streams where room_id=p_room and user_id=auth.uid()) then raise exception 'Você já está compartilhando uma tela.'; end if;
 if (select count(*) from public.room_streams where room_id=p_room)>=3 then raise exception 'A sala já tem três telas compartilhadas. Aguarde uma transmissão terminar.'; end if;
 insert into public.room_streams(room_id,user_id) values(p_room,auth.uid()) returning session_id into sid;
 return sid;
end; $$;

create or replace function public.release_stream(p_room uuid,p_client uuid,p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.touch(p_room,p_client);
 delete from public.room_streams where room_id=p_room and user_id=auth.uid() and session_id=p_session;
end; $$;

create or replace function public.admin_list_rooms() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'created_at',r.created_at,'expires_at',r.expires_at,
 'participants',(select count(*) from public.room_members m where m.room_id=r.id and m.last_seen>now()-interval '60 seconds'),
 'transmitting',exists(select 1 from public.room_streams s where s.room_id=r.id and s.expires_at>now())) order by r.created_at desc),'[]'::jsonb)
 from public.rooms r where r.expires_at>now();
$$;
-- Existing function grants survive CREATE OR REPLACE. No direct media writes.
notify pgrst,'reload schema';
