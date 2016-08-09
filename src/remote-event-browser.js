import {BrowserWindow, ipcMain} from 'electron';
import {Observable} from 'rx';

const eventListenerTable = {};
const d = require('debug-electron')('remote-event-browser');

function initialize() {
  d('Initializing browser-half of remote-event');
  
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
      e.returnValue = {error: `Failed to find ${type} with ID ${id}`};
      d(e.returnValue.error);
      return;
    }
    
    const key = `${type}-${id}-${event}-${e.sender.id}`;
    if (eventListenerTable[key]) {
      d(`Using existing key ${key} in eventListenerTable`);
      eventListenerTable[key].refCount++;
      e.returnValue = {error: null};
      return;
    }
    
    let targetWebContents = e.sender;
    
    d(`Creating new event subscription with key ${key}`);
    eventListenerTable[key] = {
      refCount: 1,
      disposable: Observable.fromEvent(target, event, (...args) => [args])
        .takeUntil(Observable.fromEvent(targetWebContents, 'destroyed'))
        .do(() => d(`Got event on browser side: ${key}`))
        .subscribe((args) => targetWebContents.send(`electron-remote-event-${key}`, args))
    };
    
    e.returnValue = {error: null};
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
