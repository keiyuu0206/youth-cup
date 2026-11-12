# INFINEX（youth-cup）引き継ぎメモ

最終更新：2026年11月　／　このメモを新しい会話に添付して「このプロジェクトの続きをお願いします」と伝えてください。

---

## 0. 新しい会話の最初に伝えること（そのまま貼り付け可）

```
少年サッカー大会運営アプリ「INFINEX」（Cloudflare Workers + D1、ビルド不要の素のJavaScript）の続きです。
添付の HANDOFF.md が全体像です。youth-cup-all.zip がソース一式、INFINEX_dev_tools.zip が検査とマニュアル作成の道具です。
前提：
・本番のデータは絶対に崩さない（データベースの構造は変えず、追加だけ。既存データは書き換えない）
・保護者向けURL（/t/…）と配布済みQRは変更しない
・変更後は関係する検査を実行し、Cloudflareと同じ組み立て（wrangler deploy --dry-run）を確認してから渡す
・小さな修正のときは、検査は関係する範囲だけでよい（使用量を節約したい）
・説明は日本語で、専門用語を避けて
```

---

## 1. 概要

- **名前**：INFINEX（Powered by INFINITY FOOTBALL CLUB）
- **用途**：少年サッカー大会の運営（組分け・日程・結果・順位・トーナメント・要項・PDF・SNS画像・保護者向け閲覧ページ）
- **構成**：Cloudflare Workers（`worker.js`）＋ D1（SQLite）。フロントはビルド不要の素のJavaScript（`web-*.js`）。全ファイル1階層。
- **デプロイ**：GitHub（リポジトリ youth-cup）にアップロード → Cloudflareが自動デプロイ（`npx wrangler deploy`）
- **マニュアル配信**：`manuals/` フォルダを Cloudflare の assets で配信（`wrangler.jsonc` に `"assets": { "directory": "./manuals" }`）。字体 `inter.woff2` も同じフォルダ。
- **ランディングページ**：https://claude.ai/artifact/XWcfcmmaNAo5Xvngv7mHKX （マニュアルPDFへのリンクあり）
- **デザイン案（キャンバス）**：https://claude.ai/artifact/J2ux9igiiKgPwgMq2NDhGN

---

## 2. ファイル構成（主要）

| ファイル | 役割 |
|---|---|
| `worker.js` | サーバー（API・認証・静的ファイル・DBの自動追加）。約70のAPI |
| `auth.js` | パスワード（PBKDF2・10万回）・署名付きCookie・ログイン試行の制限 |
| `schedule.js` / `bracket.js` / `grouping.js` / `standings.js` / `time.js` | 日程作成・トーナメント・組分け・順位計算・時刻 |
| `schema.sql` | DBの定義（初回のみ実行） |
| `web-app.js` | 画面の振り分け（/admin・/t/:slug・/r/:slug＝終了案内） |
| `web-admin.js` | 管理画面（大会一覧・大会の画面・ダッシュボード・アカウント・大会運営者のPC画面） |
| `web-score.js` | 大会運営者・スコア管理者のスマホ専用画面 |
| `web-viewer.js` | 保護者向け閲覧ページ |
| `web-views.js` | 共通部品（試合カード・順位表・審判の割り振りの計算など） |
| `web-print.js` | PDF出力（資料・掲示用・駐車券・Excelの入口） |
| `web-pamphlet.js` | パンフレット（A4横） |
| `web-poster.js` | 結果一覧・試合結果のSNS画像（Canvas）、保護者の順位表画像 |
| `web-outline.js` | 大会要項（編集・Web表示・PDF、赤字 `**…**`） |
| `web-ui.js` / `web-api.js` / `web-qr.js` / `web-xlsx.js` / `icons.js` | UI部品・API呼び出し・QR・Excel・アイコン |
| `web-relative.js` | 旧チーム関係者ページ（現在は使われない。/r/ は終了案内） |
| `app.css` | 全体の見た目。**最後に「Pitchside Paper」デザインの層**を重ねている |
| `lib.test.js` / `fuzz.test.js` / `e2e.mjs` | ロジック45件・総当たり590通り・通しテスト45項目 |
| `manuals/` | マニュアルPDF・`inter.woff2`（数字・英字用の字体、OFL） |
| `wrangler.jsonc` | **database_id と assets の設定は本番の値。上書き注意** |

