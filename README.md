# AudioSyncService

Production-ready Node.js service to synchronize audio files from an SFTP server to Wasabi S3-compatible storage.

## Features

- **Robust SFTP Resilience**: Automatic retries and keepalive for unstable connections.
- **Batched Processing**: Downloads and uploads files in cycles to manage resources.
- **Postgres Tracking**: Full audit trail of file status, upload timestamps, and retries.
- **Production Logging**: Structured JSON logging via Pino (with pino-pretty for development).
- **Graceful Shutdown**: Handles `SIGINT` and `SIGTERM` to close database and SFTP connections safely.
- **Automatic DB Setup**: Creates the database and tables on startup if missing.

## Prerequisites

- Node.js (v16+)
- PostgreSQL
- SFTP Server access
- Wasabi S3 Bucket and Credentials

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment template and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

## Configuration

Edit the `.env` file:

- `SFTP_*`: Your SFTP server details.
- `DATABASE_URL`: PostgreSQL connection string.
- `WASABI_*`: Wasabi storage credentials and bucket.
- `SYNC_INTERVAL_SECONDS`: How often to run the sync cycle (default 60s).

## Running the Service

### Development
```bash
npx ts-node src/index.ts
```

### Production
Build the project first:
```bash
npm run build
npm start
```

## Folder Structure

- `src/config/`: Configuration and environment validation.
- `src/repositories/`: Database abstraction layer.
- `src/services/`: External service integrations (SFTP, S3).
- `src/workers/`: Orchestration and processing logic.
- `src/logger.ts`: Centralized logging.
- `src/db.ts`: Database pool and initialization.
