-- Darajati SQLite-to-Supabase schema migration
-- Preserves SQLite table and column names. SQLite integer flags remain smallint
-- for compatibility; timestamps remain text for a lossless first migration.

create table if not exists public.categories (
  id bigserial primary key,
  slug text not null unique,
  name_ar text not null,
  image_url text not null,
  is_parts_or_accessories smallint not null default 0 check (is_parts_or_accessories in (0, 1)),
  sort_order integer not null default 0,
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.listings (
  id bigserial primary key,
  title text not null,
  brand text not null default '',
  category_id bigint not null references public.categories(id) on delete restrict,
  governorate text not null,
  area text not null default '',
  model_year integer,
  engine_cc integer,
  motor_watts integer,
  condition text not null check (condition in ('new', 'used')),
  price_iqd bigint not null,
  negotiable smallint not null default 0 check (negotiable in (0, 1)),
  phone text not null,
  description text not null,
  keywords text not null default '',
  images_json jsonb not null default '[]'::jsonb,
  video_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'sold', 'rejected')),
  is_demo smallint not null default 0 check (is_demo in (0, 1)),
  is_hidden smallint not null default 0 check (is_hidden in (0, 1)),
  owner_token_hash text not null,
  owner_code_hash text not null,
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.search_synonyms (
  id bigserial primary key,
  term text not null,
  normalized_term text not null,
  target_type text not null check (target_type in ('brand', 'category', 'keyword', 'ambiguous')),
  canonical_value text not null default '',
  category_id bigint references public.categories(id) on delete set null,
  disambiguation_options_json jsonb not null default '[]'::jsonb,
  is_active smallint not null default 1 check (is_active in (0, 1)),
  notes text not null default '',
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.sliders (
  id bigserial primary key,
  title text not null,
  subtitle text not null default '',
  image_url text not null,
  link_category_id bigint references public.categories(id) on delete set null,
  link_url text not null default '',
  sort_order integer not null default 0,
  is_active smallint not null default 1 check (is_active in (0, 1)),
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.reports (
  id bigserial primary key,
  listing_id bigint not null references public.listings(id) on delete cascade,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.admin_users (
  id bigserial primary key,
  username text not null unique,
  password_hash text not null,
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.admin_sessions (
  token_hash text primary key,
  username text not null,
  role text not null default 'admin',
  csrf_token text not null default '',
  last_activity_at bigint not null default 0,
  expires_at bigint not null default 0,
  ip_address text not null default '',
  user_agent text not null default '',
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.admin_auth_rate_limits (
  client_key text primary key,
  fail_count integer not null default 0,
  lock_level integer not null default 0,
  first_fail_at bigint not null default 0,
  locked_until bigint not null default 0,
  updated_at bigint not null default 0
);

create table if not exists public.admin_audit_logs (
  id bigserial primary key,
  event_type text not null,
  actor text not null,
  ip_address text not null default '',
  target_type text not null default '',
  target_id text not null default '',
  details text not null default '',
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.media_assets (
  filename text primary key,
  kind text not null check (kind in ('images', 'videos')),
  upload_token_hash text not null default '',
  listing_id bigint references public.listings(id) on delete set null,
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.owner_media_grants (
  token_hash text not null,
  listing_id bigint not null references public.listings(id) on delete cascade,
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  primary key (token_hash, listing_id)
);

create table if not exists public.site_visits (
  id bigserial primary key,
  session_id text not null unique,
  visited_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.admin_notifications (
  id bigserial primary key,
  type text not null,
  title text not null,
  body text not null default '',
  target_section text not null default 'pending',
  target_id bigint,
  is_read smallint not null default 0 check (is_read in (0, 1)),
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.admin_settings (
  key text primary key,
  value text not null,
  updated_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create index if not exists idx_listings_status_created on public.listings(status, created_at desc);
create index if not exists idx_listings_public_browse
  on public.listings(status, is_hidden, is_demo, created_at desc);
create index if not exists idx_listings_category on public.listings(category_id);
create index if not exists idx_listings_governorate on public.listings(governorate);
create index if not exists idx_synonyms_norm on public.search_synonyms(normalized_term);
create index if not exists idx_synonyms_category on public.search_synonyms(category_id);
create index if not exists idx_audit_logs_created on public.admin_audit_logs(created_at desc);
create index if not exists idx_reports_listing_status on public.reports(listing_id, status);
create index if not exists idx_media_assets_listing on public.media_assets(listing_id);
create index if not exists idx_owner_grants_listing on public.owner_media_grants(listing_id);
create index if not exists idx_sliders_active_sort
  on public.sliders(is_active, sort_order);
create index if not exists idx_notifications_unread
  on public.admin_notifications(is_read, created_at desc);
create index if not exists idx_admin_sessions_expiry
  on public.admin_sessions(expires_at, last_activity_at);

-- Public, read-only projection. It deliberately excludes phone and owner hashes.
-- Pending, hidden, demo, rejected listings never leave this view.
create or replace view public.public_listings
with (security_invoker = false, security_barrier = true) as
select
  id,
  title,
  brand,
  category_id,
  governorate,
  area,
  model_year,
  engine_cc,
  motor_watts,
  condition,
  price_iqd,
  negotiable,
  description,
  keywords,
  images_json,
  video_url,
  status,
  is_hidden,
  is_demo,
  created_at,
  updated_at
from public.listings
where status in ('approved', 'sold')
  and is_hidden = 0
  and is_demo = 0;

alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.search_synonyms enable row level security;
alter table public.sliders enable row level security;
alter table public.reports enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_auth_rate_limits enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.media_assets enable row level security;
alter table public.owner_media_grants enable row level security;
alter table public.site_visits enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.admin_settings enable row level security;

-- Remove direct browser privileges; the service-role key is used only by Express.
revoke all on table public.categories from anon, authenticated, public;
revoke all on table public.listings from anon, authenticated, public;
revoke all on table public.search_synonyms from anon, authenticated, public;
revoke all on table public.sliders from anon, authenticated, public;
revoke all on table public.reports from anon, authenticated, public;
revoke all on table public.admin_users from anon, authenticated, public;
revoke all on table public.admin_sessions from anon, authenticated, public;
revoke all on table public.admin_auth_rate_limits from anon, authenticated, public;
revoke all on table public.admin_audit_logs from anon, authenticated, public;
revoke all on table public.media_assets from anon, authenticated, public;
revoke all on table public.owner_media_grants from anon, authenticated, public;
revoke all on table public.site_visits from anon, authenticated, public;
revoke all on table public.admin_notifications from anon, authenticated, public;
revoke all on table public.admin_settings from anon, authenticated, public;

revoke all on table public.public_listings from anon, authenticated, public;

-- Express uses the server-only service role for all private application data.
grant all on table public.categories to service_role;
grant all on table public.listings to service_role;
grant all on table public.search_synonyms to service_role;
grant all on table public.sliders to service_role;
grant all on table public.reports to service_role;
grant all on table public.admin_users to service_role;
grant all on table public.admin_sessions to service_role;
grant all on table public.admin_auth_rate_limits to service_role;
grant all on table public.admin_audit_logs to service_role;
grant all on table public.media_assets to service_role;
grant all on table public.owner_media_grants to service_role;
grant all on table public.site_visits to service_role;
grant all on table public.admin_notifications to service_role;
grant all on table public.admin_settings to service_role;
grant select on table public.public_listings to service_role;

do $$
declare
  table_name text;
  sequence_name text;
begin
  foreach table_name in array array[
    'categories',
    'listings',
    'search_synonyms',
    'sliders',
    'reports',
    'admin_users',
    'admin_audit_logs',
    'site_visits',
    'admin_notifications'
  ]
  loop
    sequence_name := pg_catalog.pg_get_serial_sequence(
      pg_catalog.format('public.%I', table_name),
      'id'
    );
    if sequence_name is not null then
      execute pg_catalog.format(
        'grant usage, select on sequence %s to service_role',
        sequence_name::regclass
      );
    end if;
  end loop;
end;
$$;

drop policy if exists public_read_categories on public.categories;
create policy public_read_categories on public.categories
  for select to anon, authenticated using (true);
grant select on table public.categories to anon, authenticated;

drop policy if exists public_read_active_sliders on public.sliders;
create policy public_read_active_sliders on public.sliders
  for select to anon, authenticated using (is_active = 1);
grant select on table public.sliders to anon, authenticated;

drop policy if exists public_read_active_synonyms on public.search_synonyms;
create policy public_read_active_synonyms on public.search_synonyms
  for select to anon, authenticated using (is_active = 1);
grant select on table public.search_synonyms to anon, authenticated;

-- Listings are readable only through the safe public view.
grant select on table public.public_listings to anon, authenticated;

-- No public policies are created for listings, reports, media, owner grants,
-- analytics, or administrative tables. This makes their insert/update/delete
-- operations inaccessible to anon and authenticated browser roles.

-- Keep sequences ahead of both imported IDs and values already consumed by a
-- sequence. The fixed table allowlist prevents caller-controlled SQL identifiers.
create or replace function public.sync_darajati_id_sequences()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  table_name text;
  sequence_name text;
  max_id bigint;
  last_value bigint;
  is_called boolean;
  next_value bigint;
begin
  foreach table_name in array array[
    'categories',
    'listings',
    'search_synonyms',
    'sliders',
    'reports',
    'admin_users',                
    'admin_audit_logs',
    'site_visits',
    'admin_notifications'
  ]
  loop
    sequence_name := pg_catalog.pg_get_serial_sequence(
      pg_catalog.format('public.%I', table_name),
      'id'
    );
    execute pg_catalog.format(
      'select coalesce(max(id), 0)::bigint from public.%I',
      table_name
    ) into max_id;
    execute pg_catalog.format(
      'select last_value, is_called from %s',
      sequence_name::regclass
    ) into last_value, is_called;

    next_value := greatest(
      max_id + 1,
      case when is_called then last_value + 1 else last_value end
    );
    perform pg_catalog.setval(sequence_name::regclass, next_value, false);
  end loop;
end;
$$;

revoke all on function public.sync_darajati_id_sequences() from public, anon, authenticated;
grant execute on function public.sync_darajati_id_sequences() to service_role;
