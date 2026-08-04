#!/usr/bin/python3
"""Write one sanitized MCC updater status transition atomically."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

STATES = {
    "idle",
    "checking",
    "update_available",
    "queued",
    "backing_up",
    "stopping",
    "pulling",
    "installing_dependencies",
    "building",
    "starting",
    "health_check",
    "succeeded",
    "rolling_back",
    "rolled_back",
    "failed",
}
TERMINAL = {"succeeded", "rolled_back", "failed"}
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
COMMIT = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)


def clean(value: str, maximum: int = 240) -> str:
    return re.sub(r"\s+", " ", value).strip()[:maximum]


def optional_version(value: str) -> str | None:
    return value if SEMVER.fullmatch(value) else None


def optional_commit(value: str) -> str | None:
    return value.lower() if COMMIT.fullmatch(value) else None


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_existing(status_path: Path) -> dict:
    try:
        value = json.loads(status_path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) and value.get("schemaVersion") == 1 else {}
    except (OSError, ValueError, TypeError):
        return {}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status-path", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--state", required=True, choices=sorted(STATES))
    parser.add_argument("--message", required=True)
    parser.add_argument("--installed-version", default="")
    parser.add_argument("--installed-commit", default="")
    parser.add_argument("--target-version", default="")
    parser.add_argument("--target-commit", default="")
    parser.add_argument("--requester-id", type=int, default=0)
    parser.add_argument("--requester-name", default="Manual root operator")
    parser.add_argument("--outcome", choices=("none", "succeeded", "rolled_back", "failed"), default="none")
    args = parser.parse_args()

    status_path = Path(args.status_path)
    status_path.parent.mkdir(parents=True, exist_ok=True)
    existing = read_existing(status_path)
    timestamp = iso_now()
    events = existing.get("events", [])
    if not isinstance(events, list):
        events = []
    event = {
        "id": f"{clean(args.job_id, 120)}:{args.state}:{timestamp}",
        "state": args.state,
        "at": timestamp,
        "message": clean(args.message),
    }
    events = [item for item in events if isinstance(item, dict)][-79:] + [event]
    started_at = existing.get("startedAt") if existing.get("jobId") == args.job_id else timestamp
    status = {
        "schemaVersion": 1,
        "jobId": clean(args.job_id, 120),
        "state": args.state,
        "code": args.state if args.state in TERMINAL else ("queued" if args.state == "queued" else "update_available" if args.state == "update_available" else "checking"),
        "message": clean(args.message),
        "mode": "raspberry_pi",
        "environmentLabel": "RASPBERRY PI PRODUCTION",
        "installed": {
            "version": optional_version(args.installed_version),
            "commit": optional_commit(args.installed_commit),
        },
        "target": {
            "version": optional_version(args.target_version),
            "commit": optional_commit(args.target_commit),
        },
        "startedAt": started_at,
        "lastUpdatedAt": timestamp,
        "completedAt": timestamp if args.state in TERMINAL else None,
        "requester": {
            "id": max(0, args.requester_id),
            "name": clean(args.requester_name, 120),
        },
        "outcome": args.outcome,
        "checkToken": None,
        "checkExpiresAt": None,
        "events": events,
    }
    descriptor, temporary_name = tempfile.mkstemp(prefix=".status.", suffix=".tmp", dir=status_path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(status, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, 0o640)
        os.replace(temporary_name, status_path)
        os.chmod(status_path, 0o640)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


if __name__ == "__main__":
    main()
