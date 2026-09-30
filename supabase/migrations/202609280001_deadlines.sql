-- 新規のSupabaseプロジェクトに適用する。既存テーブルを削除しない。
begin;
create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company text not null check (length(btrim(company)) between 1 and 120),
  task text not null check (length(btrim(task)) between 1 and 240),
  due_date date not null check (due_date between date '2000-01-01' and date '2100-12-31'),
  due_time time(0) check (due_time is null or due_time<time '24:00'),
  submission_url text check (submission_url is null or (length(submission_url)<=2048 and submission_url ~ '^https?://[^/@[:space:]]+([/:?#]|$)' and submission_url !~ '^https?://[^/]*@')),
  status text not null default 'pending' check (status in ('pending','submitted')),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deadlines_owner_date on public.deadlines(owner_id,due_date);
create table public.notification_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  email_enabled boolean not null default false,
  push_enabled boolean not null default false,
  timezone text not null default 'Asia/Tokyo' check (timezone='Asia/Tokyo')
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null check (length(endpoint) between 20 and 2048 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth_key text not null check (auth_key ~ '^[A-Za-z0-9_-]{20,30}$'),
  created_at timestamptz not null default now(),
  unique(owner_id,endpoint)
);
create table public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  deadline_id uuid not null references public.deadlines(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null,
  offset_days integer not null check (offset_days in (3,1)),
  channel text not null check (channel in ('email','push')),
  subscription_id uuid references public.push_subscriptions(id) on delete cascade,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','unknown','cancelled','skipped')),
  attempts integer not null default 0,
  retry_at timestamptz,
  claimed_at timestamptz,
  claim_token uuid,
  last_error text,
  provider_id text,
  finished_at timestamptz,
  check ((channel='email' and subscription_id is null) or (channel='push' and subscription_id is not null))
);
create unique index reminder_jobs_unique on public.reminder_jobs(deadline_id,revision,offset_days,channel,coalesce(subscription_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index reminder_jobs_due on public.reminder_jobs(scheduled_at) where status in ('pending','failed');

alter table public.deadlines enable row level security;
alter table public.notification_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_jobs enable row level security;
create policy deadlines_own on public.deadlines for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy settings_own on public.notification_settings for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy subscriptions_own on public.push_subscriptions for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy reminders_read_own on public.reminder_jobs for select to authenticated using ((select auth.uid())=owner_id);
revoke all on public.deadlines,public.notification_settings,public.push_subscriptions,public.reminder_jobs from anon;
grant select,insert,update,delete on public.deadlines,public.notification_settings,public.push_subscriptions to authenticated;
revoke all on public.reminder_jobs from authenticated;
grant select on public.reminder_jobs to authenticated;
grant all on public.deadlines,public.notification_settings,public.push_subscriptions,public.reminder_jobs to service_role;

create function public.protect_deadline() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then
    NEW.revision:=1; NEW.created_at:=clock_timestamp();
  else
    if NEW.id<>OLD.id or NEW.owner_id<>OLD.owner_id then raise exception 'identity cannot change' using errcode='23514'; end if;
    NEW.created_at:=OLD.created_at;
    NEW.revision:=OLD.revision+case when (NEW.due_date,NEW.due_time,NEW.status,NEW.company,NEW.task,NEW.submission_url) is distinct from (OLD.due_date,OLD.due_time,OLD.status,OLD.company,OLD.task,OLD.submission_url) then 1 else 0 end;
  end if;
  NEW.updated_at:=clock_timestamp();
  return NEW;
end $$;
create trigger protect_deadline before insert or update on public.deadlines for each row execute function public.protect_deadline();

create function public.schedule_deadline(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare
  d public.deadlines; prefs public.notification_settings; sub public.push_subscriptions; offset_day integer; slot timestamptz;
begin
  select * into d from public.deadlines where id=p_id;
  if not found then return; end if;
  select * into prefs from public.notification_settings where owner_id=d.owner_id;
  update public.reminder_jobs set status='cancelled' where deadline_id=d.id and status in ('pending','failed','processing')
    and (d.status<>'pending' or revision<>d.revision or (channel='email' and not coalesce(prefs.email_enabled,false)) or (channel='push' and not coalesce(prefs.push_enabled,false)));
  if d.status<>'pending' or prefs.owner_id is null then return; end if;
  foreach offset_day in array ARRAY[3,1] loop
    slot:=((d.due_date-offset_day)+time '09:00') at time zone 'Asia/Tokyo';
    if slot<=clock_timestamp() then continue; end if;
    if prefs.email_enabled then
      insert into public.reminder_jobs(deadline_id,owner_id,revision,offset_days,channel,scheduled_at)
      values(d.id,d.owner_id,d.revision,offset_day,'email',slot)
      on conflict (deadline_id,revision,offset_days,channel,(coalesce(subscription_id,'00000000-0000-0000-0000-000000000000'::uuid))) do update set status='pending',retry_at=null,last_error=null
      where public.reminder_jobs.status='cancelled';
    end if;
    if prefs.push_enabled then
      for sub in select * from public.push_subscriptions where owner_id=d.owner_id loop
        insert into public.reminder_jobs(deadline_id,owner_id,revision,offset_days,channel,subscription_id,scheduled_at)
        values(d.id,d.owner_id,d.revision,offset_day,'push',sub.id,slot)
        on conflict (deadline_id,revision,offset_days,channel,(coalesce(subscription_id,'00000000-0000-0000-0000-000000000000'::uuid))) do update set status='pending',retry_at=null,last_error=null
        where public.reminder_jobs.status='cancelled';
      end loop;
    end if;
  end loop;
end $$;

create function public.reschedule_after_change() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if TG_TABLE_NAME='deadlines' then perform public.schedule_deadline(NEW.id);
  else
    for target in select id from public.deadlines where owner_id=NEW.owner_id and status='pending' loop perform public.schedule_deadline(target); end loop;
  end if;
  return NEW;
end $$;
create trigger deadlines_schedule after insert or update on public.deadlines for each row execute function public.reschedule_after_change();
create trigger preferences_schedule after insert or update on public.notification_settings for each row execute function public.reschedule_after_change();
create trigger subscriptions_schedule after insert or update on public.push_subscriptions for each row execute function public.reschedule_after_change();

create function public.claim_reminders() returns setof public.reminder_jobs language plpgsql security definer set search_path='' as $$
begin
  -- 結果不明の送信を自動再送しない。ワーカー停止後はunknownとして調査する。
  update public.reminder_jobs set status='unknown',last_error='worker_interrupted' where status='processing' and claimed_at<clock_timestamp()-interval '10 minutes';
  update public.reminder_jobs set status='skipped',last_error='reminder_day_expired' where status in ('pending','failed') and scheduled_at+interval '15 hours'<=clock_timestamp();
  return query
  with candidates as (
    select j.id from public.reminder_jobs j
    where j.status in ('pending','failed') and j.attempts<3 and j.scheduled_at<=clock_timestamp()
      and j.scheduled_at+interval '15 hours'>clock_timestamp() and (j.retry_at is null or j.retry_at<=clock_timestamp())
    order by j.scheduled_at,j.id for update skip locked limit 30
  ) update public.reminder_jobs j set status='processing',attempts=j.attempts+1,claimed_at=clock_timestamp(),claim_token=gen_random_uuid()
    from candidates where j.id=candidates.id returning j.*;
end $$;

revoke all on function public.protect_deadline(),public.schedule_deadline(uuid),public.reschedule_after_change(),public.claim_reminders() from public,anon,authenticated;
grant execute on function public.claim_reminders() to service_role;
commit;
