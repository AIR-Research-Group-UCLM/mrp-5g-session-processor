export const DOCUMENT_MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
} as const;

export type DocumentMimeType =
  (typeof DOCUMENT_MIME_TYPES)[keyof typeof DOCUMENT_MIME_TYPES];

export const DOCUMENT_MIME_TYPE_LIST: readonly DocumentMimeType[] = [
  DOCUMENT_MIME_TYPES.pdf,
  DOCUMENT_MIME_TYPES.docx,
  DOCUMENT_MIME_TYPES.odt,
];
