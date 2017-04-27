/* @flow */

// can be async or sync handler (promise or value directly). Storage is ES6 localstorage
type QueueStorageAsyncInterface = {
  getItem: (key: string)=>  Promise<string>,
  setItem: (key: string, value: string)=> Promise<void>,
  removeItem: (key: string)=>  Promise<void>,
};
export type QueueStorageType = QueueStorageAsyncInterface | Storage;

type QueueOperationResult = {
  id?: string,
  remainder?: string,
};
const DELIMITER = '|';

class Semaphore {
  queue: Array<Function>;
  count: number;
  max: number;

  constructor(max: number) {
    this.queue = [];
    this.max = max;
    this.count = 0;
  }

  async acquire(): Promise<boolean> {
    // console.log('acquire', this.count, this.max);
    if (this.count < this.max) {
      this.count++;
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }
  release() : void {
    if (this.queue.length > 0) {
      // console.log('flushing the queue inside release()');
      const next = this.queue.shift();
      if (next !== null) {
        next(true);
      }
    }
      
    this.count--;
  }
}

export default class LargeItemLocalQueue {
  storage: ?QueueStorageType;
  prefix: string;
  isPromiseStorage: boolean;
  queueName: string;
  lock: Semaphore;

  constructor(queuePrefix: string, storageBackend: ?QueueStorageType) {
    // todo: input validation
    this.storage = storageBackend;
    this.prefix = queuePrefix;
    this.queueName = `${this.prefix}--queue`;
    this.isPromiseStorage = this._initStorageBackendType(this.storage);
    this.lock = new Semaphore(1);
  }
  async push(item: Object) : Promise<void> {
    const hasLock = await this.lock.acquire();
    if (!hasLock) { throw new Error('failed to acquire lock'); }

    // generate a unique id for the object
    const newId = this._getUuid();
    const serializedObj = JSON.stringify(item);
    // set the item in its specific location in storage
    await this._setItem(newId, serializedObj);
    // push the id onto the main list array
    await this._pushItemIdOntoTrackingQueue(newId);

    this.lock.release();
  }
  async pushAll(items: Array<Object>) : Promise<void> {
    const hasLock = await this.lock.acquire();
    if (!hasLock) { throw new Error('failed to acquire lock'); }

    // generate a unique ids for the objects and serialize
    const idsToItems = items.map((i)=> {return {id: this._getUuid(), item: JSON.stringify(i)};});
    // set the items in their specific location in storage
    // todo: should we do this in parallel?? Promise.all()?
    for (const {id, item} of idsToItems) {
      await this._setItem(id, item);
    }
    // push the id onto the main list array
    await this._pushItemIdOntoTrackingQueue(idsToItems.map(i=>i.id));

    this.lock.release();
  }
  async pop() : Promise<?Object> {
    const hasLock = await this.lock.acquire();
    if (!hasLock) { throw new Error('failed to acquire lock'); }

    // get the 'first' id on the queue
    const {id, remainder} = await this._sliceFirstItemFromQueue();

    if (!id) {
      // console.log('empty queue');
      this.lock.release();
      return null;
    }
    // console.log('popping', id, remainder);
    // retrieve that item
    const item = await this._getItemAndDeserialize(id);
    // write the main queue back
    await this._setTrackingQueueDirect(remainder);
    // remove the unneeded reference object
    await this._removeItem(id);

    this.lock.release();

    return item;
  }
  async peek() : Promise<?Object> {
    // get the 'first' id on the queue
    const {id} = await this._sliceFirstItemFromQueue();

    return await this._getItemAndDeserialize(id);
  }
  async clear() : Promise<void> {
    // todo: not implemented
  }
  async _setTrackingQueueDirect(newQueueValue: ?string): Promise<void> {
    await this._setItem(this.queueName, newQueueValue || '');
  }
  async _sliceFirstItemFromQueue(): Promise<QueueOperationResult> {
    const queue = await this._getItem(this.queueName);
    if (!queue || queue === '') {
      return {};
    }
    const firstPipeIdx = queue.indexOf(DELIMITER);
    if (firstPipeIdx < 0) {
      return {
        id: queue,
        remainder: '',
      };
    }

    return {
      id: queue.substr(0, firstPipeIdx),
      remainder: queue.substr(firstPipeIdx + 1),
    };
  }
  async _pushItemIdOntoTrackingQueue(newIds: string | Array<string>): Promise<void> {
    // attempt to get existing queue
    const curQueueState = await this._getItem(this.queueName);
    let newQueueState;
    // if currently blank queue
    if (!curQueueState || curQueueState === '') {
      if (Array.isArray(newIds)) {
        newQueueState = newIds.join(DELIMITER);
      } else {
        newQueueState = newIds;
      }
    } else {
      // else existing queue - append
      if (Array.isArray(newIds)) {
        newQueueState = `${curQueueState}${DELIMITER}${newIds.join(DELIMITER)}`; // add all ids
      } else {
        newQueueState = `${curQueueState}${DELIMITER}${newIds}`;     // add item to the end
      }
    }
    // console.log('pushing', newIds);
    await this._setItem(this.queueName, newQueueState);
    // const final = await this._getItem(this.queueName);
    // console.log('new queue state', final);
  }
  async _setItem(key: string, value: string): Promise<void> {
    if (!this.storage) {
      return Promise.resolve();
    }

    // note: this fanciness will wrap a sync call in a promise
    // for an async call it will return a no-op 'then' after the async call
    // therefore call will always be async
    return Promise.resolve(this.storage.setItem(key, value));
  }
  async _getItemAndDeserialize(key: ?string): Promise<?Object> {
    if (!key) {
      return null;
    }
    const item = await this._getItem(key);
    if (!item) {
      return null;
    }
    return JSON.parse(item);
  }
  async _getItem(key: string): Promise<?string> {
    if (!this.storage) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.storage.getItem(key));
  }
  async _removeItem(key: string): Promise<void> {
    if (!this.storage) {
      return Promise.resolve();
    }
    return Promise.resolve(this.storage.removeItem(key));
  }
  _initStorageBackendType(storage: ?QueueStorageType) : bool {
    if (storage && storage.setItem) {
      try {
        const promiseTest = storage.setItem('__storage-queue-test__', 'test');
        return (promiseTest && promiseTest.then) ? true : false;
      } catch (e) {
        console.warn(e); // eslint-disable-line
        throw e;
      }
    } else {
      // es-lint-disable-next-line
      console.warn('Data will lost on write (/dev/null) without a storageBackend!'); // eslint-disable-line
      return false;
    }
  }
  _getUuid(): string {
    return (Math.round(Math.random() * 1E16)).toString(16);
  }
}
