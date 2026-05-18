---
trigger: always_on
---

# Prisma 7 Documentation Rule

このプロジェクトで Prisma ORM / Prisma Client / schema.prisma / migration / database access に関する実装・修正・レビューを行う場合は、必ず Prisma ORM v7 の最新公式ドキュメントを前提にすること。

## Canonical sources

まず以下を確認すること。

- https://www.prisma.io/docs/llms-full.txt
- https://www.prisma.io/llms.txt
- https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- https://www.prisma.io/changelog.md

## Version policy

- Prisma v6 以前の書き方を安易に使わない。
- package.json / lockfile / prisma.config.* / schema.prisma を確認して、実際に使っている Prisma のバージョンと設定を把握してから提案する。
- Prisma v7 の破壊的変更に関わる可能性がある場合は、実装前に公式 v7 upgrade guide を確認する。
- Prisma Client の import path、generator 設定、prisma.config.*、migrate 関連コマンドは、必ず v7 前提で検証する。

## Safety

- `prisma migrate reset`
- `prisma db push --force-reset`
- 本番 DB への migration
- データ削除・スキーマ破壊を伴う変更

これらは実行前に必ず確認を求めること。