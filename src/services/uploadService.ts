import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/config';
import { logger } from '../logger';

export class UploadService {
    private s3Client: S3Client;

    constructor() {
        this.s3Client = new S3Client({
            endpoint: config.wasabi.endpoint,
            region: config.wasabi.region,
            credentials: {
                accessKeyId: config.wasabi.accessKey,
                secretAccessKey: config.wasabi.secretKey,
            },
            forcePathStyle: true,
        });
    }

    generateBucketKey(remotePath: string): string {
        // remotePath: files/Gocontact/Operation/Type/Name/Month/Day/file.mp3
        // base: files/Gocontact
        const base = config.sftp.remoteDir.replace(/\/$/, '');
        const relativePath = remotePath.replace(base, '').replace(/^\//, '');

        // Structure: calls/{operation}/{segmentType}/{segmentName}/{month}/{day}/{filename}
        return `calls/${relativePath}`;
    }

    async uploadFile(data: Buffer, bucketKey: string): Promise<void> {
        try {
            const command = new PutObjectCommand({
                Bucket: config.wasabi.bucket,
                Key: bucketKey,
                Body: data,
            });

            logger.info(`Uploading to Wasabi: ${bucketKey}`);
            await this.s3Client.send(command);
        } catch (error: any) {
            logger.error(`Wasabi upload failed for ${bucketKey}: ${error.message}`);
            throw error;
        }
    }
}

export const uploadService = new UploadService();
