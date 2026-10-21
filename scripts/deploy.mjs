import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync(new URL('../dist/server/wrangler.json',import.meta.url),'utf8'));
const db=config.d1_databases?.find(d=>d.binding==='DB');
if(!db || !db.database_id || db.database_id==='00000000-0000-4000-8000-000000000000') {
 console.error('Set the actual D1 database_id in wrangler.jsonc, apply migrations, and rebuild before deploying.');
 process.exit(1);
}
if(!config.vars?.CF_ACCESS_TEAM_DOMAIN || !config.vars?.CF_ACCESS_AUD) console.warn('Access configuration is empty: the public site can run, but the private studio will stay locked.');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','dist/server/wrangler.json'],{stdio:'inherit'});
process.exit(result.status??1);
