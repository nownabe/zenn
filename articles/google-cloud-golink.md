---
title: "Google Cloud で作るお手軽 Golink"
emoji: "🦭"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["gcp", "gae"]
published: false
publication_name: knowledgework
---

ナレッジワークでは業務効率化を目的として Golink を導入しています。この記事では Google Cloud で構築した Golink のアーキテクチャと、導入して1年経った今の状況を紹介します。

本記事は [Google Cloud Champion Innovators Advent Calendar 2024](https://adventar.org/calendars/10061) の 7 日目の記事です。昨日は xx さんの xx でした。


# Golink って？

Golink は一言でいうと社内限定で使える短縮 URL です。[Bitly](https://bitly.com/) のようなサービスの社内版です。社内の誰でも `go/{link_name}` という短縮 URL を作ることができ、社内の誰でもその URL を使うことができます。

Go Links や GoLinks などの表記もあるようですが、元は Google の社内で使われ始めたものがシリコンバレーの企業を中心に広まったようです。[^1]

Golink を使うことで、いくつもの URL を記憶して業務効率を向上できます。例えば、特定の Cloud Run サービスのログを確認するための URL として `go/myapp-log` を作ると、ログを見たいときにはブラウザに直接 URL を入力してすぐにアクセスできます。また、社内では誰でも利用可能なのですぐに URL を共有することもできます。

また、Golink はジャンプ先の URL を変更することもできるので、一つの URL で常に最新のものにアクセスできます。例えば、チームの議事録を quarterly で作り直している場合などは `go/myteam` を作っておき、議事録を作り直したタイミングでジャンプ先の URL を変更すればブックマークなどを変更することなく対応できます。

[^1]: [The GoLinks® Blog - The History of Go Links®](https://www.golinks.com/blog/go-links-history/)

# Google Cloud 版 Golink のアーキテクチャ

この記事で紹介する Golink は私がプライベートで OSS として開発しました。既存のサービスや他の OSS もあったのですが、微妙に自分がほしいものが見つからず開発することにしました。

https://github.com/nownabe/golink

## 要件

自分がほしかった要件は次のようなものでした。

* Google Cloud で完結する
* アーキテクチャがシンプルである
* お金がかからない
* DNS の操作が不要である
* Chrome 拡張の [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate) に対応している

下 2 つを補足します。Golink ではブラウザの URL 欄に `go/foo` と入力して、何らかの方法で正しい URL に飛ばす必要があります。方法の 1 つとして、`go` というホスト名から Golink のサーバーの IP を引けるようにするという方法があります。調べるとそれなりにこの方法が採用されている Golink の実装がありました。この方法では DNS サーバーに設定を入れたり、各社員の `/etc/hosts` を操作したりが必要になります。

他に Chrome 拡張を利用する方法があります。Golink の Chrome 拡張で `go/foo` という URL に介入し処理します。もちろん Chrome 拡張をインストールする必要があります。

企業や個人で使うことを考えたとき、全 PC に DNS 設定をいれるより、全 PC に Chrome 拡張をいれる方が楽だと判断しました。また、DNS の方法だとサーバーでリダイレクトするというアーキテクチャにするときに HTTPS が使えないし、Google Cloud の Identity-Aware Proxy も使えません。

Chrome 拡張で実装された Golink もいくつかあったのですが、当時は Manifest V3 で実装されたものがありませんでした。

## アーキテクチャ

アーキテクチャは次のようになっています。

![architecture](/images/articles/google-cloud-golink/architecture.png)

### Firestore

無料で使えるデータベースとして [Firestore](https://cloud.google.com/firestore) を採用しました。リレーションもほぼなく key-value で次のようなドキュメントを保存しているだけです。

```js
{
  name: "myapp-log",
  url: "https://console.cloud.google.com/logs/query;query=...",
  owners: ["foo@example.com", "bar@example.com"]
}
```

これは `go/myapp-log` で Cloud Logging にアクセスするためのデータです。`owners` はリンクを編集できる人です。

### Identity-Aware Proxy

Golink は社内に閉じることが重要です。そのために [Identity-Aware Proxy](https://cloud.google.com/security/products/iap) を採用しています。

### App Engine

バックエンドのサーバーアプリケーションとフロントエンドをホストするために [App Engine standard environment](https://cloud.google.com/appengine/docs/standard) を利用しています。[Cloud Run](https://cloud.google.com/run) が利用できればよかったんですが、Identity-Aware Proxy と Cloud Run を組み合わせて使うためにはロードバランサーが必要となり、コンポーネントが増えてコストもかかるため App Engine を採用しました。とはいえ App Engine も素晴らしいサービスなので今のところ満足しています。

1 つの App Engine サービスで管理ポータル、API サーバー、リダイレクトサーバーをホストしています。

管理ポータルでは Golink の作成や編集などができます。[Next.js](https://nextjs.org/) で実装していますが Next.js のサーバーは使っておらず、App Engine から静的ファイルとして配信しています。

リダイレクトサーバーは `/myapp-log` というパスでリクエストが来ると Firestore に登録されている URL にリダイレクトします。Go で実装しています。

API サーバーは管理ポータルや Chrome 拡張からの API リクエストを処理します。Go で実装された [Connect](https://connectrpc.com/) のサーバーです。

App Engine の `app.yaml` は次のようになっています。

```
runtime: go121
instance_class: F1
automatic_scaling:
  target_cpu_utilization: 0.95
  target_throughput_utilization: 0.95
  min_idle_instances: 0
  max_idle_instances: 1
  min_instances: 0
  max_instances: 1
  min_pending_latency: 5000ms
  max_pending_latency: automatic
  max_concurrent_requests: 100
handlers:
  - url: /-/assets
    static_dir: console/-/assets
    expiration: 1d
    secure: always
    redirect_http_response_code: 301
  - url: /-/.*
    static_files: console/index.html
    upload: console/index\.html
    expiration: 1d
    secure: always
    redirect_http_response_code: 301
  - url: /.*
    script: auto
    secure: always
    redirect_http_response_code: 301
main: ./cmd/backend
```

### Chrome 拡張

Chrome 拡張は `http://go/*` という URL にアクセスしたとき、App Engine の URL にリダイレクトします。つまり、`http://go/myapp-log` にアクセスしたとき、Chrome 拡張が `https://PROJECT-ID-an.r.appspot.com/myapp-log` (App Engine の URL) にリダイレクトします。これをさらにリダイレクトサーバーが登録された URL にリダイレクトすることで、Golink の機能を実現しています。

# ナレッジワークでの利用状況

ナレッジワークでは URL にまつわる認知負荷を軽減すべく Platform Engineering の一環として Golink を導入しました。

約 1 年ほど運用して、だいたい 200〜300 個の Golink があるようです (ちゃんと数えてない)。過去30日間で 500 回ほどリダイレクトしていました。まだまだ社内に広く普及しているとは言えないような数ですね。

このような状況で過去1年間の合計料金は 70 円でした。平均 5 円/月です。Cloud Storage と Cloud Trace に課金されています。Cloud Storage にはコンテナイメージが保存されいるのでそれが課金されています。そういえば Container Registry がサービス終了すると App Engine はどうなるんでしょうか。2025年3月に終了予定なのでこちらは確認する必要がありそうです。

# おわりに

本記事では Google Cloud で構築した Golink のアーキテクチャと、ナレッジワーク社内で運用した状況を紹介しました。Golink を活用するととても URL の扱いがとても楽になるので、ぜひ使ってみてください。

明日の [Google Cloud Champion Innovators Advent Calendar 2024]() は xx さんです。お楽しみに！
