import dotenv from 'dotenv';
import { logger } from '../logger';

dotenv.config();

export const config = {
    sftp: {
        host: process.env.SFTP_HOST || '',
        port: parseInt(process.env.SFTP_PORT || '22'),
        username: process.env.SFTP_USERNAME || '',
        password: process.env.SFTP_PASSWORD || '',
        remoteDir: process.env.SFTP_REMOTE_DIR || '/',
    },
    db: {
        url: process.env.DATABASE_URL || '',
        ssl: process.env.DB_SSL === 'true',
    },
    wasabi: {
        endpoint: process.env.WASABI_ENDPOINT || 'https://s3.wasabisys.com',
        region: process.env.WASABI_REGION || 'us-east-1',
        accessKey: process.env.WASABI_ACCESS_KEY || '',
        secretKey: process.env.WASABI_SECRET_KEY || '',
        bucket: process.env.WASABI_BUCKET || '',
    },
    local: {
        downloadDir: process.env.LOCAL_DOWNLOAD_DIR || 'temp_audio',
        uploadedDir: process.env.LOCAL_UPLOADED_DIR || 'uploaded_audio',
    },
    sync: {
        intervalSeconds: parseInt(process.env.SYNC_INTERVAL_SECONDS || '60'),
    },
};

// Simple validation
const validateConfig = () => {
    const missing = [];
    if (!config.sftp.host) missing.push('SFTP_HOST');
    if (!config.db.url) missing.push('DATABASE_URL');
    if (!config.wasabi.accessKey) missing.push('WASABI_ACCESS_KEY');
    if (!config.wasabi.secretKey) missing.push('WASABI_SECRET_KEY');
    if (!config.wasabi.bucket) missing.push('WASABI_BUCKET');

    if (missing.length > 0) {
        logger.error(`Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
};

validateConfig();
