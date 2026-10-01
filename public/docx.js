// 보고서 Markdown → 진짜 Word(.docx) 변환기 (의존성 없음, 브라우저·Node 공용)
// - 표는 Word 네이티브 표(삼선표, 머리행 반복), 그림은 본문에 삽입된 PNG(대체 텍스트 포함)
// - 제목 스타일(탐색 창·목차 사용 가능), 글머리 목록, 인용문, 표/그림 캡션, 쪽번호
// - 보고서가 사용하는 Markdown 문법만 지원한다 (mdhtml.js와 동일한 범위)
import { zipStore } from './zip.js';
import { parseMath } from './mathtext.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const PAGE = { w: 11906, h: 16838, mx: 1134, top: 1247, bottom: 1247 };          // A4, 좌우 2cm
const CONTENT_W = PAGE.w - PAGE.mx * 2;                                            // 9638 dxa ≈ 17cm
const xesc = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- 인라인: **굵게**, *기울임*, `코드` ---------- */
function runs(text, base = {}) {
  const out = [], re = /(\$[^$\n]+\$|`[^`]+`|\*\*.+?\*\*|\*[^*\n]+\*)/g; let last = 0, m;
  const push = (t, o) => { if (t) out.push(run(t, o)); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index), base); const tok = m[0];
    if (tok.startsWith('$') && tok.length > 2) out.push(...mathRuns(tok.slice(1, -1), base));
    else if (tok.startsWith('`')) push(tok.slice(1, -1), { ...base, code: true });
    else if (tok.startsWith('**')) out.push(...runs(tok.slice(2, -2), { ...base, b: true }));
    else push(tok.slice(1, -1), { ...base, i: true });
    last = m.index + tok.length;
  }
  push(text.slice(last), base); return out.join('');
}
function run(t, o = {}) {
  const rpr = (o.math ? '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:eastAsia="Malgun Gothic" w:cs="Cambria Math"/>' : '') + (o.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Malgun Gothic"/><w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>' : '') + (o.b ? '<w:b/><w:bCs/>' : '') + (o.i ? '<w:i/><w:iCs/>' : '') + (o.color ? `<w:color w:val="${o.color}"/>` : '') + (o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : '') + (o.sub ? '<w:vertAlign w:val="subscript"/>' : o.sup ? '<w:vertAlign w:val="superscript"/>' : '');
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xesc(t)}</w:t></w:r>`;
}
// 수식 세그먼트 → Word 런 (아래/위첨자 · 영문 이탤릭 · Cambria Math)
function mathRuns(src, base = {}) {
  return parseMath(src).map(x => run(x.t, { ...base, math: true, i: (!x.up && !x.cal && /[A-Za-z]/.test(x.t)) || base.i, b: x.b || base.b, sub: x.sub, sup: x.sup })).join('');
}
const EQ_RE = /^\$\$\s*(.+?)\s*\$\$\s*(?:\(([^)]+)\))?\s*$/;
const eqPara = (src, tag) => `<w:p><w:pPr><w:pStyle w:val="Equation"/></w:pPr><w:r><w:tab/></w:r>${mathRuns(src, { sz: 22 })}<w:r><w:tab/></w:r>${tag ? run(`(${tag})`, { sz: 20 }) : ''}</w:p>`;
const para = (inner, { style, jc, keepNext, spacing } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}${spacing || ''}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${inner}</w:p>`;

/* ---------- 표 ---------- */
const cellsOf = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
function colWidths(head, rows) {
  const n = head.length, len = i => Math.max(4, ...[head[i], ...rows.map(r => r[i] ?? '')].map(s => [...String(s).replace(/\*\*|`/g, '')].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2E80 ? 2 : 1), 0)));
  const w = Array.from({ length: n }, (_, i) => Math.min(48, len(i))), sum = w.reduce((a, b) => a + b, 0);
  const min = Math.min(700, Math.floor(CONTENT_W / n)), rest = CONTENT_W - min * n, dx = w.map(v => min + Math.floor(rest * v / sum));
  dx[dx.indexOf(Math.max(...dx))] += CONTENT_W - dx.reduce((a, b) => a + b, 0); return dx;   // 모든 열 ≥ min, 합계 = CONTENT_W                                                       // 합계 = CONTENT_W
}
function table(head, rows) {
  const n = head.length, dx = colWidths(head, rows), line = (sz) => `w:val="single" w:sz="${sz}" w:space="0" w:color="111111"`;
  const cell = (txt, i, { th, first, last }) => {
    const bd = (th && first ? `<w:top ${line(12)}/>` : '') + (th ? `<w:bottom ${line(6)}/>` : '') + (last ? `<w:bottom ${line(12)}/>` : '');
    return `<w:tc><w:tcPr><w:tcW w:w="${dx[i]}" w:type="dxa"/>${bd ? `<w:tcBorders>${bd}</w:tcBorders>` : ''}${th ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}<w:vAlign w:val="center"/></w:tcPr>${para(runs(txt, { b: th, sz: 18 }), { spacing: '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>' })}</w:tc>`;
  };
  const pad = r => Array.from({ length: n }, (_, i) => r[i] ?? '');
  const tr = (r, o) => `<w:tr><w:trPr><w:cantSplit/>${o.th ? '<w:tblHeader/>' : ''}</w:trPr>${pad(r).map((c, i) => cell(c, i, o)).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_W}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0420" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${dx.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${tr(head, { th: true, first: true })}${rows.map((r, i) => tr(r, { last: i === rows.length - 1 })).join('')}</w:tbl>` + para('', { spacing: '<w:spacing w:before="0" w:after="120"/>' });
}

/* ---------- 그림 ---------- */
function drawing(rid, id, name, alt, cx, cy) {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${xesc(name)}" descr="${xesc(alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${xesc(name)}" descr="${xesc(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/**
 * @param {string} md 보고서 Markdown
 * @param {{images?:Record<string,{data:Uint8Array,w:number,h:number}>, title?:string, author?:string, created?:Date, maxWidthCm?:number}} opt
 *   images 키 = 그림 파일명(확장자 제외, 예: fig1_feasible_region_heatmap). w/h = 원본 SVG 픽셀 크기(비율 계산용).
 * @returns {Uint8Array} .docx 바이트
 */
export function buildDocx(md, { images = {}, title, author = 'DCV Research Platform', created = new Date(), maxWidthCm = 15.5, maxHeightCm = 22.5 } = {}) {
  const lines = String(md).replace(/\r/g, '').split('\n'), body = [], media = []; let i = 0, firstH1 = true, imgId = 0; const hasTitle = /^#\s/m.test(md);
  const docTitle = title || (/^#\s+(.+)$/m.exec(md) || [, 'DCV 연구 보고서'])[1];
  while (i < lines.length) {
    const l = lines[i]; if (!l.trim()) { i++; continue; } let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { const lv = m[1].length, isTitle = lv === 1 && firstH1; if (lv === 1) firstH1 = false; const hl = isTitle ? 0 : Math.max(1, hasTitle ? lv - 1 : lv); body.push(para(runs(m[2]), { style: isTitle ? 'Title' : `Heading${hl}` })); i++; continue; }  // 문서 제목(H1)=Title, ##→제목 1, ###→제목 2
    if ((m = EQ_RE.exec(l))) { body.push(eqPara(m[1], m[2])); i++; continue; }
    if (/^---+\s*$/.test(l)) { body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="BBBBBB"/></w:pBdr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>'); i++; continue; }
    if ((m = /^!\[(.*?)\]\((.*?)\)\s*$/.exec(l))) {
      const key = (m[2].split('/').pop() || '').replace(/\.\w+$/, ''), im = images[key]; i++;
      if (im && im.data && im.w > 0 && im.h > 0) {
        const cxMax = Math.round(maxWidthCm * 360000), cx0 = Math.min(cxMax, Math.round(im.w * 9525)), cx = Math.min(cx0, Math.round(maxHeightCm * 360000 * im.w / im.h)), cy = Math.round(cx * im.h / im.w), rid   /* 세로로 긴 그림(M0)이 페이지 본문 높이를 넘지 않도록 높이 상한 적용 */ = `rIdImg${++imgId}`;
        media.push({ rid, name: `image${imgId}.png`, data: im.data }); body.push(para(drawing(rid, imgId, key, m[1], cx, cy), { jc: 'center', keepNext: true, spacing: '<w:spacing w:before="160" w:after="40"/>' }));
      } else body.push(para(run(`[그림 누락: ${m[1]}]`, { i: true, color: '888888' }), { jc: 'center' }));
      continue;
    }
    if (l.startsWith('>')) { const b = []; while (i < lines.length && lines[i].startsWith('>')) b.push(lines[i++].replace(/^>\s?/, '')); body.push(para(runs(b.join(' ')), { style: 'Quote' })); continue; }
    if (l.startsWith('|') && /^\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const head = cellsOf(l); i += 2; const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(cellsOf(lines[i++])); body.push(table(head, rows)); continue;
    }
    if (/^- /.test(l)) { while (i < lines.length && /^- /.test(lines[i])) body.push(para(runs(lines[i++].slice(2)), { style: 'ListBullet' })); continue; }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\||- |---|!\[|\$\$)/.test(lines[i])) p.push(lines[i++]);
    const text = p.join(' '), style = /^\*\*(표|부록 표)\s/.test(text) ? 'TableCaption' : /^\*그림\s/.test(text) ? 'FigureCaption' : undefined;
    body.push(para(runs(text), { style }));
  }

  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${PAGE.w}" w:h="${PAGE.h}"/><w:pgMar w:top="${PAGE.top}" w:right="${PAGE.mx}" w:bottom="${PAGE.bottom}" w:left="${PAGE.mx}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const font = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Malgun Gothic" w:cs="Calibri" w:hint="eastAsia"/>';
  const hs = (id, name, sz, before, after, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>${extra}<w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="ko-KR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="336" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
    + `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>`
    + `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="200" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>`
    + hs('Heading1', 'heading 1', 32, 360, 120, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="999999"/></w:pBdr>') + hs('Heading2', 'heading 2', 27, 280, 100) + hs('Heading3', 'heading 3', 24, 200, 80)
    + `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="999999"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F6F6F6"/><w:spacing w:before="120" w:after="200"/><w:ind w:left="200"/></w:pPr><w:rPr><w:color w:val="444444"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Equation"><w:name w:val="Equation"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepLines/><w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="0072B2"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/><w:tabs><w:tab w:val="center" w:pos="${Math.round(CONTENT_W / 2)}"/><w:tab w:val="right" w:pos="${CONTENT_W - 120}"/></w:tabs><w:spacing w:before="100" w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="TableCaption"><w:name w:val="Table Caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="FigureCaption"><w:name w:val="Figure Caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="40" w:after="200"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="333333"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="480" w:hanging="280"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:hint="default"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const iso = created.toISOString().replace(/\.\d+Z$/, 'Z');
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xesc(docTitle)}</dc:title><dc:creator>${xesc(author)}</dc:creator><cp:lastModifiedBy>${xesc(author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>DCV Research Platform</Application></Properties>`;
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="${R}/numbering" Target="numbering.xml"/><Relationship Id="rIdSettings" Type="${R}/settings" Target="settings.xml"/><Relationship Id="rIdFooter" Type="${R}/footer" Target="footer1.xml"/>${media.map(x => `<Relationship Id="${x.rid}" Type="${R}/image" Target="media/${x.name}"/>`).join('')}</Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const W = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="${W}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${W}.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="${W}.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="${W}.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="${W}.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  return zipStore([
    { name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: documentXml }, { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/styles.xml', data: stylesXml }, { name: 'word/numbering.xml', data: numberingXml }, { name: 'word/settings.xml', data: settingsXml }, { name: 'word/footer1.xml', data: footerXml },
    ...media.map(x => ({ name: `word/media/${x.name}`, data: x.data })),
    { name: 'docProps/core.xml', data: coreXml }, { name: 'docProps/app.xml', data: appXml }
  ], created);
}
