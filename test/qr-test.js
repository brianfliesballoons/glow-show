const QR = require('./qr.js');
let pass=0, fail=0;
const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(x!==undefined?'  -> '+JSON.stringify(x):'')));};
const I = QR._internals;

function decode(res) {
  const size = res.size, v = res.version, m = res.modules;
  const get = (r,c) => m[r][c];
  const bits = [];
  for (let i=0;i<=5;i++) bits[i]=get(i,8);
  bits[6]=get(7,8); bits[7]=get(8,8); bits[8]=get(8,7);
  for (let i=9;i<15;i++) bits[i]=get(8,14-i);
  let fmt=0; for (let i=0;i<15;i++) fmt |= bits[i]<<i;
  const unmasked = fmt ^ 0x5412;
  const ecMask = (unmasked >> 10) & 0x1f;
  const ecLevel = (ecMask >> 3) & 3, mask = ecMask & 7;
  let d = unmasked;
  for (let i=4;i>=0;i--) if (d & (1<<(i+10))) d ^= 0x537<<i;
  if (d !== 0) throw new Error('format BCH does not check out');
  if (ecLevel !== 0) throw new Error('EC level is not M (got '+ecLevel+')');

  const base = I.makeMatrix(v, []);
  const fn = base.fn;
  const mm = m.map(r=>r.slice());
  for (let r=0;r<size;r++) for (let c=0;c<size;c++) if (!fn[r][c] && I.MASKS[mask](r,c)) mm[r][c] ^= 1;
  const stream = [];
  for (let right=size-1; right>=1; right-=2) {
    if (right===6) right=5;
    for (let vert=0; vert<size; vert++) for (let j=0;j<2;j++) {
      const c=right-j, up=((right+1)&2)===0, r=up?size-1-vert:vert;
      if (!fn[r][c]) stream.push(mm[r][c]);
    }
  }
  const cw=[];
  for (let i=0;i+8<=stream.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|stream[i+j];cw.push(b);}

  const t = I.EC_M[v];
  const sizes=[]; for(let i=0;i<t[1];i++) sizes.push(t[2]); for(let i=0;i<t[3];i++) sizes.push(t[4]);
  const blocks = sizes.map(()=>[]);
  let k=0; const maxData=Math.max.apply(null,sizes);
  for (let i=0;i<maxData;i++) for (let b=0;b<blocks.length;b++) if (i<sizes[b]) blocks[b].push(cw[k++]);
  const data=[].concat.apply([],blocks);

  const bitsOf=[]; data.forEach(b=>{for(let i=7;i>=0;i--) bitsOf.push((b>>i)&1);});
  let p=0; const take=n=>{let x=0;for(let i=0;i<n;i++)x=(x<<1)|bitsOf[p++];return x;};
  const mode=take(4);
  if (mode!==4) throw new Error('mode is not byte mode (got '+mode+')');
  const len=take(v<=9?8:16);
  const out=[]; for(let i=0;i<len;i++) out.push(take(8));
  return Buffer.from(out).toString('utf8');
}

console.log('== QR ROUND TRIP (encode -> independent decode of the rendered matrix)');
const cases = [
  'https://brianfliesballoons.github.io/glow-show/?t0=1786000000000',
  'https://brianfliesballoons.github.io/glow-show/?show=https%3A%2F%2Fbrianfliesballoons.github.io%2Fglow-show%2Fshows%2Fdemo-show.json&t0=1786000000000',
  'A',
  'x'.repeat(14), 'x'.repeat(15),
  'x'.repeat(213), 'x'.repeat(214),
  'x'.repeat(666),
  'unicode: cafe · ñ 🎈'
];
cases.forEach(function (s) {
  let res=null, got=null, err=null;
  try { res = QR.encode(s); got = decode(res); } catch(e){ err = e.message; }
  ok('v'+(res?res.version:'?')+' '+(res?res.size+'x'+res.size:'?')+'  '+(s.length>40?'"'+s.slice(0,37)+'..."':'"'+s+'"')+' ('+Buffer.byteLength(s)+'B)',
     got === s, err || (got===null?null:{gotLen:got.length,wantLen:s.length}));
});
// every version boundary
let allV = true, badV = null;
for (let v=1; v<=20; v++) {
  const s = 'G'.repeat(QR.bytesCapacity(v));
  try { const r = QR.encode(s); if (r.version !== v || decode(r) !== s) { allV=false; badV=[v, r&&r.version]; } }
  catch(e){ allV=false; badV=[v, e.message]; }
}
ok('round trip at the exact capacity of ALL 20 supported versions', allV, badV);
ok('667 bytes exceeds v20 capacity -> encode returns null', QR.encode('x'.repeat(667)) === null);

console.log('\n== QR STRUCTURE');
const r = QR.encode('https://brianfliesballoons.github.io/glow-show/?t0=1786000000000');
const m = r.modules, N = r.size;
const finderOK = (r0,c0) => {
  for (let dr=0;dr<7;dr++) for (let dc=0;dc<7;dc++) {
    const md=Math.max(Math.abs(dr-3),Math.abs(dc-3));
    if (m[r0+dr][c0+dc] !== (md!==2?1:0)) return false;
  }
  return true;
};
ok('finder pattern top-left',  finderOK(0,0));
ok('finder pattern top-right', finderOK(0,N-7));
ok('finder pattern bottom-left', finderOK(N-7,0));
let timing=true;
for(let i=8;i<N-8;i++){ if(m[6][i]!==(i%2===0?1:0)) timing=false; if(m[i][6]!==(i%2===0?1:0)) timing=false; }
ok('timing patterns alternate on row/col 6', timing);
ok('dark module set at (size-8, 8)', m[N-8][8]===1);
ok('separators light around the top-left finder', m[7][0]===0 && m[0][7]===0 && m[7][7]===0);
let dark=0; for(let a=0;a<N;a++) for(let b=0;b<N;b++) dark+=m[a][b];
const pct = dark*100/(N*N);
ok('dark proportion 40-60% after mask selection ('+pct.toFixed(1)+'%)', pct>40 && pct<60);
ok('capacity table: v1=14, v10=213, v20=666 bytes',
   QR.bytesCapacity(1)===14 && QR.bytesCapacity(10)===213 && QR.bytesCapacity(20)===666,
   [QR.bytesCapacity(1),QR.bytesCapacity(10),QR.bytesCapacity(20)]);
let capMono=true; for(let v=2;v<=20;v++) if(QR.bytesCapacity(v)<=QR.bytesCapacity(v-1)) capMono=false;
ok('capacity monotonic across all 20 versions', capMono);
// alignment patterns present for v>=2
const r7 = QR.encode('y'.repeat(120)); // v7+, exercises version-info blocks
ok('v'+r7.version+' encodes and round-trips (version-info blocks path)', decode(r7)==='y'.repeat(120));

console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail?1:0);
