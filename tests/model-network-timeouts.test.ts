import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {requestBytes} from '../packages/automation/src/network';

it('allows a model stream to run longer than its idle window while bytes keep arriving',async()=>{
  const server=createServer((_request,response)=>{
    response.setHeader('Content-Type','text/event-stream');
    let sent=0;
    const timer=setInterval(()=>{
      response.write(`data: ${++sent}\n\n`);
      if(sent===5){clearInterval(timer);response.end('data: [DONE]\n\n');}
    },80);
    response.on('close',()=>clearInterval(timer));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const address=server.address();if(!address||typeof address==='string')throw new Error('fixture address');
    const started=Date.now();
    const result=await requestBytes(`http://127.0.0.1:${address.port}/stream`,{local:true,idleTimeout:250,maxDuration:1500,maxBytes:1000});
    expect(Date.now()-started).toBeGreaterThan(300);
    expect(result.body.toString()).toContain('data: [DONE]');
  }finally{server.close();}
});

it('ends a stream that stops sending data instead of waiting forever',async()=>{
  const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/event-stream');response.write('data: first\n\n');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const address=server.address();if(!address||typeof address==='string')throw new Error('fixture address');
    await expect(requestBytes(`http://127.0.0.1:${address.port}/stream`,{local:true,idleTimeout:100,maxDuration:1500})).rejects.toMatchObject({code:'NETWORK_IDLE_TIMEOUT',retryable:true});
  }finally{server.closeAllConnections();server.close();}
});

it('keeps an absolute resource guard even when a provider sends endless heartbeats',async()=>{
  const server=createServer((_request,response)=>{
    response.setHeader('Content-Type','text/event-stream');
    const timer=setInterval(()=>response.write(': heartbeat\n\n'),30);
    response.on('close',()=>clearInterval(timer));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const address=server.address();if(!address||typeof address==='string')throw new Error('fixture address');
    await expect(requestBytes(`http://127.0.0.1:${address.port}/stream`,{local:true,idleTimeout:150,maxDuration:180})).rejects.toMatchObject({code:'NETWORK_TIMEOUT',retryable:true});
  }finally{server.closeAllConnections();server.close();}
});
