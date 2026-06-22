// ============================================================
// EXCEL EXPORT HELPERS (exceljs)
// ============================================================
import { Workbook } from 'exceljs';

export async function buildPaymentsWorkbook(data: {
  summary: any;
  transactions: any[];
}): Promise<Buffer> {
  const wb = new Workbook();

  const summarySheet = wb.addWorksheet('Résumé');
  summarySheet.columns = [
    { header: 'Indicateur', key: 'label', width: 35 },
    { header: 'Valeur (DZD)', key: 'value', width: 20 },
  ];
  summarySheet.addRows([
    { label: 'Revenu brut', value: data.summary.grossTotal || 0 },
    { label: 'Commission Kerya', value: data.summary.commission || 0 },
    { label: 'Net perçu', value: data.summary.netTotal || 0 },
    { label: 'Dont période de bienvenue (0%)', value: data.summary.welcomeAmount || 0 },
    { label: 'Locations soumises à commission', value: data.summary.commissionableAmount || 0 },
    { label: 'Paiements en attente (nombre)', value: data.summary.pendingCount || 0 },
    { label: 'Paiements en attente (montant)', value: data.summary.pendingAmount || 0 },
  ]);
  summarySheet.getRow(1).font = { bold: true };

  const txSheet = wb.addWorksheet('Transactions');
  txSheet.columns = [
    { header: 'Référence', key: 'referenceCode', width: 18 },
    { header: 'Véhicule', key: 'vehicleName', width: 28 },
    { header: 'Date de réservation', key: 'createdAt', width: 20 },
    { header: 'Début location', key: 'pickupAt', width: 18 },
    { header: 'Fin location', key: 'returnAt', width: 18 },
    { header: 'Statut', key: 'status', width: 14 },
    { header: 'Bienvenue (0%)', key: 'isWelcome', width: 16 },
    { header: 'Montant brut', key: 'totalAmount', width: 16 },
    { header: 'Commission', key: 'commissionAmount', width: 14 },
    { header: 'Montant net', key: 'netAmount', width: 16 },
  ];
  txSheet.getRow(1).font = { bold: true };
  for (const t of data.transactions) {
    txSheet.addRow({
      referenceCode: t.referenceCode,
      vehicleName: t.vehicleName,
      createdAt: t.createdAt ? new Date(t.createdAt).toLocaleString('fr-FR') : '',
      pickupAt: t.pickupAt ? new Date(t.pickupAt).toLocaleDateString('fr-FR') : '',
      returnAt: t.returnAt ? new Date(t.returnAt).toLocaleDateString('fr-FR') : '',
      status: t.status,
      isWelcome: t.isWelcome ? 'Oui' : 'Non',
      totalAmount: t.totalAmount,
      commissionAmount: t.commissionAmount,
      netAmount: t.netAmount,
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildBookingsWorkbook(bookings: any[]): Promise<Buffer> {
  const wb = new Workbook();
  const sheet = wb.addWorksheet('Réservations');
  sheet.columns = [
    { header: 'Référence', key: 'referenceCode', width: 18 },
    { header: 'Véhicule', key: 'vehicleName', width: 28 },
    { header: 'Client', key: 'customerName', width: 24 },
    { header: 'Début location', key: 'pickupAt', width: 18 },
    { header: 'Fin location', key: 'returnAt', width: 18 },
    { header: 'Montant total', key: 'totalAmount', width: 16 },
    { header: 'Statut', key: 'status', width: 16 },
    { header: 'Statut paiement', key: 'paymentStatus', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const b of bookings) {
    sheet.addRow({
      referenceCode: b.referenceCode,
      vehicleName: b.vehicle ? `${b.vehicle.brand} ${b.vehicle.model}` : '—',
      customerName: b.customer ? `${b.customer.firstName} ${b.customer.lastName}` : '—',
      pickupAt: b.pickupAt ? new Date(b.pickupAt).toLocaleDateString('fr-FR') : '',
      returnAt: b.returnAt ? new Date(b.returnAt).toLocaleDateString('fr-FR') : '',
      totalAmount: parseFloat(String(b.totalAmount || 0)),
      status: b.status,
      paymentStatus: b.paymentStatus,
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
