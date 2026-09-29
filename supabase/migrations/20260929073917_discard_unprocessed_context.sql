-- Remove an unprocessed capture from the active inbox without losing its source.
create or replace function english_api.discard_unprocessed_context(p_context_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = english_private, pg_catalog, pg_temp
as $$
declare
  v_owner uuid := english_private.current_owner();
  v_context english_private.contexts%rowtype;
begin
  select * into v_context
  from english_private.contexts
  where id = p_context_id and owner_id = v_owner
  for update;
  if not found then raise exception 'CONTEXT_NOT_FOUND'; end if;

  if v_context.status <> 'pending'
    or v_context.selected_spans <> '[]'::jsonb
    or exists (select 1 from english_private.context_candidates where context_id = p_context_id)
    or exists (select 1 from english_private.candidates where origin_context_id = p_context_id)
    or exists (
      select 1 from english_private.ai_jobs
      where kind = 'context_extract' and owner_id = v_owner
        and (subject_id = p_context_id
          or input_snapshot @> jsonb_build_object('contextId',p_context_id)
          or input_snapshot @> jsonb_build_array(jsonb_build_object('contextId',p_context_id)))
    )
  then raise exception 'CONTEXT_NOT_DISCARDABLE'; end if;

  update english_private.contexts set status = 'rejected'
  where id = p_context_id and owner_id = v_owner;
  return jsonb_build_object('ok',true,'contextId',p_context_id,'status','rejected');
end;
$$;

revoke all on function english_api.discard_unprocessed_context(uuid) from public, anon;
grant execute on function english_api.discard_unprocessed_context(uuid) to authenticated;
