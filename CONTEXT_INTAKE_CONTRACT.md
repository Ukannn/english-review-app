# 真实语料采集合同（v4.0）

更新时间：2026-08-03（Asia/Shanghai）

## 主流程与责任边界

1. 用户在 Web App“语料箱”粘贴完整英文上下文，可标记多处不懂的原文片段。
2. Apps Script 校验 UTF-16 范围、片段原文、URL、长度和幂等请求，并写入 `Context Inbox`。AI 不得改写这张表。
3. 用户点击语料箱“准备整理并打开对话”；网页复制完整的一次性合同并打开关联 Work 对话。用户粘贴并发送后，ChatGPT 读取 pending Context，只向 `Context Candidate Inbox` 暂存 0–3 条 chunk 建议，或一条 `explanation_only` 说明。
4. 用户回到 Web App 对每条建议选择接受、编辑后接受、拒绝、已掌握或仅保留解释。
5. 只有接受或编辑后接受会触发 Apps Script 在锁内写入 `Candidate Bank`，分配稳定 Candidate ID，并做固定范围精确回读。
6. `Candidate Bank` 的 `Origin Type=user_context` 保存 Context ID、选中原文、来源 URL 和优先级。此处不会直接写 `Phrase Bank`。
7. Daily Queue 先保留到期复习，再从 Candidate Bank 的 ready 候选选新题；`user_context` 可占满所有剩余新题名额，不再设置每日 4 条上限。
8. 首次学习真实语料候选时，出题优先使用原始上下文；后续复习可逐渐脱离原文。完成批改后仍由 Apps Script 负责正式 SRS 与 Phrase Bank 写入。
9. Candidate Bank 是持久候选搭配总库。新题来源优先级固定为 `user_context → learning_evidence → conversation_derived → legacy → ai_fallback`；只有个人来源候选及个人语料待处理项全部耗尽时，ChatGPT 才可生成个性化 `ai_fallback`。

## 表与写入者

| 表 | 正式写入者 | 作用 |
| --- | --- | --- |
| `Context Inbox` | Web App / Apps Script | 不可变的真实原文、选中范围、来源和处理状态 |
| `Context Candidate Inbox` | ChatGPT 暂存；Apps Script 更新决定状态 | AI 建议与用户决策暂存面 |
| `Candidate Bank` | Apps Script | 用户确认后的正式候选池，含来源元数据 |
| `Daily Queue` | Apps Script | 到期复习优先，受每日真实语料上限约束 |
| `Phrase Bank` | Apps Script | 正式学习完成后的 SRS 事实源 |

## 当前明确不做

- iPhone 快捷指令、Share Sheet、`doPost` 接口；
- 浏览器扩展、自动读取网页正文、OCR；
- 原始语料未经用户确认直接进入 Candidate Bank；
- ChatGPT 直接写 Candidate Bank、Phrase Bank 或正式学习日志。

## 入口限制

- 裸发“整理语料”已退役：普通 Work 对话不会继承 Scheduled Task 编辑器里的提示词。
- Web App 无权跨站替用户点击 ChatGPT 的“发送”；按钮负责复制完整合同并打开对话，用户仍需粘贴并发送一次。
- 每日 Scheduled Task 继续只负责 09:00 出题与“批改”，不再包含语料整理分支。
