---
title: "gRPC-Web を Cloud Run のサイドカー Envoy でやる"
emoji: "🦮"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [gcp, cloudrun, grpc, grpcweb, envoy]
publication_name: google_cloud_jp
published: true
---

## はじめに

Cloud Run の[マルチコンテナ](https://cloud.google.com/run/docs/deploying?hl=en#sidecars)がパブリック プレビューでリリースされました。本記事ではマルチコンテナを使って、1 つの Cloud Run サービスでサイドカー Envoy を使った gRPC-Web サービスを構築します。

本記事は前半が Cloud Run にサービスをデプロイして Web から呼び出してみるパート、後半が説明パートになっています。説明だけ読みたい場合は前半をスキップしてください。

マルチコンテナについては以下の記事もぜひ参考にしてください。

https://zenn.dev/google_cloud_jp/articles/cloud-run-multi-container-features

https://zenn.dev/google_cloud_jp/articles/20230516-cloud-run-otel

## やってみる

### 環境など

新しいプロジェクトと [Cloud Shell](https://cloud.google.com/shell?hl=ja) での操作を想定しています。ローカルで操作する場合は必要なツール等を適宜インストールしてください。

サンプルのコードはこちらを使います。

https://github.com/nownabe/google-cloud-examples/tree/main/grpc-web-envoy

### 事前準備

こちらをクリックしてください。Cloud Shell が開いてリポジトリがクローンされます。エディタは使わないので閉じてしまってください。

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fnownabe%2Fgoogle-cloud-examples&cloudshell_git_branch=main&cloudshell_workspace=grpc-web-envoy)

プロジェクトを設定します。

```shell
gcloud config set project <YOUR-PROJECT-ID>
```

使用するサービスの API を有効化します。

```shell
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com
```

Docker イメージ用に Artifact Registry のリポジトリを作成します。

```shell
gcloud artifacts repositories create \
  grpc-web \
  --location us-central1 \
  --repository-format DOCKER
```

Cloud Run サービス用の Service Account を作成します。

```shell
gcloud iam service-accounts create grpc-web
```

Cloud Build を使ってデプロイするので Cloud Build の Service Account に `roles/run.admin` ロールを付与します。

```shell
gcloud projects add-iam-policy-binding \
  "$(gcloud config get project)" \
  --member "serviceAccount:$(gcloud projects describe $(gcloud config get project) --format 'value(projectNumber)')@cloudbuild.gserviceaccount.com" \
  --role "roles/run.admin"
```

Cloud Build が Cloud Run サービスに Service Account を設定できるように `roles/iam.serviceAccountUser` ロールを付与します。

```shell
gcloud iam service-accounts add-iam-policy-binding \
  "grpc-web@$(gcloud config get project).iam.gserviceaccount.com" \
  --member "serviceAccount:$(gcloud projects describe $(gcloud config get project) --format 'value(projectNumber)')@cloudbuild.gserviceaccount.com" \
  --role "roles/iam.serviceAccountUser"
```

### デプロイ

Cloud Build を使って以下のことを行います。

* gRPC サービス (Go アプリ) の Docker イメージのビルド・プッシュ
* Envoy の Docker イメージのビルド・プッシュ
* Cloud Run のサービス定義ファイルの描画
* Cloud Run サービスのデプロイ

`cloudbuilld.yaml` が用意されているので実行するのはコマンドひとつです。

```shell
gcloud builds submit .
```

最後に、認証なしでアクセスできるように設定します。

```shell
gcloud run services add-iam-policy-binding \
  grpc-web \
  --region us-central1 \
  --member "allUsers" \
  --role "roles/run.invoker"
```

### Web から呼び出す

簡単なクライアント アプリを用意したので、そちらから gRPC-Web でデプロイしたサービスを使ってみます。

`web` ディレクトリに移動して `npm install` します。

```shell
cd web
npm install
```

クライアント アプリを起動します。

```shell
GRPC_HOST="$(gcloud run services describe grpc-web --region us-central1 --format 'value(status.url)')" \
  PORT=8080 \
  npm start
```

Cloud Shell の右上の **Web Preview** メニューから **Preview on port 8080** をクリックします。

![web preview](/images/articles/grpc-web-with-envoy-using-cloud-run-sidecar/web-preview.png)

こんな感じの画面が表示されます。

![client app overview](/images/articles/grpc-web-with-envoy-using-cloud-run-sidecar/client-app-overview.png)

ListBooks, CreateBook, GetBook, DeleteBook, UpdateBook が実装されているメソッドで、パラメータを入力して Call ボタンをクリックするとリクエストが飛ぶようになっています。はじめは何も Book が登録されていないので適当なパラメータを入力して CreateBook しましょう。うまくいくと Response にレスポンスが表示されます。

![createBook](/images/articles/grpc-web-with-envoy-using-cloud-run-sidecar/create-book.png)

その他のメソッドも同様に実行できます。

## 説明

サンプルアプリがどう実装されているかという観点で説明します。

### gRPC 定義

gRPC の定義は [Envoy のテスト](https://github.com/envoyproxy/envoy/blob/c2ae2211196a48b12d2e36d00c6c2889ae2f434a/test/proto/bookstore.proto)から Book リソースに関するものを抜き出して使っています。よくサンプルで使われる普通の gRPC 定義です。全文は[こちら](https://github.com/nownabe/google-cloud-examples/blob/main/grpc-web-envoy/proto/bookstore/bookstore_service.proto)。

```protobuf:bookstore.proto
import "google/protobuf/empty.proto";

service BookstoreService {
  rpc ListBooks(ListBooksRequest) returns (stream Book) {}
  rpc CreateBook(CreateBookRequest) returns (Book) {}
  rpc GetBook(GetBookRequest) returns (Book) {}
  rpc DeleteBook(DeleteBookRequest) returns (google.protobuf.Empty) {}
  rpc UpdateBook(UpdateBookRequest) returns (Book) {}
}

message Book {
  int64 id = 1;
  string title = 2;
}

message ListBooksRequest {
  int64 shelf = 1;
}
```

### gRPC サービスの実装

バックエンドの gRPC サービスは Go で実装しています。作成された Book リソースはメモリに保存されているのでコンテナが再起動するとデータは消えます。全文は[こちら](https://github.com/nownabe/google-cloud-examples/blob/main/grpc-web-envoy/go/main.go)。

Go の実装も Hello World 的なコードですが、[Cloud Run 上で gRPC でのヘルスチェック](https://cloud.google.com/run/docs/configuring/healthchecks#grpc-liveness-probes)を行うために [Health Checking Protocol](https://github.com/grpc/grpc/blob/master/doc/health-checking.md) を実装する必要があるためその実装を追加しています。

```go:main.go
import (
  "google.golang.org/grpc/health"
  healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

func main() {
  // ...

  s := grpc.NewServer()

  svc := &bookstoreService{
    shelves: make(map[int64]*shelf),
  }
  pb.RegisterBookstoreServiceServer(s, svc)

  healthSvc := health.NewServer()
  healthpb.RegisterHealthServer(s, healthSvc)
  healthSvc.SetServingStatus("bookstore.BookstoreService", healthpb.HealthCheckResponse_SERVING)

  reflection.Register(s)

  // ...
}
```

### Envoy の設定

Envoy の設定は概ね gRPC-Web の [Hello World](https://github.com/grpc/grpc-web/tree/master/net/grpc/gateway/examples/helloworld) から持ってきています。その中で特に気になった部分のみ変更しています。1 点目の変更は Deprecation の Warning が出ていた CORS の設定です。CORS 設定の内容は Hello World から変えていません。2 点目の変更は cluster の設定です。サイドカーに DNS の解決は必要ないので `type: STATIC` にしています。

```yaml:envoy.yaml
static_resources:
  listeners:
    - name: listener_0
      address:
        socket_address: {address: 0.0.0.0, port_value: 8080}
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                codec_type: AUTO
                stat_prefix: ingress_http
                route_config:
                  name: local_route
                  virtual_hosts:
                    - name: local_service
                      domains: ["*"]
                      routes:
                        - match: {prefix: "/"}
                          route:
                            cluster: grpc
                            timeout: 0s
                            max_stream_duration:
                              grpc_timeout_header_max: 0s
                      typed_per_filter_config:
                        envoy.filters.http.cors:
                          "@type": type.googleapis.com/envoy.extensions.filters.http.cors.v3.CorsPolicy
                          allow_origin_string_match:
                            - prefix: "*"
                          allow_methods: GET, PUT, DELETE, POST, OPTIONS
                          allow_headers: keep-alive,user-agent,cache-control,content-type,content-transfer-encoding,custom-header-1,x-accept-content-transfer-encoding,x-accept-response-streaming,x-user-agent,x-grpc-web,grpc-timeout
                          max_age: "1728000"
                          expose_headers: custom-header-1,grpc-status,grpc-message
                http_filters:
                  - name: envoy.filters.http.grpc_web
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.grpc_web.v3.GrpcWeb
                  - name: envoy.filters.http.cors
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.cors.v3.Cors
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
  clusters:
    - name: grpc
      type: STATIC
      lb_policy: ROUND_ROBIN
      typed_extension_protocol_options:
        envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
          "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
          explicit_http_config:
            http2_protocol_options: {}
      load_assignment:
        cluster_name: grpc
        endpoints:
          - lb_endpoints:
            - endpoint:
                address:
                  socket_address: {address: 127.0.0.1, port_value: 50051}
```

### クライアント アプリの実装

まずはクライアント用のコード生成についてです。ストリームなメソッド (ListBooks) があるので [Wire Format Mode](https://github.com/grpc/grpc-web#wire-format-mode) には `grpc-web-text` を選択しています。[Import Style](https://github.com/grpc/grpc-web#import-style) には `commonjs` を選択しています。

Buf のコード生成の設定はこんな感じです。全文は[こちら](https://github.com/nownabe/google-cloud-examples/blob/main/grpc-web-envoy/buf.gen.yaml)。

```yaml:buf.gen.yaml
version: v1
plugins:
  - plugin: buf.build/grpc/web
    out: web/src/gen
    opt:
      - mode=grpcwebtext
      - import_style=commonjs

  - plugin: buf.build/protocolbuffers/js
    out: web/src/gen
    opt:
      - import_style=commonjs
```

クライアントは [index.html](https://github.com/nownabe/google-cloud-examples/blob/main/grpc-web-envoy/web/src/index.html) と [client.js](https://github.com/nownabe/google-cloud-examples/blob/main/grpc-web-envoy/web/src/client.js) の 2 ファイルで実装しています。Vanilla な JavaScript で例えば CreateBook メソッドの Call ボタンをクリックしたときのコールバックは次のようになっています。

```js:client.js
import {
  Book,
  CreateBookRequest,
} from "./gen/bookstore/bookstore_service_pb";
import { BookstoreServiceClient } from "./gen/bookstore/bookstore_service_grpc_web_pb";

const client = new BookstoreServiceClient(grpcHost);

function createBook(event) {
  event.preventDefault();
  const data = new FormData(event.target);

  const book = new Book();
  book.setId(data.get("book.id"));
  book.setTitle(data.get("book.title"));

  const req = new CreateBookRequest();
  req.setShelf(data.get("shelf"));
  req.setBook(book)

  client.createBook(req, {}, renderResponseCallback("create-book-response"));
}
```

ListBooks はストリームで結果が返ってくるため、他とは実装が異なり次のようになっています。

```js:client.js
function listBooks(event) {
  event.preventDefault();
  const data = new FormData(event.target);

  const req = new ListBooksRequest();
  req.setShelf(data.get("shelf"));

  const books = [];
  const stream = client.listBooks(req);
  stream.on("data", (response) => {
    books.push(response.toObject());
  });
  stream.on("end", (end) => {
    document.getElementById("list-books-response").innerText = JSON.stringify(books, null, 2);
  })
}
```

### Cloud Run へのデプロイ

各 Docker イメージのビルドと Cloud Run へのデプロイは [`cloudbuild.yaml`](https://github.com/nownabe/google-cloud-examples/blob/main/grpc-web-envoy/cloudbuild.yaml) にまとめています。この中で重要なのは Cloud Run サービスの定義ファイルとデプロイのコマンドです。

現時点でマルチコンテナなサービスをデプロイするためには YAML として Cloud Run のサービスを定義して `gcloud run services replace` というコマンドを使う必要があります。もちろん直接 API でデプロイ可能ですが Web のコンソールからはデプロイできません。

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  annotations:
     run.googleapis.com/launch-stage: BETA
  name: SERVICE_NAME
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/execution-environment: gen1 #or gen2
    spec:
      containers:
      - image: INGRESS_IMAGE
        ports:
          - containerPort: CONTAINER_PORT
      - image: SIDECAR_IMAGE
```

YAML は Kubernetes Resource の形式でリソースの種類は [Knative の Service](https://knative.dev/docs/serving/reference/serving-api/#serving.knative.dev/v1.Service) です。ただし、Cloud Run 独自のアノテーションや制限があるため、YAML を書くときは[リファレンス](https://cloud.google.com/run/docs/reference/yaml/v1)や[スキーマ](https://run.googleapis.com/$discovery/rest?version=v1)を参照しながら書くとスムーズです。

本記事のデプロイに使った YAML はこちらです。

```yaml:service.template.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: grpc-web
  labels:
    cloud.googleapis.com/location: us-central1
  annotations:
    run.googleapis.com/launch-stage: BETA
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "1"
        run.googleapis.com/execution-environment: gen1
    spec:
      serviceAccountName: ${SERVICE_ACCOUNT}
      containers:
        - image: ${ENVOY_IMAGE}
          name: envoy
          ports:
            - containerPort: 8080
          resources:
            limits:
              cpu: ".08"
              memory: 128Mi
        - image: ${GRPC_IMAGE}
          name: grpc
          resources:
            limits:
              cpu: ".08"
              memory: 128Mi
          livenessProbe:
            grpc:
              port: 50051
              service: bookstore.BookstoreService
```

スケーリングに関する設定は、今回のサンプルアプリがコンテナ内のメモリにしかデータを保持できないためインスタンス数を 1 に固定しています。

マルチコンテナでは `containerPort` が全てのコンテナを通して 1 つしか設定できません。`containerPort` を設定したコンテナは Ingress コンテナと呼ばれます。Ingress コンテナ以外のコンテナはサイドカー コンテナと呼ばれます。

`containerPort` が設定されていなくても、コンテナのポートがリッスンされていればヘルスチェックは可能です。`grpc` コンテナでは `50051` ポートに gRPC ヘルスチェックを設定しています。また、例えば Envoy に [admin interface](https://www.envoyproxy.io/docs/envoy/latest/operations/admin) の設定をいれて `containerPort` とは別に admin interface のポートにヘルスチェックをするということもできます。

```yaml
- name: envoy
  image: ${ENVOY_IMAGE}
  ports:
  - containerPort: 8080
  startupProbe:
    httpGet:
      port: 9901
      path: /stats
```

このような YAML を作成し `gcloud run services replace service.yaml` を実行することでマルチコンテナのサービスをデプロイします。

## おわりに

gRPC-Web のバックエンドとなる Go アプリと Envoy プロキシを Cloud Run のマルチコンテナで 1 つのサービスとしてデプロイしてみました。マルチコンテナでますます Cloud Run が便利に使えるようになりそうです。
