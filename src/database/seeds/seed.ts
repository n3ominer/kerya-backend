import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
  User, Lessor, Vehicle, VehiclePhoto,
  Availability, PricingRule, Booking, Payment, Review, SupportTicket, SupportMessage,
} from '../entities';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'vehiculedz',
  password: process.env.DB_PASSWORD || 'vehiculedz_secret',
  database: process.env.DB_NAME || 'vehiculedz_db',
  entities: [User, Lessor, Vehicle, VehiclePhoto, Availability, PricingRule, Booking, Payment, Review, SupportTicket, SupportMessage],
  synchronize: true,
});
// Vehicle/VehiclePhoto/Availability/PricingRule/Booking/Payment/Review/SupportTicket/SupportMessage
// are registered above for synchronize but no longer seeded with fake data — only core accounts are.

async function seed() {
  await AppDataSource.initialize();
  console.log('📦 Seeding database...');

  const userRepo = AppDataSource.getRepository(User);
  const lessorRepo = AppDataSource.getRepository(Lessor);

  // ─── Admin ───────────────────────────────────────────────
  let admin = await userRepo.findOne({ where: { email: 'admin@kerya.dz' } });
  if (!admin) {
    await userRepo.save(userRepo.create({
      role: 'admin',
      firstName: 'Admin',
      lastName: 'Kerya',
      email: 'admin@kerya.dz',
      phone: '+213700000001',
      passwordHash: await bcrypt.hash('Admin123!', 12),
      preferredLanguage: 'fr',
      isVerified: true,
    }));
    console.log('✅ Admin créé');
  }

  // ─── Loueur 1 ────────────────────────────────────────────
  let lessorUser1 = await userRepo.findOne({ where: { email: 'alger.rent@gmail.com' } });
  if (!lessorUser1) {
    lessorUser1 = await userRepo.save(userRepo.create({
      role: 'lessor',
      firstName: 'Karim',
      lastName: 'Bensalem',
      email: 'alger.rent@gmail.com',
      phone: '+213661234567',
      passwordHash: await bcrypt.hash('Lessor@2026', 12),
      preferredLanguage: 'fr',
      isVerified: true,
    }));
  }

  let lessor1 = await lessorRepo.findOne({ where: { ownerUserId: lessorUser1.id } });
  if (!lessor1) {
    await lessorRepo.save(lessorRepo.create({
      ownerUserId: lessorUser1.id,
      type: 'agency',
      businessName: 'Alger Auto Rent',
      legalIdentifier: 'RC16/00-1234567',
      wilaya: 'Alger',
      city: 'Alger',
      phone: '+213661234567',
      email: 'alger.rent@gmail.com',
      status: 'approved',
    }));
    console.log('✅ Loueur 1 créé');
  }

  // ─── Loueur 2 ────────────────────────────────────────────
  let lessorUser2 = await userRepo.findOne({ where: { email: 'oran.drive@hotmail.com' } });
  if (!lessorUser2) {
    lessorUser2 = await userRepo.save(userRepo.create({
      role: 'lessor',
      firstName: 'Yasmina',
      lastName: 'Hadj',
      email: 'oran.drive@hotmail.com',
      phone: '+213771234567',
      passwordHash: await bcrypt.hash('Lessor@2026', 12),
      preferredLanguage: 'ar',
      isVerified: true,
    }));
  }

  let lessor2 = await lessorRepo.findOne({ where: { ownerUserId: lessorUser2.id } });
  if (!lessor2) {
    await lessorRepo.save(lessorRepo.create({
      ownerUserId: lessorUser2.id,
      type: 'independent',
      businessName: 'Oran Drive',
      wilaya: 'Oran',
      city: 'Oran',
      phone: '+213771234567',
      email: 'oran.drive@hotmail.com',
      status: 'approved',
    }));
    console.log('✅ Loueur 2 créé');
  }

  // ─── Client 1 ───────────────────────────────────────────────
  let client1 = await userRepo.findOne({ where: { email: 'client@gmail.com' } });
  if (!client1) {
    await userRepo.save(userRepo.create({
      role: 'customer',
      firstName: 'Ahmed',
      lastName: 'Bouras',
      email: 'client@gmail.com',
      phone: '+213551234567',
      passwordHash: await bcrypt.hash('Client@2026', 12),
      preferredLanguage: 'fr',
      isVerified: true,
    }));
    console.log('✅ Client 1 créé');
  }

  // ─── Client 2 ───────────────────────────────────────────────
  let client2 = await userRepo.findOne({ where: { email: 'client@kerya.dz' } });
  if (!client2) {
    await userRepo.save(userRepo.create({
      role: 'customer',
      firstName: 'Test',
      lastName: 'Client',
      email: 'client@kerya.dz',
      phone: '+213700000003',
      passwordHash: await bcrypt.hash('Client123!', 12),
      preferredLanguage: 'fr',
      isVerified: true,
    }));
    console.log('✅ Client 2 créé');
  }

  console.log('\n🎉 Seed terminé avec succès!');
  console.log('\n📋 Comptes de test:');
  console.log('  Admin    — admin@kerya.dz          / Admin123!');
  console.log('  Loueur 1 — alger.rent@gmail.com    / Lessor@2026');
  console.log('  Loueur 2 — oran.drive@hotmail.com  / Lessor@2026');
  console.log('  Client 1 — client@gmail.com        / Client@2026');
  console.log('  Client 2 — client@kerya.dz         / Client123!');

  await AppDataSource.destroy();
}

seed().catch((err) => { console.error(err); process.exit(1); });
