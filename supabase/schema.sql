-- fb-proposal-generator schema
-- Run once against the Supabase project (SQL Editor or `supabase db push`).
--
-- Table names are prefixed fbpg_ (FB Proposal Generator) because this
-- project shares a Supabase project with other apps in this workspace,
-- which already have their own unrelated `clients` and `proposals` tables
-- (a generic id + jsonb `data` shape used by cabinetprice/alfa-studio-tracker).
-- Do NOT rename these back to the unprefixed names -- see the commit history
-- for why (an earlier version of this script collided with those tables).
--
-- The Storage bucket (created separately via scripts/setup-storage-bucket.js,
-- not this file) is named "proposals" -- that's a different namespace from
-- Postgres tables and was confirmed not to collide with anything.

create extension if not exists "uuid-ossp";

create table if not exists fbpg_clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists fbpg_proposals (
  id uuid primary key default uuid_generate_v4(),
  proposal_num text not null,
  client_id uuid references fbpg_clients(id) on delete set null,
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
alter table fbpg_clients enable row level security;
alter table fbpg_proposals enable row level security;
