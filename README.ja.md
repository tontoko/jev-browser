# Jev Browser

**Playwrightを実行基盤に、Jevによる判断を加えたブラウザー自動化ツールです。共通コアからCLI・MCP・TypeScript SDKを提供します。**

Playwright MCP／CLIのブラウザー操作と、Stagehand型の自然言語操作・構造化抽出・エージェント処理を、1つの実装で扱います。ネイティブ操作とassertionにAIキーは不要です。自然言語処理にはJevのAPIキーを使用します。

完全なAPI・コマンド互換ではありません。移行時には[対応表](docs/migration.md)に従って設定・呼び出しを置き換えてください。

## 導入

Node.js 22.15以上。[GitHub Releases](https://github.com/tontoko/jev-browser/releases)のtarballをプロジェクトへインストールします。

```sh
npm install --save-dev ./tontoko-jev-browser-0.2.0.tgz
npx playwright install chromium
npx jev-browser open https://example.com --session work
npx jev-browser snapshot --session work
npx jev-browser close --session work
```

`open`で作成した名前付きセッションは、別々のCLI呼び出しでもブラウザー状態を維持します。全コマンドは`--args JSON`で呼び出せます。MCPでは同じ操作を`browser_click`、`browser_type`、`browser_assert`などのツールとして公開します。

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

`agent().execute()`／`run()`では、呼び出し元の読取専用`until`が`true`を返した場合だけ検証済み完了にします。モデルが完了と判断しただけなら`unverified`です。操作失敗時の自動再実行はありません。

ページ本文・リンク・表示された入力値などは機密情報を含む可能性があります。認証済みブラウザーの接続やファイルアクセスを無制限に第三者へ公開しないでください。[SECURITY.md](SECURITY.md)に権限とデータ送信範囲を記載しています。

詳しいAPI、MCP設定、CLI操作例、対応範囲と検証方法は[英語README](README.md)、[APIリファレンス](docs/api.md)、[移行ガイド](docs/migration.md)を参照してください。
