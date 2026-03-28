create table if not exists public.allowed_users (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.normalize_allowed_users_email()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists trg_allowed_users_normalize_email on public.allowed_users;
create trigger trg_allowed_users_normalize_email
before insert or update on public.allowed_users
for each row
execute function public.normalize_allowed_users_email();

insert into public.allowed_users (email)
values
  ('admingust@gmail.com'),
  ('pavanmanthika@gmail.com'),
  ('sanka.lokuliyana@gmail.com'),
  ('tabesink@gmail.com')
on conflict (email) do nothing;

create or replace function public.before_user_created_allowlist(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  signup_email text;
begin
  signup_email := lower(trim(coalesce(event->'user'->>'email', '')));

  if signup_email = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This email is not allowed to access Gust.'
      )
    );
  end if;

  if exists (
    select 1
    from public.allowed_users
    where lower(trim(email)) = signup_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email is not allowed to access Gust.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant select on table public.allowed_users to supabase_auth_admin;
grant execute on function public.before_user_created_allowlist(jsonb) to supabase_auth_admin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gust_app_runtime') then
    grant select on table public.allowed_users to gust_app_runtime;
  end if;
end;
$$;

revoke execute on function public.before_user_created_allowlist(jsonb) from anon, authenticated, public;
