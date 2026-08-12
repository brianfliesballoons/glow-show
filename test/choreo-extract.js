/* Slices the three PURE regions out of ../index.html into ./choreo.js:
     PURE CORE  (parser / validator / timeline engine)
     AUDIO ANALYSIS (PURE DSP)
     CHOREOGRAPHER (PURE)
   They ship as one module because the choreographer calls PURE CORE directly
   (validateShow / expandSegments / fmtMMSS) — same code the app runs, no copy. */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(SRC, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

function slice(startMark, endMark) {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark);
  if (a < 0 || b < 0) { console.error('markers missing: ' + startMark); process.exit(1); }
  const from = html.indexOf('*/', a) + 2;
  const to = html.lastIndexOf('/*', b);
  if (from < 2 || to <= from) { console.error('bad slice for ' + startMark); process.exit(1); }
  return html.slice(from, to);
}

const core = slice('PURE CORE  START', 'PURE CORE  END');
const dsp = slice('AUDIO ANALYSIS (PURE DSP)  START', 'AUDIO ANALYSIS (PURE DSP)  END');
const cho = slice('CHOREOGRAPHER (PURE)  START', 'CHOREOGRAPHER (PURE)  END');

fs.writeFileSync(OUT + '/choreo.js',
  core + dsp + cho +
  '\nmodule.exports={' +
  'parseShowText,validateShow,compileShow,stateAt,expandSegments,fmtMMSS,fmtSecs,slugify,SHOW_DEFAULTS,' +
  '_fftFor,_hannWindow,computeFrames,onsetEnvelope,estimateTempo,buildBeats,estimateBarPhase,detectSections,' +
  'sectionFeatures,labelSections,waveSilhouette,analyzePCM,analysisSummary,AN_DEFAULTS,' +
  'CH_DEFAULTS,chOptions,chGrid,chAnalysis,chScheduler,chPlan,chAudit,chBuildShow,choreograph' +
  '};\n');
console.log('choreo bytes: core ' + core.length + ' + dsp ' + dsp.length + ' + choreographer ' + cho.length);
