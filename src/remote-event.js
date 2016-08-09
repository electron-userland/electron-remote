import {remote, ipcRenderer} from 'electron';
import {CompositeDisposable, Disposable, Observable} from 'rx';

remote.require(require.resolve('./remote-event-browser'));

const d = require('debug-electron')('remote-event');

export function fromRemoteWindow(browserWindow, event, onWebContents=false) {
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
