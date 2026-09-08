"""Bounded, resumable payload staging with one atomic promotion transaction."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from db import run_sql
from export_xlsx_snapshot import canonical_hash
from validation import sql_preflight, empty_target_guards

MAX_QUERY_BYTES = 512 * 1024
MAX_PAYLOAD_BYTES = 240 * 1024


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def do_sql(body):
    body = body.replace("select pg_advisory_xact_lock(", "perform pg_advisory_xact_lock(")
    body = body.replace("select set_config(", "perform set_config(")
    delimiter = "$staged_" + hashlib.sha256(body.encode()).hexdigest()[:16] + "$"
    if delimiter in body:
        raise ValueError("SQL delimiter collision")
    return f"do {delimiter}\ndeclare v_block record; v_batch english_private.import_batches%rowtype; v_payload text;\nbegin\n{body}\nend {delimiter};\n"


def write_sql(path, sql):
    size = len(sql.encode())
    if size > MAX_QUERY_BYTES:
        raise ValueError(f"Staged SQL exceeds {MAX_QUERY_BYTES} bytes: {path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(sql)
    path.chmod(0o600)
    return {"file": str(path.name), "sqlSha256": hashlib.sha256(sql.encode()).hexdigest(), "bytes": size}


def record_blocks(table, records):
    current = []
    current_size = 2
    for record in records:
        encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        size = len(encoded.encode()) + 1
        if size > MAX_PAYLOAD_BYTES:
            raise ValueError(f"{table}: one record exceeds the staging block budget")
        if current and (len(current) >= 200 or current_size + size > MAX_PAYLOAD_BYTES):
            yield "[" + ",".join(current) + "]", len(current)
            current, current_size = [], 2
        current.append(encoded)
        current_size += size
    if current:
        yield "[" + ",".join(current) + "]", len(current)


def build_staged_files(output, owner, batch_id, source, report, combined, stage, promote, assertions):
    from build_english_import import select_columns
    directory = output / "staged"
    blocks, table_replacements = [], []
    # The batch row exists during staging. Its source/count fields are created by setup.
    batch_insert = next(line for line in combined.splitlines(keepends=True)
                        if line.startswith("insert into english_private.import_batches("))
    final_body = combined.replace(batch_insert, "", 1)
    postprocessing = final_body
    for buffer in (stage, promote):
        for (table, records), (copy_sql, _) in zip(buffer.tables.items(), buffer.copy_blocks, strict=True):
            columns = buffer.table_columns[table]
            for payload, count in record_blocks(table, records):
                blocks.append({"index": len(blocks), "table": table, "rows": count,
                               "sha256": hashlib.sha256(payload.encode()).hexdigest(), "payload": payload})
            replacement = f"""for v_block in select * from english_private.import_payload_blocks
 where owner_id='{owner}' and import_batch_id='{batch_id}' and target_table='{table}' order by block_index loop
 insert into {table} ({','.join(columns)})
 select {select_columns(table, columns)} from jsonb_populate_recordset(null::{table}, v_block.payload_text::jsonb);
end loop;
"""
            final_body = final_body.replace(copy_sql, replacement, 1)
            postprocessing = postprocessing.replace(copy_sql, "", 1)
    definitions = [{key: block[key] for key in ("index", "table", "rows", "sha256")} for block in blocks]
    empty = "\n".join(empty_target_guards(owner, {**stage.tables, **promote.tables, "english_private.legacy_recovery": []})) + "\n"
    metadata = {"version": 1, "snapshotHash": source["snapshot_sha256"], "sourceHash": source["source_sha256"],
                "ownerId": owner, "blocks": definitions,
                "postprocessingSha256": hashlib.sha256(postprocessing.encode()).hexdigest(),
                # Bind the actual record-to-column conversions and assertions too.
                # A new converter must not resume an older plan just because its
                # source payloads and non-COPY postprocessing are unchanged.
                "promotionBodySha256": hashlib.sha256((empty + final_body + assertions).encode()).hexdigest()}
    plan_hash = canonical_hash(metadata)
    metadata["planHash"] = plan_hash
    metadata_json = literal(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")))
    owner_guard = f"""if not exists (select 1 from english_private.app_owner where singleton and owner_id='{owner}')
 then raise exception 'IMPORT_OWNER_NOT_REGISTERED'; end if;
