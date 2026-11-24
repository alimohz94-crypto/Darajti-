-- Private media buckets for Express-mediated Storage access.
-- Before applying, review existing storage.objects policies for broad rules that
-- might grant anon/authenticated access to these bucket IDs.

-- Fail closed if any browser-role policy exists. This conservative guard also
-- blocks policies for unrelated buckets; review those manually before proceeding.
do $$
declare
  browser_policies text;
  storage_rls_enabled boolean;
begin
  select relrowsecurity
  into storage_rls_enabled
  from pg_catalog.pg_class
  where oid = 'storage.objects'::regclass;

  if storage_rls_enabled is distinct from true then
    raise exception 'storage.objects must have row-level security enabled.';
  end if;

  select string_agg(policy.polname::text, ', ' order by policy.polname)
  into browser_policies
  from pg_catalog.pg_policy policy
  where policy.polrelid = 'storage.objects'::regclass
    and (
      0::oid = any(policy.polroles)
      or exists (
        select 1
        from unnest(policy.polroles) as role_ids(role_oid)
        join pg_catalog.pg_roles role_record on role_record.oid = role_ids.role_oid
        where role_record.rolname in ('anon', 'authenticated')
      )
    );

  if browser_policies is not null then
    raise exception
      'Review storage.objects browser-role policies before provisioning Darajati buckets: %',
      browser_policies;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'darajati-images',
    'darajati-images',
    false,
    8388608,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'darajati-videos',
    'darajati-videos',
    false,
    36700160,
    array['video/mp4', 'video/webm', 'video/quicktime']
  )
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Intentionally define no anon/authenticated object policies; Express uses the
-- server-only service role after checking the listing/media authorization.
