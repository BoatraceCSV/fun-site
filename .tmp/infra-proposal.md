# GCPインフラ構成提案: ボートレースファンサイト

## 推奨アーキテクチャ構成

### アーキテクチャ概要

静的サイト生成（SSG）+ サーバーレスバッチ処理の構成を採用する。毎朝AM2:00にバッチジョブが起動し、BoatraceCSV（GitHub Pages）からレースデータを取得、Vertex AI Gemini 3 Pro / Gemini 3 Pro Image で展開予想画像を生成、静的HTMLを組み立ててCloud Storageにデプロイする。ユーザーはCloud CDN経由で高速に配信された静的ページを閲覧する。

### 構成図（テキストベース）

```
┌─────────────────────────────────────────────────────────────────┐
│                        GCP Project                              │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │   Cloud       │    │  Cloud Run Jobs  │    │  Vertex AI    │  │
│  │   Scheduler   │───▶│  (バッチ処理)     │───▶│  Gemini 3 Pro │  │
│  │   AM 2:00     │    │  TypeScript      │    │  (分析+画像)   │  │
│  └──────────────┘    └───────┬──────────┘    └───────────────┘  │
│                              │                                   │
│                              │ 生成した静的ファイルをアップロード   │
│                              ▼                                   │
│  ┌──────────────┐    ┌──────────────────┐                       │
│  │  Cloud CDN   │◀───│  Cloud Storage   │                       │
│  │  (キャッシュ) │    │  (静的ホスティング)│                       │
│  └──────┬───────┘    └──────────────────┘                       │
│         │                                                        │
│  ┌──────┴───────┐                                               │
│  │  Cloud Load  │    ┌──────────────────┐                       │
│  │  Balancer    │    │  Cloud Build     │                       │
│  │  + SSL証明書  │    │  (CI/CD)         │                       │
│  └──────┬───────┘    └──────────────────┘                       │
│         │                                                        │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
    ┌───────────┐
    │  ユーザー   │
    │ (ブラウザ)  │
    └───────────┘
```

### データフロー

```
[Cloud Scheduler] ──(HTTP trigger)──▶ [Cloud Run Jobs]
                                          │
                                          ├── 1. BoatraceCSVから当日レースデータ取得
                                          ├── 2. Vertex AI Gemini 3 Pro / Pro Imageで展開予想画像生成
                                          ├── 3. 静的HTML/CSS/JS生成（SSG）
                                          └── 4. Cloud Storageへアップロード
                                                    │
                                                    ▼
                                          [Cloud Storage] ──▶ [Cloud CDN] ──▶ ユーザー
```

---

## 各GCPサービスの選定理由

### 1. 静的サイトホスティング: Cloud Storage + Cloud CDN

**選定: Cloud Storage + Cloud CDN**（Firebase Hostingではなく）

| 観点 | Cloud Storage + CDN | Firebase Hosting |
|------|-------------------|-----------------|
| GCPネイティブ度 | ◎ GCPサービスそのもの | △ Firebase（GCP傘下だが別プロダクト） |
| ハッカソンアピール | ◎ GCPサービス活用を直接示せる | △ GCPというよりFirebase |
| CDN制御 | ◎ キャッシュポリシー細かく制御可能 | ○ 自動だが制御が限定的 |
| コスト | ○ 無料枠あり、従量課金 | ◎ Sparkプラン無料枠が大きい |
| カスタムドメイン+SSL | ○ LB+Certificate Managerが必要 | ◎ 標準搭載 |
| バッチからのデプロイ | ◎ gsutil/gcloud で直接アップロード | △ firebase CLIが必要 |

**選定理由:**
- Google Cloudハッカソンでの審査ではGCPサービスの活用度が重視される。Firebase HostingよりCloud Storage + Cloud CDNの方がGCPネイティブとして評価される
- バッチジョブからの静的ファイルデプロイが `gsutil rsync` で極めてシンプル
- CDNキャッシュの制御（1日1回更新なのでTTLを長く設定可能）が容易

### 2. バッチ実行基盤: Cloud Run Jobs

**選定: Cloud Scheduler + Cloud Run Jobs**（Cloud Functions 2nd genではなく）

| 観点 | Cloud Run Jobs | Cloud Functions 2nd gen |
|------|---------------|----------------------|
| 実行時間制限 | 最大24時間 | 最大60分（HTTP）/ 9分（イベント） |
| コンテナ自由度 | ◎ 任意のDockerイメージ | △ ランタイム制約あり |
| ローカル開発 | ◎ Docker composeで再現可能 | △ Functions Frameworkが必要 |
| メモリ上限 | 最大32GiB | 最大32GiB |
| コスト | ○ 実行時間のみ課金 | ○ 実行時間のみ課金 |