if exists(select 1 from auth.users where id<>'{owner}') then raise exception 'IMPORT_UNEXPECTED_AUTH_IDENTITY'; end if;
perform pg_advisory_xact_lock(hashtextextended('english_legacy_import',0));
"""
    bind_guard = f"""select * into v_batch from english_private.import_batches where id='{batch_id}' and owner_id='{owner}' for update;
if not found then raise exception 'STAGING_BATCH_MISSING'; end if;
if v_batch.snapshot_sha256 <> '{source['snapshot_sha256']}' or v_batch.reconciliation->'staging'->>'planHash' is distinct from '{plan_hash}'
 then raise exception 'STAGING_PLAN_CONFLICT'; end if;
"""
    setup = owner_guard + f"""select * into v_batch from english_private.import_batches where id='{batch_id}' and owner_id='{owner}' for update;
if found then
 if v_batch.snapshot_sha256 <> '{source['snapshot_sha256']}' or v_batch.reconciliation->'staging'->>'planHash' is distinct from '{plan_hash}'
 then raise exception 'STAGING_PLAN_CONFLICT'; end if;
 return;
end if;
"""
    setup += sql_preflight(owner, batch_id, {**stage.tables, **promote.tables, "english_private.legacy_recovery": []})
    setup += batch_insert
    setup += f"update english_private.import_batches set reconciliation=jsonb_build_object('staging',{metadata_json}::jsonb) where id='{batch_id}' and owner_id='{owner}';\n"
    setup_file = write_sql(directory / "000-setup.sql", do_sql(setup))
    block_files = []
    for block in blocks:
        index, sha, table = block["index"], block["sha256"], block["table"]
        payload = literal(block["payload"])
        body = owner_guard + bind_guard + f"""if v_batch.status <> 'staged' then raise exception 'STAGING_BATCH_NOT_STAGED'; end if;
if v_batch.reconciliation->'staging'->'blocks'->{index}->>'sha256' <> '{sha}'
 or v_batch.reconciliation->'staging'->'blocks'->{index}->>'table' <> '{table}' then raise exception 'STAGING_BLOCK_NOT_EXPECTED'; end if;
v_payload := {payload};
if encode(extensions.digest(v_payload,'sha256'),'hex') <> '{sha}' then raise exception 'STAGING_INPUT_HASH_MISMATCH'; end if;
select * into v_block from english_private.import_payload_blocks where owner_id='{owner}' and import_batch_id='{batch_id}' and block_index={index};
if found then
 if v_block.payload_sha256 <> '{sha}' or v_block.target_table <> '{table}' or encode(extensions.digest(v_block.payload_text,'sha256'),'hex') <> '{sha}'
 then raise exception 'STAGING_BLOCK_CONFLICT'; end if;
 return;
end if;
insert into english_private.import_payload_blocks(id,owner_id,import_batch_id,block_index,target_table,payload_text,payload_sha256)
 values (gen_random_uuid(),'{owner}','{batch_id}',{index},'{table}',v_payload,'{sha}');
"""
        details = write_sql(directory / f"{index+1:03d}-block.sql", do_sql(body))
        block_files.append({**definitions[index], **details})
    verify = f"""if (select count(*) from english_private.import_payload_blocks where owner_id='{owner}' and import_batch_id='{batch_id}') <> {len(blocks)}
 then raise exception 'STAGING_BLOCKS_INCOMPLETE'; end if;
for v_block in select * from english_private.import_payload_blocks where owner_id='{owner}' and import_batch_id='{batch_id}' order by block_index loop
 if v_block.payload_sha256 is distinct from v_batch.reconciliation->'staging'->'blocks'->v_block.block_index->>'sha256'
 or v_block.target_table is distinct from v_batch.reconciliation->'staging'->'blocks'->v_block.block_index->>'table'
 or encode(extensions.digest(v_block.payload_text,'sha256'),'hex') <> v_block.payload_sha256
 then raise exception 'STAGING_BLOCK_HASH_MISMATCH'; end if;
