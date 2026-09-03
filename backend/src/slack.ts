import { config } from './config';
import { prisma } from './db';
export async function notifySlack(text: string, userId?: string) {
  const connection = userId ? await prisma.slackConnection.findUnique({ where: { userId } }) : null;
  const webhookUrl = connection?.incomingWebhookUrl || config.slackWebhookUrl;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  } catch { /* delivery notifications must not affect email delivery */ }
}
export const slackOAuthUrl = (state: string) =>
  `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(config.slackClientId || '')}&scope=incoming-webhook&redirect_uri=${encodeURIComponent(config.slackRedirectUri)}&state=${encodeURIComponent(state)}`;
