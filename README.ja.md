# Jev Browser

**Jevの並列な意味判断、Playwrightの決定的な実行、検証根拠の明示を1つの共通コアで扱います。CLI・MCP・TypeScript SDKを提供します。**

Playwright MCP／CLIのブラウザー操作と、Stagehand型の自然言語操作・構造化抽出・エージェント処理を、1つの実装で扱います。ネイティブ操作とassertionにAIキーは不要です。自然言語処理にはJevのAPIキーを使用します。

完全なAPI・コマンド互換ではありません。移行時には[対応表](docs/migration.md)に従って設定・呼び出しを置き換えてください。

## 導入

Node.js 22.15以上。[GitHub Releases](https://github.com/tontoko/jev-browser/releases)のtarballをプロジェクトへインストールします。

```sh
npm install --save-dev ./tontoko-jev-browser-0.9.0.tgz
npx playwright install chromium
npx jev-browser open https://example.com --session work
npx jev-browser snapshot --session work
npx jev-browser close --session work
```

`open`で作成した名前付きセッションは、別々のCLI呼び出しでもブラウザー状態を維持します。全コマンドは`--args JSON`で呼び出せます。MCPでは同じ操作を`browser_click`、`browser_type`、`browser_assert`などのツールとして公開します。

## 既存のPlaywright Locatorをそのまま使う

```ts
import { expect as baseExpect } from '@playwright/test';
import { semanticMatchers } from '@tontoko/jev-browser/playwright';

const expect = baseExpect.extend(semanticMatchers(browser));
await expect(page.getByTestId('plan')).toSemanticallyMatch(
  'Professional annual subscription', { minConfidence: 0.8 },
);
```

SDKの`assertSemantic`には`actual: { locator, property: 'text' }`を直接渡せます。`value`、`checked`、明示した`attribute`も対応します。完全一致ならモデル設定もAPIキーも不要です。`.not`で不確定な結果を成功へ反転させません。

`compareSemantic`は取得した証拠の比較、`assertSemantic`は返却前に証拠を読み直す現在状態の検証です。推論中に対象が変わった場合は、古い証拠でpassせず`inconclusive`にします。同じ証拠で都合のよい回答が出るまで再判定はしません。例外の`error.semantic`には期待値、全結果、sourceと比較の各閾値が残り、CLI・MCP・名前付きセッションでも保持されます。

SDKの`locateSemanticBatch`／`compareSemanticBatch`／`assertSemanticBatch`、CLIの`semantic_*_batch`、対応するMCPツールは同じコアです。独立した質問をまとめ、候補説明の重複を減らします。複数対象を一回で発見し、有効なrefを追加の推論なしでネイティブ操作へ使えます。詳細は[semantic verification](docs/semantic-verification.md)に記載しています。

## 一度の依頼で、入力から保存・結果確認まで

```ts
const result = await browser.run(
  '顧客の新規追加フォームを開き、渡した情報を入力して保存する。マーケティングメールは送らない。',
  { values: {
      customer: { name: '検証用の顧客', email: 'customer@example.invalid' },
      account: { plan: 'Professional annual', region: 'Japan' },
  } },
);
```

フォームの入口、項目の対応、入力順序、画面変化の待機、通常の保存確認をコアが担当します。同じ画面から答えられる質問はJevへまとめ、書き込みはPlaywrightで直列に実行します。長大なnative selectは全候補を毎回モデルへ送らず、必要なときだけ境界付きで解決します。`aria-controls`／`aria-owns`で所有関係が分かるcomboboxは、開く・絞る・所有popup内の選択・値確認まで同じ実行系で扱います。大きなページでは、全体を無理に詰め込まず意味のあるフォーム／結果領域を選んで追加観測します。CLIの`run`とMCPの`browser_run`にも、同じ`instruction`と入れ子の`values`を渡せます。

保存後の新しいレコードを特定し、入力値と表示値をローカルで照合できた場合は`complete / ui-readback`です。`verification.readback`と`unobserved`で確認範囲を区別します。これは画面上の確認で、全フィールドのDB永続化を保証するものではありません。厳密なテストには共通の`expect`、SDKの`until`、通常のPlaywright assertionを加えられます。

自分で立てる合成HTTPアプリに対して、一度の依頼と実際の保存内容の独立検証まで行う`examples/goal.mjs`を同梱しています。APIキーを環境に設定し、`npm run example:goal`で実行できます。

## 自然言語とSDK

hosted Jevを使う場合は`JEV_API_KEY`を設定します。Jev互換のSystem One endpointを使う場合は`JEV_BASE_URL=http://127.0.0.1:8765`のようにbase URLだけ指定でき、JevのAPIキーは不要です。endpointは`POST /v1/systemone`で同じ`state/questions -> model/answers/usage`形式を実装する必要があります。APIキーをリポジトリやCLI引数に書き込まないでください。

```ts
const browser = new JevBrowser({ page });
await browser.act('氏名欄にnameを入力', { values: { name: '検証用の顧客' } });
await browser.act('保存ボタンを押す');
await expect(page.getByText('保存済み', { exact: true })).toBeVisible();
```

借りた`Page`はSDKの`close()`で閉じません。既存のPlaywright Test、fixture、locator、アプリ固有のassertionと併用できます。

### 意味的な検索とconfidence付きassertion

文字列やDOM状態を決定的に比較できる場合は、通常のPlaywright/native assertionを優先します。表現が違っても同じ意味かを判定したい場合だけ、semantic verificationを明示的に使えます。

```ts
const target = await browser.locateSemantic('現在の契約を管理するボタン');
await browser.native({ command: 'click', ref: target.ref });

const result = await browser.compareSemantic({
  actual: { description: '現在の契約プラン' },
  expected: 'Professional annual subscription',
  minConfidence: 0.8,
});

await browser.assertSemantic({
  actual: { description: '請求状態' },
  expected: '支払い済み',
  minConfidence: 0.9,
});
```

semantic比較は、実際に選ばれたDOM上の`evidence`、`passed | failed | inconclusive`、比較の`confidence`、別個の`sourceConfidence`、2つの閾値を返します。`minConfidence`の既定値は`0.8`、`minSourceConfidence`は指定しなければその`minConfidence`と同じ値です。source選択と意味比較のscore分布が違う場合だけ、source側を個別に調整できます。**confidenceは正解確率ではなくJevのdecision scoreです。** 閾値未満や証拠不足はpassになりません。source自体が閾値未満なら、結論がpassになり得ないため2回目のsemantic比較を呼びません。groundedなactualとexpectedが決定的に一致する場合も、2回目のsemantic比較を呼ばずローカルで完了します。

複数の独立した比較は`compareSemanticBatch()`でまとめられ、source discoveryとsemantic comparisonをそれぞれdecision frontierとして処理します。結果には`serialDecisionDepth`、token/request数、`providerMs`、`observationMs`、`verificationMs`も含まれます。詳しくは[Semantic verification](docs/semantic-verification.md)を参照してください。

CLIの`semantic_locate` / `semantic_compare` / `semantic_assert`と、MCPの`browser_semantic_*`も同じコアを使います。

抽出はZodのスカラー・入れ子オブジェクト・配列に対応し、結果の`data`と元のDOMテキストを示す`evidence`を返します。配列は行・カード単位で根拠を分け、別の行の名前と金額を混ぜないようにします。生成された文章や、存在しない値の補完は行いません。

## 実行と判定の境界

Jevは観測済みの候補から操作を選び、Playwrightが実行します。存在しないセレクターやJavaScriptをモデルに生成させません。ただし、実在する候補の選び間違いまでなくなるわけではありません。

`run()`は入力の実値、新しい保存結果、呼び出し元の追加条件を区別して結果に残します。モデルが完了と判断しただけなら`unverified`です。保存要求の結果が不明な場合は再送せず、部分実行記録を返します。対応範囲・予算・追加権限が必要な場面は[goal runtime](docs/goal-runtime.md)に記載しています。

複数段階の保存も一回の`run()`で実行し、確認できた段階を`checkpoints`に残します。後段の入力値を最初にまとめて渡せます。入力先の選択と「明示された後段の値か」の判断を同じ並列frontierにまとめ、不要な直列往復を減らします。最終`expect`は途中のcheckpointとは別に検証し、`until`も同時に指定した場合は両方が成立する必要があります。

停止結果や`error.partial`に`continuation.id`があれば、同じcoreの`resume(id, {values: {...}})`、CLIの`resume ID --session work`、MCPの`browser_resume`で続行できます。保存結果が不明なら、再送せず読み取りによる確認を先に行います。既に確認済みの同じ保存はスクロールや再開では再実行可能になりません。再開は同じ実行中のcore・Page・origin・観測scopeに限定し、既存の入力値の変更も拒否します。[詳細と制約](docs/goal-continuation.md)。


ページ本文・リンク・表示された入力値などは機密情報を含む可能性があります。認証済みブラウザーの接続やファイルアクセスを無制限に第三者へ公開しないでください。[SECURITY.md](SECURITY.md)に権限とデータ送信範囲を記載しています。

詳しいAPI、MCP設定、CLI操作例、対応範囲と検証方法は[英語README](README.md)、[APIリファレンス](docs/api.md)、[移行ガイド](docs/migration.md)を参照してください。

## 入力値と選択肢の表記が異なる場合

native selectでは、`run(..., {values:{country:"Japan"}, semanticInputs:{"/country":0.8}})`と指定すると、その値だけをJevへ渡して実際の選択肢（例：`日本` / `JP`）との意味対応を判断します。JSON Pointerでの明示許可が必要で、他の入力値は通常のローカル入力のままです。対応できない値は「未提供」と混同せず、`unresolved-input`と観測した対象を返します。正規化・辞書による意味の代用はしません。[仕様](docs/observed-input-resolution.md)。
