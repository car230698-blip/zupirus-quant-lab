"""Run PostgreSQL client tools locally or inside the selected Compose service."""
import subprocess


def run(tool, *args, database_url=None, database=None, **kwargs):
    if database_url and database:
        raise ValueError("Use either a database URL or a Compose database name.")
    if database_url:
        command = [tool, *args]
        if not (tool == "pg_restore" and "--list" in args):
            command.extend(("--dbname", database_url))
    else:
        command = [
            "docker", "compose", "exec", "-T", "timescaledb", "sh", "-ec",
            'export PGPASSWORD="$POSTGRES_PASSWORD"; '
            'target=${1:-$POSTGRES_DB}; shift; tool=$1; shift; '
            'if [ "$tool" = pg_restore ] && [ "${1:-}" = --list ]; then exec "$tool" "$@"; fi; '
            'exec "$tool" -U "$POSTGRES_USER" -d "$target" "$@"',
            "postgres-tools", database or "", tool, *args,
        ]
    try:
        return subprocess.run(command, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"{tool} exited with status {error.returncode}.") from None
    except FileNotFoundError:
        dependency = tool if database_url else "Docker Compose"
        raise RuntimeError(f"{dependency} is required for this connection mode.") from None
