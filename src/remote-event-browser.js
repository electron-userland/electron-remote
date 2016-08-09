import {BrowserWindow, ipcMain} from 'electron';
import {Observable} from 'rx';

const eventListenerTable = {};
const d = require('debug-electron')('remote-event-browser');

function initialize() {
  d('Initializing browser-half of remote-event');
  
  ipcMain.on('electron-remote-event-subscribe', (e, x) => {
    const {type, id, event, onWebContents} = x;
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
    
    const key = `electron-remote-event-${type}-${id}-${event}-${e.sender.id}`;
    if (eventListenerTable[key]) {
      d(`Using existing key ${key} in eventListenerTable`);
      eventListenerTable[key].refCount++;
      e.returnValue = {error: null};
      return;
    }
    
    let targetWebContents = e.sender;
    
    d(`Creating new event subscription with key ${key}: ${event}`);
    d(JSON.stringify(Object.keys(target)));
    
    eventListenerTable[key] = {
      refCount: 1,
      disposable: Observable.fromEvent(onWebContents ? target.webContents : target, event, (...args) => [args])
        .do(() => d(`Got event on browser side: ${key}`))
        .takeUntil(Observable.fromEvent(targetWebContents, 'destroyed'))
        .subscribe((args) => targetWebContents.send(key, args))
    };
    
    e.returnValue = {error: null};
  });
  
  ipcMain.on('electron-remote-event-dispose', (e, key) => {
    let k = eventListenerTable[key];
    if (!k) {
      d(`*** Tried to release missing key! ${key}`);
      return;
    }
    
    k.refCount--;
    if (k.refCount <= 0) {
      d(`Disposing key: ${key}`);
    
      delete eventListenerTable[key];
      k.disposable.dispose();
    }
  });
}

initialize();
