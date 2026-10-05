// Documento PDF padronizado dos relatórios: cabeçalho com a logo da VLI e o nome do sistema
// em todas as páginas, bloco de título com filtros e data de geração, tabelas com quebra de
// página (cabeçalho repetido) e rodapé "Página x de y". A4 deitado.
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const LOGO = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "vli-logo.png");
const BLUE = "#0075C4";
const ORANGE = "#FF7B00";
const INK = "#0F172A";
const MUTED = "#64748B";
const LINE = "#E2E8F0";
const ZEBRA = "#F8FAFC";
const MARGIN = { top: 78, bottom: 48, left: 36, right: 36 };

// As fontes padrão do PDF usam a codificação WinAnsi: troca símbolos fora dela.
const SYMBOLS = { "≥": ">=", "≤": "<=", "→": "->", "−": "-", "÷": "÷", "×": "×", "₂": "2", "✓": "OK" };
export const safe = (value) => String(value ?? "—")
  .replace(/[≥≤→−₂✓]/g, (char) => SYMBOLS[char])
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, "?");

export function createReport({ titulo, subtitulo, linhas = [] }) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margins: MARGIN, bufferPages: true, info: { Title: safe(titulo), Author: "SIGMA·CCM", Creator: "SIGMA·CCM" } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const left = MARGIN.left;
  const width = () => doc.page.width - MARGIN.left - MARGIN.right;
  const bottom = () => doc.page.height - MARGIN.bottom;

  const header = () => {
    const top = 22;
    const right = doc.page.width - MARGIN.right;
    doc.image(LOGO, left, top, { height: 30 });
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("SIGMA·CCM", left, top + 2, { width: width(), align: "right", lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Centro de Controle da Manutenção", left, top + 18, { width: width(), align: "right", lineBreak: false });
    doc.moveTo(left, top + 40).lineTo(right - 8, top + 40).lineWidth(1.5).strokeColor(BLUE).stroke();
    doc.circle(right - 3, top + 40, 3).fill(ORANGE);
    doc.x = left;
    doc.y = MARGIN.top;
  };
  doc.on("pageAdded", header);
  header();

  // Bloco de título da primeira página.
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(safe(titulo), left, doc.y, { width: width() });
  if (subtitulo) doc.moveDown(0.2).font("Helvetica").fontSize(10).fillColor(MUTED).text(safe(subtitulo), { width: width() });
  doc.moveDown(0.4);
  for (const linha of linhas) doc.font("Helvetica").fontSize(9).fillColor(INK).text(safe(linha), { width: width() });
  doc.moveDown(0.8);

  const ensure = (space) => { if (doc.y + space > bottom()) doc.addPage(); };

  const api = {
    doc,
    section(title, description) {
      ensure(70);
      doc.moveDown(0.4);
      const y = doc.y;
      doc.rect(left, y + 2, 4, 14).fill(ORANGE);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(BLUE).text(safe(title), left + 10, y, { width: width() - 10 });
      if (description) doc.moveDown(0.15).font("Helvetica").fontSize(8.5).fillColor(MUTED).text(safe(description), left, doc.y, { width: width() });
      doc.x = left;
      doc.moveDown(0.5);
    },
    subtitle(text) {
      // Mantém o subtítulo junto do início da tabela (evita título sozinho no pé da página).
      ensure(110);
      doc.moveDown(0.3).font("Helvetica-Bold").fontSize(10).fillColor(INK).text(safe(text), left, doc.y, { width: width() });
      doc.moveDown(0.3);
    },
    paragraph(text, { color = MUTED, size = 8.5 } = {}) {
      ensure(20);
      doc.font("Helvetica").fontSize(size).fillColor(color).text(safe(text), left, doc.y, { width: width() });
      doc.moveDown(0.4);
    },
    // Cartões de indicador: rótulo, valor, meta e situação.
    cards(items, perRow = 4) {
      const gap = 10;
      const cardWidth = (width() - gap * (perRow - 1)) / perRow;
      const cardHeight = 62;
      for (let index = 0; index < items.length; index += perRow) {
        ensure(cardHeight + 8);
        const y = doc.y;
        items.slice(index, index + perRow).forEach((item, position) => {
          const x = left + position * (cardWidth + gap);
          doc.roundedRect(x, y, cardWidth, cardHeight, 6).lineWidth(0.8).strokeColor(LINE).stroke();
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(safe(item.label).toUpperCase(), x + 10, y + 8, { width: cardWidth - 20, lineBreak: false });
          doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(safe(item.value), x + 10, y + 20, { width: cardWidth - 20, lineBreak: false });
          doc.font("Helvetica").fontSize(7.5).fillColor(item.ok === false ? "#B91C1C" : item.ok ? "#047857" : MUTED)
            .text(safe(item.detail || ""), x + 10, y + 44, { width: cardWidth - 20, lineBreak: false });
        });
        doc.x = left;
        doc.y = y + cardHeight + 8;
      }
      doc.moveDown(0.3);
    },
    // Tabela com quebra automática de página e cabeçalho repetido.
    table(columns, rows, { empty = "Sem registros para os filtros escolhidos." } = {}) {
      const total = columns.reduce((sum, column) => sum + (column.width || 1), 0);
      const widths = columns.map((column) => (width() * (column.width || 1)) / total);
      const pad = 4;
      const drawHead = () => {
        doc.font("Helvetica-Bold").fontSize(7.5);
        const height = Math.max(...columns.map((column, index) => doc.heightOfString(safe(column.label), { width: widths[index] - pad * 2 }))) + pad * 2;
        const y = doc.y;
        doc.rect(left, y, width(), height).fill(BLUE);
        let x = left;
        columns.forEach((column, index) => {
          doc.fillColor("#FFFFFF").text(safe(column.label), x + pad, y + pad, { width: widths[index] - pad * 2, align: column.align || "left" });
          x += widths[index];
        });
        doc.x = left;
        doc.y = y + height;
      };
      ensure(40);
      drawHead();
      if (!rows.length) {
        doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED).text(safe(empty), left + pad, doc.y + pad, { width: width() - pad * 2 });
        doc.moveDown(0.8);
        return;
      }
      rows.forEach((row, rowIndex) => {
        doc.font("Helvetica").fontSize(7.5);
        const cells = row.map((cell) => safe(cell));
        const height = Math.max(...cells.map((cell, index) => doc.heightOfString(cell, { width: widths[index] - pad * 2 }))) + pad * 2;
        if (doc.y + height > bottom()) { doc.addPage(); drawHead(); doc.font("Helvetica").fontSize(7.5); }
        const y = doc.y;
        if (rowIndex % 2 === 1) doc.rect(left, y, width(), height).fill(ZEBRA);
        let x = left;
        cells.forEach((cell, index) => {
          doc.fillColor(INK).text(cell, x + pad, y + pad, { width: widths[index] - pad * 2, align: columns[index].align || "left" });
          x += widths[index];
        });
        doc.moveTo(left, y + height).lineTo(left + width(), y + height).lineWidth(0.4).strokeColor(LINE).stroke();
        doc.x = left;
        doc.y = y + height;
      });
      doc.moveDown(0.8);
    },
    // Rodapé em todas as páginas e geração do arquivo.
    finish(footerText) {
      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        doc.switchToPage(range.start + index);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const y = doc.page.height - 30;
        doc.moveTo(left, y - 6).lineTo(doc.page.width - MARGIN.right, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
          .text(safe(footerText), left, y, { width: width() * 0.75, lineBreak: false })
          .text(`Página ${index + 1} de ${range.count}`, left, y, { width: width(), align: "right", lineBreak: false });
        doc.page.margins.bottom = savedBottom;
      }
      const pages = range.count;
      return new Promise((resolve, reject) => {
        doc.on("end", () => resolve({ buffer: Buffer.concat(chunks), pages }));
        doc.on("error", reject);
        doc.end();
      });
    },
  };
  return api;
}
