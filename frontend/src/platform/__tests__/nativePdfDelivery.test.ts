import { Directory } from "@capacitor/filesystem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IosPdfDeliveryAdapter } from "../nativePdfDelivery";
import { resetNativeActivityForTests } from "../nativeActivity";

const file = {
  filename: "User Name-2026-08-10-to-2026-08-16.pdf",
  bytes: new Uint8Array([37, 80, 68, 70]).buffer,
};

afterEach(() => {
  resetNativeActivityForTests();
  vi.restoreAllMocks();
});

function ports() {
  const filesystem = {
    writeFile: vi.fn(async () => ({ uri: "file:///cache/report.pdf" })),
    deleteFile: vi.fn(async () => undefined),
  };
  const share = {
    share: vi.fn(async (_options: { title: string; url: string }) => ({
      activityType: "com.apple.UIKit.activity.SaveToFiles",
    })),
  };
  return { filesystem, share };
}

describe("iOS PDF delivery", () => {
  it("writes shared PDF bytes to Cache, shares the local URL, then cleans up", async () => {
    const { filesystem, share } = ports();
    await new IosPdfDeliveryAdapter(filesystem, share).deliver(file);

    expect(filesystem.writeFile).toHaveBeenCalledWith({
      path: file.filename,
      directory: Directory.Cache,
      data: "JVBERg==",
    });
    expect(filesystem.writeFile).toHaveBeenCalledOnce();
    expect(share.share).toHaveBeenCalledWith({
      title: file.filename,
      url: "file:///cache/report.pdf",
    });
    expect(share.share).toHaveBeenCalledOnce();
    expect(share.share.mock.calls[0]?.[0]).not.toHaveProperty("files");
    expect(Object.keys(share.share.mock.calls[0]?.[0] ?? {}).sort()).toEqual(["title", "url"]);
    expect(filesystem.deleteFile).toHaveBeenCalledWith({
      path: file.filename,
      directory: Directory.Cache,
    });
    expect(filesystem.deleteFile).toHaveBeenCalledOnce();
  });

  it("treats share-sheet cancellation as a normal outcome and still cleans up", async () => {
    const { filesystem, share } = ports();
    share.share.mockRejectedValueOnce(new Error("User cancelled share"));

    await expect(new IosPdfDeliveryAdapter(filesystem, share).deliver(file)).resolves.toBeUndefined();
    expect(filesystem.writeFile).toHaveBeenCalledOnce();
    expect(share.share).toHaveBeenCalledOnce();
    expect(filesystem.deleteFile).toHaveBeenCalledOnce();
  });

  it("surfaces write and share failures while cleaning up only a written file", async () => {
    const first = ports();
    first.filesystem.writeFile.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(new IosPdfDeliveryAdapter(first.filesystem, first.share).deliver(file)).rejects.toThrow("disk unavailable");
    expect(first.filesystem.writeFile).toHaveBeenCalledOnce();
    expect(first.share.share).not.toHaveBeenCalled();
    expect(first.filesystem.deleteFile).not.toHaveBeenCalled();

    const second = ports();
    second.share.share.mockRejectedValueOnce(new Error("share failed"));
    await expect(new IosPdfDeliveryAdapter(second.filesystem, second.share).deliver(file)).rejects.toThrow("share failed");
    expect(second.filesystem.writeFile).toHaveBeenCalledOnce();
    expect(second.share.share).toHaveBeenCalledOnce();
    expect(second.filesystem.deleteFile).toHaveBeenCalledOnce();
  });

  it("does not alarm the user when cache cleanup alone fails", async () => {
    const { filesystem, share } = ports();
    filesystem.deleteFile.mockRejectedValueOnce(new Error("already removed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(new IosPdfDeliveryAdapter(filesystem, share).deliver(file)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
