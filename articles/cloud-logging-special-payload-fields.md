---
title: "Cloud Logging 構造化ログの特別な JSON フィールドまとめ"
emoji: "🪵"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [gcp,googlecloud,cloudlogging,log]
published: true
publication_name: knowledgework
---

:::message
本記事は[株式会社ナレッジワーク](https://kwork.studio)の [Publication](https://zenn.dev/p/knowledgework) で公開されています。
:::

Google Cloud のログ管理サービスである [Cloud Logging](https://cloud.google.com/logging/docs/overview) は JSON で出力されたログを[構造化ログ](https://cloud.google.com/logging/docs/structured-logging?hl=ja)として認識します。その中でも、いくつかの[特別な JSON フィールド](https://cloud.google.com/logging/docs/structured-logging?hl=ja#special-payload-fields)を使ってログに特別な属性を与える事ができます。本記事ではそれらの特別な JSON フィールドを用途ごとにまとめて紹介します。

本記事の技術的な内容はほぼすべて[このドキュメント 1 ページ](https://cloud.google.com/logging/docs/structured-logging?hl=ja)に書いてありますが、「実際に UI でどう表示されるのか」と「その特別な JSON フィールドにどんな価値があるのか」はドキュメントにないので参考にしていただけると思います。

# Cloud Logging へのログ書き込み

Cloud Logging へログを書き込むには大きく 2 つの方法があります。[API](https://cloud.google.com/logging/docs/reference/v2/rpc/google.logging.v2#google.logging.v2.LoggingServiceV2) で [LogEntry](https://cloud.google.com/logging/docs/reference/v2/rpc/google.logging.v2#logentry) を直接書き込むか、それ以外かです。

API で直接書き込む方法の場合、メジャーな言語であれば各言語のライブラリを使うことで実現できます。それ以外の方法では標準出力やファイルなどに 1 行 1 ログエントリとしてログを出力することで Cloud Logging にログを書き込みます。例えば Cloud Run で標準出力に次のような 2 行の出力があった場合、2 つの LogEntry が Cloud Logging に書き込まれます。

```shell
$ python main.py
この行が 1 つ目の LogEntry になる
この行が 2 つ目の LogEntry になる
```

本記事では後者の中でも構造化ログと呼ばれるものを対象とします。構造化ログは次のように 1 行にひとつの JSON オブジェクトが出力されるログのことです。

```shell
$ python main.py
{"text":"この JSON オブジェクトが 1 つ目の LogEntry になる"}
{"text":"この JSON オブジェクトが 2 つ目の LogEntry になる"}
```

# Cloud Logging の仕組み

特別な JSON フィールドを紹介する前に「ログに特別な属性を与える」とはどういうことなのかを説明します。

次のスクリーンショットは Cloud Logging のコンソール画面です。

![Cloud Logging UI](/images/articles/cloud-logging-special-payload-fields/cloud-logging-ui.png)

右下に表示されている 1 行 1 行がひとつのログエントリであり、API で [google.logging.v2.LogEntry](https://cloud.google.com/logging/docs/reference/v2/rpc/google.logging.v2#logentry) として定義されています。Cloud Logging では JSON でログを書き込めば `jsonPayload` フィールドにその JSON オブジェクトが格納された LogEntry が作成されます。これを構造化ログを呼びますが、出力する JSON に「特別な JSON フィールド」をもたせることで JSON から LogEntry のフィールドを操作できます。

例えば次のような JSON を出力します (見やすくしていますが実際は 1 行です。以降も見やすさのため改行を入れている場合があります)。

```json
{
  "message": "log message",
  "key1": "value1",
  "logging.googleapis.com/labels": {
    "label1": "label-value-1",
    "label2": "label-value-2"
  }
}
```

すると LogEntry は次のようになります。

```js
{
  jsonPayload: {
    key1: "value1",
    message: "log message"
  },
  labels: {
    label1: "label-value-1",
    label2: "label-value-2"
  }
}
```

このように JSON にある特定のフィールド名で値を設定すると、LogEntry のフィールドを設定できるようになっています。これを上では「ログに特別な属性を与える」と表現しました。

# 必ずおさえておきたい特別な JSON フィールド

まずは Google Cloud 上でアプリケーションを開発する際に必ず理解して使いこなしておきたい特別な JSON フィールドを紹介します。

## message

`message` JSON フィールドに文字列を設定するとコンソール上でその文字列が表示されます。

`message` フィールドがない場合は JSON がすべて表示されます (スクリーンショットの一番上です)。

```json
{"text":"Hello, Cloud Logging!","key1":"value1","key2":"value2"}
```

![message-before](/images/articles/cloud-logging-special-payload-fields/message-before.png)

`message` フィールドがある場合はその値が表示されます。

```json
{"message":"Hello, Cloud Logging!","key1":"value1","key2":"value2"}
```

![message-after](/images/articles/cloud-logging-special-payload-fields/message-after.png)

`message` フィールドに関しては少し特殊で、必ず LogEntry のフィールドにマッピングされるというわけではありません。`jsonPayload` に `message` しかない場合は `jsonPayload` が `textPayload` に変換され、その結果コンソールでの表示も変化します。それ以外の場合は LogEntry に変化はありません。

## severity

`severity` JSON フィールドに [LogSeverity 型 (Enum)](https://cloud.google.com/logging/docs/reference/v2/rpc/google.logging.type#google.logging.type.LogSeverity) を表す文字列を設定すると LogEntry の重大度を設定できます。LogSeverity には次の 9 種類があります。

| 名前 | 数値 | 意味 |
|------|-----|-----|
| DEFAULT | 0 | 重大度が設定されていない |
| DEBUG | 100 | デバッグまたはトレース情報 |
| INFO | 200 | 進行中のステータスやパフォーマンスなど日常的な情報 |
| NOTICE | 300 | スタートアップ、シャットダウン、設定変更など平常だが大きなイベント |
| WARNING | 400 | 問題を起こす可能性がある警告イベント |
| ERROR | 500 | 問題を起こす可能性が高いエラーイベント |
| CRITICAL | 600 | より深刻な問題や機能停止を起こすクリティカルイベント |
| ALERT | 700 | すぐに人間がアクションを取る必要がある |
| EMERGENCY | 800 | 一つ以上のシステムが利用できない |

`severity` フィールドがない場合は `DEFAULT` が設定されます。

```json
{"message":"Hello, Cloud Logging!","key1":"value1","key2":"value2"}
```

![severity-before](/images/articles/cloud-logging-special-payload-fields/severity-before.png)

`severity` フィールドがある場合は対応した LogSeverity が設定されます。

```json
{"message":"Hello, Cloud Logging!","severity":"ERROR","key1":"value1"}
```

![severity-after](/images/articles/cloud-logging-special-payload-fields/severity-after.png)

コンソールでは次のスクリーンショットのように LogSeverity によってアイコンが異なり視認しやすくなります。`DEFAULT` を除く LogSeverity が 8 種類あるのに対してアイコンは 5 種類しかないため、LogSeverity によっては同じアイコンが使用されます。

![severity-icons](/images/articles/cloud-logging-special-payload-fields/severity-icons.png)

LogSeverity を設定しておくと Log fields ペインで LogSeverity によるフィルタリングができます。ワンクリックでエラーログのみを表示するといったことが可能です。

![severity-log-fields](/images/articles/cloud-logging-special-payload-fields/severity-log-fields.png)

LogSeverity にはそれぞれ数値が設定されており大小で比較できます。次のようなクエリが可能です。

```
severity >= WARNING AND severity <= ALERT
```

![severity-query](/images/articles/cloud-logging-special-payload-fields/severity-query.png)

LogSeverity は 9 種類すべてを使う必要はなく、チームでどの LogSeverity をどのような基準で使うかを決めておくといいでしょう。アイコンで区別できる 5 種類を選択するぐらいがよさそうです。

## time

`time` JSON フィールドに RFC3339 フォーマットの日付を設定すると LogEntry の [timestamp](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#FIELDS.timestamp) を設定できます。

次の例は 30 分未来の `time` を設定したときの結果です。`timestamp` が `receiveTimestamp` の 30 分未来に設定されています。`receiveTimestamp` は出力専用フィールドで Cloud Logging がログを受信したタイムスタンプです。

```json
{
  "message": "Hello, Cloud Logging! with time",
  "severity": "INFO",
  "time": "2023-10-14T07:53:13.000000000Z",
  "key1": "value1"
}
```

![time](/images/articles/cloud-logging-special-payload-fields/time.png)

同じく `timestamp` を設定するための特別な JSON フィールドとして `timestamp` フィールドや `timestampSeconds` / `timestampNanos` フィールドがありますが使い勝手が悪いため本記事では割愛します。

`timestamp` は自動で設定されるため必須のフィールドではありませんが、多くのログライブラリは時刻を出力できるので `time` JSON フィールドにあわせてフォーマットを設定しておくといいでしょう。

## sourceLocation

`logging.googleapis.com/sourceLocation` JSON フィールドで LogEntry に関連するソースコードの位置情報を設定できます。位置情報は [LogEntrySourceLocation](https://cloud.google.com/logging/docs/reference/v2/rpc/google.logging.v2#google.logging.v2.LogEntrySourceLocation) 型で設定します。

```json
{
  "message": "Hello, Cloud Logging! with sourceLocation",
  "severity": "INFO",
  "key1": "value1",
  "logging.googleapis.com/sourceLocation": {
    "file": "main.rb",
    "line": "85",
    "function": "in `some_func'"
  }
}
```

![sourceLocation](/images/articles/cloud-logging-special-payload-fields/sourceLocation.png)

`sourceLocation` を設定しておくことでそのログを出力したコードに素早くたどり着けるようになります。

## trace、spanId、traceSampled

特別な JSON フィールドを使って LogEntry を [Cloud Trace](https://cloud.google.com/trace?hl=ja) の Trace や Span と紐付けることができます。次の 3 つのフィールドがあります。

* `logging.googleapis.com/trace`: `"projects/{projectId}/traces/{traceId}"` を設定することで Trace と紐付ける
* `logging.googleapis.com/spanId`: `"{spanId}"` を設定することで Span と紐付ける
* `logging.googleapis.com/trace_sampled`: boolean[^1]

[^1]: [Trace Context](https://www.w3.org/TR/trace-context/#sampled-flag)

```json
{
  "message": "Hello, Cloud Logging! with trace",
  "severity": "INFO",
  "key1": "value1",
  "logging.googleapis.com/trace": "projects/glass-archway-401508/traces/0b46338eb49895d2d02ab16ed740197c",
  "logging.googleapis.com/spanId": "04be1f2f17504cc4",
  "logging.googleapis.com/trace_sampled": true
}
```

![trace-log](/images/articles/cloud-logging-special-payload-fields/trace-log.png)

ログメッセージの先頭に表示されている Cloud Trace のアイコンをクリックすることで同じ Trace に紐づくログのみを表示したり、次のスクリーンショットのように Trace を表示できます。

![trace-logging-to-trace](/images/articles/cloud-logging-special-payload-fields/trace-logging-to-trace.png)

また、Cloud Trace からその Trace や Span に紐づくログを表示できます。

![trace-trace-to-logging](/images/articles/cloud-logging-special-payload-fields/trace-trace-to-logging.png)

従来は Request ID などを使ってひとつのリクエストに関するログの追跡をしていましたが、Google Cloud では多くのサービスが Cloud Trace と連携できるようになっているのでログに関しても Cloud Trace と紐づくようにこれらの特別な JSON フィールドを設定しておくといいでしょう。

## stack_trace

`stack_trace` JSON フィールドにスタックトレースがあると [Error Reporting](https://cloud.google.com/error-reporting) にエラーとして報告されます。エラーとして報告するためには Severity が `DEFAULT` または `ERROR` 以上である必要があります[^2]。

[^2]: `ERROR` 未満でもエラーを報告する方法はあります。必要な場合は[ドキュメント](https://cloud.google.com/error-reporting/docs/formatting-error-messages?hl=ja)を参照してください。

```json
{
  "message": "some error",
  "severity": "ERROR",
  "key1": "value1",
  "stack_trace": "some error\nmain.rb:117:in `some_error_func'\nmain.rb:122:in `block in <main>'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1763:in `call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1763:in `block in compile!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1066:in `block (3 levels) in route!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1084:in `route_eval'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1066:in `block (2 levels) in route!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1115:in `block in process_route'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1113:in `catch'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1113:in `process_route'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1064:in `block in route!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1061:in `each'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1061:in `route!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1185:in `block in dispatch!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `catch'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `invoke'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1180:in `dispatch!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:996:in `block in call!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `catch'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `invoke'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:996:in `call!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:985:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/xss_header.rb:20:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/path_traversal.rb:18:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/json_csrf.rb:28:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/base.rb:53:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/base.rb:53:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/frame_options.rb:33:in `call'\n/usr/local/bundle/gems/rack-2.2.8/lib/rack/null_logger.rb:11:in `call'\n/usr/local/bundle/gems/rack-2.2.8/lib/rack/head.rb:12:in `call'\n/usr/local/bundle/gems/rack-2.2.8/lib/rack/method_override.rb:24:in `call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:219:in `call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:2074:in `call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1633:in `block in call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1849:in `synchronize'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1633:in `call'\n/usr/local/bundle/gems/rack-2.2.8/lib/rack/handler/webrick.rb:95:in `service'\n/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/httpserver.rb:140:in `service'\n/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/httpserver.rb:96:in `run'\n/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/server.rb:310:in `block in start_thread'"
}
```

![stack-trace-log](/images/articles/cloud-logging-special-payload-fields/stack-trace-log.png)

ログメッセージの先頭に Error Reporting のアイコンが表示され、クリックすると同じエラーグループのログを表示したり、次のスクリーンショットのような Error Reporting のコンソールにジャンプしたりできます。

![stack-trace-error-reporting](/images/articles/cloud-logging-special-payload-fields/stack-trace-error-reporting.png)

上記 JSON の `stack_trace` フィールドの値を抜き出すとこうなっています。

```
some error
main.rb:117:in `some_error_func'
main.rb:122:in `block in <main>'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1763:in `call'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1763:in `block in compile!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1066:in `block (3 levels) in route!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1084:in `route_eval'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1066:in `block (2 levels) in route!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1115:in `block in process_route'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1113:in `catch'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1113:in `process_route'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1064:in `block in route!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1061:in `each'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1061:in `route!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1185:in `block in dispatch!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `catch'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `invoke'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1180:in `dispatch!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:996:in `block in call!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `catch'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `invoke'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:996:in `call!'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:985:in `call'
/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/xss_header.rb:20:in `call'
/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/path_traversal.rb:18:in `call'
/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/json_csrf.rb:28:in `call'
/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/base.rb:53:in `call'
/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/base.rb:53:in `call'
/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/frame_options.rb:33:in `call'
/usr/local/bundle/gems/rack-2.2.8/lib/rack/null_logger.rb:11:in `call'
/usr/local/bundle/gems/rack-2.2.8/lib/rack/head.rb:12:in `call'
/usr/local/bundle/gems/rack-2.2.8/lib/rack/method_override.rb:24:in `call'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:219:in `call'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:2074:in `call'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1633:in `block in call'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1849:in `synchronize'
/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1633:in `call'
/usr/local/bundle/gems/rack-2.2.8/lib/rack/handler/webrick.rb:95:in `service'
/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/httpserver.rb:140:in `service'
/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/httpserver.rb:96:in `run'
/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/server.rb:310:in `block in start_thread'
```

これは Ruby のスタックトレースですが、Java、Python、JavaScript、Ruby、C#、PHP、Go に対応しています。各言語のフォーマットなどの詳細は[ドキュメント](https://cloud.google.com/error-reporting/reference/rest/v1beta1/projects.events/report#reportederrorevent)を参照してください。

`stack_trace` フィールドの 1 行目をエラーメッセージにしておくと Error Reporting がそれをエラーメッセージとして扱います。また、1 行目を `error message (FOO)` のようにしておくとカッコ内の文字が抽出されて `FOO: error message` のように表示されます。例えば `"Runtime Error some error (#{severity})"` と出力するようにしておくと次のように表示されます。

![stack-trace-severity](/images/articles/cloud-logging-special-payload-fields/stack-trace-severity.png)

`stack_trace` JSON フィールドは他のフィールドと異なり LogEntry を操作しません。かわりに Error Reporting の [ReportedErrorEvent](https://cloud.google.com/error-reporting/reference/rest/v1beta1/projects.events/report#reportederrorevent) を[レポート](https://cloud.google.com/error-reporting/reference/rest/v1beta1/projects.events/report)します。`stack_trace` フィールドの値は次のように `ErrorEvent` の `message` フィールドに格納されます。

```json
{
  "errorEvents": [
    {
      "eventTime": "2023-10-21T03:36:56.426003Z",
      "serviceContext": {
        "service": "cloud-logging",
        "version": "cloud-logging-00021-4n9",
        "resourceType": "cloud_run_revision"
      },
      "message": "RuntimeError some error (ERROR)\nmain.rb:117:in `some_error_func'\nmain.rb:123:in `block in \u003cmain\u003e'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1763:in `call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1763:in `block in compile!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1066:in `block (3 levels) in route!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1084:in `route_eval'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1066:in `block (2 levels) in route!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1115:in `block in process_route'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1113:in `catch'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1113:in `process_route'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1064:in `block in route!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1061:in `each'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1061:in `route!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1185:in `block in dispatch!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `catch'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `invoke'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1180:in `dispatch!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:996:in `block in call!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `catch'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1156:in `invoke'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:996:in `call!'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:985:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/xss_header.rb:20:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/path_traversal.rb:18:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/json_csrf.rb:28:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/base.rb:53:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/base.rb:53:in `call'\n/usr/local/bundle/gems/rack-protection-3.1.0/lib/rack/protection/frame_options.rb:33:in `call'\n/usr/local/bundle/gems/rack-2.2.8/lib/rack/null_logger.rb:11:in `call'\n/usr/local/bundle/gems/rack-2.2.8/lib/rack/head.rb:12:in `call'\n/usr/local/bundle/gems/rack-2.2.8/lib/rack/method_override.rb:24:in `call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:219:in `call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:2074:in `call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1633:in `block in call'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1849:in `synchronize'\n/usr/local/bundle/gems/sinatra-3.1.0/lib/sinatra/base.rb:1633:in `call'\n/usr/local/bundle/gems/rack-2.2.8/lib/rack/handler/webrick.rb:95:in `service'\n/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/httpserver.rb:140:in `service'\n/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/httpserver.rb:96:in `run'\n/usr/local/bundle/gems/webrick-1.8.1/lib/webrick/server.rb:310:in `block in start_thread'"
    }
  ],
  "timeRangeBegin": "2023-10-14T04:00:51Z"
}
```

この方法は `stack_trace` JSON フィールドだけでなく、`exception` や `message` フィールドがスタックトレースを含む場合でも同様に動作します。他にも細かい使い方がありますが、詳細は次のドキュメントを参照してください。

[ログでエラーをフォーマットする  |  Error Reporting  |  Google Cloud](https://cloud.google.com/error-reporting/docs/formatting-error-messages?hl=ja)

# 便利に使える特別な JSON フィールド

必須ではないが便利に使える特別な JSON フィールドを紹介します。

## labels

`logging.googleapis.com/labels` JSON フィールドに任意のキー・バリューマップを設定すると、それを LogEntry の [labels](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#FIELDS.labels) に設定できます。キー・バリューはどちらも文字列です。

```json
{
  "message": "Hello, Cloud Logging! with labels",
  "severity": "INFO",
  "key1": "value1",
  "logging.googleapis.com/labels": {
    "label1": "value1",
    "label2": "value2"
  }
}
```

![labels-log](/images/articles/cloud-logging-special-payload-fields/labels-log.png)

LogEntry の `labels` フィールドは Google Cloud のシステム側でも利用されるため、開発者が設定したものとシステムが設定したものが混在する形になります。

`jsonPayload` にも任意のキー・バリューは設定できますが、アプリケーションで共通のものやユーザー情報などを設定しておくとログをクエリするときなどに便利です。

## httpRequest

`httpRequest` JSON フィールドを使うと LogEntry の httpRequest フィールドを設定できます。次のように [HttpRequest](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#httprequest) 型の値を用います。

```json
{
  "message": "Hello, Cloud Logging! with httpRequest",
  "severity": "INFO",
  "key1": "value1",
  "httpRequest": {
    "requestMethod": "GET",
    "requestUrl": "https://cloud-logging-vnt56eluaq-uc.a.run.app/http_request",
    "requestSize": "123",
    "status": 200,
    "responseSize": "456",
    "userAgent": "curl/7.81.0",
    "remoteIp": "169.254.1.1",
    "serverIp": "172.0.0.1",
    "latency": "3.5s",
    "cacheLookup": false,
    "cacheHit": false,
    "cacheValidatedWithOriginServer": false,
    "cacheFillBytes": "0",
    "protocol": "HTTP/1.1"
  }
}
```

![http-request-log](/images/articles/cloud-logging-special-payload-fields/http-request-log.png)

httpRequest を設定するとスクリーンショットのように HTTP メソッドやステータスコード、ユーザーエージェントなどが視認しやすくなります。これらをクリックするとマッチするログだけをフィルタリング可能です。また、リクエスト URL がメッセージとして表示されます。

アプリケーションでアクセスログなど出力する場合に利用すると視認性やクエリ効率性の向上が期待できます。HttpRequest には不必要なフィールドも多いのでアプリケーションレイヤーのアクセスログとしては必要なフィールドのみを使うことになるでしょう。


# 出番があまりなさそうな特別な JSON フィールド

以降の特別な JSON フィールドはあまり使い所がなさそうなので詳細な説明は省略します。

## insertId

`logging.googleapis.com/insertId` JSON フィールドを使うと LogEntry の insertId フィールドを設定できます。`timestamp` と `insertId` どちらも同じ LogEntry が複数存在すると、それらは重複しているとみなされてクエリ結果でひとつになります。ただし、必ず重複排除されるわけではありません。


## operation

`logging.googleapis.com/operation` JSON フィールドを使うと LogEntry の [operation](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#FIELDS.operation) フィールドを設定できます。長時間実行されるようなオペレーションのログを表現するためのフィールドですが、Cloud Logging での特別扱いもなく、オペレーションのトラッキングにも Cloud Tracing のフィールドを使うのが良いでしょう。次のような [LogEntryOperation](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#logentryoperation) 型の値を用います。

```js
{
  "id": string,
  "producer": string,
  "first": boolean,
  "last": boolean
}
```

# おわりに

本記事では Cloud Logging 構造化ログの特別な JSON フィールドとそのフィールドにどんな価値がありどのように表示されるのかを紹介しました。
他にもこういう使い方をすると便利ですよという使い方があればぜひ教えてください。

本記事の内容の一部は [Encraft #7 AppDev with Google Cloud](https://zenn.dev/knowledgework/articles/22670f39b86615) で発表しているので興味があればそちらも参照してください。

最後に、ナレッジワークではログや Observability にこだわりのあるソフトウェアエンジニアや SRE を絶賛募集しています。

https://kwork.studio/recruit-engineer

まずはお気軽にカジュアル面談も大歓迎です。

https://kitene.in/recruit-detail/1697865081929x220559030949249020