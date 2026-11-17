/* Suite 5 — irregular fields, sets, pattern cues and per-balloon safety.
   Everything under test is sliced live out of ../index.html by
   choreo-extract.js (PURE CORE + DSP + CHOREOGRAPHER), so these are the
   shipping functions, never a copy.

   Fixture: ../fields/havasu-windsor4-glow.kml — Brian's real glow field (a
   FIELD polygon, three keep-out zones, a CROWD line on the west edge and the
   ACCESS LANE keep-clear line). Distances are checked against an independent
   haversine, so the projection cannot mark its own homework. Per-balloon
   constraint checks re-derive every balloon's lane from compileShow() — the
   path the pilots' phones run — not from the choreographer's scheduler. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const C = require('./choreo.js');
const KML_PATH = path.join(__dirname, '..', 'fields', 'havasu-windsor4-glow.kml');
const DEMO_PATH = path.join(__dirname, '..', 'shows', 'demo-show.json');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
function eq(name, got, want) { ok(name + '  [' + JSON.stringify(got).slice(0, 160) + ']', JSON.stringify(got) === JSON.stringify(want), { got, want }); }
function near(name, got, want, tol) { ok(name + '  [' + got + ' vs ' + want + ' ±' + tol + ']', Math.abs(got - want) <= tol, { got, want }); }
function section(s) { console.log('\n== ' + s); }

/* ---------------------------------------------------- independent helpers */
function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function inPoly(x, y, poly) {        // own ray cast, not the app's
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
function edgeDist(x, y, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
/* a minimal zip writer (local headers, central directory, EOCD, CRC-32) */
const CRC_T = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC_T[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(entries, opts) {
  const o = opts || {}, locals = [], cds = [];
  let off = 0;
  entries.forEach(e => {
    const raw = Buffer.from(e.data), name = Buffer.from(e.name);
    const data = e.method === 8 ? zlib.deflateRawSync(raw) : raw;
    const desc = !!o.descriptor;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(desc ? 8 : 0, 6); lh.writeUInt16LE(e.method, 8);
    lh.writeUInt32LE(desc ? 0 : crc32(raw), 14); lh.writeUInt32LE(desc ? 0 : data.length, 18); lh.writeUInt32LE(desc ? 0 : raw.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const parts = [lh, name, data];
    if (desc) { const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc32(raw), 4); dd.writeUInt32LE(data.length, 8); dd.writeUInt32LE(raw.length, 12); parts.push(dd); }
    const local = Buffer.concat(parts);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(desc ? 8 : 0, 8); cd.writeUInt16LE(e.method, 10);
    cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(off, 42);
    cds.push(Buffer.concat([cd, name]));
    locals.push(local); off += local.length;
  });
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return o.noDirectory ? Buffer.concat(locals) : Buffer.concat([...locals, cdBuf, eocd]);
}
function unzipKml(buf) {
  const z = C.zipFindKml(new Uint8Array(buf));
  if (!z.ok) return { z, text: null };
  const bytes = Buffer.from(z.data);
  return { z, text: (z.method === 8 ? zlib.inflateRawSync(bytes) : bytes).toString('utf8') };
}

/* ========================================================================= */
section('KML — the real Havasu field file');
const KML = fs.readFileSync(KML_PATH, 'utf8');
const parsed = C.parseKml(KML);
ok('parses', parsed.ok, parsed.errors);
eq('document name', parsed.name, 'Havasu glow field (Windsor 4 ramp lot)');
eq('all six placemarks, by name', parsed.placemarks.map(p => p.name),
   ['FIELD', 'NO BALLOONS - power lines to the east', 'PILOT TENT', 'PA + LOCAL RADIO', 'CROWD', 'ACCESS LANE - KEEP CLEAR']);
eq('FIELD is one polygon of 8 corners (closing point dropped)', [parsed.placemarks[0].polygons.length, parsed.placemarks[0].polygons[0].length], [1, 8]);
eq('coordinates read as lon,lat', parsed.placemarks[0].polygons[0][0], [-114.353417, 34.478852]);
ok('descriptions are read (CROWD has one)', /Show front/.test(parsed.placemarks[4].description), parsed.placemarks[4].description);
const K = C.classifyKml(parsed);
ok('classifies', K.ok, K.errors);
eq('FIELD is the field', K.fieldName, 'FIELD');
eq('three keep-out zones, kinds from their names', K.zones.map(z => [z.name, z.kind]),
   [['NO BALLOONS - power lines to the east', 'nob'], ['PILOT TENT', 'tent'], ['PA + LOCAL RADIO', 'pa']]);
eq('the CROWD line is the show front (its two ends)', K.crowd, [[-114.353417, 34.478852], [-114.353417, 34.478278]]);
eq('the ACCESS LANE is a keep-clear line of 4 points', K.lines.map(l => [l.name, l.kind, l.pts.length]), [['ACCESS LANE - KEEP CLEAR', 'keepclear', 4]]);
eq('no warnings on a well-formed file', K.warnings, []);

section('KML — conventions and bad input');
const noField = KML.replace('<name>FIELD</name>', '<name>Lot outline</name>');
const K2 = C.classifyKml(C.parseKml(noField));
ok('no polygon named FIELD -> the largest non-zone polygon is used, with a warning', K2.ok && K2.fieldName === 'Lot outline' && /largest/.test(K2.warnings.join(' ')), K2.warnings);
ok('lower-case "field" still counts as FIELD', C.classifyKml(C.parseKml(KML.replace('<name>FIELD</name>', '<name>field</name>'))).fieldName === 'field');
const twoPts = '<kml><Document><Placemark><name>FIELD</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 0.001,0 0.001,0.001 0,0.001 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>' +
  '<Placemark><name>CROWD</name><Point><coordinates>0,0</coordinates></Point></Placemark><Placemark><name>crowd 2</name><Point><coordinates>0.001,0</coordinates></Point></Placemark></Document></kml>';
eq('a crowd edge can be two CROWD points instead of a line', C.classifyKml(C.parseKml(twoPts)).crowd, [[0, 0], [0.001, 0]]);
const ent = '<kml><Placemark><name><![CDATA[NO BALLOONS & <b>wires</b>]]></name><Polygon><coordinates>0,0 1,0 1,1</coordinates></Polygon></Placemark><Placemark><name>PA &amp; radio</name><Polygon><coordinates>0,0 1,0 1,1</coordinates></Polygon></Placemark></kml>';
eq('CDATA and entities in names are decoded', C.parseKml(ent).placemarks.map(p => p.name), ['NO BALLOONS & wires', 'PA & radio']);
ok('namespaced tags (kml:Placemark) parse', C.parseKml('<kml:kml><kml:Placemark><kml:name>FIELD</kml:name><kml:Polygon><kml:coordinates>0,0 1,0 1,1</kml:coordinates></kml:Polygon></kml:Placemark></kml:kml>').placemarks[0].polygons.length === 1);
ok('a non-KML file is rejected with a reason', !C.parseKml('{"format":"glow-show/1"}').ok);
const onlyZones = C.classifyKml(C.parseKml('<kml><Placemark><name>NO BALLOONS</name><Polygon><coordinates>0,0 1,0 1,1</coordinates></Polygon></Placemark></kml>'));
ok('a file whose only polygon is a keep-out zone is refused (nothing to fill)', !onlyZones.ok && /FIELD/.test(onlyZones.errors[0]), onlyZones.errors);
ok('a file with no polygon at all is refused', !C.classifyKml(C.parseKml('<kml><Placemark><name>x</name><Point><coordinates>0,0</coordinates></Point></Placemark></kml>')).ok);
ok('an unknown polygon is ignored with a note naming it',
   C.classifyKml(C.parseKml(KML.replace('<name>PILOT TENT</name>', '<name>Food trucks</name>'))).warnings.some(w => /Food trucks/.test(w)));

section('KMZ — the zip path (built here with node zlib)');
const kmz = makeZip([{ name: 'files/readme.txt', data: 'not the kml', method: 0 }, { name: 'doc.kml', data: KML, method: 8 }]);
const u1 = unzipKml(kmz);
ok('finds doc.kml inside a KMZ', u1.z.ok && u1.z.name === 'doc.kml', u1.z);
eq('  …deflated (method 8), and it inflates back to the exact KML', [u1.z.method, u1.text === KML], [8, true]);
const u2 = unzipKml(makeZip([{ name: 'glow field.kml', data: KML, method: 0 }]));
eq('a stored (method 0) KML with any name', [u2.z.ok, u2.z.method, u2.text === KML], [true, 0, true]);
const u3 = unzipKml(makeZip([{ name: 'doc.kml', data: KML, method: 8 }], { descriptor: true }));
ok('sizes in a trailing data descriptor (local header says 0) still read from the directory', u3.z.ok && u3.text === KML, u3.z);
const u4 = unzipKml(makeZip([{ name: 'doc.kml', data: KML, method: 0 }], { noDirectory: true }));
ok('a zip with no central directory falls back to walking the local headers', u4.z.ok && u4.text === KML, u4.z);
const u5 = unzipKml(makeZip([{ name: 'a.kml', data: '<kml/>', method: 0 }, { name: 'doc.kml', data: KML, method: 8 }]));
ok('doc.kml wins over another .kml', u5.z.name === 'doc.kml' && u5.text === KML);
ok('a zip with no .kml says so', !C.zipFindKml(new Uint8Array(makeZip([{ name: 'x.png', data: 'png', method: 0 }]))).ok);
ok('plain text is not mistaken for a zip', !C.zipFindKml(new Uint8Array(Buffer.from(KML))).ok);
ok('the KML from inside the KMZ parses to the same field', JSON.stringify(C.classifyKml(C.parseKml(u1.text))) === JSON.stringify(K));

section('PROJECTION — metres, rotation, crowd edge at the bottom');
const F = C.projectField(K);
eq('crowd edge comes from the file', F.crowdFrom, 'file');
near('crowd edge end 1 sits on y = 0', F.crowd[0][1], 0, 1e-5);
near('crowd edge end 2 sits on y = 0', F.crowd[1][1], 0, 1e-5);
ok('the field is above the crowd edge (every outline y >= 0)', F.outline.every(p => p[1] >= -1e-6), F.outline);
eq('one scale on both axes: the larger side is exactly 1', Math.max(F.w, F.h), 1);
ok('everything in the outline is inside 0..1', F.outline.every(p => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1));
const raw0 = K.outline;
[[0, 1], [1, 2], [2, 3], [5, 6], [6, 7], [7, 0], [0, 4]].forEach(([i, j]) => {
  const gotM = Math.hypot(F.outline[i][0] - F.outline[j][0], F.outline[i][1] - F.outline[j][1]) * F.mPerUnit;
  const want = haversine(raw0[i], raw0[j]);
  ok('corner ' + i + '→' + j + ': map distance × mPerUnit = ground distance within 1%  [' + gotM.toFixed(1) + ' m vs ' + want.toFixed(1) + ' m]',
     Math.abs(gotM - want) / want < 0.01, { gotM, want });
});
near('field area ≈ 13,200 m² (Brian\'s figure), within 3%', C.polyArea(F.outline) * F.mPerUnit * F.mPerUnit, 13200, 13200 * 0.03);
near('  …and the stored areaM2 agrees with the normalised outline', F.areaM2, C.polyArea(F.outline) * F.mPerUnit ** 2, 2);
ok('x runs left→right as the crowd sees it: the crowd faces east, so its left (north) end has the smaller x',
   F.crowd[0][0] < F.crowd[1][0], F.crowd);
const zc = z => { const p = z.poly; return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; };
const fieldCy = F.outline.reduce((s, q) => s + q[1], 0) / F.outline.length;
ok('NO BALLOONS (east of the field) lands at the BACK, away from the crowd', zc(F.zones[0])[1] > fieldCy, zc(F.zones[0]));
ok('PA + LOCAL RADIO (south edge) lands on the crowd\'s RIGHT', zc(F.zones[2])[0] > 0.8, zc(F.zones[2]));
ok('the access lane (west of the crowd) lands BEHIND the crowd edge, y < 0', F.lines[0].pts.every(p => p[1] < 0), F.lines[0].pts);
const llBack = C.fieldPtToLonLat(F, F.crowd[0][0], F.crowd[0][1]);
ok('field point → lon/lat recovers the CROWD placemark within ~0.1 m', haversine(llBack, K.crowd[0]) < 0.1, llBack);
const fp = C.lonLatToFieldPt(F, K.crowd[1][0], K.crowd[1][1]);
ok('lon/lat → field point lands on the stored crowd end', Math.hypot(fp[0] - F.crowd[1][0], fp[1] - F.crowd[1][1]) < 1e-4, fp);

section('ROTATION — ⟲/⟳ and "tap an edge"');
const pin = [{ n: 1, group: 'g', x: 0.5, y: 0.4 }];
const llPin = C.fieldPtToLonLat(F, 0.5, 0.4);
const r15 = C.rotateField(F, pin, F.geo.rotDeg + 15);
eq('rotating makes the crowd edge the bottom of the rotated field', [r15.field.crowdFrom, r15.field.crowd[0][1], r15.field.crowd[1][1]], ['rotate', 0, 0]);
near('rotation is by exactly 15°', r15.field.geo.rotDeg - F.geo.rotDeg, 15, 1e-9);
ok('a balloon keeps its real spot on the ground through a rotation (< 2 cm)', haversine(C.fieldPtToLonLat(r15.field, r15.balloons[0].x, r15.balloons[0].y), llPin) < 0.02);
const back = C.rotateField(r15.field, r15.balloons, F.geo.rotDeg);
ok('⟳ then ⟲ returns the same outline (< 1e-4)', back.field.outline.every((p, i) => Math.hypot(p[0] - F.outline[i][0], p[1] - F.outline[i][1]) < 1e-4));
near('  …area is preserved by rotation', back.field.areaM2, F.areaM2, 2);
const crowdEdge = C.fieldEdgeAt(r15.field, (r15.field.outline[7][0] + r15.field.outline[0][0]) / 2, (r15.field.outline[7][1] + r15.field.outline[0][1]) / 2, 0.02);
eq('tapping the middle of the old crowd edge finds that outline edge', crowdEdge, 7);
const ce = C.crowdFromEdge(r15.field, r15.balloons, crowdEdge);
near('making it the crowd edge rotates the field back to the file\'s orientation', ce.field.geo.rotDeg, F.geo.rotDeg, 1e-6);
ok('  …with that edge on y = 0', Math.abs(ce.field.crowd[0][1]) < 1e-5 && Math.abs(ce.field.crowd[1][1]) < 1e-5, ce.field.crowd);
const F30 = C.projectField(K, { rotDeg: 30 });
const carried = C.carryBalloons(F, F30, [{ n: 9, group: 'g', x: 0.5, y: 0.4 }]);
ok('re-import at another rotation carries balloons to the same ground spot', haversine(C.fieldPtToLonLat(F30, carried[0].x, carried[0].y), llPin) < 0.02);
eq('grid reference: row letter from the crowd, column across (25 m squares)', [C.gridRefOf(F, 0, 0), C.gridRefOf(F, 0.5, 0.4)], ['A1', 'C4']);

section('AUTO-FILL — 21 balloons on the Havasu field');
const GIDS = ['north', 'south', 'shapes'];
const A21 = C.autofillField(F, 21, { groupIds: GIDS, minSpacingM: 25 });
eq('exactly 21 spots', A21.balloons.length, 21);
eq('numbered 1..21', A21.balloons.map(b => b.n), Array.from({ length: 21 }, (_, i) => i + 1));
ok('every spot is inside FIELD (own ray cast)', A21.balloons.every(b => inPoly(b.x, b.y, F.outline)));
ok('no spot is inside a keep-out zone', A21.balloons.every(b => F.zones.every(z => !inPoly(b.x, b.y, z.poly))));
const sU = A21.spacingM / F.mPerUnit;
ok('every spot keeps half a spacing from the outline', A21.balloons.every(b => edgeDist(b.x, b.y, F.outline) >= sU / 2 - 1e-6),
   A21.balloons.map(b => +(edgeDist(b.x, b.y, F.outline) * F.mPerUnit).toFixed(1)));
let mp = Infinity;
A21.balloons.forEach((a, i) => A21.balloons.forEach((b, j) => { if (j > i) mp = Math.min(mp, Math.hypot(a.x - b.x, a.y - b.y)); }));
near('reported min pairwise spacing is the real one (m)', A21.minPairM, Math.round(mp * F.mPerUnit * 10) / 10, 0.11);
ok('  …and no two balloons are closer than the reported spacing', mp * F.mPerUnit >= A21.spacingM - 0.1, { mp: mp * F.mPerUnit, s: A21.spacingM });
ok('numbering runs from the crowd edge back (y never decreases with n)', A21.balloons.every((b, i, a) => i === 0 || b.y >= a[i - 1].y - 1e-9));
ok('  …and left→right within each row', A21.balloons.every((b, i, a) => i === 0 || b.y > a[i - 1].y + 1e-9 || b.x > a[i - 1].x));
eq('groups are contiguous depth bands, 7 / 7 / 7', GIDS.map(g => A21.balloons.filter(b => b.group === g).map(b => b.n)),
   [[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21]]);
ok('21 fit about 24 m apart — under the 25 m minimum, so it warns (amber), never drops one', A21.spacingM < 25 && /under your 25 m minimum/.test(A21.warning) && A21.fitted === 21, A21);
ok('at a 20 m minimum the same 21 fit with no warning', C.autofillField(F, 21, { groupIds: GIDS, minSpacingM: 20 }).warning === '');
const A18 = C.autofillField(F, 18, { groupIds: GIDS, minSpacingM: 25 });
ok('18 balloons fit at 25 m or more, no warning  [' + A18.spacingM + ' m]', A18.spacingM >= 25 && A18.warning === '' && A18.balloons.length === 18);
eq('auto-fill is deterministic', JSON.stringify(C.autofillField(F, 21, { groupIds: GIDS })), JSON.stringify(C.autofillField(F, 21, { groupIds: GIDS })));
const tiny = { w: 1, h: 1, mPerUnit: 20, outline: [[0, 0], [1, 0], [1, 1], [0, 1]], zones: [] };
const A300 = C.autofillField(tiny, 300, { groupIds: GIDS });
ok('300 on a 20 m square cannot fit even 2 m apart: it says how many did and does NOT claim success', !A300.ok && A300.short > 0 && A300.fitted + A300.short === 300 && A300.balloons.length === A300.fitted && /Only \d+ of 300/.test(A300.warning), { fitted: A300.fitted, w: A300.warning });
const A600 = C.autofillField(F, 600, { groupIds: GIDS });
ok('600 on the Havasu field do fit (≈5 m apart) — placed, all of them, with the amber warning', A600.ok && A600.fitted === 600 && /under your 25 m/.test(A600.warning), { fitted: A600.fitted, s: A600.spacingM });
eq('0 balloons -> none', C.autofillField(F, 0, {}).balloons.length, 0);
const sq = { w: 1, h: 1, mPerUnit: 200, outline: [[0, 0], [1, 0], [1, 1], [0, 1]], zones: [{ name: 'NO BALLOONS', kind: 'nob', poly: [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]] }] };
const Asq = C.autofillField(sq, 30, { groupIds: ['a'] });
ok('a keep-out zone in the middle of a square field stays empty, with half a spacing of margin',
   Asq.balloons.length === 30 && Asq.balloons.every(b => !inPoly(b.x, b.y, sq.zones[0].poly) && edgeDist(b.x, b.y, sq.zones[0].poly) >= Asq.spacingM / 200 / 2 - 1e-6));

section('SETS — "1–12, 30"');
eq('"1–12, 30" (en dash)', C.parseNumberList('1–12, 30').nums, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 30]);
eq('"1-3,5" (hyphen, no spaces)', C.parseNumberList('1-3,5').nums, [1, 2, 3, 5]);
eq('"12 — 9" (em dash, reversed)', C.parseNumberList('12 — 9').nums, [9, 10, 11, 12]);
eq('"#4, #7" and "3 to 5" and overlaps dedupe', [C.parseNumberList('#4, #7').nums, C.parseNumberList('3 to 5').nums, C.parseNumberList('1–3, 2–4').nums], [[4, 7], [3, 4, 5], [1, 2, 3, 4]]);
ok('junk is refused with the token named', !C.parseNumberList('1, a, 3').ok && /“a”/.test(C.parseNumberList('1, a, 3').error));
ok('empty is refused', !C.parseNumberList('  ').ok);
ok('0 is refused (numbers start at 1)', !C.parseNumberList('0-3').ok);
eq('fmtNums names balloons compactly', C.fmtNums([9, 1, 2, 3, 4, 11, 12]), '#1–4, #9, #11, #12');
eq('normalizeSets keeps real members only, slugs the id', C.normalizeSets([{ name: 'Lakeside Arc', members: [3, 1, 99, 3] }], A21.balloons),
   [{ id: 'lakeside-arc', name: 'Lakeside Arc', members: [1, 3] }]);

/* ========================================================================= */
const BAL = A21.balloons;
const ALLN = BAL.map(b => b.n);
const byN = {}; BAL.forEach(b => { byN[b.n] = b; });
const bandOf = bands => { const m = {}; bands.forEach((b, k) => b.forEach(n => { m[n] = k; })); return m; };
const groups = [{ id: 'north', label: 'FRONT', color: '#00c8ff' }, { id: 'south', label: 'MIDDLE', color: '#ff3ea5' }, { id: 'shapes', label: 'BACK', color: '#ffd400' }];
function mkShow(cues, extra) {
  return Object.assign({ format: 'glow-show/1', title: 'Pattern test', audio: { title: 't', durationMs: 120000 },
    groups: groups, balloons: BAL, field: F, cues: cues }, extra || {});
}
function patCue(t, pattern, dir, target, members, extra) {
  const e = extra || {};
  const bands = C.patternBands({ pattern, dir, bandCount: e.bandCount || 4, members, center: e.center, seed: e.seed }, BAL);
  const c = { t, dur: 0, type: 'pattern', target, label: (e.label || pattern), pattern, bands, stepMs: e.stepMs || 1500, burnMs: e.burnMs || 2500 };
  if (dir) c.dir = dir;
  if (e.seed !== undefined) c.seed = e.seed;
  c.dur = pattern === 'alternate' ? (e.dur || 6000) : C.patternDur(c);
  return c;
}
/* monotone: whenever key(a) < key(b) - eps, band(a) <= band(b) */
function monotone(bands, key) {
  const bo = bandOf(bands), ns = Object.keys(bo).map(Number);
  for (const a of ns) for (const b of ns) if (key(a) < key(b) - 1e-9 && bo[a] > bo[b]) return [a, b];
  return null;
}

section('PATTERNS — the geometry of all eight');
const cx = BAL.reduce((s, b) => s + b.x, 0) / BAL.length, cy = BAL.reduce((s, b) => s + b.y, 0) / BAL.length;
const xs = BAL.map(b => b.x), midX = (Math.min(...xs) + Math.max(...xs)) / 2;
C.PATTERNS.forEach(p => {
  const bands = C.patternBands({ pattern: p, dir: C.PATTERN_DEFAULT_DIR[p], bandCount: 4, members: ALLN, seed: 7 }, BAL);
  const flat = [].concat(...bands).sort((a, b) => a - b);
  ok(p + ': every balloon in exactly one band, no empty band, ' + (p === 'alternate' ? '2' : '≤ 4') + ' bands  [' + bands.map(b => b.length).join('/') + ']',
     JSON.stringify(flat) === JSON.stringify(ALLN) && bands.every(b => b.length) && bands.length <= (p === 'alternate' ? 2 : 4) && bands.length >= 2, bands);
});
eq('sweep lr: bands rise with x (left first, as the crowd sees it)', monotone(C.patternBands({ pattern: 'sweep', dir: 'lr', bandCount: 4, members: ALLN }, BAL), n => byN[n].x), null);
eq('sweep rl: bands rise as x falls', monotone(C.patternBands({ pattern: 'sweep', dir: 'rl', bandCount: 4, members: ALLN }, BAL), n => -byN[n].x), null);
eq('sweep fb: front row first', monotone(C.patternBands({ pattern: 'sweep', dir: 'fb', bandCount: 4, members: ALLN }, BAL), n => byN[n].y), null);
eq('sweep bf: back row first', monotone(C.patternBands({ pattern: 'sweep', dir: 'bf', bandCount: 4, members: ALLN }, BAL), n => -byN[n].y), null);
eq('ripple out: bands rise with distance from the centre', monotone(C.patternBands({ pattern: 'ripple', dir: 'out', bandCount: 4, members: ALLN }, BAL), n => Math.hypot(byN[n].x - cx, byN[n].y - cy)), null);
eq('ripple in: the edges go first', monotone(C.patternBands({ pattern: 'ripple', dir: 'in', bandCount: 4, members: ALLN }, BAL), n => -Math.hypot(byN[n].x - cx, byN[n].y - cy)), null);
const rc = [0.2, 0.2];
eq('ripple from a moved centre (front-left) rises with distance from THAT point', monotone(C.patternBands({ pattern: 'ripple', dir: 'out', bandCount: 4, members: ALLN, center: rc }, BAL), n => Math.hypot(byN[n].x - rc[0], byN[n].y - rc[1])), null);
eq('mirror in: edges first, meeting in the middle', monotone(C.patternBands({ pattern: 'mirror', dir: 'in', bandCount: 3, members: ALLN }, BAL), n => -Math.abs(byN[n].x - midX)), null);
eq('mirror out: the middle first', monotone(C.patternBands({ pattern: 'mirror', dir: 'out', bandCount: 3, members: ALLN }, BAL), n => Math.abs(byN[n].x - midX)), null);
eq('chase up: number order is the path', monotone(C.patternBands({ pattern: 'chase', dir: 'up', bandCount: 7, members: ALLN }, BAL), n => n), null);
eq('chase down: reverse number order', monotone(C.patternBands({ pattern: 'chase', dir: 'down', bandCount: 7, members: ALLN }, BAL), n => -n), null);
const ang = (n, ccw) => { const th = Math.atan2(byN[n].y - cy, byN[n].x - cx); const a = ccw ? th - Math.PI : Math.PI - th; return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); };
eq('radial cw: bands follow the angle (left, back, right, front)', monotone(C.patternBands({ pattern: 'radial', dir: 'cw', bandCount: 4, members: ALLN }, BAL), n => ang(n, false)), null);
eq('radial ccw: the other way round', monotone(C.patternBands({ pattern: 'radial', dir: 'ccw', bandCount: 4, members: ALLN }, BAL), n => ang(n, true)), null);
const sp1 = C.patternBands({ pattern: 'sparkle', bandCount: 4, members: ALLN, seed: 1 }, BAL);
eq('sparkle is seeded: same seed, same bands', JSON.stringify(C.patternBands({ pattern: 'sparkle', bandCount: 4, members: ALLN, seed: 1 }, BAL)), JSON.stringify(sp1));
ok('  …a different seed, different bands', JSON.stringify(C.patternBands({ pattern: 'sparkle', bandCount: 4, members: ALLN, seed: 2 }, BAL)) !== JSON.stringify(sp1));
ok('  …bands as even as the count allows (sizes differ by at most 1)', Math.max(...sp1.map(b => b.length)) - Math.min(...sp1.map(b => b.length)) <= 1, sp1.map(b => b.length));
const alt = C.patternBands({ pattern: 'alternate', members: ALLN }, BAL);
const altBo = bandOf(alt);
const rowsY = [...new Set(BAL.map(b => b.y))].sort((a, b) => a - b);
ok('alternate: a checkerboard — neighbours along every row are in opposite bands', rowsY.every(y => {
  const row = BAL.filter(b => b.y === y).sort((a, b) => a.x - b.x);
  return row.every((b, i) => i === 0 || altBo[b.n] !== altBo[row[i - 1].n]);
}));
ok('  …and the first balloon of each row alternates too', rowsY.every((y, i) => i === 0 || altBo[BAL.filter(b => b.y === y).sort((a, b) => a.x - b.x)[0].n] !== altBo[BAL.filter(b => b.y === rowsY[i - 1]).sort((a, b) => a.x - b.x)[0].n]));
eq('a pattern over nobody has no bands', C.patternBands({ pattern: 'sweep', members: [] }, BAL), []);
eq('more bands than balloons -> one per balloon', C.patternBands({ pattern: 'sweep', dir: 'lr', bandCount: 12, members: [1, 2, 3] }, BAL).length, 3);

