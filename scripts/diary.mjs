// じゅんひかDiary の未整理メモを取り出し、振り分け結果を書き戻すための道具。
//
//   node scripts/diary.mjs list            未整理のメモをJSONで出す
//   node scripts/diary.mjs apply < out.json 振り分け結果を書き戻す
//
// 書き戻すJSONの形:
//   [{"id":"<メモのid>","results":[{"child":"純","shita":"","ieta":"","oboeta":""}]}]
// results が2件あれば、2人分の記録に分けて保存する。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SUPABASE_URL = 'https://qkjvdtnjakfqrzgwzexx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_C1CB_8T0U-oaZmfRDqr6Xw_Qb-h9cgm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function credentials() {
  let raw;
  try {
    raw = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    fail('.env が見つかりません。DIARY_EMAIL と DIARY_PASSWORD を書いてください。');
  }

  const env = Object.fromEntries(
    raw.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      })
  );

  if (!env.DIARY_EMAIL || !env.DIARY_PASSWORD) {
    fail('.env に DIARY_EMAIL と DIARY_PASSWORD の両方が必要です。');
  }
  return env;
}

async function signIn() {
  const { DIARY_EMAIL, DIARY_PASSWORD } = credentials();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: DIARY_EMAIL, password: DIARY_PASSWORD })
  });

  if (!res.ok) fail(`ログインできませんでした (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function rest(token, path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers
    }
  });

  if (!res.ok) fail(`Supabaseへの要求が失敗しました (${res.status}): ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function list(token) {
  const rows = await rest(token,
    'diary_entries?sorted=eq.false&select=id,entry_date,note&order=entry_date.asc,created_at.asc');
  console.log(JSON.stringify(rows, null, 2));
}

async function apply(token) {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  if (!Array.isArray(payload)) fail('JSONの配列を渡してください。');

  let updated = 0;
  let added = 0;

  for (const item of payload) {
    const results = Array.isArray(item.results) ? item.results : [];
    if (!item.id || results.length === 0) continue;

    const [first, ...rest_] = results;
    await rest(token, `diary_entries?id=eq.${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...fields(first), sorted: true })
    });
    updated++;

    if (rest_.length === 0) continue;

    const [original] = await rest(token,
      `diary_entries?id=eq.${encodeURIComponent(item.id)}&select=entry_date,note`);

    for (const extra of rest_) {
      await rest(token, 'diary_entries', {
        method: 'POST',
        body: JSON.stringify({
          entry_date: original.entry_date,
          note: original.note,
          sorted: true,
          ...fields(extra)
        })
      });
      added++;
    }
  }

  console.log(`${updated}件を整理しました${added ? `（${added}件を別の子の記録として追加）` : ''}`);
}

function fields(result) {
  return {
    child: result.child ?? 'ふたり',
    shita: result.shita ?? '',
    ieta: result.ieta ?? '',
    oboeta: result.oboeta ?? ''
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const command = process.argv[2];
if (command !== 'list' && command !== 'apply') {
  fail('使い方: node scripts/diary.mjs list | node scripts/diary.mjs apply < out.json');
}

const token = await signIn();
await (command === 'list' ? list(token) : apply(token));
