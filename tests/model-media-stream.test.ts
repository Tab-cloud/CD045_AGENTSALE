import {createServer} from 'node:http';
import {once} from 'node:events';
import {it,expect} from 'vitest';
import {requestStream} from '../packages/automation/src/network';

it('relays provider media bytes without changing their order or encoding',async()=>{
  const source=Buffer.concat([Buffer.from([0,255,1,254]),Buffer.from('ftyp'),Buffer.alloc(256*1024,0xa5)]);
  const server=createServer((_request,response)=>{
    response.writeHead(200,{'Content-Type':'video/mp4','Content-Length':source.length});
    response.write(source.subarray(0,17));
    response.end(source.subarray(17));
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  try{
    const address=server.address();
    if(!address||typeof address==='string')throw new Error('missing test server address');
    const response=await requestStream(`http://127.0.0.1:${address.port}/media`,{maxBytes:source.length,local:true});
    const chunks:Buffer[]=[];
    for await(const chunk of response.body)chunks.push(chunk as Buffer);
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(Buffer.concat(chunks)).toEqual(source);
    await expect(requestStream(`http://127.0.0.1:${address.port}/media`,{maxBytes:source.length-1,local:true})).rejects.toMatchObject({code:'RESPONSE_TOO_LARGE'});
    await expect(requestStream(`http://127.0.0.1:${address.port}/media`,{maxBytes:source.length})).rejects.toMatchObject({code:'URL_REJECTED'});
  }finally{server.close();}
});
