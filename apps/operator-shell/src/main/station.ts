import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { StationInfo } from '../ipc-channels';

// Station identity = the MACHINE's role, not the human (design-arch.md §2.1).
// station.json is written by the installer / first-run step into userData
// (template: station.json.example at the package root; snake_case keys per design-arch §2.4).

export interface StationConfig extends StationInfo {
  /** Pre-shared key for the LAN KDS websocket (design-arch.md §2.4). */
  lanPsk?: string;
  /** Override for the LAN server bind address (default: first RFC1918 IPv4). */
  lanBind?: string;
  /** Thermal receipt printer (network/JetDirect). Absent = on-screen bill only. */
  printer?: { host: string; port?: number };
}

interface StationFile {
  station_id?: string;
  mode?: string;
  till_host?: string;
  lan_psk?: string;
  lan_bind?: string;
  printer?: { host?: string; port?: number };
}

let cached: StationConfig | null = null;

export function loadStation(): StationConfig {
  if (cached) return cached;
  const file = path.join(app.getPath('userData'), 'station.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as StationFile;
    // TODO: zod-validate via @touch/core schemas instead of this hand check.
    const mode = raw.mode === 'desk' || raw.mode === 'kds' ? raw.mode : 'till';
    cached = {
      stationId: raw.station_id ?? 'TILL1',
      mode,
      tillHost: raw.till_host,
      lanPsk: raw.lan_psk,
      lanBind: raw.lan_bind,
      printer:
        raw.printer && typeof raw.printer.host === 'string'
          ? { host: raw.printer.host, port: raw.printer.port }
          : undefined,
    };
  } catch {
    // Dev fallback so `electron .` boots on a clean machine. Production installs MUST
    // write station.json (W3 install runbook, design-delivery.md).
    console.warn(`[station] ${file} missing/invalid — using dev defaults (TILL1/till)`);
    cached = { stationId: 'TILL1', mode: 'till' };
  }
  return cached;
}
