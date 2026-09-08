begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists english_private;
create schema if not exists english_api;

revoke all on schema english_private from public, anon;
revoke all on schema english_api from public, anon;
grant usage on schema english_private to authenticated;
grant usage on schema english_api to authenticated;

create table english_private.settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default 'null'::jsonb,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, key)
);

create table english_private.source_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_row integer,
  date_added timestamptz,
  source text,
  context text,
  candidate_chunk text,
  why_useful text,
  added_to_bank boolean,
  created_at timestamptz not null default now()
);

create table english_private.contexts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_context_id text,
  raw_text text not null,
  selected_spans jsonb not null default '[]'::jsonb,
  source_url text,
  source_title text,
  user_note text,
  status text not null default 'pending'
    check (status in ('pending','processing','review','completed','rejected','legacy')),
  processing_batch_id text,
  capture_request_id text,
  contract_version text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (owner_id, legacy_context_id)
);

create table english_private.candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_candidate_id text,
  candidate text not null,
  candidate_type text,
  cue_zh text,
  source text,
  source_context text,
  why_useful text,
  topic text,
  difficulty text,
  natural_example text,
  common_mistake text,
  origin_type text,
  origin_context_id uuid references english_private.contexts(id) on delete set null,
  selected_text text,
  source_url text,
  intake_priority text,
  status text not null default 'ready',
  deferred_reason text,
  legacy_source_note_row integer,
  promoted_phrase_id uuid,
  created_at timestamptz not null default now(),
  promoted_at timestamptz,
  unique (owner_id, legacy_candidate_id)
);

create table english_private.context_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  context_id uuid not null references english_private.contexts(id) on delete cascade,
  position integer not null check (position >= 0),
  selected_text text,
  candidate text not null,
  cue_zh text,
  candidate_type text,
  context_meaning text,
  why_useful text,
  topic text,
  difficulty text,
  natural_example text,
  common_mistake text,
  extraction_rationale text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  decision_status text not null default 'pending'
    check (decision_status in ('pending','accepted','edited','rejected','committed')),
  edited_candidate text,
  processing_batch_id text,
  candidate_id uuid references english_private.candidates(id) on delete set null,
  contract_version text,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (context_id, position)
);

create table english_private.candidate_generation_rows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id text,
  queue_date date,
  requested_count integer,
  available_count integer,
  shortfall_count integer,
  position integer not null check (position > 0),
  candidate text not null,
  cue_zh text,
  candidate_type text,
  source text,
  source_context text,
  why_useful text,
  topic text,
  difficulty text,
  natural_example text,
  common_mistake text,
  generation_batch_id text,
  model_id text,
  status text not null default 'staged',
  candidate_id uuid references english_private.candidates(id) on delete set null,
  contract_version text,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (owner_id, request_id, position)
);

create table english_private.phrases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_phrase_id text,
  chunk text not null,
  cue_zh text,
  phrase_type text,
  topic text,
  difficulty text,
  status text not null default 'active',
  review_stage integer not null default 0 check (review_stage >= 0),
  next_review_at timestamptz,
  common_mistake text,
  natural_example text,
  notes text,
  source text,
  source_candidate_id uuid references english_private.candidates(id) on delete set null,
  mastery_streak integer not null default 0 check (mastery_streak >= 0),
  last_result text,
  contract_version text,
  canonical_pattern text,
  created_at timestamptz not null default now(),
  unique (owner_id, legacy_phrase_id),
  unique (owner_id, chunk)
);

alter table english_private.candidates
  add constraint candidates_promoted_phrase_fk
  foreign key (promoted_phrase_id) references english_private.phrases(id) on delete set null;

create table english_private.daily_queues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_queue_id text not null,
  queue_date date not null,
  status text not null default 'planned',
  planned_count integer not null default 20 check (planned_count between 1 and 150),
  adjusted_target integer check (adjusted_target is null or adjusted_target between 1 and 150),
  queue_kind text,
  revision integer not null default 1 check (revision > 0),
  superseded_by uuid references english_private.daily_queues(id) on delete set null,
  superseded_at timestamptz,
  change_reason text,
  contract_version text,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (owner_id, legacy_queue_id)
);

create table english_private.daily_queue_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  queue_id uuid not null references english_private.daily_queues(id) on delete cascade,
  position integer not null check (position > 0),
  selection_type text,
  phrase_id uuid references english_private.phrases(id) on delete restrict,
  candidate_id uuid references english_private.candidates(id) on delete restrict,
  chunk text,
  cue_zh text,
  topic text,
  difficulty text,
  natural_example text,
  original_next_review timestamptz,
  priority_reason text,
  status text not null default 'planned',
  presented_at timestamptz,
  contract_version text,
  created_at timestamptz not null default now(),
  unique (queue_id, position),
  check (phrase_id is not null or candidate_id is not null)
);

create table english_private.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_session_id text,
  queue_id uuid not null references english_private.daily_queues(id) on delete restrict,
  learning_date date not null,
  status text not null default 'open'
    check (status in ('open','submitted','grading','needs_confirmation','committed','legacy_recovery','cancelled')),
  max_questions integer not null check (max_questions between 1 and 150),
  revision integer not null default 1 check (revision > 0),
  scheduled_start timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  client_instance_id text,
  contract_version text,
  created_at timestamptz not null default now(),
  unique (owner_id, legacy_session_id)
);

create table english_private.questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  queue_id uuid not null references english_private.daily_queues(id) on delete cascade,
  queue_item_id uuid references english_private.daily_queue_items(id) on delete cascade,
  session_id uuid references english_private.sessions(id) on delete set null,
  position integer not null check (position > 0),
  phrase_id uuid references english_private.phrases(id) on delete restrict,
  candidate_id uuid references english_private.candidates(id) on delete restrict,
  question_type text,
  prompt_zh text,
  prompt_en text,
  expected_answers jsonb not null default '[]'::jsonb,
  accepted_variants jsonb not null default '[]'::jsonb,
  semantic_boundary text,
  grading_rubric text,
  generation_id text,
  model_id text,
  prompt_version text,
  content_hash text not null,
  status text not null default 'ready',
  contract_version text,
  created_at timestamptz not null default now(),
  bound_at timestamptz,
  unique (queue_id, position)
);

create table english_private.question_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  queue_id uuid references english_private.daily_queues(id) on delete set null,
  queue_item_id uuid references english_private.daily_queue_items(id) on delete set null,
  session_id uuid references english_private.sessions(id) on delete set null,
  position integer not null check (position > 0),
  phrase_id uuid references english_private.phrases(id) on delete set null,
  candidate_id uuid references english_private.candidates(id) on delete set null,
  question_type text,
  prompt_zh text,
  prompt_en text,
  expected_answers jsonb not null default '[]'::jsonb,
  accepted_variants jsonb not null default '[]'::jsonb,
  semantic_boundary text,
  grading_rubric text,
  generation_id text,
  model_id text,
  prompt_version text,
  content_hash text,
  question_status text not null,
  legacy_session_id text,
  contract_version text,
  created_at timestamptz,
  bound_at timestamptz
);

create table english_private.answer_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references english_private.sessions(id) on delete cascade,
  question_id uuid not null references english_private.questions(id) on delete restrict,
  position integer not null check (position > 0),
  answer text not null,
  revision integer not null check (revision > 0),
  reveal_hash text not null,
  answer_hash text not null,
  submit_status text not null default 'draft',
  idempotency_key text not null,
  client_instance_id text,
  page_started_at timestamptz,
  contract_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, position),
  unique (owner_id, idempotency_key)
);

create table english_private.answer_draft_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_history_id text,
  answer_draft_id uuid references english_private.answer_drafts(id) on delete set null,
  session_id uuid not null references english_private.sessions(id) on delete cascade,
  question_id uuid references english_private.questions(id) on delete set null,
  position integer not null check (position > 0),
  previous_answer text,
  previous_revision integer,
  next_answer text,
  next_revision integer not null check (next_revision > 0),
  event_type text not null,
  client_instance_id text,
  page_started_at timestamptz,
  answer_hash text,
  contract_version text,
  recorded_at timestamptz not null default now(),
  unique (owner_id, legacy_history_id)
);

create table english_private.submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_submission_id text,
  session_id uuid not null references english_private.sessions(id) on delete restrict,
  queue_id uuid not null references english_private.daily_queues(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  frozen_hash text not null,
  idempotency_key text not null,
  status text not null default 'submitted'
    check (status in ('submitted','grading','needs_confirmation','committing','committed','rejected','failed')),
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (session_id),
  unique (owner_id, legacy_submission_id),
  unique (owner_id, idempotency_key)
);

