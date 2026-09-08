begin;
-- Today is the current due workload. Earlier dates retain their recorded observation.
-- Keep the existing invoker RPC wrapper and its owner-checked private implementation.
create or replace function english_private.get_dashboard() returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with o as(select english_private.current_owner() id),today as(select english_private.learning_date() d),days as(select generate_series((select d from today)-13,(select d from today),interval '1 day')::date d),
 analytics as(select days.d,
 (select round(sum(e.duration_seconds)/60.0,1) from english_private.review_events e,o where e.owner_id=o.id and e.rule_version='english_v2' and e.learning_date=days.d) duration,
 (select count(*) from english_private.review_events e,o where e.owner_id=o.id and e.rule_version='english_v2' and e.learning_date=days.d and not e.hint_used and not e.initial_learning and e.target_outcome='correct') independent_success,
 (select count(*) from english_private.review_events e,o where e.owner_id=o.id and e.rule_version='english_v2' and e.learning_date=days.d and not e.hint_used and not e.initial_learning and e.target_outcome<>'not_measured') independent_attempts,
 (select count(*) from english_private.review_events e,o where e.owner_id=o.id and e.rule_version='english_v2' and e.learning_date=days.d and e.question_type in ('short_expression','transfer_expression') and e.meaning_ok and e.naturalness<>'major_issue') expression_success,
 (select count(*) from english_private.review_events e,o where e.owner_id=o.id and e.rule_version='english_v2' and e.learning_date=days.d and e.question_type in ('short_expression','transfer_expression')) expression_attempts,
 case when days.d=(select d from today) then
  (select count(*) from english_private.phrases p,o where p.owner_id=o.id and p.status='active'
   and p.next_review_at < ((days.d+1)::timestamp at time zone 'Asia/Shanghai'))
 else (select backlog from english_private.daily_observations b,o where b.owner_id=o.id and b.learning_date=days.d)
 end backlog from days)
 select jsonb_build_object('ok',true,'learningDate',today.d,'today',jsonb_build_object(
 'planned',(select count(*) from english_private.daily_queue_items i join english_private.daily_queues q on q.id=i.queue_id,o where q.owner_id=o.id and q.queue_date=today.d and q.contract_version='english_v2'),
 'completed',(select count(*) from english_private.review_events e,o where e.owner_id=o.id and e.learning_date=today.d and e.rule_version='english_v2' and e.affects_srs),
 'waitingForGrading',(select count(*) from english_private.submissions s join english_private.sessions ss on ss.id=s.session_id,o where s.owner_id=o.id and ss.contract_version='english_v2' and s.status in ('submitted','grading','needs_confirmation'))),
 'totals',jsonb_build_object('phrases',(select count(*) from english_private.phrases,o where owner_id=o.id),'reviews',(select count(*) from english_private.review_events,o where owner_id=o.id and affects_srs),
 'accuracy',coalesce((select round(100.0*count(*) filter(where result in ('normal','mastered'))/nullif(count(*),0),1) from english_private.review_events,o where owner_id=o.id and affects_srs),0)),
 'analytics',jsonb_build_object('ruleVersion','english_v2','legacyReviews',(select count(*) from english_private.review_events,o where owner_id=o.id and rule_version is distinct from 'english_v2'),
 'days',(select jsonb_agg(jsonb_build_object('date',d,'durationMinutes',duration,'independentSuccess',independent_success,'independentAttempts',independent_attempts,'expressionSuccess',expression_success,'expressionAttempts',expression_attempts,'backlog',backlog) order by d) from analytics))) from today
$$;
commit;
