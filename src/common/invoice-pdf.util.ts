// ============================================================
// INVOICE PDF GENERATION (pdfkit)
// ============================================================
import * as PDFDocument from 'pdfkit';

export interface InvoiceLine {
  referenceCode: string;
  vehicleName: string;
  createdAt: Date;
  totalAmount: number;
  commissionRate: number;
  commissionAmount: number;
  netAmount: number;
  isWelcome: boolean;
}

export interface InvoiceData {
  reference: string;
  periodLabel: string;
  lessor: {
    businessName: string;
    legalIdentifier?: string;
    taxIdentifier?: string;
    address?: string;
    wilaya?: string;
    city?: string;
    rib?: string;
    email?: string;
  };
  lines: InvoiceLine[];
  totals: {
    grossTotal: number;
    commission: number;
    netTotal: number;
  };
}

// Amounts in table cells: no unit (fits in narrow columns)
const fmtN = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// Amounts in totals section: with unit
const fmt  = (n: number) => fmtN(n) + ' DZD';

export async function buildInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new (PDFDocument as any)({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 50;   // left margin
    const R = 545;  // right edge

    // ── Header ──────────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').text('Kerya DZ', { align: 'left' });
    doc.fontSize(9).font('Helvetica').fillColor('#666')
      .text('Facture de commission — Plateforme de location de véhicules');
    doc.moveDown(0.8);

    doc.fillColor('#000').fontSize(13).font('Helvetica-Bold').text(`Facture ${data.reference}`);
    doc.fontSize(9).font('Helvetica').text(`Période : ${data.periodLabel}`);
    doc.moveDown(0.8);

    // ── Lessor info ─────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).text('Loueur');
    doc.font('Helvetica').fontSize(9);
    doc.text(data.lessor.businessName);
    if (data.lessor.address) doc.text(data.lessor.address);
    if (data.lessor.city || data.lessor.wilaya)
      doc.text([data.lessor.city, data.lessor.wilaya].filter(Boolean).join(', '));
    if (data.lessor.legalIdentifier) doc.text(`RC : ${data.lessor.legalIdentifier}`);
    if (data.lessor.taxIdentifier)   doc.text(`NIF : ${data.lessor.taxIdentifier}`);
    if (data.lessor.rib)             doc.text(`RIB : ${data.lessor.rib}`);
    doc.moveDown(0.8);

    // ── Table ───────────────────────────────────────────────────
    // A4 usable width 50→545 = 495pt. Amounts without "DZD" fit easily.
    // col:       ref   vehicle  date   gross  rate  commission  net
    const C = {  ref:  L,       veh: 132, date: 258, grs: 313, rate: 381, com: 415, net: 480 };
    const W = {  ref:  78,      veh: 122, date:  51, grs:  64, rate:  30, com:  61, net:  65 };

    const drawTableHeader = (y: number) => {
      doc.rect(L, y - 3, R - L, 16).fillColor('#f0f0f0').fill();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#333');
      doc.text('Référence',       C.ref,  y, { width: W.ref });
      doc.text('Véhicule',        C.veh,  y, { width: W.veh });
      doc.text('Date',            C.date, y, { width: W.date });
      doc.text('Montant (DZD)',   C.grs,  y, { width: W.grs,  align: 'right' });
      doc.text('Taux',            C.rate, y, { width: W.rate, align: 'center' });
      doc.text('Commission (DZD)',C.com,  y, { width: W.com,  align: 'right' });
      doc.text('Net (DZD)',       C.net,  y, { width: W.net,  align: 'right' });
      doc.fillColor('#000');
    };

    drawTableHeader(doc.y);
    doc.moveDown(1.2);
    doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#bbb').lineWidth(0.5).stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(8);
    for (const line of data.lines) {
      if (doc.y > 720) { doc.addPage(); drawTableHeader(doc.y); doc.moveDown(1.2); }
      const rowY = doc.y;
      doc.text(line.referenceCode, C.ref,  rowY, { width: W.ref });
      doc.text(line.vehicleName,   C.veh,  rowY, { width: W.veh });
      doc.text(new Date(line.createdAt).toLocaleDateString('fr-FR'), C.date, rowY, { width: W.date });
      doc.text(fmtN(line.totalAmount),      C.grs,  rowY, { width: W.grs,  align: 'right' });
      doc.text(line.isWelcome ? '0%*' : `${Math.round(line.commissionRate * 100)}%`, C.rate, rowY, { width: W.rate, align: 'center' });
      doc.text(fmtN(line.commissionAmount), C.com,  rowY, { width: W.com,  align: 'right' });
      doc.text(fmtN(line.netAmount),        C.net,  rowY, { width: W.net,  align: 'right' });
      doc.moveDown(0.5);
      doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#e8e8e8').lineWidth(0.4).stroke();
      doc.moveDown(0.2);
    }

    if (data.lines.some(l => l.isWelcome)) {
      doc.fontSize(7).fillColor('#888').text('* Taux 0% : période de bienvenue', L, doc.y + 4);
      doc.fillColor('#000');
      doc.moveDown(0.5);
    }

    doc.moveDown(0.3);
    doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#bbb').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    // ── Totals ──────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Total brut : ${fmt(data.totals.grossTotal)}`,         L, doc.y, { width: R - L, align: 'right' });
    doc.text(`Commission Kerya : ${fmt(data.totals.commission)}`,   L, doc.y, { width: R - L, align: 'right' });
    doc.moveDown(0.2);
    doc.moveTo(R - 160, doc.y).lineTo(R, doc.y).strokeColor('#bbb').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.fontSize(12).text(`Net à verser : ${fmt(data.totals.netTotal)}`, L, doc.y, { width: R - L, align: 'right' });

    doc.end();
  });
}