section('PATTERNS — compiled timing, per balloon');
const LEFT = ALLN.filter(n => byN[n].x < 0.5);
C.PATTERNS.forEach(p => {
  const c = patCue(20000, p, C.PATTERN_DEFAULT_DIR[p], { all: true }, ALLN, { seed: 3, label: p.toUpperCase() });
  const v = C.validateShow(mkShow([c]));
  if (!v.ok) { ok(p + ': validates', false, v.errors); return; }
  const tl = C.compileShow(v.show);
  const bo = bandOf(c.bands), B = c.bands.length;
  let bad = null;
  BAL.forEach(b => {
    const w = tl.perBalloon[b.n].windows;
    const k = bo[b.n];
    if (p === 'alternate') {
      const legs = Math.ceil(c.dur / c.stepMs);
      const mine = []; for (let j = 0; j < legs; j++) if (j % B === k) mine.push(20000 + j * c.stepMs);
      if (JSON.stringify(w.map(x => x.t)) !== JSON.stringify(mine) || !w.every(x => x.band === k && x.dur === c.stepMs)) bad = bad || [b.n, w.map(x => [x.t, x.end])];
    } else {
      const start = 20000 + k * c.stepMs, end = p === 'fill' ? 20000 + c.dur : start + c.burnMs;
      if (w.length !== 1 || w[0].t !== start || w[0].end !== end || w[0].band !== k || w[0].bands !== B || w[0].pattern !== p) bad = bad || [b.n, w.map(x => [x.t, x.end, x.band])];
    }
  });
  ok(p + ': every balloon burns exactly its own band' + (p === 'alternate' ? '’s legs' : '') + ' (band k at t + k·step' + (p === 'fill' ? ', all to the end' : '') + ')', bad === null, bad);
});
const setCue = patCue(20000, 'sweep', 'lr', { set: 'left' }, LEFT, { label: 'Left sweep' });
const vSet = C.validateShow(mkShow([setCue], { sets: [{ id: 'left', name: 'LEFT HALF', members: LEFT }] }));
ok('a sweep on a SET validates', vSet.ok, vSet.errors);
const tlSet = C.compileShow(vSet.show);
ok('  …balloons outside the set get nothing from it', ALLN.filter(n => LEFT.indexOf(n) < 0).every(n => tlSet.perBalloon[n].windows.length === 0));
ok('  …every set member gets exactly one band', LEFT.every(n => tlSet.perBalloon[n].windows.length === 1));
eq('patternDur = (bands − 1) · step + burn', C.patternDur({ pattern: 'sweep', bands: [[1], [2], [3], [4]], stepMs: 1500, burnMs: 2500 }), 7000);

