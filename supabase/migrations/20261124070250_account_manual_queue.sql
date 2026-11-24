-- Manual-only data is isolated from x_reply_jobs and every automatic executor.
alter table public.x_reply_jobs add column manual_transferred_at timestamptz;
alter table public.x_reply_jobs add column manual_transfer_reason text;
create table public.x_account_manual_posts (
  id uuid primary key default gen_random_uuid(),
  source_v2_job_id uuid unique references public.x_reply_jobs(id),
  source_account_id uuid references public.x_reply_accounts(id),
  account_id uuid not null references public.x_reply_accounts(id),
  target_author_id text not null,
  target_handle text not null,
  source_post_id text not null,
  target_post_url text not null,
  reply_text text not null,
  snapshot jsonb not null,
  source_v2_snapshot jsonb,
  status text not null default 'draft' check (status in ('draft','reported','discarded')),
  created_by uuid,
  created_at timestamptz not null default now(),
  reported_by uuid,
  reported_at timestamptz,
  result_url text,
  preview_uploaded_by_user boolean not null default false,
  constraint fixed_manual_sender check (account_id = '648f2feb-3820-4306-8192-184444ef7cb8'::uuid),
  constraint manual_result_report check (
    (status = 'reported' and reported_at is not null and reported_by is not null
     and result_url ~ '^https://x[.]com/Le6wCummeratawi/status/[0-9]{5,30}$'
     and (snapshot->>'content_mode' <> 'account_product_preview' or preview_uploaded_by_user))
    or (status <> 'reported' and reported_at is null and reported_by is null and result_url is null))
);
create unique index x_account_manual_active_author on public.x_account_manual_posts(target_author_id) where status in ('draft','reported');
create unique index x_account_manual_result on public.x_account_manual_posts(result_url) where result_url is not null;
create index x_account_manual_sender on public.x_account_manual_posts(account_id,status,created_at);
create index x_account_manual_source_sender on public.x_account_manual_posts(source_account_id);

create table public.x_account_manual_helpers (
  helper_id text primary key,
  boot_id uuid not null,
  booted_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  status text not null check (status in ('online','stopped')),
  helper_version text not null,
  session_id uuid,
  route_revision text,
  expected_ip text,
  session_state text not null default 'idle' check(session_state in ('idle','open','blocked','closed'))
);
create table public.x_account_manual_open_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.x_account_manual_posts(id),
  account_id uuid not null references public.x_reply_accounts(id),
  helper_id text not null references public.x_account_manual_helpers(helper_id),
  boot_id uuid not null,
  route_revision text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  status text not null default 'pending' check (status in ('pending','opening','opened_manual_check','ip_confirmed','blocked','failed')),
  claimed_at timestamptz,
  completed_at timestamptz,
  session_id uuid,
  expected_ip text not null,
  user_confirmed_at timestamptz,
  user_confirmed_by uuid,
  message text,
  constraint fixed_manual_open_sender check (account_id = '648f2feb-3820-4306-8192-184444ef7cb8'::uuid)
);
create index x_account_manual_request_claim on public.x_account_manual_open_requests(helper_id,boot_id,created_at) where status = 'pending';
create index x_account_manual_request_task on public.x_account_manual_open_requests(task_id,created_at desc);
create index x_account_manual_request_sender on public.x_account_manual_open_requests(account_id);

create table public.x_account_manual_migrations (
  source_job_id uuid primary key references public.x_reply_jobs(id),
  manual_post_id uuid not null unique references public.x_account_manual_posts(id),
  migrated_at timestamptz not null default now(),
  migrated_by uuid not null,
  before_snapshot jsonb not null,
  reason text not null
);

alter table public.x_account_manual_posts enable row level security;
alter table public.x_account_manual_helpers enable row level security;
alter table public.x_account_manual_open_requests enable row level security;
alter table public.x_account_manual_migrations enable row level security;
revoke all on public.x_account_manual_posts,public.x_account_manual_helpers,public.x_account_manual_open_requests,public.x_account_manual_migrations from public,anon,authenticated;
grant select,insert,update on public.x_account_manual_posts,public.x_account_manual_helpers,public.x_account_manual_open_requests,public.x_account_manual_migrations to service_role;

-- Old clients cannot resurrect automatic V2 approvals/claims after the move.
create function public.block_automatic_account_v2() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.queue_version = 2 and new.status in ('queued','claimed') then
    if tg_op = 'INSERT' then raise exception 'V2 is manual-only'; end if;
    if old.status is distinct from new.status then raise exception 'V2 is manual-only'; end if;
  end if;
  return new;
end; $$;
create trigger block_automatic_account_v2 before insert or update of status on public.x_reply_jobs
for each row execute function public.block_automatic_account_v2();

-- Cross-table contact guard, serialized per author. Manual rows never authorize auto writes.
create function public.guard_account_manual_contact() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.status in ('draft','reported') then
    perform pg_advisory_xact_lock(hashtextextended('x-author:' || new.target_author_id,0));
    if exists(select 1 from public.x_reply_jobs j where j.target_author_id = new.target_author_id
      and j.status in ('draft','queued','claimed','sent','uncertain')
      and j.id is distinct from new.source_v2_job_id) then raise exception 'Existing X contact or reply task'; end if;
  end if;
  return new;
