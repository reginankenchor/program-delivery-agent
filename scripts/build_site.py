"""Build a static report viewer from an actual, successful agent report. Standard library only."""
import argparse
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def validate_input(report):
    if not isinstance(report, dict) or report.get('origin') != 'fictional_fixture':
        raise ValueError('Only repository-owned fictional-fixture reports are supported.')
    if report.get('model') in (None, '', 'unit-test-stub'):
        raise ValueError('An actual-model report is required, not unit-test output.')
    if report.get('provenance', {}).get('source_type') == 'shared_run_summary':
        raise ValueError('Build from the original agent artifact, not the transcribed preview summary.')
    projects = report.get('projects')
    if report.get('passed') is not True or not isinstance(projects, list) or not projects:
        raise ValueError('Build requires a successful, non-empty evaluation.')
    evaluations = report.get('evaluation', {})
    for project in projects:
        ident = project.get('project_id')
        if not project.get('validation', {}).get('passed') or not evaluations.get(ident, {}).get('passed'):
            raise ValueError('A project has not passed validation and expected-case evaluation.')
        if not isinstance(project.get('report'), dict) or not project.get('trace'):
            raise ValueError('A model report and original execution trace are required for each project.')


def build(report_path, output_path, template=None):
    report_path, output_path = Path(report_path).resolve(), Path(output_path).resolve()
    template = Path(template or ROOT / 'site').resolve()
    # Prevent a user-supplied output path from overwriting source or the input artifact.
    if output_path == ROOT or output_path in ROOT.parents or output_path.is_relative_to(template) or template.is_relative_to(output_path):
        raise ValueError('Output must be separate from the repository root and site template.')
    if report_path.is_relative_to(output_path):
        raise ValueError('Output must not contain the input report.')
    if output_path.exists() and (not output_path.is_dir() or any(output_path.iterdir())):
        raise ValueError('Choose a new or empty output directory; existing files are not deleted.')
    if report_path.stat().st_size > 5 * 1024 * 1024:
        raise ValueError('Report exceeds the browser viewer limit of 5 MB.')
    report = json.loads(report_path.read_text(encoding='utf-8'))
    validate_input(report)
    shutil.copytree(template, output_path, dirs_exist_ok=True)
    (output_path / 'data' / 'latest-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    (output_path / '.nojekyll').touch()
    print('Built website with original model report and traces at ' + str(output_path))
    return output_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', default='reports/report.json')
    parser.add_argument('--output', default='_site')
    args = parser.parse_args()
    build(args.report, args.output)


if __name__ == '__main__':
    main()
