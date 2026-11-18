"""Run selected RFPs, validate evidence, and compare outcomes with test expectations."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from .agent import OllamaClient, investigate
from .data import load_json, load_projects


def evaluate(result, expected):
    actual = result["report"].get("status") if isinstance(result["report"], dict) else None
    checks = {
        "evidence_validation_passed": result["validation"]["passed"],
        "classification_matches_expected": actual == expected,
    }
    return {"passed": all(checks.values()), "checks": checks, "expected_status": expected, "actual_status": actual,
            "scope": "Controlled date-consistency classification and citation checks. Narrative quality needs human review."}


def safe_text(value):
    # Keep source/model content from breaking the generated Markdown code fence.
    return str(value).replace("```", "~~~")


def markdown(results, evaluation):
    parts = ["# Program Delivery Agent — sample evaluation", "",
             "Real model/tool execution on repository-owned fictional records. No live Jira/GitHub connector.", "",
             "| Project | Evidence validation | Expected-case evaluation |", "| --- | --- | --- |"]
    for result in results:
        ident = result["project_id"]
        parts.append(f"| {ident} | {'PASS' if result['validation']['passed'] else 'FAIL'} | "
                     f"{'PASS' if evaluation[ident]['passed'] else 'FAIL'} |")
    for result in results:
        parts.extend(["", "## " + result["project_id"] + " — " + result["project_name"], ""])
        if not result["validation"]["passed"]:
            parts.extend(["**Not accepted: evidence validation failed.**", "", "```text",
                          safe_text(result["validation"]["error"] or result["validation"]["checks"]), "```"])
        else:
            report = result["report"]
            parts.extend(["Status: **" + report["status"] + "**", "", "### Finding", "", "```text", safe_text(report["finding"]), "```", "", "### Evidence", ""])
            parts.extend("- `" + item["record_id"] + "`: " + (item["target_date"] or "No date supplied") for item in report["evidence"])
            parts.extend(["", "### Uncertainty", "", "```text", safe_text(report["uncertainty"]), "```", "", "### Recommended action", "", "```text", safe_text(report["recommended_action"]), "```"])
        parts.extend(["", f"Elapsed: {result['elapsed_seconds']} seconds."])
    parts.extend(["", "Passing these cases does not establish production reliability or correctness on other tasks."])
    return "\n".join(parts) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--projects", default="all", help="all or comma-separated RFP IDs")
    parser.add_argument("--output", default="reports")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    projects = load_projects(root)
    wanted = {p["id"] for p in projects} if args.projects == "all" else set(args.projects.split(","))
    if not wanted or not wanted <= {p["id"] for p in projects}:
        parser.error("Unknown or empty project selection.")
    projects = [p for p in projects if p["id"] in wanted]
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    expected = load_json(root / "tests/expected.json")
    client = OllamaClient()
    results, evaluations = [], {}
    for project in projects:
        print("Investigating " + project["id"], flush=True)
        result = investigate(root, project, client)
        results.append(result)
        evaluations[project["id"]] = evaluate(result, expected[project["id"]])
        (out / (project["id"] + "-trace.json")).write_text(json.dumps(result["trace"], indent=2))
        (out / (project["id"] + "-result.json")).write_text(json.dumps(result, indent=2))
        print(json.dumps({"project": project["id"], **evaluations[project["id"]]}), flush=True)
    passed = all(e["passed"] for e in evaluations.values())
    combined = {"origin": "fictional_fixture", "model": client.model,
                "generated_at": datetime.now(timezone.utc).isoformat(), "passed": passed,
                "projects": results, "evaluation": evaluations}
    (out / "report.json").write_text(json.dumps(combined, indent=2))
    (out / "evaluation.json").write_text(json.dumps(evaluations, indent=2))
    report_md = markdown(results, evaluations)
    (out / "report.md").write_text(report_md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        Path(os.environ["GITHUB_STEP_SUMMARY"]).write_text(report_md)
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
