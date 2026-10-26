from __future__ import annotations

import os
import subprocess
from pathlib import Path


def test_railway_fallback_uses_service_root_contracts() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    environment = os.environ.copy()
    environment["DRY_RUN"] = "true"
    environment["CI"] = "true"

    result = subprocess.run(
        [
            "bash",
            "scripts/prod/deploy-railway-prod.sh",
            "backend",
            "frontend",
            "digest-daily-cron",
        ],
        cwd=repo_root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "DRY RUN: railway up -s backend" in result.stdout
    assert "DRY RUN: railway up -s frontend" in result.stdout
    assert "railway up backend --path-as-root" not in result.stdout
    assert "railway up frontend --path-as-root" not in result.stdout
    assert (
        "railway up deploy/digest-daily-cron --path-as-root -s digest-daily-cron"
        in result.stdout
    )


def test_railway_up_failure_prints_cli_error(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    fake_railway = tmp_path / "railway"
    fake_railway.write_text(
        "#!/usr/bin/env bash\n"
        "echo 'Unauthorized. Please check that your RAILWAY_TOKEN is valid.' >&2\n"
        "exit 1\n"
    )
    fake_railway.chmod(0o755)

    environment = os.environ.copy()
    environment["CI"] = "true"
    environment["RAILWAY_TOKEN"] = "test-project-token"
    environment["PATH"] = f"{tmp_path}{os.pathsep}{environment['PATH']}"

    result = subprocess.run(
        ["bash", "scripts/prod/deploy-railway-prod.sh", "backend"],
        cwd=repo_root,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "Unauthorized. Please check that your RAILWAY_TOKEN is valid." in result.stdout
    assert "railway up failed for backend (exit 1)" in result.stderr
