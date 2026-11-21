import {
  STATUSES,
  escapeHTML as e,
  normalizeRun,
  getProject,
  projectStatus,
  summarize,
  filterProjects,
  evidenceFor,
  sourceRecord,
  executionSummary
} from './model.mjs';

const REPO = 'https://github.com/reginankenchor/program-delivery-agent';
const WORKFLOW = REPO + '/actions/workflows/evaluate-agent.yml';

let run;
let originalRun;
let fixtures = {};
let imported = false;
let search = '';
let toastTimer;

const page = document.getElementById('page');
const title = document.getElementById('pageLabel');
const fileInput = document.getElementById('reportFile');
const demoRun = document.getElementById('demoRun');

function toast(text, error = false) {
  const element = document.getElementById('toast');
  element.textContent = text;
  element.className = error ? 'show toast-error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.className = '';
  }, 6500);
}

function btn(label, url, primary = false) {
  const external = url.startsWith('https:')
    ? ' target="_blank" rel="noopener noreferrer"'
    : '';
  return `<a class="btn${primary ? ' primary' : ''}" href="${e(url)}"${external}>${e(label)}</a>`;
}

function badge(status) {
  return `<span class="tag ${STATUSES[status].tone}">${e(STATUSES[status].label)}</span>`;
}

function dateLabel(date) {
  return date ?? 'No date supplied';
}

function labelRun() {
  if (imported) return 'Imported agent report';
  if (run.provenance?.commit_short) return 'Run ' + run.provenance.commit_short;
  return 'Saved agent report';
}

function isSummary() {
  return !imported && run.provenance?.source_type === 'shared_run_summary';
}

function originNote() {
  if (isSummary()) {
    return `
      <div class="summarynote">
        <p><b>From your successful GitHub run.</b> These findings were transcribed
        from the run summary you shared (${e(run.provenance.commit_short)}).
        Import the artifact’s <code>report.json</code> to inspect the original
        tool calls and validation attempts.</p>
      </div>`;
  }

  return `
    <div class="summarynote">
      <p><b>${imported ? 'Imported' : 'Saved'} agent report.</b>
      ${e(run.model)} · ${run.generated_at ? e(run.generated_at) : 'Run timestamp not supplied'}.
      Findings are model-generated; passing automated checks does not replace
      technical review.</p>
    </div>`;
}

function pageHead(eyebrow, heading, subtitle, actions = '') {
  return `
    <div class="pagehead">
      <div>
        <div class="eyebrow">${e(eyebrow)}</div>
        <h1>${e(heading)}</h1>
        <p class="subtitle">${e(subtitle)}</p>
      </div>
      <div class="btnrow">${actions}</div>
    </div>`;
}

function filterLinks(current = 'all', prefix = 'report') {
  const counts = summarize(run);
  const filters = [
    ['all', 'All projects'],
    ...Object.entries(STATUSES)
      .filter(([key]) => key !== 'rejected' || counts.rejected)
      .map(([key, value]) => [key, value.label])
  ];

  return `
    <div class="scope-bar" aria-label="Filter findings">
      ${filters.map(([key, label]) => {
        const active = current === key;
        const query = key === 'all' ? '' : '?status=' + key;
        return `<a class="${active ? 'active' : ''}"
          href="#/${prefix}${query}"${active ? ' aria-current="true"' : ''}>${e(label)}</a>`;
      }).join('')}
    </div>`;
}

function findingRow(project) {
  const status = projectStatus(run, project);

  return `
    <a class="findingrow" href="#/project/${encodeURIComponent(project.project_id)}/finding">
      <div class="findingmeta">
        <span class="filehint">${e(project.project_id)}</span>${badge(status)}
      </div>
      <h3>${e(project.project_name)}</h3>
      <p>${e(project.report?.finding || 'No accepted finding was produced.')}</p>
      <div class="hint" style="margin-top:10px">Inspect finding &amp; evidence →</div>
    </a>`;
}

