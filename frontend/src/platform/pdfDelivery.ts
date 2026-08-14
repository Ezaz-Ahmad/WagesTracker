export interface GeneratedPdfFile {
  filename: string;
  bytes: ArrayBuffer;
}

export interface PdfDeliveryAdapter {
  deliver(file: GeneratedPdfFile): Promise<void>;
}

/** Browser delivery stays separate from report creation. A future native
 * adapter can write these same bytes to the device and open the share sheet
 * without changing report calculations or layout code. */
export class WebPdfDeliveryAdapter implements PdfDeliveryAdapter {
  async deliver(file: GeneratedPdfFile): Promise<void> {
    const blob = new Blob([file.bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export const webPdfDelivery = new WebPdfDeliveryAdapter();
