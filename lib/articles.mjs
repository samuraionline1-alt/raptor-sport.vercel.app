import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_URL = 'https://www.raptorthailand.com';
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (value, field, file) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${file}: ${field} must be nonempty text`);
};
function validate(article, file) {
  if (!article || typeof article !== 'object' || Array.isArray(article)) throw new Error(`${file}: expected an article object`);
  if (typeof article.slug !== 'string' || !slugPattern.test(article.slug)) throw new Error(`${file}: Invalid article slug`);
  if (file !== `${article.slug}.json`) throw new Error(`${file}: filename must match slug`);
  if (article.draft !== undefined && typeof article.draft !== 'boolean') throw new Error(`${file}: draft must be boolean`);
  for (const field of ['title','description','excerpt','category','summary','thumbnailAlt']) text(article[field],field,file);
  for (const field of ['published','modified']) {
    const value = article[field];
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error(`${file}: invalid ${field}`);
  }
  if (article.modified < article.published) throw new Error(`${file}: modified precedes published`);
  if (typeof article.targetProductLink !== 'string' || !/^\/products\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(article.targetProductLink)) throw new Error(`${file}: invalid targetProductLink`);
  if (typeof article.thumbnail !== 'string' || !/^\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|avif)$/.test(article.thumbnail)) throw new Error(`${file}: thumbnail must be a local image path`);
  if (!Array.isArray(article.sections) || !article.sections.length) throw new Error(`${file}: sections required`);
  const ids = new Set(['main','faq','related']);
  for (const section of article.sections) {
    if (!section || typeof section.id !== 'string' || !slugPattern.test(section.id) || ids.has(section.id)) throw new Error(`${file}: invalid or duplicate section id`);
    ids.add(section.id);
    text(section.title,'section title',file);
    if (!Array.isArray(section.paragraphs) || !section.paragraphs.length) throw new Error(`${file}: paragraphs required`);
    section.paragraphs.forEach(p=>text(p,'paragraph',file));
    if (section.items !== undefined) {
      if (!Array.isArray(section.items)) throw new Error(`${file}: items must be an array`);
      section.items.forEach(p=>text(p,'list item',file));
    }
    if (section.productLink !== undefined && typeof section.productLink !== 'boolean') throw new Error(`${file}: productLink must be boolean`);
    if (section.articleLink !== undefined && (typeof section.articleLink !== 'string' || !slugPattern.test(section.articleLink))) throw new Error(`${file}: invalid articleLink`);
  }
  if (article.faqData !== undefined && !Array.isArray(article.faqData)) throw new Error(`${file}: faqData must be an array`);
  for (const faq of article.faqData || []) {
    text(faq?.question,'FAQ question',file); text(faq?.answer,'FAQ answer',file);
  }
}

function findProduct(value) {
  if (Array.isArray(value)) return value.map(findProduct).find(Boolean);
  if (!value || typeof value !== 'object') return null;
  if ([value['@type']].flat().includes('Product')) return value;
  return findProduct(value['@graph']);
}
// Discover any product from its existing page rather than maintaining a fixed SKU list.
async function readProduct(root, targetProductLink) {
  const html = await readFile(path.join(root,targetProductLink.slice(1),'index.html'),'utf8');
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)) {
    const source = findProduct(JSON.parse(script[1]));
    if (!source) continue;
    text(source.name,'product name',targetProductLink);
    const image = [source.image].flat().find(v=>typeof v === 'string');
    if (!image) throw new Error(`${targetProductLink}: product image missing`);
    return {'@type':'Product','@id':source['@id'] || `${SITE_URL}${targetProductLink}#product`,name:source.name,url:`${SITE_URL}${targetProductLink}`,image,description:source.description,brand:source.brand,...(source.additionalProperty?{additionalProperty:source.additionalProperty}:{})};
  }
  throw new Error(`${targetProductLink}: Product schema missing`);
}

export async function getAllArticles({root=defaultRoot, includeDrafts=false}={}) {
  const directory = path.join(root,'data/articles');
  const entries = (await readdir(directory,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith('.json')).sort((a,b)=>a.name.localeCompare(b.name));
  const productCache = new Map();
  const articles = [];
  for (const entry of entries) {
    let article;
    try { article = JSON.parse(await readFile(path.join(directory,entry.name),'utf8')); }
    catch (error) { throw new Error(`${entry.name}: ${error.message}`); }
    validate(article,entry.name);
    // Validate drafts too so copying a template cannot silently introduce errors.
    if (!productCache.has(article.targetProductLink)) productCache.set(article.targetProductLink,readProduct(root,article.targetProductLink));
    const product = await productCache.get(article.targetProductLink);
    await access(path.join(root,article.thumbnail.slice(1))).catch(()=>{throw new Error(`${entry.name}: thumbnail does not exist`);});
    articles.push({...article,faqData:article.faqData||[],product});
  }
  const published = articles.filter(a=>!a.draft);
  const liveSlugs = new Set(published.map(a=>a.slug));
  for (const article of published) for (const section of article.sections) if (section.articleLink && !liveSlugs.has(section.articleLink)) throw new Error(`${article.slug}: related article is missing or draft`);
  return (includeDrafts?articles:published).sort((a,b)=>b.published.localeCompare(a.published)||a.slug.localeCompare(b.slug));
}
export async function getArticleBySlug(slug, options={}) {
  if (typeof slug !== 'string' || !slugPattern.test(slug)) return null;
  return (await getAllArticles(options)).find(article=>article.slug===slug) || null;
}
