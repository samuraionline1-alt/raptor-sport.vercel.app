# Optional regeneration tool: requires fontTools and brotli; generated assets are committed.
import urllib.request,re,pathlib,hashlib,io,json
from fontTools.ttLib import TTFont
from fontTools import subset
root=pathlib.Path(__file__).resolve().parent.parent;out=root/'assets/vendor';out.mkdir(parents=True,exist_ok=True)
ua='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
def get(url):return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':ua}),timeout=30).read()
def save(data,stem,ext):
 name=f'{stem}-{hashlib.sha256(data).hexdigest()[:12]}.{ext}';(out/name).write_bytes(data);return '/assets/vendor/'+name
css=get('https://fonts.googleapis.com/css2?family=Kanit:wght@400;700&display=swap').decode()
for url in set(re.findall(r'url\((https[^)]+)\)',css)):
 font=get(url);ext='woff2' if font[:4]==b'wOF2' else 'ttf';css=css.replace(url,save(font,'kanit',ext))
css=css.replace('font-weight: 400;', 'font-weight: 100 500;').replace('font-weight: 700;', 'font-weight: 600 900;')
(out/'kanit.css').write_text(css)
fa=get('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css').decode()
html='\n'.join(p.read_text() for p in root.rglob('*.html') if 'node_modules' not in p.parts)
js='\n'.join(p.read_text() for p in root.glob('*.js'))
used=set(re.findall(r'\bfa-[a-z0-9-]+',html+js))
# Keep base CSS and every alias of the icons actually used in source/dynamic templates.
codes=set();kept=[]
for m in re.finditer(r'([^{}]+)\{([^{}]*)\}',fa):
 selector,body=m.groups()
 if 'content:' in body and '.fa-' in selector:
  if any('.'+c+':' in selector for c in used):
   kept.append(selector+'{'+body+'}');codes.update(int(x,16) for x in re.findall(r'content:"\\([0-9a-f]+)"',body))
# Keep original structural/font rules, remove unrelated glyph mappings.
base=re.sub(r'[^{}]+\{[^{}]*content:"\\[0-9a-f]+"[^{}]*\}', '',fa)
# Download and subset WOFF2, keeping ligature/name tables and original code points.
for url in set(re.findall(r'url\(([^)]+\.woff2)\)',base)):
 full=urllib.parse.urljoin('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',url)
 font=TTFont(io.BytesIO(get(full.replace('.woff2','.ttf'))));options=subset.Options();options.flavor='woff2';sub=subset.Subsetter(options=options);sub.populate(unicodes=codes);sub.subset(font);buf=io.BytesIO();font.save(buf);base=base.replace(url,save(buf.getvalue(),'icons','woff2'))
base=re.sub(r'src:([^;{}]+)',lambda m:'src:'+re.search(r'url\([^)]*\.woff2\)\s*format\("woff2"\)',m[1])[0],base)
base=base.replace('font-display:block','font-display:swap')
(out/'icons.css').write_text(base+'\n'+''.join(kept))
print(json.dumps({'icons_used':len(used),'codepoints':len(codes),'files':len(list(out.iterdir())),'bytes':sum(p.stat().st_size for p in out.iterdir())}))
