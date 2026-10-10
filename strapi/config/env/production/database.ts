import type { Core } from '@strapi/strapi';

/**
 * Production database: Strapi Cloud's PostgreSQL. Strapi Cloud runs with NODE_ENV=production, which merges this file
 * over `config/database.ts` (SQLite, for the laptop), and it injects the variables below for its own database.
 *
 * Never add a variable starting with DATABASE_ to the Cloud project yourself: Strapi Cloud then assumes an external
 * database and stops injecting its own ones (Strapi Cloud docs, "Database").
 */
const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Database => ({
  connection: {
    client: 'postgres',
    connection: {
      host: env('DATABASE_HOST', 'localhost'),
      port: env.int('DATABASE_PORT', 5432),
      database: env('DATABASE_NAME', 'strapi'),
      user: env('DATABASE_USERNAME', 'strapi'),
      password: env('DATABASE_PASSWORD', 'strapi'),
      schema: env('DATABASE_SCHEMA', 'public'),
      ssl: env.bool('DATABASE_SSL', false) && {
        rejectUnauthorized: env.bool('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
      },
    },
    pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    acquireConnectionTimeout: env.int('DATABASE_CONNECTION_TIMEOUT', 60000),
  },
});

export default config;
