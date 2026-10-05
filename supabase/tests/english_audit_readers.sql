\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$ begin begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;else raise exception 'Expected %, got %',expected,sqlerrm;end if;end;raise exception 'Expected error %',expected;end $$;
insert into auth.users(id,email,aud,role) values
 ('a1010101-1010-4010-8010-101010101010','audit@example.invalid','authenticated','authenticated'),
 ('a2020202-2020-4020-8020-202020202020','other@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('a1010101-1010-4010-8010-101010101010');
select set_config('request.jwt.claim.sub','a1010101-1010-4010-8010-101010101010',true);
insert into english_private.contexts(owner_id,raw_text,status) select 'a1010101-1010-4010-8010-101010101010','Source '||status,status
 from unnest(array['pending','processing','review','completed','rejected','legacy'])status;
insert into english_private.contexts(owner_id,raw_text,status) values('a2020202-2020-4020-8020-202020202020','Other owner source','completed');
insert into english_private.review_events(owner_id,rule_version,affects_srs) select 'a1010101-1010-4010-8010-101010101010',version,false
 from unnest(array[null,null,'legacy_v1','english_v2','english_v3'])version;
insert into english_private.review_events(owner_id,rule_version,affects_srs) values('a2020202-2020-4020-8020-202020202020',null,false);
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(english_api.get_context_inbox()->'contexts')=6,'all six owner context states remain available');
select pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(english_api.get_context_inbox()->'contexts')x where x->>'rawText'='Other owner source'),'cross-owner contexts stay private');
select pg_temp.assert_true((english_api.get_dashboard()->'analytics'->>'legacyReviews')::integer=3,'NULL and old rules count as legacy, modern and other owners do not');
select pg_temp.assert_true(not (select prosecdef from pg_proc where oid='english_api.get_context_inbox()'::regprocedure),'exposed reader stays security invoker');
select pg_temp.assert_true((select prosecdef from pg_proc where oid='english_private.get_context_inbox()'::regprocedure),'implementation stays in private definer');
select set_config('request.jwt.claim.sub','a2020202-2020-4020-8020-202020202020',true);
select pg_temp.expect_error('select english_api.get_context_inbox()','OWNER_REQUIRED');
select pg_temp.expect_error('select english_api.get_dashboard()','OWNER_REQUIRED');
reset role;
rollback;
