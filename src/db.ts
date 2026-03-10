import { Pool, Client } from 'pg';
import { parse } from 'pg-connection-string';
import { config } from './config/config';
import { logger } from './logger';

const dbConfig = parse(config.db.url);
const targetDbName = dbConfig.database || 'wasabidb';

export const pool = new Pool({
    connectionString: config.db.url,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
});

export const ensureDatabaseExists = async () => {
    const postgresConfig = {
        ...dbConfig,
        database: 'postgres',
        port: dbConfig.port ? parseInt(dbConfig.port) : undefined
    };
    const client = new Client(postgresConfig as any);

    try {
        await client.connect();
        const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [targetDbName]);

        if (res.rowCount === 0) {
            logger.info(`Database "${targetDbName}" does not exist. Creating...`);
            await client.query(`CREATE DATABASE "${targetDbName}"`);
            logger.info(`Database "${targetDbName}" created successfully.`);
        }
    } catch (error: any) {
        logger.error(`Error ensuring database exists: ${error.message}`);
        throw error;
    } finally {
        await client.end();
    }
};

export const ensureTableExists = async () => {
    const createTableQuery = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE TABLE IF NOT EXISTS files (
        id UUID PRIMARY KEY,
        filename TEXT NOT NULL,
        local_path TEXT NOT NULL,
        bucket_key TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        retries INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        uploaded_at TIMESTAMP
    );
  `;

    const migrateQuery = `
    DO $$ 
    BEGIN 
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='retries') THEN
        ALTER TABLE files ADD COLUMN retries INT DEFAULT 0;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='uploaded_at') THEN
        ALTER TABLE files ADD COLUMN uploaded_at TIMESTAMP;
      END IF;
      ALTER TABLE files ALTER COLUMN local_path DROP NOT NULL;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
  `;

    try {
        await pool.query(createTableQuery);
        await pool.query(migrateQuery);
        logger.info('Database table "files" checked/migrated.');
    } catch (error: any) {
        logger.error(`Error ensuring table exists/migrated: ${error.message}`);
        throw error;
    }
};