create table english_private.grade_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null references english_private.submissions(id) on delete cascade,
  question_id uuid not null references english_private.questions(id) on delete restrict,
  position integer not null check (position > 0),
  phrase_id uuid references english_private.phrases(id) on delete restrict,
  candidate_id uuid references english_private.candidates(id) on delete restrict,
  observed_answer text not null,
  prompt_zh text,
  prompt_en text,
  expected_answers jsonb not null,
  accepted_variants jsonb not null default '[]'::jsonb,
  semantic_boundary text,
  grading_rubric text,
  review_stage integer,
  answer_hash text not null,
  request_status text not null default 'ready',
  snapshot_contract_version text not null default '1.0',
  contract_version text,
  created_at timestamptz not null default now(),
  unique (submission_id, position)
);

create table english_private.grade_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null references english_private.submissions(id) on delete cascade,
  grade_request_id uuid not null references english_private.grade_requests(id) on delete restrict,
  position integer not null check (position > 0),
  result text not null check (result in ('forgotten','difficult','normal','mastered')),
  feedback_zh text,
  error_category text,
  confidence numeric not null check (confidence between 0 and 1),
  evidence text,
  expected_answer text,
  observed_answer text not null,
  candidate_suggestions jsonb not null default '[]'::jsonb,
  extra_practice jsonb not null default '[]'::jsonb,
  grading_batch_id text,
  prompt_version text,
  status text not null default 'staged'
    check (status in ('staged','needs_confirmation','accepted','rejected','committed')),
  confirmation_decision text,
  contract_version text,
  created_at timestamptz not null default now(),
  unique (submission_id, position)
);

-- Append-only import/runtime audit of every grading attempt. This preserves
-- rejected legacy Grade Inbox rows even when a later accepted attempt exists
-- for the same submission position.
create table english_private.grade_result_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid references english_private.submissions(id) on delete set null,
  legacy_submission_id text,
  position integer not null check (position > 0),
  phrase_id uuid references english_private.phrases(id) on delete set null,
  candidate_id uuid references english_private.candidates(id) on delete set null,
  answer_hash text,
  result text,
  feedback_zh text,
  error_category text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  evidence text,
  expected_answer text,
  observed_answer text,
  candidate_suggestions jsonb not null default '[]'::jsonb,
  extra_practice jsonb not null default '[]'::jsonb,
  grading_batch_id text,
  prompt_version text,
  grade_status text not null,
  contract_version text,
  created_at timestamptz,
  unique (owner_id, legacy_submission_id, grading_batch_id, position, grade_status)
);

create table english_private.commit_journal (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null references english_private.submissions(id) on delete cascade,
  answer_hash text not null,
  status text not null default 'pending',
  last_completed_step text,
  error_code text,
  error_detail text,
  readback_status text,
  result jsonb not null default '{}'::jsonb,
  confirmation jsonb not null default '{}'::jsonb,
  contract_version text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (submission_id)
);

create table english_private.review_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  phrase_id uuid references english_private.phrases(id) on delete restrict,
  session_id uuid references english_private.sessions(id) on delete restrict,
  grade_result_id uuid references english_private.grade_results(id) on delete set null,
  question_position integer,
  prompt text,
  expected_answer text,
  user_answer text,
  result text,
  tag text,
  follow_up_needed boolean,
  notes text,
  legacy_attempt_id text,
  attempt_type text,
  parent_attempt_id text,
  question_type text,
  affects_srs boolean not null default true,
  contract_version text,
  reviewed_at timestamptz not null default now()
);

create table english_private.error_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_error_id text,
  phrase_id uuid references english_private.phrases(id) on delete set null,
  session_id uuid references english_private.sessions(id) on delete set null,
  chunk text,
  error_type text,
  user_answer text,
  correction text,
  explanation text,
  next_action text,
  resolved boolean,
  attempt_id text,
  occurred_at timestamptz,
  resolved_at timestamptz,
  contract_version text,
  created_at timestamptz not null default now(),
  unique (owner_id, legacy_error_id)
);

create table english_private.extra_practice (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid references english_private.submissions(id) on delete set null,
  phrase_id uuid references english_private.phrases(id) on delete set null,
  practice_type text not null,
  prompt text not null,
  answer text,
  reference_answer text,
  affects_srs boolean not null default false check (affects_srs = false),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create table english_private.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('context_extract','candidate_generate','question_prepare','grade_submission')),
  subject_id uuid,
  requested_count integer check (requested_count is null or requested_count between 1 and 150),
  expected_count integer not null check (expected_count >= 0),
  input_snapshot jsonb not null,
  snapshot_hash text not null,
  batch_id uuid not null default gen_random_uuid(),
  model_id text,
  output_payload jsonb,
  status text not null default 'prepared'
    check (status in ('prepared','imported','validated','consumed','cancelled','rejected')),
  idempotency_key text not null,
  error_detail text,
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  validated_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  unique (owner_id, idempotency_key)
);

create table english_private.rpc_idempotency (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, operation, idempotency_key)
);

create table english_private.import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_file text not null,
  source_sha256 text not null,
  snapshot_sha256 text not null,
  source_modified_at timestamptz,
  status text not null default 'staged'
    check (status in ('staged','reconciled','promoted','failed')),
  expected_sheet_count integer not null default 18,
  expected_row_count integer not null,
  expected_formula_count integer not null,
  reconciliation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reconciled_at timestamptz,
  promoted_at timestamptz,
  unique (owner_id, source_sha256)
);

create table english_private.import_rows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  import_batch_id uuid not null references english_private.import_batches(id) on delete cascade,
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  legacy_id text,
  raw_json jsonb not null,
  row_hash text not null,
  formula_cells jsonb not null default '[]'::jsonb,
  target_table text,
  target_id uuid,
  promotion_status text not null default 'staged'
    check (promotion_status in ('staged','promoted','legacy_only','rejected')),
  error_detail text,
  created_at timestamptz not null default now(),
  unique (import_batch_id, source_sheet, source_row),
  unique (import_batch_id, row_hash)
);

create table english_private.legacy_recovery (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  recovery_kind text not null,
  legacy_key text not null,
  payload jsonb not null,
  learning_date date,
  visible boolean not null default true,
  automatically_resumable boolean not null default false check (automatically_resumable = false),
  created_at timestamptz not null default now(),
  unique (owner_id, recovery_kind, legacy_key)
);

