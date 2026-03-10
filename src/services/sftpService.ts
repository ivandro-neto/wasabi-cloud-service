import Client from 'ssh2-sftp-client';
import path from 'path';
import fs from 'fs-extra';
import { config } from '../config/config';
import { logger } from '../logger';

export class SftpService {
    private sftp: Client | null = null;

    private async sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async connect() {
        let retries = 3;
        while (retries > 0) {
            try {
                if (this.sftp) {
                    try { await this.sftp.end(); } catch (e) { }
                }
                this.sftp = new Client();

                this.sftp.on('error', (err: any) => {
                    logger.error(`[SFTP Instance Error]: ${err.message}`);
                });

                logger.info(`Attempting to connect to SFTP ${config.sftp.host} (Retries left: ${retries - 1})`);
                await this.sftp.connect({
                    host: config.sftp.host,
                    port: config.sftp.port,
                    username: config.sftp.username,
                    password: config.sftp.password,
                    readyTimeout: 30000,
                    keepaliveInterval: 5000,
                });
                logger.info('SFTP connected successfully.');
                return;
            } catch (error: any) {
                retries--;
                logger.error(`SFTP connection failed: ${error.message}`);
                if (retries === 0) throw error;
                await this.sleep(2000);
            }
        }
    }

    async listFilesRecursive(remoteDir: string): Promise<{ name: string; fullPath: string }[]> {
        if (!this.sftp) await this.connect();

        let allFiles: { name: string; fullPath: string }[] = [];

        const walk = async (dir: string) => {
            logger.info(`Entering SFTP directory: ${dir}`);
            let listRetries = 2;
            while (listRetries > 0) {
                try {
                    const list = await this.sftp!.list(dir);
                    for (const item of list) {
                        if (item.name === '.' || item.name === '..') continue;

                        const fullPath = path.posix.join(dir, item.name);
                        if (item.type === 'd') {
                            await walk(fullPath);
                        } else if (item.type === '-' && /\.(wav|mp3)$/i.test(item.name)) {
                            allFiles.push({ name: item.name, fullPath });
                        }
                    }
                    return;
                } catch (error: any) {
                    listRetries--;
                    logger.error(`SFTP list failed for ${dir}: ${error.message}`);
                    if (listRetries === 0) throw error;
                    await this.sleep(1000);
                    if (error.message.includes('ECONNRESET') || error.message.includes('lost')) {
                        await this.connect();
                    }
                }
            }
        };

        try {
            await walk(remoteDir);
            logger.info(`Found ${allFiles.length} audio files in ${remoteDir} (recursive).`);
            return allFiles;
        } catch (error: any) {
            logger.error(`Recursive listing failed: ${error.message}`);
            return allFiles; // Return what we found so far
        }
    }

    async getFileBuffer(remotePath: string): Promise<Buffer> {
        if (!this.sftp) await this.connect();

        try {
            logger.info(`Fetching ${remotePath} from SFTP...`);
            const buffer = await this.sftp!.get(remotePath);
            return buffer as Buffer;
        } catch (error: any) {
            logger.error(`Error fetching ${remotePath} from SFTP: ${error.message}`);
            throw error;
        }
    }

    async close() {
        if (this.sftp) {
            try {
                await this.sftp.end();
                logger.info('SFTP connection closed.');
            } catch (e: any) {
                logger.error(`Error closing SFTP: ${e.message}`);
            }
            this.sftp = null;
        }
    }
}

export const sftpService = new SftpService();
