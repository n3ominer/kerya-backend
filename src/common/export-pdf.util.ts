// ============================================================
// PDF EXPORT HELPERS (pdfkit) — bookings & payments
// ============================================================
import * as PDFDocument from 'pdfkit';

const fmtNum  = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' DZD';
const fmtDate = (d: any)    => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const fmtDays = (a: any, b: any) => {
  if (!a || !b) return '—';
  const ms = Math.abs(new Date(b).getTime() - new Date(a).getTime());
  return Math.round(ms / 86400000) + ' j';
};

// ─── Bookings PDF ─────────────────────────────────────────────
export async function buildBookingsPdf(bookings: any[], title = 'Export réservations'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new (PDFDocument as any)({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = 841.89;
    const margin = 40;
    const contentW = pageW - margin * 2;

    // Header
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text('Kerya DZ', margin, margin);
    doc.fontSize(10).font('Helvetica').fillColor('#555')
      .text(title, margin, doc.y, { continued: false });
    doc.fontSize(9).fillColor('#888')
      .text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
    doc.moveDown(0.5);

    // Column definitions (landscape A4 = 841 wide)
    const cols = [
      { label: 'Référence',      key: 'ref',    w: 90,  align: 'left'  as const },
      { label: 'Client',         key: 'client', w: 120, align: 'left'  as const },
      { label: 'Véhicule',       key: 'veh',    w: 130, align: 'left'  as const },
      { label: 'Début',          key: 'start',  w: 70,  align: 'center'as const },
      { label: 'Fin',            key: 'end',    w: 70,  align: 'center'as const },
      { label: 'Durée',          key: 'days',   w: 45,  align: 'center'as const },
      { label: 'Caution',        key: 'dep',    w: 80,  align: 'right' as const },
      { label: 'Montant',        key: 'amt',    w: 90,  align: 'right' as const },
      { label: 'Statut',         key: 'stat',   w: 70,  align: 'center'as const },
    ];

    const drawRow = (row: Record<string, string>, isHeader = false, y?: number) => {
      let x = margin;
      const rowY = y ?? doc.y;
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHeader ? 8 : 8);
      doc.fillColor(isHeader ? '#374151' : '#111');
      for (const col of cols) {
        doc.text(row[col.key] ?? '—', x, rowY, { width: col.w, align: col.align });
        x += col.w;
      }
    };

    // Table header
    const headerY = doc.y;
    doc.rect(margin, headerY - 2, contentW, 18).fillColor('#f3f4f6').fill();
    doc.fillColor('#374151');
    drawRow(Object.fromEntries(cols.map(c => [c.key, c.label])), true, headerY + 2);
    doc.moveDown(1.6);
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#e5e7eb').stroke();
    doc.moveDown(0.3);

    for (const b of bookings) {
      if (doc.y > 530) {
        doc.addPage({ layout: 'landscape' });
        doc.moveDown(1);
        const hy = doc.y;
        doc.rect(margin, hy - 2, contentW, 18).fillColor('#f3f4f6').fill();
        drawRow(Object.fromEntries(cols.map(c => [c.key, c.label])), true, hy + 2);
        doc.moveDown(1.6);
        doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#e5e7eb').stroke();
        doc.moveDown(0.3);
      }
      const veh = b.vehicle ? `${b.vehicle.brand} ${b.vehicle.model} (${b.vehicle.year ?? ''})`.trim() : (b.vehicleName || '—');
      const client = b.customer ? `${b.customer.firstName} ${b.customer.lastName}\n${b.customer.phone || ''}` : (b.customerName || '—');
      const status = { confirmed: 'Confirmée', pending: 'En attente', cancelled: 'Annulée', completed: 'Terminée', rejected: 'Refusée' }[b.status] ?? b.status;
      drawRow({
        ref:    b.referenceCode || '—',
        client,
        veh,
        start:  fmtDate(b.pickupAt),
        end:    fmtDate(b.returnAt),
        days:   fmtDays(b.pickupAt, b.returnAt),
        dep:    b.depositAmount ? fmtNum(Number(b.depositAmount)) : '—',
        amt:    b.totalAmount ? fmtNum(Number(b.totalAmount)) : '—',
        stat:   status,
      });
      doc.moveDown(0.3);
      doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#f3f4f6').stroke();
      doc.moveDown(0.2);
    }

    // Summary
    const total = bookings.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
    doc.moveDown(0.5);
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#9ca3af').stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
      .text(`Total : ${bookings.length} réservation${bookings.length > 1 ? 's' : ''}`, margin, doc.y, { continued: true })
      .text(`Montant total : ${fmtNum(total)}`, { align: 'right' });

    doc.end();
  });
}

