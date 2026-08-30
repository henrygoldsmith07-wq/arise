-- Accounts and cross-device sync for Arise.
--
-- Arise was local-first with no backend at all. This adds the smallest schema
-- that makes a Google account meaningful across devices: who you are, and one
-- snapshot of your training data.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  -- Google's stable subject claim. Preferred over email when matching, because
  -- it survives the user changing the address on their Google account.
  google_sub text unique,
  name text,
  image text,
  created_at timestamptz not null default now()
);

-- One row per user holding one snapshot of the monolithic store.
--
-- Conflict handling is last-writer-wins on `updated_at`, decided by the client.
-- The server does not merge: it cannot tell which of two training histories is
-- correct, and a wrong merge silently corrupts months of logged sessions.
create table if not exists user_state (
  user_id uuid primary key references users (id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  -- Schema version of the snapshot, so a newer client can migrate an old one.
  version integer not null default 1
);

create index if not exists user_state_updated_idx on user_state (updated_at desc);
