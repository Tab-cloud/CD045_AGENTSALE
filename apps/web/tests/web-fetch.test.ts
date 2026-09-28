import {it,expect,vi} from 'vitest';
import {fetchSource,requestBytes} from '../packages/automation/src/network';
const reply=(url:string,status=200,body='',headers:Record<string,string>={'content-type':'text/html'})=>({url,status,body:Buffer.from(body),headers});
const html='<html><title>公开资料</title><body><script>HIDDEN_SCRIPT</script><p>'+('可验证的正文材料。'.repeat(30))+'</p></body></html>';
it('reads HTML with timestamp and fingerprint, stripping executable content',async()=>{
 const transport=vi.fn<typeof requestBytes>().mockImplementation(async url=>url.endsWith('/robots.txt')?reply(url,404):reply(url,200,html));
 const source=await fetchSource('https://example.com/article',[],transport);
 expect(source.text).toContain('可验证的正文材料');expect(source.text).not.toContain('HIDDEN_SCRIPT');expect(source.hash).toMatch(/^[a-f0-9]{64}$/);expect(Date.parse(source.fetchedAt)).toBeGreaterThan(0);
 expect(transport.mock.calls[1][1]).toEqual({allowedDomains:[],followRedirects:false});
});
it('checks robots again before reading a redirected path',async()=>{
 const transport=vi.fn<typeof requestBytes>().mockImplementation(async url=>url.endsWith('/robots.txt')?reply(url,200,'User-agent: *\nDisallow: /private'):reply(url,302,'',{location:'/private/data'}));
 await expect(fetchSource('https://example.com/public',[],transport)).rejects.toMatchObject({code:'ROBOTS_DENIED'});
 expect(transport.mock.calls.map(c=>c[0])).toEqual(['https://example.com/robots.txt','https://example.com/public','https://example.com/robots.txt']);
});
it('rejects private or unapproved redirect targets before requesting them',async()=>{
 for(const target of ['http://127.0.0.1/admin','https://other.example/article']){
  const transport=vi.fn<typeof requestBytes>().mockImplementation(async url=>url.endsWith('/robots.txt')?reply(url,404):reply(url,302,'',{location:target}));
  await expect(fetchSource('https://example.com/a',['example.com'],transport)).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(2);
 }
});
it('keeps robots failures, PDF and login/empty pages explicit',async()=>{
 const cases=[{robots:503,page:html,type:'text/html',code:'ROBOTS_UNAVAILABLE'},{robots:404,page:'PDF',type:'application/pdf',code:'SOURCE_TYPE'},{robots:404,page:'<body>Login</body>',type:'text/html',code:'SOURCE_EMPTY'}];
 for(const c of cases){const transport=vi.fn<typeof requestBytes>().mockImplementation(async url=>url.endsWith('/robots.txt')?reply(url,c.robots):reply(url,200,c.page,{'content-type':c.type}));await expect(fetchSource('https://example.com/a',[],transport)).rejects.toMatchObject({code:c.code});}
});
it('bounds redirect count and extracted text',async()=>{
 const redirect=vi.fn<typeof requestBytes>().mockImplementation(async url=>url.endsWith('/robots.txt')?reply(url,404):reply(url,302,'',{location:'/again'}));
 await expect(fetchSource('https://example.com/a',[],redirect)).rejects.toMatchObject({code:'REDIRECT_LIMIT'});expect(redirect).toHaveBeenCalledTimes(8);
 const transport=vi.fn<typeof requestBytes>().mockImplementation(async url=>url.endsWith('/robots.txt')?reply(url,404):reply(url,200,'<body>'+('正文'.repeat(20000))+'</body>'));
 expect((await fetchSource('https://example.com/a',[],transport)).text.length).toBe(18000);
});
