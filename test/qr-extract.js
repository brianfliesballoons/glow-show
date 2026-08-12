const fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8').replace(/<!--[\s\S]*?-->/g,'');
const a=html.indexOf('const QR = (function () {');
const stop=html.indexOf('===== WAKE LOCK =====', a);
const b=html.lastIndexOf('})();', stop)+5;
fs.writeFileSync('qr.js', html.slice(a,b)+'\nmodule.exports=QR;\n');
console.log('qr bytes:', b-a);
