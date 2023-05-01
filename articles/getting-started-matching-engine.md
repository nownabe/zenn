---
title: "Vertex AI Matching Engine: フルマネージドで利用する Google のベクトル検索"
emoji: "🤝"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [gcp,vertexai,matchingengine,ai]
publication_name: google_cloud_jp
published: false
---

## はじめに

本記事では [Vertex AI Matching Engine](https://cloud.google.com/vertex-ai/docs/matching-engine/overview?hl=ja) とは何かを簡単に説明して、使い始めるための手順を説明します。本記事の目的は、ベクトル検索を実現するために Matching Engine を使えるようになってもらうことです。

* 記事全体を理解するためにはある程度のクラウドやプログラミングの知識が必要です
  * 必要に応じて補足したり、リンクしたりしています
* Matching Engine の背景にある論文等の解説はしません
* 使い始めるための手順の中でいくつか選択肢があるとき、今後主流になりそうな選択肢の手順のみを説明します

とにかくまずは使ってみたいという方は、[Vertex AI Matching Engine を使ってみる](#vertex-ai-matching-engine-を使ってみる)まで読み飛ばすか、次のチュートリアルを実施してください。

https://github.com/googlecloudplatform/matching-engine-tutorial-for-image-search

## 実行環境

後半では実際に Matching Engine を構築して利用する手順を記載しています。実行環境として次の環境で動作確認しています。

* Python 3.11.3
* [gcloud](https://cloud.google.com/sdk/docs/install?hl=ja) 426.0.0

また、手順を実行するには Google Cloud のアカウントとプロジェクトが必要です。

https://cloud.google.com/docs/get-started?hl=ja

## ベクトル検索で何ができるの？

昨今ではテキスト、画像、ユーザー行動など様々なものを機械学習モデルによって意味のある多次元ベクトルとして表現[^1]できます (このようなベクトル表現を[エンベディング](https://cloud.google.com/blog/ja/topics/developers-practitioners/meet-ais-multitool-vector-embeddings?hl=ja)と呼びます)。例えば Open AI の [Embeddings API](https://platform.openai.com/docs/api-reference/embeddings) を使えば、様々なテキストに対して GPT-3 によるベクトル表現が得られます。そして、[最近傍探索](https://ja.wikipedia.org/wiki/%E6%9C%80%E8%BF%91%E5%82%8D%E6%8E%A2%E7%B4%A2)で入力ベクトルに対して類似度が高いベクトルを探索することで次の様なことが実現できます。

* レコメンデーション
* 広告ターゲティング
* テキスト検索
* 類似画像検索
* チャットボット・Q&A システムの実装
* プロンプト エンジニアリングへの組み込み

次の図は本の検索を単語のマッチングではなくエンベディングの最近傍探索を使って実現しています。

* Step 1: 目的の達成に必要なニューラル ネットワーク モデル ([Two-Tower モデル](https://cloud.google.com/vertex-ai/docs/matching-engine/train-embeddings-two-tower?hl=ja)) を学習
* Step 2: 学習したモデルを使ってデータベースに存在する本のエンベディングを生成
* Step 3: 実際に検索しています。検索クエリの文字列をエンベディングとして表現して、そのエンベディングに近い本を最近傍探索によって探索

このようにすることで、単純に単語のマッチングで検索するだけでは検索できないような意味的に近い本などを検索できます。

![Embedding](/images/articles/getting-started-matching-engine/ScaNN_tom_export.gif)

## Vertex AI Matching Engine とは

Vertex AI Matching Engine は[フルマネージドな近似最近傍探索 (ANN: Approximate Nearest Neighbor)](https://cloud.google.com/vertex-ai/docs/matching-engine/ann-service-overview?hl=ja) を提供するサービスです。

近似最近傍探索とは最近傍探索問題の近似的な答えを高速に求める方法です。最近傍探索は次元数とベクトル数に比例して計算量が増加するため、多数のデータがあると非常に時間がかかります。そこで、多くのアプリケーションではある程度の厳密さを犠牲にして高速に近似解を求める ANN が使われます。このように、最近傍探索問題では精度と速度のトレードオフがあります。

Matching Engine では [Google Research が開発した ANN 手法](https://ai.googleblog.com/2020/07/announcing-scann-efficient-vector.html) を利用して、高速で精度の高い ANN を実現します。[公式ドキュメント](https://cloud.google.com/vertex-ai/docs/matching-engine/ann-service-overview?hl=ja#why_does_ann_perform_approximate_matches_instead_of_exact_matches)には次のような記述があります。

> 再現率は、システムによって返される真の最近傍の割合を測定するために使用される指標です。Google 社内のチームによる実証的な統計によると、多くの実世界のアプリケーションにおいて、Vertex AI Matching Engine は 95～98% の再現率を達成し、10ms 以下で 90 パーセンタイルのレイテンシで結果を提供できることがわかっています（Google Cloud 社内調査、2021 年 5 月）。

その他、Matching Engine には次のような特徴があります。

* 数十億ベクトルにスケーリング可能
* 高いスループット、低レイテンシ
* 高い再現率
* 数千次元のベクトルをサポート
* オートスケーリング
* 検索結果のフィルタリング

## Vertex AI Matching Engine を使ってみる

### 使ってみる流れ

このような流れで使い方や概念を説明します。

1. Matching Engine におけるリソースの種類
2. 事前準備
3. Index の作成
4. IndexEndpoint の作成
5. Index のデプロイ
6. 検索クエリの実行
7. Index のストリーム更新

### Vertex AI Matching Engine のリソース

Matching Engine には 2 種類のリソースがあります。

* **[Indexes](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.indexes)**: ANN を実現するためのデータ構造でベクトル表現を保存するインデックスです。エンベディングのデータベースだと考えることもできます
* **[IndexEndpoints](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.indexEndpoints)**: ANN サービスを提供するエンドポイントです。構築した Index を IndexEndpoint にデプロイすることでクエリを実行できるようになります

これらに加えて [DeployedIndex](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.indexEndpoints#DeployedIndex) という概念があります。IndexEndpoint にデプロイされた Index を表す概念です。REST のリソースではないのですが、クエリ実行時に必要だったり、オートスケールなどをこの概念と紐付けて設定したりすることになります。

また、Index に登録されるひとつひとつのアイテムを [IndexDatapoint](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.indexes/upsertDatapoints#IndexDatapoint) と言います。IndexDatapoint には、その IndexDatapoint を示す一意な ID やその IndexDatapoint を表すエンベディング (float の配列) を持ちます。

### 事前準備

Matching Engine を使う前に必要な準備をします。

gcloud コマンドの準備をします。YOUR-PROJECT を自分のプロジェクト ID に差し替えてください。

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR-PROJECT
```

Vertex AI の機能を有効化します。

```bash
gcloud services enable aiplatform.googleapis.com
```

検索クエリを実行する [Service Account](https://cloud.google.com/iam/docs/service-account-overview?hl=ja) を作成して必要な権限を付与します。ここでは Matching Engine へのクエリ実行やストリーム更新ができるように [Vertex AI User (roles/aiplatform.user) ロール](https://cloud.google.com/vertex-ai/docs/general/access-control#predefined-roles) を付与します。

```bash
gcloud iam service-accounts create query-runner
gcloud projects add-iam-policy-binding \
  "$(gcloud config get project)" \
  --member "serviceAccount:query-runner@$(gcloud config get project).iam.gserviceaccount.com" \
  --role roles/aiplatform.user
```

Index 作成時に登録するエンベディングを格納する Cloud Storage バケットを作成します。

```bash
gcloud storage buckets create \
  "gs://$(gcloud config get project)-embeddings" \
  -l us-central1
```

必要な依存関係をインストールします。

```bash
pip install tensorflow==2.12.0
pip install google-cloud-storage==2.8.0
pip install google-cloud-aiplatform==1.24.1
```

### Index の作成

Index は次のような項目を設定して作成します。

* 初期登録データ
* 更新方法
* ベクトルの次元数
* ベクトル間の距離をどう計算するか
* シャードサイズ
* アルゴリズムに関する設定
* など

#### 初期登録データ

Index 作成時には初期データとなる IndexDatapoint 群が必要になります。これらは、[Cloud Storage](https://cloud.google.com/storage?hl=ja) にファイル群としてアップロードして、Index 作成時にそのルートディレクトリを指定します。ファイル群は次の[決まり](https://cloud.google.com/vertex-ai/docs/matching-engine/match-eng-setup/format-structure)に従って、指定したルートディレクトリに配置する必要があります。

* フォーマットは CSV、JSON、Avro のいずれかで、それぞれ `.csv`、`.json`、`.avro` の拡張子を持つ
* それぞれのファイルはルートディレクトリ直下にある

例えば `gs://my-embeddings/dog_image_embeddings` という Cloud Storage のパスをルートディレクトリとして指定したとき、それぞれのファイルは次のように配置します。

```
gs://my-embeddings/dog_image_embeddings
├── bulldog.json
├── cavalier_king_charles_spaniel.json
├── golden_retriever.json
└── shiba.json
```

それぞれのファイルは、例えば JSON であれば次のような形になります。1 行が 1 IndexDatapoint で、`id` は UTF-8 文字列でその IndexDatapoint を示す一意 ID です。`embedding` はその IndexDatapoint を表すベクトル表現で float の配列です。他のフォーマットについては[ドキュメント](https://cloud.google.com/vertex-ai/docs/matching-engine/match-eng-setup/format-structure#data-file-formats)を参照してください。

```json:shiba.json
{id: "ルビー", embedding: [0.05, 0.3, ..., 0.15]}
{id: "まめ", embedding: [0.1, 0.2, ..., 0.1]}
...
```

`id` と `embedding` に加えて、[名前空間によって検索結果をフィルタリング](https://cloud.google.com/vertex-ai/docs/matching-engine/filtering?hl=ja#json)したり、[多様性のために検索結果において同じタグを持つアイテムの数を絞ったり](https://github.com/googleapis/python-aiplatform/blob/b989dbbeb7dbb502a935e7dcf4eed3aff30fe0f6/google/cloud/aiplatform/matching_engine/_protos/match_service.proto#L45-L50)するための情報を与えることもできます。本記事では割愛します。

#### 更新方法

Index にはバッチ更新とストリーム更新の 2 種類があります。

* [バッチ更新](https://cloud.google.com/vertex-ai/docs/matching-engine/update-rebuild-index#update_index_content_with_batch_updates)
  * IndexDatapoint の追加・更新・削除をバッチで行う
  * 対象 IndexDatapoin は初期登録データと同じように Cloud Storage 上にファイルとしてアップロード
  * Index への更新が終わると自動で DeployedIndex にも反映
  * 更新が結果に反映されるまである程度時間がかかる
* [ストリーム更新](https://cloud.google.com/vertex-ai/docs/matching-engine/update-rebuild-index#update_an_index_using_streaming_updates)
  * IndexDatapoint の追加・更新・削除をリアルタイムに行う
  * 追加・更新・削除を直接 DeployedIndex のメモリに反映
  * 更新は数秒で結果に反映

本記事ではリアルタイムで更新が可能なストリーム更新の Index を扱います。

#### シャードサイズ

Index のシャードサイズです。`SMALL`、`MEDIUM`、`LARGE` から選択します。以下は比較表になります。

| シャードサイズ名 | シャードサイズ | 最小マシンタイプ |
|------------------|----------------|------------------|
| SMALL            | 2 GB           | e2-standard-2    |
| MEDIUM           | 20 GB          | e2-standard-16   |
| LARGE            | 50 GB          | e2-highmem-16    |

それぞれで利用可能なすべてのマシンタイプを確認するには [API リファレンス](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.indexEndpoints#deployedindex) を参照してください。

例えば 100 GB のデータサイズがあったとき、SMALL だと 50 個のシャードが必要になります。LARGE の場合は 2 個のシャードが必要です。また、リクエスト数 (QPS) が増えるとオートスケールにより各シャードに対してレプリカが増加します。

シャードとレプリカについては [公式ドキュメントの FAQ](https://cloud.google.com/vertex-ai/docs/matching-engine/faqs#how_many_ip_addresses_should_i_reserve) がわかりやすいです。 

#### 初期登録データを作成する

Index を作成する前に初期登録データを用意します。本記事では画像を [EfficientNetB0](https://www.tensorflow.org/api_docs/python/tf/keras/applications/efficientnet/EfficientNetB0) というモデルでエンベディングを生成して Cloud Storage にアップロードします。サンプルデータには [CC-BY-2.0](https://creativecommons.org/licenses/by/2.0/) で配布されている花の写真を使います。このサンプルデータは Cloud Storage の `gs://cloud-samples-data/ai-platform/flowers/` に保存されています。

次の Python プログラムを作成してください。このプログラムは指定した種類の花の画像すべてのエンベディングを生成して指定した Cloud Storage のパスにアップロードします。

```python:generate_and_upload_embeddings.py
import json
import os
import sys
from tempfile import NamedTemporaryFile

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import numpy as np
import tensorflow as tf
from google.cloud import storage


BUCKET = "cloud-samples-data"
PREFIX = "ai-platform/flowers/"

tf.keras.utils.disable_interactive_logging()
model = tf.keras.applications.EfficientNetB0(include_top=False, pooling="avg")


# Cloud Storage のオブジェクトをダウンロードして、
# EfficientNetB0 でベクトル化する
def blob_to_embedding(blob: storage.Blob) -> list[float]:
    with NamedTemporaryFile(prefix="flowers") as temp:
        blob.download_to_filename(temp.name)
        raw = tf.io.read_file(temp.name)

    image = tf.image.decode_jpeg(raw, channels=3)
    prediction = model.predict(np.array([image.numpy()]))
    return prediction[0].tolist()


# 指定された花の画像すべてに対してエンベディングを生成して、
# 指定した Cloud Storage パスに Matching Engine の JSON フォーマットでアップロードする
def generate_and_upload_embeddings(flower: str, destination_root: str) -> None:
    print(f"Started generating and uploading embeddings for {flower}")

    client = storage.Client(project="gs-matching-engine")

    datapoints = []

    blobs = list(client.list_blobs(BUCKET, prefix=f"{PREFIX}{flower}/"))
    for i, blob in enumerate(blobs, 1):
        print(f"[{i:3d}/{len(blobs)}] Processing {blob.name}")

        embedding = blob_to_embedding(blob)
        datapoints.append({
            "id": blob.name,
            "embedding": embedding,
        })

    dst_bucket_name, dst_base = destination_root[5:].split("/", maxsplit=1)
    dst_bucket = client.bucket(dst_bucket_name)
    dst_blob = dst_bucket.blob(os.path.join(dst_base, flower + ".json"))

    with dst_blob.open(mode="w") as f:
        for datapoint in datapoints:
            f.write(json.dumps(datapoint) + "\n")

    print(f"Finished generating and uploading embeddings for {flower} 🎉")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python generate_and_upload_embeddings.py FLOWER DESTINATION_ROOT")
        print("  FLOWER: daisy, dandelion, roses, sunflowers, or tulips")
        print("  DESTINATION_ROOT: root path of Cloud Storage like gs://my-bucket/embeddings/")
    else:
        generate_and_upload_embeddings(sys.argv[1], sys.argv[2])
```

次のように実行して、デイジーと薔薇の画像の初期登録データを作成してください。

```bash
python generate_and_upload_embeddings.py daisy "gs://$(gcloud config get project)-embeddings/"
python generate_and_upload_embeddings.py roses "gs://$(gcloud config get project)-embeddings/"
```

#### Index を作成する

ストリーム更新の Index を作成します。現在 gcloud コマンドではストリーム更新の Index を作成できないため curl コマンドで直接 Index 作成の API をコールします。

API のリクエストボディとなる JSON をファイルとして作成します。YOUR-PROJECT は自分のプロジェクト ID に置き換えてください。


```json:index_metadata.json
{
  "display_name": "Search index for flower images",
  "metadata": {
    "contentsDeltaUri": "gs://YOUR-PROJECT-embeddings/",
    "config": {
      "dimensions": 1280,
      "approximateNeighborsCount": 100,
      "shardSize": "SHARD_SIZE_SMALL",
      "algorithmConfig": {"treeAhConfig": {}}
    }
  },
  "indexUpdateMethod": "STREAM_UPDATE"
}
```

`metadata.contentsDeltaUri` が初期登録データのルートディレクトリ、`metadata.config.dimensions` がエンベディングの次元数、`shardSize` がシャードサイズです。その他の設定項目についてはドキュメントの[スキーマ](https://cloud.google.com/vertex-ai/docs/matching-engine/create-manage-index#index-metadata-file) を参照してください。

curl コマンドを実行します。

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/$(gcloud config get project)/locations/us-central1/indexes" \
  -d @index_metadata.json
```

Index の作成には 1 時間程度かかります。作成ジョブの状態は[コンソール](https://console.cloud.google.com/vertex-ai/matching-engine/indexes)や `gcloud ai operations describe` コマンドで確認できます。作成が終わると次のように表示されます。

![complete_index_creation_job](/images/articles/getting-started-matching-engine/complete_index_creation_job.png)

### IndexEndpoint の作成

#### IndexEndpoint の種類

IndexEndpoint には接続方法によって 3 種類あります。

| 接続方法                                                                                                                         | 接続元       | 認証の有無   | リリース段階 |
|----------------------------------------------------------------------------------------------------------------------------------|--------------|--------------|--------------|
| [Private Service Access (PSA)](https://cloud.google.com/vertex-ai/docs/matching-engine/deploy-index-vpc)                         | 指定した VPC | あり or なし | 一般提供     |
| [Private Service Connect (PSC)](https://cloud.google.com/vertex-ai/docs/matching-engine/match-eng-setup/private-service-connect) | 指定した VPC | あり or なし | プレビュー   |
| [Public endpoint](https://cloud.google.com/vertex-ai/docs/matching-engine/deploy-index-public#deploy_index_default-drest)        | どこからでも | あり         | プレビュー   |

つまり、IndexEndpoint はデプロイしたインデックスをネットワーク的にどこから使うかを設定します。PSA と PSC の IndexEndpoint は接続した VPC からのみアクセスできるようになります。一方、public endpoint の IndexEndpoint はパブリックなエンドポイントでアクセスできるようになります。また、PSA と PSC では VPC からアクセスするため認証なしでアクセス可能ですが、public endpoint は認証が必須です。

本記事ではサーバーレスとの相性が良かったり、他クラウドからも使いやすかったりする Public endpoint を使います。ただし、public endpoint は執筆時点ではまだプレビューです。

#### Public Endpoint の IndexEndpoint を作成する

現時点で public endpoint の IndexEndpoint は gcloud では作成できません。`curl` コマンドで [API](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.indexEndpoints/create) をコールします。

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/$(gcloud config get project)/locations/us-central1/indexEndpoints" \
  -d '{"display_name": "public-endpoint-flowers", "publicEndpointEnabled": true}'
```

IndexEndpoint の作成はすぐに終了します。

### Index のデプロイ

#### デプロイ時の設定項目

作成した Index を作成した IndexEndpoint にデプロイすると ANN のクエリを実行できるようになります。このときデプロイに関していくつかの設定が必要になります。この設定は API では [DeployedIndex](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.indexEndpoints/deployIndex) というオブジェクトとして表されます。

以下は本記事で設定する項目の簡単な説明です。詳細はドキュメントを参照してください。

| フィールド名            | 内容                               |
|-------------------------|------------------------------------|
| id                      | DeployedIndex の ID                |
| index                   | デプロイする Index の name         |
| dedicatedResources      | マシンタイプとオートスケールの設定 |

DeployedIndex にはマシンタイプやオートスケールの設定が紐付きます。特に指定しない場合は自動で設定されますが、`dedicatedResources` フィールドで小さいマシンタイプを指定すると初期コストを抑えてスモールスタートが可能です。

#### Index をデプロイする

Index を IndexEndpoint へデプロイするために、Index と IndexEndpoint のリソース名が必要です。それぞれ、次のように gcloud コマンドで調べられます。

```bash
# Index のリソース名を表示
gcloud ai indexes list \
  --region us-central1 \
  --format "value(displayName,name)"

# IndexEndpoint のリソース名を表示
gcloud ai index-endpoints list \
  --region us-central1 \
  --format "value(displayName,name)"
```

現時点で gcloud は `dedicatedResources` が設定できないため、Index の作成や IndexEndpoint の作成と同様に curl コマンドで [API](https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.indexEndpoints/deployIndex) をコールします。

リクエストボディは次のようになります。`Index のリソース名` は上で調べたものに置き換えてください。

```json:deploy_index.json
{
  "deployedIndex": {
    "id": "deployed_index_flowers",
    "index": "Indexのリソース名",
    "dedicatedResources": {
      "machineSpec": {
        "machineType": "e2-standard-2"
      },
      "minReplicaCount": 1
    }
  }
}
```

curl コマンドを実行します。

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-aiplatform.googleapis.com/v1/$(gcloud ai index-endpoints list --region us-central1 --format 'value(name)'):deployIndex" \
  -d @deploy_index.json
```

Index のデプロイには数十分程度かかります。デプロイジョブの状態は[コンソール](https://console.cloud.google.com/vertex-ai/matching-engine/index-endpoints)や `gcloud ai operations describe` コマンドで確認できます。

### 検索クエリの実行

#### クエリ画像をダウンロードする

類似画像を探す画像をローカルにダウンロードしておきます。どのような画像でもクエリにはなりますが、この時点で Index にはデイジーと薔薇の画像しか登録されていないので、ここでは同じように花の画像を使います。

サンプルデータのデイジーの画像と、Index に登録されていないチューリップの画像ををいくつかダウンロードします。

```bash
mkdir flowers/{daisy,tulips}
gcloud storage ls gs://cloud-samples-data/ai-platform/flowers/daisy \
  | head \
  | xargs -I@ gcloud storage cp "@" flowers/daisy/
gcloud storage ls gs://cloud-samples-data/ai-platform/flowers/tulips \
  | head \
  | xargs -I@ gcloud storage cp "@" flowers/tulips/
```

#### クエリを実行するプログラムを作成する

以下の Python プログラムを作成してください。このプログラムはコマンドライン引数として与えられた画像ファイルのエンベディングを作成して IndexEndpoint に類似度の高いエンベディングを問合せます。エンベディングの作成には Index の初期登録データを作成したときと同じように EfficientNetB0 を利用します。

また、クエリ先の IndexEndpoint や DeployedIndex を環境変数として設定するようにしています。認証については[アプリケーションのデフォルト認証情報](https://cloud.google.com/docs/authentication/application-default-credentials?hl=ja)を利用します。

```python:search_for_similar_image.py
import os
import sys

import numpy as np
from google.cloud.aiplatform.matching_engine import MatchingEngineIndexEndpoint
from google.cloud import aiplatform_v1beta1 as vertexai

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import tensorflow as tf

tf.keras.utils.disable_interactive_logging()


# 指定されたパスの画像ファイルを EfficientNetB0 でベクトル化する
def file_to_embedding(model: tf.keras.Model, path: str) -> list[float]:
    raw = tf.io.read_file(path)
    image = tf.image.decode_jpeg(raw, channels=3)
    prediction = model.predict(np.array([image.numpy()]))
    return prediction[0].tolist()


class Matcher:
    def __init__(self, index_endpoint_name: str, deployed_index_id: str):
        self._index_endpoint_name = index_endpoint_name
        self._deployed_index_id = deployed_index_id

        self._client = vertexai.MatchServiceClient(
            client_options={"api_endpoint": self._public_endpoint()}
        )

    # Matching Engine にリクエストして、
    # 与えられたエンベディングの近似最近傍探索を行う
    def find_neighbors(self, embedding: list[float], neighbor_count: int):
        datapoint = vertexai.IndexDatapoint(
            datapoint_id="dummy-id",
            feature_vector=embedding
        )
        query = vertexai.FindNeighborsRequest.Query(datapoint=datapoint)
        request = vertexai.FindNeighborsRequest(
            index_endpoint=self._index_endpoint_name,
            deployed_index_id=self._deployed_index_id,
            queries=[query],
        )

        resp = self._client.find_neighbors(request)

        return resp.nearest_neighbors[0].neighbors

    # IndexEndpoint の public endpoint を取得する
    def _public_endpoint(self) -> str:
        endpoint = MatchingEngineIndexEndpoint(
            index_endpoint_name=self._index_endpoint_name
        )
        return endpoint.gca_resource.public_endpoint_domain_name


def search_for_similar_image(index_endpoint_name: str,
                             deployed_index_id: str,
                             image_path: str) -> None:
    print("Loading EfficientNetB0")
    model = tf.keras.applications.EfficientNetB0(
            include_top=False, pooling="avg")

    print(f"Started generating embeddings for {image_path}")
    embedding = file_to_embedding(model, image_path)

    matcher = Matcher(index_endpoint_name, deployed_index_id)
    neighbors = matcher.find_neighbors(embedding, 10)

    for neighbor in neighbors:
        datapoint_id = neighbor.datapoint.datapoint_id
        distance = neighbor.distance
        print(f"{datapoint_id}\tdistance={distance}")


def main():
    if len(sys.argv) != 2:
        print("Usage: python search_for_similar_image.py IMAGE_FILE")
        print("  IMAGE_FILE: path to an image file")
        sys.exit(1)

    index_endpoint_name = os.environ["INDEX_ENDPOINT_NAME"]
    deployed_index_id = os.environ["DEPLOYED_INDEX_ID"]
    image_path = sys.argv[1]

    search_for_similar_image(index_endpoint_name=index_endpoint_name,
                             deployed_index_id=deployed_index_id,
                             image_path=image_path)


if __name__ == "__main__":
    main()
```

#### Service Account のキーファイルをダウンロードする

ローカルマシンから Service Account として実行できるようにキーファイルをダウンロードします。

```bash
gcloud iam service-accounts keys create \
  credentials.json \
  --iam-account "query-runner@$(gcloud config get project).iam.gserviceaccount.com"
```

#### 類似画像検索クエリを実行する

アプリケーション デフォルト認証情報としてキーファイルを利用できるように [`GOOGLE_APPLICATION_CREDENTIALS`](https://cloud.google.com/docs/authentication/application-default-credentials?hl=ja#GAC) 環境変数を設定します。

```bash
export GOOGLE_APPLICATION_CREDENTIALS=credentials.json
```

IndexEndpoint と DeployedIndex を設定します。

```bash
export INDEX_ENDPOINT_NAME="$(gcloud ai index-endpoints list --region us-central1 --format 'value(name)')"
export DEPLOYED_INDEX_ID="deployed_index_flowers"
```

プログラムを実行します。

```bash
python search_for_similar_image.py flowers/daisy/100080576_f52e8ee070_n.jpg
```

次の様な結果が得られます。

```bash
$ python search_for_similar_image.py flowers/daisy/100080576_f52e8ee070_n.jpg
ai-platform/flowers/daisy/100080576_f52e8ee070_n.jpg    distance=84.67890930175781
ai-platform/flowers/daisy/15207766_fc2f1d692c_n.jpg     distance=67.46304321289062
ai-platform/flowers/daisy/437859108_173fb33c98.jpg      distance=67.08963775634766
ai-platform/flowers/daisy/10140303196_b88d3d6cec.jpg    distance=66.45585632324219
ai-platform/flowers/daisy/3275951182_d27921af97_n.jpg   distance=65.7507553100586
ai-platform/flowers/daisy/2509545845_99e79cb8a2_n.jpg   distance=65.38701629638672
ai-platform/flowers/daisy/5626895440_97a0ec04c2_n.jpg   distance=64.9582748413086
ai-platform/flowers/daisy/1286274236_1d7ac84efb_n.jpg   distance=63.265689849853516
ai-platform/flowers/daisy/17027891179_3edc08f4f6.jpg    distance=62.160308837890625
ai-platform/flowers/daisy/676120388_28f03069c3.jpg      distance=61.204811096191406
```

それぞれの行が入力エンベディングに類似するエンベディングを持つ IndexDatapoint です。左のパスが IndexDatapoint の ID で右の `distance` が類似度です。

入力画像 (`flowers/daisy/100080576_f52e8ee070_n.jpg`) が最も高い類似度となっています。

![クエリ画像](/images/articles/getting-started-matching-engine/input1.jpg)
*入力画像のデイジー*

2 番目に高い類似度の画像をダウンロードして確認してみます。

```bash
gcloud storage cp \
  gs://cloud-samples-data/ai-platform/flowers/daisy/15207766_fc2f1d692c_n.jpg \
  flowers/daisy/
open flowers/daisy/15207766_fc2f1d692c_n.jpg
```

![類似画像](/images/articles/getting-started-matching-engine/output1.jpg)
*2 番目に類似度が高かったデイジー画像*

その他の類似画像を見たり他の画像 (花以外でも) でクエリを実行したりしてみてください。

### Index のストリーム更新

最後に Index をリアルタイムで更新するストリーム更新を試します。

#### チューリップの類似画像を検索する

まず、Index にひとつも登録されていないチューリップ画像でクエリを実行してみます。

```bash
$ python search_for_similar_image.py flowers/tulips/100930342_92e8746431_n.jpg
ai-platform/flowers/roses/5863698305_04a4277401_n.jpg   distance=86.56088256835938
ai-platform/flowers/roses/12338444334_72fcc2fc58_m.jpg  distance=86.2914810180664
ai-platform/flowers/roses/9216324117_5fa1e2bc25_n.jpg   distance=84.63143920898438
ai-platform/flowers/roses/3903276582_fe05bf84c7_n.jpg   distance=83.88673400878906
ai-platform/flowers/roses/6363951285_a802238d4e.jpg     distance=82.80744934082031
ai-platform/flowers/roses/475947979_554062a608_m.jpg    distance=82.3120346069336
ai-platform/flowers/roses/17040847367_b54d05bf52.jpg    distance=81.04847717285156
ai-platform/flowers/roses/3475572132_01ae28e834_n.jpg   distance=80.88462829589844
ai-platform/flowers/roses/4558025386_2c47314528.jpg     distance=80.80659484863281
ai-platform/flowers/roses/15681454551_b6f73ce443_n.jpg  distance=80.43231964111328
```

![input tulip](/images/articles/getting-started-matching-engine/input_tulip.jpg)
*入力画像のチューリップ*

類似度の高い薔薇の画像が返ります。

![output2](/images/articles/getting-started-matching-engine/output2.jpg)
*最も類似度が高かった薔薇の画像*

#### ストリーム更新のプログラムを作成する

ストリーム更新を実行する Python プログラムを作成します。このプログラムはコマンドライン引数で与えられた画像に対して EfficientNetB0 でエンベディングを生成して Index に登録します。

```python:upsert_image.py
import os
import sys

import numpy as np
from google.cloud.aiplatform_v1 import (
    IndexServiceClient,
    UpsertDatapointsRequest,
    IndexDatapoint,
)

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import tensorflow as tf

tf.keras.utils.disable_interactive_logging()


# 指定されたパスの画像を EfficientNetB0 でベクトル化する
def file_to_embedding(model: tf.keras.Model, path: str) -> list[float]:
    raw = tf.io.read_file(path)
    image = tf.image.decode_jpeg(raw, channels=3)
    prediction = model.predict(np.array([image.numpy()]))
    return prediction[0].tolist()


class Upserter:
    def __init__(self, index_name: str):
        self._index_name = index_name

        location = index_name.split("/")[3]
        api_endpoint = f"{location}-aiplatform.googleapis.com"
        self._client = IndexServiceClient(
            client_options={"api_endpoint": api_endpoint}
        )

    # 与えられた ID とエンベディングから成る IndexDatapoint を
    # 指定された Index に upsert する
    def upsert(self, datapoint_id: str, embedding: list[float]) -> None:
        datapoint = IndexDatapoint(
            datapoint_id=datapoint_id,
            feature_vector=embedding,
        )
        request = UpsertDatapointsRequest(
            index=self._index_name,
            datapoints=[datapoint]
        )
        self._client.upsert_datapoints(request=request)


def upsert_image(index_name: str, image_path: str):
    print("Loading EfficientNetB0")
    model = tf.keras.applications.EfficientNetB0(
            include_top=False, pooling="avg")

    print(f"Started generating embeddings for {image_path}")
    embedding = file_to_embedding(model, image_path)

    upserter = Upserter(index_name=index_name)
    upserter.upsert(datapoint_id=image_path, embedding=embedding)


def main():
    if len(sys.argv) != 2:
        print("Usage: python upsert.py IMAGE_FILE")
        print("  IMAGE_FILE: path to an image file")
        sys.exit(1)

    index_name = os.environ["INDEX_NAME"]
    image_path = sys.argv[1]

    upsert_image(index_name=index_name, image_path=image_path)


if __name__ == "__main__":
    main()
```

#### ストリーム更新する

ストリーム更新でチューリップ画像を Index に登録します。

Index の name を環境変数として設定する必要があります。

```bash
export INDEX_NAME="$(gcloud ai indexes list --region us-central1 --format 'value(name)')"
```

プログラムを実行します。

```bash
python upsert_image.py flowers/tulips/100930342_92e8746431_n.jpg
```

#### クエリを実行する

更新された Index に対してクエリを実行します。

```bash
$ python search_for_similar_image.py flowers/tulips/100930342_92e8746431_n.jpg
flowers/tulips/100930342_92e8746431_n.jpg       distance=138.33843994140625
ai-platform/flowers/roses/5863698305_04a4277401_n.jpg   distance=86.56088256835938
ai-platform/flowers/roses/12338444334_72fcc2fc58_m.jpg  distance=86.2914810180664
ai-platform/flowers/roses/9216324117_5fa1e2bc25_n.jpg   distance=84.63143920898438
ai-platform/flowers/roses/3903276582_fe05bf84c7_n.jpg   distance=83.88673400878906
ai-platform/flowers/roses/6363951285_a802238d4e.jpg     distance=82.80744934082031
ai-platform/flowers/roses/475947979_554062a608_m.jpg    distance=82.3120346069336
ai-platform/flowers/roses/17040847367_b54d05bf52.jpg    distance=81.04847717285156
ai-platform/flowers/roses/3475572132_01ae28e834_n.jpg   distance=80.88462829589844
ai-platform/flowers/roses/4558025386_2c47314528.jpg     distance=80.80659484863281
```

このように、最も類似度の高い画像としてストリーム更新で追加した画像が得られます。


## おわりに

Vetex AI Matching Engine を使えば、Google が開発した高度な近似最近傍探索をフルマネージドで利用できます。今後 AI 活用が進む中で、ベクトルデータベース・ベクトル検索が必要なときの選択肢のひとつになるのではないでしょうか。

若いサービスということもあり Matching Engine は SDK やドキュメント、gcloud の対応がまだ不足している部分がありますが、高頻度で改善されていてどんどん使いやすくなっています。もしクライアント ライブラリの使い方がわかりにくいという場合は [API リファレンス](https://cloud.google.com/vertex-ai/docs/reference/rest)や [google-cloud-aiplatform](https://github.com/googleapis/python-aiplatform) のソースコードを参照することをオススメします。

また、今回利用したコードはこちらにまとめてあります。コメントで利用したクラスやメソッドの定義元への URL をつけています。必要があれば参照してください。

https://github.com/nownabe/google-cloud-examples/tree/main/python/getting-started-matching-engine