---

## 3. 権限

| 権限 | できること |
|---|---|
| 全体管理者（admin） | すべて。アカウント管理（地域管理者・閲覧専用の発行） |
| 地域管理者 | 大会の登録・編集・管理、アカウント追加（大会運営者・スコア管理者の発行）。共有された大会の閲覧・コピー |
| 閲覧専用 | すべての大会の確認だけ |
| 大会運営者（role: operator） | 結果の登録・修正、ダッシュボード、時間の調整、試合・左右の入れ替え、節の番号、棄権、PDF・SNS画像、忘れ物。**PC・タブレット（幅900px以上）は管理画面の運営者版、スマホは専用画面**（［スマホ表示］［パソコン表示］で切替） |
| スコア管理者（role: scorer） | 結果の登録だけ（確定済みの修正は不可） |

- 大会運営者の許可APIは `worker.js` の `OPERATOR_ADMIN` に列挙（サーバー側でも制限）。
- 上部のボタン名は「アカウント追加」（旧「スコア管理者」）。
- **チーム関係者向けの結果登録ページ（/r/・PIN）は終了**。`/api/rel/*` は 410 を返す。PINのデータは残している。

---

## 4. 主な機能（実装済み）

**準備**：大会作成（最大4日）・カテゴリ・形式（リーグ／トーナメント／リーグ＋決勝、上位・中位・下位、順位別）・チーム（ロゴ・略称）・組分け・日程作成・形式テンプレート・要項（赤字・画像）・スポンサー・駐車券・忘れ物・大会のコピー・地域管理者への共有。

**日程の手直し**：試合のタップで入れ替え（時刻・コート）、［⇄ 左右を入れ替える］（得点も一緒に入れ替え）、入れ替え時に「第◯節」を時刻順に振り直し、［節の番号を時刻の順にそろえる］、［↶ 1つ前に戻す］（`time_history` に直近20件）。

**当日**：ダッシュボード（進み具合・得点・コートの状況・各組の順位・最近の結果）、結果の登録・承認、時間の調整（まとめてずらす／試合時間を変えて組み直す／翌日に移す）、開催中は**まだ行っていない試合どうしだけ**時刻・コートを入れ替え（他の試合の時刻は不変）、**棄権・キャンセル**（残り試合を相手の不戦勝で確定、後のトーナメントにも自動反映、取り消し可）。

**審判の割り振り**（大会の設定 `settings.referee.mode`）：`none`／`left`（一覧の左側が担当＋［左側の審判が均等になるように左右をそろえる］）／`one`（自動で均等）／`halves`（前審・後審）。表示時に計算（DBに書かない）。マークは閲覧ページ・管理画面・PDF・パンフレットに出る。

**出力**：資料PDF（A4縦）・掲示用・パンフレット（A4横・色テーマ）・Excel・要項PDF・駐車券（**選んだチームのロゴ表示**）・結果一覧（画像・PDF）・試合結果のSNS画像（組ごと・回戦ごと、写真はカテゴリごとに登録）。カテゴリの帯に［SNS画像］ボタン。

**保護者の閲覧ページ**：自チーム（黒地カード）、試合・順位表・トーナメント、大会要項、忘れ物、SNS画像（順位表・最終順位は全チーム1枚の画像で保存）、駐車券、手動の［↻ 更新］。

**その他**：バックアップ（大会単位・全データ）と復元（新しい大会として追加）、ログイン試行制限（同じIP・同じIDで10分間に10回）、今後作る大会のURLは20文字（発行済みは10文字のまま）。

---

## 5. データベース（既存データを崩さないための注意）