function chart() {
  const counts = summarize(run);
  const total = run.projects.length;
  const groups = Object.entries(counts).filter(([, count]) => count);
  let angle = 0;

  const segments = groups.map(([status, count]) => {
    const start = angle;
    angle += count / total * 360;
    return `${STATUSES[status].color} ${start}deg ${angle}deg`;
  });

  const label = groups.map(([status, count]) =>
    `${count} ${STATUSES[status].label.toLowerCase()}`
  ).join(', ');

  return `
    <div class="card">
      <div class="cardhead"><h2>What the agent found</h2></div>
      <div class="cardbody">
        <div class="donut-ring" role="img" aria-label="${e(label)}"
          style="background:conic-gradient(${segments.join(',')})">
          <div class="donut-hole"><b>${total}</b><small>projects reviewed</small></div>
        </div>
        <div class="legend">
          ${groups.map(([status, count]) => `
            <a href="#/report?status=${status}">
              <span class="legend-label">
                <i style="background:${STATUSES[status].color}"></i>${e(STATUSES[status].label)}
              </span>
              <b>${count} →</b>
            </a>`).join('')}
        </div>
        <p class="chartnote">Date consistency only. “Dates match” is not a project
        health or delivery assurance rating.</p>
      </div>
    </div>`;
}

function workspace() {
  const counts = summarize(run);
  const stats = [
    ['potential_mismatch', 'Compare delivery commitments'],
    ['aligned', 'Matching dates; scope still needs review'],
    ['insufficient_data', 'A required source date is missing']
  ];

  page.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">YOUR AGENT WORKSPACE</div>
        <h1>Less searching.<br>Clearer delivery decisions.</h1>
        <p class="subtitle">Review how an AI agent investigates delivery plans and
        engineering records across projects—with traceable evidence and human oversight.</p>
        <div class="btnrow">
          ${btn('Open agent report', '#/report', true)}
          ${btn('Run agent on GitHub ↗', WORKFLOW)}
        </div>
      </div>
      <div class="hero-art" aria-label="The agent compares GitHub and Jira evidence">
        <div class="signal">
          <span class="signal-icon">GH</span>
          <div><b>GitHub records</b><small>Mapped engineering milestone dates</small></div>
        </div>
        <div class="agent-connector">↓ &nbsp; READ-ONLY AGENT INVESTIGATION &nbsp; ↓</div>
        <div class="signal">
          <span class="signal-icon">JR</span>
          <div><b>Jira records</b><small>Mapped delivery commitment dates</small></div>
        </div>
        <div class="agent-connector">Evidence → finding → your judgment</div>
      </div>
    </section>

    ${originNote()}

    <div class="stats two-stats">
      ${stats.map(([status, description]) => `
        <a class="stat" href="#/report?status=${status}">
          <div class="statlabel">${e(STATUSES[status].label)}</div>
          <div class="statnum">${counts[status]}</div>
          <div class="statfoot">${e(description)} →</div>
        </a>`).join('')}
    </div>

    ${counts.rejected ? `
      <div class="fail-box">
        ${counts.rejected} report(s) failed checks.
        ${btn('Inspect rejected reports', '#/report?status=rejected')}
      </div>` : ''}

    <div class="agentresults">
      <div>
        <div class="card">
          <div class="cardhead">
            <h2>Latest agent findings</h2>
            <a href="#/report">View full report →</a>
          </div>
          ${run.projects.map(findingRow).join('')}
        </div>
        <div class="stage-row">
          <div class="stage"><small>01 · READ</small><b>Retrieve mapped records</b>
            <p>The model calls an allowlisted tool for each source.</p></div>
          <div class="stage"><small>02 · INVESTIGATE</small><b>Compare the evidence</b>
            <p>It returns dates, a finding, uncertainty, and an action.</p></div>
          <div class="stage"><small>03 · VALIDATE</small><b>Check before reviewing</b>
            <p>Code verifies citations and date consistency; a TPM reviews the meaning.</p></div>
        </div>
      </div>
      <div>
        ${chart()}
        <div class="card">
          <div class="cardhead"><h2>Execution environment</h2></div>
          <div class="cardbody">
            <dl class="keyvalue">
              <dt>Model</dt><dd>${e(run.model)}</dd>
              <dt>Execution</dt><dd>GitHub-hosted runner</dd>
              <dt>Source data</dt><dd>Repository-owned sample records</dd>
              <dt>Permissions</dt><dd>Read-only; no ticket changes</dd>
            </dl>
            <div class="btnrow">
              <button class="btn widebutton" data-action="import">Import another report</button>
            </div>
            <p class="hint" style="margin-top:10px">Import happens in this browser tab.
            The website does not execute the model.</p>
          </div>
        </div>
      </div>
    </div>`;
}

function reportView(status) {
  const rows = filterProjects(run, status, search);

  page.innerHTML = pageHead(
    'EVIDENCE-LINKED FINDINGS',
    'Agent report',
    'Inspect the conclusion, the dates behind it, and what still requires human judgment.',
    '<button class="btn" data-action="export">Download report</button>'
  ) + originNote() + filterLinks(status) + `
    <div class="filters">
      <label class="label" for="search">Find a project</label>
      <input class="field search" id="search" type="search"
        placeholder="Search by project name or RFP ID" value="${e(search)}">
      <span class="hint">${rows.length} of ${run.projects.length} projects</span>
    </div>

    <div class="card">
      ${rows.length ? rows.map(findingRow).join('') : `
        <div class="empty">
          <h3>No matching projects</h3>
          <p>Try another name or select a different filter.</p>
          ${btn('Show all projects', '#/report')}
        </div>`}
    </div>`;
}

function projectList() {
  page.innerHTML = pageHead(
    'MULTI-PROJECT REVIEW',
    'Projects',
    'Each project has an explicit mapping between a GitHub record and a Jira record.'
  ) + `
    <div class="card tablewrap">
      <table>
        <thead>
          <tr><th>Project</th><th>Agent finding</th><th>GitHub date</th><th>Jira date</th><th>Review</th></tr>
        </thead>
        <tbody>
          ${run.projects.map(project => {
            const id = encodeURIComponent(project.project_id);
            return `
              <tr>
                <td><a href="#/project/${id}/finding">${e(project.project_name)}</a>
                  <small>${e(project.project_id)}</small></td>
                <td>${badge(projectStatus(run, project))}</td>
                <td class="date-small">${e(dateLabel(evidenceFor(project, 'github')?.target_date))}</td>
                <td class="date-small">${e(dateLabel(evidenceFor(project, 'jira')?.target_date))}</td>
                <td><a href="#/project/${id}/evidence">Inspect evidence →</a></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function comparison(project) {
  return `
    <div class="sourcecompare">
      ${['github', 'jira'].map(source => {
        const evidence = evidenceFor(project, source);
        const record = sourceRecord(project, source, fixtures, isSummary());
        const github = source === 'github';

        return `
          <div class="sourcebox">
            <span class="provider">${github ? 'GitHub' : 'Jira'}</span>
            <div class="source-date${evidence?.target_date == null ? ' missing' : ''}">
              ${e(dateLabel(evidence?.target_date))}
            </div>
            <p>${github ? 'Engineering milestone due date' : 'Delivery task due date'}</p>
            <div class="filehint">${e(evidence?.record_id || 'No evidence citation')}</div>
            <div style="margin-top:15px">
              ${btn(
                record ? 'Inspect source record' : 'Inspect available evidence',
                `#/source/${encodeURIComponent(project.project_id)}/${source}`
              )}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function projectDetail(id, tab) {
  const project = getProject(run, id);
  if (!project) return notFound();

  const status = projectStatus(run, project);
  const execution = executionSummary(project);
  let body;

  if (tab === 'evidence') {
    body = `
      <div class="cardbody">
        <h3 class="sectionlabel">Dates cited by the agent</h3>
        ${comparison(project)}
        <div class="note">These records are mapped to the same sample deliverable.
        A task due date and milestone due date can represent different commitments;
        their meaning needs human confirmation.</div>
      </div>`;
  } else if (tab === 'execution') {
    body = `
      <div class="cardbody">
        ${execution.available ? `
          <div class="metricsline">
            <div><strong>${execution.reads}</strong><small>record reads</small></div>
            <div><strong>${execution.modelMessages}</strong><small>model responses</small></div>
            <div><strong>${execution.attempts}</strong><small>report attempts</small></div>
          </div>
          ${project.trace.map(traceRow).join('')}` : `
          <div class="tracewarning">
            <b>Original execution trace not imported yet.</b>
            <p>The shared summary confirms the model’s findings and elapsed times.
            It does not contain the tool-call trace. Import <code>report.json</code>
            from the successful GitHub artifact to view the actual calls, responses,
            and correction attempts.</p>
            <button class="btn" data-action="import">Import report.json</button>
          </div>`}
      </div>`;
  } else {
    const report = project.report;
    body = `
      <div class="cardbody">
        ${status === 'rejected' ? `
          <div class="fail-box"><b>Not accepted.</b> This output failed validation
          or expected-case evaluation. Review it as a failed attempt, not an accepted finding.</div>` : ''}
        <h3 class="sectionlabel">Agent finding</h3>
        <p class="finding-copy">${e(report?.finding || 'No report was generated.')}</p>
        <div style="margin:23px 0">${comparison(project)}</div>
        ${status === 'insufficient_data' ? `
          <div class="notice"><b>Missing evidence stays unknown.</b>
          Do not infer alignment from context when a source date is absent.</div>` : ''}
        <h3>What remains uncertain</h3>
        <p>${e(report?.uncertainty || 'No explanation supplied.')}</p>
        <div class="review-block">
          <b>Suggested next action · for human review</b>
          <p>${e(report?.recommended_action || 'Investigate the failed run before using this output.')}</p>
        </div>
        <div class="info-actions">
          ${btn('View execution details', `#/project/${encodeURIComponent(id)}/execution`)}
        </div>
      </div>`;
  }

  const tabs = [['finding', 'Finding'], ['evidence', 'Evidence'], ['execution', 'Execution']];
  page.innerHTML = `
    <div class="breadcrumbs">
      <a href="#/agent">Agent workspace</a><span>/</span>
      <a href="#/report">Agent report</a><span>/</span>${e(id)}
    </div>
    ${pageHead(id, project.project_name, 'A bounded agent investigation of mapped delivery dates.', badge(status))}
    <div class="detailgrid">
      <div class="card">
        <div class="tabs" role="navigation" aria-label="Project review">
          ${tabs.map(([key, label]) => `
            <a class="${tab === key ? 'active' : ''}" href="#/project/${encodeURIComponent(id)}/${key}"
              ${tab === key ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
        </div>
        ${body}
      </div>
      <aside>
        <div class="card">
          <div class="cardhead"><h2>Run details</h2></div>
          <div class="cardbody">
            <dl class="keyvalue">
              <dt>Project</dt><dd>${e(id)}</dd>
              <dt>Model</dt><dd>${e(run.model)}</dd>
              <dt>Time</dt><dd>${typeof project.elapsed_seconds === 'number'
                ? e(project.elapsed_seconds) + ' seconds' : 'Not supplied'}</dd>
              <dt>Evidence checks</dt><dd>${project.validation.passed ? 'Passed' : 'Failed'}</dd>
              <dt>Expected case</dt><dd>${run.evaluation[id]?.passed ? 'Passed' : 'Failed'}</dd>
              <dt>Origin</dt><dd>Sample source records</dd>
            </dl>
            <p class="hint">Automated checks cover source citations and date classification.
            Written explanations still need review.</p>
          </div>
        </div>
        ${btn('Back to all findings', '#/report')}
      </aside>
    </div>`;
}

function traceRow(event, index) {
  let label = 'Trace event';
  let detail = '';

  if (event.executed_tool) {
    label = 'Tool executed · ' + event.executed_tool;
    detail = event.arguments?.source || '';
  } else if (event.model_message) {
    label = 'Model response';
    detail = event.model_message.tool_calls?.length
      ? 'Requested ' + event.model_message.tool_calls.length + ' tool call(s)'
      : 'Generated report response';
  } else if (event.report_attempt) {
    label = 'Report validation · attempt ' + event.report_attempt;
    detail = Object.entries(event.validation || {})
      .filter(([, passed]) => !passed)
      .map(([key]) => key)
      .join(', ') || 'All recorded checks passed';
  }

  return `
    <div class="trace-entry">
      <strong>${index + 1}. ${e(label)}</strong>
      <small>${e(detail)}</small>
      <details><summary>Inspect recorded JSON</summary><pre>${e(JSON.stringify(event, null, 2))}</pre></details>
    </div>`;
}

function sourcesView() {
  page.innerHTML = pageHead(
    'PROVENANCE & SOURCE RECORDS',
    'Data & evidence',
    'Sample records live in the GitHub repository. The agent reads them through an explicitly mapped, read-only tool.'
  ) + originNote() + `
    <div class="card">
      <div class="cardhead">
        <h2>Project source mappings</h2>
        <span class="hint">${run.projects.length} projects · 2 sources each</span>
      </div>
      ${run.projects.map(project => {
        const id = encodeURIComponent(project.project_id);
        return `
          <div class="cardbody source-card" style="border-bottom:1px solid var(--line)">
            <div>
              <h3>${e(project.project_name)}</h3>
              <p class="hint">${e(project.project_id)} · GitHub milestone ↔ Jira task</p>
            </div>
            <div class="btnrow">
              ${btn('GitHub record', `#/source/${id}/github?from=sources`)}
              ${btn('Jira record', `#/source/${id}/jira?from=sources`)}
            </div>
          </div>`;
      }).join('')}
    </div>
    <div class="note"><b>No live integrations.</b> These files mirror selected API
    fields for the demonstration. A future connector could retrieve authorized
    records; this version only reads repository-owned fixtures.</div>`;
}

function sourceView(id, source, from) {
  const project = getProject(run, id);
  if (!project || !['github', 'jira'].includes(source)) return notFound();

  const entry = sourceRecord(project, source, fixtures, isSummary());
  const evidence = evidenceFor(project, source);
  const fromSources = from === 'sources';
  const back = fromSources ? '#/sources' : `#/project/${encodeURIComponent(id)}/evidence`;

  page.innerHTML = `
    <div class="breadcrumbs">
      <a href="${back}">← ${fromSources ? 'Back to data & evidence' : 'Back to project evidence'}</a>
      <span>/</span>${e(id)}<span>/</span>${e(source)}
    </div>
    ${pageHead(
      'SOURCE INSPECTOR',
      source === 'github' ? 'GitHub milestone record' : 'Jira task record',
      entry?.provenance || 'Only the agent’s evidence citation is available in this report.'
    )}
    <div class="detailgrid">
      <div class="card">
        <div class="cardhead">
          <h2>${entry ? 'Source record JSON' : 'Cited evidence'}</h2>
          <span class="provider">${e(source)}</span>
        </div>
        <div class="cardbody">
          ${entry ? `
            <p class="filehint">${e(entry.record.file || 'File path not provided')}</p>
            <pre>${e(JSON.stringify(entry.record.response ?? entry.record, null, 2))}</pre>` : `
            <div class="tracewarning">The original source record is not available in this
            report. Import the full artifact to inspect it.</div>
            <pre>${e(JSON.stringify(evidence ?? {}, null, 2))}</pre>`}
        </div>
      </div>
      <aside>
        <div class="card">
          <div class="cardhead"><h2>Evidence mapping</h2></div>
          <div class="cardbody">
            <dl class="keyvalue">
              <dt>Record ID</dt><dd>${e(evidence?.record_id || 'Not cited')}</dd>
              <dt>Cited date</dt><dd>${e(dateLabel(evidence?.target_date))}</dd>
              <dt>Field</dt><dd>${e(entry?.record.date_field || (source === 'github' ? 'due_on' : 'fields.duedate'))}</dd>
              <dt>Record origin</dt><dd>${entry?.captured ? 'Captured by the tool'
                : entry ? 'Repository fixture' : 'Not supplied'}</dd>
            </dl>
            <p class="hint">Dates are normalized to YYYY-MM-DD for comparison.
            A missing date stays null.</p>
          </div>
        </div>
        ${btn('Return to project', `#/project/${encodeURIComponent(id)}/finding`)}
      </aside>
    </div>`;
}

function about() {
  page.innerHTML = pageHead(
    'BUILT BY REGINA NKENCHOR',
    'How this agent works',
    'A technical program management portfolio project connecting source evidence, model reasoning, and explicit validation.'
  ) + `
    <div class="aboutgrid">
      <section class="card">
        <div class="prose">
          <h2>The question</h2>
          <p>Do the delivery commitments in the planning record agree with the
          engineering record—and what evidence supports the answer?</p>

          <h2>The agent’s work</h2>
          <p>A language model running on a GitHub-hosted runner requests both mapped sources
          using <code>read_delivery_record</code>. It examines the returned records
          and writes a finding with citations, uncertainty, and a recommended action.</p>
          <p>Python enforces the read-only tool allowlist and checks the report.
          A failed report gets up to one correction attempt with validation feedback.
          If the answer still fails, it stays rejected; the program does not replace
          it with a passing answer.</p>

          <h2>The human’s work</h2>
          <p>The technical program manager confirms whether the mapped task and milestone
          represent the same commitment, reviews the explanation, and decides what
          action is appropriate. The agent does not approve work, update tickets,
          or contact stakeholders.</p>
        </div>
      </section>

      <section class="card">
        <div class="prose">
          <h2>What this version demonstrates</h2>
          <ul>
            <li>Actual model/tool execution on three sample projects.</li>
            <li>GitHub-shaped milestone and Jira-shaped issue records stored in the repository.</li>
            <li>Evidence and date-consistency checks, with a bounded correction loop.</li>
            <li>A report viewer with project findings, source inspection, and imported execution traces.</li>
          </ul>

          <h2>What the website does</h2>
          <p>It displays a saved report. “Run agent on GitHub” opens the workflow page;
          the model runs in GitHub Actions, not this browser. Importing a report reads
          it in this browser tab and does not upload it to a server. Refreshing
          restores the saved report.</p>

          <h2>Scope of the evidence</h2>
          <p>Passing these three cases demonstrates a working date-consistency experiment.
          It does not establish production reliability, repository-wide monitoring,
          live Jira/GitHub integration, or broad delivery-risk detection.</p>

          <div class="btnrow">
            ${btn('View source repository ↗', REPO)}
            ${btn('Open workflow ↗', WORKFLOW)}
          </div>
        </div>
      </section>
    </div>`;
}

function notFound() {
  page.innerHTML = `
    <div class="empty">
      <h1>Page not found</h1>
      <p>This project or view is not in the current report.</p>
      ${btn('Back to agent workspace', '#/agent', true)}
    </div>`;
}

function render(focus = false) {
  if (!run) return;

  const hash = location.hash.slice(1) || '/agent';
  const [path, query = ''] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const route = parts[0] || 'agent';
  const params = new URLSearchParams(query);
  let status = params.get('status') || 'all';

  if (status !== 'all' && !STATUSES[status]) status = 'all';

  const labels = {
    agent: 'Agent workspace',
    report: 'Agent report',
    projects: 'Projects',
    sources: 'Data & evidence',
    source: 'Source inspector',
    project: 'Project investigation',
    about: 'How it works'
  };

  title.textContent = labels[route] || 'Workspace';
  document.title = `${labels[route] || 'Workspace'} · Program Delivery Agent`;
  document.getElementById('runLabel').textContent = labelRun();

  const navigationRoute = route === 'project' ? 'report'
    : route === 'source' ? 'sources' : route;

  document.querySelectorAll('[data-nav]').forEach(link => {
    const active = link.dataset.nav === navigationRoute;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  try {
    switch (route) {
      case 'agent':
        workspace();
        break;
      case 'report':
        reportView(status);
        break;
      case 'projects':
        projectList();
        break;
      case 'project':
        projectDetail(
          decodeURIComponent(parts[1] || ''),
          ['finding', 'evidence', 'execution'].includes(parts[2]) ? parts[2] : 'finding'
        );
        break;
      case 'sources':
        sourcesView();
        break;
      case 'source':
        sourceView(decodeURIComponent(parts[1] || ''), parts[2], params.get('from'));
        break;
      case 'about':
        about();
        break;
      default:
        notFound();
    }
  } catch (error) {
    console.error(error);
    notFound();
  }

  if (focus) {
    document.getElementById('content').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;

  if (control.dataset.action === 'import') {
    fileInput.value = '';
    fileInput.click();
  }

  if (control.dataset.action === 'export') {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = isSummary() ? 'shared-run-summary.json' : 'agent-report.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
});

document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;

  const start = event.target.selectionStart;
  search = event.target.value;
  render();

  const input = document.getElementById('search');
  input?.focus();
  if (input?.type === 'search') {
    try {
      input.setSelectionRange(start, start);
    } catch {
      // Some browsers do not expose text selection for search inputs.
    }
  }
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    toast('Choose a report smaller than 5 MB.', true);
    return;
  }

  try {
    const candidate = normalizeRun(JSON.parse(await file.text()));
    run = candidate;
    imported = true;
    search = '';

    if (originalRun) {
      let option = demoRun.querySelector('option[value="imported"]');
      if (!option) {
        option = document.createElement('option');
        option.value = 'imported';
        option.textContent = 'Imported report';
        demoRun.append(option);
      }
      demoRun.value = 'imported';
    }

    location.hash = '#/agent';
    render(true);
    toast('Agent report imported. Its contents stay in this browser tab.');
  } catch (error) {
    toast('Could not import report: ' + error.message, true);
  }
});

demoRun.addEventListener('change', () => {
  if (demoRun.value !== 'v1' || !originalRun) return;

  run = originalRun;
  imported = false;
  search = '';
  demoRun.querySelector('option[value="imported"]')?.remove();
  render();
});

window.addEventListener('hashchange', () => {
  search = '';
  render(true);
});

try {
  const responses = await Promise.all([
    fetch('./data/latest-report.json'),
    fetch('./data/fixtures.json')
  ]);

  if (!responses[0].ok) throw Error('Saved report unavailable');

  originalRun = normalizeRun(await responses[0].json());
  run = originalRun;
  demoRun.disabled = false;

  if (responses[1].ok) fixtures = await responses[1].json();

  render();
} catch (error) {
  page.innerHTML = `
    <div class="empty">
      <h1>The saved report could not load</h1>
      <p>${e(error.message)}. Import the combined report.json from your GitHub artifact to continue.</p>
      <button class="btn primary" data-action="import">Import report.json</button>
    </div>`;
}
