import { applyMigrations } from './src/migrate.js';
await applyMigrations({ DATABASE_URL: 'file:/tmp/t6.db' });
