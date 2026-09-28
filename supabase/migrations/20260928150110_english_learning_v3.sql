begin;
-- Additive v3. Persisted v2 jobs and sessions continue through retained implementations.
alter table english_private.review_events add column metadata jsonb not null default '{}'::jsonb;
create unique index review_v3_grade_once on english_private.review_events(grade_result_id) where rule_version='english_v3';
create unique index review_modern_day_once on english_private.review_events(owner_id,phrase_id,learning_date) where rule_version in ('english_v2','english_v3') and affects_srs;
create unique index queue_v3_day_once on english_private.daily_queues(owner_id,queue_date) where contract_version='english_v3';
create unique index session_v3_queue_once on english_private.sessions(queue_id) where contract_version='english_v3';
create table english_private.lessons (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 queue_id uuid not null unique references english_private.daily_queues(id), session_id uuid references english_private.sessions(id),
 sequence integer not null, theme text not null check(theme in ('life','work')),
 material jsonb not null, reading_started_at timestamptz, reading_completed_at timestamptz,
 active_reading_seconds integer not null default 0 check(active_reading_seconds between 0 and 7200),
 burden text check(burden in ('light','right','heavy')),created_at timestamptz not null default now(), unique(owner_id,sequence)
);
create table english_private.lesson_exposures (
 owner_id uuid not null references auth.users(id),phrase_id uuid not null references english_private.phrases(id),
 learning_date date not null,source text not null,created_at timestamptz not null default now(),
 primary key(owner_id,phrase_id,learning_date,source)
);
alter table english_private.lessons enable row level security;
alter table english_private.lesson_exposures enable row level security;
revoke all on english_private.lessons,english_private.lesson_exposures from public,anon,authenticated;
-- Enable only after compatible frontend deployment. New owners default to enabled in rule_v3.
insert into english_private.settings(owner_id,key,value)
select owner_id,'v3_learning_settings','{"enabled":false,"reviewCount":8}'::jsonb from english_private.app_owner on conflict do nothing;
create function english_private.rule_v3(p_owner uuid) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
 select coalesce((select value||jsonb_build_object('revision',revision) from english_private.settings where owner_id=p_owner and key='v3_learning_settings'),'{"enabled":true,"reviewCount":8,"revision":0}'::jsonb)
$$;


alter function english_private.get_review_bootstrap() rename to get_review_bootstrap_v2;

alter function english_private.create_ai_job(text,integer,uuid,text) rename to create_ai_job_v2;

alter function english_private.get_ai_job_prompt(uuid) rename to get_ai_job_prompt_v2;

alter function english_private.import_ai_result(uuid,jsonb) rename to import_ai_result_v2;

alter function english_private.checkpoint_answers(uuid,jsonb,integer,text,text) rename to checkpoint_answers_v2;

alter function english_private.submit_session(uuid,jsonb,integer,text,text) rename to submit_session_v2;

alter function english_private.commit_submission(uuid,uuid) rename to commit_submission_v2;

alter function english_private.get_dashboard() rename to get_dashboard_v2;

alter function english_private.set_question_count(integer,text,integer,text) rename to set_question_count_v2;

create or replace function english_private.fill_queue(p_owner uuid,p_queue uuid) returns void language plpgsql
set search_path=pg_catalog,pg_temp as $$
#variable_conflict use_column
declare q english_private.daily_queues%rowtype; p english_private.phrases%rowtype; c english_private.candidates%rowtype;
 v_pos integer; v_target integer; v_new integer; v_due integer;
begin
 select * into q from english_private.daily_queues where id=p_queue and owner_id=p_owner for update;
 if q.id is null or q.status in ('committed','legacy','cancelled') then return; end if;
 if exists(select 1 from english_private.sessions where queue_id=q.id and status<>'open') then return; end if;
 v_target:=coalesce(q.adjusted_target,q.planned_count);
 select count(*) into v_due from english_private.phrases where owner_id=p_owner and status in ('active','mastered')
 and next_review_at < ((q.queue_date+1)::timestamp at time zone 'Asia/Shanghai');
 insert into english_private.daily_observations(owner_id,learning_date,backlog) values(p_owner,q.queue_date,v_due)
 on conflict(owner_id,learning_date) do update set backlog=excluded.backlog,observed_at=now();
 select coalesce(max(position),0) into v_pos from english_private.daily_queue_items where queue_id=q.id;
 for p in select p.* from english_private.phrases p where p.owner_id=p_owner and p.status in ('active','mastered')
 and p.next_review_at < ((q.queue_date+1)::timestamp at time zone 'Asia/Shanghai')
 and not exists(select 1 from english_private.daily_queue_items i where i.queue_id=q.id and i.phrase_id=p.id)
 order by p.next_review_at,p.created_at,p.id limit greatest(v_target-v_pos,0)
 loop
  v_pos:=v_pos+1;
  insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,chunk,cue_zh,topic,difficulty,natural_example,original_next_review,priority_reason,contract_version)
  values(p_owner,q.id,v_pos,'due',p.id,p.chunk,p.cue_zh,p.topic,p.difficulty,p.natural_example,p.next_review_at,'到期优先','english_v2');
 end loop;
 if v_due>=v_target then return; end if;
 select count(*) into v_new from english_private.daily_queue_items i join english_private.daily_queues d on d.id=i.queue_id
 where i.owner_id=p_owner and d.queue_date=q.queue_date and i.selection_type='new' and d.contract_version='english_v2';
 -- Previously approved but never studied phrases may have been removed by a count reduction.
 for p in select p.* from english_private.phrases p where p.owner_id=p_owner and p.status in ('active','mastered') and p.next_review_at is null
 and not exists(select 1 from english_private.review_events e where e.phrase_id=p.id)
 and not exists(select 1 from english_private.daily_queue_items i where i.queue_id=q.id and i.phrase_id=p.id)
 order by p.created_at,p.id limit least(greatest(v_target-v_pos,0),greatest(2-v_new,0))
 loop
  v_pos:=v_pos+1;v_new:=v_new+1;
  insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,chunk,cue_zh,topic,difficulty,natural_example,priority_reason,contract_version)
  values(p_owner,q.id,v_pos,'new',p.id,p.chunk,p.cue_zh,p.topic,p.difficulty,p.natural_example,'已确认的新表达','english_v2');
 end loop;
 for c in select c.* from english_private.candidates c where c.owner_id=p_owner and c.status='ready' and c.promoted_phrase_id is null
 and not exists(select 1 from english_private.phrases p where p.owner_id=p_owner and lower(trim(p.chunk))=lower(trim(c.candidate)))
 order by case when c.origin_type='context' then 0 else 1 end,c.created_at,c.id
 limit least(greatest(v_target-v_pos,0),greatest(2-v_new,0))
 loop
  insert into english_private.phrases(owner_id,chunk,cue_zh,phrase_type,topic,difficulty,common_mistake,natural_example,source,source_candidate_id,contract_version)
  values(p_owner,c.candidate,c.cue_zh,c.candidate_type,c.topic,c.difficulty,c.common_mistake,c.natural_example,c.source,c.id,'english_v2') returning * into p;
  update english_private.candidates set promoted_phrase_id=p.id,status='promoted',promoted_at=now() where id=c.id;
  v_pos:=v_pos+1;
  insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,candidate_id,chunk,cue_zh,topic,difficulty,natural_example,priority_reason,contract_version)
  values(p_owner,q.id,v_pos,'new',p.id,c.id,p.chunk,p.cue_zh,p.topic,p.difficulty,p.natural_example,'已确认的新表达','english_v2');
 end loop;
end $$;

create or replace function english_private.fill_queue_v3(p_owner uuid,p_queue uuid) returns void language plpgsql
set search_path=pg_catalog,pg_temp as $$
#variable_conflict use_column
declare q english_private.daily_queues%rowtype; p english_private.phrases%rowtype; c english_private.candidates%rowtype;
 v_pos integer; v_target integer; v_new integer; v_due integer;
begin
 select * into q from english_private.daily_queues where id=p_queue and owner_id=p_owner for update;
 if exists(select 1 from english_private.ai_jobs where subject_id=p_queue and kind='question_prepare' and status in ('prepared','consumed')) then return;end if;
 if q.id is null or q.status in ('committed','legacy','cancelled') then return; end if;
 if exists(select 1 from english_private.sessions where queue_id=q.id and status<>'open') then return; end if;
 v_target:=coalesce(q.adjusted_target,q.planned_count);
 select count(*) into v_due from english_private.phrases where owner_id=p_owner and status in ('active','mastered')
 and next_review_at < ((q.queue_date+1)::timestamp at time zone 'Asia/Shanghai');
 insert into english_private.daily_observations(owner_id,learning_date,backlog) values(p_owner,q.queue_date,v_due)
 on conflict(owner_id,learning_date) do update set backlog=excluded.backlog,observed_at=now();
 select coalesce(max(position),0) into v_pos from english_private.daily_queue_items where queue_id=q.id;
 for p in select p.* from english_private.phrases p where p.owner_id=p_owner and p.status in ('active','mastered')
 and p.next_review_at < ((q.queue_date+1)::timestamp at time zone 'Asia/Shanghai')
 and not exists(select 1 from english_private.daily_queue_items i where i.queue_id=q.id and i.phrase_id=p.id)
 order by p.next_review_at,p.id limit greatest(v_target-v_pos,0)
 loop
  v_pos:=v_pos+1;
  insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,chunk,cue_zh,topic,difficulty,natural_example,original_next_review,priority_reason,contract_version)
  values(p_owner,q.id,v_pos,'due',p.id,p.chunk,p.cue_zh,p.topic,p.difficulty,p.natural_example,p.next_review_at,'到期优先','english_v3');
 end loop;
 if v_due>=v_target then return; end if;
 select count(*) into v_new from english_private.daily_queue_items i join english_private.daily_queues d on d.id=i.queue_id
 where i.owner_id=p_owner and d.queue_date=q.queue_date and i.selection_type='new' and d.contract_version='english_v3';
 -- Previously approved but never studied phrases may have been removed by a count reduction.
 for p in select p.* from english_private.phrases p where p.owner_id=p_owner and p.status in ('active','mastered') and p.next_review_at is null
 and not exists(select 1 from english_private.review_events e where e.phrase_id=p.id)
 and not exists(select 1 from english_private.daily_queue_items i where i.queue_id=q.id and i.phrase_id=p.id)
 order by p.created_at,p.id limit least(greatest(v_target-v_pos,0),greatest(1-v_new,0))
 loop
  v_pos:=v_pos+1;v_new:=v_new+1;
  insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,chunk,cue_zh,topic,difficulty,natural_example,priority_reason,contract_version)
  values(p_owner,q.id,v_pos,'new',p.id,p.chunk,p.cue_zh,p.topic,p.difficulty,p.natural_example,'已确认的新表达','english_v3');
 end loop;
 for c in select c.* from english_private.candidates c where c.owner_id=p_owner and c.status='ready' and c.promoted_phrase_id is null
 and not exists(select 1 from english_private.phrases p where p.owner_id=p_owner and lower(trim(p.chunk))=lower(trim(c.candidate)))
 order by case when c.origin_type='context' then 0 else 1 end,c.created_at,c.id
 limit least(greatest(v_target-v_pos,0),greatest(1-v_new,0))
 loop
  insert into english_private.phrases(owner_id,chunk,cue_zh,phrase_type,topic,difficulty,common_mistake,natural_example,source,source_candidate_id,contract_version)
  values(p_owner,c.candidate,c.cue_zh,c.candidate_type,c.topic,c.difficulty,c.common_mistake,c.natural_example,c.source,c.id,'english_v3') returning * into p;
  update english_private.candidates set promoted_phrase_id=p.id,status='promoted',promoted_at=now() where id=c.id;
  v_pos:=v_pos+1;
  insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,candidate_id,chunk,cue_zh,topic,difficulty,natural_example,priority_reason,contract_version)
  values(p_owner,q.id,v_pos,'new',p.id,c.id,p.chunk,p.cue_zh,p.topic,p.difficulty,p.natural_example,'已确认的新表达','english_v3');
 end loop;
