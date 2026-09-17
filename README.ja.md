# Jev Browser

**Playwrightを実行基盤に、Jevによる判断を加えたブラウザー自動化ツールです。共通コアからCLI・MCP・TypeScript SDKを提供します。**

Playwright MCP／CLIのブラウザー操作と、Stagehand型の自然言語操作・構造化抽出・エージェント処理を、1つの実装で扱います。ネイティブ操作とassertionにAIキーは不要です。自然言語処理にはJevのAPIキーを使用します。

完全なAPI・コマンド互換ではありません。移行時には[対応表](docs/migration.md)に従って設定・呼び出しを置き換えてください。

## 導入

Node.js 22.15以上。[GitHub Releases](https://github.com/tontoko/jev-browser/releases)のtarballをプロジェクトへインストールします。

```sh
npm install --save-dev ./tontoko-jev-browser-0.3.0.tgz
npx playwright install chromium
npx jev-browser open https://example.com --session work
npx jev-browser snapshot --session work
npx jev-browser close --session work
```

`open`で作成した名前付きセッションは、別々のCLI呼び出しでもブラウザー状態を維持します。全コマンドは`--args JSON`で呼び出せます。MCPでは同じ操作を`browser_click`、`browser_type`、`browser_assert`などのツールとして公開します。

## 一度の依頼で、入力から保存・結果確認まで

```ts
const result = await browser.run(
  '生徒の新規追加フォームを開き、渡した情報を入力して保存する。招待メールは送らない。',
  { values: {
      student: { name: '検証用の生徒', email: 'student@example.invalid' },
      guardian: { name: '検証用の保護者', email: 'guardian@example.invalid' },
      course: 'ヴィオラ・ダ・ガンバ',
  } },
);
```

フォームの入口、項目の対応、入力順序、画面変化の待機、通常の保存確認をコアが担当します。同じ画面から答えられる質問はJevへまとめ、書き込みはPlaywrightで直列に実行します。CLIの`run`とMCPの`browser_run`にも、同じ`instruction`と入れ子の`values`を渡せます。

保存後の新しいレコードを特定し、入力値と表示値をローカルで照合できた場合は`complete / ui-readback`です。`verification.readback`と`unobserved`で確認範囲を区別します。これは画面上の確認で、全フィールドのDB永続化を保証するものではありません。厳密なテストには共通の`expect`、SDKの`until`、通常のPlaywright assertionを加えられます。

自分で立てる合成HTTPアプリに対して、一度の依頼と実際の保存内容の独立検証まで行う`examples/goal.mjs`を同梱しています。APIキーを環境に設定し、`npm run example:goal`で実行できます。

## 自然言語とSDK

`JEV_API_KEY`を環境変数に設定すると`act`・`observe`・`extract`・`run`を利用できます。APIキーをリポジトリやCLI引数に書き込まないでください。

```ts
const browser = new JevBrowser({ page });
await browser.act('氏名欄にnameを入力', { values: { name: '検証用の受講者' } });
await browser.act('保存ボタンを押す');
await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
```

借りた`Page`はSDKの`close()`で閉じません。既存のPlaywright Test、fixture、locator、アプリ固有のassertionと併用できます。

抽出はZodのスカラー・入れ子オブジェクト・配列に対応し、結果の`data`と元のDOMテキストを示す`evidence`を返します。配列は行・カード単位で根拠を分け、別の行の名前と金額を混ぜないようにします。生成された文章や、存在しない値の補完は行いません。

## 実行と判定の境界

Jevは観測済みの候補から操作を選び、Playwrightが実行します。存在しないセレクターやJavaScriptをモデルに生成させません。ただし、実在する候補の選び間違いまでなくなるわけではありません。

`run()`は入力の実値、新しい保存結果、呼び出し元の追加条件を区別して結果に残します。モデルが完了と判断しただけなら`unverified`です。保存要求の結果が不明な場合は再送せず、部分実行記録を返します。対応範囲・予算・追加権限が必要な場面は[goal runtime](docs/goal-runtime.md)に記載しています。

ページ本文・リンク・表示された入力値などは機密情報を含む可能性があります。認証済みブラウザーの接続やファイルアクセスを無制限に第三者へ公開しないでください。[SECURITY.md](SECURITY.md)に権限とデータ送信範囲を記載しています。

詳しいAPI、MCP設定、CLI操作例、対応範囲と検証方法は[英語README](README.md)、[APIリファレンス](docs/api.md)、[移行ガイド](docs/migration.md)を参照してください。
