---
title: "Rails でも Spanner はいいぞ"
emoji: "🔧"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [rails, ruby, gcp, googlecloud, cloudspanner]
published: true
---

# はじめに

2021年末、[Cloud Spanner](https://cloud.google.com/spanner?hl=ja) に対応した [ActiveRecord Adapter](https://cloud.google.com/blog/ja/topics/developers-practitioners/scale-your-ruby-applications-active-record-support-cloud-spanner) がリリースされました。Cloud Spanner を使うと旧来の RDBMS と比べて運用が楽になったり、可用性が高くなったり、簡単にアプリケーションがスケーラブルになったりします。しかし、MySQL や PostgreSQL などと比較すると Rails 開発には馴染みがないため、Rails と Cloud Spanner の組合せはまだ少ないのが現状です。

本稿ではそんな現状を解消すべく、Cloud Spanner とは何か、Ruby on Rails での Cloud Spanner の基本的な使い方、 Cloud Spanner 特有のハマりどころとその回避策を説明します。  

# TL; DR

* Cloud Spanner はいいぞ
* Rails でも Cloud Spanner のよさは享受できる
* ただし特有のハマりどころがあるので注意

# Cloud Spanner はいいぞ

まずは [Cloud Spanner](https://cloud.google.com/spanner?hl=ja) とはなにかを簡単に説明します。Spanner は Google が開発したリレーショナル データベースです。強い整合性があり、SQL を処理できます。多くの Google サービスのバックエンドで利用されており、Google Cloud のサービスとして提供されているのが Cloud Spanner です。

従来の RDBMS と比較すると次のような違いがあります。

* 高い可用性
* **パッチやホストメンテなどの計画メンテによるダウンタイムがない**
* ダウンタイムなしで性能の追加・削減が可能
* 自動シャーディングと無制限のスケーリング
* ほぼサーバーレス [^1]

[^1]: インスタンス課金なのでサーバーレスではないんですが、開発者の使い心地としてはサーバーレスなデータベースに近いです。

特に、通常の運用でダウンタイムが発生しないという点は多くの開発・運用チームにとって大きな恩恵を受けられるポイントではないでしょうか。メンテのダウンタイムによるアラートで夜中に起こされたり、強制パッチのメンテ時間調整で疲弊したりすることがなくなります。

また、サービスの成長に手間なくダウンタイムなく追従できる点も安心です。小さく始めたサービスが成長してくるとデータベースのプライマリ インスタンスのスケールアップやシャーディングが必要になり、ダウンタイムや大幅な設計変更が伴うケースがあります。このようなケースでも Cloud Spanner ではノードを追加するだけで対応できて[^2]ダウンタイムも発生しません。

[^2]: スキーマがしっかりと設計されている必要はあります。

## でも、お高いんじゃない？

Cloud Spanner といえば高いというイメージがありますよね。しかし、[Processing Units](https://cloud.google.com/spanner/docs/compute-capacity) という単位でインスタンスをデプロイできるようになり状況は変わっています。

例えば、サービス立ち上げ初期の本番環境を想定した Cloud SQL (MySQL) と比較してみましょう。条件は以下のように設定して、見積もりには [Google Cloud 料金計算ツール](https://cloud.google.com/products/calculator) を利用します。

* 東京リージョン
* 高可用性
* 専用vCPU
* データ容量 100 GB
* バックアップ 300 GB

[結果](https://cloud.google.com/products/calculator/#id=14090fb8-dd32-4f99-995d-0de0d5f50f04)は次のようになりました。

* Cloud SQL 203.62 ドル/月
* Cloud Spanner 154.41 ドル/月

このように、単純に Cloud Spanner の方が高いという結果にはなりません。運用コストや構築の容易さ、サーバーレス プロダクトとの相性の良さ等も考えると十分にコスト優位性が出てくるようになっています。

## 注意点

ここまで、そんなに高くもなくメリットいっぱいあるよという説明をしましたが注意点もあります。

1つ目は、Cloud Spanner 性能を最大限発揮するためには Cloud Spanner の知識が必要になるということです。Cloud Spanner はサービスの成長に追従できると説明しましたが、そのためにはこのポイントを抑えておく必要があります。例えば、Cloud Spanner ではプライマリキーに連番を使うと自動シャーディングで上手くスケールしないケースがあります。従来の RDBMS ではスケールアップで対応できる可能性がありますが、Cloud Spanner の場合は自動シャーディングによるスケールアウトで対応しなければいけません。[^3]

[^3]: ドキュメントは日本語でもしっかり整備されているので一読すればほぼ問題はありません。 [スキーマ設計  |  Cloud Spanner  |  Google Cloud](https://cloud.google.com/spanner/docs/schema-design)

2つ目は、開発用インスタンスの必要性です。Cloud Spanner は OSS ではないためローカルマシンで動作しません。[エミュレータ](https://cloud.google.com/spanner/docs/emulator?hl=ja)はありますが、永続化できず本番環境との差分もいくつかあるのでテストには十分ですが開発用途としては不十分です。そのため、ローカル開発用のインスタンスも必要になるケースが多いです。最低料金のインスタンスでも 10 個のデータベースを作成できるので、開発用にインスタンスを 1 つ作成するような形がいいでしょう。

3つ目は、ActiveRecord Spanner Adapter の成熟度です。まだリリースして1年であり、成熟しているとは言えません。世に出ている情報もまだ少ないですし、様々な壁にぶつかる可能性があります。現段階では問題があれば自力でなんとかしてやるぜ、ぐらいの気概を持って使った方がいいかもしれません。

# 基本的な使い方

## 前提

これから Cloud Spanner を Rails で使うときには新規アプリが多いかと思うので、できるだけ最新のものを前提とします。今回は各種このようなバージョンを利用します。

* Ruby 3.1.3
* Rails 7.0.4
* [ActiveRecord Cloud Spanner Adapter](https://github.com/googleapis/ruby-spanner-activerecord) 1.2.2

## Cloud Spanner インスタンス作成

`rails new` する前に Cloud Spanner インスタンスを作成しておきます。Web UI でも作成できますし、`gcloud` コマンドでも作成できます。今回は `gcloud` コマンドを利用します。[^4]

```sh
gcloud spanner instances create rails-on-spanner \
  --config regional-asia-northeast1 \
  --description "Rails app development" \
  --processing-units 100
```

このコマンドで最小インスタンスが東京リージョンに作成されます。

[^4]: gcloud のインストールと初期化が必要です。[クイックスタート: Google Cloud CLI をインストールする  |  Google Cloud CLI のドキュメント](https://cloud.google.com/sdk/docs/install-sdk?hl=ja)

## Application Default Credentials の設定

Google Cloud の各種クライアント SDK は [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) という仕組みで認証を行います。いくつか設定方法はありますが、ローカル開発では `gcloud` コマンドで簡単に設定できます。次のコマンドを実行して認証します。

```sh
gcloud auth application-default login
```

## 初期設定

最初に `rails new` して Cloud Spanner を使い始めるまでを説明します。

まずはいつもどおり `rails new` しましょう。

```sh
rails _7.0.4_ new rails-on-spanner --skip-bundle
```

ディレクトリを移動します。

```sh
cd rails-on-spanner
```

`Gemfile` を編集します。

```diff:Gemfile
 # The original asset pipeline for Rails [https://github.com/rails/sprockets-rails]
 gem "sprockets-rails"
 
-# Use sqlite3 as the database for Active Record
-gem "sqlite3", "~> 1.4"
+gem "activerecord-spanner-adapter", "~> 1.2.2"
 
 # Use the Puma web server [https://github.com/puma/puma]
 gem "puma", "~> 5.0"
```

設定した Gem をインストールします。

```sh
bundle install
```

`config/database.yml` を編集します。

```yaml:config/database.yml
default: &default
  adapter: spanner
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  project: <%= ENV.fetch("SPANNER_PROJECT_ID", "rails-on-spanner") %>
  instance: <%= ENV.fetch("SPANNER_INSTANCE_ID", "rails-on-spanner") %>
  database: <%= ENV.fetch("SPANNER_DATABASE_ID", "rails-on-spanner") %>

development:
  <<: *default

test:
  <<: *default
  emulator_host: "localhost:9010"

production:
  <<: *default
```

テストではエミュレータを利用するように設定しています。

データベースを作成します。まだエミュレータを設定していないのでテスト用データベースの作成はスキップします。

```sh
rails db:create SKIP_TEST_DATABASE=true
```

開発用サーバーを起動します。

```sh
rails server
```

ここまでが http://localhost:3000 にアクセスできるまでの初期設定になります。

## モデル作成

モデルの作成はいつもどおりの方法で可能です。試しに `Post` というモデルを作成してみます。

```sh
rails generate model Post text:string
```

次のような普通のマイグレーションファイルが生成されます。

```ruby
class CreatePosts < ActiveRecord::Migration[7.0]
  def change
    create_table :posts do |t|
      t.string :text

      t.timestamps
    end
  end
end
```

マイグレーションも通常のコマンドで実行します。

```sh
rails db:migrate
```

コンソールでモデルを使ってみます。

```irb
$ rails console
Loading development environment (Rails 7.0.4)
irb(main):001:0> post = Post.new(text: "Hello, Spanner!")
irb(main):002:0> post.save
irb(main):003:0> Post.all
=>
[#<Post:0x00007fa3d6753948
  id: 1512774127824833883,
  text: "Hello, Spanner!",
  created_at: Fri, 02 Dec 2022 06:38:31.642071966 UTC +00:00,
  updated_at: Fri, 02 Dec 2022 06:38:31.642071966 UTC +00:00>]
```

ここで気になる点として、`id` がランダムな数値になっています。Cloud Spanner Adapter はデフォルトでプライマリキーに UUID を利用します[^5]。これは Cloud Spanner で連番の利用が推奨されないためです。

[^5]: よく見る UUID の文字列フォーマットではなく Integer になっています。Cloud Spanner Adapter では元の UUID の先頭 4 bit は常に一定となるため捨てていて、厳密な UUID ではありません。

ここまでは本当に基本的な部分の設定などでした。

## spanner-cli によるクエリ実行

## 外部キー制約の利用

## インターリーブの利用

## 生成列の利用

## 配列型の利用

## トランザクションの利用

## ミューテーションの利用

## エミュレータの設定

# ハマりどころ

## db:schema:load でエラーになる
## use_transactional_tests が使えない
## travel_to でエラーになる
## upsert あれこれ

## テーブルコメントがない

# おわりに
