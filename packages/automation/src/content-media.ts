import sharp from 'sharp';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { artifact,ownedFile,hash } from './media';
import { FlowError,type Job,type Asset } from './types';
export const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function wrap(text:string,columns:number){const words=text.split(/(\s+|[\u2e80-\uffff])/).filter(Boolean),rows:string[]=[];let line='';const width=(s:string)=>Array.from(s).reduce((sum,c)=>sum+(c.charCodeAt(0)>255?2:1),0);for(const word of words){if(width(line+word)>columns&&line.trim()){rows.push(line.trim());line='';}if(width(word)>columns)throw new FlowError('POSTER_TEXT','海报包含过长的连续文字，请增加空格或缩短文字');line+=word;}if(line.trim())rows.push(line.trim());return rows;}
function fit(text:string,initial:number,maxRows:number){for(let size=initial;size>=24;size-=2){const rows=wrap(text,Math.floor(1740/size));if(rows.length<=maxRows)return {size,rows};}throw new FlowError('POSTER_TEXT','海报文字过长，请缩短标题或副标题');}
export async function renderPosters(root:string,job:Job,asset:Asset){
  if(!job.copy||asset.productId!==job.productId)throw new FlowError('POSTER_INPUT','海报需要当前商品的文案与图片');
  const bytes=await readFile(ownedFile(root,asset.file));if(hash(bytes)!==asset.hash)throw new FlowError('ASSET_CHANGED','商品图片已变化');
  const copy=job.copy.poster||{headline:job.copy.scenes[0].headline,subheading:job.copy.scenes[0].caption,cta:'Learn more'};
  const heading=fit(copy.headline,64,3),sub=fit(copy.subheading,32,3),cta=fit(copy.cta,28,2),files=[];
  for(const [name,height] of [['square',1080],['portrait',1350],['story',1920]] as const){
    const photoTop=160+heading.rows.length*(heading.size+10),photoHeight=height-photoTop-260;
    const photo=await sharp(bytes).resize(936,photoHeight,{fit:'contain',background:'#f5f5f7'}).png().toBuffer();
    const svg=Buffer.from(`<svg width="1080" height="${height}" xmlns="http://www.w3.org/2000/svg"><g fill="#1d1d1f" font-family="Microsoft YaHei,Segoe UI,sans-serif"><text x="72" y="58" font-size="18" fill="#6e6e73">PRODUCT COLLECTION · DRAFT</text>${heading.rows.map((v,i)=>`<text x="72" y="${130+i*(heading.size+10)}" font-size="${heading.size}" font-weight="600">${escapeHtml(v)}</text>`).join('')}${sub.rows.map((v,i)=>`<text x="72" y="${height-205+i*(sub.size+8)}" font-size="${sub.size}">${escapeHtml(v)}</text>`).join('')}${cta.rows.map((v,i)=>`<text x="72" y="${height-72+i*32}" font-size="${cta.size}" fill="#0066cc">${escapeHtml(v)}</text>`).join('')}</g></svg>`);
    const file=`jobs/${job.id}/poster-${name}.png`,target=ownedFile(root,file);await mkdir(path.dirname(target),{recursive:true});
    await sharp({create:{width:1080,height,channels:4,background:'#ffffff'}}).composite([{input:photo,left:72,top:photoTop},{input:svg,left:0,top:0}]).png().toFile(target);files.push(await artifact(root,file,'image/png'));
  }
  return files;
}
export function listingDocuments(job:Job):Record<string,string>{
  const l=job.copy?.listing;if(!l)return {};
  const h=escapeHtml;
  const html=`<!doctype html><html lang="${h(l.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${h(l.seoTitle)}</title><meta name="description" content="${h(l.seoDescription)}"><style>body{font:16px/1.7 system-ui;color:#1d1d1f;max-width:760px;margin:60px auto;padding:24px}h1{font-size:36px}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ddd;padding:12px}p{white-space:pre-wrap}small{color:#666}</style></head><body><small>DRAFT · FOR REVIEW</small><h1>${h(l.title)}</h1><p>${h(l.summary)}</p><ul>${l.bullets.map(s=>`<li>${h(s)}</li>`).join('')}</ul><p>${h(l.description)}</p><table>${l.specifications.map(s=>`<tr><td>${h(s.name)}</td><td>${h(s.value)}</td></tr>`).join('')}</table><small>${l.missing.map(h).join(' · ')}</small></body></html>`;
  return {'product-listing.json':JSON.stringify(l,null,2),'product-description.html':html,'product-description.txt':[l.title,l.summary,l.bullets.map(s=>'• '+s).join('\n'),l.description,l.specifications.map(s=>s.name+': '+s.value).join('\n'),'SEO: '+l.seoTitle,l.seoDescription,'Keywords: '+l.keywords.join(', '),'Missing: '+l.missing.join('; '),'DRAFT · NOT PUBLISHED'].join('\n\n')};
}
