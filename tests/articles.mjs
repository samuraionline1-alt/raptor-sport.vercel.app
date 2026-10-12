import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root,file),'utf8');
const articles = JSON.parse(await read('data/articles.json'));
const sitemap = await read('sitemap.xml');
const base = 'https://www.raptorthailand.com';
const escape = value => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for (const article of articles) {
  const url = `${base}/articles/${article.slug}/`;
  const html = await read(`articles/${article.slug}/index.html`);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const schema = graph.find(n=>n['@type']==='Article');
  assert.equal(schema.headline,article.title);
  assert.equal(schema.mainEntityOfPage['@id'],url);
  assert.equal(schema.dateModified.slice(0,10),article.modified);
  assert.equal(graph.find(n=>n['@type']==='Product')['@id'],schema.about['@id']);
  assert.match(graph.find(n=>n['@type']==='Product').description,/ไม่มีส่วนผสมของการบูร/);
  const faqs = graph.find(n=>n['@type']==='FAQPage').mainEntity;
  assert.equal(faqs.length,article.faqs.length);
  faqs.forEach(faq=>{
    assert.ok(html.includes(`<summary>${escape(faq.name)}</summary>`));
    assert.ok(html.includes(`<p>${escape(faq.acceptedAnswer.text)}</p>`));
  });
  assert.equal((html.match(/<h1>/g)||[]).length,1);
  assert.match(html,/<article><header>/);
  assert.match(html,/href="\/products\/raptor-cooling-spray\/"/);
  assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
  assert.ok(sitemap.includes(`<loc>${url}</loc>`));
  assert.ok((await read('articles/index.html')).includes(`href="/articles/${article.slug}/"`));
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
    const href = match[1].split('?')[0];
    if (!href.startsWith('/')) continue;
    const file = href.endsWith('/') ? `${href}index.html` : href;
    await assert.doesNotReject(()=>read(file.slice(1)),`Broken link: ${href}`);
  }
  for (const match of html.matchAll(/href="#([^\"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
}
assert.ok((await read('index.html')).includes('href="/articles/"'));
assert.ok((await read('products/raptor-cooling-spray/index.html')).includes('href="/articles/how-cooling-spray-works/"'));
assert.equal(JSON.parse(await read('vercel.json')).buildCommand,'npm run build');
assert.equal(JSON.parse(await read('vercel.json')).outputDirectory,'.');

// Exercise new article discovery, escaping, removals and repeat builds in isolation.
const fixture = await mkdtemp(path.join(tmpdir(),'raptor-articles-'));
try {
  for (const directory of ['data','scripts']) await mkdir(path.join(fixture,directory));
  await copyFile(path.join(root,'scripts/build-articles.mjs'),path.join(fixture,'scripts/build-articles.mjs'));
  await copyFile(path.join(root,'sitemap.xml'),path.join(fixture,'sitemap.xml'));
  const added = {...articles[0],slug:'test-new-article',title:'Test <script> & title',sections:[{id:'test',title:'Test',paragraphs:['Literal </script> content'],productLink:true}]};
  await writeFile(path.join(fixture,'data/articles.json'),JSON.stringify([...articles,added]));
  let run = 0;
  const build = () => import(`${pathToFileURL(path.join(fixture,'scripts/build-articles.mjs')).href}?run=${run++}`);
  await build();
  const page = await readFile(path.join(fixture,'articles/test-new-article/index.html'),'utf8');
  assert.ok(page.includes('Test &lt;script&gt; &amp; title'));
  assert.ok(page.includes('Test \\u003cscript> & title'));
  const first = await readFile(path.join(fixture,'sitemap.xml'),'utf8');
  await build();
  assert.equal(await readFile(path.join(fixture,'sitemap.xml'),'utf8'),first,'Build must be idempotent');
  assert.equal((first.match(/<loc>[^<]*\/articles\/test-new-article\/<\/loc>/g)||[]).length,1);
  await writeFile(path.join(fixture,'data/articles.json'),JSON.stringify(articles));
  await build();
  assert.ok(!(await readFile(path.join(fixture,'sitemap.xml'),'utf8')).includes('/test-new-article/'));
  await assert.rejects(()=>readFile(path.join(fixture,'articles/test-new-article/index.html')));
  await writeFile(path.join(fixture,'data/articles.json'),JSON.stringify([{...added,slug:'../../escape'}]));
  await assert.rejects(build,/Invalid or duplicate article slug/);
} finally { await rm(fixture,{recursive:true,force:true}); }
console.log(`PASS: ${articles.length} articles, schema/visible FAQ parity, links, sitemap updates, escaping and repeat builds`);
