\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
insert into auth.users(id,email,aud,role) values('c3333333-3333-4333-8333-333333333333','schedule-test@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('c3333333-3333-4333-8333-333333333333');
select set_config('request.jwt.claim.sub','c3333333-3333-4333-8333-333333333333',true);

-- Deliberately construct frozen sessions on specified practice dates to test delayed grading and same-day retry invariants.
create function pg_temp.review_once(p_phrase uuid,p_day date,p_outcome text,p_hint boolean default false,p_initial boolean default false) returns uuid language plpgsql as $$
declare o uuid:='c3333333-3333-4333-8333-333333333333';q uuid;s uuid;x uuid;su uuid;r uuid;g uuid;at_time timestamptz:=(p_day::timestamp at time zone 'Asia/Shanghai')+interval '12 hours';
begin
 insert into english_private.daily_queues(owner_id,legacy_queue_id,queue_date,planned_count,contract_version) values(o,gen_random_uuid()::text,p_day,1,'test_fixture') returning id into q;
 insert into english_private.sessions(owner_id,queue_id,learning_date,max_questions,status,contract_version) values(o,q,p_day,1,'needs_confirmation','english_v2') returning id into s;
 insert into english_private.questions(owner_id,queue_id,session_id,position,phrase_id,question_type,prompt_zh,expected_answers,content_hash,contract_version,metadata)
 values(o,q,s,1,p_phrase,'whole_recall','不同场景 '||p_day||' '||s,jsonb_build_array('sample'),'sample','english_v2',jsonb_build_object('isNew',p_initial)) returning id into x;
 insert into english_private.answer_drafts(owner_id,session_id,question_id,position,answer,revision,reveal_hash,answer_hash,idempotency_key,created_at,updated_at,metadata)
 values(o,s,x,1,'sample',1,'sample','sample',gen_random_uuid()::text,at_time,at_time,jsonb_build_object('hintUsed',p_hint,'practiceStartedAt',at_time-interval '20 seconds','practiceEndedAt',at_time));
 insert into english_private.submissions(owner_id,session_id,queue_id,frozen_hash,idempotency_key,status) values(o,s,q,'sample',gen_random_uuid()::text,'needs_confirmation') returning id into su;
 insert into english_private.grade_requests(owner_id,submission_id,question_id,position,phrase_id,observed_answer,expected_answers,answer_hash) values(o,su,x,1,p_phrase,'sample',jsonb_build_array('sample'),'sample') returning id into r;
 insert into english_private.grade_results(owner_id,submission_id,grade_request_id,position,result,confidence,observed_answer,target_outcome,hint_used,meaning_ok,naturalness,status)
 values(o,su,r,1,'normal',0.9,'sample',p_outcome,p_hint,true,'natural','accepted') returning id into g;
 insert into english_private.commit_journal(owner_id,submission_id,answer_hash) values(o,su,'sample');
 perform english_private.commit_submission(o,su);
 return su;
end $$;

insert into english_private.phrases(owner_id,legacy_phrase_id,chunk,cue_zh,review_stage,next_review_at) values
('c3333333-3333-4333-8333-333333333333','test-target','make room for','为…腾出空间',3,now()-interval '1 day');
select pg_temp.review_once((select id from english_private.phrases where legacy_phrase_id='test-target'),english_private.learning_date()-3,'correct');
select pg_temp.assert_true((select review_stage=4 from english_private.phrases where legacy_phrase_id='test-target'),'first independent success');
select pg_temp.review_once((select id from english_private.phrases where legacy_phrase_id='test-target'),english_private.learning_date()-3,'forgotten');
select pg_temp.assert_true((select review_stage=4 from english_private.phrases where legacy_phrase_id='test-target'),'same-day retry cannot advance or demote SRS twice');
select pg_temp.assert_true((select count(*)=1 from english_private.review_events where not affects_srs),'same-day retry retained as practice');
select pg_temp.review_once((select id from english_private.phrases where legacy_phrase_id='test-target'),english_private.learning_date()-2,'correct');
insert into english_private.daily_queues(owner_id,legacy_queue_id,queue_date,planned_count) values('c3333333-3333-4333-8333-333333333333','test-snapshot',english_private.learning_date(),12);
insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,chunk,cue_zh)
select p.owner_id,q.id,1,'due',p.id,p.chunk,p.cue_zh from english_private.phrases p cross join english_private.daily_queues q where p.legacy_phrase_id='test-target' and q.legacy_queue_id='test-snapshot';
select pg_temp.assert_true((english_private.question_snapshot('c3333333-3333-4333-8333-333333333333',(select id from english_private.daily_queues where legacy_queue_id='test-snapshot'))->0->>'questionType')='transfer_expression','different dates and prompts allow gradual transfer');
select pg_temp.review_once((select id from english_private.phrases where legacy_phrase_id='test-target'),english_private.learning_date()-1,'partial');
select pg_temp.assert_true((select review_stage=4 and english_private.learning_date(next_review_at)=english_private.learning_date()+3 from english_private.phrases where legacy_phrase_id='test-target'),'partial lowers one stage, at most three days');
select pg_temp.assert_true((english_private.question_snapshot('c3333333-3333-4333-8333-333333333333',(select id from english_private.daily_queues where legacy_queue_id='test-snapshot'))->0->>'questionType')='collocation_gap','recent component error restores support');
select pg_temp.review_once((select id from english_private.phrases where legacy_phrase_id='test-target'),english_private.learning_date(),'not_measured');
select pg_temp.assert_true((select review_stage=4 and english_private.learning_date(next_review_at)=english_private.learning_date()+1 from english_private.phrases where legacy_phrase_id='test-target'),'reasonable alternative preserves stage and checks next day');
select pg_temp.assert_true((english_private.question_snapshot('c3333333-3333-4333-8333-333333333333',(select id from english_private.daily_queues where legacy_queue_id='test-snapshot'))->0->>'questionType')='whole_recall','unmeasured target receives explicit recall');
select pg_temp.assert_true((select bool_and(duration_seconds=20) from english_private.review_events),'duration excludes waiting for grading');
select pg_temp.assert_true((select count(distinct learning_date)=4 from english_private.review_events),'practice dates retained when grading later');
insert into english_private.phrases(owner_id,legacy_phrase_id,chunk,cue_zh,review_stage,next_review_at) values
('c3333333-3333-4333-8333-333333333333','test-new','come in handy','派上用场',0,null);
select pg_temp.review_once((select id from english_private.phrases where legacy_phrase_id='test-new'),english_private.learning_date(),'correct',false,true);
select pg_temp.assert_true((select review_stage=0 and english_private.learning_date(next_review_at)=english_private.learning_date()+1 from english_private.phrases where legacy_phrase_id='test-new'),'initial successful recall still starts next day');
select pg_temp.assert_true((select count(*)=0 from english_private.review_events where phrase_id=(select id from english_private.phrases where legacy_phrase_id='test-new') and target_outcome='correct' and not initial_learning),'same-day learning excluded from ability evidence');
select 'english_v2_schedule: PASS' result;
rollback;
