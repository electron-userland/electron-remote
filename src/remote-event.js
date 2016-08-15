import {remote, ipcRenderer} from 'electron';
import {CompositeDisposable, Disposable, Observable} from 'rx';

const isBrowser = process.type === 'browser';

if (!isBrowser) {
  remote.require(require.resolve('./remote-event-browser'));
}

const d = require('debug-electron')('remote-event');

/**
 * Safely subscribes to an event on a BrowserWindow or its WebContents. This
 * method avoids the "remote event listener" Electron issue.
 *
 * @param browserWindow  BrowserWindow   - the window to listen to
 * @param event  String  - The event to listen to
 * @param onWebContents  Boolean  - If true, the event is on the window's
 *                                  WebContents, not on the window itself.
 *
 * @returns Observable<Object>  - an Observable representing the event.
 *                                Unsubscribing from the Observable will
 *                                remove the event listener.
 */
export function fromRemoteWindow(browserWindow, event, onWebContents=false) {
  if (isBrowser) {
    return onWebContents ?
      Observable.fromEvent(browserWindow.webContents, event, (...args) => args) :
      Observable.fromEvent(browserWindow, event, (...args) => args);
  }

  let type = 'window';
  let id = browserWindow.id;

  const key = `electron-remote-event-${type}-${id}-${event}-${remote.getCurrentWebContents().id}`;

  d(`Subscribing to event with key: ${key}`);
  let {error} = ipcRenderer.sendSync(
    'electron-remote-event-subscribe',
    {type, id, event, onWebContents});

  if (error) {
    d(`Failed with error: ${error}`);
    return Observable.throw(new Error(error));
  }

  let ret = Observable.create((subj) => {
    let disp = new CompositeDisposable();
    disp.add(
      Observable.fromEvent(ipcRenderer, key, (e,arg) => arg)
        .do(() => d(`Got event: ${key}`))
        .subscribe(subj));

    disp.add(Disposable.create(() => {
      d(`Got event: ${key}`);
      ipcRenderer.send('electron-remote-event-dispose', key);
    }));

    return disp;
  });

  return ret.publish().refCount();
}
