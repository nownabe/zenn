---
title: "Cloud Run worker pools で GitHub Actions self-hosted runner"
emoji: "🦈"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [googlecloud, cloudrun, github, githubactions]
publication_name: knowledgework
published: true
---

Cloud Run worker pools が来ましたね！まだ preview ですが Cloud Run ファンとしてはとても期待している機能です。
本記事では Cloud Run worker pools で GitHub Actions の self-hosted runner として構築する手順を紹介します。

:::message alert
この記事は GitHub App の権限設定が雑なので実際に利用する場合は注意してください。
:::

## Cloud Run worker pools とは

[Cloud Run](https://cloud.google.com/run) に新しく追加された機能です。これまでは HTTP 等のリクエストを処理するための services とジョブを実行するための jobs がありました。Worker pools は 3 つ目の Cloud Run で[ドキュメント](https://cloud.google.com/run/docs/resource-model#workerpools)によると次のような特徴を持っています。

> No endpoint/URL

URL がつきません。

> No requirement for the deployed container to listen for requests at a port

Services ではリクエストを処理するためにポートを開いておく必要がありましたが、それが不要です。

> No automatic scaling

自動でスケールアウトしません。自動化することは可能で、[Kafka autoscaler](https://cloud.google.com/run/docs/configuring/workerpools/kafka-autoscaler) のガイドが公開されています。

Worker pools の用途として、例えば Pub/Sub の pull subscriber、Slack や Discord のボット、GitHub Actions の self-hosted runner での利用が考えられます。

なぜ worker pools がいいのかについてはこちらのスライドがとても参考になります。

https://speakerdeck.com/iselegant/deep-dive-cloud-run-worker-pools

## GitHub App の設定

では早速構築していきます。まずは GitHub App を設定します。Self-hosted runner の登録には personal access token (PAT) か GitHub App が必要になりますが、self-hosted runner が必要になる組織では GitHub App が適しているでしょう。本記事では user に GitHub App を作成し repository にインストールします。実際に運用する場合は organization や enterprise に設定するのがいいでしょう。

### GitHub App 作成

[Settings > Developer Settings > GitHub Apps > New GitHub App](https://github.com/settings/apps/new) で次のように設定して「Create GitHub App」をクリックします。

- GitHub App name: 適当に
- Homepage URL: 適当に
- Webhook: Active のチェックを外す
- Permissions: Repository permissions の Administration を `Read and write` にする

作成すると You must generate a private key というメッセージが出るので、クリックして秘密鍵を作成して PEM ファイルをダウンロードします。

![You must generate a private key](/images/articles/self-hosted-runner-on-cloud-run-worker-pools/generate-private-key.png)

今いるページの上部に `App ID` というものがあるのでそれをメモっておきます。

### GitHub App インストール

作成した GitHub App の左メニューの Install App をクリックして、インストールしたいリポジトリにインストールしてください。

インストール後のページの URL が次のような形式になっているので installation_id をメモっておきます。

```
https://github.com/settings/installations/{installation_id}
```

## Google Cloud 設定

デプロイ前に Google Cloud の設定をしておきます。

### プロジェクト設定

利用するプロジェクトを設定しておきます。

```shell
gcloud config set project YOUR-PROJECT-ID
```

### API 有効化

必要な API を有効化します。

```shell
gcloud services enable \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com
```

### GitHub App 秘密鍵の保存

ダウンロードした GitHub App の秘密鍵を Secret Manager に保存します。

```shell
gcloud secrets create github-app-private-key --data-file=private-key.pem
```

### Artifact Registry 作成

コンテナイメージを保存するリポジトリを作成します。

```shell
gcloud artifacts repositories create runner \
  --repository-format=docker \
  --location=asia-northeast1
```

### Service Account 作成

Cloud Run に設定する service account を作成して必要な権限を設定します。

```shell
gcloud iam service-accounts create actions-runner
gcloud secrets add-iam-policy-binding github-app-private-key \
  --member="serviceAccount:actions-runner@$(gcloud config get project).iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

## Worker Pools デプロイ

Worker Pools をデプロイします。`Dockerfile` や `entrypoint.sh` は必要最低限のものなのでよしなに修正してください。

### Dockerfile

Dockerfile はこんな感じです。

```dockerfile
FROM debian:bookworm

ARG RUNNER_VERSION="2.325.0"
ARG RUNNER_SHA256="5020da7139d85c776059f351e0de8fdec753affc9c558e892472d43ebeb518f4"

RUN apt-get update \
  && apt-get install -y \
  curl \
  perl \
  libkrb5-3 \
  zlib1g \
  liblttng-ust1 \
  libssl3 \
  libicu72 \
  jq \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 61000 runner \
  && useradd -g 61000 -u 61000 -l -m -s /bin/false runner

WORKDIR /home/runner

RUN curl -o actions-runner.tar.gz -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz \
  && echo "${RUNNER_SHA256}  actions-runner.tar.gz" | shasum -a 256 -c \
  && tar xzf actions-runner.tar.gz \
  && rm -f actions-runner.tar.gz \
  && chown -R runner:runner /home/runner

USER runner
COPY --chmod=0755 entrypoint.sh .

ENTRYPOINT ["./entrypoint.sh"]
```

### entrypoint.sh

詳しくは説明しませんが、このコンテナは次のような動きをするようにしています。

- 起動したら self-hosted runner の registration token を取得し、自らを self-hosted runner として登録する
- ジョブを待つ
- 1 つのジョブを処理すると終了する

終了したら Cloud Run が自動で再起動してくれます。こうすることでクリーンな Actions 実行環境を維持できます。

```shell
#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

echo "GITHUB_REPOSITORY=$GITHUB_REPOSITORY" >&2
echo "GITHUB_APP_ID=$GITHUB_APP_ID" >&2
echo "GITHUB_APP_INSTALLATION_ID=$GITHUB_APP_INSTALLATION_ID" >&2
echo "GITHUB_APP_PRIVATE_KEY_FILE=${GITHUB_APP_PRIVATE_KEY_FILE:-}" >&2
echo "GITHUB_APP_PRIVATE_KEY_SECRET_ID=${GITHUB_APP_PRIVATE_KEY_SECRET_ID:-}" >&2
echo "GITHUB_APP_PRIVATE_KEY_SECRET_VERSION=${GITHUB_APP_PRIVATE_KEY_SECRET_VERSION:-latest}" >&2

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

get_metadata() {
  curl -s \
    -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/$1"
}

print_private_key() {
  if [[ -n "${GITHUB_APP_PRIVATE_KEY_FILE:-}" ]]; then
    cat "$GITHUB_APP_PRIVATE_KEY_FILE"
    return
  fi

  local project_id access_token url

  project_id="$(get_metadata "project/project-id")"
  access_token="$(get_metadata "instance/service-accounts/default/token" | jq -r '.access_token')"

  url="https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${GITHUB_APP_PRIVATE_KEY_SECRET_ID}/versions/${GITHUB_APP_PRIVATE_KEY_SECRET_VERSION}:access"
  curl -sf -H "Authorization: Bearer ${access_token}" "$url" | jq -r '.payload.data' | tr '_-' '/+' | base64 -d
}

get_registration_token() {
  local private_key now iat exp header payload unsigned signature jwt access_token

  private_key=$(mktemp)
  print_private_key >"$private_key"
  trap 'rm -f "$private_key"' RETURN

  now=$(date +%s)
  iat=$((now))
  exp=$((now + 60))

  header='{"alg":"RS256","typ":"JWT"}'
  payload=$(printf '{"iat":%d,"exp":%d,"iss":%d}' "$iat" "$exp" "$GITHUB_APP_ID")
  unsigned="$(printf %s "$header" | b64url).$(printf %s "$payload" | b64url)"
  signature="$(printf %s "$unsigned" | openssl dgst -sha256 -sign "$private_key" -binary | b64url)"
  jwt="$unsigned.$signature"

  access_token=$(curl -fsSL -X POST \
    -H "Authorization: Bearer $jwt" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/app/installations/${GITHUB_APP_INSTALLATION_ID}/access_tokens" |
    jq -r .token)

  curl -fsSL -X POST \
    -H "Authorization: Bearer $access_token" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/actions/runners/registration-token" |
    jq -r .token
}

token=$(get_registration_token)

./config.sh \
  --unattended \
  --url "https://github.com/${GITHUB_REPOSITORY}" \
  --token "$token" \
  --name "${CLOUD_RUN_REVISION}-$(get_metadata instance/id | head -c32)" \
  --labels "cloudrun,linux" \
  --work _work \
  --replace \
  --disableupdate \
  --ephemeral

unset GITHUB_APP_ID
unset GITHUB_APP_INSTALLATION_ID
unset GITHUB_APP_PRIVATE_KEY_FILE
unset GITHUB_REPOSITORY

exec ./run.sh
```

:::message
現在 preview の worker pools はまだ Secret Manager のマウントをサポートしていないので、`entrypoing.sh` で Secret Manager API から取得しています。
:::

### イメージビルド&プッシュ

コンテナイメージをローカルでビルドして Artifact Registry にプッシュします。

```shell
docker build -t "asia-northeast1-docker.pkg.dev/$(gcloud config get project)/runner/actions-runner:latest" .
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
docker push "asia-northeast1-docker.pkg.dev/$(gcloud config get project)/runner/actions-runner:latest"
```

### Worker Pools デプロイ

Worker pools をデプロイします。現在は preview でウェブコンソールでのデプロイはできません。`gcloud beta run worker-pools` で操作できます。次のコマンドでデプロイできます。各環境変数は適切な値を設定してください。

```shell
gcloud beta run worker-pools deploy actions-runner \
  --service-account="actions-runner@$(gcloud config get project).iam.gserviceaccount.com" \
  --image="asia-northeast1-docker.pkg.dev/$(gcloud config get project)/runner/actions-runner:latest" \
  --region=asia-northeast1 \
  --set-env-vars="GITHUB_APP_ID=$GITHUB_APP_ID" \
  --set-env-vars="GITHUB_APP_INSTALLATION_ID=$GITHUB_APP_INSTALLATION_ID" \
  --set-env-vars="GITHUB_REPOSITORY=$GITHUB_REPOSITORY" \
  --set-env-vars="GITHUB_APP_PRIVATE_KEY_SECRET_ID=github-app-private-key" \
  --set-env-vars="GITHUB_APP_PRIVATE_KEY_SECRET_VERSION=latest"
```

### GitHub の確認

うまくデプロイできていれば GitHub Actions の self-hosted runner として登録されています。リポジトリの Settings > Actions > Runners で登録されていることを確認しましょう。

![registered runner](/images/articles/self-hosted-runner-on-cloud-run-worker-pools/registered-runner.png)

## GitHub Actions 実行

次のファイルを `.github/workflows/test.yaml` に commit して workflow が動くことを確認します。

```yaml
name: Self-hosted Runner Test

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: [cloudrun,linux]
    timeout-minutes: 10

    steps:
      - name: Show runner context
        run: |
          echo "RUNNER_NAME=$RUNNER_NAME"
          echo "RUNNER_OS=$RUNNER_OS"
          echo "RUNNER_ARCH=$RUNNER_ARCH"
```

## おわりに

本記事では Cloud Run の新機能である worker pools で GitHub Actions の self-hosted runner を構築してみました。まだ preview で足りないものはありますが、Worker pools のおかげで Cloud Run の大きな穴が埋まりました。ますます便利に使えそうでとても楽しみです 🥰
