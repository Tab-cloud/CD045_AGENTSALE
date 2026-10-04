export type VoiceEntry={id:string;name:string};

export function appendVoices(value:string,voices:VoiceEntry[]):{value:string;added:number}{
  const configured=new Set(value.split('\n').map(line=>line.split('|')[0].trim()).filter(Boolean));
  const lines:string[]=[];
  for(const voice of voices){
    if(configured.has(voice.id))continue;
    configured.add(voice.id);
    lines.push(voice.id+' | '+(voice.name||voice.id).replace(/[|\r\n]/g,' '));
  }
  if(!lines.length)return {value,added:0};
  const current=value.trimEnd();
  return {value:current+(current?'\n':'')+lines.join('\n'),added:lines.length};
}
