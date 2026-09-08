begin;
-- Management API uploads are staged in bounded blocks. No browser role may access them.
-- Promotion validates the registered owner, exact block hashes and final typed row counts atomically.
create table english_private.import_payload_blocks (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 import_batch_id uuid not null references english_private.import_batches(id) on delete cascade,
 block_index integer not null check(block_index>=0),
 target_table text not null,
 payload_text text not null,
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 unique(import_batch_id,block_index)
);
create index import_payload_blocks_owner_idx on english_private.import_payload_blocks(owner_id);
alter table english_private.import_payload_blocks enable row level security;
create policy owner_scope on english_private.import_payload_blocks for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
revoke all on english_private.import_payload_blocks from public,anon,authenticated;
commit;
