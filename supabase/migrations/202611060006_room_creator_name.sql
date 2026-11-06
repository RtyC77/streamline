-- Store the creator's nickname in the room name so every participant sees it.
create or replace function public.create_room(p_nickname text,p_client uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; token text;
begin
 if not private.throttle() then return jsonb_build_object('error','Muitas tentativas. Aguarde um minuto.'); end if;
 if char_length(trim(p_nickname)) not between 2 and 24 or p_nickname is null or p_client is null then return jsonb_build_object('error','Use um apelido de 2 a 24 caracteres.'); end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.rooms where created_by=auth.uid() and created_at>now()-interval '1 hour' and expires_at>now())>=3 then return jsonb_build_object('error','Limite de três salas ativas criadas na última hora. Finalize uma sala ou aguarde.'); end if;
 insert into public.rooms(created_by,name) values(auth.uid(),'Sala de '||trim(p_nickname)) returning * into r;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.room_invites values(r.id,sha256(convert_to(token,'UTF8')),r.expires_at);
 insert into public.room_members values(r.id,auth.uid(),trim(p_nickname),p_client,now());
 return private.snapshot(r.id)||jsonb_build_object('invite',token);
end; $$;