end; $$;
create trigger guard_account_manual_contact before insert or update of status on public.x_account_manual_posts
for each row execute function public.guard_account_manual_contact();

create function public.guard_reply_against_account_manual() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.target_author_id is not null and new.status in ('draft','queued','claimed','sent','uncertain') then
    perform pg_advisory_xact_lock(hashtextextended('x-author:' || new.target_author_id,0));
    if exists(select 1 from public.x_account_manual_posts m where m.target_author_id = new.target_author_id
      and m.status in ('draft','reported')) then raise exception 'Author reserved in manual queue'; end if;
  end if;
  return new;
end; $$;
create trigger guard_reply_against_account_manual before insert or update of status on public.x_reply_jobs
for each row execute function public.guard_reply_against_account_manual();

-- Explicit, reviewable data move; installing this schema does not migrate/send/open anything.
create function public.migrate_account_v2_to_manual(p_job_ids uuid[], p_actor uuid) returns integer
language plpgsql security invoker set search_path = public as $$
declare
  j public.x_reply_jobs%rowtype;
  mid uuid;
  n integer := 0;
  expected_ids uuid[] := array[
    '0f27875c-3040-41e8-b23d-8b448756629d','a7c9b84c-0fe1-45c4-aec9-2cbc7d385cd0',
    '2155cd69-7e74-43ce-817d-1b67e4737b4f','bf062aaa-b5d1-48cd-8c05-e98d9a7b0305',
    'ad6faea7-68a6-46e6-803f-dd98dc515f95','818d6986-8e35-4be8-9acd-12223ba611af',
    'dff21bf9-0054-477c-bbcd-b2e2d2b481e4','76ded0d4-13e5-47a4-91e1-86854c2a3502',
    'b81ee7ab-e1c5-4d45-bc7c-0e62000b7fcb','d1204402-d353-41e4-978e-35a7bb89e5a9',
    '6693bf54-b047-4f66-9425-7af38527e631','8f893872-95b9-421e-aeea-ba42070bd504',
    '48e8b2c5-faab-4134-8ee5-2c76ec330e59','cf1eb1c0-1fa5-4e94-a6bc-5bc1c4777c92',
    '3162ce8c-a7ab-443e-8210-2d07f7b41e66','3ddb170c-25da-4f53-9573-485360b02256',
    '71743bf2-a3e2-415c-9054-43e30847e1bb','c3906faa-090c-454a-ad5f-b0ecb3264111']::uuid[];
begin
  if p_actor is null or cardinality(p_job_ids) <> 18 or not p_job_ids @> expected_ids or not expected_ids @> p_job_ids then
    raise exception 'Migration requires the exact frozen 18 jobs and an audit actor';
  end if;
  if not exists(select 1 from public.x_reply_accounts where id='648f2feb-3820-4306-8192-184444ef7cb8'
    and account_key='Le6wCummeratawi' and active and network_mode='fixed_proxy') then raise exception 'Fixed manual sender unavailable'; end if;
  for j in select * from public.x_reply_jobs where id=any(p_job_ids) order by id for update loop
    if exists(select 1 from public.x_account_manual_migrations where source_job_id=j.id) then
      if j.status <> 'rejected' then raise exception 'Migrated source changed'; end if;
      n := n+1; continue;
    end if;
    if j.queue_version <> 2 or j.account_id <> '670f94f4-7d00-49ce-b31d-43816feaa821'::uuid
      or j.status <> 'queued' or j.attempt_count <> 0 or j.claimed_at is not null
      or j.completed_at is not null or j.result_url is not null or j.preparation_status <> 'ready'
      or j.content_mode <> 'account_product_preview' or j.account_preview_path is null
      or j.account_preview_hash is null then raise exception 'Source is no longer an untouched queued preview: %',j.id; end if;
    insert into public.x_account_manual_posts(source_v2_job_id,source_account_id,account_id,target_author_id,target_handle,
      source_post_id,target_post_url,reply_text,snapshot,source_v2_snapshot,created_by)
    values(j.id,j.account_id,'648f2feb-3820-4306-8192-184444ef7cb8',j.target_author_id,
      split_part(j.target_post_url,'/',4),j.source_post_id,j.target_post_url,j.reply_text,to_jsonb(j),to_jsonb(j),p_actor)
    returning id into mid;
    update public.x_reply_jobs set status='rejected',manual_transferred_at=now(),
      manual_transfer_reason='Transferred to manual queue; original content, approval and schedule retained.'
      where id=j.id and status='queued' and attempt_count=0 and claimed_at is null;
    if not found then raise exception 'Concurrent source update'; end if;
    insert into public.x_account_manual_migrations(source_job_id,manual_post_id,migrated_by,before_snapshot,reason)
      values(j.id,mid,p_actor,to_jsonb(j),'User requested manual-only account queue on 2026-11-24');
    n := n+1;
  end loop;
  if n <> 18 then raise exception 'Missing source jobs'; end if;
  return n;
end; $$;

revoke all on function public.block_automatic_account_v2(),public.guard_account_manual_contact(),public.guard_reply_against_account_manual() from public,anon,authenticated;
revoke all on function public.migrate_account_v2_to_manual(uuid[],uuid) from public,anon,authenticated;
grant execute on function public.migrate_account_v2_to_manual(uuid[],uuid) to service_role;
