"""Real PostgreSQL checks in a NEW local-only disposable cluster, never an app DB.

Uses installed PostgreSQL and Python stdlib only. No URL/credential/database
arguments, Supabase login/link/reset, Docker, downloads, or existing data dirs.
Artifacts remain in the printed OS temp directory; the owned server is stopped.
"""
from pathlib import Path
import argparse
import json
import os
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20261101182121_historical_enrollment_foundation.sql"
PG = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "PostgreSQL/18/bin"
BOOTSTRAP = """
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_admin nologin;
create schema extensions;
create schema auth;
create schema storage;
create table auth.users (
 id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
 raw_app_meta_data jsonb default '{}', email_confirmed_at timestamptz,
 encrypted_password text, aud text, role text
);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')
$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;
"""

def concurrent_history_check(database, sql, env, artifact, log):
    """Two real sessions race the same student; fixed snapshots fail closed."""
    payload = json.dumps({
        "school_id": "62000000-0000-4000-8000-000000000001",
        "student_id": "67000000-0000-4000-8000-000000000004",
        "term_id": "66000000-0000-4000-8000-000000000003",
        "evidence_state": "confirmed", "school_state": "enrolled",
        "coverage_kind": "whole_term", "start_precision": "term_start",
        "end_precision": "term_end", "source_type": "class_register",
        "source_reference": "FICTIONAL-CONCURRENCY", "reason": "Fictional concurrency check",
    })
    append = "select public.append_enrollment_history('school','" + payload + "'::jsonb);"
    identity = "select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true); set local role authenticated;"
    command = [str(PG / "psql.exe"), "-X", "--no-password", "-v", "ON_ERROR_STOP=1",
               "-v", "VERBOSITY=verbose", "-h", "127.0.0.1", "-p", env["PGPORT"],
               "-U", "postgres", "-d", database, "-At", "-c"]
    holder_sql = "set application_name='iupc_phase2a_holder'; begin;" + identity + append + "select pg_sleep(2);commit;"
    with (artifact / (database + "-holder.out")).open("w") as stdout, (artifact / (database + "-holder.err")).open("w") as stderr:
        holder = subprocess.Popen(command + [holder_sql], env=env, stdout=stdout, stderr=stderr)
        try:
            for _ in range(30):
                if sql(database, "select exists(select 1 from pg_stat_activity where application_name='iupc_phase2a_holder' and wait_event='PgSleep')").strip() == "t":
                    break
                if holder.poll() is not None:
                    raise AssertionError("Holder failed before acquiring test lock")
                time.sleep(0.05)
            else:
                raise AssertionError("Holder did not reach the controlled wait")
            contender = subprocess.run(command + ["begin;" + identity + append + "commit;"],
                                       env=env, capture_output=True, text=True, timeout=15)
            assert contender.returncode != 0 and "23514" in contender.stderr, contender.stderr
            assert holder.wait(timeout=10) == 0
            log.append({"test": "two-session overlap", "database": database, "blocked": contender.stderr})
        finally:
            if holder.poll() is None:
                holder.terminate()
                holder.wait(timeout=10)
    assert sql(database, "select count(*) from public.student_school_enrollment_history").strip() == "1"
    for isolation in ("repeatable read", "serializable"):
        fixed = subprocess.run(command + ["begin isolation level " + isolation + ";" + identity + append + "commit;"],
                               env=env, capture_output=True, text=True, timeout=15)
        assert fixed.returncode != 0 and "25001" in fixed.stderr, fixed.stderr
        log.append({"test": isolation + " fails closed", "database": database, "result": fixed.stderr})
    print("CONCURRENCY=passed; REPEATABLE_READ=denied; SERIALIZABLE=denied", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema-only", action="store_true")
    args = parser.parse_args()
    for tool in ("initdb.exe", "pg_ctl.exe", "psql.exe"):
        if not (PG / tool).is_file():
            raise SystemExit("Installed PostgreSQL binaries unavailable; no database tests executed.")
    artifact = Path(tempfile.mkdtemp(prefix="iupc-phase2a-disposable-"))
    data = artifact / "data"  # Must not exist; initdb creates a fresh cluster.
    marker = artifact / "DISPOSABLE_IUPC_PHASE2A.txt"
    marker.write_text("Created by verify-enrollment-history.py; fictional test data only.", encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(PGHOST="127.0.0.1", PGUSER="postgres", PGDATABASE="postgres",
               PGPASSFILE=str(artifact / "no-password-file"), PGSSLMODE="disable",
               PGCONNECT_TIMEOUT="5", PGCLIENTENCODING="UTF8")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env["PGPORT"] = str(port)
    log = []

    def run(command, timeout=60):
        # File redirection avoids Windows background-server descendants keeping
        # a captured stdout pipe open after pg_ctl has exited.
        stdout_path = artifact / "command.stdout"
        stderr_path = artifact / "command.stderr"
        with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
            result = subprocess.run([str(x) for x in command], env=env, cwd=ROOT,
                                    stdout=stdout, stderr=stderr, timeout=timeout)
        result.stdout = stdout_path.read_text(encoding="utf-8", errors="replace")
        result.stderr = stderr_path.read_text(encoding="utf-8", errors="replace")
        log.append({"command": [str(x) for x in command], "returncode": result.returncode,
                    "stdout": result.stdout, "stderr": result.stderr})
        if result.returncode:
            raise RuntimeError(result.stderr or result.stdout)
        return result.stdout

    def sql(database, text=None, file=None, atomic=False):
        command = [PG / "psql.exe", "-X", "--no-password", "-v", "ON_ERROR_STOP=1",
                   "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "-d", database]
        if atomic:
            command.append("--single-transaction")
        command += ["-f", file] if file else ["-At", "-c", text]
        return run(command)

    started = False
    try:
        assert marker.is_file() and not data.exists()
        if os.name == "nt":
            # initdb drops elevated Administrator group rights on Windows.
            # Grant only this freshly created FICTIONAL cluster directory to
            # the local Users group; never change an existing directory's ACL.
            run(["icacls.exe", artifact, "/grant", "*S-1-5-32-545:(OI)(CI)M"])
        run([PG / "initdb.exe", "-D", data, "-U", "postgres", "-A", "trust",
             "--no-locale", "--encoding=UTF8"])
        run([PG / "pg_ctl.exe", "-D", data, "-l", artifact / "postgres.log",
             "-o", f"-h 127.0.0.1 -p {port}", "-w", "start"])
        started = True
        for name in ("iupc_phase2a_a", "iupc_phase2a_b"):
            sql("postgres", f"create database {name}")
            # Roles are cluster-global; schemas/auth stubs are database-local.
            bootstrap = BOOTSTRAP if name.endswith("_a") else BOOTSTRAP[BOOTSTRAP.index("create schema extensions;"):]
            sql(name, bootstrap)
            for migration in sorted(MIGRATION.parent.glob("*.sql")):
                if migration.name >= MIGRATION.name:
                    continue
                sql(name, file=migration, atomic=True)
            fixture = ROOT / "supabase/tests/fixtures/enrollment-history-baseline.sql"
            sql(name, file=fixture)
            snapshot_query = """
              select jsonb_build_object(
                'students',(select jsonb_agg(to_jsonb(s) order by id) from public.students s),
                'student_subjects',(select jsonb_agg(to_jsonb(s) order by student_id,subject_id) from public.student_subjects s),
                'classes',(select jsonb_agg(to_jsonb(c) order by id) from public.classes c),
                'subjects',(select jsonb_agg(to_jsonb(s) order by id) from public.subjects s),
                'terms',(select jsonb_agg(to_jsonb(t) order by id) from public.terms t),
                'report_cards',(select jsonb_agg(to_jsonb(r) order by id) from public.report_cards r),
                'revisions',(select jsonb_agg(to_jsonb(r) order by id) from public.mark_revisions r),
                'receipts',(select jsonb_agg(to_jsonb(r) order by request_id) from public.write_receipts r),
                'marks',(select jsonb_agg(to_jsonb(m) order by id) from public.marks m),
                'exams',(select jsonb_agg(to_jsonb(e) order by id) from public.exams e)
              )::text
            """
            before = sql(name, snapshot_query)
            sql(name, file=MIGRATION, atomic=True)
            assert before == sql(name, snapshot_query), "Existing fixture records changed by migration"
            count = sql(name, """
              select (select count(*) from public.student_school_enrollment_history)
                 + (select count(*) from public.student_class_enrollment_history)
                 + (select count(*) from public.student_subject_enrollment_history)
            """).strip()
            assert count == "0", "Migration must not backfill history"
            if not args.schema_only:
                output = sql(name, file=ROOT / "supabase/tests/enrollment_history.test.sql")
                print(next(line.strip() for line in output.splitlines() if line.strip().startswith("PHASE2A_ASSERTIONS=")), flush=True)
                assert before == sql(name, snapshot_query), "History tests changed existing fixture records"
                concurrent_history_check(name, sql, env, artifact, log)
            print(f"{name}: prior chain + additive migration; unchanged legacy rows; zero backfill; checks passed", flush=True)
        print("DISPOSABLE_CLUSTER_ARTIFACTS=" + str(artifact))
    finally:
        if started:
            assert marker.read_text(encoding="utf-8").startswith("Created by verify-enrollment-history.py")
            run([PG / "pg_ctl.exe", "-D", data, "-m", "fast", "-w", "stop"])
        (artifact / "verification.json").write_text(json.dumps(log, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
