#!/usr/bin/env python3
from pathlib import Path
import zipfile, hashlib, json
R=Path(__file__).resolve().parents[1]
files=[p for p in R.rglob('*') if p.is_file() and not any(part in {'__pycache__','.pytest_cache','.git'} for part in p.parts)]
sums={str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.suffix in {'.js','.html','.webp','.css','.md'} and p.name !='SHA256SUMS.json'}
(R/'reports/SHA256SUMS.json').write_text(json.dumps(sums,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
files=[p for p in R.rglob('*') if p.is_file() and not any(part in {'__pycache__','.pytest_cache','.git'} for part in p.parts)]
for filename,quick in [('ADVERSE-JUDGE-CINEMA-v1.0.0-full-source.zip',False),('ADVERSE-JUDGE-CINEMA-v1.0.0-QUICK-START.zip',True)]:
 dst=Path('/mnt/data')/filename
 chosen=[p for p in files if not(quick and ('source-boards' in p.parts or (p.parent.name=='reports' and p.suffix.lower() in {'.png','.jpg','.jpeg'})))]
 with zipfile.ZipFile(dst,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=8) as z:
  for p in sorted(chosen):z.write(p,arcname='ADVERSE-JUDGE-CINEMA/'+str(p.relative_to(R)))
 with zipfile.ZipFile(dst) as z: assert z.testzip() is None
 print('Created',filename,dst.stat().st_size,'bytes',len(chosen),'files')
