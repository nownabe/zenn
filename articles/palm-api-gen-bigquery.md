---
title: "PaLM API を使って自然言語で BigQuery にクエリしてみる"
emoji: "🤖"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [gcp, vertexai, llm, bigquery, generativeai]
published: false
---

## はじめに

先日の [Google I/O 2023](https://io.google/2023/) で Public Preview になった [Vertex AI PaLM API](https://cloud.google.com/vertex-ai/docs/generative-ai/learn/overview#palm-api) を使って、自然言語で BigQuery に対してクエリを実行してみます。

「とりあえず PaLM API を触ってみたい」が趣旨であり実用的ではありません。より実用的に使うためには[今後出てくる](https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-launches-new-ai-models-opens-generative-ai-studio)コード生成に特化したモデル (Codey) を使ったり、プロンプト エンジニアリングしたり、トライ & エラーできるような仕組みを作ったりする必要があるでしょう。

本記事では PaLM API からのレスポンスをマスクしています。どのようなものが生成されたか見たい方はぜひ自分で実行してみてください。

:::message alert
本記事の執筆時点で[Generative AI Preview Products の規約](https://cloud.google.com/trustedtester/aitos?hl=ja)により、生成された結果を公開できません。PaLM API 等を利用する際は注意してください。また、こちらの規約に関しては内容や URL が変更される可能性があります。必ず最新のものを参照してください。
:::

本記事で使ったコード全文は Gist にあります。必要に応じて参照してください。

https://gist.github.com/nownabe/97e4bd8ea600d71bbfac12daf0c4110e

## 必要なもの

* Google Cloud のアカウント
* Google Cloud のプロジェクト
* [gcloud](https://cloud.google.com/sdk/docs/install) コマンド
* Python

## 準備

gcloud の認証をします。

```shell
gcloud auth login
gcloud auth application-default login
```

プロジェクトの設定もしておきます。

```shell
gcloud config set project <YOUR-PROJECT>
```

Vertex AI の機能を有効化します。

```shell
gcloud services enable aiplatform.googleapis.com
```

Vertex AI と BigQuery のクライアント SDK をインストールします。

```shell
pip install google-cloud-aiplatform=="1.25.0" google-cloud-bigquery=="3.10.0"
```

## PaLM API を叩いてみる

まずはシンプルに PaLM API を叩くスクリプトを作成して実行してみます。

```python:main.py
import sys

from vertexai.preview.language_models import TextGenerationModel

prompt = sys.argv[1]

model = TextGenerationModel.from_pretrained("text-bison@001")
result = model.predict(prompt)
print(result.text)
```

実行すると次のように入力プロンプトに対して生成されたテキストが表示されます。

```shell
$ python main.py "What's PaLM?"
(省略)
```

利用可能なモデルやパラメータについては [ドキュメント](https://cloud.google.com/vertex-ai/docs/generative-ai/learn/models) を参照してください。`text-bison@001` は汎用の基盤モデルです。今後は[より巨大な汎用モデル](https://japan.googleblog.com/2023/05/palm-2.html)や[コード生成に特化したモデルなど](https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-launches-new-ai-models-opens-generative-ai-studio)も追加されることが発表されています。

パラメータを指定する場合は次のようにします。

```python
result = model.predict(
    prompt,
    temperature=0.2,
    max_output_tokens=256,
    top_k=0.8,
    top_p=40,
)
```

## PaLM API で BigQuery のクエリを生成する

こんな感じのプロンプトで SQL クエリを生成します。

```
You are an experienced data analyst. Write a BigQuery SQL to answer the user's prompt based on the following context.

---- Context ----
Format: Plain SQL only, no Markdown
Table: `{table.full_table_id}`
Restriction: {restriction}
Schema as JSON:
{schema}
----

User's prompt: {user_prompt}
```

プロンプトにはテーブル名やスキーマなどの情報をコンテキストとして埋め込みます。これらの情報は与えられたテーブル名から動的に取得するようにします。次のスクリプトはコマンドライン引数でテーブル名とプロンプトを受け取り、テーブルのメタデータをコンテキストとして埋め込んだプロンプトを PaLM API に投げてレスポンスを得るスクリプトです。

```python:main.py
import io
import sys

from google.cloud import bigquery
from vertexai.preview.language_models import TextGenerationModel


client = bigquery.Client()

def render_prompt(full_table_id: str, user_prompt: str) -> str:
    table = client.get_table(full_table_id)

    restriction = "None"
    if (partitioning := table.time_partitioning) and partitioning.require_partition_filter:
        restriction = f"You MUST filter `{partitioning.field}` field in a `where` clause."

    with io.StringIO("") as buf:
        client.schema_to_json(table.schema, buf)
        schema = buf.getvalue()

    return f"""You are an experienced data analyst. Write a BigQuery SQL to answer the user's prompt based on the following context.

---- Context ----
Format: Plain SQL only, no Markdown
Table: `{table.full_table_id}`
Restriction: {restriction}
Schema as JSON:
{schema}
----

User's prompt: {user_prompt}"""

full_table_id = sys.argv[1]
user_prompt = sys.argv[2]

prompt = render_prompt(full_table_id, user_prompt)

print(f"==== Prompt ====\n{prompt}")

model = TextGenerationModel.from_pretrained("text-bison@001")
result = model.predict(prompt)
print(f"\n==== Response ====\n{result.text}")
```

これを実行すると次のようになります。

```
$ python main.py \
  "bigquery-public-data.wikipedia.pageviews_2023" \
  "Show top 10 popular articles in Japan in April, 2023"
==== Prompt ====
You are an experienced data analyst. Write a BigQuery SQL to answer the user's prompt based on the following context.

---- Context ----
Format: Plain SQL only, no Markdown
Table: `bigquery-public-data:wikipedia.pageviews_2023`
Restriction: You MUST filter `datehour` field in a `where` clause.
Schema as JSON:
[
  {
    "mode": "NULLABLE",
    "name": "datehour",
    "type": "TIMESTAMP"
  },
  {
    "mode": "NULLABLE",
    "name": "wiki",
    "type": "STRING"
  },
  {
    "mode": "NULLABLE",
    "name": "title",
    "type": "STRING"
  },
  {
    "mode": "NULLABLE",
    "name": "views",
    "type": "INTEGER"
  }
]
----

User's prompt: Show top 10 popular articles in Japan in April, 2023

==== Response ====
(省略: SQL が生成されることを期待)
```

## 生成された SQL を実行する

最後に、生成された結果を SQL と仮定して BigQuery で実行します。

先程のスクリプトの末尾に次の 4 行を追加します。PaLM API からのレスポンスを BigQuery のクエリとして実行して、結果を表示するコードです。

```python
rows = client.query(result.text).result()
print(f"\n==== Result ====\n")
for row in rows:
    print("\t".join(map(str, row.values()))
```

実行すると次のようになります。

```
$ python main.py \
  "bigquery-public-data.wikipedia.pageviews_2023" \
  "Show top 10 popular articles in Japan in April, 2023"
==== Prompt ====
(長いので省略)

==== Response ====
(省略: SQL が生成されることを期待)

==== Result ====
(省略: 生成された SQL により結果が返ることを期待)
```

省略ばかりで何もわかりませんが、正しい SQL が生成されれば BigQuery からのクエリ結果が表示されます。

このようにして自然言語のプロンプトからクエリ結果が得られます。

## おわりに

同じようなシステムを実用化しようとするとまだまだ工夫が必要ですが、簡単なスクリプトと汎用の LLM でここまでできるとワクワクしますね。ぜひお手持ちのテーブルやプロンプトで試してみてください。

今回は汎用 LLM で SQL を生成しましたが、用途に特化したモデルや Embeddings API なども発表されていて今後がますます楽しみです。例えば本記事の SQL 生成というタスクでは Codey というコード生成に特化したモデルが適しているでしょう。

https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-launches-new-ai-models-opens-generative-ai-studio

最後に、現在 PaLM API はプレビューであり破壊的変更等の可能性があります。また、[Generative AI Preview Products の追加規約](https://cloud.google.com/trustedtester/aitos?hl=ja)があります。利用する際は留意してください。
