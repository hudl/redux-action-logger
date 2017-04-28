/* @flow */

export default class Semaphore {
  queue: Array<Function>;
  count: number;
  max: number;

  constructor(max: number) {
    this.queue = [];
    this.max = max;
    this.count = 0;
  }

  async acquire(maxWaitMillis: number = -1): Promise<boolean> {
    if (this.count < this.max) {
      this.count++;
      return Promise.resolve(true);
    }

    if (maxWaitMillis > 0) {
      // dummyResolver starts out as a true 'dummy' resolve function
      let dummyResolver = () => { };
      const promise = new Promise(r => {
        dummyResolver = r;
      });
      this.queue.push(dummyResolver);
      setTimeout(() => {
        const index = this.queue.indexOf(dummyResolver);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        dummyResolver(false);
      }, maxWaitMillis);

      return promise;
    } else {
      return new Promise(resolve => {
        this.queue.push(resolve);
      });
    }
  }
  release() : void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next !== null) {
        next(true);
      }
    }
      
    this.count--;
  }
}
