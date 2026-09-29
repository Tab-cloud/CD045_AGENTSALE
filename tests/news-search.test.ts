import {expect,it} from 'vitest';
import {parseNewsRss} from '../packages/automation/src/providers';

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
