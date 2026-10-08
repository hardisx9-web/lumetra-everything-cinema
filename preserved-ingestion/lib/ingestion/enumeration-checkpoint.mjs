import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { httpForSource } from './provider-policy.mjs';
import { digest } from './http.mjs';

// Transport checkpoints supplement immutable PostgreSQL observations. A finalized
// snapshot is never changed; page progress is resumed only before finalization.
export async function checkpointHttp(source, directory) {
  const http = httpForSource(source);
  http.policyEvidence ||= [];
  if (!directory) return http;
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${source.id}.progress.json`);
  const identity = digest(JSON.stringify(source));
  let saved;
  try { saved = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved) {
    if (saved.registry_source_id !== source.id || saved.source_sha256 !== identity || saved.version !== 1) throw new Error('Enumeration checkpoint belongs to a different source policy; use a new directory.');
    http.enumerationState = saved.state;
    http.enumerationCandidates = saved.candidates;
    http.requests.push(...saved.requests);
    http.policyEvidence.push(...(saved.policy_evidence || []));
  }
  http.checkpoint = async (state, candidates) => {
    const snapshot = { version: 1, registry_source_id: source.id, source_sha256: identity,
      checked_at: new Date().toISOString(), state, candidates, requests: http.requests, policy_evidence: http.policyEvidence || [] };
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`);
    await rename(temporary, file);
  };
  return http;
}
