/**
 * `electron-updater` stand-in for unit tests (aliased in vitest.config.ts).
 * An EventEmitter with the members updater.ts touches; every call is recorded
 * so a test can assert what the shell asked of it.
 */
import { EventEmitter } from 'node:events';
import { autoUpdater as nativeUpdater } from 'electron';

export const __calls: string[] = [];

class StubUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  autoRunAppAfterInstall = true;
  logger: unknown = console;
  /** Set by a test to make the next check reject. */
  failNextCheck: Error | null = null;
  /** Set by a test: this many checks in a row reject (a network that is not up yet). */
  failChecks = 0;
  /** Set by a test: the next check never settles (a line that hangs). */
  hangNextCheck = false;
  /** Set by a test: what the next check resolves to. null is electron-updater's own "not active" answer. */
  nextCheckResult: unknown = null;
  /** Set by a test: the next quitAndInstall refuses the way BaseUpdater.install does, with a synchronous 'error'. */
  refuseNextInstall = false;
  /** Set by a test: the next installer cannot be spawned, reported after quitAndInstall returns (NsisUpdater.doInstall). */
  failNextInstallLate = false;
  /** Set by a test: the next check throws before it returns a promise at all. */
  throwNextCheck = false;
  /** BaseUpdater.quitAndInstallCalled: set by an install that went ahead. */
  installCalled = false;

  checkForUpdates(): Promise<unknown> {
    __calls.push('check');
    if (this.throwNextCheck) {
      this.throwNextCheck = false;
      throw new Error('checkForUpdates threw');
    }
    return this.answer();
  }

  private async answer(): Promise<unknown> {
    if (this.failNextCheck) {
      const e = this.failNextCheck;
      this.failNextCheck = null;
      throw e;
    }
    if (this.failChecks > 0) {
      this.failChecks--;
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    }
    if (this.hangNextCheck) {
      this.hangNextCheck = false;
      return new Promise(() => {});
    }
    const result = this.nextCheckResult;
    this.nextCheckResult = null;
    return result;
  }

  /**
   * Like BaseUpdater: a refusal is a synchronous 'error' and nothing else;
   * otherwise the quit is announced on Electron's autoUpdater in a
   * setImmediate (where the real one then calls app.quit(), which the stub
   * does not). A spawn failure lands before that setImmediate. A second call
   * after one went ahead is ignored without a word, and the flag is then
   * reset, so a third would install again.
   */
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    if (this.installCalled) {
      __calls.push('ignored');
      this.installCalled = false;
      return;
    }
    __calls.push(`install:${isSilent ? 'silent' : 'ui'}:${isForceRunAfter ? 'relaunch' : 'stay'}`);
    if (this.refuseNextInstall) {
      this.refuseNextInstall = false;
      this.emit('error', new Error("No update filepath provided, can't quit and install"));
      return;
    }
    if (this.failNextInstallLate) {
      this.failNextInstallLate = false;
      queueMicrotask(() => this.emit('error', new Error('spawn EMFILE')));
    }
    this.installCalled = true;
    setImmediate(() => {
      __calls.push('before-quit-for-update');
      nativeUpdater.emit('before-quit-for-update');
    });
  }
}

export const autoUpdater = new StubUpdater();
export type AppUpdater = StubUpdater;

export function __reset(): void {
  __calls.length = 0;
  autoUpdater.removeAllListeners();
  autoUpdater.failNextCheck = null;
  autoUpdater.failChecks = 0;
  autoUpdater.hangNextCheck = false;
  autoUpdater.nextCheckResult = null;
  autoUpdater.refuseNextInstall = false;
  autoUpdater.failNextInstallLate = false;
  autoUpdater.throwNextCheck = false;
  autoUpdater.installCalled = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.logger = console;
}