create index settings_owner_idx on english_private.settings(owner_id);
create index source_notes_owner_idx on english_private.source_notes(owner_id);
create index contexts_owner_status_idx on english_private.contexts(owner_id, status, created_at desc);
create index candidates_owner_status_idx on english_private.candidates(owner_id, status, created_at desc);
create index context_candidates_owner_status_idx on english_private.context_candidates(owner_id, decision_status);
create index context_candidates_context_idx on english_private.context_candidates(context_id);
create index candidate_generation_owner_status_idx on english_private.candidate_generation_rows(owner_id, status);
create index phrases_owner_next_review_idx on english_private.phrases(owner_id, status, next_review_at);
create index candidates_origin_context_idx on english_private.candidates(origin_context_id);
create index candidates_promoted_phrase_idx on english_private.candidates(promoted_phrase_id);
create index phrases_source_candidate_idx on english_private.phrases(source_candidate_id);
create index queues_owner_date_idx on english_private.daily_queues(owner_id, queue_date desc, revision desc);
create index queues_superseded_by_idx on english_private.daily_queues(superseded_by);
create index queue_items_owner_idx on english_private.daily_queue_items(owner_id, queue_id, position);
create index queue_items_phrase_idx on english_private.daily_queue_items(phrase_id);
create index queue_items_candidate_idx on english_private.daily_queue_items(candidate_id);
create index sessions_owner_status_idx on english_private.sessions(owner_id, learning_date desc, status);
create index sessions_queue_idx on english_private.sessions(queue_id);
create index questions_owner_session_idx on english_private.questions(owner_id, session_id, position);
create index questions_queue_item_idx on english_private.questions(queue_item_id);
create index questions_phrase_idx on english_private.questions(phrase_id);
create index questions_candidate_idx on english_private.questions(candidate_id);
create index question_attempts_owner_queue_idx on english_private.question_attempts(owner_id, queue_id, position);
create index question_attempts_queue_item_idx on english_private.question_attempts(queue_item_id);
create index question_attempts_session_idx on english_private.question_attempts(session_id);
create index question_attempts_phrase_idx on english_private.question_attempts(phrase_id);
create index question_attempts_candidate_idx on english_private.question_attempts(candidate_id);
create index questions_content_hash_idx on english_private.questions(owner_id, content_hash);
create index drafts_owner_session_idx on english_private.answer_drafts(owner_id, session_id, position);
create index drafts_question_idx on english_private.answer_drafts(question_id);
create index draft_history_owner_session_idx on english_private.answer_draft_history(owner_id, session_id, recorded_at);
create index draft_history_draft_idx on english_private.answer_draft_history(answer_draft_id);
create index draft_history_question_idx on english_private.answer_draft_history(question_id);
create index submissions_owner_status_idx on english_private.submissions(owner_id, status, created_at desc);
create index submissions_queue_idx on english_private.submissions(queue_id);
create index grade_requests_owner_submission_idx on english_private.grade_requests(owner_id, submission_id, position);
create index grade_requests_question_idx on english_private.grade_requests(question_id);
create index grade_requests_phrase_idx on english_private.grade_requests(phrase_id);
create index grade_requests_candidate_idx on english_private.grade_requests(candidate_id);
create index grade_results_owner_submission_idx on english_private.grade_results(owner_id, submission_id, position);
create index grade_results_request_idx on english_private.grade_results(grade_request_id);
create index grade_attempts_owner_submission_idx on english_private.grade_result_attempts(owner_id, legacy_submission_id, position);
create index grade_attempts_submission_idx on english_private.grade_result_attempts(submission_id);
create index grade_attempts_phrase_idx on english_private.grade_result_attempts(phrase_id);
create index grade_attempts_candidate_idx on english_private.grade_result_attempts(candidate_id);
create index review_events_owner_date_idx on english_private.review_events(owner_id, reviewed_at desc);
create index review_events_phrase_idx on english_private.review_events(phrase_id, reviewed_at desc);
create index review_events_session_idx on english_private.review_events(session_id);
create index review_events_grade_idx on english_private.review_events(grade_result_id);
create index error_events_owner_date_idx on english_private.error_events(owner_id, occurred_at desc);
create index error_events_phrase_idx on english_private.error_events(phrase_id);
create index error_events_session_idx on english_private.error_events(session_id);
create index extra_practice_owner_idx on english_private.extra_practice(owner_id, created_at desc);
create index extra_practice_submission_idx on english_private.extra_practice(submission_id);
create index extra_practice_phrase_idx on english_private.extra_practice(phrase_id);
create index ai_jobs_owner_status_idx on english_private.ai_jobs(owner_id, status, created_at desc);
create index import_batches_owner_status_idx on english_private.import_batches(owner_id, status);
create index import_rows_owner_sheet_idx on english_private.import_rows(owner_id, source_sheet, source_row);
create index import_rows_batch_idx on english_private.import_rows(import_batch_id);

do $$
declare table_name text;
begin
  for table_name in
    select tablename from pg_tables where schemaname = 'english_private'
  loop
    execute format('alter table english_private.%I enable row level security', table_name);
    execute format(
      'create policy owner_scope on english_private.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',
      table_name
    );
  end loop;
end;
$$;

grant select, insert, update, delete on all tables in schema english_private to authenticated;
grant usage, select on all sequences in schema english_private to authenticated;
alter default privileges in schema english_private revoke all on tables from public, anon;
alter default privileges in schema english_private grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema english_private grant usage, select on sequences to authenticated;

create view english_private.phrase_review_stats
with (security_invoker = true)
as
select
  p.owner_id,
  p.id as phrase_id,
  max(r.reviewed_at) filter (where r.affects_srs) as last_reviewed_at,
  count(r.id) filter (where r.affects_srs) as times_seen,
  count(r.id) filter (where r.affects_srs and r.result in ('normal','mastered')) as times_correct
from english_private.phrases p
left join english_private.review_events r on r.phrase_id = p.id and r.owner_id = p.owner_id
group by p.owner_id, p.id;

grant select on english_private.phrase_review_stats to authenticated;

create or replace function english_private.current_owner()
returns uuid
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare v_owner uuid := (select auth.uid());
begin
  if v_owner is null then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  return v_owner;
end;
$$;

