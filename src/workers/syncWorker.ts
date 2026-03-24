import { config } from '../config/config';
import { logger } from '../logger';
import { sftpService } from '../services/sftpService';
import { uploadService } from '../services/uploadService';
import { fileRepository } from '../repositories/fileRepository';
import { externalApiService } from '../services/externalApiService';
import * as mm from 'music-metadata';

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

                        // Notify external API
                        await this.notifyExternalApi(file.name, file.fullPath, bucketKey, buffer);
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

                    // Notify external API on retry
                    await this.notifyExternalApi(file.filename, match.fullPath, file.bucket_key, buffer);
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

    private parseAudioSourceAndMetadata(filename: string, fullPath: string) {
        const isFive9 = fullPath.toLowerCase().includes('/recordings/') || fullPath.toLowerCase().includes('\\recordings\\');
        const source = isFive9 ? 'FIVE9' : 'GO_CONTACT';
        let agentName = 'System';
        let customerPhone = 'Unknown';

        if (isFive9) {
            // Five9: {UUID}_{Campaign}_{Email}_{Phone}_{Time}
            // Example: 1F936F6A514F447FB74DB59B59FBF67A_Sba Empresarial PT200000000009472_gaspar.antonio@ucall.co.ao_+244954384232_12_45_33 PM
            const parts = filename.split('_');
            if (parts.length >= 4) {
                // Agent is usually the 2nd part or 3rd if Campaign has spaces (but split by _ should handle)
                // Let's find parts that look like email and phone
                const emailPart = parts.find(p => p.includes('@'));
                const phonePart = parts.find(p => p.startsWith('+'));
                if (emailPart) agentName = emailPart;
                if (phonePart) customerPhone = phonePart;
            }
        } else {
            // GoContact: Call_DD_MM_YYYY_UUID_..._Agent_{AgentName}_segmentID_...
            // Example: Call_02_01_2026_UUID_0f6b7dab-e1bd-4fb5-8398-d6708afa86ba_Agent_Elopes_segmentID_610
            const agentMatch = filename.match(/_Agent_([^_]+)/);
            if (agentMatch) {
                agentName = agentMatch[1];
            }
        }

        return { source, agentName, customerPhone };
    }

    private async notifyExternalApi(filename: string, fullPath: string, bucketKey: string, buffer: Buffer) {
        const { source, agentName, customerPhone } = this.parseAudioSourceAndMetadata(filename, fullPath);
        let duration = 0;

        try {
            const metadata = await mm.parseBuffer(buffer);
            duration = Math.round(metadata.format.duration || 0);
        } catch (error: any) {
            logger.warn(`Could not extract duration for ${filename}: ${error.message}`);
        }

        try {
            await externalApiService.notifyAudio({
                filename: filename,
                source: source,
                agentName: agentName,
                customerPhone: customerPhone,
                duration: duration,
                wasabiUrl: `${config.wasabi.endpoint}/${config.wasabi.bucket}/${bucketKey}`,
                fileSize: buffer.length,
                status: 'pending'
            });
        } catch (error: any) {
            logger.error(`External notification failed for ${filename}: ${error.message}`);
        }
    }
}

export const syncWorker = new SyncWorker();