end $$;

create function english_private.question_snapshot_v3(p_owner uuid,p_queue uuid) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
 with rows as (
 select i.*,p.common_mistake,p.canonical_pattern,
 (select jsonb_agg(to_jsonb(t)) from (select e.target_outcome,e.hint_used,e.question_type,e.prompt,e.user_answer,e.learning_date,e.meaning_ok,e.naturalness,e.metadata from english_private.review_events e where e.phrase_id=i.phrase_id and e.owner_id=p_owner order by e.reviewed_at desc limit 6) t) recent,
 (select count(distinct learning_date) from english_private.review_events e where e.phrase_id=i.phrase_id and e.rule_version in ('english_v2','english_v3') and e.target_outcome='correct' and not e.hint_used and not e.initial_learning and coalesce(e.metadata->>'phase','review')='review' and e.question_type not in ('collocation_gap','contextual_gap') and not coalesce((e.metadata->>'exposed')::boolean,false)) success_days,
 (select count(distinct question_fingerprint) from english_private.review_events e where e.phrase_id=i.phrase_id and e.rule_version in ('english_v2','english_v3') and e.target_outcome='correct' and not e.hint_used and not e.initial_learning and coalesce(e.metadata->>'phase','review')='review' and e.question_type not in ('collocation_gap','contextual_gap') and not coalesce((e.metadata->>'exposed')::boolean,false)) success_prompts,
 (select e.target_outcome from english_private.review_events e where e.phrase_id=i.phrase_id and e.rule_version in ('english_v2','english_v3') and coalesce(e.metadata->>'phase','review')='review' order by e.reviewed_at desc limit 1) last_outcome,
 (select e.hint_used from english_private.review_events e where e.phrase_id=i.phrase_id and e.rule_version in ('english_v2','english_v3') and coalesce(e.metadata->>'phase','review')='review' order by e.reviewed_at desc limit 1) last_hint,
 (select e.question_type from english_private.review_events e where e.phrase_id=i.phrase_id and e.rule_version in ('english_v2','english_v3') and coalesce(e.metadata->>'phase','review')='review' order by e.reviewed_at desc limit 1) last_type,
 coalesce((select jsonb_agg(z.prompt) from (select coalesce(qq.prompt_zh,qq.prompt_en) prompt from english_private.questions qq where qq.phrase_id=i.phrase_id order by qq.created_at desc limit 5) z),'[]'::jsonb) recent_prompts
 from english_private.daily_queue_items i join english_private.phrases p on p.id=i.phrase_id
 where i.owner_id=p_owner and i.queue_id=p_queue and not exists(select 1 from english_private.questions x where x.queue_item_id=i.id)
 ), kinds as (
 select *,case when selection_type='new' then 'learning_recall'
 when last_type='collocation_gap' and last_outcome='correct' then 'whole_recall'
 when last_outcome in ('partial','forgotten') or last_hint then 'collocation_gap'
 when last_outcome='not_measured' then 'whole_recall'
 when last_outcome='correct' and success_days>=2 and success_prompts>=2 then 'transfer_expression'
 when last_outcome='correct' and last_type<>'collocation_gap' then 'short_expression'
 else 'whole_recall' end proposed from rows
 ), ranked as (
 select *,count(*) filter(where proposed in ('short_expression','transfer_expression')) over(order by position) expression_number from kinds
 )
 select coalesce(jsonb_agg(jsonb_build_object('queueItemId',id,'position',position,'phraseId',phrase_id,'candidateId',candidate_id,
 'chunk',chunk,'cueZh',cue_zh,'example',natural_example,'commonMistake',common_mistake,'usageBoundary',canonical_pattern,
 'isNew',selection_type='new','questionType',case when expression_number>greatest(2-(select count(*) from english_private.questions x where x.queue_id=p_queue and x.question_type in ('short_expression','transfer_expression')),0) and proposed in ('short_expression','transfer_expression') then 'whole_recall' else proposed end,
 'recentAnswers',coalesce(recent,'[]'::jsonb),'recentPrompts',recent_prompts,'successDays',success_days,'successPrompts',success_prompts) order by position),'[]'::jsonb) from ranked
$$;

create or replace function english_private.commit_submission_v2(p_owner uuid,p_submission_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
#variable_conflict use_column
declare s english_private.submissions%rowtype;g english_private.grade_results%rowtype;p english_private.phrases%rowtype;
 q english_private.questions%rowtype;d english_private.answer_drafts%rowtype;v_day date;v_stage integer;v_days integer;v_apply boolean;v_initial boolean;v_duration integer;v_at timestamptz;v_result text;
 intervals integer[]:=array[1,2,4,7,14,30,60,120];
begin
 if p_owner is distinct from english_private.current_owner() then raise exception 'OWNER_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,2));
 select * into s from english_private.submissions where id=p_submission_id and owner_id=p_owner for update;
 if s.id is null then raise exception 'SUBMISSION_NOT_FOUND';end if;
 if s.status='committed' then return jsonb_build_object('ok',true,'submissionId',s.id,'status','committed','idempotent',true);end if;
 if not exists(select 1 from english_private.sessions where id=s.session_id and contract_version='english_v2') then raise exception 'LEGACY_SESSION_READ_ONLY';end if;
 if exists(select 1 from english_private.grade_results where submission_id=s.id and status<>'accepted') then raise exception 'GRADES_NOT_CONFIRMED';end if;
 if (select count(*) from english_private.grade_results where submission_id=s.id)=0 or (select count(*) from english_private.grade_results where submission_id=s.id)<>(select count(*) from english_private.grade_requests where submission_id=s.id) then raise exception 'GRADE_COUNT_MISMATCH';end if;
 for g in select * from english_private.grade_results where submission_id=s.id order by position loop
  select x.* into q from english_private.questions x join english_private.grade_requests r on r.question_id=x.id where r.id=g.grade_request_id;
  select * into p from english_private.phrases where id=q.phrase_id and owner_id=p_owner for update;
  select * into d from english_private.answer_drafts where question_id=q.id and session_id=s.session_id;
  if p.id is null or g.target_outcome is null then raise exception 'INVALID_V2_GRADE';end if;
  v_at:=coalesce(nullif(d.metadata->>'practiceEndedAt','')::timestamptz,(select revealed_at from english_private.question_activity where question_id=q.id),d.created_at);
  v_day:=english_private.learning_date(v_at);
  v_initial:=coalesce((q.metadata->>'isNew')::boolean,false);
  v_apply:=(v_initial or not exists(select 1 from english_private.lesson_exposures where owner_id=p_owner and phrase_id=p.id and learning_date=v_day)) and not exists(select 1 from english_private.review_events where owner_id=p_owner and phrase_id=p.id and learning_date=v_day and rule_version in ('english_v2','english_v3') and affects_srs);
  v_stage:=least(p.review_stage,7);
  if v_initial then v_stage:=0;v_days:=1;
  elsif g.target_outcome='not_measured' then v_days:=1;
  elsif g.target_outcome='forgotten' then v_stage:=0;v_days:=1;
  elsif g.target_outcome='partial' then v_stage:=greatest(v_stage-1,0);v_days:=least(intervals[v_stage+1],3);
  elsif g.hint_used then v_days:=least(intervals[v_stage+1],3);
  else v_stage:=least(v_stage+1,7);v_days:=intervals[v_stage+1];end if;
  v_result:=case g.target_outcome when 'forgotten' then 'forgotten' when 'partial' then 'difficult' when 'not_measured' then 'normal' else case when g.hint_used then 'difficult' else 'normal' end end;
  if v_apply then
   update english_private.phrases set review_stage=v_stage,next_review_at=((greatest(v_day,english_private.learning_date())+v_days)::timestamp at time zone 'Asia/Shanghai'),
   last_result=v_result,contract_version='english_v2',mastery_streak=case when g.target_outcome='correct' and not g.hint_used and not v_initial then mastery_streak+1 else 0 end where id=p.id;
  end if;
  v_duration:=null;
  if nullif(d.metadata->>'practiceStartedAt','') is not null then
   v_duration:=least(1800,greatest(0,extract(epoch from(v_at-(d.metadata->>'practiceStartedAt')::timestamptz))::integer));
  end if;
  insert into english_private.review_events(owner_id,phrase_id,session_id,grade_result_id,question_position,prompt,expected_answer,user_answer,result,question_type,affects_srs,reviewed_at,contract_version,
  learning_date,rule_version,target_outcome,hint_used,question_fingerprint,meaning_ok,naturalness,duration_seconds,initial_learning)
  values(p_owner,p.id,s.session_id,g.id,g.position,coalesce(q.prompt_zh,q.prompt_en),g.expected_answer,g.observed_answer,v_result,q.question_type,v_apply,v_at,'english_v2',v_day,'english_v2',g.target_outcome,g.hint_used,
  english_private.sha256_json(jsonb_build_array(q.prompt_zh,q.prompt_en)),g.meaning_ok,g.naturalness,v_duration,v_initial);
  if g.target_outcome in ('partial','forgotten') or g.naturalness<>'natural' then
   insert into english_private.error_events(owner_id,phrase_id,session_id,chunk,error_type,user_answer,correction,explanation,next_action,resolved,occurred_at,contract_version)
   values(p_owner,p.id,s.session_id,p.chunk,coalesce(g.error_category,g.target_outcome),g.observed_answer,g.expected_answer,g.feedback_zh,'依照下一次提取表现调整提示',false,v_at,'english_v2');
  end if;
  update english_private.grade_results set result=v_result,status='committed' where id=g.id;
 end loop;
 update english_private.submissions set status='committed',revision=revision+1,completed_at=now(),updated_at=now() where id=s.id;
 update english_private.sessions set status='committed',completed_at=now(),revision=revision+1 where id=s.session_id;
 update english_private.daily_queues set status='committed',committed_at=now() where id=s.queue_id;
 update english_private.commit_journal set status='committed',last_completed_step='readback',readback_status='verified_complete',result=jsonb_build_object('submissionId',s.id,'answerHash',s.frozen_hash,'ruleVersion','english_v2'),completed_at=now(),updated_at=now() where submission_id=s.id;
 return jsonb_build_object('ok',true,'submissionId',s.id,'status','committed','answerHash',s.frozen_hash);
end $$;

create function english_private.queue_for_day_v3(p_owner uuid,p_date date) returns uuid language plpgsql set search_path=pg_catalog,pg_temp as $$
declare q uuid;n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,2));
 select id into q from english_private.daily_queues where owner_id=p_owner and queue_date=p_date and contract_version='english_v3';
 if q is null then
  n:=(english_private.rule_v3(p_owner)->>'reviewCount')::integer;
  insert into english_private.daily_queues(owner_id,legacy_queue_id,queue_date,planned_count,queue_kind,contract_version) values(p_owner,'v3-'||p_date,p_date,n,'lesson','english_v3') returning id into q;
 end if;
 if not exists(select 1 from english_private.ai_jobs where subject_id=q and kind='question_prepare') and not exists(select 1 from english_private.sessions where queue_id=q) then
  n:=(english_private.rule_v3(p_owner)->>'reviewCount')::integer;
  if exists(select 1 from english_private.daily_queues where id=q and planned_count<>n) then
   delete from english_private.daily_queue_items where queue_id=q;
   update english_private.daily_queues set planned_count=n,revision=revision+1 where id=q;
  end if;
 end if;
 perform english_private.fill_queue_v3(p_owner,q);
 return q;
