\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;

insert into auth.users(id,email,aud,role) values
('d4444444-4444-4444-8444-444444444444','dashboard-test@example.invalid','authenticated','authenticated'),
('e5555555-5555-4555-8555-555555555555','dashboard-other@example.invalid','authenticated','authenticated');
-- Updating the singleton only inside this rolled-back fixture also supports a populated local test database.
insert into english_private.app_owner(owner_id) values('d4444444-4444-4444-8444-444444444444')
on conflict(singleton) do update set owner_id=excluded.owner_id;
select set_config('request.jwt.claim.sub','d4444444-4444-4444-8444-444444444444',true);

insert into english_private.phrases(owner_id,chunk,cue_zh,status,next_review_at) values
('d4444444-4444-4444-8444-444444444444','overdue one','过期一','active',(english_private.learning_date()-2)::timestamp at time zone 'Asia/Shanghai'),
('d4444444-4444-4444-8444-444444444444','overdue two','过期二','active',(english_private.learning_date()-1)::timestamp at time zone 'Asia/Shanghai'),
('d4444444-4444-4444-8444-444444444444','due today','今日到期','active',((english_private.learning_date()+1)::timestamp at time zone 'Asia/Shanghai')-interval '1 second'),
('d4444444-4444-4444-8444-444444444444','due tomorrow','明日到期','active',(english_private.learning_date()+1)::timestamp at time zone 'Asia/Shanghai'),
('d4444444-4444-4444-8444-444444444444','not studied','尚未学习','active',null),
('d4444444-4444-4444-8444-444444444444','paused due','暂停表达','paused',(english_private.learning_date()-1)::timestamp at time zone 'Asia/Shanghai'),
('e5555555-5555-4555-8555-555555555555','other owner','其他用户','active',(english_private.learning_date()-1)::timestamp at time zone 'Asia/Shanghai');
insert into english_private.daily_observations(owner_id,learning_date,backlog) values
('d4444444-4444-4444-8444-444444444444',english_private.learning_date(),9),
('d4444444-4444-4444-8444-444444444444',english_private.learning_date()-1,7);

set local role authenticated;
select pg_temp.assert_true((english_api.get_dashboard()->'analytics'->'days'->-1->>'backlog')::integer=3,'today backlog is live, due today included; future/new/inactive/other-owner excluded');
select pg_temp.assert_true((english_api.get_dashboard()->'analytics'->'days'->-2->>'backlog')::integer=7,'past backlog retains its recorded observation');
reset role;
update english_private.phrases set next_review_at=(english_private.learning_date()+1)::timestamp at time zone 'Asia/Shanghai'
where owner_id='d4444444-4444-4444-8444-444444444444' and status='active' and next_review_at<(english_private.learning_date()+1)::timestamp at time zone 'Asia/Shanghai';
set local role authenticated;
select pg_temp.assert_true((english_api.get_dashboard()->'analytics'->'days'->-1->>'backlog')::integer=0,'committed reviews immediately clear today backlog without regenerating queue');
select pg_temp.assert_true((english_api.get_dashboard()->'analytics'->'days'->-2->>'backlog')::integer=7,'live updates do not rewrite historical observations');
reset role;
select pg_temp.assert_true((select backlog=9 from english_private.daily_observations where owner_id='d4444444-4444-4444-8444-444444444444' and learning_date=english_private.learning_date()),'dashboard reads do not mutate original observation');
select 'english_v2_dashboard: PASS' result;
rollback;