- 表：`tournaments categories teams matches match_officials templates rate_limits sponsors sponsor_clicks assets lost_items presets users time_history`
- アプリ起動時に**不足分だけ自動追加**（`ALTER TABLE … ADD COLUMN`、`time_history` の作成）。既存データは変更しない。
- `tournaments.settings`（JSON）に追加した主な項目：`outline`（要項）・`parking`・`snsPhotos`（カテゴリID→画像ID）・`referee.mode`・`withdrawn`（カテゴリID→棄権チームIDの配列）。PATCHは**項目ごとに上書き（マージ）**。
- 下位トーナメントの試合名は、**表示時に** `place_w`（決まる順位）から「7位決定戦」などに補正（DBの名前は古いままでも可）。
- 「1つ前に戻す」の履歴（`time_history.data`）は、`matches`（時刻・コート・節・名前）、`flips`（左右）、`results`＋`withdraw`（棄権）を保存できる。

---

## 6. デプロイ手順（変更を反映するとき）

1. 変更したファイルを GitHub の youth-cup リポジトリのトップに「Add file → Upload files」→「Commit changes」。
2. マニュアルや字体は **`manuals` フォルダを開いた画面で**アップロード。
3. Cloudflare の「デプロイ」が「成功」になったら、画面を `Ctrl + Shift + R` で読み直す。
4. **新しいファイルを追加したときは必ずアップロード**（無いと組み立てエラーになる。過去に `schedule.js` の入れ忘れで失敗した例あり）。
5. `wrangler.jsonc` は本番の値（database_id・assets）なので、ソース一式の zip には含めていない。

初回の構築（参考）：D1 で `youth-cup-db` を作成 → `schema.sql` を実行 → `wrangler.jsonc` の database_id を設定 → シークレット `ADMIN_PASSWORD`・`SESSION_SECRET`（40文字以上）・`ADMIN_ID`（省略時 admin）。

---

## 7. 検査の方法（INFINEX_dev_tools.zip の devtests/）

ローカル：`npm install` → `npm run db:init:local` → `npx wrangler dev --port 8788`（`.dev.vars` に ADMIN_PASSWORD=test-pass など）。

| 検査 | 命令 | 前回の結果 |
|---|---|---|
| ロジック | `npm test` | 45件 合格 |
| 総当たり | `npm run test:fuzz` | 590通り 完走 |
| 通しテスト | `BASE_URL=http://127.0.0.1:8788 node e2e.mjs` | 45項目 合格 |
| バックアップ | `node backup.mjs` | 22項目 |
| 時間の調整 | `node retime.mjs` | 24項目 |
| 大会運営者の権限 | `node operator.mjs` | 20項目 |
| 棄権・開催中の入れ替え | `node wd_test.mjs` | 17項目 |
| 左右・左側の審判 | `seeddemo2.mjs`→`pkset.mjs`→`flip_test.mjs` | 11項目 |
| 試合の入れ替え・節 | `node move_test.mjs` | 6項目 |
| 全画面を開く | `seeddemo2.mjs`→`pkset.mjs`→`seed_manual.mjs`→`python3 smoke.py` | 22画面 エラー0 |
| 組み立て | `npx wrangler deploy --dry-run --outdir /tmp/wbuild` | 成功 |

- 各検査は**空のデータベースから**実行する（`fresh.sh` が「サーバー停止 → DB作り直し → 起動」を行う）。
- **注意**：サーバーが動いている最中に `.wrangler` を消すと、サーバーが壊れて検査が止まる。必ず `fresh.sh` を使う。
- 道具の置き場所の前提：`devtests/setup.sh` を実行すると、検査の道具を `/tmp/` に、画像を所定の場所にコピーする。プロジェクトは `/home/claude/youth-cup-flat` に置く想定。

---

## 8. マニュアル（INFINEX_dev_tools.zip の manual-tools/）

- 作成：`python3 make_all.py`（`build.py`＝HTML→PDF、`content_org_full.py`＝大会管理者・全体管理者、`content_staff2.py`＝大会運営者・スコア管理者＋簡易マニュアル2冊、`content_parents.py`＝保護者）。
- 画面写真：`img/`。撮り直しは `shot_all.py`（管理画面・運営者・スコア管理者）、`shotpar.py`・`shotlost.py`・`shot_m10.py`（保護者）。
- 出力先：`/mnt/user-data/outputs/manuals/`（システム用4冊）、`/mnt/user-data/outputs/quick/`（簡易マニュアル2冊）。
- システム用のマニュアルは `manuals/` に入れてデプロイし、ランディングページのリンクも差し替える。

