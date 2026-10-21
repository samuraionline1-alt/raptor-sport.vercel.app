import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getAllArticles, SITE_URL } from '../lib/articles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = SITE_URL;
const articles = await getAllArticles({root});
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const dateLabel = value => new Intl.DateTimeFormat('th-TH', {dateStyle:'long', timeZone:'Asia/Bangkok'}).format(new Date(`${value}T00:00:00+07:00`));
const articlePath = article => `/articles/${article.slug}/`;
const articleUrl = article => `${base}${articlePath(article)}`;

const slugs = new Set(articles.map(article=>article.slug));

const organization = {'@type':'Organization','@id':`${base}/#organization`,name:'RAPTOR Thailand',url:`${base}/`};
const breadcrumbs = article => ({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'หน้าหลัก',item:`${base}/`},{'@type':'ListItem',position:2,name:'บทความ',item:`${base}/articles/`},...(article ? [{'@type':'ListItem',position:3,name:article.title,item:articleUrl(article)}] : [])]});
function schema(article) {
  const url = articleUrl(article);
  return {'@context':'https://schema.org','@graph':[
    organization, article.product,
    {'@type':'Article','@id':`${url}#article`,headline:article.title,description:article.description,url,mainEntityOfPage:{'@type':'WebPage','@id':url},image:[`${base}${article.thumbnail}`],datePublished:`${article.published}T00:00:00+07:00`,dateModified:`${article.modified}T00:00:00+07:00`,inLanguage:'th-TH',author:{'@id':organization['@id']},publisher:{'@id':organization['@id']},about:{'@id':article.product['@id']},articleSection:article.category},
    ...(article.faqData.length ? [{'@type':'FAQPage','@id':`${url}#faq`,url:`${url}#faq`,inLanguage:'th-TH',mainEntity:article.faqData.map(faq=>({'@type':'Question',name:faq.question,acceptedAnswer:{'@type':'Answer',text:faq.answer}}))}] : []),
    breadcrumbs(article)
  ]};
}
function shell({title, description, url, structured, body, article}) {
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} | RAPTOR Thailand</title>
<meta name="description" content="${escape(description)}">
<meta name="robots" content="index, follow, max-image-preview:large"><meta name="theme-color" content="#18181b">
<link rel="canonical" href="${url}"><link rel="alternate" hreflang="th-TH" href="${url}"><link rel="alternate" hreflang="x-default" href="${url}">
<meta property="og:type" content="${article?'article':'website'}"><meta property="og:locale" content="th_TH"><meta property="og:site_name" content="RAPTOR Thailand">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${base}${article?.thumbnail || '/raptor-dual-action-pack.png'}"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${base}${article?.thumbnail || '/raptor-dual-action-pack.png'}">
${article ? `<meta property="article:published_time" content="${article.published}T00:00:00+07:00"><meta property="article:modified_time" content="${article.modified}T00:00:00+07:00">` : ''}

