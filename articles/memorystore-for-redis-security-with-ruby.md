---
title: "セキュリティが有効な Memorystore for Redis に Ruby から接続する方法"
emoji: "🔒"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [Ruby, GCP, Memorystore, Redis]
published: false
---

# はじめに

セキュリティ オプションを有効にした [Memorystore for Redis](https://cloud.google.com/memorystore/docs/redis/redis-overview?hl=ja) インスタンスに Ruby から接続する方法を紹介します。

Memorystore for Redis のセキュリティ オプションは 3 種類あります。

* [Redis AUTH](https://cloud.google.com/memorystore/docs/redis/auth-overview?hl=ja)
* [転送中の暗号化](https://cloud.google.com/memorystore/docs/redis/in-transit-encryption?hl=ja)
* [お客管理の暗号鍵 (CMEK)](https://cloud.google.com/memorystore/docs/redis/cmek?hl=ja)

このうちクライアントからの接続に関係する **Redis AUTH** と**転送中の暗号化**について簡単に紹介し、それぞれが有効なときに Ruby から接続する方法を紹介します。

Ruby の Redis クライアントには [redis](https://github.com/redis/redis-rb) Gem を利用します。

# サンプル

本記事の内容を一通り試すためのサンプルを用意しました。

https://github.com/nownabe/example-google-cloud-ruby/tree/main/cloudrun-memorystore-redis

Cloud Run から ４種類の設定で構成された Memorystore for Redis インスタンスにそれぞれアクセスするというサンプルです。

同梱の Terraform では、Cloud Run から Redis インスタンスに接続するときに必要なネットワーク設定 ([Private Service Access](https://cloud.google.com/vpc/docs/configure-private-services-access?hl=ja) や [Serverless VPC Access](https://cloud.google.com/vpc/docs/configure-serverless-vpc-access?hl=ja)) や AUTH 文字列と CA を [Secret Manager](https://cloud.google.com/secret-manager?hl=ja) に設定するコードも含まれています。


# Redis AUTH

Redis の [AUTH コマンド](https://redis.io/commands/auth/) を使った認証です。いわゆるパスワード認証です。

次のようにして AUTH が有効なインスタンスを作成できます。

```sh
gcloud redis instances create auth-instance \
  --region asia-northeast1 \
  --enable-auth
```

Memorystore for Redis ではインスタンスで AUTH が有効になると UUID 形式の AUTH 文字列が生成されます。クライアントはその AUTH 文字列で認証します。

AUTH 文字列は次のコマンド取得できます。また、Web コンソールでも確認できます。

```sh
gcloud redis instances get-auth-string auth-instance \
  --region asia-northeast1 
```

このインスタンスに Ruby から接続するコードはこちらになります。

```ruby
require "redis"

redis = Redis.new(
  host: "10.232.151.35", # インスタンスのエンドポイント
  password: "8af4db94-887a-438f-bc9f-97877848e4ea", # AUTH 文字列
)
```

もしくは次のようにもできます。

```ruby
redis = Redis.new(host: "10.232.151.35")
redis.call("AUTH", "8af4db94-887a-438f-bc9f-97877848e4ea")
```

# 転送中の暗号化

転送中の暗号化を有効にすると、Redis とクライアントのすべてのトラフィックを TLS で暗号化します。

https://redis.io/docs/manual/security/encryption/

次のコマンドで転送中の暗号化が有効なインスタンスを作成できます。

```sh
gcloud redis instances create tls-instance \
  --region asia-northeast1 \
  --transit-encryption-mode server-authentication
```

転送中の暗号化が有効な Redis インスタンスにはサーバー確認に使用される認証局 (CA) があります。クライアントではこの CA を利用してサーバー証明書を検証する必要があります。
転送中の暗号化を有効にした場合、CA 証明書の有効期限が 10 年に設定されていたり、接続上限が設定されたりするので注意が必要です。[^1]

[^1]: [転送中の暗号化  |  Memorystore for Redis  |  Google Cloud](https://cloud.google.com/memorystore/docs/redis/in-transit-encryption?hl=ja)

CA 証明書は次のコマンドで確認できます。

```sh
gcloud redis instances describe tls-instance \
  --region asia-northeast1 \
  --format json \
  | jq -r ".serverCaCerts[].cert" 
```

例:

```sh
❯ gcloud redis instances describe tls-instance \
  --region asia-northeast1 \
  --format json \
  | jq -r ".serverCaCerts[].cert"
-----BEGIN CERTIFICATE-----
MIIDnTCCAoWgAwIBAgIBADANBgkqhkiG9w0BAQsFADCBhTEtMCsGA1UELhMkYjVk
NGY1NmQtYjMwYi00NmEyLWI5YjUtMTYzYWVlODM4YzA5MTEwLwYDVQQDEyhHb29n
bGUgQ2xvdWQgTWVtb3J5c3RvcmUgUmVkaXMgU2VydmVyIENBMRQwEgYDVQQKEwtH
b29nbGUsIEluYzELMAkGA1UEBhMCVVMwHhcNMjIwOTA0MDQxNTI5WhcNMzIwOTAx
MDQxNjI5WjCBhTEtMCsGA1UELhMkYjVkNGY1NmQtYjMwYi00NmEyLWI5YjUtMTYz
YWVlODM4YzA5MTEwLwYDVQQDEyhHb29nbGUgQ2xvdWQgTWVtb3J5c3RvcmUgUmVk
aXMgU2VydmVyIENBMRQwEgYDVQQKEwtHb29nbGUsIEluYzELMAkGA1UEBhMCVVMw
ggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDHEJU2wAyLPSebRbSaPl0Y
K95hrBcimOGMxrkpIUTF4w/YTE1qlK0glON1ZmgoG3FRTsz76jHK2M9BXLUC7Ci9
6JYY3egSWaf+zZvyZNRjLt/92Zj62MO+/fcrU7ABxMdSFuT3G3IrvXlr5qJSHI5y
DIfHhMYjVW5NNiCDR36HsboTJnHceJSJZD7QSniuQIQzx1CbcCwWko0qy6pN+5Zi
S3bgPeH/gs74eFhyEKvnxCjan7Z9Qs9pDbyF/SeiV/H2NMMXJwxdKau82ixvViCQ
SNl8bOpfvCEkS/ssQShcUJ13mrmyhvAZf9hZ071nMeukFGFPi1gZvlshKSZExcBX
AgMBAAGjFjAUMBIGA1UdEwEB/wQIMAYBAf8CAQAwDQYJKoZIhvcNAQELBQADggEB
ALKfnKx0oKKfOJC6KjWc6Q7/JJyEarscfJ/ViG9SGTkY5FEMIITHwI/obwNsnRP5
4KPY8u5FEKMdh362jWZQHpgcQrCHk5M5Wvc40poYMMLuKbIh0cQUZonkFcYlsf8h
w0q9BgiWDjNgo95CTT1/J5ms/slgO5W2DycxFNH7NDOzqzrNjQId++jRK0Xr/U7u
Ah/HK8JHs/pUPtPOgluMbduv8kUQqscD7SF7wkpl7ggNB5VUL0vdG4giv00aY4y0
Y/xoUK0KEqrtW+AohnmPXSf61APU3jJwC8EFRlqZ9FYIF+Tgapbjc3maYDmZdTEX
FFkNYATunv34hWpawTtsKvw=
-----END CERTIFICATE-----
```

これを例えば `/path/to/redis-ca.pem` にファイルとして保存して、次の Ruby コードで Redis インスタンスに接続できます。

```ruby
redis = Redis.new(
  host: "10.226.48.11",
  port: 6378,
  ssl: true,
  ssl_params: { ca_file: "/path/to/redis-ca.pem" },
)
```

ssl に関するパラメータが必要なことと、ポート番号が変わることに注意が必要です。

# AUTH と転送中の暗号化の両方を設定した場合

このようになります。

```ruby
redis = Redis.new(
  host: "10.226.48.11",
  port: 6378,
  password: "8af4db94-887a-438f-bc9f-97877848e4ea",
  ssl: true,
  ssl_params: { ca_file: "/path/to/redis-ca.pem" },
)
```

# おわりに

本記事では必要な部分だけ抜粋しましたが、実際の利用を想定した全体像はサンプルを眺めてみてもらうとわかりやすいと思います。

https://github.com/nownabe/example-google-cloud-ruby/tree/main/cloudrun-memorystore-redis
