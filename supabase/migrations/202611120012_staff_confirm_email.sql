create function public.staff_confirm_email(p_id uuid, p_email text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target public.profiles; confirmed_at timestamptz;
begin
  perform pg_advisory_xact_lock(1837106112,11);
  perform private.staff_role();
  select * into actor from public.profiles where id=auth.uid();
  select * into target from public.profiles where id=p_id;
  if not found or target.role<>'user' or target.status<>'active' then
    raise exception 'Só é possível confirmar contas ativas de usuários comuns.' using errcode='42501';
  end if;

  select u.email_confirmed_at into confirmed_at
  from auth.users u
  where u.id=p_id and u.email=p_email and not u.is_anonymous
  for update;
  if not found then
    raise exception 'A conta foi alterada. Atualize a lista e tente novamente.';
  end if;
  if confirmed_at is not null then return false; end if;

  update auth.users
  set email_confirmed_at=now(), confirmation_token='', updated_at=now(),
      raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||'{"email_verified":true}'::jsonb
  where id=p_id;

  delete from auth.one_time_tokens where user_id=p_id and token_type='confirmation_token';

  insert into public.admin_audit_logs(actor_id,target_id,actor_name,target_name,action,previous_state,new_state)
  values(actor.id,p_id,actor.username,target.username,'confirm_email',
    '{"email_confirmed":false}'::jsonb,'{"email_confirmed":true}'::jsonb);
  return true;
end; $$;

revoke execute on function public.staff_confirm_email(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.staff_confirm_email(uuid,text) to authenticated;
