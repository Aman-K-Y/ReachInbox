import { app } from './app';
import { config } from './config';
import { reconcileScheduledEmails } from './queue';

app.listen(config.port, () => {
  console.log(`ReachInbox API listening on http://localhost:${config.port}`);
  reconcileScheduledEmails().catch(error => console.error('Queue reconciliation failed', error));
});
