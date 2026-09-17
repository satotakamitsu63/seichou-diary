# じゅんひかDiary

純と光の成長記録。スマホのブラウザで開いて、思いついたまま書いて残す。
**書いた文章は書き換えない。** 一覧にはそのまま全文が出る。
あとで Claude Code から、どの子の記録かのラベルだけをまとめて付ける。

- 公開URL: GitHub Pages（リポジトリ設定の Pages を `main` ブランチのルートにする）
- データの置き場所: Supabase `diary_entries` テーブル
- 写真・動画: Supabase Storage の非公開バケット `diary-media`（1件につき1つ、50MBまで）。
  表示には期限付きURLを使う。有効期限内はURLを知っている人が閲覧できる
- 読み書きできる人: `diary_members` テーブルに載っているメールアドレスの人だけ

## 準備（一度だけ）

1. Supabase の SQL Editor で `supabase/schema.sql` を実行する。
2. 妻のメールアドレスを `diary_members` に追加する（SQLの末尾にコメントで例を置いてある）。
3. 妻がまだSupabaseのアカウントを持っていなければ、Authentication → Users から作る。

## 振り分け（Claude Code から）

未整理のメモを取り出す:

```
node scripts/diary.mjs list
```

出てきたメモをClaudeが読んで、どの子の記録かを決め、次の形のJSONで書き戻す:

```
node scripts/diary.mjs apply < out.json
```

```json
[
  { "id": "メモのid", "children": ["純"] },
  { "id": "別のメモのid", "children": ["ふたり"] }
]
```

`child` に入るのは `純` `光` `ふたり` のいずれか。どちらの子の話か決められないとき、
または2人が一緒に出てくるときは `ふたり` にする。本文には手を入れない。

`.env`（Gitに入れない）にログイン情報を書いておく:

```
DIARY_EMAIL=...
DIARY_PASSWORD=...
```

## Googleドライブへの切り替え準備

連携コードは追加済みですが、まだ有効化していません。公開版は従来のSupabaseです。
設定と未完了の検証は [Googleドライブ設定手順](docs/google-drive-setup.md) を参照してください。
