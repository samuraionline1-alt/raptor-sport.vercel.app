# Local-only integration fixture; does not contact Google or Meta.
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
from pathlib import Path
import json,os
root=Path(__file__).resolve().parent.parent;os.chdir(root)
events=root/'work/tracking-mock-events.jsonl';events.parent.mkdir(exist_ok=True);events.write_text('')
def endpoint(url):return '/api/tracking-script?url='+__import__('urllib.parse',fromlist=['quote']).quote(url,safe='')
gtm=endpoint('https://www.googletagmanager.com/gtm.js?id=GTM-TW2P4VN5')
meta=endpoint('https://connect.facebook.net/en_US/fbevents.js')
queue=(root/'tracking-queue.js').read_text();adapter=(root/'tracking-meta.js').read_text().replace('https://connect.facebook.net/en_US/fbevents.js',meta)
fixture='''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local mock tracking integration</title><script>'''+queue+'''</script><script src="/tracking-worker-bootstrap.js" defer></script>
<script type="text/partytown">window.dataLayer=window.dataLayer||[];window.dataLayer.push({event:'gtm.js'});var s=document.createElement('script');s.src='''+json.dumps(gtm)+''';document.head.appendChild(s);</script>
<script type="text/partytown">'''+adapter+'''window.RaptorInitMetaPixel();fbq('init','462184846324554');fbq('track','PageView');window.RaptorReplayMetaQueue();</script>
<script>document.addEventListener('DOMContentLoaded',function(){dataLayer.push({event:'purchase',transaction_id:'LOCAL-MOCK-ONLY'});fbq('track','Purchase',{value:329,currency:'THB'});});</script></head><body><h1>Local mock tracking integration</h1><p>No requests are sent to real tracking vendors.</p></body></html>'''
class Handler(SimpleHTTPRequestHandler):
 def send_text(self,data,type='text/html'):
  data=data.encode();self.send_response(200);self.send_header('Content-Type',type);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_GET(self):
  u=urlparse(self.path)
  if u.path=='/test-tracking':return self.send_text(fixture)
  if u.path=='/__test/results':return self.send_text('['+','.join(events.read_text().splitlines())+']','application/json')
  if u.path=='/api/tracking-script':
   remote=parse_qs(u.query).get('url',[''])[0]
   if '/gtm.js?' in remote:
    js="""(function(){var start=performance.now();while(performance.now()-start<500){};var q=window.dataLayer=window.dataLayer||[];var old=q.push.bind(q);function send(e){if(e&&e.event)navigator.sendBeacon('/__test/events',JSON.stringify({vendor:'google',event:e.event}));}q.push=function(){var a=Array.from(arguments);a.forEach(send);return old.apply(q,a);};Array.from(q).forEach(send);}());"""
   elif '/fbevents.js' in remote:
    js="""(function(){var start=performance.now();while(performance.now()-start<500){};var q=window.fbq;function send(){var a=Array.from(arguments);if(a[0]!=='init')navigator.sendBeacon('/__test/events',JSON.stringify({vendor:'meta',event:a[1]}));}q.callMethod=send;var pending=q.queue.splice(0);pending.forEach(function(a){send.apply(null,a);});}());"""
   else:self.send_error(400);return
   return self.send_text(js,'application/javascript')
  return super().do_GET()
 def do_POST(self):
  if urlparse(self.path).path!='/__test/events':return self.send_error(404)
  data=self.rfile.read(int(self.headers.get('Content-Length',0))).decode()
  with events.open('a') as out:out.write(data+'\n')
  self.send_response(204);self.end_headers()
ThreadingHTTPServer(('127.0.0.1',8767),Handler).serve_forever()
