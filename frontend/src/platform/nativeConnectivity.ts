import { Network, type ConnectionStatus } from "@capacitor/network";
import type { ConnectivityAdapter, ConnectivityStatus, RemovableListener } from "./connectivity";

export class NativeConnectivityAdapter implements ConnectivityAdapter {
  async getStatus(): Promise<ConnectivityStatus> {
    const status = await Network.getStatus();
    return { connected: status.connected };
  }

  async addListener(listener: (status: ConnectivityStatus) => void): Promise<RemovableListener> {
    return Network.addListener("networkStatusChange", (status: ConnectionStatus) => {
      listener({ connected: status.connected });
    });
  }
}