section('PER-BALLOON STATE — what pilot #n sees');
const sweep = patCue(30000, 'sweep', 'lr', { all: true }, ALLN, { label: 'Verse sweep' });
const fill = patCue(60000, 'fill', 'fb', { all: true }, ALLN, { label: 'Build fill' });
const showP = mkShow([{ t: 15000, dur: 3000, type: 'burn', groups: ['all'], label: 'Opening ALL burn' }, sweep, fill]);
const vP = C.validateShow(showP);
ok('a show mixing group cues and pattern cues validates', vP.ok, vP.errors);
const tlP = C.compileShow(vP.show);
eq('compiled: hasBalloonCues, 21 balloon lanes', [tlP.hasBalloonCues, Object.keys(tlP.perBalloon).length], [true, 21]);
const sBo = bandOf(sweep.bands);
const nB2 = ALLN.filter(n => sBo[n] === 2)[0];
const st0 = 30000 + 2 * 1500;
const sR = C.stateAtBalloon(tlP, nB2, st0 - 100);
eq('#' + nB2 + ' (sweep band 3 of 4) is in GET READY 0.1 s before its band', [sR.phase, sR.readySeg.fromPattern, sR.readySeg.band, sR.readySeg.bands, sR.readySeg.pattern], ['GETREADY', true, 2, 4, 'sweep']);
eq('  …its countdown is to ITS band, not the cue start', sR.countdownMs, 100);
const sB = C.stateAtBalloon(tlP, nB2, st0 + 10);
eq('  …BURN exactly from its band start, labelled with the cue', [sB.phase, sB.seg.baseLabel, sB.seg.band], ['BURN', 'Verse sweep', 2]);
eq('  …STOP when its band ends', C.stateAtBalloon(tlP, nB2, st0 + 2500 + 10).phase, 'STOP');
const nB0 = ALLN.filter(n => sBo[n] === 0)[0], nB1 = ALLN.filter(n => sBo[n] === 1)[0];
eq('a band-2 balloon is already burning while #' + nB2 + ' is still getting ready', C.stateAtBalloon(tlP, nB1, st0 - 100).phase, 'BURN');
eq('  …and band 1 has finished and is on STOP', C.stateAtBalloon(tlP, nB0, st0 - 100).phase, 'STOP');
const fBo = bandOf(fill.bands);
const f0 = ALLN.filter(n => fBo[n] === 0)[0], fLast = ALLN.filter(n => fBo[n] === fill.bands.length - 1)[0];
eq('the fill\'s band 1 holds a long burn (7 s) -> its VENT warning shows 20 s before ITS start', C.stateAtBalloon(tlP, f0, 60000 - 15000).phase, 'VENT');
eq('  …while the last band (2.5 s, not long) gets no vent warning', C.stateAtBalloon(tlP, fLast, 60000 - 15000).phase, 'IDLE');
eq('the fill: every band ends together at the cue end', C.stateAtBalloon(tlP, fLast, 60000 + fill.dur - 10).phase + '/' + C.stateAtBalloon(tlP, f0, 60000 + fill.dur - 10).phase, 'BURN/BURN');
eq('stateForPilot takes the balloon path once a show has balloon cues', JSON.stringify(C.stateForPilot(tlP, nB2, byN[nB2].group, st0 + 10)), JSON.stringify(sB));
const pv = C.stateAtBalloon(tlP, nB2, 20000).next;
ok('the preview strip marks a pattern cue that includes me as mine', pv[0].mine && pv[0].cue.label === 'Verse sweep' && pv[0].cue.balloons.length === 21, pv[0]);
const tlSetP = C.compileShow(C.validateShow(mkShow([setCue], { sets: [{ id: 'left', name: 'LEFT HALF', members: LEFT }] })).show);
const outsider = ALLN.filter(n => LEFT.indexOf(n) < 0)[0];
ok('…and one that does not include me as not mine', C.stateAtBalloon(tlSetP, outsider, 10000).next[0].mine === false);
eq('the outsider stays IDLE through the whole set sweep', [19000, 21000, 23000, 26000].map(t => C.stateAtBalloon(tlSetP, outsider, t).phase), ['IDLE', 'IDLE', 'IDLE', 'IDLE']);
const tgt = mkShow([{ t: 20000, dur: 3000, type: 'burn', target: { n: [3, 5] }, label: 'Duo' }]);
const tlT = C.compileShow(C.validateShow(tgt).show);
eq('a plain burn addressed to numbers burns exactly those balloons', ALLN.filter(n => C.stateAtBalloon(tlT, n, 21000).phase === 'BURN'), [3, 5]);

