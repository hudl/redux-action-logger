/* @flow */
'use strict';
import LargeItemLocalQueue from './LargeItemLocalQueue';
import type { QueueStorageType } from './LargeItemLocalQueue';

// a map of headers. each can have a string or function value
type EndpointHeaderType = {[header: string]: (string | Function)};

// transform takes the raw json event object. output is translated object
type TransformFunctionType = (inputJson: Object) => Object;

export type EndpointType = {
  uri: string,
  includeCredentials?: boolean,
  transformFunction?:  TransformFunctionType,
  headers?: EndpointHeaderType,
};

// injectedParamters can be a string or function which is passed state
type ParameterType = string | ((state: Object) => string);

// todo: better define Object types below
type ActionHandlerType = (action: Object, state: Object) => ?Object;

export type ActionLoggerOptionsType = {
  name: string,
  actionHandlers: Array<ActionHandlerType> | ActionHandlerType,
  injectedParameters?: {[name: string]:  ParameterType},
  endpoint: EndpointType,
  logValidator?: (inputJson: Object) => boolean,
  queueStorage?: QueueStorageType,
};

const isEmptyObject = (obj = {}) => !Object.keys(obj).length;

async function sendToEndpoint(endpoint: EndpointType, state: Object, log: Object): Promise<Response> {
  let headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  if (endpoint.headers) {
    const mergedHeaders = {...endpoint.headers};

    // go through each header. if function - call and replace value
    for (const key in endpoint.headers) {
      if (typeof endpoint.headers[key] === 'function') {
        mergedHeaders[key] = (endpoint.headers[key].call(undefined, state): string);
      } else if (typeof endpoint.headers[key] === 'boolean') {
        mergedHeaders[key] = endpoint.headers[key].toString(); // booleans need to be manually converted
      }
    }
    headers = {
      ...headers,
      ...mergedHeaders,
    };
  }

  return fetch(endpoint.uri, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(log),
    credentials: endpoint.includeCredentials ? 'include' : 'omit',
    cache: 'no-cache',
  });
}
async function popAndSendToEndpoint(endpoint: EndpointType, state: Object, logQueue: LargeItemLocalQueue)
  : Promise<void> {
  const nextLog = await logQueue.pop();
  // if there isn't another item - return
  if (!nextLog) {
    return;
  }

  try {
    const response = await sendToEndpoint(endpoint, state, nextLog);
    if (response.ok) {
      // attempt to get the next item from the queue
      popAndSendToEndpoint(endpoint, state, logQueue);
    } else {
      logQueue.push(nextLog);
    }
  } catch (e) {
    // console.log('send failure', e);
    // this indicates a client error (probably no internet)
    logQueue.push(nextLog);
  }
}

export function createActionLogger(options: ActionLoggerOptionsType): Function {
  const {
    name,
    actionHandlers,
    endpoint,
    queueStorage = localStorage, // do we want to do this? or make the user pass it in (with suggestions)
    injectedParameters,
    logValidator,
  } = options;

  if (logValidator !== null && logValidator !== undefined && (typeof logValidator !== 'function')) {
    throw new Error('logValidator must be a function');
  }
  if (!name) {
    throw new Error('a name is required');
  }
  if ((typeof name !== 'string') || name.length === 0) {
    throw new Error('name must be a valid non-empty string');
  }
  if (!actionHandlers) {
    throw new Error('actionHandlers is required');
  }
  const isArrayOfActionHandlers = Array.isArray(actionHandlers);
  if ((typeof actionHandlers !== 'function') && !isArrayOfActionHandlers) {
    throw new Error('actionHandlers must be either a function or an array of functions');
  }
  if (isArrayOfActionHandlers) {
    if (actionHandlers.length === 0) {
      throw new Error('actionHandlers array must not be empty');
    }
    for (const ah of actionHandlers) {
      if (typeof ah !== 'function') {
        throw new Error('All elements of the actionHandlers array must be functions, found handler=' + ah);
      }
    }
  }
  if (endpoint === null || endpoint === undefined) {
    throw new Error('endpoint is required');
  }
  if (!endpoint.uri || (typeof endpoint.uri !== 'string') || endpoint.uri.length === 0) {
    throw new Error('endpoint.uri must be a valid string');
  }


  // this is the initial setup area
  const logQueue = new LargeItemLocalQueue(name, queueStorage);

  // this is the actual middleware function (called on every action)
  return store => next => action => {
    let result;
    const curState = store.getState();
    if (Array.isArray(actionHandlers)) {
      // go through each handler sequentially until this action is fullfilled
      for (const ah of actionHandlers) {
        result = ah.call(undefined, action, curState);
        if (result !== null) {
          break;
        }
      }
    } else {
      result = actionHandlers.call(undefined, action, curState);
    }

    // if action isn't being logged/handled - then just skip this middleware
    if (result === null || result === undefined) {
      return next(action);
    }

    if (!isEmptyObject(injectedParameters)) {
      const mergeObj = {...injectedParameters};

      // go through each injectedParamter. if function - call and replace value
      for (const key in injectedParameters) {
        if (typeof injectedParameters[key] === 'function') {
          mergeObj[key] = injectedParameters[key].call(undefined, curState);
        }
      }
      result = {...result, ...mergeObj};
    }

    if (logValidator) {
      if (!logValidator.call(undefined, result)) {
        console.error('Log did not successfully validate and will not be sent.', result); // eslint-disable-line
        return next(action);
      }
    }


    if (endpoint.transformFunction) {
      result = endpoint.transformFunction.call(undefined, result);
    }

    // if nothing to log at the end - just continue
    if(isEmptyObject(result)) {
      return next(action);
    }

    const pushPromise = logQueue.push(result);

    pushPromise.then(() => popAndSendToEndpoint(endpoint, curState, logQueue));

    return pushPromise.then(()=> next(action));
  };
}