**選定理由:**
- 画像生成APIの呼び出し + 静的サイト生成で処理時間が読めない。Cloud Run Jobsなら最大24時間まで対応可能
- TypeScript + Node.jsのDockerイメージとして自由に構成可能
- 複数レース場（最大24場）× 複数レース（最大12R）の画像生成は並列処理が望ましく、Cloud Run Jobsのタスク並列実行が適している
- ローカル開発・テストがDockerだけで完結する

### 3. Vertex AI API呼び出し構成

**サービスアカウント設計:**

```
cloud-run-batch@{PROJECT_ID}.iam.gserviceaccount.com
  ├── roles/aiplatform.user          (Vertex AI API呼び出し)
  ├── roles/storage.objectAdmin      (Cloud Storageへの書き込み)
  └── roles/logging.logWriter        (ログ出力)
```

**API呼び出しパターン:**
- Gemini 3 Pro（展開予想テキスト分析・品質チェック）
- Gemini 3 Pro Image（展開予想画像生成）
- Application Default Credentials（ADC）によるサービスアカウント認証
- レート制限対策: 指数バックオフ付きリトライ（最大3回）
- バッチ内で並行度を制限（同時5リクエスト程度）してAPIクォータ超過を防止

**Gemini API の使い方:**
```typescript
// @google-cloud/vertexai パッケージを使用
import { VertexAI } from '@google-cloud/vertexai';

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID,
  location: 'us-central1',
});

const model = vertexAI.getGenerativeModel({
  model: 'gemini-3-pro',
});
```

### 3.5. データ取得元: BoatraceCSV

**GitHub Pages 配信の CSV データを利用する。**

URL パターン: `https://boatracecsv.github.io/data/{type}/YYYY/MM/DD.csv`

| CSV種別 | パス | 内容 |
|---|---|---|
| Programs | `data/programs/YYYY/MM/DD.csv` | 出走表（選手・モーター・成績） |
| Prediction Previews | `data/prediction-preview/YYYY/MM/DD.csv` | ML予測による展示会予測 |
| Estimates | `data/estimate/YYYY/MM/DD.csv` | ML予測（着順・決まり手・コース・ST） |
| Results | `data/results/YYYY/MM/DD.csv` | レース結果・配当金 |
| Confirmations | `data/confirm/YYYY/MM/DD.csv` | 予想と結果の対比 |

外部HTTP取得のためサービスアカウントへの追加権限は不要。

### 4. コスト最適化

**月額コスト概算（個人開発レベル）:**

| サービス | 無料枠 | 想定使用量 | 月額概算 |
|---------|--------|----------|---------|
| Cloud Storage | 5GB/月 | ~1GB（HTML+画像） | ¥0 |
| Cloud CDN | - | ~10GB配信 | ~¥800 |
| Cloud Run Jobs | CPU 180,000 vCPU秒/月 | 1日1回×~300秒 | ¥0（無料枠内） |
| Cloud Scheduler | 3ジョブ無料 | 1ジョブ | ¥0 |
| Vertex AI Gemini 3 Pro / Pro Image | - | ~24レース/日×30日 | ~¥9,000-12,000 |
| Cloud Build | 120分/日無料 | ~5分/ビルド | ¥0 |
| Cloud Load Balancer | - | 最小構成 | ~¥2,500 |
| **合計** | | | **~¥12,300-15,300** |

**コスト削減のポイント:**
- Cloud CDN + LBのコストが固定費として大きい。ハッカソン期間中のみ有効化し、それ以外はCloud Storageの直接公開URLで代替可能
- Gemini 3 Pro Image の画像生成枚数を絞ることで Vertex AI コストを削減可能
- Cloud Storage の Standard クラスで十分（Nearline/Coldlineは不要）
- 対象レース数の絞り込み（各場12Rのみ → 最大24レース/日）でコスト制御

### 5. CI/CDパイプライン: Cloud Build

**選定: Cloud Build**（GitHub Actionsではなく）

**選定理由:**
- GCPハッカソンではCloud Buildの利用がGCPエコシステム活用として評価される
- GitHub連携が標準サポートされており、pushトリガーで自動ビルド可能
- 120ビルド分/日の無料枠で個人開発には十分
- Cloud Run Jobsのコンテナイメージビルド・デプロイまで一気通貫

**パイプライン構成:**