section('VALIDATOR — balloon cues, sets, field');
const vbad = (show, needle, label) => { const r = C.validateShow(show); ok(label, !r.ok && r.errors.some(e => e.indexOf(needle) !== -1), r.errors); };
const noBal = mkShow([sweep]); delete noBal.balloons; delete noBal.field;
vbad(noBal, 'no balloons', 'a pattern cue in a show with no balloons is rejected');
vbad(mkShow([Object.assign({}, sweep, { target: { set: 'nope' } })]), 'unknown set', 'an unknown set is rejected');
vbad(mkShow([Object.assign({}, sweep, { target: { group: 'ghost' } })]), 'unknown group', 'an unknown group target is rejected');
vbad(mkShow([Object.assign({}, sweep, { target: { all: true, n: [1] } })]), 'exactly one of', 'a target with two kinds is rejected');
vbad(mkShow([Object.assign({}, sweep, { target: { n: [] } })]), 'is empty', 'an empty number target is rejected');
vbad(mkShow([Object.assign({}, sweep, { target: { n: [1, 99] } })]), '99', 'a number target naming a missing balloon is rejected');
const dupBand = JSON.parse(JSON.stringify(sweep)); dupBand.bands[1].push(dupBand.bands[0][0]);
vbad(mkShow([dupBand]), 'exactly one band', 'a balloon in two bands of one cue is rejected');
const ghostBand = JSON.parse(JSON.stringify(sweep)); ghostBand.bands[0].push(77);
vbad(mkShow([ghostBand]), '77', 'a band naming a missing balloon is rejected');
vbad(mkShow([Object.assign({}, setCue, { bands: [ALLN] })], { sets: [{ id: 'left', name: 'L', members: LEFT }] }), 'not in the cue', 'a band member outside the target is rejected');
vbad(mkShow([Object.assign({}, sweep, { pattern: 'zigzag' })]), 'pattern must be', 'an unknown pattern is rejected');
vbad(mkShow([Object.assign({}, sweep, { dir: 'out' })]), 'does not apply', 'a direction that does not fit the pattern is rejected');
vbad(mkShow([Object.assign({}, sweep, { stepMs: 5000 })]), 'after the cue ends', 'a band that would start after the cue ends is rejected');
vbad(mkShow([Object.assign({}, sweep, { burnMs: 0 })]), 'burnMs', 'a sweep with no burn length is rejected');
vbad(mkShow([Object.assign({}, sweep, { groups: ['all'] })]), 'both groups', 'a cue with both groups and a target is rejected');
vbad(mkShow([{ t: 30000, dur: 4000, type: 'alternate', target: { all: true }, periodMs: 1000, label: 'x' }]), 'alternate trades between groups', 'an alternate addressed to balloons is pointed at the pattern instead');
vbad(mkShow([{ t: 31000, dur: 3000, type: 'burn', groups: [byN[nB0].group], label: 'Group clash' }, sweep].sort((a, b) => a.t - b.t)), 'Balloon #', 'a group cue colliding with a balloon\'s band is caught PER BALLOON');
vbad(mkShow([sweep], { sets: [{ id: 'x', name: 'X', members: [1, 404] }] }), '#404', 'a set naming a missing balloon is rejected');
vbad(mkShow([sweep], { sets: [{ id: 'all', name: 'X', members: [1] }] }), 'built-in', 'a set called "all" is rejected');
vbad(mkShow([sweep], { sets: [{ id: 'x', name: 'X', members: [1] }, { id: 'x', name: 'Y', members: [2] }] }), 'duplicated', 'duplicate set ids are rejected');
const sNoB = mkShow([{ t: 1000, dur: 1000, type: 'burn', groups: ['all'], label: 'x' }], { sets: [{ id: 'x', name: 'X', members: [1] }] }); delete sNoB.balloons;
vbad(sNoB, 'no balloons', 'sets without balloons are rejected');
const missingW = C.validateShow(mkShow([Object.assign({}, sweep, { bands: sweep.bands.slice(1) })]));
ok('a band list that leaves targeted balloons out validates but warns, naming them', missingW.ok && missingW.warnings.some(w => /out of every band/.test(w)), missingW.warnings);
const badField = C.validateShow(mkShow([sweep], { field: { outline: [[0, 0]], mPerUnit: 1 } }));
ok('a malformed field never blocks a show — it is dropped with a warning', badField.ok && !('field' in badField.show) && badField.warnings.some(w => /field ignored/.test(w)), badField.warnings);
const goodField = C.validateShow(mkShow([sweep]));
eq('a good field rides through validation unchanged', JSON.stringify(goodField.show.field), JSON.stringify(C.normalizeField(F).field));
ok('the exported pattern show re-parses identically', JSON.stringify(C.validateShow(JSON.parse(JSON.stringify(vP.show))).show) === JSON.stringify(vP.show));

