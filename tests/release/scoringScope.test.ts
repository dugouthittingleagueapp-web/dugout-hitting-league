import {describe,it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const scope=JSON.parse(readFileSync('release/scope.json','utf8'));
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
describe('Scoring release scope',()=>{
 it('preserves Production schedule screens, import behavior and schema without adding development schedule APIs',()=>{
  for(const [path,digest] of Object.entries(scope.unchangedFiles))expect(hash(readFileSync(path)),path).toBe(digest);
  const storage=readFileSync('services/storageService.ts','utf8');
  expect(hash(storage.slice(storage.indexOf('export const importScheduleFromCsv')))).toBe(scope.legacyImportFunctionSha256);
  for(const path of scope.excludedNewFiles)expect(existsSync(path),path).toBe(false);
 });
});
