"""Serialize Alembic across independent API and worker pre-deploy hooks."""

import subprocess
import sys

import psycopg
from sqlalchemy.engine import make_url

from .config import settings


def main():
    url = make_url(settings().database_url).set(drivername="postgresql")
    # A dedicated session holds this lock until the subprocess completes.
    with psycopg.connect(
        url.render_as_string(hide_password=False), autocommit=True
    ) as conn:
        conn.execute("SELECT pg_advisory_lock(8734032187)")
        try:
            subprocess.run(
                [sys.executable, "-m", "alembic", "upgrade", "head"], check=True
            )
        finally:
            conn.execute("SELECT pg_advisory_unlock(8734032187)")


if __name__ == "__main__":
    main()