// ─── Payments PDF ─────────────────────────────────────────────
export async function buildPaymentsPdf(data: { summary: any; transactions: any[] }, title = 'Export paiements'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new (PDFDocument as any)({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = 841.89;
    const margin = 40;
    const contentW = pageW - margin * 2;

    // Header
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text('Kerya DZ', margin, margin);
    doc.fontSize(10).font('Helvetica').fillColor('#555').text(title);
    doc.fontSize(9).fillColor('#888')
      .text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
    doc.moveDown(0.5);

    // Summary box
    const s = data.summary;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Résumé de la période', margin);
    doc.moveDown(0.3);
    const summaryItems = [
      ['Revenu brut',     fmtNum(s.grossTotal || 0)],
      ['Commission Kerya', fmtNum(s.commission || 0)],
      ['Net perçu',       fmtNum(s.netTotal || 0)],
    ];
    let sx = margin;
    for (const [lbl, val] of summaryItems) {
      doc.rect(sx, doc.y, 180, 44).fillColor('#f9fafb').fill().strokeColor('#e5e7eb').stroke();
      doc.fillColor('#6b7280').font('Helvetica').fontSize(8).text(lbl, sx + 10, doc.y + 8, { width: 160 });
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(12).text(val, sx + 10, doc.y + 2, { width: 160 });
      sx += 192;
    }
    doc.moveDown(4);

    // Transactions table
    const cols = [
      { label: 'Référence',   key: 'ref',    w: 100, align: 'left'  as const },
      { label: 'Véhicule',    key: 'veh',    w: 140, align: 'left'  as const },
      { label: 'Date',        key: 'date',   w: 75,  align: 'center'as const },
      { label: 'Début',       key: 'start',  w: 70,  align: 'center'as const },
      { label: 'Fin',         key: 'end',    w: 70,  align: 'center'as const },
      { label: 'Statut',      key: 'stat',   w: 75,  align: 'center'as const },
      { label: 'Brut',        key: 'gross',  w: 80,  align: 'right' as const },
      { label: 'Commission',  key: 'comm',   w: 80,  align: 'right' as const },
      { label: 'Net',         key: 'net',    w: 80,  align: 'right' as const },
    ];

    const drawRow = (row: Record<string, string>, isHeader = false, y?: number) => {
      let x = margin;
      const rowY = y ?? doc.y;
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      doc.fillColor(isHeader ? '#374151' : '#111');
      for (const col of cols) {
        doc.text(row[col.key] ?? '—', x, rowY, { width: col.w, align: col.align });
        x += col.w;
      }
    };

    const hy = doc.y;
    doc.rect(margin, hy - 2, contentW, 18).fillColor('#f3f4f6').fill();
    drawRow(Object.fromEntries(cols.map(c => [c.key, c.label])), true, hy + 2);
    doc.moveDown(1.6);
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#e5e7eb').stroke();
    doc.moveDown(0.3);

    for (const t of data.transactions) {
      if (doc.y > 530) {
        doc.addPage({ layout: 'landscape' });
        doc.moveDown(1);
        const rhy = doc.y;
        doc.rect(margin, rhy - 2, contentW, 18).fillColor('#f3f4f6').fill();
        drawRow(Object.fromEntries(cols.map(c => [c.key, c.label])), true, rhy + 2);
        doc.moveDown(1.6);
        doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#e5e7eb').stroke();
        doc.moveDown(0.3);
      }
      const status = { confirmed: 'Confirmé', pending: 'En attente', cancelled: 'Annulé', completed: 'Terminé' }[t.status] ?? t.status;
      drawRow({
        ref:   t.referenceCode || '—',
        veh:   t.vehicleName   || '—',
        date:  fmtDate(t.createdAt),
        start: fmtDate(t.pickupAt),
        end:   fmtDate(t.returnAt),
        stat:  status,
        gross: fmtNum(Number(t.totalAmount || 0)),
        comm:  fmtNum(Number(t.commissionAmount || 0)),
        net:   fmtNum(Number(t.netAmount || 0)),
      });
      doc.moveDown(0.3);
      doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#f3f4f6').stroke();
      doc.moveDown(0.2);
    }

    // Footer total
    doc.moveDown(0.5);
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#9ca3af').stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
      .text(`${data.transactions.length} transaction${data.transactions.length > 1 ? 's' : ''}`, margin, doc.y, { continued: true })
      .text(`Net total : ${fmtNum(s.netTotal || 0)}`, { align: 'right' });

    doc.end();
  });
}
