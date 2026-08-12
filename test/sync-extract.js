const fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8').replace(/<!--[\s\S]*?-->/g,'');
const a=html.indexOf('const SYNC = {');
const b=html.indexOf('===== T0 / ARMING =====');
const c=html.lastIndexOf('/*', b);
const consts = html.slice(html.indexOf('const SYNC_ROUNDS'), html.indexOf('const DRIFT_WARN_MS')) + 'const DRIFT_WARN_MS=60;\n';
fs.writeFileSync('sync.js', consts + html.slice(a,c) +
  '\nmodule.exports={SYNC,runSync,syncedNow,syncAgeMs,syncStatus,restoreSync,persistSync,median,maybeAutoSync,SYNC_ROUNDS,SYNC_STALE_MS};\n');
console.log('sync bytes:', c-a);
