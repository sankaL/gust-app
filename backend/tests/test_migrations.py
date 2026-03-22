from pathlib import Path

from sqlalchemy import create_engine, text

from app.db.migrations import check_required_revision, get_current_revision


def test_get_current_revision_returns_none_when_alembic_table_is_missing() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")

    with engine.begin() as connection:
        assert get_current_revision(connection) is None


def test_check_required_revision_accepts_matching_revision(tmp_path: Path) -> None:
    database_path = tmp_path / "gust.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    engine = create_engine(database_url)

    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        connection.execute(
            text("INSERT INTO alembic_version (version_num) VALUES ('0001_phase0_baseline')")
        )

    check_required_revision(database_url, "0001_phase0_baseline")