end $$;

create or replace function english_private.get_review_bootstrap() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner();d date:=english_private.learning_date();q uuid;ss english_private.sessions%rowtype;l english_private.lessons%rowtype;items jsonb;n integer;cfg jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,2));
 if exists(select 1 from english_private.sessions where owner_id=o and contract_version='english_v2' and (status in ('open','submitted','grading','needs_confirmation') or learning_date=d)) or exists(select 1 from english_private.ai_jobs j join english_private.daily_queues dq on dq.id=j.subject_id where j.owner_id=o and j.kind='question_prepare' and j.status='prepared' and dq.contract_version='english_v2') or (not (english_private.rule_v3(o)->>'enabled')::boolean and not exists(select 1 from english_private.sessions where owner_id=o and contract_version='english_v3' and status in ('open','submitted','grading','needs_confirmation')) and not exists(select 1 from english_private.ai_jobs where owner_id=o and status='prepared' and input_snapshot->>'ruleVersion'='english_v3')) then
  return english_private.get_review_bootstrap_v2();
 end if;
 select * into ss from english_private.sessions where owner_id=o and contract_version='english_v3' and status in ('open','submitted','grading','needs_confirmation') order by created_at limit 1;
 if ss.id is not null then q:=ss.queue_id;else select subject_id into q from english_private.ai_jobs where owner_id=o and kind='question_prepare' and status='prepared' and input_snapshot->>'ruleVersion'='english_v3' order by created_at limit 1;
 if q is null then q:=english_private.queue_for_day_v3(o,d);end if;select * into ss from english_private.sessions where queue_id=q;end if;
 select * into l from english_private.lessons where queue_id=q;
 select count(*) into n from english_private.daily_queue_items where queue_id=q;
 cfg:=english_private.rule_v3(o);
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'position',x.position,'phraseId',x.phrase_id,'candidateId',x.candidate_id,'questionType',x.question_type,'promptZh',x.prompt_zh,'promptEn',x.prompt_en,'expectedAnswers',x.expected_answers,'acceptedVariants',x.accepted_variants,'semanticBoundary',null,'contentHash',x.content_hash,'ruleVersion','english_v3')||x.metadata||jsonb_build_object('hintCount',coalesce(a.hint_count,0),'learningCardViewed',coalesce(a.study_viewed,false),'draft',case when dr.id is null then null else jsonb_build_object('answer',dr.answer,'revision',dr.revision,'answerHash',dr.answer_hash,'status',dr.submit_status)||dr.metadata end) order by x.position),'[]'::jsonb) into items
 from english_private.questions x left join english_private.answer_drafts dr on dr.question_id=x.id left join english_private.question_activity a on a.question_id=x.id where x.queue_id=q;
 return jsonb_build_object('ok',true,'ruleVersion','english_v3','state',case when l.id is not null then ss.status when n>0 or exists(select 1 from english_private.phrases ph where owner_id=o and status in ('active','mastered') and (status='mastered' or exists(select 1 from english_private.review_events e where e.phrase_id=ph.id))) then 'questions_required' else 'empty' end,
 'learningDate',coalesce(ss.learning_date,d),'queueId',q,'actualCount',n,'settings',jsonb_build_object('defaultQuestionCount',cfg->'reviewCount','todayQuestionCount',n,'minimumTodayCount',4,'revision',cfg->'revision','ruleVersion','english_v3'),
 'session',case when ss.id is null then null else jsonb_build_object('id',ss.id,'revision',ss.revision,'maxQuestions',ss.max_questions,'status',ss.status,'submissionId',(select id from english_private.submissions where session_id=ss.id)) end,'questions',items,
 'lesson',case when l.id is null then null else jsonb_build_object('id',l.id,'theme',l.theme,'sequence',l.sequence,'material',case when l.reading_started_at is null then null else l.material end,'readingStarted',l.reading_started_at is not null,'readingCompleted',l.reading_completed_at is not null,'readingSeconds',l.active_reading_seconds,'burden',l.burden) end);
end $$;

