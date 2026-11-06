create or replace function private.snapshot(p_room uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('room',jsonb_build_object('id',r.id,'name',r.name,'created_by',r.created_by,'expires_at',r.expires_at,'channel_epoch',r.channel_epoch,
    'broadcaster_id',case when r.stream_expires_at>now() then r.broadcaster_id end,
    'stream_session',case when r.stream_expires_at>now() then r.stream_session end),
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'nickname',m.nickname,'client_id',m.client_id))
      from public.room_members m where m.room_id=r.id and m.last_seen>now()-interval '60 seconds'),'[]'::jsonb))
  from public.rooms r where r.id=p_room;
$$;
create function public.kick_member(p_room uuid,p_client uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; old_epoch uuid;
begin
  perform private.touch(p_room,p_client);
  select created_by,channel_epoch into owner_id,old_epoch from public.rooms where id=p_room;
  if owner_id<>auth.uid() then raise exception 'Somente o host pode expulsar participantes.' using errcode='42501'; end if;
  if p_user=owner_id then raise exception 'Use Sair da sala para encerrar sua participação.'; end if;
  delete from public.room_members where room_id=p_room and user_id=p_user;
  if found then
    update public.rooms set channel_epoch=gen_random_uuid(),
      broadcaster_id=case when broadcaster_id=p_user then null else broadcaster_id end,
      stream_session=case when broadcaster_id=p_user then null else stream_session end,
      stream_expires_at=case when broadcaster_id=p_user then null else stream_expires_at end
      where id=p_room;
    perform realtime.send('{}'::jsonb,'state-changed','room:'||p_room::text||':'||old_epoch::text||':user:'||owner_id::text,true);
  end if;
  return private.snapshot(p_room);
end; $$;
revoke execute on function public.kick_member(uuid,uuid,uuid) from public,anon;
grant execute on function public.kick_member(uuid,uuid,uuid) to authenticated;
revoke execute on function private.snapshot(uuid) from public,anon,authenticated;
