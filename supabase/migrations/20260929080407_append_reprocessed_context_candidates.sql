-- Preserve existing decisions when a previously imported context is processed again.
-- Payload positions remain 1..n; stored positions continue after the existing maximum.
create or replace function english_private.import_ai_result_v2(p_job_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
#variable_conflict use_column
declare o uuid:=english_private.current_owner();j english_private.ai_jobs%rowtype;x jsonb;v_snapshot jsonb;g english_private.grade_requests%rowtype;i english_private.daily_queue_items%rowtype;
 n integer;v_pos integer;v_hash text;v_context_position_offset integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(o::text,2));
 select * into j from english_private.ai_jobs where id=p_job_id and owner_id=o for update;
 if j.id is null then raise exception 'AI_JOB_NOT_FOUND';end if;
 if j.status='consumed' and j.output_payload=p_payload then return jsonb_build_object('ok',true,'jobId',j.id,'status','consumed','actualCount',jsonb_array_length(j.output_payload->'items'),'idempotent',true);end if;
 if j.status<>'prepared' then raise exception 'AI_JOB_CLOSED';end if;
 if j.kind='context_extract' then
  select coalesce(max(position),0) into v_context_position_offset
  from english_private.context_candidates where owner_id=o and context_id=j.subject_id;
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'INVALID_AI_PAYLOAD';end if;
 if p_payload->>'jobId' is distinct from j.id::text or p_payload->>'batchId' is distinct from j.batch_id::text or p_payload->>'snapshotHash' is distinct from j.snapshot_hash or p_payload->>'ruleVersion' is distinct from 'english_v2' then raise exception 'AI_SNAPSHOT_MISMATCH';end if;
 if english_private.required_text(p_payload,'modelId',200) is not true or jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'INVALID_AI_PAYLOAD';end if;
 n:=jsonb_array_length(p_payload->'items');
 if (j.kind in ('question_prepare','grade_submission') and n<>j.expected_count) or (j.kind in ('context_extract','candidate_generate') and n>j.expected_count) then raise exception 'AI_ITEM_COUNT_MISMATCH';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'items') z where jsonb_typeof(z) is distinct from 'object' or coalesce(z->>'position','') !~ '^[1-9][0-9]{0,2}$') then raise exception 'INVALID_AI_POSITION';end if;
 if (select count(distinct z->>'position') from jsonb_array_elements(p_payload->'items') z)<>n then raise exception 'DUPLICATE_AI_POSITION';end if;
 if j.kind='question_prepare' then
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
   if i.id is null or x->>'questionType' is distinct from v_snapshot->>'questionType' then raise exception 'INVALID_QUESTION_TYPE';end if;
   if english_private.required_text(x,'trainingGoal') is not true or english_private.required_text(x,'promptZh') is not true
    or english_private.valid_strings(x->'expectedAnswers',1,12) is not true or english_private.valid_strings(x->'acceptedVariants',0,12) is not true
    or english_private.valid_strings(x->'hints',0,3) is not true or english_private.required_text(x,'semanticBoundary') is not true
    or english_private.required_text(x,'gradingRubric') is not true then raise exception 'INVALID_QUESTION';end if;
   if x ? 'promptEn' and jsonb_typeof(x->'promptEn') not in ('string','null') then raise exception 'INVALID_QUESTION';end if;
   if length(i.chunk)>2 and strpos(lower(coalesce(x->>'promptZh','')||' '||coalesce(x->>'promptEn','')),lower(i.chunk))>0 then raise exception 'QUESTION_LEAKS_TARGET';end if;
   if exists(select 1 from english_private.questions qq where qq.phrase_id=i.phrase_id and qq.contract_version='english_v2' and qq.prompt_zh=x->>'promptZh' and coalesce(qq.prompt_en,'')=coalesce(x->>'promptEn','') and qq.created_at>now()-interval '90 days') then raise exception 'QUESTION_REPEATS_RECENT_PROMPT';end if;
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
   if x->>'targetOutcome'='not_measured' and not (x->>'meaningOk')::boolean then raise exception 'INVALID_NOT_MEASURED';end if;
   if x ? 'extraPractice' and jsonb_typeof(x->'extraPractice') is distinct from 'array' then raise exception 'INVALID_EXTRA_PRACTICE';end if;
  else
   if v_pos>n or english_private.required_text(x,'candidate',300) is not true or english_private.required_text(x,'cueZh') is not true or english_private.required_text(x,'whyUseful') is not true or english_private.required_text(x,'naturalExample') is not true then raise exception 'INVALID_CANDIDATE';end if;
   if jsonb_typeof(x->'confidence') is distinct from 'number' or (x->>'confidence')::numeric not between 0 and 1 then raise exception 'INVALID_CONFIDENCE';end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'items') zz where lower(trim(zz->>'candidate'))=lower(trim(x->>'candidate')) and (zz->>'position')::integer<>v_pos) then raise exception 'DUPLICATE_CANDIDATE';end if;
   if j.kind='context_extract' then
    if x->>'contextId' is distinct from j.subject_id::text or english_private.required_text(x,'selectedText') is not true or strpos(j.input_snapshot->>'rawText',x->>'selectedText')=0 then raise exception 'CONTEXT_ECHO_MISMATCH';end if;
    if exists(select 1 from english_private.context_candidates old
      where old.owner_id=o and old.context_id=j.subject_id
        and lower(trim(old.candidate))=lower(trim(x->>'candidate')))
    then raise exception 'CONTEXT_CANDIDATE_ALREADY_EXISTS';end if;
   end if;
  end if;
 end loop;
 for x in select value from jsonb_array_elements(p_payload->'items') loop
  if j.kind='question_prepare' then
   select value into v_snapshot from jsonb_array_elements(j.input_snapshot->'items') where value->>'queueItemId'=x->>'queueItemId';
   v_hash:=english_private.sha256_json(x);
   insert into english_private.questions(owner_id,queue_id,queue_item_id,session_id,position,phrase_id,candidate_id,question_type,prompt_zh,prompt_en,expected_answers,accepted_variants,semantic_boundary,grading_rubric,generation_id,model_id,prompt_version,content_hash,contract_version,metadata)
   select o,i.queue_id,i.id,(select id from english_private.sessions where queue_id=i.queue_id),i.position,i.phrase_id,i.candidate_id,x->>'questionType',x->>'promptZh',x->>'promptEn',x->'expectedAnswers',x->'acceptedVariants',x->>'semanticBoundary',x->>'gradingRubric',j.id::text,p_payload->>'modelId','english_v2',v_hash,'english_v2',
   jsonb_build_object('trainingGoal',x->>'trainingGoal','hints',x->'hints','learningCard',x->'learningCard','isNew',(v_snapshot->>'isNew')::boolean)
   from english_private.daily_queue_items i where i.id=(x->>'queueItemId')::uuid;
  elsif j.kind='grade_submission' then
   select * into g from english_private.grade_requests where id=(x->>'requestId')::uuid;
   insert into english_private.grade_results(owner_id,submission_id,grade_request_id,position,result,feedback_zh,error_category,confidence,evidence,expected_answer,observed_answer,extra_practice,grading_batch_id,prompt_version,status,contract_version,target_outcome,meaning_ok,naturalness,hint_used)
   values(o,g.submission_id,g.id,g.position,case x->>'targetOutcome' when 'forgotten' then 'forgotten' when 'partial' then 'difficult' when 'not_measured' then 'normal' else case when (x->>'hintUsed')::boolean then 'difficult' else 'normal' end end,x->>'feedbackZh',x->>'errorCategory',(x->>'confidence')::numeric,x->>'evidence',x->>'expectedAnswer',g.observed_answer,coalesce(x->'extraPractice','[]'::jsonb),j.batch_id::text,'english_v2','needs_confirmation','english_v2',x->>'targetOutcome',(x->>'meaningOk')::boolean,x->>'naturalness',(x->>'hintUsed')::boolean);
   insert into english_private.grade_result_attempts(owner_id,submission_id,position,phrase_id,candidate_id,answer_hash,result,feedback_zh,error_category,confidence,evidence,expected_answer,observed_answer,extra_practice,grading_batch_id,prompt_version,grade_status,contract_version,created_at)
   values(o,g.submission_id,g.position,g.phrase_id,g.candidate_id,g.answer_hash,x->>'result',x->>'feedbackZh',x->>'errorCategory',(x->>'confidence')::numeric,x->>'evidence',x->>'expectedAnswer',g.observed_answer,coalesce(x->'extraPractice','[]'::jsonb),j.batch_id::text,'english_v2','needs_confirmation','english_v2',now());
   update english_private.grade_result_attempts set metadata=x where submission_id=g.submission_id and position=g.position and grading_batch_id=j.batch_id::text;
   update english_private.grade_requests set request_status='graded' where id=g.id;
  elsif j.kind='context_extract' then
   insert into english_private.context_candidates(owner_id,context_id,position,selected_text,candidate,cue_zh,candidate_type,context_meaning,why_useful,topic,difficulty,natural_example,common_mistake,confidence,processing_batch_id,contract_version)
   values(o,j.subject_id,v_context_position_offset+(x->>'position')::integer,x->>'selectedText',x->>'candidate',x->>'cueZh',x->>'candidateType',x->>'contextMeaning',x->>'whyUseful',x->>'topic',x->>'difficulty',x->>'naturalExample',x->>'commonMistake',(x->>'confidence')::numeric,j.batch_id::text,'english_v2');
  else
   insert into english_private.candidate_generation_rows(owner_id,request_id,requested_count,position,candidate,cue_zh,candidate_type,why_useful,topic,difficulty,natural_example,common_mistake,generation_batch_id,model_id,status,contract_version)
   values(o,j.id::text,j.expected_count,(x->>'position')::integer,x->>'candidate',x->>'cueZh',x->>'candidateType',x->>'whyUseful',x->>'topic',x->>'difficulty',x->>'naturalExample',x->>'commonMistake',j.batch_id::text,p_payload->>'modelId','staged','english_v2');
  end if;
 end loop;
 if j.kind='context_extract' then update english_private.contexts set status=case when n=0 then 'completed' else 'review' end,processed_at=now() where id=j.subject_id;end if;
 if j.kind='grade_submission' then
  update english_private.submissions set status='needs_confirmation',revision=revision+1,updated_at=now() where id=j.subject_id;
  update english_private.sessions set status='needs_confirmation' where id=(select session_id from english_private.submissions where id=j.subject_id);
 end if;
 update english_private.ai_jobs set status='consumed',model_id=p_payload->>'modelId',output_payload=p_payload,imported_at=now(),validated_at=now(),consumed_at=now() where id=j.id;
 return jsonb_build_object('ok',true,'jobId',j.id,'status','consumed','actualCount',n);
end $$;
