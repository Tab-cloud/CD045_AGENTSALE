import {expect,it} from 'vitest';
import {decodeSpeechAudio} from '../admin-console/components/speech-test-audio';

it('decodes only completed, valid MiniMax speech audio',()=>{
 const audio=Uint8Array.from([0x49,0x44,0x33,0x01]);
 expect(decodeSpeechAudio({base_resp:{status_code:0},data:{status:2,audio:'49443301'}})).toEqual(audio);
 for(const payload of [
  {base_resp:{status_code:0},data:{status:1,audio:'49443301'}},
  {base_resp:{status_code:0},data:{status:2,audio:'4944330'}},
  {base_resp:{status_code:0},data:{status:2,audio:'not-hex'}},
  {base_resp:{status_code:2042},data:{status:2,audio:'49443301'}}
 ])expect(()=>decodeSpeechAudio(payload)).toThrow();
});
