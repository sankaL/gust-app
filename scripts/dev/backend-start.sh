#!/bin/sh
set -eu

current_revision=$(
python - <<'PY'
from app.core.settings import get_settings
from app.db.engine import connection_scope
from app.db.migrations import get_current_revision

settings = get_settings()

with connection_scope(settings.database_url) as connection:
    print(get_current_revision(connection) or "")
PY
)

head_revision=$(
python - <<'PY'
from alembic.config import Config
from alembic.script import ScriptDirectory

config = Config("alembic.ini")
print(ScriptDirectory.from_config(config).get_current_head() or "")
PY
)

if [ "$current_revision" != "$head_revision" ]; then
    if [ -n "$current_revision" ]; then
        echo "Upgrading database from $current_revision to $head_revision."
    else
        echo "Initializing database to $head_revision."
    fi
    alembic upgrade head
else
    echo "Database already at Alembic revision $head_revision."
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