create function english_private.set_learning_settings(p_count integer,p_revision integer,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner();cfg jsonb;h text;r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,2));
 h:=english_private.sha256_json(jsonb_build_array(p_count,p_revision));
 select response into r from english_private.rpc_idempotency where owner_id=o and operation='learning_settings' and idempotency_key=p_idempotency_key and request_hash=h;if r is not null then return r;end if;
 if nullif(p_idempotency_key,'') is null or exists(select 1 from english_private.rpc_idempotency where owner_id=o and operation='learning_settings' and idempotency_key=p_idempotency_key) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 if p_count is null or p_count not between 4 and 12 then raise exception 'REVIEW_COUNT_OUT_OF_RANGE';end if;
 cfg:=english_private.rule_v3(o);if p_revision is distinct from (cfg->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
 insert into english_private.settings(owner_id,key,value) values(o,'v3_learning_settings',jsonb_build_object('enabled',(cfg->>'enabled')::boolean,'reviewCount',p_count)) on conflict(owner_id,key) do update set value=excluded.value,revision=english_private.settings.revision+1,updated_at=now();
 r:=jsonb_build_object('ok',true,'defaultCount',p_count,'revision',(english_private.rule_v3(o)->>'revision')::integer);
 insert into english_private.rpc_idempotency(owner_id,operation,idempotency_key,request_hash,response) values(o,'learning_settings',p_idempotency_key,h,r);return r;
end $$;
create or replace function english_private.set_question_count(p_count integer,p_mode text default 'today',p_revision integer default null,p_idempotency_key text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner();
begin
 if exists(select 1 from english_private.sessions where owner_id=o and contract_version='english_v3' and status='open') then raise exception 'LESSON_FROZEN_USE_FUTURE_SETTINGS';end if;
 return english_private.set_question_count_v2(p_count,p_mode,p_revision,p_idempotency_key);
end $$;

create function english_private.record_lesson_activity(p_session_id uuid,p_action text,p_seconds integer,p_burden text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner();l english_private.lessons%rowtype;h text;r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,2));
 h:=english_private.sha256_json(jsonb_build_array(p_session_id,p_action,p_seconds,p_burden));
 select response into r from english_private.rpc_idempotency where owner_id=o and operation='lesson_activity' and idempotency_key=p_idempotency_key and request_hash=h;if r is not null then return r;end if;
 if nullif(p_idempotency_key,'') is null or exists(select 1 from english_private.rpc_idempotency where owner_id=o and operation='lesson_activity' and idempotency_key=p_idempotency_key) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 select * into l from english_private.lessons where session_id=p_session_id and owner_id=o for update;if l.id is null then raise exception 'LESSON_NOT_FOUND';end if;
 if p_action='burden' then
  if p_burden is null or p_burden not in ('light','right','heavy') then raise exception 'INVALID_BURDEN';end if;
  update english_private.lessons set burden=p_burden where id=l.id;
 else
  if not exists(select 1 from english_private.sessions where id=p_session_id and status='open') then raise exception 'SESSION_NOT_OPEN';end if;
  if p_action is null or p_action not in ('reading_start','reading_complete','reading_time') or p_seconds is null or p_seconds not between 0 and 7200 then raise exception 'INVALID_LESSON_ACTIVITY';end if;
  if exists(select 1 from english_private.questions q where q.session_id=p_session_id and q.metadata->>'phase'='review' and not exists(select 1 from english_private.answer_drafts d where d.question_id=q.id)) then raise exception 'REVIEW_NOT_FINISHED';end if;
  if p_action<>'reading_start' and l.reading_started_at is null then raise exception 'READING_REQUIRED';end if;
  update english_private.lessons set reading_started_at=coalesce(reading_started_at,now()),reading_completed_at=case when p_action='reading_complete' then coalesce(reading_completed_at,now()) else reading_completed_at end,active_reading_seconds=greatest(active_reading_seconds,p_seconds) where id=l.id;
  insert into english_private.lesson_exposures(owner_id,phrase_id,learning_date,source) select o,x::uuid,english_private.learning_date(),'reading' from jsonb_array_elements_text(l.material->'targetPhraseIds')x on conflict do nothing;
 end if;
 r:=jsonb_build_object('ok',true);insert into english_private.rpc_idempotency(owner_id,operation,idempotency_key,request_hash,response) values(o,'lesson_activity',p_idempotency_key,h,r);return r;
end $$;
create or replace function english_private.build_daily_queue() returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid;
begin
 select owner_id into o from english_private.app_owner;if o is null then return;end if;
 if (english_private.rule_v3(o)->>'enabled')::boolean then perform english_private.queue_for_day_v3(o,english_private.learning_date());else perform english_private.queue_for_day(o,english_private.learning_date());end if;
end $$;


create or replace function english_private.checkpoint_answers(
  p_session_id uuid,
  p_answers jsonb,
  p_session_revision integer,
  p_idempotency_key text,
  p_frozen_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = english_private, extensions, pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_owner uuid := english_private.current_owner();
  v_session english_private.sessions%rowtype;
  v_answer jsonb;
  v_question english_private.questions%rowtype;
  v_existing english_private.answer_drafts%rowtype;
  v_hash text := english_private.sha256_json(p_answers);
  v_response jsonb;
  v_request_hash text:=english_private.sha256_json(jsonb_build_object('sessionId',p_session_id,'revision',p_session_revision,'answers',p_answers));
  v_revision integer; v_state text; v_exposed boolean; v_at timestamptz;
begin
  if not exists(select 1 from english_private.sessions where id=p_session_id and owner_id=v_owner and contract_version='english_v3') then return english_private.checkpoint_answers_v2(p_session_id,p_answers,p_session_revision,p_idempotency_key,p_frozen_hash);end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text,2));
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) not between 1 and 150 then raise exception 'INVALID_ANSWERS'; end if;
  if nullif(p_idempotency_key,'') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED';end if;
  if (select count(distinct x->>'position') from jsonb_array_elements(p_answers)x)<>jsonb_array_length(p_answers) then raise exception 'DUPLICATE_ANSWER_POSITION';end if;
  if v_hash is distinct from p_frozen_hash then raise exception 'FROZEN_HASH_MISMATCH'; end if;
  select response into v_response from english_private.rpc_idempotency
  where owner_id=v_owner and operation='checkpoint_answers' and idempotency_key=p_idempotency_key and request_hash=v_request_hash;
  if v_response is not null then return v_response; end if;
  if exists (select 1 from english_private.rpc_idempotency where owner_id=v_owner and operation='checkpoint_answers' and idempotency_key=p_idempotency_key)
  then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  begin
    select * into v_session from english_private.sessions where id=p_session_id and owner_id=v_owner for update nowait;
  exception when lock_not_available then raise exception 'BUSY_RETRY'; end;
  if v_session.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'open' then raise exception 'SESSION_NOT_OPEN'; end if;
  if v_session.revision is distinct from p_session_revision then raise exception 'REVISION_CONFLICT'; end if;

  for v_answer in select value from jsonb_array_elements(p_answers)
  loop
    v_state:=coalesce(v_answer->>'attemptState','answered');
    if v_state not in ('answered','dont_know','skipped') or (v_state='answered' and nullif(trim(v_answer->>'answer'),'') is null) or (v_state<>'answered' and v_answer->>'answer' is distinct from '') or (v_answer->>'revision')::integer < 1 or nullif(v_answer->>'revealHash','') is null then
      raise exception 'INVALID_ANSWER_ROW';
    end if;
    select * into v_question from english_private.questions
    where session_id=v_session.id and owner_id=v_owner and position=(v_answer->>'position')::integer;
    if v_question.id is null then raise exception 'QUESTION_NOT_FOUND'; end if;
    if coalesce((v_answer->>'hintCount')::integer,0) not between 0 and jsonb_array_length(coalesce(v_question.metadata->'hints','[]'::jsonb)) then raise exception 'INVALID_HINT_COUNT';end if;
    if coalesce((v_answer->>'hintUsed')::boolean,false) is distinct from (coalesce((v_answer->>'hintCount')::integer,0)>0) then raise exception 'INVALID_HINT_METADATA';end if;
    if exists(select 1 from english_private.question_activity a where a.question_id=v_question.id and (a.hint_count>coalesce((v_answer->>'hintCount')::integer,0) or (a.study_viewed and not coalesce((v_answer->>'learningCardViewed')::boolean,false)))) then raise exception 'ACTIVITY_METADATA_CONFLICT';end if;
    if v_state<>'skipped' and coalesce((v_question.metadata->>'isNew')::boolean,false) and not coalesce((v_answer->>'learningCardViewed')::boolean,false) then raise exception 'LEARNING_CARD_NOT_VIEWED';end if;
    if nullif(v_answer->>'practiceEndedAt','') is not null and ((v_answer->>'practiceEndedAt')::timestamptz>now()+interval '5 minutes' or (v_answer->>'practiceEndedAt')::timestamptz<coalesce(nullif(v_answer->>'practiceStartedAt','')::timestamptz,(v_answer->>'practiceEndedAt')::timestamptz)) then raise exception 'INVALID_PRACTICE_TIMING';end if;
    if coalesce((v_answer->>'activeSeconds')::numeric,-1) not between 0 and 1800 then raise exception 'INVALID_ACTIVE_TIME';end if;
    if v_question.metadata->>'phase'='expression' and v_state<>'skipped' and not exists(select 1 from english_private.lessons where session_id=p_session_id and reading_started_at is not null) then raise exception 'READING_REQUIRED';end if;
    v_at:=coalesce(nullif(v_answer->>'practiceEndedAt','')::timestamptz,now());
    v_exposed:=exists(select 1 from english_private.lesson_exposures where owner_id=v_owner and phrase_id=v_question.phrase_id and learning_date=english_private.learning_date(v_at) and created_at<=v_at) or exists(select 1 from english_private.review_events where owner_id=v_owner and phrase_id=v_question.phrase_id and learning_date=english_private.learning_date(v_at));
    select * into v_existing from english_private.answer_drafts where session_id=v_session.id and position=v_question.position;
    if v_existing.id is not null then
      if v_existing.revision=(v_answer->>'revision')::integer and v_existing.answer=(v_answer->>'answer') and v_existing.metadata->>'attemptState'=v_state and v_existing.metadata->>'hintUsed' is not distinct from coalesce(v_answer->>'hintUsed','false') then continue; end if;
      raise exception 'ANSWER_FROZEN';
    end if;
    if v_question.metadata->>'phase'='review' and exists(select 1 from english_private.lessons where session_id=p_session_id and reading_started_at is not null) then raise exception 'REVIEW_PHASE_CLOSED';end if;
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
    update english_private.answer_drafts set metadata=jsonb_build_object('hintUsed',coalesce((v_answer->>'hintUsed')::boolean,false),'hintCount',coalesce((v_answer->>'hintCount')::integer,0),'learningCardViewed',coalesce((v_answer->>'learningCardViewed')::boolean,false),'practiceStartedAt',v_answer->>'practiceStartedAt','practiceEndedAt',v_answer->>'practiceEndedAt','attemptState',v_state,'phase',v_question.metadata->>'phase','answerForm',v_question.metadata->>'answerForm','exposed',v_exposed or v_question.metadata->>'phase'='expression','activeSeconds',(v_answer->>'activeSeconds')::integer),contract_version='english_v3' where session_id=v_session.id and position=v_question.position;
    if v_state<>'skipped' then
      insert into english_private.lesson_exposures(owner_id,phrase_id,learning_date,source) values(v_owner,v_question.phrase_id,english_private.learning_date(v_at),'answer_reveal') on conflict do nothing;
    end if;
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
  values(v_owner,'checkpoint_answers',p_idempotency_key,v_request_hash,v_response);
  return v_response;
end;
$$;

create or replace function english_private.submit_session(
  p_session_id uuid,
  p_answers jsonb,
  p_session_revision integer,
  p_idempotency_key text,
  p_frozen_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = english_private, extensions, pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_owner uuid := english_private.current_owner();
  v_session english_private.sessions%rowtype;
  v_submission english_private.submissions%rowtype;
  v_actual_hash text;
  v_response jsonb;
begin
  if not exists(select 1 from english_private.sessions where id=p_session_id and owner_id=v_owner and contract_version='english_v3') then return english_private.submit_session_v2(p_session_id,p_answers,p_session_revision,p_idempotency_key,p_frozen_hash);end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text,2));
  select * into v_submission from english_private.submissions where session_id=p_session_id and owner_id=v_owner;
  if v_submission.id is not null then
   if v_submission.frozen_hash is distinct from p_frozen_hash then raise exception 'SUBMISSION_HASH_CONFLICT';end if;
   return jsonb_build_object('ok',true,'submissionId',v_submission.id,'status',v_submission.status,'answerHash',v_submission.frozen_hash,'idempotent',true);
  end if;
  if nullif(p_idempotency_key,'') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED';end if;
  if p_answers is not null and jsonb_array_length(p_answers) > 0 then
    perform english_api.checkpoint_answers(p_session_id,p_answers,p_session_revision,p_idempotency_key || ':tail',english_private.sha256_json(p_answers));
    p_session_revision := p_session_revision + 1;
  end if;
  begin
    select * into v_session from english_private.sessions where id=p_session_id and owner_id=v_owner for update nowait;
  exception when lock_not_available then raise exception 'BUSY_RETRY'; end;
  if v_session.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status<>'open' then raise exception 'SESSION_NOT_OPEN';end if;
  if v_session.revision is distinct from p_session_revision then raise exception 'REVISION_CONFLICT'; end if;
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
  left join english_private.phrases p on p.id=q.phrase_id where q.session_id=v_session.id and d.metadata->>'attemptState'<>'skipped' order by q.position;
  update english_private.grade_requests set contract_version='english_v3',snapshot_contract_version='english_v3' where submission_id=v_submission.id;
  update english_private.answer_drafts set submit_status='submitted' where session_id=v_session.id;
  update english_private.sessions set status='submitted',submitted_at=now(),revision=revision+1 where id=v_session.id;
  insert into english_private.commit_journal(owner_id,submission_id,answer_hash,status,last_completed_step)
  values(v_owner,v_submission.id,v_actual_hash,'pending','grade_requests_frozen');
  if not exists(select 1 from english_private.grade_requests where submission_id=v_submission.id) then
    update english_private.submissions set status='committed',completed_at=now() where id=v_submission.id;
    update english_private.sessions set status='committed',completed_at=now() where id=v_session.id;
    update english_private.daily_queues set status='committed',committed_at=now() where id=v_session.queue_id;
    update english_private.commit_journal set status='committed',readback_status='verified_complete',completed_at=now() where submission_id=v_submission.id;
  end if;
  v_response := jsonb_build_object('ok',true,'submissionId',v_submission.id,'status',(select status from english_private.submissions where id=v_submission.id),'answerHash',v_actual_hash,'gradeRequestCount',(select count(*) from english_private.grade_requests where submission_id=v_submission.id));
  return v_response;
