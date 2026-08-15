export interface GeneratedPdfFile {
  filename: string;
  bytes: ArrayBuffer;
}

export interface PdfDeliveryAdapter {
  deliver(file: GeneratedPdfFile): Promise<void>;
}

export const PDF_OBJECT_URL_REVOKE_DELAY_MS = 1_000;

/** Browser delivery stays separate from report creation. A future native
 * adapter can write these same bytes to the device and open the share sheet
 * without changing report calculations or layout code. */
export class WebPdfDeliveryAdapter implements PdfDeliveryAdapter {
  async deliver(file: GeneratedPdfFile): Promise<void> {
    const blob = new Blob([file.bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.style.display = "none";
    try {
      document.body.appendChild(link);
      link.click();
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    } finally {
      link.remove();
    }

    // Safari (including installed iPhone PWAs) may not have consumed the
    // object URL by the time click() returns. Keep it alive briefly, then
    // release it without making callers wait for the cleanup timer.
    setTimeout(() => URL.revokeObjectURL(url), PDF_OBJECT_URL_REVOKE_DELAY_MS);
  }
}

export const webPdfDelivery = new WebPdfDeliveryAdapter();

let activePdfDelivery: PdfDeliveryAdapter = webPdfDelivery;

/** Native startup swaps only the delivery mechanism. PDF layout, calculations,
 * bytes and filenames remain shared with the browser build. */
export function configurePdfDelivery(adapter: PdfDeliveryAdapter): void {
  activePdfDelivery = adapter;
}

export function getPdfDelivery(): PdfDeliveryAdapter {
  return activePdfDelivery;
}
