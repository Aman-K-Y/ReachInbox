import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from './db';
import { auth, AuthRequest, hashPassword, signToken, verifyPassword, verifyToken } from './auth';
import { cancelScheduledEmail, enqueueEmail, emailQueue } from './queue';
import { indexEmail, searchEmails } from './search';
import { notifySlack, slackOAuthUrl } from './slack';
import { config } from './config';

export const app = express();
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true }));
const health = (_req: express.Request, res: express.Response) => res.json({ ok: true, status: 'ok', service: 'email-scheduler' });
app.get('/api/health', health);
app.get('/health', health);

const credentials = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().optional() });
const googleProfile = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200).optional(),
  image: z.string().trim().optional().transform((value) => value && value.trim() ? value : undefined)
});
app.post('/api/auth/register', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const user = await prisma.user.create({ data: { email: parsed.data.email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password) } });
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name }, token: signToken(user.id) });
  } catch { res.status(409).json({ error: 'Email already registered' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const parsed = credentials.pick({ email: true, password: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid email and password are required' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ user: { id: user.id, email: user.email, name: user.name }, token: signToken(user.id) });
});
app.get('/api/auth/me', auth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});
app.get('/api/auth/google/login-url', (_req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) {
    return res.status(400).json({ error: 'Google OAuth is not configured on this server.' });
  }

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent'
  });

  return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});
