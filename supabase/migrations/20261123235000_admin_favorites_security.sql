-- Server-only persistence for authentication throttling and anonymous favorites.
-- This file is applied only through a separately approved production migration.

create table if not exists public.favorite_devices (
  device_id_hash text primary key check (device_id_hash ~ '^[a-f0-9]{64}$'),
  imported_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

create table if not exists public.device_favorites (
  device_id_hash text not null references public.favorite_devices(device_id_hash) on delete cascade,
  listing_id bigint not null references public.listings(id) on delete cascade,
  created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  primary key (device_id_hash, listing_id)
);

create index if not exists idx_device_favorites_listing on public.device_favorites(listing_id);

alter table public.favorite_devices enable row level security;
alter table public.device_favorites enable row level security;
revoke all on table public.favorite_devices from anon, authenticated, public;
revoke all on table public.device_favorites from anon, authenticated, public;
grant all on table public.favorite_devices to service_role;
grant all on table public.device_favorites to service_role;

create or replace function public.sync_device_favorites(
  p_device_id_hash text,
  p_listing_ids bigint[]
)
returns table (listing_id bigint)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_device_id text;
begin
  if p_device_id_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid device identifier hash';
  end if;

  insert into public.favorite_devices (device_id_hash)
  values (p_device_id_hash)
  on conflict (device_id_hash) do nothing
  returning device_id_hash into created_device_id;

  if created_device_id is not null then
    insert into public.device_favorites (device_id_hash, listing_id)
    select p_device_id_hash, candidate.listing_id
    from (
      select distinct unnest(coalesce(p_listing_ids, array[]::bigint[])) as listing_id
    ) candidate
    join public.listings listing on listing.id = candidate.listing_id
    where listing.status in ('approved', 'sold')
      and listing.is_hidden = 0
      and listing.is_demo = 0
    on conflict (device_id_hash, listing_id) do nothing;
  end if;

  return query
  select favorite.listing_id
  from public.device_favorites favorite
  join public.listings listing on listing.id = favorite.listing_id
  where favorite.device_id_hash = p_device_id_hash
    and listing.status in ('approved', 'sold')
    and listing.is_hidden = 0
    and listing.is_demo = 0
  order by favorite.listing_id;
end;
$$;

create or replace function public.record_admin_auth_failure(
  p_client_key text,
  p_now bigint,
  p_window_ms bigint,
  p_max_attempts integer,
  p_max_lock_level integer,
  p_base_lock_minutes integer,
  p_max_lock_minutes integer
)
returns table (
  client_key text,
  fail_count integer,
  lock_level integer,
  first_fail_at bigint,
  locked_until bigint,
  updated_at bigint,
  attempt integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_limit public.admin_auth_rate_limits%rowtype;
  next_attempt integer;
  next_fail_count integer;
  next_lock_level integer;
  next_first_fail_at bigint;
  next_locked_until bigint := 0;
  fresh_window boolean;
begin
  if p_client_key is null or length(p_client_key) < 1 or length(p_client_key) > 80 then
    raise exception 'Invalid authentication rate-limit key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_key, 0));
  select * into current_limit
  from public.admin_auth_rate_limits
  where admin_auth_rate_limits.client_key = p_client_key
  for update;

  fresh_window := not found
    or p_now - current_limit.first_fail_at > p_window_ms;
  next_attempt := case
    when fresh_window then 1
    else current_limit.fail_count + 1
  end;
  next_lock_level := case
    when fresh_window then 0
    else current_limit.lock_level
  end;
  next_first_fail_at := case
    when fresh_window then p_now
    else current_limit.first_fail_at
  end;

  if next_attempt >= p_max_attempts then
    next_lock_level := least(greatest(p_max_lock_level, 1), next_lock_level + 1);
    next_locked_until := p_now + least(
      greatest(p_max_lock_minutes, 1),
      greatest(p_base_lock_minutes, 1) * power(2, next_lock_level - 1)::integer
    )::bigint * 60000;
    next_fail_count := 0;
  else
    next_fail_count := next_attempt;
  end if;

  insert into public.admin_auth_rate_limits (
    client_key, fail_count, lock_level, first_fail_at, locked_until, updated_at
  ) values (
    p_client_key, next_fail_count, next_lock_level, next_first_fail_at, next_locked_until, p_now
  )
  on conflict (client_key) do update set
    fail_count = excluded.fail_count,
    lock_level = excluded.lock_level,
    first_fail_at = excluded.first_fail_at,
    locked_until = excluded.locked_until,
    updated_at = excluded.updated_at;

  return query
  select p_client_key, next_fail_count, next_lock_level, next_first_fail_at,
    next_locked_until, p_now, next_attempt;
end;
$$;

revoke all on function public.sync_device_favorites(text, bigint[]) from public, anon, authenticated;
grant execute on function public.sync_device_favorites(text, bigint[]) to service_role;

revoke all on function public.record_admin_auth_failure(text, bigint, bigint, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_admin_auth_failure(text, bigint, bigint, integer, integer, integer, integer)
  to service_role;
