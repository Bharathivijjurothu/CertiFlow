import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

interface DemoUserSeed {
  name: string;
  email: string;
  role: Role;
  plainPassword: string;
  districtId?: string;
  trainingCentreId?: string;
}

const DEMO_USERS: DemoUserSeed[] = [
  {
    name: 'Anika',
    email: 'anika@certiflow.local',
    role: Role.TRAINING_CENTRE,
    plainPassword: 'CertiFlow@2026',
    trainingCentreId: 'TC-DELHI-001'
  },
  {
    name: 'Dev',
    email: 'dev@certiflow.local',
    role: Role.DISTRICT_OFFICER,
    plainPassword: 'CertiFlow@2026',
    districtId: 'DIST-NORTH-01'
  },
  {
    name: 'Kabir',
    email: 'kabir@certiflow.local',
    role: Role.DISTRICT_OFFICER,
    plainPassword: 'CertiFlow@2026',
    districtId: 'DIST-NORTH-01'
  },
  {
    name: 'Meera',
    email: 'meera@certiflow.local',
    role: Role.DISTRICT_OFFICER,
    plainPassword: 'CertiFlow@2026',
    districtId: 'DIST-SOUTH-02'
  },
  {
    name: 'Neha',
    email: 'neha@certiflow.local',
    role: Role.QUALITY_OFFICER,
    plainPassword: 'CertiFlow@2026'
  },
  {
    name: 'Farah',
    email: 'farah@certiflow.local',
    role: Role.STATE_OFFICER,
    plainPassword: 'CertiFlow@2026'
  }
];

async function main() {
  console.log('🌱 Starting database seed for CertiFlow demo users...');

  // Hash salt rounds: 10
  const saltRounds = 10;

  for (const demoUser of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(demoUser.plainPassword, saltRounds);

    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {
        name: demoUser.name,
        role: demoUser.role,
        passwordHash,
        districtId: demoUser.districtId ?? null,
        trainingCentreId: demoUser.trainingCentreId ?? null
      },
      create: {
        name: demoUser.name,
        email: demoUser.email,
        role: demoUser.role,
        passwordHash,
        districtId: demoUser.districtId ?? null,
        trainingCentreId: demoUser.trainingCentreId ?? null
      }
    });

    console.log(`✓ Seeded user: ${user.name} (${user.role}) - ${user.email} (District: ${user.districtId ?? 'N/A'}, TC: ${user.trainingCentreId ?? 'N/A'})`);
  }

  const totalUsers = await prisma.user.count();
  console.log(`✅ Database seeding completed successfully. Total users: ${totalUsers}`);
}

main()
  .catch((error) => {
    console.error('❌ Error during database seeding:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
