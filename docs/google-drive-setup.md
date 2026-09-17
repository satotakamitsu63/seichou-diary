# Google Drive integration — prepared, not activated

Owner: ragubiiiii@gmail.com. Keep MEDIA_PROVIDER='supabase' until end-to-end checks pass.

## Setup status and spending constraint (2026-09-17)

The owner approved drive.file access and server-side credential storage, with no additional spending. Do not enable billing, start a paid trial, upgrade plans, or increase billable quotas. Confirm the actual Supabase organization is on Free before activation. Drive storage uses the existing subscription, but media proxied through Edge Functions also consumes Supabase egress; storage capacity is not free transfer capacity.

Google project refined-gist-508902-m3 has Drive API enabled. OAuth branding is じゅんひかDiary; only drive.file was selected. Web client Junhika Diary private media was created with callback http://localhost:42813/oauth/callback. Its status is Testing. The credential download did not produce a retrievable file in the in-app browser; no client secret, owner refresh token, or Drive folder has been obtained. Do not create duplicate clients to work around this. Finish downloading the existing client's JSON into .private/ (ignored by git), then complete authorization and server deployment. Do not paste credentials into chat or public frontend files.

## Architecture

The drive-media Supabase Edge Function verifies the Supabase session, an explicit owner/spouse email allowlist, and diary_members on every request. Google access and refresh tokens never leave the server. A drive.file OAuth grant belonging to the owner creates files in an application-created private folder. This uses the owner's quota even for requests from the spouse. No public Drive sharing links or folder sharing are required for in-app viewing.

Existing media_path values still use private Supabase Storage. New values use drive:<file-id>, so no database migration is required. Google downloads additionally check the diary row, dedicated parent folder and application marker. Photos load on entering the viewport. Videos download on demand before playback; the initial implementation retains the existing 50MB limit. This is not streaming or resumable client-side upload yet.

## Required deployment setup

1. In the owner's Google Cloud project enable Google Drive API. Configure OAuth for personal use, scope https://www.googleapis.com/auth/drive.file. Create a web OAuth client with an exact server/local setup callback. Never place a client secret in GitHub Pages.
2. Have the owner explicitly authorize offline access. Store the resulting refresh token as a Supabase function secret. Testing-mode Drive grants expire after seven days; configure the personal OAuth application's production status before relying on unattended access. This does not make diary contents public.
3. Using that same OAuth client and owner grant, create a private folder named じゅんひかDiary and record its ID. Do not use a service account as file owner; it does not use this user's 5TB quota.
4. Configure the secrets listed in drive-secrets.example. Confirm the spouse's actual account email; do not infer it from account names. Only the two approved emails belong in DIARY_ALLOWED_EMAILS.
5. Deploy supabase/functions/drive-media with Supabase's JWT verification enabled. The handler also independently verifies the current user with the Auth API. SUPABASE_URL and SUPABASE_ANON_KEY are supplied by the function environment.
6. Test both intended accounts and an unauthorized account. Upload dummy image/video, save a diary row, retrieve from a second session and confirm bytes match. Check privacy, quota ownership and the existing Supabase attachments. No real family data should be moved before this succeeds.
7. Switch media-config.js to google-drive and deploy the frontend only after the live checks pass.

## Migration / rollback

Existing attachments are not moved or deleted by this implementation. After activation, prepare a separate migration that copies each original, verifies its bytes, then updates the row using a compare-and-set condition on the old path. Keep originals and a private mapping for rollback. That migration has not been run or implemented yet.

Rollback new uploads by setting MEDIA_PROVIDER back to supabase. Keep the function and Google grant active to read any existing drive: attachments. Do not revoke the grant until those records have a verified alternative copy.

Record deletion retains attachment files in both providers, so a failed diary deletion cannot destroy its media. Any media cleanup needs a separately reviewed and confirmed operation.

## Verification

node --test tests/drive-media.test.mjs

Tests use mock responses, not live Google credentials. OAuth, deployment, smartphone playback, quota ownership and migration remain unverified until setup is completed.
