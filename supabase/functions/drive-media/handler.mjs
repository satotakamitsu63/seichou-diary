// Google credentials stay on the server. Every request verifies the diary user.
const MAX_BYTES = 50 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']);
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function createHandler(config, request = fetch) {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID', 'DIARY_ALLOWED_EMAILS', 'APP_ORIGIN'];
  const configured = required.every(key => config[key]);
  const json = (value, status = 200) => Response.json(value, { status });
  async function checked(url, options) {
    const response = await request(url, options);
    if (!response.ok) throw new RequestError(502, '保存先との通信に失敗しました。Google連携と空き容量を確認してください');
    return response;
  }
  async function authorize(req) {
    const authorization = req.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new RequestError(401, 'ログインしてください');
    const headers = { authorization, apikey: config.SUPABASE_ANON_KEY };
    const response = await request(`${config.SUPABASE_URL}/auth/v1/user`, { headers });
    if (!response.ok) throw new RequestError(401, 'ログインし直してください');
    const user = await response.json();
    const allowed = config.DIARY_ALLOWED_EMAILS.split(',').map(email => email.trim().toLowerCase());
    if (!user.email_confirmed_at || !allowed.includes(user.email?.toLowerCase())) throw new RequestError(403, 'この日記へのアクセス権がありません');
    const members = await checked(`${config.SUPABASE_URL}/rest/v1/diary_members?select=email&limit=1`, { headers });
    if (!(await members.json()).length) throw new RequestError(403, '日記のメンバー登録が必要です');
    return headers;
  }
  async function googleToken() {
    const response = await checked('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET, refresh_token: config.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' })
    });
    const token = (await response.json()).access_token;
    if (!token) throw new RequestError(502, 'Googleとの再連携が必要です');
    return { authorization: `Bearer ${token}` };
  }
  async function upload(req) {
    const type = req.headers.get('content-type')?.split(';')[0];
    const size = Number(req.headers.get('x-file-size'));
    if (!TYPES.has(type) || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) throw new RequestError(400, '対応する写真・動画を50MB以内で選んでください');
    // Bound actual bytes as well as the client-declared size.
    const reader = req.body?.getReader();
    if (!reader) throw new RequestError(400, '添付がありません');
    const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > size) { await reader.cancel(); throw new RequestError(413, '添付サイズが上限を超えています'); }
      chunks.push(value);
    }
    if (total !== size) throw new RequestError(400, '添付の受信が完了していません');
    const headers = await googleToken();
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov' }[type];
    const started = await checked('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name: `${crypto.randomUUID()}.${extension}`, parents: [config.GOOGLE_DRIVE_FOLDER_ID], appProperties: { app: 'junhika-diary' } })
    });
    const location = started.headers.get('location');
    if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw new RequestError(502, 'アップロード先を確認できませんでした');
    const response = await checked(location, { method: 'PUT', headers: { ...headers, 'content-type': type }, body: new Blob(chunks, { type }) });
    const file = await response.json();
    if (!/^[\w-]+$/.test(file.id ?? '')) throw new RequestError(502, '保存結果を確認できませんでした');
    return json({ path: `drive:${file.id}`, kind: type.startsWith('video/') ? 'video' : 'image' });
  }
  async function download(url, diaryHeaders) {
    const id = url.searchParams.get('id');
    if (!id || !/^[\w-]+$/.test(id)) throw new RequestError(400, '添付が指定されていません');
    const rows = await checked(`${config.SUPABASE_URL}/rest/v1/diary_entries?select=id&media_path=eq.${encodeURIComponent(`drive:${id}`)}&limit=1`, { headers: diaryHeaders });
    if (!(await rows.json()).length) throw new RequestError(404, '記録に添付されていません');
    const headers = await googleToken();
    const metadata = await (await checked(`https://www.googleapis.com/drive/v3/files/${id}?fields=parents,trashed,mimeType,appProperties,size`, { headers })).json();
    if (metadata.trashed || !metadata.parents?.includes(config.GOOGLE_DRIVE_FOLDER_ID) || metadata.appProperties?.app !== 'junhika-diary' || !TYPES.has(metadata.mimeType)) throw new RequestError(403, '日記の添付ではありません');
    if (Number(metadata.size) > MAX_BYTES) throw new RequestError(413, '添付サイズが上限を超えています');
    const file = await checked(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers });
    return new Response(file.body, { headers: { 'content-type': metadata.mimeType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }
  return async req => {
    const origin = req.headers.get('origin');
    let response;
    try {
      if (origin && origin !== config.APP_ORIGIN) throw new RequestError(403, '許可されていないページです');
      if (req.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else {
        if (!configured) throw new RequestError(503, 'Googleドライブの初期設定が必要です');
        const diaryHeaders = await authorize(req);
        const url = new URL(req.url);
        if (req.method === 'GET' && url.searchParams.get('action') === 'status') response = json({ ready: true });
        else if (req.method === 'GET') response = await download(url, diaryHeaders);
        else if (req.method === 'POST') response = await upload(req);
        else throw new RequestError(405, '対応していない操作です');
      }
    } catch (error) {
      response = json({ error: error instanceof RequestError ? error.message : '通信に失敗しました。再度お試しください' }, error instanceof RequestError ? error.status : 500);
    }
    response.headers.set('cache-control', 'no-store');
    if (origin === config.APP_ORIGIN) response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-file-size');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return response;
  };
}
