# 自适应出题与题组外加练 PRD

状态：已实现，待发布验收
版本目标：项目 v0.9.0 / Apps Script version 28
日期：2026-08-12（Asia/Shanghai）

## 1. 要解决的问题

1. 正式题的说明不清楚，用户无法判断长段文字是背景、填空材料，还是需要整段翻译。
2. 同一 chunk 反复使用同一句子或同一场景，用户可能依赖场景线索答题，而非真正回忆表达。
3. 系统虽然会把错误写入日志并调整 SRS，但旧出题合同不会主动读取最近错误来设计下一题。
4. 完整句写作与词块回忆混在同一正式题组，会让一次 SRS 结果同时衡量两个不同能力。

## 2. 正式题合同

- 每题 Prompt ZH 开头必须且只能有一个标签：`【作答范围：词块组成部分】` 或 `【作答范围：完整目标词块】`。
- 正式题只测词块，不要求翻译整段或写完整英文句子。
- 新词、上次 forgotten、Review Stage 1–2：优先关键组成部分填空。
- Review Stage 3–5：优先完整词块填空。
- Review Stage 6–8：优先中文含义或短情境到完整词块的回忆。
- 最近 Error Log 有近义词、介词、漏词、时态或搭配边界错误时，下一题定向检查该错误点。
- 正式作答继续使用 `Attempt Type=primary`、`Affects SRS?=yes`，一次正式题只产生一个 SRS Result。

## 3. 语境轮换

- 出题必须读取同一 Phrase/Candidate 的历史 `Session Questions`，重点比较最近 5 题。
- 禁止重复历史完整题面；Apps Script 会拒绝标准化后完全相同的历史 Prompt。
- 不得重复最近 3 题的核心场景。
- 与最近 1 题相比，actor / domain / event / syntax 至少改变两项。
- `Natural Example` 只能作为理解目标表达的素材，不能长期原样复用成题面。

## 4. 错误强化

- 每个正式 `forgotten` 或 `difficult` 结果恰好生成 1 道 reinforcement。
- 不设置本场或每日总上限：正式题错几题，就生成几道。
- 强化题换一个短场景，要求重新填写完整目标词块，并针对本次具体错误点。
- 写入 `Review Log` 时使用 `Attempt Type=reinforcement`、`Parent Attempt ID=<正式 Attempt ID>`、`Affects SRS?=no`。
- 强化题不写 `Error Log`、不改 `Phrase Bank`、不生成下一层强化题，因此是非递归的。

## 5. 完整句迁移挑战

- 位于正式题组结果页之外。
- 只对批改结果为 mastered 且批改前 Review Stage>=6 的词块生成。
- 要求用户在新场景中写一个完整英文句子；提交后显示参考例句。
- 写入 `Review Log` 时使用 `Attempt Type=sentence_challenge`、`Affects SRS?=no`；结果只表示完成，不改变正式掌握度。

## 6. 数据与恢复

- `Grade Inbox` 在原 18 列之后追加 `Extra Practice JSON`，旧列位置不变。
- 加练计划冻结在 `Commit Journal.Confirmation JSON` 的 commit plan 中，刷新后仍可恢复。
- 加练 ID 由 Session、正式题 Position 与类型确定；重复提交同一答案幂等，另一答案不能覆盖。
- 参考答案只在加练提交后返回前端；未提交状态不在结果 JSON 中暴露答案。
- `Phrase Bank` 的 Last Reviewed / Times Seen / Times Correct 公式只统计 `Affects SRS?=yes`，题组外加练不能污染正式复习统计。

## 7. 验收标准

- 新正式题缺少作答范围标签、要求整句、或复用历史相同题面时，题组被拒绝并提示重新准备。
- 10 道正式错误必须得到 10 道强化题，不得因数量上限截断。
- 强化题和完整句挑战的 `Affects SRS?` 精确回读为 `no`，且不会新增 Error Log 或改写 Phrase Bank。
- 加练重复提交保持幂等；刷新后已完成状态可从 Review Log 恢复。
- 桌面和 375×812 页面均可填写、提交和查看参考答案，无横向溢出。
