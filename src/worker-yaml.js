"no use strict";
!(function(window) {
if (typeof window.window != "undefined" && window.document)
    return;
if (window.require && window.define)
    return;

if (!window.console) {
    window.console = function() {
        var msgs = Array.prototype.slice.call(arguments, 0);
        postMessage({type: "log", data: msgs});
    };
    window.console.error =
    window.console.warn = 
    window.console.log =
    window.console.trace = window.console;
}
window.window = window;
window.ace = window;

window.onerror = function(message, file, line, col, err) {
    postMessage({type: "error", data: {
        message: message,
        data: err && err.data,
        file: file,
        line: line, 
        col: col,
        stack: err && err.stack
    }});
};

window.normalizeModule = function(parentId, moduleName) {
    // normalize plugin requires
    if (moduleName.indexOf("!") !== -1) {
        var chunks = moduleName.split("!");
        return window.normalizeModule(parentId, chunks[0]) + "!" + window.normalizeModule(parentId, chunks[1]);
    }
    // normalize relative requires
    if (moduleName.charAt(0) == ".") {
        var base = parentId.split("/").slice(0, -1).join("/");
        moduleName = (base ? base + "/" : "") + moduleName;
        
        while (moduleName.indexOf(".") !== -1 && previous != moduleName) {
            var previous = moduleName;
            moduleName = moduleName.replace(/^\.\//, "").replace(/\/\.\//, "/").replace(/[^\/]+\/\.\.\//, "");
        }
    }
    
    return moduleName;
};

window.require = function require(parentId, id) {
    if (!id) {
        id = parentId;
        parentId = null;
    }
    if (!id.charAt)
        throw new Error("worker.js require() accepts only (parentId, id) as arguments");

    id = window.normalizeModule(parentId, id);

    var module = window.require.modules[id];
    if (module) {
        if (!module.initialized) {
            module.initialized = true;
            module.exports = module.factory().exports;
        }
        return module.exports;
    }
   
    if (!window.require.tlns)
        return console.log("unable to load " + id);
    
    var path = resolveModuleId(id, window.require.tlns);
    if (path.slice(-3) != ".js") path += ".js";
    
    window.require.id = id;
    window.require.modules[id] = {}; // prevent infinite loop on broken modules
    importScripts(path);
    return window.require(parentId, id);
};
function resolveModuleId(id, paths) {
    var testPath = id, tail = "";
    while (testPath) {
        var alias = paths[testPath];
        if (typeof alias == "string") {
            return alias + tail;
        } else if (alias) {
            return  alias.location.replace(/\/*$/, "/") + (tail || alias.main || alias.name);
        } else if (alias === false) {
            return "";
        }
        var i = testPath.lastIndexOf("/");
        if (i === -1) break;
        tail = testPath.substr(i) + tail;
        testPath = testPath.slice(0, i);
    }
    return id;
}
window.require.modules = {};
window.require.tlns = {};

window.define = function(id, deps, factory) {
    if (arguments.length == 2) {
        factory = deps;
        if (typeof id != "string") {
            deps = id;
            id = window.require.id;
        }
    } else if (arguments.length == 1) {
        factory = id;
        deps = [];
        id = window.require.id;
    }
    
    if (typeof factory != "function") {
        window.require.modules[id] = {
            exports: factory,
            initialized: true
        };
        return;
    }

    if (!deps.length)
        // If there is no dependencies, we inject "require", "exports" and
        // "module" as dependencies, to provide CommonJS compatibility.
        deps = ["require", "exports", "module"];

    var req = function(childId) {
        return window.require(id, childId);
    };

    window.require.modules[id] = {
        exports: {},
        factory: function() {
            var module = this;
            var returnExports = factory.apply(this, deps.slice(0, factory.length).map(function(dep) {
                switch (dep) {
                    // Because "require", "exports" and "module" aren't actual
                    // dependencies, we must handle them seperately.
                    case "require": return req;
                    case "exports": return module.exports;
                    case "module":  return module;
                    // But for all other dependencies, we can just go ahead and
                    // require them.
                    default:        return req(dep);
                }
            }));
            if (returnExports)
                module.exports = returnExports;
            return module;
        }
    };
};
window.define.amd = {};
window.require.tlns = {};
window.initBaseUrls  = function initBaseUrls(topLevelNamespaces) {
    for (var i in topLevelNamespaces)
        this.require.tlns[i] = topLevelNamespaces[i];
};

window.initSender = function initSender() {

    var EventEmitter = window.require("ace/lib/event_emitter").EventEmitter;
    var oop = window.require("ace/lib/oop");
    
    var Sender = function() {};
    
    (function() {
        
        oop.implement(this, EventEmitter);
                
        this.callback = function(data, callbackId) {
            postMessage({
                type: "call",
                id: callbackId,
                data: data
            });
        };
    
        this.emit = function(name, data) {
            postMessage({
                type: "event",
                name: name,
                data: data
            });
        };
        
    }).call(Sender.prototype);
    
    return new Sender();
};

var main = window.main = null;
var sender = window.sender = null;

window.onmessage = function(e) {
    var msg = e.data;
    if (msg.event && sender) {
        sender._signal(msg.event, msg.data);
    }
    else if (msg.command) {
        if (main[msg.command])
            main[msg.command].apply(main, msg.args);
        else if (window[msg.command])
            window[msg.command].apply(window, msg.args);
        else
            throw new Error("Unknown command:" + msg.command);
    }
    else if (msg.init) {
        window.initBaseUrls(msg.tlns);
        sender = window.sender = window.initSender();
        var clazz = this.require(msg.module)[msg.classname];
        main = window.main = new clazz(sender);
    }
};
})(this);

define("ace/lib/oop", [], function(require, exports, module) {
"use strict";
exports.inherits = function(ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });
};

/**
 * Implements mixin properties into the prototype of an object.
 * @template T
 * @param {T} obj - The prototype of the target object.
 * @param {Object} mixin - The source object.
 * @returns {T & Object} The merged prototype.
 */
exports.mixin = function(obj, mixin) {
    for (var key in mixin) {
        obj[key] = mixin[key];
    }
    return obj;
};

/**
 * Implements mixin properties into the prototype of an object.
 * @template T
 * @param {T} proto - The prototype of the target object.
 * @param {Object} mixin - The source object.
 * @returns {T & Object} The merged prototype.
 */
exports.implement = function(proto, mixin) {
    exports.mixin(proto, mixin);
};
});

define("ace/lib/event_emitter", [], function(require, exports, module) {
"use strict";
/**@type {any}*/
var EventEmitter = {};
var stopPropagation = function() { this.propagationStopped = true; };
var preventDefault = function() { this.defaultPrevented = true; };

EventEmitter._emit =
EventEmitter._dispatchEvent = function(eventName, e) {
    this._eventRegistry || (this._eventRegistry = {});
    this._defaultHandlers || (this._defaultHandlers = {});

    var listeners = this._eventRegistry[eventName] || [];
    var defaultHandler = this._defaultHandlers[eventName];
    if (!listeners.length && !defaultHandler)
        return;

    if (typeof e != "object" || !e)
        e = {};

    if (!e.type)
        e.type = eventName;
    if (!e.stopPropagation)
        e.stopPropagation = stopPropagation;
    if (!e.preventDefault)
        e.preventDefault = preventDefault;

    listeners = listeners.slice();
    for (var i=0; i<listeners.length; i++) {
        listeners[i](e, this);
        if (e.propagationStopped)
            break;
    }
    
    if (defaultHandler && !e.defaultPrevented)
        return defaultHandler(e, this);
};


EventEmitter._signal = function(eventName, e) {
    var listeners = (this._eventRegistry || {})[eventName];
    if (!listeners)
        return;
    listeners = listeners.slice();
    for (var i=0; i<listeners.length; i++)
        listeners[i](e, this);
};

EventEmitter.once = function(eventName, callback) {
    var _self = this;
    this.on(eventName, function newCallback() {
        _self.off(eventName, newCallback);
        callback.apply(null, arguments);
    });
    if (!callback) {
        /*global Promise*/
        return new Promise(function(resolve) {
            callback = resolve;
        });
    }
};


EventEmitter.setDefaultHandler = function(eventName, callback) {
    /**@type {any}*/
    var handlers = this._defaultHandlers;
    if (!handlers)
        handlers = this._defaultHandlers = {_disabled_: {}};
    
    if (handlers[eventName]) {
        var old = handlers[eventName];
        var disabled = handlers._disabled_[eventName];
        if (!disabled)
            handlers._disabled_[eventName] = disabled = [];
        disabled.push(old);
        var i = disabled.indexOf(callback);
        if (i != -1) 
            disabled.splice(i, 1);
    }
    handlers[eventName] = callback;
};
EventEmitter.removeDefaultHandler = function(eventName, callback) {
    var handlers = this._defaultHandlers;
    if (!handlers)
        return;
    var disabled = handlers._disabled_[eventName];
    
    if (handlers[eventName] == callback) {
        if (disabled)
            this.setDefaultHandler(eventName, disabled.pop());
    } else if (disabled) {
        var i = disabled.indexOf(callback);
        if (i != -1)
            disabled.splice(i, 1);
    }
};

EventEmitter.on =
EventEmitter.addEventListener = function(eventName, callback, capturing) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        listeners = this._eventRegistry[eventName] = [];

    if (listeners.indexOf(callback) == -1)
        listeners[capturing ? "unshift" : "push"](callback);
    return callback;
};

EventEmitter.off =
EventEmitter.removeListener =
EventEmitter.removeEventListener = function(eventName, callback) {
    this._eventRegistry = this._eventRegistry || {};

    var listeners = this._eventRegistry[eventName];
    if (!listeners)
        return;

    var index = listeners.indexOf(callback);
    if (index !== -1)
        listeners.splice(index, 1);
};
/**
 * @this {EventEmitter}
 */
EventEmitter.removeAllListeners = function(eventName) {
    if (!eventName) this._eventRegistry = this._defaultHandlers = undefined;
    if (this._eventRegistry) this._eventRegistry[eventName] = undefined;
    if (this._defaultHandlers) this._defaultHandlers[eventName] = undefined;
};

exports.EventEmitter = EventEmitter;
});

define("ace/mode/yaml_worker", [], function(require, exports, module) {
"use strict";
var define = undefined;
var aceLegacyWorkerModule;
var aceLegacyWorkerModule = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };
  var __await = function(promise, isYieldStar) {
    this[0] = promise;
    this[1] = isYieldStar;
  };
  var __yieldStar = (value) => {
    var obj = value[__knownSymbol("asyncIterator")], isAwait = false, method, it = {};
    if (obj == null) {
      obj = value[__knownSymbol("iterator")]();
      method = (k) => it[k] = (x) => obj[k](x);
    } else {
      obj = obj.call(value);
      method = (k) => it[k] = (v) => {
        if (isAwait) {
          isAwait = false;
          if (k === "throw") throw v;
          return v;
        }
        isAwait = true;
        return {
          done: false,
          value: new __await(new Promise((resolve) => {
            var x = obj[k](v);
            if (!(x instanceof Object)) __typeError("Object expected");
            resolve(x);
          }), 1)
        };
      };
    }
    return it[__knownSymbol("iterator")] = () => it, method("next"), "throw" in obj ? method("throw") : it.throw = (x) => {
      throw x;
    }, "return" in obj && method("return"), it;
  };

  // ../../node_modules/ace-code/src/lib/deep_copy.js
  var require_deep_copy = __commonJS({
    "../../node_modules/ace-code/src/lib/deep_copy.js"(exports) {
      exports.deepCopy = function deepCopy(obj) {
        if (typeof obj !== "object" || !obj)
          return obj;
        var copy;
        if (Array.isArray(obj)) {
          copy = [];
          for (let key = 0; key < obj.length; key++) {
            copy[key] = deepCopy(obj[key]);
          }
          return copy;
        }
        if (Object.prototype.toString.call(obj) !== "[object Object]")
          return obj;
        copy = {};
        for (let key in obj)
          copy[key] = deepCopy(obj[key]);
        return copy;
      };
    }
  });

  // ../../node_modules/ace-code/src/lib/lang.js
  var require_lang = __commonJS({
    "../../node_modules/ace-code/src/lib/lang.js"(exports) {
      "use strict";
      exports.last = function(a) {
        return a[a.length - 1];
      };
      exports.stringReverse = function(string2) {
        return string2.split("").reverse().join("");
      };
      exports.stringRepeat = function(string2, count) {
        var result = "";
        while (count > 0) {
          if (count & 1)
            result += string2;
          if (count >>= 1)
            string2 += string2;
        }
        return result;
      };
      var trimBeginRegexp = /^\s\s*/;
      var trimEndRegexp = /\s\s*$/;
      exports.stringTrimLeft = function(string2) {
        return string2.replace(trimBeginRegexp, "");
      };
      exports.stringTrimRight = function(string2) {
        return string2.replace(trimEndRegexp, "");
      };
      exports.copyObject = function(obj) {
        var copy = {};
        for (var key in obj) {
          copy[key] = obj[key];
        }
        return copy;
      };
      exports.copyArray = function(array) {
        var copy = [];
        for (var i = 0, l = array.length; i < l; i++) {
          if (array[i] && typeof array[i] == "object")
            copy[i] = this.copyObject(array[i]);
          else
            copy[i] = array[i];
        }
        return copy;
      };
      exports.deepCopy = require_deep_copy().deepCopy;
      exports.arrayToMap = function(arr) {
        var map2 = {};
        for (var i = 0; i < arr.length; i++) {
          map2[arr[i]] = 1;
        }
        return map2;
      };
      exports.createMap = function(props) {
        var map2 = /* @__PURE__ */ Object.create(null);
        for (var i in props) {
          map2[i] = props[i];
        }
        return map2;
      };
      exports.arrayRemove = function(array, value) {
        for (var i = 0; i <= array.length; i++) {
          if (value === array[i]) {
            array.splice(i, 1);
          }
        }
      };
      exports.escapeRegExp = function(str) {
        return str.replace(/([.*+?^${}()|[\]\/\\])/g, "\\$1");
      };
      exports.escapeHTML = function(str) {
        return ("" + str).replace(/&/g, "&#38;").replace(/"/g, "&#34;").replace(/'/g, "&#39;").replace(/</g, "&#60;");
      };
      exports.getMatchOffsets = function(string2, regExp) {
        var matches = [];
        string2.replace(regExp, function(str) {
          matches.push({
            offset: arguments[arguments.length - 2],
            length: str.length
          });
        });
        return matches;
      };
      exports.deferredCall = function(fcn) {
        var timer = null;
        var callback = function() {
          timer = null;
          fcn();
        };
        var deferred = function(timeout) {
          deferred.cancel();
          timer = setTimeout(callback, timeout || 0);
          return deferred;
        };
        deferred.schedule = deferred;
        deferred.call = function() {
          this.cancel();
          fcn();
          return deferred;
        };
        deferred.cancel = function() {
          clearTimeout(timer);
          timer = null;
          return deferred;
        };
        deferred.isPending = function() {
          return timer;
        };
        return deferred;
      };
      exports.delayedCall = function(fcn, defaultTimeout) {
        var timer = null;
        var callback = function() {
          timer = null;
          fcn();
        };
        var _self = function(timeout) {
          if (timer == null)
            timer = setTimeout(callback, timeout || defaultTimeout);
        };
        _self.delay = function(timeout) {
          timer && clearTimeout(timer);
          timer = setTimeout(callback, timeout || defaultTimeout);
        };
        _self.schedule = _self;
        _self.call = function() {
          this.cancel();
          fcn();
        };
        _self.cancel = function() {
          timer && clearTimeout(timer);
          timer = null;
        };
        _self.isPending = function() {
          return timer;
        };
        return _self;
      };
      exports.supportsLookbehind = function() {
        try {
          new RegExp("(?<=.)");
        } catch (e) {
          return false;
        }
        return true;
      };
      exports.skipEmptyMatch = function(line, last, supportsUnicodeFlag) {
        return supportsUnicodeFlag && line.codePointAt(last) > 65535 ? 2 : 1;
      };
    }
  });

  // ../../node_modules/ace-code/src/lib/oop.js
  var require_oop = __commonJS({
    "../../node_modules/ace-code/src/lib/oop.js"(exports) {
      "use strict";
      exports.inherits = function(ctor, superCtor) {
        ctor.super_ = superCtor;
        ctor.prototype = Object.create(superCtor.prototype, {
          constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
          }
        });
      };
      exports.mixin = function(obj, mixin) {
        for (var key in mixin) {
          obj[key] = mixin[key];
        }
        return obj;
      };
      exports.implement = function(proto, mixin) {
        exports.mixin(proto, mixin);
      };
    }
  });

  // ../../node_modules/ace-code/src/apply_delta.js
  var require_apply_delta = __commonJS({
    "../../node_modules/ace-code/src/apply_delta.js"(exports) {
      "use strict";
      exports.applyDelta = function(docLines, delta, doNotValidate) {
        var row = delta.start.row;
        var startColumn = delta.start.column;
        var line = docLines[row] || "";
        switch (delta.action) {
          case "insert":
            var lines = delta.lines;
            if (lines.length === 1) {
              docLines[row] = line.substring(0, startColumn) + delta.lines[0] + line.substring(startColumn);
            } else {
              var args = [row, 1].concat(delta.lines);
              docLines.splice.apply(docLines, args);
              docLines[row] = line.substring(0, startColumn) + docLines[row];
              docLines[row + delta.lines.length - 1] += line.substring(startColumn);
            }
            break;
          case "remove":
            var endColumn = delta.end.column;
            var endRow = delta.end.row;
            if (row === endRow) {
              docLines[row] = line.substring(0, startColumn) + line.substring(endColumn);
            } else {
              docLines.splice(
                row,
                endRow - row + 1,
                line.substring(0, startColumn) + docLines[endRow].substring(endColumn)
              );
            }
            break;
        }
      };
    }
  });

  // ../../node_modules/ace-code/src/lib/event_emitter.js
  var require_event_emitter = __commonJS({
    "../../node_modules/ace-code/src/lib/event_emitter.js"(exports) {
      "use strict";
      var EventEmitter2 = {};
      var stopPropagation = function() {
        this.propagationStopped = true;
      };
      var preventDefault = function() {
        this.defaultPrevented = true;
      };
      EventEmitter2._emit = EventEmitter2._dispatchEvent = function(eventName, e) {
        this._eventRegistry || (this._eventRegistry = {});
        this._defaultHandlers || (this._defaultHandlers = {});
        var listeners = this._eventRegistry[eventName] || [];
        var defaultHandler = this._defaultHandlers[eventName];
        if (!listeners.length && !defaultHandler)
          return;
        if (typeof e != "object" || !e)
          e = {};
        if (!e.type)
          e.type = eventName;
        if (!e.stopPropagation)
          e.stopPropagation = stopPropagation;
        if (!e.preventDefault)
          e.preventDefault = preventDefault;
        listeners = listeners.slice();
        for (var i = 0; i < listeners.length; i++) {
          listeners[i](e, this);
          if (e.propagationStopped)
            break;
        }
        if (defaultHandler && !e.defaultPrevented)
          return defaultHandler(e, this);
      };
      EventEmitter2._signal = function(eventName, e) {
        var listeners = (this._eventRegistry || {})[eventName];
        if (!listeners)
          return;
        listeners = listeners.slice();
        for (var i = 0; i < listeners.length; i++)
          listeners[i](e, this);
      };
      EventEmitter2.once = function(eventName, callback) {
        var _self = this;
        this.on(eventName, function newCallback() {
          _self.off(eventName, newCallback);
          callback.apply(null, arguments);
        });
        if (!callback) {
          return new Promise(function(resolve) {
            callback = resolve;
          });
        }
      };
      EventEmitter2.setDefaultHandler = function(eventName, callback) {
        var handlers = this._defaultHandlers;
        if (!handlers)
          handlers = this._defaultHandlers = { _disabled_: {} };
        if (handlers[eventName]) {
          var old = handlers[eventName];
          var disabled = handlers._disabled_[eventName];
          if (!disabled)
            handlers._disabled_[eventName] = disabled = [];
          disabled.push(old);
          var i = disabled.indexOf(callback);
          if (i != -1)
            disabled.splice(i, 1);
        }
        handlers[eventName] = callback;
      };
      EventEmitter2.removeDefaultHandler = function(eventName, callback) {
        var handlers = this._defaultHandlers;
        if (!handlers)
          return;
        var disabled = handlers._disabled_[eventName];
        if (handlers[eventName] == callback) {
          if (disabled)
            this.setDefaultHandler(eventName, disabled.pop());
        } else if (disabled) {
          var i = disabled.indexOf(callback);
          if (i != -1)
            disabled.splice(i, 1);
        }
      };
      EventEmitter2.on = EventEmitter2.addEventListener = function(eventName, callback, capturing) {
        this._eventRegistry = this._eventRegistry || {};
        var listeners = this._eventRegistry[eventName];
        if (!listeners)
          listeners = this._eventRegistry[eventName] = [];
        if (listeners.indexOf(callback) == -1)
          listeners[capturing ? "unshift" : "push"](callback);
        return callback;
      };
      EventEmitter2.off = EventEmitter2.removeListener = EventEmitter2.removeEventListener = function(eventName, callback) {
        this._eventRegistry = this._eventRegistry || {};
        var listeners = this._eventRegistry[eventName];
        if (!listeners)
          return;
        var index = listeners.indexOf(callback);
        if (index !== -1)
          listeners.splice(index, 1);
      };
      EventEmitter2.removeAllListeners = function(eventName) {
        if (!eventName) this._eventRegistry = this._defaultHandlers = void 0;
        if (this._eventRegistry) this._eventRegistry[eventName] = void 0;
        if (this._defaultHandlers) this._defaultHandlers[eventName] = void 0;
      };
      exports.EventEmitter = EventEmitter2;
    }
  });

  // ../../node_modules/ace-code/src/range.js
  var require_range = __commonJS({
    "../../node_modules/ace-code/src/range.js"(exports) {
      "use strict";
      var Range2 = class _Range {
        /**
         * Creates a new `Range` object with the given starting and ending rows and columns.
         * @param {Number} [startRow] The starting row
         * @param {Number} [startColumn] The starting column
         * @param {Number} [endRow] The ending row
         * @param {Number} [endColumn] The ending column
         * @constructor
         **/
        constructor(startRow, startColumn, endRow, endColumn) {
          this.start = {
            row: startRow,
            column: startColumn
          };
          this.end = {
            row: endRow,
            column: endColumn
          };
        }
        /**
         * Returns `true` if and only if the starting row and column, and ending row and column, are equivalent to those given by `range`.
         * @param {IRange} range A range to check against
         * @return {Boolean}
         **/
        isEqual(range) {
          return this.start.row === range.start.row && this.end.row === range.end.row && this.start.column === range.start.column && this.end.column === range.end.column;
        }
        /**
         * Returns a string containing the range's row and column information, given like this:
         * ```
         *    [start.row/start.column] -> [end.row/end.column]
         * ```
         * @return {String}
         **/
        toString() {
          return "Range: [" + this.start.row + "/" + this.start.column + "] -> [" + this.end.row + "/" + this.end.column + "]";
        }
        /**
         * Returns `true` if the `row` and `column` provided are within the given range. This can better be expressed as returning `true` if:
         * ```javascript
         *    this.start.row <= row <= this.end.row &&
         *    this.start.column <= column <= this.end.column
         * ```
         * @param {Number} row A row to check for
         * @param {Number} column A column to check for
         * @returns {Boolean}
         * @related [[Range.compare]]
         **/
        contains(row, column) {
          return this.compare(row, column) == 0;
        }
        /**
         * Compares `this` range (A) with another range (B).
         * @param {IRange} range A range to compare with
         * @related [[Range.compare]]
         * @returns {Number} This method returns one of the following numbers:
         * * `-2`: (B) is in front of (A), and doesn't intersect with (A)
         * * `-1`: (B) begins before (A) but ends inside of (A)
         * * `0`: (B) is completely inside of (A)
         * * `+1`: (B) begins inside of (A) but ends outside of (A)
         * * `+2`: (B) is after (A) and doesn't intersect with (A)
         * * `42`: FTW state: (B) ends in (A) but starts outside of (A)
         **/
        compareRange(range) {
          var cmp, end = range.end, start = range.start;
          cmp = this.compare(end.row, end.column);
          if (cmp == 1) {
            cmp = this.compare(start.row, start.column);
            if (cmp == 1) {
              return 2;
            } else if (cmp == 0) {
              return 1;
            } else {
              return 0;
            }
          } else if (cmp == -1) {
            return -2;
          } else {
            cmp = this.compare(start.row, start.column);
            if (cmp == -1) {
              return -1;
            } else if (cmp == 1) {
              return 42;
            } else {
              return 0;
            }
          }
        }
        /**
         * Compares the row and column of `p` with the starting and ending [[Point]]'s of the calling range (by calling [[Range.compare]]).
         * @param {Point} p A point to compare with
         * @related [[Range.compare]]
         * @returns {Number}
         **/
        comparePoint(p) {
          return this.compare(p.row, p.column);
        }
        /**
         * Checks the start and end [[Point]]'s of `range` and compares them to the calling range. Returns `true` if the `range` is contained within the caller's range.
         * @param {IRange} range A range to compare with
         * @returns {Boolean}
         * @related [[Range.comparePoint]]
         **/
        containsRange(range) {
          return this.comparePoint(range.start) == 0 && this.comparePoint(range.end) == 0;
        }
        /**
         * Returns `true` if passed in `range` intersects with the one calling this method.
         * @param {IRange} range A range to compare with
         * @returns {Boolean}
         **/
        intersects(range) {
          var cmp = this.compareRange(range);
          return cmp == -1 || cmp == 0 || cmp == 1;
        }
        /**
         * Returns `true` if the caller's ending row is the same as `row`, and if the caller's ending column is the same as `column`.
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Boolean}
         **/
        isEnd(row, column) {
          return this.end.row == row && this.end.column == column;
        }
        /**
         * Returns `true` if the caller's starting row is the same as `row`, and if the caller's starting column is the same as `column`.
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Boolean}
         **/
        isStart(row, column) {
          return this.start.row == row && this.start.column == column;
        }
        /**
         * Sets the starting row and column for the range.
         * @param {Number|Point} row A row to set
         * @param {Number} [column] A column to set
         *
         **/
        setStart(row, column) {
          if (typeof row == "object") {
            this.start.column = row.column;
            this.start.row = row.row;
          } else {
            this.start.row = row;
            this.start.column = column;
          }
        }
        /**
         * Sets the starting row and column for the range.
         * @param {Number|Point} row A row to set
         * @param {Number} [column] A column to set
         *
         **/
        setEnd(row, column) {
          if (typeof row == "object") {
            this.end.column = row.column;
            this.end.row = row.row;
          } else {
            this.end.row = row;
            this.end.column = column;
          }
        }
        /**
         * Returns `true` if the `row` and `column` are within the given range.
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Boolean}
         * @related [[Range.compare]]
         **/
        inside(row, column) {
          if (this.compare(row, column) == 0) {
            if (this.isEnd(row, column) || this.isStart(row, column)) {
              return false;
            } else {
              return true;
            }
          }
          return false;
        }
        /**
         * Returns `true` if the `row` and `column` are within the given range's starting [[Point]].
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Boolean}
         * @related [[Range.compare]]
         **/
        insideStart(row, column) {
          if (this.compare(row, column) == 0) {
            if (this.isEnd(row, column)) {
              return false;
            } else {
              return true;
            }
          }
          return false;
        }
        /**
         * Returns `true` if the `row` and `column` are within the given range's ending [[Point]].
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Boolean}
         * @related [[Range.compare]]
         *
         **/
        insideEnd(row, column) {
          if (this.compare(row, column) == 0) {
            if (this.isStart(row, column)) {
              return false;
            } else {
              return true;
            }
          }
          return false;
        }
        /**
         * Compares the `row` and `column` with the starting and ending [[Point]]'s of the calling range.
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Number} This method returns one of the following numbers:
         * * `1` if `row` is greater than the calling range
         * * `-1` if `row` is less then the calling range
         * * `0` otherwise
         *
         * If the starting row of the calling range is equal to `row`, and:
         * * `column` is greater than or equal to the calling range's starting column, this returns `0`
         * * Otherwise, it returns -1
         *
         * If the ending row of the calling range is equal to `row`, and:
         * * `column` is less than or equal to the calling range's ending column, this returns `0`
         * * Otherwise, it returns 1
         **/
        compare(row, column) {
          if (!this.isMultiLine()) {
            if (row === this.start.row) {
              return column < this.start.column ? -1 : column > this.end.column ? 1 : 0;
            }
          }
          if (row < this.start.row)
            return -1;
          if (row > this.end.row)
            return 1;
          if (this.start.row === row)
            return column >= this.start.column ? 0 : -1;
          if (this.end.row === row)
            return column <= this.end.column ? 0 : 1;
          return 0;
        }
        /**
         * Compares the `row` and `column` with the starting and ending [[Point]]'s of the calling range.
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Number} This method returns one of the following numbers:
         * * `-1` if calling range's starting column and calling range's starting row are equal `row` and `column`
         * * Otherwise, it returns the value after calling [[Range.compare `compare()`]].
         **/
        compareStart(row, column) {
          if (this.start.row == row && this.start.column == column) {
            return -1;
          } else {
            return this.compare(row, column);
          }
        }
        /**
         * Compares the `row` and `column` with the starting and ending [[Point]]'s of the calling range.
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Number} This method returns one of the following numbers:
         * * `1` if calling range's ending column and calling range's ending row are equal `row` and `column`.
         * * Otherwise, it returns the value after calling [[Range.compare `compare()`]].
         */
        compareEnd(row, column) {
          if (this.end.row == row && this.end.column == column) {
            return 1;
          } else {
            return this.compare(row, column);
          }
        }
        /**
         * Compares the `row` and `column` with the start and end [[Point]]'s of the calling range.
         * @param {Number} row A row to compare with
         * @param {Number} column A column to compare with
         * @returns {Number} This method returns one of the following numbers:
         * * `1` if the ending row of the calling range is equal to `row`, and the ending column of the calling range is equal to `column`
         * * `-1` if the starting row of the calling range is equal to `row`, and the starting column of the calling range is equal to `column`
         * * Otherwise, it returns the value after calling [[Range.compare `compare()`]].
         **/
        compareInside(row, column) {
          if (this.end.row == row && this.end.column == column) {
            return 1;
          } else if (this.start.row == row && this.start.column == column) {
            return -1;
          } else {
            return this.compare(row, column);
          }
        }
        /**
         * Returns the part of the current `Range` that occurs within the boundaries of `firstRow` and `lastRow` as a new `Range` object.
         * @param {Number} firstRow The starting row
         * @param {Number} lastRow The ending row
         * @returns {Range}
        **/
        clipRows(firstRow, lastRow) {
          if (this.end.row > lastRow)
            var end = { row: lastRow + 1, column: 0 };
          else if (this.end.row < firstRow)
            var end = { row: firstRow, column: 0 };
          if (this.start.row > lastRow)
            var start = { row: lastRow + 1, column: 0 };
          else if (this.start.row < firstRow)
            var start = { row: firstRow, column: 0 };
          return _Range.fromPoints(start || this.start, end || this.end);
        }
        /**
         * Changes the `row` and `column` for the calling range for both the starting and ending [[Point]]'s.
         * @param {Number} row A new row to extend to
         * @param {Number} column A new column to extend to
         * @returns {Range} The original range with the new row
        **/
        extend(row, column) {
          var cmp = this.compare(row, column);
          if (cmp == 0)
            return this;
          else if (cmp == -1)
            var start = { row, column };
          else
            var end = { row, column };
          return _Range.fromPoints(start || this.start, end || this.end);
        }
        /**
         * Returns `true` if the calling range is empty (starting [[Point]] == ending [[Point]]).
         * @returns {Boolean}
         **/
        isEmpty() {
          return this.start.row === this.end.row && this.start.column === this.end.column;
        }
        /**
         * Returns `true` if the range spans across multiple lines.
         * @returns {Boolean}
        **/
        isMultiLine() {
          return this.start.row !== this.end.row;
        }
        /**
         * Returns a duplicate of the calling range.
         * @returns {Range}
        **/
        clone() {
          return _Range.fromPoints(this.start, this.end);
        }
        /**
         * Returns a range containing the starting and ending rows of the original range, but with a column value of `0`.
         * @returns {Range}
        **/
        collapseRows() {
          if (this.end.column == 0)
            return new _Range(this.start.row, 0, Math.max(this.start.row, this.end.row - 1), 0);
          else
            return new _Range(this.start.row, 0, this.end.row, 0);
        }
        /**
         * Given the current `Range`, this function converts those starting and ending [[Point]]'s into screen positions, and then returns a new `Range` object.
         * @param {EditSession} session The `EditSession` to retrieve coordinates from
         * @returns {Range}
        **/
        toScreenRange(session) {
          var screenPosStart = session.documentToScreenPosition(this.start);
          var screenPosEnd = session.documentToScreenPosition(this.end);
          return new _Range(
            screenPosStart.row,
            screenPosStart.column,
            screenPosEnd.row,
            screenPosEnd.column
          );
        }
        /**
         * Shift the calling range by `row` and `column` values.
         * @param {Number} row
         * @param {Number} column
         * @experimental
         */
        moveBy(row, column) {
          this.start.row += row;
          this.start.column += column;
          this.end.row += row;
          this.end.column += column;
        }
      };
      Range2.fromPoints = function(start, end) {
        return new Range2(start.row, start.column, end.row, end.column);
      };
      Range2.comparePoints = function(p1, p2) {
        return p1.row - p2.row || p1.column - p2.column;
      };
      exports.Range = Range2;
    }
  });

  // src/workers/yaml-worker.ts
  var yaml_worker_exports = {};
  __export(yaml_worker_exports, {
    YamlWorker: () => YamlWorker
  });

  // src/mirror.ts
  var lang = __toESM(require_lang());

  // src/min-document.ts
  var oop = require_oop();
  var applyDelta = require_apply_delta().applyDelta;
  var EventEmitter = require_event_emitter().EventEmitter;
  var Range = require_range().Range;
  var MinDocument = class {
    constructor(textOrLines) {
      this.$autoNewLine = "";
      this.$newLineMode = "auto";
      this.$lines = [""];
      if (textOrLines.length === 0) {
        this.$lines = [""];
      } else if (Array.isArray(textOrLines)) {
        this.insertMergedLines({ row: 0, column: 0 }, textOrLines);
      } else {
        this.insert({ row: 0, column: 0 }, textOrLines);
      }
    }
    setValue(text) {
      var len = this.getLength() - 1;
      this.remove(new Range(0, 0, len, this.getLine(len).length));
      this.insert({ row: 0, column: 0 }, text || "");
    }
    getValue() {
      return this.getAllLines().join(this.getNewLineCharacter());
    }
    $detectNewLine(text) {
      var match = text.match(/^.*?(\r\n|\r|\n)/m);
      this.$autoNewLine = match ? match[1] : "\n";
      this._signal("changeNewLineMode");
    }
    getNewLineCharacter() {
      switch (this.$newLineMode) {
        case "windows":
          return "\r\n";
        case "unix":
          return "\n";
        default:
          return this.$autoNewLine || "\n";
      }
    }
    setNewLineMode(newLineMode) {
      if (this.$newLineMode === newLineMode)
        return;
      this.$newLineMode = newLineMode;
      this._signal("changeNewLineMode");
    }
    getNewLineMode() {
      return this.$newLineMode;
    }
    isNewLine(text) {
      return text == "\r\n" || text == "\r" || text == "\n";
    }
    getLine(row) {
      return this.$lines[row] || "";
    }
    getLines(firstRow, lastRow) {
      return this.$lines.slice(firstRow, lastRow + 1);
    }
    getAllLines() {
      return this.getLines(0, this.getLength());
    }
    getLength() {
      return this.$lines.length;
    }
    getTextRange(range) {
      return this.getLinesForRange(range).join(this.getNewLineCharacter());
    }
    getLinesForRange(range) {
      var lines;
      if (range.start.row === range.end.row) {
        lines = [this.getLine(range.start.row).substring(range.start.column, range.end.column)];
      } else {
        lines = this.getLines(range.start.row, range.end.row);
        lines[0] = (lines[0] || "").substring(range.start.column);
        var l = lines.length - 1;
        if (range.end.row - range.start.row == l)
          lines[l] = lines[l].substring(0, range.end.column);
      }
      return lines;
    }
    insert(position, text) {
      if (this.getLength() <= 1)
        this.$detectNewLine(text);
      return this.insertMergedLines(position, this.$split(text));
    }
    insertInLine(position, text) {
      var start = this.clippedPos(position.row, position.column);
      var end = this.pos(position.row, position.column + text.length);
      this.applyDelta({
        start,
        end,
        action: "insert",
        lines: [text]
      }, true);
      return this.clonePos(end);
    }
    clippedPos(row, column) {
      var length = this.getLength();
      if (row === void 0) {
        row = length;
      } else if (row < 0) {
        row = 0;
      } else if (row >= length) {
        row = length - 1;
        column = void 0;
      }
      var line = this.getLine(row);
      if (column == void 0)
        column = line.length;
      column = Math.min(Math.max(column, 0), line.length);
      return { row, column };
    }
    clonePos(pos) {
      return { row: pos.row, column: pos.column };
    }
    pos(row, column) {
      return { row, column };
    }
    $clipPosition(position) {
      var length = this.getLength();
      if (position.row >= length) {
        position.row = Math.max(0, length - 1);
        position.column = this.getLine(length - 1).length;
      } else {
        position.row = Math.max(0, position.row);
        position.column = Math.min(Math.max(position.column, 0), this.getLine(position.row).length);
      }
      return position;
    }
    insertFullLines(row, lines) {
      row = Math.min(Math.max(row, 0), this.getLength());
      var column = 0;
      if (row < this.getLength()) {
        lines = lines.concat([""]);
        column = 0;
      } else {
        lines = [""].concat(lines);
        row--;
        column = this.$lines[row].length;
      }
      this.insertMergedLines({ row, column }, lines);
    }
    insertMergedLines(position, lines) {
      var start = this.clippedPos(position.row, position.column);
      var end = {
        row: start.row + lines.length - 1,
        column: (lines.length == 1 ? start.column : 0) + lines[lines.length - 1].length
      };
      this.applyDelta({
        start,
        end,
        action: "insert",
        lines
      });
      return this.clonePos(end);
    }
    remove(range) {
      var start = this.clippedPos(range.start.row, range.start.column);
      var end = this.clippedPos(range.end.row, range.end.column);
      this.applyDelta({
        start,
        end,
        action: "remove",
        lines: this.getLinesForRange({ start, end })
      });
      return this.clonePos(start);
    }
    removeInLine(row, startColumn, endColumn) {
      var start = this.clippedPos(row, startColumn);
      var end = this.clippedPos(row, endColumn);
      this.applyDelta({
        start,
        end,
        action: "remove",
        lines: this.getLinesForRange({ start, end })
      }, true);
      return this.clonePos(start);
    }
    removeFullLines(firstRow, lastRow) {
      firstRow = Math.min(Math.max(0, firstRow), this.getLength() - 1);
      lastRow = Math.min(Math.max(0, lastRow), this.getLength() - 1);
      var deleteFirstNewLine = lastRow == this.getLength() - 1 && firstRow > 0;
      var deleteLastNewLine = lastRow < this.getLength() - 1;
      var startRow = deleteFirstNewLine ? firstRow - 1 : firstRow;
      var startCol = deleteFirstNewLine ? this.getLine(startRow).length : 0;
      var endRow = deleteLastNewLine ? lastRow + 1 : lastRow;
      var endCol = deleteLastNewLine ? 0 : this.getLine(endRow).length;
      var range = new Range(startRow, startCol, endRow, endCol);
      var deletedLines = this.$lines.slice(firstRow, lastRow + 1);
      this.applyDelta({
        start: range.start,
        end: range.end,
        action: "remove",
        lines: this.getLinesForRange(range)
      });
      return deletedLines;
    }
    removeNewLine(row) {
      if (row < this.getLength() - 1 && row >= 0) {
        this.applyDelta({
          start: this.pos(row, this.getLine(row).length),
          end: this.pos(row + 1, 0),
          action: "remove",
          lines: ["", ""]
        });
      }
    }
    replace(range, text) {
      if (!(range instanceof Range))
        range = Range.fromPoints(range.start, range.end);
      if (text.length === 0 && range.isEmpty())
        return range.start;
      if (text == this.getTextRange(range))
        return range.end;
      this.remove(range);
      var end;
      if (text) {
        end = this.insert(range.start, text);
      } else {
        end = range.start;
      }
      return end;
    }
    applyDeltas(deltas) {
      for (var i = 0; i < deltas.length; i++) {
        this.applyDelta(deltas[i]);
      }
    }
    revertDeltas(deltas) {
      for (var i = deltas.length - 1; i >= 0; i--) {
        this.revertDelta(deltas[i]);
      }
    }
    /**
     * Applies `delta` to the document.
     * @param {Delta} delta A delta object (can include "insert" and "remove" actions)
     * @param {boolean} [doNotValidate]
     **/
    applyDelta(delta, doNotValidate) {
      var isInsert = delta.action == "insert";
      if (isInsert ? delta.lines.length <= 1 && !delta.lines[0] : !Range.comparePoints(delta.start, delta.end)) {
        return;
      }
      if (isInsert && delta.lines.length > 2e4) {
        this.$splitAndapplyLargeDelta(delta, 2e4);
      } else {
        applyDelta(this.$lines, delta, doNotValidate);
        this._signal("change", delta);
      }
    }
    /**
     * @param {Delta} delta
     */
    $safeApplyDelta(delta) {
      var docLength = this.$lines.length;
      if (delta.action == "remove" && delta.start.row < docLength && delta.end.row < docLength || delta.action == "insert" && delta.start.row <= docLength) {
        this.applyDelta(delta);
      }
    }
    $splitAndapplyLargeDelta(delta, MAX) {
      var lines = delta.lines;
      var l = lines.length - MAX + 1;
      var row = delta.start.row;
      var column = delta.start.column;
      for (var from = 0, to = 0; from < l; from = to) {
        to += MAX - 1;
        var chunk = lines.slice(from, to);
        chunk.push("");
        this.applyDelta({
          start: this.pos(row + from, column),
          end: this.pos(row + to, column = 0),
          action: delta.action,
          lines: chunk
        }, true);
      }
      delta.lines = lines.slice(from);
      delta.start.row = row + from;
      delta.start.column = column;
      this.applyDelta(delta, true);
    }
    revertDelta(delta) {
      this.$safeApplyDelta({
        start: this.clonePos(delta.start),
        end: this.clonePos(delta.end),
        action: delta.action == "insert" ? "remove" : "insert",
        lines: delta.lines.slice()
      });
    }
    indexToPosition(index, startRow) {
      var lines = this.$lines || this.getAllLines();
      var newlineLength = this.getNewLineCharacter().length;
      for (var i = startRow || 0, l = lines.length; i < l; i++) {
        index -= lines[i].length + newlineLength;
        if (index < 0)
          return { row: i, column: index + lines[i].length + newlineLength };
      }
      return { row: l - 1, column: index + lines[l - 1].length + newlineLength };
    }
    positionToIndex(pos, startRow) {
      var lines = this.$lines || this.getAllLines();
      var newlineLength = this.getNewLineCharacter().length;
      var index = 0;
      var row = Math.min(pos.row, lines.length);
      for (var i = startRow || 0; i < row; ++i)
        index += lines[i].length + newlineLength;
      return index + pos.column;
    }
    $split(text) {
      return text.split(/\r\n|\r|\n/);
    }
  };
  oop.implement(MinDocument.prototype, EventEmitter);

  // src/mirror.ts
  var Mirror = class {
    constructor(sender) {
      this.$timeout = 500;
      this.sender = sender;
      var doc = this.doc = new MinDocument("");
      var deferredUpdate = this.deferredUpdate = lang.delayedCall(
        this.onUpdate.bind(this)
      );
      var _self = this;
      sender.on("change", function(e) {
        var data = e.data;
        if (data[0].start) {
          doc.applyDeltas(data);
        } else {
          for (var i = 0; i < data.length; i += 2) {
            var d, err;
            if (Array.isArray(data[i + 1])) {
              d = { action: "insert", start: data[i], lines: data[i + 1] };
            } else {
              d = { action: "remove", start: data[i], end: data[i + 1] };
            }
            if ((d.action == "insert" ? d.start : d.end).row >= doc["$lines"].length) {
              err = new Error("Invalid delta");
              err.data = {
                path: _self.$path,
                linesLength: doc["$lines"].length,
                start: d.start,
                end: d.end
              };
              throw err;
            }
            doc.applyDelta(d, true);
          }
        }
        if (_self.$timeout) return deferredUpdate.schedule(_self.$timeout);
        _self.onUpdate();
      });
    }
    setTimeout(timeout) {
      this.$timeout = timeout;
    }
    setValue(value) {
      this.doc.setValue(value);
      this.deferredUpdate.schedule(this.$timeout);
    }
    getValue(callbackId) {
      this.sender.callback(this.doc.getValue(), callbackId);
    }
    isPending() {
      return this.deferredUpdate.isPending();
    }
  };

  // node_modules/yaml/browser/dist/nodes/identity.js
  var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
  var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
  var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
  var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
  var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
  var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
  var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
  var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
  var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
  var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
  var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
  var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
  var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
  function isCollection(node) {
    if (node && typeof node === "object")
      switch (node[NODE_TYPE]) {
        case MAP:
        case SEQ:
          return true;
      }
    return false;
  }
  function isNode(node) {
    if (node && typeof node === "object")
      switch (node[NODE_TYPE]) {
        case ALIAS:
        case MAP:
        case SCALAR:
        case SEQ:
          return true;
      }
    return false;
  }
  var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;

  // node_modules/yaml/browser/dist/visit.js
  var BREAK = /* @__PURE__ */ Symbol("break visit");
  var SKIP = /* @__PURE__ */ Symbol("skip children");
  var REMOVE = /* @__PURE__ */ Symbol("remove node");
  function visit(node, visitor) {
    const visitor_ = initVisitor(visitor);
    if (isDocument(node)) {
      const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
      if (cd === REMOVE)
        node.contents = null;
    } else
      visit_(null, node, visitor_, Object.freeze([]));
  }
  visit.BREAK = BREAK;
  visit.SKIP = SKIP;
  visit.REMOVE = REMOVE;
  function visit_(key, node, visitor, path) {
    const ctrl = callVisitor(key, node, visitor, path);
    if (isNode(ctrl) || isPair(ctrl)) {
      replaceNode(key, path, ctrl);
      return visit_(key, ctrl, visitor, path);
    }
    if (typeof ctrl !== "symbol") {
      if (isCollection(node)) {
        path = Object.freeze(path.concat(node));
        for (let i = 0; i < node.items.length; ++i) {
          const ci = visit_(i, node.items[i], visitor, path);
          if (typeof ci === "number")
            i = ci - 1;
          else if (ci === BREAK)
            return BREAK;
          else if (ci === REMOVE) {
            node.items.splice(i, 1);
            i -= 1;
          }
        }
      } else if (isPair(node)) {
        path = Object.freeze(path.concat(node));
        const ck = visit_("key", node.key, visitor, path);
        if (ck === BREAK)
          return BREAK;
        else if (ck === REMOVE)
          node.key = null;
        const cv = visit_("value", node.value, visitor, path);
        if (cv === BREAK)
          return BREAK;
        else if (cv === REMOVE)
          node.value = null;
      }
    }
    return ctrl;
  }
  function visitAsync(node, visitor) {
    return __async(this, null, function* () {
      const visitor_ = initVisitor(visitor);
      if (isDocument(node)) {
        const cd = yield visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        yield visitAsync_(null, node, visitor_, Object.freeze([]));
    });
  }
  visitAsync.BREAK = BREAK;
  visitAsync.SKIP = SKIP;
  visitAsync.REMOVE = REMOVE;
  function visitAsync_(key, node, visitor, path) {
    return __async(this, null, function* () {
      const ctrl = yield callVisitor(key, node, visitor, path);
      if (isNode(ctrl) || isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = yield visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = yield visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = yield visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    });
  }
  function initVisitor(visitor) {
    if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
      return Object.assign({
        Alias: visitor.Node,
        Map: visitor.Node,
        Scalar: visitor.Node,
        Seq: visitor.Node
      }, visitor.Value && {
        Map: visitor.Value,
        Scalar: visitor.Value,
        Seq: visitor.Value
      }, visitor.Collection && {
        Map: visitor.Collection,
        Seq: visitor.Collection
      }, visitor);
    }
    return visitor;
  }
  function callVisitor(key, node, visitor, path) {
    var _a, _b, _c, _d, _e;
    if (typeof visitor === "function")
      return visitor(key, node, path);
    if (isMap(node))
      return (_a = visitor.Map) == null ? void 0 : _a.call(visitor, key, node, path);
    if (isSeq(node))
      return (_b = visitor.Seq) == null ? void 0 : _b.call(visitor, key, node, path);
    if (isPair(node))
      return (_c = visitor.Pair) == null ? void 0 : _c.call(visitor, key, node, path);
    if (isScalar(node))
      return (_d = visitor.Scalar) == null ? void 0 : _d.call(visitor, key, node, path);
    if (isAlias(node))
      return (_e = visitor.Alias) == null ? void 0 : _e.call(visitor, key, node, path);
    return void 0;
  }
  function replaceNode(key, path, node) {
    const parent = path[path.length - 1];
    if (isCollection(parent)) {
      parent.items[key] = node;
    } else if (isPair(parent)) {
      if (key === "key")
        parent.key = node;
      else
        parent.value = node;
    } else if (isDocument(parent)) {
      parent.contents = node;
    } else {
      const pt = isAlias(parent) ? "alias" : "scalar";
      throw new Error(`Cannot replace node with ${pt} parent`);
    }
  }

  // node_modules/yaml/browser/dist/doc/directives.js
  var escapeChars = {
    "!": "%21",
    ",": "%2C",
    "[": "%5B",
    "]": "%5D",
    "{": "%7B",
    "}": "%7D"
  };
  var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
  var Directives = class _Directives {
    constructor(yaml, tags) {
      this.docStart = null;
      this.docEnd = false;
      this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
      this.tags = Object.assign({}, _Directives.defaultTags, tags);
    }
    clone() {
      const copy = new _Directives(this.yaml, this.tags);
      copy.docStart = this.docStart;
      return copy;
    }
    /**
     * During parsing, get a Directives instance for the current document and
     * update the stream state according to the current version's spec.
     */
    atDocument() {
      const res = new _Directives(this.yaml, this.tags);
      switch (this.yaml.version) {
        case "1.1":
          this.atNextDocument = true;
          break;
        case "1.2":
          this.atNextDocument = false;
          this.yaml = {
            explicit: _Directives.defaultYaml.explicit,
            version: "1.2"
          };
          this.tags = Object.assign({}, _Directives.defaultTags);
          break;
      }
      return res;
    }
    /**
     * @param onError - May be called even if the action was successful
     * @returns `true` on success
     */
    add(line, onError) {
      if (this.atNextDocument) {
        this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
        this.tags = Object.assign({}, _Directives.defaultTags);
        this.atNextDocument = false;
      }
      const parts = line.trim().split(/[ \t]+/);
      const name = parts.shift();
      switch (name) {
        case "%TAG": {
          if (parts.length !== 2) {
            onError(0, "%TAG directive should contain exactly two parts");
            if (parts.length < 2)
              return false;
          }
          const [handle, prefix] = parts;
          this.tags[handle] = prefix;
          return true;
        }
        case "%YAML": {
          this.yaml.explicit = true;
          if (parts.length !== 1) {
            onError(0, "%YAML directive should contain exactly one part");
            return false;
          }
          const [version] = parts;
          if (version === "1.1" || version === "1.2") {
            this.yaml.version = version;
            return true;
          } else {
            const isValid = /^\d+\.\d+$/.test(version);
            onError(6, `Unsupported YAML version ${version}`, isValid);
            return false;
          }
        }
        default:
          onError(0, `Unknown directive ${name}`, true);
          return false;
      }
    }
    /**
     * Resolves a tag, matching handles to those defined in %TAG directives.
     *
     * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
     *   `'!local'` tag, or `null` if unresolvable.
     */
    tagName(source, onError) {
      if (source === "!")
        return "!";
      if (source[0] !== "!") {
        onError(`Not a valid tag: ${source}`);
        return null;
      }
      if (source[1] === "<") {
        const verbatim = source.slice(2, -1);
        if (verbatim === "!" || verbatim === "!!") {
          onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
          return null;
        }
        if (source[source.length - 1] !== ">")
          onError("Verbatim tags must end with a >");
        return verbatim;
      }
      const [, handle, suffix] = source.match(new RegExp("^(.*!)([^!]*)$", "s"));
      if (!suffix)
        onError(`The ${source} tag has no suffix`);
      const prefix = this.tags[handle];
      if (prefix) {
        try {
          return prefix + decodeURIComponent(suffix);
        } catch (error) {
          onError(String(error));
          return null;
        }
      }
      if (handle === "!")
        return source;
      onError(`Could not resolve tag: ${source}`);
      return null;
    }
    /**
     * Given a fully resolved tag, returns its printable string form,
     * taking into account current tag prefixes and defaults.
     */
    tagString(tag) {
      for (const [handle, prefix] of Object.entries(this.tags)) {
        if (tag.startsWith(prefix))
          return handle + escapeTagName(tag.substring(prefix.length));
      }
      return tag[0] === "!" ? tag : `!<${tag}>`;
    }
    toString(doc) {
      const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
      const tagEntries = Object.entries(this.tags);
      let tagNames;
      if (doc && tagEntries.length > 0 && isNode(doc.contents)) {
        const tags = {};
        visit(doc.contents, (_key, node) => {
          if (isNode(node) && node.tag)
            tags[node.tag] = true;
        });
        tagNames = Object.keys(tags);
      } else
        tagNames = [];
      for (const [handle, prefix] of tagEntries) {
        if (handle === "!!" && prefix === "tag:yaml.org,2002:")
          continue;
        if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
          lines.push(`%TAG ${handle} ${prefix}`);
      }
      return lines.join("\n");
    }
  };
  Directives.defaultYaml = { explicit: false, version: "1.2" };
  Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };

  // node_modules/yaml/browser/dist/doc/anchors.js
  function anchorIsValid(anchor) {
    if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
      const sa = JSON.stringify(anchor);
      const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
      throw new Error(msg);
    }
    return true;
  }
  function anchorNames(root) {
    const anchors = /* @__PURE__ */ new Set();
    visit(root, {
      Value(_key, node) {
        if (node.anchor)
          anchors.add(node.anchor);
      }
    });
    return anchors;
  }
  function findNewAnchor(prefix, exclude) {
    for (let i = 1; true; ++i) {
      const name = `${prefix}${i}`;
      if (!exclude.has(name))
        return name;
    }
  }
  function createNodeAnchors(doc, prefix) {
    const aliasObjects = [];
    const sourceObjects = /* @__PURE__ */ new Map();
    let prevAnchors = null;
    return {
      onAnchor: (source) => {
        aliasObjects.push(source);
        prevAnchors != null ? prevAnchors : prevAnchors = anchorNames(doc);
        const anchor = findNewAnchor(prefix, prevAnchors);
        prevAnchors.add(anchor);
        return anchor;
      },
      /**
       * With circular references, the source node is only resolved after all
       * of its child nodes are. This is why anchors are set only after all of
       * the nodes have been created.
       */
      setAnchors: () => {
        for (const source of aliasObjects) {
          const ref = sourceObjects.get(source);
          if (typeof ref === "object" && ref.anchor && (isScalar(ref.node) || isCollection(ref.node))) {
            ref.node.anchor = ref.anchor;
          } else {
            const error = new Error("Failed to resolve repeated object (this should not happen)");
            error.source = source;
            throw error;
          }
        }
      },
      sourceObjects
    };
  }

  // node_modules/yaml/browser/dist/doc/applyReviver.js
  function applyReviver(reviver, obj, key, val) {
    if (val && typeof val === "object") {
      if (Array.isArray(val)) {
        for (let i = 0, len = val.length; i < len; ++i) {
          const v0 = val[i];
          const v1 = applyReviver(reviver, val, String(i), v0);
          if (v1 === void 0)
            delete val[i];
          else if (v1 !== v0)
            val[i] = v1;
        }
      } else if (val instanceof Map) {
        for (const k of Array.from(val.keys())) {
          const v0 = val.get(k);
          const v1 = applyReviver(reviver, val, k, v0);
          if (v1 === void 0)
            val.delete(k);
          else if (v1 !== v0)
            val.set(k, v1);
        }
      } else if (val instanceof Set) {
        for (const v0 of Array.from(val)) {
          const v1 = applyReviver(reviver, val, v0, v0);
          if (v1 === void 0)
            val.delete(v0);
          else if (v1 !== v0) {
            val.delete(v0);
            val.add(v1);
          }
        }
      } else {
        for (const [k, v0] of Object.entries(val)) {
          const v1 = applyReviver(reviver, val, k, v0);
          if (v1 === void 0)
            delete val[k];
          else if (v1 !== v0)
            val[k] = v1;
        }
      }
    }
    return reviver.call(obj, key, val);
  }

  // node_modules/yaml/browser/dist/nodes/toJS.js
  function toJS(value, arg, ctx) {
    if (Array.isArray(value))
      return value.map((v, i) => toJS(v, String(i), ctx));
    if (value && typeof value.toJSON === "function") {
      if (!ctx || !hasAnchor(value))
        return value.toJSON(arg, ctx);
      const data = { aliasCount: 0, count: 1, res: void 0 };
      ctx.anchors.set(value, data);
      ctx.onCreate = (res2) => {
        data.res = res2;
        delete ctx.onCreate;
      };
      const res = value.toJSON(arg, ctx);
      if (ctx.onCreate)
        ctx.onCreate(res);
      return res;
    }
    if (typeof value === "bigint" && !(ctx == null ? void 0 : ctx.keep))
      return Number(value);
    return value;
  }

  // node_modules/yaml/browser/dist/nodes/Node.js
  var NodeBase = class {
    constructor(type) {
      Object.defineProperty(this, NODE_TYPE, { value: type });
    }
    /** Create a copy of this node.  */
    clone() {
      const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    /** A plain JavaScript representation of this node. */
    toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
      if (!isDocument(doc))
        throw new TypeError("A document argument is required");
      const ctx = {
        anchors: /* @__PURE__ */ new Map(),
        doc,
        keep: true,
        mapAsMap: mapAsMap === true,
        mapKeyWarned: false,
        maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
      };
      const res = toJS(this, "", ctx);
      if (typeof onAnchor === "function")
        for (const { count, res: res2 } of ctx.anchors.values())
          onAnchor(res2, count);
      return typeof reviver === "function" ? applyReviver(reviver, { "": res }, "", res) : res;
    }
  };

  // node_modules/yaml/browser/dist/nodes/Alias.js
  var Alias = class extends NodeBase {
    constructor(source) {
      super(ALIAS);
      this.source = source;
      Object.defineProperty(this, "tag", {
        set() {
          throw new Error("Alias nodes cannot have tags");
        }
      });
    }
    /**
     * Resolve the value of this alias within `doc`, finding the last
     * instance of the `source` anchor before this node.
     */
    resolve(doc, ctx) {
      let nodes;
      if (ctx == null ? void 0 : ctx.aliasResolveCache) {
        nodes = ctx.aliasResolveCache;
      } else {
        nodes = [];
        visit(doc, {
          Node: (_key, node) => {
            if (isAlias(node) || hasAnchor(node))
              nodes.push(node);
          }
        });
        if (ctx)
          ctx.aliasResolveCache = nodes;
      }
      let found = void 0;
      for (const node of nodes) {
        if (node === this)
          break;
        if (node.anchor === this.source)
          found = node;
      }
      return found;
    }
    toJSON(_arg, ctx) {
      if (!ctx)
        return { source: this.source };
      const { anchors, doc, maxAliasCount } = ctx;
      const source = this.resolve(doc, ctx);
      if (!source) {
        const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
        throw new ReferenceError(msg);
      }
      let data = anchors.get(source);
      if (!data) {
        toJS(source, null, ctx);
        data = anchors.get(source);
      }
      if ((data == null ? void 0 : data.res) === void 0) {
        const msg = "This should not happen: Alias anchor was not resolved?";
        throw new ReferenceError(msg);
      }
      if (maxAliasCount >= 0) {
        data.count += 1;
        if (data.aliasCount === 0)
          data.aliasCount = getAliasCount(doc, source, anchors);
        if (data.count * data.aliasCount > maxAliasCount) {
          const msg = "Excessive alias count indicates a resource exhaustion attack";
          throw new ReferenceError(msg);
        }
      }
      return data.res;
    }
    toString(ctx, _onComment, _onChompKeep) {
      const src = `*${this.source}`;
      if (ctx) {
        anchorIsValid(this.source);
        if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new Error(msg);
        }
        if (ctx.implicitKey)
          return `${src} `;
      }
      return src;
    }
  };
  function getAliasCount(doc, node, anchors) {
    if (isAlias(node)) {
      const source = node.resolve(doc);
      const anchor = anchors && source && anchors.get(source);
      return anchor ? anchor.count * anchor.aliasCount : 0;
    } else if (isCollection(node)) {
      let count = 0;
      for (const item of node.items) {
        const c = getAliasCount(doc, item, anchors);
        if (c > count)
          count = c;
      }
      return count;
    } else if (isPair(node)) {
      const kc = getAliasCount(doc, node.key, anchors);
      const vc = getAliasCount(doc, node.value, anchors);
      return Math.max(kc, vc);
    }
    return 1;
  }

  // node_modules/yaml/browser/dist/nodes/Scalar.js
  var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
  var Scalar = class extends NodeBase {
    constructor(value) {
      super(SCALAR);
      this.value = value;
    }
    toJSON(arg, ctx) {
      return (ctx == null ? void 0 : ctx.keep) ? this.value : toJS(this.value, arg, ctx);
    }
    toString() {
      return String(this.value);
    }
  };
  Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
  Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
  Scalar.PLAIN = "PLAIN";
  Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
  Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";

  // node_modules/yaml/browser/dist/doc/createNode.js
  var defaultTagPrefix = "tag:yaml.org,2002:";
  function findTagObject(value, tagName, tags) {
    var _a;
    if (tagName) {
      const match = tags.filter((t) => t.tag === tagName);
      const tagObj = (_a = match.find((t) => !t.format)) != null ? _a : match[0];
      if (!tagObj)
        throw new Error(`Tag ${tagName} not found`);
      return tagObj;
    }
    return tags.find((t) => {
      var _a2;
      return ((_a2 = t.identify) == null ? void 0 : _a2.call(t, value)) && !t.format;
    });
  }
  function createNode(value, tagName, ctx) {
    var _a, _b, _c, _d;
    if (isDocument(value))
      value = value.contents;
    if (isNode(value))
      return value;
    if (isPair(value)) {
      const map2 = (_b = (_a = ctx.schema[MAP]).createNode) == null ? void 0 : _b.call(_a, ctx.schema, null, ctx);
      map2.items.push(value);
      return map2;
    }
    if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
      value = value.valueOf();
    }
    const { aliasDuplicateObjects, onAnchor, onTagObj, schema: schema4, sourceObjects } = ctx;
    let ref = void 0;
    if (aliasDuplicateObjects && value && typeof value === "object") {
      ref = sourceObjects.get(value);
      if (ref) {
        (_c = ref.anchor) != null ? _c : ref.anchor = onAnchor(value);
        return new Alias(ref.anchor);
      } else {
        ref = { anchor: null, node: null };
        sourceObjects.set(value, ref);
      }
    }
    if (tagName == null ? void 0 : tagName.startsWith("!!"))
      tagName = defaultTagPrefix + tagName.slice(2);
    let tagObj = findTagObject(value, tagName, schema4.tags);
    if (!tagObj) {
      if (value && typeof value.toJSON === "function") {
        value = value.toJSON();
      }
      if (!value || typeof value !== "object") {
        const node2 = new Scalar(value);
        if (ref)
          ref.node = node2;
        return node2;
      }
      tagObj = value instanceof Map ? schema4[MAP] : Symbol.iterator in Object(value) ? schema4[SEQ] : schema4[MAP];
    }
    if (onTagObj) {
      onTagObj(tagObj);
      delete ctx.onTagObj;
    }
    const node = (tagObj == null ? void 0 : tagObj.createNode) ? tagObj.createNode(ctx.schema, value, ctx) : typeof ((_d = tagObj == null ? void 0 : tagObj.nodeClass) == null ? void 0 : _d.from) === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar(value);
    if (tagName)
      node.tag = tagName;
    else if (!tagObj.default)
      node.tag = tagObj.tag;
    if (ref)
      ref.node = node;
    return node;
  }

  // node_modules/yaml/browser/dist/nodes/Collection.js
  function collectionFromPath(schema4, path, value) {
    let v = value;
    for (let i = path.length - 1; i >= 0; --i) {
      const k = path[i];
      if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
        const a = [];
        a[k] = v;
        v = a;
      } else {
        v = /* @__PURE__ */ new Map([[k, v]]);
      }
    }
    return createNode(v, void 0, {
      aliasDuplicateObjects: false,
      keepUndefined: false,
      onAnchor: () => {
        throw new Error("This should not happen, please report a bug.");
      },
      schema: schema4,
      sourceObjects: /* @__PURE__ */ new Map()
    });
  }
  var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
  var Collection = class extends NodeBase {
    constructor(type, schema4) {
      super(type);
      Object.defineProperty(this, "schema", {
        value: schema4,
        configurable: true,
        enumerable: false,
        writable: true
      });
    }
    /**
     * Create a copy of this collection.
     *
     * @param schema - If defined, overwrites the original's schema
     */
    clone(schema4) {
      const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
      if (schema4)
        copy.schema = schema4;
      copy.items = copy.items.map((it) => isNode(it) || isPair(it) ? it.clone(schema4) : it);
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    /**
     * Adds a value to the collection. For `!!map` and `!!omap` the value must
     * be a Pair instance or a `{ key, value }` object, which may not have a key
     * that already exists in the map.
     */
    addIn(path, value) {
      if (isEmptyPath(path))
        this.add(value);
      else {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (isCollection(node))
          node.addIn(rest, value);
        else if (node === void 0 && this.schema)
          this.set(key, collectionFromPath(this.schema, rest, value));
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
    }
    /**
     * Removes a value from the collection.
     * @returns `true` if the item was found and removed.
     */
    deleteIn(path) {
      const [key, ...rest] = path;
      if (rest.length === 0)
        return this.delete(key);
      const node = this.get(key, true);
      if (isCollection(node))
        return node.deleteIn(rest);
      else
        throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
    }
    /**
     * Returns item at `key`, or `undefined` if not found. By default unwraps
     * scalar values from their surrounding node; to disable set `keepScalar` to
     * `true` (collections are always returned intact).
     */
    getIn(path, keepScalar) {
      const [key, ...rest] = path;
      const node = this.get(key, true);
      if (rest.length === 0)
        return !keepScalar && isScalar(node) ? node.value : node;
      else
        return isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
    }
    hasAllNullValues(allowScalar) {
      return this.items.every((node) => {
        if (!isPair(node))
          return false;
        const n = node.value;
        return n == null || allowScalar && isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
      });
    }
    /**
     * Checks if the collection includes a value with the key `key`.
     */
    hasIn(path) {
      const [key, ...rest] = path;
      if (rest.length === 0)
        return this.has(key);
      const node = this.get(key, true);
      return isCollection(node) ? node.hasIn(rest) : false;
    }
    /**
     * Sets a value in this collection. For `!!set`, `value` needs to be a
     * boolean to add/remove the item from the set.
     */
    setIn(path, value) {
      const [key, ...rest] = path;
      if (rest.length === 0) {
        this.set(key, value);
      } else {
        const node = this.get(key, true);
        if (isCollection(node))
          node.setIn(rest, value);
        else if (node === void 0 && this.schema)
          this.set(key, collectionFromPath(this.schema, rest, value));
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
    }
  };

  // node_modules/yaml/browser/dist/stringify/stringifyComment.js
  var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
  function indentComment(comment, indent) {
    if (/^\n+$/.test(comment))
      return comment.substring(1);
    return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
  }
  var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;

  // node_modules/yaml/browser/dist/stringify/foldFlowLines.js
  var FOLD_FLOW = "flow";
  var FOLD_BLOCK = "block";
  var FOLD_QUOTED = "quoted";
  function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
    if (!lineWidth || lineWidth < 0)
      return text;
    if (lineWidth < minContentWidth)
      minContentWidth = 0;
    const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
    if (text.length <= endStep)
      return text;
    const folds = [];
    const escapedFolds = {};
    let end = lineWidth - indent.length;
    if (typeof indentAtStart === "number") {
      if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
        folds.push(0);
      else
        end = lineWidth - indentAtStart;
    }
    let split = void 0;
    let prev = void 0;
    let overflow = false;
    let i = -1;
    let escStart = -1;
    let escEnd = -1;
    if (mode === FOLD_BLOCK) {
      i = consumeMoreIndentedLines(text, i, indent.length);
      if (i !== -1)
        end = i + endStep;
    }
    for (let ch; ch = text[i += 1]; ) {
      if (mode === FOLD_QUOTED && ch === "\\") {
        escStart = i;
        switch (text[i + 1]) {
          case "x":
            i += 3;
            break;
          case "u":
            i += 5;
            break;
          case "U":
            i += 9;
            break;
          default:
            i += 1;
        }
        escEnd = i;
      }
      if (ch === "\n") {
        if (mode === FOLD_BLOCK)
          i = consumeMoreIndentedLines(text, i, indent.length);
        end = i + indent.length + endStep;
        split = void 0;
      } else {
        if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
          const next = text[i + 1];
          if (next && next !== " " && next !== "\n" && next !== "	")
            split = i;
        }
        if (i >= end) {
          if (split) {
            folds.push(split);
            end = split + endStep;
            split = void 0;
          } else if (mode === FOLD_QUOTED) {
            while (prev === " " || prev === "	") {
              prev = ch;
              ch = text[i += 1];
              overflow = true;
            }
            const j = i > escEnd + 1 ? i - 2 : escStart - 1;
            if (escapedFolds[j])
              return text;
            folds.push(j);
            escapedFolds[j] = true;
            end = j + endStep;
            split = void 0;
          } else {
            overflow = true;
          }
        }
      }
      prev = ch;
    }
    if (overflow && onOverflow)
      onOverflow();
    if (folds.length === 0)
      return text;
    if (onFold)
      onFold();
    let res = text.slice(0, folds[0]);
    for (let i2 = 0; i2 < folds.length; ++i2) {
      const fold = folds[i2];
      const end2 = folds[i2 + 1] || text.length;
      if (fold === 0)
        res = `
${indent}${text.slice(0, end2)}`;
      else {
        if (mode === FOLD_QUOTED && escapedFolds[fold])
          res += `${text[fold]}\\`;
        res += `
${indent}${text.slice(fold + 1, end2)}`;
      }
    }
    return res;
  }
  function consumeMoreIndentedLines(text, i, indent) {
    let end = i;
    let start = i + 1;
    let ch = text[start];
    while (ch === " " || ch === "	") {
      if (i < start + indent) {
        ch = text[++i];
      } else {
        do {
          ch = text[++i];
        } while (ch && ch !== "\n");
        end = i;
        start = i + 1;
        ch = text[start];
      }
    }
    return end;
  }

  // node_modules/yaml/browser/dist/stringify/stringifyString.js
  var getFoldOptions = (ctx, isBlock2) => ({
    indentAtStart: isBlock2 ? ctx.indent.length : ctx.indentAtStart,
    lineWidth: ctx.options.lineWidth,
    minContentWidth: ctx.options.minContentWidth
  });
  var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
  function lineLengthOverLimit(str, lineWidth, indentLength) {
    if (!lineWidth || lineWidth < 0)
      return false;
    const limit = lineWidth - indentLength;
    const strLen = str.length;
    if (strLen <= limit)
      return false;
    for (let i = 0, start = 0; i < strLen; ++i) {
      if (str[i] === "\n") {
        if (i - start > limit)
          return true;
        start = i + 1;
        if (strLen - start <= limit)
          return false;
      }
    }
    return true;
  }
  function doubleQuotedString(value, ctx) {
    const json = JSON.stringify(value);
    if (ctx.options.doubleQuotedAsJSON)
      return json;
    const { implicitKey } = ctx;
    const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
    const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
    let str = "";
    let start = 0;
    for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
      if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
        str += json.slice(start, i) + "\\ ";
        i += 1;
        start = i;
        ch = "\\";
      }
      if (ch === "\\")
        switch (json[i + 1]) {
          case "u":
            {
              str += json.slice(start, i);
              const code = json.substr(i + 2, 4);
              switch (code) {
                case "0000":
                  str += "\\0";
                  break;
                case "0007":
                  str += "\\a";
                  break;
                case "000b":
                  str += "\\v";
                  break;
                case "001b":
                  str += "\\e";
                  break;
                case "0085":
                  str += "\\N";
                  break;
                case "00a0":
                  str += "\\_";
                  break;
                case "2028":
                  str += "\\L";
                  break;
                case "2029":
                  str += "\\P";
                  break;
                default:
                  if (code.substr(0, 2) === "00")
                    str += "\\x" + code.substr(2);
                  else
                    str += json.substr(i, 6);
              }
              i += 5;
              start = i + 1;
            }
            break;
          case "n":
            if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
              i += 1;
            } else {
              str += json.slice(start, i) + "\n\n";
              while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                str += "\n";
                i += 2;
              }
              str += indent;
              if (json[i + 2] === " ")
                str += "\\";
              i += 1;
              start = i + 1;
            }
            break;
          default:
            i += 1;
        }
    }
    str = start ? str + json.slice(start) : json;
    return implicitKey ? str : foldFlowLines(str, indent, FOLD_QUOTED, getFoldOptions(ctx, false));
  }
  function singleQuotedString(value, ctx) {
    if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
      return doubleQuotedString(value, ctx);
    const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
    const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
    return ctx.implicitKey ? res : foldFlowLines(res, indent, FOLD_FLOW, getFoldOptions(ctx, false));
  }
  function quotedString(value, ctx) {
    const { singleQuote } = ctx.options;
    let qs;
    if (singleQuote === false)
      qs = doubleQuotedString;
    else {
      const hasDouble = value.includes('"');
      const hasSingle = value.includes("'");
      if (hasDouble && !hasSingle)
        qs = singleQuotedString;
      else if (hasSingle && !hasDouble)
        qs = doubleQuotedString;
      else
        qs = singleQuote ? singleQuotedString : doubleQuotedString;
    }
    return qs(value, ctx);
  }
  var blockEndNewlines;
  try {
    blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
  } catch (e) {
    blockEndNewlines = /\n+(?!\n|$)/g;
  }
  function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
    const { blockQuote, commentString, lineWidth } = ctx.options;
    if (!blockQuote || /\n[\t ]+$/.test(value)) {
      return quotedString(value, ctx);
    }
    const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
    const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.BLOCK_FOLDED ? false : type === Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
    if (!value)
      return literal ? "|\n" : ">\n";
    let chomp;
    let endStart;
    for (endStart = value.length; endStart > 0; --endStart) {
      const ch = value[endStart - 1];
      if (ch !== "\n" && ch !== "	" && ch !== " ")
        break;
    }
    let end = value.substring(endStart);
    const endNlPos = end.indexOf("\n");
    if (endNlPos === -1) {
      chomp = "-";
    } else if (value === end || endNlPos !== end.length - 1) {
      chomp = "+";
      if (onChompKeep)
        onChompKeep();
    } else {
      chomp = "";
    }
    if (end) {
      value = value.slice(0, -end.length);
      if (end[end.length - 1] === "\n")
        end = end.slice(0, -1);
      end = end.replace(blockEndNewlines, `$&${indent}`);
    }
    let startWithSpace = false;
    let startEnd;
    let startNlPos = -1;
    for (startEnd = 0; startEnd < value.length; ++startEnd) {
      const ch = value[startEnd];
      if (ch === " ")
        startWithSpace = true;
      else if (ch === "\n")
        startNlPos = startEnd;
      else
        break;
    }
    let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
    if (start) {
      value = value.substring(start.length);
      start = start.replace(/\n+/g, `$&${indent}`);
    }
    const indentSize = indent ? "2" : "1";
    let header = (startWithSpace ? indentSize : "") + chomp;
    if (comment) {
      header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
      if (onComment)
        onComment();
    }
    if (!literal) {
      const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
      let literalFallback = false;
      const foldOptions = getFoldOptions(ctx, true);
      if (blockQuote !== "folded" && type !== Scalar.BLOCK_FOLDED) {
        foldOptions.onOverflow = () => {
          literalFallback = true;
        };
      }
      const body = foldFlowLines(`${start}${foldedValue}${end}`, indent, FOLD_BLOCK, foldOptions);
      if (!literalFallback)
        return `>${header}
${indent}${body}`;
    }
    value = value.replace(/\n+/g, `$&${indent}`);
    return `|${header}
${indent}${start}${value}${end}`;
  }
  function plainString(item, ctx, onComment, onChompKeep) {
    const { type, value } = item;
    const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
    if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
      return quotedString(value, ctx);
    }
    if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
      return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
    }
    if (!implicitKey && !inFlow && type !== Scalar.PLAIN && value.includes("\n")) {
      return blockString(item, ctx, onComment, onChompKeep);
    }
    if (containsDocumentMarker(value)) {
      if (indent === "") {
        ctx.forceBlockIndent = true;
        return blockString(item, ctx, onComment, onChompKeep);
      } else if (implicitKey && indent === indentStep) {
        return quotedString(value, ctx);
      }
    }
    const str = value.replace(/\n+/g, `$&
${indent}`);
    if (actualString) {
      const test = (tag) => {
        var _a;
        return tag.default && tag.tag !== "tag:yaml.org,2002:str" && ((_a = tag.test) == null ? void 0 : _a.test(str));
      };
      const { compat, tags } = ctx.doc.schema;
      if (tags.some(test) || (compat == null ? void 0 : compat.some(test)))
        return quotedString(value, ctx);
    }
    return implicitKey ? str : foldFlowLines(str, indent, FOLD_FLOW, getFoldOptions(ctx, false));
  }
  function stringifyString(item, ctx, onComment, onChompKeep) {
    const { implicitKey, inFlow } = ctx;
    const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
    let { type } = item;
    if (type !== Scalar.QUOTE_DOUBLE) {
      if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
        type = Scalar.QUOTE_DOUBLE;
    }
    const _stringify = (_type) => {
      switch (_type) {
        case Scalar.BLOCK_FOLDED:
        case Scalar.BLOCK_LITERAL:
          return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
        case Scalar.QUOTE_DOUBLE:
          return doubleQuotedString(ss.value, ctx);
        case Scalar.QUOTE_SINGLE:
          return singleQuotedString(ss.value, ctx);
        case Scalar.PLAIN:
          return plainString(ss, ctx, onComment, onChompKeep);
        default:
          return null;
      }
    };
    let res = _stringify(type);
    if (res === null) {
      const { defaultKeyType, defaultStringType } = ctx.options;
      const t = implicitKey && defaultKeyType || defaultStringType;
      res = _stringify(t);
      if (res === null)
        throw new Error(`Unsupported default string type ${t}`);
    }
    return res;
  }

  // node_modules/yaml/browser/dist/stringify/stringify.js
  function createStringifyContext(doc, options) {
    const opt = Object.assign({
      blockQuote: true,
      commentString: stringifyComment,
      defaultKeyType: null,
      defaultStringType: "PLAIN",
      directives: null,
      doubleQuotedAsJSON: false,
      doubleQuotedMinMultiLineLength: 40,
      falseStr: "false",
      flowCollectionPadding: true,
      indentSeq: true,
      lineWidth: 80,
      minContentWidth: 20,
      nullStr: "null",
      simpleKeys: false,
      singleQuote: null,
      trailingComma: false,
      trueStr: "true",
      verifyAliasOrder: true
    }, doc.schema.toStringOptions, options);
    let inFlow;
    switch (opt.collectionStyle) {
      case "block":
        inFlow = false;
        break;
      case "flow":
        inFlow = true;
        break;
      default:
        inFlow = null;
    }
    return {
      anchors: /* @__PURE__ */ new Set(),
      doc,
      flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
      indent: "",
      indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
      inFlow,
      options: opt
    };
  }
  function getTagObject(tags, item) {
    var _a, _b, _c, _d;
    if (item.tag) {
      const match = tags.filter((t) => t.tag === item.tag);
      if (match.length > 0)
        return (_a = match.find((t) => t.format === item.format)) != null ? _a : match[0];
    }
    let tagObj = void 0;
    let obj;
    if (isScalar(item)) {
      obj = item.value;
      let match = tags.filter((t) => {
        var _a2;
        return (_a2 = t.identify) == null ? void 0 : _a2.call(t, obj);
      });
      if (match.length > 1) {
        const testMatch = match.filter((t) => t.test);
        if (testMatch.length > 0)
          match = testMatch;
      }
      tagObj = (_b = match.find((t) => t.format === item.format)) != null ? _b : match.find((t) => !t.format);
    } else {
      obj = item;
      tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
    }
    if (!tagObj) {
      const name = (_d = (_c = obj == null ? void 0 : obj.constructor) == null ? void 0 : _c.name) != null ? _d : obj === null ? "null" : typeof obj;
      throw new Error(`Tag not resolved for ${name} value`);
    }
    return tagObj;
  }
  function stringifyProps(node, tagObj, { anchors, doc }) {
    var _a;
    if (!doc.directives)
      return "";
    const props = [];
    const anchor = (isScalar(node) || isCollection(node)) && node.anchor;
    if (anchor && anchorIsValid(anchor)) {
      anchors.add(anchor);
      props.push(`&${anchor}`);
    }
    const tag = (_a = node.tag) != null ? _a : tagObj.default ? null : tagObj.tag;
    if (tag)
      props.push(doc.directives.tagString(tag));
    return props.join(" ");
  }
  function stringify(item, ctx, onComment, onChompKeep) {
    var _a, _b;
    if (isPair(item))
      return item.toString(ctx, onComment, onChompKeep);
    if (isAlias(item)) {
      if (ctx.doc.directives)
        return item.toString(ctx);
      if ((_a = ctx.resolvedAliases) == null ? void 0 : _a.has(item)) {
        throw new TypeError(`Cannot stringify circular structure without alias nodes`);
      } else {
        if (ctx.resolvedAliases)
          ctx.resolvedAliases.add(item);
        else
          ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
        item = item.resolve(ctx.doc);
      }
    }
    let tagObj = void 0;
    const node = isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
    tagObj != null ? tagObj : tagObj = getTagObject(ctx.doc.schema.tags, node);
    const props = stringifyProps(node, tagObj, ctx);
    if (props.length > 0)
      ctx.indentAtStart = ((_b = ctx.indentAtStart) != null ? _b : 0) + props.length + 1;
    const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : isScalar(node) ? stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
    if (!props)
      return str;
    return isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
  }

  // node_modules/yaml/browser/dist/stringify/stringifyPair.js
  function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
    var _a, _b;
    const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
    let keyComment = isNode(key) && key.comment || null;
    if (simpleKeys) {
      if (keyComment) {
        throw new Error("With simple keys, key nodes cannot have comments");
      }
      if (isCollection(key) || !isNode(key) && typeof key === "object") {
        const msg = "With simple keys, collection cannot be used as a key value";
        throw new Error(msg);
      }
    }
    let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || isCollection(key) || (isScalar(key) ? key.type === Scalar.BLOCK_FOLDED || key.type === Scalar.BLOCK_LITERAL : typeof key === "object"));
    ctx = Object.assign({}, ctx, {
      allNullValues: false,
      implicitKey: !explicitKey && (simpleKeys || !allNullValues),
      indent: indent + indentStep
    });
    let keyCommentDone = false;
    let chompKeep = false;
    let str = stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
    if (!explicitKey && !ctx.inFlow && str.length > 1024) {
      if (simpleKeys)
        throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
      explicitKey = true;
    }
    if (ctx.inFlow) {
      if (allNullValues || value == null) {
        if (keyCommentDone && onComment)
          onComment();
        return str === "" ? "?" : explicitKey ? `? ${str}` : str;
      }
    } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
      str = `? ${str}`;
      if (keyComment && !keyCommentDone) {
        str += lineComment(str, ctx.indent, commentString(keyComment));
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    if (keyCommentDone)
      keyComment = null;
    if (explicitKey) {
      if (keyComment)
        str += lineComment(str, ctx.indent, commentString(keyComment));
      str = `? ${str}
${indent}:`;
    } else {
      str = `${str}:`;
      if (keyComment)
        str += lineComment(str, ctx.indent, commentString(keyComment));
    }
    let vsb, vcb, valueComment;
    if (isNode(value)) {
      vsb = !!value.spaceBefore;
      vcb = value.commentBefore;
      valueComment = value.comment;
    } else {
      vsb = false;
      vcb = null;
      valueComment = null;
      if (value && typeof value === "object")
        value = doc.createNode(value);
    }
    ctx.implicitKey = false;
    if (!explicitKey && !keyComment && isScalar(value))
      ctx.indentAtStart = str.length + 1;
    chompKeep = false;
    if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && isSeq(value) && !value.flow && !value.tag && !value.anchor) {
      ctx.indent = ctx.indent.substring(2);
    }
    let valueCommentDone = false;
    const valueStr = stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
    let ws = " ";
    if (keyComment || vsb || vcb) {
      ws = vsb ? "\n" : "";
      if (vcb) {
        const cs = commentString(vcb);
        ws += `
${indentComment(cs, ctx.indent)}`;
      }
      if (valueStr === "" && !ctx.inFlow) {
        if (ws === "\n" && valueComment)
          ws = "\n\n";
      } else {
        ws += `
${ctx.indent}`;
      }
    } else if (!explicitKey && isCollection(value)) {
      const vs0 = valueStr[0];
      const nl0 = valueStr.indexOf("\n");
      const hasNewline = nl0 !== -1;
      const flow = (_b = (_a = ctx.inFlow) != null ? _a : value.flow) != null ? _b : value.items.length === 0;
      if (hasNewline || !flow) {
        let hasPropsLine = false;
        if (hasNewline && (vs0 === "&" || vs0 === "!")) {
          let sp0 = valueStr.indexOf(" ");
          if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
            sp0 = valueStr.indexOf(" ", sp0 + 1);
          }
          if (sp0 === -1 || nl0 < sp0)
            hasPropsLine = true;
        }
        if (!hasPropsLine)
          ws = `
${ctx.indent}`;
      }
    } else if (valueStr === "" || valueStr[0] === "\n") {
      ws = "";
    }
    str += ws + valueStr;
    if (ctx.inFlow) {
      if (valueCommentDone && onComment)
        onComment();
    } else if (valueComment && !valueCommentDone) {
      str += lineComment(str, ctx.indent, commentString(valueComment));
    } else if (chompKeep && onChompKeep) {
      onChompKeep();
    }
    return str;
  }

  // node_modules/yaml/browser/dist/log.js
  function warn(logLevel, warning) {
    if (logLevel === "debug" || logLevel === "warn") {
      console.warn(warning);
    }
  }

  // node_modules/yaml/browser/dist/schema/yaml-1.1/merge.js
  var MERGE_KEY = "<<";
  var merge = {
    identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
    default: "key",
    tag: "tag:yaml.org,2002:merge",
    test: /^<<$/,
    resolve: () => Object.assign(new Scalar(Symbol(MERGE_KEY)), {
      addToJSMap: addMergeToJSMap
    }),
    stringify: () => MERGE_KEY
  };
  var isMergeKey = (ctx, key) => (merge.identify(key) || isScalar(key) && (!key.type || key.type === Scalar.PLAIN) && merge.identify(key.value)) && (ctx == null ? void 0 : ctx.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default));
  function addMergeToJSMap(ctx, map2, value) {
    value = ctx && isAlias(value) ? value.resolve(ctx.doc) : value;
    if (isSeq(value))
      for (const it of value.items)
        mergeValue(ctx, map2, it);
    else if (Array.isArray(value))
      for (const it of value)
        mergeValue(ctx, map2, it);
    else
      mergeValue(ctx, map2, value);
  }
  function mergeValue(ctx, map2, value) {
    const source = ctx && isAlias(value) ? value.resolve(ctx.doc) : value;
    if (!isMap(source))
      throw new Error("Merge sources must be maps or map aliases");
    const srcMap = source.toJSON(null, ctx, Map);
    for (const [key, value2] of srcMap) {
      if (map2 instanceof Map) {
        if (!map2.has(key))
          map2.set(key, value2);
      } else if (map2 instanceof Set) {
        map2.add(key);
      } else if (!Object.prototype.hasOwnProperty.call(map2, key)) {
        Object.defineProperty(map2, key, {
          value: value2,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    }
    return map2;
  }

  // node_modules/yaml/browser/dist/nodes/addPairToJSMap.js
  function addPairToJSMap(ctx, map2, { key, value }) {
    if (isNode(key) && key.addToJSMap)
      key.addToJSMap(ctx, map2, value);
    else if (isMergeKey(ctx, key))
      addMergeToJSMap(ctx, map2, value);
    else {
      const jsKey = toJS(key, "", ctx);
      if (map2 instanceof Map) {
        map2.set(jsKey, toJS(value, jsKey, ctx));
      } else if (map2 instanceof Set) {
        map2.add(jsKey);
      } else {
        const stringKey = stringifyKey(key, jsKey, ctx);
        const jsValue = toJS(value, stringKey, ctx);
        if (stringKey in map2)
          Object.defineProperty(map2, stringKey, {
            value: jsValue,
            writable: true,
            enumerable: true,
            configurable: true
          });
        else
          map2[stringKey] = jsValue;
      }
    }
    return map2;
  }
  function stringifyKey(key, jsKey, ctx) {
    if (jsKey === null)
      return "";
    if (typeof jsKey !== "object")
      return String(jsKey);
    if (isNode(key) && (ctx == null ? void 0 : ctx.doc)) {
      const strCtx = createStringifyContext(ctx.doc, {});
      strCtx.anchors = /* @__PURE__ */ new Set();
      for (const node of ctx.anchors.keys())
        strCtx.anchors.add(node.anchor);
      strCtx.inFlow = true;
      strCtx.inStringifyKey = true;
      const strKey = key.toString(strCtx);
      if (!ctx.mapKeyWarned) {
        let jsonStr = JSON.stringify(strKey);
        if (jsonStr.length > 40)
          jsonStr = jsonStr.substring(0, 36) + '..."';
        warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
        ctx.mapKeyWarned = true;
      }
      return strKey;
    }
    return JSON.stringify(jsKey);
  }

  // node_modules/yaml/browser/dist/nodes/Pair.js
  function createPair(key, value, ctx) {
    const k = createNode(key, void 0, ctx);
    const v = createNode(value, void 0, ctx);
    return new Pair(k, v);
  }
  var Pair = class _Pair {
    constructor(key, value = null) {
      Object.defineProperty(this, NODE_TYPE, { value: PAIR });
      this.key = key;
      this.value = value;
    }
    clone(schema4) {
      let { key, value } = this;
      if (isNode(key))
        key = key.clone(schema4);
      if (isNode(value))
        value = value.clone(schema4);
      return new _Pair(key, value);
    }
    toJSON(_, ctx) {
      const pair = (ctx == null ? void 0 : ctx.mapAsMap) ? /* @__PURE__ */ new Map() : {};
      return addPairToJSMap(ctx, pair, this);
    }
    toString(ctx, onComment, onChompKeep) {
      return (ctx == null ? void 0 : ctx.doc) ? stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
    }
  };

  // node_modules/yaml/browser/dist/stringify/stringifyCollection.js
  function stringifyCollection(collection, ctx, options) {
    var _a;
    const flow = (_a = ctx.inFlow) != null ? _a : collection.flow;
    const stringify4 = flow ? stringifyFlowCollection : stringifyBlockCollection;
    return stringify4(collection, ctx, options);
  }
  function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
    const { indent, options: { commentString } } = ctx;
    const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
    let chompKeep = false;
    const lines = [];
    for (let i = 0; i < items.length; ++i) {
      const item = items[i];
      let comment2 = null;
      if (isNode(item)) {
        if (!chompKeep && item.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
        if (item.comment)
          comment2 = item.comment;
      } else if (isPair(item)) {
        const ik = isNode(item.key) ? item.key : null;
        if (ik) {
          if (!chompKeep && ik.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
        }
      }
      chompKeep = false;
      let str2 = stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
      if (comment2)
        str2 += lineComment(str2, itemIndent, commentString(comment2));
      if (chompKeep && comment2)
        chompKeep = false;
      lines.push(blockItemPrefix + str2);
    }
    let str;
    if (lines.length === 0) {
      str = flowChars.start + flowChars.end;
    } else {
      str = lines[0];
      for (let i = 1; i < lines.length; ++i) {
        const line = lines[i];
        str += line ? `
${indent}${line}` : "\n";
      }
    }
    if (comment) {
      str += "\n" + indentComment(commentString(comment), indent);
      if (onComment)
        onComment();
    } else if (chompKeep && onChompKeep)
      onChompKeep();
    return str;
  }
  function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
    const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
    itemIndent += indentStep;
    const itemCtx = Object.assign({}, ctx, {
      indent: itemIndent,
      inFlow: true,
      type: null
    });
    let reqNewline = false;
    let linesAtValue = 0;
    const lines = [];
    for (let i = 0; i < items.length; ++i) {
      const item = items[i];
      let comment = null;
      if (isNode(item)) {
        if (item.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, item.commentBefore, false);
        if (item.comment)
          comment = item.comment;
      } else if (isPair(item)) {
        const ik = isNode(item.key) ? item.key : null;
        if (ik) {
          if (ik.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, ik.commentBefore, false);
          if (ik.comment)
            reqNewline = true;
        }
        const iv = isNode(item.value) ? item.value : null;
        if (iv) {
          if (iv.comment)
            comment = iv.comment;
          if (iv.commentBefore)
            reqNewline = true;
        } else if (item.value == null && (ik == null ? void 0 : ik.comment)) {
          comment = ik.comment;
        }
      }
      if (comment)
        reqNewline = true;
      let str = stringify(item, itemCtx, () => comment = null);
      reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
      if (i < items.length - 1) {
        str += ",";
      } else if (ctx.options.trailingComma) {
        if (ctx.options.lineWidth > 0) {
          reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
        }
        if (reqNewline) {
          str += ",";
        }
      }
      if (comment)
        str += lineComment(str, itemIndent, commentString(comment));
      lines.push(str);
      linesAtValue = lines.length;
    }
    const { start, end } = flowChars;
    if (lines.length === 0) {
      return start + end;
    } else {
      if (!reqNewline) {
        const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
        reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
      }
      if (reqNewline) {
        let str = start;
        for (const line of lines)
          str += line ? `
${indentStep}${indent}${line}` : "\n";
        return `${str}
${indent}${end}`;
      } else {
        return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
      }
    }
  }
  function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
    if (comment && chompKeep)
      comment = comment.replace(/^\n+/, "");
    if (comment) {
      const ic = indentComment(commentString(comment), indent);
      lines.push(ic.trimStart());
    }
  }

  // node_modules/yaml/browser/dist/nodes/YAMLMap.js
  function findPair(items, key) {
    const k = isScalar(key) ? key.value : key;
    for (const it of items) {
      if (isPair(it)) {
        if (it.key === key || it.key === k)
          return it;
        if (isScalar(it.key) && it.key.value === k)
          return it;
      }
    }
    return void 0;
  }
  var YAMLMap = class extends Collection {
    static get tagName() {
      return "tag:yaml.org,2002:map";
    }
    constructor(schema4) {
      super(MAP, schema4);
      this.items = [];
    }
    /**
     * A generic collection parsing method that can be extended
     * to other node classes that inherit from YAMLMap
     */
    static from(schema4, obj, ctx) {
      const { keepUndefined, replacer } = ctx;
      const map2 = new this(schema4);
      const add = (key, value) => {
        if (typeof replacer === "function")
          value = replacer.call(obj, key, value);
        else if (Array.isArray(replacer) && !replacer.includes(key))
          return;
        if (value !== void 0 || keepUndefined)
          map2.items.push(createPair(key, value, ctx));
      };
      if (obj instanceof Map) {
        for (const [key, value] of obj)
          add(key, value);
      } else if (obj && typeof obj === "object") {
        for (const key of Object.keys(obj))
          add(key, obj[key]);
      }
      if (typeof schema4.sortMapEntries === "function") {
        map2.items.sort(schema4.sortMapEntries);
      }
      return map2;
    }
    /**
     * Adds a value to the collection.
     *
     * @param overwrite - If not set `true`, using a key that is already in the
     *   collection will throw. Otherwise, overwrites the previous value.
     */
    add(pair, overwrite) {
      var _a;
      let _pair;
      if (isPair(pair))
        _pair = pair;
      else if (!pair || typeof pair !== "object" || !("key" in pair)) {
        _pair = new Pair(pair, pair == null ? void 0 : pair.value);
      } else
        _pair = new Pair(pair.key, pair.value);
      const prev = findPair(this.items, _pair.key);
      const sortEntries = (_a = this.schema) == null ? void 0 : _a.sortMapEntries;
      if (prev) {
        if (!overwrite)
          throw new Error(`Key ${_pair.key} already set`);
        if (isScalar(prev.value) && isScalarValue(_pair.value))
          prev.value.value = _pair.value;
        else
          prev.value = _pair.value;
      } else if (sortEntries) {
        const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
        if (i === -1)
          this.items.push(_pair);
        else
          this.items.splice(i, 0, _pair);
      } else {
        this.items.push(_pair);
      }
    }
    delete(key) {
      const it = findPair(this.items, key);
      if (!it)
        return false;
      const del = this.items.splice(this.items.indexOf(it), 1);
      return del.length > 0;
    }
    get(key, keepScalar) {
      var _a;
      const it = findPair(this.items, key);
      const node = it == null ? void 0 : it.value;
      return (_a = !keepScalar && isScalar(node) ? node.value : node) != null ? _a : void 0;
    }
    has(key) {
      return !!findPair(this.items, key);
    }
    set(key, value) {
      this.add(new Pair(key, value), true);
    }
    /**
     * @param ctx - Conversion context, originally set in Document#toJS()
     * @param {Class} Type - If set, forces the returned collection type
     * @returns Instance of Type, Map, or Object
     */
    toJSON(_, ctx, Type) {
      const map2 = Type ? new Type() : (ctx == null ? void 0 : ctx.mapAsMap) ? /* @__PURE__ */ new Map() : {};
      if (ctx == null ? void 0 : ctx.onCreate)
        ctx.onCreate(map2);
      for (const item of this.items)
        addPairToJSMap(ctx, map2, item);
      return map2;
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      for (const item of this.items) {
        if (!isPair(item))
          throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
      }
      if (!ctx.allNullValues && this.hasAllNullValues(false))
        ctx = Object.assign({}, ctx, { allNullValues: true });
      return stringifyCollection(this, ctx, {
        blockItemPrefix: "",
        flowChars: { start: "{", end: "}" },
        itemIndent: ctx.indent || "",
        onChompKeep,
        onComment
      });
    }
  };

  // node_modules/yaml/browser/dist/schema/common/map.js
  var map = {
    collection: "map",
    default: true,
    nodeClass: YAMLMap,
    tag: "tag:yaml.org,2002:map",
    resolve(map2, onError) {
      if (!isMap(map2))
        onError("Expected a mapping for this tag");
      return map2;
    },
    createNode: (schema4, obj, ctx) => YAMLMap.from(schema4, obj, ctx)
  };

  // node_modules/yaml/browser/dist/nodes/YAMLSeq.js
  var YAMLSeq = class extends Collection {
    static get tagName() {
      return "tag:yaml.org,2002:seq";
    }
    constructor(schema4) {
      super(SEQ, schema4);
      this.items = [];
    }
    add(value) {
      this.items.push(value);
    }
    /**
     * Removes a value from the collection.
     *
     * `key` must contain a representation of an integer for this to succeed.
     * It may be wrapped in a `Scalar`.
     *
     * @returns `true` if the item was found and removed.
     */
    delete(key) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        return false;
      const del = this.items.splice(idx, 1);
      return del.length > 0;
    }
    get(key, keepScalar) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        return void 0;
      const it = this.items[idx];
      return !keepScalar && isScalar(it) ? it.value : it;
    }
    /**
     * Checks if the collection includes a value with the key `key`.
     *
     * `key` must contain a representation of an integer for this to succeed.
     * It may be wrapped in a `Scalar`.
     */
    has(key) {
      const idx = asItemIndex(key);
      return typeof idx === "number" && idx < this.items.length;
    }
    /**
     * Sets a value in this collection. For `!!set`, `value` needs to be a
     * boolean to add/remove the item from the set.
     *
     * If `key` does not contain a representation of an integer, this will throw.
     * It may be wrapped in a `Scalar`.
     */
    set(key, value) {
      const idx = asItemIndex(key);
      if (typeof idx !== "number")
        throw new Error(`Expected a valid index, not ${key}.`);
      const prev = this.items[idx];
      if (isScalar(prev) && isScalarValue(value))
        prev.value = value;
      else
        this.items[idx] = value;
    }
    toJSON(_, ctx) {
      const seq2 = [];
      if (ctx == null ? void 0 : ctx.onCreate)
        ctx.onCreate(seq2);
      let i = 0;
      for (const item of this.items)
        seq2.push(toJS(item, String(i++), ctx));
      return seq2;
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      return stringifyCollection(this, ctx, {
        blockItemPrefix: "- ",
        flowChars: { start: "[", end: "]" },
        itemIndent: (ctx.indent || "") + "  ",
        onChompKeep,
        onComment
      });
    }
    static from(schema4, obj, ctx) {
      const { replacer } = ctx;
      const seq2 = new this(schema4);
      if (obj && Symbol.iterator in Object(obj)) {
        let i = 0;
        for (let it of obj) {
          if (typeof replacer === "function") {
            const key = obj instanceof Set ? it : String(i++);
            it = replacer.call(obj, key, it);
          }
          seq2.items.push(createNode(it, void 0, ctx));
        }
      }
      return seq2;
    }
  };
  function asItemIndex(key) {
    let idx = isScalar(key) ? key.value : key;
    if (idx && typeof idx === "string")
      idx = Number(idx);
    return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
  }

  // node_modules/yaml/browser/dist/schema/common/seq.js
  var seq = {
    collection: "seq",
    default: true,
    nodeClass: YAMLSeq,
    tag: "tag:yaml.org,2002:seq",
    resolve(seq2, onError) {
      if (!isSeq(seq2))
        onError("Expected a sequence for this tag");
      return seq2;
    },
    createNode: (schema4, obj, ctx) => YAMLSeq.from(schema4, obj, ctx)
  };

  // node_modules/yaml/browser/dist/schema/common/string.js
  var string = {
    identify: (value) => typeof value === "string",
    default: true,
    tag: "tag:yaml.org,2002:str",
    resolve: (str) => str,
    stringify(item, ctx, onComment, onChompKeep) {
      ctx = Object.assign({ actualString: true }, ctx);
      return stringifyString(item, ctx, onComment, onChompKeep);
    }
  };

  // node_modules/yaml/browser/dist/schema/common/null.js
  var nullTag = {
    identify: (value) => value == null,
    createNode: () => new Scalar(null),
    default: true,
    tag: "tag:yaml.org,2002:null",
    test: /^(?:~|[Nn]ull|NULL)?$/,
    resolve: () => new Scalar(null),
    stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
  };

  // node_modules/yaml/browser/dist/schema/core/bool.js
  var boolTag = {
    identify: (value) => typeof value === "boolean",
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
    resolve: (str) => new Scalar(str[0] === "t" || str[0] === "T"),
    stringify({ source, value }, ctx) {
      if (source && boolTag.test.test(source)) {
        const sv = source[0] === "t" || source[0] === "T";
        if (value === sv)
          return source;
      }
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
  };

  // node_modules/yaml/browser/dist/stringify/stringifyNumber.js
  function stringifyNumber({ format, minFractionDigits, tag, value }) {
    if (typeof value === "bigint")
      return String(value);
    const num = typeof value === "number" ? value : Number(value);
    if (!isFinite(num))
      return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
    let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
    if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^\d/.test(n)) {
      let i = n.indexOf(".");
      if (i < 0) {
        i = n.length;
        n += ".";
      }
      let d = minFractionDigits - (n.length - i - 1);
      while (d-- > 0)
        n += "0";
    }
    return n;
  }

  // node_modules/yaml/browser/dist/schema/core/float.js
  var floatNaN = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
    resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    stringify: stringifyNumber
  };
  var floatExp = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "EXP",
    test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
    resolve: (str) => parseFloat(str),
    stringify(node) {
      const num = Number(node.value);
      return isFinite(num) ? num.toExponential() : stringifyNumber(node);
    }
  };
  var float = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
    resolve(str) {
      const node = new Scalar(parseFloat(str));
      const dot = str.indexOf(".");
      if (dot !== -1 && str[str.length - 1] === "0")
        node.minFractionDigits = str.length - dot - 1;
      return node;
    },
    stringify: stringifyNumber
  };

  // node_modules/yaml/browser/dist/schema/core/int.js
  var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
  var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
  function intStringify(node, radix, prefix) {
    const { value } = node;
    if (intIdentify(value) && value >= 0)
      return prefix + value.toString(radix);
    return stringifyNumber(node);
  }
  var intOct = {
    identify: (value) => intIdentify(value) && value >= 0,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "OCT",
    test: /^0o[0-7]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
    stringify: (node) => intStringify(node, 8, "0o")
  };
  var int = {
    identify: intIdentify,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^[-+]?[0-9]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
    stringify: stringifyNumber
  };
  var intHex = {
    identify: (value) => intIdentify(value) && value >= 0,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "HEX",
    test: /^0x[0-9a-fA-F]+$/,
    resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
    stringify: (node) => intStringify(node, 16, "0x")
  };

  // node_modules/yaml/browser/dist/schema/core/schema.js
  var schema = [
    map,
    seq,
    string,
    nullTag,
    boolTag,
    intOct,
    int,
    intHex,
    floatNaN,
    floatExp,
    float
  ];

  // node_modules/yaml/browser/dist/schema/json/schema.js
  function intIdentify2(value) {
    return typeof value === "bigint" || Number.isInteger(value);
  }
  var stringifyJSON = ({ value }) => JSON.stringify(value);
  var jsonScalars = [
    {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify: stringifyJSON
    },
    {
      identify: (value) => value == null,
      createNode: () => new Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^null$/,
      resolve: () => null,
      stringify: stringifyJSON
    },
    {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^true$|^false$/,
      resolve: (str) => str === "true",
      stringify: stringifyJSON
    },
    {
      identify: intIdentify2,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^-?(?:0|[1-9][0-9]*)$/,
      resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
      stringify: ({ value }) => intIdentify2(value) ? value.toString() : JSON.stringify(value)
    },
    {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
      resolve: (str) => parseFloat(str),
      stringify: stringifyJSON
    }
  ];
  var jsonError = {
    default: true,
    tag: "",
    test: /^/,
    resolve(str, onError) {
      onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
      return str;
    }
  };
  var schema2 = [map, seq].concat(jsonScalars, jsonError);

  // node_modules/yaml/browser/dist/schema/yaml-1.1/binary.js
  var binary = {
    identify: (value) => value instanceof Uint8Array,
    // Buffer inherits from Uint8Array
    default: false,
    tag: "tag:yaml.org,2002:binary",
    /**
     * Returns a Buffer in node and an Uint8Array in browsers
     *
     * To use the resulting buffer as an image, you'll want to do something like:
     *
     *   const blob = new Blob([buffer], { type: 'image/jpeg' })
     *   document.querySelector('#photo').src = URL.createObjectURL(blob)
     */
    resolve(src, onError) {
      if (typeof atob === "function") {
        const str = atob(src.replace(/[\n\r]/g, ""));
        const buffer = new Uint8Array(str.length);
        for (let i = 0; i < str.length; ++i)
          buffer[i] = str.charCodeAt(i);
        return buffer;
      } else {
        onError("This environment does not support reading binary tags; either Buffer or atob is required");
        return src;
      }
    },
    stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
      if (!value)
        return "";
      const buf = value;
      let str;
      if (typeof btoa === "function") {
        let s = "";
        for (let i = 0; i < buf.length; ++i)
          s += String.fromCharCode(buf[i]);
        str = btoa(s);
      } else {
        throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
      }
      type != null ? type : type = Scalar.BLOCK_LITERAL;
      if (type !== Scalar.QUOTE_DOUBLE) {
        const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
        const n = Math.ceil(str.length / lineWidth);
        const lines = new Array(n);
        for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
          lines[i] = str.substr(o, lineWidth);
        }
        str = lines.join(type === Scalar.BLOCK_LITERAL ? "\n" : " ");
      }
      return stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
    }
  };

  // node_modules/yaml/browser/dist/schema/yaml-1.1/pairs.js
  function resolvePairs(seq2, onError) {
    var _a;
    if (isSeq(seq2)) {
      for (let i = 0; i < seq2.items.length; ++i) {
        let item = seq2.items[i];
        if (isPair(item))
          continue;
        else if (isMap(item)) {
          if (item.items.length > 1)
            onError("Each pair must have its own sequence indicator");
          const pair = item.items[0] || new Pair(new Scalar(null));
          if (item.commentBefore)
            pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
          if (item.comment) {
            const cn = (_a = pair.value) != null ? _a : pair.key;
            cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
          }
          item = pair;
        }
        seq2.items[i] = isPair(item) ? item : new Pair(item);
      }
    } else
      onError("Expected a sequence for this tag");
    return seq2;
  }
  function createPairs(schema4, iterable, ctx) {
    const { replacer } = ctx;
    const pairs2 = new YAMLSeq(schema4);
    pairs2.tag = "tag:yaml.org,2002:pairs";
    let i = 0;
    if (iterable && Symbol.iterator in Object(iterable))
      for (let it of iterable) {
        if (typeof replacer === "function")
          it = replacer.call(iterable, String(i++), it);
        let key, value;
        if (Array.isArray(it)) {
          if (it.length === 2) {
            key = it[0];
            value = it[1];
          } else
            throw new TypeError(`Expected [key, value] tuple: ${it}`);
        } else if (it && it instanceof Object) {
          const keys = Object.keys(it);
          if (keys.length === 1) {
            key = keys[0];
            value = it[key];
          } else {
            throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
          }
        } else {
          key = it;
        }
        pairs2.items.push(createPair(key, value, ctx));
      }
    return pairs2;
  }
  var pairs = {
    collection: "seq",
    default: false,
    tag: "tag:yaml.org,2002:pairs",
    resolve: resolvePairs,
    createNode: createPairs
  };

  // node_modules/yaml/browser/dist/schema/yaml-1.1/omap.js
  var YAMLOMap = class _YAMLOMap extends YAMLSeq {
    constructor() {
      super();
      this.add = YAMLMap.prototype.add.bind(this);
      this.delete = YAMLMap.prototype.delete.bind(this);
      this.get = YAMLMap.prototype.get.bind(this);
      this.has = YAMLMap.prototype.has.bind(this);
      this.set = YAMLMap.prototype.set.bind(this);
      this.tag = _YAMLOMap.tag;
    }
    /**
     * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
     * but TypeScript won't allow widening the signature of a child method.
     */
    toJSON(_, ctx) {
      if (!ctx)
        return super.toJSON(_);
      const map2 = /* @__PURE__ */ new Map();
      if (ctx == null ? void 0 : ctx.onCreate)
        ctx.onCreate(map2);
      for (const pair of this.items) {
        let key, value;
        if (isPair(pair)) {
          key = toJS(pair.key, "", ctx);
          value = toJS(pair.value, key, ctx);
        } else {
          key = toJS(pair, "", ctx);
        }
        if (map2.has(key))
          throw new Error("Ordered maps must not include duplicate keys");
        map2.set(key, value);
      }
      return map2;
    }
    static from(schema4, iterable, ctx) {
      const pairs2 = createPairs(schema4, iterable, ctx);
      const omap2 = new this();
      omap2.items = pairs2.items;
      return omap2;
    }
  };
  YAMLOMap.tag = "tag:yaml.org,2002:omap";
  var omap = {
    collection: "seq",
    identify: (value) => value instanceof Map,
    nodeClass: YAMLOMap,
    default: false,
    tag: "tag:yaml.org,2002:omap",
    resolve(seq2, onError) {
      const pairs2 = resolvePairs(seq2, onError);
      const seenKeys = [];
      for (const { key } of pairs2.items) {
        if (isScalar(key)) {
          if (seenKeys.includes(key.value)) {
            onError(`Ordered maps must not include duplicate keys: ${key.value}`);
          } else {
            seenKeys.push(key.value);
          }
        }
      }
      return Object.assign(new YAMLOMap(), pairs2);
    },
    createNode: (schema4, iterable, ctx) => YAMLOMap.from(schema4, iterable, ctx)
  };

  // node_modules/yaml/browser/dist/schema/yaml-1.1/bool.js
  function boolStringify({ value, source }, ctx) {
    const boolObj = value ? trueTag : falseTag;
    if (source && boolObj.test.test(source))
      return source;
    return value ? ctx.options.trueStr : ctx.options.falseStr;
  }
  var trueTag = {
    identify: (value) => value === true,
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
    resolve: () => new Scalar(true),
    stringify: boolStringify
  };
  var falseTag = {
    identify: (value) => value === false,
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
    resolve: () => new Scalar(false),
    stringify: boolStringify
  };

  // node_modules/yaml/browser/dist/schema/yaml-1.1/float.js
  var floatNaN2 = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
    resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
    stringify: stringifyNumber
  };
  var floatExp2 = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "EXP",
    test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
    resolve: (str) => parseFloat(str.replace(/_/g, "")),
    stringify(node) {
      const num = Number(node.value);
      return isFinite(num) ? num.toExponential() : stringifyNumber(node);
    }
  };
  var float2 = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
    resolve(str) {
      const node = new Scalar(parseFloat(str.replace(/_/g, "")));
      const dot = str.indexOf(".");
      if (dot !== -1) {
        const f = str.substring(dot + 1).replace(/_/g, "");
        if (f[f.length - 1] === "0")
          node.minFractionDigits = f.length;
      }
      return node;
    },
    stringify: stringifyNumber
  };

  // node_modules/yaml/browser/dist/schema/yaml-1.1/int.js
  var intIdentify3 = (value) => typeof value === "bigint" || Number.isInteger(value);
  function intResolve2(str, offset, radix, { intAsBigInt }) {
    const sign = str[0];
    if (sign === "-" || sign === "+")
      offset += 1;
    str = str.substring(offset).replace(/_/g, "");
    if (intAsBigInt) {
      switch (radix) {
        case 2:
          str = `0b${str}`;
          break;
        case 8:
          str = `0o${str}`;
          break;
        case 16:
          str = `0x${str}`;
          break;
      }
      const n2 = BigInt(str);
      return sign === "-" ? BigInt(-1) * n2 : n2;
    }
    const n = parseInt(str, radix);
    return sign === "-" ? -1 * n : n;
  }
  function intStringify2(node, radix, prefix) {
    const { value } = node;
    if (intIdentify3(value)) {
      const str = value.toString(radix);
      return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
    }
    return stringifyNumber(node);
  }
  var intBin = {
    identify: intIdentify3,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "BIN",
    test: /^[-+]?0b[0-1_]+$/,
    resolve: (str, _onError, opt) => intResolve2(str, 2, 2, opt),
    stringify: (node) => intStringify2(node, 2, "0b")
  };
  var intOct2 = {
    identify: intIdentify3,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "OCT",
    test: /^[-+]?0[0-7_]+$/,
    resolve: (str, _onError, opt) => intResolve2(str, 1, 8, opt),
    stringify: (node) => intStringify2(node, 8, "0")
  };
  var int2 = {
    identify: intIdentify3,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^[-+]?[0-9][0-9_]*$/,
    resolve: (str, _onError, opt) => intResolve2(str, 0, 10, opt),
    stringify: stringifyNumber
  };
  var intHex2 = {
    identify: intIdentify3,
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "HEX",
    test: /^[-+]?0x[0-9a-fA-F_]+$/,
    resolve: (str, _onError, opt) => intResolve2(str, 2, 16, opt),
    stringify: (node) => intStringify2(node, 16, "0x")
  };

  // node_modules/yaml/browser/dist/schema/yaml-1.1/set.js
  var YAMLSet = class _YAMLSet extends YAMLMap {
    constructor(schema4) {
      super(schema4);
      this.tag = _YAMLSet.tag;
    }
    add(key) {
      let pair;
      if (isPair(key))
        pair = key;
      else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
        pair = new Pair(key.key, null);
      else
        pair = new Pair(key, null);
      const prev = findPair(this.items, pair.key);
      if (!prev)
        this.items.push(pair);
    }
    /**
     * If `keepPair` is `true`, returns the Pair matching `key`.
     * Otherwise, returns the value of that Pair's key.
     */
    get(key, keepPair) {
      const pair = findPair(this.items, key);
      return !keepPair && isPair(pair) ? isScalar(pair.key) ? pair.key.value : pair.key : pair;
    }
    set(key, value) {
      if (typeof value !== "boolean")
        throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
      const prev = findPair(this.items, key);
      if (prev && !value) {
        this.items.splice(this.items.indexOf(prev), 1);
      } else if (!prev && value) {
        this.items.push(new Pair(key));
      }
    }
    toJSON(_, ctx) {
      return super.toJSON(_, ctx, Set);
    }
    toString(ctx, onComment, onChompKeep) {
      if (!ctx)
        return JSON.stringify(this);
      if (this.hasAllNullValues(true))
        return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
      else
        throw new Error("Set items must all have null values");
    }
    static from(schema4, iterable, ctx) {
      const { replacer } = ctx;
      const set2 = new this(schema4);
      if (iterable && Symbol.iterator in Object(iterable))
        for (let value of iterable) {
          if (typeof replacer === "function")
            value = replacer.call(iterable, value, value);
          set2.items.push(createPair(value, null, ctx));
        }
      return set2;
    }
  };
  YAMLSet.tag = "tag:yaml.org,2002:set";
  var set = {
    collection: "map",
    identify: (value) => value instanceof Set,
    nodeClass: YAMLSet,
    default: false,
    tag: "tag:yaml.org,2002:set",
    createNode: (schema4, iterable, ctx) => YAMLSet.from(schema4, iterable, ctx),
    resolve(map2, onError) {
      if (isMap(map2)) {
        if (map2.hasAllNullValues(true))
          return Object.assign(new YAMLSet(), map2);
        else
          onError("Set items must all have null values");
      } else
        onError("Expected a mapping for this tag");
      return map2;
    }
  };

  // node_modules/yaml/browser/dist/schema/yaml-1.1/timestamp.js
  function parseSexagesimal(str, asBigInt) {
    const sign = str[0];
    const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
    const num = (n) => asBigInt ? BigInt(n) : Number(n);
    const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
    return sign === "-" ? num(-1) * res : res;
  }
  function stringifySexagesimal(node) {
    let { value } = node;
    let num = (n) => n;
    if (typeof value === "bigint")
      num = (n) => BigInt(n);
    else if (isNaN(value) || !isFinite(value))
      return stringifyNumber(node);
    let sign = "";
    if (value < 0) {
      sign = "-";
      value *= num(-1);
    }
    const _60 = num(60);
    const parts = [value % _60];
    if (value < 60) {
      parts.unshift(0);
    } else {
      value = (value - parts[0]) / _60;
      parts.unshift(value % _60);
      if (value >= 60) {
        value = (value - parts[0]) / _60;
        parts.unshift(value);
      }
    }
    return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
  }
  var intTime = {
    identify: (value) => typeof value === "bigint" || Number.isInteger(value),
    default: true,
    tag: "tag:yaml.org,2002:int",
    format: "TIME",
    test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
    resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
    stringify: stringifySexagesimal
  };
  var floatTime = {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    format: "TIME",
    test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
    resolve: (str) => parseSexagesimal(str, false),
    stringify: stringifySexagesimal
  };
  var timestamp = {
    identify: (value) => value instanceof Date,
    default: true,
    tag: "tag:yaml.org,2002:timestamp",
    // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
    // may be omitted altogether, resulting in a date format. In such a case, the time part is
    // assumed to be 00:00:00Z (start of day, UTC).
    test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
    resolve(str) {
      const match = str.match(timestamp.test);
      if (!match)
        throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
      const [, year, month, day, hour, minute, second] = match.map(Number);
      const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
      let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
      const tz = match[8];
      if (tz && tz !== "Z") {
        let d = parseSexagesimal(tz, false);
        if (Math.abs(d) < 30)
          d *= 60;
        date -= 6e4 * d;
      }
      return new Date(date);
    },
    stringify: ({ value }) => {
      var _a;
      return (_a = value == null ? void 0 : value.toISOString().replace(/(T00:00:00)?\.000Z$/, "")) != null ? _a : "";
    }
  };

  // node_modules/yaml/browser/dist/schema/yaml-1.1/schema.js
  var schema3 = [
    map,
    seq,
    string,
    nullTag,
    trueTag,
    falseTag,
    intBin,
    intOct2,
    int2,
    intHex2,
    floatNaN2,
    floatExp2,
    float2,
    binary,
    merge,
    omap,
    pairs,
    set,
    intTime,
    floatTime,
    timestamp
  ];

  // node_modules/yaml/browser/dist/schema/tags.js
  var schemas = /* @__PURE__ */ new Map([
    ["core", schema],
    ["failsafe", [map, seq, string]],
    ["json", schema2],
    ["yaml11", schema3],
    ["yaml-1.1", schema3]
  ]);
  var tagsByName = {
    binary,
    bool: boolTag,
    float,
    floatExp,
    floatNaN,
    floatTime,
    int,
    intHex,
    intOct,
    intTime,
    map,
    merge,
    null: nullTag,
    omap,
    pairs,
    seq,
    set,
    timestamp
  };
  var coreKnownTags = {
    "tag:yaml.org,2002:binary": binary,
    "tag:yaml.org,2002:merge": merge,
    "tag:yaml.org,2002:omap": omap,
    "tag:yaml.org,2002:pairs": pairs,
    "tag:yaml.org,2002:set": set,
    "tag:yaml.org,2002:timestamp": timestamp
  };
  function getTags(customTags, schemaName, addMergeTag) {
    const schemaTags = schemas.get(schemaName);
    if (schemaTags && !customTags) {
      return addMergeTag && !schemaTags.includes(merge) ? schemaTags.concat(merge) : schemaTags.slice();
    }
    let tags = schemaTags;
    if (!tags) {
      if (Array.isArray(customTags))
        tags = [];
      else {
        const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
        throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
      }
    }
    if (Array.isArray(customTags)) {
      for (const tag of customTags)
        tags = tags.concat(tag);
    } else if (typeof customTags === "function") {
      tags = customTags(tags.slice());
    }
    if (addMergeTag)
      tags = tags.concat(merge);
    return tags.reduce((tags2, tag) => {
      const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
      if (!tagObj) {
        const tagName = JSON.stringify(tag);
        const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
        throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
      }
      if (!tags2.includes(tagObj))
        tags2.push(tagObj);
      return tags2;
    }, []);
  }

  // node_modules/yaml/browser/dist/schema/Schema.js
  var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  var Schema = class _Schema {
    constructor({ compat, customTags, merge: merge2, resolveKnownTags, schema: schema4, sortMapEntries, toStringDefaults }) {
      this.compat = Array.isArray(compat) ? getTags(compat, "compat") : compat ? getTags(null, compat) : null;
      this.name = typeof schema4 === "string" && schema4 || "core";
      this.knownTags = resolveKnownTags ? coreKnownTags : {};
      this.tags = getTags(customTags, this.name, merge2);
      this.toStringOptions = toStringDefaults != null ? toStringDefaults : null;
      Object.defineProperty(this, MAP, { value: map });
      Object.defineProperty(this, SCALAR, { value: string });
      Object.defineProperty(this, SEQ, { value: seq });
      this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
    }
    clone() {
      const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
      copy.tags = this.tags.slice();
      return copy;
    }
  };

  // node_modules/yaml/browser/dist/stringify/stringifyDocument.js
  function stringifyDocument(doc, options) {
    var _a;
    const lines = [];
    let hasDirectives = options.directives === true;
    if (options.directives !== false && doc.directives) {
      const dir = doc.directives.toString(doc);
      if (dir) {
        lines.push(dir);
        hasDirectives = true;
      } else if (doc.directives.docStart)
        hasDirectives = true;
    }
    if (hasDirectives)
      lines.push("---");
    const ctx = createStringifyContext(doc, options);
    const { commentString } = ctx.options;
    if (doc.commentBefore) {
      if (lines.length !== 1)
        lines.unshift("");
      const cs = commentString(doc.commentBefore);
      lines.unshift(indentComment(cs, ""));
    }
    let chompKeep = false;
    let contentComment = null;
    if (doc.contents) {
      if (isNode(doc.contents)) {
        if (doc.contents.spaceBefore && hasDirectives)
          lines.push("");
        if (doc.contents.commentBefore) {
          const cs = commentString(doc.contents.commentBefore);
          lines.push(indentComment(cs, ""));
        }
        ctx.forceBlockIndent = !!doc.comment;
        contentComment = doc.contents.comment;
      }
      const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
      let body = stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
      if (contentComment)
        body += lineComment(body, "", commentString(contentComment));
      if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
        lines[lines.length - 1] = `--- ${body}`;
      } else
        lines.push(body);
    } else {
      lines.push(stringify(doc.contents, ctx));
    }
    if ((_a = doc.directives) == null ? void 0 : _a.docEnd) {
      if (doc.comment) {
        const cs = commentString(doc.comment);
        if (cs.includes("\n")) {
          lines.push("...");
          lines.push(indentComment(cs, ""));
        } else {
          lines.push(`... ${cs}`);
        }
      } else {
        lines.push("...");
      }
    } else {
      let dc = doc.comment;
      if (dc && chompKeep)
        dc = dc.replace(/^\n+/, "");
      if (dc) {
        if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
          lines.push("");
        lines.push(indentComment(commentString(dc), ""));
      }
    }
    return lines.join("\n") + "\n";
  }

  // node_modules/yaml/browser/dist/doc/Document.js
  var Document = class _Document {
    constructor(value, replacer, options) {
      this.commentBefore = null;
      this.comment = null;
      this.errors = [];
      this.warnings = [];
      Object.defineProperty(this, NODE_TYPE, { value: DOC });
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
        replacer = void 0;
      }
      const opt = Object.assign({
        intAsBigInt: false,
        keepSourceTokens: false,
        logLevel: "warn",
        prettyErrors: true,
        strict: true,
        stringKeys: false,
        uniqueKeys: true,
        version: "1.2"
      }, options);
      this.options = opt;
      let { version } = opt;
      if (options == null ? void 0 : options._directives) {
        this.directives = options._directives.atDocument();
        if (this.directives.yaml.explicit)
          version = this.directives.yaml.version;
      } else
        this.directives = new Directives({ version });
      this.setSchema(version, options);
      this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
    }
    /**
     * Create a deep copy of this Document and its contents.
     *
     * Custom Node values that inherit from `Object` still refer to their original instances.
     */
    clone() {
      const copy = Object.create(_Document.prototype, {
        [NODE_TYPE]: { value: DOC }
      });
      copy.commentBefore = this.commentBefore;
      copy.comment = this.comment;
      copy.errors = this.errors.slice();
      copy.warnings = this.warnings.slice();
      copy.options = Object.assign({}, this.options);
      if (this.directives)
        copy.directives = this.directives.clone();
      copy.schema = this.schema.clone();
      copy.contents = isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
      if (this.range)
        copy.range = this.range.slice();
      return copy;
    }
    /** Adds a value to the document. */
    add(value) {
      if (assertCollection(this.contents))
        this.contents.add(value);
    }
    /** Adds a value to the document. */
    addIn(path, value) {
      if (assertCollection(this.contents))
        this.contents.addIn(path, value);
    }
    /**
     * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
     *
     * If `node` already has an anchor, `name` is ignored.
     * Otherwise, the `node.anchor` value will be set to `name`,
     * or if an anchor with that name is already present in the document,
     * `name` will be used as a prefix for a new unique anchor.
     * If `name` is undefined, the generated anchor will use 'a' as a prefix.
     */
    createAlias(node, name) {
      if (!node.anchor) {
        const prev = anchorNames(this);
        node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        !name || prev.has(name) ? findNewAnchor(name || "a", prev) : name;
      }
      return new Alias(node.anchor);
    }
    createNode(value, replacer, options) {
      let _replacer = void 0;
      if (typeof replacer === "function") {
        value = replacer.call({ "": value }, "", value);
        _replacer = replacer;
      } else if (Array.isArray(replacer)) {
        const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
        const asStr = replacer.filter(keyToStr).map(String);
        if (asStr.length > 0)
          replacer = replacer.concat(asStr);
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
        replacer = void 0;
      }
      const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options != null ? options : {};
      const { onAnchor, setAnchors, sourceObjects } = createNodeAnchors(
        this,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        anchorPrefix || "a"
      );
      const ctx = {
        aliasDuplicateObjects: aliasDuplicateObjects != null ? aliasDuplicateObjects : true,
        keepUndefined: keepUndefined != null ? keepUndefined : false,
        onAnchor,
        onTagObj,
        replacer: _replacer,
        schema: this.schema,
        sourceObjects
      };
      const node = createNode(value, tag, ctx);
      if (flow && isCollection(node))
        node.flow = true;
      setAnchors();
      return node;
    }
    /**
     * Convert a key and a value into a `Pair` using the current schema,
     * recursively wrapping all values as `Scalar` or `Collection` nodes.
     */
    createPair(key, value, options = {}) {
      const k = this.createNode(key, null, options);
      const v = this.createNode(value, null, options);
      return new Pair(k, v);
    }
    /**
     * Removes a value from the document.
     * @returns `true` if the item was found and removed.
     */
    delete(key) {
      return assertCollection(this.contents) ? this.contents.delete(key) : false;
    }
    /**
     * Removes a value from the document.
     * @returns `true` if the item was found and removed.
     */
    deleteIn(path) {
      if (isEmptyPath(path)) {
        if (this.contents == null)
          return false;
        this.contents = null;
        return true;
      }
      return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
    }
    /**
     * Returns item at `key`, or `undefined` if not found. By default unwraps
     * scalar values from their surrounding node; to disable set `keepScalar` to
     * `true` (collections are always returned intact).
     */
    get(key, keepScalar) {
      return isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
    }
    /**
     * Returns item at `path`, or `undefined` if not found. By default unwraps
     * scalar values from their surrounding node; to disable set `keepScalar` to
     * `true` (collections are always returned intact).
     */
    getIn(path, keepScalar) {
      if (isEmptyPath(path))
        return !keepScalar && isScalar(this.contents) ? this.contents.value : this.contents;
      return isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
    }
    /**
     * Checks if the document includes a value with the key `key`.
     */
    has(key) {
      return isCollection(this.contents) ? this.contents.has(key) : false;
    }
    /**
     * Checks if the document includes a value at `path`.
     */
    hasIn(path) {
      if (isEmptyPath(path))
        return this.contents !== void 0;
      return isCollection(this.contents) ? this.contents.hasIn(path) : false;
    }
    /**
     * Sets a value in this document. For `!!set`, `value` needs to be a
     * boolean to add/remove the item from the set.
     */
    set(key, value) {
      if (this.contents == null) {
        this.contents = collectionFromPath(this.schema, [key], value);
      } else if (assertCollection(this.contents)) {
        this.contents.set(key, value);
      }
    }
    /**
     * Sets a value in this document. For `!!set`, `value` needs to be a
     * boolean to add/remove the item from the set.
     */
    setIn(path, value) {
      if (isEmptyPath(path)) {
        this.contents = value;
      } else if (this.contents == null) {
        this.contents = collectionFromPath(this.schema, Array.from(path), value);
      } else if (assertCollection(this.contents)) {
        this.contents.setIn(path, value);
      }
    }
    /**
     * Change the YAML version and schema used by the document.
     * A `null` version disables support for directives, explicit tags, anchors, and aliases.
     * It also requires the `schema` option to be given as a `Schema` instance value.
     *
     * Overrides all previously set schema options.
     */
    setSchema(version, options = {}) {
      if (typeof version === "number")
        version = String(version);
      let opt;
      switch (version) {
        case "1.1":
          if (this.directives)
            this.directives.yaml.version = "1.1";
          else
            this.directives = new Directives({ version: "1.1" });
          opt = { resolveKnownTags: false, schema: "yaml-1.1" };
          break;
        case "1.2":
        case "next":
          if (this.directives)
            this.directives.yaml.version = version;
          else
            this.directives = new Directives({ version });
          opt = { resolveKnownTags: true, schema: "core" };
          break;
        case null:
          if (this.directives)
            delete this.directives;
          opt = null;
          break;
        default: {
          const sv = JSON.stringify(version);
          throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
        }
      }
      if (options.schema instanceof Object)
        this.schema = options.schema;
      else if (opt)
        this.schema = new Schema(Object.assign(opt, options));
      else
        throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
    }
    // json & jsonArg are only used from toJSON()
    toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
      const ctx = {
        anchors: /* @__PURE__ */ new Map(),
        doc: this,
        keep: !json,
        mapAsMap: mapAsMap === true,
        mapKeyWarned: false,
        maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
      };
      const res = toJS(this.contents, jsonArg != null ? jsonArg : "", ctx);
      if (typeof onAnchor === "function")
        for (const { count, res: res2 } of ctx.anchors.values())
          onAnchor(res2, count);
      return typeof reviver === "function" ? applyReviver(reviver, { "": res }, "", res) : res;
    }
    /**
     * A JSON representation of the document `contents`.
     *
     * @param jsonArg Used by `JSON.stringify` to indicate the array index or
     *   property name.
     */
    toJSON(jsonArg, onAnchor) {
      return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
    }
    /** A YAML representation of the document. */
    toString(options = {}) {
      if (this.errors.length > 0)
        throw new Error("Document with errors cannot be stringified");
      if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
        const s = JSON.stringify(options.indent);
        throw new Error(`"indent" option must be a positive integer, not ${s}`);
      }
      return stringifyDocument(this, options);
    }
  };
  function assertCollection(contents) {
    if (isCollection(contents))
      return true;
    throw new Error("Expected a YAML collection as document contents");
  }

  // node_modules/yaml/browser/dist/errors.js
  var YAMLError = class extends Error {
    constructor(name, pos, code, message) {
      super();
      this.name = name;
      this.code = code;
      this.message = message;
      this.pos = pos;
    }
  };
  var YAMLParseError = class extends YAMLError {
    constructor(pos, code, message) {
      super("YAMLParseError", pos, code, message);
    }
  };
  var YAMLWarning = class extends YAMLError {
    constructor(pos, code, message) {
      super("YAMLWarning", pos, code, message);
    }
  };
  var prettifyError = (src, lc) => (error) => {
    if (error.pos[0] === -1)
      return;
    error.linePos = error.pos.map((pos) => lc.linePos(pos));
    const { line, col } = error.linePos[0];
    error.message += ` at line ${line}, column ${col}`;
    let ci = col - 1;
    let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
    if (ci >= 60 && lineStr.length > 80) {
      const trimStart = Math.min(ci - 39, lineStr.length - 79);
      lineStr = "\u2026" + lineStr.substring(trimStart);
      ci -= trimStart - 1;
    }
    if (lineStr.length > 80)
      lineStr = lineStr.substring(0, 79) + "\u2026";
    if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
      let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
      if (prev.length > 80)
        prev = prev.substring(0, 79) + "\u2026\n";
      lineStr = prev + lineStr;
    }
    if (/[^ ]/.test(lineStr)) {
      let count = 1;
      const end = error.linePos[1];
      if ((end == null ? void 0 : end.line) === line && end.col > col) {
        count = Math.max(1, Math.min(end.col - col, 80 - ci));
      }
      const pointer = " ".repeat(ci) + "^".repeat(count);
      error.message += `:

${lineStr}
${pointer}
`;
    }
  };

  // node_modules/yaml/browser/dist/compose/resolve-props.js
  function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
    let spaceBefore = false;
    let atNewline = startOnNewline;
    let hasSpace = startOnNewline;
    let comment = "";
    let commentSep = "";
    let hasNewline = false;
    let reqSpace = false;
    let tab = null;
    let anchor = null;
    let tag = null;
    let newlineAfterProp = null;
    let comma = null;
    let found = null;
    let start = null;
    for (const token of tokens) {
      if (reqSpace) {
        if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
          onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
        reqSpace = false;
      }
      if (tab) {
        if (atNewline && token.type !== "comment" && token.type !== "newline") {
          onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
        }
        tab = null;
      }
      switch (token.type) {
        case "space":
          if (!flow && (indicator !== "doc-start" || (next == null ? void 0 : next.type) !== "flow-collection") && token.source.includes("	")) {
            tab = token;
          }
          hasSpace = true;
          break;
        case "comment": {
          if (!hasSpace)
            onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
          const cb = token.source.substring(1) || " ";
          if (!comment)
            comment = cb;
          else
            comment += commentSep + cb;
          commentSep = "";
          atNewline = false;
          break;
        }
        case "newline":
          if (atNewline) {
            if (comment)
              comment += token.source;
            else if (!found || indicator !== "seq-item-ind")
              spaceBefore = true;
          } else
            commentSep += token.source;
          atNewline = true;
          hasNewline = true;
          if (anchor || tag)
            newlineAfterProp = token;
          hasSpace = true;
          break;
        case "anchor":
          if (anchor)
            onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
          if (token.source.endsWith(":"))
            onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
          anchor = token;
          start != null ? start : start = token.offset;
          atNewline = false;
          hasSpace = false;
          reqSpace = true;
          break;
        case "tag": {
          if (tag)
            onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
          tag = token;
          start != null ? start : start = token.offset;
          atNewline = false;
          hasSpace = false;
          reqSpace = true;
          break;
        }
        case indicator:
          if (anchor || tag)
            onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
          if (found)
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow != null ? flow : "collection"}`);
          found = token;
          atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
          hasSpace = false;
          break;
        case "comma":
          if (flow) {
            if (comma)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
            comma = token;
            atNewline = false;
            hasSpace = false;
            break;
          }
        // else fallthrough
        default:
          onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
          atNewline = false;
          hasSpace = false;
      }
    }
    const last = tokens[tokens.length - 1];
    const end = last ? last.offset + last.source.length : offset;
    if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
      onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
    }
    if (tab && (atNewline && tab.indent <= parentIndent || (next == null ? void 0 : next.type) === "block-map" || (next == null ? void 0 : next.type) === "block-seq"))
      onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
    return {
      comma,
      found,
      spaceBefore,
      comment,
      hasNewline,
      anchor,
      tag,
      newlineAfterProp,
      end,
      start: start != null ? start : end
    };
  }

  // node_modules/yaml/browser/dist/compose/util-contains-newline.js
  function containsNewline(key) {
    if (!key)
      return null;
    switch (key.type) {
      case "alias":
      case "scalar":
      case "double-quoted-scalar":
      case "single-quoted-scalar":
        if (key.source.includes("\n"))
          return true;
        if (key.end) {
          for (const st of key.end)
            if (st.type === "newline")
              return true;
        }
        return false;
      case "flow-collection":
        for (const it of key.items) {
          for (const st of it.start)
            if (st.type === "newline")
              return true;
          if (it.sep) {
            for (const st of it.sep)
              if (st.type === "newline")
                return true;
          }
          if (containsNewline(it.key) || containsNewline(it.value))
            return true;
        }
        return false;
      default:
        return true;
    }
  }

  // node_modules/yaml/browser/dist/compose/util-flow-indent-check.js
  function flowIndentCheck(indent, fc, onError) {
    if ((fc == null ? void 0 : fc.type) === "flow-collection") {
      const end = fc.end[0];
      if (end.indent === indent && (end.source === "]" || end.source === "}") && containsNewline(fc)) {
        const msg = "Flow end indicator should be more indented than parent";
        onError(end, "BAD_INDENT", msg, true);
      }
    }
  }

  // node_modules/yaml/browser/dist/compose/util-map-includes.js
  function mapIncludes(ctx, items, search) {
    const { uniqueKeys } = ctx.options;
    if (uniqueKeys === false)
      return false;
    const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || isScalar(a) && isScalar(b) && a.value === b.value;
    return items.some((pair) => isEqual(pair.key, search));
  }

  // node_modules/yaml/browser/dist/compose/resolve-block-map.js
  var startColMsg = "All mapping items must start at the same column";
  function resolveBlockMap({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, bm, onError, tag) {
    var _a, _b;
    const NodeClass = (_a = tag == null ? void 0 : tag.nodeClass) != null ? _a : YAMLMap;
    const map2 = new NodeClass(ctx.schema);
    if (ctx.atRoot)
      ctx.atRoot = false;
    let offset = bm.offset;
    let commentEnd = null;
    for (const collItem of bm.items) {
      const { start, key, sep, value } = collItem;
      const keyProps = resolveProps(start, {
        indicator: "explicit-key-ind",
        next: key != null ? key : sep == null ? void 0 : sep[0],
        offset,
        onError,
        parentIndent: bm.indent,
        startOnNewline: true
      });
      const implicitKey = !keyProps.found;
      if (implicitKey) {
        if (key) {
          if (key.type === "block-seq")
            onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
          else if ("indent" in key && key.indent !== bm.indent)
            onError(offset, "BAD_INDENT", startColMsg);
        }
        if (!keyProps.anchor && !keyProps.tag && !sep) {
          commentEnd = keyProps.end;
          if (keyProps.comment) {
            if (map2.comment)
              map2.comment += "\n" + keyProps.comment;
            else
              map2.comment = keyProps.comment;
          }
          continue;
        }
        if (keyProps.newlineAfterProp || containsNewline(key)) {
          onError(key != null ? key : start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
        }
      } else if (((_b = keyProps.found) == null ? void 0 : _b.indent) !== bm.indent) {
        onError(offset, "BAD_INDENT", startColMsg);
      }
      ctx.atKey = true;
      const keyStart = keyProps.end;
      const keyNode = key ? composeNode2(ctx, key, keyProps, onError) : composeEmptyNode2(ctx, keyStart, start, null, keyProps, onError);
      if (ctx.schema.compat)
        flowIndentCheck(bm.indent, key, onError);
      ctx.atKey = false;
      if (mapIncludes(ctx, map2.items, keyNode))
        onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
      const valueProps = resolveProps(sep != null ? sep : [], {
        indicator: "map-value-ind",
        next: value,
        offset: keyNode.range[2],
        onError,
        parentIndent: bm.indent,
        startOnNewline: !key || key.type === "block-scalar"
      });
      offset = valueProps.end;
      if (valueProps.found) {
        if (implicitKey) {
          if ((value == null ? void 0 : value.type) === "block-map" && !valueProps.hasNewline)
            onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
          if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
            onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
        }
        const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : composeEmptyNode2(ctx, offset, sep, null, valueProps, onError);
        if (ctx.schema.compat)
          flowIndentCheck(bm.indent, value, onError);
        offset = valueNode.range[2];
        const pair = new Pair(keyNode, valueNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        map2.items.push(pair);
      } else {
        if (implicitKey)
          onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
        if (valueProps.comment) {
          if (keyNode.comment)
            keyNode.comment += "\n" + valueProps.comment;
          else
            keyNode.comment = valueProps.comment;
        }
        const pair = new Pair(keyNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        map2.items.push(pair);
      }
    }
    if (commentEnd && commentEnd < offset)
      onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
    map2.range = [bm.offset, offset, commentEnd != null ? commentEnd : offset];
    return map2;
  }

  // node_modules/yaml/browser/dist/compose/resolve-block-seq.js
  function resolveBlockSeq({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, bs, onError, tag) {
    var _a;
    const NodeClass = (_a = tag == null ? void 0 : tag.nodeClass) != null ? _a : YAMLSeq;
    const seq2 = new NodeClass(ctx.schema);
    if (ctx.atRoot)
      ctx.atRoot = false;
    if (ctx.atKey)
      ctx.atKey = false;
    let offset = bs.offset;
    let commentEnd = null;
    for (const { start, value } of bs.items) {
      const props = resolveProps(start, {
        indicator: "seq-item-ind",
        next: value,
        offset,
        onError,
        parentIndent: bs.indent,
        startOnNewline: true
      });
      if (!props.found) {
        if (props.anchor || props.tag || value) {
          if ((value == null ? void 0 : value.type) === "block-seq")
            onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
          else
            onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
        } else {
          commentEnd = props.end;
          if (props.comment)
            seq2.comment = props.comment;
          continue;
        }
      }
      const node = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode2(ctx, props.end, start, null, props, onError);
      if (ctx.schema.compat)
        flowIndentCheck(bs.indent, value, onError);
      offset = node.range[2];
      seq2.items.push(node);
    }
    seq2.range = [bs.offset, offset, commentEnd != null ? commentEnd : offset];
    return seq2;
  }

  // node_modules/yaml/browser/dist/compose/resolve-end.js
  function resolveEnd(end, offset, reqSpace, onError) {
    let comment = "";
    if (end) {
      let hasSpace = false;
      let sep = "";
      for (const token of end) {
        const { source, type } = token;
        switch (type) {
          case "space":
            hasSpace = true;
            break;
          case "comment": {
            if (reqSpace && !hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += sep + cb;
            sep = "";
            break;
          }
          case "newline":
            if (comment)
              sep += source;
            hasSpace = true;
            break;
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
        }
        offset += source.length;
      }
    }
    return { comment, offset };
  }

  // node_modules/yaml/browser/dist/compose/resolve-flow-collection.js
  var blockMsg = "Block collections are not allowed within flow collections";
  var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
  function resolveFlowCollection({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, fc, onError, tag) {
    var _a, _b, _c;
    const isMap2 = fc.start.source === "{";
    const fcName = isMap2 ? "flow map" : "flow sequence";
    const NodeClass = (_a = tag == null ? void 0 : tag.nodeClass) != null ? _a : isMap2 ? YAMLMap : YAMLSeq;
    const coll = new NodeClass(ctx.schema);
    coll.flow = true;
    const atRoot = ctx.atRoot;
    if (atRoot)
      ctx.atRoot = false;
    if (ctx.atKey)
      ctx.atKey = false;
    let offset = fc.offset + fc.start.source.length;
    for (let i = 0; i < fc.items.length; ++i) {
      const collItem = fc.items[i];
      const { start, key, sep, value } = collItem;
      const props = resolveProps(start, {
        flow: fcName,
        indicator: "explicit-key-ind",
        next: key != null ? key : sep == null ? void 0 : sep[0],
        offset,
        onError,
        parentIndent: fc.indent,
        startOnNewline: false
      });
      if (!props.found) {
        if (!props.anchor && !props.tag && !sep && !value) {
          if (i === 0 && props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
          else if (i < fc.items.length - 1)
            onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
          if (props.comment) {
            if (coll.comment)
              coll.comment += "\n" + props.comment;
            else
              coll.comment = props.comment;
          }
          offset = props.end;
          continue;
        }
        if (!isMap2 && ctx.options.strict && containsNewline(key))
          onError(
            key,
            // checked by containsNewline()
            "MULTILINE_IMPLICIT_KEY",
            "Implicit keys of flow sequence pairs need to be on a single line"
          );
      }
      if (i === 0) {
        if (props.comma)
          onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
      } else {
        if (!props.comma)
          onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
        if (props.comment) {
          let prevItemComment = "";
          loop: for (const st of start) {
            switch (st.type) {
              case "comma":
              case "space":
                break;
              case "comment":
                prevItemComment = st.source.substring(1);
                break loop;
              default:
                break loop;
            }
          }
          if (prevItemComment) {
            let prev = coll.items[coll.items.length - 1];
            if (isPair(prev))
              prev = (_b = prev.value) != null ? _b : prev.key;
            if (prev.comment)
              prev.comment += "\n" + prevItemComment;
            else
              prev.comment = prevItemComment;
            props.comment = props.comment.substring(prevItemComment.length + 1);
          }
        }
      }
      if (!isMap2 && !sep && !props.found) {
        const valueNode = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode2(ctx, props.end, sep, null, props, onError);
        coll.items.push(valueNode);
        offset = valueNode.range[2];
        if (isBlock(value))
          onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
      } else {
        ctx.atKey = true;
        const keyStart = props.end;
        const keyNode = key ? composeNode2(ctx, key, props, onError) : composeEmptyNode2(ctx, keyStart, start, null, props, onError);
        if (isBlock(key))
          onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
        ctx.atKey = false;
        const valueProps = resolveProps(sep != null ? sep : [], {
          flow: fcName,
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (valueProps.found) {
          if (!isMap2 && !props.found && ctx.options.strict) {
            if (sep)
              for (const st of sep) {
                if (st === valueProps.found)
                  break;
                if (st.type === "newline") {
                  onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                  break;
                }
              }
            if (props.start < valueProps.found.offset - 1024)
              onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
          }
        } else if (value) {
          if ("source" in value && ((_c = value.source) == null ? void 0 : _c[0]) === ":")
            onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
          else
            onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
        }
        const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode2(ctx, valueProps.end, sep, null, valueProps, onError) : null;
        if (valueNode) {
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else if (valueProps.comment) {
          if (keyNode.comment)
            keyNode.comment += "\n" + valueProps.comment;
          else
            keyNode.comment = valueProps.comment;
        }
        const pair = new Pair(keyNode, valueNode);
        if (ctx.options.keepSourceTokens)
          pair.srcToken = collItem;
        if (isMap2) {
          const map2 = coll;
          if (mapIncludes(ctx, map2.items, keyNode))
            onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
          map2.items.push(pair);
        } else {
          const map2 = new YAMLMap(ctx.schema);
          map2.flow = true;
          map2.items.push(pair);
          const endRange = (valueNode != null ? valueNode : keyNode).range;
          map2.range = [keyNode.range[0], endRange[1], endRange[2]];
          coll.items.push(map2);
        }
        offset = valueNode ? valueNode.range[2] : valueProps.end;
      }
    }
    const expectedEnd = isMap2 ? "}" : "]";
    const [ce, ...ee] = fc.end;
    let cePos = offset;
    if ((ce == null ? void 0 : ce.source) === expectedEnd)
      cePos = ce.offset + ce.source.length;
    else {
      const name = fcName[0].toUpperCase() + fcName.substring(1);
      const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
      onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
      if (ce && ce.source.length !== 1)
        ee.unshift(ce);
    }
    if (ee.length > 0) {
      const end = resolveEnd(ee, cePos, ctx.options.strict, onError);
      if (end.comment) {
        if (coll.comment)
          coll.comment += "\n" + end.comment;
        else
          coll.comment = end.comment;
      }
      coll.range = [fc.offset, cePos, end.offset];
    } else {
      coll.range = [fc.offset, cePos, cePos];
    }
    return coll;
  }

  // node_modules/yaml/browser/dist/compose/compose-collection.js
  function resolveCollection(CN2, ctx, token, onError, tagName, tag) {
    const coll = token.type === "block-map" ? resolveBlockMap(CN2, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq(CN2, ctx, token, onError, tag) : resolveFlowCollection(CN2, ctx, token, onError, tag);
    const Coll = coll.constructor;
    if (tagName === "!" || tagName === Coll.tagName) {
      coll.tag = Coll.tagName;
      return coll;
    }
    if (tagName)
      coll.tag = tagName;
    return coll;
  }
  function composeCollection(CN2, ctx, token, props, onError) {
    var _a, _b, _c;
    const tagToken = props.tag;
    const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
    if (token.type === "block-seq") {
      const { anchor, newlineAfterProp: nl } = props;
      const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor != null ? anchor : tagToken;
      if (lastProp && (!nl || nl.offset < lastProp.offset)) {
        const message = "Missing newline after block sequence props";
        onError(lastProp, "MISSING_CHAR", message);
      }
    }
    const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
    if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.tagName && expType === "seq") {
      return resolveCollection(CN2, ctx, token, onError, tagName);
    }
    let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
    if (!tag) {
      const kt = ctx.schema.knownTags[tagName];
      if ((kt == null ? void 0 : kt.collection) === expType) {
        ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
        tag = kt;
      } else {
        if (kt) {
          onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${(_a = kt.collection) != null ? _a : "scalar"}`, true);
        } else {
          onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
        }
        return resolveCollection(CN2, ctx, token, onError, tagName);
      }
    }
    const coll = resolveCollection(CN2, ctx, token, onError, tagName, tag);
    const res = (_c = (_b = tag.resolve) == null ? void 0 : _b.call(tag, coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options)) != null ? _c : coll;
    const node = isNode(res) ? res : new Scalar(res);
    node.range = coll.range;
    node.tag = tagName;
    if (tag == null ? void 0 : tag.format)
      node.format = tag.format;
    return node;
  }

  // node_modules/yaml/browser/dist/compose/resolve-block-scalar.js
  function resolveBlockScalar(ctx, scalar, onError) {
    const start = scalar.offset;
    const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
    if (!header)
      return { value: "", type: null, comment: "", range: [start, start, start] };
    const type = header.mode === ">" ? Scalar.BLOCK_FOLDED : Scalar.BLOCK_LITERAL;
    const lines = scalar.source ? splitLines(scalar.source) : [];
    let chompStart = lines.length;
    for (let i = lines.length - 1; i >= 0; --i) {
      const content = lines[i][1];
      if (content === "" || content === "\r")
        chompStart = i;
      else
        break;
    }
    if (chompStart === 0) {
      const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
      let end2 = start + header.length;
      if (scalar.source)
        end2 += scalar.source.length;
      return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
    }
    let trimIndent = scalar.indent + header.indent;
    let offset = scalar.offset + header.length;
    let contentStart = 0;
    for (let i = 0; i < chompStart; ++i) {
      const [indent, content] = lines[i];
      if (content === "" || content === "\r") {
        if (header.indent === 0 && indent.length > trimIndent)
          trimIndent = indent.length;
      } else {
        if (indent.length < trimIndent) {
          const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
          onError(offset + indent.length, "MISSING_CHAR", message);
        }
        if (header.indent === 0)
          trimIndent = indent.length;
        contentStart = i;
        if (trimIndent === 0 && !ctx.atRoot) {
          const message = "Block scalar values in collections must be indented";
          onError(offset, "BAD_INDENT", message);
        }
        break;
      }
      offset += indent.length + content.length + 1;
    }
    for (let i = lines.length - 1; i >= chompStart; --i) {
      if (lines[i][0].length > trimIndent)
        chompStart = i + 1;
    }
    let value = "";
    let sep = "";
    let prevMoreIndented = false;
    for (let i = 0; i < contentStart; ++i)
      value += lines[i][0].slice(trimIndent) + "\n";
    for (let i = contentStart; i < chompStart; ++i) {
      let [indent, content] = lines[i];
      offset += indent.length + content.length + 1;
      const crlf = content[content.length - 1] === "\r";
      if (crlf)
        content = content.slice(0, -1);
      if (content && indent.length < trimIndent) {
        const src = header.indent ? "explicit indentation indicator" : "first line";
        const message = `Block scalar lines must not be less indented than their ${src}`;
        onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
        indent = "";
      }
      if (type === Scalar.BLOCK_LITERAL) {
        value += sep + indent.slice(trimIndent) + content;
        sep = "\n";
      } else if (indent.length > trimIndent || content[0] === "	") {
        if (sep === " ")
          sep = "\n";
        else if (!prevMoreIndented && sep === "\n")
          sep = "\n\n";
        value += sep + indent.slice(trimIndent) + content;
        sep = "\n";
        prevMoreIndented = true;
      } else if (content === "") {
        if (sep === "\n")
          value += "\n";
        else
          sep = "\n";
      } else {
        value += sep + content;
        sep = " ";
        prevMoreIndented = false;
      }
    }
    switch (header.chomp) {
      case "-":
        break;
      case "+":
        for (let i = chompStart; i < lines.length; ++i)
          value += "\n" + lines[i][0].slice(trimIndent);
        if (value[value.length - 1] !== "\n")
          value += "\n";
        break;
      default:
        value += "\n";
    }
    const end = start + header.length + scalar.source.length;
    return { value, type, comment: header.comment, range: [start, end, end] };
  }
  function parseBlockScalarHeader({ offset, props }, strict, onError) {
    if (props[0].type !== "block-scalar-header") {
      onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
      return null;
    }
    const { source } = props[0];
    const mode = source[0];
    let indent = 0;
    let chomp = "";
    let error = -1;
    for (let i = 1; i < source.length; ++i) {
      const ch = source[i];
      if (!chomp && (ch === "-" || ch === "+"))
        chomp = ch;
      else {
        const n = Number(ch);
        if (!indent && n)
          indent = n;
        else if (error === -1)
          error = offset + i;
      }
    }
    if (error !== -1)
      onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
    let hasSpace = false;
    let comment = "";
    let length = source.length;
    for (let i = 1; i < props.length; ++i) {
      const token = props[i];
      switch (token.type) {
        case "space":
          hasSpace = true;
        // fallthrough
        case "newline":
          length += token.source.length;
          break;
        case "comment":
          if (strict && !hasSpace) {
            const message = "Comments must be separated from other tokens by white space characters";
            onError(token, "MISSING_CHAR", message);
          }
          length += token.source.length;
          comment = token.source.substring(1);
          break;
        case "error":
          onError(token, "UNEXPECTED_TOKEN", token.message);
          length += token.source.length;
          break;
        /* istanbul ignore next should not happen */
        default: {
          const message = `Unexpected token in block scalar header: ${token.type}`;
          onError(token, "UNEXPECTED_TOKEN", message);
          const ts = token.source;
          if (ts && typeof ts === "string")
            length += ts.length;
        }
      }
    }
    return { mode, indent, chomp, comment, length };
  }
  function splitLines(source) {
    const split = source.split(/\n( *)/);
    const first = split[0];
    const m = first.match(/^( *)/);
    const line0 = (m == null ? void 0 : m[1]) ? [m[1], first.slice(m[1].length)] : ["", first];
    const lines = [line0];
    for (let i = 1; i < split.length; i += 2)
      lines.push([split[i], split[i + 1]]);
    return lines;
  }

  // node_modules/yaml/browser/dist/compose/resolve-flow-scalar.js
  function resolveFlowScalar(scalar, strict, onError) {
    const { offset, type, source, end } = scalar;
    let _type;
    let value;
    const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
    switch (type) {
      case "scalar":
        _type = Scalar.PLAIN;
        value = plainValue(source, _onError);
        break;
      case "single-quoted-scalar":
        _type = Scalar.QUOTE_SINGLE;
        value = singleQuotedValue(source, _onError);
        break;
      case "double-quoted-scalar":
        _type = Scalar.QUOTE_DOUBLE;
        value = doubleQuotedValue(source, _onError);
        break;
      /* istanbul ignore next should not happen */
      default:
        onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
        return {
          value: "",
          type: null,
          comment: "",
          range: [offset, offset + source.length, offset + source.length]
        };
    }
    const valueEnd = offset + source.length;
    const re = resolveEnd(end, valueEnd, strict, onError);
    return {
      value,
      type: _type,
      comment: re.comment,
      range: [offset, valueEnd, re.offset]
    };
  }
  function plainValue(source, onError) {
    let badChar = "";
    switch (source[0]) {
      /* istanbul ignore next should not happen */
      case "	":
        badChar = "a tab character";
        break;
      case ",":
        badChar = "flow indicator character ,";
        break;
      case "%":
        badChar = "directive indicator character %";
        break;
      case "|":
      case ">": {
        badChar = `block scalar indicator ${source[0]}`;
        break;
      }
      case "@":
      case "`": {
        badChar = `reserved character ${source[0]}`;
        break;
      }
    }
    if (badChar)
      onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
    return foldLines(source);
  }
  function singleQuotedValue(source, onError) {
    if (source[source.length - 1] !== "'" || source.length === 1)
      onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
    return foldLines(source.slice(1, -1)).replace(/''/g, "'");
  }
  function foldLines(source) {
    var _a;
    let first, line;
    try {
      first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
      line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
    } catch (e) {
      first = new RegExp("(.*?)[ \\t]*\\r?\\n", "sy");
      line = new RegExp("[ \\t]*(.*?)[ \\t]*\\r?\\n", "sy");
    }
    let match = first.exec(source);
    if (!match)
      return source;
    let res = match[1];
    let sep = " ";
    let pos = first.lastIndex;
    line.lastIndex = pos;
    while (match = line.exec(source)) {
      if (match[1] === "") {
        if (sep === "\n")
          res += sep;
        else
          sep = "\n";
      } else {
        res += sep + match[1];
        sep = " ";
      }
      pos = line.lastIndex;
    }
    const last = new RegExp("[ \\t]*(.*)", "sy");
    last.lastIndex = pos;
    match = last.exec(source);
    return res + sep + ((_a = match == null ? void 0 : match[1]) != null ? _a : "");
  }
  function doubleQuotedValue(source, onError) {
    let res = "";
    for (let i = 1; i < source.length - 1; ++i) {
      const ch = source[i];
      if (ch === "\r" && source[i + 1] === "\n")
        continue;
      if (ch === "\n") {
        const { fold, offset } = foldNewline(source, i);
        res += fold;
        i = offset;
      } else if (ch === "\\") {
        let next = source[++i];
        const cc = escapeCodes[next];
        if (cc)
          res += cc;
        else if (next === "\n") {
          next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
        } else if (next === "\r" && source[i + 1] === "\n") {
          next = source[++i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
        } else if (next === "x" || next === "u" || next === "U") {
          const length = { x: 2, u: 4, U: 8 }[next];
          res += parseCharCode(source, i + 1, length, onError);
          i += length;
        } else {
          const raw = source.substr(i - 1, 2);
          onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
          res += raw;
        }
      } else if (ch === " " || ch === "	") {
        const wsStart = i;
        let next = source[i + 1];
        while (next === " " || next === "	")
          next = source[++i + 1];
        if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
          res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
      } else {
        res += ch;
      }
    }
    if (source[source.length - 1] !== '"' || source.length === 1)
      onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
    return res;
  }
  function foldNewline(source, offset) {
    let fold = "";
    let ch = source[offset + 1];
    while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[offset + 2] !== "\n")
        break;
      if (ch === "\n")
        fold += "\n";
      offset += 1;
      ch = source[offset + 1];
    }
    if (!fold)
      fold = " ";
    return { fold, offset };
  }
  var escapeCodes = {
    "0": "\0",
    // null character
    a: "\x07",
    // bell character
    b: "\b",
    // backspace
    e: "\x1B",
    // escape character
    f: "\f",
    // form feed
    n: "\n",
    // line feed
    r: "\r",
    // carriage return
    t: "	",
    // horizontal tab
    v: "\v",
    // vertical tab
    N: "\x85",
    // Unicode next line
    _: "\xA0",
    // Unicode non-breaking space
    L: "\u2028",
    // Unicode line separator
    P: "\u2029",
    // Unicode paragraph separator
    " ": " ",
    '"': '"',
    "/": "/",
    "\\": "\\",
    "	": "	"
  };
  function parseCharCode(source, offset, length, onError) {
    const cc = source.substr(offset, length);
    const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
    const code = ok ? parseInt(cc, 16) : NaN;
    if (isNaN(code)) {
      const raw = source.substr(offset - 2, length + 2);
      onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
      return raw;
    }
    return String.fromCodePoint(code);
  }

  // node_modules/yaml/browser/dist/compose/compose-scalar.js
  function composeScalar(ctx, token, tagToken, onError) {
    const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar(ctx, token, onError) : resolveFlowScalar(token, ctx.options.strict, onError);
    const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
    let tag;
    if (ctx.options.stringKeys && ctx.atKey) {
      tag = ctx.schema[SCALAR];
    } else if (tagName)
      tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
    else if (token.type === "scalar")
      tag = findScalarTagByTest(ctx, value, token, onError);
    else
      tag = ctx.schema[SCALAR];
    let scalar;
    try {
      const res = tag.resolve(value, (msg) => onError(tagToken != null ? tagToken : token, "TAG_RESOLVE_FAILED", msg), ctx.options);
      scalar = isScalar(res) ? res : new Scalar(res);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onError(tagToken != null ? tagToken : token, "TAG_RESOLVE_FAILED", msg);
      scalar = new Scalar(value);
    }
    scalar.range = range;
    scalar.source = value;
    if (type)
      scalar.type = type;
    if (tagName)
      scalar.tag = tagName;
    if (tag.format)
      scalar.format = tag.format;
    if (comment)
      scalar.comment = comment;
    return scalar;
  }
  function findScalarTagByName(schema4, value, tagName, tagToken, onError) {
    var _a;
    if (tagName === "!")
      return schema4[SCALAR];
    const matchWithTest = [];
    for (const tag of schema4.tags) {
      if (!tag.collection && tag.tag === tagName) {
        if (tag.default && tag.test)
          matchWithTest.push(tag);
        else
          return tag;
      }
    }
    for (const tag of matchWithTest)
      if ((_a = tag.test) == null ? void 0 : _a.test(value))
        return tag;
    const kt = schema4.knownTags[tagName];
    if (kt && !kt.collection) {
      schema4.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
      return kt;
    }
    onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
    return schema4[SCALAR];
  }
  function findScalarTagByTest({ atKey, directives, schema: schema4 }, value, token, onError) {
    var _a;
    const tag = schema4.tags.find((tag2) => {
      var _a2;
      return (tag2.default === true || atKey && tag2.default === "key") && ((_a2 = tag2.test) == null ? void 0 : _a2.test(value));
    }) || schema4[SCALAR];
    if (schema4.compat) {
      const compat = (_a = schema4.compat.find((tag2) => {
        var _a2;
        return tag2.default && ((_a2 = tag2.test) == null ? void 0 : _a2.test(value));
      })) != null ? _a : schema4[SCALAR];
      if (tag.tag !== compat.tag) {
        const ts = directives.tagString(tag.tag);
        const cs = directives.tagString(compat.tag);
        const msg = `Value may be parsed as either ${ts} or ${cs}`;
        onError(token, "TAG_RESOLVE_FAILED", msg, true);
      }
    }
    return tag;
  }

  // node_modules/yaml/browser/dist/compose/util-empty-scalar-position.js
  function emptyScalarPosition(offset, before, pos) {
    if (before) {
      pos != null ? pos : pos = before.length;
      for (let i = pos - 1; i >= 0; --i) {
        let st = before[i];
        switch (st.type) {
          case "space":
          case "comment":
          case "newline":
            offset -= st.source.length;
            continue;
        }
        st = before[++i];
        while ((st == null ? void 0 : st.type) === "space") {
          offset += st.source.length;
          st = before[++i];
        }
        break;
      }
    }
    return offset;
  }

  // node_modules/yaml/browser/dist/compose/compose-node.js
  var CN = { composeNode, composeEmptyNode };
  function composeNode(ctx, token, props, onError) {
    const atKey = ctx.atKey;
    const { spaceBefore, comment, anchor, tag } = props;
    let node;
    let isSrcToken = true;
    switch (token.type) {
      case "alias":
        node = composeAlias(ctx, token, onError);
        if (anchor || tag)
          onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
        break;
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
      case "block-scalar":
        node = composeScalar(ctx, token, tag, onError);
        if (anchor)
          node.anchor = anchor.source.substring(1);
        break;
      case "block-map":
      case "block-seq":
      case "flow-collection":
        try {
          node = composeCollection(CN, ctx, token, props, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          onError(token, "RESOURCE_EXHAUSTION", message);
        }
        break;
      default: {
        const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
        onError(token, "UNEXPECTED_TOKEN", message);
        isSrcToken = false;
      }
    }
    node != null ? node : node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError);
    if (anchor && node.anchor === "")
      onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
    if (atKey && ctx.options.stringKeys && (!isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
      const msg = "With stringKeys, all keys must be strings";
      onError(tag != null ? tag : token, "NON_STRING_KEY", msg);
    }
    if (spaceBefore)
      node.spaceBefore = true;
    if (comment) {
      if (token.type === "scalar" && token.source === "")
        node.comment = comment;
      else
        node.commentBefore = comment;
    }
    if (ctx.options.keepSourceTokens && isSrcToken)
      node.srcToken = token;
    return node;
  }
  function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
    const token = {
      type: "scalar",
      offset: emptyScalarPosition(offset, before, pos),
      indent: -1,
      source: ""
    };
    const node = composeScalar(ctx, token, tag, onError);
    if (anchor) {
      node.anchor = anchor.source.substring(1);
      if (node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
    }
    if (spaceBefore)
      node.spaceBefore = true;
    if (comment) {
      node.comment = comment;
      node.range[2] = end;
    }
    return node;
  }
  function composeAlias({ options }, { offset, source, end }, onError) {
    const alias = new Alias(source.substring(1));
    if (alias.source === "")
      onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
    if (alias.source.endsWith(":"))
      onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
    const valueEnd = offset + source.length;
    const re = resolveEnd(end, valueEnd, options.strict, onError);
    alias.range = [offset, valueEnd, re.offset];
    if (re.comment)
      alias.comment = re.comment;
    return alias;
  }

  // node_modules/yaml/browser/dist/compose/compose-doc.js
  function composeDoc(options, directives, { offset, start, value, end }, onError) {
    const opts = Object.assign({ _directives: directives }, options);
    const doc = new Document(void 0, opts);
    const ctx = {
      atKey: false,
      atRoot: true,
      directives: doc.directives,
      options: doc.options,
      schema: doc.schema
    };
    const props = resolveProps(start, {
      indicator: "doc-start",
      next: value != null ? value : end == null ? void 0 : end[0],
      offset,
      onError,
      parentIndent: 0,
      startOnNewline: true
    });
    if (props.found) {
      doc.directives.docStart = true;
      if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
        onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
    }
    doc.contents = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
    const contentEnd = doc.contents.range[2];
    const re = resolveEnd(end, contentEnd, false, onError);
    if (re.comment)
      doc.comment = re.comment;
    doc.range = [offset, contentEnd, re.offset];
    return doc;
  }

  // node_modules/yaml/browser/dist/compose/composer.js
  function getErrorPos(src) {
    if (typeof src === "number")
      return [src, src + 1];
    if (Array.isArray(src))
      return src.length === 2 ? src : [src[0], src[1]];
    const { offset, source } = src;
    return [offset, offset + (typeof source === "string" ? source.length : 1)];
  }
  function parsePrelude(prelude) {
    var _a;
    let comment = "";
    let atComment = false;
    let afterEmptyLine = false;
    for (let i = 0; i < prelude.length; ++i) {
      const source = prelude[i];
      switch (source[0]) {
        case "#":
          comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
          atComment = true;
          afterEmptyLine = false;
          break;
        case "%":
          if (((_a = prelude[i + 1]) == null ? void 0 : _a[0]) !== "#")
            i += 1;
          atComment = false;
          break;
        default:
          if (!atComment)
            afterEmptyLine = true;
          atComment = false;
      }
    }
    return { comment, afterEmptyLine };
  }
  var Composer = class {
    constructor(options = {}) {
      this.doc = null;
      this.atDirectives = false;
      this.prelude = [];
      this.errors = [];
      this.warnings = [];
      this.onError = (source, code, message, warning) => {
        const pos = getErrorPos(source);
        if (warning)
          this.warnings.push(new YAMLWarning(pos, code, message));
        else
          this.errors.push(new YAMLParseError(pos, code, message));
      };
      this.directives = new Directives({ version: options.version || "1.2" });
      this.options = options;
    }
    decorate(doc, afterDoc) {
      const { comment, afterEmptyLine } = parsePrelude(this.prelude);
      if (comment) {
        const dc = doc.contents;
        if (afterDoc) {
          doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
        } else if (afterEmptyLine || doc.directives.docStart || !dc) {
          doc.commentBefore = comment;
        } else if (isCollection(dc) && !dc.flow && dc.items.length > 0) {
          let it = dc.items[0];
          if (isPair(it))
            it = it.key;
          const cb = it.commentBefore;
          it.commentBefore = cb ? `${comment}
${cb}` : comment;
        } else {
          const cb = dc.commentBefore;
          dc.commentBefore = cb ? `${comment}
${cb}` : comment;
        }
      }
      if (afterDoc) {
        Array.prototype.push.apply(doc.errors, this.errors);
        Array.prototype.push.apply(doc.warnings, this.warnings);
      } else {
        doc.errors = this.errors;
        doc.warnings = this.warnings;
      }
      this.prelude = [];
      this.errors = [];
      this.warnings = [];
    }
    /**
     * Current stream status information.
     *
     * Mostly useful at the end of input for an empty stream.
     */
    streamInfo() {
      return {
        comment: parsePrelude(this.prelude).comment,
        directives: this.directives,
        errors: this.errors,
        warnings: this.warnings
      };
    }
    /**
     * Compose tokens into documents.
     *
     * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
     * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
     */
    *compose(tokens, forceDoc = false, endOffset = -1) {
      for (const token of tokens)
        yield* __yieldStar(this.next(token));
      yield* __yieldStar(this.end(forceDoc, endOffset));
    }
    /** Advance the composer by one CST token. */
    *next(token) {
      switch (token.type) {
        case "directive":
          this.directives.add(token.source, (offset, message, warning) => {
            const pos = getErrorPos(token);
            pos[0] += offset;
            this.onError(pos, "BAD_DIRECTIVE", message, warning);
          });
          this.prelude.push(token.source);
          this.atDirectives = true;
          break;
        case "document": {
          const doc = composeDoc(this.options, this.directives, token, this.onError);
          if (this.atDirectives && !doc.directives.docStart)
            this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
          this.decorate(doc, false);
          if (this.doc)
            yield this.doc;
          this.doc = doc;
          this.atDirectives = false;
          break;
        }
        case "byte-order-mark":
        case "space":
          break;
        case "comment":
        case "newline":
          this.prelude.push(token.source);
          break;
        case "error": {
          const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
          const error = new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
          if (this.atDirectives || !this.doc)
            this.errors.push(error);
          else
            this.doc.errors.push(error);
          break;
        }
        case "doc-end": {
          if (!this.doc) {
            const msg = "Unexpected doc-end without preceding document";
            this.errors.push(new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
            break;
          }
          this.doc.directives.docEnd = true;
          const end = resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
          this.decorate(this.doc, true);
          if (end.comment) {
            const dc = this.doc.comment;
            this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
          }
          this.doc.range[2] = end.offset;
          break;
        }
        default:
          this.errors.push(new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
      }
    }
    /**
     * Call at end of input to yield any remaining document.
     *
     * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
     * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
     */
    *end(forceDoc = false, endOffset = -1) {
      if (this.doc) {
        this.decorate(this.doc, true);
        yield this.doc;
        this.doc = null;
      } else if (forceDoc) {
        const opts = Object.assign({ _directives: this.directives }, this.options);
        const doc = new Document(void 0, opts);
        if (this.atDirectives)
          this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
        doc.range = [0, endOffset, endOffset];
        this.decorate(doc, false);
        yield doc;
      }
    }
  };

  // node_modules/yaml/browser/dist/parse/cst-visit.js
  var BREAK2 = /* @__PURE__ */ Symbol("break visit");
  var SKIP2 = /* @__PURE__ */ Symbol("skip children");
  var REMOVE2 = /* @__PURE__ */ Symbol("remove item");
  function visit2(cst, visitor) {
    if ("type" in cst && cst.type === "document")
      cst = { start: cst.start, value: cst.value };
    _visit(Object.freeze([]), cst, visitor);
  }
  visit2.BREAK = BREAK2;
  visit2.SKIP = SKIP2;
  visit2.REMOVE = REMOVE2;
  visit2.itemAtPath = (cst, path) => {
    let item = cst;
    for (const [field, index] of path) {
      const tok = item == null ? void 0 : item[field];
      if (tok && "items" in tok) {
        item = tok.items[index];
      } else
        return void 0;
    }
    return item;
  };
  visit2.parentCollection = (cst, path) => {
    const parent = visit2.itemAtPath(cst, path.slice(0, -1));
    const field = path[path.length - 1][0];
    const coll = parent == null ? void 0 : parent[field];
    if (coll && "items" in coll)
      return coll;
    throw new Error("Parent collection not found");
  };
  function _visit(path, item, visitor) {
    let ctrl = visitor(item, path);
    if (typeof ctrl === "symbol")
      return ctrl;
    for (const field of ["key", "value"]) {
      const token = item[field];
      if (token && "items" in token) {
        for (let i = 0; i < token.items.length; ++i) {
          const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
          if (typeof ci === "number")
            i = ci - 1;
          else if (ci === BREAK2)
            return BREAK2;
          else if (ci === REMOVE2) {
            token.items.splice(i, 1);
            i -= 1;
          }
        }
        if (typeof ctrl === "function" && field === "key")
          ctrl = ctrl(item, path);
      }
    }
    return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
  }

  // node_modules/yaml/browser/dist/parse/cst.js
  var BOM = "\uFEFF";
  var DOCUMENT = "";
  var FLOW_END = "";
  var SCALAR2 = "";
  function tokenType(source) {
    switch (source) {
      case BOM:
        return "byte-order-mark";
      case DOCUMENT:
        return "doc-mode";
      case FLOW_END:
        return "flow-error-end";
      case SCALAR2:
        return "scalar";
      case "---":
        return "doc-start";
      case "...":
        return "doc-end";
      case "":
      case "\n":
      case "\r\n":
        return "newline";
      case "-":
        return "seq-item-ind";
      case "?":
        return "explicit-key-ind";
      case ":":
        return "map-value-ind";
      case "{":
        return "flow-map-start";
      case "}":
        return "flow-map-end";
      case "[":
        return "flow-seq-start";
      case "]":
        return "flow-seq-end";
      case ",":
        return "comma";
    }
    switch (source[0]) {
      case " ":
      case "	":
        return "space";
      case "#":
        return "comment";
      case "%":
        return "directive-line";
      case "*":
        return "alias";
      case "&":
        return "anchor";
      case "!":
        return "tag";
      case "'":
        return "single-quoted-scalar";
      case '"':
        return "double-quoted-scalar";
      case "|":
      case ">":
        return "block-scalar-header";
    }
    return null;
  }

  // node_modules/yaml/browser/dist/parse/lexer.js
  function isEmpty(ch) {
    switch (ch) {
      case void 0:
      case " ":
      case "\n":
      case "\r":
      case "	":
        return true;
      default:
        return false;
    }
  }
  var hexDigits = new Set("0123456789ABCDEFabcdef");
  var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
  var flowIndicatorChars = new Set(",[]{}");
  var invalidAnchorChars = new Set(" ,[]{}\n\r	");
  var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
  var Lexer = class {
    constructor() {
      this.atEnd = false;
      this.blockScalarIndent = -1;
      this.blockScalarKeep = false;
      this.buffer = "";
      this.flowKey = false;
      this.flowLevel = 0;
      this.indentNext = 0;
      this.indentValue = 0;
      this.lineEndPos = null;
      this.next = null;
      this.pos = 0;
    }
    /**
     * Generate YAML tokens from the `source` string. If `incomplete`,
     * a part of the last line may be left as a buffer for the next call.
     *
     * @returns A generator of lexical tokens
     */
    *lex(source, incomplete = false) {
      var _a;
      if (source) {
        if (typeof source !== "string")
          throw TypeError("source is not a string");
        this.buffer = this.buffer ? this.buffer + source : source;
        this.lineEndPos = null;
      }
      this.atEnd = !incomplete;
      let next = (_a = this.next) != null ? _a : "stream";
      while (next && (incomplete || this.hasChars(1)))
        next = yield* __yieldStar(this.parseNext(next));
    }
    atLineEnd() {
      let i = this.pos;
      let ch = this.buffer[i];
      while (ch === " " || ch === "	")
        ch = this.buffer[++i];
      if (!ch || ch === "#" || ch === "\n")
        return true;
      if (ch === "\r")
        return this.buffer[i + 1] === "\n";
      return false;
    }
    charAt(n) {
      return this.buffer[this.pos + n];
    }
    continueScalar(offset) {
      let ch = this.buffer[offset];
      if (this.indentNext > 0) {
        let indent = 0;
        while (ch === " ")
          ch = this.buffer[++indent + offset];
        if (ch === "\r") {
          const next = this.buffer[indent + offset + 1];
          if (next === "\n" || !next && !this.atEnd)
            return offset + indent + 1;
        }
        return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
      }
      if (ch === "-" || ch === ".") {
        const dt = this.buffer.substr(offset, 3);
        if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
          return -1;
      }
      return offset;
    }
    getLine() {
      let end = this.lineEndPos;
      if (typeof end !== "number" || end !== -1 && end < this.pos) {
        end = this.buffer.indexOf("\n", this.pos);
        this.lineEndPos = end;
      }
      if (end === -1)
        return this.atEnd ? this.buffer.substring(this.pos) : null;
      if (this.buffer[end - 1] === "\r")
        end -= 1;
      return this.buffer.substring(this.pos, end);
    }
    hasChars(n) {
      return this.pos + n <= this.buffer.length;
    }
    setNext(state) {
      this.buffer = this.buffer.substring(this.pos);
      this.pos = 0;
      this.lineEndPos = null;
      this.next = state;
      return null;
    }
    peek(n) {
      return this.buffer.substr(this.pos, n);
    }
    *parseNext(next) {
      switch (next) {
        case "stream":
          return yield* __yieldStar(this.parseStream());
        case "line-start":
          return yield* __yieldStar(this.parseLineStart());
        case "block-start":
          return yield* __yieldStar(this.parseBlockStart());
        case "doc":
          return yield* __yieldStar(this.parseDocument());
        case "flow":
          return yield* __yieldStar(this.parseFlowCollection());
        case "quoted-scalar":
          return yield* __yieldStar(this.parseQuotedScalar());
        case "block-scalar":
          return yield* __yieldStar(this.parseBlockScalar());
        case "plain-scalar":
          return yield* __yieldStar(this.parsePlainScalar());
      }
    }
    *parseStream() {
      let line = this.getLine();
      if (line === null)
        return this.setNext("stream");
      if (line[0] === BOM) {
        yield* __yieldStar(this.pushCount(1));
        line = line.substring(1);
      }
      if (line[0] === "%") {
        let dirEnd = line.length;
        let cs = line.indexOf("#");
        while (cs !== -1) {
          const ch = line[cs - 1];
          if (ch === " " || ch === "	") {
            dirEnd = cs - 1;
            break;
          } else {
            cs = line.indexOf("#", cs + 1);
          }
        }
        while (true) {
          const ch = line[dirEnd - 1];
          if (ch === " " || ch === "	")
            dirEnd -= 1;
          else
            break;
        }
        const n = (yield* __yieldStar(this.pushCount(dirEnd))) + (yield* __yieldStar(this.pushSpaces(true)));
        yield* __yieldStar(this.pushCount(line.length - n));
        this.pushNewline();
        return "stream";
      }
      if (this.atLineEnd()) {
        const sp = yield* __yieldStar(this.pushSpaces(true));
        yield* __yieldStar(this.pushCount(line.length - sp));
        yield* __yieldStar(this.pushNewline());
        return "stream";
      }
      yield DOCUMENT;
      return yield* __yieldStar(this.parseLineStart());
    }
    *parseLineStart() {
      const ch = this.charAt(0);
      if (!ch && !this.atEnd)
        return this.setNext("line-start");
      if (ch === "-" || ch === ".") {
        if (!this.atEnd && !this.hasChars(4))
          return this.setNext("line-start");
        const s = this.peek(3);
        if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
          yield* __yieldStar(this.pushCount(3));
          this.indentValue = 0;
          this.indentNext = 0;
          return s === "---" ? "doc" : "stream";
        }
      }
      this.indentValue = yield* __yieldStar(this.pushSpaces(false));
      if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
        this.indentNext = this.indentValue;
      return yield* __yieldStar(this.parseBlockStart());
    }
    *parseBlockStart() {
      const [ch0, ch1] = this.peek(2);
      if (!ch1 && !this.atEnd)
        return this.setNext("block-start");
      if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
        const n = (yield* __yieldStar(this.pushCount(1))) + (yield* __yieldStar(this.pushSpaces(true)));
        this.indentNext = this.indentValue + 1;
        this.indentValue += n;
        return yield* __yieldStar(this.parseBlockStart());
      }
      return "doc";
    }
    *parseDocument() {
      yield* __yieldStar(this.pushSpaces(true));
      const line = this.getLine();
      if (line === null)
        return this.setNext("doc");
      let n = yield* __yieldStar(this.pushIndicators());
      switch (line[n]) {
        case "#":
          yield* __yieldStar(this.pushCount(line.length - n));
        // fallthrough
        case void 0:
          yield* __yieldStar(this.pushNewline());
          return yield* __yieldStar(this.parseLineStart());
        case "{":
        case "[":
          yield* __yieldStar(this.pushCount(1));
          this.flowKey = false;
          this.flowLevel = 1;
          return "flow";
        case "}":
        case "]":
          yield* __yieldStar(this.pushCount(1));
          return "doc";
        case "*":
          yield* __yieldStar(this.pushUntil(isNotAnchorChar));
          return "doc";
        case '"':
        case "'":
          return yield* __yieldStar(this.parseQuotedScalar());
        case "|":
        case ">":
          n += yield* __yieldStar(this.parseBlockScalarHeader());
          n += yield* __yieldStar(this.pushSpaces(true));
          yield* __yieldStar(this.pushCount(line.length - n));
          yield* __yieldStar(this.pushNewline());
          return yield* __yieldStar(this.parseBlockScalar());
        default:
          return yield* __yieldStar(this.parsePlainScalar());
      }
    }
    *parseFlowCollection() {
      let nl, sp;
      let indent = -1;
      do {
        nl = yield* __yieldStar(this.pushNewline());
        if (nl > 0) {
          sp = yield* __yieldStar(this.pushSpaces(false));
          this.indentValue = indent = sp;
        } else {
          sp = 0;
        }
        sp += yield* __yieldStar(this.pushSpaces(true));
      } while (nl + sp > 0);
      const line = this.getLine();
      if (line === null)
        return this.setNext("flow");
      if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
        const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
        if (!atFlowEndMarker) {
          this.flowLevel = 0;
          yield FLOW_END;
          return yield* __yieldStar(this.parseLineStart());
        }
      }
      let n = 0;
      while (line[n] === ",") {
        n += yield* __yieldStar(this.pushCount(1));
        n += yield* __yieldStar(this.pushSpaces(true));
        this.flowKey = false;
      }
      n += yield* __yieldStar(this.pushIndicators());
      switch (line[n]) {
        case void 0:
          return "flow";
        case "#":
          yield* __yieldStar(this.pushCount(line.length - n));
          return "flow";
        case "{":
        case "[":
          yield* __yieldStar(this.pushCount(1));
          this.flowKey = false;
          this.flowLevel += 1;
          return "flow";
        case "}":
        case "]":
          yield* __yieldStar(this.pushCount(1));
          this.flowKey = true;
          this.flowLevel -= 1;
          return this.flowLevel ? "flow" : "doc";
        case "*":
          yield* __yieldStar(this.pushUntil(isNotAnchorChar));
          return "flow";
        case '"':
        case "'":
          this.flowKey = true;
          return yield* __yieldStar(this.parseQuotedScalar());
        case ":": {
          const next = this.charAt(1);
          if (this.flowKey || isEmpty(next) || next === ",") {
            this.flowKey = false;
            yield* __yieldStar(this.pushCount(1));
            yield* __yieldStar(this.pushSpaces(true));
            return "flow";
          }
        }
        // fallthrough
        default:
          this.flowKey = false;
          return yield* __yieldStar(this.parsePlainScalar());
      }
    }
    *parseQuotedScalar() {
      const quote = this.charAt(0);
      let end = this.buffer.indexOf(quote, this.pos + 1);
      if (quote === "'") {
        while (end !== -1 && this.buffer[end + 1] === "'")
          end = this.buffer.indexOf("'", end + 2);
      } else {
        while (end !== -1) {
          let n = 0;
          while (this.buffer[end - 1 - n] === "\\")
            n += 1;
          if (n % 2 === 0)
            break;
          end = this.buffer.indexOf('"', end + 1);
        }
      }
      const qb = this.buffer.substring(0, end);
      let nl = qb.indexOf("\n", this.pos);
      if (nl !== -1) {
        while (nl !== -1) {
          const cs = this.continueScalar(nl + 1);
          if (cs === -1)
            break;
          nl = qb.indexOf("\n", cs);
        }
        if (nl !== -1) {
          end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
        }
      }
      if (end === -1) {
        if (!this.atEnd)
          return this.setNext("quoted-scalar");
        end = this.buffer.length;
      }
      yield* __yieldStar(this.pushToIndex(end + 1, false));
      return this.flowLevel ? "flow" : "doc";
    }
    *parseBlockScalarHeader() {
      this.blockScalarIndent = -1;
      this.blockScalarKeep = false;
      let i = this.pos;
      while (true) {
        const ch = this.buffer[++i];
        if (ch === "+")
          this.blockScalarKeep = true;
        else if (ch > "0" && ch <= "9")
          this.blockScalarIndent = Number(ch) - 1;
        else if (ch !== "-")
          break;
      }
      return yield* __yieldStar(this.pushUntil((ch) => isEmpty(ch) || ch === "#"));
    }
    *parseBlockScalar() {
      let nl = this.pos - 1;
      let indent = 0;
      let ch;
      loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
        switch (ch) {
          case " ":
            indent += 1;
            break;
          case "\n":
            nl = i2;
            indent = 0;
            break;
          case "\r": {
            const next = this.buffer[i2 + 1];
            if (!next && !this.atEnd)
              return this.setNext("block-scalar");
            if (next === "\n")
              break;
          }
          // fallthrough
          default:
            break loop;
        }
      }
      if (!ch && !this.atEnd)
        return this.setNext("block-scalar");
      if (indent >= this.indentNext) {
        if (this.blockScalarIndent === -1)
          this.indentNext = indent;
        else {
          this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
        }
        do {
          const cs = this.continueScalar(nl + 1);
          if (cs === -1)
            break;
          nl = this.buffer.indexOf("\n", cs);
        } while (nl !== -1);
        if (nl === -1) {
          if (!this.atEnd)
            return this.setNext("block-scalar");
          nl = this.buffer.length;
        }
      }
      let i = nl + 1;
      ch = this.buffer[i];
      while (ch === " ")
        ch = this.buffer[++i];
      if (ch === "	") {
        while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
          ch = this.buffer[++i];
        nl = i - 1;
      } else if (!this.blockScalarKeep) {
        do {
          let i2 = nl - 1;
          let ch2 = this.buffer[i2];
          if (ch2 === "\r")
            ch2 = this.buffer[--i2];
          const lastChar = i2;
          while (ch2 === " ")
            ch2 = this.buffer[--i2];
          if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
            nl = i2;
          else
            break;
        } while (true);
      }
      yield SCALAR2;
      yield* __yieldStar(this.pushToIndex(nl + 1, true));
      return yield* __yieldStar(this.parseLineStart());
    }
    *parsePlainScalar() {
      const inFlow = this.flowLevel > 0;
      let end = this.pos - 1;
      let i = this.pos - 1;
      let ch;
      while (ch = this.buffer[++i]) {
        if (ch === ":") {
          const next = this.buffer[i + 1];
          if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
            break;
          end = i;
        } else if (isEmpty(ch)) {
          let next = this.buffer[i + 1];
          if (ch === "\r") {
            if (next === "\n") {
              i += 1;
              ch = "\n";
              next = this.buffer[i + 1];
            } else
              end = i;
          }
          if (next === "#" || inFlow && flowIndicatorChars.has(next))
            break;
          if (ch === "\n") {
            const cs = this.continueScalar(i + 1);
            if (cs === -1)
              break;
            i = Math.max(i, cs - 2);
          }
        } else {
          if (inFlow && flowIndicatorChars.has(ch))
            break;
          end = i;
        }
      }
      if (!ch && !this.atEnd)
        return this.setNext("plain-scalar");
      yield SCALAR2;
      yield* __yieldStar(this.pushToIndex(end + 1, true));
      return inFlow ? "flow" : "doc";
    }
    *pushCount(n) {
      if (n > 0) {
        yield this.buffer.substr(this.pos, n);
        this.pos += n;
        return n;
      }
      return 0;
    }
    *pushToIndex(i, allowEmpty) {
      const s = this.buffer.slice(this.pos, i);
      if (s) {
        yield s;
        this.pos += s.length;
        return s.length;
      } else if (allowEmpty)
        yield "";
      return 0;
    }
    *pushIndicators() {
      switch (this.charAt(0)) {
        case "!":
          return (yield* __yieldStar(this.pushTag())) + (yield* __yieldStar(this.pushSpaces(true))) + (yield* __yieldStar(this.pushIndicators()));
        case "&":
          return (yield* __yieldStar(this.pushUntil(isNotAnchorChar))) + (yield* __yieldStar(this.pushSpaces(true))) + (yield* __yieldStar(this.pushIndicators()));
        case "-":
        // this is an error
        case "?":
        // this is an error outside flow collections
        case ":": {
          const inFlow = this.flowLevel > 0;
          const ch1 = this.charAt(1);
          if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
            if (!inFlow)
              this.indentNext = this.indentValue + 1;
            else if (this.flowKey)
              this.flowKey = false;
            return (yield* __yieldStar(this.pushCount(1))) + (yield* __yieldStar(this.pushSpaces(true))) + (yield* __yieldStar(this.pushIndicators()));
          }
        }
      }
      return 0;
    }
    *pushTag() {
      if (this.charAt(1) === "<") {
        let i = this.pos + 2;
        let ch = this.buffer[i];
        while (!isEmpty(ch) && ch !== ">")
          ch = this.buffer[++i];
        return yield* __yieldStar(this.pushToIndex(ch === ">" ? i + 1 : i, false));
      } else {
        let i = this.pos + 1;
        let ch = this.buffer[i];
        while (ch) {
          if (tagChars.has(ch))
            ch = this.buffer[++i];
          else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
            ch = this.buffer[i += 3];
          } else
            break;
        }
        return yield* __yieldStar(this.pushToIndex(i, false));
      }
    }
    *pushNewline() {
      const ch = this.buffer[this.pos];
      if (ch === "\n")
        return yield* __yieldStar(this.pushCount(1));
      else if (ch === "\r" && this.charAt(1) === "\n")
        return yield* __yieldStar(this.pushCount(2));
      else
        return 0;
    }
    *pushSpaces(allowTabs) {
      let i = this.pos - 1;
      let ch;
      do {
        ch = this.buffer[++i];
      } while (ch === " " || allowTabs && ch === "	");
      const n = i - this.pos;
      if (n > 0) {
        yield this.buffer.substr(this.pos, n);
        this.pos = i;
      }
      return n;
    }
    *pushUntil(test) {
      let i = this.pos;
      let ch = this.buffer[i];
      while (!test(ch))
        ch = this.buffer[++i];
      return yield* __yieldStar(this.pushToIndex(i, false));
    }
  };

  // node_modules/yaml/browser/dist/parse/line-counter.js
  var LineCounter = class {
    constructor() {
      this.lineStarts = [];
      this.addNewLine = (offset) => this.lineStarts.push(offset);
      this.linePos = (offset) => {
        let low = 0;
        let high = this.lineStarts.length;
        while (low < high) {
          const mid = low + high >> 1;
          if (this.lineStarts[mid] < offset)
            low = mid + 1;
          else
            high = mid;
        }
        if (this.lineStarts[low] === offset)
          return { line: low + 1, col: 1 };
        if (low === 0)
          return { line: 0, col: offset };
        const start = this.lineStarts[low - 1];
        return { line: low, col: offset - start + 1 };
      };
    }
  };

  // node_modules/yaml/browser/dist/parse/parser.js
  function includesToken(list, type) {
    for (let i = 0; i < list.length; ++i)
      if (list[i].type === type)
        return true;
    return false;
  }
  function findNonEmptyIndex(list) {
    for (let i = 0; i < list.length; ++i) {
      switch (list[i].type) {
        case "space":
        case "comment":
        case "newline":
          break;
        default:
          return i;
      }
    }
    return -1;
  }
  function isFlowToken(token) {
    switch (token == null ? void 0 : token.type) {
      case "alias":
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
      case "flow-collection":
        return true;
      default:
        return false;
    }
  }
  function getPrevProps(parent) {
    var _a;
    switch (parent.type) {
      case "document":
        return parent.start;
      case "block-map": {
        const it = parent.items[parent.items.length - 1];
        return (_a = it.sep) != null ? _a : it.start;
      }
      case "block-seq":
        return parent.items[parent.items.length - 1].start;
      /* istanbul ignore next should not happen */
      default:
        return [];
    }
  }
  function getFirstKeyStartProps(prev) {
    var _a;
    if (prev.length === 0)
      return [];
    let i = prev.length;
    loop: while (--i >= 0) {
      switch (prev[i].type) {
        case "doc-start":
        case "explicit-key-ind":
        case "map-value-ind":
        case "seq-item-ind":
        case "newline":
          break loop;
      }
    }
    while (((_a = prev[++i]) == null ? void 0 : _a.type) === "space") {
    }
    return prev.splice(i, prev.length);
  }
  function fixFlowSeqItems(fc) {
    if (fc.start.type === "flow-seq-start") {
      for (const it of fc.items) {
        if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
          if (it.key)
            it.value = it.key;
          delete it.key;
          if (isFlowToken(it.value)) {
            if (it.value.end)
              Array.prototype.push.apply(it.value.end, it.sep);
            else
              it.value.end = it.sep;
          } else
            Array.prototype.push.apply(it.start, it.sep);
          delete it.sep;
        }
      }
    }
  }
  var Parser = class {
    /**
     * @param onNewLine - If defined, called separately with the start position of
     *   each new line (in `parse()`, including the start of input).
     */
    constructor(onNewLine) {
      this.atNewLine = true;
      this.atScalar = false;
      this.indent = 0;
      this.offset = 0;
      this.onKeyLine = false;
      this.stack = [];
      this.source = "";
      this.type = "";
      this.lexer = new Lexer();
      this.onNewLine = onNewLine;
    }
    /**
     * Parse `source` as a YAML stream.
     * If `incomplete`, a part of the last line may be left as a buffer for the next call.
     *
     * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
     *
     * @returns A generator of tokens representing each directive, document, and other structure.
     */
    *parse(source, incomplete = false) {
      if (this.onNewLine && this.offset === 0)
        this.onNewLine(0);
      for (const lexeme of this.lexer.lex(source, incomplete))
        yield* __yieldStar(this.next(lexeme));
      if (!incomplete)
        yield* __yieldStar(this.end());
    }
    /**
     * Advance the parser by the `source` of one lexical token.
     */
    *next(source) {
      this.source = source;
      if (this.atScalar) {
        this.atScalar = false;
        yield* __yieldStar(this.step());
        this.offset += source.length;
        return;
      }
      const type = tokenType(source);
      if (!type) {
        const message = `Not a YAML token: ${source}`;
        yield* __yieldStar(this.pop({ type: "error", offset: this.offset, message, source }));
        this.offset += source.length;
      } else if (type === "scalar") {
        this.atNewLine = false;
        this.atScalar = true;
        this.type = "scalar";
      } else {
        this.type = type;
        yield* __yieldStar(this.step());
        switch (type) {
          case "newline":
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine)
              this.onNewLine(this.offset + source.length);
            break;
          case "space":
            if (this.atNewLine && source[0] === " ")
              this.indent += source.length;
            break;
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
            if (this.atNewLine)
              this.indent += source.length;
            break;
          case "doc-mode":
          case "flow-error-end":
            return;
          default:
            this.atNewLine = false;
        }
        this.offset += source.length;
      }
    }
    /** Call at end of input to push out any remaining constructions */
    *end() {
      while (this.stack.length > 0)
        yield* __yieldStar(this.pop());
    }
    get sourceToken() {
      const st = {
        type: this.type,
        offset: this.offset,
        indent: this.indent,
        source: this.source
      };
      return st;
    }
    *step() {
      const top = this.peek(1);
      if (this.type === "doc-end" && (top == null ? void 0 : top.type) !== "doc-end") {
        while (this.stack.length > 0)
          yield* __yieldStar(this.pop());
        this.stack.push({
          type: "doc-end",
          offset: this.offset,
          source: this.source
        });
        return;
      }
      if (!top)
        return yield* __yieldStar(this.stream());
      switch (top.type) {
        case "document":
          return yield* __yieldStar(this.document(top));
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
          return yield* __yieldStar(this.scalar(top));
        case "block-scalar":
          return yield* __yieldStar(this.blockScalar(top));
        case "block-map":
          return yield* __yieldStar(this.blockMap(top));
        case "block-seq":
          return yield* __yieldStar(this.blockSequence(top));
        case "flow-collection":
          return yield* __yieldStar(this.flowCollection(top));
        case "doc-end":
          return yield* __yieldStar(this.documentEnd(top));
      }
      yield* __yieldStar(this.pop());
    }
    peek(n) {
      return this.stack[this.stack.length - n];
    }
    *pop(error) {
      const token = error != null ? error : this.stack.pop();
      if (!token) {
        const message = "Tried to pop an empty stack";
        yield { type: "error", offset: this.offset, source: "", message };
      } else if (this.stack.length === 0) {
        yield token;
      } else {
        const top = this.peek(1);
        if (token.type === "block-scalar") {
          token.indent = "indent" in top ? top.indent : 0;
        } else if (token.type === "flow-collection" && top.type === "document") {
          token.indent = 0;
        }
        if (token.type === "flow-collection")
          fixFlowSeqItems(token);
        switch (top.type) {
          case "document":
            top.value = token;
            break;
          case "block-scalar":
            top.props.push(token);
            break;
          case "block-map": {
            const it = top.items[top.items.length - 1];
            if (it.value) {
              top.items.push({ start: [], key: token, sep: [] });
              this.onKeyLine = true;
              return;
            } else if (it.sep) {
              it.value = token;
            } else {
              Object.assign(it, { key: token, sep: [] });
              this.onKeyLine = !it.explicitKey;
              return;
            }
            break;
          }
          case "block-seq": {
            const it = top.items[top.items.length - 1];
            if (it.value)
              top.items.push({ start: [], value: token });
            else
              it.value = token;
            break;
          }
          case "flow-collection": {
            const it = top.items[top.items.length - 1];
            if (!it || it.value)
              top.items.push({ start: [], key: token, sep: [] });
            else if (it.sep)
              it.value = token;
            else
              Object.assign(it, { key: token, sep: [] });
            return;
          }
          /* istanbul ignore next should not happen */
          default:
            yield* __yieldStar(this.pop());
            yield* __yieldStar(this.pop(token));
        }
        if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
          const last = token.items[token.items.length - 1];
          if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
            if (top.type === "document")
              top.end = last.start;
            else
              top.items.push({ start: last.start });
            token.items.splice(-1, 1);
          }
        }
      }
    }
    *stream() {
      switch (this.type) {
        case "directive-line":
          yield { type: "directive", offset: this.offset, source: this.source };
          return;
        case "byte-order-mark":
        case "space":
        case "comment":
        case "newline":
          yield this.sourceToken;
          return;
        case "doc-mode":
        case "doc-start": {
          const doc = {
            type: "document",
            offset: this.offset,
            start: []
          };
          if (this.type === "doc-start")
            doc.start.push(this.sourceToken);
          this.stack.push(doc);
          return;
        }
      }
      yield {
        type: "error",
        offset: this.offset,
        message: `Unexpected ${this.type} token in YAML stream`,
        source: this.source
      };
    }
    *document(doc) {
      if (doc.value)
        return yield* __yieldStar(this.lineEnd(doc));
      switch (this.type) {
        case "doc-start": {
          if (findNonEmptyIndex(doc.start) !== -1) {
            yield* __yieldStar(this.pop());
            yield* __yieldStar(this.step());
          } else
            doc.start.push(this.sourceToken);
          return;
        }
        case "anchor":
        case "tag":
        case "space":
        case "comment":
        case "newline":
          doc.start.push(this.sourceToken);
          return;
      }
      const bv = this.startBlockValue(doc);
      if (bv)
        this.stack.push(bv);
      else {
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML document`,
          source: this.source
        };
      }
    }
    *scalar(scalar) {
      if (this.type === "map-value-ind") {
        const prev = getPrevProps(this.peek(2));
        const start = getFirstKeyStartProps(prev);
        let sep;
        if (scalar.end) {
          sep = scalar.end;
          sep.push(this.sourceToken);
          delete scalar.end;
        } else
          sep = [this.sourceToken];
        const map2 = {
          type: "block-map",
          offset: scalar.offset,
          indent: scalar.indent,
          items: [{ start, key: scalar, sep }]
        };
        this.onKeyLine = true;
        this.stack[this.stack.length - 1] = map2;
      } else
        yield* __yieldStar(this.lineEnd(scalar));
    }
    *blockScalar(scalar) {
      switch (this.type) {
        case "space":
        case "comment":
        case "newline":
          scalar.props.push(this.sourceToken);
          return;
        case "scalar":
          scalar.source = this.source;
          this.atNewLine = true;
          this.indent = 0;
          if (this.onNewLine) {
            let nl = this.source.indexOf("\n") + 1;
            while (nl !== 0) {
              this.onNewLine(this.offset + nl);
              nl = this.source.indexOf("\n", nl) + 1;
            }
          }
          yield* __yieldStar(this.pop());
          break;
        /* istanbul ignore next should not happen */
        default:
          yield* __yieldStar(this.pop());
          yield* __yieldStar(this.step());
      }
    }
    *blockMap(map2) {
      var _a;
      const it = map2.items[map2.items.length - 1];
      switch (this.type) {
        case "newline":
          this.onKeyLine = false;
          if (it.value) {
            const end = "end" in it.value ? it.value.end : void 0;
            const last = Array.isArray(end) ? end[end.length - 1] : void 0;
            if ((last == null ? void 0 : last.type) === "comment")
              end == null ? void 0 : end.push(this.sourceToken);
            else
              map2.items.push({ start: [this.sourceToken] });
          } else if (it.sep) {
            it.sep.push(this.sourceToken);
          } else {
            it.start.push(this.sourceToken);
          }
          return;
        case "space":
        case "comment":
          if (it.value) {
            map2.items.push({ start: [this.sourceToken] });
          } else if (it.sep) {
            it.sep.push(this.sourceToken);
          } else {
            if (this.atIndentedComment(it.start, map2.indent)) {
              const prev = map2.items[map2.items.length - 2];
              const end = (_a = prev == null ? void 0 : prev.value) == null ? void 0 : _a.end;
              if (Array.isArray(end)) {
                Array.prototype.push.apply(end, it.start);
                end.push(this.sourceToken);
                map2.items.pop();
                return;
              }
            }
            it.start.push(this.sourceToken);
          }
          return;
      }
      if (this.indent >= map2.indent) {
        const atMapIndent = !this.onKeyLine && this.indent === map2.indent;
        const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
        let start = [];
        if (atNextItem && it.sep && !it.value) {
          const nl = [];
          for (let i = 0; i < it.sep.length; ++i) {
            const st = it.sep[i];
            switch (st.type) {
              case "newline":
                nl.push(i);
                break;
              case "space":
                break;
              case "comment":
                if (st.indent > map2.indent)
                  nl.length = 0;
                break;
              default:
                nl.length = 0;
            }
          }
          if (nl.length >= 2)
            start = it.sep.splice(nl[1]);
        }
        switch (this.type) {
          case "anchor":
          case "tag":
            if (atNextItem || it.value) {
              start.push(this.sourceToken);
              map2.items.push({ start });
              this.onKeyLine = true;
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "explicit-key-ind":
            if (!it.sep && !it.explicitKey) {
              it.start.push(this.sourceToken);
              it.explicitKey = true;
            } else if (atNextItem || it.value) {
              start.push(this.sourceToken);
              map2.items.push({ start, explicitKey: true });
            } else {
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start: [this.sourceToken], explicitKey: true }]
              });
            }
            this.onKeyLine = true;
            return;
          case "map-value-ind":
            if (it.explicitKey) {
              if (!it.sep) {
                if (includesToken(it.start, "newline")) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else {
                  const start2 = getFirstKeyStartProps(it.start);
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                  });
                }
              } else if (it.value) {
                map2.items.push({ start: [], key: null, sep: [this.sourceToken] });
              } else if (includesToken(it.sep, "map-value-ind")) {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start, key: null, sep: [this.sourceToken] }]
                });
              } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                const start2 = getFirstKeyStartProps(it.start);
                const key = it.key;
                const sep = it.sep;
                sep.push(this.sourceToken);
                delete it.key;
                delete it.sep;
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: start2, key, sep }]
                });
              } else if (start.length > 0) {
                it.sep = it.sep.concat(start, this.sourceToken);
              } else {
                it.sep.push(this.sourceToken);
              }
            } else {
              if (!it.sep) {
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              } else if (it.value || atNextItem) {
                map2.items.push({ start, key: null, sep: [this.sourceToken] });
              } else if (includesToken(it.sep, "map-value-ind")) {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [], key: null, sep: [this.sourceToken] }]
                });
              } else {
                it.sep.push(this.sourceToken);
              }
            }
            this.onKeyLine = true;
            return;
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar": {
            const fs = this.flowScalar(this.type);
            if (atNextItem || it.value) {
              map2.items.push({ start, key: fs, sep: [] });
              this.onKeyLine = true;
            } else if (it.sep) {
              this.stack.push(fs);
            } else {
              Object.assign(it, { key: fs, sep: [] });
              this.onKeyLine = true;
            }
            return;
          }
          default: {
            const bv = this.startBlockValue(map2);
            if (bv) {
              if (bv.type === "block-seq") {
                if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                  yield* __yieldStar(this.pop({
                    type: "error",
                    offset: this.offset,
                    message: "Unexpected block-seq-ind on same line with key",
                    source: this.source
                  }));
                  return;
                }
              } else if (atMapIndent) {
                map2.items.push({ start });
              }
              this.stack.push(bv);
              return;
            }
          }
        }
      }
      yield* __yieldStar(this.pop());
      yield* __yieldStar(this.step());
    }
    *blockSequence(seq2) {
      var _a;
      const it = seq2.items[seq2.items.length - 1];
      switch (this.type) {
        case "newline":
          if (it.value) {
            const end = "end" in it.value ? it.value.end : void 0;
            const last = Array.isArray(end) ? end[end.length - 1] : void 0;
            if ((last == null ? void 0 : last.type) === "comment")
              end == null ? void 0 : end.push(this.sourceToken);
            else
              seq2.items.push({ start: [this.sourceToken] });
          } else
            it.start.push(this.sourceToken);
          return;
        case "space":
        case "comment":
          if (it.value)
            seq2.items.push({ start: [this.sourceToken] });
          else {
            if (this.atIndentedComment(it.start, seq2.indent)) {
              const prev = seq2.items[seq2.items.length - 2];
              const end = (_a = prev == null ? void 0 : prev.value) == null ? void 0 : _a.end;
              if (Array.isArray(end)) {
                Array.prototype.push.apply(end, it.start);
                end.push(this.sourceToken);
                seq2.items.pop();
                return;
              }
            }
            it.start.push(this.sourceToken);
          }
          return;
        case "anchor":
        case "tag":
          if (it.value || this.indent <= seq2.indent)
            break;
          it.start.push(this.sourceToken);
          return;
        case "seq-item-ind":
          if (this.indent !== seq2.indent)
            break;
          if (it.value || includesToken(it.start, "seq-item-ind"))
            seq2.items.push({ start: [this.sourceToken] });
          else
            it.start.push(this.sourceToken);
          return;
      }
      if (this.indent > seq2.indent) {
        const bv = this.startBlockValue(seq2);
        if (bv) {
          this.stack.push(bv);
          return;
        }
      }
      yield* __yieldStar(this.pop());
      yield* __yieldStar(this.step());
    }
    *flowCollection(fc) {
      const it = fc.items[fc.items.length - 1];
      if (this.type === "flow-error-end") {
        let top;
        do {
          yield* __yieldStar(this.pop());
          top = this.peek(1);
        } while ((top == null ? void 0 : top.type) === "flow-collection");
      } else if (fc.end.length === 0) {
        switch (this.type) {
          case "comma":
          case "explicit-key-ind":
            if (!it || it.sep)
              fc.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
          case "map-value-ind":
            if (!it || it.value)
              fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
            else if (it.sep)
              it.sep.push(this.sourceToken);
            else
              Object.assign(it, { key: null, sep: [this.sourceToken] });
            return;
          case "space":
          case "comment":
          case "newline":
          case "anchor":
          case "tag":
            if (!it || it.value)
              fc.items.push({ start: [this.sourceToken] });
            else if (it.sep)
              it.sep.push(this.sourceToken);
            else
              it.start.push(this.sourceToken);
            return;
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar": {
            const fs = this.flowScalar(this.type);
            if (!it || it.value)
              fc.items.push({ start: [], key: fs, sep: [] });
            else if (it.sep)
              this.stack.push(fs);
            else
              Object.assign(it, { key: fs, sep: [] });
            return;
          }
          case "flow-map-end":
          case "flow-seq-end":
            fc.end.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(fc);
        if (bv)
          this.stack.push(bv);
        else {
          yield* __yieldStar(this.pop());
          yield* __yieldStar(this.step());
        }
      } else {
        const parent = this.peek(2);
        if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
          yield* __yieldStar(this.pop());
          yield* __yieldStar(this.step());
        } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          fixFlowSeqItems(fc);
          const sep = fc.end.splice(1, fc.end.length);
          sep.push(this.sourceToken);
          const map2 = {
            type: "block-map",
            offset: fc.offset,
            indent: fc.indent,
            items: [{ start, key: fc, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map2;
        } else {
          yield* __yieldStar(this.lineEnd(fc));
        }
      }
    }
    flowScalar(type) {
      if (this.onNewLine) {
        let nl = this.source.indexOf("\n") + 1;
        while (nl !== 0) {
          this.onNewLine(this.offset + nl);
          nl = this.source.indexOf("\n", nl) + 1;
        }
      }
      return {
        type,
        offset: this.offset,
        indent: this.indent,
        source: this.source
      };
    }
    startBlockValue(parent) {
      switch (this.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
          return this.flowScalar(this.type);
        case "block-scalar-header":
          return {
            type: "block-scalar",
            offset: this.offset,
            indent: this.indent,
            props: [this.sourceToken],
            source: ""
          };
        case "flow-map-start":
        case "flow-seq-start":
          return {
            type: "flow-collection",
            offset: this.offset,
            indent: this.indent,
            start: this.sourceToken,
            items: [],
            end: []
          };
        case "seq-item-ind":
          return {
            type: "block-seq",
            offset: this.offset,
            indent: this.indent,
            items: [{ start: [this.sourceToken] }]
          };
        case "explicit-key-ind": {
          this.onKeyLine = true;
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          start.push(this.sourceToken);
          return {
            type: "block-map",
            offset: this.offset,
            indent: this.indent,
            items: [{ start, explicitKey: true }]
          };
        }
        case "map-value-ind": {
          this.onKeyLine = true;
          const prev = getPrevProps(parent);
          const start = getFirstKeyStartProps(prev);
          return {
            type: "block-map",
            offset: this.offset,
            indent: this.indent,
            items: [{ start, key: null, sep: [this.sourceToken] }]
          };
        }
      }
      return null;
    }
    atIndentedComment(start, indent) {
      if (this.type !== "comment")
        return false;
      if (this.indent <= indent)
        return false;
      return start.every((st) => st.type === "newline" || st.type === "space");
    }
    *documentEnd(docEnd) {
      if (this.type !== "doc-mode") {
        if (docEnd.end)
          docEnd.end.push(this.sourceToken);
        else
          docEnd.end = [this.sourceToken];
        if (this.type === "newline")
          yield* __yieldStar(this.pop());
      }
    }
    *lineEnd(token) {
      switch (this.type) {
        case "comma":
        case "doc-start":
        case "doc-end":
        case "flow-seq-end":
        case "flow-map-end":
        case "map-value-ind":
          yield* __yieldStar(this.pop());
          yield* __yieldStar(this.step());
          break;
        case "newline":
          this.onKeyLine = false;
        // fallthrough
        case "space":
        case "comment":
        default:
          if (token.end)
            token.end.push(this.sourceToken);
          else
            token.end = [this.sourceToken];
          if (this.type === "newline")
            yield* __yieldStar(this.pop());
      }
    }
  };

  // node_modules/yaml/browser/dist/public-api.js
  function parseOptions(options) {
    const prettyErrors = options.prettyErrors !== false;
    const lineCounter = options.lineCounter || prettyErrors && new LineCounter() || null;
    return { lineCounter, prettyErrors };
  }
  function parseAllDocuments(source, options = {}) {
    const { lineCounter, prettyErrors } = parseOptions(options);
    const parser = new Parser(lineCounter == null ? void 0 : lineCounter.addNewLine);
    const composer = new Composer(options);
    const docs = Array.from(composer.compose(parser.parse(source)));
    if (prettyErrors && lineCounter)
      for (const doc of docs) {
        doc.errors.forEach(prettifyError(source, lineCounter));
        doc.warnings.forEach(prettifyError(source, lineCounter));
      }
    if (docs.length > 0)
      return docs;
    return Object.assign([], { empty: true }, composer.streamInfo());
  }

  // src/workers/yaml-worker.ts
  var YamlWorker = class extends Mirror {
    constructor(sender) {
      super(sender);
      this.setTimeout(500);
    }
    onUpdate() {
      return __async(this, null, function* () {
        var value = this.doc.getValue();
        var errors = [];
        try {
          var diagnostics = [];
          var yamlAllDocuments = parseAllDocuments(value, {
            prettyErrors: false
          });
          yamlAllDocuments.forEach((doc) => {
            diagnostics.push(...doc.errors, ...doc.warnings);
          });
          errors = diagnostics.map((diagnostic) => {
            var _a;
            var start = (_a = diagnostic.linePos) == null ? void 0 : _a[0];
            var row, column;
            if (start) {
              row = start && start.line > 0 ? start.line : 0;
              column = start && start.col > 0 ? start.line : 0;
            } else {
              var pos = this.doc.indexToPosition(diagnostic.pos[0]);
              row = pos.row;
              column = pos.column;
            }
            return {
              row,
              column,
              text: diagnostic.message,
              type: diagnostic.name === "YAMLWarning" ? "warning" : "error"
            };
          });
        } catch (e) {
          console.error(e);
        }
        this.sender.emit("annotate", errors);
      });
    }
  };
  return __toCommonJS(yaml_worker_exports);
})();
aceLegacyWorkerModule = aceLegacyWorkerModule.default || aceLegacyWorkerModule;

exports.YamlWorker = aceLegacyWorkerModule.YamlWorker;
});