<link href="/assets/vendor/kanit.css?v=a11y-20261019" rel="stylesheet">
<link rel="stylesheet" href="/articles.css?v=directory-20261012">
<script type="application/ld+json">${json(structured)}</script>
<link rel="icon" type="image/png" href="/favicon.png?v=original-raptor-20261021">
</head><body>
<a class="skip" href="#main">ข้ามไปเนื้อหา</a>
<header class="site-header"><nav class="nav" aria-label="เมนูหลัก"><a class="brand" href="/">RAPTOR<span> SPORT</span></a><div class="nav-links"><a href="/#shop">ผลิตภัณฑ์</a><a href="/articles/" aria-current="${article?'true':'page'}">บทความ</a><a href="/#contact">ติดต่อเรา</a></div></nav></header>
<main id="main" class="container">${body}</main>
<footer class="footer"><p>RAPTOR Thailand · ความรู้สำหรับนักกีฬา</p><p><a href="/articles/">บทความทั้งหมด</a> · <a href="/#shop">ผลิตภัณฑ์ RAPTOR</a> · <a href="/policies/">นโยบายร้านค้า</a></p></footer>
</body></html>\n`;
}
function crumb(article) {
  return `<nav class="breadcrumbs" aria-label="เส้นทางนำทาง"><ol><li><a href="/">หน้าหลัก</a></li><li>${article?'<a href="/articles/">บทความ</a>':'<span aria-current="page">บทความ</span>'}</li>${article?`<li aria-current="page">${escape(article.title)}</li>`:''}</ol></nav>`;
}
function card(article) {
  return `<article class="card"><a class="card-image" href="${articlePath(article)}" tabindex="-1" aria-hidden="true"><img src="${escape(article.thumbnail)}" alt="" width="480" height="300" loading="lazy" decoding="async"></a><div class="card-content"><span class="eyebrow">${escape(article.category)}</span><h2><a href="${articlePath(article)}">${escape(article.title)}</a></h2><p>${escape(article.excerpt)}</p><p class="meta"><time datetime="${article.published}">${dateLabel(article.published)}</time> · RAPTOR Thailand</p><a class="button" href="${articlePath(article)}" aria-label="${escape(`อ่านเพิ่มเติม: ${article.title}`)}">อ่านเพิ่มเติม <span aria-hidden="true">→</span></a></div></article>`;
}
await mkdir(path.join(root,'articles'), {recursive:true});
// Only remove obsolete generated pages; leave manually authored routes intact.
for (const entry of await readdir(path.join(root,'articles'), {withFileTypes:true})) {
  if (!entry.isDirectory() || slugs.has(entry.name)) continue;
  const file = path.join(root,'articles',entry.name,'index.html');
  const content = await readFile(file,'utf8').catch(()=> '');
  if (content.startsWith('<!-- generated:raptor-articles -->')) await rm(file);
}
for (const article of articles) {
  const productLink = `<a href="${escape(article.targetProductLink)}">${escape(article.product.name)}</a>`;
  const sections = article.sections.map(section=>`<section aria-labelledby="${section.id}"><h2 id="${section.id}">${escape(section.title)}</h2>${section.paragraphs.map(p=>`<p>${escape(p)}</p>`).join('')}${section.items?.length?`<ul>${section.items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`:''}${section.productLink?`<p>ตรวจสอบส่วนประกอบ วิธีใช้ และรายละเอียดของ ${productLink} บนหน้าผลิตภัณฑ์</p>`:''}${section.articleLink?`<p>อ่านเพิ่มเติม: <a href="/articles/${section.articleLink}/">${escape(articles.find(a=>a.slug===section.articleLink).title)}</a></p>`:''}</section>`).join('');
  const faqs = article.faqData.length ? `<section aria-labelledby="faq"><h2 id="faq">คำถามที่พบบ่อย</h2>${article.faqData.map(faq=>`<details open><summary>${escape(faq.question)}</summary><p>${escape(faq.answer)}</p></details>`).join('')}</section>` : '';
  const related = articles.filter(a=>a.slug!==article.slug).sort((a,b)=>Number(b.targetProductLink===article.targetProductLink)-Number(a.targetProductLink===article.targetProductLink)).slice(0,3);
  const body = `${crumb(article)}<article><header><p class="eyebrow">RAPTOR KNOWLEDGE · ${escape(article.category)}</p><h1>${escape(article.title)}</h1><p class="meta">โดย <a href="/">RAPTOR Thailand</a> · เผยแพร่ <time datetime="${article.published}">${dateLabel(article.published)}</time> · อัปเดต <time datetime="${article.modified}">${dateLabel(article.modified)}</time></p><div class="summary"><h2>คำตอบโดยย่อ</h2><p>${escape(article.summary)}</p></div></header><div class="article-layout"><div class="prose">${sections}${faqs}<p class="note">เนื้อหาจัดทำโดย RAPTOR Thailand เพื่อให้ข้อมูลทั่วไป ไม่ใช่คำวินิจฉัยหรือคำแนะนำเฉพาะบุคคล ข้อมูลผลิตภัณฑ์และวิธีใช้: ${productLink} โปรดตรวจสอบฉลากปัจจุบันก่อนใช้</p></div><aside class="sidebar" aria-label="สารบัญและผลิตภัณฑ์"><nav class="toc" aria-label="สารบัญ"><h2>ในบทความนี้</h2><ol>${article.sections.map(s=>`<li><a href="#${s.id}">${escape(s.title)}</a></li>`).join('')}${article.faqData.length?'<li><a href="#faq">คำถามที่พบบ่อย</a></li>':''}</ol></nav><div class="product"><img src="${escape(article.thumbnail)}" alt="${escape(article.thumbnailAlt)}" width="150" height="180" loading="lazy" decoding="async"><h2>${escape(article.product.name)}</h2><a class="button" href="${escape(article.targetProductLink)}">ดูข้อมูลผลิตภัณฑ์</a></div></aside></div></article>${related.length?`<section class="related" aria-labelledby="related"><h2 id="related">บทความที่เกี่ยวข้อง</h2><ul>${related.map(a=>`<li><a href="${articlePath(a)}">${escape(a.title)}</a></li>`).join('')}</ul></section>`:''}`;
  await mkdir(path.join(root,'articles',article.slug),{recursive:true});
  await writeFile(path.join(root,'articles',article.slug,'index.html'),'<!-- generated:raptor-articles -->\n'+shell({title:article.title,description:article.description,url:articleUrl(article),structured:schema(article),body,article}));
}
const indexTitle = 'บทความและความรู้สำหรับนักกีฬา';
await writeFile(path.join(root,'articles/index.html'), shell({title:indexTitle,description:'ความรู้เรื่องการดูแลนักกีฬาและผลิตภัณฑ์ RAPTOR อ่านวิธีใช้ ส่วนประกอบ และคำตอบที่พบบ่อยจากบทความในแต่ละหมวด',url:`${base}/articles/`,structured:{'@context':'https://schema.org','@graph':[organization,{'@type':'CollectionPage','@id':`${base}/articles/`,name:indexTitle,url:`${base}/articles/`,inLanguage:'th-TH',mainEntity:{'@type':'ItemList',itemListElement:articles.map((a,i)=>({'@type':'ListItem',position:i+1,name:a.title,url:articleUrl(a)}))}},breadcrumbs()]},body:`${crumb()}<header><p class="eyebrow">RAPTOR KNOWLEDGE</p><h1>${indexTitle}</h1><p class="intro">ความรู้สำหรับทุกจังหวะของกีฬา ตั้งแต่การเตรียมตัว การดูแลหลังออกกำลังกาย ไปจนถึงการเลือกผลิตภัณฑ์ RAPTOR ให้เหมาะกับคุณ</p></header><div class="grid">${articles.length?articles.map(card).join(''):'<p>กำลังเตรียมบทความใหม่ โปรดกลับมาอ่านอีกครั้ง</p>'}</div>`}));

// Preserve all existing non-article sitemap entries and replace generated entries.
const sitemapFile = path.join(root,'sitemap.xml');
let sitemap = await readFile(sitemapFile,'utf8');
sitemap = sitemap.replace(/\s*<url>\s*<loc>https:\/\/www\.raptorthailand\.com\/articles\/(?:[^<]*)<\/loc>[\s\S]*?<\/url>/g,'');
const latest = articles.map(a=>a.modified).sort().at(-1);
const entries = [{url:`${base}/articles/`,modified:latest},...articles.map(a=>({url:articleUrl(a),modified:a.modified}))];
sitemap = sitemap.replace('</urlset>',`${entries.map(e=>`  <url>\n    <loc>${e.url}</loc>\n${e.modified?`    <lastmod>${e.modified}</lastmod>\n`:''}    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`).join('\n')}\n</urlset>`);
await writeFile(sitemapFile,sitemap);
console.log(`Built /articles/ and ${articles.length} article pages; sitemap updated.`);
