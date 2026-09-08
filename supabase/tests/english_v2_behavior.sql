\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;else raise exception 'Expected %, got % for %',expected,sqlerrm,statement;end if;end;
 raise exception 'Expected error % but succeeded: %',expected,statement;
end $$;

insert into auth.users(id,email,aud,role) values('a1111111-1111-4111-8111-111111111111','english-test@example.invalid','authenticated','authenticated'),('b2222222-2222-4222-8222-222222222222','stranger@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('a1111111-1111-4111-8111-111111111111');
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.assert_true(english_private.learning_date('2026-09-07 15:59:59+00')='2026-09-07','Shanghai before midnight');
select pg_temp.assert_true(english_private.learning_date('2026-09-07 16:00:00+00')='2026-09-08','Shanghai after midnight');
select pg_temp.assert_true(not exists(select 1 from cron.job where jobname='english-daily-queue' and active),'cron gated until cutover');
select pg_temp.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='english_api' and p.prosecdef),'no exposed definer');
set local role authenticated;
select pg_temp.assert_true((english_api.get_review_bootstrap()->'settings'->>'defaultQuestionCount')::integer=12,'default twelve');
select pg_temp.expect_error('select * from english_private.phrases','permission denied');
select pg_temp.expect_error($q$select english_private.commit_submission('a1111111-1111-4111-8111-111111111111',gen_random_uuid())$q$,'permission denied');
select set_config('request.jwt.claim.sub','b2222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_error('select english_api.get_review_bootstrap()','OWNER_REQUIRED');
select pg_temp.expect_error('select english_api.get_dashboard()','OWNER_REQUIRED');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error('select english_api.get_dashboard()','UNAUTHENTICATED');
reset role;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);

insert into english_private.phrases(owner_id,legacy_phrase_id,chunk,cue_zh,review_stage,next_review_at,natural_example,contract_version)
values
('a1111111-1111-4111-8111-111111111111','due-1','make a decision','作决定',3,now()-interval '4 days','We need to make a decision.','legacy'),
('a1111111-1111-4111-8111-111111111111','due-2','take responsibility','承担责任',2,now()-interval '3 days','I take responsibility.','legacy'),
('a1111111-1111-4111-8111-111111111111','due-3','raise a concern','提出顾虑',5,now()-interval '2 days','I want to raise a concern.','legacy'),
('a1111111-1111-4111-8111-111111111111','due-4','draw a conclusion','得出结论',3,now()-interval '1 day','We can draw a conclusion.','legacy'),
('a1111111-1111-4111-8111-111111111111','future','meet the deadline','赶上截止时间',3,now()+interval '10 days','We can meet the deadline.','legacy');
insert into english_private.candidates(owner_id,candidate,cue_zh,natural_example,origin_type,status) values
('a1111111-1111-4111-8111-111111111111','push back the deadline','推迟截止日期','Could we push back the deadline?','context','ready'),
('a1111111-1111-4111-8111-111111111111','keep in touch','保持联系','Let us keep in touch.','generated','ready'),
('a1111111-1111-4111-8111-111111111111','bring it up','提出来','I will bring it up.','generated','ready');

