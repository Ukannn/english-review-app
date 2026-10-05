\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(v boolean,label text) returns void language plpgsql as $$ begin if v is not true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
insert into auth.users(id,email,aud,role) values('d4444444-4444-4444-8444-444444444444','discard@example.invalid','authenticated','authenticated');
insert into english_private.app_owner(owner_id) values('d4444444-4444-4444-8444-444444444444');
select set_config('request.jwt.claim.sub','d4444444-4444-4444-8444-444444444444',true);

create temp table pg_temp.context_to_discard(id uuid);
insert into pg_temp.context_to_discard
select (english_api.save_context('{"rawText":"An unmarked passage.","selectedSpans":[]}',null,'discard-test')->>'contextId')::uuid;
select pg_temp.assert_true(
  (select (english_api.discard_unprocessed_context(id)->>'status')='rejected' from pg_temp.context_to_discard),
  'unprocessed context can be discarded');
select pg_temp.assert_true(
  (select status='rejected' from english_private.contexts where id=(select id from pg_temp.context_to_discard)),
  'discard preserves source for recovery');
select pg_temp.assert_true(
  exists (select 1 from jsonb_array_elements(english_api.get_context_inbox()->'contexts') c
    where (c->>'id')::uuid=(select id from pg_temp.context_to_discard) and c->>'status'='rejected'),
  'discarded context remains available as archived source');

create temp table pg_temp.marked_context(id uuid);
insert into pg_temp.marked_context
select (english_api.save_context('{"rawText":"A marked passage.","selectedSpans":[{"text":"marked","start":2,"end":8}]}',null,'marked-test')->>'contextId')::uuid;
do $$ begin
  perform english_api.discard_unprocessed_context((select id from pg_temp.marked_context));
  raise exception 'Marked context should have been retained';
exception when others then
  if sqlerrm <> 'CONTEXT_NOT_DISCARDABLE' then raise; end if;
end $$;
select pg_temp.assert_true(
  (select status='pending' from english_private.contexts where id=(select id from pg_temp.marked_context)),
  'marked context remains pending');
rollback;
