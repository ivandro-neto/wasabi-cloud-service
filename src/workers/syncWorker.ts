import { config } from '../config/config';
import { logger } from '../logger';
import { sftpService } from '../services/sftpService';
import { uploadService } from '../services/uploadService';
import { fileRepository } from '../repositories/fileRepository';

export class SyncWorker {
    private isProcessing = false;

    async runSyncCycle() {
        if (this.isProcessing) {
            logger.warn('Previous sync cycle is still running. Skipping...');
            return;
        }

        this.isProcessing = true;
        logger.info('--- Direct Sync Cycle Started ---');

        try {
            const allRemoteFiles = await sftpService.listFilesRecursive(config.sftp.remoteDir);

            // 1. Process New Files from SFTP
            await this.processNewSftpFiles(allRemoteFiles);

            // 2. Process Failed/Pending Retries
            await this.retryPendingUploads(allRemoteFiles);

        } catch (error: any) {
            logger.error(`Sync cycle error: ${error.message}`);
        } finally {
            this.isProcessing = false;
            await sftpService.close();
            logger.info('--- Direct Sync Cycle Finished ---');
        }
    }

    private async processNewSftpFiles(remoteFiles: { name: string; fullPath: string }[]) {
        try {
            for (const file of remoteFiles) {
                // Check if already in DB
                const existing = await fileRepository.getFileByFilename(file.name);
                if (existing) continue;

                const bucketKey = uploadService.generateBucketKey(file.fullPath);

                try {
                    const buffer = await sftpService.getFileBuffer(file.fullPath);
                    await uploadService.uploadFile(buffer, bucketKey);

                    await fileRepository.registerFile(file.name, '', bucketKey);
                    const record = await fileRepository.getFileByFilename(file.name);
                    if (record) {
                        await fileRepository.updateStatus(record.id, 'uploaded', new Date());
                    }
                    logger.info(`Successfully transferred: ${file.fullPath} -> ${bucketKey}`);
                } catch (error: any) {
                    logger.error(`Failed direct transfer for ${file.name}: ${error.message}`);
                    await fileRepository.registerFile(file.name, '', bucketKey);
                    const record = await fileRepository.getFileByFilename(file.name);
                    if (record) await fileRepository.incrementRetries(record.id);
                }
            }
        } catch (error: any) {
            logger.error(`SFTP processing phase failed: ${error.message}`);
        }
    }

    private async retryPendingUploads(allRemote: { name: string; fullPath: string }[]) {
        try {
            const pendingFiles = await fileRepository.getPendingFiles(20);
            logger.info(`Retrying ${pendingFiles.length} pending files.`);

            for (const file of pendingFiles) {
                try {
                    // Note: In a production system, we'd store the full remote path in the DB
                    // if filenames aren't globally unique across folders.
                    // For now, we'll try to find it again or assume filenames are unique identifiers.
                    // IF filenames are NOT unique, we need to add 'remote_path' column to DB.

                    const match = allRemote.find(f => f.name === file.filename);

                    if (!match) {
                        logger.error(`Retry failed: File ${file.filename} no longer found on SFTP.`);
                        await fileRepository.incrementRetries(file.id);
                        continue;
                    }

                    const buffer = await sftpService.getFileBuffer(match.fullPath);
                    await uploadService.uploadFile(buffer, file.bucket_key);

                    await fileRepository.updateStatus(file.id, 'uploaded', new Date());
                    logger.info(`Successfully retried: ${file.filename}`);
                } catch (error: any) {
                    logger.error(`Retry failed for ${file.filename}: ${error.message}`);
                    await fileRepository.incrementRetries(file.id);
                }
            }
        } catch (error: any) {
            logger.error(`Retry phase failed: ${error.message}`);
        }
    }
}

export const syncWorker = new SyncWorker();
