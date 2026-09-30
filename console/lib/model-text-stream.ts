type TextEvent = {type:'snapshot'|'delta'|'completed'|'failed';text?:string;message?:string};
type Listener = (event:TextEvent)=>void;
type ActiveStream = {text:string;listeners:Set<Listener>};

// Only active requests live here. The membership store remains authoritative
// for completed/unknown results and for reconnects after a service restart.
const state=globalThis as typeof globalThis&{lingfengTextStreams?:Map<string,ActiveStream>};
const streams=state.lingfengTextStreams??=new Map<string,ActiveStream>();

export function subscribeText(id:string,listener:Listener){
  const active=streams.get(id)??{text:'',listeners:new Set<Listener>()};
  streams.set(id,active);
  active.listeners.add(listener);
  if(active.text)listener({type:'snapshot',text:active.text});
  return ()=>{
    active.listeners.delete(listener);
    if(!active.listeners.size&&!active.text)streams.delete(id);
  };
}

export function publishTextDelta(id:string,delta:string){
  const active=streams.get(id)??{text:'',listeners:new Set<Listener>()};
  streams.set(id,active);
  active.text+=delta;
  for(const listener of active.listeners){
    try{listener({type:'delta',text:delta});}catch{active.listeners.delete(listener);}
  }
}

export function finishTextStream(id:string,result:{text?:string;message?:string}){
  const active=streams.get(id);
  if(!active)return;
  streams.delete(id);
  const event:TextEvent=result.text?{type:'completed',text:result.text}:{type:'failed',message:result.message||'模型请求未能完成'};
  for(const listener of active.listeners){try{listener(event);}catch{ /* A disconnected desktop cannot interrupt a paid model call. */ }}
  active.listeners.clear();
}
