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
