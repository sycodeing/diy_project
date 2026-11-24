-- New X-home requests require a fresh explicit user action. Legacy IP-only requests never authorize X.
alter table public.x_account_manual_open_requests
  add column purpose text not null default 'legacy_ip' check (purpose in ('legacy_ip','manual_task_x_home','account_x_home'));
alter table public.x_account_manual_open_requests alter column task_id drop not null;
alter table public.x_account_manual_open_requests add constraint manual_open_purpose_task
  check ((purpose in ('legacy_ip','manual_task_x_home') and task_id is not null)
      or (purpose = 'account_x_home' and task_id is null));
alter table public.x_account_manual_open_requests drop constraint x_account_manual_open_requests_status_check;
alter table public.x_account_manual_open_requests add constraint x_account_manual_open_requests_status_check
  check (status in ('pending','opening','opened_manual_check','ip_confirmed','opened_x_home','blocked','failed'));
alter table public.x_account_manual_open_requests add column observed_x_handle text;
alter table public.x_account_manual_helpers add column observed_x_handle text;
create index x_account_manual_request_account_purpose
  on public.x_account_manual_open_requests(account_id,purpose,boot_id,created_at desc);
