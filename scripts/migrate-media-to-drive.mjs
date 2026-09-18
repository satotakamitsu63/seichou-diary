// Supabase Storage に残っている添付を Google ドライブへ移す。
// 中身が一致することを確かめてから記録を書き換える。元のファイルは復旧用に残す。
//
//   node scripts/migrate-media-to-drive.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SUPABASE_URL = 'https://qkjvdtnjakfqrzgwzexx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_C1CB_8T0U-oaZmfRDqr6Xw_Qb-h9cgm';
const BUCKET = 'diary-media';
const ORIGIN = 'https://satotakamitsu63.github.io';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; })
);

const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: env.DIARY_EMAIL, password: env.DIARY_PASSWORD })
}).then(response => response.json());

if (!auth.access_token) throw new Error('ログインできませんでした');

const headers = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${auth.access_token}`, origin: ORIGIN };
const fn = `${SUPABASE_URL}/functions/v1/drive-media`;

const rows = await fetch(
  `${SUPABASE_URL}/rest/v1/diary_entries?select=id,media_path,media_type&media_path=not.is.null&media_path=not.like.drive:*`,
  { headers }
).then(response => response.json());

if (rows.length === 0) {
  console.log('移す添付はありません。');
  process.exit(0);
}

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' };

for (const row of rows) {
  const { data } = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${row.media_path}`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 })
  }).then(async response => ({ data: await response.json() }));

  const original = new Uint8Array(await (await fetch(`${SUPABASE_URL}/storage/v1${data.signedURL ?? data.signedUrl}`)).arrayBuffer());
  const type = TYPES[row.media_path.split('.').pop().toLowerCase()];
  if (!type) { console.log(`${row.id}: 種類が分からないので飛ばします (${row.media_path})`); continue; }

  const uploaded = await fetch(fn, {
    method: 'POST',
    headers: { ...headers, 'content-type': type, 'x-file-size': String(original.length) },
    body: original
  });
  const media = await uploaded.json();
  if (!uploaded.ok) { console.log(`${row.id}: 送れませんでした (${JSON.stringify(media)})`); continue; }

  // 取り出しは記録に紐づいた添付しか許さないので、先に書き換えてから中身を確かめる。
  // 書き換えの間に添付が変わっていたら何もしない。
  const updated = await fetch(
    `${SUPABASE_URL}/rest/v1/diary_entries?id=eq.${row.id}&media_path=eq.${encodeURIComponent(row.media_path)}`,
    { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify({ media_path: media.path }) }
  ).then(response => response.json());

  if (!updated.length) { console.log(`${row.id}: 途中で添付が変わったため書き換えませんでした`); continue; }

  const copied = new Uint8Array(await (await fetch(`${fn}?id=${encodeURIComponent(media.path.slice(6))}`, { headers })).arrayBuffer());
  const same = copied.length === original.length && copied.every((value, index) => value === original[index]);

  if (!same) {
    await fetch(`${SUPABASE_URL}/rest/v1/diary_entries?id=eq.${row.id}`, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ media_path: row.media_path })
    });
    console.log(`${row.id}: 中身が一致しないので元に戻しました`);
    continue;
  }

  console.log(`${row.id}: ${row.media_path} → ${media.path}（${original.length}バイト一致）`);
}
