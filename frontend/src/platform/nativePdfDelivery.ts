import { Directory, Filesystem, type WriteFileResult } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { GeneratedPdfFile, PdfDeliveryAdapter } from "./pdfDelivery";
import { duringNativeActivity } from "./nativeActivity";

export interface NativeFilesystemPort {
  writeFile(options: { path: string; data: string; directory: Directory }): Promise<WriteFileResult>;
  deleteFile(options: { path: string; directory: Directory }): Promise<void>;
}

export interface NativeSharePort {
  share(options: { title: string; url: string; files: string[] }): Promise<unknown>;
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function isShareCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cancel(?:led|ed)?|user did not share|activity.*dismiss/i.test(message);
}

export class IosPdfDeliveryAdapter implements PdfDeliveryAdapter {
  constructor(
    private readonly filesystem: NativeFilesystemPort = Filesystem,
    private readonly share: NativeSharePort = Share
  ) {}

  async deliver(file: GeneratedPdfFile): Promise<void> {
    const temporaryPath = file.filename;
    let written = false;
    let primaryError: unknown;

    try {
      const result = await this.filesystem.writeFile({
        path: temporaryPath,
        directory: Directory.Cache,
        data: toBase64(file.bytes),
      });
      written = true;
      await duringNativeActivity(() =>
        this.share.share({ title: file.filename, url: result.uri, files: [result.uri] })
      );
    } catch (error) {
      if (!(written && isShareCancellation(error))) primaryError = error;
    } finally {
      if (written) {
        try {
          await this.filesystem.deleteFile({ path: temporaryPath, directory: Directory.Cache });
        } catch (cleanupError) {
          // Cache is OS-managed. A cleanup failure must be observable to
          // developers, but must not turn a successful share into a scary
          // user-facing failure.
          console.warn("Could not remove temporary shared PDF", cleanupError);
        }
      }
    }

    if (primaryError) throw primaryError;
  }
}