| マニュアル | ページ |
|---|---|
| 大会管理者 | 25 |
| 大会運営者・スコア管理者 | 12 |
| 保護者 | 13 |
| 全体管理者 | 5 |
| 簡易：大会運営者／スコア管理者（システム外） | 各1 |

---

## 9. 残っている課題・次の候補

1. **マニュアルの画面写真の撮り直し**：前回の写真は、日本語が中国語の字体で写っている（字体の指定を修正済み。撮り直しのみ必要）。
2. **2段階認証（認証アプリの6桁コード）**と**管理画面の入口のURLの変更**：提案済み・未実装（必須にする権限は未決定）。段階的なロック・ログイン履歴も候補。
3. デザインの続き：管理画面の左側メニュー化、トーナメント表・星取表の見た目、SNS画像・パンフレットの初期色。
4. 審判を第三者のチームが担当する方式（`match_officials` 表は定義済み・未使用）。
5. 電波が切れたときの入力の保持（オフライン対応）。
6. `manuals/INFINEX_manual_team.pdf`（旧チーム関係者マニュアル）は不要。GitHubから削除してよい。

---

## 10. これまでに決まっていること（方針）

- 本番データは保持。DBは「追加のみ」、既存の値の書き換えは利用者の操作があったときだけ（変更前は履歴に保存し、戻せるようにする）。
- 発行済みの保護者URL・QRは変えない。
- 文言は分かりやすい日本語。専門用語は避ける。
- デザインは「Pitchside Paper」：背景 #FAFAF9・文字 #0C0A09・アクセントはライム #C8FF3D の1色（文字色にはしない）・赤 #E7000B は試合中とエラーだけ・数字は Inter・ピル型のボタン・ヘアラインのカード。
- 日本語の字体は `Noto Sans CJK JP` をヒラギノより前に指定（Android・Linuxで中国語の字体にならないように）。

## 11. 直近の変更（2026年11月・ユーザーテスト後）

- **SNS画像（Instagram向けに刷新）**：左上に大きな見出し、最終結果は表彰台（優勝＝ライムの大きなカード、2・3位＝並べたカード）、予選の順位表は組ごとの角丸カード。背景は黒地＋アクセントの光＋薄いピッチのライン（`web-poster.js` の `bgModern`・`headModern`・`footModern`）。試合結果の画像は従来のデザイン（写真つき）。
- **Safari対策**：絵文字（♾️ など）を含む文字の幅が測れない不具合に対応（`measureW`・`fillCenter`）。保存は共有の画面から写真へ（`web-ui.js` の `saveImages`）。
- **スマホの専用画面（スコア管理者・大会運営者）**：一番上に「次に入力する試合」、絞り込み（状態・コート）を記憶、入力待ちの印、大きな＋−、確定ボタンに内容を表示、確定後に「次の試合を入力」、タブは画面の下、上部はスマホで［メニュー］にまとめる。
- **決勝リーグ**：すべての進み方で［トーナメント／リーグ戦］を選べる。決勝の段のリーグ戦は引き分けを確定できる（`isLeagueLike`）。
- **その他**：得点の入力は0〜99の整数に自動でそろえる、ダッシュボードに「結果の報告待ち」とLINE用の催促文、忘れ物の写真はJPEGで自動圧縮、「結果訂正」は得点が実際に変わったときだけ、準備中の大会は担当者の画面に灰色で表示。
- **未対応**：マニュアル（PDF）は、これらの変更と新しい画面写真にまだ更新していない。
- **2026年11月11日**：［LINEで送る］（結果の報告待ちをLINEの共有で送る。大会運営者のスマホ・ダッシュボード）。予選リーグのコートの割り振りに「ブロックごと」（`config.leagueCourtMode = 'block'`。組ごとにコートを固定し交互に）を追加。PDF・Excelの「途中経過」の表記を削除。試合の入れ替えでは節の番号を自動で変えず、順でなくなったら確認を出す（`roundsOutOfOrder`・`askRenumber`）。
