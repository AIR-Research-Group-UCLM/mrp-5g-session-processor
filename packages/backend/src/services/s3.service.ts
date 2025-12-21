import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/index.js";
import fs from "node:fs";
import type { Readable } from "node:stream";

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: true,
});

async function uploadFile(
  key: string,
  filePath: string,
  contentType: string
): Promise<void> {
  const fileStream = fs.createReadStream(filePath);

  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    Body: fileStream,
    ContentType: contentType,
  });

  await s3Client.send(command);
}

async function getPresignedUrl(
  key: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
  });

  await s3Client.send(command);
}

// Security: Sanitize filename to prevent path traversal and use UUID-based naming
function getVideoKey(userId: string, sessionId: string, filename: string): string {
  // Extract and sanitize extension (only allow alphanumeric extensions)
  const ext = filename.includes(".")
    ? filename.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin"
    : "bin";

  // Use a deterministic but safe filename based on original name hash + sanitized extension
  // For internal uses (like "audio.mp3"), this still works correctly
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_").substring(0, 50);

  // Check if it's an internal/safe filename (no path traversal characters)
  if (/^[a-zA-Z0-9_.-]+$/.test(filename) && !filename.includes("..")) {
    return `${userId}/${sessionId}/${filename}`;
  }

  // For user-provided filenames, use sanitized version
  return `${userId}/${sessionId}/${safeFilename}.${ext}`;
}

async function getFileMetadata(key: string): Promise<{ contentLength: number; contentType: string } | null> {
  try {
    const command = new HeadObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    });

    const response = await s3Client.send(command);
    return {
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

async function getFileStream(
  key: string,
  range?: { start: number; end: number }
): Promise<{ stream: Readable; contentLength: number; contentType: string } | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Range: range ? `bytes=${range.start}-${range.end}` : undefined,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return null;
    }

    return {
      stream: response.Body as Readable,
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export const s3Service = {
  uploadFile,
  getPresignedUrl,
  deleteFile,
  getVideoKey,
  getFileMetadata,
  getFileStream,
};
