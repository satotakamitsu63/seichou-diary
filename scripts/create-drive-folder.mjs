// 一度だけ実行する設定作業。写真・動画を置く専用フォルダをGoogleドライブに作り、
// そのIDを .private/google-grant.json に書き足す。
// すでに作ってあれば作り直さず、そのIDを使う。

import { readFile, writeFile } from 'node:fs/promises';

const FOLDER_NAME = 'じゅんひかDiary';
const APP_MARKER = 'junhika-diary';

const clientPath = new URL('../.private/google-client.json', import.meta.url);
const grantPath = new URL('../.private/google-grant.json', import.meta.url);

const { web: client } = JSON.parse(await readFile(clientPath, 'utf8'));
const grant = JSON.parse(await readFile(grantPath, 'utf8'));

async function accessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: grant.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) throw new Error(`Googleとの再接続に失敗しました (${response.status})`);
  const { access_token } = await response.json();
  if (!access_token) throw new Error('アクセストークンを受け取れませんでした');
  return access_token;
}

async function findFolder(headers) {
  const query = `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='app' and value='${APP_MARKER}' }`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`フォルダを探せませんでした (${response.status})`);
  return (await response.json()).files[0];
}

async function createFolder(headers) {
  const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { app: APP_MARKER }
    })
  });

  if (!response.ok) throw new Error(`フォルダを作れませんでした (${response.status})`);
  return response.json();
}

const headers = { authorization: `Bearer ${await accessToken()}` };
const existing = await findFolder(headers);
const folder = existing ?? await createFolder(headers);

await writeFile(grantPath, JSON.stringify({ ...grant, folder_id: folder.id }, null, 2));
console.log(`${existing ? '既にあるフォルダを使います' : 'フォルダを作りました'}: ${folder.name} (${folder.id})`);
