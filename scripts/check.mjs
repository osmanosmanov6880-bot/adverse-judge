import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
let count=0;
for(const dir of ['public','server','shared','scripts','tests'])for(const name of readdirSync(dir))if(name.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',`${dir}/${name}`],{stdio:'inherit'});if(r.status)process.exit(r.status);count++;}
console.log(`Syntax checks passed: ${count} modules`);