```yaml
# cloudbuild.yaml
steps:
  # 1. 依存関係インストール
  - name: 'node:20'
    entrypoint: 'npm'
    args: ['ci']

  # 2. Lint + 型チェック
  - name: 'node:20'
    entrypoint: 'npm'
    args: ['run', 'check']

  # 3. テスト
  - name: 'node:20'
    entrypoint: 'npm'
    args: ['run', 'test']

  # 4. Dockerイメージビルド & プッシュ
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'us-central1-docker.pkg.dev/$PROJECT_ID/fun-site/batch:$COMMIT_SHA', '.']

  # 5. Artifact Registryへプッシュ
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'us-central1-docker.pkg.dev/$PROJECT_ID/fun-site/batch:$COMMIT_SHA']

  # 6. Cloud Run Jobsの更新
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args: ['gcloud', 'run', 'jobs', 'update', 'fun-site-batch',
           '--image', 'us-central1-docker.pkg.dev/$PROJECT_ID/fun-site/batch:$COMMIT_SHA',
           '--region', 'us-central1']
```

### 6. ドメイン・SSL

**推奨構成:**
- **ドメイン取得**: Cloud Domains（GCPネイティブ、ハッカソンでのGCPサービス活用アピール）
- **SSL証明書**: Certificate Manager（Google マネージド証明書、自動更新）
- **ロードバランサ**: Global External Application Load Balancer（HTTP(S) LB）

**Cloud Domains の利点:**
- GCPコンソールから直接ドメイン管理が可能
- Cloud DNS との自動統合
- Certificate Manager との連携がシームレス
- ハッカソン審査でGCPサービス活用としてカウント可能

### 7. ハッカソン向けアピールポイント

**GCPサービス活用の幅広さ:**

| カテゴリ | 使用サービス | アピール |
|---------|------------|--------|
| AI/ML | Vertex AI Gemini 3 Pro / Pro Image | 最新のマルチモーダルAI活用 |
| コンピュート | Cloud Run Jobs | サーバーレスバッチ処理 |
| ストレージ | Cloud Storage | 静的サイトホスティング |
| ネットワーク | Cloud CDN + LB | グローバル配信 |
| スケジューリング | Cloud Scheduler | 定期実行 |
| CI/CD | Cloud Build | 自動ビルド・デプロイ |
| コンテナ | Artifact Registry | コンテナイメージ管理 |
| セキュリティ | IAM + Service Account | 最小権限原則 |
| 監視 | Cloud Logging + Monitoring | 運用可視化 |

**審査でのアピール要素:**
1. **Vertex AI Gemini 3 Pro / Pro Image の活用**: Google最新のマルチモーダルAIを実用的なユースケースで活用
2. **完全サーバーレス**: 運用コストと管理負荷を最小化する設計
3. **GCPネイティブ**: 9つ以上のGCPサービスを適切に組み合わせた構成
4. **コスト効率**: 無料枠の最大活用と従量課金による最適化
5. **実用性**: 実際のボートレースデータに基づく日次更新サイト

---

## リージョン選定

| サービス | リージョン | 理由 |
|---------|----------|------|
| Cloud Run Jobs | us-central1 | Vertex AI Gemini対応リージョン、コスト最安 |
| Cloud Storage | us-central1 | Cloud Run Jobsと同一リージョンでデータ転送費削減 |
| Vertex AI | us-central1 | Gemini 3 Pro / Pro Image が利用可能 |
| Cloud Build | us-central1 | Artifact Registryと同一リージョン |
| Load Balancer | グローバル | CDNと統合 |

**注意:** ユーザーは日本国内が主だが、Cloud Storageはマルチリージョンではなくus-central1シングルリージョンを推奨する。理由：
- Cloud CDNがキャッシュするため実際のレイテンシ影響は軽微
- Vertex AI Geminiがus-central1で利用可能なため、同一リージョンに揃えるとデータ転送費が無料
- asia-northeast1（東京）にするとVertex AIとのクロスリージョン通信が発生

---

## 初期構築手順（概略）

```bash
# 1. プロジェクト作成・API有効化
gcloud projects create boatrace-fun-site
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  aiplatform.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  domains.googleapis.com \
  certificatemanager.googleapis.com

# 2. サービスアカウント作成
gcloud iam service-accounts create cloud-run-batch \
  --display-name="Batch Processing Service Account"

# 3. 権限付与
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:cloud-run-batch@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# 4. Cloud Storage バケット作成（静的サイト）
gsutil mb -l us-central1 gs://boatrace-fun-site/
gsutil web set -m index.html -e 404.html gs://boatrace-fun-site/

# 5. Artifact Registry リポジトリ作成
gcloud artifacts repositories create fun-site \
  --repository-format=docker \
  --location=us-central1

# 6. Cloud Run Jobs作成
gcloud run jobs create fun-site-batch \
  --image=us-central1-docker.pkg.dev/$PROJECT_ID/fun-site/batch:latest \
  --region=us-central1 \
  --service-account=cloud-run-batch@$PROJECT_ID.iam.gserviceaccount.com

# 7. Cloud Scheduler設定（毎日AM2:00 JST）
gcloud scheduler jobs create http fun-site-daily \
  --schedule="0 2 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/..." \
  --http-method=POST
```