end;
$$;

create or replace function english_private.commit_submission(p_owner uuid,p_submission_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
#variable_conflict use_column
declare s english_private.submissions%rowtype;g english_private.grade_results%rowtype;p english_private.phrases%rowtype;
 q english_private.questions%rowtype;d english_private.answer_drafts%rowtype;v_day date;v_stage integer;v_days integer;v_apply boolean;v_initial boolean;v_duration integer;v_at timestamptz;v_result text;
 intervals integer[]:=array[1,2,4,7,14,30,60,120];
begin
 if not exists(select 1 from english_private.submissions su join english_private.sessions se on se.id=su.session_id where su.id=p_submission_id and su.owner_id=p_owner and se.contract_version='english_v3') then return english_private.commit_submission_v2(p_owner,p_submission_id);end if;
 if p_owner is distinct from english_private.current_owner() then raise exception 'OWNER_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,2));
 select * into s from english_private.submissions where id=p_submission_id and owner_id=p_owner for update;
 if s.id is null then raise exception 'SUBMISSION_NOT_FOUND';end if;
 if s.status='committed' then return jsonb_build_object('ok',true,'submissionId',s.id,'status','committed','idempotent',true);end if;
 if not exists(select 1 from english_private.sessions where id=s.session_id and contract_version='english_v3') then raise exception 'LEGACY_SESSION_READ_ONLY';end if;
 if exists(select 1 from english_private.grade_results where submission_id=s.id and status<>'accepted') then raise exception 'GRADES_NOT_CONFIRMED';end if;
 if (select count(*) from english_private.grade_results where submission_id=s.id)=0 or (select count(*) from english_private.grade_results where submission_id=s.id)<>(select count(*) from english_private.grade_requests where submission_id=s.id) then raise exception 'GRADE_COUNT_MISMATCH';end if;
 for g in select * from english_private.grade_results where submission_id=s.id order by position loop
  select x.* into q from english_private.questions x join english_private.grade_requests r on r.question_id=x.id where r.id=g.grade_request_id;
  select * into p from english_private.phrases where id=q.phrase_id and owner_id=p_owner for update;
  select * into d from english_private.answer_drafts where question_id=q.id and session_id=s.session_id;
  if p.id is null or g.target_outcome is null then raise exception 'INVALID_V2_GRADE';end if;
  v_at:=coalesce(nullif(d.metadata->>'practiceEndedAt','')::timestamptz,(select revealed_at from english_private.question_activity where question_id=q.id),d.created_at);
  v_day:=english_private.learning_date(v_at);
  v_initial:=coalesce((q.metadata->>'isNew')::boolean,false);
  v_apply:=q.metadata->>'phase'='review' and (not coalesce((d.metadata->>'exposed')::boolean,false) or v_initial) and not exists(select 1 from english_private.review_events where owner_id=p_owner and phrase_id=p.id and learning_date=v_day and rule_version in ('english_v2','english_v3') and affects_srs);
  v_stage:=least(p.review_stage,7);
  if v_initial then v_stage:=0;v_days:=1;
  elsif g.target_outcome='not_measured' then v_days:=1;
  elsif g.target_outcome='forgotten' then v_stage:=0;v_days:=1;
  elsif g.target_outcome='partial' then v_stage:=greatest(v_stage-1,0);v_days:=least(intervals[v_stage+1],3);
  elsif g.hint_used or q.question_type='collocation_gap' then v_days:=least(intervals[v_stage+1],3);
  else v_stage:=least(v_stage+1,7);v_days:=intervals[v_stage+1];end if;
  v_result:=case g.target_outcome when 'forgotten' then 'forgotten' when 'partial' then 'difficult' when 'not_measured' then 'normal' else case when g.hint_used then 'difficult' else 'normal' end end;
  if v_apply then
   update english_private.phrases set review_stage=v_stage,next_review_at=((greatest(v_day,english_private.learning_date())+v_days)::timestamp at time zone 'Asia/Shanghai'),
   last_result=v_result,contract_version='english_v3',mastery_streak=case when g.target_outcome='correct' and not g.hint_used and not v_initial and q.question_type<>'collocation_gap' then mastery_streak+1 else 0 end where id=p.id;
  end if;
  v_duration:=(d.metadata->>'activeSeconds')::integer;
  insert into english_private.review_events(owner_id,phrase_id,session_id,grade_result_id,question_position,prompt,expected_answer,user_answer,result,question_type,affects_srs,reviewed_at,contract_version,
  learning_date,rule_version,target_outcome,hint_used,question_fingerprint,meaning_ok,naturalness,duration_seconds,initial_learning,metadata)
  values(p_owner,p.id,s.session_id,g.id,g.position,coalesce(q.prompt_zh,q.prompt_en),g.expected_answer,g.observed_answer,v_result,q.question_type,v_apply,v_at,'english_v3',v_day,'english_v3',g.target_outcome,g.hint_used,
  english_private.sha256_json(jsonb_build_array(q.prompt_zh,q.prompt_en)),g.meaning_ok,g.naturalness,v_duration,v_initial,d.metadata);
  if g.target_outcome in ('partial','forgotten') or g.naturalness<>'natural' then
   insert into english_private.error_events(owner_id,phrase_id,session_id,chunk,error_type,user_answer,correction,explanation,next_action,resolved,occurred_at,contract_version)
   values(p_owner,p.id,s.session_id,p.chunk,coalesce(g.error_category,g.target_outcome),g.observed_answer,g.expected_answer,g.feedback_zh,'依照下一次提取表现调整提示',false,v_at,'english_v3');
  end if;
  update english_private.grade_results set result=v_result,status='committed' where id=g.id;
 end loop;
 update english_private.submissions set status='committed',revision=revision+1,completed_at=now(),updated_at=now() where id=s.id;
 update english_private.sessions set status='committed',completed_at=now(),revision=revision+1 where id=s.session_id;
 update english_private.daily_queues set status='committed',committed_at=now() where id=s.queue_id;
 update english_private.commit_journal set status='committed',last_completed_step='readback',readback_status='verified_complete',result=jsonb_build_object('submissionId',s.id,'answerHash',s.frozen_hash,'ruleVersion','english_v3'),completed_at=now(),updated_at=now() where submission_id=s.id;
 return jsonb_build_object('ok',true,'submissionId',s.id,'status','committed','answerHash',s.frozen_hash);
end $$;

create or replace function english_private.create_ai_job(p_kind text,p_requested_count integer default null,p_subject_id uuid default null,p_idempotency_key text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner();j english_private.ai_jobs%rowtype;q uuid:=p_subject_id;s jsonb;items jsonb;targets jsonb;pos integer;seq integer;theme text;p english_private.phrases%rowtype;cnt integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,2));
 if p_kind='question_prepare' and q is null then q:=(english_private.get_review_bootstrap()->>'queueId')::uuid;end if;
 if p_kind='grade_submission' and q is null then select id into q from english_private.submissions where owner_id=o and status='submitted' order by created_at limit 1;end if;
 if (p_kind='question_prepare' and not exists(select 1 from english_private.daily_queues where id=q and owner_id=o and contract_version='english_v3')) or (p_kind='grade_submission' and not exists(select 1 from english_private.submissions su join english_private.sessions se on se.id=su.session_id where su.id=q and su.owner_id=o and se.contract_version='english_v3')) or p_kind not in ('question_prepare','grade_submission') then return english_private.create_ai_job_v2(p_kind,p_requested_count,p_subject_id,p_idempotency_key);end if;
 if nullif(p_idempotency_key,'') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED';end if;
 select * into j from english_private.ai_jobs where owner_id=o and idempotency_key=p_idempotency_key;
 if j.id is not null and (j.kind<>p_kind or j.subject_id<>q or j.requested_count is distinct from p_requested_count) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 if j.id is null then select * into j from english_private.ai_jobs where owner_id=o and kind=p_kind and subject_id=q and status='prepared';end if;
 if j.id is null then
  if p_kind='question_prepare' then
   if exists(select 1 from english_private.lessons where queue_id=q) then raise exception 'LESSON_ALREADY_PREPARED';end if;
   if not (english_private.rule_v3(o)->>'enabled')::boolean then raise exception 'NEW_LESSONS_PAUSED';end if;
   select coalesce(max(sequence),0)+1 into seq from english_private.lessons where owner_id=o;
   theme:=case when seq%3=0 then 'work' else 'life' end;
   -- Reserve expression tasks once, independently of success thresholds.
   if not exists(select 1 from english_private.daily_queue_items where queue_id=q and selection_type='expression') then
    select coalesce(max(position),0) into pos from english_private.daily_queue_items where queue_id=q;
    cnt:=0;
    for p in select ph.* from english_private.phrases ph where ph.owner_id=o and ph.status in ('active','mastered') and (exists(select 1 from english_private.daily_queue_items i where i.queue_id=q and i.phrase_id=ph.id) or (pos=0 and (ph.status='mastered' or exists(select 1 from english_private.review_events e where e.phrase_id=ph.id)))) order by
      case when (coalesce(ph.topic,'')||' '||ph.chunk) ~* '(coffee|feel|food|health|social|daily|life|schedule|weather|shopping|生活|日常|饮食|健康)' then case when theme='life' then 0 else 1 end else case when theme='work' then 0 else 1 end end,ph.id limit 2
    loop
     cnt:=cnt+1;
     insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,chunk,cue_zh,topic,natural_example,contract_version) values(o,q,pos+cnt,'expression',p.id,p.chunk,p.cue_zh,p.topic,p.natural_example,'english_v3');
    end loop;
    if cnt=0 then raise exception 'NO_LEARNING_MATERIAL';end if;
    if cnt=1 then insert into english_private.daily_queue_items(owner_id,queue_id,position,selection_type,phrase_id,chunk,cue_zh,topic,natural_example,contract_version) select owner_id,queue_id,pos+2,selection_type,phrase_id,chunk,cue_zh,topic,natural_example,contract_version from english_private.daily_queue_items where queue_id=q and selection_type='expression' limit 1;end if;
   end if;
   items:=english_private.question_snapshot_v3(o,q);
   select jsonb_agg(x||jsonb_build_object('phase',case when i.selection_type='expression' then 'expression' else 'review' end,'questionType',case when i.selection_type='expression' then 'post_reading_expression' else x->>'questionType' end,'answerForm',case when i.selection_type='expression' or x->>'questionType' in ('short_expression','transfer_expression') then 'response' when x->>'questionType'='collocation_gap' then 'gap' else 'chunk' end) order by i.position) into items from jsonb_array_elements(items)x join english_private.daily_queue_items i on i.id=(x->>'queueItemId')::uuid;
   select jsonb_agg(distinct phrase_id) into targets from english_private.daily_queue_items where queue_id=q and selection_type='expression';
   s:=jsonb_build_object('ruleVersion','english_v3','sequence',seq,'theme',theme,'targetPhraseIds',targets,'queueRevision',(select revision from english_private.daily_queues where id=q),'items',items);
  else
   if not exists(select 1 from english_private.submissions where id=q and owner_id=o and status in ('submitted','grading')) then raise exception 'SUBMISSION_NOT_READY';end if;
   select jsonb_build_object('ruleVersion','english_v3','items',jsonb_agg(jsonb_build_object('requestId',g.id,'position',g.position,'observedAnswer',g.observed_answer,'answerHash',g.answer_hash,'chunk',ph.chunk,'promptZh',g.prompt_zh,'promptEn',g.prompt_en,'expectedAnswers',g.expected_answers,'acceptedVariants',g.accepted_variants,'semanticBoundary',g.semantic_boundary,'gradingRubric',g.grading_rubric,'questionType',qu.question_type,'hintUsed',(dr.metadata->>'hintUsed')::boolean,'attemptState',dr.metadata->>'attemptState','answerForm',qu.metadata->>'answerForm','phase',qu.metadata->>'phase','exposed',dr.metadata->'exposed') order by g.position)) into s
   from english_private.grade_requests g join english_private.questions qu on qu.id=g.question_id join english_private.phrases ph on ph.id=g.phrase_id join english_private.answer_drafts dr on dr.question_id=qu.id where g.submission_id=q and g.owner_id=o and g.request_status='ready';
  end if;
  if jsonb_array_length(s->'items') is null or jsonb_array_length(s->'items')=0 then raise exception 'AI_JOB_EMPTY';end if;
  insert into english_private.ai_jobs(owner_id,kind,subject_id,requested_count,expected_count,input_snapshot,snapshot_hash,idempotency_key) values(o,p_kind,q,p_requested_count,jsonb_array_length(s->'items'),s,english_private.sha256_json(s),p_idempotency_key) returning * into j;
 end if;
 return jsonb_build_object('ok',true,'jobId',j.id,'kind',j.kind,'subjectId',j.subject_id,'snapshotHash',j.snapshot_hash,'batchId',j.batch_id,'expectedCount',j.expected_count,'status',j.status);
