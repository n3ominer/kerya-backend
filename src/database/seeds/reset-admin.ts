import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, Lessor, Vehicle, VehiclePhoto, Availability, PricingRule, Booking, Payment, Review, SupportTicket, SupportMessage } from '../entities';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'vehiculedz',
  password: process.env.DB_PASSWORD || 'vehiculedz_secret',
  database: process.env.DB_NAME || 'vehiculedz_db',
  entities: [User, Lessor, Vehicle, VehiclePhoto, Availability, PricingRule, Booking, Payment, Review, SupportTicket, SupportMessage],
});

async function resetAdmin() {
  await AppDataSource.initialize();
  const userRepo = AppDataSource.getRepository(User);

  const PHONE    = '+213700000001';
  const PASSWORD = 'Admin123!';

  let admin = await userRepo.findOne({ where: { phone: PHONE } });
  if (!admin) {
    admin = userRepo.create({
      role: 'admin',
      firstName: 'Admin',
      lastName: 'Kerya',
      email: 'admin@kerya.dz',
      phone: PHONE,
      preferredLanguage: 'fr',
      isVerified: true,
      isActive: true,
    });
  }

  admin.passwordHash = await bcrypt.hash(PASSWORD, 12);
  admin.isActive = true;
  await userRepo.save(admin);

  console.log('✅ Admin password reset');
  console.log(`   Phone    : ${PHONE}`);
  console.log(`   Password : ${PASSWORD}`);
  await AppDataSource.destroy();
}

resetAdmin().catch((err) => { console.error(err); process.exit(1); });
