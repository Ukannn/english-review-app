\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
insert into auth.users(id,email,aud,role) values('d4444444-4444-4444-8444-444444444444','edges@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('d4444444-4444-4444-8444-444444444444');
select set_config('request.jwt.claim.sub','d4444444-4444-4444-8444-444444444444',true);
select pg_temp.assert_true(english_api.get_review_bootstrap()->>'state'='empty','empty library does not invent targets');
insert into english_private.phrases(owner_id,chunk,cue_zh,status,next_review_at,review_stage) select 'd4444444-4444-4444-8444-444444444444','phrase '||i,'提示','active',now()-interval '1 day',2 from generate_series(1,12)i;
select english_api.set_learning_settings(4,0,'four');
select pg_temp.assert_true(english_api.get_review_bootstrap()->>'actualCount'='4','ungenerated queue uses changed preference');
select english_api.set_learning_settings(6,1,'six');
select pg_temp.assert_true(english_api.get_review_bootstrap()->>'actualCount'='6','increase before generation');
select english_api.create_ai_job('question_prepare',null,null,'freeze');
select english_api.set_learning_settings(4,2,'four-later');
select pg_temp.assert_true(english_api.get_review_bootstrap()->>'actualCount'='8','prepared job stays six plus two');
select pg_temp.assert_true((select count(*)=12 from english_private.phrases where next_review_at<now()),'planning never clears backlog');
update english_private.daily_queues set queue_date=queue_date-1;
select pg_temp.assert_true((english_api.get_review_bootstrap()->>'queueId')::uuid=(select subject_id from english_private.ai_jobs),'prepared lesson resumes across days');
update english_private.settings set value=jsonb_set(value,'{enabled}','false') where key='v3_learning_settings';
select pg_temp.assert_true(english_api.get_review_bootstrap()->>'ruleVersion'='english_v3','pause preserves prepared job');
rollback;

\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
insert into auth.users(id,email,aud,role) values('d4444444-4444-4444-8444-444444444444','edges@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('d4444444-4444-4444-8444-444444444444');
select set_config('request.jwt.claim.sub','d4444444-4444-4444-8444-444444444444',true);
insert into english_private.phrases(owner_id,chunk,cue_zh,status,next_review_at,review_stage) values('d4444444-4444-4444-8444-444444444444','feel up to','有精力做','mastered',now()+interval '10 days',5);
select pg_temp.assert_true(english_api.get_review_bootstrap()->>'actualCount'='0','non-due familiar items do not fill review');
select english_api.create_ai_job('question_prepare',null,null,'familiar');
select pg_temp.assert_true((select expected_count=2 and jsonb_array_length(input_snapshot->'targetPhraseIds')=1 from english_private.ai_jobs),'one familiar target supports two practice tasks');
select pg_temp.assert_true(not exists(select 1 from english_private.daily_queue_items where selection_type<>'expression'),'no fake due items');
rollback;

\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
insert into auth.users(id,email,aud,role) values('d4444444-4444-4444-8444-444444444444','edges@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('d4444444-4444-4444-8444-444444444444');
select set_config('request.jwt.claim.sub','d4444444-4444-4444-8444-444444444444',true);
insert into english_private.phrases(owner_id,chunk,cue_zh,status,review_stage) select 'd4444444-4444-4444-8444-444444444444','new phrase '||i,'提示','active',0 from generate_series(1,3)i;
select pg_temp.assert_true(english_api.get_review_bootstrap()->>'actualCount'='1','at most one confirmed new expression');
select english_api.create_ai_job('question_prepare',null,null,'new');
select pg_temp.assert_true((select count(*)=1 from english_private.ai_jobs,jsonb_array_elements(input_snapshot->'items')x where (x->>'isNew')::boolean),'new learning explicitly distinguished');
rollback;
