# Orbit Life

円形フィールドを舞台に、局所的な引力・反発・旋回と生命ルールから群れが創発する、ブラウザベースの粒子ライフシミュレーションです。

## 起動

ビルドは不要です。任意の静的ファイルサーバーでリポジトリを公開してください。

```bash
python3 -m http.server 4173
```

その後、`http://localhost:4173` を開きます。

## GitHub Pages へのデプロイ

このリポジトリには、GitHub Pagesへ自動デプロイするGitHub Actionsワークフローが含まれています。ビルド処理や追加パッケージは必要ありません。

### 初回設定

1. リポジトリをGitHubへpushします。
2. GitHub上のリポジトリで **Settings → Pages** を開きます。
3. **Build and deployment** の **Source** を **GitHub Actions** に変更します。
4. `main` または `master` ブランチへ変更をpushします。
5. **Actions** タブの「Deploy Orbit Life to GitHub Pages」が完了するまで待ちます。

デプロイ後は、通常は次のURLでアクセスできます。

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```

このリポジトリ名が `cirLife` の場合は、`https://<GitHubユーザー名>.github.io/cirLife/` です。CSSとJavaScriptは相対パスで参照しているため、プロジェクトサイトのサブパスでも動作します。

### 手動で再デプロイする

GitHubの **Actions → Deploy Orbit Life to GitHub Pages → Run workflow** から、いつでも手動デプロイできます。通常は `main` または `master` へのpush時に自動実行されます。

### 公開されない場合

- **Settings → Pages → Source** が **GitHub Actions** になっているか確認してください。
- **Actions** タブでワークフローのエラー内容を確認してください。
- Organizationリポジトリでは、GitHub PagesやActionsの利用がポリシーで制限されていないか管理者へ確認してください。
- 初回デプロイ直後は、公開URLが利用可能になるまで少し時間がかかる場合があります。

## 操作

- **Pause / Start** — シミュレーションの一時停止と再開
- **Reset** — 現在のシードで初期状態を再現
- **Randomize** — 新しいシードで世界を生成
- **Simulation Speed** — `0.25×` から `4×` まで時間倍率を変更
- **フィールドをクリック / ドラッグ** — 生体粒子を追加
- 左パネルのスライダー — 引力、反発、旋回力、出生率をリアルタイム調整

シミュレーションは Canvas 2D と Uniform Grid による近傍探索で実装され、固定 60 Hz の更新と描画ループを分離しています。
