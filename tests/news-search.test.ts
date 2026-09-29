import {expect,it} from 'vitest';
import {newsSearch,parseNewsRss} from '../packages/automation/src/providers';
import {requestBytes} from '../packages/automation/src/network';
import {defaults,type SecretSettings} from '../packages/automation/src/types';

it('discovers recent publisher articles from RSS and excludes stale or unsafe links',()=>{
 const xml=`<rss><channel>
  <item><title>World event A</title><link>https://news.example.com/world/2026/09/story-a</link><description>Confirmed details</description><pubDate>Mon, 28 Sep 2026 08:00:00 GMT</pubDate></item>
  <item><title>Old event</title><link>https://news.example.com/world/old</link><pubDate>Thu, 24 Sep 2026 08:00:00 GMT</pubDate></item>
  <item><title>Unsafe</title><link>http://127.0.0.1/private</link><pubDate>Mon, 28 Sep 2026 08:00:00 GMT</pubDate></item>
  <item><title>Duplicate</title><link>https://news.example.com/world/2026/09/story-a</link><pubDate>Mon, 28 Sep 2026 09:00:00 GMT</pubDate></item>
 </channel></rss>`;
 expect(parseNewsRss(xml,new Date('2026-09-28T12:00:00Z'))).toEqual([{
  title:'World event A',url:'https://news.example.com/world/2026/09/story-a',
  description:'Confirmed details',source:'news_rss',publishedAt:'2026-09-28T08:00:00.000Z'
 }]);
});

it('returns recent publisher articles when some news feeds are unavailable',async()=>{
 const config={...defaults,apiKey:'',minimaxKey:'',verifiedAt:null,revision:'fixture'} as SecretSettings;
 const xml=(name:string)=>`<rss><channel><item><title>${name}</title><link>https://news.example.com/world/${name}</link><description>Article summary</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
 const transport=(async(url:string)=>{
  if(url.includes('guardian'))throw new Error('publisher unavailable');
  return {status:200,headers:{},body:Buffer.from(xml(url.includes('bbc')?'bbc':'sky')),url};
 }) as typeof requestBytes;
 const hits=await newsSearch('今日国际新闻',config,{},transport);
 expect(hits.map(hit=>hit.title)).toEqual(['bbc','sky']);
 expect(hits.every(hit=>!!hit.publishedAt)).toBe(true);
});

it('does not turn failed current-news discovery into unrelated generic search results',async()=>{
 const config={...defaults,apiKey:'',minimaxKey:'',verifiedAt:null,revision:'fixture'} as SecretSettings;
 const unavailable=(async()=>{throw new Error('feed unavailable');}) as typeof requestBytes;
 await expect(newsSearch('今日国际新闻',config,{},unavailable)).rejects.toMatchObject({code:'NEWS_SOURCE_UNAVAILABLE'});
});