end loop;
"""
    final = owner_guard + bind_guard + "if v_batch.status='promoted' then return; end if;\n"
    final += verify + empty + final_body + assertions
    final += f"update english_private.import_batches set reconciliation=reconciliation || jsonb_build_object('staging',{metadata_json}::jsonb) where owner_id='{owner}' and id='{batch_id}';\n"
    final_file = write_sql(directory / "999-promote.sql", do_sql(final))
    return {"planHash": plan_hash, "setup": setup_file, "blocks": block_files, "promote": final_file,
            "maxQueryBytes": max([setup_file["bytes"], final_file["bytes"]]+[b["bytes"] for b in block_files])}


def checked_sql(directory, file):
    filename = file["file"]
    if Path(filename).name != filename:
        raise ValueError("Invalid staged SQL path")
    sql = (directory / filename).read_text()
    if len(sql.encode()) > MAX_QUERY_BYTES or hashlib.sha256(sql.encode()).hexdigest() != file["sqlSha256"]:
        raise ValueError("Staged SQL integrity check failed")
    return sql


def read_staging(args, manifest):
    owner, batch = manifest["ownerId"], manifest["batchId"]
    # These values originated in a validated UUID manifest; never interpolate unchecked input.
    import uuid
    owner, batch = str(uuid.UUID(owner)), str(uuid.UUID(batch))
    query = f"""select jsonb_build_object(
 'batch',(select jsonb_build_object('status',status,'planHash',reconciliation->'staging'->>'planHash') from english_private.import_batches where owner_id='{owner}' and id='{batch}'),
 'blocks',(select coalesce(jsonb_agg(jsonb_build_object('index',block_index,'table',target_table,'sha256',payload_sha256,'verifiedHash',encode(extensions.digest(payload_text,'sha256'),'hex')) order by block_index),'[]'::jsonb) from english_private.import_payload_blocks where owner_id='{owner}' and import_batch_id='{batch}'));
"""
    return json.loads(run_sql(args, query))


def validate_staging(manifest, state):
    if state["batch"] is None:
        return {}
    if state["batch"]["planHash"] != manifest["staged"]["planHash"]:
        raise ValueError("Stored staging plan differs; refusing to merge imports")
    expected = {b["index"]: b for b in manifest["staged"]["blocks"]}
    valid = {}
    for block in state["blocks"]:
        target = expected.get(block["index"])
        if target is None or target["sha256"] != block["sha256"] or target["sha256"] != block["verifiedHash"] or target["table"] != block["table"]:
            raise ValueError("Stored staging block content differs; refusing to skip or overwrite")
        valid[block["index"]] = block
    return valid


def apply_staged(args, directory, manifest, *, stage_only=False, max_blocks=None):
    files = manifest["staged"]
    state = read_staging(args, manifest)
    existing = validate_staging(manifest, state)
    if state["batch"] and state["batch"]["status"] == "promoted":
        return {"state": "promoted", "skippedBlocks": len(existing), "writtenBlocks": 0}
    try:
        run_sql(args, checked_sql(directory, files["setup"]), expect_result=False)
    except RuntimeError:
        latest = read_staging(args, manifest)
        validate_staging(manifest, latest)
        if latest["batch"] is None:
            raise
    written = 0
    for block in files["blocks"]:
        if block["index"] in existing:
            continue
        if max_blocks is not None and written >= max_blocks:
            return {"state": "staged", "skippedBlocks": len(existing), "writtenBlocks": written}
        try:
            run_sql(args, checked_sql(directory, block), expect_result=False)
        except RuntimeError:
            # Read before retry: an uncertain transport can still have committed this block.
            latest = validate_staging(manifest, read_staging(args, manifest))
            if block["index"] not in latest:
                raise
        written += 1
    latest = validate_staging(manifest, read_staging(args, manifest))
    if len(latest) != len(files["blocks"]):
        raise ValueError("Staging readback is incomplete; promotion not attempted")
    if not stage_only:
        try:
            run_sql(args, checked_sql(directory, files["promote"]), expect_result=False)
        except RuntimeError:
            latest = read_staging(args, manifest)
            validate_staging(manifest, latest)
            if not latest["batch"] or latest["batch"]["status"] != "promoted":
                raise
    return {"state": "staged" if stage_only else "promoted", "skippedBlocks": len(existing), "writtenBlocks": written}