create temp table test_state(k text primary key,v jsonb);
insert into test_state values('bootstrap',english_api.get_review_bootstrap());
select pg_temp.assert_true((select v->>'state'='questions_required' and (v->>'actualCount')::integer=6 from test_state where k='bootstrap'),'four due plus max two new and no future filler');
select pg_temp.assert_true((select count(*)=2 from english_private.daily_queue_items where selection_type='new'),'two new cap');
select pg_temp.assert_true((select chunk='make a decision' from english_private.daily_queue_items where position=1),'due chronological priority');
select pg_temp.expect_error($q$select english_api.set_question_count(0,'today',0,'bad-zero')$q$,'QUESTION_COUNT_OUT_OF_RANGE');
select pg_temp.expect_error($q$select english_api.set_question_count(151,'today',0,'bad-high')$q$,'QUESTION_COUNT_OUT_OF_RANGE');
select pg_temp.expect_error($q$select english_api.set_question_count(1,'today',null,'bad-revision')$q$,'REVISION_CONFLICT');
select pg_temp.assert_true((english_api.set_question_count(1,'today',0,'one')->>'actualCount')::integer=1,'reduce unstarted queue');
select pg_temp.assert_true((english_api.set_question_count(1,'today',0,'one')->>'actualCount')::integer=1,'count request idempotent');
select pg_temp.expect_error($q$select english_api.set_question_count(2,'today',0,'one')$q$,'IDEMPOTENCY_CONFLICT');
select pg_temp.assert_true((english_api.set_question_count(150,'default',1,'future-count')->>'defaultCount')::integer=150,'default upper boundary');
select pg_temp.assert_true((english_api.get_review_bootstrap()->>'actualCount')::integer=1,'future default leaves today intact');
select pg_temp.assert_true((english_api.set_question_count(12,'both',2,'restore')->>'actualCount')::integer=6,'both grows due and new without filler');
select pg_temp.assert_true((english_api.get_review_bootstrap()->'settings'->>'defaultQuestionCount')::integer=12,'both restores default');
insert into test_state values('job',english_api.create_ai_job('question_prepare',null,null,'prepare'));
select pg_temp.assert_true(english_api.create_ai_job('question_prepare',null,null,'prepare')=(select v from test_state where k='job'),'job idempotent');
select pg_temp.assert_true((english_api.get_pending_ai_jobs()->'items'->0->>'jobId')=(select v->>'jobId' from test_state where k='job'),'pending job recoverable');
select pg_temp.assert_true(length(english_api.get_ai_job_prompt((select(v->>'jobId')::uuid from test_state where k='job'))->>'prompt')>1000,'complete prompt embeds frozen material');
select pg_temp.expect_error(format('select english_api.import_ai_result(%L,%L::jsonb)',(select v->>'jobId' from test_state where k='job'),'{}'),'AI_SNAPSHOT_MISMATCH');
insert into test_state select 'question_payload',jsonb_build_object('jobId',j.id,'batchId',j.batch_id,'snapshotHash',j.snapshot_hash,'ruleVersion','english_v2','modelId','test-model',
 'items',(select jsonb_agg(jsonb_build_object('queueItemId',x->>'queueItemId','position',(x->>'position')::integer,'questionType',x->>'questionType','trainingGoal','回忆完整词块','promptZh','情境'||(x->>'position')||'：根据意图写出表达','promptEn','A familiar context '||(x->>'position'),
 'expectedAnswers',jsonb_build_array(x->>'chunk'),'acceptedVariants','[]'::jsonb,'semanticBoundary','表达此义项，合理别答单独判断','gradingRubric','目标提取与沟通分开','hints',jsonb_build_array('一个短语线索'),
 'learningCard',case when (x->>'isNew')::boolean then jsonb_build_object('meaningZh',x->>'cueZh','example',x->>'example','usageNote','用于熟悉日常情境') else 'null'::jsonb end) order by (x->>'position')::integer) from jsonb_array_elements(j.input_snapshot->'items')x))
 from english_private.ai_jobs j where id=(select(v->>'jobId')::uuid from test_state where k='job');
select pg_temp.expect_error(format('select english_api.import_ai_result(%L,%L::jsonb)',(select v->>'jobId' from test_state where k='job'),(select jsonb_set(v,'{items,0,queueItemId}',to_jsonb(gen_random_uuid()::text))::text from test_state where k='question_payload')),'QUESTION_SNAPSHOT_ECHO_MISMATCH');
select pg_temp.assert_true(not exists(select 1 from english_private.questions),'bad imports atomic');
select english_api.import_ai_result((select(v->>'jobId')::uuid from test_state where k='job'),(select v from test_state where k='question_payload'));
select pg_temp.assert_true((english_api.import_ai_result((select(v->>'jobId')::uuid from test_state where k='job'),(select v from test_state where k='question_payload'))->>'idempotent')::boolean,'question reimport idempotent');
update test_state set v=english_api.get_review_bootstrap() where k='bootstrap';
select pg_temp.assert_true((select v->>'state'='open' and jsonb_array_length(v->'questions')=6 from test_state where k='bootstrap'),'full session binds');
select english_api.record_question_activity((select(v->'session'->>'id')::uuid from test_state where k='bootstrap'),2,'hint','hint-2');
select english_api.record_question_activity((select(v->'session'->>'id')::uuid from test_state where k='bootstrap'),5,'study','study-5');
select english_api.record_question_activity((select(v->'session'->>'id')::uuid from test_state where k='bootstrap'),5,'reveal','reveal-5');
select pg_temp.expect_error($q$select english_api.set_question_count(4,'today',3,'unsafe-shrink')$q$,'QUESTION_COUNT_BELOW_LOCKED_MINIMUM');
select pg_temp.assert_true((english_api.get_review_bootstrap()->'questions'->1->>'hintCount')::integer=1,'hints survive refresh');
insert into test_state select 'answers',jsonb_agg(jsonb_build_object('position',position,'answer',expected_answers->>0,'revision',1,'revealHash',content_hash,'clientInstanceId','sql-test','pageStartedAt',now(),
 'hintUsed',position=2,'hintCount',case when position=2 then 1 else 0 end,'learningCardViewed',coalesce((metadata->>'isNew')::boolean,false),'practiceStartedAt',now()-interval '15 seconds') order by position)
 from english_private.questions;
