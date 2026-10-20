import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, copyFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAllArticles, getArticleBySlug, SITE_URL } from '../lib/articles.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root,file),'utf8');
const articles = await getAllArticles({root});
const sitemap = await read('sitemap.xml');
const escape = value => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseSchema = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
for (const article of articles) {
  const url = `${SITE_URL}/articles/${article.slug}/`;
  const html = await read(`articles/${article.slug}/index.html`);
  const graph = parseSchema(html);
  const schema = graph.find(n=>n['@type']==='Article');
  assert.equal(schema.headline,article.title);
  assert.equal(schema.mainEntityOfPage['@id'],url);
  assert.equal(schema.dateModified.slice(0,10),article.modified);
  assert.equal(graph.find(n=>n['@type']==='Product')['@id'],schema.about['@id']);
  assert.deepEqual(schema.image,[`${SITE_URL}${article.thumbnail}`]);
  const faqs = graph.find(n=>n['@type']==='FAQPage')?.mainEntity || [];
  assert.equal(faqs.length,article.faqData.length);
  faqs.forEach(faq=>{
    assert.ok(html.includes(`<summary>${escape(faq.name)}</summary>`));
    assert.ok(html.includes(`<p>${escape(faq.acceptedAnswer.text)}</p>`));
  });
  assert.equal((html.match(/<h1>/g)||[]).length,1);
  assert.match(html,/<article><header>/);
  assert.ok(html.includes(`href="${article.targetProductLink}"`));
  assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
  assert.ok(sitemap.includes(`<loc>${url}</loc>`));
  const index = await read('articles/index.html');
  assert.ok(index.includes(`href="/articles/${article.slug}/"`));
  assert.ok(index.includes(`src="${article.thumbnail}"`));
  assert.ok(index.includes(escape(article.excerpt)));
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
    const href = match[1].split('?')[0];
    if (!href.startsWith('/')) continue;
    await assert.doesNotReject(()=>read((href.endsWith('/')?`${href}index.html`:href).slice(1)),`Broken link: ${href}`);
  }
  for (const match of html.matchAll(/href="#([^\"]+)"/g)) assert.ok(html.includes(`id="${match[1]}"`));
}
assert.equal(await getArticleBySlug('../../escape'),null);
assert.equal(await getArticleBySlug('sample-energy-gel-guide'),null);
assert.ok(!(await read('articles/index.html')).includes('/sample-energy-gel-guide/'));
assert.ok(!sitemap.includes('/sample-energy-gel-guide/'));
assert.ok((await read('index.html')).includes('href="/articles/"'));
assert.equal(JSON.parse(await read('vercel.json')).buildCommand,'npm run build');
assert.equal(JSON.parse(await read('vercel.json')).outputDirectory,'_site');

