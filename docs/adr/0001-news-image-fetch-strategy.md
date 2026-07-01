# ADR-0003: News Image Fetch Strategy

## Status

Accepted

## Context

ニュースカードへサムネイル画像を表示する機能を実装する。

RSSによって画像の提供方法は異なる。

例

* media:thumbnail
* enclosure
* hatena:imageurl
* content:encoded
* OGP
* Twitter Card

またGoogle NewsはGoogle独自URLを返すため、元記事URL取得にはGoogle内部APIへのアクセスが必要となる。

内部APIは大量アクセス時にHTTP 429でレート制限されるため、バッチ処理には適さない。

画像取得率だけではなく、

* 保守性
* 外部サービスへの負荷
* 将来の仕様変更耐性

を重視する必要がある。

---

## Decision

画像取得は以下の優先順位で実施する。

1. media:thumbnail
2. hatena:imageurl
3. enclosure（image/*のみ）
4. content:encoded の最初の img
5. og:image
6. twitter:image

最初に取得できた画像を採用する。

RSSから画像取得できた場合はHTML解析を行わない。

---

Google Newsについては、

* Google内部APIによる元記事URL取得を採用しない
* Googleブランド画像も利用しない
* プロジェクト独自のプレースホルダー画像を表示する

---

画像取得状態は以下のEnumで管理する。

* PENDING
* PROCESSING
* SUCCESS
* NOT_FOUND
* FAILED

PROCESSINGは複数ワーカー・複数Cronによる二重処理防止を目的とする。

---

RSS取得CronとOGP取得Cronは分離する。

RSS取得では画像取得待ち状態まで更新する。

OGP取得CronがPENDING記事を処理する。

OGP取得は5件並列で実行する。

タイムアウト時はFAILEDとする。

---

## Consequences

メリット

* RSSだけで取得可能なサイトでは余計なHTTPアクセスを行わない
* Google Newsの仕様変更や429問題の影響を受けない
* ワーカー増設にも対応できる
* 保守性が高い

デメリット

* Google Newsの記事は記事固有サムネイルを表示できない
* 一部記事はプレースホルダー表示となる
