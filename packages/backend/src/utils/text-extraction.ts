import { parseOffice } from "officeparser";
import { DOCUMENT_MIME_TYPE_LIST, type DocumentMimeType } from "@mrp/shared";

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (!(DOCUMENT_MIME_TYPE_LIST as readonly string[]).includes(mimeType)) {
    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }

  const ast = await parseOffice(buffer);
  return ast.toText().trim();
}

export type { DocumentMimeType };
