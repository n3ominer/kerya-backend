import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import { extname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

@Injectable()
export class StorageService {
  private readonly driver: string;
  private s3: AWS.S3 | null = null;
  private bucket: string;

  constructor(private readonly config: ConfigService) {
    this.driver = config.get<string>('STORAGE_DRIVER', 'local');
    this.bucket = config.get<string>('S3_BUCKET', '');

    if (this.driver === 's3') {
      this.s3 = new AWS.S3({
        endpoint: config.get<string>('S3_ENDPOINT'),
        accessKeyId: config.get<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.get<string>('S3_SECRET_KEY'),
        region: config.get<string>('S3_REGION', 'auto'),
        signatureVersion: 'v4',
        s3ForcePathStyle: true,
      });
    }
  }

  async upload(buffer: Buffer, folder: string, originalName: string): Promise<string> {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = extname(originalName);
    const filename = `${unique}${ext}`;

    if (this.driver === 's3') {
      return this.uploadS3(buffer, `${folder}/${filename}`);
    }
    return this.uploadLocal(buffer, folder, filename);
  }

  private async uploadS3(buffer: Buffer, key: string): Promise<string> {
    await this.s3!.putObject({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: this.mimeFromKey(key),
    }).promise();

    const endpoint = this.config.get<string>('S3_ENDPOINT', '');
    const publicUrl = this.config.get<string>('S3_PUBLIC_URL', '');
    if (publicUrl) return `${publicUrl.replace(/\/$/, '')}/${key}`;
    return `${endpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
  }

  private uploadLocal(buffer: Buffer, folder: string, filename: string): string {
    const dir = join(process.cwd(), 'uploads', folder);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), buffer);
    return `/uploads/${folder}/${filename}`;
  }

  private mimeFromKey(key: string): string {
    const ext = extname(key).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    return map[ext] ?? 'application/octet-stream';
  }
}
