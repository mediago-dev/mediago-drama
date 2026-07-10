# mgmd 一致性语料(conformance corpus)

这是 mgmd 规范的**可执行形式**。三端(前端 TS / Go 服务端 / MCP)的解析与序列化行为以本目录的语料为准,而不是以文字描述为准(见 [../mgmd-spec.md](../mgmd-spec.md) §8)。

## 目录

- `fixtures/*.md` —— 语言中立的 mgmd 文档样本(正文,不含文档层 front matter)。每个文件覆盖一类语法。
- 各端的运行器读取同一批 `fixtures/*.md`,断言相同的性质。

## 断言的性质

1. **往返稳定(幂等)** —— `serialize(parse(x))` 再跑一次结果不变。这保证"重新保存不会 churn 文件"(协同 / diff / git 的前提)。
2. **构造保真** —— section-id、mention、章节音视频等 mgmd 构造在往返后数量不减(不被静默丢弃)。

## 运行器

- **前端**:`apps/workspace/src/domains/documents/lib/mgmd/conformance.test.ts`(用真实编辑器解析扩展跑)。
  - `pnpm -C apps/workspace exec vitest run src/domains/documents/lib/mgmd/conformance.test.ts`
- **Go 服务端 / MCP**:待补(阶段 1 接入,读同一批 fixtures)。

## 阶段 0 说明

本语料先用**现状语法**锁定快照。已知空白(见 spec 附录 A.9)——如表格/列表往返未系统验证——由这里的用例暴露;暴露出的问题以 `KNOWN GAP` 注明,阶段 1 修复后转为硬断言。
