import { config } from './config/config';
import { logger } from './logger';
import { ensureDatabaseExists, ensureTableExists, pool } from './db';
import { syncWorker } from './workers/syncWorker';

const start = async () => {
    logger.info('Starting AudioSyncService...');

    try {
        // Initialize DB
        await ensureDatabaseExists();
        await ensureTableExists();

        // Start Loop
        runCycle();

        const interval = config.sync.intervalSeconds * 1000;
        const timer = setInterval(runCycle, interval);

        // Graceful Shutdown
        const shutdown = async () => {
            logger.info('Shutting down gracefully...');
            clearInterval(timer);
            await pool.end();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (error: any) {
        logger.error(`Service failed to start: ${error.message}`);
        process.exit(1);
    }
};

const runCycle = () => {
    syncWorker.runSyncCycle().catch(err => {
        logger.error(`Unexpected worker error: ${err.message}`);
    });
};

start();
