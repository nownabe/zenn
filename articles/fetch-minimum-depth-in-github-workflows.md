---
title: "GitHub Actions workflows で Pull Request の差分コミットだけ fetch する"
emoji: "🐙"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: [GitHub]
published: true
---

Pull Request の diff から何かを確認したいときや、Pull Request に含まれるコミットそれぞれをチェックしたい場合、Pull Request の base (例えば `main`) からその Pull Request の最新コミットまでを含む履歴が必要になります。このとき、リポジトリすべての履歴ではなく、必要な履歴のみを取得すると CI の高速化が可能です。

GitHub Actions workflows の [actions/checkout](https://github.com/actions/checkout) はデフォルトで `fetch-depth` が `1` に設定されていて最新のコミットのみを取得するようになっています。Pull Request に複数コミットが含まれる場合、これでは base との diff はとれません。`fetch-depth` を `0` に設定するとすべての履歴を取得できますが、巨大なリポジトリでは時間がかかります。

Pull Request でトリガーされる workflow の場合、[GitHub context](https://docs.github.com/en/actions/learn-github-actions/contexts#github-context) の `event` プロパティに [pull_requet](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request) オブジェクトが含まれています。次のようにするとベースからの履歴のみを取得できます。

```yaml
- run: echo "fetch_depth=$(( commits + 1 ))" >> $GITHUB_ENV
  env:
    commits: ${{ github.event.pull_request.commits }}
- uses: actions/checkout@v4
  with:
    fetch-depth: ${{ env.fetch_depth }}
```

`github.even.pull_request.commits` で Pull Request に含まれるコミット数が取得できます。ベースを含めるために `+ 1` する必要があり環境変数を経由しています。

例えば Pull Request に含まれるコミットすべてが [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) を満たしているかチェックする workflow は次のようになります。

```yaml
name: Conventional Commits

on: [pull_request]

jobs:
  commitlint:
    runs-on: ubuntu-latest
    steps:

      # fetch-depth の計算
      - run: echo "fetch_depth=$(( commits + 1 ))" >> $GITHUB_ENV
        env:
          commits: ${{ github.event.pull_request.commits }}

      # 必要な履歴だけを fetch
      - uses: actions/checkout@v4
        with:
          fetch-depth: ${{ env.fetch_depth }}

      # Conventional Cmmits のチェック
      - uses: actions/setup-node@v3
      - run: npm install -g @commitlint/cli @commitlint/config-conventional
      - run: npx commitlint --from "$from" --to "$to" --verbose -x "$extends"
        env:
          from: ${{ github.event.pull_request.base.sha }}
          to: ${{ github.event.pull_request.head.sha }}
          extends: "@commitlint/config-conventional"
```

## おまけ

[kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) リポジトリ (118,324 コミット) で試した結果次のようになりました。

| fetch-depth | Job 実行時間 |
|-------------|-------------|
| 0 | 2m 8s |
| 1 | 18s |
| 10 | 21s |

```yaml
name: fetch-deth comparison

on: [pull_request]

jobs:
  depth0:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: kubernetes/kubernetes
          fetch-depth: 0

  depth1:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: kubernetes/kubernetes
          fetch-depth: 1

  depth10:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: kubernetes/kubernetes
          fetch-depth: 10
```
