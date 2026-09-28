\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$ begin begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;else raise exception 'Expected %, got %',expected,sqlerrm;end if;end;raise exception 'Expected error %',expected;end $$;
insert into auth.users(id,email,aud,role) values('d4444444-4444-4444-8444-444444444444','lesson@example.invalid','authenticated','authenticated'),('e5555555-5555-4555-8555-555555555555','stranger@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('d4444444-4444-4444-8444-444444444444');
select set_config('request.jwt.claim.sub','d4444444-4444-4444-8444-444444444444',true);
insert into english_private.phrases(id,owner_id,legacy_phrase_id,chunk,cue_zh,status,review_stage,next_review_at,topic,natural_example)
select ('f0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'d4444444-4444-4444-8444-444444444444','v3-'||i,case i when 1 then 'grab a coffee' when 2 then 'cut back on' when 3 then 'run as scheduled' else 'test expression '||i end,'表达意思 '||i,case when i<=2 then 'mastered' when i=9 then 'suspended' else 'active' end,3,now()-interval '1 day',case when i<=2 then 'daily life' else 'work' end,'A natural example.' from generate_series(1,9)i;
-- Persisted difficulty leads to a supported gap, not a full-recall success.
insert into english_private.review_events(owner_id,phrase_id,prompt,user_answer,result,question_type,affects_srs,rule_version,learning_date,target_outcome,hint_used,metadata)
select owner_id,id,'previous prompt','wrong','forgotten','whole_recall',false,'english_v3',english_private.learning_date()-1,'forgotten',false,'{"phase":"review"}' from english_private.phrases where legacy_phrase_id='v3-3';
create temp table st(k text primary key,v jsonb);
insert into st values('boot',english_api.get_review_bootstrap());
select pg_temp.assert_true((select v->>'ruleVersion'='english_v3' and v->'settings'->>'defaultQuestionCount'='8' and v->>'actualCount'='8' from st where k='boot'),'default 8, mastered included, suspended excluded');
select pg_temp.assert_true((select count(*)=2 from english_private.daily_queue_items i join english_private.phrases p on p.id=i.phrase_id where p.status='mastered'),'mastered due included');
insert into st values('job',english_api.create_ai_job('question_prepare',null,(select(v->>'queueId')::uuid from st where k='boot'),'prepare-v3'));
select pg_temp.assert_true((select v->>'expectedCount'='10' from st where k='job'),'8 review plus exactly 2 expression');
select pg_temp.assert_true((select count(*)=2 from english_private.ai_jobs j,jsonb_array_elements(j.input_snapshot->'items')x where x->>'questionType'='post_reading_expression'),'expression without success gate');
select pg_temp.assert_true((english_api.get_ai_job_prompt((select(v->>'jobId')::uuid from st where k='job'))->>'prompt') like '%120–180%','complete frozen material contract');
insert into st select 'payload',jsonb_build_object('jobId',j.id,'batchId',j.batch_id,'snapshotHash',j.snapshot_hash,'ruleVersion','english_v3','modelId','contract-test',
 'material',jsonb_build_object('title','A short conversation','kind','dialogue','body',trim(repeat('We are discussing a simple plan for this afternoon. ',15)),'explanationZh','讨论下午的计划','targetPhraseIds',j.input_snapshot->'targetPhraseIds','notes',(select jsonb_agg(jsonb_build_object('phraseId',x,'explanationZh','适合日常交流')) from jsonb_array_elements_text(j.input_snapshot->'targetPhraseIds')x)),
 'items',(select jsonb_agg(jsonb_build_object('queueItemId',x->>'queueItemId','position',x->'position','questionType',x->>'questionType','phase',x->>'phase','answerForm',x->>'answerForm','trainingGoal','明确表达意图','promptZh','任务 '||(x->>'position')||'：'||case x->>'answerForm' when 'response' then '给朋友写一两句回复' when 'gap' then '只填指定空格' else '写完整词块' end,'promptEn','', 'expectedAnswers',jsonb_build_array(case when x->>'questionType'='collocation_gap' then 'as' else x->>'chunk' end),'acceptedVariants','[]'::jsonb,'semanticBoundary','PRIVATE target as / figured must never be public','gradingRubric','按要求的答案形式评分','hints','["一个语义线索"]'::jsonb,'learningCard',null) order by (x->>'position')::integer) from jsonb_array_elements(j.input_snapshot->'items')x)) from english_private.ai_jobs j where id=(select(v->>'jobId')::uuid from st where k='job');
select pg_temp.expect_error(format('select english_api.import_ai_result(%L,%L::jsonb)',(select v->>'jobId' from st where k='job'),(select jsonb_set(v,'{items,0,phase}','"expression"')::text from st where k='payload')),'QUESTION_PHASE_MISMATCH');
select pg_temp.expect_error(format('select english_api.import_ai_result(%L,%L::jsonb)',(select v->>'jobId' from st where k='job'),(select jsonb_set(v,'{items,2,promptEn}','"The train runs as _____."')::text from st where k='payload')),'QUESTION_LEAKS_TARGET');
select english_api.import_ai_result((select(v->>'jobId')::uuid from st where k='job'),(select v from st where k='payload'));
select pg_temp.assert_true((english_api.import_ai_result((select(v->>'jobId')::uuid from st where k='job'),(select v from st where k='payload'))->>'idempotent')::boolean,'lesson import idempotent');
update st set v=english_api.get_review_bootstrap() where k='boot';
insert into st select 'answers',jsonb_agg(jsonb_build_object('position',q.position,'answer','','attemptState','skipped','revision',1,'revealHash','skip','hintUsed',false,'hintCount',0,'learningCardViewed',false,'activeSeconds',0,'clientInstanceId','sql','pageStartedAt',now(),'practiceEndedAt',now()) order by q.position) from english_private.questions q;
select english_api.checkpoint_answers((select(v->'session'->>'id')::uuid from st where k='boot'),(select v from st where k='answers'),1,'all-skipped',english_private.sha256_json((select v from st where k='answers')));
insert into st select 'frozen',to_jsonb(english_private.sha256_json(jsonb_agg(jsonb_build_object('position',position,'questionId',question_id,'answer',answer,'revision',revision,'answerHash',answer_hash) order by position))) from english_private.answer_drafts;
insert into st values('submission',english_api.submit_session((select(v->'session'->>'id')::uuid from st where k='boot'),'[]',2,'submit-all-skip',(select v#>>'{}' from st where k='frozen')));
select pg_temp.assert_true((select v->>'status'='committed' and v->>'gradeRequestCount'='0' from st where k='submission'),'all skipped ends without grading');
select pg_temp.assert_true(not exists(select 1 from english_private.review_events where grade_result_id is not null),'skip makes no learning evidence');
select pg_temp.assert_true((english_api.get_dashboard()->'v3'->>'completedLessons')='0','all skipped does not count toward ten complete lessons');
rollback;
