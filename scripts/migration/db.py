"""Explicit psql connection modes; credentials never appear in subprocess arguments."""
import os
import json
import re
import subprocess
import tempfile


def add_connection_arguments(parser):
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--database-url-env", help="Environment variable containing a direct/session-mode Postgres URL")
    group.add_argument("--pg-service", help="Named libpq service (credentials stay in service/pass files)")
    group.add_argument("--docker-container", help="Explicit local test container; no production container default")
    group.add_argument("--project-ref", help="Explicit Supabase project via authenticated CLI Management API; no DB password needed")
    parser.add_argument("--docker-database", default="postgres")
    parser.add_argument("--psql-bin", default="psql")
    parser.add_argument("--supabase-bin", default="supabase")


def connection_command(args):
    env = os.environ.copy()
    if args.database_url_env:
        value = env.get(args.database_url_env)
        if not value:
            raise ValueError("Named database URL environment variable is empty")
        env["PGDATABASE"] = value
    elif args.pg_service:
        env["PGSERVICE"] = args.pg_service
    common = ["-X", "--no-password", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1"]
    if args.docker_container:
        command = ["docker", "exec", "-i", args.docker_container, "psql", "--username", "postgres",
                   "--dbname", args.docker_database] + common
    else:
        command = [args.psql_bin] + common
    return command, env


def run_sql(args, sql, *, expect_result=True):
    if getattr(args, "project_ref", None):
        if not re.fullmatch(r"[a-z0-9]{20}", args.project_ref):
            raise ValueError("Invalid explicit Supabase project ref")
        if re.search(r"(?im)^copy .* from stdin|^\\\\set|^\\\\\.$", sql):
            raise ValueError("Management API requires import-api.sql, not psql COPY streams")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", encoding="utf-8") as query:
            query.write(sql)
            query.flush()
            command = [args.supabase_bin, "db", "query", "--linked", "--project-ref", args.project_ref,
                       "--file", query.name, "--output", "json"]
            result = subprocess.run(command, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(f"Supabase query failed (exit {result.returncode}); reconcile before retrying")
        return management_payload(result.stdout) if expect_result else ""
    command, env = connection_command(args)
    result = subprocess.run(command, input=sql, text=True, capture_output=True, env=env)
    if result.returncode:
        # psql may print source answers/COPY rows in an error. Keep them out of terminal output.
        raise RuntimeError(f"Postgres command failed (exit {result.returncode}); no successful write is claimed. Reconcile before retrying.")
    return result.stdout.strip()


def management_payload(stdout):
    """Observed CLI 2.116 JSON envelope. Its warning/boundary fields are data only."""
    envelope = json.loads(stdout)
    if not isinstance(envelope, dict) or not isinstance(envelope.get("rows"), list):
        raise ValueError("Unexpected Supabase CLI JSON shape; no success is assumed")
    rows = envelope["rows"]
    if not rows:
        return ""
    if len(rows) != 1 or not isinstance(rows[0], dict) or len(rows[0]) != 1:
        raise ValueError("Expected one JSON result column from Supabase CLI")
    return json.dumps(next(iter(rows[0].values())), ensure_ascii=False)
