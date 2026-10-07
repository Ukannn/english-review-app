# English learning policy v3

The goal is reliable production of useful words and chunks, especially for a learner who understands expressions but cannot retrieve them when needed. The default workload is about 15–20 minutes, with up to eight independent reviews, one reading and two short responses; actual duration is measured rather than guaranteed.

## Captured learning targets

A recognizable English word saved on its own or explicitly marked in a passage is a learning request. Keep it as a word candidate rather than discarding it for lacking context or forcing it into a phrase. Use the surrounding passage to determine meaning when available. Without context, propose one common sense, label the meaning as provisional in the context explanation and selection reason, and note relevant alternative senses or register. A generated teaching example is never a source quotation. Normalize inflection only when clear, retaining the exact source text separately.

Automatic extraction from an unmarked article still favors useful chunks and does not harvest every word. The candidate count is a maximum, not a quota. Unrecognizable or unhelpful material can yield no suggestions. All proposals require learner confirmation before entering learning; the AI cannot accept them or change review progress.

## Evidence used

- [Li and Boers (2025)](https://onlinelibrary.wiley.com/doi/10.1111/modl.70007): study before retrieval is relevant for collocation learning; this does not establish unsupported full-chunk recall as universally superior to contextual cloze.
- [Oikawa and Uchihara (2026)](https://doi.org/10.1017/S0272263126101818): the value of contextual variation depends on learning conditions and task demands; do not force a new scenario every time.
- [Suzuki and colleagues (2025)](https://doi.org/10.1017/S0272263125101290): chunk preparation can connect to performance tasks, but this app's text scores are not measurements of spoken fluency.

These sources motivate design choices. They do not validate this product's exact daily counts, difficulty thresholds or eight-stage interval schedule as an optimal algorithm.

## Question selection

1. Read the exact expression, meaning, usage restrictions, recent real answers, hint records, error categories and prior prompts.
2. If meaning is unfamiliar, present a compact learning card, hide it, and separate first retrieval with other items where possible.
3. If collocation components are unstable, use a contextual gap focused on the unstable component.
4. If a cue helps but full retrieval fails, ask for a complete chunk from a brief intention and offer recorded hints.
5. If retrieval succeeds but use is unstable, supply a recipient and communicative purpose for a one- or two-sentence reply.
6. After stable familiar performance, vary one of scenario, register or syntax at a time.

Every task has one main target and explicit instructions. Reject answer leaks, unnatural language, duplicate prompts and inconsistent rubrics. A recall prompt with too many plausible answers needs a clearer limitation or must become an open response. Never grade an undisclosed preferred answer as the only valid answer.

## Feedback and evaluation

Track target retrieval, meaning, naturalness and hints separately. Prefer one key correction and one natural example. Human corrections can override AI proposals before final confirmation. Reasonable alternatives produce target-not-measured evidence; irrelevant minor errors are feedback rather than target failure.

Two unaided successes on distinct dates and prompts may increase exercise difficulty; neither establishes permanent mastery. Same-day training and cross-day evidence remain separate. Hinted or failed retrieval adds support on the next task; stable retrieval can reduce support.

Review the last 14 days of time, unaided retrieval, short-response performance and overdue backlog. Show denominators and distinguish missing evidence from failure. The first release provides evidence for review; it does not silently tune policy parameters.

## Version 0.15 daily package

The default sequence is independent review → reading → two purposeful responses. Eight independent items is a future preference configurable from 4–12; a prepared package stays frozen. Due `active` and `mastered` expressions are ordered by due date and stable ID; suspended expressions stay out. Fewer eligible items means less review, with at most one previously confirmed new expression and no non-due filler. New expressions require a learning card before recall. Up to two review items can ask for contextual responses; recent evidence controls support and complexity, not access to the two fixed expression tasks.

Reading is a natural 120–180 word passage or dialogue. Generated packages rotate life, life, work. Use two or three reviewed targets naturally (fewer when scarce). With no due items, familiar expressions can support reading and responses without fake review events. Material remains unavailable until all review positions are saved or explicitly skipped. Chinese help is optional. Reading never adds vocabulary automatically.

Each response requests one or two sentences for a recipient and a communicative purpose. The first connects to the reading; the second transfers to a related personal scenario. The original text starts collapsed. Every response remains post-reading practice regardless of whether the learner reopens it. “暂时不会” is an attempted failure; “跳过” is not learning evidence. Ending early grades only attempted tasks.

## Evidence and scheduling

Only pre-reading, unexposed full retrieval or an independent response can advance a stage. Correct local gaps hold their stage and return within three days for full retrieval. New learning, reading, hinted success and post-answer practice cannot establish independent mastery. Confirmed initial learning is due tomorrow. Reasonable alternatives preserve the stage and receive a clearer target-recall task tomorrow. Existing partial/failure scheduling remains in place. At most one schedule-affecting event per expression per Shanghai date spans v2 and v3. Actual reading, hints and attempts are frozen by the system; AI cannot invent exposure facts.

Reports separate full independent retrieval, hints, gaps, post-reading expression and later delayed retrieval. Hinted attempts stay in the independent denominator. Unmeasured targets and skips are not failures. Active time counts foreground interaction only, excludes waits, and stops after 60 seconds without interaction; historical durations use a different measure. After ten complete packages, the report opens a reflection with available denominators, delayed evidence, duration and optional burden feedback. Small samples remain explicitly inconclusive and do not change policy automatically.

Public instructions, optional hints and private scoring criteria have distinct fields. The UI never displays semantic boundaries or grading rubrics before answering. Historical possibly leaked tasks are an evidence limitation; their scores and due dates are not rewritten. The current API prompt is returned by `get_ai_job_prompt`; retained Sheets prompts and configuration are historical only.
