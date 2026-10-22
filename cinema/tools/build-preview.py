from pathlib import Path
from base64 import b64encode
import json
root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text('utf-8')
css=(root/'src/style.css').read_text('utf-8')
html=html.replace('<link rel="stylesheet" href="src/style.css">','<style>'+css+'</style>')
images={f.name:'data:image/webp;base64,'+b64encode(f.read_bytes()).decode('ascii') for f in (root/'assets').glob('*.webp')}
assets='<script>window.CINEMA_ASSETS='+json.dumps(images,separators=(',',':'))+';</script>'
html=html.replace('  <script src="src/data.js"></script>',assets+'\n  <script>'+ (root/'src/data.js').read_text('utf-8') +'</script>')
for name in ['engine','sound','app']:
 html=html.replace('  <script src="src/'+name+'.js"></script>','  <script>'+ (root/'src'/f'{name}.js').read_text('utf-8') +'</script>')
html=html.replace('<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">','')
out=root/'dist'/'ADVERSE-JUDGE-CINEMATIC-DEMO.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html,'utf-8')
print(out,round(out.stat().st_size/1024),'KiB',len(images),'assets')
