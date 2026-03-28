insert into public.allowed_users (email)
values
  ('admingust@gmail.com'),
  ('pavanmanthika@gmail.com'),
  ('sanka.lokuliyana@gmail.com'),
  ('tabesink@gmail.com'),
  ('local-dev@gust.local')
on conflict (email) do nothing;