app.get('/api/auth/google/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code || !config.googleClientId || !config.googleClientSecret) {
    return res.status(400).json({ error: 'Google OAuth is not configured or the authorization code is missing.' });
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: 'authorization_code'
    })
  });

  const tokenPayload = await tokenResponse.json() as { access_token?: string; id_token?: string };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return res.status(400).json({ error: 'Google token exchange failed.' });
  }

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` }
  });

  const profilePayload = await profileResponse.json() as { email?: string; name?: string; picture?: string };
  if (!profileResponse.ok || !profilePayload.email) {
    return res.status(400).json({ error: 'Google profile lookup failed.' });
  }

  const profile = googleProfile.parse({
    email: profilePayload.email,
    name: profilePayload.name,
    image: profilePayload.picture
  });

  const user = await prisma.user.upsert({
    where: { email: profile.email },
    update: { name: profile.name ?? undefined, image: profile.image ?? undefined },
    create: {
      email: profile.email,
      name: profile.name ?? profile.email.split('@')[0],
      image: profile.image,
      passwordHash: null
    }
  });

  const token = signToken(user.id);
  return res.redirect(`${config.frontendUrl}/login?google=success&token=${encodeURIComponent(token)}`);
});
app.post('/api/auth/google', async (req, res) => {
  const parsed = googleProfile.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid Google profile data is required' });

  const profile = parsed.data;
  const user = await prisma.user.upsert({
    where: { email: profile.email },
    update: { name: profile.name ?? undefined, image: profile.image ?? undefined },
    create: {
      email: profile.email,
      name: profile.name ?? profile.email.split('@')[0],
      image: profile.image,
      passwordHash: null
    }
  });

  res.json({ user: { id: user.id, email: user.email, name: user.name }, token: signToken(user.id) });
});

const senderInput = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  smtpHost: z.string().min(1).max(255).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().max(255).optional(),
  smtpPassword: z.string().max(1000).optional(),
  hourlyLimit: z.coerce.number().int().min(1).max(100000).optional()
});
function publicSender(sender: { id: string; email: string; name: string | null; smtpHost: string | null; smtpPort: number | null; smtpUser: string | null; hourlyLimit: number; createdAt: Date; updatedAt: Date }) {
  return { ...sender, smtpPassword: undefined };
}
app.get('/api/senders', auth, async (req: AuthRequest, res) => {
  const senders = await prisma.sender.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'asc' } });
  res.json(senders.map(publicSender));
});
app.get('/api/senders/:id', auth, async (req: AuthRequest, res) => {
  const sender = await prisma.sender.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
  sender ? res.json(publicSender(sender)) : res.status(404).json({ error: 'Sender not found' });
});
app.post('/api/senders', auth, async (req: AuthRequest, res) => {
  const parsed = senderInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const sender = await prisma.sender.create({ data: { ...parsed.data, userId: req.userId!, hourlyLimit: parsed.data.hourlyLimit || config.senderHourlyLimit } });
    res.status(201).json(publicSender(sender));
  } catch { res.status(409).json({ error: 'A sender with this email already exists' }); }
});
app.patch('/api/senders/:id', auth, async (req: AuthRequest, res) => {
  const parsed = senderInput.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const sender = await prisma.sender.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
  if (!sender) return res.status(404).json({ error: 'Sender not found' });
  try {
    const updated = await prisma.sender.update({ where: { id: sender.id }, data: parsed.data });
    res.json(publicSender(updated));
  } catch { res.status(409).json({ error: 'A sender with this email already exists' }); }
});
app.delete('/api/senders/:id', auth, async (req: AuthRequest, res) => {
  const sender = await prisma.sender.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
  if (!sender) return res.status(404).json({ error: 'Sender not found' });
  if (await prisma.emailJob.count({ where: { senderId: sender.id, status: { in: ['SCHEDULED', 'RESCHEDULED', 'SENDING'] } } })) {
    return res.status(409).json({ error: 'Sender has pending email jobs' });
  }
  await prisma.sender.delete({ where: { id: sender.id } });
  res.status(204).end();
});

const emailInput = z.object({
  senderId: z.string().min(1).optional(),
  to: z.string().email().optional(),
  recipient: z.string().email().optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  scheduledAt: z.coerce.date(),
  idempotencyKey: z.string().min(1).max(200).optional()
}).superRefine((value, ctx) => {
  if (!value.to && !value.recipient) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Recipient is required' });
});

async function defaultSender(userId: string) {
  const existing = await prisma.sender.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return prisma.sender.create({ data: { userId, email: user.email, hourlyLimit: config.senderHourlyLimit } });
}

async function createScheduledEmail(userId: string, input: z.infer<typeof emailInput>, keySuffix = '') {
  const to = input.to || input.recipient!;
  if (input.scheduledAt.getTime() <= Date.now()) throw new Error('scheduledAt must be in the future');
  const sender = input.senderId
    ? await prisma.sender.findFirst({ where: { id: input.senderId, userId } })
    : await defaultSender(userId);
  if (!sender) throw new Error('Sender not found');
  const key = input.idempotencyKey || `schedule:${userId}:${sender.id}:${to}:${input.scheduledAt.toISOString()}${keySuffix}`;
  const existing = await prisma.emailJob.findUnique({ where: { idempotencyKey: key } });
  if (existing) return existing;
  const email = await prisma.emailJob.create({ data: { userId, senderId: sender.id, to, subject: input.subject, body: input.body, scheduledAt: input.scheduledAt, idempotencyKey: key } });
  await enqueueEmail(email);
  await indexEmail(email);
  return email;
}

async function scheduleHandler(req: AuthRequest, res: express.Response) {
  if (Array.isArray(req.body?.recipients)) {
    const common = { ...req.body };
    const jobs = [];
    for (const [index, recipient] of req.body.recipients.entries()) {
      const recipientValue = typeof recipient === 'string' ? recipient : recipient.to || recipient.email || recipient.recipient;
      const input = emailInput.safeParse({ ...common, ...recipient, to: recipientValue, scheduledAt: common.scheduledAt || common.scheduledFor, idempotencyKey: recipient.idempotencyKey || common.idempotencyKey });
      if (!input.success) return res.status(400).json({ error: input.error.flatten(), recipient: index });
      try { jobs.push(await createScheduledEmail(req.userId!, input.data, `:${index}`)); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid schedule' }); }
    }
    return res.status(201).json({ jobs });
  }
  const parsed = emailInput.safeParse({ ...req.body, to: req.body?.to || req.body?.recipient || req.body?.recipientEmail, scheduledAt: req.body?.scheduledAt || req.body?.scheduledFor });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const email = await createScheduledEmail(req.userId!, parsed.data);
    res.status(201).json(email);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid schedule' }); }
}
app.post('/api/emails/schedule', auth, scheduleHandler);
app.post('/api/emails', auth, scheduleHandler);

app.get('/api/emails', auth, async (req: AuthRequest, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const emails = q ? await searchEmails(req.userId!, q) : await prisma.emailJob.findMany({ where: { userId: req.userId! }, orderBy: { scheduledAt: 'desc' } });
  res.json(emails);
});
app.get('/api/emails/:id', auth, async (req: AuthRequest, res) => {
  const email = await prisma.emailJob.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
  email ? res.json(email) : res.status(404).json({ error: 'Email not found' });
});
app.patch('/api/emails/:id', auth, async (req: AuthRequest, res) => {
  const email = await prisma.emailJob.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
  if (!email) return res.status(404).json({ error: 'Email not found' });

  const input = z.object({
    to: z.string().email().optional(),
    subject: z.string().min(1).max(200).optional(),
    body: z.string().min(1).optional(),
    scheduledAt: z.coerce.date().optional()
  }).safeParse(req.body);

  if (!input.success) return res.status(400).json({ error: input.error.flatten() });
  if (!input.data.to && !input.data.subject && !input.data.body && !input.data.scheduledAt) {
    return res.status(400).json({ error: 'At least one field must be provided' });
  }

  if (input.data.scheduledAt && input.data.scheduledAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'scheduledAt must be in the future' });
  }

  const updateData = {
    ...(input.data.to ? { to: input.data.to } : {}),
    ...(input.data.subject ? { subject: input.data.subject } : {}),
    ...(input.data.body ? { body: input.data.body } : {}),
    ...(input.data.scheduledAt ? { scheduledAt: input.data.scheduledAt, status: 'SCHEDULED' } : {})
  };

  try {
    const updated = await prisma.emailJob.update({ where: { id: email.id }, data: updateData });
    await cancelScheduledEmail(email.id);
    await enqueueEmail(updated);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to reschedule email' });
  }
});
app.delete('/api/emails/:id', auth, async (req: AuthRequest, res) => {
  const email = await prisma.emailJob.findFirst({ where: { id: String(req.params.id), userId: req.userId! } });
  if (!email) return res.status(404).json({ error: 'Email not found' });
  await cancelScheduledEmail(email.id);
  await prisma.emailJob.delete({ where: { id: email.id } });
  res.status(204).end();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
function parseCsvLine(line: string) {
  const values: string[] = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += character;
  }
  values.push(value.trim());
  return values;
}
function parseUpload(buffer: Buffer) {
  const lines = buffer.toString('utf8').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return { rows: [], errors: ['CSV is empty'] };
  const headers = parseCsvLine(lines[0]).map(header => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  const indexes = ['to', 'subject', 'body', 'scheduledat'].map(header => headers.indexOf(header));
  if (indexes.some(index => index < 0)) return { rows: [], errors: ['CSV must include to, subject, body and scheduledAt columns'] };
  const rows: Array<{ to: string; subject: string; body: string; scheduledAt: string }> = [];
  const errors: Array<string> = [];
  lines.slice(1).forEach((line, rowIndex) => {
    const values = parseCsvLine(line);
    const row = { to: values[indexes[0]] || '', subject: values[indexes[1]] || '', body: values[indexes[2]] || '', scheduledAt: values[indexes[3]] || '' };
    if (!emailInput.safeParse(row).success || new Date(row.scheduledAt) <= new Date()) errors.push(`Row ${rowIndex + 2} is invalid or not in the future`);
    else rows.push(row);
  });
  return { rows, errors };
}
app.post('/api/uploads/parse', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
  res.json(parseUpload(req.file.buffer));
});
app.post('/api/emails/upload/parse', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
  res.json(parseUpload(req.file.buffer));
});
app.post('/api/emails/upload', auth, upload.single('file'), async (req: AuthRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
  const parsed = parseUpload(req.file.buffer);
  const created = [];
  for (const [index, row] of parsed.rows.entries()) {
    try { created.push(await createScheduledEmail(req.userId!, emailInput.parse({ ...row, senderId: req.body.senderId }), `:csv:${index}`)); } catch { /* invalid rows are reported below */ }
  }
  res.status(201).json({ count: created.length, emails: created, errors: parsed.errors });
});

app.get('/api/slack/connect', auth, (req: AuthRequest, res) => res.json({ url: slackOAuthUrl(signToken(req.userId!)) }));
app.get('/api/slack/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const userId = typeof req.query.state === 'string' ? verifyToken(req.query.state) : null;
  if (!code || !userId) return res.status(400).json({ error: 'Missing Slack OAuth code or state' });
  if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
    return res.status(400).json({ error: 'Slack OAuth state is no longer valid' });
  }
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.slackClientId || '', client_secret: config.slackClientSecret || '', redirect_uri: config.slackRedirectUri })
  });
  const result = await response.json() as { ok?: boolean; access_token?: string; scope?: string; team?: { id?: string }; incoming_webhook?: { url?: string; channel_id?: string; channel_name?: string } };
  if (!result.ok || !result.incoming_webhook?.url) return res.status(400).json({ error: 'Slack authorization failed' });
  await prisma.slackConnection.upsert({
    where: { userId },
    create: { userId, teamId: result.team?.id, incomingWebhookUrl: result.incoming_webhook.url, channelId: result.incoming_webhook.channel_id, channelName: result.incoming_webhook.channel_name, accessToken: result.access_token, scope: result.scope },
    update: { teamId: result.team?.id, incomingWebhookUrl: result.incoming_webhook.url, channelId: result.incoming_webhook.channel_id, channelName: result.incoming_webhook.channel_name, accessToken: result.access_token, scope: result.scope }
  });
  res.redirect(`${config.frontendUrl}/dashboard?slack=connected`);
});
app.get('/api/slack/status', auth, async (req: AuthRequest, res) => {
  const connection = await prisma.slackConnection.findUnique({ where: { userId: req.userId! }, select: { teamId: true, channelId: true, channelName: true, createdAt: true } });
  res.json({ connected: Boolean(connection), connection });
});
app.delete('/api/slack/connect', auth, async (req: AuthRequest, res) => {
  await prisma.slackConnection.deleteMany({ where: { userId: req.userId! } });
  res.status(204).end();
});
app.post('/api/slack/test', auth, async (req: AuthRequest, res) => { await notifySlack('ReachInbox Slack notifications are connected.', req.userId); res.json({ ok: true }); });
app.post('/api/slack/webhook', async (req, res) => {
  if (req.body?.type === 'url_verification') return res.json({ challenge: req.body.challenge });
  console.log('Slack event', req.body?.type);
  res.sendStatus(200);
});

export default app;
