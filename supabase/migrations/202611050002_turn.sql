-- Optional TURN endpoint authorization. No elevated key is used in the browser.
create function public.authorize_turn(p_room uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not private.throttle() then return false; end if;
  return private.is_member(p_room);
end; $$;
revoke execute on function public.authorize_turn(uuid) from public,anon;
grant execute on function public.authorize_turn(uuid) to authenticated;
