export interface ConnectivityStatus {
  connected: boolean;
}

export interface RemovableListener {
  remove(): Promise<void> | void;
}

export interface ConnectivityAdapter {
  getStatus(): Promise<ConnectivityStatus>;
  addListener(listener: (status: ConnectivityStatus) => void): Promise<RemovableListener>;
}

class WebConnectivityAdapter implements ConnectivityAdapter {
  async getStatus(): Promise<ConnectivityStatus> {
    return { connected: navigator.onLine };
  }

  async addListener(listener: (status: ConnectivityStatus) => void): Promise<RemovableListener> {
    const online = () => listener({ connected: true });
    const offline = () => listener({ connected: false });
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return { remove: () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    } };
  }
}

let adapter: ConnectivityAdapter = new WebConnectivityAdapter();

export function configureConnectivityAdapter(next: ConnectivityAdapter): void {
  adapter = next;
}

export function getConnectivityStatus(): Promise<ConnectivityStatus> {
  return adapter.getStatus();
}

export function subscribeConnectivity(listener: (status: ConnectivityStatus) => void): () => void {
  let disposed = false;
  let handle: RemovableListener | undefined;
  void adapter.getStatus()
    .then((status) => { if (!disposed) listener(status); })
    .catch((error) => console.warn("Could not read connectivity status", error));
  void adapter.addListener(listener)
    .then((next) => {
      if (disposed) void next.remove();
      else handle = next;
    })
    .catch((error) => console.warn("Could not observe connectivity changes", error));
  return () => {
    disposed = true;
    if (handle) void handle.remove();
  };
}
