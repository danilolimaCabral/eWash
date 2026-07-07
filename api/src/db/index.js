import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema.js';

export const getDb = (env) => drizzle(env.DB, { schema });
export { schema };