end $$;

create or replace function english_private.get_ai_job_prompt(p_job_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner();j english_private.ai_jobs%rowtype;r jsonb;extra text;shape jsonb;
begin
 select * into j from english_private.ai_jobs where owner_id=o and id=p_job_id;if j.id is null then raise exception 'AI_JOB_NOT_FOUND';end if;
 r:=english_private.get_ai_job_prompt_v2(p_job_id);
 if j.input_snapshot->>'ruleVersion'<>'english_v3' then return r;end if;
 if j.kind='question_prepare' then
  extra:=$p$本任务使用 english_v3，覆盖旧版题型说明。返回完整学习包；items精确覆盖snapshot.items，逐项回显queueItemId/position/questionType/phase/answerForm。每项一个目标义项。phase=review：独立复习；phase=expression：读后的两次回应，第一项回复文中人物，第二项转到相近个人场景。每次1–2句，接受合理替代表达。不得写“使用某英语词块”泄露答案。answerForm=gap只填指定空格、chunk填完整词块、response写完整回应，promptZh必须明确，评分遵守这一形式，不因片段不是完整句扣自然度。semanticBoundary/gradingRubric仅供批改，绝不混入公开任务。先学习的新项才有learningCard；按需hints逐级支持。材料自查：目标线索泄露、语义重复、近期原题重复、跨题泄露、自然性、评分一致性；不合格重写。不得根据旧SRS阶段推定表达能力。
额外返回material对象：title、kind(dialogue/passage)、body(120–180英文词)、explanationZh(简短中文内容说明)、targetPhraseIds(原样回显snapshot.targetPhraseIds)、notes数组(每个目标一项，phraseId/explanationZh)。围绕snapshot.theme自然组织内容；life以生活为主，work兼顾工作。自然使用目标，不硬塞全部复习词，不编造原文引用。不生成额外生词入库。文章不计入expectedCount。先复习、后展示材料；表达任务已曝光，不能当独立提取。$p$;
  shape:=jsonb_build_object('material',jsonb_build_object('title','标题','kind','dialogue','body','120–180 words','explanationZh','中文内容说明','targetPhraseIds',j.input_snapshot->'targetPhraseIds','notes',jsonb_build_array(jsonb_build_object('phraseId','目标 UUID','explanationZh','义项与自然搭配'))));
 else
  extra:=$p$本任务使用 english_v3。冻结snapshot中的phase/answerForm/attemptState/exposed/hintUsed是事实，不可推断或覆盖。dont_know为空答案且明确尝试不会，targetOutcome必须forgotten；skipped不在批改请求内。gap按填空形式、chunk按词块形式评价，不以缺少主语或句号判不自然；response按实际沟通目的。合理同义表达meaningOk=true且targetOutcome=not_measured，不是遗忘。仅填写反馈，禁止计算SRS或宣称读后成功等于独立掌握。最多一处关键修改加一个自然例句。$p$;shape:='{}'::jsonb;
 end if;
 return r||jsonb_build_object('snapshot',j.input_snapshot,'prompt',replace(r->>'prompt','english_v2','english_v3')||E'\n优先执行以下v3合同：\n'||extra||E'\n附加顶层字段：'||shape::text);
end $$;

create or replace function english_private.import_ai_result(p_job_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
#variable_conflict use_column
declare o uuid:=english_private.current_owner();j english_private.ai_jobs%rowtype;x jsonb;v_snapshot jsonb;g english_private.grade_requests%rowtype;i english_private.daily_queue_items%rowtype;
 n integer;v_pos integer;v_hash text; ss uuid; mat jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,2));
 select * into j from english_private.ai_jobs where id=p_job_id and owner_id=o for update;
 if j.id is null then raise exception 'AI_JOB_NOT_FOUND';end if;
 if j.input_snapshot->>'ruleVersion'<>'english_v3' then return english_private.import_ai_result_v2(p_job_id,p_payload);end if;
 if j.status='consumed' and j.output_payload=p_payload then return jsonb_build_object('ok',true,'jobId',j.id,'status','consumed','actualCount',jsonb_array_length(j.output_payload->'items'),'idempotent',true);end if;
 if j.status<>'prepared' then raise exception 'AI_JOB_CLOSED';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'INVALID_AI_PAYLOAD';end if;
 if p_payload->>'jobId' is distinct from j.id::text or p_payload->>'batchId' is distinct from j.batch_id::text or p_payload->>'snapshotHash' is distinct from j.snapshot_hash or p_payload->>'ruleVersion' is distinct from 'english_v3' then raise exception 'AI_SNAPSHOT_MISMATCH';end if;
 if english_private.required_text(p_payload,'modelId',200) is not true or jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'INVALID_AI_PAYLOAD';end if;
 n:=jsonb_array_length(p_payload->'items');
 if (j.kind in ('question_prepare','grade_submission') and n<>j.expected_count) or (j.kind in ('context_extract','candidate_generate') and n>j.expected_count) then raise exception 'AI_ITEM_COUNT_MISMATCH';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'items') z where jsonb_typeof(z) is distinct from 'object' or coalesce(z->>'position','') !~ '^[1-9][0-9]{0,2}$') then raise exception 'INVALID_AI_POSITION';end if;
 if (select count(distinct z->>'position') from jsonb_array_elements(p_payload->'items') z)<>n then raise exception 'DUPLICATE_AI_POSITION';end if;
 if j.kind='question_prepare' then
  mat:=p_payload->'material';
  if jsonb_typeof(mat) is distinct from 'object' or english_private.required_text(mat,'title') is not true or english_private.required_text(mat,'body',6000) is not true or english_private.required_text(mat,'explanationZh') is not true or coalesce(mat->>'kind','') not in ('dialogue','passage') or mat->'targetPhraseIds' is distinct from j.input_snapshot->'targetPhraseIds' or jsonb_typeof(mat->'notes') is distinct from 'array' then raise exception 'INVALID_LESSON_MATERIAL';end if;
  if cardinality(regexp_split_to_array(trim(mat->>'body'),'\s+')) not between 120 and 180 then raise exception 'MATERIAL_WORD_COUNT';end if;
  if jsonb_array_length(mat->'notes')<>jsonb_array_length(mat->'targetPhraseIds') or (select count(distinct z->>'phraseId') from jsonb_array_elements(mat->'notes')z)<>jsonb_array_length(mat->'notes') or exists(select 1 from jsonb_array_elements(mat->'notes')z where not (mat->'targetPhraseIds' ? (z->>'phraseId')) or english_private.required_text(z,'explanationZh') is not true) then raise exception 'INVALID_MATERIAL_NOTES';end if;
  if (select revision from english_private.daily_queues where id=j.subject_id and owner_id=o) is distinct from (j.input_snapshot->>'queueRevision')::integer then raise exception 'AI_QUEUE_CHANGED';end if;
  if exists(select 1 from english_private.sessions where queue_id=j.subject_id and status<>'open') then raise exception 'SESSION_FROZEN';end if;
 elsif j.kind='grade_submission' then
  if not exists(select 1 from english_private.submissions where id=j.subject_id and owner_id=o and status in ('submitted','grading')) then raise exception 'SUBMISSION_NOT_READY';end if;
 end if;
 for x in select value from jsonb_array_elements(p_payload->'items') loop
  v_pos:=(x->>'position')::integer;
  if j.kind='question_prepare' then
   select value into v_snapshot from jsonb_array_elements(j.input_snapshot->'items') where value->>'queueItemId'=x->>'queueItemId' and (value->>'position')::integer=v_pos;
   if v_snapshot is null then raise exception 'QUESTION_SNAPSHOT_ECHO_MISMATCH';end if;
   select * into i from english_private.daily_queue_items where id=(x->>'queueItemId')::uuid and queue_id=j.subject_id and owner_id=o;
   if x->>'phase' is distinct from v_snapshot->>'phase' or x->>'answerForm' is distinct from v_snapshot->>'answerForm' then raise exception 'QUESTION_PHASE_MISMATCH';end if;
   if i.id is null or x->>'questionType' is distinct from v_snapshot->>'questionType' then raise exception 'INVALID_QUESTION_TYPE';end if;
   if english_private.required_text(x,'trainingGoal') is not true or english_private.required_text(x,'promptZh') is not true
    or english_private.valid_strings(x->'expectedAnswers',1,12) is not true or english_private.valid_strings(x->'acceptedVariants',0,12) is not true
    or english_private.valid_strings(x->'hints',0,3) is not true or english_private.required_text(x,'semanticBoundary') is not true
    or english_private.required_text(x,'gradingRubric') is not true then raise exception 'INVALID_QUESTION';end if;
   if x ? 'promptEn' and jsonb_typeof(x->'promptEn') not in ('string','null') then raise exception 'INVALID_QUESTION';end if;
   if length(i.chunk)>2 and strpos(lower(coalesce(x->>'promptZh','')||' '||coalesce(x->>'promptEn','')),lower(i.chunk))>0 then raise exception 'QUESTION_LEAKS_TARGET';end if;
   if x->>'phase'='review' and exists(select 1 from jsonb_array_elements(j.input_snapshot->'items') t where t->>'phase'='review' and length(t->>'chunk')>2 and strpos(lower(coalesce(x->>'promptZh','')||' '||coalesce(x->>'promptEn','')),lower(t->>'chunk'))>0) then raise exception 'QUESTION_LEAKS_TARGET';end if;
   if x->>'answerForm'='gap' and exists(select 1 from jsonb_array_elements_text(x->'expectedAnswers') ans where strpos(' '||regexp_replace(lower(coalesce(x->>'promptZh','')||' '||coalesce(x->>'promptEn','')),'[^a-z0-9]+',' ','g')||' ',' '||lower(ans)||' ')>0) then raise exception 'QUESTION_LEAKS_TARGET';end if;
   if exists(select 1 from english_private.questions qq where qq.phrase_id=i.phrase_id and qq.contract_version='english_v3' and qq.prompt_zh=x->>'promptZh' and coalesce(qq.prompt_en,'')=coalesce(x->>'promptEn','') and qq.created_at>now()-interval '90 days') then raise exception 'QUESTION_REPEATS_RECENT_PROMPT';end if;
   if (v_snapshot->>'isNew')::boolean then
    if jsonb_typeof(x->'learningCard') is distinct from 'object' or english_private.required_text(x->'learningCard','meaningZh') is not true or english_private.required_text(x->'learningCard','example') is not true or english_private.required_text(x->'learningCard','usageNote') is not true then raise exception 'LEARNING_CARD_REQUIRED';end if;
   elsif x->'learningCard' is not null and x->'learningCard'<>'null'::jsonb then raise exception 'UNEXPECTED_LEARNING_CARD';end if;
  elsif j.kind='grade_submission' then
   select value into v_snapshot from jsonb_array_elements(j.input_snapshot->'items') where value->>'requestId'=x->>'requestId' and (value->>'position')::integer=v_pos;
   if v_snapshot is null then raise exception 'GRADE_REQUEST_ECHO_MISMATCH';end if;
   select * into g from english_private.grade_requests where id=(x->>'requestId')::uuid and submission_id=j.subject_id and owner_id=o and request_status='ready';
   if g.id is null or x->>'observedAnswer' is distinct from g.observed_answer or x->>'answerHash' is distinct from g.answer_hash then raise exception 'GRADE_REQUEST_ECHO_MISMATCH';end if;
   if coalesce(x->>'result','') not in ('forgotten','difficult','normal','mastered') or coalesce(x->>'targetOutcome','') not in ('correct','partial','forgotten','not_measured')
    or jsonb_typeof(x->'meaningOk') is distinct from 'boolean' or coalesce(x->>'naturalness','') not in ('natural','minor_issue','major_issue')
    or jsonb_typeof(x->'hintUsed') is distinct from 'boolean' or x->'hintUsed' is distinct from v_snapshot->'hintUsed'
    or jsonb_typeof(x->'confidence') is distinct from 'number' then raise exception 'INVALID_GRADE_RESULT';end if;
   if (x->>'confidence')::numeric not between 0 and 1 or english_private.required_text(x,'feedbackZh') is not true or english_private.required_text(x,'evidence') is not true or english_private.required_text(x,'expectedAnswer') is not true then raise exception 'INVALID_GRADE_RESULT';end if;
   if v_snapshot->>'attemptState'='dont_know' and x->>'targetOutcome'<>'forgotten' then raise exception 'INVALID_DONT_KNOW_GRADE';end if;
   if x->>'targetOutcome'='not_measured' and not (x->>'meaningOk')::boolean then raise exception 'INVALID_NOT_MEASURED';end if;
   if x ? 'extraPractice' and jsonb_typeof(x->'extraPractice') is distinct from 'array' then raise exception 'INVALID_EXTRA_PRACTICE';end if;
  else
   if v_pos>n or english_private.required_text(x,'candidate',300) is not true or english_private.required_text(x,'cueZh') is not true or english_private.required_text(x,'whyUseful') is not true or english_private.required_text(x,'naturalExample') is not true then raise exception 'INVALID_CANDIDATE';end if;
   if jsonb_typeof(x->'confidence') is distinct from 'number' or (x->>'confidence')::numeric not between 0 and 1 then raise exception 'INVALID_CONFIDENCE';end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'items') zz where lower(trim(zz->>'candidate'))=lower(trim(x->>'candidate')) and (zz->>'position')::integer<>v_pos) then raise exception 'DUPLICATE_CANDIDATE';end if;
   if j.kind='context_extract' then
    if x->>'contextId' is distinct from j.subject_id::text or english_private.required_text(x,'selectedText') is not true or strpos(j.input_snapshot->>'rawText',x->>'selectedText')=0 then raise exception 'CONTEXT_ECHO_MISMATCH';end if;
   end if;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(p_payload->'items') loop
  if j.kind='question_prepare' then
   select value into v_snapshot from jsonb_array_elements(j.input_snapshot->'items') where value->>'queueItemId'=x->>'queueItemId';
   v_hash:=english_private.sha256_json(x);
   insert into english_private.questions(owner_id,queue_id,queue_item_id,session_id,position,phrase_id,candidate_id,question_type,prompt_zh,prompt_en,expected_answers,accepted_variants,semantic_boundary,grading_rubric,generation_id,model_id,prompt_version,content_hash,contract_version,metadata)
   select o,i.queue_id,i.id,(select id from english_private.sessions where queue_id=i.queue_id),i.position,i.phrase_id,i.candidate_id,x->>'questionType',x->>'promptZh',x->>'promptEn',x->'expectedAnswers',x->'acceptedVariants',x->>'semanticBoundary',x->>'gradingRubric',j.id::text,p_payload->>'modelId','english_v3',v_hash,'english_v3',
   jsonb_build_object('trainingGoal',x->>'trainingGoal','hints',x->'hints','learningCard',x->'learningCard','isNew',(v_snapshot->>'isNew')::boolean,'phase',v_snapshot->>'phase','answerForm',v_snapshot->>'answerForm')
   from english_private.daily_queue_items i where i.id=(x->>'queueItemId')::uuid;
  elsif j.kind='grade_submission' then
   select * into g from english_private.grade_requests where id=(x->>'requestId')::uuid;
   insert into english_private.grade_results(owner_id,submission_id,grade_request_id,position,result,feedback_zh,error_category,confidence,evidence,expected_answer,observed_answer,extra_practice,grading_batch_id,prompt_version,status,contract_version,target_outcome,meaning_ok,naturalness,hint_used)
   values(o,g.submission_id,g.id,g.position,case x->>'targetOutcome' when 'forgotten' then 'forgotten' when 'partial' then 'difficult' when 'not_measured' then 'normal' else case when (x->>'hintUsed')::boolean then 'difficult' else 'normal' end end,x->>'feedbackZh',x->>'errorCategory',(x->>'confidence')::numeric,x->>'evidence',x->>'expectedAnswer',g.observed_answer,coalesce(x->'extraPractice','[]'::jsonb),j.batch_id::text,'english_v3','needs_confirmation','english_v3',x->>'targetOutcome',(x->>'meaningOk')::boolean,x->>'naturalness',(x->>'hintUsed')::boolean);
   insert into english_private.grade_result_attempts(owner_id,submission_id,position,phrase_id,candidate_id,answer_hash,result,feedback_zh,error_category,confidence,evidence,expected_answer,observed_answer,extra_practice,grading_batch_id,prompt_version,grade_status,contract_version,created_at)
   values(o,g.submission_id,g.position,g.phrase_id,g.candidate_id,g.answer_hash,x->>'result',x->>'feedbackZh',x->>'errorCategory',(x->>'confidence')::numeric,x->>'evidence',x->>'expectedAnswer',g.observed_answer,coalesce(x->'extraPractice','[]'::jsonb),j.batch_id::text,'english_v3','needs_confirmation','english_v3',now());
   update english_private.grade_result_attempts set metadata=x where submission_id=g.submission_id and position=g.position and grading_batch_id=j.batch_id::text;
   update english_private.grade_requests set request_status='graded' where id=g.id;
  elsif j.kind='context_extract' then
   insert into english_private.context_candidates(owner_id,context_id,position,selected_text,candidate,cue_zh,candidate_type,context_meaning,why_useful,topic,difficulty,natural_example,common_mistake,confidence,processing_batch_id,contract_version)
   values(o,j.subject_id,(x->>'position')::integer,x->>'selectedText',x->>'candidate',x->>'cueZh',x->>'candidateType',x->>'contextMeaning',x->>'whyUseful',x->>'topic',x->>'difficulty',x->>'naturalExample',x->>'commonMistake',(x->>'confidence')::numeric,j.batch_id::text,'english_v3');
  else
   insert into english_private.candidate_generation_rows(owner_id,request_id,requested_count,position,candidate,cue_zh,candidate_type,why_useful,topic,difficulty,natural_example,common_mistake,generation_batch_id,model_id,status,contract_version)
   values(o,j.id::text,j.expected_count,(x->>'position')::integer,x->>'candidate',x->>'cueZh',x->>'candidateType',x->>'whyUseful',x->>'topic',x->>'difficulty',x->>'naturalExample',x->>'commonMistake',j.batch_id::text,p_payload->>'modelId','staged','english_v3');
  end if;
 end loop;
 if j.kind='question_prepare' then
  insert into english_private.sessions(owner_id,queue_id,learning_date,max_questions,status,started_at,contract_version) select o,j.subject_id,queue_date,n,'open',now(),'english_v3' from english_private.daily_queues where id=j.subject_id returning id into ss;
  update english_private.questions set session_id=ss,bound_at=now() where queue_id=j.subject_id;
  insert into english_private.lessons(owner_id,queue_id,session_id,sequence,theme,material) values(o,j.subject_id,ss,(j.input_snapshot->>'sequence')::integer,j.input_snapshot->>'theme',mat);
 end if;
 if j.kind='context_extract' then update english_private.contexts set status=case when n=0 then 'completed' else 'review' end,processed_at=now() where id=j.subject_id;end if;
 if j.kind='grade_submission' then
  update english_private.submissions set status='needs_confirmation',revision=revision+1,updated_at=now() where id=j.subject_id;
  update english_private.sessions set status='needs_confirmation' where id=(select session_id from english_private.submissions where id=j.subject_id);
 end if;
 update english_private.ai_jobs set status='consumed',model_id=p_payload->>'modelId',output_payload=p_payload,imported_at=now(),validated_at=now(),consumed_at=now() where id=j.id;
 return jsonb_build_object('ok',true,'jobId',j.id,'status','consumed','actualCount',n);
