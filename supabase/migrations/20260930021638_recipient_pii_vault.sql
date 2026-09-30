create table if not exists public.order_recipient_pii_vault (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.orders(id) on delete cascade,
  record_label text not null unique,
  is_test boolean not null default false,
  recipient_name_secret_id uuid not null unique,
  recipient_phone_secret_id uuid not null unique,
  recipient_address_secret_id uuid not null unique,
  recipient_email_secret_id uuid not null unique,
  encryption_scheme text not null default 'Supabase Vault authenticated encryption',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_recipient_pii_requires_order
    check (is_test or order_id is not null)
);

comment on table public.order_recipient_pii_vault is
  'Maps an order to recipient PII encrypted in Supabase Vault. Secret plaintext is never stored in this table.';
comment on column public.order_recipient_pii_vault.recipient_name_secret_id is
  'Vault secret identifier for the encrypted recipient name.';
comment on column public.order_recipient_pii_vault.recipient_phone_secret_id is
  'Vault secret identifier for the encrypted recipient phone number.';
comment on column public.order_recipient_pii_vault.recipient_address_secret_id is
  'Vault secret identifier for the encrypted delivery address.';
comment on column public.order_recipient_pii_vault.recipient_email_secret_id is
  'Vault secret identifier for the encrypted customer email.';

alter table public.order_recipient_pii_vault enable row level security;

revoke all on table public.order_recipient_pii_vault from anon, authenticated;
grant select, insert, update, delete on table public.order_recipient_pii_vault to service_role;

drop trigger if exists set_order_recipient_pii_vault_updated_at
  on public.order_recipient_pii_vault;
create trigger set_order_recipient_pii_vault_updated_at
before update on public.order_recipient_pii_vault
for each row execute function public.touch_updated_at();
