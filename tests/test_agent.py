import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pda.agent import investigate, validate_report, final_instruction
from pda.data import load_projects, read_record, record_date, source_path
from pda.run import evaluate, main

ROOT = Path(__file__).resolve().parents[1]


def calls(sources=("github", "jira"), name="read_delivery_record"):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"function": {"name": name, "arguments": {"source": source}}} for source in sources
    ]}


class StubClient:
    """Unit-test stand-in. These tests do not exercise actual model inference."""
    model = "unit-test-stub"

    def chat(self, messages, final=False):
        if not final:
            return calls()
        records = [json.loads(m["content"]) for m in messages if m["role"] == "tool"]
        dates = [r["normalized_target_date"] for r in records]
        status = "insufficient_data" if None in dates else "aligned" if dates[0] == dates[1] else "potential_mismatch"
        report = {
            "status": status, "finding": "Test fixture interpretation.",
            "evidence": [{"record_id": r["record_id"], "target_date": r["normalized_target_date"]} for r in records],
            "uncertainty": "Task and milestone dates can have different meanings.",
            "recommended_action": "Confirm the delivery commitment with the owner.",
        }
        return {"role": "assistant", "content": json.dumps(report)}


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.projects = load_projects(ROOT)
        self.project = self.projects[0]
        self.records = {s: read_record(ROOT, self.project, s) for s in ["github", "jira"]}
        self.result = investigate(ROOT, self.project, StubClient())

    def test_three_explicit_project_mappings(self):
        self.assertEqual(len(self.projects), 3)
        self.assertEqual({p["id"] for p in self.projects}, {"RFP-001", "RFP-002", "RFP-003"})

    def test_raw_records_are_separate_provider_files(self):
        self.assertIn("due_on", self.records["github"]["response"])
        self.assertIn("fields", self.records["jira"]["response"])
        self.assertEqual(self.records["jira"]["file"], "data/jira/rfp-001.json")

    def test_source_path_cannot_escape_data(self):
        with self.assertRaises(ValueError):
            source_path(ROOT, "../secrets.json")
        with self.assertRaises(ValueError):
            source_path(ROOT, "tests/expected.json")

    def test_unmapped_provider_rejected(self):
        with self.assertRaises(ValueError):
            read_record(ROOT, self.project, "other")

    def test_missing_date_stays_null(self):
        self.assertIsNone(read_record(ROOT, self.projects[2], "github")["normalized_target_date"])

    def test_invalid_dates_rejected(self):
        with self.assertRaises(ValueError):
            record_date("jira", {"fields": {"duedate": "2026-02-31"}})

    def test_valid_mocked_tool_loop(self):
        self.assertTrue(self.result["validation"]["passed"])
        self.assertEqual(sum("executed_tool" in t for t in self.result["trace"]), 2)

    def test_source_ids_do_not_leak_between_projects(self):
        result = investigate(ROOT, self.projects[1], StubClient())
        self.assertTrue(all(e["record_id"].startswith("RFP-002:") for e in result["report"]["evidence"]))

    def test_fabricated_reference_rejected(self):
        report = copy.deepcopy(self.result["report"])
        report["evidence"][0]["record_id"] = "RFP-999:github"
        self.assertFalse(validate_report(report, self.records)["exact_source_references"])

    def test_incorrect_quoted_date_rejected(self):
        report = copy.deepcopy(self.result["report"])
        report["evidence"][0]["target_date"] = "2099-01-01"
        self.assertFalse(validate_report(report, self.records)["quoted_dates_match_sources"])

    def test_duplicate_citation_rejected(self):
        report = copy.deepcopy(self.result["report"])
        report["evidence"][1] = report["evidence"][0].copy()
        self.assertFalse(validate_report(report, self.records)["exact_source_references"])

    def test_invalid_evidence_shape_does_not_pass(self):
        report = copy.deepcopy(self.result["report"])
        report["evidence"][0] = "not an evidence record"
        self.assertFalse(validate_report(report, self.records)["exact_source_references"])

    def test_unknown_status_rejected(self):
        report = copy.deepcopy(self.result["report"])
        report["status"] = "definitely_late"
        self.assertFalse(validate_report(report, self.records)["status_valid"])

    def test_empty_uncertainty_rejected(self):
        report = copy.deepcopy(self.result["report"])
        report["uncertainty"] = " "
        self.assertFalse(validate_report(report, self.records)["required_text_present"])

    def test_no_tool_answer_is_not_accepted(self):
        class NoTools:
            def chat(self, *args, **kwargs):
                return {"role": "assistant", "content": "Everything is fine."}
        result = investigate(ROOT, self.project, NoTools(), max_turns=2)
        self.assertFalse(result["validation"]["passed"])
        self.assertFalse(result["validation"]["checks"]["model_executed_tools"])

    def test_write_tool_is_rejected(self):
        class Writes:
            def chat(self, *args, **kwargs):
                return calls(name="update_ticket")
        result = investigate(ROOT, self.project, Writes())
        self.assertIn("allowlist", result["validation"]["error"])
        self.assertFalse(result["validation"]["passed"])

    def test_wrong_classification_fails_even_with_valid_evidence(self):
        result = copy.deepcopy(self.result)
        result["report"]["status"] = "aligned"
        checks = validate_report(result["report"], self.records)
        self.assertFalse(checks["status_matches_source_dates"])
        result["validation"]["checks"] = checks
        result["validation"]["passed"] = all(checks.values())
        self.assertFalse(evaluate(result, "potential_mismatch")["passed"])

    def test_aligned_rejected_when_a_source_date_is_missing(self):
        project = self.projects[2]
        result = investigate(ROOT, project, StubClient())
        result["report"]["status"] = "aligned"
        records = {s: read_record(ROOT, project, s) for s in ("github", "jira")}
        self.assertFalse(validate_report(result["report"], records)["status_matches_source_dates"])

    def test_raw_github_timestamp_is_still_rejected(self):
        report = copy.deepcopy(self.result["report"])
        report["evidence"][0]["target_date"] = self.records["github"]["response"]["due_on"]
        self.assertFalse(validate_report(report, self.records)["quoted_dates_match_sources"])

    def test_final_instruction_uses_normalized_evidence(self):
        prompt = final_instruction(self.records)
        self.assertIn('"target_date": "2026-12-15"', prompt)
        self.assertIn('"target_date": "2026-11-30"', prompt)
        self.assertNotIn('"target_date": "2026-12-15T00:00:00Z"', prompt)

    def test_failed_report_is_retried_with_feedback_and_not_overwritten(self):
        class InitiallyWrong(StubClient):
            def __init__(self):
                self.attempts, self.prompts = 0, []

            def chat(self, messages, final=False):
                message = super().chat(messages, final)
                if final:
                    self.attempts += 1
                    self.prompts.append(messages[-1]["content"])
                    if self.attempts == 1:
                        report = json.loads(message["content"])
                        report["status"] = "aligned"
                        report["evidence"][0]["target_date"] += "T00:00:00Z"
                        message["content"] = json.dumps(report)
                return message

        client = InitiallyWrong()
        result = investigate(ROOT, self.project, client)
        self.assertTrue(result["validation"]["passed"])
        self.assertEqual(client.attempts, 2)
        self.assertIn("status_matches_source_dates", client.prompts[1])
        self.assertIn("quoted_dates_match_sources", client.prompts[1])
        attempts = [t for t in result["trace"] if "report_attempt" in t]
        self.assertFalse(attempts[0]["validation"]["status_matches_source_dates"])
        self.assertTrue(attempts[1]["validation"]["status_matches_source_dates"])
        answers = [json.loads(t["model_message"]["content"])
                   for t in result["trace"] if "model_message" in t
                   and not t["model_message"].get("tool_calls")]
        self.assertEqual(answers[0]["status"], "aligned")
        self.assertEqual(result["report"]["status"], "potential_mismatch")

    def test_persistently_wrong_model_fails_after_two_reports(self):
        class AlwaysWrong(StubClient):
            attempts = 0

            def chat(self, messages, final=False):
                message = super().chat(messages, final)
                if final:
                    self.attempts += 1
                    report = json.loads(message["content"])
                    report["status"] = "aligned"
                    message["content"] = json.dumps(report)
                return message

        client = AlwaysWrong()
        result = investigate(ROOT, self.project, client)
        self.assertEqual(client.attempts, 2)
        self.assertFalse(result["validation"]["passed"])
        self.assertEqual(result["report"]["status"], "aligned")
        self.assertIn("two attempts", result["validation"]["error"])

    def test_invalid_json_can_be_corrected_once(self):
        class BadJSON(StubClient):
            attempts = 0

            def chat(self, messages, final=False):
                if final:
                    self.attempts += 1
                    if self.attempts == 1:
                        return {"role": "assistant", "content": "not JSON"}
                return super().chat(messages, final)

        client = BadJSON()
        result = investigate(ROOT, self.project, client)
        self.assertTrue(result["validation"]["passed"])
        self.assertEqual(client.attempts, 2)

    def test_positive_clean_and_missing_data_cases(self):
        expectations = json.loads((ROOT / "tests/expected.json").read_text())
        for project in self.projects:
            result = investigate(ROOT, project, StubClient())
            self.assertTrue(evaluate(result, expectations[project["id"]])["passed"])

    def test_cli_preserves_all_reports_and_traces(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            with patch("pda.run.OllamaClient", StubClient), patch("sys.argv", ["pda", "--output", temp]):
                self.assertEqual(main(), 0)
            report = json.loads((Path(temp) / "report.json").read_text())
            self.assertEqual(len(report["projects"]), 3)
            self.assertEqual(report["model"], "unit-test-stub")
            self.assertTrue((Path(temp) / "RFP-001-trace.json").exists())


if __name__ == "__main__":
    unittest.main()
