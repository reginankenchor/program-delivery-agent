# Program Delivery Agent

[![Live Demo][demo-badge]](https://reginankenchor.github.io/program-delivery-agent/)
[![Version 1.0.0][version-badge]](docs/releases/v1.0.0.md)
[![View Workflow][workflow-badge]](https://github.com/reginankenchor/program-delivery-agent/actions/workflows/evaluate-agent.yml)

Program Delivery Agent helps technical program managers compare delivery plans with engineering records, inspect the evidence behind each finding, and decide what to follow up on.

## How it works

1. **Read the records.** Qwen3 1.7B runs in GitHub Actions and requests the mapped Jira task and GitHub milestone records through a read-only tool.
2. **Compare and validate.** Python compares the dates and verifies that the report cites the right records and dates.
3. **Explain the finding.** The model summarises the evidence and suggests a next step for human review.

Open **Agent report** in the demo and choose a project. The **Evidence** and **Execution** tabs show the records and tool calls from the saved run.

## Releases

### [v1.0.0](docs/releases/v1.0.0.md) · 19 November 2026

The first public demo uses fictional Jira and GitHub records stored in this repository to compare delivery dates across three sample RFP (Request for Proposal) projects.

| Sample project | Scenario | What the report shows |
| --- | --- | --- |
| RFP-001 · CSV Export Delivery | Dates differ | The Jira task is due November 30, 2026, and the GitHub milestone is due December 15, 2026. Confirm whether they represent the same delivery commitment. |
| RFP-002 · Documentation Preview | Dates match | Both records show December 3, 2026. |
| RFP-003 · Metrics Endpoint | Date missing | Jira shows December 10, 2026. The GitHub milestone has no due date, so there isn’t enough information to compare the dates. |

[demo-badge]: https://img.shields.io/badge/Live%20Demo-6941A5?style=flat
[version-badge]: https://img.shields.io/badge/Version%201.0.0-16756F?style=flat
[workflow-badge]: https://img.shields.io/badge/View%20Workflow-A64D6D?style=flat
