import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { createInflateRaw } from "node:zlib";
import { DOCUMENT_MIME_TYPES } from "@mrp/shared";

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await pdf.getText();
    return result.text.trim();
  } finally {
    await pdf.destroy();
  }
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function extractTextFromOdt(buffer: Buffer): Promise<string> {
  const contentXml = await extractFileFromZip(buffer, "content.xml");
  if (!contentXml) {
    throw new Error("Invalid ODT file: content.xml not found");
  }

  return stripOdtXml(contentXml);
}

function stripOdtXml(xml: string): string {
  return xml
    .replace(/<text:p[^>]*\/>/g, "\n")
    .replace(/<text:p[^>]*>/g, "\n")
    .replace(/<text:tab[^>]*\/?>/g, "\t")
    .replace(/<text:line-break[^>]*\/?>/g, "\n")
    .replace(/<text:s[^>]*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;

function findEndOfCentralDirectory(zipBuffer: Buffer): number {
  const minEocdSize = 22;
  const maxCommentSize = 0xffff;
  const searchStart = Math.max(0, zipBuffer.length - minEocdSize - maxCommentSize);

  for (let i = zipBuffer.length - minEocdSize; i >= searchStart; i--) {
    if (zipBuffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }

  return -1;
}

function inflateRaw(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw();
    const chunks: Buffer[] = [];
    inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
    inflate.on("end", () => resolve(Buffer.concat(chunks)));
    inflate.on("error", reject);
    inflate.end(data);
  });
}

async function extractFileFromZip(
  zipBuffer: Buffer,
  targetFile: string,
): Promise<string | null> {
  const eocdOffset = findEndOfCentralDirectory(zipBuffer);
  if (eocdOffset === -1) {
    return null;
  }

  const cdEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let cdPtr = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (zipBuffer.readUInt32LE(cdPtr) !== CENTRAL_DIR_SIGNATURE) {
      return null;
    }

    const compMethod = zipBuffer.readUInt16LE(cdPtr + 10);
    const compSize = zipBuffer.readUInt32LE(cdPtr + 20);
    const nameLen = zipBuffer.readUInt16LE(cdPtr + 28);
    const extraLen = zipBuffer.readUInt16LE(cdPtr + 30);
    const commentLen = zipBuffer.readUInt16LE(cdPtr + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cdPtr + 42);
    const name = zipBuffer.subarray(cdPtr + 46, cdPtr + 46 + nameLen).toString("utf-8");

    if (name === targetFile) {
      const lfNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const lfExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfNameLen + lfExtraLen;
      const rawData = zipBuffer.subarray(dataStart, dataStart + compSize);

      if (compMethod === 0) {
        return rawData.toString("utf-8");
      }
      if (compMethod === 8) {
        const inflated = await inflateRaw(rawData);
        return inflated.toString("utf-8");
      }
      return null;
    }

    cdPtr += 46 + nameLen + extraLen + commentLen;
  }

  return null;
}

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case DOCUMENT_MIME_TYPES.pdf:
      return extractTextFromPdf(buffer);
    case DOCUMENT_MIME_TYPES.docx:
      return extractTextFromDocx(buffer);
    case DOCUMENT_MIME_TYPES.odt:
      return extractTextFromOdt(buffer);
    default:
      throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
}
