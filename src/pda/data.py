"""Explicitly mapped, repository-owned snapshots. No live API connector yet."""
import json
from datetime import date, datetime
from pathlib import Path


def load_json(path):
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def source_path(root, relative):
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root / "data") or path.suffix != ".json":
        raise ValueError("Source records must be JSON files inside this repository's data directory.")
    return path


def load_projects(root):
    projects = load_json(Path(root) / "data/projects.json")["projects"]
    ids = [project["id"] for project in projects]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate project IDs.")
    for project in projects:
        if set(project["sources"]) != {"github", "jira"}:
            raise ValueError("Each project must explicitly map GitHub and Jira sources.")
        if project.get("origin") != "fictional_fixture":
            raise ValueError("This experiment only accepts explicitly fictional fixtures.")
        for relative in project["sources"].values():
            source_path(root, relative)
    return projects


def record_date(source, response):
    if source == "jira":
        raw = response.get("fields", {}).get("duedate")
        if raw is None:
            return None
        return date.fromisoformat(raw).isoformat()
    if source == "github":
        raw = response.get("due_on")
        if raw is None:
            return None
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date().isoformat()
    raise ValueError("Unsupported provider.")


def read_record(root, project, source):
    if source not in {"github", "jira"}:
        raise ValueError("Only the mapped GitHub and Jira providers may be read.")
    relative = project["sources"][source]
    response = load_json(source_path(root, relative))
    return {
        "record_id": project["id"] + ":" + source,
        "provider": source,
        "origin": "fictional_fixture",
        "file": relative,
        "date_field": "due_on" if source == "github" else "fields.duedate",
        "date_meaning": "milestone due date" if source == "github" else "task due date",
        "normalized_target_date": record_date(source, response),
        "response": response,
    }
