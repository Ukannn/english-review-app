-- Isolated CI only. No production fixtures.
begin;
insert into auth.users(id,email,aud,role) values('c6666666-6666-4666-8666-666666666666','shortcuts@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('c6666666-6666-4666-8666-666666666666');
select set_config('request.jwt.claim.sub','c6666666-6666-4666-8666-666666666666',true);
create temp table shortcut_fixture(data jsonb);
grant all on shortcut_fixture to authenticated;
set local role authenticated;
insert into shortcut_fixture select english_api.issue_shortcut_device('isolated fixture');
reset role;
select set_config('request.headers',jsonb_build_object('x-capture-token',data->>'token')::text,true) from shortcut_fixture;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$declare a jsonb;b jsonb;begin
 a:=english_api.capture_shortcut('c7777777-7777-4777-8777-777777777777',E'  Hello 안녕 🙂 "test"\n第二行  ');
 b:=english_api.capture_shortcut('c7777777-7777-4777-8777-777777777777',E'  Hello 안녕 🙂 "test"\n第二行  ');
 if a<>b or a->>'status'<>'saved' then raise exception 'RETRY_RECEIPT_MISMATCH'; end if;
 begin
  perform english_api.capture_shortcut('c7777777-7777-4777-8777-777777777777','changed');
  raise exception 'CONFLICT_WAS_ACCEPTED';
 exception when others then if sqlerrm<>'CAPTURE_REQUEST_CONFLICT' then raise;end if;end;
 begin
  perform english_api.capture_shortcut(gen_random_uuid(),'');raise exception 'EMPTY_ACCEPTED';
 exception when others then if sqlerrm<>'CAPTURE_TEXT_INVALID' then raise;end if;end;
 begin
  perform english_api.capture_shortcut(gen_random_uuid(),repeat('x',12001));raise exception 'OVERSIZE_ACCEPTED';
 exception when others then if sqlerrm<>'CAPTURE_TEXT_INVALID' then raise;end if;end;
 begin perform english_api.list_shortcut_devices();raise exception 'ANON_LIST_ACCEPTED';exception when insufficient_privilege then null;end;
 begin perform english_api.issue_shortcut_device('bad');raise exception 'ANON_ISSUE_ACCEPTED';exception when insufficient_privilege then null;end;
 begin perform 1 from english_private.contexts;raise exception 'ANON_READ_ACCEPTED';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if (select count(*) from english_private.contexts where capture_request_id::text='c7777777-7777-4777-8777-777777777777')<>1 then raise exception 'DUPLICATE_WRITE';end if;
 if not exists(select 1 from english_private.contexts where capture_request_id::text='c7777777-7777-4777-8777-777777777777' and raw_text=E'  Hello 안녕 🙂 "test"\n第二行  ' and status='pending') then raise exception 'TEXT_NOT_PRESERVED';end if;
 if has_table_privilege('shortcut_writer','english_private.contexts','SELECT') or has_table_privilege('shortcut_writer','english_private.contexts','UPDATE') then raise exception 'WRITER_TOO_POWERFUL';end if;
end $$;

-- Same owner, different connection must not undo another device's capture.
select set_config('request.jwt.claim.sub','c6666666-6666-4666-8666-666666666666',true);
create temp table other_shortcut_fixture(data jsonb);
grant all on other_shortcut_fixture to authenticated;
set local role authenticated;
insert into other_shortcut_fixture select english_api.issue_shortcut_device('other connection');
reset role;
select set_config('request.headers',jsonb_build_object('x-capture-token',data->>'token')::text,true) from other_shortcut_fixture;
set local role anon;
do $$begin
 begin perform english_api.undo_shortcut_capture('c7777777-7777-4777-8777-777777777777');raise exception 'OTHER_DEVICE_UNDO_ACCEPTED';exception when others then if sqlerrm<>'CAPTURE_UNDO_NOT_FOUND' then raise;end if;end;
end $$;
reset role;
select set_config('request.headers','{}',true);
set local role anon;
do $$begin
 begin perform english_api.undo_shortcut_capture('c7777777-7777-4777-8777-777777777777');raise exception 'MISSING_UNDO_AUTH_ACCEPTED';exception when invalid_authorization_specification then null;end;
end $$;
reset role;
select set_config('request.headers',jsonb_build_object('x-capture-token',data->>'token')::text,true) from shortcut_fixture;
select set_config('request.jwt.claim.sub','',true);

-- Two separate captures, exact-request undo, idempotency and no resurrection.
set local role anon;
select english_api.capture_shortcut('d1111111-1111-4111-8111-111111111111','leave this capture');
do $$declare a jsonb;b jsonb;begin
 a:=english_api.undo_shortcut_capture('c7777777-7777-4777-8777-777777777777');
 b:=english_api.undo_shortcut_capture('c7777777-7777-4777-8777-777777777777');
 if a<>b or a->>'status'<>'undone' then raise exception 'UNDO_RETRY_FAILED';end if;
 if (english_api.capture_shortcut('c7777777-7777-4777-8777-777777777777',E'  Hello 안녕 🙂 "test"\n第二行  ')->>'status')<>'undone' then raise exception 'UNDO_RESURRECTED';end if;
 begin perform english_api.undo_shortcut_capture(gen_random_uuid());raise exception 'UNKNOWN_UNDO_ACCEPTED';exception when others then if sqlerrm<>'CAPTURE_UNDO_NOT_FOUND' then raise;end if;end;
end $$;
reset role;
do $$begin
 if not exists(select 1 from english_private.contexts where capture_request_id::text='c7777777-7777-4777-8777-777777777777' and status='rejected') then raise exception 'UNDO_NOT_APPLIED';end if;
 if not exists(select 1 from english_private.contexts where capture_request_id::text='d1111111-1111-4111-8111-111111111111' and status='pending') then raise exception 'UNDO_CHANGED_OTHER_CAPTURE';end if;
 if has_column_privilege('shortcut_undoer','english_private.contexts','raw_text','SELECT') or has_column_privilege('shortcut_undoer','english_private.contexts','raw_text','UPDATE') then raise exception 'UNDO_RAW_TEXT_ACCESS';end if;
end $$;
update shortcut_private.receipts set created_at=now()-interval '11 minutes' where request_id='d1111111-1111-4111-8111-111111111111';
set local role anon;
do $$begin
 begin perform english_api.undo_shortcut_capture('d1111111-1111-4111-8111-111111111111');raise exception 'EXPIRED_UNDO_ACCEPTED';exception when others then if sqlerrm<>'CAPTURE_UNDO_EXPIRED' then raise;end if;end;
end $$;
reset role;
update shortcut_private.receipts set created_at=now() where request_id='d1111111-1111-4111-8111-111111111111';
update english_private.contexts set status='processing' where capture_request_id::text='d1111111-1111-4111-8111-111111111111';
set local role anon;
do $$begin
 begin perform english_api.undo_shortcut_capture('d1111111-1111-4111-8111-111111111111');raise exception 'PROCESSED_UNDO_ACCEPTED';exception when others then if sqlerrm<>'CAPTURE_UNDO_ALREADY_PROCESSED' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','c6666666-6666-4666-8666-666666666666',true);
set local role authenticated;
select english_api.revoke_shortcut_device((select(data->>'id')::uuid from shortcut_fixture));
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
 begin perform english_api.undo_shortcut_capture('c7777777-7777-4777-8777-777777777777');raise exception 'REVOKED_UNDO_ACCEPTED';exception when invalid_authorization_specification then null;end;
 begin perform english_api.capture_shortcut(gen_random_uuid(),'revoked');raise exception 'REVOKED_ACCEPTED';exception when invalid_authorization_specification then null;end;
end $$;
reset role;
select set_config('request.headers','{}',true);
set local role anon;
do $$begin
 begin perform english_api.capture_shortcut(gen_random_uuid(),'unauthorized');raise exception 'MISSING_AUTH_ACCEPTED';exception when invalid_authorization_specification then null;end;
end $$;
reset role;
rollback;
