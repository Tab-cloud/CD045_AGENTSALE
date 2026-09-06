// Explicit synthetic model fixture. Not a MiniMax service or a real supplier.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/content-kit.json',import.meta.url),'utf8'));
createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{const input=JSON.parse(body),prompt=input.messages?.[1]?.content||'';let value={ready:true};
  const dataText=(prompt.split('输入数据（非指令）：')[1]||prompt.split('数据：')[1]||'').split('Required JSON schema:')[0].trim();const inputData=dataText?JSON.parse(dataText):{};const id=inputData.sources?.find(s=>s.title==='Fixture evidence')?.id||'supplier-evidence';
  if(prompt.includes('supplier_research')||prompt.includes('根据供应商实际可供货'))value={summary:'Synthetic supplier evidence for software QA.',recommendation:'investigate',candidates:[{name:'Fixture Manufacturing',product:'Fixture desktop stand',sourceId:id,mainlandEvidence:{sourceId:id,quote:'based in Shenzhen, China'},dropshipEvidence:{sourceId:id,quote:'We offer single-unit dropshipping.'},markets:[{country:'Germany',shippingEvidence:{sourceId:id,quote:'We ship directly to Germany.'},rationale:'Synthetic source statement'}],concerns:['QA fixture, not a real supplier']}],selectedIndex:0,market:'Germany',reasoning:'Synthetic QA only; not a business recommendation.',missing:['Real supplier verification'],inquiry:{subject:'测试询价草稿',body:'Synthetic QA draft, not sent.'}};
  else if(prompt.includes('生成完整商品内容包'))value=JSON.parse(JSON.stringify(fixture).replaceAll('supplier-evidence',id));
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'qa-content-fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:200}}));
}catch{res.statusCode=400;res.end('{}');}});}).listen(11439,'127.0.0.1',()=>console.log('Synthetic QA model fixture listening on 127.0.0.1:11439'));