end $$;


create or replace function english_private.get_dashboard() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner();r jsonb;v jsonb;d date:=english_private.learning_date();backlog integer;
begin
 r:=english_private.get_dashboard_v2();
 select count(*) into backlog from english_private.phrases where owner_id=o and status in ('active','mastered') and next_review_at<((d+1)::timestamp at time zone 'Asia/Shanghai');
 with days as(select generate_series(d-13,d,interval '1 day')::date learning_day), data as (
 select days.learning_day,
 count(e.id) filter(where e.metadata->>'phase'='review' and e.question_type not in ('collocation_gap','contextual_gap') and not e.initial_learning and not coalesce((e.metadata->>'exposed')::boolean,false) and e.target_outcome<>'not_measured') independent_attempts,
 count(e.id) filter(where e.metadata->>'phase'='review' and e.question_type not in ('collocation_gap','contextual_gap') and not e.initial_learning and not coalesce((e.metadata->>'exposed')::boolean,false) and not e.hint_used and e.target_outcome='correct') independent_success,
 count(e.id) filter(where e.hint_used) hinted,
 count(e.id) attempts,
 count(e.id) filter(where e.question_type='collocation_gap') gap_attempts,
 count(e.id) filter(where e.question_type='collocation_gap' and e.target_outcome='correct') gap_success,
 count(e.id) filter(where e.metadata->>'phase'='expression') expression_attempts,
 count(e.id) filter(where e.metadata->>'phase'='expression' and e.meaning_ok and e.naturalness<>'major_issue') expression_success,
 count(e.id) filter(where e.target_outcome='not_measured') unmeasured,
 count(e.id) filter(where e.metadata->>'phase'='review' and not e.initial_learning and not coalesce((e.metadata->>'exposed')::boolean,false) and e.question_type not in ('collocation_gap','contextual_gap') and e.target_outcome<>'not_measured' and exists(select 1 from english_private.lesson_exposures ex where ex.owner_id=o and ex.phrase_id=e.phrase_id and ex.source='reading' and ex.learning_date<e.learning_date)) delayed_attempts,
 count(e.id) filter(where e.metadata->>'phase'='review' and not e.initial_learning and not coalesce((e.metadata->>'exposed')::boolean,false) and e.question_type not in ('collocation_gap','contextual_gap') and e.target_outcome='correct' and not e.hint_used and exists(select 1 from english_private.lesson_exposures ex where ex.owner_id=o and ex.phrase_id=e.phrase_id and ex.source='reading' and ex.learning_date<e.learning_date)) delayed_success
 from days left join english_private.review_events e on e.owner_id=o and e.rule_version='english_v3' and e.learning_date=days.learning_day group by days.learning_day)
 select jsonb_build_object('completedLessons',(select count(*) from english_private.lessons l join english_private.sessions s on s.id=l.session_id where l.owner_id=o and s.status='committed' and l.reading_completed_at is not null and (select count(*) from english_private.review_events e where e.session_id=s.id and e.metadata->>'phase'='expression')=2),
 'dueCount',backlog,'days',jsonb_agg(jsonb_build_object('date',learning_day,'independentAttempts',independent_attempts,'independentSuccess',independent_success,'hinted',hinted,'attempts',attempts,'gapAttempts',gap_attempts,'gapSuccess',gap_success,'expressionAttempts',expression_attempts,'expressionSuccess',expression_success,'unmeasured',unmeasured,'delayedAttempts',delayed_attempts,'delayedSuccess',delayed_success,
 'durationMinutes',(select round(sum(coalesce((ad.metadata->>'activeSeconds')::integer,0))/60.0,1) from english_private.answer_drafts ad join english_private.sessions s on s.id=ad.session_id where s.owner_id=o and s.contract_version='english_v3' and s.status='committed' and s.learning_date=data.learning_day)+(select coalesce(round(sum(l.active_reading_seconds)/60.0,1),0) from english_private.lessons l join english_private.sessions s on s.id=l.session_id where l.owner_id=o and s.status='committed' and s.learning_date=data.learning_day)) order by learning_day),
 'burden',(select coalesce(jsonb_agg(jsonb_build_object('date',s.learning_date,'value',l.burden)),'[]'::jsonb) from english_private.lessons l join english_private.sessions s on s.id=l.session_id where l.owner_id=o and l.burden is not null and s.learning_date>=d-13)) into v from data;
 r:=r||jsonb_build_object('v3',v);
 r:=jsonb_set(r,'{analytics,legacyReviews}',to_jsonb((select count(*) from english_private.review_events where owner_id=o and rule_version not in ('english_v2','english_v3'))));
 if exists(select 1 from english_private.daily_queues where owner_id=o and queue_date=d and contract_version='english_v3') then
 r:=jsonb_set(r,'{today}',jsonb_build_object('planned',(select count(*) from english_private.questions q join english_private.daily_queues dq on dq.id=q.queue_id where dq.owner_id=o and dq.queue_date=d and dq.contract_version='english_v3'),
 'completed',(select count(*) from english_private.review_events where owner_id=o and learning_date=d and rule_version='english_v3'),
 'waitingForGrading',(select count(*) from english_private.submissions su join english_private.sessions s on s.id=su.session_id where su.owner_id=o and s.contract_version='english_v3' and su.status in ('submitted','grading','needs_confirmation'))));end if;
 return r;
