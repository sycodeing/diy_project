alter table public.x_reply_accounts
  add column if not exists batch_sent_count integer not null default 0,
  add column if not exists cooldown_until timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'x_reply_accounts_batch_sent_count_check'
      and conrelid = 'public.x_reply_accounts'::regclass
  ) then
    alter table public.x_reply_accounts
      add constraint x_reply_accounts_batch_sent_count_check
      check (batch_sent_count between 0 and 11);
  end if;
end
$$;

comment on column public.x_reply_accounts.batch_sent_count is
  'Confirmed sends for this account since its last 45-minute rest; resets after the twelfth send.';
comment on column public.x_reply_accounts.cooldown_until is
  'This account cannot claim another write before this time; other accounts remain eligible.';
comment on column public.x_reply_workers.batch_sent_count is
  'Legacy worker-wide counter retained for rollout compatibility; account counters control rests.';
comment on column public.x_reply_workers.cooldown_until is
  'Legacy worker-wide cooldown retained for rollout compatibility; account cooldowns control claims.';
