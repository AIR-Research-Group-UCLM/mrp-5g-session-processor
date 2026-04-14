import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { createInflateRaw } from "node:zlib";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
]);

export function isSupportedMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType);
}

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

function extractFileFromZip(zipBuffer: Buffer, targetFile: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let offset = 0;

    while (offset < zipBuffer.length - 4) {
      const sig = zipBuffer.readUInt32LE(offset);
      if (sig !== 0x04034b50) break;

      const compMethod = zipBuffer.readUInt16LE(offset + 8);
      const compSize = zipBuffer.readUInt32LE(offset + 18);
      const nameLen = zipBuffer.readUInt16LE(offset + 26);
      const extraLen = zipBuffer.readUInt16LE(offset + 28);
      const name = zipBuffer.subarray(offset + 30, offset + 30 + nameLen).toString("utf-8");
      const dataStart = offset + 30 + nameLen + extraLen;

      if (name === targetFile) {
        const rawData = zipBuffer.subarray(dataStart, dataStart + compSize);

        if (compMethod === 0) {
          resolve(rawData.toString("utf-8"));
          return;
        }

        if (compMethod === 8) {
          const inflate = createInflateRaw();
          const chunks: Buffer[] = [];
          inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
          inflate.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
          inflate.on("error", (err) => reject(err));
          inflate.end(rawData);
          return;
        }
      }

      offset = dataStart + compSize;
    }

    resolve(null);
  });
}

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "application/pdf":
      return extractTextFromPdf(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractTextFromDocx(buffer);
    case "application/vnd.oasis.opendocument.text":
      return extractTextFromOdt(buffer);
    default:
      throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
}
