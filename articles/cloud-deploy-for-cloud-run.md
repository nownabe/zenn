---
title: "Cloud Run のための実践 Cloud Deploy"
emoji: "🚀"
type: "tech" # tech: 技術記事 / idea: アイデア
topics:
- gc24
- gcp
- googlecloud
- clouddeploy
- cloudrun
publication_name: knowledgework
published: false
---

# はじめに

本記事では実践的な Cloud Run のデプロイパイプライン実装を通して Cloud Deploy の理解を試みます。Cloud Deploy は元々 Kubernetes 用のプロダクトとしてリリースされたこともあり、Cloud Run に限って利用するにはわかりにくい部分があります。本記事では Cloud Run のデプロイの本番環境構築・運用に必要な部分のみをピックアップして次のようなことを説明します。

* Cloud Deploy の仕組み
* Cloud Deploy を使ったデプロイパイプラインの設計・実装方法
* Service Account、IAM 設計
* おすすめの Infra as Code の方法
* おすすめの skaffold.yaml の書き方

Automation、デプロイフック、カナリアデプロイなどの高度なパイプライン、監視などは上記のような基本をおさえれば応用が効くので本記事では説明しません。

本記事の想定読者は Cloud Run は使っているけど Cloud Deploy は使っていないという人です。Kubernetes の知識がなくても理解できるようにしていますが、次のような知識を前提としています。

* Google Cloud (gcloud CLI, プロジェクト, IAM, Service Account, Cloud Run, Cloud Build, Cloud Storage, Artifact Registry)
* Docker、コンテナ
* Terraform

:::details Disclaimer
本記事ではおすすめの方法などを紹介していますが、筆者が実際に構築・運用をする中で考えたおすすめやベストプラクティスであって、Google Cloud 公式のものではありません。また、わかりやすさのため説明が厳密ではない部分があります。
:::

# Cloud Deploy とは

## 概要

「開発環境 → ステージング環境 → 本番環境」のような、異なる環境に対する一連のデプロイパイプラインを管理・自動化するためのフルマネージドサービスです。Cloud Deploy ではそのようなパイプラインを Delivery Pipeline と呼びます。

本記事ではこれ以上の概要は割愛しますが、 Cloud Deploy で何ができるのか、何が嬉しいのかを把握するには以下の記事がおすすめです。

https://medium.com/google-cloud-jp/cloud-deploy-397c8a7c68c0

https://zenn.dev/google_cloud_jp/articles/cloud-deploy-updates-2023


## Delivery Pipeline の例

Cloud Deploy では例えば以下のような Delivery Pipeline を実現できます。各 Delivery Pipeline に対してサンプル実装を用意しているので参考にしてください。

### シリアル デプロイ

![serial](/images/articles/cloud-deploy-for-cloud-run/serial.png)

1つの Cloud Run service アプリを各環境に順にデプロイするシンプルなパイプラインです。Google Cloud では環境はプロジェクトを分けることが一般的であるため、Delivery Pipeline はプロジェクトをまたいで構築することになります。

