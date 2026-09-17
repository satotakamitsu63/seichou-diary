import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/drive-media/handler.mjs';
const config = { SUPABASE_URL: 'https://diary.example', SUPABASE_ANON_KEY: 'public-key', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh', GOOGLE_DRIVE_FOLDER_ID: 'folder', DIARY_ALLOWED_EMAILS: 'owner@example.com,wife@example.com', APP_ORIGIN: 'https://app.example' };
const result = value => Response.json(value);
function mock(options = {}) {
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return options.invalid ? new Response('', { status: 401 }) : result({ email: options.email ?? 'wife@example.com', email_confirmed_at: '2026-01-01' });
    if (url.includes('/diary_members?')) return result(options.member === false ? [] : [{ email: 'wife@example.com' }]);
    if (url.includes('/diary_entries?')) return result(options.linked === false ? [] : [{ id: 'entry' }]);
    if (url.includes('oauth2.googleapis.com')) return result({ access_token: 'google-access' });
    if (url.includes('uploadType=resumable')) return new Response(null, { headers: { location: 'https://www.googleapis.com/upload/session' } });
    if (url.endsWith('/upload/session')) return result({ id: 'file123' });
    if (url.includes('fields=parents')) return result({ parents: [options.folder ?? 'folder'], appProperties: { app: 'junhika-diary' }, mimeType: 'image/jpeg', size: 3 });
    if (url.endsWith('alt=media')) return new Response('img');
    throw new Error('Unexpected request');
  };
  return { calls, request };
}
function req(query = '', options = {}) {
  return new Request(`https://edge.example/drive-media${query}`, { ...options, headers: { origin: config.APP_ORIGIN, authorization: 'Bearer user-token', ...options.headers } });
}
test('missing configuration fails closed', async () => {
  const response = await createHandler({}, () => assert.fail())(req());
  assert.equal(response.status, 403);
});
test('unconfigured Google returns 503', async () => {
  assert.equal((await createHandler({ APP_ORIGIN: config.APP_ORIGIN }, () => assert.fail())(req())).status, 503);
});
for (const [name, options, status] of [['invalid login', { invalid: true }, 401], ['outsider', { email: 'outsider@example.com' }, 403], ['not a diary member', { member: false }, 403]]) {
  test(name, async () => {
    const backend = mock(options);
    const response = await createHandler(config, backend.request)(req('?action=status'));
    assert.equal(response.status, status);
    assert.ok(backend.calls.every(call => !call.url.includes('google')));
  });
}
test('untrusted origin denied before any network request', async () => {
  assert.equal((await createHandler(config, () => assert.fail())(req('', { headers: { origin: 'https://evil.example' } }))).status, 403);
});
test('wife uploads through owner token into designated folder', async () => {
  const backend = mock();
  const response = await createHandler(config, backend.request)(req('', { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-file-size': '3' }, body: 'img' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { path: 'drive:file123', kind: 'image' });
  const created = backend.calls.find(call => call.url.includes('uploadType=resumable'));
  assert.deepEqual(JSON.parse(created.init.body).parents, ['folder']);
  assert.equal(created.init.headers.authorization, 'Bearer google-access');
});
test('false size rejected without sending to Google', async () => {
  const backend = mock();
  assert.equal((await createHandler(config, backend.request)(req('', { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-file-size': '2' }, body: 'img' }))).status, 413);
  assert.ok(backend.calls.every(call => !call.url.includes('google')));
});
test('oversize file rejected', async () => {
  const backend = mock();
  assert.equal((await createHandler(config, backend.request)(req('', { method: 'POST', headers: { 'content-type': 'video/mp4', 'x-file-size': String(51 * 1024 * 1024) }, body: 'img' }))).status, 400);
});
test('non-diary file cannot be read', async () => {
  const backend = mock({ linked: false });
  assert.equal((await createHandler(config, backend.request)(req('?id=other'))).status, 404);
  assert.ok(backend.calls.every(call => !call.url.includes('google')));
});
test('file outside dedicated folder cannot be read', async () => {
  const backend = mock({ folder: 'private-documents' });
  assert.equal((await createHandler(config, backend.request)(req('?id=file123'))).status, 403);
});
test('authorized image streams without public URL or access token', async () => {
  const backend = mock();
  const response = await createHandler(config, backend.request)(req('?id=file123'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'img');
});
test('deletion endpoint is not exposed', async () => {
  const backend = mock();
  assert.equal((await createHandler(config, backend.request)(req('?id=file123', { method: 'DELETE' }))).status, 405);
});
