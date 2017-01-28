import {Observable} from 'rxjs/Observable';
import {Scheduler} from 'rxjs/Scheduler';

import 'rxjs/add/operator/map';
import 'rxjs/add/operator/switch';
import 'rxjs/add/observable/timer';

const newCoolOperators = {
  guaranteedThrottle: function (time, scheduler=Scheduler.timeout) {
    return this
      .map((x) => Observable.timer(time, scheduler).map(() => x))
      .switch();
  }
};

for (let key of Object.keys(newCoolOperators)) {
  Observable.prototype[key] = newCoolOperators[key];
}
