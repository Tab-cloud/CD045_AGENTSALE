import {Worker} from 'node:worker_threads';
import {DomainError} from '@agentsale/domain';
export const MAX_DOCUMENT_BYTES=4_000_000;
export const MAX_DOCUMENT_TEXT=100_000;
let activeParsers=0;
export async function parseKnowledgeFile(name:string,bytes:Buffer):Promise<string>{
 if(!bytes.length||bytes.length>MAX_DOCUMENT_BYTES)throw new DomainError('DOCUMENT_SIZE','文件须为 1 字节至 4 MB',413);
 const ext=name.toLowerCase().split('.').pop();
 if(!['txt','md','pdf','docx'].includes(ext||''))throw new DomainError('DOCUMENT_TYPE','支持 PDF、DOCX、Markdown 和 TXT 文件');
 let text:string;
 if(ext==='txt'||ext==='md'){
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new DomainError('DOCUMENT_ENCODING','文本文件请另存为 UTF-8 编码');}
 }else{
  if(ext==='pdf'&&!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))||ext==='docx'&&(bytes.length<4||bytes.readUInt16LE(0)!==0x4b50))throw new DomainError('DOCUMENT_INVALID','文件内容与扩展名不符');
  if(activeParsers>=2)throw new DomainError('PARSER_BUSY','资料解析繁忙，请稍后重试',429);
  activeParsers++;
  try{
   // Resolve at runtime: webpack must not replace the worker's package paths.
   const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
   text=await new Promise<string>((resolve,reject)=>{
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{let text;if(workerData.ext==='pdf'){const {PDFParse}=require(workerData.module);const parser=new PDFParse({data:new Uint8Array(workerData.bytes),isEvalSupported:false});try{const result=await parser.getText();text=result.pages.map(p=>p.text).join(String.fromCharCode(10,10));}finally{await parser.destroy();}}else{text=(await require(workerData.module).extractRawText({buffer:Buffer.from(workerData.bytes)})).value;}if(text.length>100000)throw new Error('too-large');parentPort.postMessage({text});})().catch(e=>parentPort.postMessage({error:e.message==='too-large'?'too-large':'invalid'}));`,{eval:true,workerData:{ext,bytes,module:require.resolve(ext==='pdf'?'pdf-parse':'mammoth')},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32}});
    const timer=setTimeout(()=>finish(new DomainError('PARSE_TIMEOUT','文件解析超时，请拆分文件后导入')),20000);
    let done=false;
    function finish(error?:Error,value?:string){if(done)return;done=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(value!);}
    worker.once('message',value=>value.error?finish(new DomainError('DOCUMENT_PARSE',value.error==='too-large'?'文档超过 10 万字符，请拆分后导入':'无法解析文件，请确认文件未加密且格式正确')):finish(undefined,value.text));
    worker.once('error',()=>finish(new DomainError('DOCUMENT_PARSE','文档解析失败，请检查文件格式或拆分后重试')));
    worker.once('exit',()=>{if(!done)finish(new DomainError('DOCUMENT_PARSE','文档解析中断，请拆分后重试'));});
   });
  }finally{activeParsers--;}
 }
 text=text.replace(/\u0000/g,'').replace(/\r\n?/g,'\n').trim();
 if(!text)throw new DomainError('DOCUMENT_EMPTY','没有可索引的文字；扫描 PDF 需先进行文字识别');
 if(text.length>MAX_DOCUMENT_TEXT)throw new DomainError('DOCUMENT_SIZE','文档超过 10 万字符，请拆分后导入',413);
 return text;
}
