# User Access Management

This document explains how to grant, reset, or revoke app access when Gust uses Supabase Auth email + password sign-in with a database allowlist.

Gust has no public sign-up and no in-app password reset. An administrator creates every account and resets passwords.

## How Access Works

A person can use Gust only when both of these are true:
- their email is in `public.allowed_users`, and
- they have a Supabase Auth user with a password.

The `before_user_created` hook rejects creating a Supabase user whose email is not on the allowlist, so always add the email to the allowlist first.

## Prerequisites

- You have admin access to the correct Supabase project (local or production).
- You know the exact email address the user will sign in with.

## Add a New User (Step by Step)

1. Open Supabase for the target environment.
2. Go to **SQL Editor** and run:

```sql
insert into public.allowed_users (email)
values ('newuser@example.com')
on conflict (email) do nothing;
```

3. Verify the email is present:

```sql
select email, created_at
from public.allowed_users
where email = 'newuser@example.com';
```

4. Go to **Authentication → Users → Add user → Create new user**. Enter the same email and a strong password, and check **Auto Confirm User**.
5. Share the password with the user through a private channel (not email in plain text where avoidable).
6. Ask the user to sign in at `/login` with that email and password. On first successful sign-in, Gust creates their account data (user row and Inbox) automatically.

## Reset a Password

1. Open **Authentication → Users** and find the user.
2. Set a new password for the **existing** user. Use the dashboard if it offers a password field, or the Admin API with the service-role key from an admin machine:

```bash
curl -X PUT "$SUPABASE_URL/auth/v1/admin/users/<user_id>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password": "<new password>"}'
```

3. Share the new password privately.

Never delete and recreate a user to reset their password. A recreated user gets a new ID, and their existing tasks, groups, and captures stay attached to the old one.

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

If no row is returned, allowlist access is revoked. Gust re-checks the allowlist on every request, so any open session stops working on the user's next request.

## Important Notes

- Emails are normalized to lowercase + trimmed by database trigger logic, and the sign-in form normalizes the same way.
- Always add/remove users in the same Supabase project the app is using (local vs production).
- A Supabase user without an allowlist row cannot use Gust, even with the correct password.

## Troubleshooting

If sign-in fails with "Email or password is incorrect.":
- Confirm the Supabase user exists with exactly that email and is confirmed.
- Reset the password (see above) and retry.

If sign-in shows the "not part of the user list" message:
- The password was correct, but the email is not in `public.allowed_users`. Add it and retry.
- Confirm you edited the correct Supabase environment.
