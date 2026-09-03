import { prisma } from './db';

export async function indexEmail(_email: { id: string; userId: string; to: string; subject: string; body: string; status: string }) {
  // Local SQLite mode does not use Elasticsearch; the database search fallback remains active.
}

export async function searchEmails(userId: string, query: string) {
  return prisma.emailJob.findMany({
    where: {
      userId,
      OR: [
        { to: { contains: query } },
        { subject: { contains: query } },
        { body: { contains: query } }
      ]
    },
    orderBy: { createdAt: 'desc' }
  });
}