insert into test_state select 'first_five',(select jsonb_agg(x order by (x->>'position')::integer) from jsonb_array_elements(v)x where (x->>'position')::integer<=5) from test_state where k='answers';
insert into test_state select 'tail',(select jsonb_agg(x) from jsonb_array_elements(v)x where (x->>'position')::integer>5) from test_state where k='answers';
select pg_temp.expect_error(format('select english_api.checkpoint_answers(%L,%L::jsonb,1,%L,%L)',(select v->'session'->>'id' from test_state where k='bootstrap'),(select v::text from test_state where k='first_five'),'bad-hash','wrong'),'FROZEN_HASH_MISMATCH');
select english_api.checkpoint_answers((select(v->'session'->>'id')::uuid from test_state where k='bootstrap'),(select v from test_state where k='first_five'),1,'checkpoint',english_private.sha256_json((select v from test_state where k='first_five')));
select pg_temp.assert_true((english_api.checkpoint_answers((select(v->'session'->>'id')::uuid from test_state where k='bootstrap'),(select v from test_state where k='first_five'),1,'checkpoint',english_private.sha256_json((select v from test_state where k='first_five')))->>'revision')::integer=2,'checkpoint retry does not increment revision');
select pg_temp.expect_error(format('select english_api.checkpoint_answers(%L,%L::jsonb,1,%L,%L)',gen_random_uuid(),(select v::text from test_state where k='first_five'),'checkpoint',english_private.sha256_json((select v from test_state where k='first_five'))),'IDEMPOTENCY_CONFLICT');
insert into test_state select 'frozen',to_jsonb(english_private.sha256_json(jsonb_agg(jsonb_build_object('position',q.position,'questionId',q.id,'answer',x->>'answer','revision',1,'answerHash',english_private.sha256_json(jsonb_build_object('questionId',q.id,'answer',x->>'answer','revision',1))) order by q.position)))
from english_private.questions q join jsonb_array_elements((select v from test_state where k='answers'))x on (x->>'position')::integer=q.position;
insert into test_state values('submission',english_api.submit_session((select(v->'session'->>'id')::uuid from test_state where k='bootstrap'),(select v from test_state where k='tail'),2,'submit',(select v#>>'{}' from test_state where k='frozen')));
select pg_temp.assert_true((english_api.submit_session((select(v->'session'->>'id')::uuid from test_state where k='bootstrap'),(select v from test_state where k='tail'),2,'submit',(select v#>>'{}' from test_state where k='frozen'))->>'idempotent')::boolean,'submit retry succeeds despite changed session revision');
select pg_temp.expect_error($q$select english_api.set_question_count(12,'today',3,'frozen-count')$q$,'SESSION_FROZEN');
select pg_temp.assert_true((english_api.set_question_count(9,'default',3,'allowed-future')->>'defaultCount')::integer=9,'submitted can edit future default');
insert into test_state values('grade_job',english_api.create_ai_job('grade_submission',null,(select(v->>'submissionId')::uuid from test_state where k='submission'),'grade'));
insert into test_state select 'grade_payload',jsonb_build_object('jobId',j.id,'batchId',j.batch_id,'snapshotHash',j.snapshot_hash,'ruleVersion','english_v2','modelId','test-model','items',
 (select jsonb_agg(jsonb_build_object('requestId',x->>'requestId','position',(x->>'position')::integer,'observedAnswer',x->>'observedAnswer','answerHash',x->>'answerHash','result','normal','targetOutcome',case when (x->>'position')::integer=3 then 'forgotten' else 'correct' end,
 'meaningOk',true,'naturalness','natural','hintUsed',x->'hintUsed','confidence',0.9,'feedbackZh','表达清楚，示例见参考答案','evidence','依据实际作答','expectedAnswer',x->>'chunk','extraPractice','[]'::jsonb) order by (x->>'position')::integer) from jsonb_array_elements(j.input_snapshot->'items')x)) from english_private.ai_jobs j where id=(select(v->>'jobId')::uuid from test_state where k='grade_job');
select pg_temp.expect_error(format('select english_api.import_ai_result(%L,%L::jsonb)',(select v->>'jobId' from test_state where k='grade_job'),(select jsonb_set(v,'{items,0,observedAnswer}','"tampered"')::text from test_state where k='grade_payload')),'GRADE_REQUEST_ECHO_MISMATCH');
select english_api.import_ai_result((select(v->>'jobId')::uuid from test_state where k='grade_job'),(select v from test_state where k='grade_payload'));
select pg_temp.assert_true(not exists(select 1 from english_private.review_events),'AI cannot advance before human confirmation');
insert into test_state select 'decisions',jsonb_agg(jsonb_build_object('position',position,'decision','accept') order by position) from english_private.grade_results;
select english_api.confirm_grades((select(v->>'submissionId')::uuid from test_state where k='submission'),(select v from test_state where k='decisions'),2,'confirm',english_private.sha256_json((select v from test_state where k='decisions')));
select pg_temp.assert_true((select review_stage=4 and english_private.learning_date(next_review_at)=english_private.learning_date()+14 from english_private.phrases where legacy_phrase_id='due-1'),'independent correct advances stage and interval');
select pg_temp.assert_true((select review_stage=2 and english_private.learning_date(next_review_at)=english_private.learning_date()+3 from english_private.phrases where legacy_phrase_id='due-2'),'hinted correct holds stage <=3 days');
select pg_temp.assert_true((select review_stage=0 and english_private.learning_date(next_review_at)=english_private.learning_date()+1 from english_private.phrases where legacy_phrase_id='due-3'),'forgotten resets first stage');
select pg_temp.assert_true((select count(*)=2 from english_private.review_events where initial_learning),'initial learning evidence labelled');
select pg_temp.assert_true((select count(*)=6 from english_private.review_events),'exactly one event per grade');
select english_api.confirm_grades((select(v->>'submissionId')::uuid from test_state where k='submission'),(select v from test_state where k='decisions'),2,'confirm',english_private.sha256_json((select v from test_state where k='decisions')));
select pg_temp.assert_true((select count(*)=6 from english_private.review_events),'confirm retry no double SRS');
select pg_temp.expect_error(format('select english_api.confirm_grades(%L,%L::jsonb,2,%L,%L)',gen_random_uuid(),(select v::text from test_state where k='decisions'),'confirm',english_private.sha256_json((select v from test_state where k='decisions'))),'IDEMPOTENCY_CONFLICT');
select pg_temp.assert_true(jsonb_array_length(english_api.get_dashboard()->'analytics'->'days')=14,'fourteen observed days');
select pg_temp.assert_true((english_api.get_dashboard()->'analytics'->'days'->0->'backlog')='null'::jsonb,'unknown backlog is null, not invented');
select pg_temp.assert_true((english_api.get_review_bootstrap()->>'state')='committed','same day does not start duplicate session');

-- Independent source pipeline: an AI output remains staged until explicit confirmation.
insert into test_state values('context',english_api.save_context('{"rawText":"We should follow up tomorrow.","selectedSpans":[]}',null,'capture'));
insert into test_state values('context_job',english_api.create_ai_job('context_extract',2,(select(v->>'contextId')::uuid from test_state where k='context'),'extract'));
insert into test_state select 'context_payload',jsonb_build_object('jobId',j.id,'batchId',j.batch_id,'snapshotHash',j.snapshot_hash,'ruleVersion','english_v2','modelId','test','items',jsonb_build_array(jsonb_build_object('contextId',j.subject_id,'position',1,'candidate','follow up','cueZh','跟进','whyUseful','项目沟通','naturalExample','I will follow up tomorrow.','confidence',0.9,'selectedText','follow up'))) from english_private.ai_jobs j where id=(select(v->>'jobId')::uuid from test_state where k='context_job');
select english_api.import_ai_result((select(v->>'jobId')::uuid from test_state where k='context_job'),(select v from test_state where k='context_payload'));
select pg_temp.assert_true(not exists(select 1 from english_private.candidates where candidate='follow up'),'AI extraction not auto accepted');
select english_api.confirm_candidates((select jsonb_build_array(jsonb_build_object('id',id,'source','context','action','accept')) from english_private.context_candidates where candidate='follow up'),'accept-context');
select pg_temp.assert_true(exists(select 1 from english_private.candidates where candidate='follow up' and status='ready'),'confirmed candidate available');
insert into test_state values('candidate_job',english_api.create_ai_job('candidate_generate',2,null,'generate'));
insert into test_state select 'candidate_payload',jsonb_build_object('jobId',j.id,'batchId',j.batch_id,'snapshotHash',j.snapshot_hash,'ruleVersion','english_v2','modelId','test','items',jsonb_build_array(jsonb_build_object('position',1,'candidate','give it a try','cueZh','试一试','whyUseful','日常建议','naturalExample','Give it a try.','confidence',0.9))) from english_private.ai_jobs j where id=(select(v->>'jobId')::uuid from test_state where k='candidate_job');
select english_api.import_ai_result((select(v->>'jobId')::uuid from test_state where k='candidate_job'),(select v from test_state where k='candidate_payload'));
select pg_temp.assert_true(not exists(select 1 from english_private.candidates where candidate='give it a try'),'generated output stays staged');
select english_api.confirm_candidates((select jsonb_build_array(jsonb_build_object('id',id,'source','generated','action','edit','editedCandidate','give something a try')) from english_private.candidate_generation_rows where candidate='give it a try'),'accept-generated');
select pg_temp.assert_true(exists(select 1 from english_private.candidates where candidate='give something a try'),'edited generated candidate accepted');

select 'english_v2_behavior: PASS' result;
rollback;
