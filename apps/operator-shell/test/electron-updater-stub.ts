/**
 * `electron-updater` stand-in for unit tests (aliased in vitest.config.ts).
 * An EventEmitter with the members updater.ts touches; every call is recorded
 * so a test can assert what the shell asked of it.
 */
import { EventEmitter } from 'node:events';

export const __calls: string[] = [];

class StubUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  /** Set by a test to make the next check reject. */
  failNextCheck: Error | null = null;

  async checkForUpdates(): Promise<null> {
    __calls.push('check');
    if (this.failNextCheck) {
      const e = this.failNextCheck;
      this.failNextCheck = null;
      throw e;
    }
    return null;
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    __calls.push(`install:${isSilent ? 'silent' : 'ui'}:${isForceRunAfter ? 'relaunch' : 'stay'}`);
  }
}

export const autoUpdater = new StubUpdater();
export type AppUpdater = StubUpdater;

export function __reset(): void {
  __calls.length = 0;
  autoUpdater.removeAllListeners();
  autoUpdater.failNextCheck = null;
}
