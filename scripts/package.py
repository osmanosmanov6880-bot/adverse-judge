from pathlib import Path
import zipfile
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent.parent/'ADVERSE-JUDGE-v0.30.0-WAVES-21-25-source.zip'
IGNORE={'data','node_modules','.git','__pycache__','backups','browser','screenshots','browser-04','browser-v05','browser-v05-baseline'}
def allowed(p):
    rel=p.relative_to(ROOT)
    if set(rel.parts)&IGNORE: return False
    if p.name.startswith('.env') and p.name != '.env.example': return False
    if p.name.endswith(('.sqlite-shm','.sqlite-wal','.log')): return False
    if p.suffix=='.sqlite' and rel.parts[:2] != ('tests','fixtures'): return False
    return True
paths=[p for p in ROOT.rglob('*') if p.is_file() and allowed(p)]
with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(paths):z.write(p,Path('adverse-judge')/p.relative_to(ROOT))
with zipfile.ZipFile(OUT) as z:
    assert z.testzip() is None
    members=set(z.namelist())
    assert 'adverse-judge/tests/fixtures/v025.sqlite' in members
    assert 'adverse-judge/tests/fixtures/v020.sqlite' in members
    assert 'adverse-judge/tests/fixtures/v010.sqlite' in members
print(f'{OUT}: {len(paths)} files, {OUT.stat().st_size} bytes')
