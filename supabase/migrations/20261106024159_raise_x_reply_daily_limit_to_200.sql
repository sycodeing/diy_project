alter table public.x_reply_accounts
  drop constraint if exists x_reply_accounts_daily_limit_check;

alter table public.x_reply_accounts
  alter column daily_limit set default 200,
  add constraint x_reply_accounts_daily_limit_check
    check (daily_limit between 1 and 200);

update public.x_reply_accounts
set daily_limit = 200
where daily_limit <> 200;
