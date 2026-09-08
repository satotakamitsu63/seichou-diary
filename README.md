# じゅんひかDiary

純と光の成長記録。スマホのブラウザで開いて、思いついたまま書いて残す。
したこと・できたこと・覚えたことへの振り分けは、あとで Claude Code からまとめて行う。

- 公開URL: GitHub Pages（リポジトリ設定の Pages を `main` ブランチのルートにする）
- データの置き場所: Supabase `diary_entries` テーブル
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

出てきたメモをClaudeが読んで、次の形のJSONにして書き戻す:

```
node scripts/diary.mjs apply < out.json
```

```json
[
  {
    "id": "メモのid",
    "results": [
      { "child": "純", "shita": "公園で砂遊びをした", "ieta": "すべり台を一人で登れた", "oboeta": "" },
      { "child": "光", "shita": "", "ieta": "「ワンワン」と言えた", "oboeta": "" }
    ]
  }
]
```

`results` を2件にすると、1つのメモを2人分の記録に分けて保存する。

`.env`（Gitに入れない）にログイン情報を書いておく:

```
DIARY_EMAIL=...
DIARY_PASSWORD=...
```
