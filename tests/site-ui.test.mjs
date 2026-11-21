import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as model from '../site/model.mjs';
const saved=JSON.parse(fs.readFileSync(new URL('../site/data/latest-report.json',import.meta.url)));
const fixtures=JSON.parse(fs.readFileSync(new URL('../site/data/fixtures.json',import.meta.url)));
const code=fs.readFileSync(new URL('../site/app.js',import.meta.url),'utf8').replace(/^import .*?;\n/,'');
async function harness(){
  const nodes=Object.fromEntries(['page','pageLabel','reportFile','toast','runLabel','content'].map(k=>[k,{innerHTML:'',textContent:'',className:'',files:[],addEventListener(type,fn){this[type]=fn;},focus(){},click(){this.clicked=true;}}]));
  const options = [];
  nodes.demoRun = {
    value:'v1', disabled:true,
    addEventListener(type, handler){this[type]=handler;},
    querySelector(){return options.find(option => option.value === 'imported');},
    append(option){options.push(option);option.remove=()=>options.splice(options.indexOf(option),1);}
  };
  const location={hash:'#/agent'};
  const context={...model,e:model.escapeHTML,console,location,URL,URLSearchParams,Blob,setTimeout:()=>0,clearTimeout(){},fetch:async url=>({ok:true,json:async()=>structuredClone(url.includes('fixtures')?fixtures:saved)}),window:{addEventListener(){},scrollTo(){}},document:{createElement:()=>({}),getElementById:id=>nodes[id],querySelectorAll:()=>[],addEventListener(){},title:''}};
  const api=await vm.runInNewContext('(async()=>{'+code+';return {render,setRun(value){run=normalizeRun(value);imported=true;},getRun(){return run;}};})()',context);
  return {api,nodes,location,html:()=>nodes.page.innerHTML};
}
test('workspace opens on agent findings and functional workflow link',async()=>{const h=await harness();assert.match(h.html(),/Latest agent findings/);assert.match(h.html(),/actions\/workflows\/evaluate-agent.yml/);assert.match(h.html(),/8327e4f/);});
test('each finding, evidence tab, and execution tab renders',async()=>{const h=await harness();for(const p of saved.projects)for(const tab of ['finding','evidence','execution']){h.location.hash=`#/project/${p.project_id}/${tab}`;h.api.render();assert.match(h.html(),new RegExp(p.project_name));assert.doesNotMatch(h.html(),/Page not found/);}});
test('source inspectors show correct mapped records and return links',async()=>{const h=await harness();for(const p of saved.projects)for(const source of ['github','jira']){h.location.hash=`#/source/${p.project_id}/${source}`;h.api.render();assert.match(h.html(),/not a captured execution trace/);assert.match(h.html(),new RegExp(p.project_id+'/evidence'));assert.match(h.html(),source==='github'?/due_on/:/duedate/);}});
test('source-list return target is preserved',async()=>{const h=await harness();h.location.hash='#/source/RFP-001/github?from=sources';h.api.render();assert.match(h.html(),/href="#\/sources">← Back to data/);});
test('matching and empty filters render correct states',async()=>{const h=await harness();h.location.hash='#/report?status=aligned';h.api.render();assert.match(h.html(),/Documentation Preview/);assert.doesNotMatch(h.html(),/CSV Export Delivery/);h.location.hash='#/report?status=rejected';h.api.render();assert.match(h.html(),/No matching projects/);});
test('all navigation routes and missing project route are handled',async()=>{const h=await harness();for(const route of ['report','projects','sources','about']){h.location.hash='#/'+route;h.api.render();assert.doesNotMatch(h.html(),/Page not found/);}h.location.hash='#/project/not-a-project/finding';h.api.render();assert.match(h.html(),/Page not found/);});
test('summary never invents execution details',async()=>{const h=await harness();h.location.hash='#/project/RFP-001/execution';h.api.render();assert.match(h.html(),/Original execution trace not imported yet/);assert.doesNotMatch(h.html(),/Tool executed/);});
test('actual import exposes recorded execution and source provenance',async()=>{const h=await harness();const r=structuredClone(saved);delete r.provenance;r.projects[0].trace=[{executed_tool:'read_delivery_record',arguments:{source:'github'},result:fixtures['RFP-001'].github},{executed_tool:'read_delivery_record',arguments:{source:'jira'},result:fixtures['RFP-001'].jira},{report_attempt:1,validation:{quoted_dates_match_sources:true}}];h.nodes.reportFile.files=[{size:100,text:async()=>JSON.stringify(r)}];await h.nodes.reportFile.change();assert.match(h.nodes.runLabel.textContent,/Imported/);h.location.hash='#/project/RFP-001/execution';h.api.render();assert.match(h.html(),/Tool executed/);assert.match(h.html(),/Report validation/);h.location.hash='#/source/RFP-001/github';h.api.render();assert.match(h.html(),/Recorded tool result/);});
test('invalid file import preserves the existing run',async()=>{const h=await harness();h.nodes.reportFile.files=[{size:100,text:async()=>'{invalid'}];await h.nodes.reportFile.change();assert.match(h.nodes.toast.textContent,/Could not import/);assert.equal(h.api.getRun().projects.length,3);});
test('model output renders as escaped text, including inspector JSON',async()=>{const h=await harness();const r=structuredClone(saved);r.projects[0].report.finding='<img src=x onerror="evil()">';h.api.setRun(r);h.location.hash='#/project/RFP-001/finding';h.api.render();assert.doesNotMatch(h.html(),/<img src=x/);assert.match(h.html(),/&lt;img/);});
test('missing data view warns against inferring alignment',async()=>{const h=await harness();h.location.hash='#/project/RFP-003/finding';h.api.render();assert.match(h.html(),/Do not infer alignment from context/);});

test('Version 1 restores the saved report after a local import',async()=>{
  const h=await harness();
  assert.equal(h.nodes.demoRun.disabled,false);
  const r=structuredClone(saved);r.projects[0].project_name='Imported project';
  h.nodes.reportFile.files=[{size:100,text:async()=>JSON.stringify(r)}];
  await h.nodes.reportFile.change();
  assert.equal(h.nodes.demoRun.value,'imported');
  assert.match(h.html(),/Imported project/);
  h.nodes.demoRun.value='v1';h.nodes.demoRun.change();
  assert.match(h.html(),/CSV Export Delivery/);
  assert.doesNotMatch(h.html(),/Imported project/);
});