section('BACKWARD COMPATIBILITY — groups-only shows, with and without the new fields');
const demoRaw = JSON.parse(fs.readFileSync(DEMO_PATH, 'utf8'));
const dV = C.validateShow(demoRaw);
ok('the demo show validates', dV.ok, dV.errors);
eq('…and gains no field / sets keys', ['field' in dV.show, 'sets' in dV.show], [false, false]);
const dTl = C.compileShow(dV.show);
eq('…and has no balloon-addressed cues', [dTl.hasBalloonCues, dTl.bSegments.length], [false, 0]);
const withExtra = JSON.parse(JSON.stringify(demoRaw));
withExtra.field = { w: 1, h: 0.6, mPerUnit: 150, outline: [[0, 0], [1, 0], [1, 0.6], [0, 0.6]] };
withExtra.sets = [{ id: 'stars', name: 'STARS', members: [2, 7] }];
const xV = C.validateShow(withExtra);
ok('the demo with a field and a set added validates', xV.ok, xV.errors);
const xTl = C.compileShow(xV.show);
const dig = t => JSON.stringify({ segments: t.segments, vents: t.vents, perGroup: t.perGroup, previewCues: t.previewCues, endMs: t.endMs, audioMs: t.audioMs });
ok('adding a field + sets changes NOTHING about the compiled cue timeline', dig(xTl) === dig(dTl));
let diff1 = null, diff2 = null, nStates = 0;
for (const b of dTl.balloons) {
  for (let t = -10000; t <= 92000; t += 25) {
    const g = C.stateAt(dTl, [b.group], t);
    const sb = JSON.stringify(C.stateAtBalloon(dTl, b.n, t));
    nStates++;
    if (!diff1 && sb !== JSON.stringify(g)) diff1 = [b.n, t];
    if (!diff2 && JSON.stringify(C.stateAt(xTl, [b.group], t)) !== JSON.stringify(g)) diff2 = [b.n, t];
  }
}
ok('stateAtBalloon(#n) === stateAt(its group) for every balloon of the demo, 25 ms steps, −10 s..92 s (' + nStates + ' states)', diff1 === null, diff1);
ok('every stateAt() is identical with and without the field + sets', diff2 === null, diff2);
ok('stateForPilot keeps the original group path for a groups-only show',
   [0, 15500, 26000, 41000, 53500].every(t => JSON.stringify(C.stateForPilot(dTl, 7, 'south', t)) === JSON.stringify(C.stateAt(dTl, ['south'], t))));
const oldShape = JSON.parse(JSON.stringify(demoRaw)); delete oldShape.balloons; delete oldShape.audio.bpm; delete oldShape.audio.beatOffsetMs;
const oV = C.validateShow(oldShape);
eq('a pre-balloon show still compiles with empty per-balloon lanes', [oV.ok, Object.keys(C.compileShow(oV.show).perBalloon).length], [true, 0]);

console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail ? 1 : 0);
