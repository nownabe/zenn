---
title: "できるだけインフラ運用したくない Ruby on Rails on Google Cloud"
emoji: "🚂"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [rails,ruby,gcp,docker,serverless]
published: true
---

# TL; DR

Google Cloud 上で Rails をできるだけインフラ運用しなくて済むように構築するとしたら、こういう構成にするのはどうだろうか？

* メインの Web アプリは Cloud Run
* メインのデータベースには Cloud Spanner
* 非同期ワーカーには GKE Autopilot
* 非同期メッセージングキューには Cloud Pub/Sub
* DB マイグレーションには GKE Autopilot
* rails console には GKE Autopilot

# はじめに

先日、Cloud Spanner の ActiveRecord アダプターのバージョン 1.0 がリリースされました。

* [Scale your Ruby applications with Active Record support for Cloud Spanner | Google Cloud Blog](https://cloud.google.com/blog/topics/developers-practitioners/scale-your-ruby-applications-active-record-support-cloud-spanner)
* [大規模分散DBのCloud Spannerが、RailsのActive Recordに対応。スケーラブルで高可用なRubyアプリケーションの開発が容易に － Publickey](https://www.publickey1.jp/blog/21/dbcloud_spannerrailsactive_recordruby.html)

待ちに待っていた人も多いんじゃないでしょうか。これでついに Rails でも Google Cloud のいいところを余すことなく使えるようになったんじゃないかということで、自分が今 Rails アプリを公開するならどうするかなーということを考えてみました。

本記事は技術選定パート、実践パートの 2 部構成でお送りします。

私は Rails から離れて久しく、実際にこの構成で運用したわけでもないのでツッコミどころは多々あるかと思います。何かあればぜひコメントでご教授ください。


# 想定読者

* Rails 開発者
* Rails の本番環境を構築したことがある
* Google Cloud に触れたことがある
* Docker に触れたことがある


# 全体像

全体像はこんな感じです。

![overview](/images/articles/rails-on-google-cloud/overview.png)

以下、このアーキテクチャの技術選定と実践方法について説明します。細かいことはいいから早く試したいという方は技術選定を読み飛ばして実践パートに進んでください。


# 技術選定について

## 前提

今回の Rails アプリはごく普通の Web アプリを想定しています。RESTful な Web アプリで、RDB を利用していて、非同期ジョブを処理するワーカーがいます。

その他の要素はあまり技術選定に影響を及ぼさないと考えて本記事では考慮してません。

技術選定の方針としては、インフラ運用を極力少なくするためにできるだけサーバーレスな構成を目指します。つまり、本記事においては「できるだけインフラ運用したくない」≒「サーバーレス」です。



## コンテナ

今回は 1 つのコンテナイメージで如何にしてシステム全体を構築するかを意識しています。

コンテナを選んだ理由は大きく 2 つあります。1 つ目は一般的に言われているコンテナのメリットや Docker エコシステムによる生産性向上を享受するためです[^1]。2 つ目は Google Cloud 特有の理由によるものです。Google Cloud でコンテナイメージを作らずサーバーレスで Rails アプリを現実的に運用する方法がありません。

Google Cloud において非コンテナ・サーバーレスで Ruby のアプリケーションを実現するとき Cloud Functions か App Engine Standard Environment の 2 つが選択肢になります。しかし、どちらもランタイムの制約が大きく、ランタイムの制約に従ってアプリケーションを開発する必要があります。そのためローカルで開発したものが、いざデプロイしたら動かないという可能性もあります。また、Rails の場合は DB マイグレーションや Rails コンソールのために環境を別に作る必要があります。

Rails のようなコンテナ以前から存在するフレームワークはコンテナと抜群に相性がいいとは言えないし、その時代に培ったマインドセットでは望ましくないコンテナの使い方をしてしまうこともあります。とはいえ、コンテナをしっかり理解して使えば、Rails アプリも問題なくコンテナのメリットを享受できます。本記事では Rails アプリでコンテナのメリットを活かせるような技術選定を目指します。

[^1]: 一般的なコンテナのメリットについては他の詳しい記事に譲ります。[コンテナとは  |  Google Cloud](https://cloud.google.com/learn/what-are-containers)


## Cloud Run

Rails のメインである Web アプリ (`bin/rails server`) を動かすプラットフォームとして [Cloud Run](https://cloud.google.com/run) を選択しました。Cloud Run はコンテナを実行するサーバーレスプラットフォームです。コンテナイメージさえあれば[^2]前準備なしのコマンド一発で:

* コンテナイメージを指定して HTTPS で公開
* 0 to N オートスケール
* ロギング
* モニタリング
* リビジョン管理

なんかができます。機能が充実していて安く、シンプルで使いやいため私がコンテナでアプリケーションを公開するときには真っ先に検討するプラットフォームです。Google Cloud 版 Heroku、コンテナ版 App Engine Standard Environment と考えればわかりやすいです。

Google Cloud で Rails のコンテナを動かそうとすると、Cloud Run、Google Compute Engine (GCE)、Google Kubernetes Engine (GKE)、App Engine Flexible Environment (FE) などの選択肢があります。Cloud Run がこの中で唯一サーバーレスにコンテナを運用できます[^3]。

本記事の実践編では Cloud Run を直接エンドポイントとして公開するような構成を取っていますが、本番運用するなら [Cloud Load Balancing](https://cloud.google.com/load-balancing) を前段に構えることも検討してください。例えば、[Cloud CDN](https://cloud.google.com/cdn) でキャッシュしたり、[Cloud Armor](https://cloud.google.com/armor) でセキュリティを強化したり、他の Google Cloud サービスと連携しやすくなります。また、Cloud Run の Rails アプリと App Engine Standard の Go アプリを混在させた Microservices アーキテクチャを作る、といったことも簡単になる場合があります。

[^2]: 最近はソースコードから勝手にイメージをビルドしてくれるようになりました。[ソースコードからのデプロイ  |  Cloud Run のドキュメント  |  Google Cloud](https://cloud.google.com/run/docs/deploying-source-code)

[^3]: App Engine FE もコンテナの PaaS であり似たような環境ではあります。ただ、コンテナ on GCE のラッパーに近いサービスでコンテナネイティブとは言い辛く、ノードを意識せざるを得なかったりデプロイや起動が遅かったりします。App Engine FE はノードに SSH できるので従来の運用方法からいきなりコンテナネイティブな運用に移行するのが難しい場合などは良い選択肢になり得ます。


## Cloud Spanner

データベースとして [Cloud Spanner](https://cloud.google.com/spanner/) を選択しました[^4]。Cloud Spanner は優れたスケーラビリティ、強整合性、高い可用性を備えたフルマネージド RDB です。Spanner はスケーラビリティや高い可用性に注目されがちですが、シンプルに構築できて運用が楽なことも特徴のひとつです。

AWS の RDS や GCP の Cloud SQL などのマネージド RDB サービスを使うとき、サイジング、フェイルオーバー、レプリケーション、リードレプリカなどの設計が必要になります。また、アップグレードやメンテナンス時はダウンタイムが発生するため、それを考慮したアプリケーションの設計・運用が必要です。Spanner はメンテナンスによるダウンタイムもなく、開発者はノード数とリージョンを設定するだけです。ノード数に関しても性能が足りなくなればダウンタイムなしで追加できます。そのため従来の RDB サービスに比べてインフラとしての構築・運用コストは遥かに少なく済みます。

ただし、注意点が 2 点あります。インフラコストと従来の RDB との差異です。高い可用性のために標準で冗長化されているということもあり、特に小規模な利用だと一般的な RDB サービスより料金が高くなることが多いです[^5]。また、従来の MySQL や PostgreSQL との差異をアプリケーションレイヤーで考慮する必要があります。例えば Cloud Spanner では連番の ID はアンチパターンとされており、Active Record の Spanner アダプターは Primary Key に UUID を利用します。そのため `Post.first` や `Post.last` などは当てにできません。とはいえ、スケーラビリティを意識したアプリケーションにおいては特別なことではないので、Spanner の特性を理解すればそこまで難しい話ではないでしょう。


[^4]: 選択したというかこれを使ってみたくてこの記事書き始めたんですが。
[^5]: 現在はプレビュー機能ですが、1 ノード未満から Spanner を使うことができるようになりました。この機能を使えば低コストから使い始められるようになりました。[コンピューティング容量、ノード、処理単位  |  Cloud Spanner  |  Google Cloud](https://cloud.google.com/spanner/docs/compute-capacity?hl=ja)

## Cloud Pub/Sub

非同期ジョブのメッセージングキューとして [Cloud Pub/Sub](https://cloud.google.com/pubsub) を選択しました。Cloud Pub/Sub はサーバーレスなメッセージングキューサービスです。

ここでは Redis をメッセージングキューとして使うことと比較して考えます。クラウドのマネージド Redis サービスを使う場合であっても RDB サービスと同じような設計・運用コストが発生します。Pub/Sub であればこのようなインフラに関する面倒事は考えなくて済みます。

ただ、次の 2 つの理由から現実的には [Memorystore for Redis](https://cloud.google.com/memorystore/docs/redis/redis-overview) を選択することになりそうです。1 つ目は、Pub/Sub に対応した実用的な非同期ジョブワーカーがないことです。Sidekiq 使いたいですよね。2 つ目は、結局キャッシュも必要になるからです。Pub/Sub はキャッシュにはなり得ません。Sidekiq などの Redis ベースのワーカーを使いたい場合やキャッシュとメッセージングキューを同居させたいという場合は、Redis のマネージドサービスがリーズナブルな選択肢になるのではないでしょうか。また、課金体系の違いから Redis の方が安くなるケースも考えられます。どうしても Redis を運用したくないという場合は Pub/Sub + [Memorystore for Memcached](https://cloud.google.com/memorystore/docs/memcached) が良い選択肢になります。


## Googke Kubernetes Engine Autopilot

多くの方が本記事の Kubernetes という単語を見てガッカリしたんじゃないでしょうか。よくわかります。私もできることなら Kubernetes は使いたくありません。

といいつつ、DB マイグレーション、非同期ジョブワーカー、Rails コンソールの実行プラットフォームとして [Google Kubernetes Engine Autopilot mode](https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview) を選択しました。GKE Autopilot はほぼサーバーレスとして Kubernetes の機能を提供するサービスです。もう少しだけ正確に説明すると、GKE のベストプラクティスを適用したフルマネージドなノードをコンテナ単位[^6]で提供するマネージド Kubernetes サービスです。GKE Standard に比べると設定項目が少ないため簡単にクラスタを作成できます。

すべての用途を Cloud Run でカバーできるとベストだったんですが現在はできません。例えば、Cloud Run ではインスタンスの常時起動ができず[^7]、Pub/Sub の Pull サブスクリプションを利用できません[^8]。

Kubernetes は色々な見方があるものの、インフラをいい感じに抽象化してあらゆる要件に応えるべくコンテナをよろしく運用できるようにするプラットフォームです。また、GKE Autopilot はほぼサーバーレスに Kubernetes を利用できるマネージド Kubernetes サービスです。なので、GKE Autopilot を使えばコンテナを使った大半のユースケースをほぼサーバーレスとして運用できます。

明確にサーバーレスではないと言える唯一の要素が課金体系です。GKE Autopilot ではリクエストが来ていない時間であってもコンテナは常に起動しているため料金が発生します。ただ、本記事では運用を楽にしたいという理由でサーバーレスを選択の軸にしていることから、この課金体系については無視して GKE Autopilot をサーバーレスと言い張ることにします。

まとめると、GKE Autopilot を選択した理由は以下の通りです。

* サーバーレスである
* Cloud Run とあわせて、rails server、db:migrate、非同期ジョブワーカー、rails console をすべて 1 つのコンテナイメージで実行可能
* Kubernetes の便利な機能が利用できる
  * 非同期ジョブワーカーをポート公開なしの Deployment で運用
  * Horizontal Pod Autoscaler のカスタムメトリクスを使って Pub/Sub の詰まり具合でワーカーをスケール可能[^9]
  * db:migrate は Job でバッチ実行
  * rails console は一時的な Pod をデプロイして kubectl exec で利用

本記事で使用する Job や Deployment といった Kubernetes のリソースについては後述します。


[^6]: 正確には Kubernetes の Pod というリソースが最小デプロイ単位になります。[Podの概観 | Kubernetes](https://kubernetes.io/ja/docs/concepts/workloads/pods/pod-overview/)
[^7]: CPU を常に割り当てた場合も同様で、リクエストが来ないインスタンスは停止されます。[CPU の割り当て  |  Cloud Run のドキュメント  |  Google Cloud](https://cloud.google.com/run/docs/configuring/cpu-allocation)
[^8]: [Pub/Sub の push によるトリガー  |  Cloud Run のドキュメント  |  Google Cloud](https://cloud.google.com/run/docs/triggering/pubsub-push)
[^9]: [Cloud Monitoring 指標を使用した Deployment の自動スケーリング  |  Kubernetes Engine  |  Google Cloud](https://cloud.google.com/kubernetes-engine/docs/tutorials/autoscaling-metrics#step6)


# 実践

ここからは実際に上記の技術選定に従って Rails アプリを構築します。

全ソースコードは [nownabe/sample-rails-on-google-cloud](https://github.com/nownabe/sample-rails-on-google-cloud) においてあります。また、各セクションに対応するコミットへのリンクも記載しているので適宜参照してください。

## 環境

各ツール等のバージョンは以下の通りです。

* Ruby 3.0.3
* Node 16.13.1
* Rails 6.1.4.4
* Terraform 1.1.2
* Cloud SDK 367.0.0
* Docker 19.03.6

## rails new

([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/946e42e6407b3c52fef06fbeac075844a97672bd))

まずは rails new します。先日[Rails 7がリリース](https://rubyonrails.org/2021/12/15/Rails-7-fulfilling-a-vision)されて非常に面白そうなアップデートではあるものの、残念ながら [activerecord-spanner-adapter](https://rubygems.org/gems/activerecord-spanner-adapter) がまだ ActiveRecord 7 系には対応していないので Rails 6 を使います。

```bash
rails _6.1.4.4_ new my_app
```


## モデルの作成

([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/23806729e2a8454e10e9a42cd7913b603fd495ee))

今回は DB まわりと非同期ジョブワーカーの動きを確認するためだけのアプリを作成します。マイクロブログ的なものを想定していて以下の 2 つのモデルを作成します。

* `Post` - ユーザーからの投稿
* `PostNotification` - 投稿に関する通知 (実際は Post が作成されると非同期ジョブで新しいレコードを作成するだけ)

2 つのモデルについて Scaffold します。

```bash
bin/rails g scaffold Post name:string title:string content:text
bin/rails g scaffold PostNotification post:references message:text
```


## データベースの設定

([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/1fd126cb688a7c85927bd3ec1833d8521837bf76))

データベースを設定します。今回はローカル開発環境として Docker Compose で [Spanner Emulator](https://cloud.google.com/spanner/docs/emulator) を立ち上げます。Spanner Emulator はデータの永続化ができないので実際の開発では開発用の Spanner インスタンスを用意してください。ローカルや CI でのテストにはエミュレータが使えます。

以下の `docker-compose.yaml` を作成して `docker-compose up` で起動します。

```yaml:docker-compose.yaml
version: "3.8"

services:
  spanner:
    image: gcr.io/cloud-spanner-emulator/emulator
    ports:
    - 9010:9010
    - 9020:9020
```

`Gemfile` に `gem 'activerecord-spanner-adapter'` を追加して `bundle install` を実行します。

```ruby:Gemfile
gem 'activerecord-spanner-adapter'
```

`config/database.yml` を設定します。コンテナで設定しやすいように環境変数を使います。細かい設定内容については[ドキュメント](https://www.rubydoc.info/gems/activerecord-spanner-adapter/1.0.0)や[サンプル](https://github.com/googleapis/ruby-spanner-activerecord/tree/main/examples)を参照してください。

```yaml:config/database.yml
default: &default
  adapter: spanner
  project: <%= ENV.fetch("GOOGLE_CLOUD_PROJECT") %>
  instance: <%= ENV.fetch("SPANNER_INSTANCE") %>
  database: <%= ENV.fetch("SPANNER_DATABASE") %>
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  timeout: 5000

development: &development
  <<: *default
  emulator_host: <%= ENV.fetch("SPANNER_EMULATOR_HOST", "") %>

test:
  <<: *development
  database: "test"

production:
  <<: *default
```

開発環境でこれらの環境変数を設定するために今回は [Direnv](https://direnv.net/) を利用します。次の `.envrc` を作成して `direnv allow` を実行します。

```bash:.envrc
export GOOGLE_CLOUD_PROJECT="your-project-id"
export SPANNER_INSTANCE="myapp"
export SPANNER_DATABASE="development"
export SPANNER_EMULATOR_HOST="localhost:9010"
```

これで Rails から Spanner エミュレータには接続できるようになりましたが、エミュレータにインスタンスとデータベースが作成されていないためエラーになります。

```bash
$ bin/rails db:version
rails aborted!
ActiveRecord::NoDatabaseError: 5:Instance not found: projects/your-project-id/instances/myapp. debug_error_string:{"created":"@1639983117.171127472","description":"Error received from peer ipv6:[::1]:9010","file":"src/core/lib/surface/call.cc","file_line":1063,"grpc_message":"Instance not found: projects/your-project-id/instances/myapp","grpc_status":5}
```

エミュレータにインスタンスを作成する Rake タスクを作ります。

```ruby:lib/tasks/spanner.rake
require "google/cloud/spanner"

namespace :spanner do
  namespace :instance do
    task :create => :environment do
      config = ActiveRecord::Base.configurations.find_db_config(Rails.env).configuration_hash
      spanner = Google::Cloud::Spanner.new(
        project_id: config[:project],
        emulator_host: config[:emulator_host],
      )
      job = spanner.create_instance(config[:instance])
      job.wait_until_done!
      p job.error if job.error?
    end
  end
end
```

Rake タスクを実行してエミュレータにインスタンスを作成します。

```bash
bin/rails spanner:instance:create
```

データベースは `db:create` タスクで作成できます。

```bash
bin/rails db:create
```

本番環境ではインスタンス、データベースともに Terraform で作成するのでこれらの作業は必要ありません。


## db:migrate と結果の確認

([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/859dceb2787542c3088066babeeb41a828f8dcfd))

`db:migrate` を実行して結果を確認します。

```bash
bin/rails db:migrate
```

結果の確認には[spanner-cli](https://github.com/cloudspannerecosystem/spanner-cli)を使います。

```bash
$ spanner-cli -p $GOOGLE_CLOUD_PROJECT -i $SPANNER_INSTANCE -d $SPANNER_DATABASE -t -e 'SHOW TABLES'
+-----------------------+
| Tables_in_development |
+-----------------------+
| post_notifications    |
| posts                 |
| ar_internal_metadata  |
| schema_migrations     |
+-----------------------+

$ spanner-cli -p $GOOGLE_CLOUD_PROJECT -i $SPANNER_INSTANCE -d $SPANNER_DATABASE -t -e 'SHOW CREATE TABLE posts'
+-------+----------------------------------+
| Table | Create Table                     |
+-------+----------------------------------+
| posts | CREATE TABLE posts (             |
|       |   id INT64 NOT NULL,             |
|       |   name STRING(MAX),              |
|       |   title STRING(MAX),             |
|       |   content STRING(MAX),           |
|       |   created_at TIMESTAMP NOT NULL, |
|       |   updated_at TIMESTAMP NOT NULL, |
|       | ) PRIMARY KEY(id)                |
+-------+----------------------------------+

$ spanner-cli -p $GOOGLE_CLOUD_PROJECT -i $SPANNER_INSTANCE -d $SPANNER_DATABASE -t -e 'SHOW CREATE TABLE post_notifications'
+--------------------+-----------------------------------------------------------------------------+
| Table              | Create Table                                                                |
+--------------------+-----------------------------------------------------------------------------+
| post_notifications | CREATE TABLE post_notifications (                                           |
|                    |   id INT64 NOT NULL,                                                        |
|                    |   post_id INT64 NOT NULL,                                                   |
|                    |   message STRING(MAX),                                                      |
|                    |   created_at TIMESTAMP NOT NULL,                                            |
|                    |   updated_at TIMESTAMP NOT NULL,                                            |
|                    |   CONSTRAINT fk_rails_0dc44904b4 FOREIGN KEY(post_id) REFERENCES posts(id), |
|                    | ) PRIMARY KEY(id)                                                           |
+--------------------+-----------------------------------------------------------------------------+
```

また、これで一通り機能するようになりました。http://localhost:3000/posts で Post を作成してデータベースを確認してみます。

```bash
$ spanner-cli -p $GOOGLE_CLOUD_PROJECT -i $SPANNER_INSTANCE -d $SPANNER_DATABASE -t -e 'SELECT * FROM posts ORDER BY created_at'
+---------------------+---------+-------+---------+--------------------------------+--------------------------------+
| id                  | name    | title | content | created_at                     | updated_at                     |
+---------------------+---------+-------+---------+--------------------------------+--------------------------------+
| 2475678417263982927 | nownabe | 1     | hello   | 2021-12-20T07:19:27.06211764Z  | 2021-12-20T07:19:27.06211764Z  |
| 1864645484749297673 | nownabe | 2     | hi      | 2021-12-20T07:19:38.630756518Z | 2021-12-20T07:19:38.630756518Z |
+---------------------+---------+-------+---------+--------------------------------+--------------------------------+
```

ちゃんとレコードが作成されてますね。Primary Key の `id` が単純な連番ではないことも確認できます。

## Pub/Sub と ActiveJob の設定

([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/94433688a7c9f2fabd4ee010443ff6a5dc47696b))

Pub/Sub の開発環境を設定して、ActiveJob で Pub/Sub を使うように設定します。

Spanner と同じように開発環境では Docker Compose で [Pub/Sub エミュレータ](https://cloud.google.com/pubsub/docs/emulator)を立ち上げるようにします。`Dockerfile-pubsub-emulator` を作成してください。

```Dockerfile:Dockerfile-pubsub-emulator
FROM google/cloud-sdk:slim

RUN apt-get install -y --no-install-recommends google-cloud-sdk-pubsub-emulator

ENTRYPOINT ["gcloud", "beta", "emulators", "pubsub", "start"]
```

`docker-compose.yaml` に `pubsub` サービスを追加します。

```yaml:docker-compose.yaml
services:
  # ...

  pubsub:
    build:
      context: .
      dockerfile: Dockerfile-pubsub-emulator
    command:
      - --project
      - $GOOGLE_CLOUD_PROJECT
      - --host-port
      - 0.0.0.0:8085
    ports:
      - 8085:8085
```

`docker-compose up` し直します。コンテナを立ち上げ直すと Spanner エミュレータのデータが消失するので、もう一度インスタンス作成、データベース作成、db:migrate を実行します。

```bash
docker-compose up -d
bin/rails spanner:instance:create
bin/rails db:create
bin/rails db:migrate
```

Pub/Sub エミュレータのホストを環境変数で設定します。`.envrc` を修正して `direnv allow` を実行します。

```bash:.envrc
export PUBSUB_EMULATOR_HOST="localhost:8085"
```

`Gemfile` に `google-cloud-pubsub` を追加して `bundle install` してください。

```ruby:Gemfile
gem 'google-cloud-pubsub'
```

Pub/Sub エミュレータに Topic と Subscription[^10]を作成する Rake タスクを作ります。Topic は ActiveJob のキュー単位で作成します。今回 Subscription はジョブワーカー用に `#{トピック名}-worker` という名前で機械的に作成します。

```ruby:lib/tasks/pubsub.rake
require "google/cloud/pubsub"

namespace :pubsub do
  namespace :topic do
    task :create, ['topic'] => :environment do |_, args|
      pubsub = Google::Cloud::PubSub.new(project: ENV.fetch("GOOGLE_CLOUD_PROJECT"))
      next if pubsub.topic(args[:topic])
      topic = pubsub.create_topic(args[:topic])
      topic.subscribe("#{args[:topic]}-worker")

      puts "Created #{args[:topic]} topic"
    end
  end
end
```

タスクを実行して `default` Topic と `default-worker` Subscription を作成します。この Topic は `default` キューに対応します。本番環境は Terraform で作成するのでこの作業は不要です。

```bash
bin/rails pubsub:topic:create[default]
```

ActiveJob の QueueAdapter を作成します。この Adapter で非同期 Job がシリアライズされて Pub/Sub にキューイングされます。

```ruby:lib/active_job/queue_adapters/pubsub_adapter.rb
require "json"
require "google/cloud/pubsub"

module ActiveJob
  module QueueAdapters
    class PubsubAdapter
      def enqueue(job)
        topic = client.topic(job.queue_name)
        message = topic.publish(job.serialize.to_json)
        job.provider_job_id = message.message_id
      end

      private

      def client
        @client ||= Google::Cloud::Pubsub.new(project: ENV.fetch("GOOGLE_CLOUD_PROJECT"))
      end
    end
  end
end
```

`config/application.rb` でこの Adapter を利用するように設定します。

```ruby:config/application.rb
require_relative "../active_job/queue_adapters/pubsub_adapter"

module MyApp
  class Application < Rails::Application
    # ...

    config.active_job.queue_adapter = :pubsub
  end
end
```

[^10]: [Pub/Sub: Google 規模のメッセージ サービス  |  Google Cloud](https://cloud.google.com/pubsub/architecture)

## 非同期ジョブの作成

([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/5e214e9ee9896d20bb18b801bd5b00e9a72c3801))

Post を作成したときに、PostNotification を作成する Job を作ります。

`PostNotificationJob` を作成します。

```bash
bin/rails g job PostNotification
```

PostNotificationJob では少し sleep して新しく PostNotification を作成するようにします。

```ruby:app/jobs/post_notification_job.rb
class PostNotificationJob < ApplicationJob
  queue_as :default

  def perform(post)
    Rails.logger.info("Performing PostNotificationJob with Post(ID: #{post.id})")

    sleep 10

    post_notification = PostNotification.new(post: post)
    post_notification.message = "New post (#{post.id}) was created by #{post.name}."

    unless post_notification.save
      Rails.logger.error(post_notification.errors)
    end
  end
end
```

Post が作成されたときキューイングするようにします。

```ruby:app/controllers/posts_controller.rb
  # POST /posts or /posts.json
  def create
    # ...

    PostNotificationJob.perform_later(@post)
  end
```

## 非同期ジョブワーカーの作成
([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/e7fe844ff04f35a4322072256c5a0642bc2d07c7))

非同期ジョブワーカーを作成します。Pub/Sub 版の似非 Sidekiq ですね。今回は非常に簡単な薄いワーカーを作ります。

`lib/pusbusb_worker/worker.rb` に `PubsubWorker::Worker` クラスを作成します。[GitHub](https://github.com/nownabe/sample-rails-on-google-cloud/blob/main/lib/pubsub_worker/worker.rb) には Graceful Shutdown やエラー処理、ロギングなども考慮したコードを置いています。

```ruby:lib/pubsub_worker/worker.rb
module PubsubWorker
  class Worker
    def initialize(queue:)
      @queue = queue
    end

    def start
      subscriber.start
    end

    private

    def pubsub
      @pubsub ||= Google::Cloud::Pubsub.new(
        project: ENV.fetch("GOOGLE_CLOUD_PROJECT"),
      )
    end

    def subscription
      @subscription ||= pubsub.subscription("#{@queue}-worker")
    end

    def subscriber
      @subscriber ||= subscription.listen do |message|
        handle(message)
      end
    end

    def handle(message)
      job = parse_message_as_job(message)
      job.perform(*job.arguments)
      message.acknowledge!
    end

    def parse_message_as_job(message)
      serialized_job = JSON.parse(message.message.data)
      arguments = ActiveJob::Arguments.deserialize(serialized_job["arguments"])
      job = serialized_job["job_class"].constantize.new(*arguments)
      job.deserialize(serialized_job)
      job
    end
  end
end
```

`bin/worker` に起動スクリプトを作成します。

```ruby:bin/worker
#!/usr/bin/env ruby

require "bundler/setup"
require_relative "../lib/pubsub_worker/worker"
PubsubWorker::Worker.new(queue: ARGV[0]).start
```

実行権限をつけて実行します。

```bash
chmod +x bin/worker
bin/worker default
```

ワーカーを起動した状態で Post を作成してみると、ワーカーの標準出力でジョブが実行されていることが確認できます。

```bash
$ bin/worker default
I, [2021-12-20T17:30:59.822076 #422257]  INFO -- : Initializing #<PubsubWorker::Worker @queue="default">
I, [2021-12-20T17:31:00.661220 #422257]  INFO -- : Started #<PubsubWorker::Worker @queue="default">
D, [2021-12-20T17:31:04.089690 #422257] DEBUG -- :   Post Load (1.6ms)  SELECT `posts`.* FROM `posts` WHERE `posts`.`id` = @p1 LIMIT @p2
D, [2021-12-20T17:31:04.090100 #422257] DEBUG -- :   ↳ lib/pubsub_worker/worker.rb:75:in `parse_message_as_job'
I, [2021-12-20T17:31:04.097400 #422257]  INFO -- : Started PostNotificationJob (Job ID: f07e0e37-3338-4917-82dd-ab3b8b40e1af) with arguments: [#<Post id: 3357958519696874465, name: "nownabe", title: "Hello async job", content: "Hi", created_at: "2021-12-20 08:29:38.419687717 +0000", updated_at: "2021-12-20 08:29:38.419687717 +0000">]
I, [2021-12-20T17:31:04.097465 #422257]  INFO -- : Performing PostNotificationJob with Post(ID: 3357958519696874465)
D, [2021-12-20T17:31:14.117517 #422257] DEBUG -- :   SQL (0.1ms)  BEGIN
D, [2021-12-20T17:31:14.117780 #422257] DEBUG -- :   ↳ app/jobs/post_notification_job.rb:12:in `perform'
D, [2021-12-20T17:31:14.120066 #422257] DEBUG -- :   PostNotification Create (1.3ms)  INSERT INTO `post_notifications` (`post_id`, `message`, `created_at`, `updated_at`, `id`) VALUES (@p1, @p2, @p3, @p4, @p5)
D, [2021-12-20T17:31:14.120607 #422257] DEBUG -- :   ↳ app/jobs/post_notification_job.rb:12:in `perform'
D, [2021-12-20T17:31:14.121932 #422257] DEBUG -- :   SQL (0.8ms)  COMMIT
D, [2021-12-20T17:31:14.122304 #422257] DEBUG -- :   ↳ app/jobs/post_notification_job.rb:12:in `perform'
I, [2021-12-20T17:31:14.122513 #422257]  INFO -- : Finished PostNotificationJob (Job ID: f07e0e37-3338-4917-82dd-ab3b8b40e1af) with arguments: [#<Post id: 3357958519696874465, name: "nownabe", title: "Hello async job", content: "Hi", created_at: "2021-12-20 08:29:38.419687717 +0000", updated_at: "2021-12-20 08:29:38.419687717 +0000">]
```

また、http://localhost:3000/post_notifications でレコードが作成されていることを確認できます。

## マスターキーの設定
([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/a65937e53a6ee3cb313b7a452c5f32f58c5a3630))

本番環境でマスターキーを安全に利用するための設定をします。ここでいうマスターキーは `config/credentials.yml.enc`[^11]の暗号化・複合に利用するマスターキーのことを指します。ここではマスターキーに焦点を当てていますが他の機密データも同じように考えることができます。Rails の場合はマスターキーさえ安全に扱うことができれば他の機密データは `credentials.yml.enc` に格納することも簡単です。`credentials.yml.enc` を使わない方はマスターキーではなく `SECRET_KEY_BASE` と捉えてください。

今回は [Secret Manager](https://cloud.google.com/secret-manager) でマスターキーを管理して Rails の初期化プロセス中に取得します。この方法を採用した理由は後述します。

マスターキーが設定されていることを保証するために `config/environments/production.rb` を修正します。

```ruby:config/environments/production.rb
Rails.application.configure do
  # ...

  # Ensures that a master key has been made available in either ENV["RAILS_MASTER_KEY"]
  # or in config/master.key. This key is used to decrypt credentials (and other encrypted files).
  config.require_master_key = true
end
```

`Gemfile` に `google-cloud-secret_manager` を追加して `bundle install` します。

```ruby:Gemfile
gem 'google-cloud-secret_manager'
```

`lib/master_key_manager/railtie.rb` に Secret Manager からマスターキーを取得して環境変数 `RAILS_MASTER_KEY` にセットするための Railtie プラグインを作ります。

```ruby:lib/master_key_manager/railtie.rb
module MasterKeyManager
  class Railtie < ::Rails::Railtie
    initializer "master_key_manager.set_master_key", before: "active_support.require_master_key" do |app|
      if app.config.x.master_key_manager.secret_id
        require "google/cloud/secret_manager"

        client = Google::Cloud::SecretManager.secret_manager_service
        name = client.secret_version_path(
          project: app.config.x.master_key_manager.project_id,
          secret: app.config.x.master_key_manager.secret_id,
          secret_version: "latest",
        )
        ENV.store(
          "RAILS_MASTER_KEY",
          client.access_secret_version(name: name).payload.data,
        )
      end
    end
  end
end
```

`config/application.rb` で設定します。

```ruby:config/application.rb
require_relative "../lib/master_key_manager/railtie"

module MyApp
  class Application < Rails::Application

    config.x.master_key_manager.secret_id = ENV.fetch("MASTER_KEY_SECRET_ID", nil)
    config.x.master_key_manager.project_id = ENV.fetch("GOOGLE_CLOUD_PROJECT")
  end
end
```

これで、環境変数 `MASTER_KEY_SECRET_ID` を設定すると Secret Manager からマスターキーが読み込まれるようになりました。

[^11]: [Rails セキュリティガイド - Railsガイド](https://railsguides.jp/security.html#%E7%8B%AC%E8%87%AA%E3%81%AEcredential)


### この方法を採用した理由

Google Cloud で機密データを管理するサービスに Secret Manager があります。今回のようなアプリケーションから簡単・安全に機密データを扱いたいというユースケースでは Secret Manager を使うことになります。

Cloud Run では Secret Manager の機密データを直接ファイルか環境変数としてコンテナに渡すことができます。しかし、残念ながら GKE ではコンテナに直接渡すことができません。Secret Manager の機密データを GKE のコンテナに渡す方法としては以下のような方法が考えられます。

* Kubernetes レイヤーで解決 - (例) [External Secrets](https://github.com/external-secrets/kubernetes-external-secrets) のような Kubernetes のプラグインを導入
* コンテナレイヤーで解決 - (例) コンテナ起動時に rails server を実行する前に gcloud コマンド等で機密データを取得して環境変数またはファイルとして設定する
* アプリケーションレイヤーで解決 - (例) Rails の初期化プロセス中に機密データを取得する

本記事はできるだけインフラとは関わりたくないという趣旨の記事であり、Kubernetes レイヤーやコンテナレイヤーで解決するのは本末転倒だということで、アプリケーションレイヤーでの解決を選択しました。また、他にも以下のような理由があります。

* Cloud Run でも GKE でも同じ仕組みが使える
* なんならローカルの開発環境でも CI でも同じ仕組みが使えて、そうすると Google Cloud の IAM によってマスターキーにアクセスできる開発者を厳密にコントロールできる
* rails server するまでの開発フローに余計な手順やスクリプトが不要なので普段と変わらない Rails 開発体験が得られる。つまり、この仕組みを作った人以外はこの仕組みのことを特に意識する必要がない
* 各開発者がそれぞれ `config/master.key` を作成したり `RAILS_MASTER_KEY` を設定したりすることがなく、メモリにしかマスターキーを保持しないため開発者がマスターキーを見ることがなくより安全

デメリットとしては、Rails の初期化プロセスに介入するので少しお行儀が悪いこと、開発者を IAM で管理する必要があることでしょうか。後者に関しては、今までの方法で開発者にマスターキーを渡すことで解決できます。


## Google Cloud プロジェクトの作成

さて、ようやく Rails アプリの準備が完了しました。ここからはデプロイしていきます。

今回利用する Google Cloud のプロジェクトを作成してください。既存のプロジェクトでも大丈夫です。プロジェクトに対して課金が有効であることも確認してください。

用意したプロジェクト ID を `.envrc` の `GOOGLE_CLOUD_PROJECT` 環境変数に設定して `direnv allow` を実行します。

[Cloud SDK (gcloud)](https://cloud.google.com/sdk/docs/quickstart) のアカウントとプロジェクトを設定します。

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project $GOOGLE_CLOUD_PROJECT
```


## Terraform
([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/35effec03358364338ccaf65d3cb9ded47a799f0))

Terraform で Google Cloud に必要なリソースを作成します。本記事では Terraform の細かい内容については説明しません。Terraform の [Google Cloud Platform Provider のドキュメント](https://registry.terraform.io/providers/hashicorp/google/latest/docs)を参照してください。

`terraform` ディレクトリと `.gitignore` ファイルを作成します。

```bash
mkdir terraform
cd terraform
echo ".terraform*" >> .gitignore
echo "terraform.tfstate*" >> .gitignore
```

`main.tf` を作成します。ソースコードは[こちら](https://github.com/nownabe/sample-rails-on-google-cloud/blob/main/terraform/main.tf)です。ざっくりと次のことを行います。

* Spanner インスタンスの作成、Spanner データベースの作成
* Pub/Sub トピックの作成、Pub/Sub サブスクリプションの作成
* [Artifact Registry](https://cloud.google.com/artifact-registry) で Docker イメージ用レポジトリの作成
* GKE Autopilot 用のネットワークの設定
* GKE Autopilot クラスタの作成
* Secret Manager でマスターキー用シークレット作成
* Continuous Delivery 用 [Cloud Build](https://cloud.google.com/build) トリガーの作成
* 必要な [Service Account](https://cloud.google.com/iam/docs/service-accounts) の作成と権限設定

Terraform 実行に必要な環境変数を `.envrc` に追加して `direnv allow` します。

```bash:.envrc
export TF_VAR_project_id="${GOOGLE_CLOUD_PROJECT}"

# GitHubリポジトリが nownabe/myapp だったら nownabe
export TF_VAR_github_owner="your-github-owner"

# GitHubリポジトリが nownabe/myapp だったら myapp
export TF_VAR_github_repo="your-github-repo"
```

init して apply します。エラーが発生した場合はエラーメッセージに従って再実行してください。手動で Google Cloud と GitHub の連携が必要など想定されているエラーがありますが、エラーメッセージに表示される URL を開けば解決できます。

```bash
terraform init
terraform apply
```


## マスターキーの保存

マスターキーを Secret Manager に保存します。

```bash
gcloud secrets versions add rails-master-key \
  --data-file=./config/master.key
```


## Continuous Delivery の方針

移行の実装を進める前に、デプロイまわり、Continous Delivery まわりのざっくり方針を説明します。

CD ツールは Circle CI でも GitHub Actions でもなんでも構いませんが、今回は [Cloud Build](https://cloud.google.com/build) を使います。

今回 Cloud Build ではひとつのトリガーで次の 2 ステップの処理を行います。

* コンテナイメージのビルド
* デプロイスクリプトの実行

デプロイスクリプトでは次の処理を行います。

* GKE Autopilot に Job をデプロイして db:migrate
  * db:migrate Job が終わるまで待って、正常に終了したら Job を削除
* Cloud Run にデプロイ
* GKE Autopilot に Deployment として非同期ワーカーをデプロイ

以降でそれぞれステップにわけて実装します。また、Job や Deployment などの Kubernetes のリソースについてもそこで説明します。


## Cloud Build の設定
([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/b42b0dedcf1ac71140f01ec50a84dfd5ed7879ae))

まずは CD の骨組みとなる Cloud Build を設定します。詳細は [Cloud Build のドキュメント](https://cloud.google.com/build/docs/build-config-file-schema)を参照してください。

次の `cloudbuild.yaml` を作成します。

```yaml:cloudbuild.yaml
steps:

  - name: gcr.io/kaniko-project/executor
    args: [--destination=$_IMAGE:$COMMIT_SHA, --cache=true, --cache-ttl=240h]

  - name: gcr.io/cloud-builders/gcloud
    entrypoint: bash
    args: [deploy.sh]
    env:
      - COMMIT_SHA=$COMMIT_SHA
      - GOOGLE_CLOUD_PROJECT=$PROJECT_ID
      - SPANNER_INSTANCE=$_SPANNER_INSTANCE
      - SPANNER_DATABASE=$_SPANNER_DATABASE
      - MASTER_KEY_SECRET_ID=$_SECRET_RAILS_MASTER_KEY_ID
      - IMAGE=$_IMAGE

substitutions:
  _IMAGE: asia-northeast1-docker.pkg.dev/${PROJECT_ID}/myapp/myapp

options:
  dynamic_substitutions: true
  logging: CLOUD_LOGGING_ONLY

serviceAccount: projects/$PROJECT_ID/serviceAccounts/build-deploy@$PROJECT_ID.iam.gserviceaccount.com
```

あとで実装しますが、ひとまず空の `deploy.sh` を作っておきます。

```bash:deploy.sh
echo "I'm deploy.sh."
```

これで git push するとこの `cloudbuild.yaml` に従ってステップが実行されます。


## Dockerfile の作成
([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/4ab22a9ad0cd206590308bef021b765aa9236e6a))

まずは Docker イメージがないと始まらないので、Dockerfile を作ってイメージをビルドできるようにします。

```Dockerfile:Dockerfile
# -------- node binary -------- #
FROM node:16.13.1-slim as node


# -------- build dependencies and assets --------#
FROM ruby:3.0.3-slim as build

ENV RAILS_ENV production

# these environment variables are required in boot process
ENV GOOGLE_CLOUD_PROJECT dummy
ENV SPANNER_INSTANCE dummy
ENV SPANNER_DATABASE dummy
ENV SECRET_KEY_BASE dummy

COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ gcc make \
  && ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && npm i -g yarn

COPY Gemfile /usr/src/app/
COPY Gemfile.lock /usr/src/app/
COPY package.json /usr/src/app
COPY yarn.lock /usr/src/app

WORKDIR /usr/src/app

RUN bundle config set frozen true \
  && bundle config set with production \
  && bundle install --no-cache \
  && yarn install

COPY . /usr/src/app

RUN bin/rails assets:precompile


# -------- runtime --------#
FROM ruby:3.0.3-slim as runtime

ENV RAILS_ENV production
ENV RAILS_LOG_TO_STDOUT true
ENV RAILS_SERVE_STATIC_FILES true

WORKDIR /usr/src/app

RUN groupadd -g 61000 appuser \
  && useradd -g 61000 -l -m -s /bin/false -u 61000 appuser \
  && mkdir -p /usr/src/app/tmp/pids \
  && chown -R appuser:appuser /usr/src/app

USER appuser

COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build /usr/src/app/public/assets /usr/src/app/public/assets
COPY --from=build /usr/src/app/public/packs /usr/src/app/public/packs

COPY --chown=appuser:appuser . /usr/src/app
```

`.dockerignore` も設定します。

```:.dockerignore
.envrc
.git
.gitattributes
.gitignore
.ruby-versions
Dockerfile
Dockerfile-pubsub-emulator
README.md
cloudbuild.yaml
config/master.key
deploy.sh
docker-compose.yaml
k8s
log/*
node_modules
public/assets
public/packs
public/packs-test
storage/*
terraform
tmp/*
vendor/*
```

これで、git push するとイメージがビルドされて Artifact Registry のリポジトリへプッシュされるようになります。初回はそれなりに時間がかかるので 1 回 push しておいてください。


## db:migrate Job

([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/43b3b7b97595f1184d26c533fd359e49459701aa))[^12]

さて、鬼門パートです。Cloud Build から Kubernetes の Job を使って db:migrate を実行するようにします。

まず、Kubernetes の Job について説明します。

[Job](https://kubernetes.io/docs/concepts/workloads/controllers/job/) は Kubernetes の Pod を 1 回だけ実行するための機能です。[Pod](https://kubernetes.io/ja/docs/concepts/workloads/pods/) というのは Kubernetes の最小デプロイ単位のことで、ここでは Pod = コンテナと考えてもらって問題ありません。Job では実行に失敗した場合のリトライや並列実行もサポートしています。db:migrate のような 1 回だけ実行する処理や、夜間のバッチ処理などの実行に向いている Kubernetes の機能です。また、[CronJob](https://kubernetes.io/ja/docs/concepts/workloads/controllers/cron-jobs/) も Job を使って実装されています。

Kubernetes ではリソースを YAML として定義します。db:migrate を Job として実行するために次の 2 つの YAML を作成します。

* `k8s/dbjob/service-account.yaml.tpl` - Kubernetes の世界の [Service Account](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/) です。GKE の [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) という機能を使って Kubernetes 世界の Service Account と Google Cloud 世界の Service Account を紐付けることで、Pod に Google Cloud の権限を付与できます。
* `k8s/dbjob/job-db-migrate.yaml.tpl` - db:migrate を実行する Job です。

拡張子が `.tpl` となっているのには理由があって、これらのファイルが YAML を生成するテンプレートだからです。例えばデプロイする度にコンテナイメージは新しくなるので、YAML の中で最新のコンテナイメージを指定する必要があります。これを解決するために Git リポジトリには YAML のテンプレートをコミットしてデプロイ時に `deploy.sh` で YAML をレンダリングします。

`k8s/dbjob/service-account.yaml.tpl` を作成します。プロジェクト ID が変数になっているので `deploy.sh` でレンダリングすることになります。

```YAML:k8s/dbjob/service-account.yaml.tpl
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-dbjob
  annotations:
    iam.gke.io/gcp-service-account: myapp-dbjob@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com
```

`k8s/dbjob/job-db-migrate.yaml.tpl` を作成します。コンテナイメージや環境変数が変数になっています。

```YAML:k8s/dbjob/job-db-migrate.yaml.tpl
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
spec:
  backoffLimit: 0
  template:
    metadata:
      name: db-migrate
    spec:
      serviceAccountName: myapp-dbjob
      restartPolicy: Never
      securityContext:
        fsGroup: 61000
        runAsGroup: 61000
        runAsUser: 61000
      containers:
        - name: db-migrate
          image: "${IMAGE}:${COMMIT_SHA}"
          securityContext:
            allowPrivilegeEscalation: false
            privileged: false
          command: ["bundle", "exec", "rake", "db:migrate"]
          resources:
            requests:
              memory: 512Mi
              cpu: 1000m
            limits:
              memory: 512Mi
              cpu: 1000m
          env:
            - name: GOOGLE_CLOUD_PROJECT
              value: "${GOOGLE_CLOUD_PROJECT}"
            - name: SPANNER_INSTANCE
              value: "${SPANNER_INSTANCE}"
            - name: SPANNER_DATABASE
              value: "${SPANNER_DATABASE}"
            - name: MASTER_KEY_SECRET_ID
              value: "${MASTER_KEY_SECRET_ID}"
```

`deploy.sh` でこれらの YAML を利用して db:migrate を実行するようにします。

```bash:deploy.sh
#!/usr/bin/env bash

# Render Kubernetes manifests
for f in $(ls k8s/{dbjob,worker}/*.tpl); do
  eval "cat <<EOF
$(cat $f)
EOF" > ${f%.tpl}
done

# kubectlコマンド用の認証情報を取得
gcloud container clusters get-credentials myapp --region asia-northeast1

# Service Account をデプロイ
kubectl apply -f k8s/dbjob/service-account.yaml

if kubectl get job db-migrate >/dev/null 2>&1; then
  echo "Job db-migrate already exists"
  exit 1
fi

# Job をデプロイ
kubectl apply -f k8s/dbjob/job-db-migrate.yaml

# 最大30分待つ
for _ in {1..360}; do
  if [[ "$(kubectl get job db-migrate -o jsonpath='{.status.succeeded}')" = "1" ]]; then
    break
  elif [[ "$(kubectl get job db-migrate -o jsonpath='{.status.failed}')" = "1" ]]; then
    echo "Job db-migrate failed" >&2
    exit 1
  fi
  sleep 5
done

kubectl delete -f k8s/dbjob/job-db-migrate.yaml
```

これで git push すると db:migrate が実行されるようになります。実際に運用するときは git コマンドで `db/schema.rb` に変更があるときのみ db:migrate Job を実行するなどの運用がよさそうです。

[^12]: GitHub に置いている YAML や `deploy.sh` は[Namespace](https://kubernetes.io/ja/docs/concepts/overview/working-with-objects/namespaces/)や[ConfigMap](https://kubernetes.io/ja/docs/concepts/configuration/configmap/)も活用したバージョンになっているので注意してください。


## Cloud Run へのデプロイ
([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/43b3b7b97595f1184d26c533fd359e49459701aa))

ついにここまできました。Cloud Run へデプロイします。db:migrate と比べると非常に簡単で `deploy.sh` にコマンドをひとつ追加するだけです。

`deploy.sh` に以下のコードを追加します。

```bash:deploy.sh
gcloud run deploy myapp \
  --args bin/rails,server,-b,0.0.0.0 \
  --cpu 1000m \
  --memory 512Mi \
  --service-account myapp-main@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com \
  --set-env-vars GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT} \
  --set-env-vars SPANNER_INSTANCE=${SPANNER_INSTANCE} \
  --set-env-vars SPANNER_DATABASE=${SPANNER_DATABASE} \
  --set-env-vars MASTER_KEY_SECRET_ID=${MASTER_KEY_SECRET_ID} \
  --image ${IMAGE}:${COMMIT_SHA} \
  --allow-unauthenticated \
  --region asia-northeast1
```

これで git push すると Cloud Run へデプロイされます。

実際に試してみましょう。git push して Cloud Build のジョブが完了したことを確認してください。そして、次のコマンドで URL を表示してアクセスしてください。

```bash
echo $(gcloud run services describe myapp --region asia-northeast1 --format "value(status.address.url)")/posts
```

New Post で Spanner に Post レコードが作成されることも確認できます。しかし、まだ非同期ジョブワーカーをデプロイしていないので自動で Post Notification レコードが作られることはありません。


## 非同期ジョブワーカーのデプロイ
([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/5e18117695874b9fdc24ef882820446e82c795e4))

それでは最後にワーカーをデプロイします。ワーカーは Kubernetes の Deployment として GKE Autopilot にデプロイします。

[Deployment](https://kubernetes.io/ja/docs/concepts/workloads/controllers/deployment/) は Kubernetes の主役と言ってもいい機能で、Web アプリやバックグラウンドプロセスを管理するためによく使われます。コンテナの自動障害復旧、新しいコンテナイメージへのローリングアップデート、ロールバック、スケーリングなど、アプリケーションの運用に必要な様々な機能を備えています[^13]。

ワーカーも db:migrate Job と同じように Service Account と Deployment の YAML をそれぞれ作成します。

```YAML:k8s/worker/service-account-worker-default.yaml.tpl
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-worker-default
  annotations:
    iam.gke.io/gcp-service-account: myapp-worker-default@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com
```

```YAML:k8s/worker/deployment-worker-default.yaml.tpl
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-worker-default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp-worker-default
  template:
    metadata:
      labels:
        app: myapp-worker-default
    spec:
      serviceAccountName: myapp-worker-default
      securityContext:
        fsGroup: 61000
        runAsGroup: 61000
        runAsUser: 61000
      terminationGracePeriodSeconds: 60 # Fit timeout of worker
      containers:
      - name: worker
        image: "${IMAGE}:${COMMIT_SHA}"
        securityContext:
          allowPrivilegeEscalation: false
          privileged: false
        command: ["bin/worker", "default"]
        resources:
          requests:
            memory: 512Mi
            cpu: 1000m
          limits:
            memory: 512Mi
            cpu: 1000m
        env:
          - name: GOOGLE_CLOUD_PROJECT
            value: "${GOOGLE_CLOUD_PROJECT}"
          - name: SPANNER_INSTANCE
            value: "${SPANNER_INSTANCE}"
          - name: SPANNER_DATABASE
            value: "${SPANNER_DATABASE}"
          - name: MASTER_KEY_SECRET_ID
            value: "${MASTER_KEY_SECRET_ID}"
```

`deploy.sh` に次の 2 行を追加して、Cloud Build でデプロイするようにします。

```bash:deploy.sh
kubectl apply -f k8s/worker/service-account-worker-default.yaml
kubectl apply -f k8s/worker/deployment-worker-default.yaml
```

これで git push してください。ワーカーがデプロイされ Post Notification のレコードが作成されます。

[^13]: 厳密には、Pod や [ReplicaSet](https://kubernetes.io/ja/docs/concepts/workloads/controllers/replicaset/) などを組合せてこういった機能を提供しています。


## Rails コンソール
([commit](https://github.com/nownabe/sample-rails-on-google-cloud/commit/f0daefc7d709825eab3ec9e80166e36e84a27b62))

ここで終わりとしたいところですが、最後に Rails コンソールを実行する仕組みを作ります。

コンテナを使うのであればすべてイミュータブルに宣言的なアレでやっていくべきだという声もあります。しかし、Rails を使う多くのチームが Rails コンソールを前提とした運用方法に慣れているであろうことは簡単に想像できます。また、今から新しく Rails を採用してかつインフラの面倒をみなくていいように開発しようというスピード感には Rails コンソールがあると目的を達しやすいということも考えられます。というわけで、本記事ではサーバーレスに Rails コンソールを利用する方法を紹介します。

本記事では、Rails コンソールを利用したいときに GKE Autopilot で Rails コンソール用の Pod を立ち上げて、そこに kubectl exec で接続するという方法を採用しました。

Job や Deployment と同じように Pod の YAML を作成します。

```yaml:k8s/console/pod-console.yaml.tpl
apiVersion: v1
kind: Pod
metadata:
  name: myapp-console-${USER}
spec:
  serviceAccountName: myapp-dbjob
  restartPolicy: Never
  securityContext:
    fsGroup: 61000
    runAsGroup: 61000
    runAsUser: 61000
  containers:
    - name: console
      image: "${IMAGE}@${DIGEST}"
      securityContext:
        allowPrivilegeEscalation: false
        privileged: false
      command: ["sleep", "infinity"]
      resources:
        requests:
          memory: 512Mi
          cpu: 1000m
        limits:
          memory: 512Mi
          cpu: 1000m
      env:
        - name: GOOGLE_CLOUD_PROJECT
          value: "${GOOGLE_CLOUD_PROJECT}"
        - name: SPANNER_INSTANCE
          value: "myapp"
        - name: SPANNER_DATABASE
          value: "production"
        - name: MASTER_KEY_SECRET_ID
          value: "rails-master-key"
```

ここで、Deployment や Job と違って `env` に直接 `value` を埋め込んでしまっています。`pod-console.yaml.tpl` は Cloud Build ではなく開発者のローカル環境でレンダリングするため、正しい本番環境の環境変数をレンダリングできないためです。これを回避するために [ConfigMap](https://kubernetes.io/ja/docs/concepts/configuration/configmap/) が利用できます。本記事では Kubernetes まわりの説明を簡略化するために割愛しましたが、GitHub には ConfigMap を利用したバージョンを置いているので参考にしてください。

次に、本番環境で Rails コンソール用の Pod を作成して、それに接続する `bin/remote-console` を作成します。

```bash:bin/remote-console
#!/usr/bin/env bash

export IMAGE=asia-northeast1-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/myapp/myapp

# Artifact Registryにある最新のイメージの情報を取得
export DIGEST=$(
  gcloud artifacts docker images list \
    ${IMAGE} --sort-by update_time \
    | tail -1 | awk '{ print $2 }'
)

# GKE Autopilot クラスタの認証情報を取得
gcloud container clusters get-credentials \
  myapp \
  --region asia-northeast1 \
  --project ${GOOGLE_CLOUD_PROJECT}

# YAMLをレンダリング
eval "cat <<EOF
$(cat k8s/console/pod-console.yaml.tpl)
EOF" > tmp/pod-console.yaml

# Podを作成
kubectl apply -f tmp/pod-console.yaml

# Podが作成されるまで待機
for _ in {1..60}; do
  phase=$(kubectl get pod myapp-console-${USER} -o jsonpath='{.status.phase}')
  echo "Phase: ${phase}"
  if [[ "${phase}" = "Pending" ]]; then
    sleep 5
    continue
  elif [[ "${phase}" = "Running" ]]; then
    break
  else
    echo "Console pod failed" >&2
    exit 1
  fi
done

kubectl exec -ti myapp-console-${USER} -- /bin/bash

kubectl delete -f tmp/pod-console.yaml
```

では実際に使ってみましょう。実行権を付与してスクリプトを実行してください。

```bash
chmod +x bin/remote-console
bin/remote-console
```

上手く行けば、こんな感じで本番環境の Rails コンソールに接続できます。

```bash
$ bin/remote-console
...

appuser@myapp-console-nownabe:/usr/src/app$ bin/rails c
Loading production environment (Rails 6.1.4.4)
irb(main):001:0> Post.first
=> 
#<Post:0x000055cae6824fb8
 id: 4099257140149308946,
 name: "nownabe",
 title: "hi",
 content: "ok!",
 created_at: Tue, 21 Dec 2021 12:23:26.659313787 UTC +00:00,
 updated_at: Tue, 21 Dec 2021 12:23:26.659313787 UTC +00:00>
irb(main):002:0> 
```

## ログやモニタリング

今回紹介した構成であればすべてのログは[Cloud Logging](https://cloud.google.com/logging)に保存されます。また、Google Cloud のコンソールから、Cloud Build、Cloud Run、GKE、それぞれの UI でログを確認できます。

モニタリングに関しても、主要なメトリクスは[Cloud Monitoring](https://cloud.google.com/monitoring)に保存されます。

Cloud Monitoring ではこれらのログやメトリクスを利用してアラートを作成できます。また、外形監視も可能です。

# おわりに

ActiveRecord の Spanner アダプタ試してみるかーと軽い気持ちで書き始めた記事がいつの間にか非常に長くなってしまいました。ぜひ、Rails で Google Cloud の楽しさを体験してみてください。ここまでお付き合いいただきありがとうございました！　🐶💖
