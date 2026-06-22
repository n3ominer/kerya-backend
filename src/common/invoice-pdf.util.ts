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

const fmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} DZD`;

export async function buildInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new (PDFDocument as any)({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Kerya DZ', { align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor('#666').text('Facture de commission — Plateforme de location de véhicules');
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(14).font('Helvetica-Bold').text(`Facture ${data.reference}`);
    doc.fontSize(10).font('Helvetica').text(`Période : ${data.periodLabel}`);
    doc.moveDown(1);

    // Lessor info
    doc.font('Helvetica-Bold').fontSize(11).text('Loueur');
    doc.font('Helvetica').fontSize(10);
    doc.text(data.lessor.businessName);
    if (data.lessor.address) doc.text(data.lessor.address);
    if (data.lessor.city || data.lessor.wilaya) doc.text([data.lessor.city, data.lessor.wilaya].filter(Boolean).join(', '));
    if (data.lessor.legalIdentifier) doc.text(`RC : ${data.lessor.legalIdentifier}`);
    if (data.lessor.taxIdentifier) doc.text(`NIF : ${data.lessor.taxIdentifier}`);
    if (data.lessor.rib) doc.text(`RIB : ${data.lessor.rib}`);
    doc.moveDown(1);

    // Table header
    const tableTop = doc.y;
    const colX = { ref: 50, vehicle: 130, date: 280, gross: 340, rate: 410, commission: 460, net: 520 };
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Référence', colX.ref, tableTop);
    doc.text('Véhicule', colX.vehicle, tableTop);
    doc.text('Date', colX.date, tableTop);
    doc.text('Montant', colX.gross, tableTop, { width: 60, align: 'right' });
    doc.text('Taux', colX.rate, tableTop, { width: 40, align: 'right' });
    doc.text('Commission', colX.commission, tableTop, { width: 55, align: 'right' });
    doc.text('Net', colX.net, tableTop, { width: 60, align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(560, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9);
    for (const line of data.lines) {
      const y = doc.y;
      if (y > 720) {
        doc.addPage();
      }
      const rowY = doc.y;
      doc.text(line.referenceCode, colX.ref, rowY, { width: 75 });
      doc.text(line.vehicleName, colX.vehicle, rowY, { width: 140 });
      doc.text(new Date(line.createdAt).toLocaleDateString('fr-FR'), colX.date, rowY, { width: 55 });
      doc.text(fmt(line.totalAmount), colX.gross, rowY, { width: 60, align: 'right' });
      doc.text(line.isWelcome ? '0% (bienvenue)' : `${Math.round(line.commissionRate * 100)}%`, colX.rate, rowY, { width: 60, align: 'right' });
      doc.text(fmt(line.commissionAmount), colX.commission, rowY, { width: 55, align: 'right' });
      doc.text(fmt(line.netAmount), colX.net, rowY, { width: 60, align: 'right' });
      doc.moveDown(0.6);
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(560, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.5);

    // Totals
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Total brut : ${fmt(data.totals.grossTotal)}`, { align: 'right' });
    doc.text(`Commission Kerya : ${fmt(data.totals.commission)}`, { align: 'right' });
    doc.text(`Net à verser au loueur : ${fmt(data.totals.netTotal)}`, { align: 'right' });

    doc.end();
  });
}
