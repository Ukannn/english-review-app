\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$
begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;exception when others then
  if position(expected in sqlerrm)>0 then return;else raise;end if;
 end;
 raise exception 'Expected error % but succeeded',expected;
end $$;

insert into auth.users(id,email,aud,role) values
 ('e5555555-5555-4555-8555-555555555555','word-test@example.invalid','authenticated','authenticated'),
 ('f6666666-6666-4666-8666-666666666666','other-word-test@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('e5555555-5555-4555-8555-555555555555');
select set_config('request.jwt.claim.sub','e5555555-5555-4555-8555-555555555555',true);
create temp table st(k text primary key,v jsonb);
grant select,insert on st to authenticated;
insert into st values('word',english_api.save_context('{"rawText":"Coincidence","selectedSpans":[]}',null,'word-source'));
insert into st values('word-job',english_api.create_ai_job('context_extract',null,(select(v->>'contextId')::uuid from st where k='word'),'word-job'));
insert into st values('word-prompt',english_api.get_ai_job_prompt((select(v->>'jobId')::uuid from st where k='word-job')));
select pg_temp.assert_true((select v->>'prompt' like '%candidateType=word%' and v->>'prompt' like '%不得仅因%' and v->>'prompt' like '%缺少上下文，义项待确认%' and v->>'prompt' not like '%不把单个孤立生词强当词块%' from st where k='word-prompt'),'explicit words and uncertain senses have unambiguous instructions');
select pg_temp.assert_true((select v->'outputContract'->>'ruleVersion'='english_v2' and v->'outputContract'->'items'->0->>'contextId'=v->>'subjectId' from st where k='word-prompt'),'complete compatible context envelope');
select pg_temp.assert_true((select p.v->'snapshot'=j.input_snapshot and p.v->>'snapshotHash'=j.snapshot_hash from st p join english_private.ai_jobs j on j.id=(p.v->>'jobId')::uuid where p.k='word-prompt'),'frozen source and hash unchanged');

-- Reproduce the old empty result, then repair the same source through the API.
insert into st select 'empty-payload',(v->'outputContract')||'{"modelId":"test","items":[]}'::jsonb from st where k='word-prompt';
select english_api.import_ai_result((select(v->>'jobId')::uuid from st where k='word-job'),(select v from st where k='empty-payload'));
set local role authenticated;
insert into st values('retry',english_api.retry_empty_context((select(v->>'contextId')::uuid from st where k='word'),'word-retry'));
select pg_temp.assert_true((select english_api.retry_empty_context((select(v->>'contextId')::uuid from st where k='word'),'word-retry')=v from st where k='retry'),'retry key returns same prepared job');
reset role;
select pg_temp.assert_true((select count(*)=1 from english_private.contexts),'retry does not duplicate source');
select pg_temp.assert_true((select status='consumed' and output_payload->'items'='[]'::jsonb from english_private.ai_jobs where id=(select(v->>'jobId')::uuid from st where k='word-job')),'old empty receipt preserved');
insert into st select 'retry-prompt',english_api.get_ai_job_prompt((v->>'jobId')::uuid) from st where k='retry';
insert into st select 'word-payload',(v->'outputContract')||jsonb_build_object('modelId','test','items',jsonb_build_array(
 (v->'outputContract'->'items'->0)||jsonb_build_object('candidate','coincidence','selectedText','Coincidence',
 'cueZh','巧合；偶然一致','contextMeaning','缺少上下文，义项待确认；暂按巧合理解',
 'whyUseful','主动收藏的词；缺少上下文，义项待确认','naturalExample','It was a coincidence that we chose the same day.',
 'commonMistake','名词；例句是新写的示例。','confidence',0.7))) from st where k='retry-prompt';
select pg_temp.expect_error(format('select english_api.import_ai_result(%L,%L::jsonb)',
 (select v->>'jobId' from st where k='retry'),
 (select jsonb_set(v,'{items,0,selectedText}','"invented quotation"'::jsonb)::text from st where k='word-payload')),'CONTEXT_ECHO_MISMATCH');
select english_api.import_ai_result((select(v->>'jobId')::uuid from st where k='retry'),(select v from st where k='word-payload'));
select english_api.import_ai_result((select(v->>'jobId')::uuid from st where k='retry'),(select v from st where k='word-payload'));
select pg_temp.assert_true((select count(*)=1 from english_private.context_candidates where candidate='coincidence' and candidate_type='word' and decision_status='pending'),'word import stays pending and is idempotent');
select pg_temp.assert_true(not exists(select 1 from english_private.candidates) and not exists(select 1 from english_private.phrases) and not exists(select 1 from english_private.review_events),'repair never auto accepts or advances learning');
select pg_temp.assert_true((select english_api.retry_empty_context((select(v->>'contextId')::uuid from st where k='word'),'word-retry')->>'status'='consumed'),'retry after import preserves consumed status');
select pg_temp.expect_error(format('select english_api.retry_empty_context(%L,%L)',(select v->>'contextId' from st where k='word'),'new-retry'),'CONTEXT_NOT_EMPTY_COMPLETED');
select english_api.confirm_candidates((select jsonb_build_array(jsonb_build_object('id',id,'source','context','action','accept')) from english_private.context_candidates where candidate='coincidence'),'confirm-word');
select pg_temp.assert_true(exists(select 1 from english_private.candidates where candidate='coincidence' and candidate_type='word' and status='ready'),'learner may confirm a word through the existing candidate flow');

-- Marked words retain their exact source and surrounding sentence.
insert into st values('marked',english_api.save_context('{"rawText":"These songs are bangers.","selectedSpans":[{"text":"bangers","start":16,"end":23}]}',null,'marked-word'));
insert into st values('marked-job',english_api.create_ai_job('context_extract',null,(select(v->>'contextId')::uuid from st where k='marked'),'marked-job'));
select pg_temp.assert_true((english_api.get_ai_job_prompt((select(v->>'jobId')::uuid from st where k='marked-job'))->'snapshot'->'selectedSpans'->0->>'text')='bangers','marked word remains frozen with its context');

-- Unmarked articles can still produce zero; generated recommendations stay phrase-first.
insert into st values('article',english_api.save_context('{"rawText":"Nothing useful to extract from this test passage.","selectedSpans":[]}',null,'article'));
insert into st values('article-job',english_api.create_ai_job('context_extract',null,(select(v->>'contextId')::uuid from st where k='article'),'article-job'));
insert into st select 'article-payload',(english_api.get_ai_job_prompt((v->>'jobId')::uuid)->'outputContract')||'{"modelId":"test","items":[]}'::jsonb from st where k='article-job';
select english_api.import_ai_result((select(v->>'jobId')::uuid from st where k='article-job'),(select v from st where k='article-payload'));
select pg_temp.assert_true((select status='completed' from english_private.contexts where id=(select(v->>'contextId')::uuid from st where k='article')),'unmarked article keeps zero-item behavior');
insert into st values('generated',english_api.create_ai_job('candidate_generate',2,null,'generated'));
select pg_temp.assert_true((english_api.get_ai_job_prompt((select(v->>'jobId')::uuid from st where k='generated'))->>'prompt') like '%不把单个孤立生词强当词块%','automatic recommendation policy unchanged');
select pg_temp.expect_error(format('select english_api.retry_empty_context(%L,%L)',(select v->>'contextId' from st where k='article'),'word-retry'),'IDEMPOTENCY_CONFLICT');
select pg_temp.expect_error('select english_api.retry_empty_context(gen_random_uuid(),''unknown-context'')','CONTEXT_NOT_FOUND');
select pg_temp.expect_error('select english_api.retry_empty_context(gen_random_uuid(),null)','IDEMPOTENCY_KEY_REQUIRED');
select pg_temp.assert_true(not has_function_privilege('anon','english_api.retry_empty_context(uuid,text)','EXECUTE') and not has_function_privilege('anon','english_private.retry_empty_context(uuid,text)','EXECUTE'),'anonymous cannot retry');
-- Word type survives confirmation and controls the next review after a failure.
insert into english_private.phrases(owner_id,chunk,cue_zh,phrase_type,contract_version)
select owner_id,candidate,cue_zh,candidate_type,'english_v3' from english_private.candidates where candidate='coincidence';
insert into english_private.phrases(owner_id,chunk,cue_zh,phrase_type,contract_version)
values('e5555555-5555-4555-8555-555555555555','by coincidence','碰巧','collocation','english_v3');
insert into english_private.daily_queues(owner_id,legacy_queue_id,queue_date,planned_count,contract_version)
values('e5555555-5555-4555-8555-555555555555','word-review',english_private.learning_date(),2,'english_v3');
insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,chunk,cue_zh,contract_version)
select p.owner_id,q.id,row_number() over(order by p.chunk),'due',p.id,p.chunk,p.cue_zh,'english_v3'
from english_private.phrases p cross join english_private.daily_queues q where q.legacy_queue_id='word-review';
insert into english_private.review_events(owner_id,phrase_id,result,question_type,rule_version,learning_date,target_outcome,hint_used,affects_srs)
select owner_id,id,'forgotten','whole_recall','english_v3',english_private.learning_date()-1,'forgotten',false,false from english_private.phrases;
insert into st select 'word-review-snapshot',english_private.question_snapshot_v3('e5555555-5555-4555-8555-555555555555',id) from english_private.daily_queues where legacy_queue_id='word-review';
select pg_temp.assert_true((select x->>'questionType'='whole_recall' and x->>'targetType'='word' from st,jsonb_array_elements(v)x where k='word-review-snapshot' and x->>'chunk'='coincidence'),'failed word uses full-word retrieval rather than a chunk-component gap');
select pg_temp.assert_true((select x->>'questionType'='collocation_gap' from st,jsonb_array_elements(v)x where k='word-review-snapshot' and x->>'chunk'='by coincidence'),'failed collocation retains its gap support');
insert into st select 'word-lesson-job',english_api.create_ai_job('question_prepare',null,id,'word-lesson') from english_private.daily_queues where legacy_queue_id='word-review';
select pg_temp.assert_true((english_api.get_ai_job_prompt((select(v->>'jobId')::uuid from st where k='word-lesson-job'))->>'prompt') like '%不挖空单词内部的字母或词根%','word lesson explicitly supports single-word answers');
select set_config('request.jwt.claim.sub','f6666666-6666-4666-8666-666666666666',true);
select pg_temp.expect_error(format('select english_api.retry_empty_context(%L,%L)',(select v->>'contextId' from st where k='article'),'wrong-owner'),'OWNER_REQUIRED');
select 'english_explicit_words: PASS' result;
rollback;
