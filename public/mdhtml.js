// 보고서 Markdown → HTML 변환기 (보고서가 사용하는 문법만 지원, 모든 텍스트는 이스케이프)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());

export function mdToHtml(md, { figure = () => '' } = {}) {
  const lines = String(md).replace(/\r/g, '').split('\n'), out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if ((m = /^!\[(.*?)\]\((.*?)\)\s*$/.exec(l))) { out.push(figure(m[1], m[2])); i++; continue; }
    if (l.startsWith('>')) { const b = []; while (i < lines.length && lines[i].startsWith('>')) b.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${inline(b.join(' '))}</blockquote>`); continue; }
    if (l.startsWith('|') && /^\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    if (/^- /.test(l)) { const it = []; while (i < lines.length && /^- /.test(lines[i])) it.push(lines[i++].slice(2)); out.push(`<ul>${it.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`); continue; }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\||- |---|!\[)/.test(lines[i])) p.push(lines[i++]);
    const text = p.join(' '), cls = /^\*\*(표|부록 표)\s/.test(text) ? ' class="tcap"' : /^\*그림\s/.test(text) ? ' class="fcap"' : '';
    out.push(`<p${cls}>${inline(text)}</p>`);
  }
  return out.join('\n');
}

export const PRINT_CSS = `@page{size:A4;margin:22mm 20mm}body{font-family:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:11pt;line-height:1.7;color:#111;max-width:820px;margin:24px auto;padding:0 18px}h1{font-size:20pt;line-height:1.3}h2{font-size:15pt;margin-top:1.8em;border-bottom:1px solid #999;padding-bottom:.2em}h3{font-size:12.5pt;margin-top:1.4em}blockquote{margin:1em 0;padding:.4em 1em;border-left:3px solid #999;color:#444;background:#f6f6f6}table{border-collapse:collapse;width:100%;margin:.4em 0 1.2em;font-size:9.5pt;break-inside:avoid}th,td{padding:4px 8px;text-align:left;vertical-align:top}thead th{border-top:1.5px solid #111;border-bottom:1px solid #111}tbody tr:last-child td{border-bottom:1.5px solid #111}p.tcap{font-weight:700;margin-bottom:.2em;break-after:avoid}p.fcap{text-align:center;color:#333;font-size:10pt;margin-top:.2em}figure{margin:1em 0 .2em;text-align:center;break-inside:avoid}figure svg,figure img{max-width:100%;height:auto}code{background:#f0f0f0;padding:0 4px}hr{border:0;border-top:1px solid #bbb}.noprint{background:#fff8e1;border:1px solid #e6c200;padding:8px 12px;margin-bottom:16px;font-size:10pt}@media print{.noprint{display:none}body{margin:0;padding:0}}`;

export function buildHtmlDocument(title, bodyHtml, { note = true } = {}) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${note ? '<div class="noprint">PDF로 저장: 브라우저 인쇄(Ctrl+P) → 대상 “PDF로 저장”. 그림은 벡터(SVG)로 삽입되어 있습니다.</div>' : ''}${bodyHtml}</body></html>`;
}
export function buildWordDocument(title, bodyHtml) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`;
}
