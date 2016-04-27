import {Observable, Scheduler} from 'rx';

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
