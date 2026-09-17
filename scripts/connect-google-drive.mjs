import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// One-time local setup. Never serve these credentials or print token responses.
const client = JSON.parse(await readFile(new URL('../.private/google-client.json', import.meta.url), 'utf8')).web;
const callback = 'http://localhost:42813/oauth/callback';
const scope = 'https://www.googleapis.com/auth/drive.file';
const owner = 'ragubiiiii@gmail.com';
if (!client.redirect_uris.includes(callback)) throw new Error('OAuth callback does not match configuration');
const state = randomBytes(32).toString('hex');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
let busy = false;
let complete = false;

function matches(value, expected) {
  const actual = Buffer.from(value || '');
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function page(response, message, status = 200) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'" });
  response.end(`<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width"><title>じゅんひかDiary 接続設定</title><h1>じゅんひかDiary</h1>${message}</html>`);
}

const server = createServer(async (request, response) => {
  try {
    if (request.headers.host !== 'localhost:42813') return page(response, '接続先が違います。', 403);
    const url = new URL(request.url, callback);
    if (request.method !== 'GET') return page(response, '対応していない操作です。', 405);
    if (url.pathname === '/') return page(response, complete ? '<p>Googleとの接続情報を保存しました。この画面を閉じられます。</p>' : '<p>ragubiiiii@gmail.com のGoogle Driveに接続します。アプリが扱うファイルだけが対象です。</p><p><a href="/authorize">Googleに接続する</a></p>');
    if (url.pathname === '/authorize' && !complete && !busy) {
      const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorization.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', scope, state, access_type: 'offline', prompt: 'consent', login_hint: owner, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
      response.writeHead(302, { location: authorization.toString(), 'set-cookie': `junhika_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1200`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      return response.end();
    }
    if (url.pathname !== '/oauth/callback') return page(response, '見つかりません。', 404);
    const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('junhika_oauth='))?.slice('junhika_oauth='.length);
    if (!matches(url.searchParams.get('state'), state) || !matches(cookie, state) || busy || complete) return page(response, '認証の状態が一致しません。最初からやり直してください。', 403);
    if (url.searchParams.has('error') || !url.searchParams.get('code')) return page(response, 'Googleとの接続は許可されませんでした。', 400);
    busy = true;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, code: url.searchParams.get('code'), redirect_uri: callback, grant_type: 'authorization_code', code_verifier: verifier }), signal: AbortSignal.timeout(20000)
    });
    if (!tokenResponse.ok) throw new Error('token exchange failed');
    const tokens = await tokenResponse.json();
    if (!tokens.refresh_token || tokens.scope?.split(' ').some(value => value !== scope) || !tokens.scope?.split(' ').includes(scope)) throw new Error('unexpected permission');
    const identityResponse = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota', { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(20000) });
    if (!identityResponse.ok) throw new Error('account verification failed');
    const identity = await identityResponse.json();
    if (identity.user?.emailAddress?.toLowerCase() !== owner) throw new Error('wrong owner');
    await writeFile(new URL('../.private/google-grant.json', import.meta.url), JSON.stringify({ refresh_token: tokens.refresh_token, scope: tokens.scope, owner, storageQuota: identity.storageQuota, created_at: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    complete = true;
    response.writeHead(303, { location: '/', 'cache-control': 'no-store', 'set-cookie': 'junhika_oauth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    response.end();
    process.stdout.write('Google Drive owner verified; private grant saved.\n');
  } catch {
    busy = false;
    page(response, '<p>接続情報を保存できませんでした。既存の情報は上書きしていません。設定を確認してやり直します。</p>', 500);
  }
});
server.listen(42813, '127.0.0.1', () => process.stdout.write('Google setup available at http://localhost:42813\n'));
setTimeout(() => server.close(), 20 * 60 * 1000).unref();
