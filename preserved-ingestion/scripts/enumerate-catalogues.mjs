import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { enumerateSource } from '../lib/ingestion/catalogues.mjs';
import { checkpointHttp } from '../lib/ingestion/enumeration-checkpoint.mjs';

const root = resolve(import.meta.dirname, '..');
const selected = process.argv.filter((arg) => arg.startsWith('--source=')).map((arg) => arg.slice(9));
const priority = process.argv.find((arg) => arg.startsWith('--priority='))?.slice(11);
const registry = JSON.parse(await readFile(resolve(root, 'src/data/source-registry.json'), 'utf8'));
const all = [...registry.sources, ...registry.rights_holder_channels_to_enumerate];
if (selected.some((id) => !all.some((source) => source.id === id))) throw new Error('Unknown --source registry id');
const targets = all.filter((source) => (!selected.length || selected.includes(source.id)) && (!priority || source.priority === priority));
if (!targets.length) throw new Error('No registered sources selected');
const output = resolve(process.argv.find((arg) => arg.startsWith('--output-dir='))?.slice(13) || resolve(root, '.research/sweeps', `${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}`));
await mkdir(output, { recursive: true });
let manifest;
try { manifest = JSON.parse(await readFile(resolve(output,'manifest.json'),'utf8')); }
catch (error) { if(error.code!=='ENOENT') throw error; }
manifest ||= { registry_version: registry.registry_meta.version, started_at: new Date().toISOString(), mode: 'ENUMERATE_ONLY', sources: [] };
if(manifest.registry_version!==registry.registry_meta.version) throw new Error('Use a new enumeration directory when registry policy changes.');
async function save(name, data) { const path = resolve(output, name); await writeFile(`${path}.tmp`, `${JSON.stringify(data, null, 2)}\n`); await rename(`${path}.tmp`, path); }
console.log(JSON.stringify({ output_directory: output, targets: targets.map((source) => source.id) }));
for (const source of targets) {
  // Reusing an interrupted directory resumes it; it never re-enumerates or overwrites finished source observations.
  if(manifest.sources.some((entry)=>entry.source_id===source.id)) { console.log(JSON.stringify({source_id:source.id,skipped:true,reason:'Existing enumeration checkpoint preserved'})); continue; }
  // Each source has its own access-denial cache; a blocked provider never aborts another source.
  const http = await checkpointHttp(source, output);
  const started = new Date().toISOString();
  const enumeration = await enumerateSource(source, http);
  const result = { ...enumeration, started_at: started, checked_at: new Date().toISOString(), requests: http.requests, policy_evidence: http.policyEvidence || [], registry_source_id: source.id };
  await save(`${source.id}.json`, result);
  manifest.sources.push({ source_id: source.id, file: `${source.id}.json`, status: result.status, candidates: result.candidates.length, enumeration_complete: result.enumeration_complete });
  await save('manifest.json', manifest);
  console.log(JSON.stringify(manifest.sources.at(-1)));
}
manifest.finished_at ||= new Date().toISOString();
manifest.enumeration_complete = manifest.sources.every((source) => source.enumeration_complete);
await save('manifest.json', manifest);
console.log(JSON.stringify({ output_directory: output, enumerated: manifest.sources.filter((source) => source.enumeration_complete).length, blocked_or_unfinished: manifest.sources.filter((source) => !source.enumeration_complete).length, candidates: manifest.sources.reduce((sum, source) => sum + source.candidates, 0) }));
