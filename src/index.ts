import 'dotenv/config'; // Load .env before anything else
import './config/env'; // Validate env vars — fail fast if any are missing
import { createApp } from './app';
import { prisma } from './prisma/client';
import { env } from './config/env';

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${env.PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
});

// Graceful shutdown — close the DB connection pool cleanly
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