create or replace function english_private.sha256_json(p_value jsonb)
returns text
language sql
immutable
security invoker
set search_path = extensions, pg_catalog, pg_temp
as $$
  select encode(extensions.digest(convert_to(coalesce(p_value, 'null'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function english_private.normalize_answer(p_value text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select lower(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function english_private.commit_submission(p_owner uuid, p_submission_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare
  v_submission english_private.submissions%rowtype;
  v_result english_private.grade_results%rowtype;
  v_phrase english_private.phrases%rowtype;
  v_next timestamptz;
begin
  select * into v_submission from english_private.submissions
  where id = p_submission_id and owner_id = p_owner for update;
  if v_submission.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  if v_submission.status = 'committed' then
    return jsonb_build_object('ok', true, 'status', 'committed', 'submissionId', v_submission.id, 'idempotent', true);
  end if;
  if exists (
    select 1 from english_private.grade_results
    where submission_id = v_submission.id and status not in ('accepted','committed')
  ) then raise exception 'GRADES_NOT_CONFIRMED'; end if;
  if (select count(*) from english_private.grade_results where submission_id = v_submission.id)
     <> (select count(*) from english_private.grade_requests where submission_id = v_submission.id)
  then raise exception 'GRADE_COUNT_MISMATCH'; end if;

  insert into english_private.commit_journal(owner_id, submission_id, answer_hash, status, last_completed_step)
  values (p_owner, v_submission.id, v_submission.frozen_hash, 'committing', 'grades_validated')
  on conflict (submission_id) do update
    set status = 'committing', last_completed_step = 'grades_validated', updated_at = now(), error_code = null, error_detail = null;

  for v_result in
    select * from english_private.grade_results where submission_id = v_submission.id order by position
  loop
    select p.* into v_phrase
    from english_private.phrases p
    join english_private.grade_requests gr on gr.phrase_id = p.id
    where gr.id = v_result.grade_request_id and p.owner_id = p_owner;
    if v_phrase.id is not null then
      v_next := case v_result.result
        when 'forgotten' then now() + interval '1 day'
        when 'difficult' then now() + interval '3 days'
        when 'normal' then now() + interval '7 days'
        else now() + interval '21 days'
      end;
      update english_private.phrases set
        review_stage = case
          when v_result.result = 'forgotten' then greatest(review_stage - 1, 0)
          when v_result.result = 'difficult' then review_stage
          else review_stage + 1
        end,
        next_review_at = v_next,
        mastery_streak = case when v_result.result = 'mastered' then mastery_streak + 1 else 0 end,
        last_result = v_result.result
      where id = v_phrase.id and owner_id = p_owner;
      insert into english_private.review_events(
        owner_id, phrase_id, session_id, grade_result_id, question_position, prompt,
        expected_answer, user_answer, result, affects_srs, reviewed_at
      )
      select p_owner, v_phrase.id, v_submission.session_id, v_result.id, v_result.position,
        coalesce(gr.prompt_en, gr.prompt_zh), v_result.expected_answer, v_result.observed_answer,
        v_result.result, true, now()
      from english_private.grade_requests gr where gr.id = v_result.grade_request_id
      and not exists (select 1 from english_private.review_events re where re.grade_result_id = v_result.id);
    end if;
    update english_private.grade_results set status = 'committed' where id = v_result.id;
  end loop;

  update english_private.submissions set status = 'committed', completed_at = now(), updated_at = now()
  where id = v_submission.id;
  update english_private.sessions set status = 'committed', completed_at = now(), revision = revision + 1
  where id = v_submission.session_id and owner_id = p_owner;
  update english_private.daily_queues set status = 'committed', committed_at = now()
  where id = v_submission.queue_id and owner_id = p_owner;
  update english_private.commit_journal set
    status = 'committed', last_completed_step = 'readback', readback_status = 'verified_complete',
    result = jsonb_build_object('submissionId', v_submission.id, 'answerHash', v_submission.frozen_hash),
    completed_at = now(), updated_at = now()
  where submission_id = v_submission.id;
  return jsonb_build_object('ok', true, 'status', 'committed', 'submissionId', v_submission.id, 'answerHash', v_submission.frozen_hash);
end;
$$;

create or replace function english_api.set_question_count(
  p_count integer,
  p_mode text default 'today',
  p_revision integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, extensions, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_key text := case when p_mode = 'default' then 'question_count_default' else 'question_count_today' end;
  v_existing english_private.settings%rowtype;
  v_response jsonb;
  v_request_hash text := english_private.sha256_json(jsonb_build_object('count',p_count,'mode',p_mode,'revision',p_revision));
begin
  if p_count not between 1 and 150 then raise exception 'QUESTION_COUNT_OUT_OF_RANGE'; end if;
  if p_mode not in ('today','default') then raise exception 'INVALID_MODE'; end if;
  if p_idempotency_key is not null then
    select response into v_response from english_private.rpc_idempotency
    where owner_id=v_owner and operation='set_question_count' and idempotency_key=p_idempotency_key and request_hash=v_request_hash;
    if v_response is not null then return v_response; end if;
    if exists (select 1 from english_private.rpc_idempotency where owner_id=v_owner and operation='set_question_count' and idempotency_key=p_idempotency_key)
    then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  end if;
  select * into v_existing from english_private.settings where owner_id=v_owner and key=v_key for update;
  if v_existing.id is not null and p_revision is not null and v_existing.revision <> p_revision then raise exception 'REVISION_CONFLICT'; end if;
  insert into english_private.settings(owner_id,key,value,revision)
  values (v_owner,v_key,to_jsonb(p_count),1)
  on conflict (owner_id,key) do update set value=excluded.value, revision=english_private.settings.revision+1, updated_at=now()
  returning * into v_existing;
  v_response := jsonb_build_object('ok',true,'count',p_count,'mode',p_mode,'revision',v_existing.revision);
  if p_idempotency_key is not null then
    insert into english_private.rpc_idempotency(owner_id,operation,idempotency_key,request_hash,response)
    values(v_owner,'set_question_count',p_idempotency_key,v_request_hash,v_response);
  end if;
  return v_response;
end;
$$;

create or replace function english_api.get_review_bootstrap()
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_date date := (now() at time zone 'Asia/Shanghai')::date;
  v_queue english_private.daily_queues%rowtype;
  v_session english_private.sessions%rowtype;
  v_count integer;
begin
  select * into v_session from english_private.sessions
  where owner_id=v_owner and status in ('open','submitted','grading','needs_confirmation')
  order by created_at desc limit 1;
  if v_session.id is null then
    select * into v_queue from english_private.daily_queues
    where owner_id=v_owner and queue_date=v_date and status not in ('superseded','cancelled')
    order by revision desc, created_at desc limit 1;
    if v_queue.id is null then
      return jsonb_build_object('ok',true,'state','empty','learningDate',v_date,'session',null,'questions','[]'::jsonb);
    end if;
    select count(*) into v_count from english_private.questions where queue_id=v_queue.id;
    if v_count = 0 then
      return jsonb_build_object('ok',true,'state','questions_required','learningDate',v_date,'queueId',v_queue.id,'session',null,'questions','[]'::jsonb);
    end if;
    insert into english_private.sessions(owner_id,queue_id,learning_date,max_questions,status,started_at)
    values(v_owner,v_queue.id,v_date,least(v_count,coalesce(v_queue.adjusted_target,v_queue.planned_count)),'open',now())
    returning * into v_session;
    update english_private.questions set session_id=v_session.id,bound_at=coalesce(bound_at,now())
    where owner_id=v_owner and queue_id=v_queue.id and position<=v_session.max_questions;
    update english_private.daily_queues set status='presented' where id=v_queue.id;
  end if;
  return jsonb_build_object(
    'ok',true,'state',v_session.status,'learningDate',v_session.learning_date,
    'session',jsonb_build_object(
      'id',v_session.id,'revision',v_session.revision,'maxQuestions',v_session.max_questions,'status',v_session.status,
      'submissionId',(select s.id from english_private.submissions s where s.session_id=v_session.id limit 1)
    ),
    'questions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',q.id,'position',q.position,'phraseId',q.phrase_id,'candidateId',q.candidate_id,
      'questionType',q.question_type,'promptZh',q.prompt_zh,'promptEn',q.prompt_en,
      'expectedAnswers',q.expected_answers,'acceptedVariants',q.accepted_variants,
      'semanticBoundary',q.semantic_boundary,'contentHash',q.content_hash,
      'draft',case when d.id is null then null else jsonb_build_object('answer',d.answer,'revision',d.revision,'answerHash',d.answer_hash,'status',d.submit_status) end
    ) order by q.position) from english_private.questions q left join english_private.answer_drafts d on d.question_id=q.id and d.session_id=v_session.id
      where q.owner_id=v_owner and q.session_id=v_session.id and q.position<=v_session.max_questions),'[]'::jsonb)
  );
end;
$$;

create or replace function english_api.checkpoint_answers(
  p_session_id uuid,
  p_answers jsonb,
  p_session_revision integer,
  p_idempotency_key text,
  p_frozen_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, extensions, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_session english_private.sessions%rowtype;
  v_answer jsonb;
  v_question english_private.questions%rowtype;
  v_existing english_private.answer_drafts%rowtype;
  v_hash text := english_private.sha256_json(p_answers);
  v_response jsonb;
  v_revision integer;
begin
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) < 1 then raise exception 'INVALID_ANSWERS'; end if;
  if v_hash <> p_frozen_hash then raise exception 'FROZEN_HASH_MISMATCH'; end if;
  select response into v_response from english_private.rpc_idempotency
  where owner_id=v_owner and operation='checkpoint_answers' and idempotency_key=p_idempotency_key and request_hash=v_hash;
  if v_response is not null then return v_response; end if;
  if exists (select 1 from english_private.rpc_idempotency where owner_id=v_owner and operation='checkpoint_answers' and idempotency_key=p_idempotency_key)
  then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  begin
    select * into v_session from english_private.sessions where id=p_session_id and owner_id=v_owner for update nowait;
  exception when lock_not_available then raise exception 'BUSY_RETRY'; end;
  if v_session.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'open' then raise exception 'SESSION_NOT_OPEN'; end if;
  if v_session.revision <> p_session_revision then raise exception 'REVISION_CONFLICT'; end if;

  for v_answer in select value from jsonb_array_elements(p_answers)
  loop
    if nullif(v_answer->>'answer','') is null or (v_answer->>'revision')::integer < 1 or nullif(v_answer->>'revealHash','') is null then
      raise exception 'INVALID_ANSWER_ROW';
    end if;
    select * into v_question from english_private.questions
    where session_id=v_session.id and owner_id=v_owner and position=(v_answer->>'position')::integer;
    if v_question.id is null then raise exception 'QUESTION_NOT_FOUND'; end if;
    select * into v_existing from english_private.answer_drafts where session_id=v_session.id and position=v_question.position;
    if v_existing.id is not null and v_existing.revision >= (v_answer->>'revision')::integer then
      if v_existing.revision=(v_answer->>'revision')::integer and v_existing.answer=(v_answer->>'answer') then continue; end if;
      raise exception 'ANSWER_REVISION_CONFLICT';
    end if;
    insert into english_private.answer_drafts(
      owner_id,session_id,question_id,position,answer,revision,reveal_hash,answer_hash,submit_status,idempotency_key,client_instance_id,page_started_at
    ) values (
      v_owner,v_session.id,v_question.id,v_question.position,v_answer->>'answer',(v_answer->>'revision')::integer,
      v_answer->>'revealHash',english_private.sha256_json(jsonb_build_object('questionId',v_question.id,'answer',v_answer->>'answer','revision',(v_answer->>'revision')::integer)),
      'checkpointed',p_idempotency_key || ':' || v_question.position, v_answer->>'clientInstanceId', nullif(v_answer->>'pageStartedAt','')::timestamptz
    ) on conflict (session_id,position) do update set
      answer=excluded.answer,revision=excluded.revision,reveal_hash=excluded.reveal_hash,answer_hash=excluded.answer_hash,
      submit_status='checkpointed',idempotency_key=excluded.idempotency_key,client_instance_id=excluded.client_instance_id,
      page_started_at=excluded.page_started_at,updated_at=now()
    returning revision into v_revision;
    insert into english_private.answer_draft_history(
      owner_id,answer_draft_id,session_id,question_id,position,previous_answer,previous_revision,next_answer,next_revision,event_type,
      client_instance_id,page_started_at,answer_hash
    ) select v_owner,d.id,v_session.id,v_question.id,v_question.position,v_existing.answer,v_existing.revision,d.answer,d.revision,
      'checkpoint',d.client_instance_id,d.page_started_at,d.answer_hash
    from english_private.answer_drafts d where d.session_id=v_session.id and d.position=v_question.position;
  end loop;
  update english_private.sessions set revision=revision+1 where id=v_session.id returning revision into v_revision;
  v_response := jsonb_build_object('ok',true,'sessionId',v_session.id,'revision',v_revision,'checkpointed',jsonb_array_length(p_answers),'frozenHash',v_hash);
  insert into english_private.rpc_idempotency(owner_id,operation,idempotency_key,request_hash,response)
  values(v_owner,'checkpoint_answers',p_idempotency_key,v_hash,v_response);
  return v_response;
end;
$$;

create or replace function english_api.submit_session(
  p_session_id uuid,
  p_answers jsonb,
  p_session_revision integer,
  p_idempotency_key text,
  p_frozen_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, extensions, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_session english_private.sessions%rowtype;
  v_submission english_private.submissions%rowtype;
  v_actual_hash text;
  v_response jsonb;
begin
  if p_answers is not null and jsonb_array_length(p_answers) > 0 then
    perform english_api.checkpoint_answers(p_session_id,p_answers,p_session_revision,p_idempotency_key || ':tail',english_private.sha256_json(p_answers));
    p_session_revision := p_session_revision + 1;
  end if;
  begin
    select * into v_session from english_private.sessions where id=p_session_id and owner_id=v_owner for update nowait;
  exception when lock_not_available then raise exception 'BUSY_RETRY'; end;
  if v_session.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.revision <> p_session_revision then raise exception 'REVISION_CONFLICT'; end if;
  if (select count(*) from english_private.answer_drafts where session_id=v_session.id)
     <> v_session.max_questions then raise exception 'INCOMPLETE_ANSWER_SET'; end if;
  select english_private.sha256_json(jsonb_agg(jsonb_build_object(
    'position',d.position,'questionId',d.question_id,'answer',d.answer,'revision',d.revision,'answerHash',d.answer_hash
  ) order by d.position)) into v_actual_hash
  from english_private.answer_drafts d where d.session_id=v_session.id;
  if v_actual_hash <> p_frozen_hash then raise exception 'FROZEN_HASH_MISMATCH'; end if;
  select * into v_submission from english_private.submissions where session_id=v_session.id;
  if v_submission.id is not null then
    if v_submission.frozen_hash <> v_actual_hash then raise exception 'SUBMISSION_HASH_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'submissionId',v_submission.id,'status',v_submission.status,'answerHash',v_submission.frozen_hash,'idempotent',true);
  end if;
  insert into english_private.submissions(owner_id,session_id,queue_id,revision,frozen_hash,idempotency_key,status)
  values(v_owner,v_session.id,v_session.queue_id,1,v_actual_hash,p_idempotency_key,'submitted') returning * into v_submission;
  insert into english_private.grade_requests(
    owner_id,submission_id,question_id,position,phrase_id,candidate_id,observed_answer,prompt_zh,prompt_en,
    expected_answers,accepted_variants,semantic_boundary,grading_rubric,review_stage,answer_hash,request_status
  ) select v_owner,v_submission.id,q.id,q.position,q.phrase_id,q.candidate_id,d.answer,q.prompt_zh,q.prompt_en,
    q.expected_answers,q.accepted_variants,q.semantic_boundary,q.grading_rubric,p.review_stage,d.answer_hash,'ready'
  from english_private.questions q join english_private.answer_drafts d on d.question_id=q.id and d.session_id=v_session.id
  left join english_private.phrases p on p.id=q.phrase_id where q.session_id=v_session.id order by q.position;
  update english_private.answer_drafts set submit_status='submitted' where session_id=v_session.id;
  update english_private.sessions set status='submitted',submitted_at=now(),revision=revision+1 where id=v_session.id;
  insert into english_private.commit_journal(owner_id,submission_id,answer_hash,status,last_completed_step)
  values(v_owner,v_submission.id,v_actual_hash,'pending','grade_requests_frozen');
  v_response := jsonb_build_object('ok',true,'submissionId',v_submission.id,'status','submitted','answerHash',v_actual_hash,'gradeRequestCount',v_session.max_questions);
  return v_response;
end;
$$;

create or replace function english_api.get_submission_status(p_submission_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'ok',true,'submissionId',s.id,'sessionId',s.session_id,'status',s.status,'answerHash',s.frozen_hash,
    'revision',s.revision,'errorCode',s.error_code,'errorDetail',s.error_detail,
    'grades',coalesce((select jsonb_agg(jsonb_build_object(
      'position',g.position,'result',g.result,'feedbackZh',g.feedback_zh,'errorCategory',g.error_category,
      'confidence',g.confidence,'evidence',g.evidence,'expectedAnswer',g.expected_answer,
      'observedAnswer',g.observed_answer,'status',g.status,'needsConfirmation',g.status='needs_confirmation',
      'extraPractice',g.extra_practice
    ) order by g.position) from english_private.grade_results g where g.submission_id=s.id),'[]'::jsonb),
    'journal',(select jsonb_build_object('status',j.status,'lastCompletedStep',j.last_completed_step,'readbackStatus',j.readback_status,'errorCode',j.error_code) from english_private.commit_journal j where j.submission_id=s.id)
  ) from english_private.submissions s
  where s.id=p_submission_id and s.owner_id=english_private.current_owner();
$$;

create or replace function english_api.confirm_grades(
  p_submission_id uuid,
  p_decisions jsonb,
  p_revision integer,
  p_idempotency_key text,
  p_frozen_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_submission english_private.submissions%rowtype;
  v_decision jsonb;
  v_result english_private.grade_results%rowtype;
  v_hash text := english_private.sha256_json(p_decisions);
  v_response jsonb;
begin
  if v_hash <> p_frozen_hash then raise exception 'FROZEN_HASH_MISMATCH'; end if;
  select response into v_response from english_private.rpc_idempotency
  where owner_id=v_owner and operation='confirm_grades' and idempotency_key=p_idempotency_key and request_hash=v_hash;
  if v_response is not null then return v_response; end if;
  select * into v_submission from english_private.submissions where id=p_submission_id and owner_id=v_owner for update;
  if v_submission.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  if v_submission.revision <> p_revision then raise exception 'REVISION_CONFLICT'; end if;
  for v_decision in select value from jsonb_array_elements(p_decisions)
  loop
    select * into v_result from english_private.grade_results
    where submission_id=v_submission.id and position=(v_decision->>'position')::integer for update;
    if v_result.id is null or v_result.status <> 'needs_confirmation' then raise exception 'CONFIRMATION_NOT_REQUIRED'; end if;
    if v_decision->>'decision' not in ('accept','reject') then raise exception 'INVALID_CONFIRMATION_DECISION'; end if;
    update english_private.grade_results set
      status=case when v_decision->>'decision'='accept' then 'accepted' else 'rejected' end,
      confirmation_decision=v_decision->>'decision'
    where id=v_result.id;
  end loop;
  if exists (select 1 from english_private.grade_results where submission_id=v_submission.id and status='rejected') then
    update english_private.submissions set status='rejected',revision=revision+1,updated_at=now() where id=v_submission.id returning * into v_submission;
    v_response := jsonb_build_object('ok',true,'submissionId',v_submission.id,'status','rejected','revision',v_submission.revision);
  elsif exists (select 1 from english_private.grade_results where submission_id=v_submission.id and status='needs_confirmation') then
    update english_private.submissions set status='needs_confirmation',revision=revision+1,updated_at=now() where id=v_submission.id returning * into v_submission;
    v_response := jsonb_build_object('ok',true,'submissionId',v_submission.id,'status','needs_confirmation','revision',v_submission.revision);
  else
    update english_private.grade_results set status='accepted' where submission_id=v_submission.id and status='staged';
    v_response := english_private.commit_submission(v_owner,v_submission.id);
  end if;
  insert into english_private.rpc_idempotency(owner_id,operation,idempotency_key,request_hash,response)
  values(v_owner,'confirm_grades',p_idempotency_key,v_hash,v_response);
  return v_response;
end;
$$;

create or replace function english_api.retry_submission_commit(
  p_submission_id uuid,
  p_revision integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_submission english_private.submissions%rowtype;
  v_response jsonb;
  v_hash text := english_private.sha256_json(jsonb_build_object('submissionId',p_submission_id,'revision',p_revision));
begin
  select response into v_response from english_private.rpc_idempotency
  where owner_id=v_owner and operation='retry_submission_commit' and idempotency_key=p_idempotency_key and request_hash=v_hash;
  if v_response is not null then return v_response; end if;
  select * into v_submission from english_private.submissions where id=p_submission_id and owner_id=v_owner for update;
  if v_submission.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  if v_submission.revision <> p_revision then raise exception 'REVISION_CONFLICT'; end if;
  v_response := english_private.commit_submission(v_owner,p_submission_id);
  insert into english_private.rpc_idempotency(owner_id,operation,idempotency_key,request_hash,response)
  values(v_owner,'retry_submission_commit',p_idempotency_key,v_hash,v_response);
  return v_response;
end;
$$;

create or replace function english_api.submit_extra_practice(
  p_submission_id uuid,
  p_phrase_id uuid,
  p_practice_type text,
  p_prompt text,
  p_answer text,
  p_reference_answer text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare v_owner uuid := english_private.current_owner(); v_id uuid;
begin
  insert into english_private.extra_practice(owner_id,submission_id,phrase_id,practice_type,prompt,answer,reference_answer,affects_srs,idempotency_key)
  values(v_owner,p_submission_id,p_phrase_id,p_practice_type,p_prompt,p_answer,p_reference_answer,false,p_idempotency_key)
  on conflict (owner_id,idempotency_key) do update set answer=english_private.extra_practice.answer
  returning id into v_id;
  return jsonb_build_object('ok',true,'practiceId',v_id,'affectsSrs',false);
end;
$$;

create or replace function english_api.create_ai_job(
  p_kind text,
  p_requested_count integer default null,
  p_subject_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, extensions, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_snapshot jsonb;
  v_job english_private.ai_jobs%rowtype;
  v_key text := coalesce(p_idempotency_key,gen_random_uuid()::text);
begin
  if p_kind not in ('context_extract','candidate_generate','question_prepare','grade_submission') then raise exception 'INVALID_AI_JOB_KIND'; end if;
  if p_requested_count is not null and p_requested_count not between 1 and 150 then raise exception 'REQUESTED_COUNT_OUT_OF_RANGE'; end if;
  if p_kind='context_extract' then
    select coalesce(jsonb_agg(jsonb_build_object('contextId',id,'rawText',raw_text,'selectedSpans',selected_spans) order by created_at),'[]'::jsonb)
    into v_snapshot from english_private.contexts where owner_id=v_owner and status='pending' and (p_subject_id is null or id=p_subject_id);
  elsif p_kind='candidate_generate' then
    v_snapshot := jsonb_build_object('requestedCount',coalesce(p_requested_count,20),'existing',coalesce((select jsonb_agg(chunk order by chunk) from english_private.phrases where owner_id=v_owner),'[]'::jsonb));
  elsif p_kind='question_prepare' then
    select coalesce(jsonb_agg(jsonb_build_object('queueItemId',qi.id,'position',qi.position,'phraseId',qi.phrase_id,'candidateId',qi.candidate_id,'chunk',qi.chunk,'cueZh',qi.cue_zh,'example',qi.natural_example) order by qi.position),'[]'::jsonb)
    into v_snapshot from english_private.daily_queue_items qi join english_private.daily_queues q on q.id=qi.queue_id
    where qi.owner_id=v_owner and (p_subject_id is null or q.id=p_subject_id) and q.status in ('planned','presented');
  else
    select coalesce(jsonb_agg(jsonb_build_object('requestId',gr.id,'submissionId',gr.submission_id,'position',gr.position,'phraseId',gr.phrase_id,'candidateId',gr.candidate_id,'observedAnswer',gr.observed_answer,'promptZh',gr.prompt_zh,'promptEn',gr.prompt_en,'expectedAnswers',gr.expected_answers,'acceptedVariants',gr.accepted_variants,'semanticBoundary',gr.semantic_boundary,'gradingRubric',gr.grading_rubric,'answerHash',gr.answer_hash) order by gr.position),'[]'::jsonb)
    into v_snapshot from english_private.grade_requests gr where gr.owner_id=v_owner and gr.request_status='ready' and (p_subject_id is null or gr.submission_id=p_subject_id);
  end if;
  if jsonb_typeof(v_snapshot)='array' and jsonb_array_length(v_snapshot)=0 then raise exception 'AI_JOB_EMPTY'; end if;
  insert into english_private.ai_jobs(owner_id,kind,subject_id,requested_count,expected_count,input_snapshot,snapshot_hash,idempotency_key)
  values(v_owner,p_kind,p_subject_id,p_requested_count,case when jsonb_typeof(v_snapshot)='array' then jsonb_array_length(v_snapshot) else coalesce(p_requested_count,0) end,v_snapshot,english_private.sha256_json(v_snapshot),v_key)
  on conflict (owner_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning * into v_job;
  if p_kind='context_extract' then update english_private.contexts set status='processing' where owner_id=v_owner and id in (select (x->>'contextId')::uuid from jsonb_array_elements(v_snapshot) x); end if;
  return jsonb_build_object('ok',true,'jobId',v_job.id,'kind',v_job.kind,'snapshotHash',v_job.snapshot_hash,'batchId',v_job.batch_id,'expectedCount',v_job.expected_count,'status',v_job.status);
end;
$$;

create or replace function english_api.get_ai_job_prompt(p_job_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare v_owner uuid := english_private.current_owner(); v_job english_private.ai_jobs%rowtype;
begin
  select * into v_job from english_private.ai_jobs where id=p_job_id and owner_id=v_owner;
  if v_job.id is null then raise exception 'AI_JOB_NOT_FOUND'; end if;
  return jsonb_build_object(
    'ok',true,'jobId',v_job.id,'kind',v_job.kind,'snapshotHash',v_job.snapshot_hash,'batchId',v_job.batch_id,
    'expectedCount',v_job.expected_count,'snapshot',v_job.input_snapshot,
    'prompt',format('Return one strict JSON object only. Echo jobId=%s, snapshotHash=%s, batchId=%s and include modelId plus items. Do not add markdown. Job kind: %s.',v_job.id,v_job.snapshot_hash,v_job.batch_id,v_job.kind)
  );
end;
$$;

create or replace function english_api.import_ai_result(p_job_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_job english_private.ai_jobs%rowtype;
  v_item jsonb;
  v_request english_private.grade_requests%rowtype;
  v_needs_confirmation boolean;
  v_count integer;
  v_submission_id uuid;
begin
  select * into v_job from english_private.ai_jobs where id=p_job_id and owner_id=v_owner for update;
  if v_job.id is null then raise exception 'AI_JOB_NOT_FOUND'; end if;
  if v_job.status in ('cancelled','consumed') then raise exception 'AI_JOB_CLOSED'; end if;
  if p_payload->>'jobId' <> v_job.id::text or p_payload->>'snapshotHash' <> v_job.snapshot_hash or p_payload->>'batchId' <> v_job.batch_id::text then raise exception 'AI_SNAPSHOT_MISMATCH'; end if;
  if nullif(p_payload->>'modelId','') is null or jsonb_typeof(p_payload->'items') <> 'array' then raise exception 'INVALID_AI_PAYLOAD'; end if;
  v_count := jsonb_array_length(p_payload->'items');
  if v_count <> v_job.expected_count then raise exception 'AI_ITEM_COUNT_MISMATCH'; end if;

  if v_job.kind='grade_submission' then
    for v_item in select value from jsonb_array_elements(p_payload->'items')
    loop
      select * into v_request from english_private.grade_requests where id=(v_item->>'requestId')::uuid and owner_id=v_owner and request_status='ready';
      if v_request.id is null or v_item->>'observedAnswer' <> v_request.observed_answer or v_item->>'answerHash' <> v_request.answer_hash then raise exception 'GRADE_REQUEST_ECHO_MISMATCH'; end if;
      if v_item->>'result' not in ('forgotten','difficult','normal','mastered') or (v_item->>'confidence')::numeric not between 0 and 1 then raise exception 'INVALID_GRADE_RESULT'; end if;
    end loop;
    for v_item in select value from jsonb_array_elements(p_payload->'items')
    loop
      select * into v_request from english_private.grade_requests where id=(v_item->>'requestId')::uuid;
      v_needs_confirmation := (v_item->>'confidence')::numeric < 0.75
        or (english_private.normalize_answer(v_item->>'observedAnswer') <> english_private.normalize_answer(coalesce(v_item->>'expectedAnswer','')) and v_item->>'result' in ('normal','mastered'));
      insert into english_private.grade_results(
        owner_id,submission_id,grade_request_id,position,result,feedback_zh,error_category,confidence,evidence,expected_answer,
        observed_answer,candidate_suggestions,extra_practice,grading_batch_id,prompt_version,status
      ) values (
        v_owner,v_request.submission_id,v_request.id,v_request.position,v_item->>'result',v_item->>'feedbackZh',v_item->>'errorCategory',
        (v_item->>'confidence')::numeric,v_item->>'evidence',v_item->>'expectedAnswer',v_item->>'observedAnswer',
        coalesce(v_item->'candidateSuggestions','[]'::jsonb),coalesce(v_item->'extraPractice','[]'::jsonb),v_job.batch_id::text,p_payload->>'promptVersion',
        case when v_needs_confirmation then 'needs_confirmation' else 'accepted' end
      ) on conflict (submission_id,position) do nothing;
      update english_private.grade_requests set request_status='graded' where id=v_request.id;
      v_submission_id := v_request.submission_id;
    end loop;
    if exists (select 1 from english_private.grade_results where submission_id=v_submission_id and status='needs_confirmation') then
      update english_private.submissions set status='needs_confirmation',revision=revision+1,updated_at=now() where id=v_submission_id;
    else
      perform english_private.commit_submission(v_owner,v_submission_id);
    end if;
  elsif v_job.kind='context_extract' then
    for v_item in select value from jsonb_array_elements(p_payload->'items')
    loop
      if nullif(v_item->>'contextId','') is null or nullif(v_item->>'candidate','') is null then raise exception 'INVALID_CONTEXT_CANDIDATE'; end if;
    end loop;
    for v_item in select value from jsonb_array_elements(p_payload->'items')
    loop
      insert into english_private.context_candidates(owner_id,context_id,position,selected_text,candidate,cue_zh,candidate_type,context_meaning,why_useful,topic,difficulty,natural_example,common_mistake,extraction_rationale,confidence,processing_batch_id)
      values(v_owner,(v_item->>'contextId')::uuid,(v_item->>'position')::integer,v_item->>'selectedText',v_item->>'candidate',v_item->>'cueZh',v_item->>'candidateType',v_item->>'contextMeaning',v_item->>'whyUseful',v_item->>'topic',v_item->>'difficulty',v_item->>'naturalExample',v_item->>'commonMistake',v_item->>'extractionRationale',(v_item->>'confidence')::numeric,v_job.batch_id::text)
      on conflict (context_id,position) do nothing;
      update english_private.contexts set status='review',processed_at=now() where id=(v_item->>'contextId')::uuid and owner_id=v_owner;
    end loop;
  elsif v_job.kind='candidate_generate' then
    for v_item in select value from jsonb_array_elements(p_payload->'items')
    loop
      if nullif(v_item->>'candidate','') is null then raise exception 'INVALID_CANDIDATE'; end if;
    end loop;
    for v_item in select value from jsonb_array_elements(p_payload->'items')
    loop
      insert into english_private.candidate_generation_rows(owner_id,request_id,requested_count,position,candidate,cue_zh,candidate_type,source,source_context,why_useful,topic,difficulty,natural_example,common_mistake,generation_batch_id,model_id,status)
      values(v_owner,v_job.id::text,v_job.requested_count,(v_item->>'position')::integer,v_item->>'candidate',v_item->>'cueZh',v_item->>'candidateType',v_item->>'source',v_item->>'context',v_item->>'whyUseful',v_item->>'topic',v_item->>'difficulty',v_item->>'naturalExample',v_item->>'commonMistake',v_job.batch_id::text,p_payload->>'modelId','staged');
    end loop;
  else
    for v_item in select value from jsonb_array_elements(p_payload->'items')
    loop
      if nullif(v_item->>'queueItemId','') is null or nullif(v_item->>'contentHash','') is null then raise exception 'INVALID_QUESTION'; end if;
    end loop;
    for v_item in select value from jsonb_array_elements(p_payload->'items')
    loop
      insert into english_private.questions(owner_id,queue_id,queue_item_id,position,phrase_id,candidate_id,question_type,prompt_zh,prompt_en,expected_answers,accepted_variants,semantic_boundary,grading_rubric,generation_id,model_id,prompt_version,content_hash,status)
      select v_owner,qi.queue_id,qi.id,qi.position,qi.phrase_id,qi.candidate_id,v_item->>'questionType',v_item->>'promptZh',v_item->>'promptEn',coalesce(v_item->'expectedAnswers','[]'::jsonb),coalesce(v_item->'acceptedVariants','[]'::jsonb),v_item->>'semanticBoundary',v_item->>'gradingRubric',v_job.id::text,p_payload->>'modelId',v_item->>'promptVersion',v_item->>'contentHash','ready'
      from english_private.daily_queue_items qi where qi.id=(v_item->>'queueItemId')::uuid and qi.owner_id=v_owner
      on conflict (queue_id,position) do nothing;
    end loop;
  end if;
  update english_private.ai_jobs set output_payload=p_payload,model_id=p_payload->>'modelId',status='consumed',imported_at=now(),validated_at=now(),consumed_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'jobId',v_job.id,'status','consumed','actualCount',v_count);
end;
$$;

create or replace function english_api.cancel_ai_job(p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare v_owner uuid := english_private.current_owner(); v_job english_private.ai_jobs%rowtype;
begin
  select * into v_job from english_private.ai_jobs where id=p_job_id and owner_id=v_owner for update;
  if v_job.id is null then raise exception 'AI_JOB_NOT_FOUND'; end if;
  if v_job.status='consumed' then raise exception 'AI_JOB_CONSUMED'; end if;
  if v_job.kind='context_extract' then
    update english_private.contexts set status='pending' where owner_id=v_owner and status='processing'
    and id in (select (x->>'contextId')::uuid from jsonb_array_elements(v_job.input_snapshot) x);
  end if;
  update english_private.ai_jobs set status='cancelled',cancelled_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'jobId',v_job.id,'status','cancelled');
end;
$$;

create or replace function english_api.save_context(
  p_payload jsonb,
  p_revision integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, extensions, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_id uuid;
  v_key text := coalesce(p_idempotency_key,gen_random_uuid()::text);
  v_hash text := english_private.sha256_json(jsonb_build_object('payload',p_payload,'revision',p_revision));
  v_response jsonb;
begin
  select response into v_response from english_private.rpc_idempotency
  where owner_id=v_owner and operation='save_context' and idempotency_key=v_key and request_hash=v_hash;
  if v_response is not null then return v_response; end if;
  if exists (select 1 from english_private.rpc_idempotency where owner_id=v_owner and operation='save_context' and idempotency_key=v_key)
    then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if p_revision is not null and p_revision <> 0 then raise exception 'REVISION_CONFLICT'; end if;
  if length(trim(coalesce(p_payload->>'rawText',''))) < 1 then raise exception 'CONTEXT_TEXT_REQUIRED'; end if;
  insert into english_private.contexts(owner_id,legacy_context_id,raw_text,selected_spans,source_url,source_title,user_note,status,capture_request_id)
  values(v_owner,null,p_payload->>'rawText',coalesce(p_payload->'selectedSpans','[]'::jsonb),p_payload->>'sourceUrl',p_payload->>'sourceTitle',p_payload->>'userNote','pending',v_key)
  returning id into v_id;
  v_response := jsonb_build_object('ok',true,'contextId',v_id,'status','pending','revision',1);
  insert into english_private.rpc_idempotency(owner_id,operation,idempotency_key,request_hash,response)
  values(v_owner,'save_context',v_key,v_hash,v_response);
  return v_response;
end;
$$;

create or replace function english_api.get_context_inbox()
returns jsonb
language sql
stable
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
  select jsonb_build_object('ok',true,'contexts',coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'rawText',c.raw_text,'selectedSpans',c.selected_spans,'sourceUrl',c.source_url,'sourceTitle',c.source_title,
    'userNote',c.user_note,'status',c.status,'createdAt',c.created_at,
    'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',cc.id,'position',cc.position,'candidate',cc.candidate,'cueZh',cc.cue_zh,'whyUseful',cc.why_useful,'confidence',cc.confidence,'decisionStatus',cc.decision_status) order by cc.position) from english_private.context_candidates cc where cc.context_id=c.id),'[]'::jsonb)
  ) order by c.created_at desc),'[]'::jsonb)) from english_private.contexts c
  where c.owner_id=english_private.current_owner() and c.status in ('pending','processing','review');
$$;

create or replace function english_api.decide_context_candidate(
  p_candidate_id uuid,
  p_action text,
  p_edited_candidate text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_proposal english_private.context_candidates%rowtype;
  v_candidate_id uuid;
  v_key text := coalesce(p_idempotency_key,gen_random_uuid()::text);
  v_hash text := english_private.sha256_json(jsonb_build_object('candidateId',p_candidate_id,'action',p_action,'editedCandidate',p_edited_candidate));
  v_response jsonb;
begin
  select response into v_response from english_private.rpc_idempotency
  where owner_id=v_owner and operation='decide_context_candidate' and idempotency_key=v_key and request_hash=v_hash;
  if v_response is not null then return v_response; end if;
  if exists (select 1 from english_private.rpc_idempotency where owner_id=v_owner and operation='decide_context_candidate' and idempotency_key=v_key)
    then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if p_action not in ('accept','edit','reject') then raise exception 'INVALID_CONTEXT_DECISION'; end if;
  select * into v_proposal from english_private.context_candidates where id=p_candidate_id and owner_id=v_owner for update;
  if v_proposal.id is null then raise exception 'CONTEXT_CANDIDATE_NOT_FOUND'; end if;
  if p_action='reject' then
    update english_private.context_candidates set decision_status='rejected' where id=v_proposal.id;
  else
    if p_action='edit' and nullif(trim(p_edited_candidate),'') is null then raise exception 'EDITED_CANDIDATE_REQUIRED'; end if;
    insert into english_private.candidates(owner_id,candidate,candidate_type,cue_zh,source,source_context,why_useful,topic,difficulty,natural_example,common_mistake,origin_type,origin_context_id,selected_text,status)
    values(v_owner,case when p_action='edit' then p_edited_candidate else v_proposal.candidate end,v_proposal.candidate_type,v_proposal.cue_zh,'context',v_proposal.context_meaning,v_proposal.why_useful,v_proposal.topic,v_proposal.difficulty,v_proposal.natural_example,v_proposal.common_mistake,'context',v_proposal.context_id,v_proposal.selected_text,'ready')
    returning id into v_candidate_id;
    update english_private.context_candidates set decision_status=case when p_action='edit' then 'edited' else 'accepted' end,edited_candidate=p_edited_candidate,candidate_id=v_candidate_id,committed_at=now() where id=v_proposal.id;
  end if;
  v_response := jsonb_build_object('ok',true,'proposalId',v_proposal.id,'action',p_action,'candidateId',v_candidate_id);
  insert into english_private.rpc_idempotency(owner_id,operation,idempotency_key,request_hash,response)
  values(v_owner,'decide_context_candidate',v_key,v_hash,v_response);
  return v_response;
end;
$$;

create or replace function english_api.get_dashboard()
returns jsonb
language sql
stable
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
  with owner as (select english_private.current_owner() id),
  today as (select (now() at time zone 'Asia/Shanghai')::date d)
  select jsonb_build_object(
    'ok',true,'learningDate',today.d,
    'today',jsonb_build_object(
      'planned',coalesce((select max(coalesce(q.adjusted_target,q.planned_count)) from english_private.daily_queues q,owner where q.owner_id=owner.id and q.queue_date=today.d),0),
      'completed',coalesce((select count(*) from english_private.review_events r,owner where r.owner_id=owner.id and (r.reviewed_at at time zone 'Asia/Shanghai')::date=today.d and r.affects_srs),0),
      'waitingForGrading',coalesce((select count(*) from english_private.submissions s,owner where s.owner_id=owner.id and s.status in ('submitted','grading','needs_confirmation')),0)
    ),
    'totals',jsonb_build_object(
      'phrases',(select count(*) from english_private.phrases p,owner where p.owner_id=owner.id),
      'reviews',(select count(*) from english_private.review_events r,owner where r.owner_id=owner.id and r.affects_srs),
      'accuracy',coalesce((select round(100.0*count(*) filter(where r.result in ('normal','mastered'))/nullif(count(*),0),1) from english_private.review_events r,owner where r.owner_id=owner.id and r.affects_srs),0)
    )
  ) from owner,today;
$$;

create or replace function english_api.get_phrase_library(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
  select jsonb_build_object('ok',true,'items',coalesce(jsonb_agg(item order by item->>'chunk'),'[]'::jsonb))
  from (
    select jsonb_build_object(
      'id',p.id,'chunk',p.chunk,'cueZh',p.cue_zh,'type',p.phrase_type,'topic',p.topic,'difficulty',p.difficulty,
      'status',p.status,'reviewStage',p.review_stage,'nextReviewAt',p.next_review_at,'lastReviewedAt',s.last_reviewed_at,
      'timesSeen',s.times_seen,'timesCorrect',s.times_correct,'naturalExample',p.natural_example,'lastResult',p.last_result
    ) item
    from english_private.phrases p join english_private.phrase_review_stats s on s.phrase_id=p.id
    where p.owner_id=english_private.current_owner() and (p_search is null or p.chunk ilike '%'||p_search||'%' or p.cue_zh ilike '%'||p_search||'%')
    order by p.chunk
    limit least(greatest(p_limit,1),200) offset greatest(p_offset,0)
  ) page;
$$;

create or replace function english_api.get_phrase_detail(p_phrase_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'ok',true,'phrase',jsonb_build_object('id',p.id,'chunk',p.chunk,'cueZh',p.cue_zh,'type',p.phrase_type,'topic',p.topic,'difficulty',p.difficulty,'status',p.status,'reviewStage',p.review_stage,'nextReviewAt',p.next_review_at,'commonMistake',p.common_mistake,'naturalExample',p.natural_example,'notes',p.notes,'canonicalPattern',p.canonical_pattern),
    'stats',jsonb_build_object('lastReviewedAt',s.last_reviewed_at,'timesSeen',s.times_seen,'timesCorrect',s.times_correct),
    'history',coalesce((select jsonb_agg(jsonb_build_object('reviewedAt',r.reviewed_at,'result',r.result,'prompt',r.prompt,'userAnswer',r.user_answer,'expectedAnswer',r.expected_answer) order by r.reviewed_at desc) from english_private.review_events r where r.phrase_id=p.id),'[]'::jsonb)
  ) from english_private.phrases p join english_private.phrase_review_stats s on s.phrase_id=p.id
  where p.id=p_phrase_id and p.owner_id=english_private.current_owner();
$$;

create or replace function english_api.get_system_status()
returns jsonb
language sql
stable
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
  with owner as (select english_private.current_owner() id)
  select jsonb_build_object(
    'ok',true,'database','available','timezone','Asia/Shanghai',
    'pendingAiJobs',(select count(*) from english_private.ai_jobs j,owner where j.owner_id=owner.id and j.status in ('prepared','imported','validated')),
    'failedSubmissions',(select count(*) from english_private.submissions s,owner where s.owner_id=owner.id and s.status='failed'),
    'lastCommittedAt',(select max(s.completed_at) from english_private.submissions s,owner where s.owner_id=owner.id and s.status='committed'),
    'latestImport',(select jsonb_build_object('id',b.id,'status',b.status,'sourceSha256',b.source_sha256,'snapshotSha256',b.snapshot_sha256,'createdAt',b.created_at) from english_private.import_batches b,owner where b.owner_id=owner.id order by b.created_at desc limit 1)
  ) from owner;
$$;

revoke all on all functions in schema english_api from public, anon;
grant execute on function english_api.set_question_count(integer,text,integer,text) to authenticated;
grant execute on function english_api.get_review_bootstrap() to authenticated;
grant execute on function english_api.checkpoint_answers(uuid,jsonb,integer,text,text) to authenticated;
grant execute on function english_api.submit_session(uuid,jsonb,integer,text,text) to authenticated;
grant execute on function english_api.get_submission_status(uuid) to authenticated;
grant execute on function english_api.confirm_grades(uuid,jsonb,integer,text,text) to authenticated;
grant execute on function english_api.retry_submission_commit(uuid,integer,text) to authenticated;
grant execute on function english_api.submit_extra_practice(uuid,uuid,text,text,text,text,text) to authenticated;
grant execute on function english_api.create_ai_job(text,integer,uuid,text) to authenticated;
grant execute on function english_api.get_ai_job_prompt(uuid) to authenticated;
grant execute on function english_api.import_ai_result(uuid,jsonb) to authenticated;
grant execute on function english_api.cancel_ai_job(uuid) to authenticated;
grant execute on function english_api.save_context(jsonb,integer,text) to authenticated;
grant execute on function english_api.get_context_inbox() to authenticated;
grant execute on function english_api.decide_context_candidate(uuid,text,text,text) to authenticated;
grant execute on function english_api.get_dashboard() to authenticated;
grant execute on function english_api.get_phrase_library(text,integer,integer) to authenticated;
grant execute on function english_api.get_phrase_detail(uuid) to authenticated;
grant execute on function english_api.get_system_status() to authenticated;

notify pgrst, 'reload schema';

commit;
