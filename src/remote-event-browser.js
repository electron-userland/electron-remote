import {BrowserWindow, ipcMain} from 'electron';
import {Observable} from 'rx';

const eventListenerTable = {};

function initialize() {
  ipcMain.on('electron-remote-event-subscribe', (e, x) => {
    const {type, id, event} = x;
    let target = null;
    
    switch(type) {
    case 'window':
      target = BrowserWindow.fromId(id);
      break;
    default:
      target = null;
    }
    
    if (!target) {
      event.returnValue = {error: `Failed to find ${type} with ID ${id}`};
      return;
    }
    
    const key = `${type}-${id}-${event}-${e.sender.id}`;
    if (eventListenerTable[key]) {
      eventListenerTable[key].refCount++;
      event.returnValue = {error: null};
      return;
    }
    
    let targetWebContents = e.sender;
    
    eventListenerTable[key] = {
      refCount: 1,
      disposable: Observable.fromEvent(target, event, (...args) => [args])
        .takeUntil(Observable.fromEvent(targetWebContents, 'destroyed'))
        .subscribe((args) => targetWebContents.send(`electron-remote-event-${key}`, args))
    };
  });
  
  ipcMain.on('electron-remote-event-dispose', (e, key) => {
    eventListenerTable[key].refCount--;
    if (eventListenerTable[key].refCount <= 0) {
      let k = eventListenerTable[key];
      delete eventListenerTable[k];
      
      k.disposable.dispose();
    }
  });
}

initialize();
