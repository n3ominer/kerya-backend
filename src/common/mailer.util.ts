// ============================================================
// MAILER (nodemailer) — used for sending invoices to lessors
// ============================================================
import * as nodemailer from 'nodemailer';

export async function sendMailWithAttachment(opts: {
  to: string;
  subject: string;
  text: string;
  attachment: { filename: string; content: Buffer; contentType: string };
}): Promise<void> {
  if (process.env.EMAIL_PROVIDER === 'mock' || !process.env.SMTP_USER) {
    console.log(`[Email:mock] → ${opts.to}: ${opts.subject} (pièce jointe : ${opts.attachment.filename})`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@vehiculedz.dz',
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    attachments: [opts.attachment],
  });
}
