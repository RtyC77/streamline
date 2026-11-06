-- Execute as postgres in SQL Editor. Enable the Supabase Cron integration first.
-- Re-running replaces this named schedule rather than creating duplicates.
select cron.schedule('streamlite-cleanup', '*/15 * * * *', $job$
  delete from public.rooms where expires_at < now();
  delete from private.attempts where window_start < now()-interval '1 day';
  delete from auth.users u where u.is_anonymous is true
    and u.created_at < now()-interval '30 days'
    and not exists(select 1 from public.room_members m join public.rooms r on r.id=m.room_id
      where m.user_id=u.id and r.expires_at>now())
    and not exists(select 1 from public.rooms r where r.created_by=u.id and r.expires_at>now());
$job$);
