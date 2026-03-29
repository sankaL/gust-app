revoke all privileges on table public.allowed_users from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gust_app_runtime') then
    revoke all privileges on table public.allowed_users from gust_app_runtime;
  end if;
end;
$$;

grant select on table public.allowed_users to supabase_auth_admin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gust_app_runtime') then
    grant select on table public.allowed_users to gust_app_runtime;
  end if;
end;
$$;
