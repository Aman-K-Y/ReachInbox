import nodemailer from 'nodemailer';
import { prisma } from './db';
import { config } from './config';
import { notifySlack } from './slack';

type QueuedJob = { id: string; data: { emailId: string } };
const timerRegistry = new Map<string, NodeJS.Timeout>();
const senderBuckets = new Map<string, { count: number; resetAt: number }>();
const globalBuckets = new Map<string, { count: number; resetAt: number }>();

function getWindowReset(now: number, windowMs: number) {
return Math.ceil((now + windowMs) / windowMs) * windowMs;
}

export async function reserveSenderSlot(senderId: string, hourlyLimit: number) {
const windowMs = 60 * 60 * 1000;
const now = Date.now();
const bucketKey = `sender:${senderId}:${Math.floor(now / windowMs)}`;
const current = senderBuckets.get(bucketKey);

if (!current || current.resetAt <= now) {
  const next = { count: 0, resetAt: getWindowReset(now, windowMs) };
  senderBuckets.set(bucketKey, next);
  next.count += 1;
  return { allowed: true, retryAfterSeconds: 1 };
}

if (current.count >= Math.max(1, hourlyLimit)) {
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

current.count += 1;
senderBuckets.set(bucketKey, current);
return { allowed: true, retryAfterSeconds: 1 };
}

export async function reserveGlobalSlot() {
const windowMs = 60 * 60 * 1000;
const now = Date.now();
const bucketKey = `global:${Math.floor(now / windowMs)}`;
const current = globalBuckets.get(bucketKey);

if (!current || current.resetAt <= now) {
  const next = { count: 0, resetAt: getWindowReset(now, windowMs) };
  globalBuckets.set(bucketKey, next);
  next.count += 1;
  return { allowed: true, retryAfterSeconds: 1 };
}

if (current.count >= Math.max(1, config.maxEmailsPerHour)) {
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

current.count += 1;
globalBuckets.set(bucketKey, current);
return { allowed: true, retryAfterSeconds: 1 };
}

export async function cancelScheduledEmail(emailId: string) {
const jobId = `email:${emailId}`;
const timer = timerRegistry.get(jobId);
if (timer) {
   clearTimeout(timer);
   timerRegistry.delete(jobId);
}
}

export const emailQueue = {
add: async (_name: string, data: { emailId: string }, options: { jobId?: string; delay?: number } = {}) => {
  const jobId = options.jobId ?? `email:${data.emailId}`;
  const delayMs = Math.max(0, options.delay ?? 0);
  const existingTimer = timerRegistry.get(jobId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    timerRegistry.delete(jobId);
  }
  const timer = setTimeout(() => {
    void sendEmail({ id: jobId, data } as QueuedJob);
  }, delayMs);
  timerRegistry.set(jobId, timer);
  return { id: jobId, data } as QueuedJob;
},
getJob: async (jobId: string) => (timerRegistry.has(jobId) ? { id: jobId } : null),
close: async () => {
  for (const timer of timerRegistry.values()) clearTimeout(timer);
  timerRegistry.clear();
}
};

export async function enqueueEmail(email: { id: string; scheduledAt: Date }) {
const delay = Math.max(config.minDelayMs, email.scheduledAt.getTime() - Date.now());
return emailQueue.add('send', { emailId: email.id }, { jobId: `email:${email.id}`, delay });
}

async function sendEmail(job: QueuedJob) {
timerRegistry.delete(job.id);
const email = await prisma.emailJob.findUnique({ where: { id: job.data.emailId }, include: { sender: true } });
if (!email || email.status === 'SENT') return;

const claimed = await prisma.emailJob.updateMany({
  where: { id: email.id, status: { in: ['SCHEDULED', 'RESCHEDULED', 'FAILED'] } },
  data: { status: 'SENDING', attempts: { increment: 1 } }
});
if (!claimed.count) return;

const globalCapacity = await reserveGlobalSlot();
if (!globalCapacity.allowed) {
  await prisma.emailJob.update({ where: { id: email.id }, data: { status: 'RESCHEDULED' } });
  await emailQueue.add('send', { emailId: email.id }, {
    jobId: `email:${email.id}:hourly:${Date.now()}`,
    delay: globalCapacity.retryAfterSeconds * 1000 + 1000
  });
  return;
}

const senderCapacity = await reserveSenderSlot(
  email.senderId,
  Math.min(email.sender.hourlyLimit, config.maxEmailsPerHourPerSender)
);
if (!senderCapacity.allowed) {
  await prisma.emailJob.update({ where: { id: email.id }, data: { status: 'RESCHEDULED' } });
  await emailQueue.add('send', { emailId: email.id }, {
    jobId: `email:${email.id}:sender:${Date.now()}`,
    delay: senderCapacity.retryAfterSeconds * 1000 + 1000
  });
  return;
}

try {
  const transport = email.sender.smtpHost && email.sender.smtpUser && email.sender.smtpPassword
    ? nodemailer.createTransport({
      host: email.sender.smtpHost,
      port: email.sender.smtpPort || 587,
      secure: (email.sender.smtpPort || 587) === 465,
      auth: { user: email.sender.smtpUser, pass: email.sender.smtpPassword }
    })
    : config.etherealUser && config.etherealPass
      ? nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587, secure: false, auth: { user: config.etherealUser, pass: config.etherealPass } })
      : nodemailer.createTransport({ jsonTransport: true });

  const result = await transport.sendMail({
    from: email.sender.email,
    to: email.to,
    subject: email.subject,
    html: email.body
  });

  await prisma.emailJob.update({
    where: { id: email.id },
    data: { status: 'SENT', sentAt: new Date(), providerId: result.messageId }
  });
  await notifySlack(`✅ Email sent to ${email.to}: ${email.subject}`, email.userId);
} catch (error) {
  await prisma.emailJob.update({
    where: { id: email.id },
    data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) }
  });
  await notifySlack(`❌ Email failed for ${email.to}: ${email.subject}`, email.userId);
  throw error;
}
}

export async function reconcileScheduledEmails() {
const staleSending = new Date(Date.now() - 15 * 60 * 1000);
await prisma.emailJob.updateMany({
  where: { status: 'SENDING', updatedAt: { lt: staleSending } },
  data: { status: 'SCHEDULED' }
});

const pending = await prisma.emailJob.findMany({
  where: { status: { in: ['SCHEDULED', 'RESCHEDULED'] } },
  select: { id: true, scheduledAt: true }
});

for (const email of pending) {
  const jobId = `email:${email.id}`;
  if (!(await emailQueue.getJob(jobId))) {
    await enqueueEmail(email);
  }
}
}

export const worker = {
on: () => undefined,
close: async () => emailQueue.close()
};
