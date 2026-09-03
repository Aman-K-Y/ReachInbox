import 'dotenv/config';

function envString(name: string, fallback: string) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function envInt(name: string, fallback: number, minimum: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

const senderHourlyLimit = envInt('SENDER_HOURLY_LIMIT', 30, 1);

export const config = {
  port: envInt('API_PORT', 4000, 0),
  jwtSecret: envString('JWT_SECRET', 'development-secret'),
  frontendUrl: envString('FRONTEND_URL', 'http://localhost:3000'),
  redisUrl: envString('REDIS_URL', 'redis://localhost:6379'),
  elasticUrl: envString('ELASTICSEARCH_URL', 'http://localhost:9200'),
  databaseUrl: envString('DATABASE_URL', 'file:./dev.db'),
  etherealUser: process.env.ETHEREAL_USER,
  etherealPass: process.env.ETHEREAL_PASS,
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  slackClientId: process.env.SLACK_CLIENT_ID,
  slackClientSecret: process.env.SLACK_CLIENT_SECRET,
  slackRedirectUri: envString('SLACK_REDIRECT_URI', 'http://localhost:4000/api/slack/callback'),
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: envString('GOOGLE_REDIRECT_URI', 'http://localhost:4000/api/auth/google/callback'),
  senderHourlyLimit,
  minDelayMs: envInt('MIN_DELAY_MS', 2000, 0),
  maxEmailsPerHour: envInt('MAX_EMAILS_PER_HOUR', 1000, 1),
  maxEmailsPerHourPerSender: envInt('MAX_EMAILS_PER_HOUR_PER_SENDER', senderHourlyLimit, 1),
  workerConcurrency: envInt('WORKER_CONCURRENCY', 5, 1)
};
