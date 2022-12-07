---
title: "Rails でも Spanner を使いたい"
emoji: "🔧"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [rails, ruby, gcp, googlecloud, cloudspanner]
publication_name: "google_cloud_jp"
published: false
---

# はじめに

2021年末、[Cloud Spanner](https://cloud.google.com/spanner?hl=ja) に対応した [ActiveRecord Adapter](https://cloud.google.com/blog/ja/topics/developers-practitioners/scale-your-ruby-applications-active-record-support-cloud-spanner) がリリースされました。Cloud Spanner を使うと旧来の RDBMS と比べて運用が楽になったり、可用性が高くなったり、簡単にアプリケーションがスケーラブルになったりします。しかし、MySQL や PostgreSQL などと比較すると Rails 開発には馴染みがないため、Rails と Cloud Spanner の組合せはまだ少ないのが現状です。

本稿ではそんな現状を解消すべく、Cloud Spanner とは何か、Ruby on Rails での Cloud Spanner の基本的な使い方、 Cloud Spanner 特有のハマりどころとその回避策を説明します。

対象読者は、

* Rails 開発者でデータベース運用のツラミを感じている人
* Rails 開発者で Spanner に興味がある人
* Rails 開発者で Google Cloud を使ってみたい人
* Rails 開発者

です。

# TL; DR

* Cloud Spanner はいいぞ
* Rails でも Cloud Spanner は活用できる
* ただし特有のハマりどころがあるので注意

# Cloud Spanner はいいぞ

まずは [Cloud Spanner](https://cloud.google.com/spanner?hl=ja) とはなにかを簡単に説明します。[Spanner](https://research.google/pubs/pub39966/) は Google が開発したデータベースで、多くの Google サービスのバックエンドとして利用されています。Spanner を Google Cloud のサービスとして提供されているものが Cloud Spanner です。

NewSQL と呼ばれることもあり、RDBMS の特徴 (スキーマ、SQL クエリ、ACID トランザクションなど) を持ちつつ、水平スケールする分散データベースです。

## 運用がとても楽

Cloud Spanner には 従来の RDBMS と比較すると次のような特徴があります。

* 高い可用性
* **パッチやホストメンテなどの計画メンテによるダウンタイムがない**
* ダウンタイムなしで性能の追加・削減が可能
* 自動シャーディングと無制限のスケーリング
* ほぼサーバーレス [^1]

[^1]: インスタンス課金なのでサーバーレスではないんですが、開発者の使い心地としてはサーバーレスなデータベースに近いです。

特に、通常の運用でダウンタイムが発生しないという点は多くの開発・運用チームにとって大きな恩恵を受けられるポイントではないでしょうか。メンテのダウンタイムによるアラートで夜中に起こされたり、強制パッチのメンテ時間調整で疲弊したりすることがなくなります。

また、サービスの成長に手間なくダウンタイムなく追従できる点も安心です。小さく始めたサービスが成長してくるとデータベースのプライマリ インスタンスのスケールアップやシャーディングが必要になり、ダウンタイムや大幅な設計変更が伴うケースがあります。このようなケースでも Cloud Spanner ではノードを追加するだけで対応できて[^2]ダウンタイムも発生しません。

[^2]: スキーマがしっかりと設計されている必要はあります。

## 構築がとても楽

これが Cloud Spanner インスタンスの作成画面です。

![create instance](/images/articles/spanner-on-rails/create-instance.png)

さて、Cloud SQL の MySQL インスタンス作成画面も見てみましょう。

![create mysql](/images/articles/spanner-on-rails/create-mysql.png)

Cloud Spanner を使えばもう複雑な画面を前に悩む必要はありません。

## 開発が思ったより普通

特殊なデータベースだから特殊な開発スキルが必要かというと、そんなことはありません。決してそこまで特殊ではなく MySQL や PostgreSQL と同じような RDBMS として利用できます。細かい使い勝手が違うことはありますが他の RDBMS 同士の差分と比べて学習量が特段大きいわけではありません。

将来的に安心できるスキーマを設計するためには Cloud Spanner のベストプラクティスに従う必要がありますが、整備されたドキュメントを一通り読めば問題ないでしょう。他の RDBMS で正しく設計・開発ができる開発者であれば、慣れていない RDBMS を使う程度の苦労で Cloud Spanner を使うことができます。

## でも、お高いんじゃない？

Cloud Spanner といえば高いというイメージがありますよね。しかし、[Processing Units](https://cloud.google.com/spanner/docs/compute-capacity) という単位でインスタンスをデプロイできるようになり状況は変わりました。

例えば、スモールスタートな本番環境を想定した Cloud SQL (MySQL) と比較してみましょう。条件は以下のように設定して、見積もりには [Google Cloud 料金計算ツール](https://cloud.google.com/products/calculator) を利用します。

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

1つ目は、Cloud Spanner 性能を最大限発揮するためには Cloud Spanner の知識が必要になるということです。Cloud Spanner はサービスの成長に追従できると説明しましたが、そのためにはこのポイントを抑えておく必要があります。例えば、Cloud Spanner では主キーに連番を使うと自動シャーディングで上手くスケールしないケースがあります。従来の RDBMS ではスケールアップで対応できる可能性がありますが、Cloud Spanner の場合は自動シャーディングによるスケールアウトで対応しなければいけません。[^3]

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

```sh
$ rails console
Loading development environment (Rails 7.0.4)
>> post = Post.new(text: "Hello, Spanner!")
>> post.save
>> Post.all
=>
[#<Post:0x00007fa3d6753948
  id: 1512774127824833883,
  text: "Hello, Spanner!",
  created_at: Fri, 02 Dec 2022 06:38:31.642071966 UTC +00:00,
  updated_at: Fri, 02 Dec 2022 06:38:31.642071966 UTC +00:00>]
```

ここで気になる点として、`id` がランダムな数値になっています。Cloud Spanner Adapter はデフォルトで主キーに UUID を利用します[^5]。これは性能を引き出すための[ベストプラクティス](https://cloud.google.com/spanner/docs/schema-design?hl=ja#uuid_primary_key)のひとつです。

[^5]: UUID はよく見る文字列ではなく INT64 型になっています。Cloud Spanner Adapter では元の UUID の先頭 4 bit は常に一定となるため捨てていて、厳密な UUID ではありません。


## spanner-cli によるクエリ実行

MySQL や PostgreSQL を使った開発で `mysql` コマンドや `psql` コマンドを使って直接 SQL クエリを実行することはよくあります。Cloud Spanner では Web UI からクエリを実行して結果を得ることもできますが、[spanner-cli](https://github.com/cloudspannerecosystem/spanner-cli) で簡単にローカルから接続できます。

次のように使います。

```sh
$ spanner-cli -p $SPANNER_PROJECT_ID -i $SPANNER_INSTANCE_ID -d $SPANNER_DATABASE_ID

Connected.
spanner> select * from posts;
+---------------------+-----------------+--------------------------------+--------------------------------+
| id                  | text            | created_at                     | updated_at                     |
+---------------------+-----------------+--------------------------------+--------------------------------+
| 1512774127824833883 | Hello, Spanner! | 2022-12-02T06:38:31.642071966Z | 2022-12-02T06:38:31.642071966Z |
+---------------------+-----------------+--------------------------------+--------------------------------+
1 rows in set (7.77 msecs)

spanner> show tables;
+----------------------------+
| Tables_in_rails-on-spanner |
+----------------------------+
| ar_internal_metadata       |
| posts                      |
| schema_migrations          |
+----------------------------+
3 rows in set (0.03 sec)

spanner> show create table posts;
+-------+----------------------------------+
| Table | Create Table                     |
+-------+----------------------------------+
| posts | CREATE TABLE posts (             |
|       |   id INT64 NOT NULL,             |
|       |   text STRING(MAX),              |
|       |   created_at TIMESTAMP NOT NULL, |
|       |   updated_at TIMESTAMP NOT NULL, |
|       | ) PRIMARY KEY(id)                |
+-------+----------------------------------+
1 rows in set (0.48 sec)

spanner>
```

## アソシエーション

Cloud Spanner でも通常の方法でアソシエーションを扱えます。

Post モデルに紐づく Comment モデルを作成します。

```sh
rails g model Comment post:references text:string
```

次のようなマイグレーション ファイルが作成されます。

```ruby
class CreateComments < ActiveRecord::Migration[7.0]
  def change
    create_table :comments do |t|
      t.references :post, null: false, foreign_key: true
      t.string :text

      t.timestamps
    end
  end
end
```

各モデルはこのようにします。

```ruby
# app/models/post.rb
class Post < ApplicationRecord
  has_many :comments
end

# app/models/comment.rb
class Comment < ApplicationRecord
  belongs_to :post
end
```

マイグレーションしてコンソールから使ってみます。

```sh
❯ rails console
Loading development environment (Rails 7.0.4)
>> post = Post.new(text: "I'm post")
>> post.save
>> comment1 = Comment.new(text: "1st comment", post: post)
>> comment1.save
>> comment2 = Comment.new(text: "2nd comment", post: post)
>> comment2.save
>> post.comments
=>
[#<Comment:0x00007fe742a44e90
  id: 554336591488924812,
  post_id: 1930108953802636175,
  text: "2nd comment",
  created_at: Fri, 02 Dec 2022 14:22:29.074713484 UTC +00:00,
  updated_at: Fri, 02 Dec 2022 14:22:29.074713484 UTC +00:00>,
 #<Comment:0x00007fe742a445d0
  id: 1283981736145185058,
  post_id: 1930108953802636175,
  text: "1st comment",
  created_at: Fri, 02 Dec 2022 14:22:11.155543363 UTC +00:00,
  updated_at: Fri, 02 Dec 2022 14:22:11.155543363 UTC +00:00>]
>> comment1.post
=> #<Post:0x00007fe7429ab920 id: 1930108953802636175, text: "I'm post", created_at: Fri, 02 Dec 2022 14:20:15.862502705 UTC +00:00, updated_at: Fri, 02 Dec 2022 14:20:15.862502705 UTC +00:00>
```

## インターリーブの利用

Cloud Spanner には[インターリーブ](https://cloud.google.com/spanner/docs/schema-and-data-model?hl=ja)という外部キーに似た機能があります。どちらも親子関係を表現できる機能ですが、インターリーブでは分散されたノードにおいて親と子が物理的に同じ場所に配置されるため多くの親子関係で外部キーよりパフォーマンスが向上します。[^6]

[^6]: インターリーブと外部キーの違いについては[こちら](https://cloud.google.com/spanner/docs/foreign-keys/overview?hl=ja#fk-and-table-interleaving)にまとまっています。

インターリーブすると子テーブルは複合主キーとなるので、ActiveRecord でインターリーブする場合は複合主キーを扱うために [composite_primary_keys](https://github.com/composite-primary-keys/composite_primary_keys) という gem が必要になります。

```ruby:Gemfile
gem "composite_primary_keys", "~> 14.0.4"
```

例えば、インタリーブを使った親子関係を持つ`Singer`、`Album`、`Track`という 3 つのモデルのスキーマ定義は次のようにします。

```ruby
create_table :singers, id: false do |t|
  # 明示的に主キーに名前をつけます。
  # インターリーブするすべてのテーブルの主キーが `id` になることを避けるためです。
  t.primary_key :singer_id

  t.string :name
  t.timestamps
end

create_table :albums, id: false do |t|
  # albums テーブルを singers テーブルを親テーブルとしてインターリーブします。
  t.interleave_in :singers

  # 親テーブルの主キーを指定します。
  t.parent_key :singer_id

  # 明示的に主キーに名前をつけます。
  t.primary_key :album_id

  t.string :title
  t.timestamps
end

create_table :tracks, id: false do |t|
  # tracks テーブルを albums テーブルを親テーブルとしてインターリーブします。
  # :cascade オプションをつけると親レコードを削除したとき子レコードも削除されます。
  t.interleave_in :albums, :cascade

  # 親テーブルの主キーを指定します。
  t.parent_key :singer_id
  t.parent_key :album_id

  # 明示的に主キーに名前をつけます。
  t.primary_key :track_id

  t.string :title
  t.timestamps
end
```

モデルにも少し特殊な記述が必要になります。各モデルは次のようになります。

```ruby
class Singer < ApplicationRecord
  has_many :albums, foreign_key: :singer_id

  # tracks テーブルも singer_id 列があるので直接 has_many できる
  has_many :tracks, foreign_key: :singer_id
end

class Album < ApplicationRecord
  # 複合主キーを指定する
  self.primary_keys = [:singer_id, :album_id]

  belongs_to :singer, foreign_key: :singer_id
  has_many :tracks, foreign_key: [:singer_id, :album_id]
end

class Track < ApplicationRecord
  self.primary_keys = [:singer_id, :album_id, :track_id]

  belongs_to :album, foreign_key: [:singer_id, :album_id]
  belongs_to :singer, foreign_key: :singer_id

  def initialize(attributes = nil)
    super
    self.singer ||= album&.singer
  end

  def album=(value)
    super
    self.singer = value&.singer
  end
end
```

モデルのアソシエーションの使い方は通常の使い方と同じです。

```ruby
$ rails c
Loading development environment (Rails 7.0.4)
>> singer = Singer.create!(name: "ずっと真夜中でいいのに")
>> album1 = Album.create!(singer: singer, title: "潜潜話")
>> track1_1 = Track.create!(album: album1, title: "秒針を噛む")
>> track1_2 = Track.create!(album: album1, title: "脳裏上のクラッカー")
>> album2 = Album.create!(singer: singer, title: "ぐされ")
>> track2_1 = Track.create!(album: album2, title: "お勉強しといてよ")
>> track2_2 = Track.create!(album: album2, title: "暗く黒く")

>> singer.albums.pluck(:title)
=> ["ぐされ", "潜潜話"]

>> singer.tracks.pluck(:title)
=> ["お勉強しといてよ", "暗く黒く", "脳裏上のクラッカー", "秒針を噛む"]

>> track2_2.album.title
=> "ぐされ"

>> track2_2.singer.name
=> "ずっと真夜中でいいのに"

>> album2.delete

>> singer.tracks.pluck(:title)
=> ["脳裏上のクラッカー", "秒針を噛む"]
```

:::message alert
現在、ActiveRecord Spanner Adapter のバグで子テーブルの保存がエラーになります。
鋭意修正中ですが、修正されたバージョンがリリースされるまで `ApplicationRecord` で以下のパッチを当ててください。

```ruby:app/models/application_record.rb
class ApplicationRecord < ActiveRecord::Base
  primary_abstract_class

  class << self
    def _set_composite_primary_key_values(primary_keys, values)
      primary_key_value = []
      primary_key.each do |col|
        value = values[col]

        if value&.value.nil? && prefetch_primary_key?
          value = ActiveModel::Attribute.from_database col, next_sequence_value, ActiveModel::Type::BigInteger.new
          values[col] = value
        end
        if value.is_a? ActiveModel::Attribute
          value = value.value
        end
        primary_key_value.append value
      end
      primary_key_value
    end
  end
end
```
:::

## 配列型の利用

[PostgreSQL](https://guides.rubyonrails.org/active_record_postgresql.html#array) とおなじように Cloud Spanner でも[配列型](https://cloud.google.com/spanner/docs/reference/standard-sql/arrays?hl=ja)のカラムを使えます。

マイグレーションは次のように書きます。

```ruby
create_table :books do |t|
  t.string :title, null: false
  t.string :tags, array: true, null: false, default: []
  t.string :ratings, array: true, null: false, default: []

  t.timestamps
end
```

次のように使います。

```ruby
>> Book.create(title: "たのしい Ruby", tags: ["programming", "ruby"], ratings: [4, 5])
>> Book.where("'ruby' IN UNNEST(tags)").pluck(:title)
=> ["たのしい Ruby"]
>> Book.where("ARRAY_LENGTH(ratings) > 1").pluck(:title)
=> ["たのしい Ruby"]
```

## トランザクションの利用

トランザクションは一般的な方法で利用できます。

```ruby
>> ActiveRecord::Base.transaction do
>>   Post.create(text: "in transaction")
>>   raise ActiveRecord::Rollback
>> end

>> Post.where(text: "in transaction").size
=> 0
```

この使い方の場合トランザクションは [Read/Write トランザクション](https://cloud.google.com/spanner/docs/transactions?hl=ja#read-write_transactions)になります。Cloud Spanner には [Read Only トランザクション](https://cloud.google.com/spanner/docs/transactions?hl=ja#read-only_transactions)もあり、ある時点での整合性のあるデータをロックせず読み取ることができます。

```ruby
>> ActiveRecord::Base.transaction(isolation: :read_only) do
>>   Post.where(text: "I'm post").size
>> end
  SQL (7.3ms)  BEGIN read_only
  Post Count (14.2ms)  SELECT COUNT(*) FROM `posts` WHERE `posts`.`text` = @p1
  SQL (0.0ms)  COMMIT
=> 1
```

また、[過去のタイムスタンプのデータ読み取り](https://cloud.google.com/spanner/docs/timestamp-bounds?hl=ja)も可能です。

```ruby
>> post = Post.create(text: "20 seconds ago")
>> sleep 15
>> Post.update(post.id, text: "5 seconds ago")
>> sleep 5
>> ActiveRecord::Base.transaction(isolation: { timestamp: Time.now - 10.seconds }) do
>>   Post.find(post.id).text
>> end
=> "20 seconds ago"
```

[ステイルネス](https://cloud.google.com/spanner/docs/timestamp-bounds?hl=ja#bounded_staleness)を指定すると、指定した古さを許容するデータ読み取りができます。ステイルネスを利用することでパフォーマンスの向上が期待できます。例えば、次のコードでは過去30秒前より新しいデータを読み取ります。

```ruby
>> ActiveRecord::Base.transaction(isolation: { staleness: 30.seconds }) do
>>   Post.where(text: "I'm post")
>> end
```

## エミュレータの設定

初期設定のパートでスキップしてしまいましたが、Cloud Spanner には[エミュレータ](https://cloud.google.com/spanner/docs/emulator?hl=ja)が存在します。開発用途でも使えますが、特にローカルでのテストや CI に向いています。

本稿では Docker Compose での使い方を紹介します。`docker-compose.yaml` にサービスを次のように追加して `docker compose up` すればエミュレータが起動します。

```yaml:docker-compose.yaml
services:
  spanner:
    image: gcr.io/cloud-spanner-emulator/emulator
    ports:
      - 9010:9010
```

起動は簡単ですが使い方に少しクセがあります。まず、Rails アプリからエミュレータに接続する場合は `config/database.yml` に `emulator_host` を設定します。このとき、プロジェクト、インスタンス、データベースの指定も必要ですが、実際に存在するものではなく適当な名前でも大丈夫です。

```yaml:config/database.yml
test:
  adapter: spanner
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  project: hoge
  instance: hoge
  database: hoge
  emulator_host: "localhost:9010"
```

他に、環境変数 `SPANNER_EMULATOR_HOST` を設定した場合、`config/database.yml` で `emulator_host` を指定しなくてもエミュレーターを利用するようになります。これは、多くの Cloud Spanner のクライアントライブラリと共通の振る舞いです。

```sh
# エミュレーターを使ってサーバーを起動する
SPANNER_EMULATOR_HOST=localhost:9010 rails server

# エミュレーターを使ってコンソールを起動する
SPANNER_EMULATOR_HOST=localhost:9010 rails console
```

`spanner-cli` ではこの方法を使います。

```sh
SPANNER_EMULATOR_HOST=localhost:9010 spanner-cli -p rails-on-spanner -i rails-on-spanner -d rails-on-spanner
```

環境変数の挙動を知らないと変にハマってしまったりするので開発中は注意してください。データベースの挙動がおかしいときは `SPANNER_EMULATOR_HOST` を確認してみるといいでしょう。

このようにエミュレータに接続する前に、エミュレータにもインスタンスとデータベースを作成する必要があります。データベースは `db:create` で作成できるので、`db:create` の前にインスタンスを作成するようにしておけば楽になります。

```ruby:lib/cloud_spanner_admin.rb
require "google/cloud/spanner"
require "google/cloud/spanner/admin/instance"

class CloudSpannerAdmin
  DEFAULT_REGION = "asia-northeast1"

  def initialize(db_config)
    @project_id = db_config[:project]
    @instance_id = db_config[:instance]
    @emulator_host = db_config[:emulator_host]
  end

  def ensure_instance!
    pp instance_exists?
    return if instance_exists?

    instance_admin.create_instance(
      parent: project_path,
      instance_id: @instance_id,
      instance: {
        name: instance_path,
        config: instance_config_path,
        display_name: @instance_id,
        processing_units: 100
      }
    ).wait_until_done!
  end

  private

  def instance_admin
    @instance_admin ||= Google::Cloud::Spanner::Admin::Instance.instance_admin(
      project_id: @project_id,
      emulator_host: @emulator_host
    )
  end

  def instance_config_path
    @instance_config_path ||= instance_admin.instance_config_path(
      project: @project_id,
      instance_config: "regional-#{DEFAULT_REGION}"
    )
  end

  def instance_exists?
    instance_admin.list_instances(parent: project_path)
                  .any? { |instance| instance.name == instance_path }
  end

  def instance_path
    @instance_path ||= instance_admin.instance_path(
      project: @project_id,
      instance: @instance_id
    )
  end

  def project_path
    @project_path ||= instance_admin.project_path(project: @project_id)
  end
end
```

```ruby:lib/tasks/spanner.rake
require "cloud_spanner_admin"

namespace :spanner do
  namespace :instance do
    task create: :environment do
      config = ActiveRecord::Base.configurations
                                 .find_db_config(Rails.env)
                                 .configuration_hash
      admin = CloudSpannerAdmin.new(config)
      admin.ensure_instance!
    end
  end
end

Rake::Task["db:create"].enhance(["spanner:instance:create"])
```

# ハマりどころ

これまで Rails 開発で基本的な使い方を紹介しました。ここからは Cloud Spanner 特有のハマりどころを紹介します。

## use_transactional_tests が使えない

Minitest だと `use_transactional_tests`、RSpec だと `use_transactional_fixtures` が使えません。これは Cloud Spanner が `SAVEPOINT` 文をサポートしていないためです。同じ理由で `transaction(requires_new: true)` も使えません。

テストにおけるデータの削除を実現する他の方法としては [DatabaseCleaner](https://github.com/DatabaseCleaner/database_cleaner) があります。

```ruby:Gemfile
group :test do
  gem "database_cleaner-spanner"
end
```

```ruby:spec/rails_helper.rb
RSpec.configure do |config|
  config.use_transactional_fixtures = false

  config.around(:each) do |example|
    DatabaseCleaner[:spanner].cleaning do
      example.run
    end
  end
end
```

ただし、こちらの方法では並列テストで期待する動作にならない可能性があります。並列テストを使うときは、ワーカー数だけデータベースを用意するなどの工夫が必要になります。

## travel_to でエラーになる

`travel_to` で過去時間を設定したとき `Google::Cloud::DeadlineExceededError` が発生することがあります。これは、Cloud Spanner へのリクエストのタイムスタンプが過去に設定されるためリクエストがタイムアウトとみなされることが理由です。

これに関しては[タイムアウト設定を変更](https://github.com/googleapis/google-cloud-ruby/blob/main/google-cloud-spanner-v1/lib/google/cloud/spanner/v1/spanner/client.rb)することで回避できます。

```ruby
# test/test_helper.rb とかに入れておくといいかも

Google::Cloud::Spanner::V1::Spanner::Client.configure do |c|
  timeout_sec = 10 * 365 * 24 * 60 * 60 # ten years

  c.rpcs.create_session.timeout = timeout_sec
  c.rpcs.batch_create_sessions.timeout = timeout_sec
  c.rpcs.get_session.timeout = timeout_sec
  c.rpcs.list_sessions.timeout = timeout_sec
  c.rpcs.delete_session.timeout = timeout_sec
  c.rpcs.execute_sql.timeout = timeout_sec
  c.rpcs.execute_streaming_sql.timeout = timeout_sec
  c.rpcs.read.timeout = timeout_sec
  c.rpcs.streaming_read.timeout = timeout_sec
  c.rpcs.begin_transaction.timeout = timeout_sec
  c.rpcs.commit.timeout = timeout_sec
  c.rpcs.rollback.timeout = timeout_sec
  c.rpcs.partition_query.timeout = timeout_sec
  c.rpcs.partition_read.timeout = timeout_sec
end
```

## upsert とミューテーション

Cloud Spanner は upsert 用の構文[^7]をサポートしていません。Cloud Spanner で upsert を実現するためには SQL ではなく[ミューテーション](https://cloud.google.com/spanner/docs/modify-mutation-api?hl=ja) という方法を使う必要があります[^8]。そのため ActiveRecord Cloud Spanner Adapter では `upsert`/`upsert_all` メソッドをミューテーションを使って実装しています。

注意点として、Cloud Spanner はひとつのトランザクション内で SQL とミューテーションによるデータ更新を同時に扱うことができず、SQL を発行するようなトランザクション内で `upsert`/`upsert_all` メソッドを実行するとエラーになります。トランザクション内で upsert するためにはミューテーションを使うための特別なトランザクションを利用します。このトランザクションの中では SQL のかわりにミューテーションを発行します。

```ruby
>> ActiveRecord::Base.transaction(isolation: :buffered_mutations) do
>>   post = Post.new(text: "mutation")
>>   post.save
>>
>>   # upsert できる
>> end
  SQL (0.1ms)  BEGIN buffered_mutations
  SQL (239.3ms)  COMMIT
=> true

>> ActiveRecord::Base.transaction do
>>   post = Post.new(text: "DML")
>>   post.save
>>
>>   # upsert できない
>> end
  SQL (0.1ms)  BEGIN
  Post Create (32.1ms)  INSERT INTO `posts` (`text`, `created_at`, `updated_at`, `id`) VALUES (@p1, @p2, @p3, @p4)
  SQL (12.1ms)  COMMIT
=> true
```

:::message alert
ただし、現行バージョン (Rails 7.0.4、Cloud Spanner Adapter 1.2.2) ではバグのためミューテーションのトランザクション内でも upsert がエラーになります。
:::

[^7]: `ON DUPLICATE` や `ON CONFLICT`
[^8]: [DML とミューテーションの比較  |  Cloud Spanner  |  Google Cloud](https://cloud.google.com/spanner/docs/dml-versus-mutations?hl=ja)

データベースまわりでトラブルシュートが必要になったとき、その処理が SQL で実行されているか、ミューテーションで実行されているかを意識することも必要になってくるでしょう。

## テーブルコメントがない

Cloud Spanner にはテーブルやカラムにコメントをつける機能がありません。マイグレーション ファイルでコメントをつけていても無視されるので注意してください。

# 既知の不具合
## fixtures が使えない
## db:schema:load がエラーになる
## インターリブの小テーブルの保存に失敗する

上述したバグです。Rails 7.0.x では `ApplicationRecord._set_composite_primary_key_values` をオーバーライドすることで対応できます。

```ruby:app/models/application_record.rb
class ApplicationRecord < ActiveRecord::Base
  primary_abstract_class

  class << self
    def _set_composite_primary_key_values(primary_keys, values)
      primary_key_value = []
      primary_key.each do |col|
        value = values[col]

        if value&.value.nil? && prefetch_primary_key?
          value = ActiveModel::Attribute.from_database col, next_sequence_value, ActiveModel::Type::BigInteger.new
          values[col] = value
        end
        if value.is_a? ActiveModel::Attribute
          value = value.value
        end
        primary_key_value.append value
      end
      primary_key_value
    end
  end
end
```

## Generated Column は未対応

MySQL や PostgreSQL と同じように Cloud Spanner でも [Generated Column](https://cloud.google.com/spanner/docs/generated-column/how-to?hl=ja) を扱えます。しかし、現在 ActiveRecord Cloud Spanner Adapter では対応していません。

:::message
リポジトリに [Generated Column のサンプル](https://github.com/googleapis/ruby-spanner-activerecord/tree/main/examples/snippets/generated-column)はありますが、実際にはまだ対応していません。サンプル通りにマイグレーションを書くと Generated Column を持つテーブルの作成はできますがレコードの保存ができません。
:::

## upsert がエラーになる

# おわりに
