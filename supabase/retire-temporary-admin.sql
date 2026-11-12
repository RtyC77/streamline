-- Execute depois de validar o login de Rod na aplicação publicada.
begin;
do $$
begin
  if not exists (
    select 1 from public.profiles p join auth.users u using(id)
    where p.username='Rod' and p.role='superadmin' and p.status='active'
      and p.can_create_rooms and lower(u.email)='ropolatto77@gmail.com'
      and u.email_confirmed_at is not null and u.last_sign_in_at is not null
  ) then
    raise exception 'Valide primeiro o acesso administrativo de Rod.';
  end if;
end; $$;

revoke execute on function public.admin_list_rooms(),public.admin_close_room(uuid)
from public,anon,authenticated,service_role;
drop function if exists public.admin_login_gate();
drop table if exists private.admin_login_budget;
notify pgrst, 'reload schema';
commit;
