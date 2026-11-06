-- Additive, backwards-compatible. Keep the epoch on admission; revoke cached
-- authorization by rotating it only when an association is actually removed.
create or replace function public.join_room(p_invite text,p_nickname text,p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rid uuid; previous_epoch uuid; existing public.room_members; removed integer; recipient uuid;
begin
  if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
  if p_invite is null or p_invite !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','Convite inválido ou expirado.'); end if;
  if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
  select r.id,r.channel_epoch into rid,previous_epoch from public.rooms r join public.room_invites i on i.room_id=r.id
    where i.token_hash=sha256(convert_to(p_invite,'UTF8')) and i.expires_at>now() and r.expires_at>now() for update of r;
  if rid is null then return jsonb_build_object('error','Convite inválido ou expirado.'); end if;
  delete from public.room_members where room_id=rid and last_seen<=now()-interval '60 seconds';
  get diagnostics removed = row_count;
  if removed>0 then update public.rooms set channel_epoch=gen_random_uuid() where id=rid; end if;
  select * into existing from public.room_members where room_id=rid and user_id=auth.uid();
  if existing.user_id is not null and existing.client_id<>p_client then return jsonb_build_object('error','Esta sala já está aberta em outra aba. Feche-a e aguarde até um minuto.'); end if;
  if existing.user_id is null and (select count(*) from public.room_members where room_id=rid)>=5 then return jsonb_build_object('error','A sala está cheia. O limite é de cinco participantes.'); end if;
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
