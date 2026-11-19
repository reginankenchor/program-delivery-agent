export const STATUSES = Object.freeze({
  potential_mismatch: {label:'Dates differ', short:'Mismatch', tone:'mismatch', color:'#c49b56'},
  aligned: {label:'Dates match', short:'Aligned', tone:'aligned', color:'#659b85'},
  insufficient_data: {label:'Missing information', short:'Missing date', tone:'missing', color:'#9a81bb'},
  rejected: {label:'Report needs correction', short:'Rejected', tone:'rejected', color:'#bc7180'}
});
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function normalizeRun(raw) {
  if (!object(raw) || raw.origin !== 'fictional_fixture') throw Error('Import a fictional-fixture report.json from this project. Live or organizational data is outside this demonstration.');
  if (!Array.isArray(raw.projects) || raw.projects.length < 1 || raw.projects.length > 100) throw Error('The report must contain between 1 and 100 projects.');
  if (!object(raw.evaluation)) throw Error('This is not the combined report.json. It must include projects and evaluation.');
  if (typeof raw.model !== 'string' || !raw.model.trim()) throw Error('The report must identify its model.');
  if (raw.model === 'unit-test-stub') throw Error('This is unit-test output. Import report.json from the actual agent artifact.');
  const ids = new Set();
  for (const p of raw.projects) {
    if (!object(p) || typeof p.project_id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(p.project_id) || ids.has(p.project_id)) throw Error('Invalid or duplicate project identifier.');
    ids.add(p.project_id);
    if (typeof p.project_name !== 'string' || !object(p.validation) || typeof p.validation.passed !== 'boolean' || !object(raw.evaluation[p.project_id])) throw Error('Missing project name, validation, or evaluation result.');
    if (p.report !== null) {
      if (!object(p.report) || !['potential_mismatch','aligned','insufficient_data'].includes(p.report.status)) throw Error('Unsupported finding status.');
      for (const field of ['finding','uncertainty','recommended_action']) if (typeof p.report[field] !== 'string') throw Error('A finding is missing its written explanation.');
      if (!Array.isArray(p.report.evidence) || p.report.evidence.length > 20) throw Error('Invalid evidence list.');
      for (const e of p.report.evidence) if (!object(e) || typeof e.record_id !== 'string' || !(e.target_date === null || (typeof e.target_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.target_date)))) throw Error('Evidence dates must use YYYY-MM-DD or null.');
    }
    if (p.trace !== undefined && (!Array.isArray(p.trace) || p.trace.length > 300)) throw Error('Invalid execution trace.');
  }
  return raw;
}
export function getProject(run, id) { return run.projects.find(p => p.project_id === id); }
export function projectStatus(run, p) {
  if (!p.report || !p.validation.passed || run.evaluation[p.project_id]?.passed !== true) return 'rejected';
  const ev = p.report.evidence;
  const byId = new Map(ev.map(e=>[e.record_id,e.target_date]));
  if (ev.length !== 2 || byId.size !== 2 || !byId.has(p.project_id+':github') || !byId.has(p.project_id+':jira')) return 'rejected';
  const a=byId.get(p.project_id+':github'), b=byId.get(p.project_id+':jira');
  const expected = a === null || b === null ? 'insufficient_data' : a === b ? 'aligned' : 'potential_mismatch';
  if (p.report.status !== expected) return 'rejected';
  // When actual tool results are available, validate displayed citations against them too.
  const reads=(p.trace||[]).filter(t=>t.executed_tool==='read_delivery_record' && object(t.result));
  if(reads.length) for(const source of ['github','jira']) {
    const record=reads.filter(t=>t.arguments?.source===source).at(-1)?.result;
    if(!record || record.record_id!==p.project_id+':'+source || record.normalized_target_date!==byId.get(record.record_id)) return 'rejected';
  }
  return expected;
}
export function summarize(run) {
  const counts = {potential_mismatch:0,aligned:0,insufficient_data:0,rejected:0};
  for (const p of run.projects) counts[projectStatus(run,p)]++;
  return counts;
}
export function filterProjects(run, status='all', query='') {
  const term=query.toLowerCase().trim();
  return run.projects.filter(p=>(status==='all'||projectStatus(run,p)===status) && (!term||(p.project_id+' '+p.project_name).toLowerCase().includes(term)));
}
export function evidenceFor(p, source) { return p.report?.evidence.find(e=>e.record_id===p.project_id+':'+source); }
export function sourceRecord(p, source, fixtures={}, allowFixture=false) {
  const read=(p.trace||[]).filter(t=>t.executed_tool==='read_delivery_record' && t.arguments?.source===source).at(-1);
  if (read?.result) return {record:read.result, provenance:'Recorded tool result', captured:true};
  if (allowFixture && fixtures[p.project_id]?.[source]) return {record:fixtures[p.project_id][source],provenance:'Repository sample snapshot · not a captured execution trace',captured:false};
  return null;
}
export function executionSummary(p) {
  const trace=p.trace||[];
  return {reads:trace.filter(t=>t.executed_tool==='read_delivery_record').length,
    attempts:trace.filter(t=>t.report_attempt).length,
    modelMessages:trace.filter(t=>t.model_message).length,
    available:trace.length>0};
}
