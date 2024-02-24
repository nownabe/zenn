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

以下の内容は上記のような基本をおさえれば応用が効くので本記事では説明しません。

* Automation
* デプロイフック
* カナリアデプロイなど高度なデプロイパイプライン
* 監視

本記事の想定読者は Cloud Run は使っているけど Cloud Deploy は使っていないという人です。Kubernetes の知識がなくても理解できるようにしていますが、次のような知識を前提としています。

* Google Cloud
  * gcloud CLI
  * プロジェクト
  * IAM
  * Cloud Run
  * Cloud Build
  * Artifact Registry
* Docker、コンテナ
* Terraform

## Disclaimer

本記事ではおすすめの方法などを紹介していますが、筆者が実際に構築・運用をする中で考えたおすすめやベストプラクティスであって、Google Cloud 公式のものではありません。

また、わかりやすさのため説明が厳密ではない部分があります。

# Cloud Deploy とは

## 概要

dev → stg → prod のような、異なる環境に対する一連のデプロイパイプラインを管理・自動化するためのフルマネージドサービスです。Cloud Deploy ではそのようなパイプラインを Delivery Pipeline と呼びます。

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

## Delivery Pipeline を構築する

ここから、実際に Delivery Pipeline を構築する流れで Cloud Deploy の仕組みやおすすめの構築方法を説明していきます。`hello-app` という Cloud Run service アプリのデプロイパイプライン構築を考えます。

### プロジェクト構成

### 権限設計

## Delivery Pipeline を運用する


## Cloud Deploy のリソース

## Skaffold とは


# Cloud Run のデプロイを実装する

## 準備

`gcloud components update skaffold`

## 実践的なアーキテクチャ


## Cloud Run service の箱を用意する

## skaffold.yaml を作成する

* Docker イメージ名の設定
* Docker イメージタグの命名方法の設定
* Cloud Run Service 定義 YAML の場所の指定