import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import type { RequestHandler } from "express";
import { fileTypeFromFile } from "file-type";
import { AppError } from "./error.middleware.js";

const UPLOAD_DIR = "./uploads";
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_MIMETYPES = [
  // Video formats
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  // Audio formats
  "audio/mpeg", // mp3
  "audio/mp4", // m4a
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
];

// Map file-type detected MIME types to our allowed types
// Some file-type detections may differ slightly from browser-reported types
const ALLOWED_MAGIC_MIMETYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/aac",
]);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(400, `Invalid file type. Allowed: ${ALLOWED_MIMETYPES.join(", ")}`));
  }
};

const multerUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

// Security: Validate file magic bytes after upload to prevent MIME type spoofing
export const validateMagicBytes: RequestHandler = async (req, _res, next) => {
  try {
    const file = req.file;
    if (!file) {
      return next();
    }

    const fileType = await fileTypeFromFile(file.path);

    // Some files (like WAV) may not be detected by file-type
    // In that case, trust the extension if it's an allowed audio format
    if (!fileType) {
      const ext = path.extname(file.originalname).toLowerCase();
      if ([".wav", ".ogg"].includes(ext)) {
        return next();
      }
      // Clean up and reject unknown file types
      await fsPromises.unlink(file.path);
      return next(new AppError(400, "Could not verify file type. Please use a supported format."));
    }

    // Check if detected MIME type is allowed
    if (!ALLOWED_MAGIC_MIMETYPES.has(fileType.mime)) {
      // Clean up the uploaded file
      await fsPromises.unlink(file.path);
      return next(
        new AppError(
          400,
          `File content does not match a supported media format. Detected: ${fileType.mime}`
        )
      );
    }

    next();
  } catch (error) {
    // Clean up file on error
    if (req.file?.path) {
      await fsPromises.unlink(req.file.path).catch(() => {});
    }
    next(error);
  }
};

// Export combined middleware
export const uploadMiddleware = {
  single: (fieldName: string) => [
    multerUpload.single(fieldName),
    validateMagicBytes,
  ],
};
