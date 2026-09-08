"""Fail closed before generating a cutover import and again inside its transaction."""
from collections import Counter

LIVE_ONLY_TABLES = {"english_private.grade_results", "english_private.extra_practice",
                    "english_private.ai_jobs", "english_private.rpc_idempotency",
                    "english_private.daily_observations", "english_private.question_activity"}


def empty_target_guards(owner, tables):
    return [f"if exists (select 1 from {table}) then raise exception 'IMPORT_TARGET_NOT_EMPTY: {table}'; end if;"
            for table in sorted(set(tables) | LIVE_ONLY_TABLES)]


def present(value):
    return value is not None and value != ""


def validate_source(sheets):
    keys = {
        "Config": ("Key",), "Context Inbox": ("Context ID",), "Candidate Bank": ("Candidate ID",),
        "Phrase Bank": ("ID",), "Daily Queue": ("Queue ID", "Position"),
        "Session Log": ("Session ID",), "Answer Drafts": ("Session ID", "Position"),
        "Answer Draft History": ("History ID",), "Commit Journal": ("Submission ID",),
        "Grade Requests": ("Submission ID", "Position"),
        "Context Candidate Inbox": ("Context ID", "Proposal Position"),
        "Candidate Generation Inbox": ("Request ID", "Position"),
    }
    for sheet, columns in keys.items():
        seen = set()
        for row in sheets[sheet]:
            key = tuple(str(row[c]) for c in columns)
            if any(not present(row[c]) for c in columns) or key in seen:
                raise ValueError(f"{sheet} row {row['__source_row']}: blank/duplicate identity {columns}")
            seen.add(key)
    phrase_ids = {r["ID"] for r in sheets["Phrase Bank"]}
    candidate_ids = {r["Candidate ID"] for r in sheets["Candidate Bank"]}
    context_ids = {r["Context ID"] for r in sheets["Context Inbox"]}
    session_ids = {r["Session ID"] for r in sheets["Session Log"]}
    queue_ids = {r["Queue ID"] for r in sheets["Daily Queue"]}
    submission_ids = {r["Submission ID"] for r in sheets["Commit Journal"]}
    known = {"Phrase ID": phrase_ids, "Candidate ID": candidate_ids, "Session ID": session_ids,
             "Queue ID": queue_ids, "Origin Context ID": context_ids, "Source Candidate ID": candidate_ids,
             "Promoted Phrase ID": phrase_ids, "Superseded By": queue_ids}
    exceptions = []
    for name, rows in sheets.items():
        for row in rows:
            for field, ids in known.items():
                if name == "Candidate Bank" and field == "Candidate ID":
                    continue
                value = row.get(field)
                if present(value) and value not in ids:
                    if field == "Session ID" and name in ("Daily Queue", "Session Questions"):
                        # Legacy queue presentation could precede its Session Log write.
                        exceptions.append({"sheet": name, "row": row["__source_row"], "reason": "presentation_without_session_log"})
                        continue
                    raise ValueError(f"{name} row {row['__source_row']}: orphan {field}")
            if name in ("Context Candidate Inbox",) and row["Context ID"] not in context_ids:
                raise ValueError(f"{name} row {row['__source_row']}: orphan Context ID")
            if name == "Grade Requests" and row["Submission ID"] not in submission_ids:
                raise ValueError(f"{name} row {row['__source_row']}: orphan Submission ID")
            if name == "Grade Inbox" and row["Submission ID"] not in submission_ids:
                # Rejected/failed historical attempts can predate any formal submission.
                if row.get("Grade Status") not in ("rejected", "failed"):
                    raise ValueError(f"{name} row {row['__source_row']}: unexplained orphan Submission ID")
                exceptions.append({"sheet": name, "row": row["__source_row"], "reason": "rejected_or_failed_submission_not_committed"})
    bound = Counter((r["Queue ID"], str(r["Position"])) for r in sheets["Session Questions"] if r["Question Status"] != "rejected")
    if any(count > 1 for count in bound.values()):
        raise ValueError("Ambiguous non-rejected question versions; explicit resolution is required")
    chunk_counts = Counter(r["Chunk"] for r in sheets["Phrase Bank"])
    if any(not present(chunk) or count > 1 for chunk, count in chunk_counts.items()):
        raise ValueError("Blank/duplicate Phrase Bank chunk conflicts with database uniqueness")
    return {"unresolvedReferences": 0, "historicalReferenceExceptions": exceptions}


