import {remote, ipcRenderer} from 'electron';
import {CompositeDisposable, Disposable, Observable} from 'rx';

remote.require('./remote-event-browser');

export function fromRemoteWindow(browserWindow, event) {
  let type = 'window';
  let id = browserWindow.id;
  
  const key = `electron-remote-event-${type}-${id}-${event}-${remote.getCurrentWebContents().id}`;
  let {error} = ipcRenderer.sendSync('electron-remote-event-subscribe', {type, id, event});
  if (error) {
    return Observable.throw(new Error(error));
  }
  
  let ret = Observable.create((subj) => {
    let disp = new CompositeDisposable();
    disp.add(
      Observable.fromEvent(ipcRenderer, key, (e,arg) => arg)
        .subscribe(subj));
      
    disp.add(Disposable.create(() => {
      ipcRenderer.send('electron-remote-event-dispose', key);
    }));
    
    return disp;
  });
  
  return ret.publish().refCount();
}
