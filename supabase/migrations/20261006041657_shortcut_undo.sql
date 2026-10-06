-- Immediate, reversible removal of this device's own recent, unprocessed capture.
alter table shortcut_private.receipts add column undone_at timestamptz;
create role shortcut_undoer nologin noinherit nobypassrls;
grant usage on schema shortcut_private,english_private,extensions to shortcut_undoer;
grant select on shortcut_private.devices,shortcut_private.receipts to shortcut_undoer;
grant update(revoked_at) on shortcut_private.devices to shortcut_undoer;
grant update(undone_at) on shortcut_private.receipts to shortcut_undoer;
create policy undo_devices on shortcut_private.devices to shortcut_undoer using(true);
create policy undo_receipts on shortcut_private.receipts to shortcut_undoer using(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid) with check(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid);
grant select(id,owner_id,status,selected_spans),update(status) on english_private.contexts to shortcut_undoer;
create policy undo_context_read on english_private.contexts for select to shortcut_undoer using(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid);
create policy undo_context_write on english_private.contexts for update to shortcut_undoer using(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid and status='pending') with check(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid and status='rejected');
grant select(owner_id,context_id) on english_private.context_candidates to shortcut_undoer;
create policy undo_dependency_read on english_private.context_candidates for select to shortcut_undoer using(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid);
grant select(owner_id,origin_context_id) on english_private.candidates to shortcut_undoer;
create policy undo_dependency_read on english_private.candidates for select to shortcut_undoer using(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid);
grant select(owner_id,kind,input_snapshot,subject_id) on english_private.ai_jobs to shortcut_undoer;
create policy undo_dependency_read on english_private.ai_jobs for select to shortcut_undoer using(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid);
create function shortcut_private.undo_capture(p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare t text:=current_setting('request.headers',true)::jsonb->>'x-capture-token';d shortcut_private.devices%rowtype;r shortcut_private.receipts%rowtype;c record;
begin
 if t is null or t !~ '^capture_[a-f0-9]{64}$' then raise exception 'CAPTURE_AUTH_REQUIRED' using errcode='28000';end if;
 select * into d from shortcut_private.devices where token_hash=encode(extensions.digest(t,'sha256'),'hex') and revoked_at is null and expires_at>now() for update;
 if not found then raise exception 'CAPTURE_AUTH_INVALID' using errcode='28000';end if;
 perform set_config('shortcut.owner',d.owner_id::text,true);
 perform pg_advisory_xact_lock(hashtextextended(d.owner_id::text||':shortcut-capture',0));
 select * into r from shortcut_private.receipts where owner_id=d.owner_id and request_id=p_request_id and device_id=d.id for update;
 if not found then raise exception 'CAPTURE_UNDO_NOT_FOUND';end if;
 if r.undone_at is not null then return jsonb_build_object('status','undone','requestId',p_request_id,'contextId',r.context_id,'language','en');end if;
 if r.created_at<now()-interval '10 minutes' then raise exception 'CAPTURE_UNDO_EXPIRED';end if;
 select id,status,selected_spans into c from english_private.contexts where id=r.context_id and owner_id=d.owner_id for update;
 if not found then raise exception 'CAPTURE_UNDO_ALREADY_PROCESSED';end if;
 if c.status<>'pending' or c.selected_spans<>'[]'::jsonb or exists(select 1 from english_private.context_candidates where context_id=r.context_id) or exists(select 1 from english_private.candidates where origin_context_id=r.context_id)
 or exists(select 1 from english_private.ai_jobs where owner_id=d.owner_id and kind='context_extract' and (subject_id=r.context_id or input_snapshot @> jsonb_build_object('contextId',r.context_id) or input_snapshot @> jsonb_build_array(jsonb_build_object('contextId',r.context_id))))
 then raise exception 'CAPTURE_UNDO_ALREADY_PROCESSED';end if;
 update english_private.contexts set status='rejected' where id=r.context_id and owner_id=d.owner_id;
 if not found then raise exception 'CAPTURE_UNDO_NOT_FOUND';end if;
 update shortcut_private.receipts set undone_at=now() where owner_id=d.owner_id and request_id=p_request_id;
 return jsonb_build_object('status','undone','requestId',p_request_id,'contextId',r.context_id,'language','en');
end $$;
grant create on schema shortcut_private to shortcut_undoer;
grant shortcut_undoer to postgres with inherit false;
alter function shortcut_private.undo_capture(uuid) owner to shortcut_undoer;
revoke shortcut_undoer from postgres;
revoke create on schema shortcut_private from shortcut_undoer;
revoke all on function shortcut_private.undo_capture(uuid) from public,anon,authenticated;
grant execute on function shortcut_private.undo_capture(uuid) to anon;
create function english_api.undo_shortcut_capture(p_request_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,pg_temp as $$select shortcut_private.undo_capture(p_request_id)$$;
revoke all on function english_api.undo_shortcut_capture(uuid) from public,anon,authenticated;
grant execute on function english_api.undo_shortcut_capture(uuid) to anon;

grant shortcut_writer to postgres with inherit true;
create or replace function shortcut_private.capture(p_request_id uuid,p_text text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare t text:=current_setting('request.headers',true)::jsonb->>'x-capture-token'; d shortcut_private.devices%rowtype; r shortcut_private.receipts%rowtype; h text; cid uuid:=gen_random_uuid();
begin
 if t is null or t !~ '^capture_[a-f0-9]{64}$' then raise exception 'CAPTURE_AUTH_REQUIRED' using errcode='28000'; end if;
 select * into d from shortcut_private.devices where token_hash=encode(extensions.digest(t,'sha256'),'hex') and revoked_at is null and expires_at>now() for update;
 if not found then raise exception 'CAPTURE_AUTH_INVALID' using errcode='28000'; end if;
 if p_request_id is null or nullif(btrim(p_text),'') is null or char_length(p_text)>12000 then raise exception 'CAPTURE_TEXT_INVALID'; end if;
 h:=encode(extensions.digest(p_text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(d.owner_id::text||':shortcut-capture',0));
 select * into r from shortcut_private.receipts where owner_id=d.owner_id and request_id=p_request_id;
 if found then
  if r.text_hash<>h then raise exception 'CAPTURE_REQUEST_CONFLICT'; end if;
  return jsonb_build_object('status',case when r.undone_at is null then 'saved' else 'undone' end,'contextId',r.context_id,'requestId',p_request_id,'language','en');
 end if;
 if (select count(*) from shortcut_private.receipts where owner_id=d.owner_id and created_at>now()-interval '1 day')>=1000 then raise exception 'CAPTURE_DAILY_LIMIT'; end if;
 perform set_config('shortcut.owner',d.owner_id::text,true);
 insert into english_private.contexts(id,owner_id,raw_text,source_title,user_note,capture_request_id)
 values(cid,d.owner_id,p_text,'Apple Shortcuts',null,p_request_id::text);
 insert into shortcut_private.receipts(owner_id,request_id,device_id,context_id,text_hash) values(d.owner_id,p_request_id,d.id,cid,h);
 return jsonb_build_object('status','saved','contextId',cid,'requestId',p_request_id,'language','en');
end $$;

revoke shortcut_writer from postgres;
