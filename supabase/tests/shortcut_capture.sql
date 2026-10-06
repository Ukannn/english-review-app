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
select set_config('request.jwt.claim.sub','c6666666-6666-4666-8666-666666666666',true);
set local role authenticated;
select english_api.revoke_shortcut_device((select(data->>'id')::uuid from shortcut_fixture));
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
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
