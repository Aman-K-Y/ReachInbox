import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const demoEmail = 'demo@reachinbox.local';
const demoPassword = process.env.DEMO_USER_PASSWORD || 'DemoPassword123!';

async function main() {
  const user = await prisma.user.upsert({
    where: { email: demoEmail },
    update: { name: 'ReachInbox Demo', passwordHash: await bcrypt.hash(demoPassword, 10) },
    create: {
      email: demoEmail,
      name: 'ReachInbox Demo',
      passwordHash: await bcrypt.hash(demoPassword, 10)
    }
  });

  const accounts = await Promise.all([
    nodemailer.createTestAccount(),
    nodemailer.createTestAccount()
  ]);

  const senders = [];
  for (const [index, account] of accounts.entries()) {
    const sender = await prisma.sender.upsert({
      where: { userId_email: { userId: user.id, email: account.user } },
      update: {
        name: `Demo Sender ${index + 1}`,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        smtpUser: account.user,
        smtpPassword: account.pass
      },
      create: {
        userId: user.id,
        email: account.user,
        name: `Demo Sender ${index + 1}`,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        smtpUser: account.user,
        smtpPassword: account.pass
      }
    });
    senders.push(sender);
  }

  console.log(`Demo user credentials: ${demoEmail} / ${demoPassword}`);
  senders.forEach((sender, index) => {
    console.log(`Demo sender ${index + 1} credentials: ${sender.email} / ${sender.smtpUser} / ${sender.smtpPassword}`);
  });
}

main()
  .catch(error => {
    console.error('Prisma seed failed', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
