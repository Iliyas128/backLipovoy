import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const bucket = process.env.AWS_BUCKET_NAME;
const region = process.env.AWS_REGION || "eu-north-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY;

export const s3Enabled = Boolean(bucket && accessKeyId && secretAccessKey);

const client = s3Enabled
  ? new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    })
  : null;

function extFromMime(mime) {
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return map[mime] || "bin";
}

export function publicUrl(key) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export async function uploadBuffer(buffer, mime, folder = "uploads") {
  if (!s3Enabled || !client) {
    throw new Error("S3 is not configured");
  }

  const ext = extFromMime(mime);
  const key = `${folder}/${Date.now()}-${randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mime,
    }),
  );

  return publicUrl(key);
}

export async function uploadDataUrl(dataUrl, folder = "uploads") {
  if (!dataUrl || typeof dataUrl !== "string") return dataUrl;
  if (!dataUrl.startsWith("data:")) return dataUrl;

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUrl;

  const [, mime, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  return uploadBuffer(buffer, mime, folder);
}

export async function persistValue(value, folder) {
  if (!value || typeof value !== "string") return value;
  if (!value.startsWith("data:")) return value;
  if (!s3Enabled) throw new Error("S3 is not configured");
  return uploadDataUrl(value, folder);
}
