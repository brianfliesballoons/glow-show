const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const OUT = __dirname;
const raw = fs.readFileSync(SRC, 'utf8');
const html = raw.replace(/<!--[\s\S]*?-->/g, '');   // drop HTML comments first

const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m, i = 0;
while ((m = re.exec(html))) fs.writeFileSync(OUT + '/script-' + (i++) + '.js', m[1]);
console.log('script blocks extracted:', i);

// PURE CORE: from the */ that closes the START banner to the /* that opens the END banner
const a = html.indexOf('PURE CORE  START');
const b = html.indexOf('PURE CORE  END');
if (a < 0 || b < 0) { console.error('markers missing'); process.exit(1); }
const from = html.indexOf('*/', a) + 2;
const to   = html.lastIndexOf('/*', b);
const core = html.slice(from, to);
fs.writeFileSync(OUT + '/pure-core.js',
  core + '\nmodule.exports={parseShowText,validateShow,compileShow,stateAt,expandSegments,fmtMMSS,fmtSecs,slugify,SHOW_DEFAULTS};\n');
console.log('pure core bytes:', core.length);
