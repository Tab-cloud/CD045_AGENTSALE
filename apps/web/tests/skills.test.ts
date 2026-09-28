import {describe,it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import catalog from '../../../packages/skills/catalog.json';
import {skillInstructions} from '../packages/automation/src/skills';
describe('bundled skill catalog',()=>{
 it('pins six licensed upstream packages and verifies embedded content integrity',()=>{
  expect(catalog).toHaveLength(6);expect(new Set(catalog.map(s=>s.id)).size).toBe(6);
  for(const s of catalog){expect(s.commit).toMatch(/^[a-f0-9]{40}$/);expect(s.licenseText).toContain('MIT License');expect(s.licenseText).toContain('Copyright');expect(createHash('sha256').update(s.instructions).digest('hex')).toBe(s.sha256);}
 });
 it('loads full audited reference methods, not a catalog-only label',()=>{const s=catalog[0],text=skillInstructions([s],'ecommerce');expect(text).toContain(s.instructions);expect(text).toContain(s.commit);expect(text).toContain('不执行其命令');});
 it('rejects unknown, modified, duplicate and out-of-scope skills',()=>{const s=catalog[0];expect(()=>skillInstructions([{...s,id:randomUUID()}],'skills')).toThrow();expect(()=>skillInstructions([{...s,sha256:'changed'}],'skills')).toThrow('版本');expect(()=>skillInstructions([s,s],'skills')).toThrow();expect(()=>skillInstructions([catalog.find(s=>s.id==='ffmpeg')],'ecommerce')).toThrow('不支持');expect(()=>skillInstructions([s],'research')).toThrow('不支持');});
});