end $$;
alter function english_private.get_submission_status(uuid) rename to get_submission_status_v2;
create function english_private.get_submission_status(p_submission_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner();r jsonb;s english_private.sessions%rowtype;l english_private.lessons%rowtype;
begin
 r:=english_private.get_submission_status_v2(p_submission_id);
 select se.* into s from english_private.sessions se join english_private.submissions su on su.session_id=se.id where su.id=p_submission_id and su.owner_id=o;
 if s.contract_version='english_v3' then
  select * into l from english_private.lessons where session_id=s.id;
  r:=r||jsonb_build_object('ruleVersion','english_v3','sessionId',s.id,'lessonSummary',jsonb_build_object('title',l.material->>'title','expressions',(select jsonb_agg(p.chunk order by p.id) from english_private.phrases p where p.id::text in(select jsonb_array_elements_text(l.material->'targetPhraseIds'))),'burden',l.burden,'readingCompleted',l.reading_completed_at is not null,'skipped',(select count(*) from english_private.answer_drafts where session_id=s.id and metadata->>'attemptState'='skipped'),'nextFocus','下次先独立回忆；需要提示或局部填对的表达会更早回来。读后表达不提升复习阶段。'));
 end if;return r;
end $$;
create or replace function english_api.get_submission_status(p_submission_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,pg_temp as $$ select english_private.get_submission_status(p_submission_id) $$;
grant execute on function english_private.get_submission_status(uuid) to authenticated;


do $security$
declare f record; params text;
begin
 for f in select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) identities,pg_get_function_arguments(p.oid) arguments,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='english_private' and p.proname in ('get_review_bootstrap','create_ai_job','get_ai_job_prompt','import_ai_result','checkpoint_answers','submit_session','get_dashboard','set_question_count','set_learning_settings','record_lesson_activity') loop
 execute format('alter function english_private.%I(%s) security definer',f.proname,f.identities);
 select coalesce(string_agg(format('%I',a),', '),'') into params from unnest(f.proargnames) a;
 execute format('create or replace function english_api.%I(%s) returns jsonb language sql security invoker set search_path=pg_catalog,pg_temp as %L',f.proname,f.arguments,format('select english_private.%I(%s)',f.proname,params));
 execute format('revoke all on function english_api.%I(%s) from public,anon',f.proname,f.identities);
 execute format('grant execute on function english_api.%I(%s) to authenticated',f.proname,f.identities);
 execute format('grant execute on function english_private.%I(%s) to authenticated',f.proname,f.identities);
 end loop;
end $security$;
-- Newly created private helpers must not inherit Supabase default grants.
revoke all on all functions in schema english_private from public,anon,authenticated;
do $grants$
declare f record;
begin
 for f in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='english_api' loop
 execute format('grant execute on function english_private.%I(%s) to authenticated',f.proname,f.args);
 end loop;
end $grants$;
notify pgrst,'reload schema';
commit;
