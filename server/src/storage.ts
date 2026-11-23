import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageInterface {
  putPrivateDocument(key: string, body: Buffer, contentType: string): Promise<string>;
  privateDocumentUrl(key: string): Promise<string>;
  storageConfigured(): boolean;
  getPrivateDocument?(key: string): Promise<{ body: Buffer; contentType: string }>;
}

const required = ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY'] as const;
export const storageConfigured = () => required.every(key => Boolean(process.env[key]));

export async function putPrivateDocument(key: string, body: Buffer, contentType: string) { if (!storageConfigured()) throw new Error('Private object storage is not configured'); const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } }); await client.send(new PutObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' })); return key; }

export async function privateDocumentExists(key: string) {
  if (!storageConfigured()) return false;
  const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } });
  try { await client.send(new HeadObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key })); return true; } catch { return false; }
}

export async function privateDocumentUrl(key: string) {
  if (!storageConfigured()) throw new Error('Private object storage is not configured');
  const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } });
  return getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key }), { expiresIn: 60 });
}

// Server-side read of a private object, used to send registered candidate
// photos to the AI service for check-in identification. Never exposed to clients.
export async function getPrivateDocument(key: string) {
  if (!storageConfigured()) throw new Error('Private object storage is not configured');
  const client = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION || 'auto', credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY! } });
  const object = await client.send(new GetObjectCommand({ Bucket: process.env.OBJECT_STORAGE_BUCKET!, Key: key }));
  if (!object.Body) throw new Error('Private object is empty');
  return { body: Buffer.from(await object.Body.transformToByteArray()), contentType: object.ContentType ?? 'application/octet-stream' };
}

export const realStorage: StorageInterface = {
  putPrivateDocument,
  privateDocumentUrl,
  storageConfigured,
  getPrivateDocument
};
