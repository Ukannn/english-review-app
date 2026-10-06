begin;
-- Add-only capture capability. Tokens authorize inserts, never library reads or learning changes.
create schema shortcut_private;
revoke all on schema shortcut_private from public;
create role shortcut_writer nologin noinherit nobypassrls;
grant usage on schema shortcut_private to authenticated, anon, shortcut_writer;
grant usage on schema english_api to anon;
grant usage on schema english_private to shortcut_writer;
-- The owner-only invoker registration reads only its own account identifier.
grant execute on function english_private.current_owner() to authenticated;
grant select(owner_id) on english_private.app_owner to authenticated;
create policy shortcut_owner_identity on english_private.app_owner for select to authenticated using(owner_id=(select auth.uid()));
create table shortcut_private.devices (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 label text not null check(char_length(label) between 1 and 80), token_hash text not null unique,
 created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '90 days'), revoked_at timestamptz
);
create table shortcut_private.receipts (
 owner_id uuid not null references auth.users(id), request_id uuid not null, device_id uuid not null references shortcut_private.devices(id),
 context_id uuid not null, text_hash text not null, created_at timestamptz not null default now(), primary key(owner_id,request_id)
);
alter table shortcut_private.devices enable row level security;
alter table shortcut_private.receipts enable row level security;
create policy own_devices on shortcut_private.devices to authenticated using(owner_id=(select english_private.current_owner())) with check(owner_id=(select english_private.current_owner()));
create policy capture_devices on shortcut_private.devices to shortcut_writer using(true);
create policy capture_receipts on shortcut_private.receipts to shortcut_writer using(true) with check(true);
grant select,insert on shortcut_private.devices to authenticated;
grant update(revoked_at) on shortcut_private.devices to authenticated;
grant select on shortcut_private.devices to shortcut_writer;
grant update(revoked_at) on shortcut_private.devices to shortcut_writer;
grant select,insert on shortcut_private.receipts to shortcut_writer;
-- Only the NOLOGIN function owner can satisfy this policy. GUC alone grants no access.
create policy shortcut_insert on english_private.contexts for insert to shortcut_writer
 with check(owner_id=nullif(current_setting('shortcut.owner',true),'')::uuid);
grant insert(id,owner_id,raw_text,source_title,user_note,capture_request_id) on english_private.contexts to shortcut_writer;
create function shortcut_private.issue_device(p_label text) returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare o uuid:=english_private.current_owner(); t text; d shortcut_private.devices%rowtype;
begin
 if nullif(btrim(p_label),'') is null or char_length(p_label)>80 then raise exception 'CAPTURE_LABEL_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(o::text||':shortcut-devices',0));
 if (select count(*) from shortcut_private.devices where owner_id=o and revoked_at is null and expires_at>now())>=10 then raise exception 'CAPTURE_DEVICE_LIMIT'; end if;
 t:='capture_'||encode(extensions.gen_random_bytes(32),'hex');
 insert into shortcut_private.devices(owner_id,label,token_hash) values(o,btrim(p_label),encode(extensions.digest(t,'sha256'),'hex')) returning * into d;
 return jsonb_build_object('id',d.id,'token',t,'expiresAt',d.expires_at);
end $$;
create function shortcut_private.list_devices() returns jsonb language sql security invoker set search_path=pg_catalog,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'createdAt',created_at,'expiresAt',expires_at,'revokedAt',revoked_at) order by created_at desc),'[]') from shortcut_private.devices where owner_id=english_private.current_owner()
$$;
create function shortcut_private.revoke_device(p_id uuid) returns void language sql security invoker set search_path=pg_catalog,pg_temp as $$
 update shortcut_private.devices set revoked_at=coalesce(revoked_at,now()) where id=p_id and owner_id=english_private.current_owner()
$$;
create function shortcut_private.capture(p_request_id uuid,p_text text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
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
  return jsonb_build_object('status','saved','contextId',r.context_id,'requestId',p_request_id,'language','en');
 end if;
 if (select count(*) from shortcut_private.receipts where owner_id=d.owner_id and created_at>now()-interval '1 day')>=1000 then raise exception 'CAPTURE_DAILY_LIMIT'; end if;
 perform set_config('shortcut.owner',d.owner_id::text,true);
 insert into english_private.contexts(id,owner_id,raw_text,source_title,user_note,capture_request_id)
 values(cid,d.owner_id,p_text,'Apple Shortcuts',null,p_request_id::text);
 insert into shortcut_private.receipts(owner_id,request_id,device_id,context_id,text_hash) values(d.owner_id,p_request_id,d.id,cid,h);
 return jsonb_build_object('status','saved','contextId',cid,'requestId',p_request_id,'language','en');
end $$;
-- Transfer only this function to a dedicated least-privilege identity.
grant usage on schema extensions to shortcut_writer;
grant create on schema shortcut_private to shortcut_writer;
grant shortcut_writer to postgres with inherit false;
alter function shortcut_private.capture(uuid,text) owner to shortcut_writer;
revoke shortcut_writer from postgres;
revoke create on schema shortcut_private from shortcut_writer;
revoke all on all functions in schema shortcut_private from public,anon,authenticated;
grant execute on function shortcut_private.issue_device(text),shortcut_private.list_devices(),shortcut_private.revoke_device(uuid) to authenticated;
grant execute on function shortcut_private.capture(uuid,text) to anon;
create function english_api.issue_shortcut_device(p_label text) returns jsonb language sql security invoker set search_path=pg_catalog,pg_temp as $$select shortcut_private.issue_device(p_label)$$;
create function english_api.list_shortcut_devices() returns jsonb language sql security invoker set search_path=pg_catalog,pg_temp as $$select shortcut_private.list_devices()$$;
create function english_api.revoke_shortcut_device(p_id uuid) returns void language sql security invoker set search_path=pg_catalog,pg_temp as $$select shortcut_private.revoke_device(p_id)$$;
create function english_api.capture_shortcut(p_request_id uuid,p_text text) returns jsonb language sql security invoker set search_path=pg_catalog,pg_temp as $$select shortcut_private.capture(p_request_id,p_text)$$;
revoke all on function english_api.issue_shortcut_device(text),english_api.list_shortcut_devices(),english_api.revoke_shortcut_device(uuid),english_api.capture_shortcut(uuid,text) from public,anon,authenticated;
grant execute on function english_api.issue_shortcut_device(text),english_api.list_shortcut_devices(),english_api.revoke_shortcut_device(uuid) to authenticated;
grant execute on function english_api.capture_shortcut(uuid,text) to anon;
notify pgrst,'reload schema';
commit;
