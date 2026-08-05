-- fb-proposal-generator schema
-- Run once against the Supabase project (SQL Editor or `supabase db push`).
-- After running this, also create a Storage bucket named "proposals" via
-- the dashboard (Storage -> New bucket) with "Public bucket" UNCHECKED —
-- generated files contain client PII and are served via signed URLs
-- (see lib/supabase.js), not public links.

create extension if not exists "uuid-ossp";

create table if not exists clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists proposals (
  id uuid primary key default uuid_generate_v4(),
  proposal_num text not null,
  client_id uuid references clients(id) on delete set null,
  client_name text not null,
  client_address text,
  client_phone text,
  client_email text,
  date text not null,
  sections jsonb not null,
  total_amount numeric not null,
  total_label text,
  notes text,
  docx_storage_path text,
  pdf_storage_path text,
  created_at timestamptz not null default now()
);

-- RLS: deny-by-default. All reads/writes happen server-side in
-- api/generate.js using the service role key, which bypasses RLS
-- automatically — no policies are added for anon/authenticated roles,
-- since client PII (name, address, phone, email) lives in these tables.
alter table clients enable row level security;
alter table proposals enable row level security;
