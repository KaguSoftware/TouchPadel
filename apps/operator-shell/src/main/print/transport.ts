import * as net from 'node:net';

/**
 * Printer transports behind one interface — the venue's printer model is
 * unverified against the spec (client pack 2026-08-30: "arrived", model
 * unknown), so the pipeline must not assume more than "bytes go in". Network
 * (JetDirect port 9100) first: every 80mm thermal printer with an Ethernet
 * port speaks it. USB lands only if the venue printer turns out USB-only.
 */
export interface PrinterTransport {
  write(bytes: Buffer): Promise<void>;
}

export function networkTransport(host: string, port = 9100, timeoutMs = 5_000): PrinterTransport {
  return {
    write(bytes: Buffer): Promise<void> {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        const fail = (err: Error) => {
          socket.destroy();
          reject(err);
        };
        socket.setTimeout(timeoutMs, () => fail(new Error(`printer ${host}:${port} timed out`)));
        socket.once('error', fail);
        socket.once('connect', () => {
          socket.end(bytes, () => resolve());
        });
      });
    },
  };
}
