#!/usr/bin/env python3
"""Build fully offline self-contained cinema preview with embedded WebP assets."""
from pathlib import Path
import base64, json, re
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text('utf-8')
css=(ROOT/'src/style.css').read_text('utf-8')
html=html.replace('<link rel="stylesheet" href="src/style.css">','<style>\n'+css+'\n</style>')
assets={p.name:'data:image/webp;base64,'+base64.b64encode(p.read_bytes()).decode('ascii') for p in sorted((ROOT/'assets').glob('*.webp'))}
initial='<script>\nwindow.CINEMA_ASSETS='+json.dumps(assets,ensure_ascii=False,separators=(',',':'))+';\n</script>'
html=html.replace('<script src="src/data.js"></script>',initial+'\n<script>\n'+(ROOT/'src/data.js').read_text('utf-8').replace('</script','<\\/script')+'\n</script>')
for name in ['engine','sound','app']:
 html=html.replace(f'<script src="src/{name}.js"></script>','<script>\n'+(ROOT/f'src/{name}.js').read_text('utf-8').replace('</script','<\\/script')+'\n</script>')
html=html.replace('<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">', '<link rel="icon" href="data:image/svg+xml;base64,'+base64.b64encode((ROOT/'assets/favicon.svg').read_bytes()).decode('ascii')+'" type="image/svg+xml">')
dst=ROOT/'dist/ADVERSE-JUDGE-CINEMA-STANDALONE.html';dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(html,'utf-8')
print(f'Built {dst} ({dst.stat().st_size:,} bytes, {len(assets)} WebP resources)')
