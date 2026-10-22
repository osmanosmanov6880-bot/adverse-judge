// Packaging is performed with the Python standard library; never include secrets.
import {spawnSync} from 'node:child_process';
const result=spawnSync('python',['scripts/package.py'],{stdio:'inherit'});
process.exit(result.status??1);
