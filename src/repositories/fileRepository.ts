import { pool } from '../db';
import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';

export interface FileRecord {
    id: string;
    filename: string;
    local_path: string;
    bucket_key: string;
    status: 'pending' | 'uploaded' | 'failed';
    retries: number;
    created_at: Date;
    uploaded_at?: Date;
}

export class FileRepository {
    async registerFile(filename: string, localPath: string = '', bucketKey: string): Promise<FileRecord> {
        const id = uuidv4();
        const query = `
      INSERT INTO files (id, filename, local_path, bucket_key, status, retries)
      VALUES ($1, $2, $3, $4, 'pending', 0)
      RETURNING *;
    `;
        const values = [id, filename, localPath, bucketKey];
        try {
            const { rows } = await pool.query(query, values);
            return rows[0];
        } catch (error: any) {
            logger.error(`Error registering file ${filename}: ${error.message}`);
            throw error;
        }
    }

    async getFileByFilename(filename: string): Promise<FileRecord | null> {
        const query = 'SELECT * FROM files WHERE filename = $1';
        const { rows } = await pool.query(query, [filename]);
        return rows.length > 0 ? rows[0] : null;
    }

    async getPendingFiles(limit: number = 50): Promise<FileRecord[]> {
        const query = `
      SELECT * FROM files 
      WHERE status = 'pending' 
      AND retries < 3 
      ORDER BY created_at ASC
      LIMIT $1;
    `;
        const { rows } = await pool.query(query, [limit]);
        return rows;
    }

    async updateStatus(id: string, status: 'uploaded' | 'failed', uploadedAt?: Date): Promise<void> {
        const query = `
      UPDATE files 
      SET status = $1, uploaded_at = $2 
      WHERE id = $3;
    `;
        await pool.query(query, [status, uploadedAt || null, id]);
    }

    async incrementRetries(id: string): Promise<void> {
        const query = `
      UPDATE files 
      SET retries = retries + 1, 
          status = CASE WHEN retries + 1 >= 3 THEN 'failed' ELSE 'pending' END
      WHERE id = $1;
    `;
        await pool.query(query, [id]);
    }
}

export const fileRepository = new FileRepository();
