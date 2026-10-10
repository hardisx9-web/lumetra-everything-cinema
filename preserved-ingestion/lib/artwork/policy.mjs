// Fail-closed film-artwork policy. Search ranking is never identity or permission.
export const plain = value => String(value?.value ?? value ?? '').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#0?39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
export const normalize = value => plain(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function rights(meta={}) {
  const name=plain(meta.LicenseShortName), licenseUrl=plain(meta.LicenseUrl);
  const warnings=plain(meta.Categories)+' '+plain(meta.Restrictions);
  if(/copyright violations|copyrighted in the u\.?s|deletion requests|disputed|fair use|non.free|no permission|freedom of panorama|personality|trademark/i.test(warnings))return null;
  if (/^public domain$/i.test(name) && plain(meta.Copyrighted).toLowerCase()==='false') return {name, url:licenseUrl||'https://creativecommons.org/publicdomain/mark/1.0/',basis:'PUBLIC_DOMAIN',statement:plain(meta.UsageTerms)};
  if(/^CC0(?: 1\.0)?$/i.test(name))return {name,url:licenseUrl||'https://creativecommons.org/publicdomain/zero/1.0/',basis:'CC0',statement:plain(meta.UsageTerms)};
  // NC/ND/GFDL/custom licenses are not silently broadened. SA is preserved in
  // attribution; only unaltered scans and proportional resized variants are made.
  if(/^CC BY(?:-SA)? [1-4]\.0$/i.test(name) && /^https:\/\/creativecommons.org\/licenses\/by(?:-sa)?\/[1-4]\.0\/?$/i.test(licenseUrl))return {name,url:licenseUrl,basis:name.toUpperCase().replaceAll(' ','-'),statement:plain(meta.UsageTerms)};
  return null;
}
export function matchArtwork(work,page) {
  const info=page.imageinfo?.[0],meta=info?.extmetadata||{};
  const reject=reason=>({accepted:false,reason,source_page:info?.descriptionurl||null});
  if(!info||!['image/jpeg','image/png','image/webp'].includes(info.mime))return reject('NOT_SUPPORTED_IMAGE');
  if(info.width<180||info.height<180)return reject('INSUFFICIENT_DIMENSIONS');
  const permission=rights(meta);if(!permission)return reject('RIGHTS_UNVERIFIED_OR_CONFLICTING');
  const desc=plain(meta.ImageDescription),filename=plain(page.title).replace(/^File:/,'');
  const depiction=normalize(filename+' '+desc);
  if(/book cover|fan art|fan made|cosplay|premiere|film festival|exhibition|reloaded|tribute|logo|dvd cover|blu ray|soundtrack|location|recreation|inspired by/.test(depiction))return reject('NOT_FILM_ARTWORK');
  const titles=[work.canonical_title,work.original_title,work.metadata?.displayTitle,...(work.alternate_titles||[])].filter(Boolean).map(normalize).filter(t=>t.length>3);
  const categories=plain(meta.Categories).split('|').map(normalize);
  const datedCategory=categories.find(c=>titles.some(t=>[`${t} ${work.year}`,`${t} ${work.year} film`].includes(c)));
  const fileDate=plain(meta.DateTimeOriginal).match(/^\d{4}$/)?.[0];
  const filmCategory=categories.find(c=>titles.some(t=>c===t||c===`${t} film`));
  const exactCategory=datedCategory || (Number(fileDate)===work.year && /film|movie|motion picture/i.test(desc) ? filmCategory : null);
  const titleYear=titles.some(t=>new RegExp(`(?:^| )${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} ${work.year}(?: |$)`,'u').test(depiction));
  const director=normalize(work.director||'');
  const directorMatch=director.length>5 && normalize(desc+' '+plain(meta.Artist)).includes(director);
  if(!work.year || (!exactCategory && !(titleYear && directorMatch)))return reject('IDENTITY_NOT_CORROBORATED');
  // A category can contain photographs of screenings or people, not just frames.
  let type=null;
  if(/\b(poster|affiche|plakat|plakate|theatrical advertisement)\b/.test(depiction))type='POSTER';
  else if(/\b(still|frame|screenshot|screen shot|scene from|publicity photograph)\b/.test(depiction))type='STILL';
  if(!type)return reject('ARTWORK_TYPE_UNVERIFIED');
  return {accepted:true,reason:'EXACT_FILM_RELATION',type,permission,confidence:exactCategory&&directorMatch?1:0.98,evidence:{work_id:work.work_id,title:work.canonical_title,year:work.year,director:work.director,exact_category:exactCategory||null,director_match:directorMatch,title_year_in_description:titleYear,description:desc,file_title:filename}};
}