const fixture = await mkdtemp(path.join(tmpdir(),'raptor-articles-'));
try {
  for (const directory of ['data/articles','scripts','lib','products']) await mkdir(path.join(fixture,directory),{recursive:true});
  for (const file of ['scripts/build-articles.mjs','lib/articles.mjs','sitemap.xml']) await copyFile(path.join(root,file),path.join(fixture,file));
  for (const article of articles) {
    await copyFile(path.join(root,'data/articles',`${article.slug}.json`),path.join(fixture,'data/articles',`${article.slug}.json`));
    await copyFile(path.join(root,article.thumbnail.slice(1)),path.join(fixture,article.thumbnail.slice(1)));
  }
  // All current product routes plus a newly added SKU, with no loader changes.
  await cp(path.join(root,'products'),path.join(fixture,'products'),{recursive:true});
  await mkdir(path.join(fixture,'products/raptor-new-product'),{recursive:true});
  const newProduct = {'@type':'Product','@id':`${SITE_URL}/products/raptor-new-product/#product`,name:'New RAPTOR Product',image:`${SITE_URL}/raptor-go-energy-gel.png`,description:'A new product without cooling-spray claims'};
  await writeFile(path.join(fixture,'products/raptor-new-product/index.html'),`<script type="application/ld+json">${JSON.stringify(newProduct)}</script>`);
  await copyFile(path.join(root,'raptor-go-energy-gel.png'),path.join(fixture,'raptor-go-energy-gel.png'));
  const added = {...articles[0],slug:'test-new-article',title:'Test <script> & title',description:'New product article',summary:'New product summary',excerpt:'New product excerpt',targetProductLink:'/products/raptor-new-product/',thumbnail:'/raptor-go-energy-gel.png',sections:[{id:'test',title:'Test',paragraphs:['Literal </script> content'],productLink:true,items:['List item']}],faqData:[]};
  const file = path.join(fixture,'data/articles/test-new-article.json');
  await writeFile(file,JSON.stringify(added));
  let run = 0;
  const build = () => import(`${pathToFileURL(path.join(fixture,'scripts/build-articles.mjs')).href}?run=${run++}`);
  await build();
  const page = await readFile(path.join(fixture,'articles/test-new-article/index.html'),'utf8');
  assert.ok(page.includes('Test &lt;script&gt; &amp; title'));
  assert.ok(page.includes('Test \\u003cscript> & title'));
  assert.ok(page.includes('<ul><li>List item</li></ul>'));
  const graph = parseSchema(page);
  assert.ok(!graph.some(n=>n['@type']==='FAQPage'));
  assert.ok(!page.includes('id="faq"'));
  assert.equal(graph.find(n=>n['@type']==='Article').about['@id'],newProduct['@id']);
  assert.ok(!JSON.stringify(graph.find(n=>n['@type']==='Product')).includes('ไม่มีส่วนผสมของการบูร'),'New product must not inherit cooling-spray claims');
  const first = await readFile(path.join(fixture,'sitemap.xml'),'utf8');
  await build();
  assert.equal(await readFile(path.join(fixture,'sitemap.xml'),'utf8'),first);
  assert.equal((first.match(/<loc>[^<]*\/articles\/test-new-article\/<\/loc>/g)||[]).length,1);
  // A draft must remove any previous generated page and sitemap entry.
  await writeFile(file,JSON.stringify({...added,draft:true}));
  await build();
  assert.ok(!(await readFile(path.join(fixture,'sitemap.xml'),'utf8')).includes('/test-new-article/'));
  await assert.rejects(()=>readFile(path.join(fixture,'articles/test-new-article/index.html')));
  assert.equal(await getArticleBySlug('test-new-article',{root:fixture}),null);
  assert.ok(await getArticleBySlug('test-new-article',{root:fixture,includeDrafts:true}));
  // No product catalog size limit: every existing product route can be targeted.
  for (const slug of ['raptor-cool-patch','raptor-dual-action-pack','raptor-go-energy-gel','raptor-herbal-cooling-gel','raptor-herbal-roll-on','raptor-ice-defense-sport-shampoo','raptor-sport-foot-spray','raptor-sport-therapy-oil','raptor-v-mix','raptor-warming-spray']) {
    await writeFile(file,JSON.stringify({...added,targetProductLink:`/products/${slug}/`}));
    assert.equal((await getArticleBySlug(added.slug,{root:fixture})).product.url,`${SITE_URL}/products/${slug}/`);
  }
  await writeFile(file,JSON.stringify({...added,slug:'../../escape'}));
  await assert.rejects(build,/Invalid article slug/);
  await writeFile(file,JSON.stringify({...added,targetProductLink:'https://evil.example/'}));
  await assert.rejects(build,/invalid targetProductLink/);
  await writeFile(file,JSON.stringify({...added,thumbnail:'/missing.png'}));
  await assert.rejects(build,/thumbnail does not exist/);
  await writeFile(file,JSON.stringify({...added,sections:[{id:'faq',title:'Invalid',paragraphs:['Test']}]}));
  await assert.rejects(build,/invalid or duplicate section id/);
  await rm(file);
  await build();
  // Preserve unrelated sitemap URLs and manually authored routes.
  assert.ok((await readFile(path.join(fixture,'sitemap.xml'),'utf8')).includes(`${SITE_URL}/products/raptor-cooling-spray/`));
  await mkdir(path.join(fixture,'articles/manual'),{recursive:true});
  await writeFile(path.join(fixture,'articles/manual/index.html'),'Manual page');
  await build();
  assert.equal(await readFile(path.join(fixture,'articles/manual/index.html'),'utf8'),'Manual page');
} finally { await rm(fixture,{recursive:true,force:true}); }
console.log(`PASS: ${articles.length} published articles; per-file discovery, catalog growth, optional FAQ, draft exclusion, sitemap, links and escaping`);