def validate_targets(tables):
    ids = {}
    for table, rows in tables.items():
        values = [r["id"] for r in rows]
        if len(set(values)) != len(values):
            raise ValueError(f"{table}: duplicate generated IDs")
        ids[table.removeprefix("english_private.")] = set(values)
    for raw in tables["english_private.import_rows"]:
        if raw["promotion_status"] == "legacy_only":
            continue
        if raw["target_id"] not in ids.get(raw["target_table"], set()):
            raise ValueError(f"{raw['source_sheet']} row {raw['source_row']}: missing promoted target")
    refs = {"phrase_id": "phrases", "candidate_id": "candidates", "queue_id": "daily_queues",
            "session_id": "sessions", "question_id": "questions", "queue_item_id": "daily_queue_items",
            "submission_id": "submissions", "answer_draft_id": "answer_drafts", "context_id": "contexts",
            "origin_context_id": "contexts", "source_candidate_id": "candidates", "superseded_by": "daily_queues"}
    for table, rows in tables.items():
        for row in rows:
            for field, target in refs.items():
                if row.get(field) is not None and row[field] not in ids.get(target, set()):
                    raise ValueError(f"{table}: unresolved target {field}")
    return {"orphanTargets": 0, "duplicateTargetIds": 0}


def sql_preflight(owner, batch_id, tables):
    checks = [f"if not exists (select 1 from english_private.app_owner where singleton and owner_id='{owner}') then raise exception 'IMPORT_OWNER_NOT_REGISTERED'; end if;",
              f"if not exists (select 1 from auth.users where id='{owner}') then raise exception 'IMPORT_AUTH_OWNER_MISSING'; end if;",
              f"if exists (select 1 from auth.users where id<>'{owner}') then raise exception 'IMPORT_UNEXPECTED_AUTH_IDENTITY'; end if;",
              f"if exists (select 1 from english_private.import_batches where owner_id='{owner}') then raise exception 'IMPORT_ALREADY_EXISTS: reconcile previous attempt before retrying'; end if;"]
    # Check live-only tables too: empty phrase/history tables do not prove that
    # Preview has not already created AI jobs, observations or idempotency state.
    checks.extend(empty_target_guards(owner, tables))
    return ("select pg_advisory_xact_lock(hashtextextended('english_legacy_import',0));\n"
            "do $guard$ begin\n" + "\n".join(checks) + "\nend $guard$;\n")


def sql_assertions(owner, batch_id, manifest, tables):
    checks = []
    for table, rows in tables.items():
        checks.append(f"if (select count(*) from {table} where owner_id='{owner}') <> {len(rows)} then raise exception 'IMPORT_COUNT_MISMATCH: {table}'; end if;")
    checks.append(f"if (select coalesce(sum(jsonb_array_length(formula_cells)),0) from english_private.import_rows where owner_id='{owner}' and import_batch_id='{batch_id}') <> {manifest['formula_count']} then raise exception 'IMPORT_FORMULA_COUNT_MISMATCH'; end if;")
    for table in sorted(tables):
        short = table.removeprefix("english_private.")
        if short == "import_rows":
            continue
        checks.append(f"if exists (select 1 from english_private.import_rows r left join {table} t on t.id=r.target_id and t.owner_id=r.owner_id where r.owner_id='{owner}' and r.import_batch_id='{batch_id}' and r.target_table='{short}' and t.id is null) then raise exception 'IMPORT_ORPHAN_TARGET: {short}'; end if;")
    checks.extend([
        f"if exists (select 1 from english_private.daily_queues where owner_id='{owner}' and status <> 'legacy') then raise exception 'IMPORT_ACTIVE_LEGACY_QUEUE'; end if;",
        f"if exists (select 1 from english_private.sessions where owner_id='{owner}' and status <> 'legacy_recovery') then raise exception 'IMPORT_ACTIVE_LEGACY_SESSION'; end if;",
    ])
    return "do $verify$ begin\n" + "\n".join(checks) + "\nend $verify$;\n"
