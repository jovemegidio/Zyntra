/**
 * ═══════════════════════════════════════════════════════════════
 * ALUFORCE ERP — Cloud Upload Service (S3 / MinIO / Local)
 * Abstração de storage: local → MinIO self-hosted → AWS S3
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Lazy-load AWS SDK (só quando necessário) ─────────────────
let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand;

function loadAwsSdk() {
    if (!S3Client) {
        try {
            const s3 = require('@aws-sdk/client-s3');
            S3Client = s3.S3Client;
            PutObjectCommand = s3.PutObjectCommand;
            GetObjectCommand = s3.GetObjectCommand;
            DeleteObjectCommand = s3.DeleteObjectCommand;
            HeadObjectCommand = s3.HeadObjectCommand;
        } catch (err) {
            console.warn('[upload-storage] @aws-sdk/client-s3 not installed — S3/MinIO disabled');
            return false;
        }
    }
    return true;
}

// ── Provider Detection ──────────────────────────────────────
function detectProvider() {
    if (process.env.MINIO_ENDPOINT) return 'minio';
    if (process.env.AWS_S3_BUCKET) return 's3';
    return 'local';
}

// ── S3-Compatible Client (works for both AWS S3 and MinIO) ──
function createS3Client() {
    if (!loadAwsSdk()) return null;

    const provider = detectProvider();

    if (provider === 'minio') {
        return new S3Client({
            endpoint: process.env.MINIO_ENDPOINT || 'http://minio:9000',
            region: process.env.MINIO_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.MINIO_ACCESS_KEY || 'aluforce',
                secretAccessKey: process.env.MINIO_SECRET_KEY || 'aluforce2024secret',
            },
            forcePathStyle: true, // Required for MinIO
        });
    }

    if (provider === 's3') {
        return new S3Client({
            region: process.env.AWS_REGION || 'sa-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
    }

    return null;
}

// ── Bucket Name ─────────────────────────────────────────────
function getBucket(customBucket) {
    return customBucket
        || process.env.AWS_S3_BUCKET
        || process.env.MINIO_BUCKET
        || 'aluforce-uploads';
}

// ── Generate unique key ─────────────────────────────────────
function generateKey(originalName, prefix = '') {
    const ext = path.extname(originalName);
    const hash = crypto.randomBytes(8).toString('hex');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const safeName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${prefix ? prefix + '/' : ''}${date}/${safeName}-${hash}${ext}`;
}

// ═════════════════════════════════════════════════════════════
// Upload Storage API
// ═════════════════════════════════════════════════════════════
class UploadStorage {
    constructor() {
        this.provider = detectProvider();
        this.s3 = null;
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        if (this.provider !== 'local') {
            this.s3 = createS3Client();
            if (!this.s3) {
                console.warn('[upload-storage] Falling back to local storage');
                this.provider = 'local';
            }
        }
        this._initialized = true;
        console.log(`[upload-storage] Provider: ${this.provider.toUpperCase()}`);
    }

    /**
     * Upload a file
     * @param {Buffer|ReadableStream} data - File content
     * @param {string} originalName - Original filename
     * @param {Object} options - { bucket, prefix, contentType, metadata }
     * @returns {Object} { key, url, provider, size }
     */
    async uploadFile(data, originalName, options = {}) {
        await this.init();

        const key = options.key || generateKey(originalName, options.prefix);
        const bucket = getBucket(options.bucket);
        const contentType = options.contentType || this._guessContentType(originalName);

        if (this.provider === 'local') {
            return this._uploadLocal(data, key, options);
        }

        // S3/MinIO upload
        const params = {
            Bucket: bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
            Metadata: options.metadata || {},
        };

        await this.s3.send(new PutObjectCommand(params));

        const url = this.provider === 'minio'
            ? `${process.env.MINIO_ENDPOINT || 'http://minio:9000'}/${bucket}/${key}`
            : `https://${bucket}.s3.${process.env.AWS_REGION || 'sa-east-1'}.amazonaws.com/${key}`;

        return {
            key,
            url,
            provider: this.provider,
            bucket,
            size: Buffer.isBuffer(data) ? data.length : null,
            contentType,
        };
    }

    /**
     * Get a signed/direct URL for downloading
     * @param {string} key - Object key
     * @param {Object} options - { bucket }
     * @returns {string} URL
     */
    async getFileUrl(key, options = {}) {
        await this.init();
        const bucket = getBucket(options.bucket);

        if (this.provider === 'local') {
            return `/uploads/${key}`;
        }

        if (this.provider === 'minio') {
            return `${process.env.MINIO_ENDPOINT || 'http://minio:9000'}/${bucket}/${key}`;
        }

        return `https://${bucket}.s3.${process.env.AWS_REGION || 'sa-east-1'}.amazonaws.com/${key}`;
    }

    /**
     * Delete a file
     * @param {string} key - Object key
     * @param {Object} options - { bucket }
     */
    async deleteFile(key, options = {}) {
        await this.init();
        const bucket = getBucket(options.bucket);

        if (this.provider === 'local') {
            return this._deleteLocal(key);
        }

        await this.s3.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
        }));

        return { deleted: true, key, provider: this.provider };
    }

    /**
     * Check if a file exists
     * @param {string} key - Object key
     * @param {Object} options - { bucket }
     * @returns {boolean}
     */
    async fileExists(key, options = {}) {
        await this.init();
        const bucket = getBucket(options.bucket);

        if (this.provider === 'local') {
            const fullPath = path.join(this._localDir(), key);
            return fs.existsSync(fullPath);
        }

        try {
            await this.s3.send(new HeadObjectCommand({
                Bucket: bucket,
                Key: key,
            }));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get file as a stream (for download proxy)
     * @param {string} key - Object key
     * @param {Object} options - { bucket }
     * @returns {ReadableStream|Buffer}
     */
    async getFileStream(key, options = {}) {
        await this.init();
        const bucket = getBucket(options.bucket);

        if (this.provider === 'local') {
            const fullPath = path.join(this._localDir(), key);
            if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${key}`);
            return fs.createReadStream(fullPath);
        }

        const res = await this.s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        }));

        return res.Body;
    }

    /**
     * Get storage stats
     */
    getStats() {
        return {
            provider: this.provider,
            bucket: getBucket(),
            initialized: this._initialized,
            s3Available: !!this.s3,
        };
    }

    // ── Private: Local Filesystem ────────────────────────────

    _localDir() {
        const dir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    _uploadLocal(data, key, options = {}) {
        const dir = this._localDir();
        const fullPath = path.join(dir, key);

        // Ensure subdirectory exists
        const subDir = path.dirname(fullPath);
        if (!fs.existsSync(subDir)) {
            fs.mkdirSync(subDir, { recursive: true });
        }

        if (Buffer.isBuffer(data)) {
            fs.writeFileSync(fullPath, data);
        } else if (data.pipe) {
            // Stream
            const ws = fs.createWriteStream(fullPath);
            data.pipe(ws);
            return new Promise((resolve, reject) => {
                ws.on('finish', () => resolve({
                    key,
                    url: `/uploads/${key}`,
                    provider: 'local',
                    size: fs.statSync(fullPath).size,
                }));
                ws.on('error', reject);
            });
        }

        return {
            key,
            url: `/uploads/${key}`,
            provider: 'local',
            size: Buffer.isBuffer(data) ? data.length : null,
        };
    }

    _deleteLocal(key) {
        const fullPath = path.join(this._localDir(), key);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        return { deleted: true, key, provider: 'local' };
    }

    _guessContentType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const map = {
            '.pdf': 'application/pdf',
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.csv': 'text/csv',
            '.txt': 'text/plain',
            '.zip': 'application/zip',
            '.xml': 'application/xml',
            '.json': 'application/json',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.mp4': 'video/mp4',
        };
        return map[ext] || 'application/octet-stream';
    }
}

// ── Singleton ────────────────────────────────────────────────
const uploadStorage = new UploadStorage();

module.exports = {
    uploadStorage,
    UploadStorage,
    generateKey,
    detectProvider,
};
