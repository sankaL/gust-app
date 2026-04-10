# User Access Management

This document explains how to grant or revoke app access for users when Gust uses Google OAuth with Supabase Auth allowlist enforcement.

## When You Need This

Use this process when:
- you have already added a person to the Google OAuth app configuration (for example, OAuth test users), and
- they still cannot sign in to Gust.

Gust enforces access with a Supabase database allowlist (`public.allowed_users`) in addition to Google OAuth.

## Prerequisites

- You have admin access to the correct Supabase project (local or production).
- You know the exact Google account email address the user will use.

## Add a New User (Step by Step)

1. Open Supabase for the target environment.
2. Go to **SQL Editor**.
3. Run:

```sql
insert into public.allowed_users (email)
values ('newuser@example.com')
on conflict (email) do nothing;
```

4. Verify the email is present:

```sql
select email, created_at
from public.allowed_users
where email = 'newuser@example.com';
```

5. Ask the user to sign in again from Gust login (`/login`) using the same Google email.
6. On first successful login, Gust bootstraps that user account data automatically.

## Remove a User (Revoke Access)

1. Open Supabase SQL Editor for the same environment.
2. Run:

```sql
delete from public.allowed_users
where email = 'olduser@example.com';
```

3. Verify removal:

```sql
select email
from public.allowed_users
where email = 'olduser@example.com';
```

If no row is returned, allowlist access is revoked.

## Important Notes

- Emails are normalized to lowercase + trimmed by database trigger logic.
- Always add/remove users in the same Supabase project the app is using (local vs production).
- Adding someone only in Google OAuth does not grant Gust app access by itself.

## Troubleshooting

If login still fails after allowlisting:
- Confirm the user signed in with the exact email you added.
- Confirm the row exists in `public.allowed_users`.
- Confirm you edited the correct Supabase environment.
- Have the user fully sign out and retry login.

