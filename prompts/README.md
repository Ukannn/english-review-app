# Historical Sheets prompts

`daily-task.txt` and `context-processing.txt` describe the retired Sheets/Apps Script contract. They and `src/server/config/review-contract.gs` are preserved for reproducible historical builds, not current learning rules.

The active PWA uses `english_v3` for new lessons, while frozen earlier jobs retain `english_v2`. ChatGPT obtains the authoritative per-job snapshot and instructions from `english_api.get_ai_job_prompt`. The v3 contract is installed by `supabase/migrations/20260928150110_english_learning_v3.sql`; see [current learning policy](../docs/learning-policy.md).