[サンプル実装](https://github.com/nownabe/google-cloud-examples/tree/main/cloud-deploy/serial)

### 並行デプロイ

![multi-region](/images/articles/cloud-deploy-for-cloud-run/multi-region.png)

複数の Cloud Run service アプリを各環境に順にデプロイするパイプラインです。ひとつの環境に対しては複数の Cloud Run service を同時にデプロイします。例えば、同じアプリをマルチリージョンにデプロイしている場合などに役立ちます。

[サンプル実装](https://github.com/nownabe/google-cloud-examples/tree/main/cloud-deploy/multi-region)

### カナリア デプロイ

### デプロイフック

# Cloud Deploy のアーキテクチャとデプロイの流れ

Delivery Pipeline を正しく構築するためには Cloud Deploy がどのようなアーキテクチャで、どうやってデプロイするかを理解しておく必要があります。

## Skaffold

まずはじめに、Cloud Deploy を使い始めた人が戸惑うであろう Skaffold について説明します。

Cloud Deploy は [Skaffold](https://skaffold.dev/) という OSS を利用してデプロイを実現します。Skaffold は Kubernetes 用の開発ツールで機能が多く学習コストも高いのですが、Cloud Run のデプロイをする場合は一旦次のような理解を持っておけば大丈夫です。

Skaffold は `skaffold.yaml` という YAML ファイルの設定に従い、

* コンテナイメージをビルド・プッシュする
* ビルドしたイメージに基づいて [Cloud Run service YAML](https://cloud.google.com/run/docs/reference/yaml/v1) をレンダリングする (以下、`manifest.yaml` とします)
* レンダリングした `manifest.yaml` をデプロイする

## Cloud Deploy のアーキテクチャ

Cloud Deploy の Delivery Pipeline は [Delivery Pipeline](https://cloud.google.com/deploy/docs/api/reference/rest/v1/projects.locations.deliveryPipelines) とそれに紐づく複数の [Target](https://cloud.google.com/deploy/docs/api/reference/rest/v1/projects.locations.targets) で構成されます。

![architecture](/images/articles/cloud-deploy-for-cloud-run/architecture.png)

Delivery Pipeline は Cloud Deploy のメインとなるリソースで、何をどういう順番でデプロイするかを定義します。順番の定義には [Stage](https://cloud.google.com/deploy/docs/terminology#stage) という概念が使われます。例えば dev / stg / prd 環境があるとき、それぞれ dev stage、stg stage、prd stage を定義します。各 Stage には 1 つ以上の Target が紐付きます。

Target はデプロイ先を表現するリソースで、Cloud Run の場合はデプロイ先のプロジェクトとロケーションを定義します。

Delivery Pipeline と Target を擬似的な Terraform で表現すると次のようになります。

```tf
resource "google_clouddeploy_target" "hello-app-dev" {
  name = "hello-app-dev"
  run {
    location = "projects/hello-app-dev/locations/us-west1"
  }
}

resource "google_clouddeploy_target" "hello-app-stg" {
  name = "hello-app-stg"
  run {
    location = "projects/hello-app-stg/locations/us-west1"
  }
}

resource "google_clouddeploy_target" "hello-app-prd" {
  name = "hello-app-prd"
  run {
    location = "projects/hello-app-prd/locations/us-west1"
  }
}

resource "google_clouddeploy_delivery_pipeline" "delivery-pipeline" {
  name = "hello-app-pipeline"
  serial_pipeline {
    stages { target_id = "hello-app-dev" }
    stages { target_id = "hello-app-stg" }
    stages { target_id = "hello-app-prd" }
  }
}
```

## デプロイの流れ

### デプロイの全体像

Cloud Deploy での一連のデプロイは大きく次のような流れになります。

* **事前準備**: コンテナイメージをビルドする
* **Release 作成**: ビルドしたイメージを Cloud Deploy の Release というリソースに紐付ける
* 各 Stage に対して以下をそれぞれ行う
  * **Promote**: 次の Stage にイメージをデプロイする

### 事前準備

Cloud Deploy はあくまでもデプロイに特化したサービスなので、コンテナイメージのビルド等を事前にやっておく必要があります。具体的には `skaffold build` の実行が事前に必要です。

次のようなコマンドを実行すると、Skaffold が `skaffold.yaml` の設定に従いコンテナイメージをビルド、プッシュして結果を `artifacts.json` として出力します。

```shell
skaffold build \
  --filename skaffold.yaml \
  --default-repo us-west1-docker.pkg.dev/hello-app-pipeline/my-app \
  --file-output artifacts.json
```

`artifacts.json` にはビルドしたイメージの情報が格納されています。Cloud Deploy ではこの情報をデプロイ単位として扱うことで、各環境に同じ成果物をデプロイすることを保証します。

```json
{
  "builds": [
    {
      "imageName": "hello-app",
      "tag": "us-west1-docker.pkg.dev/hello-app-pipeline/hello-app/hello-app:v1.0.0@sha256:6e0fea340f0db7af620de12a2e121231ed497adc4903cf2a920fed497fc06e5b"
    }
  ]
}
```

### Release 作成

Cloud Deploy でのデプロイはまず [Release](https://cloud.google.com/deploy/docs/api/reference/rest/v1/projects.locations.deliveryPipelines.releases) というリソースを作ります。Release は事前準備でビルドしたコンテナイメージを Delivery Pipeline に紐付けるリソースです。Release はコンテナイメージの情報以外にも Cloud Run service YAML をレンダリングするためのソースを持っています。具体的には、`skaffold.yaml` と `manifest.yaml` のテンプレートを格納した `.tgz` を保存している Cloud Storage の URI です。

![release](/images/articles/cloud-deploy-for-cloud-run/release.png)

gcloud を使って Release を作成するには次のようにします。

```shell
gcloud deploy releases create v-1-0-0 \
  --region us-west1 \
  --delivery-pipeline hello-app \
  --gcs-source-staging-dir gs://hello-app-pipeline/hello-app/source \
  --build-artifacts artifacts.json \
  --skaffold-file skaffold.yaml \
  --source .
```

また、Release は作成されると同時に全 Target に対する `manifest.yaml` をレンダリングして Cloud Storage に保存します。具体的には各 Target ごとに Cloud Build 上で `skaffold render` コマンドを実行します。

![render-manifest](/images/articles/cloud-deploy-for-cloud-run/render-manifest.png)

### Promote

Release を作成したあと、その Release を Promote して次の Stage へ実際にデプロイします。

実は、Cloud Deploy でよく目にする「Promote」ですが、具体的な「Promote」という処理は存在しません。Promote をしたとき、具体的な処理としては [Rollout](https://cloud.google.com/deploy/docs/api/reference/rest/v1/projects.locations.deliveryPipelines.releases.rollouts) というリソースの作成をしています。

Rollout は Release と Target を紐付けるリソースです。Rollout を作成すると Cloud Build 上で `skaffold apply` を実行して、レンダリング済みの `manifest.yaml` を Target にデプロイします。

![create-rollout](/images/articles/cloud-deploy-for-cloud-run/create-rollout.png)

以上をおさえた上で「Promoteする」とは、一般的には「対象とする Release について次の Stage が指す Target への Rollout を作成する」ことです。 gcloud を使って Promote するには次のようにします。

```shell
gcloud deploy releases promote \
  --release v-1-0-0 \
  --delivery-pipeline hello-app \
  --region us-west11
```

最初の Stage に対する Rollout 作成は Release 作成と同時に実行することが多く、コンソールや `gcloud deploy releases create` もそうなっています。つまり、dev → stg → prd のような Delivery Pipeline の場合、Release を作成すると同時に dev 環境へのデプロイが実施されます。

:::details Rollout についての補足
正確には、Rollout と Cloud Build の間には [Phase](https://cloud.google.com/deploy/docs/terminology#phase) や [Job](https://cloud.google.com/deploy/docs/terminology#job) といった概念も存在します。今回例にしているようなシンプルな Delivery Pipeline では意識する必要はありませんが、例えば[カナリアデプロイ](https://cloud.google.com/deploy/docs/deployment-strategies/canary)をするときには Phase を、[デプロイフック](https://cloud.google.com/deploy/docs/hooks)を利用するときは Job を意識する必要が出てきます。
:::

:::details Promote についての補足
Promote は実態としては特定の Target に対する Rollout の作成です。このことを理解しておけば、必ずしも dev → stg → prd という順番を守ってデプロイする必要はないことがわかります。例えば、`--disable-initial-rollout` オプションを使って `gcloud deploy releases create` を実行すると、dev への Rollout を作成せずに Release を作成することができます。その状態で、`--to-target` オプションを使って `gcloud deploy releases promote` を実行するといきなり prd 環境へデプロイすることもできます。prd 環境へ hotfix する場合などに活用できます。
:::

### まとめ

Cloud Deploy を使った dev → stg → prd というデプロイパイプラインにおけるデプロイの流れをまとめると次のようになります。

1. **事前準備**
    * `skaffold build` を使ってコンテナイメージをビルド、プッシュする
    * ビルド結果として `artifacts.json` を手に入れる
2. **Release 作成**
    * `gcloud deploy releases create` コマンド等で Release を作成する
    * Release は `skaffold.yaml`、`manifest.yaml` (テンプレート)、`artifacts.json` から各 Target にデプロイするための `manifest.yaml` を `skaffold render` でレンダリングし、Cloud Storage へ格納する
    * 自動的に dev 環境への Rollout が作成される
    * dev 環境への Rollout は `skaffold apply` を実行して dev 用にレンダリングされた `manifest.yaml` を dev 環境へデプロイする
3. **stg 環境への Promote**
    * `gcloud deploy releases promote` コマンド等で Promote する
    * stg 環境への Rollout が作成される
    * stg 環境への Rollout は `skaffold apply` を実行して stg 用にレンダリングされた `manifest.yaml` を stg 環境へデプロイする
4. **prd 環境への Promote**
    * `gcloud deploy releases promote` コマンド等で Promote する
    * prd 環境への Rollout が作成される
    * prd 環境への Rollout は `skaffold apply` を実行して prd 用にレンダリングされた `manifest.yaml` を prd 環境へデプロイする


![flow](/images/articles/cloud-deploy-for-cloud-run/flow.png)
*デプロイの流れ全体像*

# Delivery Pipeline を構築する

ここからは `hello-app` という Cloud Run service アプリの dev → stg → prd というデプロイパイプライン構築を通して Cloud Deploy の仕組み、おすすめの構築方法、おすすめの設計を説明していきます。

サンプルの Terraform コードは省略して書いてあるためそのままコピペしても動きません。[サンプルコード](https://github.com/nownabe/google-cloud-examples/tree/main/cloud-deploy/serial)からコピーするようにしてください。

## プロジェクト構成

Google Cloud では環境ごとにプロジェクトを分けることがベストプラクティスです。では Delivery Pipeline などデプロイ用のリソースをどこに置けばいいかというと、サービス用のプロジェクトとは別にパイプライン用のプロジェクトを作成するのがおすすめです。

![projects](/images/articles/cloud-deploy-for-cloud-run/projects.png)

## 権限設計

Delivery Pipeline 周辺にどのような登場人物 (Google Cloud 用語で [Principal](https://cloud.google.com/iam/docs/overview#concepts_related_identity)) がいて、それぞれ何ができればよいかを考えます。

### Principals

まずはどのような Principal がいるのかを見ていきます。下図は登場する Principal をまとめたものです。

![principals](/images/articles/cloud-deploy-for-cloud-run/principals.png)

それぞれ簡単に説明します。

* **image builder**: コンテナイメージをビルド・プッシュする人。`skaffold build` を実行する
* **releaser**: Release を作成する人。`gcloud deploy releases create` を実行する
* **xxx promoter**: 各環境への Rollout を作成する人。`gcloud deploy releases promote` を実行する
* **Cloud Build の Service Account**: 各 Target に関する Cloud Build の Service Account。`skaffold render` や `skaffold apply` を実行する
* **Cloud Run service の Service Account**: 各 Cloud Run service の Service Account

細かく考えると上記のような Principals がありますが今回は次のようにします。

* releaser に image builder と dev promoter を含める
  * 多くの場合、コンテナイメージのビルド・プッシュから dev 環境へのデプロイは自動化して同時に実施することが多いため
* Cloud Run の Service Account は考えない
  * Delivery Pipeline 周辺においては Principal として登場しないため

![principals2](/images/articles/cloud-deploy-for-cloud-run/principals2.png)


### releaser の権限

releaser は次の処理を行います。また、各処理に必要な role または permission を併記します。

* `skaffold build`
  * コンテナイメージをビルド
  * コンテナイメージをプッシュ (Artifact Registry repository への `roles/artifactregistry.writer`)
* `gcloud deploy releases create`
  * Release の作成 (Delivery Pipeline への `clouddeploy.releases.create`)
    * `source.tgz` を Cloud Storage へアップロード (Cloud Storage bucket への `roles/storage.objectCreator`, `roles/storage.legacyBucketReader`)
    * 各 Target に対して `skaffold render` を実行するための Cloud Build の起動 (各 Target に設定された Service Account への `roles/iam.serviceAccountUser`)
  * dev に対する Rollout の作成 (Delivery Pipeline への条件付き `roles/clouddeploy.releaser`)
    * dev Target に対して `skaffold apply` を実行するための Cloud Build の起動 (dev Target に設定された Service Account への `roles/iam.serviceAccountUser`)
  * 非同期処理 ([Operations](https://cloud.google.com/deploy/docs/api/reference/rest/v1/projects.locations.operations)) の取得 (pipeline プロジェクトへの `roles/clouddeploy.viewer`)

:::details releaser に必要な権限の補足
Rollout を作成するときに各 Target に対する読み取り権限も必要になりますが、Operation を取得するためにプロジェクトに `roles/clouddeploy.viewer` をつける必要があり、それで全 Target を読み取りできるようになるので省略しています。
:::

releaser の処理は自動化され、ソースコードの変更をトリガーに起動する GitHub Workflow や Cloud Build が実態となるケースが多いので、それに対応する Service Account にこれらの権限を付与することになるでしょう。

Terraform で権限を設定すると次のようになります。

```tf
resource "google_service_account" "hello-app-releaser" {
  project    = google_project.pipeline.project_id
  account_id = "hello-app-releaser"
}

resource "google_artifact_registry_repository_iam_member" "hello-app-deployer" {
  project    = google_artifact_registry_repository.hello-app.project
  location   = google_artifact_registry_repository.hello-app.location
  repository = google_artifact_registry_repository.hello-app.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.hello-app-releaser.email}"
}

resource "google_storage_bucket_iam_member" "objectCreator" {
  bucket = google_storage_bucket.storage.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.hello-app-releaser.email}"
}

resource "google_storage_bucket_iam_member" "legacyBucketReader" {
  bucket = google_storage_bucket.storage.name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${google_service_account.hello-app-releaser.email}"
}

resource "google_service_account_iam_member" "serviceAccountUser" {
  for_each = ["dev", "stg", "prd"]

  service_account_id = google_service_account.hello-app-target[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.hello-app-releaser.email}"
}

resource "google_project_iam_custom_role" "clouddeployReleaseCreator" {
  project     = google_project.pipeline.project_id
  role_id     = "clouddeployReleaseCreator"
  title       = "Cloud Deploy Release Creator"
  permissions = ["clouddeploy.releases.create"]
}

data "google_iam_policy" "hello-app-pipeline-policy" {
  binding {
    role    = google_project_iam_custom_role.clouddeployReleaseCreator.id
    members = ["serviceAccount:${google_service_account.hello-app-releaser.email}"]
  }

  binding {
    role    = "roles/clouddeploy.releaser"
    members = ["serviceAccount:${google_service_account.hello-app-releaser.email}"]
    condition {
      title      = "Rollout to hello-app-dev"
      expression = "api.getAttribute(\"clouddeploy.googleapis.com/rolloutTarget\", \"\") == \"${google_clouddeploy_target.hello-app-target["dev"].name}\""
    }
  }

  // ...
}

resource "google_clouddeploy_delivery_pipeline_iam_policy" "policy" {
  project     = google_clouddeploy_delivery_pipeline.hello-app-pipeline.project
  location    = google_clouddeploy_delivery_pipeline.hello-app-pipeline.location
  name        = google_clouddeploy_delivery_pipeline.hello-app-pipeline.name
  policy_data = data.google_iam_policy.hello-app-pipeline-policy.policy_data
}

resource "google_project_iam_member" "hello-app-deployer_clouddeploy_viewer" {
  project = google_project.pipeline.project_id
  role    = "roles/clouddeploy.viewer"
  member  = "serviceAccount:${google_service_account.hello-app-releaser.email}"
}
```

:::details releaser の権限設定の補足
Terraform を見ると releaser に対する権限設定が複雑なことがわかります。これは、releaser が stg や prd にデプロイできないようにするために必要な設定です。Delivery Pipeline に Release を作成するための role として `roles/clouddeploy.releaser` がありますが、これには Rollout を作成する permission も含まれているため、Delivery Pipeline に対して条件なしで付与するとすべての Target へのデプロイができるようになってしまいます。そのため、Release を作成するためだけの custom role を作成しています。また、`roles/clouddeploy.releaser` は dev 環境に対してのみ有効化されるような条件を設定しています。
:::

### Cloud Build の Service Account

Delivery Pipeline から起動される Cloud Build にアタッチされる Service Account は、その Cloud Build がどの Target に関するものかで決まります。例えば dev Target に関する Cloud Build の Service Account を設定する Terraform は次のようになります。

```tf
resource "google_service_account" "hello-app-target-dev" {
  project    = google_project.pipeline.project_id
  account_id = "hello-app-target-dev"
}

resource "google_clouddeploy_target" "hello-app-target-dev" {
  project          = google_project.pipeline.project_id
  location         = "us-west1"
  name             = "hello-app-dev"
  execution_configs {
    service_account = google_service_account.hello-app-target-dev.email
  }
  run {
    location = "projects/hello-app-dev/locations/us-west1"
  }
}
```

一つの Target に対して Cloud Build は 2 回、Release 作成時と Rollout 作成時にそれぞれ起動されます。それぞれで実行する処理と必要な権限は次のようになります。

* `skaffold render` (Release 作成時に起動される)
  * `source.tgz` を Cloud Storage からダウンロード (Cloud Storage bucket への `roles/storage.objectViewer`)
  * `manifest.json` を Cloud Storage へアップロード (Cloud Storage bucket への `roles/storage.objectCreator`)
* `skaffold apply` (Rollout 作成時に起動される)
  * `manifest.json` を Cloud Storage からダウンロード (Cloud Storage bucket への `roles/storage.objectViewer`)
  * Cloud Run service をデプロイ (Cloud Run service への `roles/run.developer`、Cloud Run service の Service Account への `roles/iam.serviceAccountUser`)

また、Cloud Build を実行する基本的な role として `roles/logging.logWriter` が必要です。

Terraform で dev Target に関する Cloud Build の Service Account に必要な権限を設定すると次のようになります。(stg, prd も同様)

```tf
resource "google_service_account" "hello-app-target-dev" {
  project    = google_project.pipeline.project_id
  account_id = "hello-app-target-dev"
}

resource "google_project_iam_member" "logWriter" {
  project = google_project.pipeline.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.hello-app-target-dev.email}"
}

resource "google_storage_bucket_iam_member" "objectViewer" {
  bucket = google_storage_bucket.storage.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.hello-app-target-dev.email}"
}

resource "google_storage_bucket_iam_member" "objectCreator" {
  bucket = google_storage_bucket.storage.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.hello-app-target-dev.email}"
}

resource "google_service_account_iam_member" "serviceAccountUser" {
  service_account_id = google_service_account.hello-app-dev.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.hello-app-target-dev.email}"
}

resource "google_cloud_run_v2_service_iam_member" "hello-app-target_run_developer" {
  project  = google_cloud_run_v2_service.hello-app-dev.project
  location = google_cloud_run_v2_service.hello-app-dev.location
  name     = google_cloud_run_v2_service.hello-app-dev.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.hello-app-target-dev.email}"
}
```

:::details Cloud Build の Service Account の権限についての補足
Cloud Deploy のデフォルトの設定では `source.tgz` を格納する Cloud Storage bucket と `manifest.json` を格納する Cloud Storage bucket は別の bucket を使うようになっています。そのため、権限設定も 2 つのバケットに対して必要になります。実用上同じ bucket で問題ない場合は同じにしておくのがおすすめです。
:::

### stg promoter と prd promoter

stg promoter と prd promoter は releaser のサブセットと捉えることができます。stg promoter は次の処理を行います (prd promoter も同様)。

* `gcloud deploy releases promote`
  * stg に対する Rollout の作成 (Delivery Pipeline への条件付き `roles/clouddeploy.releaser`)
    * stg Target に対して `skaffold apply` を実行するための Cloud Build の起動 (stg Target に設定された Service Account への `roles/iam.serviceAccountUser`)
  * 非同期処理 ([Operations](https://cloud.google.com/deploy/docs/api/reference/rest/v1/projects.locations.operations)) の取得 (pipeline プロジェクトへの `roles/clouddeploy.viewer`)

promoter は releaser と違って SRE などの人となることも多いです。もしくは人かなんらかイベントがトリガーする自動化システムになるでしょう。

stg promoter を Service Account として実装する場合の権限設定 Terraform は次のようになります (prd promoter も同様)。

```tf
resource "google_service_account" "hello-app-stg-promoter" {
  project    = google_project.pipeline.project_id
  account_id = "hello-app-stg-promoter"
}

resource "google_service_account_iam_member" "serviceAccountUser" {
  service_account_id = google_service_account.hello-app-target["stg"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.hello-app-stg-promoter.email}"
}

data "google_iam_policy" "hello-app-policy" {
  // ...

  binding {
    role    = "roles/clouddeploy.releaser"
    members = ["serviceAccount:${google_service_account.hello-app-stg-promoter.email}"]
    condition {
      title      = "Rollout to hello-app-stg"
      expression = "api.getAttribute(\"clouddeploy.googleapis.com/rolloutTarget\", \"\") == \"${google_clouddeploy_target.hello-app-stg.name}\""
    }
  }

  // ...
}

resource "google_clouddeploy_delivery_pipeline_iam_policy" "policy" {
  project     = google_clouddeploy_delivery_pipeline.hello-app.project
  location    = google_clouddeploy_delivery_pipeline.hello-app.location
  name        = google_clouddeploy_delivery_pipeline.hello-app.name
  policy_data = data.google_iam_policy.hello-app-policy.policy_data
}

resource "google_project_iam_member" "clouddeploy_viewer" {
  project = google_project.pipeline.project_id
  role    = "roles/clouddeploy.viewer"
  member  = "serviceAccount:${google_service_account.hello-app-stg-promoter.email}",
}
```

## Delivery Pipeline 構築

Cloud Deploy に関する公式ドキュメントや記事には [Delivery Pipeline を YAML で定義する](https://cloud.google.com/deploy/docs/config-files)ように書かれているものが多いですが、まったくその必要はありません。いつも通りの方法、例えば Terraform で管理しましょう。

Terraform の場合 [google_clouddeploy_delivery_pipeline](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/clouddeploy_delivery_pipeline) リソースを使って以下のように定義します。

```tf
resource "google_clouddeploy_delivery_pipeline" "hello-app-pipeline" {
  location = "us-west1"
  name     = "hello-app-pipeline"
  serial_pipeline {
    stages { target_id = google_clouddeploy_target.hello-app-dev.name }
    stages { target_id = google_clouddeploy_target.hello-app-stg.name }
    stages { target_id = google_clouddeploy_target.hello-app-prd.name }
  }
}
```

`location` は、デプロイ先の location とは無関係です。

多くのドキュメントやサンプルで、各ステージに `profiles` というものを設定していますが、これは不要です。むしろ、特に Cloud Run の場合、使わないようにしたほうがシンプルでわかりやすく構成できます。

## manifest.yaml

`manifest.yaml` は [Cloud Run service YAML](https://cloud.google.com/run/docs/reference/yaml/v1#service) のことです。普段 Cloud Run を使うだけであればこの YAML は必要ないのですが、Cloud Deploy を使う場合は必要になります。

現在 Cloud Run を使っているのであれば、この YAML はコンソールからも確認できますし、次のコマンドで確認することもできます。コピペして[リファレンス](https://cloud.google.com/run/docs/reference/yaml/v1#service)と見比べながら不必要なものを削除していくのがいいでしょう。

```shell
gcloud run services describe hello-app \
  --region us-central1 \
  --format yaml
```

`manifest.yaml` は Cloud Run service アプリに対して 1 つあればよく (dev、stg、prd それぞれ別のものを作る必要はない)、最小の `manifest.yaml` は次のようになります。

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: hello-app
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    spec:
      serviceAccountName: dummy # from-param: ${service_account_name}
      containers:
        - name: hello-app
          image: hello-app
          env:
            - name: MESSAGE
              value: dummy # from-param: ${message}
```

ここで、`# from-param: ${service_account_name}` のようなコメントがついているフィールドがありますが、**このコメントには意味があります**。この `# from-param:` によって設定されたパラメータは [deploy parameters](https://cloud.google.com/deploy/docs/parameters) と呼ばれます。deploy parameters は Target ごとに設定できるため、環境ごとに変化する値を使いたい場合は deploy parameters を利用します。

例えば上の YAML の場合、各環境に対して Cloud Deploy で次のような値に書き換えられて Cloud Run にデプロイされます。

* dev 環境
  * `serviceAccountName`: `dummy` → `hello-app@hello-app-dev.iam.gserviceaccount.com`
  * `env[0].value`: `dummy` → `Hello, dev!`
* stg 環境
  * `serviceAccountName`: `dummy` → `hello-app@hello-app-stg.iam.gserviceaccount.com`
  * `env[0].value`: `dummy` → `Hello, stg!`
* prd 環境
  * `serviceAccountName`: `dummy` → `hello-app@hello-app-prd.iam.gserviceaccount.com`
  * `env[0].value`: `dummy` → `Hello, prd!`

:::details manifest.yaml のレンダリングについての補足
本記事ではシンプルで学習コストが低く Terraform で管理しやすい deploy parameters を推していますが、`manifest.yaml` が複雑になってくると 1 つの `manifest.yaml` と deploy parameters だけではレンダリングが難しくなってくる場合があるかもしれません。その場合、Cloud Deploy では Helm、Kustomize、kpt が使えるので[それらレンダリングツールの利用](https://cloud.google.com/deploy/docs/using-skaffold/managing-manifests)を検討してください。
:::

## Target

Cloud Deploy の Target も Delivery Pipeline と同じく Terraform 等で構築しましょう。Terraform の場合は [google_clouddeploy_target](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/clouddeploy_target) リソースを使います。

```tf
resource "google_clouddeploy_target" "hello-app-dev" {
  location         = "us-west1
  name             = "hello-app-dev"

  execution_configs {
    usages           = ["RENDER", "DEPLOY"]
    service_account  = google_service_account.hello-app-target-dev.email
    artifact_storage = "gs://${google_storage_bucket.storage.name}/artifacts"
  }

  run {
    location = "projects/${each.value}/locations/${var.region}"
  }

  deploy_parameters = {
    message              = "Hello, dev"
    service_account_name = google_service_account.hello-app-dev.email
  }
}
```

`location` はデプロイ先の Cloud Run ではなく、**Delivery Pipeline** と同じ location にしておく必要があります。

`manifest.yaml` で説明した deploy parameters はここで設定します。

## skaffold.yaml

最後は `skaffold.yaml` です。これまでコンテナイメージのビルド・プッシュを `skaffold build`、`manifest.yaml` のレンダリングを `skaffold render` で行っていると説明しましたが、それらのコマンドの設定を `skaffold.yaml` に記述します。具体的には次の 4 点を設定します。

* `skaffold build`
  * コンテナイメージタグの命名方法
  * コンテナイメージ名
  * コンテナイメージのビルド設定
* `skaffold render`
  * `manifest.yaml` のパス
* `skaffold apply`
  * 特になし (おまじないのみ)

これらを設定した `skaffold.yaml` は次のようになります。

```yaml
apiVersion: skaffold/v3
kind: Config
metadata:
  name: hello-app
build:
  tagPolicy:
    envTemplate:
      template: "{{ .APP_VERSION }}"
  artifacts:
    - image: hello-app
      context: ../../app
      docker:
        buildArgs:
          app_version: "{{ .APP_VERSION }}"
        dockerfile: ../../app/Dockerfile
  local:
    useBuildkit: true
    push: true
deploy:
  cloudrun: {}
manifests:
  rawYaml:
    - manifest.yaml
```

それぞれの詳しい説明は [skaffold.yaml のリファレンス](https://skaffold.dev/docs/references/yaml/)を参照してください。最低限必要なものは以下で簡単に説明します。

* `build.tagPolicy`: コンテナイメージのタグの命名方法を設定します。上のサンプルは環境変数で設定する `envTemplate` を利用していて `skaffold build` 時に `APP_VERSION` 環境変数に設定した値がタグになります。他には Git から自動でタグを設定する `gitCommit` などが存在します。詳しくは[ドキュメント](https://skaffold.dev/docs/taggers/)を参照してください。
* `build.artifacts[].image`: コンテナイメージの名前です。`manifest.yaml` の中でこの名前に一致するイメージが実際にビルドしたコンテナイメージに置換されます。
* `build.artifacts[].context`: `docker build` を実行するときの context です。
* `build.artifacts[].docker`: `docker build` の設定です。
* `manifests.rawYaml`: `manifest.yaml` のパスを指定します。`manifest.yaml` は `gcloud deploy releases create` の `--source` オプションで指定したパスに含める必要があり、`--source` オプションで指定したパスからの相対パスになります。

## ディレクトリ構成

`skaffold.yaml` と `manifest.yaml` はそれらだけで同じディレクトリに置いておくと便利です。そうすると、そのディレクトリに入って `skaffold build` や `gcloud deploy releases create` を実行すれば考えることを減らしつついろいろ上手く動きます。

```shell
.
├── README.md
├── app
│   ├── Dockerfile
│   ├── go.mod
│   ├── go.sum
│   └── main.go
├── deploy
│   ├── manifest.yaml
│   └── skaffold.yaml
└── terraform
    ├── pipeline.tf
    ├── service.tf
    ├── variables.tf
    └── versions.tf
```

# おわりに

概要を調べても何なのかよく分からず、中身もなかなか複雑な Cloud Deploy ですが、本記事の内容を理解すれば問題なく構築・運用できると思います。理解して使えばとても便利なサービスなのでガンガン使っていきましょう 🚀✨

TODO:

* [x] hello-app.yaml から manifest.yaml に変える
* [x] deployer を releaser に書き換え
* [ ] カナリアデプロイ
* [ ] デプロイフック