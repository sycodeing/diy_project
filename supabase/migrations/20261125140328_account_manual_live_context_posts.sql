-- New navigation authorization is separate from historic X-home requests.
alter table public.x_account_manual_open_requests drop constraint x_account_manual_open_requests_purpose_check;
alter table public.x_account_manual_open_requests add constraint x_account_manual_open_requests_purpose_check
  check (purpose in ('legacy_ip','manual_task_x_home','account_x_home','manual_task_x_post'));
alter table public.x_account_manual_open_requests drop constraint manual_open_purpose_task;
alter table public.x_account_manual_open_requests add constraint manual_open_purpose_task
  check ((purpose in ('legacy_ip','manual_task_x_home','manual_task_x_post') and task_id is not null)
      or (purpose = 'account_x_home' and task_id is null));
alter table public.x_account_manual_open_requests drop constraint x_account_manual_open_requests_status_check;
alter table public.x_account_manual_open_requests add constraint x_account_manual_open_requests_status_check
  check (status in ('pending','opening','opened_manual_check','ip_confirmed','opened_x_home','opened_x_post','blocked','failed'));
