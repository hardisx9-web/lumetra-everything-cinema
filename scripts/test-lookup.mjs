import assert from 'node:assert/strict';
import {lookup} from '../site-server/catalogue.js';
for(const invalid of [[1],['../../other'],['<script>'],Array.from({length:41},(_,i)=>'film-'+i),['x'.repeat(161)]]){
 await assert.rejects(lookup(null,invalid),error=>error.status===400);
}
assert.deepEqual(await lookup(null,[]),{items:[]});
console.log('PASS bounded /api/lookup validation; rejects traversal, invalid IDs and more than 40 records');
