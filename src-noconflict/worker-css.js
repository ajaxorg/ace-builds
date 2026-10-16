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

ace.define("ace/lib/oop", [], function(require, exports, module) {
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

ace.define("ace/lib/event_emitter", [], function(require, exports, module) {
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

ace.define("ace/mode/css_worker", [], function(require, exports, module) {
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
      exports.stringReverse = function(string) {
        return string.split("").reverse().join("");
      };
      exports.stringRepeat = function(string, count) {
        var result = "";
        while (count > 0) {
          if (count & 1)
            result += string;
          if (count >>= 1)
            string += string;
        }
        return result;
      };
      var trimBeginRegexp = /^\s\s*/;
      var trimEndRegexp = /\s\s*$/;
      exports.stringTrimLeft = function(string) {
        return string.replace(trimBeginRegexp, "");
      };
      exports.stringTrimRight = function(string) {
        return string.replace(trimEndRegexp, "");
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
        var map = {};
        for (var i = 0; i < arr.length; i++) {
          map[arr[i]] = 1;
        }
        return map;
      };
      exports.createMap = function(props) {
        var map = /* @__PURE__ */ Object.create(null);
        for (var i in props) {
          map[i] = props[i];
        }
        return map;
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
      exports.getMatchOffsets = function(string, regExp) {
        var matches2 = [];
        string.replace(regExp, function(str) {
          matches2.push({
            offset: arguments[arguments.length - 2],
            length: str.length
          });
        });
        return matches2;
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
      var Range3 = class _Range {
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
      Range3.fromPoints = function(start, end) {
        return new Range3(start.row, start.column, end.row, end.column);
      };
      Range3.comparePoints = function(p1, p2) {
        return p1.row - p2.row || p1.column - p2.column;
      };
      exports.Range = Range3;
    }
  });

  // src/workers/css-worker.ts
  var css_worker_exports = {};
  __export(css_worker_exports, {
    CssWorker: () => CssWorker
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

  // src/vscode-text-document-min.ts
  var MinTextDocument = class {
    constructor(uri, languageId, version, content) {
      this._uri = uri;
      this._languageId = languageId;
      this._version = version;
      this._content = content;
      this._lineOffsets = void 0;
    }
    get uri() {
      return this._uri;
    }
    get languageId() {
      return this._languageId;
    }
    get version() {
      return this._version;
    }
    getText(range) {
      if (range) {
        const start = this.offsetAt(range.start);
        const end = this.offsetAt(range.end);
        return this._content.substring(start, end);
      }
      return this._content;
    }
    getLineOffsets() {
      if (this._lineOffsets === void 0) {
        this._lineOffsets = computeLineOffsets(this._content, true);
      }
      return this._lineOffsets;
    }
    positionAt(offset) {
      offset = Math.max(Math.min(offset, this._content.length), 0);
      const lineOffsets = this.getLineOffsets();
      let low = 0, high = lineOffsets.length;
      if (high === 0) {
        return { line: 0, character: offset };
      }
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (lineOffsets[mid] > offset) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }
      const line = low - 1;
      offset = this.ensureBeforeEOL(offset, lineOffsets[line]);
      return { line, character: offset - lineOffsets[line] };
    }
    offsetAt(position) {
      const lineOffsets = this.getLineOffsets();
      if (position.line >= lineOffsets.length) {
        return this._content.length;
      } else if (position.line < 0) {
        return 0;
      }
      const lineOffset = lineOffsets[position.line];
      if (position.character <= 0) {
        return lineOffset;
      }
      const nextLineOffset = position.line + 1 < lineOffsets.length ? lineOffsets[position.line + 1] : this._content.length;
      const offset = Math.min(lineOffset + position.character, nextLineOffset);
      return this.ensureBeforeEOL(offset, lineOffset);
    }
    ensureBeforeEOL(offset, lineOffset) {
      while (offset > lineOffset && isEOL(this._content.charCodeAt(offset - 1))) {
        offset--;
      }
      return offset;
    }
    get lineCount() {
      return this.getLineOffsets().length;
    }
  };
  function computeLineOffsets(text, isAtLineStart, textOffset = 0) {
    const result = isAtLineStart ? [textOffset] : [];
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (isEOL(ch)) {
        if (ch === 13 /* CarriageReturn */ && i + 1 < text.length && text.charCodeAt(i + 1) === 10 /* LineFeed */) {
          i++;
        }
        result.push(textOffset + i + 1);
      }
    }
    return result;
  }
  function isEOL(char) {
    return char === 13 /* CarriageReturn */ || char === 10 /* LineFeed */;
  }

  // src/utils.ts
  function toAnnotations(diagnostics) {
    return diagnostics == null ? void 0 : diagnostics.map((el) => {
      const annotation = {
        row: el.range.start.line,
        column: el.range.start.character,
        text: el.message,
        type: el.severity === 1 ? "error" : el.severity === 2 ? "warning" : "info",
        code: el.code,
        data: el.data
      };
      return annotation;
    });
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/cssScanner.js
  var TokenType;
  (function(TokenType2) {
    TokenType2[TokenType2["Ident"] = 0] = "Ident";
    TokenType2[TokenType2["AtKeyword"] = 1] = "AtKeyword";
    TokenType2[TokenType2["String"] = 2] = "String";
    TokenType2[TokenType2["BadString"] = 3] = "BadString";
    TokenType2[TokenType2["UnquotedString"] = 4] = "UnquotedString";
    TokenType2[TokenType2["Hash"] = 5] = "Hash";
    TokenType2[TokenType2["Num"] = 6] = "Num";
    TokenType2[TokenType2["Percentage"] = 7] = "Percentage";
    TokenType2[TokenType2["Dimension"] = 8] = "Dimension";
    TokenType2[TokenType2["UnicodeRange"] = 9] = "UnicodeRange";
    TokenType2[TokenType2["CDO"] = 10] = "CDO";
    TokenType2[TokenType2["CDC"] = 11] = "CDC";
    TokenType2[TokenType2["Colon"] = 12] = "Colon";
    TokenType2[TokenType2["SemiColon"] = 13] = "SemiColon";
    TokenType2[TokenType2["CurlyL"] = 14] = "CurlyL";
    TokenType2[TokenType2["CurlyR"] = 15] = "CurlyR";
    TokenType2[TokenType2["ParenthesisL"] = 16] = "ParenthesisL";
    TokenType2[TokenType2["ParenthesisR"] = 17] = "ParenthesisR";
    TokenType2[TokenType2["BracketL"] = 18] = "BracketL";
    TokenType2[TokenType2["BracketR"] = 19] = "BracketR";
    TokenType2[TokenType2["Whitespace"] = 20] = "Whitespace";
    TokenType2[TokenType2["Includes"] = 21] = "Includes";
    TokenType2[TokenType2["Dashmatch"] = 22] = "Dashmatch";
    TokenType2[TokenType2["SubstringOperator"] = 23] = "SubstringOperator";
    TokenType2[TokenType2["PrefixOperator"] = 24] = "PrefixOperator";
    TokenType2[TokenType2["SuffixOperator"] = 25] = "SuffixOperator";
    TokenType2[TokenType2["Delim"] = 26] = "Delim";
    TokenType2[TokenType2["EMS"] = 27] = "EMS";
    TokenType2[TokenType2["EXS"] = 28] = "EXS";
    TokenType2[TokenType2["Length"] = 29] = "Length";
    TokenType2[TokenType2["Angle"] = 30] = "Angle";
    TokenType2[TokenType2["Time"] = 31] = "Time";
    TokenType2[TokenType2["Freq"] = 32] = "Freq";
    TokenType2[TokenType2["Exclamation"] = 33] = "Exclamation";
    TokenType2[TokenType2["Resolution"] = 34] = "Resolution";
    TokenType2[TokenType2["Comma"] = 35] = "Comma";
    TokenType2[TokenType2["Charset"] = 36] = "Charset";
    TokenType2[TokenType2["EscapedJavaScript"] = 37] = "EscapedJavaScript";
    TokenType2[TokenType2["BadEscapedJavaScript"] = 38] = "BadEscapedJavaScript";
    TokenType2[TokenType2["Comment"] = 39] = "Comment";
    TokenType2[TokenType2["SingleLineComment"] = 40] = "SingleLineComment";
    TokenType2[TokenType2["EOF"] = 41] = "EOF";
    TokenType2[TokenType2["ContainerQueryLength"] = 42] = "ContainerQueryLength";
    TokenType2[TokenType2["CustomToken"] = 43] = "CustomToken";
  })(TokenType || (TokenType = {}));
  var MultiLineStream = class {
    constructor(source) {
      this.source = source;
      this.len = source.length;
      this.position = 0;
    }
    substring(from, to = this.position) {
      return this.source.substring(from, to);
    }
    eos() {
      return this.len <= this.position;
    }
    pos() {
      return this.position;
    }
    goBackTo(pos) {
      this.position = pos;
    }
    goBack(n) {
      this.position -= n;
    }
    advance(n) {
      this.position += n;
    }
    nextChar() {
      return this.source.charCodeAt(this.position++) || 0;
    }
    peekChar(n = 0) {
      return this.source.charCodeAt(this.position + n) || 0;
    }
    lookbackChar(n = 0) {
      return this.source.charCodeAt(this.position - n) || 0;
    }
    advanceIfChar(ch) {
      if (ch === this.source.charCodeAt(this.position)) {
        this.position++;
        return true;
      }
      return false;
    }
    advanceIfChars(ch) {
      if (this.position + ch.length > this.source.length) {
        return false;
      }
      let i = 0;
      for (; i < ch.length; i++) {
        if (this.source.charCodeAt(this.position + i) !== ch[i]) {
          return false;
        }
      }
      this.advance(i);
      return true;
    }
    advanceWhileChar(condition) {
      const posNow = this.position;
      while (this.position < this.len && condition(this.source.charCodeAt(this.position))) {
        this.position++;
      }
      return this.position - posNow;
    }
  };
  var _a = "a".charCodeAt(0);
  var _f = "f".charCodeAt(0);
  var _z = "z".charCodeAt(0);
  var _u = "u".charCodeAt(0);
  var _A = "A".charCodeAt(0);
  var _F = "F".charCodeAt(0);
  var _Z = "Z".charCodeAt(0);
  var _0 = "0".charCodeAt(0);
  var _9 = "9".charCodeAt(0);
  var _TLD = "~".charCodeAt(0);
  var _HAT = "^".charCodeAt(0);
  var _EQS = "=".charCodeAt(0);
  var _PIP = "|".charCodeAt(0);
  var _MIN = "-".charCodeAt(0);
  var _USC = "_".charCodeAt(0);
  var _PRC = "%".charCodeAt(0);
  var _MUL = "*".charCodeAt(0);
  var _LPA = "(".charCodeAt(0);
  var _RPA = ")".charCodeAt(0);
  var _LAN = "<".charCodeAt(0);
  var _RAN = ">".charCodeAt(0);
  var _ATS = "@".charCodeAt(0);
  var _HSH = "#".charCodeAt(0);
  var _DLR = "$".charCodeAt(0);
  var _BSL = "\\".charCodeAt(0);
  var _FSL = "/".charCodeAt(0);
  var _NWL = "\n".charCodeAt(0);
  var _CAR = "\r".charCodeAt(0);
  var _LFD = "\f".charCodeAt(0);
  var _DQO = '"'.charCodeAt(0);
  var _SQO = "'".charCodeAt(0);
  var _WSP = " ".charCodeAt(0);
  var _TAB = "	".charCodeAt(0);
  var _SEM = ";".charCodeAt(0);
  var _COL = ":".charCodeAt(0);
  var _CUL = "{".charCodeAt(0);
  var _CUR = "}".charCodeAt(0);
  var _BRL = "[".charCodeAt(0);
  var _BRR = "]".charCodeAt(0);
  var _CMA = ",".charCodeAt(0);
  var _DOT = ".".charCodeAt(0);
  var _BNG = "!".charCodeAt(0);
  var _QSM = "?".charCodeAt(0);
  var _PLS = "+".charCodeAt(0);
  var staticTokenTable = {};
  staticTokenTable[_SEM] = TokenType.SemiColon;
  staticTokenTable[_COL] = TokenType.Colon;
  staticTokenTable[_CUL] = TokenType.CurlyL;
  staticTokenTable[_CUR] = TokenType.CurlyR;
  staticTokenTable[_BRR] = TokenType.BracketR;
  staticTokenTable[_BRL] = TokenType.BracketL;
  staticTokenTable[_LPA] = TokenType.ParenthesisL;
  staticTokenTable[_RPA] = TokenType.ParenthesisR;
  staticTokenTable[_CMA] = TokenType.Comma;
  var staticUnitTable = {};
  staticUnitTable["em"] = TokenType.EMS;
  staticUnitTable["ex"] = TokenType.EXS;
  staticUnitTable["px"] = TokenType.Length;
  staticUnitTable["cm"] = TokenType.Length;
  staticUnitTable["mm"] = TokenType.Length;
  staticUnitTable["in"] = TokenType.Length;
  staticUnitTable["pt"] = TokenType.Length;
  staticUnitTable["pc"] = TokenType.Length;
  staticUnitTable["deg"] = TokenType.Angle;
  staticUnitTable["rad"] = TokenType.Angle;
  staticUnitTable["grad"] = TokenType.Angle;
  staticUnitTable["ms"] = TokenType.Time;
  staticUnitTable["s"] = TokenType.Time;
  staticUnitTable["hz"] = TokenType.Freq;
  staticUnitTable["khz"] = TokenType.Freq;
  staticUnitTable["%"] = TokenType.Percentage;
  staticUnitTable["fr"] = TokenType.Percentage;
  staticUnitTable["dpi"] = TokenType.Resolution;
  staticUnitTable["dpcm"] = TokenType.Resolution;
  staticUnitTable["cqw"] = TokenType.ContainerQueryLength;
  staticUnitTable["cqh"] = TokenType.ContainerQueryLength;
  staticUnitTable["cqi"] = TokenType.ContainerQueryLength;
  staticUnitTable["cqb"] = TokenType.ContainerQueryLength;
  staticUnitTable["cqmin"] = TokenType.ContainerQueryLength;
  staticUnitTable["cqmax"] = TokenType.ContainerQueryLength;
  var Scanner = class {
    constructor() {
      this.stream = new MultiLineStream("");
      this.ignoreComment = true;
      this.ignoreWhitespace = true;
      this.inURL = false;
    }
    setSource(input) {
      this.stream = new MultiLineStream(input);
    }
    finishToken(offset, type, text) {
      return {
        offset,
        len: this.stream.pos() - offset,
        type,
        text: text || this.stream.substring(offset)
      };
    }
    substring(offset, len) {
      return this.stream.substring(offset, offset + len);
    }
    pos() {
      return this.stream.pos();
    }
    goBackTo(pos) {
      this.stream.goBackTo(pos);
    }
    scanUnquotedString() {
      const offset = this.stream.pos();
      const content = [];
      if (this._unquotedString(content)) {
        return this.finishToken(offset, TokenType.UnquotedString, content.join(""));
      }
      return null;
    }
    scan() {
      const triviaToken = this.trivia();
      if (triviaToken !== null) {
        return triviaToken;
      }
      const offset = this.stream.pos();
      if (this.stream.eos()) {
        return this.finishToken(offset, TokenType.EOF);
      }
      return this.scanNext(offset);
    }
    /**
     * Read the range as described in https://www.w3.org/TR/CSS21/syndata.html#tokenization
     * Assume the `u` has aleady been consumed
     * @returns if reading the unicode was successful
     */
    tryScanUnicode() {
      const offset = this.stream.pos();
      if (!this.stream.eos() && this._unicodeRange()) {
        return this.finishToken(offset, TokenType.UnicodeRange);
      }
      this.stream.goBackTo(offset);
      return void 0;
    }
    scanNext(offset) {
      if (this.stream.advanceIfChars([_LAN, _BNG, _MIN, _MIN])) {
        return this.finishToken(offset, TokenType.CDO);
      }
      if (this.stream.advanceIfChars([_MIN, _MIN, _RAN])) {
        return this.finishToken(offset, TokenType.CDC);
      }
      let content = [];
      if (this.ident(content)) {
        return this.finishToken(offset, TokenType.Ident, content.join(""));
      }
      if (this.stream.advanceIfChar(_ATS)) {
        content = ["@"];
        if (this._name(content)) {
          const keywordText = content.join("");
          if (keywordText === "@charset") {
            return this.finishToken(offset, TokenType.Charset, keywordText);
          }
          return this.finishToken(offset, TokenType.AtKeyword, keywordText);
        } else {
          return this.finishToken(offset, TokenType.Delim);
        }
      }
      if (this.stream.advanceIfChar(_HSH)) {
        content = ["#"];
        if (this._name(content)) {
          return this.finishToken(offset, TokenType.Hash, content.join(""));
        } else {
          return this.finishToken(offset, TokenType.Delim);
        }
      }
      if (this.stream.advanceIfChar(_BNG)) {
        return this.finishToken(offset, TokenType.Exclamation);
      }
      if (this._number()) {
        const pos = this.stream.pos();
        content = [this.stream.substring(offset, pos)];
        if (this.stream.advanceIfChar(_PRC)) {
          return this.finishToken(offset, TokenType.Percentage);
        } else if (this.ident(content)) {
          const dim = this.stream.substring(pos).toLowerCase();
          const tokenType2 = staticUnitTable[dim];
          if (typeof tokenType2 !== "undefined") {
            return this.finishToken(offset, tokenType2, content.join(""));
          } else {
            return this.finishToken(offset, TokenType.Dimension, content.join(""));
          }
        }
        return this.finishToken(offset, TokenType.Num);
      }
      content = [];
      let tokenType = this._string(content);
      if (tokenType !== null) {
        return this.finishToken(offset, tokenType, content.join(""));
      }
      tokenType = staticTokenTable[this.stream.peekChar()];
      if (typeof tokenType !== "undefined") {
        this.stream.advance(1);
        return this.finishToken(offset, tokenType);
      }
      if (this.stream.peekChar(0) === _TLD && this.stream.peekChar(1) === _EQS) {
        this.stream.advance(2);
        return this.finishToken(offset, TokenType.Includes);
      }
      if (this.stream.peekChar(0) === _PIP && this.stream.peekChar(1) === _EQS) {
        this.stream.advance(2);
        return this.finishToken(offset, TokenType.Dashmatch);
      }
      if (this.stream.peekChar(0) === _MUL && this.stream.peekChar(1) === _EQS) {
        this.stream.advance(2);
        return this.finishToken(offset, TokenType.SubstringOperator);
      }
      if (this.stream.peekChar(0) === _HAT && this.stream.peekChar(1) === _EQS) {
        this.stream.advance(2);
        return this.finishToken(offset, TokenType.PrefixOperator);
      }
      if (this.stream.peekChar(0) === _DLR && this.stream.peekChar(1) === _EQS) {
        this.stream.advance(2);
        return this.finishToken(offset, TokenType.SuffixOperator);
      }
      this.stream.nextChar();
      return this.finishToken(offset, TokenType.Delim);
    }
    trivia() {
      while (true) {
        const offset = this.stream.pos();
        if (this._whitespace()) {
          if (!this.ignoreWhitespace) {
            return this.finishToken(offset, TokenType.Whitespace);
          }
        } else if (this.comment()) {
          if (!this.ignoreComment) {
            return this.finishToken(offset, TokenType.Comment);
          }
        } else {
          return null;
        }
      }
    }
    comment() {
      if (this.stream.advanceIfChars([_FSL, _MUL])) {
        let success = false, hot = false;
        this.stream.advanceWhileChar((ch) => {
          if (hot && ch === _FSL) {
            success = true;
            return false;
          }
          hot = ch === _MUL;
          return true;
        });
        if (success) {
          this.stream.advance(1);
        }
        return true;
      }
      return false;
    }
    _number() {
      let npeek = 0;
      let hasDot = false;
      const peekFirst = this.stream.peekChar();
      if (peekFirst === _PLS || peekFirst === _MIN) {
        npeek++;
      }
      if (this.stream.peekChar(npeek) === _DOT) {
        npeek++;
        hasDot = true;
      }
      const ch = this.stream.peekChar(npeek);
      if (ch >= _0 && ch <= _9) {
        this.stream.advance(npeek + 1);
        this.stream.advanceWhileChar((ch2) => {
          return ch2 >= _0 && ch2 <= _9 || !hasDot && ch2 === _DOT;
        });
        return true;
      }
      return false;
    }
    _newline(result) {
      const ch = this.stream.peekChar();
      switch (ch) {
        case _CAR:
        case _LFD:
        case _NWL:
          this.stream.advance(1);
          result.push(String.fromCharCode(ch));
          if (ch === _CAR && this.stream.advanceIfChar(_NWL)) {
            result.push("\n");
          }
          return true;
      }
      return false;
    }
    _escape(result, includeNewLines) {
      let ch = this.stream.peekChar();
      if (ch === _BSL) {
        this.stream.advance(1);
        ch = this.stream.peekChar();
        let hexNumCount = 0;
        while (hexNumCount < 6 && (ch >= _0 && ch <= _9 || ch >= _a && ch <= _f || ch >= _A && ch <= _F)) {
          this.stream.advance(1);
          ch = this.stream.peekChar();
          hexNumCount++;
        }
        if (hexNumCount > 0) {
          try {
            const hexVal = parseInt(this.stream.substring(this.stream.pos() - hexNumCount), 16);
            if (hexVal) {
              result.push(String.fromCharCode(hexVal));
            }
          } catch (e) {
          }
          if (ch === _WSP || ch === _TAB) {
            this.stream.advance(1);
          } else {
            this._newline([]);
          }
          return true;
        }
        if (ch !== _CAR && ch !== _LFD && ch !== _NWL) {
          this.stream.advance(1);
          result.push(String.fromCharCode(ch));
          return true;
        } else if (includeNewLines) {
          return this._newline(result);
        }
      }
      return false;
    }
    _stringChar(closeQuote, result) {
      const ch = this.stream.peekChar();
      if (ch !== 0 && ch !== closeQuote && ch !== _BSL && ch !== _CAR && ch !== _LFD && ch !== _NWL) {
        this.stream.advance(1);
        result.push(String.fromCharCode(ch));
        return true;
      }
      return false;
    }
    _string(result) {
      if (this.stream.peekChar() === _SQO || this.stream.peekChar() === _DQO) {
        const closeQuote = this.stream.nextChar();
        result.push(String.fromCharCode(closeQuote));
        while (this._stringChar(closeQuote, result) || this._escape(result, true)) {
        }
        if (this.stream.peekChar() === closeQuote) {
          this.stream.nextChar();
          result.push(String.fromCharCode(closeQuote));
          return TokenType.String;
        } else {
          return TokenType.BadString;
        }
      }
      return null;
    }
    _unquotedChar(result) {
      const ch = this.stream.peekChar();
      if (ch !== 0 && ch !== _BSL && ch !== _SQO && ch !== _DQO && ch !== _LPA && ch !== _RPA && ch !== _WSP && ch !== _TAB && ch !== _NWL && ch !== _LFD && ch !== _CAR) {
        this.stream.advance(1);
        result.push(String.fromCharCode(ch));
        return true;
      }
      return false;
    }
    _unquotedString(result) {
      let hasContent = false;
      while (this._unquotedChar(result) || this._escape(result)) {
        hasContent = true;
      }
      return hasContent;
    }
    _whitespace() {
      const n = this.stream.advanceWhileChar((ch) => {
        return ch === _WSP || ch === _TAB || ch === _NWL || ch === _LFD || ch === _CAR;
      });
      return n > 0;
    }
    _name(result) {
      let matched = false;
      while (this._identChar(result) || this._escape(result)) {
        matched = true;
      }
      return matched;
    }
    ident(result) {
      const pos = this.stream.pos();
      const hasMinus = this._minus(result);
      if (hasMinus) {
        if (this._minus(result) || this._identFirstChar(result) || this._escape(result)) {
          while (this._identChar(result) || this._escape(result)) {
          }
          return true;
        }
      } else if (this._identFirstChar(result) || this._escape(result)) {
        while (this._identChar(result) || this._escape(result)) {
        }
        return true;
      }
      this.stream.goBackTo(pos);
      return false;
    }
    _identFirstChar(result) {
      const ch = this.stream.peekChar();
      if (ch === _USC || // _
      ch >= _a && ch <= _z || // a-z
      ch >= _A && ch <= _Z || // A-Z
      ch >= 128 && ch <= 65535) {
        this.stream.advance(1);
        result.push(String.fromCharCode(ch));
        return true;
      }
      return false;
    }
    _minus(result) {
      const ch = this.stream.peekChar();
      if (ch === _MIN) {
        this.stream.advance(1);
        result.push(String.fromCharCode(ch));
        return true;
      }
      return false;
    }
    _identChar(result) {
      const ch = this.stream.peekChar();
      if (ch === _USC || // _
      ch === _MIN || // -
      ch >= _a && ch <= _z || // a-z
      ch >= _A && ch <= _Z || // A-Z
      ch >= _0 && ch <= _9 || // 0/9
      ch >= 128 && ch <= 65535) {
        this.stream.advance(1);
        result.push(String.fromCharCode(ch));
        return true;
      }
      return false;
    }
    _unicodeRange() {
      if (this.stream.advanceIfChar(_PLS)) {
        const isHexDigit = (ch) => ch >= _0 && ch <= _9 || ch >= _a && ch <= _f || ch >= _A && ch <= _F;
        const codePoints = this.stream.advanceWhileChar(isHexDigit) + this.stream.advanceWhileChar((ch) => ch === _QSM);
        if (codePoints >= 1 && codePoints <= 6) {
          if (this.stream.advanceIfChar(_MIN)) {
            const digits = this.stream.advanceWhileChar(isHexDigit);
            if (digits >= 1 && digits <= 6) {
              return true;
            }
          } else {
            return true;
          }
        }
      }
      return false;
    }
  };

  // ../../node_modules/vscode-css-languageservice/lib/esm/utils/strings.js
  function trim(str, regexp) {
    const m = regexp.exec(str);
    if (m && m[0].length) {
      return str.substr(0, str.length - m[0].length);
    }
    return str;
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/cssNodes.js
  var NodeType;
  (function(NodeType2) {
    NodeType2[NodeType2["Undefined"] = 0] = "Undefined";
    NodeType2[NodeType2["Identifier"] = 1] = "Identifier";
    NodeType2[NodeType2["Stylesheet"] = 2] = "Stylesheet";
    NodeType2[NodeType2["Ruleset"] = 3] = "Ruleset";
    NodeType2[NodeType2["Selector"] = 4] = "Selector";
    NodeType2[NodeType2["SimpleSelector"] = 5] = "SimpleSelector";
    NodeType2[NodeType2["SelectorInterpolation"] = 6] = "SelectorInterpolation";
    NodeType2[NodeType2["SelectorCombinator"] = 7] = "SelectorCombinator";
    NodeType2[NodeType2["SelectorCombinatorParent"] = 8] = "SelectorCombinatorParent";
    NodeType2[NodeType2["SelectorCombinatorSibling"] = 9] = "SelectorCombinatorSibling";
    NodeType2[NodeType2["SelectorCombinatorAllSiblings"] = 10] = "SelectorCombinatorAllSiblings";
    NodeType2[NodeType2["SelectorCombinatorShadowPiercingDescendant"] = 11] = "SelectorCombinatorShadowPiercingDescendant";
    NodeType2[NodeType2["Page"] = 12] = "Page";
    NodeType2[NodeType2["PageBoxMarginBox"] = 13] = "PageBoxMarginBox";
    NodeType2[NodeType2["ClassSelector"] = 14] = "ClassSelector";
    NodeType2[NodeType2["IdentifierSelector"] = 15] = "IdentifierSelector";
    NodeType2[NodeType2["ElementNameSelector"] = 16] = "ElementNameSelector";
    NodeType2[NodeType2["PseudoSelector"] = 17] = "PseudoSelector";
    NodeType2[NodeType2["AttributeSelector"] = 18] = "AttributeSelector";
    NodeType2[NodeType2["Declaration"] = 19] = "Declaration";
    NodeType2[NodeType2["Declarations"] = 20] = "Declarations";
    NodeType2[NodeType2["Property"] = 21] = "Property";
    NodeType2[NodeType2["Expression"] = 22] = "Expression";
    NodeType2[NodeType2["BinaryExpression"] = 23] = "BinaryExpression";
    NodeType2[NodeType2["Term"] = 24] = "Term";
    NodeType2[NodeType2["Operator"] = 25] = "Operator";
    NodeType2[NodeType2["Value"] = 26] = "Value";
    NodeType2[NodeType2["StringLiteral"] = 27] = "StringLiteral";
    NodeType2[NodeType2["URILiteral"] = 28] = "URILiteral";
    NodeType2[NodeType2["EscapedValue"] = 29] = "EscapedValue";
    NodeType2[NodeType2["Function"] = 30] = "Function";
    NodeType2[NodeType2["NumericValue"] = 31] = "NumericValue";
    NodeType2[NodeType2["HexColorValue"] = 32] = "HexColorValue";
    NodeType2[NodeType2["RatioValue"] = 33] = "RatioValue";
    NodeType2[NodeType2["MixinDeclaration"] = 34] = "MixinDeclaration";
    NodeType2[NodeType2["MixinReference"] = 35] = "MixinReference";
    NodeType2[NodeType2["VariableName"] = 36] = "VariableName";
    NodeType2[NodeType2["VariableDeclaration"] = 37] = "VariableDeclaration";
    NodeType2[NodeType2["Prio"] = 38] = "Prio";
    NodeType2[NodeType2["Interpolation"] = 39] = "Interpolation";
    NodeType2[NodeType2["NestedProperties"] = 40] = "NestedProperties";
    NodeType2[NodeType2["ExtendsReference"] = 41] = "ExtendsReference";
    NodeType2[NodeType2["SelectorPlaceholder"] = 42] = "SelectorPlaceholder";
    NodeType2[NodeType2["Debug"] = 43] = "Debug";
    NodeType2[NodeType2["If"] = 44] = "If";
    NodeType2[NodeType2["Else"] = 45] = "Else";
    NodeType2[NodeType2["For"] = 46] = "For";
    NodeType2[NodeType2["Each"] = 47] = "Each";
    NodeType2[NodeType2["While"] = 48] = "While";
    NodeType2[NodeType2["MixinContentReference"] = 49] = "MixinContentReference";
    NodeType2[NodeType2["MixinContentDeclaration"] = 50] = "MixinContentDeclaration";
    NodeType2[NodeType2["Media"] = 51] = "Media";
    NodeType2[NodeType2["Scope"] = 52] = "Scope";
    NodeType2[NodeType2["Keyframe"] = 53] = "Keyframe";
    NodeType2[NodeType2["FontFace"] = 54] = "FontFace";
    NodeType2[NodeType2["Import"] = 55] = "Import";
    NodeType2[NodeType2["Namespace"] = 56] = "Namespace";
    NodeType2[NodeType2["Invocation"] = 57] = "Invocation";
    NodeType2[NodeType2["FunctionDeclaration"] = 58] = "FunctionDeclaration";
    NodeType2[NodeType2["ReturnStatement"] = 59] = "ReturnStatement";
    NodeType2[NodeType2["MediaQuery"] = 60] = "MediaQuery";
    NodeType2[NodeType2["MediaCondition"] = 61] = "MediaCondition";
    NodeType2[NodeType2["MediaFeature"] = 62] = "MediaFeature";
    NodeType2[NodeType2["FunctionParameter"] = 63] = "FunctionParameter";
    NodeType2[NodeType2["FunctionArgument"] = 64] = "FunctionArgument";
    NodeType2[NodeType2["KeyframeSelector"] = 65] = "KeyframeSelector";
    NodeType2[NodeType2["ViewPort"] = 66] = "ViewPort";
    NodeType2[NodeType2["Document"] = 67] = "Document";
    NodeType2[NodeType2["AtApplyRule"] = 68] = "AtApplyRule";
    NodeType2[NodeType2["CustomPropertyDeclaration"] = 69] = "CustomPropertyDeclaration";
    NodeType2[NodeType2["CustomPropertySet"] = 70] = "CustomPropertySet";
    NodeType2[NodeType2["ListEntry"] = 71] = "ListEntry";
    NodeType2[NodeType2["Supports"] = 72] = "Supports";
    NodeType2[NodeType2["SupportsCondition"] = 73] = "SupportsCondition";
    NodeType2[NodeType2["NamespacePrefix"] = 74] = "NamespacePrefix";
    NodeType2[NodeType2["GridLine"] = 75] = "GridLine";
    NodeType2[NodeType2["Plugin"] = 76] = "Plugin";
    NodeType2[NodeType2["UnknownAtRule"] = 77] = "UnknownAtRule";
    NodeType2[NodeType2["Use"] = 78] = "Use";
    NodeType2[NodeType2["ModuleConfiguration"] = 79] = "ModuleConfiguration";
    NodeType2[NodeType2["Forward"] = 80] = "Forward";
    NodeType2[NodeType2["ForwardVisibility"] = 81] = "ForwardVisibility";
    NodeType2[NodeType2["Module"] = 82] = "Module";
    NodeType2[NodeType2["UnicodeRange"] = 83] = "UnicodeRange";
    NodeType2[NodeType2["Layer"] = 84] = "Layer";
    NodeType2[NodeType2["LayerNameList"] = 85] = "LayerNameList";
    NodeType2[NodeType2["LayerName"] = 86] = "LayerName";
    NodeType2[NodeType2["PropertyAtRule"] = 87] = "PropertyAtRule";
    NodeType2[NodeType2["Container"] = 88] = "Container";
    NodeType2[NodeType2["ModuleConfig"] = 89] = "ModuleConfig";
    NodeType2[NodeType2["SelectorList"] = 90] = "SelectorList";
    NodeType2[NodeType2["StartingStyleAtRule"] = 91] = "StartingStyleAtRule";
  })(NodeType || (NodeType = {}));
  var ReferenceType;
  (function(ReferenceType2) {
    ReferenceType2[ReferenceType2["Mixin"] = 0] = "Mixin";
    ReferenceType2[ReferenceType2["Rule"] = 1] = "Rule";
    ReferenceType2[ReferenceType2["Variable"] = 2] = "Variable";
    ReferenceType2[ReferenceType2["Function"] = 3] = "Function";
    ReferenceType2[ReferenceType2["Keyframe"] = 4] = "Keyframe";
    ReferenceType2[ReferenceType2["Unknown"] = 5] = "Unknown";
    ReferenceType2[ReferenceType2["Module"] = 6] = "Module";
    ReferenceType2[ReferenceType2["Forward"] = 7] = "Forward";
    ReferenceType2[ReferenceType2["ForwardVisibility"] = 8] = "ForwardVisibility";
    ReferenceType2[ReferenceType2["Property"] = 9] = "Property";
  })(ReferenceType || (ReferenceType = {}));
  var Node = class {
    get end() {
      return this.offset + this.length;
    }
    constructor(offset = -1, len = -1, nodeType) {
      this.parent = null;
      this.offset = offset;
      this.length = len;
      if (nodeType) {
        this.nodeType = nodeType;
      }
    }
    set type(type) {
      this.nodeType = type;
    }
    get type() {
      return this.nodeType || NodeType.Undefined;
    }
    getTextProvider() {
      let node = this;
      while (node && !node.textProvider) {
        node = node.parent;
      }
      if (node) {
        return node.textProvider;
      }
      return () => {
        return "unknown";
      };
    }
    getText() {
      return this.getTextProvider()(this.offset, this.length);
    }
    matches(str) {
      return this.length === str.length && this.getTextProvider()(this.offset, this.length) === str;
    }
    startsWith(str) {
      return this.length >= str.length && this.getTextProvider()(this.offset, str.length) === str;
    }
    endsWith(str) {
      return this.length >= str.length && this.getTextProvider()(this.end - str.length, str.length) === str;
    }
    accept(visitor) {
      if (visitor(this) && this.children) {
        for (const child of this.children) {
          child.accept(visitor);
        }
      }
    }
    acceptVisitor(visitor) {
      this.accept(visitor.visitNode.bind(visitor));
    }
    adoptChild(node, index = -1) {
      if (node.parent && node.parent.children) {
        const idx = node.parent.children.indexOf(node);
        if (idx >= 0) {
          node.parent.children.splice(idx, 1);
        }
      }
      node.parent = this;
      let children = this.children;
      if (!children) {
        children = this.children = [];
      }
      if (index !== -1) {
        children.splice(index, 0, node);
      } else {
        children.push(node);
      }
      return node;
    }
    attachTo(parent, index = -1) {
      if (parent) {
        parent.adoptChild(this, index);
      }
      return this;
    }
    collectIssues(results) {
      if (this.issues) {
        results.push.apply(results, this.issues);
      }
    }
    addIssue(issue) {
      if (!this.issues) {
        this.issues = [];
      }
      this.issues.push(issue);
    }
    hasIssue(rule) {
      return Array.isArray(this.issues) && this.issues.some((i) => i.getRule() === rule);
    }
    isErroneous(recursive = false) {
      if (this.issues && this.issues.length > 0) {
        return true;
      }
      return recursive && Array.isArray(this.children) && this.children.some((c) => c.isErroneous(true));
    }
    setNode(field, node, index = -1) {
      if (node) {
        node.attachTo(this, index);
        this[field] = node;
        return true;
      }
      return false;
    }
    addChild(node) {
      if (node) {
        if (!this.children) {
          this.children = [];
        }
        node.attachTo(this);
        this.updateOffsetAndLength(node);
        return true;
      }
      return false;
    }
    updateOffsetAndLength(node) {
      if (node.offset < this.offset || this.offset === -1) {
        this.offset = node.offset;
      }
      const nodeEnd = node.end;
      if (nodeEnd > this.end || this.length === -1) {
        this.length = nodeEnd - this.offset;
      }
    }
    hasChildren() {
      return !!this.children && this.children.length > 0;
    }
    getChildren() {
      return this.children ? this.children.slice(0) : [];
    }
    getChild(index) {
      if (this.children && index < this.children.length) {
        return this.children[index];
      }
      return null;
    }
    addChildren(nodes) {
      for (const node of nodes) {
        this.addChild(node);
      }
    }
    findFirstChildBeforeOffset(offset) {
      if (this.children) {
        let current = null;
        for (let i = this.children.length - 1; i >= 0; i--) {
          current = this.children[i];
          if (current.offset <= offset) {
            return current;
          }
        }
      }
      return null;
    }
    findChildAtOffset(offset, goDeep) {
      const current = this.findFirstChildBeforeOffset(offset);
      if (current && current.end >= offset) {
        if (goDeep) {
          return current.findChildAtOffset(offset, true) || current;
        }
        return current;
      }
      return null;
    }
    encloses(candidate) {
      return this.offset <= candidate.offset && this.offset + this.length >= candidate.offset + candidate.length;
    }
    getParent() {
      let result = this.parent;
      while (result instanceof Nodelist) {
        result = result.parent;
      }
      return result;
    }
    findParent(type) {
      let result = this;
      while (result && result.type !== type) {
        result = result.parent;
      }
      return result;
    }
    findAParent(...types) {
      let result = this;
      while (result && !types.some((t2) => result.type === t2)) {
        result = result.parent;
      }
      return result;
    }
    setData(key, value) {
      if (!this.options) {
        this.options = {};
      }
      this.options[key] = value;
    }
    getData(key) {
      if (!this.options || !this.options.hasOwnProperty(key)) {
        return null;
      }
      return this.options[key];
    }
  };
  var Nodelist = class extends Node {
    constructor(parent, index = -1) {
      super(-1, -1);
      this.attachTo(parent, index);
      this.offset = -1;
      this.length = -1;
    }
  };
  var UnicodeRange = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.UnicodeRange;
    }
    setRangeStart(rangeStart) {
      return this.setNode("rangeStart", rangeStart);
    }
    getRangeStart() {
      return this.rangeStart;
    }
    setRangeEnd(rangeEnd) {
      return this.setNode("rangeEnd", rangeEnd);
    }
    getRangeEnd() {
      return this.rangeEnd;
    }
  };
  var Identifier = class extends Node {
    constructor(offset, length) {
      super(offset, length);
      this.isCustomProperty = false;
    }
    get type() {
      return NodeType.Identifier;
    }
    containsInterpolation() {
      return this.hasChildren();
    }
  };
  var Stylesheet = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Stylesheet;
    }
  };
  var Declarations = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Declarations;
    }
  };
  var BodyDeclaration = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    getDeclarations() {
      return this.declarations;
    }
    setDeclarations(decls) {
      return this.setNode("declarations", decls);
    }
  };
  var RuleSet = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Ruleset;
    }
    getSelectors() {
      if (!this.selectors) {
        this.selectors = new Nodelist(this);
      }
      return this.selectors;
    }
    isNested() {
      return !!this.parent && this.parent.findParent(NodeType.Declarations) !== null;
    }
  };
  var Selector = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Selector;
    }
  };
  var SimpleSelector = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.SimpleSelector;
    }
  };
  var AbstractDeclaration = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
  };
  var CustomPropertySet = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.CustomPropertySet;
    }
  };
  var Declaration = class _Declaration extends AbstractDeclaration {
    constructor(offset, length) {
      super(offset, length);
      this.property = null;
    }
    get type() {
      return NodeType.Declaration;
    }
    setProperty(node) {
      return this.setNode("property", node);
    }
    getProperty() {
      return this.property;
    }
    getFullPropertyName() {
      const propertyName = this.property ? this.property.getName() : "unknown";
      if (this.parent instanceof Declarations && this.parent.getParent() instanceof NestedProperties) {
        const parentDecl = this.parent.getParent().getParent();
        if (parentDecl instanceof _Declaration) {
          return parentDecl.getFullPropertyName() + propertyName;
        }
      }
      return propertyName;
    }
    getNonPrefixedPropertyName() {
      const propertyName = this.getFullPropertyName();
      if (propertyName && propertyName.charAt(0) === "-") {
        const vendorPrefixEnd = propertyName.indexOf("-", 1);
        if (vendorPrefixEnd !== -1) {
          return propertyName.substring(vendorPrefixEnd + 1);
        }
      }
      return propertyName;
    }
    setValue(value) {
      return this.setNode("value", value);
    }
    getValue() {
      return this.value;
    }
    setNestedProperties(value) {
      return this.setNode("nestedProperties", value);
    }
    getNestedProperties() {
      return this.nestedProperties;
    }
  };
  var CustomPropertyDeclaration = class extends Declaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.CustomPropertyDeclaration;
    }
    setPropertySet(value) {
      return this.setNode("propertySet", value);
    }
    getPropertySet() {
      return this.propertySet;
    }
  };
  var Property = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Property;
    }
    setIdentifier(value) {
      return this.setNode("identifier", value);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return trim(this.getText(), /[_\+]+$/);
    }
    isCustomProperty() {
      return !!this.identifier && this.identifier.isCustomProperty;
    }
  };
  var Invocation = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Invocation;
    }
    getArguments() {
      if (!this.arguments) {
        this.arguments = new Nodelist(this);
      }
      return this.arguments;
    }
  };
  var Function = class extends Invocation {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Function;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return this.identifier ? this.identifier.getText() : "";
    }
  };
  var FunctionParameter = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.FunctionParameter;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return this.identifier ? this.identifier.getText() : "";
    }
    setDefaultValue(node) {
      return this.setNode("defaultValue", node, 0);
    }
    getDefaultValue() {
      return this.defaultValue;
    }
  };
  var FunctionArgument = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.FunctionArgument;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return this.identifier ? this.identifier.getText() : "";
    }
    setValue(node) {
      return this.setNode("value", node, 0);
    }
    getValue() {
      return this.value;
    }
  };
  var IfStatement = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.If;
    }
    setExpression(node) {
      return this.setNode("expression", node, 0);
    }
    setElseClause(elseClause) {
      return this.setNode("elseClause", elseClause);
    }
  };
  var ForStatement = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.For;
    }
    setVariable(node) {
      return this.setNode("variable", node, 0);
    }
  };
  var EachStatement = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Each;
    }
    getVariables() {
      if (!this.variables) {
        this.variables = new Nodelist(this);
      }
      return this.variables;
    }
  };
  var WhileStatement = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.While;
    }
  };
  var ElseStatement = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Else;
    }
  };
  var FunctionDeclaration = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.FunctionDeclaration;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return this.identifier ? this.identifier.getText() : "";
    }
    getParameters() {
      if (!this.parameters) {
        this.parameters = new Nodelist(this);
      }
      return this.parameters;
    }
  };
  var ViewPort = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.ViewPort;
    }
  };
  var FontFace = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.FontFace;
    }
  };
  var NestedProperties = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.NestedProperties;
    }
  };
  var Keyframe = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Keyframe;
    }
    setKeyword(keyword) {
      return this.setNode("keyword", keyword, 0);
    }
    getKeyword() {
      return this.keyword;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return this.identifier ? this.identifier.getText() : "";
    }
  };
  var KeyframeSelector = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.KeyframeSelector;
    }
  };
  var Import = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Import;
    }
    setMedialist(node) {
      if (node) {
        node.attachTo(this);
        return true;
      }
      return false;
    }
  };
  var Use = class extends Node {
    get type() {
      return NodeType.Use;
    }
    setParameters(value) {
      return this.setNode("parameters", value);
    }
    getParameters() {
      return this.parameters;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
  };
  var ModuleConfiguration = class extends Node {
    get type() {
      return NodeType.ModuleConfiguration;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return this.identifier ? this.identifier.getText() : "";
    }
    setValue(node) {
      return this.setNode("value", node, 0);
    }
    getValue() {
      return this.value;
    }
  };
  var Forward = class extends Node {
    get type() {
      return NodeType.Forward;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    setParameters(value) {
      return this.setNode("parameters", value);
    }
    getParameters() {
      return this.parameters;
    }
  };
  var ForwardVisibility = class extends Node {
    get type() {
      return NodeType.ForwardVisibility;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
  };
  var Namespace = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Namespace;
    }
  };
  var Media = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Media;
    }
  };
  var Scope = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Scope;
    }
  };
  var ScopeLimits = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Scope;
    }
    getScopeStart() {
      return this.scopeStart;
    }
    setScopeStart(right) {
      return this.setNode("scopeStart", right);
    }
    getScopeEnd() {
      return this.scopeEnd;
    }
    setScopeEnd(right) {
      return this.setNode("scopeEnd", right);
    }
    getName() {
      let name = "";
      if (this.scopeStart) {
        name += this.scopeStart.getText();
      }
      if (this.scopeEnd) {
        name += `${this.scopeStart ? " " : ""}\u2192 ${this.scopeEnd.getText()}`;
      }
      return name;
    }
  };
  var Supports = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Supports;
    }
  };
  var Layer = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Layer;
    }
    setNames(names) {
      return this.setNode("names", names);
    }
    getNames() {
      return this.names;
    }
  };
  var PropertyAtRule = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.PropertyAtRule;
    }
    setName(node) {
      if (node) {
        node.attachTo(this);
        this.name = node;
        return true;
      }
      return false;
    }
    getName() {
      return this.name;
    }
  };
  var StartingStyleAtRule = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.StartingStyleAtRule;
    }
  };
  var Document = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Document;
    }
  };
  var Container = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Container;
    }
  };
  var Medialist = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
  };
  var MediaQuery = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.MediaQuery;
    }
  };
  var MediaCondition = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.MediaCondition;
    }
  };
  var MediaFeature = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.MediaFeature;
    }
  };
  var SupportsCondition = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.SupportsCondition;
    }
  };
  var Page = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Page;
    }
  };
  var PageBoxMarginBox = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.PageBoxMarginBox;
    }
  };
  var Expression = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Expression;
    }
  };
  var BinaryExpression = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.BinaryExpression;
    }
    setLeft(left) {
      return this.setNode("left", left);
    }
    getLeft() {
      return this.left;
    }
    setRight(right) {
      return this.setNode("right", right);
    }
    getRight() {
      return this.right;
    }
    setOperator(value) {
      return this.setNode("operator", value);
    }
    getOperator() {
      return this.operator;
    }
  };
  var Term = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Term;
    }
    setOperator(value) {
      return this.setNode("operator", value);
    }
    getOperator() {
      return this.operator;
    }
    setExpression(value) {
      return this.setNode("expression", value);
    }
    getExpression() {
      return this.expression;
    }
  };
  var AttributeSelector = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.AttributeSelector;
    }
    setNamespacePrefix(value) {
      return this.setNode("namespacePrefix", value);
    }
    getNamespacePrefix() {
      return this.namespacePrefix;
    }
    setIdentifier(value) {
      return this.setNode("identifier", value);
    }
    getIdentifier() {
      return this.identifier;
    }
    setOperator(operator) {
      return this.setNode("operator", operator);
    }
    getOperator() {
      return this.operator;
    }
    setValue(value) {
      return this.setNode("value", value);
    }
    getValue() {
      return this.value;
    }
  };
  var HexColorValue = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.HexColorValue;
    }
  };
  var RatioValue = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.RatioValue;
    }
  };
  var _dot = ".".charCodeAt(0);
  var _02 = "0".charCodeAt(0);
  var _92 = "9".charCodeAt(0);
  var NumericValue = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.NumericValue;
    }
    getValue() {
      const raw = this.getText();
      let unitIdx = 0;
      let code;
      for (let i = 0, len = raw.length; i < len; i++) {
        code = raw.charCodeAt(i);
        if (!(_02 <= code && code <= _92 || code === _dot)) {
          break;
        }
        unitIdx += 1;
      }
      return {
        value: raw.substring(0, unitIdx),
        unit: unitIdx < raw.length ? raw.substring(unitIdx) : void 0
      };
    }
  };
  var VariableDeclaration = class extends AbstractDeclaration {
    constructor(offset, length) {
      super(offset, length);
      this.needsSemicolon = true;
    }
    get type() {
      return NodeType.VariableDeclaration;
    }
    setVariable(node) {
      if (node) {
        node.attachTo(this);
        this.variable = node;
        return true;
      }
      return false;
    }
    getVariable() {
      return this.variable;
    }
    getName() {
      return this.variable ? this.variable.getName() : "";
    }
    setValue(node) {
      if (node) {
        node.attachTo(this);
        this.value = node;
        return true;
      }
      return false;
    }
    getValue() {
      return this.value;
    }
  };
  var Interpolation = class extends Node {
    // private _interpolations: void; // workaround for https://github.com/Microsoft/TypeScript/issues/18276
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.Interpolation;
    }
  };
  var Variable = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.VariableName;
    }
    getName() {
      return this.getText();
    }
  };
  var ExtendsReference = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.ExtendsReference;
    }
    getSelectors() {
      if (!this.selectors) {
        this.selectors = new Nodelist(this);
      }
      return this.selectors;
    }
  };
  var MixinContentReference = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.MixinContentReference;
    }
    getArguments() {
      if (!this.arguments) {
        this.arguments = new Nodelist(this);
      }
      return this.arguments;
    }
  };
  var MixinContentDeclaration = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.MixinContentDeclaration;
    }
    getParameters() {
      if (!this.parameters) {
        this.parameters = new Nodelist(this);
      }
      return this.parameters;
    }
  };
  var MixinReference = class extends Node {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.MixinReference;
    }
    getNamespaces() {
      if (!this.namespaces) {
        this.namespaces = new Nodelist(this);
      }
      return this.namespaces;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return this.identifier ? this.identifier.getText() : "";
    }
    getArguments() {
      if (!this.arguments) {
        this.arguments = new Nodelist(this);
      }
      return this.arguments;
    }
    setContent(node) {
      return this.setNode("content", node);
    }
    getContent() {
      return this.content;
    }
  };
  var MixinDeclaration = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.MixinDeclaration;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
    getName() {
      return this.identifier ? this.identifier.getText() : "";
    }
    getParameters() {
      if (!this.parameters) {
        this.parameters = new Nodelist(this);
      }
      return this.parameters;
    }
    setGuard(node) {
      if (node) {
        node.attachTo(this);
        this.guard = node;
      }
      return false;
    }
  };
  var UnknownAtRule = class extends BodyDeclaration {
    constructor(offset, length) {
      super(offset, length);
    }
    get type() {
      return NodeType.UnknownAtRule;
    }
    setAtRuleName(atRuleName) {
      this.atRuleName = atRuleName;
    }
    getAtRuleName() {
      return this.atRuleName;
    }
  };
  var ListEntry = class extends Node {
    get type() {
      return NodeType.ListEntry;
    }
    setKey(node) {
      return this.setNode("key", node, 0);
    }
    setValue(node) {
      return this.setNode("value", node, 1);
    }
  };
  var LessGuard = class extends Node {
    getConditions() {
      if (!this.conditions) {
        this.conditions = new Nodelist(this);
      }
      return this.conditions;
    }
  };
  var GuardCondition = class extends Node {
    setVariable(node) {
      return this.setNode("variable", node);
    }
  };
  var Module = class extends Node {
    get type() {
      return NodeType.Module;
    }
    setIdentifier(node) {
      return this.setNode("identifier", node, 0);
    }
    getIdentifier() {
      return this.identifier;
    }
  };
  var Level;
  (function(Level2) {
    Level2[Level2["Ignore"] = 1] = "Ignore";
    Level2[Level2["Warning"] = 2] = "Warning";
    Level2[Level2["Error"] = 4] = "Error";
  })(Level || (Level = {}));
  var Marker = class {
    constructor(node, rule, level, message, offset = node.offset, length = node.length) {
      this.node = node;
      this.rule = rule;
      this.level = level;
      this.message = message || rule.message;
      this.offset = offset;
      this.length = length;
    }
    getRule() {
      return this.rule;
    }
    getLevel() {
      return this.level;
    }
    getOffset() {
      return this.offset;
    }
    getLength() {
      return this.length;
    }
    getNode() {
      return this.node;
    }
    getMessage() {
      return this.message;
    }
  };
  var ParseErrorCollector = class _ParseErrorCollector {
    static entries(node) {
      const visitor = new _ParseErrorCollector();
      node.acceptVisitor(visitor);
      return visitor.entries;
    }
    constructor() {
      this.entries = [];
    }
    visitNode(node) {
      if (node.isErroneous()) {
        node.collectIssues(this.entries);
      }
      return true;
    }
  };

  // ../../node_modules/@vscode/l10n/dist/browser.js
  var bundle;
  function t(...args) {
    var _a2;
    const firstArg = args[0];
    let key;
    let message;
    let formatArgs;
    if (typeof firstArg === "string") {
      key = firstArg;
      message = firstArg;
      args.splice(0, 1);
      formatArgs = !args || typeof args[0] !== "object" ? args : args[0];
    } else if (firstArg instanceof Array) {
      const replacements = args.slice(1);
      if (firstArg.length !== replacements.length + 1) {
        throw new Error("expected a string as the first argument to l10n.t");
      }
      let str = firstArg[0];
      for (let i = 1; i < firstArg.length; i++) {
        str += `{${i - 1}}` + firstArg[i];
      }
      return t(str, ...replacements);
    } else {
      message = firstArg.message;
      key = message;
      if (firstArg.comment && firstArg.comment.length > 0) {
        key += `/${Array.isArray(firstArg.comment) ? firstArg.comment.join("") : firstArg.comment}`;
      }
      formatArgs = (_a2 = firstArg.args) != null ? _a2 : {};
    }
    const messageFromBundle = bundle == null ? void 0 : bundle[key];
    if (!messageFromBundle) {
      return format(message, formatArgs);
    }
    if (typeof messageFromBundle === "string") {
      return format(messageFromBundle, formatArgs);
    }
    if (messageFromBundle.comment) {
      return format(messageFromBundle.message, formatArgs);
    }
    return format(message, formatArgs);
  }
  var _format2Regexp = /{([^}]+)}/g;
  function format(template, values2) {
    if (Object.keys(values2).length === 0) {
      return template;
    }
    return template.replace(_format2Regexp, (match, group) => {
      var _a2;
      return (_a2 = values2[group]) != null ? _a2 : match;
    });
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/cssErrors.js
  var CSSIssueType = class {
    constructor(id, message) {
      this.id = id;
      this.message = message;
    }
  };
  var ParseError = {
    NumberExpected: new CSSIssueType("css-numberexpected", t("number expected")),
    ConditionExpected: new CSSIssueType("css-conditionexpected", t("condition expected")),
    RuleOrSelectorExpected: new CSSIssueType("css-ruleorselectorexpected", t("at-rule or selector expected")),
    DotExpected: new CSSIssueType("css-dotexpected", t("dot expected")),
    ColonExpected: new CSSIssueType("css-colonexpected", t("colon expected")),
    SemiColonExpected: new CSSIssueType("css-semicolonexpected", t("semi-colon expected")),
    TermExpected: new CSSIssueType("css-termexpected", t("term expected")),
    ExpressionExpected: new CSSIssueType("css-expressionexpected", t("expression expected")),
    OperatorExpected: new CSSIssueType("css-operatorexpected", t("operator expected")),
    IdentifierExpected: new CSSIssueType("css-identifierexpected", t("identifier expected")),
    PercentageExpected: new CSSIssueType("css-percentageexpected", t("percentage expected")),
    URIOrStringExpected: new CSSIssueType("css-uriorstringexpected", t("uri or string expected")),
    URIExpected: new CSSIssueType("css-uriexpected", t("URI expected")),
    VariableNameExpected: new CSSIssueType("css-varnameexpected", t("variable name expected")),
    VariableValueExpected: new CSSIssueType("css-varvalueexpected", t("variable value expected")),
    PropertyValueExpected: new CSSIssueType("css-propertyvalueexpected", t("property value expected")),
    LeftCurlyExpected: new CSSIssueType("css-lcurlyexpected", t("{ expected")),
    RightCurlyExpected: new CSSIssueType("css-rcurlyexpected", t("} expected")),
    LeftSquareBracketExpected: new CSSIssueType("css-rbracketexpected", t("[ expected")),
    RightSquareBracketExpected: new CSSIssueType("css-lbracketexpected", t("] expected")),
    LeftParenthesisExpected: new CSSIssueType("css-lparentexpected", t("( expected")),
    RightParenthesisExpected: new CSSIssueType("css-rparentexpected", t(") expected")),
    CommaExpected: new CSSIssueType("css-commaexpected", t("comma expected")),
    PageDirectiveOrDeclarationExpected: new CSSIssueType("css-pagedirordeclexpected", t("page directive or declaraton expected")),
    UnknownAtRule: new CSSIssueType("css-unknownatrule", t("at-rule unknown")),
    UnknownKeyword: new CSSIssueType("css-unknownkeyword", t("unknown keyword")),
    SelectorExpected: new CSSIssueType("css-selectorexpected", t("selector expected")),
    StringLiteralExpected: new CSSIssueType("css-stringliteralexpected", t("string literal expected")),
    WhitespaceExpected: new CSSIssueType("css-whitespaceexpected", t("whitespace expected")),
    MediaQueryExpected: new CSSIssueType("css-mediaqueryexpected", t("media query expected")),
    IdentifierOrWildcardExpected: new CSSIssueType("css-idorwildcardexpected", t("identifier or wildcard expected")),
    WildcardExpected: new CSSIssueType("css-wildcardexpected", t("wildcard expected")),
    IdentifierOrVariableExpected: new CSSIssueType("css-idorvarexpected", t("identifier or variable expected")),
    IfConditionExpected: new CSSIssueType("css-ifconditionexpected", t("if condition expected"))
  };

  // ../../node_modules/vscode-languageserver-types/lib/esm/main.js
  var DocumentUri;
  (function(DocumentUri2) {
    function is(value) {
      return typeof value === "string";
    }
    DocumentUri2.is = is;
  })(DocumentUri || (DocumentUri = {}));
  var URI;
  (function(URI2) {
    function is(value) {
      return typeof value === "string";
    }
    URI2.is = is;
  })(URI || (URI = {}));
  var integer;
  (function(integer2) {
    integer2.MIN_VALUE = -2147483648;
    integer2.MAX_VALUE = 2147483647;
    function is(value) {
      return typeof value === "number" && integer2.MIN_VALUE <= value && value <= integer2.MAX_VALUE;
    }
    integer2.is = is;
  })(integer || (integer = {}));
  var uinteger;
  (function(uinteger2) {
    uinteger2.MIN_VALUE = 0;
    uinteger2.MAX_VALUE = 2147483647;
    function is(value) {
      return typeof value === "number" && uinteger2.MIN_VALUE <= value && value <= uinteger2.MAX_VALUE;
    }
    uinteger2.is = is;
  })(uinteger || (uinteger = {}));
  var Position;
  (function(Position2) {
    function create(line, character) {
      if (line === Number.MAX_VALUE) {
        line = uinteger.MAX_VALUE;
      }
      if (character === Number.MAX_VALUE) {
        character = uinteger.MAX_VALUE;
      }
      return { line, character };
    }
    Position2.create = create;
    function is(value) {
      let candidate = value;
      return Is.objectLiteral(candidate) && Is.uinteger(candidate.line) && Is.uinteger(candidate.character);
    }
    Position2.is = is;
  })(Position || (Position = {}));
  var Range2;
  (function(Range3) {
    function create(one, two, three, four) {
      if (Is.uinteger(one) && Is.uinteger(two) && Is.uinteger(three) && Is.uinteger(four)) {
        return { start: Position.create(one, two), end: Position.create(three, four) };
      } else if (Position.is(one) && Position.is(two)) {
        return { start: one, end: two };
      } else {
        throw new Error(`Range#create called with invalid arguments[${one}, ${two}, ${three}, ${four}]`);
      }
    }
    Range3.create = create;
    function is(value) {
      let candidate = value;
      return Is.objectLiteral(candidate) && Position.is(candidate.start) && Position.is(candidate.end);
    }
    Range3.is = is;
  })(Range2 || (Range2 = {}));
  var Location;
  (function(Location2) {
    function create(uri, range) {
      return { uri, range };
    }
    Location2.create = create;
    function is(value) {
      let candidate = value;
      return Is.objectLiteral(candidate) && Range2.is(candidate.range) && (Is.string(candidate.uri) || Is.undefined(candidate.uri));
    }
    Location2.is = is;
  })(Location || (Location = {}));
  var LocationLink;
  (function(LocationLink2) {
    function create(targetUri, targetRange, targetSelectionRange, originSelectionRange) {
      return { targetUri, targetRange, targetSelectionRange, originSelectionRange };
    }
    LocationLink2.create = create;
    function is(value) {
      let candidate = value;
      return Is.objectLiteral(candidate) && Range2.is(candidate.targetRange) && Is.string(candidate.targetUri) && Range2.is(candidate.targetSelectionRange) && (Range2.is(candidate.originSelectionRange) || Is.undefined(candidate.originSelectionRange));
    }
    LocationLink2.is = is;
  })(LocationLink || (LocationLink = {}));
  var Color;
  (function(Color2) {
    function create(red, green, blue, alpha) {
      return {
        red,
        green,
        blue,
        alpha
      };
    }
    Color2.create = create;
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && Is.numberRange(candidate.red, 0, 1) && Is.numberRange(candidate.green, 0, 1) && Is.numberRange(candidate.blue, 0, 1) && Is.numberRange(candidate.alpha, 0, 1);
    }
    Color2.is = is;
  })(Color || (Color = {}));
  var ColorInformation;
  (function(ColorInformation2) {
    function create(range, color) {
      return {
        range,
        color
      };
    }
    ColorInformation2.create = create;
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && Range2.is(candidate.range) && Color.is(candidate.color);
    }
    ColorInformation2.is = is;
  })(ColorInformation || (ColorInformation = {}));
  var ColorPresentation;
  (function(ColorPresentation2) {
    function create(label, textEdit, additionalTextEdits) {
      return {
        label,
        textEdit,
        additionalTextEdits
      };
    }
    ColorPresentation2.create = create;
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && Is.string(candidate.label) && (Is.undefined(candidate.textEdit) || TextEdit.is(candidate)) && (Is.undefined(candidate.additionalTextEdits) || Is.typedArray(candidate.additionalTextEdits, TextEdit.is));
    }
    ColorPresentation2.is = is;
  })(ColorPresentation || (ColorPresentation = {}));
  var FoldingRangeKind;
  (function(FoldingRangeKind2) {
    FoldingRangeKind2.Comment = "comment";
    FoldingRangeKind2.Imports = "imports";
    FoldingRangeKind2.Region = "region";
  })(FoldingRangeKind || (FoldingRangeKind = {}));
  var FoldingRange;
  (function(FoldingRange2) {
    function create(startLine, endLine, startCharacter, endCharacter, kind, collapsedText) {
      const result = {
        startLine,
        endLine
      };
      if (Is.defined(startCharacter)) {
        result.startCharacter = startCharacter;
      }
      if (Is.defined(endCharacter)) {
        result.endCharacter = endCharacter;
      }
      if (Is.defined(kind)) {
        result.kind = kind;
      }
      if (Is.defined(collapsedText)) {
        result.collapsedText = collapsedText;
      }
      return result;
    }
    FoldingRange2.create = create;
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && Is.uinteger(candidate.startLine) && Is.uinteger(candidate.startLine) && (Is.undefined(candidate.startCharacter) || Is.uinteger(candidate.startCharacter)) && (Is.undefined(candidate.endCharacter) || Is.uinteger(candidate.endCharacter)) && (Is.undefined(candidate.kind) || Is.string(candidate.kind));
    }
    FoldingRange2.is = is;
  })(FoldingRange || (FoldingRange = {}));
  var DiagnosticRelatedInformation;
  (function(DiagnosticRelatedInformation2) {
    function create(location, message) {
      return {
        location,
        message
      };
    }
    DiagnosticRelatedInformation2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Location.is(candidate.location) && Is.string(candidate.message);
    }
    DiagnosticRelatedInformation2.is = is;
  })(DiagnosticRelatedInformation || (DiagnosticRelatedInformation = {}));
  var DiagnosticSeverity;
  (function(DiagnosticSeverity2) {
    DiagnosticSeverity2.Error = 1;
    DiagnosticSeverity2.Warning = 2;
    DiagnosticSeverity2.Information = 3;
    DiagnosticSeverity2.Hint = 4;
  })(DiagnosticSeverity || (DiagnosticSeverity = {}));
  var DiagnosticTag;
  (function(DiagnosticTag2) {
    DiagnosticTag2.Unnecessary = 1;
    DiagnosticTag2.Deprecated = 2;
  })(DiagnosticTag || (DiagnosticTag = {}));
  var CodeDescription;
  (function(CodeDescription2) {
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && Is.string(candidate.href);
    }
    CodeDescription2.is = is;
  })(CodeDescription || (CodeDescription = {}));
  var Diagnostic;
  (function(Diagnostic2) {
    function create(range, message, severity, code, source, relatedInformation) {
      let result = { range, message };
      if (Is.defined(severity)) {
        result.severity = severity;
      }
      if (Is.defined(code)) {
        result.code = code;
      }
      if (Is.defined(source)) {
        result.source = source;
      }
      if (Is.defined(relatedInformation)) {
        result.relatedInformation = relatedInformation;
      }
      return result;
    }
    Diagnostic2.create = create;
    function is(value) {
      var _a2;
      let candidate = value;
      return Is.defined(candidate) && Range2.is(candidate.range) && Is.string(candidate.message) && (Is.number(candidate.severity) || Is.undefined(candidate.severity)) && (Is.integer(candidate.code) || Is.string(candidate.code) || Is.undefined(candidate.code)) && (Is.undefined(candidate.codeDescription) || Is.string((_a2 = candidate.codeDescription) === null || _a2 === void 0 ? void 0 : _a2.href)) && (Is.string(candidate.source) || Is.undefined(candidate.source)) && (Is.undefined(candidate.relatedInformation) || Is.typedArray(candidate.relatedInformation, DiagnosticRelatedInformation.is));
    }
    Diagnostic2.is = is;
  })(Diagnostic || (Diagnostic = {}));
  var Command;
  (function(Command2) {
    function create(title, command, ...args) {
      let result = { title, command };
      if (Is.defined(args) && args.length > 0) {
        result.arguments = args;
      }
      return result;
    }
    Command2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Is.string(candidate.title) && Is.string(candidate.command);
    }
    Command2.is = is;
  })(Command || (Command = {}));
  var TextEdit;
  (function(TextEdit2) {
    function replace(range, newText) {
      return { range, newText };
    }
    TextEdit2.replace = replace;
    function insert(position, newText) {
      return { range: { start: position, end: position }, newText };
    }
    TextEdit2.insert = insert;
    function del(range) {
      return { range, newText: "" };
    }
    TextEdit2.del = del;
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && Is.string(candidate.newText) && Range2.is(candidate.range);
    }
    TextEdit2.is = is;
  })(TextEdit || (TextEdit = {}));
  var ChangeAnnotation;
  (function(ChangeAnnotation2) {
    function create(label, needsConfirmation, description) {
      const result = { label };
      if (needsConfirmation !== void 0) {
        result.needsConfirmation = needsConfirmation;
      }
      if (description !== void 0) {
        result.description = description;
      }
      return result;
    }
    ChangeAnnotation2.create = create;
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && Is.string(candidate.label) && (Is.boolean(candidate.needsConfirmation) || candidate.needsConfirmation === void 0) && (Is.string(candidate.description) || candidate.description === void 0);
    }
    ChangeAnnotation2.is = is;
  })(ChangeAnnotation || (ChangeAnnotation = {}));
  var ChangeAnnotationIdentifier;
  (function(ChangeAnnotationIdentifier2) {
    function is(value) {
      const candidate = value;
      return Is.string(candidate);
    }
    ChangeAnnotationIdentifier2.is = is;
  })(ChangeAnnotationIdentifier || (ChangeAnnotationIdentifier = {}));
  var AnnotatedTextEdit;
  (function(AnnotatedTextEdit2) {
    function replace(range, newText, annotation) {
      return { range, newText, annotationId: annotation };
    }
    AnnotatedTextEdit2.replace = replace;
    function insert(position, newText, annotation) {
      return { range: { start: position, end: position }, newText, annotationId: annotation };
    }
    AnnotatedTextEdit2.insert = insert;
    function del(range, annotation) {
      return { range, newText: "", annotationId: annotation };
    }
    AnnotatedTextEdit2.del = del;
    function is(value) {
      const candidate = value;
      return TextEdit.is(candidate) && (ChangeAnnotation.is(candidate.annotationId) || ChangeAnnotationIdentifier.is(candidate.annotationId));
    }
    AnnotatedTextEdit2.is = is;
  })(AnnotatedTextEdit || (AnnotatedTextEdit = {}));
  var TextDocumentEdit;
  (function(TextDocumentEdit2) {
    function create(textDocument, edits) {
      return { textDocument, edits };
    }
    TextDocumentEdit2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && OptionalVersionedTextDocumentIdentifier.is(candidate.textDocument) && Array.isArray(candidate.edits);
    }
    TextDocumentEdit2.is = is;
  })(TextDocumentEdit || (TextDocumentEdit = {}));
  var CreateFile;
  (function(CreateFile2) {
    function create(uri, options, annotation) {
      let result = {
        kind: "create",
        uri
      };
      if (options !== void 0 && (options.overwrite !== void 0 || options.ignoreIfExists !== void 0)) {
        result.options = options;
      }
      if (annotation !== void 0) {
        result.annotationId = annotation;
      }
      return result;
    }
    CreateFile2.create = create;
    function is(value) {
      let candidate = value;
      return candidate && candidate.kind === "create" && Is.string(candidate.uri) && (candidate.options === void 0 || (candidate.options.overwrite === void 0 || Is.boolean(candidate.options.overwrite)) && (candidate.options.ignoreIfExists === void 0 || Is.boolean(candidate.options.ignoreIfExists))) && (candidate.annotationId === void 0 || ChangeAnnotationIdentifier.is(candidate.annotationId));
    }
    CreateFile2.is = is;
  })(CreateFile || (CreateFile = {}));
  var RenameFile;
  (function(RenameFile2) {
    function create(oldUri, newUri, options, annotation) {
      let result = {
        kind: "rename",
        oldUri,
        newUri
      };
      if (options !== void 0 && (options.overwrite !== void 0 || options.ignoreIfExists !== void 0)) {
        result.options = options;
      }
      if (annotation !== void 0) {
        result.annotationId = annotation;
      }
      return result;
    }
    RenameFile2.create = create;
    function is(value) {
      let candidate = value;
      return candidate && candidate.kind === "rename" && Is.string(candidate.oldUri) && Is.string(candidate.newUri) && (candidate.options === void 0 || (candidate.options.overwrite === void 0 || Is.boolean(candidate.options.overwrite)) && (candidate.options.ignoreIfExists === void 0 || Is.boolean(candidate.options.ignoreIfExists))) && (candidate.annotationId === void 0 || ChangeAnnotationIdentifier.is(candidate.annotationId));
    }
    RenameFile2.is = is;
  })(RenameFile || (RenameFile = {}));
  var DeleteFile;
  (function(DeleteFile2) {
    function create(uri, options, annotation) {
      let result = {
        kind: "delete",
        uri
      };
      if (options !== void 0 && (options.recursive !== void 0 || options.ignoreIfNotExists !== void 0)) {
        result.options = options;
      }
      if (annotation !== void 0) {
        result.annotationId = annotation;
      }
      return result;
    }
    DeleteFile2.create = create;
    function is(value) {
      let candidate = value;
      return candidate && candidate.kind === "delete" && Is.string(candidate.uri) && (candidate.options === void 0 || (candidate.options.recursive === void 0 || Is.boolean(candidate.options.recursive)) && (candidate.options.ignoreIfNotExists === void 0 || Is.boolean(candidate.options.ignoreIfNotExists))) && (candidate.annotationId === void 0 || ChangeAnnotationIdentifier.is(candidate.annotationId));
    }
    DeleteFile2.is = is;
  })(DeleteFile || (DeleteFile = {}));
  var WorkspaceEdit;
  (function(WorkspaceEdit2) {
    function is(value) {
      let candidate = value;
      return candidate && (candidate.changes !== void 0 || candidate.documentChanges !== void 0) && (candidate.documentChanges === void 0 || candidate.documentChanges.every((change) => {
        if (Is.string(change.kind)) {
          return CreateFile.is(change) || RenameFile.is(change) || DeleteFile.is(change);
        } else {
          return TextDocumentEdit.is(change);
        }
      }));
    }
    WorkspaceEdit2.is = is;
  })(WorkspaceEdit || (WorkspaceEdit = {}));
  var TextDocumentIdentifier;
  (function(TextDocumentIdentifier2) {
    function create(uri) {
      return { uri };
    }
    TextDocumentIdentifier2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Is.string(candidate.uri);
    }
    TextDocumentIdentifier2.is = is;
  })(TextDocumentIdentifier || (TextDocumentIdentifier = {}));
  var VersionedTextDocumentIdentifier;
  (function(VersionedTextDocumentIdentifier2) {
    function create(uri, version) {
      return { uri, version };
    }
    VersionedTextDocumentIdentifier2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Is.string(candidate.uri) && Is.integer(candidate.version);
    }
    VersionedTextDocumentIdentifier2.is = is;
  })(VersionedTextDocumentIdentifier || (VersionedTextDocumentIdentifier = {}));
  var OptionalVersionedTextDocumentIdentifier;
  (function(OptionalVersionedTextDocumentIdentifier2) {
    function create(uri, version) {
      return { uri, version };
    }
    OptionalVersionedTextDocumentIdentifier2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Is.string(candidate.uri) && (candidate.version === null || Is.integer(candidate.version));
    }
    OptionalVersionedTextDocumentIdentifier2.is = is;
  })(OptionalVersionedTextDocumentIdentifier || (OptionalVersionedTextDocumentIdentifier = {}));
  var TextDocumentItem;
  (function(TextDocumentItem2) {
    function create(uri, languageId, version, text) {
      return { uri, languageId, version, text };
    }
    TextDocumentItem2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Is.string(candidate.uri) && Is.string(candidate.languageId) && Is.integer(candidate.version) && Is.string(candidate.text);
    }
    TextDocumentItem2.is = is;
  })(TextDocumentItem || (TextDocumentItem = {}));
  var MarkupKind;
  (function(MarkupKind2) {
    MarkupKind2.PlainText = "plaintext";
    MarkupKind2.Markdown = "markdown";
    function is(value) {
      const candidate = value;
      return candidate === MarkupKind2.PlainText || candidate === MarkupKind2.Markdown;
    }
    MarkupKind2.is = is;
  })(MarkupKind || (MarkupKind = {}));
  var MarkupContent;
  (function(MarkupContent2) {
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(value) && MarkupKind.is(candidate.kind) && Is.string(candidate.value);
    }
    MarkupContent2.is = is;
  })(MarkupContent || (MarkupContent = {}));
  var CompletionItemKind;
  (function(CompletionItemKind2) {
    CompletionItemKind2.Text = 1;
    CompletionItemKind2.Method = 2;
    CompletionItemKind2.Function = 3;
    CompletionItemKind2.Constructor = 4;
    CompletionItemKind2.Field = 5;
    CompletionItemKind2.Variable = 6;
    CompletionItemKind2.Class = 7;
    CompletionItemKind2.Interface = 8;
    CompletionItemKind2.Module = 9;
    CompletionItemKind2.Property = 10;
    CompletionItemKind2.Unit = 11;
    CompletionItemKind2.Value = 12;
    CompletionItemKind2.Enum = 13;
    CompletionItemKind2.Keyword = 14;
    CompletionItemKind2.Snippet = 15;
    CompletionItemKind2.Color = 16;
    CompletionItemKind2.File = 17;
    CompletionItemKind2.Reference = 18;
    CompletionItemKind2.Folder = 19;
    CompletionItemKind2.EnumMember = 20;
    CompletionItemKind2.Constant = 21;
    CompletionItemKind2.Struct = 22;
    CompletionItemKind2.Event = 23;
    CompletionItemKind2.Operator = 24;
    CompletionItemKind2.TypeParameter = 25;
  })(CompletionItemKind || (CompletionItemKind = {}));
  var InsertTextFormat;
  (function(InsertTextFormat2) {
    InsertTextFormat2.PlainText = 1;
    InsertTextFormat2.Snippet = 2;
  })(InsertTextFormat || (InsertTextFormat = {}));
  var CompletionItemTag;
  (function(CompletionItemTag2) {
    CompletionItemTag2.Deprecated = 1;
  })(CompletionItemTag || (CompletionItemTag = {}));
  var InsertReplaceEdit;
  (function(InsertReplaceEdit2) {
    function create(newText, insert, replace) {
      return { newText, insert, replace };
    }
    InsertReplaceEdit2.create = create;
    function is(value) {
      const candidate = value;
      return candidate && Is.string(candidate.newText) && Range2.is(candidate.insert) && Range2.is(candidate.replace);
    }
    InsertReplaceEdit2.is = is;
  })(InsertReplaceEdit || (InsertReplaceEdit = {}));
  var InsertTextMode;
  (function(InsertTextMode2) {
    InsertTextMode2.asIs = 1;
    InsertTextMode2.adjustIndentation = 2;
  })(InsertTextMode || (InsertTextMode = {}));
  var CompletionItemLabelDetails;
  (function(CompletionItemLabelDetails2) {
    function is(value) {
      const candidate = value;
      return candidate && (Is.string(candidate.detail) || candidate.detail === void 0) && (Is.string(candidate.description) || candidate.description === void 0);
    }
    CompletionItemLabelDetails2.is = is;
  })(CompletionItemLabelDetails || (CompletionItemLabelDetails = {}));
  var CompletionItem;
  (function(CompletionItem2) {
    function create(label) {
      return { label };
    }
    CompletionItem2.create = create;
  })(CompletionItem || (CompletionItem = {}));
  var CompletionList;
  (function(CompletionList2) {
    function create(items, isIncomplete) {
      return { items: items ? items : [], isIncomplete: !!isIncomplete };
    }
    CompletionList2.create = create;
  })(CompletionList || (CompletionList = {}));
  var MarkedString;
  (function(MarkedString2) {
    function fromPlainText(plainText) {
      return plainText.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
    }
    MarkedString2.fromPlainText = fromPlainText;
    function is(value) {
      const candidate = value;
      return Is.string(candidate) || Is.objectLiteral(candidate) && Is.string(candidate.language) && Is.string(candidate.value);
    }
    MarkedString2.is = is;
  })(MarkedString || (MarkedString = {}));
  var Hover;
  (function(Hover2) {
    function is(value) {
      let candidate = value;
      return !!candidate && Is.objectLiteral(candidate) && (MarkupContent.is(candidate.contents) || MarkedString.is(candidate.contents) || Is.typedArray(candidate.contents, MarkedString.is)) && (value.range === void 0 || Range2.is(value.range));
    }
    Hover2.is = is;
  })(Hover || (Hover = {}));
  var ParameterInformation;
  (function(ParameterInformation2) {
    function create(label, documentation) {
      return documentation ? { label, documentation } : { label };
    }
    ParameterInformation2.create = create;
  })(ParameterInformation || (ParameterInformation = {}));
  var SignatureInformation;
  (function(SignatureInformation2) {
    function create(label, documentation, ...parameters) {
      let result = { label };
      if (Is.defined(documentation)) {
        result.documentation = documentation;
      }
      if (Is.defined(parameters)) {
        result.parameters = parameters;
      } else {
        result.parameters = [];
      }
      return result;
    }
    SignatureInformation2.create = create;
  })(SignatureInformation || (SignatureInformation = {}));
  var DocumentHighlightKind;
  (function(DocumentHighlightKind2) {
    DocumentHighlightKind2.Text = 1;
    DocumentHighlightKind2.Read = 2;
    DocumentHighlightKind2.Write = 3;
  })(DocumentHighlightKind || (DocumentHighlightKind = {}));
  var DocumentHighlight;
  (function(DocumentHighlight2) {
    function create(range, kind) {
      let result = { range };
      if (Is.number(kind)) {
        result.kind = kind;
      }
      return result;
    }
    DocumentHighlight2.create = create;
  })(DocumentHighlight || (DocumentHighlight = {}));
  var SymbolKind;
  (function(SymbolKind2) {
    SymbolKind2.File = 1;
    SymbolKind2.Module = 2;
    SymbolKind2.Namespace = 3;
    SymbolKind2.Package = 4;
    SymbolKind2.Class = 5;
    SymbolKind2.Method = 6;
    SymbolKind2.Property = 7;
    SymbolKind2.Field = 8;
    SymbolKind2.Constructor = 9;
    SymbolKind2.Enum = 10;
    SymbolKind2.Interface = 11;
    SymbolKind2.Function = 12;
    SymbolKind2.Variable = 13;
    SymbolKind2.Constant = 14;
    SymbolKind2.String = 15;
    SymbolKind2.Number = 16;
    SymbolKind2.Boolean = 17;
    SymbolKind2.Array = 18;
    SymbolKind2.Object = 19;
    SymbolKind2.Key = 20;
    SymbolKind2.Null = 21;
    SymbolKind2.EnumMember = 22;
    SymbolKind2.Struct = 23;
    SymbolKind2.Event = 24;
    SymbolKind2.Operator = 25;
    SymbolKind2.TypeParameter = 26;
  })(SymbolKind || (SymbolKind = {}));
  var SymbolTag;
  (function(SymbolTag2) {
    SymbolTag2.Deprecated = 1;
  })(SymbolTag || (SymbolTag = {}));
  var SymbolInformation;
  (function(SymbolInformation2) {
    function create(name, kind, range, uri, containerName) {
      let result = {
        name,
        kind,
        location: { uri, range }
      };
      if (containerName) {
        result.containerName = containerName;
      }
      return result;
    }
    SymbolInformation2.create = create;
  })(SymbolInformation || (SymbolInformation = {}));
  var WorkspaceSymbol;
  (function(WorkspaceSymbol2) {
    function create(name, kind, uri, range) {
      return range !== void 0 ? { name, kind, location: { uri, range } } : { name, kind, location: { uri } };
    }
    WorkspaceSymbol2.create = create;
  })(WorkspaceSymbol || (WorkspaceSymbol = {}));
  var DocumentSymbol;
  (function(DocumentSymbol2) {
    function create(name, detail, kind, range, selectionRange, children) {
      let result = {
        name,
        detail,
        kind,
        range,
        selectionRange
      };
      if (children !== void 0) {
        result.children = children;
      }
      return result;
    }
    DocumentSymbol2.create = create;
    function is(value) {
      let candidate = value;
      return candidate && Is.string(candidate.name) && Is.number(candidate.kind) && Range2.is(candidate.range) && Range2.is(candidate.selectionRange) && (candidate.detail === void 0 || Is.string(candidate.detail)) && (candidate.deprecated === void 0 || Is.boolean(candidate.deprecated)) && (candidate.children === void 0 || Array.isArray(candidate.children)) && (candidate.tags === void 0 || Array.isArray(candidate.tags));
    }
    DocumentSymbol2.is = is;
  })(DocumentSymbol || (DocumentSymbol = {}));
  var CodeActionKind;
  (function(CodeActionKind2) {
    CodeActionKind2.Empty = "";
    CodeActionKind2.QuickFix = "quickfix";
    CodeActionKind2.Refactor = "refactor";
    CodeActionKind2.RefactorExtract = "refactor.extract";
    CodeActionKind2.RefactorInline = "refactor.inline";
    CodeActionKind2.RefactorRewrite = "refactor.rewrite";
    CodeActionKind2.Source = "source";
    CodeActionKind2.SourceOrganizeImports = "source.organizeImports";
    CodeActionKind2.SourceFixAll = "source.fixAll";
  })(CodeActionKind || (CodeActionKind = {}));
  var CodeActionTriggerKind;
  (function(CodeActionTriggerKind2) {
    CodeActionTriggerKind2.Invoked = 1;
    CodeActionTriggerKind2.Automatic = 2;
  })(CodeActionTriggerKind || (CodeActionTriggerKind = {}));
  var CodeActionContext;
  (function(CodeActionContext2) {
    function create(diagnostics, only, triggerKind) {
      let result = { diagnostics };
      if (only !== void 0 && only !== null) {
        result.only = only;
      }
      if (triggerKind !== void 0 && triggerKind !== null) {
        result.triggerKind = triggerKind;
      }
      return result;
    }
    CodeActionContext2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Is.typedArray(candidate.diagnostics, Diagnostic.is) && (candidate.only === void 0 || Is.typedArray(candidate.only, Is.string)) && (candidate.triggerKind === void 0 || candidate.triggerKind === CodeActionTriggerKind.Invoked || candidate.triggerKind === CodeActionTriggerKind.Automatic);
    }
    CodeActionContext2.is = is;
  })(CodeActionContext || (CodeActionContext = {}));
  var CodeAction;
  (function(CodeAction2) {
    function create(title, kindOrCommandOrEdit, kind) {
      let result = { title };
      let checkKind = true;
      if (typeof kindOrCommandOrEdit === "string") {
        checkKind = false;
        result.kind = kindOrCommandOrEdit;
      } else if (Command.is(kindOrCommandOrEdit)) {
        result.command = kindOrCommandOrEdit;
      } else {
        result.edit = kindOrCommandOrEdit;
      }
      if (checkKind && kind !== void 0) {
        result.kind = kind;
      }
      return result;
    }
    CodeAction2.create = create;
    function is(value) {
      let candidate = value;
      return candidate && Is.string(candidate.title) && (candidate.diagnostics === void 0 || Is.typedArray(candidate.diagnostics, Diagnostic.is)) && (candidate.kind === void 0 || Is.string(candidate.kind)) && (candidate.edit !== void 0 || candidate.command !== void 0) && (candidate.command === void 0 || Command.is(candidate.command)) && (candidate.isPreferred === void 0 || Is.boolean(candidate.isPreferred)) && (candidate.edit === void 0 || WorkspaceEdit.is(candidate.edit));
    }
    CodeAction2.is = is;
  })(CodeAction || (CodeAction = {}));
  var CodeLens;
  (function(CodeLens2) {
    function create(range, data) {
      let result = { range };
      if (Is.defined(data)) {
        result.data = data;
      }
      return result;
    }
    CodeLens2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Range2.is(candidate.range) && (Is.undefined(candidate.command) || Command.is(candidate.command));
    }
    CodeLens2.is = is;
  })(CodeLens || (CodeLens = {}));
  var FormattingOptions;
  (function(FormattingOptions2) {
    function create(tabSize, insertSpaces) {
      return { tabSize, insertSpaces };
    }
    FormattingOptions2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Is.uinteger(candidate.tabSize) && Is.boolean(candidate.insertSpaces);
    }
    FormattingOptions2.is = is;
  })(FormattingOptions || (FormattingOptions = {}));
  var DocumentLink;
  (function(DocumentLink2) {
    function create(range, target, data) {
      return { range, target, data };
    }
    DocumentLink2.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Range2.is(candidate.range) && (Is.undefined(candidate.target) || Is.string(candidate.target));
    }
    DocumentLink2.is = is;
  })(DocumentLink || (DocumentLink = {}));
  var SelectionRange;
  (function(SelectionRange2) {
    function create(range, parent) {
      return { range, parent };
    }
    SelectionRange2.create = create;
    function is(value) {
      let candidate = value;
      return Is.objectLiteral(candidate) && Range2.is(candidate.range) && (candidate.parent === void 0 || SelectionRange2.is(candidate.parent));
    }
    SelectionRange2.is = is;
  })(SelectionRange || (SelectionRange = {}));
  var SemanticTokenTypes;
  (function(SemanticTokenTypes2) {
    SemanticTokenTypes2["namespace"] = "namespace";
    SemanticTokenTypes2["type"] = "type";
    SemanticTokenTypes2["class"] = "class";
    SemanticTokenTypes2["enum"] = "enum";
    SemanticTokenTypes2["interface"] = "interface";
    SemanticTokenTypes2["struct"] = "struct";
    SemanticTokenTypes2["typeParameter"] = "typeParameter";
    SemanticTokenTypes2["parameter"] = "parameter";
    SemanticTokenTypes2["variable"] = "variable";
    SemanticTokenTypes2["property"] = "property";
    SemanticTokenTypes2["enumMember"] = "enumMember";
    SemanticTokenTypes2["event"] = "event";
    SemanticTokenTypes2["function"] = "function";
    SemanticTokenTypes2["method"] = "method";
    SemanticTokenTypes2["macro"] = "macro";
    SemanticTokenTypes2["keyword"] = "keyword";
    SemanticTokenTypes2["modifier"] = "modifier";
    SemanticTokenTypes2["comment"] = "comment";
    SemanticTokenTypes2["string"] = "string";
    SemanticTokenTypes2["number"] = "number";
    SemanticTokenTypes2["regexp"] = "regexp";
    SemanticTokenTypes2["operator"] = "operator";
    SemanticTokenTypes2["decorator"] = "decorator";
  })(SemanticTokenTypes || (SemanticTokenTypes = {}));
  var SemanticTokenModifiers;
  (function(SemanticTokenModifiers2) {
    SemanticTokenModifiers2["declaration"] = "declaration";
    SemanticTokenModifiers2["definition"] = "definition";
    SemanticTokenModifiers2["readonly"] = "readonly";
    SemanticTokenModifiers2["static"] = "static";
    SemanticTokenModifiers2["deprecated"] = "deprecated";
    SemanticTokenModifiers2["abstract"] = "abstract";
    SemanticTokenModifiers2["async"] = "async";
    SemanticTokenModifiers2["modification"] = "modification";
    SemanticTokenModifiers2["documentation"] = "documentation";
    SemanticTokenModifiers2["defaultLibrary"] = "defaultLibrary";
  })(SemanticTokenModifiers || (SemanticTokenModifiers = {}));
  var SemanticTokens;
  (function(SemanticTokens2) {
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && (candidate.resultId === void 0 || typeof candidate.resultId === "string") && Array.isArray(candidate.data) && (candidate.data.length === 0 || typeof candidate.data[0] === "number");
    }
    SemanticTokens2.is = is;
  })(SemanticTokens || (SemanticTokens = {}));
  var InlineValueText;
  (function(InlineValueText2) {
    function create(range, text) {
      return { range, text };
    }
    InlineValueText2.create = create;
    function is(value) {
      const candidate = value;
      return candidate !== void 0 && candidate !== null && Range2.is(candidate.range) && Is.string(candidate.text);
    }
    InlineValueText2.is = is;
  })(InlineValueText || (InlineValueText = {}));
  var InlineValueVariableLookup;
  (function(InlineValueVariableLookup2) {
    function create(range, variableName, caseSensitiveLookup) {
      return { range, variableName, caseSensitiveLookup };
    }
    InlineValueVariableLookup2.create = create;
    function is(value) {
      const candidate = value;
      return candidate !== void 0 && candidate !== null && Range2.is(candidate.range) && Is.boolean(candidate.caseSensitiveLookup) && (Is.string(candidate.variableName) || candidate.variableName === void 0);
    }
    InlineValueVariableLookup2.is = is;
  })(InlineValueVariableLookup || (InlineValueVariableLookup = {}));
  var InlineValueEvaluatableExpression;
  (function(InlineValueEvaluatableExpression2) {
    function create(range, expression) {
      return { range, expression };
    }
    InlineValueEvaluatableExpression2.create = create;
    function is(value) {
      const candidate = value;
      return candidate !== void 0 && candidate !== null && Range2.is(candidate.range) && (Is.string(candidate.expression) || candidate.expression === void 0);
    }
    InlineValueEvaluatableExpression2.is = is;
  })(InlineValueEvaluatableExpression || (InlineValueEvaluatableExpression = {}));
  var InlineValueContext;
  (function(InlineValueContext2) {
    function create(frameId, stoppedLocation) {
      return { frameId, stoppedLocation };
    }
    InlineValueContext2.create = create;
    function is(value) {
      const candidate = value;
      return Is.defined(candidate) && Range2.is(value.stoppedLocation);
    }
    InlineValueContext2.is = is;
  })(InlineValueContext || (InlineValueContext = {}));
  var InlayHintKind;
  (function(InlayHintKind2) {
    InlayHintKind2.Type = 1;
    InlayHintKind2.Parameter = 2;
    function is(value) {
      return value === 1 || value === 2;
    }
    InlayHintKind2.is = is;
  })(InlayHintKind || (InlayHintKind = {}));
  var InlayHintLabelPart;
  (function(InlayHintLabelPart2) {
    function create(value) {
      return { value };
    }
    InlayHintLabelPart2.create = create;
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && (candidate.tooltip === void 0 || Is.string(candidate.tooltip) || MarkupContent.is(candidate.tooltip)) && (candidate.location === void 0 || Location.is(candidate.location)) && (candidate.command === void 0 || Command.is(candidate.command));
    }
    InlayHintLabelPart2.is = is;
  })(InlayHintLabelPart || (InlayHintLabelPart = {}));
  var InlayHint;
  (function(InlayHint2) {
    function create(position, label, kind) {
      const result = { position, label };
      if (kind !== void 0) {
        result.kind = kind;
      }
      return result;
    }
    InlayHint2.create = create;
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && Position.is(candidate.position) && (Is.string(candidate.label) || Is.typedArray(candidate.label, InlayHintLabelPart.is)) && (candidate.kind === void 0 || InlayHintKind.is(candidate.kind)) && candidate.textEdits === void 0 || Is.typedArray(candidate.textEdits, TextEdit.is) && (candidate.tooltip === void 0 || Is.string(candidate.tooltip) || MarkupContent.is(candidate.tooltip)) && (candidate.paddingLeft === void 0 || Is.boolean(candidate.paddingLeft)) && (candidate.paddingRight === void 0 || Is.boolean(candidate.paddingRight));
    }
    InlayHint2.is = is;
  })(InlayHint || (InlayHint = {}));
  var StringValue;
  (function(StringValue2) {
    function createSnippet(value) {
      return { kind: "snippet", value };
    }
    StringValue2.createSnippet = createSnippet;
  })(StringValue || (StringValue = {}));
  var InlineCompletionItem;
  (function(InlineCompletionItem2) {
    function create(insertText, filterText, range, command) {
      return { insertText, filterText, range, command };
    }
    InlineCompletionItem2.create = create;
  })(InlineCompletionItem || (InlineCompletionItem = {}));
  var InlineCompletionList;
  (function(InlineCompletionList2) {
    function create(items) {
      return { items };
    }
    InlineCompletionList2.create = create;
  })(InlineCompletionList || (InlineCompletionList = {}));
  var InlineCompletionTriggerKind;
  (function(InlineCompletionTriggerKind2) {
    InlineCompletionTriggerKind2.Invoked = 0;
    InlineCompletionTriggerKind2.Automatic = 1;
  })(InlineCompletionTriggerKind || (InlineCompletionTriggerKind = {}));
  var SelectedCompletionInfo;
  (function(SelectedCompletionInfo2) {
    function create(range, text) {
      return { range, text };
    }
    SelectedCompletionInfo2.create = create;
  })(SelectedCompletionInfo || (SelectedCompletionInfo = {}));
  var InlineCompletionContext;
  (function(InlineCompletionContext2) {
    function create(triggerKind, selectedCompletionInfo) {
      return { triggerKind, selectedCompletionInfo };
    }
    InlineCompletionContext2.create = create;
  })(InlineCompletionContext || (InlineCompletionContext = {}));
  var WorkspaceFolder;
  (function(WorkspaceFolder2) {
    function is(value) {
      const candidate = value;
      return Is.objectLiteral(candidate) && URI.is(candidate.uri) && Is.string(candidate.name);
    }
    WorkspaceFolder2.is = is;
  })(WorkspaceFolder || (WorkspaceFolder = {}));
  var TextDocument;
  (function(TextDocument3) {
    function create(uri, languageId, version, content) {
      return new FullTextDocument(uri, languageId, version, content);
    }
    TextDocument3.create = create;
    function is(value) {
      let candidate = value;
      return Is.defined(candidate) && Is.string(candidate.uri) && (Is.undefined(candidate.languageId) || Is.string(candidate.languageId)) && Is.uinteger(candidate.lineCount) && Is.func(candidate.getText) && Is.func(candidate.positionAt) && Is.func(candidate.offsetAt) ? true : false;
    }
    TextDocument3.is = is;
    function applyEdits(document, edits) {
      let text = document.getText();
      let sortedEdits = mergeSort2(edits, (a, b) => {
        let diff = a.range.start.line - b.range.start.line;
        if (diff === 0) {
          return a.range.start.character - b.range.start.character;
        }
        return diff;
      });
      let lastModifiedOffset = text.length;
      for (let i = sortedEdits.length - 1; i >= 0; i--) {
        let e = sortedEdits[i];
        let startOffset = document.offsetAt(e.range.start);
        let endOffset = document.offsetAt(e.range.end);
        if (endOffset <= lastModifiedOffset) {
          text = text.substring(0, startOffset) + e.newText + text.substring(endOffset, text.length);
        } else {
          throw new Error("Overlapping edit");
        }
        lastModifiedOffset = startOffset;
      }
      return text;
    }
    TextDocument3.applyEdits = applyEdits;
    function mergeSort2(data, compare) {
      if (data.length <= 1) {
        return data;
      }
      const p = data.length / 2 | 0;
      const left = data.slice(0, p);
      const right = data.slice(p);
      mergeSort2(left, compare);
      mergeSort2(right, compare);
      let leftIdx = 0;
      let rightIdx = 0;
      let i = 0;
      while (leftIdx < left.length && rightIdx < right.length) {
        let ret = compare(left[leftIdx], right[rightIdx]);
        if (ret <= 0) {
          data[i++] = left[leftIdx++];
        } else {
          data[i++] = right[rightIdx++];
        }
      }
      while (leftIdx < left.length) {
        data[i++] = left[leftIdx++];
      }
      while (rightIdx < right.length) {
        data[i++] = right[rightIdx++];
      }
      return data;
    }
  })(TextDocument || (TextDocument = {}));
  var FullTextDocument = class {
    constructor(uri, languageId, version, content) {
      this._uri = uri;
      this._languageId = languageId;
      this._version = version;
      this._content = content;
      this._lineOffsets = void 0;
    }
    get uri() {
      return this._uri;
    }
    get languageId() {
      return this._languageId;
    }
    get version() {
      return this._version;
    }
    getText(range) {
      if (range) {
        let start = this.offsetAt(range.start);
        let end = this.offsetAt(range.end);
        return this._content.substring(start, end);
      }
      return this._content;
    }
    update(event, version) {
      this._content = event.text;
      this._version = version;
      this._lineOffsets = void 0;
    }
    getLineOffsets() {
      if (this._lineOffsets === void 0) {
        let lineOffsets = [];
        let text = this._content;
        let isLineStart = true;
        for (let i = 0; i < text.length; i++) {
          if (isLineStart) {
            lineOffsets.push(i);
            isLineStart = false;
          }
          let ch = text.charAt(i);
          isLineStart = ch === "\r" || ch === "\n";
          if (ch === "\r" && i + 1 < text.length && text.charAt(i + 1) === "\n") {
            i++;
          }
        }
        if (isLineStart && text.length > 0) {
          lineOffsets.push(text.length);
        }
        this._lineOffsets = lineOffsets;
      }
      return this._lineOffsets;
    }
    positionAt(offset) {
      offset = Math.max(Math.min(offset, this._content.length), 0);
      let lineOffsets = this.getLineOffsets();
      let low = 0, high = lineOffsets.length;
      if (high === 0) {
        return Position.create(0, offset);
      }
      while (low < high) {
        let mid = Math.floor((low + high) / 2);
        if (lineOffsets[mid] > offset) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }
      let line = low - 1;
      return Position.create(line, offset - lineOffsets[line]);
    }
    offsetAt(position) {
      let lineOffsets = this.getLineOffsets();
      if (position.line >= lineOffsets.length) {
        return this._content.length;
      } else if (position.line < 0) {
        return 0;
      }
      let lineOffset = lineOffsets[position.line];
      let nextLineOffset = position.line + 1 < lineOffsets.length ? lineOffsets[position.line + 1] : this._content.length;
      return Math.max(Math.min(lineOffset + position.character, nextLineOffset), lineOffset);
    }
    get lineCount() {
      return this.getLineOffsets().length;
    }
  };
  var Is;
  (function(Is2) {
    const toString = Object.prototype.toString;
    function defined(value) {
      return typeof value !== "undefined";
    }
    Is2.defined = defined;
    function undefined2(value) {
      return typeof value === "undefined";
    }
    Is2.undefined = undefined2;
    function boolean(value) {
      return value === true || value === false;
    }
    Is2.boolean = boolean;
    function string(value) {
      return toString.call(value) === "[object String]";
    }
    Is2.string = string;
    function number(value) {
      return toString.call(value) === "[object Number]";
    }
    Is2.number = number;
    function numberRange(value, min, max) {
      return toString.call(value) === "[object Number]" && min <= value && value <= max;
    }
    Is2.numberRange = numberRange;
    function integer2(value) {
      return toString.call(value) === "[object Number]" && -2147483648 <= value && value <= 2147483647;
    }
    Is2.integer = integer2;
    function uinteger2(value) {
      return toString.call(value) === "[object Number]" && 0 <= value && value <= 2147483647;
    }
    Is2.uinteger = uinteger2;
    function func(value) {
      return toString.call(value) === "[object Function]";
    }
    Is2.func = func;
    function objectLiteral(value) {
      return value !== null && typeof value === "object";
    }
    Is2.objectLiteral = objectLiteral;
    function typedArray(value, check) {
      return Array.isArray(value) && value.every(check);
    }
    Is2.typedArray = typedArray;
  })(Is || (Is = {}));

  // ../../node_modules/vscode-languageserver-textdocument/lib/esm/main.js
  var FullTextDocument2 = class _FullTextDocument {
    constructor(uri, languageId, version, content) {
      this._uri = uri;
      this._languageId = languageId;
      this._version = version;
      this._content = content;
      this._lineOffsets = void 0;
    }
    get uri() {
      return this._uri;
    }
    get languageId() {
      return this._languageId;
    }
    get version() {
      return this._version;
    }
    getText(range) {
      if (range) {
        const start = this.offsetAt(range.start);
        const end = this.offsetAt(range.end);
        return this._content.substring(start, end);
      }
      return this._content;
    }
    update(changes, version) {
      for (const change of changes) {
        if (_FullTextDocument.isIncremental(change)) {
          const range = getWellformedRange(change.range);
          const startOffset = this.offsetAt(range.start);
          const endOffset = this.offsetAt(range.end);
          this._content = this._content.substring(0, startOffset) + change.text + this._content.substring(endOffset, this._content.length);
          const startLine = Math.max(range.start.line, 0);
          const endLine = Math.max(range.end.line, 0);
          let lineOffsets = this._lineOffsets;
          const addedLineOffsets = computeLineOffsets2(change.text, false, startOffset);
          if (endLine - startLine === addedLineOffsets.length) {
            for (let i = 0, len = addedLineOffsets.length; i < len; i++) {
              lineOffsets[i + startLine + 1] = addedLineOffsets[i];
            }
          } else {
            if (addedLineOffsets.length < 1e4) {
              lineOffsets.splice(startLine + 1, endLine - startLine, ...addedLineOffsets);
            } else {
              this._lineOffsets = lineOffsets = lineOffsets.slice(0, startLine + 1).concat(addedLineOffsets, lineOffsets.slice(endLine + 1));
            }
          }
          const diff = change.text.length - (endOffset - startOffset);
          if (diff !== 0) {
            for (let i = startLine + 1 + addedLineOffsets.length, len = lineOffsets.length; i < len; i++) {
              lineOffsets[i] = lineOffsets[i] + diff;
            }
          }
        } else if (_FullTextDocument.isFull(change)) {
          this._content = change.text;
          this._lineOffsets = void 0;
        } else {
          throw new Error("Unknown change event received");
        }
      }
      this._version = version;
    }
    getLineOffsets() {
      if (this._lineOffsets === void 0) {
        this._lineOffsets = computeLineOffsets2(this._content, true);
      }
      return this._lineOffsets;
    }
    positionAt(offset) {
      offset = Math.max(Math.min(offset, this._content.length), 0);
      const lineOffsets = this.getLineOffsets();
      let low = 0, high = lineOffsets.length;
      if (high === 0) {
        return { line: 0, character: offset };
      }
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (lineOffsets[mid] > offset) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }
      const line = low - 1;
      offset = this.ensureBeforeEOL(offset, lineOffsets[line]);
      return { line, character: offset - lineOffsets[line] };
    }
    offsetAt(position) {
      const lineOffsets = this.getLineOffsets();
      if (position.line >= lineOffsets.length) {
        return this._content.length;
      } else if (position.line < 0) {
        return 0;
      }
      const lineOffset = lineOffsets[position.line];
      if (position.character <= 0) {
        return lineOffset;
      }
      const nextLineOffset = position.line + 1 < lineOffsets.length ? lineOffsets[position.line + 1] : this._content.length;
      const offset = Math.min(lineOffset + position.character, nextLineOffset);
      return this.ensureBeforeEOL(offset, lineOffset);
    }
    ensureBeforeEOL(offset, lineOffset) {
      while (offset > lineOffset && isEOL2(this._content.charCodeAt(offset - 1))) {
        offset--;
      }
      return offset;
    }
    get lineCount() {
      return this.getLineOffsets().length;
    }
    static isIncremental(event) {
      const candidate = event;
      return candidate !== void 0 && candidate !== null && typeof candidate.text === "string" && candidate.range !== void 0 && (candidate.rangeLength === void 0 || typeof candidate.rangeLength === "number");
    }
    static isFull(event) {
      const candidate = event;
      return candidate !== void 0 && candidate !== null && typeof candidate.text === "string" && candidate.range === void 0 && candidate.rangeLength === void 0;
    }
  };
  var TextDocument2;
  (function(TextDocument3) {
    function create(uri, languageId, version, content) {
      return new FullTextDocument2(uri, languageId, version, content);
    }
    TextDocument3.create = create;
    function update(document, changes, version) {
      if (document instanceof FullTextDocument2) {
        document.update(changes, version);
        return document;
      } else {
        throw new Error("TextDocument.update: document must be created by TextDocument.create");
      }
    }
    TextDocument3.update = update;
    function applyEdits(document, edits) {
      const text = document.getText();
      const sortedEdits = mergeSort(edits.map(getWellformedEdit), (a, b) => {
        const diff = a.range.start.line - b.range.start.line;
        if (diff === 0) {
          return a.range.start.character - b.range.start.character;
        }
        return diff;
      });
      let lastModifiedOffset = 0;
      const spans = [];
      for (const e of sortedEdits) {
        const startOffset = document.offsetAt(e.range.start);
        if (startOffset < lastModifiedOffset) {
          throw new Error("Overlapping edit");
        } else if (startOffset > lastModifiedOffset) {
          spans.push(text.substring(lastModifiedOffset, startOffset));
        }
        if (e.newText.length) {
          spans.push(e.newText);
        }
        lastModifiedOffset = document.offsetAt(e.range.end);
      }
      spans.push(text.substr(lastModifiedOffset));
      return spans.join("");
    }
    TextDocument3.applyEdits = applyEdits;
  })(TextDocument2 || (TextDocument2 = {}));
  function mergeSort(data, compare) {
    if (data.length <= 1) {
      return data;
    }
    const p = data.length / 2 | 0;
    const left = data.slice(0, p);
    const right = data.slice(p);
    mergeSort(left, compare);
    mergeSort(right, compare);
    let leftIdx = 0;
    let rightIdx = 0;
    let i = 0;
    while (leftIdx < left.length && rightIdx < right.length) {
      const ret = compare(left[leftIdx], right[rightIdx]);
      if (ret <= 0) {
        data[i++] = left[leftIdx++];
      } else {
        data[i++] = right[rightIdx++];
      }
    }
    while (leftIdx < left.length) {
      data[i++] = left[leftIdx++];
    }
    while (rightIdx < right.length) {
      data[i++] = right[rightIdx++];
    }
    return data;
  }
  function computeLineOffsets2(text, isAtLineStart, textOffset = 0) {
    const result = isAtLineStart ? [textOffset] : [];
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (isEOL2(ch)) {
        if (ch === 13 && i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
          i++;
        }
        result.push(textOffset + i + 1);
      }
    }
    return result;
  }
  function isEOL2(char) {
    return char === 13 || char === 10;
  }
  function getWellformedRange(range) {
    const start = range.start;
    const end = range.end;
    if (start.line > end.line || start.line === end.line && start.character > end.character) {
      return { start: end, end: start };
    }
    return range;
  }
  function getWellformedEdit(textEdit) {
    const range = getWellformedRange(textEdit.range);
    if (range !== textEdit.range) {
      return { newText: textEdit.newText, range };
    }
    return textEdit;
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/cssLanguageTypes.js
  var ClientCapabilities;
  (function(ClientCapabilities2) {
    ClientCapabilities2.LATEST = {
      textDocument: {
        completion: {
          completionItem: {
            documentationFormat: [MarkupKind.Markdown, MarkupKind.PlainText]
          }
        },
        hover: {
          contentFormat: [MarkupKind.Markdown, MarkupKind.PlainText]
        }
      }
    };
  })(ClientCapabilities || (ClientCapabilities = {}));
  var FileType;
  (function(FileType2) {
    FileType2[FileType2["Unknown"] = 0] = "Unknown";
    FileType2[FileType2["File"] = 1] = "File";
    FileType2[FileType2["Directory"] = 2] = "Directory";
    FileType2[FileType2["SymbolicLink"] = 64] = "SymbolicLink";
  })(FileType || (FileType = {}));

  // ../../node_modules/vscode-css-languageservice/lib/esm/languageFacts/entry.js
  var missingBaselineBrowserFormatter = new Intl.ListFormat("en", {
    style: "long",
    type: "disjunction"
  });

  // ../../node_modules/vscode-css-languageservice/lib/esm/languageFacts/colors.js
  var colorFunctions = [
    {
      label: "rgb",
      func: "rgb($red, $green, $blue)",
      insertText: "rgb(${1:red}, ${2:green}, ${3:blue})",
      desc: t("Creates a Color from red, green, and blue values.")
    },
    {
      label: "rgba",
      func: "rgba($red, $green, $blue, $alpha)",
      insertText: "rgba(${1:red}, ${2:green}, ${3:blue}, ${4:alpha})",
      desc: t("Creates a Color from red, green, blue, and alpha values.")
    },
    {
      label: "rgb relative",
      func: "rgb(from $color $red $green $blue)",
      insertText: "rgb(from ${1:color} ${2:r} ${3:g} ${4:b})",
      desc: t("Creates a Color from the red, green, and blue values of another Color.")
    },
    {
      label: "hsl",
      func: "hsl($hue, $saturation, $lightness)",
      insertText: "hsl(${1:hue}, ${2:saturation}, ${3:lightness})",
      desc: t("Creates a Color from hue, saturation, and lightness values.")
    },
    {
      label: "hsla",
      func: "hsla($hue, $saturation, $lightness, $alpha)",
      insertText: "hsla(${1:hue}, ${2:saturation}, ${3:lightness}, ${4:alpha})",
      desc: t("Creates a Color from hue, saturation, lightness, and alpha values.")
    },
    {
      label: "hsl relative",
      func: "hsl(from $color $hue $saturation $lightness)",
      insertText: "hsl(from ${1:color} ${2:h} ${3:s} ${4:l})",
      desc: t("Creates a Color from the hue, saturation, and lightness values of another Color.")
    },
    {
      label: "hwb",
      func: "hwb($hue $white $black)",
      insertText: "hwb(${1:hue} ${2:white} ${3:black})",
      desc: t("Creates a Color from hue, white, and black values.")
    },
    {
      label: "hwb relative",
      func: "hwb(from $color $hue $white $black)",
      insertText: "hwb(from ${1:color} ${2:h} ${3:w} ${4:b})",
      desc: t("Creates a Color from the hue, white, and black values of another Color.")
    },
    {
      label: "lab",
      func: "lab($lightness $a $b)",
      insertText: "lab(${1:lightness} ${2:a} ${3:b})",
      desc: t("Creates a Color from lightness, a, and b values.")
    },
    {
      label: "lab relative",
      func: "lab(from $color $lightness $a $b)",
      insertText: "lab(from ${1:color} ${2:l} ${3:a} ${4:b})",
      desc: t("Creates a Color from the lightness, a, and b values of another Color.")
    },
    {
      label: "oklab",
      func: "oklab($lightness $a $b)",
      insertText: "oklab(${1:lightness} ${2:a} ${3:b})",
      desc: t("Creates a Color from lightness, a, and b values.")
    },
    {
      label: "oklab relative",
      func: "oklab(from $color $lightness $a $b)",
      insertText: "oklab(from ${1:color} ${2:l} ${3:a} ${4:b})",
      desc: t("Creates a Color from the lightness, a, and b values of another Color.")
    },
    {
      label: "lch",
      func: "lch($lightness $chroma $hue)",
      insertText: "lch(${1:lightness} ${2:chroma} ${3:hue})",
      desc: t("Creates a Color from lightness, chroma, and hue values.")
    },
    {
      label: "lch relative",
      func: "lch(from $color $lightness $chroma $hue)",
      insertText: "lch(from ${1:color} ${2:l} ${3:c} ${4:h})",
      desc: t("Creates a Color from the lightness, chroma, and hue values of another Color.")
    },
    {
      label: "oklch",
      func: "oklch($lightness $chroma $hue)",
      insertText: "oklch(${1:lightness} ${2:chroma} ${3:hue})",
      desc: t("Creates a Color from lightness, chroma, and hue values.")
    },
    {
      label: "oklch relative",
      func: "oklch(from $color $lightness $chroma $hue)",
      insertText: "oklch(from ${1:color} ${2:l} ${3:c} ${4:h})",
      desc: t("Creates a Color from the lightness, chroma, and hue values of another Color.")
    },
    {
      label: "color",
      func: "color($color-space $red $green $blue)",
      insertText: "color(${1|srgb,srgb-linear,display-p3,a98-rgb,prophoto-rgb,rec2020,xyx,xyz-d50,xyz-d65|} ${2:red} ${3:green} ${4:blue})",
      desc: t("Creates a Color in a specific color space from red, green, and blue values.")
    },
    {
      label: "color relative",
      func: "color(from $color $color-space $red $green $blue)",
      insertText: "color(from ${1:color} ${2|srgb,srgb-linear,display-p3,a98-rgb,prophoto-rgb,rec2020,xyx,xyz-d50,xyz-d65|} ${3:r} ${4:g} ${5:b})",
      desc: t("Creates a Color in a specific color space from the red, green, and blue values of another Color.")
    },
    {
      label: "color-mix",
      func: "color-mix(in $color-space, $color $percentage, $color $percentage)",
      insertText: "color-mix(in ${1|srgb,srgb-linear,lab,oklab,xyz,xyz-d50,xyz-d65|}, ${3:color} ${4:percentage}, ${5:color} ${6:percentage})",
      desc: t("Mix two colors together in a rectangular color space.")
    },
    {
      label: "color-mix hue",
      func: "color-mix(in $color-space $interpolation-method hue, $color $percentage, $color $percentage)",
      insertText: "color-mix(in ${1|hsl,hwb,lch,oklch|} ${2|shorter hue,longer hue,increasing hue,decreasing hue|}, ${3:color} ${4:percentage}, ${5:color} ${6:percentage})",
      desc: t("Mix two colors together in a polar color space.")
    },
    {
      label: "lab",
      func: "lab($lightness $channel_a $channel_b $alpha)",
      insertText: "lab(${1:lightness} ${2:a} ${3:b} ${4:alpha})",
      desc: t("css.builtin.lab", "Creates a Color from Lightness, Channel a, Channel b and alpha values.")
    },
    {
      label: "lab relative",
      func: "lab(from $color $lightness $channel_a $channel_b $alpha)",
      insertText: "lab(from ${1:color} ${2:lightness} ${3:channel_a} ${4:channel_b} ${5:alpha})",
      desc: t("css.builtin.lab", "Creates a Color from Lightness, Channel a, Channel b and alpha values of another Color.")
    },
    {
      label: "lch",
      func: "lch($lightness $chrome $hue $alpha)",
      insertText: "lch(${1:lightness} ${2:chrome} ${3:hue} ${4:alpha})",
      desc: t("css.builtin.lab", "Creates a Color from Lightness, Chroma, Hue and alpha values.")
    },
    {
      label: "lch relative",
      func: "lch(from $color $lightness $chrome $hue $alpha)",
      insertText: "lch(from ${1:color} ${2:lightness} ${3:chrome} ${4:hue} ${5:alpha})",
      desc: t("css.builtin.lab", "Creates a Color from Lightness, Chroma, Hue and alpha values of another Color.")
    }
  ];
  var colors = {
    aliceblue: "#f0f8ff",
    antiquewhite: "#faebd7",
    aqua: "#00ffff",
    aquamarine: "#7fffd4",
    azure: "#f0ffff",
    beige: "#f5f5dc",
    bisque: "#ffe4c4",
    black: "#000000",
    blanchedalmond: "#ffebcd",
    blue: "#0000ff",
    blueviolet: "#8a2be2",
    brown: "#a52a2a",
    burlywood: "#deb887",
    cadetblue: "#5f9ea0",
    chartreuse: "#7fff00",
    chocolate: "#d2691e",
    coral: "#ff7f50",
    cornflowerblue: "#6495ed",
    cornsilk: "#fff8dc",
    crimson: "#dc143c",
    cyan: "#00ffff",
    darkblue: "#00008b",
    darkcyan: "#008b8b",
    darkgoldenrod: "#b8860b",
    darkgray: "#a9a9a9",
    darkgrey: "#a9a9a9",
    darkgreen: "#006400",
    darkkhaki: "#bdb76b",
    darkmagenta: "#8b008b",
    darkolivegreen: "#556b2f",
    darkorange: "#ff8c00",
    darkorchid: "#9932cc",
    darkred: "#8b0000",
    darksalmon: "#e9967a",
    darkseagreen: "#8fbc8f",
    darkslateblue: "#483d8b",
    darkslategray: "#2f4f4f",
    darkslategrey: "#2f4f4f",
    darkturquoise: "#00ced1",
    darkviolet: "#9400d3",
    deeppink: "#ff1493",
    deepskyblue: "#00bfff",
    dimgray: "#696969",
    dimgrey: "#696969",
    dodgerblue: "#1e90ff",
    firebrick: "#b22222",
    floralwhite: "#fffaf0",
    forestgreen: "#228b22",
    fuchsia: "#ff00ff",
    gainsboro: "#dcdcdc",
    ghostwhite: "#f8f8ff",
    gold: "#ffd700",
    goldenrod: "#daa520",
    gray: "#808080",
    grey: "#808080",
    green: "#008000",
    greenyellow: "#adff2f",
    honeydew: "#f0fff0",
    hotpink: "#ff69b4",
    indianred: "#cd5c5c",
    indigo: "#4b0082",
    ivory: "#fffff0",
    khaki: "#f0e68c",
    lavender: "#e6e6fa",
    lavenderblush: "#fff0f5",
    lawngreen: "#7cfc00",
    lemonchiffon: "#fffacd",
    lightblue: "#add8e6",
    lightcoral: "#f08080",
    lightcyan: "#e0ffff",
    lightgoldenrodyellow: "#fafad2",
    lightgray: "#d3d3d3",
    lightgrey: "#d3d3d3",
    lightgreen: "#90ee90",
    lightpink: "#ffb6c1",
    lightsalmon: "#ffa07a",
    lightseagreen: "#20b2aa",
    lightskyblue: "#87cefa",
    lightslategray: "#778899",
    lightslategrey: "#778899",
    lightsteelblue: "#b0c4de",
    lightyellow: "#ffffe0",
    lime: "#00ff00",
    limegreen: "#32cd32",
    linen: "#faf0e6",
    magenta: "#ff00ff",
    maroon: "#800000",
    mediumaquamarine: "#66cdaa",
    mediumblue: "#0000cd",
    mediumorchid: "#ba55d3",
    mediumpurple: "#9370d8",
    mediumseagreen: "#3cb371",
    mediumslateblue: "#7b68ee",
    mediumspringgreen: "#00fa9a",
    mediumturquoise: "#48d1cc",
    mediumvioletred: "#c71585",
    midnightblue: "#191970",
    mintcream: "#f5fffa",
    mistyrose: "#ffe4e1",
    moccasin: "#ffe4b5",
    navajowhite: "#ffdead",
    navy: "#000080",
    oldlace: "#fdf5e6",
    olive: "#808000",
    olivedrab: "#6b8e23",
    orange: "#ffa500",
    orangered: "#ff4500",
    orchid: "#da70d6",
    palegoldenrod: "#eee8aa",
    palegreen: "#98fb98",
    paleturquoise: "#afeeee",
    palevioletred: "#d87093",
    papayawhip: "#ffefd5",
    peachpuff: "#ffdab9",
    peru: "#cd853f",
    pink: "#ffc0cb",
    plum: "#dda0dd",
    powderblue: "#b0e0e6",
    purple: "#800080",
    red: "#ff0000",
    rebeccapurple: "#663399",
    rosybrown: "#bc8f8f",
    royalblue: "#4169e1",
    saddlebrown: "#8b4513",
    salmon: "#fa8072",
    sandybrown: "#f4a460",
    seagreen: "#2e8b57",
    seashell: "#fff5ee",
    sienna: "#a0522d",
    silver: "#c0c0c0",
    skyblue: "#87ceeb",
    slateblue: "#6a5acd",
    slategray: "#708090",
    slategrey: "#708090",
    snow: "#fffafa",
    springgreen: "#00ff7f",
    steelblue: "#4682b4",
    tan: "#d2b48c",
    teal: "#008080",
    thistle: "#d8bfd8",
    tomato: "#ff6347",
    turquoise: "#40e0d0",
    violet: "#ee82ee",
    wheat: "#f5deb3",
    white: "#ffffff",
    whitesmoke: "#f5f5f5",
    yellow: "#ffff00",
    yellowgreen: "#9acd32"
  };
  var colorsRegExp = new RegExp(`^(${Object.keys(colors).join("|")})$`, "i");
  var colorKeywords = {
    "currentColor": "The value of the 'color' property. The computed value of the 'currentColor' keyword is the computed value of the 'color' property. If the 'currentColor' keyword is set on the 'color' property itself, it is treated as 'color:inherit' at parse time.",
    "transparent": "Fully transparent. This keyword can be considered a shorthand for rgba(0,0,0,0) which is its computed value."
  };
  var colorKeywordsRegExp = new RegExp(`^(${Object.keys(colorKeywords).join("|")})$`, "i");
  var DEGREES_PER_CIRCLE = 360;
  var RADIANS_TO_DEGREES_FACTOR = DEGREES_PER_CIRCLE / 2 / Math.PI;
  var DEGREES_TO_RADIANS_FACTOR = Math.PI / 180;

  // ../../node_modules/vscode-css-languageservice/lib/esm/languageFacts/builtinData.js
  var units = {
    "length": ["cap", "ch", "cm", "cqb", "cqh", "cqi", "cqmax", "cqmin", "cqw", "dvb", "dvh", "dvi", "dvw", "em", "ex", "ic", "in", "lh", "lvb", "lvh", "lvi", "lvw", "mm", "pc", "pt", "px", "q", "rcap", "rch", "rem", "rex", "ric", "rlh", "svb", "svh", "svi", "svw", "vb", "vh", "vi", "vmax", "vmin", "vw"],
    "angle": ["deg", "rad", "grad", "turn"],
    "time": ["ms", "s"],
    "frequency": ["Hz", "kHz"],
    "resolution": ["dpi", "dpcm", "dppx"],
    "percentage": ["%", "fr"]
  };
  var pageBoxDirectives = [
    "@bottom-center",
    "@bottom-left",
    "@bottom-left-corner",
    "@bottom-right",
    "@bottom-right-corner",
    "@left-bottom",
    "@left-middle",
    "@left-top",
    "@right-bottom",
    "@right-middle",
    "@right-top",
    "@top-center",
    "@top-left",
    "@top-left-corner",
    "@top-right",
    "@top-right-corner"
  ];

  // ../../node_modules/vscode-css-languageservice/lib/esm/utils/objects.js
  function values(obj) {
    return Object.keys(obj).map((key) => obj[key]);
  }
  function isDefined(obj) {
    return typeof obj !== "undefined";
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/cssParser.js
  var Parser = class {
    constructor(scnr = new Scanner()) {
      this.keyframeRegex = /^@(\-(webkit|ms|moz|o)\-)?keyframes$/i;
      this.scanner = scnr;
      this.token = { type: TokenType.EOF, offset: -1, len: 0, text: "" };
      this.prevToken = void 0;
    }
    peekIdent(text) {
      return TokenType.Ident === this.token.type && text.length === this.token.text.length && text === this.token.text.toLowerCase();
    }
    peekKeyword(text) {
      return TokenType.AtKeyword === this.token.type && text.length === this.token.text.length && text === this.token.text.toLowerCase();
    }
    peekDelim(text) {
      return TokenType.Delim === this.token.type && text === this.token.text;
    }
    peek(type) {
      return type === this.token.type;
    }
    peekOne(...types) {
      return types.indexOf(this.token.type) !== -1;
    }
    peekRegExp(type, regEx) {
      if (type !== this.token.type) {
        return false;
      }
      return regEx.test(this.token.text);
    }
    hasWhitespace() {
      return !!this.prevToken && this.prevToken.offset + this.prevToken.len !== this.token.offset;
    }
    consumeToken() {
      this.prevToken = this.token;
      this.token = this.scanner.scan();
    }
    acceptUnicodeRange() {
      const token = this.scanner.tryScanUnicode();
      if (token) {
        this.prevToken = token;
        this.token = this.scanner.scan();
        return true;
      }
      return false;
    }
    mark() {
      return {
        prev: this.prevToken,
        curr: this.token,
        pos: this.scanner.pos()
      };
    }
    restoreAtMark(mark) {
      this.prevToken = mark.prev;
      this.token = mark.curr;
      this.scanner.goBackTo(mark.pos);
    }
    try(func) {
      const pos = this.mark();
      const node = func();
      if (!node) {
        this.restoreAtMark(pos);
        return null;
      }
      return node;
    }
    acceptOneKeyword(keywords) {
      if (TokenType.AtKeyword === this.token.type) {
        for (const keyword of keywords) {
          if (keyword.length === this.token.text.length && keyword === this.token.text.toLowerCase()) {
            this.consumeToken();
            return true;
          }
        }
      }
      return false;
    }
    accept(type) {
      if (type === this.token.type) {
        this.consumeToken();
        return true;
      }
      return false;
    }
    acceptIdent(text) {
      if (this.peekIdent(text)) {
        this.consumeToken();
        return true;
      }
      return false;
    }
    acceptKeyword(text) {
      if (this.peekKeyword(text)) {
        this.consumeToken();
        return true;
      }
      return false;
    }
    acceptDelim(text) {
      if (this.peekDelim(text)) {
        this.consumeToken();
        return true;
      }
      return false;
    }
    acceptRegexp(regEx) {
      if (regEx.test(this.token.text)) {
        this.consumeToken();
        return true;
      }
      return false;
    }
    _parseRegexp(regEx) {
      let node = this.createNode(NodeType.Identifier);
      do {
      } while (this.acceptRegexp(regEx));
      return this.finish(node);
    }
    acceptUnquotedString() {
      const pos = this.scanner.pos();
      this.scanner.goBackTo(this.token.offset);
      const unquoted = this.scanner.scanUnquotedString();
      if (unquoted) {
        this.token = unquoted;
        this.consumeToken();
        return true;
      }
      this.scanner.goBackTo(pos);
      return false;
    }
    resync(resyncTokens, resyncStopTokens) {
      while (true) {
        if (resyncTokens && resyncTokens.indexOf(this.token.type) !== -1) {
          this.consumeToken();
          return true;
        } else if (resyncStopTokens && resyncStopTokens.indexOf(this.token.type) !== -1) {
          return true;
        } else {
          if (this.token.type === TokenType.EOF) {
            return false;
          }
          this.token = this.scanner.scan();
        }
      }
    }
    createNode(nodeType) {
      return new Node(this.token.offset, this.token.len, nodeType);
    }
    create(ctor) {
      return new ctor(this.token.offset, this.token.len);
    }
    finish(node, error, resyncTokens, resyncStopTokens) {
      if (!(node instanceof Nodelist)) {
        if (error) {
          this.markError(node, error, resyncTokens, resyncStopTokens);
        }
        if (this.prevToken) {
          const prevEnd = this.prevToken.offset + this.prevToken.len;
          node.length = prevEnd > node.offset ? prevEnd - node.offset : 0;
        }
      }
      return node;
    }
    markError(node, error, resyncTokens, resyncStopTokens) {
      if (this.token !== this.lastErrorToken) {
        node.addIssue(new Marker(node, error, Level.Error, void 0, this.token.offset, this.token.len));
        this.lastErrorToken = this.token;
      }
      if (resyncTokens || resyncStopTokens) {
        this.resync(resyncTokens, resyncStopTokens);
      }
    }
    parseStylesheet(textDocument) {
      const versionId = textDocument.version;
      const text = textDocument.getText();
      const textProvider = (offset, length) => {
        if (textDocument.version !== versionId) {
          throw new Error("Underlying model has changed, AST is no longer valid");
        }
        return text.substr(offset, length);
      };
      return this.internalParse(text, this._parseStylesheet, textProvider);
    }
    internalParse(input, parseFunc, textProvider) {
      this.scanner.setSource(input);
      this.token = this.scanner.scan();
      const node = parseFunc.bind(this)();
      if (node) {
        if (textProvider) {
          node.textProvider = textProvider;
        } else {
          node.textProvider = (offset, length) => {
            return input.substr(offset, length);
          };
        }
      }
      return node;
    }
    _parseStylesheet() {
      const node = this.create(Stylesheet);
      while (node.addChild(this._parseStylesheetStart())) {
      }
      let inRecovery = false;
      do {
        let hasMatch = false;
        do {
          hasMatch = false;
          const statement = this._parseStylesheetStatement();
          if (statement) {
            node.addChild(statement);
            hasMatch = true;
            inRecovery = false;
            if (!this.peek(TokenType.EOF) && this._needsSemicolonAfter(statement) && !this.accept(TokenType.SemiColon)) {
              this.markError(node, ParseError.SemiColonExpected);
            }
          }
          while (this.accept(TokenType.SemiColon) || this.accept(TokenType.CDO) || this.accept(TokenType.CDC)) {
            hasMatch = true;
            inRecovery = false;
          }
        } while (hasMatch);
        if (this.peek(TokenType.EOF)) {
          break;
        }
        if (!inRecovery) {
          if (this.peek(TokenType.AtKeyword)) {
            this.markError(node, ParseError.UnknownAtRule);
          } else {
            this.markError(node, ParseError.RuleOrSelectorExpected);
          }
          inRecovery = true;
        }
        this.consumeToken();
      } while (!this.peek(TokenType.EOF));
      return this.finish(node);
    }
    _parseStylesheetStart() {
      return this._parseCharset();
    }
    _parseStylesheetStatement(isNested = false) {
      if (this.peek(TokenType.AtKeyword)) {
        return this._parseStylesheetAtStatement(isNested);
      }
      return this._parseRuleset(isNested);
    }
    _parseStylesheetAtStatement(isNested = false) {
      return this._parseImport() || this._parseMedia(isNested) || this._parseScope() || this._parsePage() || this._parseFontFace() || this._parseKeyframe() || this._parseSupports(isNested) || this._parseLayer(isNested) || this._parsePropertyAtRule() || this._parseViewPort() || this._parseNamespace() || this._parseDocument() || this._parseContainer(isNested) || this._parseStartingStyleAtRule(isNested) || this._parseUnknownAtRule();
    }
    _tryParseRuleset(isNested) {
      const mark = this.mark();
      if (this._parseSelector(isNested)) {
        while (this.accept(TokenType.Comma) && this._parseSelector(isNested)) {
        }
        if (this.accept(TokenType.CurlyL)) {
          this.restoreAtMark(mark);
          return this._parseRuleset(isNested);
        }
      }
      this.restoreAtMark(mark);
      return null;
    }
    _parseRuleset(isNested = false) {
      const node = this.create(RuleSet);
      const selectors = node.getSelectors();
      if (!selectors.addChild(this._parseSelector(isNested))) {
        return null;
      }
      while (this.accept(TokenType.Comma)) {
        if (!selectors.addChild(this._parseSelector(isNested))) {
          return this.finish(node, ParseError.SelectorExpected);
        }
      }
      return this._parseBody(node, this._parseRuleSetDeclaration.bind(this));
    }
    _parseRuleSetDeclarationAtStatement() {
      return this._parseMedia(true) || this._parseScope() || this._parseSupports(true) || this._parseLayer(true) || this._parseContainer(true) || this._parseStartingStyleAtRule(true) || this._parseUnknownAtRule();
    }
    _parseRuleSetDeclaration() {
      if (this.peek(TokenType.AtKeyword)) {
        return this._parseRuleSetDeclarationAtStatement();
      }
      if (!this.peek(TokenType.Ident)) {
        return this._parseRuleset(true);
      }
      return this._tryParseRuleset(true) || this._parseDeclaration();
    }
    _needsSemicolonAfter(node) {
      switch (node.type) {
        case NodeType.Keyframe:
        case NodeType.ViewPort:
        case NodeType.Media:
        case NodeType.Ruleset:
        case NodeType.Namespace:
        case NodeType.If:
        case NodeType.For:
        case NodeType.Each:
        case NodeType.While:
        case NodeType.MixinDeclaration:
        case NodeType.FunctionDeclaration:
        case NodeType.MixinContentDeclaration:
        case NodeType.Scope:
          return false;
        case NodeType.ExtendsReference:
        case NodeType.MixinContentReference:
        case NodeType.ReturnStatement:
        case NodeType.MediaQuery:
        case NodeType.Debug:
        case NodeType.Import:
        case NodeType.AtApplyRule:
        case NodeType.CustomPropertyDeclaration:
          return true;
        case NodeType.VariableDeclaration:
          return node.needsSemicolon;
        case NodeType.MixinReference:
          return !node.getContent();
        case NodeType.Declaration:
          return !node.getNestedProperties();
      }
      return false;
    }
    _parseDeclarations(parseDeclaration) {
      const node = this.create(Declarations);
      if (!this.accept(TokenType.CurlyL)) {
        return null;
      }
      let decl = parseDeclaration();
      while (node.addChild(decl)) {
        if (this.peek(TokenType.CurlyR)) {
          break;
        }
        if (this._needsSemicolonAfter(decl) && !this.accept(TokenType.SemiColon)) {
          return this.finish(node, ParseError.SemiColonExpected, [TokenType.SemiColon, TokenType.CurlyR]);
        }
        if (decl && this.prevToken && this.prevToken.type === TokenType.SemiColon) {
          decl.semicolonPosition = this.prevToken.offset;
        }
        while (this.accept(TokenType.SemiColon)) {
        }
        decl = parseDeclaration();
      }
      if (!this.accept(TokenType.CurlyR)) {
        return this.finish(node, ParseError.RightCurlyExpected, [TokenType.CurlyR, TokenType.SemiColon]);
      }
      return this.finish(node);
    }
    _parseBody(node, parseDeclaration) {
      if (!node.setDeclarations(this._parseDeclarations(parseDeclaration))) {
        return this.finish(node, ParseError.LeftCurlyExpected, [TokenType.CurlyR, TokenType.SemiColon]);
      }
      return this.finish(node);
    }
    _parseSelector(isNested) {
      const node = this.create(Selector);
      let hasContent = false;
      if (isNested) {
        hasContent = node.addChild(this._parseCombinator());
      }
      while (node.addChild(this._parseSimpleSelector())) {
        hasContent = true;
        node.addChild(this._parseCombinator());
      }
      return hasContent ? this.finish(node) : null;
    }
    _parseDeclaration(stopTokens, standaloneCustomPropertyValid = false) {
      const customProperty = this._tryParseCustomPropertyDeclaration(stopTokens, standaloneCustomPropertyValid);
      if (customProperty) {
        return customProperty;
      }
      const node = this.create(Declaration);
      if (!node.setProperty(this._parseProperty())) {
        return null;
      }
      if (!this.accept(TokenType.Colon)) {
        return this.finish(node, ParseError.ColonExpected, [TokenType.Colon], stopTokens || [TokenType.SemiColon]);
      }
      if (this.prevToken) {
        node.colonPosition = this.prevToken.offset;
      }
      if (!node.setValue(this._parseExpr())) {
        return this.finish(node, ParseError.PropertyValueExpected);
      }
      node.addChild(this._parsePrio());
      if (this.peek(TokenType.SemiColon)) {
        node.semicolonPosition = this.token.offset;
      }
      return this.finish(node);
    }
    _tryParseCustomPropertyDeclaration(stopTokens, standaloneCustomPropertyValid = false) {
      if (!this.peekRegExp(TokenType.Ident, /^--/)) {
        return null;
      }
      const node = this.create(CustomPropertyDeclaration);
      if (!node.setProperty(this._parseProperty())) {
        return null;
      }
      if (!this.accept(TokenType.Colon)) {
        if (standaloneCustomPropertyValid) {
          return this.finish(node);
        }
        return this.finish(node, ParseError.ColonExpected, [TokenType.Colon]);
      }
      if (this.prevToken) {
        node.colonPosition = this.prevToken.offset;
      }
      const mark = this.mark();
      if (this.peek(TokenType.CurlyL)) {
        const propertySet = this.create(CustomPropertySet);
        const declarations = this._parseDeclarations(this._parseRuleSetDeclaration.bind(this));
        if (propertySet.setDeclarations(declarations) && !declarations.isErroneous(true)) {
          propertySet.addChild(this._parsePrio());
          if (this.peek(TokenType.SemiColon)) {
            this.finish(propertySet);
            node.setPropertySet(propertySet);
            node.semicolonPosition = this.token.offset;
            return this.finish(node);
          }
        }
        this.restoreAtMark(mark);
      }
      const expression = this._parseExpr();
      if (expression && !expression.isErroneous(true)) {
        this._parsePrio();
        if (this.peekOne(...stopTokens || [], TokenType.SemiColon, TokenType.EOF)) {
          node.setValue(expression);
          if (this.peek(TokenType.SemiColon)) {
            node.semicolonPosition = this.token.offset;
          }
          return this.finish(node);
        }
      }
      this.restoreAtMark(mark);
      node.addChild(this._parseCustomPropertyValue(stopTokens));
      node.addChild(this._parsePrio());
      if (isDefined(node.colonPosition) && this.token.offset === node.colonPosition + 1) {
        return this.finish(node, ParseError.PropertyValueExpected);
      }
      return this.finish(node);
    }
    /**
     * Parse custom property values.
     *
     * Based on https://www.w3.org/TR/css-variables/#syntax
     *
     * This code is somewhat unusual, as the allowed syntax is incredibly broad,
     * parsing almost any sequence of tokens, save for a small set of exceptions.
     * Unbalanced delimitors, invalid tokens, and declaration
     * terminators like semicolons and !important directives (when not inside
     * of delimitors).
     */
    _parseCustomPropertyValue(stopTokens = [TokenType.CurlyR]) {
      const node = this.create(Node);
      const isTopLevel = () => curlyDepth === 0 && parensDepth === 0 && bracketsDepth === 0;
      const onStopToken = () => stopTokens.indexOf(this.token.type) !== -1;
      let curlyDepth = 0;
      let parensDepth = 0;
      let bracketsDepth = 0;
      done: while (true) {
        switch (this.token.type) {
          case TokenType.SemiColon:
            if (isTopLevel()) {
              break done;
            }
            break;
          case TokenType.Exclamation:
            if (isTopLevel()) {
              break done;
            }
            break;
          case TokenType.CurlyL:
            curlyDepth++;
            break;
          case TokenType.CurlyR:
            curlyDepth--;
            if (curlyDepth < 0) {
              if (onStopToken() && parensDepth === 0 && bracketsDepth === 0) {
                break done;
              }
              return this.finish(node, ParseError.LeftCurlyExpected);
            }
            break;
          case TokenType.ParenthesisL:
            parensDepth++;
            break;
          case TokenType.ParenthesisR:
            parensDepth--;
            if (parensDepth < 0) {
              if (onStopToken() && bracketsDepth === 0 && curlyDepth === 0) {
                break done;
              }
              return this.finish(node, ParseError.LeftParenthesisExpected);
            }
            break;
          case TokenType.BracketL:
            bracketsDepth++;
            break;
          case TokenType.BracketR:
            bracketsDepth--;
            if (bracketsDepth < 0) {
              return this.finish(node, ParseError.LeftSquareBracketExpected);
            }
            break;
          case TokenType.BadString:
            break done;
          case TokenType.EOF:
            let error = ParseError.RightCurlyExpected;
            if (bracketsDepth > 0) {
              error = ParseError.RightSquareBracketExpected;
            } else if (parensDepth > 0) {
              error = ParseError.RightParenthesisExpected;
            }
            return this.finish(node, error);
        }
        this.consumeToken();
      }
      return this.finish(node);
    }
    _tryToParseDeclaration(stopTokens) {
      const mark = this.mark();
      if (this._parseProperty() && this.accept(TokenType.Colon)) {
        this.restoreAtMark(mark);
        return this._parseDeclaration(stopTokens);
      }
      this.restoreAtMark(mark);
      return null;
    }
    _parseProperty() {
      const node = this.create(Property);
      const mark = this.mark();
      if (this.acceptDelim("*") || this.acceptDelim("_")) {
        if (this.hasWhitespace()) {
          this.restoreAtMark(mark);
          return null;
        }
      }
      if (node.setIdentifier(this._parsePropertyIdentifier())) {
        return this.finish(node);
      }
      return null;
    }
    _parsePropertyIdentifier() {
      return this._parseIdent();
    }
    _parseCharset() {
      if (!this.peek(TokenType.Charset)) {
        return null;
      }
      const node = this.create(Node);
      this.consumeToken();
      if (!this.accept(TokenType.String)) {
        return this.finish(node, ParseError.IdentifierExpected);
      }
      if (!this.accept(TokenType.SemiColon)) {
        return this.finish(node, ParseError.SemiColonExpected);
      }
      return this.finish(node);
    }
    _parseImport() {
      if (!this.peekKeyword("@import")) {
        return null;
      }
      const node = this.create(Import);
      this.consumeToken();
      if (!node.addChild(this._parseURILiteral()) && !node.addChild(this._parseStringLiteral())) {
        return this.finish(node, ParseError.URIOrStringExpected);
      }
      return this._completeParseImport(node);
    }
    _completeParseImport(node) {
      if (this.acceptIdent("layer")) {
        if (this.accept(TokenType.ParenthesisL)) {
          if (!node.addChild(this._parseLayerName())) {
            return this.finish(node, ParseError.IdentifierExpected, [TokenType.SemiColon]);
          }
          if (!this.accept(TokenType.ParenthesisR)) {
            return this.finish(node, ParseError.RightParenthesisExpected, [TokenType.ParenthesisR], []);
          }
        }
      }
      if (this.acceptIdent("supports")) {
        if (this.accept(TokenType.ParenthesisL)) {
          node.addChild(this._tryToParseDeclaration() || this._parseSupportsCondition());
          if (!this.accept(TokenType.ParenthesisR)) {
            return this.finish(node, ParseError.RightParenthesisExpected, [TokenType.ParenthesisR], []);
          }
        }
      }
      if (!this.peek(TokenType.SemiColon) && !this.peek(TokenType.EOF)) {
        node.setMedialist(this._parseMediaQueryList());
      }
      return this.finish(node);
    }
    _parseNamespace() {
      if (!this.peekKeyword("@namespace")) {
        return null;
      }
      const node = this.create(Namespace);
      this.consumeToken();
      if (!node.addChild(this._parseURILiteral())) {
        node.addChild(this._parseIdent());
        if (!node.addChild(this._parseURILiteral()) && !node.addChild(this._parseStringLiteral())) {
          return this.finish(node, ParseError.URIExpected, [TokenType.SemiColon]);
        }
      }
      if (!this.accept(TokenType.SemiColon)) {
        return this.finish(node, ParseError.SemiColonExpected);
      }
      return this.finish(node);
    }
    _parseFontFace() {
      if (!this.peekKeyword("@font-face")) {
        return null;
      }
      const node = this.create(FontFace);
      this.consumeToken();
      return this._parseBody(node, this._parseRuleSetDeclaration.bind(this));
    }
    _parseViewPort() {
      if (!this.peekKeyword("@-ms-viewport") && !this.peekKeyword("@-o-viewport") && !this.peekKeyword("@viewport")) {
        return null;
      }
      const node = this.create(ViewPort);
      this.consumeToken();
      return this._parseBody(node, this._parseRuleSetDeclaration.bind(this));
    }
    _parseKeyframe() {
      if (!this.peekRegExp(TokenType.AtKeyword, this.keyframeRegex)) {
        return null;
      }
      const node = this.create(Keyframe);
      const atNode = this.create(Node);
      this.consumeToken();
      node.setKeyword(this.finish(atNode));
      if (atNode.matches("@-ms-keyframes")) {
        this.markError(atNode, ParseError.UnknownKeyword);
      }
      if (!node.setIdentifier(this._parseKeyframeIdent())) {
        return this.finish(node, ParseError.IdentifierExpected, [TokenType.CurlyR]);
      }
      return this._parseBody(node, this._parseKeyframeSelector.bind(this));
    }
    _parseKeyframeIdent() {
      return this._parseIdent([ReferenceType.Keyframe]);
    }
    _parseKeyframeSelector() {
      const node = this.create(KeyframeSelector);
      let hasContent = false;
      if (node.addChild(this._parseIdent())) {
        hasContent = true;
      }
      if (this.accept(TokenType.Percentage)) {
        hasContent = true;
      }
      if (!hasContent) {
        return null;
      }
      while (this.accept(TokenType.Comma)) {
        hasContent = false;
        if (node.addChild(this._parseIdent())) {
          hasContent = true;
        }
        if (this.accept(TokenType.Percentage)) {
          hasContent = true;
        }
        if (!hasContent) {
          return this.finish(node, ParseError.PercentageExpected);
        }
      }
      return this._parseBody(node, this._parseRuleSetDeclaration.bind(this));
    }
    _tryParseKeyframeSelector() {
      const node = this.create(KeyframeSelector);
      const pos = this.mark();
      let hasContent = false;
      if (node.addChild(this._parseIdent())) {
        hasContent = true;
      }
      if (this.accept(TokenType.Percentage)) {
        hasContent = true;
      }
      if (!hasContent) {
        return null;
      }
      while (this.accept(TokenType.Comma)) {
        hasContent = false;
        if (node.addChild(this._parseIdent())) {
          hasContent = true;
        }
        if (this.accept(TokenType.Percentage)) {
          hasContent = true;
        }
        if (!hasContent) {
          this.restoreAtMark(pos);
          return null;
        }
      }
      if (!this.peek(TokenType.CurlyL)) {
        this.restoreAtMark(pos);
        return null;
      }
      return this._parseBody(node, this._parseRuleSetDeclaration.bind(this));
    }
    _parsePropertyAtRule() {
      if (!this.peekKeyword("@property")) {
        return null;
      }
      const node = this.create(PropertyAtRule);
      this.consumeToken();
      if (!this.peekRegExp(TokenType.Ident, /^--/) || !node.setName(this._parseIdent([ReferenceType.Property]))) {
        return this.finish(node, ParseError.IdentifierExpected);
      }
      return this._parseBody(node, this._parseDeclaration.bind(this));
    }
    _parseStartingStyleAtRule(isNested = false) {
      if (!this.peekKeyword("@starting-style")) {
        return null;
      }
      const node = this.create(StartingStyleAtRule);
      this.consumeToken();
      return this._parseBody(node, this._parseStartingStyleDeclaration.bind(this, isNested));
    }
    // this method is the same as ._parseContainerDeclaration()
    // which is the same as ._parseMediaDeclaration(),
    // _parseSupportsDeclaration, and ._parseLayerDeclaration()
    _parseStartingStyleDeclaration(isNested = false) {
      if (isNested) {
        return this._tryParseRuleset(true) || this._tryToParseDeclaration() || this._parseStylesheetStatement(true);
      }
      return this._parseStylesheetStatement(false);
    }
    _parseLayer(isNested = false) {
      if (!this.peekKeyword("@layer")) {
        return null;
      }
      const node = this.create(Layer);
      this.consumeToken();
      const names = this._parseLayerNameList();
      if (names) {
        node.setNames(names);
      }
      if ((!names || names.getChildren().length === 1) && this.peek(TokenType.CurlyL)) {
        return this._parseBody(node, this._parseLayerDeclaration.bind(this, isNested));
      }
      if (!this.accept(TokenType.SemiColon)) {
        return this.finish(node, ParseError.SemiColonExpected);
      }
      return this.finish(node);
    }
    _parseLayerDeclaration(isNested = false) {
      if (isNested) {
        return this._tryParseRuleset(true) || this._tryToParseDeclaration() || this._parseStylesheetStatement(true);
      }
      return this._parseStylesheetStatement(false);
    }
    _parseLayerNameList() {
      const node = this.createNode(NodeType.LayerNameList);
      if (!node.addChild(this._parseLayerName())) {
        return null;
      }
      while (this.accept(TokenType.Comma)) {
        if (!node.addChild(this._parseLayerName())) {
          return this.finish(node, ParseError.IdentifierExpected);
        }
      }
      return this.finish(node);
    }
    _parseLayerName() {
      const node = this.createNode(NodeType.LayerName);
      if (!node.addChild(this._parseIdent())) {
        return null;
      }
      while (!this.hasWhitespace() && this.acceptDelim(".")) {
        if (this.hasWhitespace() || !node.addChild(this._parseIdent())) {
          return this.finish(node, ParseError.IdentifierExpected);
        }
      }
      return this.finish(node);
    }
    _parseSupports(isNested = false) {
      if (!this.peekKeyword("@supports")) {
        return null;
      }
      const node = this.create(Supports);
      this.consumeToken();
      node.addChild(this._parseSupportsCondition());
      return this._parseBody(node, this._parseSupportsDeclaration.bind(this, isNested));
    }
    _parseSupportsDeclaration(isNested = false) {
      if (isNested) {
        return this._tryParseRuleset(true) || this._tryToParseDeclaration() || this._parseStylesheetStatement(true);
      }
      return this._parseStylesheetStatement(false);
    }
    _parseSupportsCondition() {
      const node = this.create(SupportsCondition);
      if (this.acceptIdent("not")) {
        node.addChild(this._parseSupportsConditionInParens());
      } else {
        node.addChild(this._parseSupportsConditionInParens());
        if (this.peekRegExp(TokenType.Ident, /^(and|or)$/i)) {
          const text = this.token.text.toLowerCase();
          while (this.acceptIdent(text)) {
            node.addChild(this._parseSupportsConditionInParens());
          }
        }
      }
      return this.finish(node);
    }
    _parseSupportsConditionInParens() {
      const node = this.create(SupportsCondition);
      if (this.accept(TokenType.ParenthesisL)) {
        if (this.prevToken) {
          node.lParent = this.prevToken.offset;
        }
        if (!node.addChild(this._tryToParseDeclaration([TokenType.ParenthesisR]))) {
          if (!this._parseSupportsCondition()) {
            return this.finish(node, ParseError.ConditionExpected);
          }
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [TokenType.ParenthesisR], []);
        }
        if (this.prevToken) {
          node.rParent = this.prevToken.offset;
        }
        return this.finish(node);
      } else if (this.peek(TokenType.Ident)) {
        const pos = this.mark();
        this.consumeToken();
        if (!this.hasWhitespace() && this.accept(TokenType.ParenthesisL)) {
          let openParentCount = 1;
          while (this.token.type !== TokenType.EOF && openParentCount !== 0) {
            if (this.token.type === TokenType.ParenthesisL) {
              openParentCount++;
            } else if (this.token.type === TokenType.ParenthesisR) {
              openParentCount--;
            }
            this.consumeToken();
          }
          return this.finish(node);
        } else {
          this.restoreAtMark(pos);
        }
      }
      return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.ParenthesisL]);
    }
    _parseMediaDeclaration(isNested = false) {
      if (isNested) {
        return this._tryParseRuleset(true) || this._tryToParseDeclaration() || this._parseStylesheetStatement(true);
      }
      return this._parseStylesheetStatement(false);
    }
    _parseMedia(isNested = false) {
      if (!this.peekKeyword("@media")) {
        return null;
      }
      const node = this.create(Media);
      this.consumeToken();
      if (!node.addChild(this._parseMediaQueryList())) {
        return this.finish(node, ParseError.MediaQueryExpected);
      }
      return this._parseBody(node, this._parseMediaDeclaration.bind(this, isNested));
    }
    _parseMediaQueryList() {
      const node = this.create(Medialist);
      if (!node.addChild(this._parseMediaQuery())) {
        return this.finish(node, ParseError.MediaQueryExpected);
      }
      while (this.accept(TokenType.Comma)) {
        if (!node.addChild(this._parseMediaQuery())) {
          return this.finish(node, ParseError.MediaQueryExpected);
        }
      }
      return this.finish(node);
    }
    _parseMediaQuery() {
      const node = this.create(MediaQuery);
      const pos = this.mark();
      this.acceptIdent("not");
      if (!this.peek(TokenType.ParenthesisL)) {
        if (this.acceptIdent("only")) {
        }
        if (!node.addChild(this._parseIdent())) {
          return null;
        }
        if (this.acceptIdent("and")) {
          node.addChild(this._parseMediaCondition());
        }
      } else {
        this.restoreAtMark(pos);
        node.addChild(this._parseMediaCondition());
      }
      return this.finish(node);
    }
    _parseRatio() {
      const pos = this.mark();
      const node = this.create(RatioValue);
      if (!this._parseNumeric()) {
        return null;
      }
      if (!this.acceptDelim("/")) {
        this.restoreAtMark(pos);
        return null;
      }
      if (!this._parseNumeric()) {
        return this.finish(node, ParseError.NumberExpected);
      }
      return this.finish(node);
    }
    _parseBooleanExpression(parseTest) {
      const node = this.create(Node);
      if (this.acceptIdent("not")) {
        if (!node.addChild(this._parseBooleanExpressionGroup(parseTest))) {
          return null;
        }
      } else {
        if (!node.addChild(this._parseBooleanExpressionGroup(parseTest))) {
          return null;
        }
        if (this.peekIdent("and")) {
          while (this.acceptIdent("and")) {
            if (!node.addChild(this._parseBooleanExpressionGroup(parseTest))) {
              return null;
            }
          }
        } else if (this.peekIdent("or")) {
          while (this.acceptIdent("or")) {
            if (!node.addChild(this._parseBooleanExpressionGroup(parseTest))) {
              return null;
            }
          }
        }
      }
      return this.finish(node);
    }
    _parseBooleanExpressionGroup(parseTest) {
      const node = this.create(Node);
      const pos = this.mark();
      if (this.accept(TokenType.ParenthesisL)) {
        if (node.addChild(this._parseBooleanExpression(parseTest))) {
          if (!this.accept(TokenType.ParenthesisR)) {
            return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.CurlyL]);
          }
          return this.finish(node);
        }
        this.restoreAtMark(pos);
      }
      if (!node.addChild(parseTest())) {
        return null;
      }
      ;
      return this.finish(node);
    }
    _parseMediaCondition() {
      const node = this.create(MediaCondition);
      this.acceptIdent("not");
      let parseExpression = true;
      while (parseExpression) {
        if (!this.accept(TokenType.ParenthesisL)) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.CurlyL]);
        }
        if (this.peek(TokenType.ParenthesisL) || this.peekIdent("not")) {
          node.addChild(this._parseMediaCondition());
        } else {
          node.addChild(this._parseMediaFeature());
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.CurlyL]);
        }
        parseExpression = this.acceptIdent("and") || this.acceptIdent("or");
      }
      return this.finish(node);
    }
    _parseMediaFeature() {
      const resyncStopToken = [TokenType.ParenthesisR];
      const node = this.create(MediaFeature);
      if (node.addChild(this._parseMediaFeatureName())) {
        if (this.accept(TokenType.Colon)) {
          if (!node.addChild(this._parseMediaFeatureValue())) {
            return this.finish(node, ParseError.TermExpected, [], resyncStopToken);
          }
        } else if (this._parseMediaFeatureRangeOperator()) {
          if (!node.addChild(this._parseMediaFeatureValue())) {
            return this.finish(node, ParseError.TermExpected, [], resyncStopToken);
          }
          if (this._parseMediaFeatureRangeOperator()) {
            if (!node.addChild(this._parseMediaFeatureValue())) {
              return this.finish(node, ParseError.TermExpected, [], resyncStopToken);
            }
          }
        } else {
        }
      } else if (node.addChild(this._parseMediaFeatureValue())) {
        if (!this._parseMediaFeatureRangeOperator()) {
          return this.finish(node, ParseError.OperatorExpected, [], resyncStopToken);
        }
        if (!node.addChild(this._parseMediaFeatureName())) {
          return this.finish(node, ParseError.IdentifierExpected, [], resyncStopToken);
        }
        if (this._parseMediaFeatureRangeOperator()) {
          if (!node.addChild(this._parseMediaFeatureValue())) {
            return this.finish(node, ParseError.TermExpected, [], resyncStopToken);
          }
        }
      } else {
        return this.finish(node, ParseError.IdentifierExpected, [], resyncStopToken);
      }
      return this.finish(node);
    }
    _parseMediaFeatureRangeOperator() {
      if (this.acceptDelim("<") || this.acceptDelim(">")) {
        if (!this.hasWhitespace()) {
          this.acceptDelim("=");
        }
        return true;
      } else if (this.acceptDelim("=")) {
        return true;
      }
      return false;
    }
    _parseMediaFeatureName() {
      return this._parseIdent();
    }
    _parseMediaFeatureValue() {
      return this._parseRatio() || this._parseTermExpression();
    }
    _parseScope() {
      if (!this.peekKeyword("@scope")) {
        return null;
      }
      const node = this.create(Scope);
      this.consumeToken();
      node.addChild(this._parseScopeLimits());
      return this._parseBody(node, this._parseScopeDeclaration.bind(this));
    }
    _parseScopeDeclaration() {
      const isNested = true;
      return this._tryParseRuleset(isNested) || this._tryToParseDeclaration() || this._parseStylesheetStatement(isNested);
    }
    _parseScopeLimits() {
      const node = this.create(ScopeLimits);
      if (this.accept(TokenType.ParenthesisL)) {
        if (!node.setScopeStart(this._parseScopeSelectorList())) {
          return this.finish(node, ParseError.SelectorExpected, [], [TokenType.ParenthesisR]);
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.CurlyL]);
        }
      }
      if (this.acceptIdent("to")) {
        if (!this.accept(TokenType.ParenthesisL)) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.CurlyL]);
        }
        if (!node.setScopeEnd(this._parseScopeSelectorList())) {
          return this.finish(node, ParseError.SelectorExpected, [], [TokenType.ParenthesisR]);
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.CurlyL]);
        }
      }
      return this.finish(node);
    }
    _parseScopeSelectorList() {
      const selectors = this.createNode(NodeType.SelectorList);
      if (!selectors.addChild(this._parseSelector(true))) {
        return null;
      }
      while (this.accept(TokenType.Comma) && selectors.addChild(this._parseSelector(true))) {
      }
      return this.finish(selectors);
    }
    _parseMedium() {
      const node = this.create(Node);
      if (node.addChild(this._parseIdent())) {
        return this.finish(node);
      } else {
        return null;
      }
    }
    _parsePageDeclaration() {
      return this._parsePageMarginBox() || this._parseRuleSetDeclaration();
    }
    _parsePage() {
      if (!this.peekKeyword("@page")) {
        return null;
      }
      const node = this.create(Page);
      this.consumeToken();
      if (node.addChild(this._parsePageSelector())) {
        while (this.accept(TokenType.Comma)) {
          if (!node.addChild(this._parsePageSelector())) {
            return this.finish(node, ParseError.IdentifierExpected);
          }
        }
      }
      return this._parseBody(node, this._parsePageDeclaration.bind(this));
    }
    _parsePageMarginBox() {
      if (!this.peek(TokenType.AtKeyword)) {
        return null;
      }
      const node = this.create(PageBoxMarginBox);
      if (!this.acceptOneKeyword(pageBoxDirectives)) {
        this.markError(node, ParseError.UnknownAtRule, [], [TokenType.CurlyL]);
      }
      return this._parseBody(node, this._parseRuleSetDeclaration.bind(this));
    }
    _parsePageSelector() {
      if (!this.peek(TokenType.Ident) && !this.peek(TokenType.Colon)) {
        return null;
      }
      const node = this.create(Node);
      node.addChild(this._parseIdent());
      if (this.accept(TokenType.Colon)) {
        if (!node.addChild(this._parseIdent())) {
          return this.finish(node, ParseError.IdentifierExpected);
        }
      }
      return this.finish(node);
    }
    _parseDocument() {
      if (!this.peekKeyword("@-moz-document")) {
        return null;
      }
      const node = this.create(Document);
      this.consumeToken();
      this.resync([], [TokenType.CurlyL]);
      return this._parseBody(node, this._parseStylesheetStatement.bind(this));
    }
    _parseContainerDeclaration(isNested = false) {
      if (isNested) {
        return this._tryParseRuleset(true) || this._tryToParseDeclaration() || this._parseStylesheetStatement(true);
      }
      return this._parseStylesheetStatement(false);
    }
    _parseContainer(isNested = false) {
      if (!this.peekKeyword("@container")) {
        return null;
      }
      const node = this.create(Container);
      this.consumeToken();
      node.addChild(this._parseIdent());
      if (node.addChild(this._parseContainerQuery())) {
        while (this.accept(TokenType.Comma)) {
          if (this.peek(TokenType.CurlyL)) {
            break;
          }
          node.addChild(this._parseIdent());
          node.addChild(this._parseContainerQuery());
        }
      }
      return this._parseBody(node, this._parseContainerDeclaration.bind(this, isNested));
    }
    _parseContainerQuery() {
      const node = this.create(Node);
      if (this.acceptIdent("not")) {
        node.addChild(this._parseContainerQueryInParens());
      } else {
        node.addChild(this._parseContainerQueryInParens(true));
        if (this.peekIdent("and")) {
          while (this.acceptIdent("and")) {
            node.addChild(this._parseContainerQueryInParens());
          }
        } else if (this.peekIdent("or")) {
          while (this.acceptIdent("or")) {
            node.addChild(this._parseContainerQueryInParens());
          }
        }
      }
      return this.finish(node);
    }
    _parseContainerQueryInParens(optional = false) {
      const node = this.create(Node);
      if (this.accept(TokenType.ParenthesisL)) {
        if (this.peekIdent("not") || this.peek(TokenType.ParenthesisL)) {
          node.addChild(this._parseContainerQuery());
        } else {
          node.addChild(this._parseMediaFeature());
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.CurlyL]);
        }
      } else if (this.acceptIdent("style")) {
        if (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL)) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.CurlyL]);
        }
        node.addChild(this._parseStyleQuery());
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.CurlyL]);
        }
      } else {
        if (optional) {
          return null;
        }
        return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.CurlyL]);
      }
      return this.finish(node);
    }
    _parseStyleQuery() {
      const node = this.create(Node);
      if (this.acceptIdent("not")) {
        node.addChild(this._parseStyleInParens());
      } else if (this.peek(TokenType.ParenthesisL)) {
        node.addChild(this._parseStyleInParens());
        if (this.peekIdent("and")) {
          while (this.acceptIdent("and")) {
            node.addChild(this._parseStyleInParens());
          }
        } else if (this.peekIdent("or")) {
          while (this.acceptIdent("or")) {
            node.addChild(this._parseStyleInParens());
          }
        }
      } else {
        node.addChild(this._parseDeclaration([TokenType.ParenthesisR], true));
      }
      return this.finish(node);
    }
    _parseStyleInParens() {
      const node = this.create(Node);
      if (this.accept(TokenType.ParenthesisL)) {
        node.addChild(this._parseStyleQuery());
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.CurlyL]);
        }
      } else {
        return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.CurlyL]);
      }
      return this.finish(node);
    }
    // https://www.w3.org/TR/css-syntax-3/#consume-an-at-rule
    _parseUnknownAtRule() {
      if (!this.peek(TokenType.AtKeyword)) {
        return null;
      }
      const node = this.create(UnknownAtRule);
      node.addChild(this._parseUnknownAtRuleName());
      const isTopLevel = () => curlyDepth === 0 && parensDepth === 0 && bracketsDepth === 0;
      let curlyLCount = 0;
      let curlyDepth = 0;
      let parensDepth = 0;
      let bracketsDepth = 0;
      done: while (true) {
        switch (this.token.type) {
          case TokenType.SemiColon:
            if (isTopLevel()) {
              break done;
            }
            break;
          case TokenType.EOF:
            if (curlyDepth > 0) {
              return this.finish(node, ParseError.RightCurlyExpected);
            } else if (bracketsDepth > 0) {
              return this.finish(node, ParseError.RightSquareBracketExpected);
            } else if (parensDepth > 0) {
              return this.finish(node, ParseError.RightParenthesisExpected);
            } else {
              return this.finish(node);
            }
          case TokenType.CurlyL:
            curlyLCount++;
            curlyDepth++;
            break;
          case TokenType.CurlyR:
            curlyDepth--;
            if (curlyLCount > 0 && curlyDepth === 0) {
              this.consumeToken();
              if (bracketsDepth > 0) {
                return this.finish(node, ParseError.RightSquareBracketExpected);
              } else if (parensDepth > 0) {
                return this.finish(node, ParseError.RightParenthesisExpected);
              }
              break done;
            }
            if (curlyDepth < 0) {
              if (parensDepth === 0 && bracketsDepth === 0) {
                break done;
              }
              return this.finish(node, ParseError.LeftCurlyExpected);
            }
            break;
          case TokenType.ParenthesisL:
            parensDepth++;
            break;
          case TokenType.ParenthesisR:
            parensDepth--;
            if (parensDepth < 0) {
              return this.finish(node, ParseError.LeftParenthesisExpected);
            }
            break;
          case TokenType.BracketL:
            bracketsDepth++;
            break;
          case TokenType.BracketR:
            bracketsDepth--;
            if (bracketsDepth < 0) {
              return this.finish(node, ParseError.LeftSquareBracketExpected);
            }
            break;
        }
        this.consumeToken();
      }
      return node;
    }
    _parseUnknownAtRuleName() {
      const node = this.create(Node);
      if (this.accept(TokenType.AtKeyword)) {
        return this.finish(node);
      }
      return node;
    }
    _parseOperator() {
      if (this.peekDelim("/") || this.peekDelim("*") || this.peekDelim("+") || this.peekDelim("-") || this.peek(TokenType.Dashmatch) || this.peek(TokenType.Includes) || this.peek(TokenType.SubstringOperator) || this.peek(TokenType.PrefixOperator) || this.peek(TokenType.SuffixOperator) || this.peekDelim("=")) {
        const node = this.createNode(NodeType.Operator);
        this.consumeToken();
        return this.finish(node);
      } else {
        return null;
      }
    }
    _parseUnaryOperator() {
      if (!this.peekDelim("+") && !this.peekDelim("-")) {
        return null;
      }
      const node = this.create(Node);
      this.consumeToken();
      return this.finish(node);
    }
    _parseCombinator() {
      if (this.peekDelim(">")) {
        const node = this.create(Node);
        this.consumeToken();
        const mark = this.mark();
        if (!this.hasWhitespace() && this.acceptDelim(">")) {
          if (!this.hasWhitespace() && this.acceptDelim(">")) {
            node.type = NodeType.SelectorCombinatorShadowPiercingDescendant;
            return this.finish(node);
          }
          this.restoreAtMark(mark);
        }
        node.type = NodeType.SelectorCombinatorParent;
        return this.finish(node);
      } else if (this.peekDelim("+")) {
        const node = this.create(Node);
        this.consumeToken();
        node.type = NodeType.SelectorCombinatorSibling;
        return this.finish(node);
      } else if (this.peekDelim("~")) {
        const node = this.create(Node);
        this.consumeToken();
        node.type = NodeType.SelectorCombinatorAllSiblings;
        return this.finish(node);
      } else if (this.peekDelim("/")) {
        const node = this.create(Node);
        this.consumeToken();
        const mark = this.mark();
        if (!this.hasWhitespace() && this.acceptIdent("deep") && !this.hasWhitespace() && this.acceptDelim("/")) {
          node.type = NodeType.SelectorCombinatorShadowPiercingDescendant;
          return this.finish(node);
        }
        this.restoreAtMark(mark);
      }
      return null;
    }
    _parseSimpleSelector() {
      const node = this.create(SimpleSelector);
      let c = 0;
      if (node.addChild(this._parseElementName() || this._parseNestingSelector())) {
        c++;
      }
      while ((c === 0 || !this.hasWhitespace()) && node.addChild(this._parseSimpleSelectorBody())) {
        c++;
      }
      return c > 0 ? this.finish(node) : null;
    }
    _parseNestingSelector() {
      if (this.peekDelim("&")) {
        const node = this.createNode(NodeType.SelectorCombinator);
        this.consumeToken();
        return this.finish(node);
      }
      return null;
    }
    _parseSimpleSelectorBody() {
      return this._parsePseudo() || this._parseHash() || this._parseClass() || this._parseAttrib();
    }
    _parseSelectorIdent() {
      return this._parseIdent();
    }
    _parseHash() {
      if (!this.peek(TokenType.Hash) && !this.peekDelim("#")) {
        return null;
      }
      const node = this.createNode(NodeType.IdentifierSelector);
      if (this.acceptDelim("#")) {
        if (this.hasWhitespace() || !node.addChild(this._parseSelectorIdent())) {
          return this.finish(node, ParseError.IdentifierExpected);
        }
      } else {
        this.consumeToken();
      }
      return this.finish(node);
    }
    _parseClass() {
      if (!this.peekDelim(".")) {
        return null;
      }
      const node = this.createNode(NodeType.ClassSelector);
      this.consumeToken();
      if (this.hasWhitespace() || !node.addChild(this._parseSelectorIdent())) {
        return this.finish(node, ParseError.IdentifierExpected);
      }
      return this.finish(node);
    }
    _parseElementName() {
      const pos = this.mark();
      const node = this.createNode(NodeType.ElementNameSelector);
      node.addChild(this._parseNamespacePrefix());
      if (!node.addChild(this._parseSelectorIdent()) && !this.acceptDelim("*")) {
        this.restoreAtMark(pos);
        return null;
      }
      return this.finish(node);
    }
    _parseNamespacePrefix() {
      const pos = this.mark();
      const node = this.createNode(NodeType.NamespacePrefix);
      if (!node.addChild(this._parseIdent()) && !this.acceptDelim("*")) {
      }
      if (!this.acceptDelim("|")) {
        this.restoreAtMark(pos);
        return null;
      }
      return this.finish(node);
    }
    _parseAttrib() {
      if (!this.peek(TokenType.BracketL)) {
        return null;
      }
      const node = this.create(AttributeSelector);
      this.consumeToken();
      node.setNamespacePrefix(this._parseNamespacePrefix());
      if (!node.setIdentifier(this._parseIdent())) {
        return this.finish(node, ParseError.IdentifierExpected);
      }
      if (node.setOperator(this._parseOperator())) {
        node.setValue(this._parseBinaryExpr());
        this.acceptIdent("i");
        this.acceptIdent("s");
      }
      if (!this.accept(TokenType.BracketR)) {
        return this.finish(node, ParseError.RightSquareBracketExpected);
      }
      return this.finish(node);
    }
    _parsePseudo() {
      const node = this._tryParsePseudoIdentifier();
      if (node) {
        if (!this.hasWhitespace() && this.accept(TokenType.ParenthesisL)) {
          const tryAsSelector = () => {
            const selectors = this.createNode(NodeType.SelectorList);
            if (!selectors.addChild(this._parseSelector(true))) {
              return null;
            }
            while (this.accept(TokenType.Comma) && selectors.addChild(this._parseSelector(true))) {
            }
            if (this.peek(TokenType.ParenthesisR)) {
              return this.finish(selectors);
            }
            return null;
          };
          let hasSelector = node.addChild(this.try(tryAsSelector));
          if (!hasSelector) {
            while (!this.peekIdent("of") && (node.addChild(this._parseTerm()) || node.addChild(this._parseOperator()))) {
            }
            if (this.acceptIdent("of") && !node.addChild(this.try(tryAsSelector))) {
              return this.finish(node, ParseError.SelectorExpected);
            }
          }
          if (!this.accept(TokenType.ParenthesisR)) {
            return this.finish(node, ParseError.RightParenthesisExpected);
          }
        }
        return this.finish(node);
      }
      return null;
    }
    _tryParsePseudoIdentifier() {
      if (!this.peek(TokenType.Colon)) {
        return null;
      }
      const pos = this.mark();
      const node = this.createNode(NodeType.PseudoSelector);
      this.consumeToken();
      if (this.hasWhitespace()) {
        this.restoreAtMark(pos);
        return null;
      }
      this.accept(TokenType.Colon);
      if (this.hasWhitespace() || !node.addChild(this._parseIdent())) {
        return this.finish(node, ParseError.IdentifierExpected);
      }
      return this.finish(node);
    }
    _tryParsePrio() {
      const mark = this.mark();
      const prio = this._parsePrio();
      if (prio) {
        return prio;
      }
      this.restoreAtMark(mark);
      return null;
    }
    _parsePrio() {
      if (!this.peek(TokenType.Exclamation)) {
        return null;
      }
      const node = this.createNode(NodeType.Prio);
      if (this.accept(TokenType.Exclamation) && this.acceptIdent("important")) {
        return this.finish(node);
      }
      return null;
    }
    _parseExpr(stopOnComma = false) {
      const node = this.create(Expression);
      if (!node.addChild(this._parseBinaryExpr())) {
        return null;
      }
      while (true) {
        if (this.peek(TokenType.Comma)) {
          if (stopOnComma) {
            return this.finish(node);
          }
          this.consumeToken();
        }
        if (!node.addChild(this._parseBinaryExpr())) {
          break;
        }
      }
      return this.finish(node);
    }
    _parseUnicodeRange() {
      if (!this.peekIdent("u")) {
        return null;
      }
      const node = this.create(UnicodeRange);
      if (!this.acceptUnicodeRange()) {
        return null;
      }
      return this.finish(node);
    }
    _parseNamedLine() {
      if (!this.peek(TokenType.BracketL)) {
        return null;
      }
      const node = this.createNode(NodeType.GridLine);
      this.consumeToken();
      while (node.addChild(this._parseIdent())) {
      }
      if (!this.accept(TokenType.BracketR)) {
        return this.finish(node, ParseError.RightSquareBracketExpected);
      }
      return this.finish(node);
    }
    _parseBinaryExpr(preparsedLeft, preparsedOper) {
      let node = this.create(BinaryExpression);
      if (!node.setLeft(preparsedLeft || this._parseTerm())) {
        return null;
      }
      if (!node.setOperator(preparsedOper || this._parseOperator())) {
        return this.finish(node);
      }
      if (!node.setRight(this._parseTerm())) {
        return this.finish(node, ParseError.TermExpected);
      }
      node = this.finish(node);
      const operator = this._parseOperator();
      if (operator) {
        node = this._parseBinaryExpr(node, operator);
      }
      return this.finish(node);
    }
    _parseTerm() {
      let node = this.create(Term);
      node.setOperator(this._parseUnaryOperator());
      if (node.setExpression(this._parseTermExpression())) {
        return this.finish(node);
      }
      return null;
    }
    _parseTermExpression() {
      return this._parseURILiteral() || // url before function
      this._parseUnicodeRange() || this._parseFunction() || // function before ident
      this._parseIdent() || this._parseStringLiteral() || this._parseNumeric() || this._parseHexColor() || this._parseOperation() || this._parseNamedLine();
    }
    _parseOperation() {
      if (!this.peek(TokenType.ParenthesisL)) {
        return null;
      }
      const node = this.create(Node);
      this.consumeToken();
      node.addChild(this._parseExpr());
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseNumeric() {
      if (this.peek(TokenType.Num) || this.peek(TokenType.Percentage) || this.peek(TokenType.Resolution) || this.peek(TokenType.Length) || this.peek(TokenType.EMS) || this.peek(TokenType.EXS) || this.peek(TokenType.Angle) || this.peek(TokenType.Time) || this.peek(TokenType.Dimension) || this.peek(TokenType.ContainerQueryLength) || this.peek(TokenType.Freq)) {
        const node = this.create(NumericValue);
        this.consumeToken();
        return this.finish(node);
      }
      return null;
    }
    _parseStringLiteral() {
      if (!this.peek(TokenType.String) && !this.peek(TokenType.BadString)) {
        return null;
      }
      const node = this.createNode(NodeType.StringLiteral);
      this.consumeToken();
      return this.finish(node);
    }
    _parseURILiteral() {
      if (!this.peekRegExp(TokenType.Ident, /^url(-prefix)?$/i)) {
        return null;
      }
      const pos = this.mark();
      const node = this.createNode(NodeType.URILiteral);
      this.accept(TokenType.Ident);
      if (this.hasWhitespace() || !this.peek(TokenType.ParenthesisL)) {
        this.restoreAtMark(pos);
        return null;
      }
      this.scanner.inURL = true;
      this.consumeToken();
      node.addChild(this._parseURLArgument());
      this.scanner.inURL = false;
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseURLArgument() {
      const node = this.create(Node);
      if (!this.accept(TokenType.String) && !this.accept(TokenType.BadString) && !this.acceptUnquotedString()) {
        return null;
      }
      return this.finish(node);
    }
    _parseIdent(referenceTypes) {
      if (!this.peek(TokenType.Ident)) {
        return null;
      }
      const node = this.create(Identifier);
      if (referenceTypes) {
        node.referenceTypes = referenceTypes;
      }
      node.isCustomProperty = this.peekRegExp(TokenType.Ident, /^--/);
      this.consumeToken();
      return this.finish(node);
    }
    _parseFunction() {
      const pos = this.mark();
      const node = this.create(Function);
      let parseArgument = this._parseFunctionArgument.bind(this);
      let separator = TokenType.Comma;
      if (this.peekIdent("if")) {
        parseArgument = this._parseIfBranch.bind(this);
        separator = TokenType.SemiColon;
      }
      if (!node.setIdentifier(this._parseFunctionIdentifier())) {
        return null;
      }
      if (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL)) {
        this.restoreAtMark(pos);
        return null;
      }
      if (node.getArguments().addChild(parseArgument())) {
        while (this.accept(separator)) {
          if (this.peek(TokenType.ParenthesisR)) {
            break;
          }
          if (!node.getArguments().addChild(parseArgument())) {
            this.markError(node, ParseError.ExpressionExpected);
          }
        }
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseFunctionIdentifier() {
      if (!this.peek(TokenType.Ident)) {
        return null;
      }
      const node = this.create(Identifier);
      node.referenceTypes = [ReferenceType.Function];
      if (this.acceptIdent("progid")) {
        if (this.accept(TokenType.Colon)) {
          while (this.accept(TokenType.Ident) && this.acceptDelim(".")) {
          }
        }
        return this.finish(node);
      }
      this.consumeToken();
      return this.finish(node);
    }
    _parseFunctionArgument() {
      const node = this.create(FunctionArgument);
      if (node.setValue(this._parseExpr(true))) {
        return this.finish(node);
      }
      return null;
    }
    _parseIfBranch() {
      const node = this.create(Node);
      if (!node.addChild(this._parseIfCondition())) {
        return this.finish(node, ParseError.IfConditionExpected, [], [TokenType.SemiColon]);
      }
      if (!this.accept(TokenType.Colon)) {
        return this.finish(node, ParseError.ColonExpected, [], [TokenType.SemiColon]);
      }
      node.addChild(this._parseExpr());
      return this.finish(node);
    }
    _parseIfCondition() {
      const node = this.create(Node);
      if (this.peekIdent("else")) {
        node.addChild(this._parseIdent());
        return this.finish(node);
      }
      return this._parseBooleanExpression(this._parseIfTest.bind(this));
    }
    _parseIfTest() {
      const node = this.create(Node);
      if (this.acceptIdent("supports")) {
        if (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL)) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.Colon]);
        }
        node.addChild(this._tryToParseDeclaration() || this._parseSupportsCondition());
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.Colon]);
        }
        return this.finish(node);
      }
      if (this.acceptIdent("media")) {
        if (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL)) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.Colon]);
        }
        const pos = this.mark();
        const condition = this._parseMediaCondition();
        if (condition && !condition.isErroneous()) {
          node.addChild(condition);
        } else {
          this.restoreAtMark(pos);
          node.addChild(this._parseMediaFeature());
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.Colon]);
        }
        return this.finish(node);
      }
      if (this.acceptIdent("style")) {
        if (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL)) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.Colon]);
        }
        node.addChild(this._parseStyleQuery());
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.Colon]);
        }
        return this.finish(node);
      }
      return null;
    }
    _parseHexColor() {
      if (this.peekRegExp(TokenType.Hash, /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/g)) {
        const node = this.create(HexColorValue);
        this.consumeToken();
        return this.finish(node);
      } else {
        return null;
      }
    }
  };

  // ../../node_modules/vscode-css-languageservice/lib/esm/services/lintRules.js
  var Warning = Level.Warning;
  var Error2 = Level.Error;
  var Ignore = Level.Ignore;
  var Rule = class {
    constructor(id, message, defaultValue) {
      this.id = id;
      this.message = message;
      this.defaultValue = defaultValue;
    }
  };
  var Setting = class {
    constructor(id, message, defaultValue) {
      this.id = id;
      this.message = message;
      this.defaultValue = defaultValue;
    }
  };
  var Rules = {
    AllVendorPrefixes: new Rule("compatibleVendorPrefixes", t("When using a vendor-specific prefix make sure to also include all other vendor-specific properties"), Ignore),
    IncludeStandardPropertyWhenUsingVendorPrefix: new Rule("vendorPrefix", t("When using a vendor-specific prefix also include the standard property"), Warning),
    DuplicateDeclarations: new Rule("duplicateProperties", t("Do not use duplicate style definitions"), Ignore),
    EmptyRuleSet: new Rule("emptyRules", t("Do not use empty rulesets"), Warning),
    ImportStatemement: new Rule("importStatement", t("Import statements do not load in parallel"), Ignore),
    BewareOfBoxModelSize: new Rule("boxModel", t("Do not use width or height when using padding or border"), Ignore),
    UniversalSelector: new Rule("universalSelector", t("The universal selector (*) is known to be slow"), Ignore),
    ZeroWithUnit: new Rule("zeroUnits", t("No unit for zero needed"), Ignore),
    RequiredPropertiesForFontFace: new Rule("fontFaceProperties", t("@font-face rule must define 'src' and 'font-family' properties"), Warning),
    HexColorLength: new Rule("hexColorLength", t("Hex colors must consist of three, four, six or eight hex numbers"), Error2),
    ArgsInColorFunction: new Rule("argumentsInColorFunction", t("Invalid number of parameters"), Error2),
    UnknownProperty: new Rule("unknownProperties", t("Unknown property."), Warning),
    UnknownAtRules: new Rule("unknownAtRules", t("Unknown at-rule."), Warning),
    IEStarHack: new Rule("ieHack", t("IE hacks are only necessary when supporting IE7 and older"), Ignore),
    UnknownVendorSpecificProperty: new Rule("unknownVendorSpecificProperties", t("Unknown vendor specific property."), Ignore),
    PropertyIgnoredDueToDisplay: new Rule("propertyIgnoredDueToDisplay", t("Property is ignored due to the display."), Warning),
    AvoidImportant: new Rule("important", t("Avoid using !important. It is an indication that the specificity of the entire CSS has gotten out of control and needs to be refactored."), Ignore),
    AvoidFloat: new Rule("float", t("Avoid using 'float'. Floats lead to fragile CSS that is easy to break if one aspect of the layout changes."), Ignore),
    AvoidIdSelector: new Rule("idSelector", t("Selectors should not contain IDs because these rules are too tightly coupled with the HTML."), Ignore)
  };
  var Settings = {
    ValidProperties: new Setting("validProperties", t("A list of properties that are not validated against the `unknownProperties` rule."), [])
  };
  var LintConfigurationSettings = class {
    constructor(conf = {}) {
      this.conf = conf;
    }
    getRule(rule) {
      if (this.conf.hasOwnProperty(rule.id)) {
        const level = toLevel(this.conf[rule.id]);
        if (level) {
          return level;
        }
      }
      return rule.defaultValue;
    }
    getSetting(setting) {
      return this.conf[setting.id];
    }
  };
  function toLevel(level) {
    switch (level) {
      case "ignore":
        return Level.Ignore;
      case "warning":
        return Level.Warning;
      case "error":
        return Level.Error;
    }
    return null;
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/utils/arrays.js
  function includes(array, item) {
    return array.indexOf(item) !== -1;
  }
  function union(...arrays) {
    const result = [];
    for (const array of arrays) {
      for (const item of array) {
        if (!includes(result, item)) {
          result.push(item);
        }
      }
    }
    return result;
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/services/lintUtil.js
  var Element = class {
    constructor(decl) {
      this.fullPropertyName = decl.getFullPropertyName().toLowerCase();
      this.node = decl;
    }
  };
  function setSide(model, side, value, property) {
    const state = model[side];
    state.value = value;
    if (value) {
      if (!includes(state.properties, property)) {
        state.properties.push(property);
      }
    }
  }
  function setAllSides(model, value, property) {
    setSide(model, "top", value, property);
    setSide(model, "right", value, property);
    setSide(model, "bottom", value, property);
    setSide(model, "left", value, property);
  }
  function updateModelWithValue(model, side, value, property) {
    if (side === "top" || side === "right" || side === "bottom" || side === "left") {
      setSide(model, side, value, property);
    } else {
      setAllSides(model, value, property);
    }
  }
  function updateModelWithList(model, values2, property) {
    switch (values2.length) {
      case 1:
        updateModelWithValue(model, void 0, values2[0], property);
        break;
      case 2:
        updateModelWithValue(model, "top", values2[0], property);
        updateModelWithValue(model, "bottom", values2[0], property);
        updateModelWithValue(model, "right", values2[1], property);
        updateModelWithValue(model, "left", values2[1], property);
        break;
      case 3:
        updateModelWithValue(model, "top", values2[0], property);
        updateModelWithValue(model, "right", values2[1], property);
        updateModelWithValue(model, "left", values2[1], property);
        updateModelWithValue(model, "bottom", values2[2], property);
        break;
      case 4:
        updateModelWithValue(model, "top", values2[0], property);
        updateModelWithValue(model, "right", values2[1], property);
        updateModelWithValue(model, "bottom", values2[2], property);
        updateModelWithValue(model, "left", values2[3], property);
        break;
    }
  }
  function matches(value, candidates) {
    for (let candidate of candidates) {
      if (value.matches(candidate)) {
        return true;
      }
    }
    return false;
  }
  function checkLineWidth(value, allowsKeywords = true) {
    if (allowsKeywords && matches(value, ["initial", "unset"])) {
      return false;
    }
    return parseFloat(value.getText()) !== 0;
  }
  function checkLineWidthList(nodes, allowsKeywords = true) {
    return nodes.map((node) => checkLineWidth(node, allowsKeywords));
  }
  function checkLineStyle(valueNode, allowsKeywords = true) {
    if (matches(valueNode, ["none", "hidden"])) {
      return false;
    }
    if (allowsKeywords && matches(valueNode, ["initial", "unset"])) {
      return false;
    }
    return true;
  }
  function checkLineStyleList(nodes, allowsKeywords = true) {
    return nodes.map((node) => checkLineStyle(node, allowsKeywords));
  }
  function checkBorderShorthand(node) {
    const children = node.getChildren();
    if (children.length === 1) {
      const value = children[0];
      return checkLineWidth(value) && checkLineStyle(value);
    }
    for (const child of children) {
      const value = child;
      if (!checkLineWidth(
        value,
        /* allowsKeywords: */
        false
      ) || !checkLineStyle(
        value,
        /* allowsKeywords: */
        false
      )) {
        return false;
      }
    }
    return true;
  }
  function calculateBoxModel(propertyTable) {
    const model = {
      top: { value: false, properties: [] },
      right: { value: false, properties: [] },
      bottom: { value: false, properties: [] },
      left: { value: false, properties: [] }
    };
    for (const property of propertyTable) {
      const value = property.node.value;
      if (typeof value === "undefined") {
        continue;
      }
      switch (property.fullPropertyName) {
        case "box-sizing":
          return {
            top: { value: false, properties: [] },
            right: { value: false, properties: [] },
            bottom: { value: false, properties: [] },
            left: { value: false, properties: [] }
          };
        case "width":
          model.width = property;
          break;
        case "height":
          model.height = property;
          break;
        default:
          const segments = property.fullPropertyName.split("-");
          switch (segments[0]) {
            case "border":
              switch (segments[1]) {
                case void 0:
                case "top":
                case "right":
                case "bottom":
                case "left":
                  switch (segments[2]) {
                    case void 0:
                      updateModelWithValue(model, segments[1], checkBorderShorthand(value), property);
                      break;
                    case "width":
                      updateModelWithValue(model, segments[1], checkLineWidth(value, false), property);
                      break;
                    case "style":
                      updateModelWithValue(model, segments[1], checkLineStyle(value, true), property);
                      break;
                  }
                  break;
                case "width":
                  updateModelWithList(model, checkLineWidthList(value.getChildren(), false), property);
                  break;
                case "style":
                  updateModelWithList(model, checkLineStyleList(value.getChildren(), true), property);
                  break;
              }
              break;
            case "padding":
              if (segments.length === 1) {
                updateModelWithList(model, checkLineWidthList(value.getChildren(), true), property);
              } else {
                updateModelWithValue(model, segments[1], checkLineWidth(value, true), property);
              }
              break;
          }
          break;
      }
    }
    return model;
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/services/lint.js
  var NodesByRootMap = class {
    constructor() {
      this.data = {};
    }
    add(root, name, node) {
      let entry = this.data[root];
      if (!entry) {
        entry = { nodes: [], names: [] };
        this.data[root] = entry;
      }
      entry.names.push(name);
      if (node) {
        entry.nodes.push(node);
      }
    }
  };
  var LintVisitor = class _LintVisitor {
    static entries(node, document, settings, cssDataManager, entryFilter) {
      const visitor = new _LintVisitor(document, settings, cssDataManager);
      node.acceptVisitor(visitor);
      visitor.completeValidations();
      return visitor.getEntries(entryFilter);
    }
    constructor(document, settings, cssDataManager) {
      this.cssDataManager = cssDataManager;
      this.warnings = [];
      this.settings = settings;
      this.documentText = document.getText();
      this.keyframes = new NodesByRootMap();
      this.validProperties = {};
      const properties = settings.getSetting(Settings.ValidProperties);
      if (Array.isArray(properties)) {
        properties.forEach((p) => {
          if (typeof p === "string") {
            const name = p.trim().toLowerCase();
            if (name.length) {
              this.validProperties[name] = true;
            }
          }
        });
      }
    }
    isValidPropertyDeclaration(element) {
      const propertyName = element.fullPropertyName;
      return this.validProperties[propertyName];
    }
    fetch(input, s) {
      const elements = [];
      for (const curr of input) {
        if (curr.fullPropertyName === s) {
          elements.push(curr);
        }
      }
      return elements;
    }
    fetchWithValue(input, s, v) {
      const elements = [];
      for (const inputElement of input) {
        if (inputElement.fullPropertyName === s) {
          const expression = inputElement.node.getValue();
          if (expression && this.findValueInExpression(expression, v)) {
            elements.push(inputElement);
          }
        }
      }
      return elements;
    }
    findValueInExpression(expression, v) {
      let found = false;
      expression.accept((node) => {
        if (node.type === NodeType.Identifier && node.matches(v)) {
          found = true;
        }
        return !found;
      });
      return found;
    }
    getEntries(filter = Level.Warning | Level.Error) {
      return this.warnings.filter((entry) => {
        return (entry.getLevel() & filter) !== 0;
      });
    }
    addEntry(node, rule, details) {
      const entry = new Marker(node, rule, this.settings.getRule(rule), details);
      this.warnings.push(entry);
    }
    getMissingNames(expected, actual) {
      const expectedClone = expected.slice(0);
      for (let i = 0; i < actual.length; i++) {
        const k = expectedClone.indexOf(actual[i]);
        if (k !== -1) {
          expectedClone[k] = null;
        }
      }
      let result = null;
      for (let i = 0; i < expectedClone.length; i++) {
        const curr = expectedClone[i];
        if (curr) {
          if (result === null) {
            result = t("'{0}'", curr);
          } else {
            result = t("{0}, '{1}'", result, curr);
          }
        }
      }
      return result;
    }
    visitNode(node) {
      switch (node.type) {
        case NodeType.UnknownAtRule:
          return this.visitUnknownAtRule(node);
        case NodeType.Keyframe:
          return this.visitKeyframe(node);
        case NodeType.FontFace:
          return this.visitFontFace(node);
        case NodeType.Ruleset:
          return this.visitRuleSet(node);
        case NodeType.SimpleSelector:
          return this.visitSimpleSelector(node);
        case NodeType.Function:
          return this.visitFunction(node);
        case NodeType.NumericValue:
          return this.visitNumericValue(node);
        case NodeType.Import:
          return this.visitImport(node);
        case NodeType.HexColorValue:
          return this.visitHexColorValue(node);
        case NodeType.Prio:
          return this.visitPrio(node);
        case NodeType.IdentifierSelector:
          return this.visitIdentifierSelector(node);
      }
      return true;
    }
    completeValidations() {
      this.validateKeyframes();
    }
    visitUnknownAtRule(node) {
      const atRuleName = node.getChild(0);
      if (!atRuleName) {
        return false;
      }
      const atDirective = this.cssDataManager.getAtDirective(atRuleName.getText());
      if (atDirective) {
        return false;
      }
      this.addEntry(atRuleName, Rules.UnknownAtRules, `Unknown at rule ${atRuleName.getText()}`);
      return true;
    }
    visitKeyframe(node) {
      const keyword = node.getKeyword();
      if (!keyword) {
        return false;
      }
      const text = keyword.getText();
      this.keyframes.add(node.getName(), text, text !== "@keyframes" ? keyword : null);
      return true;
    }
    validateKeyframes() {
      const expected = ["@-webkit-keyframes", "@-moz-keyframes", "@-o-keyframes"];
      for (const name in this.keyframes.data) {
        const actual = this.keyframes.data[name].names;
        const needsStandard = actual.indexOf("@keyframes") === -1;
        if (!needsStandard && actual.length === 1) {
          continue;
        }
        const missingVendorSpecific = this.getMissingNames(expected, actual);
        if (missingVendorSpecific || needsStandard) {
          for (const node of this.keyframes.data[name].nodes) {
            if (needsStandard) {
              const message = t("Always define standard rule '@keyframes' when defining keyframes.");
              this.addEntry(node, Rules.IncludeStandardPropertyWhenUsingVendorPrefix, message);
            }
            if (missingVendorSpecific) {
              const message = t("Always include all vendor specific rules: Missing: {0}", missingVendorSpecific);
              this.addEntry(node, Rules.AllVendorPrefixes, message);
            }
          }
        }
      }
      return true;
    }
    visitSimpleSelector(node) {
      const firstChar = this.documentText.charAt(node.offset);
      if (node.length === 1 && firstChar === "*") {
        this.addEntry(node, Rules.UniversalSelector);
      }
      return true;
    }
    visitIdentifierSelector(node) {
      this.addEntry(node, Rules.AvoidIdSelector);
      return true;
    }
    visitImport(node) {
      this.addEntry(node, Rules.ImportStatemement);
      return true;
    }
    visitRuleSet(node) {
      const declarations = node.getDeclarations();
      if (!declarations) {
        return false;
      }
      if (!declarations.hasChildren()) {
        this.addEntry(node.getSelectors(), Rules.EmptyRuleSet);
      }
      const propertyTable = [];
      for (const element of declarations.getChildren()) {
        if (element instanceof Declaration) {
          propertyTable.push(new Element(element));
        }
      }
      const boxModel = calculateBoxModel(propertyTable);
      if (boxModel.width) {
        let properties = [];
        if (boxModel.right.value) {
          properties = union(properties, boxModel.right.properties);
        }
        if (boxModel.left.value) {
          properties = union(properties, boxModel.left.properties);
        }
        if (properties.length !== 0) {
          for (const item of properties) {
            this.addEntry(item.node, Rules.BewareOfBoxModelSize);
          }
          this.addEntry(boxModel.width.node, Rules.BewareOfBoxModelSize);
        }
      }
      if (boxModel.height) {
        let properties = [];
        if (boxModel.top.value) {
          properties = union(properties, boxModel.top.properties);
        }
        if (boxModel.bottom.value) {
          properties = union(properties, boxModel.bottom.properties);
        }
        if (properties.length !== 0) {
          for (const item of properties) {
            this.addEntry(item.node, Rules.BewareOfBoxModelSize);
          }
          this.addEntry(boxModel.height.node, Rules.BewareOfBoxModelSize);
        }
      }
      let displayElems = this.fetchWithValue(propertyTable, "display", "inline-block");
      if (displayElems.length > 0) {
        const elem = this.fetch(propertyTable, "float");
        for (let index = 0; index < elem.length; index++) {
          const node2 = elem[index].node;
          const value = node2.getValue();
          if (value && !value.matches("none")) {
            this.addEntry(node2, Rules.PropertyIgnoredDueToDisplay, t("inline-block is ignored due to the float. If 'float' has a value other than 'none', the box is floated and 'display' is treated as 'block'"));
          }
        }
      }
      displayElems = this.fetchWithValue(propertyTable, "display", "block");
      if (displayElems.length > 0) {
        const elem = this.fetch(propertyTable, "vertical-align");
        for (let index = 0; index < elem.length; index++) {
          this.addEntry(elem[index].node, Rules.PropertyIgnoredDueToDisplay, t("Property is ignored due to the display. With 'display: block', vertical-align should not be used."));
        }
      }
      const elements = this.fetch(propertyTable, "float");
      for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        if (!this.isValidPropertyDeclaration(element)) {
          this.addEntry(element.node, Rules.AvoidFloat);
        }
      }
      for (let i = 0; i < propertyTable.length; i++) {
        const element = propertyTable[i];
        if (element.fullPropertyName !== "background" && !this.validProperties[element.fullPropertyName]) {
          const value = element.node.getValue();
          if (value && this.documentText.charAt(value.offset) !== "-") {
            const elements2 = this.fetch(propertyTable, element.fullPropertyName);
            if (elements2.length > 1) {
              for (let k = 0; k < elements2.length; k++) {
                const value2 = elements2[k].node.getValue();
                if (value2 && this.documentText.charAt(value2.offset) !== "-" && elements2[k] !== element) {
                  this.addEntry(element.node, Rules.DuplicateDeclarations);
                }
              }
            }
          }
        }
      }
      const isExportBlock = node.getSelectors().matches(":export");
      if (!isExportBlock) {
        const propertiesBySuffix = new NodesByRootMap();
        let containsUnknowns = false;
        for (const element of propertyTable) {
          const decl = element.node;
          if (this.isCSSDeclaration(decl)) {
            let name = element.fullPropertyName;
            const firstChar = name.charAt(0);
            if (firstChar === "-") {
              if (name.charAt(1) !== "-") {
                if (!this.cssDataManager.isKnownProperty(name) && !this.validProperties[name]) {
                  this.addEntry(decl.getProperty(), Rules.UnknownVendorSpecificProperty);
                }
                const nonPrefixedName = decl.getNonPrefixedPropertyName();
                propertiesBySuffix.add(nonPrefixedName, name, decl.getProperty());
              }
            } else {
              const fullName = name;
              if (firstChar === "*" || firstChar === "_") {
                this.addEntry(decl.getProperty(), Rules.IEStarHack);
                name = name.substr(1);
              }
              if (!this.cssDataManager.isKnownProperty(fullName) && !this.cssDataManager.isKnownProperty(name)) {
                if (!this.validProperties[name]) {
                  this.addEntry(decl.getProperty(), Rules.UnknownProperty, t("Unknown property: '{0}'", decl.getFullPropertyName()));
                }
              }
              propertiesBySuffix.add(name, name, null);
            }
          } else {
            containsUnknowns = true;
          }
        }
        if (!containsUnknowns) {
          for (const suffix in propertiesBySuffix.data) {
            const entry = propertiesBySuffix.data[suffix];
            const actual = entry.names;
            const needsStandard = this.cssDataManager.isStandardProperty(suffix) && actual.indexOf(suffix) === -1;
            if (!needsStandard && actual.length === 1) {
              continue;
            }
            const entriesThatNeedStandard = new Set(needsStandard ? entry.nodes : []);
            if (needsStandard) {
              const pseudoElements = this.getContextualVendorSpecificPseudoElements(node);
              for (const node2 of entry.nodes) {
                const propertyName = node2.getName();
                const prefix = propertyName.substring(0, propertyName.length - suffix.length);
                if (pseudoElements.some((x) => x.startsWith(prefix))) {
                  entriesThatNeedStandard.delete(node2);
                }
              }
            }
            const expected = [];
            for (let i = 0, len = _LintVisitor.prefixes.length; i < len; i++) {
              const prefix = _LintVisitor.prefixes[i];
              if (this.cssDataManager.isStandardProperty(prefix + suffix)) {
                expected.push(prefix + suffix);
              }
            }
            const missingVendorSpecific = this.getMissingNames(expected, actual);
            if (missingVendorSpecific || needsStandard) {
              for (const node2 of entry.nodes) {
                if (needsStandard && entriesThatNeedStandard.has(node2)) {
                  const message = t("Also define the standard property '{0}' for compatibility", suffix);
                  this.addEntry(node2, Rules.IncludeStandardPropertyWhenUsingVendorPrefix, message);
                }
                if (missingVendorSpecific) {
                  const message = t("Always include all vendor specific properties: Missing: {0}", missingVendorSpecific);
                  this.addEntry(node2, Rules.AllVendorPrefixes, message);
                }
              }
            }
          }
        }
      }
      return true;
    }
    /**
     * Walks up the syntax tree (starting from given `node`) and captures vendor
     * specific pseudo-element selectors.
     * @returns An array of vendor specific pseudo-elements; or empty if none
     * was found.
     */
    getContextualVendorSpecificPseudoElements(node) {
      function walkDown(s, n) {
        var _a2;
        for (const child of n.getChildren()) {
          if (child.type === NodeType.PseudoSelector) {
            const pseudoElement = (_a2 = child.getChildren()[0]) == null ? void 0 : _a2.getText();
            if (pseudoElement) {
              s.add(pseudoElement);
            }
          }
          walkDown(s, child);
        }
      }
      function walkUp(s, n) {
        if (n.type === NodeType.Ruleset) {
          for (const selector of n.getSelectors().getChildren()) {
            walkDown(s, selector);
          }
        }
        return n.parent ? walkUp(s, n.parent) : void 0;
      }
      const result = /* @__PURE__ */ new Set();
      walkUp(result, node);
      return Array.from(result);
    }
    visitPrio(node) {
      this.addEntry(node, Rules.AvoidImportant);
      return true;
    }
    visitNumericValue(node) {
      const funcDecl = node.findParent(NodeType.Function);
      if (funcDecl && funcDecl.getName() === "calc") {
        return true;
      }
      const decl = node.findParent(NodeType.Declaration);
      if (decl) {
        const declValue = decl.getValue();
        if (declValue) {
          const value = node.getValue();
          if (!value.unit || units.length.indexOf(value.unit.toLowerCase()) === -1) {
            return true;
          }
          if (parseFloat(value.value) === 0 && !!value.unit && !this.validProperties[decl.getFullPropertyName()]) {
            this.addEntry(node, Rules.ZeroWithUnit);
          }
        }
      }
      return true;
    }
    visitFontFace(node) {
      const declarations = node.getDeclarations();
      if (!declarations) {
        return false;
      }
      let definesSrc = false, definesFontFamily = false;
      let containsUnknowns = false;
      for (const node2 of declarations.getChildren()) {
        if (this.isCSSDeclaration(node2)) {
          const name = node2.getProperty().getName().toLowerCase();
          if (name === "src") {
            definesSrc = true;
          }
          if (name === "font-family") {
            definesFontFamily = true;
          }
        } else {
          containsUnknowns = true;
        }
      }
      if (!containsUnknowns && (!definesSrc || !definesFontFamily)) {
        this.addEntry(node, Rules.RequiredPropertiesForFontFace);
      }
      return true;
    }
    isCSSDeclaration(node) {
      if (node instanceof Declaration) {
        if (!node.getValue()) {
          return false;
        }
        const property = node.getProperty();
        if (!property) {
          return false;
        }
        const identifier = property.getIdentifier();
        if (!identifier || identifier.containsInterpolation()) {
          return false;
        }
        return true;
      }
      return false;
    }
    visitHexColorValue(node) {
      const length = node.length;
      if (length !== 9 && length !== 7 && length !== 5 && length !== 4) {
        this.addEntry(node, Rules.HexColorLength);
      }
      return false;
    }
    visitFunction(node) {
      const fnName = node.getName().toLowerCase();
      let expectedAttrCount = -1;
      let actualAttrCount = 0;
      switch (fnName) {
        case "rgb(":
        case "hsl(":
          expectedAttrCount = 3;
          break;
        case "rgba(":
        case "hsla(":
          expectedAttrCount = 4;
          break;
      }
      if (expectedAttrCount !== -1) {
        node.getArguments().accept((n) => {
          if (n instanceof BinaryExpression) {
            actualAttrCount += 1;
            return false;
          }
          return true;
        });
        if (actualAttrCount !== expectedAttrCount) {
          this.addEntry(node, Rules.ArgsInColorFunction);
        }
      }
      return true;
    }
  };
  LintVisitor.prefixes = [
    "-ms-",
    "-moz-",
    "-o-",
    "-webkit-"
    // Quite common
    //		'-xv-', '-atsc-', '-wap-', '-khtml-', 'mso-', 'prince-', '-ah-', '-hp-', '-ro-', '-rim-', '-tc-' // Quite un-common
  ];

  // ../../node_modules/vscode-css-languageservice/lib/esm/services/cssValidation.js
  var CSSValidation = class {
    constructor(cssDataManager) {
      this.cssDataManager = cssDataManager;
    }
    configure(settings) {
      this.settings = settings;
    }
    doValidation(document, stylesheet, settings = this.settings) {
      if (settings && settings.validate === false) {
        return [];
      }
      const entries = [];
      entries.push.apply(entries, ParseErrorCollector.entries(stylesheet));
      entries.push.apply(entries, LintVisitor.entries(stylesheet, document, new LintConfigurationSettings(settings && settings.lint), this.cssDataManager));
      const ruleIds = [];
      for (const r in Rules) {
        ruleIds.push(Rules[r].id);
      }
      function toDiagnostic(marker) {
        const range = Range2.create(document.positionAt(marker.getOffset()), document.positionAt(marker.getOffset() + marker.getLength()));
        const source = document.languageId;
        return {
          code: marker.getRule().id,
          source,
          message: marker.getMessage(),
          severity: marker.getLevel() === Level.Warning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
          range
        };
      }
      return entries.filter((entry) => entry.getLevel() !== Level.Ignore).map(toDiagnostic);
    }
  };

  // ../../node_modules/vscode-css-languageservice/lib/esm/languageFacts/dataProvider.js
  var CSSDataProvider = class {
    /**
     * Currently, unversioned data uses the V1 implementation
     * In the future when the provider handles multiple versions of HTML custom data,
     * use the latest implementation for unversioned data
     */
    constructor(data) {
      this._properties = [];
      this._atDirectives = [];
      this._pseudoClasses = [];
      this._pseudoElements = [];
      this.addData(data);
    }
    provideProperties() {
      return this._properties;
    }
    provideAtDirectives() {
      return this._atDirectives;
    }
    providePseudoClasses() {
      return this._pseudoClasses;
    }
    providePseudoElements() {
      return this._pseudoElements;
    }
    addData(data) {
      if (Array.isArray(data.properties)) {
        for (const prop of data.properties) {
          if (isPropertyData(prop)) {
            this._properties.push(prop);
          }
        }
      }
      if (Array.isArray(data.atDirectives)) {
        for (const prop of data.atDirectives) {
          if (isAtDirective(prop)) {
            this._atDirectives.push(prop);
          }
        }
      }
      if (Array.isArray(data.pseudoClasses)) {
        for (const prop of data.pseudoClasses) {
          if (isPseudoClassData(prop)) {
            this._pseudoClasses.push(prop);
          }
        }
      }
      if (Array.isArray(data.pseudoElements)) {
        for (const prop of data.pseudoElements) {
          if (isPseudoElementData(prop)) {
            this._pseudoElements.push(prop);
          }
        }
      }
    }
  };
  function isPropertyData(d) {
    return typeof d.name === "string";
  }
  function isAtDirective(d) {
    return typeof d.name === "string";
  }
  function isPseudoClassData(d) {
    return typeof d.name === "string";
  }
  function isPseudoElementData(d) {
    return typeof d.name === "string";
  }

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/scssScanner.js
  var _FSL2 = "/".charCodeAt(0);
  var _NWL2 = "\n".charCodeAt(0);
  var _CAR2 = "\r".charCodeAt(0);
  var _LFD2 = "\f".charCodeAt(0);
  var _DLR2 = "$".charCodeAt(0);
  var _HSH2 = "#".charCodeAt(0);
  var _CUL2 = "{".charCodeAt(0);
  var _EQS2 = "=".charCodeAt(0);
  var _BNG2 = "!".charCodeAt(0);
  var _LAN2 = "<".charCodeAt(0);
  var _RAN2 = ">".charCodeAt(0);
  var _DOT2 = ".".charCodeAt(0);
  var _ATS2 = "@".charCodeAt(0);
  var customTokenValue = TokenType.CustomToken;
  var VariableName = customTokenValue++;
  var InterpolationFunction = customTokenValue++;
  var Default = customTokenValue++;
  var EqualsOperator = customTokenValue++;
  var NotEqualsOperator = customTokenValue++;
  var GreaterEqualsOperator = customTokenValue++;
  var SmallerEqualsOperator = customTokenValue++;
  var Ellipsis = customTokenValue++;
  var Module2 = customTokenValue++;
  var SCSSScanner = class extends Scanner {
    scanNext(offset) {
      if (this.stream.advanceIfChar(_DLR2)) {
        const content = ["$"];
        if (this.ident(content)) {
          return this.finishToken(offset, VariableName, content.join(""));
        } else {
          this.stream.goBackTo(offset);
        }
      }
      if (this.stream.advanceIfChars([_HSH2, _CUL2])) {
        return this.finishToken(offset, InterpolationFunction);
      }
      if (this.stream.advanceIfChars([_EQS2, _EQS2])) {
        return this.finishToken(offset, EqualsOperator);
      }
      if (this.stream.advanceIfChars([_BNG2, _EQS2])) {
        return this.finishToken(offset, NotEqualsOperator);
      }
      if (this.stream.advanceIfChar(_LAN2)) {
        if (this.stream.advanceIfChar(_EQS2)) {
          return this.finishToken(offset, SmallerEqualsOperator);
        }
        return this.finishToken(offset, TokenType.Delim);
      }
      if (this.stream.advanceIfChar(_RAN2)) {
        if (this.stream.advanceIfChar(_EQS2)) {
          return this.finishToken(offset, GreaterEqualsOperator);
        }
        return this.finishToken(offset, TokenType.Delim);
      }
      if (this.stream.advanceIfChars([_DOT2, _DOT2, _DOT2])) {
        return this.finishToken(offset, Ellipsis);
      }
      return super.scanNext(offset);
    }
    comment() {
      if (super.comment()) {
        return true;
      }
      if (!this.inURL && this.stream.advanceIfChars([_FSL2, _FSL2])) {
        this.stream.advanceWhileChar((ch) => {
          switch (ch) {
            case _NWL2:
            case _CAR2:
            case _LFD2:
              return false;
            default:
              return true;
          }
        });
        return true;
      } else {
        return false;
      }
    }
  };

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/scssErrors.js
  var SCSSIssueType = class {
    constructor(id, message) {
      this.id = id;
      this.message = message;
    }
  };
  var SCSSParseError = {
    FromExpected: new SCSSIssueType("scss-fromexpected", t("'from' expected")),
    ThroughOrToExpected: new SCSSIssueType("scss-throughexpected", t("'through' or 'to' expected")),
    InExpected: new SCSSIssueType("scss-fromexpected", t("'in' expected"))
  };

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/scssParser.js
  var SCSSParser = class extends Parser {
    constructor() {
      super(new SCSSScanner());
    }
    _parseStylesheetStatement(isNested = false) {
      if (this.peek(TokenType.AtKeyword)) {
        return this._parseWarnAndDebug() || this._parseControlStatement() || this._parseMixinDeclaration() || this._parseMixinContent() || this._parseMixinReference() || this._parseFunctionDeclaration() || this._parseForward() || this._parseUse() || this._parseRuleset(isNested) || super._parseStylesheetAtStatement(isNested);
      }
      return this._parseRuleset(true) || this._parseVariableDeclaration();
    }
    _parseImport() {
      if (!this.peekKeyword("@import")) {
        return null;
      }
      const node = this.create(Import);
      this.consumeToken();
      if (!node.addChild(this._parseURILiteral()) && !node.addChild(this._parseStringLiteral())) {
        return this.finish(node, ParseError.URIOrStringExpected);
      }
      while (this.accept(TokenType.Comma)) {
        if (!node.addChild(this._parseURILiteral()) && !node.addChild(this._parseStringLiteral())) {
          return this.finish(node, ParseError.URIOrStringExpected);
        }
      }
      return this._completeParseImport(node);
    }
    // scss variables: $font-size: 12px;
    _parseVariableDeclaration(panic = []) {
      if (!this.peek(VariableName)) {
        return null;
      }
      const node = this.create(VariableDeclaration);
      if (!node.setVariable(this._parseVariable())) {
        return null;
      }
      if (!this.accept(TokenType.Colon)) {
        return this.finish(node, ParseError.ColonExpected);
      }
      if (this.prevToken) {
        node.colonPosition = this.prevToken.offset;
      }
      if (!node.setValue(this._parseExpr())) {
        return this.finish(node, ParseError.VariableValueExpected, [], panic);
      }
      while (this.peek(TokenType.Exclamation)) {
        if (node.addChild(this._tryParsePrio())) {
        } else {
          this.consumeToken();
          if (!this.peekRegExp(TokenType.Ident, /^(default|global)$/)) {
            return this.finish(node, ParseError.UnknownKeyword);
          }
          this.consumeToken();
        }
      }
      if (this.peek(TokenType.SemiColon)) {
        node.semicolonPosition = this.token.offset;
      }
      return this.finish(node);
    }
    _parseMediaCondition() {
      return this._parseInterpolation() || super._parseMediaCondition();
    }
    _parseMediaFeatureRangeOperator() {
      return this.accept(SmallerEqualsOperator) || this.accept(GreaterEqualsOperator) || super._parseMediaFeatureRangeOperator();
    }
    _parseMediaFeatureName() {
      return this._parseModuleMember() || this._parseFunction() || this._parseIdent() || this._parseVariable();
    }
    _parseKeyframeSelector() {
      return this._tryParseKeyframeSelector() || this._parseControlStatement(this._parseKeyframeSelector.bind(this)) || this._parseWarnAndDebug() || this._parseMixinReference() || this._parseFunctionDeclaration() || this._parseVariableDeclaration() || this._parseMixinContent();
    }
    _parseVariable() {
      if (!this.peek(VariableName)) {
        return null;
      }
      const node = this.create(Variable);
      this.consumeToken();
      return node;
    }
    _parseModuleMember() {
      const pos = this.mark();
      const node = this.create(Module);
      if (!node.setIdentifier(this._parseIdent([ReferenceType.Module]))) {
        return null;
      }
      if (this.hasWhitespace() || !this.acceptDelim(".") || this.hasWhitespace()) {
        this.restoreAtMark(pos);
        return null;
      }
      if (!node.addChild(this._parseVariable() || this._parseFunction())) {
        return this.finish(node, ParseError.IdentifierOrVariableExpected);
      }
      return node;
    }
    _parseIdent(referenceTypes) {
      if (!this.peek(TokenType.Ident) && !this.peek(InterpolationFunction) && !this.peekDelim("-")) {
        return null;
      }
      const node = this.create(Identifier);
      node.referenceTypes = referenceTypes;
      node.isCustomProperty = this.peekRegExp(TokenType.Ident, /^--/);
      let hasContent = false;
      const indentInterpolation = () => {
        const pos = this.mark();
        if (this.acceptDelim("-")) {
          if (!this.hasWhitespace()) {
            this.acceptDelim("-");
          }
          if (this.hasWhitespace()) {
            this.restoreAtMark(pos);
            return null;
          }
        }
        return this._parseInterpolation();
      };
      while (this.accept(TokenType.Ident) || node.addChild(indentInterpolation()) || hasContent && this.acceptRegexp(/^[\w-]/)) {
        hasContent = true;
        if (this.hasWhitespace()) {
          break;
        }
      }
      return hasContent ? this.finish(node) : null;
    }
    _parseTermExpression() {
      return this._parseModuleMember() || this._parseVariable() || this._parseNestingSelector() || //this._tryParsePrio() ||
      super._parseTermExpression();
    }
    _parseInterpolation() {
      if (this.peek(InterpolationFunction)) {
        const node = this.create(Interpolation);
        this.consumeToken();
        if (!node.addChild(this._parseExpr()) && !this._parseNestingSelector()) {
          if (this.accept(TokenType.CurlyR)) {
            return this.finish(node);
          }
          return this.finish(node, ParseError.ExpressionExpected);
        }
        if (!this.accept(TokenType.CurlyR)) {
          return this.finish(node, ParseError.RightCurlyExpected);
        }
        return this.finish(node);
      }
      return null;
    }
    _parseOperator() {
      if (this.peek(EqualsOperator) || this.peek(NotEqualsOperator) || this.peek(GreaterEqualsOperator) || this.peek(SmallerEqualsOperator) || this.peekDelim(">") || this.peekDelim("<") || this.peekIdent("and") || this.peekIdent("or") || this.peekDelim("%")) {
        const node = this.createNode(NodeType.Operator);
        this.consumeToken();
        return this.finish(node);
      }
      return super._parseOperator();
    }
    _parseUnaryOperator() {
      if (this.peekIdent("not")) {
        const node = this.create(Node);
        this.consumeToken();
        return this.finish(node);
      }
      return super._parseUnaryOperator();
    }
    _parseRuleSetDeclaration() {
      if (this.peek(TokenType.AtKeyword)) {
        return this._parseKeyframe() || this._parseImport() || this._parseMedia(true) || this._parseFontFace() || this._parseWarnAndDebug() || this._parseControlStatement() || this._parseFunctionDeclaration() || this._parseExtends() || this._parseMixinReference() || this._parseMixinContent() || this._parseMixinDeclaration() || this._parseRuleset(true) || this._parseSupports(true) || this._parseLayer() || this._parsePropertyAtRule() || this._parseContainer(true) || this._parseRuleSetDeclarationAtStatement();
      }
      return this._parseVariableDeclaration() || this._tryParseRuleset(true) || this._parseDeclaration();
    }
    _parseDeclaration(stopTokens) {
      const custonProperty = this._tryParseCustomPropertyDeclaration(stopTokens);
      if (custonProperty) {
        return custonProperty;
      }
      const node = this.create(Declaration);
      if (!node.setProperty(this._parseProperty())) {
        return null;
      }
      if (!this.accept(TokenType.Colon)) {
        return this.finish(node, ParseError.ColonExpected, [TokenType.Colon], stopTokens || [TokenType.SemiColon]);
      }
      if (this.prevToken) {
        node.colonPosition = this.prevToken.offset;
      }
      let hasContent = false;
      if (node.setValue(this._parseExpr())) {
        hasContent = true;
        node.addChild(this._parsePrio());
      }
      if (this.peek(TokenType.CurlyL)) {
        node.setNestedProperties(this._parseNestedProperties());
      } else {
        if (!hasContent) {
          return this.finish(node, ParseError.PropertyValueExpected);
        }
      }
      if (this.peek(TokenType.SemiColon)) {
        node.semicolonPosition = this.token.offset;
      }
      return this.finish(node);
    }
    _parseNestedProperties() {
      const node = this.create(NestedProperties);
      return this._parseBody(node, this._parseDeclaration.bind(this));
    }
    _parseExtends() {
      if (this.peekKeyword("@extend")) {
        const node = this.create(ExtendsReference);
        this.consumeToken();
        if (!node.getSelectors().addChild(this._parseSimpleSelector())) {
          return this.finish(node, ParseError.SelectorExpected);
        }
        while (this.accept(TokenType.Comma)) {
          node.getSelectors().addChild(this._parseSimpleSelector());
        }
        if (this.accept(TokenType.Exclamation)) {
          if (!this.acceptIdent("optional")) {
            return this.finish(node, ParseError.UnknownKeyword);
          }
        }
        return this.finish(node);
      }
      return null;
    }
    _parseSimpleSelectorBody() {
      return this._parseSelectorPlaceholder() || super._parseSimpleSelectorBody();
    }
    _parseNestingSelector() {
      if (this.peekDelim("&")) {
        const node = this.createNode(NodeType.SelectorCombinator);
        this.consumeToken();
        while (!this.hasWhitespace() && (this.acceptDelim("-") || this.accept(TokenType.Num) || this.accept(TokenType.Dimension) || node.addChild(this._parseIdent()) || this.acceptDelim("&"))) {
        }
        return this.finish(node);
      }
      return null;
    }
    _parseSelectorPlaceholder() {
      if (this.peekDelim("%")) {
        const node = this.createNode(NodeType.SelectorPlaceholder);
        this.consumeToken();
        this._parseIdent();
        return this.finish(node);
      } else if (this.peekKeyword("@at-root")) {
        const node = this.createNode(NodeType.SelectorPlaceholder);
        this.consumeToken();
        if (this.accept(TokenType.ParenthesisL)) {
          if (!this.acceptIdent("with") && !this.acceptIdent("without")) {
            return this.finish(node, ParseError.IdentifierExpected);
          }
          if (!this.accept(TokenType.Colon)) {
            return this.finish(node, ParseError.ColonExpected);
          }
          if (!node.addChild(this._parseIdent())) {
            return this.finish(node, ParseError.IdentifierExpected);
          }
          if (!this.accept(TokenType.ParenthesisR)) {
            return this.finish(node, ParseError.RightParenthesisExpected, [TokenType.CurlyR]);
          }
        }
        return this.finish(node);
      }
      return null;
    }
    _parseElementName() {
      const pos = this.mark();
      const node = super._parseElementName();
      if (node && !this.hasWhitespace() && this.peek(TokenType.ParenthesisL)) {
        this.restoreAtMark(pos);
        return null;
      }
      return node;
    }
    _tryParsePseudoIdentifier() {
      return this._parseInterpolation() || super._tryParsePseudoIdentifier();
    }
    _parseWarnAndDebug() {
      if (!this.peekKeyword("@debug") && !this.peekKeyword("@warn") && !this.peekKeyword("@error")) {
        return null;
      }
      const node = this.createNode(NodeType.Debug);
      this.consumeToken();
      node.addChild(this._parseExpr());
      return this.finish(node);
    }
    _parseControlStatement(parseStatement = this._parseRuleSetDeclaration.bind(this)) {
      if (!this.peek(TokenType.AtKeyword)) {
        return null;
      }
      return this._parseIfStatement(parseStatement) || this._parseForStatement(parseStatement) || this._parseEachStatement(parseStatement) || this._parseWhileStatement(parseStatement);
    }
    _parseIfStatement(parseStatement) {
      if (!this.peekKeyword("@if")) {
        return null;
      }
      return this._internalParseIfStatement(parseStatement);
    }
    _internalParseIfStatement(parseStatement) {
      const node = this.create(IfStatement);
      this.consumeToken();
      if (!node.setExpression(this._parseExpr(true))) {
        return this.finish(node, ParseError.ExpressionExpected);
      }
      this._parseBody(node, parseStatement);
      if (this.acceptKeyword("@else")) {
        if (this.peekIdent("if")) {
          node.setElseClause(this._internalParseIfStatement(parseStatement));
        } else if (this.peek(TokenType.CurlyL)) {
          const elseNode = this.create(ElseStatement);
          this._parseBody(elseNode, parseStatement);
          node.setElseClause(elseNode);
        }
      }
      return this.finish(node);
    }
    _parseForStatement(parseStatement) {
      if (!this.peekKeyword("@for")) {
        return null;
      }
      const node = this.create(ForStatement);
      this.consumeToken();
      if (!node.setVariable(this._parseVariable())) {
        return this.finish(node, ParseError.VariableNameExpected, [TokenType.CurlyR]);
      }
      if (!this.acceptIdent("from")) {
        return this.finish(node, SCSSParseError.FromExpected, [TokenType.CurlyR]);
      }
      if (!node.addChild(this._parseBinaryExpr())) {
        return this.finish(node, ParseError.ExpressionExpected, [TokenType.CurlyR]);
      }
      if (!this.acceptIdent("to") && !this.acceptIdent("through")) {
        return this.finish(node, SCSSParseError.ThroughOrToExpected, [TokenType.CurlyR]);
      }
      if (!node.addChild(this._parseBinaryExpr())) {
        return this.finish(node, ParseError.ExpressionExpected, [TokenType.CurlyR]);
      }
      return this._parseBody(node, parseStatement);
    }
    _parseEachStatement(parseStatement) {
      if (!this.peekKeyword("@each")) {
        return null;
      }
      const node = this.create(EachStatement);
      this.consumeToken();
      const variables = node.getVariables();
      if (!variables.addChild(this._parseVariable())) {
        return this.finish(node, ParseError.VariableNameExpected, [TokenType.CurlyR]);
      }
      while (this.accept(TokenType.Comma)) {
        if (!variables.addChild(this._parseVariable())) {
          return this.finish(node, ParseError.VariableNameExpected, [TokenType.CurlyR]);
        }
      }
      this.finish(variables);
      if (!this.acceptIdent("in")) {
        return this.finish(node, SCSSParseError.InExpected, [TokenType.CurlyR]);
      }
      if (!node.addChild(this._parseExpr())) {
        return this.finish(node, ParseError.ExpressionExpected, [TokenType.CurlyR]);
      }
      return this._parseBody(node, parseStatement);
    }
    _parseWhileStatement(parseStatement) {
      if (!this.peekKeyword("@while")) {
        return null;
      }
      const node = this.create(WhileStatement);
      this.consumeToken();
      if (!node.addChild(this._parseBinaryExpr())) {
        return this.finish(node, ParseError.ExpressionExpected, [TokenType.CurlyR]);
      }
      return this._parseBody(node, parseStatement);
    }
    _parseFunctionBodyDeclaration() {
      return this._parseVariableDeclaration() || this._parseReturnStatement() || this._parseWarnAndDebug() || this._parseControlStatement(this._parseFunctionBodyDeclaration.bind(this));
    }
    _parseFunctionDeclaration() {
      if (!this.peekKeyword("@function")) {
        return null;
      }
      const node = this.create(FunctionDeclaration);
      this.consumeToken();
      if (!node.setIdentifier(this._parseIdent([ReferenceType.Function]))) {
        return this.finish(node, ParseError.IdentifierExpected, [TokenType.CurlyR]);
      }
      if (!this.accept(TokenType.ParenthesisL)) {
        return this.finish(node, ParseError.LeftParenthesisExpected, [TokenType.CurlyR]);
      }
      if (node.getParameters().addChild(this._parseParameterDeclaration())) {
        while (this.accept(TokenType.Comma)) {
          if (this.peek(TokenType.ParenthesisR)) {
            break;
          }
          if (!node.getParameters().addChild(this._parseParameterDeclaration())) {
            return this.finish(node, ParseError.VariableNameExpected);
          }
        }
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected, [TokenType.CurlyR]);
      }
      return this._parseBody(node, this._parseFunctionBodyDeclaration.bind(this));
    }
    _parseReturnStatement() {
      if (!this.peekKeyword("@return")) {
        return null;
      }
      const node = this.createNode(NodeType.ReturnStatement);
      this.consumeToken();
      if (!node.addChild(this._parseExpr())) {
        return this.finish(node, ParseError.ExpressionExpected);
      }
      return this.finish(node);
    }
    _parseMixinDeclaration() {
      if (!this.peekKeyword("@mixin")) {
        return null;
      }
      const node = this.create(MixinDeclaration);
      this.consumeToken();
      if (!node.setIdentifier(this._parseIdent([ReferenceType.Mixin]))) {
        return this.finish(node, ParseError.IdentifierExpected, [TokenType.CurlyR]);
      }
      if (this.accept(TokenType.ParenthesisL)) {
        if (node.getParameters().addChild(this._parseParameterDeclaration())) {
          while (this.accept(TokenType.Comma)) {
            if (this.peek(TokenType.ParenthesisR)) {
              break;
            }
            if (!node.getParameters().addChild(this._parseParameterDeclaration())) {
              return this.finish(node, ParseError.VariableNameExpected);
            }
          }
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [TokenType.CurlyR]);
        }
      }
      return this._parseBody(node, this._parseRuleSetDeclaration.bind(this));
    }
    _parseParameterDeclaration() {
      const node = this.create(FunctionParameter);
      if (!node.setIdentifier(this._parseVariable())) {
        return null;
      }
      if (this.accept(Ellipsis)) {
      }
      if (this.accept(TokenType.Colon)) {
        if (!node.setDefaultValue(this._parseExpr(true))) {
          return this.finish(node, ParseError.VariableValueExpected, [], [TokenType.Comma, TokenType.ParenthesisR]);
        }
      }
      return this.finish(node);
    }
    _parseMixinContent() {
      if (!this.peekKeyword("@content")) {
        return null;
      }
      const node = this.create(MixinContentReference);
      this.consumeToken();
      if (this.accept(TokenType.ParenthesisL)) {
        if (node.getArguments().addChild(this._parseFunctionArgument())) {
          while (this.accept(TokenType.Comma)) {
            if (this.peek(TokenType.ParenthesisR)) {
              break;
            }
            if (!node.getArguments().addChild(this._parseFunctionArgument())) {
              return this.finish(node, ParseError.ExpressionExpected);
            }
          }
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected);
        }
      }
      return this.finish(node);
    }
    _parseMixinReference() {
      if (!this.peekKeyword("@include")) {
        return null;
      }
      const node = this.create(MixinReference);
      this.consumeToken();
      const firstIdent = this._parseIdent([ReferenceType.Mixin]);
      if (!node.setIdentifier(firstIdent)) {
        return this.finish(node, ParseError.IdentifierExpected, [TokenType.CurlyR]);
      }
      if (!this.hasWhitespace() && this.acceptDelim(".") && !this.hasWhitespace()) {
        const secondIdent = this._parseIdent([ReferenceType.Mixin]);
        if (!secondIdent) {
          return this.finish(node, ParseError.IdentifierExpected, [TokenType.CurlyR]);
        }
        const moduleToken = this.create(Module);
        firstIdent.referenceTypes = [ReferenceType.Module];
        moduleToken.setIdentifier(firstIdent);
        node.setIdentifier(secondIdent);
        node.addChild(moduleToken);
      }
      if (this.accept(TokenType.ParenthesisL)) {
        if (node.getArguments().addChild(this._parseFunctionArgument())) {
          while (this.accept(TokenType.Comma)) {
            if (this.peek(TokenType.ParenthesisR)) {
              break;
            }
            if (!node.getArguments().addChild(this._parseFunctionArgument())) {
              return this.finish(node, ParseError.ExpressionExpected);
            }
          }
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected);
        }
      }
      if (this.peekIdent("using") || this.peek(TokenType.CurlyL)) {
        node.setContent(this._parseMixinContentDeclaration());
      }
      return this.finish(node);
    }
    _parseMixinContentDeclaration() {
      const node = this.create(MixinContentDeclaration);
      if (this.acceptIdent("using")) {
        if (!this.accept(TokenType.ParenthesisL)) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [TokenType.CurlyL]);
        }
        if (node.getParameters().addChild(this._parseParameterDeclaration())) {
          while (this.accept(TokenType.Comma)) {
            if (this.peek(TokenType.ParenthesisR)) {
              break;
            }
            if (!node.getParameters().addChild(this._parseParameterDeclaration())) {
              return this.finish(node, ParseError.VariableNameExpected);
            }
          }
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [TokenType.CurlyL]);
        }
      }
      if (this.peek(TokenType.CurlyL)) {
        this._parseBody(node, this._parseMixinReferenceBodyStatement.bind(this));
      }
      return this.finish(node);
    }
    _parseMixinReferenceBodyStatement() {
      return this._tryParseKeyframeSelector() || this._parseRuleSetDeclaration();
    }
    _parseIfTest() {
      const node = this.create(Node);
      if (this.acceptIdent("sass")) {
        if (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL)) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [], [TokenType.CurlyL]);
        }
        node.addChild(this._parseExpr());
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [], [TokenType.CurlyL]);
        }
        return this.finish(node);
      }
      return super._parseIfTest();
    }
    _parseFunction() {
      const pos = this.mark();
      const node = this.create(Function);
      let isIf = this.peekIdent("if");
      if (!node.setIdentifier(this._parseFunctionIdentifier())) {
        return null;
      }
      if (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL)) {
        this.restoreAtMark(pos);
        return null;
      }
      let firstArgument;
      let parseArgument = this._parseFunctionArgument.bind(this);
      let separator = TokenType.Comma;
      if (!isIf) {
        firstArgument = this._parseFunctionArgument();
      } else {
        const pos2 = this.mark();
        firstArgument = this._parseIfBranch();
        if (firstArgument && !firstArgument.isErroneous()) {
          parseArgument = this._parseIfBranch.bind(this);
          separator = TokenType.SemiColon;
        } else {
          this.restoreAtMark(pos2);
          firstArgument = this._parseFunctionArgument();
        }
      }
      if (node.getArguments().addChild(firstArgument)) {
        while (this.accept(separator)) {
          if (this.peek(TokenType.ParenthesisR)) {
            break;
          }
          if (!node.getArguments().addChild(parseArgument())) {
            this.markError(node, ParseError.ExpressionExpected);
          }
        }
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseFunctionArgument() {
      const node = this.create(FunctionArgument);
      const pos = this.mark();
      const argument = this._parseVariable();
      if (argument) {
        if (!this.accept(TokenType.Colon)) {
          if (this.accept(Ellipsis)) {
            node.setValue(argument);
            return this.finish(node);
          } else {
            this.restoreAtMark(pos);
          }
        } else {
          node.setIdentifier(argument);
        }
      }
      if (node.setValue(this._parseExpr(true))) {
        this.accept(Ellipsis);
        node.addChild(this._parsePrio());
        return this.finish(node);
      } else if (node.setValue(this._tryParsePrio())) {
        return this.finish(node);
      }
      return null;
    }
    _parseURLArgument() {
      const pos = this.mark();
      const node = super._parseURLArgument();
      if (!node || !this.peek(TokenType.ParenthesisR)) {
        this.restoreAtMark(pos);
        const node2 = this.create(Node);
        node2.addChild(this._parseBinaryExpr());
        return this.finish(node2);
      }
      return node;
    }
    _parseOperation() {
      if (!this.peek(TokenType.ParenthesisL)) {
        return null;
      }
      const node = this.create(Node);
      this.consumeToken();
      while (node.addChild(this._parseListElement())) {
        this.accept(TokenType.Comma);
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseListElement() {
      const node = this.create(ListEntry);
      const child = this._parseBinaryExpr();
      if (!child) {
        return null;
      }
      if (this.accept(TokenType.Colon)) {
        node.setKey(child);
        if (!node.setValue(this._parseBinaryExpr())) {
          return this.finish(node, ParseError.ExpressionExpected);
        }
      } else {
        node.setValue(child);
      }
      return this.finish(node);
    }
    _parseUse() {
      if (!this.peekKeyword("@use")) {
        return null;
      }
      const node = this.create(Use);
      this.consumeToken();
      if (!node.addChild(this._parseStringLiteral())) {
        return this.finish(node, ParseError.StringLiteralExpected);
      }
      if (!this.peek(TokenType.SemiColon) && !this.peek(TokenType.EOF)) {
        if (!this.peekRegExp(TokenType.Ident, /as|with/)) {
          return this.finish(node, ParseError.UnknownKeyword);
        }
        if (this.acceptIdent("as") && (!node.setIdentifier(this._parseIdent([ReferenceType.Module])) && !this.acceptDelim("*"))) {
          return this.finish(node, ParseError.IdentifierOrWildcardExpected);
        }
        if (this.acceptIdent("with")) {
          if (!node.setParameters(this._parseModuleConfig())) {
            return this.finish(node, ParseError.LeftParenthesisExpected, [TokenType.ParenthesisR]);
          }
        }
      }
      if (!this.accept(TokenType.SemiColon) && !this.accept(TokenType.EOF)) {
        return this.finish(node, ParseError.SemiColonExpected);
      }
      return this.finish(node);
    }
    _parseModuleConfig() {
      const node = this.createNode(NodeType.ModuleConfig);
      if (!this.accept(TokenType.ParenthesisL)) {
        return null;
      }
      if (!node.addChild(this._parseModuleConfigDeclaration())) {
        return this.finish(node, ParseError.VariableNameExpected);
      }
      while (this.accept(TokenType.Comma)) {
        if (this.peek(TokenType.ParenthesisR)) {
          break;
        }
        if (!node.addChild(this._parseModuleConfigDeclaration())) {
          return this.finish(node, ParseError.VariableNameExpected);
        }
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseModuleConfigDeclaration() {
      const node = this.create(ModuleConfiguration);
      if (!node.setIdentifier(this._parseVariable())) {
        return null;
      }
      if (!this.accept(TokenType.Colon) || !node.setValue(this._parseExpr(true))) {
        return this.finish(node, ParseError.VariableValueExpected, [], [TokenType.Comma, TokenType.ParenthesisR]);
      }
      if (this.accept(TokenType.Exclamation)) {
        if (this.hasWhitespace() || !this.acceptIdent("default")) {
          return this.finish(node, ParseError.UnknownKeyword);
        }
      }
      return this.finish(node);
    }
    _parseForward() {
      if (!this.peekKeyword("@forward")) {
        return null;
      }
      const node = this.create(Forward);
      this.consumeToken();
      if (!node.addChild(this._parseStringLiteral())) {
        return this.finish(node, ParseError.StringLiteralExpected);
      }
      if (this.acceptIdent("as")) {
        const identifier = this._parseIdent([ReferenceType.Forward]);
        if (!node.setIdentifier(identifier)) {
          return this.finish(node, ParseError.IdentifierExpected);
        }
        if (this.hasWhitespace() || !this.acceptDelim("*")) {
          return this.finish(node, ParseError.WildcardExpected);
        }
      }
      if (this.acceptIdent("with")) {
        if (!node.setParameters(this._parseModuleConfig())) {
          return this.finish(node, ParseError.LeftParenthesisExpected, [TokenType.ParenthesisR]);
        }
      } else if (this.peekIdent("hide") || this.peekIdent("show")) {
        if (!node.addChild(this._parseForwardVisibility())) {
          return this.finish(node, ParseError.IdentifierOrVariableExpected);
        }
      }
      if (!this.accept(TokenType.SemiColon) && !this.accept(TokenType.EOF)) {
        return this.finish(node, ParseError.SemiColonExpected);
      }
      return this.finish(node);
    }
    _parseForwardVisibility() {
      const node = this.create(ForwardVisibility);
      node.setIdentifier(this._parseIdent());
      while (node.addChild(this._parseVariable() || this._parseIdent())) {
        this.accept(TokenType.Comma);
      }
      return node.getChildren().length > 1 ? node : null;
    }
    _parseSupportsCondition() {
      return this._parseInterpolation() || super._parseSupportsCondition();
    }
  };

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/lessScanner.js
  var _FSL3 = "/".charCodeAt(0);
  var _NWL3 = "\n".charCodeAt(0);
  var _CAR3 = "\r".charCodeAt(0);
  var _LFD3 = "\f".charCodeAt(0);
  var _TIC = "`".charCodeAt(0);
  var _DOT3 = ".".charCodeAt(0);
  var customTokenValue2 = TokenType.CustomToken;
  var Ellipsis2 = customTokenValue2++;
  var LESSScanner = class extends Scanner {
    scanNext(offset) {
      const tokenType = this.escapedJavaScript();
      if (tokenType !== null) {
        return this.finishToken(offset, tokenType);
      }
      if (this.stream.advanceIfChars([_DOT3, _DOT3, _DOT3])) {
        return this.finishToken(offset, Ellipsis2);
      }
      return super.scanNext(offset);
    }
    comment() {
      if (super.comment()) {
        return true;
      }
      if (!this.inURL && this.stream.advanceIfChars([_FSL3, _FSL3])) {
        this.stream.advanceWhileChar((ch) => {
          switch (ch) {
            case _NWL3:
            case _CAR3:
            case _LFD3:
              return false;
            default:
              return true;
          }
        });
        return true;
      } else {
        return false;
      }
    }
    escapedJavaScript() {
      const ch = this.stream.peekChar();
      if (ch === _TIC) {
        this.stream.advance(1);
        this.stream.advanceWhileChar((ch2) => {
          return ch2 !== _TIC;
        });
        return this.stream.advanceIfChar(_TIC) ? TokenType.EscapedJavaScript : TokenType.BadEscapedJavaScript;
      }
      return null;
    }
  };

  // ../../node_modules/vscode-css-languageservice/lib/esm/parser/lessParser.js
  var LESSParser = class extends Parser {
    constructor() {
      super(new LESSScanner());
    }
    _parseStylesheetStatement(isNested = false) {
      if (this.peek(TokenType.AtKeyword)) {
        return this._parseVariableDeclaration() || this._parsePlugin() || super._parseStylesheetAtStatement(isNested);
      }
      return this._tryParseMixinDeclaration() || this._tryParseMixinReference() || this._parseFunction() || this._parseRuleset(true);
    }
    _parseImport() {
      if (!this.peekKeyword("@import") && !this.peekKeyword("@import-once")) {
        return null;
      }
      const node = this.create(Import);
      this.consumeToken();
      if (this.accept(TokenType.ParenthesisL)) {
        if (!this.accept(TokenType.Ident)) {
          return this.finish(node, ParseError.IdentifierExpected, [TokenType.SemiColon]);
        }
        do {
          if (!this.accept(TokenType.Comma)) {
            break;
          }
        } while (this.accept(TokenType.Ident));
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected, [TokenType.SemiColon]);
        }
      }
      if (!node.addChild(this._parseURILiteral()) && !node.addChild(this._parseStringLiteral())) {
        return this.finish(node, ParseError.URIOrStringExpected, [TokenType.SemiColon]);
      }
      if (!this.peek(TokenType.SemiColon) && !this.peek(TokenType.EOF)) {
        node.setMedialist(this._parseMediaQueryList());
      }
      return this._completeParseImport(node);
    }
    _parsePlugin() {
      if (!this.peekKeyword("@plugin")) {
        return null;
      }
      const node = this.createNode(NodeType.Plugin);
      this.consumeToken();
      if (!node.addChild(this._parseStringLiteral())) {
        return this.finish(node, ParseError.StringLiteralExpected);
      }
      if (!this.accept(TokenType.SemiColon)) {
        return this.finish(node, ParseError.SemiColonExpected);
      }
      return this.finish(node);
    }
    _parseMediaQuery() {
      const node = super._parseMediaQuery();
      if (!node) {
        const node2 = this.create(MediaQuery);
        if (node2.addChild(this._parseVariable())) {
          return this.finish(node2);
        }
        return null;
      }
      return node;
    }
    _parseMediaDeclaration(isNested = false) {
      return this._tryParseRuleset(isNested) || this._tryToParseDeclaration() || this._tryParseMixinDeclaration() || this._tryParseMixinReference() || this._parseDetachedRuleSetMixin() || this._parseStylesheetStatement(isNested);
    }
    _parseMediaFeatureName() {
      return this._parseIdent() || this._parseVariable();
    }
    _parseVariableDeclaration(panic = []) {
      const node = this.create(VariableDeclaration);
      const mark = this.mark();
      if (!node.setVariable(this._parseVariable(true))) {
        return null;
      }
      if (this.accept(TokenType.Colon)) {
        if (this.prevToken) {
          node.colonPosition = this.prevToken.offset;
        }
        if (node.setValue(this._parseDetachedRuleSet())) {
          node.needsSemicolon = false;
        } else if (!node.setValue(this._parseExpr())) {
          return this.finish(node, ParseError.VariableValueExpected, [], panic);
        }
        node.addChild(this._parsePrio());
      } else {
        this.restoreAtMark(mark);
        return null;
      }
      if (this.peek(TokenType.SemiColon)) {
        node.semicolonPosition = this.token.offset;
      }
      return this.finish(node);
    }
    _parseDetachedRuleSet() {
      let mark = this.mark();
      if (this.peekDelim("#") || this.peekDelim(".")) {
        this.consumeToken();
        if (!this.hasWhitespace() && this.accept(TokenType.ParenthesisL)) {
          let node = this.create(MixinDeclaration);
          if (node.getParameters().addChild(this._parseMixinParameter())) {
            while (this.accept(TokenType.Comma) || this.accept(TokenType.SemiColon)) {
              if (this.peek(TokenType.ParenthesisR)) {
                break;
              }
              if (!node.getParameters().addChild(this._parseMixinParameter())) {
                this.markError(node, ParseError.IdentifierExpected, [], [TokenType.ParenthesisR]);
              }
            }
          }
          if (!this.accept(TokenType.ParenthesisR)) {
            this.restoreAtMark(mark);
            return null;
          }
        } else {
          this.restoreAtMark(mark);
          return null;
        }
      }
      if (!this.peek(TokenType.CurlyL)) {
        return null;
      }
      const content = this.create(BodyDeclaration);
      this._parseBody(content, this._parseDetachedRuleSetBody.bind(this));
      return this.finish(content);
    }
    _parseDetachedRuleSetBody() {
      return this._tryParseKeyframeSelector() || this._parseRuleSetDeclaration();
    }
    _addLookupChildren(node) {
      if (!node.addChild(this._parseLookupValue())) {
        return false;
      }
      let expectsValue = false;
      while (true) {
        if (this.peek(TokenType.BracketL)) {
          expectsValue = true;
        }
        if (!node.addChild(this._parseLookupValue())) {
          break;
        }
        expectsValue = false;
      }
      return !expectsValue;
    }
    _parseLookupValue() {
      const node = this.create(Node);
      const mark = this.mark();
      if (!this.accept(TokenType.BracketL)) {
        this.restoreAtMark(mark);
        return null;
      }
      if ((node.addChild(this._parseVariable(false, true)) || node.addChild(this._parsePropertyIdentifier())) && this.accept(TokenType.BracketR) || this.accept(TokenType.BracketR)) {
        return node;
      }
      this.restoreAtMark(mark);
      return null;
    }
    _parseVariable(declaration = false, insideLookup = false) {
      const isPropertyReference = !declaration && this.peekDelim("$");
      if (!this.peekDelim("@") && !isPropertyReference && !this.peek(TokenType.AtKeyword)) {
        return null;
      }
      const node = this.create(Variable);
      const mark = this.mark();
      while (this.acceptDelim("@") || !declaration && this.acceptDelim("$")) {
        if (this.hasWhitespace()) {
          this.restoreAtMark(mark);
          return null;
        }
      }
      if (!this.accept(TokenType.AtKeyword) && !this.accept(TokenType.Ident)) {
        this.restoreAtMark(mark);
        return null;
      }
      if (!insideLookup && this.peek(TokenType.BracketL)) {
        if (!this._addLookupChildren(node)) {
          this.restoreAtMark(mark);
          return null;
        }
      }
      return node;
    }
    _parseTermExpression() {
      return this._parseVariable() || this._parseEscaped() || super._parseTermExpression() || // preference for colors before mixin references
      this._tryParseMixinReference(false);
    }
    _parseEscaped() {
      if (this.peek(TokenType.EscapedJavaScript) || this.peek(TokenType.BadEscapedJavaScript)) {
        const node = this.createNode(NodeType.EscapedValue);
        this.consumeToken();
        return this.finish(node);
      }
      if (this.peekDelim("~")) {
        const node = this.createNode(NodeType.EscapedValue);
        this.consumeToken();
        if (this.accept(TokenType.String) || this.accept(TokenType.EscapedJavaScript)) {
          return this.finish(node);
        } else {
          return this.finish(node, ParseError.TermExpected);
        }
      }
      return null;
    }
    _parseOperator() {
      const node = this._parseGuardOperator();
      if (node) {
        return node;
      } else {
        return super._parseOperator();
      }
    }
    _parseGuardOperator() {
      if (this.peekDelim(">")) {
        const node = this.createNode(NodeType.Operator);
        this.consumeToken();
        this.acceptDelim("=");
        return node;
      } else if (this.peekDelim("=")) {
        const node = this.createNode(NodeType.Operator);
        this.consumeToken();
        this.acceptDelim("<");
        return node;
      } else if (this.peekDelim("<")) {
        const node = this.createNode(NodeType.Operator);
        this.consumeToken();
        this.acceptDelim("=");
        return node;
      }
      return null;
    }
    _parseRuleSetDeclaration() {
      if (this.peek(TokenType.AtKeyword)) {
        return this._parseKeyframe() || this._parseMedia(true) || this._parseImport() || this._parseSupports(true) || this._parseLayer() || this._parsePropertyAtRule() || this._parseContainer(true) || this._parseDetachedRuleSetMixin() || this._parseVariableDeclaration() || this._parseRuleSetDeclarationAtStatement();
      }
      return this._tryParseMixinDeclaration() || this._tryParseRuleset(true) || this._tryParseMixinReference() || this._parseFunction() || this._parseExtend() || this._parseDeclaration();
    }
    _parseKeyframeIdent() {
      return this._parseIdent([ReferenceType.Keyframe]) || this._parseVariable();
    }
    _parseKeyframeSelector() {
      return this._parseDetachedRuleSetMixin() || super._parseKeyframeSelector();
    }
    // public _parseSimpleSelectorBody(): nodes.Node | null {
    // 	return this._parseNestingSelector() || super._parseSimpleSelectorBody();
    // }
    _parseSelector(isNested) {
      const node = this.create(Selector);
      let hasContent = false;
      if (isNested) {
        hasContent = node.addChild(this._parseCombinator());
      }
      while (node.addChild(this._parseSimpleSelector())) {
        hasContent = true;
        const mark = this.mark();
        if (node.addChild(this._parseGuard()) && this.peek(TokenType.CurlyL)) {
          break;
        }
        this.restoreAtMark(mark);
        node.addChild(this._parseCombinator());
      }
      return hasContent ? this.finish(node) : null;
    }
    _parseNestingSelector() {
      if (this.peekDelim("&")) {
        const node = this.createNode(NodeType.SelectorCombinator);
        this.consumeToken();
        while (!this.hasWhitespace() && (this.acceptDelim("-") || this.accept(TokenType.Num) || this.accept(TokenType.Dimension) || node.addChild(this._parseIdent()) || this.acceptDelim("&"))) {
        }
        return this.finish(node);
      }
      return null;
    }
    _parseSelectorIdent() {
      if (!this.peekInterpolatedIdent()) {
        return null;
      }
      const node = this.createNode(NodeType.SelectorInterpolation);
      const hasContent = this._acceptInterpolatedIdent(node);
      return hasContent ? this.finish(node) : null;
    }
    _parsePropertyIdentifier(inLookup = false) {
      const propertyRegex = /^[\w-]+/;
      if (!this.peekInterpolatedIdent() && !this.peekRegExp(this.token.type, propertyRegex)) {
        return null;
      }
      const mark = this.mark();
      const node = this.create(Identifier);
      node.isCustomProperty = this.acceptDelim("-") && this.acceptDelim("-");
      let childAdded = false;
      if (!inLookup) {
        if (node.isCustomProperty) {
          childAdded = this._acceptInterpolatedIdent(node);
        } else {
          childAdded = this._acceptInterpolatedIdent(node, propertyRegex);
        }
      } else {
        if (node.isCustomProperty) {
          childAdded = node.addChild(this._parseIdent());
        } else {
          childAdded = node.addChild(this._parseRegexp(propertyRegex));
        }
      }
      if (!childAdded) {
        this.restoreAtMark(mark);
        return null;
      }
      if (!inLookup && !this.hasWhitespace()) {
        this.acceptDelim("+");
        if (!this.hasWhitespace()) {
          this.acceptIdent("_");
        }
      }
      return this.finish(node);
    }
    peekInterpolatedIdent() {
      return this.peek(TokenType.Ident) || this.peekDelim("@") || this.peekDelim("$") || this.peekDelim("-");
    }
    _acceptInterpolatedIdent(node, identRegex) {
      let hasContent = false;
      const indentInterpolation = () => {
        const pos = this.mark();
        if (this.acceptDelim("-")) {
          if (!this.hasWhitespace()) {
            this.acceptDelim("-");
          }
          if (this.hasWhitespace()) {
            this.restoreAtMark(pos);
            return null;
          }
        }
        return this._parseInterpolation();
      };
      const accept = identRegex ? () => this.acceptRegexp(identRegex) : () => this.accept(TokenType.Ident);
      while (accept() || node.addChild(this._parseInterpolation() || this.try(indentInterpolation))) {
        hasContent = true;
        if (this.hasWhitespace()) {
          break;
        }
      }
      return hasContent;
    }
    _parseInterpolation() {
      const mark = this.mark();
      if (this.peekDelim("@") || this.peekDelim("$")) {
        const node = this.createNode(NodeType.Interpolation);
        this.consumeToken();
        if (this.hasWhitespace() || !this.accept(TokenType.CurlyL)) {
          this.restoreAtMark(mark);
          return null;
        }
        if (!node.addChild(this._parseIdent())) {
          return this.finish(node, ParseError.IdentifierExpected);
        }
        if (!this.accept(TokenType.CurlyR)) {
          return this.finish(node, ParseError.RightCurlyExpected);
        }
        return this.finish(node);
      }
      return null;
    }
    _tryParseMixinDeclaration() {
      const mark = this.mark();
      const node = this.create(MixinDeclaration);
      if (!node.setIdentifier(this._parseMixinDeclarationIdentifier()) || !this.accept(TokenType.ParenthesisL)) {
        this.restoreAtMark(mark);
        return null;
      }
      if (node.getParameters().addChild(this._parseMixinParameter())) {
        while (this.accept(TokenType.Comma) || this.accept(TokenType.SemiColon)) {
          if (this.peek(TokenType.ParenthesisR)) {
            break;
          }
          if (!node.getParameters().addChild(this._parseMixinParameter())) {
            this.markError(node, ParseError.IdentifierExpected, [], [TokenType.ParenthesisR]);
          }
        }
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        this.restoreAtMark(mark);
        return null;
      }
      node.setGuard(this._parseGuard());
      if (!this.peek(TokenType.CurlyL)) {
        this.restoreAtMark(mark);
        return null;
      }
      return this._parseBody(node, this._parseMixInBodyDeclaration.bind(this));
    }
    _parseMixInBodyDeclaration() {
      return this._parseFontFace() || this._parseRuleSetDeclaration();
    }
    _parseMixinDeclarationIdentifier() {
      let identifier;
      if (this.peekDelim("#") || this.peekDelim(".")) {
        identifier = this.create(Identifier);
        this.consumeToken();
        if (this.hasWhitespace() || !identifier.addChild(this._parseIdent())) {
          return null;
        }
      } else if (this.peek(TokenType.Hash)) {
        identifier = this.create(Identifier);
        this.consumeToken();
      } else {
        return null;
      }
      identifier.referenceTypes = [ReferenceType.Mixin];
      return this.finish(identifier);
    }
    _parsePseudo() {
      if (!this.peek(TokenType.Colon)) {
        return null;
      }
      const mark = this.mark();
      const node = this.create(ExtendsReference);
      this.consumeToken();
      if (this.acceptIdent("extend")) {
        return this._completeExtends(node);
      }
      this.restoreAtMark(mark);
      return super._parsePseudo();
    }
    _parseExtend() {
      if (!this.peekDelim("&")) {
        return null;
      }
      const mark = this.mark();
      const node = this.create(ExtendsReference);
      this.consumeToken();
      if (this.hasWhitespace() || !this.accept(TokenType.Colon) || !this.acceptIdent("extend")) {
        this.restoreAtMark(mark);
        return null;
      }
      return this._completeExtends(node);
    }
    _completeExtends(node) {
      if (!this.accept(TokenType.ParenthesisL)) {
        return this.finish(node, ParseError.LeftParenthesisExpected);
      }
      const selectors = node.getSelectors();
      if (!selectors.addChild(this._parseSelector(true))) {
        return this.finish(node, ParseError.SelectorExpected);
      }
      while (this.accept(TokenType.Comma)) {
        if (!selectors.addChild(this._parseSelector(true))) {
          return this.finish(node, ParseError.SelectorExpected);
        }
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseDetachedRuleSetMixin() {
      if (!this.peek(TokenType.AtKeyword)) {
        return null;
      }
      const mark = this.mark();
      const node = this.create(MixinReference);
      if (node.addChild(this._parseVariable(true)) && (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL))) {
        this.restoreAtMark(mark);
        return null;
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _tryParseMixinReference(atRoot = true) {
      const mark = this.mark();
      const node = this.create(MixinReference);
      let identifier = this._parseMixinDeclarationIdentifier();
      while (identifier) {
        this.acceptDelim(">");
        const nextId = this._parseMixinDeclarationIdentifier();
        if (nextId) {
          node.getNamespaces().addChild(identifier);
          identifier = nextId;
        } else {
          break;
        }
      }
      if (!node.setIdentifier(identifier)) {
        this.restoreAtMark(mark);
        return null;
      }
      let hasArguments = false;
      if (this.accept(TokenType.ParenthesisL)) {
        hasArguments = true;
        if (node.getArguments().addChild(this._parseMixinArgument())) {
          while (this.accept(TokenType.Comma) || this.accept(TokenType.SemiColon)) {
            if (this.peek(TokenType.ParenthesisR)) {
              break;
            }
            if (!node.getArguments().addChild(this._parseMixinArgument())) {
              return this.finish(node, ParseError.ExpressionExpected);
            }
          }
        }
        if (!this.accept(TokenType.ParenthesisR)) {
          return this.finish(node, ParseError.RightParenthesisExpected);
        }
        identifier.referenceTypes = [ReferenceType.Mixin];
      } else {
        identifier.referenceTypes = [ReferenceType.Mixin, ReferenceType.Rule];
      }
      if (this.peek(TokenType.BracketL)) {
        if (!atRoot) {
          this._addLookupChildren(node);
        }
      } else {
        node.addChild(this._parsePrio());
      }
      if (!hasArguments && !this.peek(TokenType.SemiColon) && !this.peek(TokenType.CurlyR) && !this.peek(TokenType.EOF)) {
        this.restoreAtMark(mark);
        return null;
      }
      return this.finish(node);
    }
    _parseMixinArgument() {
      const node = this.create(FunctionArgument);
      const pos = this.mark();
      const argument = this._parseVariable();
      if (argument) {
        if (!this.accept(TokenType.Colon)) {
          this.restoreAtMark(pos);
        } else {
          node.setIdentifier(argument);
        }
      }
      if (node.setValue(this._parseDetachedRuleSet() || this._parseExpr(true))) {
        return this.finish(node);
      }
      this.restoreAtMark(pos);
      return null;
    }
    _parseMixinParameter() {
      const node = this.create(FunctionParameter);
      if (this.peekKeyword("@rest")) {
        const restNode = this.create(Node);
        this.consumeToken();
        if (!this.accept(Ellipsis2)) {
          return this.finish(node, ParseError.DotExpected, [], [TokenType.Comma, TokenType.ParenthesisR]);
        }
        node.setIdentifier(this.finish(restNode));
        return this.finish(node);
      }
      if (this.peek(Ellipsis2)) {
        const varargsNode = this.create(Node);
        this.consumeToken();
        node.setIdentifier(this.finish(varargsNode));
        return this.finish(node);
      }
      let hasContent = false;
      if (node.setIdentifier(this._parseVariable())) {
        this.accept(TokenType.Colon);
        hasContent = true;
      }
      if (!node.setDefaultValue(this._parseDetachedRuleSet() || this._parseExpr(true)) && !hasContent) {
        return null;
      }
      return this.finish(node);
    }
    _parseGuard() {
      if (!this.peekIdent("when")) {
        return null;
      }
      const node = this.create(LessGuard);
      this.consumeToken();
      if (!node.getConditions().addChild(this._parseGuardCondition())) {
        return this.finish(node, ParseError.ConditionExpected);
      }
      while (this.acceptIdent("and") || this.accept(TokenType.Comma)) {
        if (!node.getConditions().addChild(this._parseGuardCondition())) {
          return this.finish(node, ParseError.ConditionExpected);
        }
      }
      return this.finish(node);
    }
    _parseGuardCondition() {
      const node = this.create(GuardCondition);
      node.isNegated = this.acceptIdent("not");
      if (!this.accept(TokenType.ParenthesisL)) {
        if (node.isNegated) {
          return this.finish(node, ParseError.LeftParenthesisExpected);
        }
        return null;
      }
      if (!node.addChild(this._parseExpr())) {
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseFunction() {
      const pos = this.mark();
      const node = this.create(Function);
      if (!node.setIdentifier(this._parseFunctionIdentifier())) {
        return null;
      }
      if (this.hasWhitespace() || !this.accept(TokenType.ParenthesisL)) {
        this.restoreAtMark(pos);
        return null;
      }
      if (node.getArguments().addChild(this._parseMixinArgument())) {
        while (this.accept(TokenType.Comma) || this.accept(TokenType.SemiColon)) {
          if (this.peek(TokenType.ParenthesisR)) {
            break;
          }
          if (!node.getArguments().addChild(this._parseMixinArgument())) {
            return this.finish(node, ParseError.ExpressionExpected);
          }
        }
      }
      if (!this.accept(TokenType.ParenthesisR)) {
        return this.finish(node, ParseError.RightParenthesisExpected);
      }
      return this.finish(node);
    }
    _parseFunctionIdentifier() {
      if (this.peekDelim("%")) {
        const node = this.create(Identifier);
        node.referenceTypes = [ReferenceType.Function];
        this.consumeToken();
        return this.finish(node);
      }
      return super._parseFunctionIdentifier();
    }
    _parseURLArgument() {
      const pos = this.mark();
      const node = super._parseURLArgument();
      if (!node || !this.peek(TokenType.ParenthesisR)) {
        this.restoreAtMark(pos);
        const node2 = this.create(Node);
        node2.addChild(this._parseBinaryExpr());
        return this.finish(node2);
      }
      return node;
    }
  };

  // src/workers/css-diagnostics-data.generated.js
  var cssData = {
    "version": 1.1,
    "properties": [
      {
        "name": "-moz-animation"
      },
      {
        "name": "-moz-animation-delay"
      },
      {
        "name": "-moz-animation-direction"
      },
      {
        "name": "-moz-animation-duration"
      },
      {
        "name": "-moz-animation-iteration-count"
      },
      {
        "name": "-moz-animation-name"
      },
      {
        "name": "-moz-animation-play-state"
      },
      {
        "name": "-moz-animation-timing-function"
      },
      {
        "name": "-moz-appearance",
        "status": "nonstandard"
      },
      {
        "name": "-moz-backface-visibility"
      },
      {
        "name": "-moz-background-clip"
      },
      {
        "name": "-moz-background-inline-policy"
      },
      {
        "name": "-moz-background-origin"
      },
      {
        "name": "-moz-binding",
        "status": "nonstandard"
      },
      {
        "name": "-moz-border-bottom-colors",
        "status": "nonstandard"
      },
      {
        "name": "-moz-border-image"
      },
      {
        "name": "-moz-border-left-colors",
        "status": "nonstandard"
      },
      {
        "name": "-moz-border-right-colors",
        "status": "nonstandard"
      },
      {
        "name": "-moz-border-top-colors",
        "status": "nonstandard"
      },
      {
        "name": "-moz-box-align"
      },
      {
        "name": "-moz-box-direction"
      },
      {
        "name": "-moz-box-flex"
      },
      {
        "name": "-moz-box-flexgroup"
      },
      {
        "name": "-moz-box-ordinal-group"
      },
      {
        "name": "-moz-box-orient"
      },
      {
        "name": "-moz-box-pack"
      },
      {
        "name": "-moz-box-sizing"
      },
      {
        "name": "-moz-column-count"
      },
      {
        "name": "-moz-column-gap"
      },
      {
        "name": "-moz-column-rule"
      },
      {
        "name": "-moz-column-rule-color"
      },
      {
        "name": "-moz-column-rule-style"
      },
      {
        "name": "-moz-column-rule-width"
      },
      {
        "name": "-moz-column-width"
      },
      {
        "name": "-moz-columns"
      },
      {
        "name": "-moz-context-properties",
        "status": "nonstandard"
      },
      {
        "name": "-moz-float-edge",
        "status": "obsolete"
      },
      {
        "name": "-moz-font-feature-settings"
      },
      {
        "name": "-moz-force-broken-image-icon",
        "status": "obsolete"
      },
      {
        "name": "-moz-hyphens"
      },
      {
        "name": "-moz-orient",
        "status": "nonstandard"
      },
      {
        "name": "-moz-outline-radius",
        "status": "nonstandard"
      },
      {
        "name": "-moz-outline-radius-bottomleft",
        "status": "nonstandard"
      },
      {
        "name": "-moz-outline-radius-bottomright",
        "status": "nonstandard"
      },
      {
        "name": "-moz-outline-radius-topleft",
        "status": "nonstandard"
      },
      {
        "name": "-moz-outline-radius-topright",
        "status": "nonstandard"
      },
      {
        "name": "-moz-perspective"
      },
      {
        "name": "-moz-perspective-origin"
      },
      {
        "name": "-moz-stack-sizing",
        "status": "nonstandard"
      },
      {
        "name": "-moz-text-align-last"
      },
      {
        "name": "-moz-text-blink",
        "status": "nonstandard"
      },
      {
        "name": "-moz-text-decoration-color"
      },
      {
        "name": "-moz-text-decoration-line"
      },
      {
        "name": "-moz-text-decoration-style"
      },
      {
        "name": "-moz-text-size-adjust"
      },
      {
        "name": "-moz-transform"
      },
      {
        "name": "-moz-transform-origin"
      },
      {
        "name": "-moz-transition"
      },
      {
        "name": "-moz-transition-delay"
      },
      {
        "name": "-moz-transition-duration"
      },
      {
        "name": "-moz-transition-property"
      },
      {
        "name": "-moz-transition-timing-function"
      },
      {
        "name": "-moz-user-focus",
        "status": "obsolete"
      },
      {
        "name": "-moz-user-input",
        "status": "obsolete"
      },
      {
        "name": "-moz-user-modify",
        "status": "nonstandard"
      },
      {
        "name": "-moz-user-select"
      },
      {
        "name": "-moz-window-dragging",
        "status": "nonstandard"
      },
      {
        "name": "-moz-window-shadow",
        "status": "nonstandard"
      },
      {
        "name": "-ms-accelerator",
        "status": "nonstandard"
      },
      {
        "name": "-ms-behavior"
      },
      {
        "name": "-ms-block-progression",
        "status": "nonstandard"
      },
      {
        "name": "-ms-content-zoom-chaining",
        "status": "nonstandard"
      },
      {
        "name": "-ms-content-zoom-limit",
        "status": "nonstandard"
      },
      {
        "name": "-ms-content-zoom-limit-max",
        "status": "nonstandard"
      },
      {
        "name": "-ms-content-zoom-limit-min",
        "status": "nonstandard"
      },
      {
        "name": "-ms-content-zoom-snap",
        "status": "nonstandard"
      },
      {
        "name": "-ms-content-zoom-snap-points",
        "status": "nonstandard"
      },
      {
        "name": "-ms-content-zoom-snap-type",
        "status": "nonstandard"
      },
      {
        "name": "-ms-content-zooming",
        "status": "nonstandard"
      },
      {
        "name": "-ms-filter",
        "status": "nonstandard"
      },
      {
        "name": "-ms-flex"
      },
      {
        "name": "-ms-flex-align"
      },
      {
        "name": "-ms-flex-direction"
      },
      {
        "name": "-ms-flex-flow"
      },
      {
        "name": "-ms-flex-item-align"
      },
      {
        "name": "-ms-flex-line-pack"
      },
      {
        "name": "-ms-flex-order"
      },
      {
        "name": "-ms-flex-pack"
      },
      {
        "name": "-ms-flex-wrap"
      },
      {
        "name": "-ms-flow-from",
        "status": "nonstandard"
      },
      {
        "name": "-ms-flow-into",
        "status": "nonstandard"
      },
      {
        "name": "-ms-grid-column"
      },
      {
        "name": "-ms-grid-column-align"
      },
      {
        "name": "-ms-grid-column-span"
      },
      {
        "name": "-ms-grid-columns",
        "status": "nonstandard"
      },
      {
        "name": "-ms-grid-layer"
      },
      {
        "name": "-ms-grid-row"
      },
      {
        "name": "-ms-grid-row-align"
      },
      {
        "name": "-ms-grid-row-span"
      },
      {
        "name": "-ms-grid-rows",
        "status": "nonstandard"
      },
      {
        "name": "-ms-high-contrast-adjust",
        "status": "nonstandard"
      },
      {
        "name": "-ms-hyphenate-limit-chars",
        "status": "nonstandard"
      },
      {
        "name": "-ms-hyphenate-limit-lines",
        "status": "nonstandard"
      },
      {
        "name": "-ms-hyphenate-limit-zone",
        "status": "nonstandard"
      },
      {
        "name": "-ms-hyphens"
      },
      {
        "name": "-ms-ime-align",
        "status": "nonstandard"
      },
      {
        "name": "-ms-ime-mode"
      },
      {
        "name": "-ms-interpolation-mode"
      },
      {
        "name": "-ms-layout-grid"
      },
      {
        "name": "-ms-layout-grid-char"
      },
      {
        "name": "-ms-layout-grid-line"
      },
      {
        "name": "-ms-layout-grid-mode"
      },
      {
        "name": "-ms-layout-grid-type"
      },
      {
        "name": "-ms-line-break"
      },
      {
        "name": "-ms-overflow-style",
        "status": "nonstandard"
      },
      {
        "name": "-ms-perspective"
      },
      {
        "name": "-ms-perspective-origin"
      },
      {
        "name": "-ms-perspective-origin-x"
      },
      {
        "name": "-ms-perspective-origin-y"
      },
      {
        "name": "-ms-progress-appearance"
      },
      {
        "name": "-ms-scroll-chaining",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-limit",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-limit-x-max",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-limit-x-min",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-limit-y-max",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-limit-y-min",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-rails",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-snap-points-x",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-snap-points-y",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-snap-type",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-snap-x",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-snap-y",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scroll-translation",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scrollbar-3dlight-color",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scrollbar-arrow-color",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scrollbar-base-color",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scrollbar-darkshadow-color",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scrollbar-face-color",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scrollbar-highlight-color",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scrollbar-shadow-color",
        "status": "nonstandard"
      },
      {
        "name": "-ms-scrollbar-track-color",
        "status": "nonstandard"
      },
      {
        "name": "-ms-text-align-last"
      },
      {
        "name": "-ms-text-autospace",
        "status": "nonstandard"
      },
      {
        "name": "-ms-text-combine-horizontal"
      },
      {
        "name": "-ms-text-justify"
      },
      {
        "name": "-ms-text-kashida-space"
      },
      {
        "name": "-ms-text-overflow"
      },
      {
        "name": "-ms-text-size-adjust"
      },
      {
        "name": "-ms-text-underline-position"
      },
      {
        "name": "-ms-touch-action"
      },
      {
        "name": "-ms-touch-select",
        "status": "nonstandard"
      },
      {
        "name": "-ms-transform"
      },
      {
        "name": "-ms-transform-origin"
      },
      {
        "name": "-ms-transform-origin-x"
      },
      {
        "name": "-ms-transform-origin-y"
      },
      {
        "name": "-ms-transform-origin-z"
      },
      {
        "name": "-ms-user-select",
        "status": "nonstandard"
      },
      {
        "name": "-ms-word-break"
      },
      {
        "name": "-ms-word-wrap"
      },
      {
        "name": "-ms-wrap-flow",
        "status": "nonstandard"
      },
      {
        "name": "-ms-wrap-margin",
        "status": "nonstandard"
      },
      {
        "name": "-ms-wrap-through",
        "status": "nonstandard"
      },
      {
        "name": "-ms-writing-mode"
      },
      {
        "name": "-ms-zoom"
      },
      {
        "name": "-ms-zoom-animation"
      },
      {
        "name": "-o-animation"
      },
      {
        "name": "-o-animation-delay"
      },
      {
        "name": "-o-animation-direction"
      },
      {
        "name": "-o-animation-duration"
      },
      {
        "name": "-o-animation-fill-mode"
      },
      {
        "name": "-o-animation-iteration-count"
      },
      {
        "name": "-o-animation-name"
      },
      {
        "name": "-o-animation-play-state"
      },
      {
        "name": "-o-animation-timing-function"
      },
      {
        "name": "-o-border-image"
      },
      {
        "name": "-o-object-fit"
      },
      {
        "name": "-o-object-position"
      },
      {
        "name": "-o-tab-size"
      },
      {
        "name": "-o-table-baseline"
      },
      {
        "name": "-o-text-overflow"
      },
      {
        "name": "-o-transform"
      },
      {
        "name": "-o-transform-origin"
      },
      {
        "name": "-o-transition"
      },
      {
        "name": "-o-transition-delay"
      },
      {
        "name": "-o-transition-duration"
      },
      {
        "name": "-o-transition-property"
      },
      {
        "name": "-o-transition-timing-function"
      },
      {
        "name": "-webkit-animation"
      },
      {
        "name": "-webkit-animation-delay"
      },
      {
        "name": "-webkit-animation-direction"
      },
      {
        "name": "-webkit-animation-duration"
      },
      {
        "name": "-webkit-animation-fill-mode"
      },
      {
        "name": "-webkit-animation-iteration-count"
      },
      {
        "name": "-webkit-animation-name"
      },
      {
        "name": "-webkit-animation-play-state"
      },
      {
        "name": "-webkit-animation-timing-function"
      },
      {
        "name": "-webkit-appearance",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-backdrop-filter"
      },
      {
        "name": "-webkit-backface-visibility"
      },
      {
        "name": "-webkit-background-clip"
      },
      {
        "name": "-webkit-background-composite"
      },
      {
        "name": "-webkit-background-origin"
      },
      {
        "name": "-webkit-border-before",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-border-before-color",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-border-before-style",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-border-before-width",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-border-image"
      },
      {
        "name": "-webkit-box-align"
      },
      {
        "name": "-webkit-box-direction"
      },
      {
        "name": "-webkit-box-flex"
      },
      {
        "name": "-webkit-box-flex-group"
      },
      {
        "name": "-webkit-box-ordinal-group"
      },
      {
        "name": "-webkit-box-orient"
      },
      {
        "name": "-webkit-box-pack"
      },
      {
        "name": "-webkit-box-reflect",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-box-sizing"
      },
      {
        "name": "-webkit-break-after"
      },
      {
        "name": "-webkit-break-before"
      },
      {
        "name": "-webkit-break-inside"
      },
      {
        "name": "-webkit-column-break-after"
      },
      {
        "name": "-webkit-column-break-before"
      },
      {
        "name": "-webkit-column-break-inside"
      },
      {
        "name": "-webkit-column-count"
      },
      {
        "name": "-webkit-column-gap"
      },
      {
        "name": "-webkit-column-rule"
      },
      {
        "name": "-webkit-column-rule-color"
      },
      {
        "name": "-webkit-column-rule-style"
      },
      {
        "name": "-webkit-column-rule-width"
      },
      {
        "name": "-webkit-column-span"
      },
      {
        "name": "-webkit-column-width"
      },
      {
        "name": "-webkit-columns"
      },
      {
        "name": "-webkit-filter"
      },
      {
        "name": "-webkit-flow-from"
      },
      {
        "name": "-webkit-flow-into"
      },
      {
        "name": "-webkit-font-feature-settings"
      },
      {
        "name": "-webkit-hyphens"
      },
      {
        "name": "-webkit-line-break"
      },
      {
        "name": "-webkit-line-clamp"
      },
      {
        "name": "-webkit-margin-bottom-collapse"
      },
      {
        "name": "-webkit-margin-collapse"
      },
      {
        "name": "-webkit-margin-start"
      },
      {
        "name": "-webkit-margin-top-collapse"
      },
      {
        "name": "-webkit-mask",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-attachment",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-clip",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-composite",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-image",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-origin",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-position",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-position-x",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-position-y",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-repeat",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-repeat-x",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-repeat-y",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-mask-size",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-nbsp-mode"
      },
      {
        "name": "-webkit-overflow-scrolling",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-padding-start"
      },
      {
        "name": "-webkit-perspective"
      },
      {
        "name": "-webkit-perspective-origin"
      },
      {
        "name": "-webkit-region-fragment"
      },
      {
        "name": "-webkit-tap-highlight-color",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-text-fill-color"
      },
      {
        "name": "-webkit-text-size-adjust"
      },
      {
        "name": "-webkit-text-stroke"
      },
      {
        "name": "-webkit-text-stroke-color"
      },
      {
        "name": "-webkit-text-stroke-width"
      },
      {
        "name": "-webkit-touch-callout",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-transform"
      },
      {
        "name": "-webkit-transform-origin"
      },
      {
        "name": "-webkit-transform-origin-x"
      },
      {
        "name": "-webkit-transform-origin-y"
      },
      {
        "name": "-webkit-transform-origin-z"
      },
      {
        "name": "-webkit-transform-style"
      },
      {
        "name": "-webkit-transition"
      },
      {
        "name": "-webkit-transition-delay"
      },
      {
        "name": "-webkit-transition-duration"
      },
      {
        "name": "-webkit-transition-property"
      },
      {
        "name": "-webkit-transition-timing-function"
      },
      {
        "name": "-webkit-user-drag"
      },
      {
        "name": "-webkit-user-modify",
        "status": "nonstandard"
      },
      {
        "name": "-webkit-user-select",
        "status": "nonstandard"
      },
      {
        "name": "accent-color"
      },
      {
        "name": "additive-symbols"
      },
      {
        "name": "align-content"
      },
      {
        "name": "align-items"
      },
      {
        "name": "align-self"
      },
      {
        "name": "align-tracks",
        "status": "nonstandard"
      },
      {
        "name": "alignment-baseline"
      },
      {
        "name": "all"
      },
      {
        "name": "alt"
      },
      {
        "name": "anchor-name"
      },
      {
        "name": "anchor-scope"
      },
      {
        "name": "animation"
      },
      {
        "name": "animation-composition"
      },
      {
        "name": "animation-delay"
      },
      {
        "name": "animation-direction"
      },
      {
        "name": "animation-duration"
      },
      {
        "name": "animation-fill-mode"
      },
      {
        "name": "animation-iteration-count"
      },
      {
        "name": "animation-name"
      },
      {
        "name": "animation-play-state"
      },
      {
        "name": "animation-range"
      },
      {
        "name": "animation-range-end"
      },
      {
        "name": "animation-range-start"
      },
      {
        "name": "animation-timeline"
      },
      {
        "name": "animation-timing-function"
      },
      {
        "name": "animation-trigger"
      },
      {
        "name": "appearance"
      },
      {
        "name": "ascent-override"
      },
      {
        "name": "aspect-ratio"
      },
      {
        "name": "backdrop-filter"
      },
      {
        "name": "backface-visibility"
      },
      {
        "name": "background"
      },
      {
        "name": "background-attachment"
      },
      {
        "name": "background-blend-mode"
      },
      {
        "name": "background-clip"
      },
      {
        "name": "background-color"
      },
      {
        "name": "background-image"
      },
      {
        "name": "background-origin"
      },
      {
        "name": "background-position"
      },
      {
        "name": "background-position-x"
      },
      {
        "name": "background-position-y"
      },
      {
        "name": "background-repeat"
      },
      {
        "name": "background-size"
      },
      {
        "name": "base-palette"
      },
      {
        "name": "baseline-shift"
      },
      {
        "name": "baseline-source"
      },
      {
        "name": "behavior"
      },
      {
        "name": "bleed"
      },
      {
        "name": "block-size"
      },
      {
        "name": "border"
      },
      {
        "name": "border-block"
      },
      {
        "name": "border-block-color"
      },
      {
        "name": "border-block-end"
      },
      {
        "name": "border-block-end-color"
      },
      {
        "name": "border-block-end-style"
      },
      {
        "name": "border-block-end-width"
      },
      {
        "name": "border-block-start"
      },
      {
        "name": "border-block-start-color"
      },
      {
        "name": "border-block-start-style"
      },
      {
        "name": "border-block-start-width"
      },
      {
        "name": "border-block-style"
      },
      {
        "name": "border-block-width"
      },
      {
        "name": "border-bottom"
      },
      {
        "name": "border-bottom-color"
      },
      {
        "name": "border-bottom-left-radius"
      },
      {
        "name": "border-bottom-right-radius"
      },
      {
        "name": "border-bottom-style"
      },
      {
        "name": "border-bottom-width"
      },
      {
        "name": "border-collapse"
      },
      {
        "name": "border-color"
      },
      {
        "name": "border-end-end-radius"
      },
      {
        "name": "border-end-start-radius"
      },
      {
        "name": "border-image"
      },
      {
        "name": "border-image-outset"
      },
      {
        "name": "border-image-repeat"
      },
      {
        "name": "border-image-slice"
      },
      {
        "name": "border-image-source"
      },
      {
        "name": "border-image-width"
      },
      {
        "name": "border-inline"
      },
      {
        "name": "border-inline-color"
      },
      {
        "name": "border-inline-end"
      },
      {
        "name": "border-inline-end-color"
      },
      {
        "name": "border-inline-end-style"
      },
      {
        "name": "border-inline-end-width"
      },
      {
        "name": "border-inline-start"
      },
      {
        "name": "border-inline-start-color"
      },
      {
        "name": "border-inline-start-style"
      },
      {
        "name": "border-inline-start-width"
      },
      {
        "name": "border-inline-style"
      },
      {
        "name": "border-inline-width"
      },
      {
        "name": "border-left"
      },
      {
        "name": "border-left-color"
      },
      {
        "name": "border-left-style"
      },
      {
        "name": "border-left-width"
      },
      {
        "name": "border-radius"
      },
      {
        "name": "border-right"
      },
      {
        "name": "border-right-color"
      },
      {
        "name": "border-right-style"
      },
      {
        "name": "border-right-width"
      },
      {
        "name": "border-spacing"
      },
      {
        "name": "border-start-end-radius"
      },
      {
        "name": "border-start-start-radius"
      },
      {
        "name": "border-style"
      },
      {
        "name": "border-top"
      },
      {
        "name": "border-top-color"
      },
      {
        "name": "border-top-left-radius"
      },
      {
        "name": "border-top-right-radius"
      },
      {
        "name": "border-top-style"
      },
      {
        "name": "border-top-width"
      },
      {
        "name": "border-width"
      },
      {
        "name": "bottom"
      },
      {
        "name": "box-align",
        "status": "obsolete"
      },
      {
        "name": "box-decoration-break"
      },
      {
        "name": "box-direction",
        "status": "obsolete"
      },
      {
        "name": "box-flex",
        "status": "obsolete"
      },
      {
        "name": "box-flex-group",
        "status": "obsolete"
      },
      {
        "name": "box-lines",
        "status": "obsolete"
      },
      {
        "name": "box-ordinal-group",
        "status": "obsolete"
      },
      {
        "name": "box-orient",
        "status": "obsolete"
      },
      {
        "name": "box-pack",
        "status": "obsolete"
      },
      {
        "name": "box-shadow"
      },
      {
        "name": "box-sizing"
      },
      {
        "name": "break-after"
      },
      {
        "name": "break-before"
      },
      {
        "name": "break-inside"
      },
      {
        "name": "caption-side"
      },
      {
        "name": "caret"
      },
      {
        "name": "caret-animation"
      },
      {
        "name": "caret-color"
      },
      {
        "name": "caret-shape"
      },
      {
        "name": "clear"
      },
      {
        "name": "clip",
        "status": "obsolete"
      },
      {
        "name": "clip-path"
      },
      {
        "name": "clip-rule"
      },
      {
        "name": "color"
      },
      {
        "name": "color-interpolation-filters"
      },
      {
        "name": "color-scheme"
      },
      {
        "name": "column-count"
      },
      {
        "name": "column-fill"
      },
      {
        "name": "column-gap"
      },
      {
        "name": "column-height"
      },
      {
        "name": "column-rule"
      },
      {
        "name": "column-rule-color"
      },
      {
        "name": "column-rule-style"
      },
      {
        "name": "column-rule-width"
      },
      {
        "name": "column-span"
      },
      {
        "name": "column-width"
      },
      {
        "name": "column-wrap"
      },
      {
        "name": "columns"
      },
      {
        "name": "contain"
      },
      {
        "name": "contain-intrinsic-block-size"
      },
      {
        "name": "contain-intrinsic-height"
      },
      {
        "name": "contain-intrinsic-inline-size"
      },
      {
        "name": "contain-intrinsic-size"
      },
      {
        "name": "contain-intrinsic-width"
      },
      {
        "name": "container"
      },
      {
        "name": "container-name"
      },
      {
        "name": "container-type"
      },
      {
        "name": "content"
      },
      {
        "name": "content-visibility"
      },
      {
        "name": "corner-block-end-shape"
      },
      {
        "name": "corner-block-start-shape"
      },
      {
        "name": "corner-bottom-left-shape"
      },
      {
        "name": "corner-bottom-right-shape"
      },
      {
        "name": "corner-bottom-shape"
      },
      {
        "name": "corner-end-end-shape"
      },
      {
        "name": "corner-end-start-shape"
      },
      {
        "name": "corner-inline-end-shape"
      },
      {
        "name": "corner-inline-start-shape"
      },
      {
        "name": "corner-left-shape"
      },
      {
        "name": "corner-right-shape"
      },
      {
        "name": "corner-shape"
      },
      {
        "name": "corner-start-end-shape"
      },
      {
        "name": "corner-start-start-shape"
      },
      {
        "name": "corner-top-left-shape"
      },
      {
        "name": "corner-top-right-shape"
      },
      {
        "name": "corner-top-shape"
      },
      {
        "name": "counter-increment"
      },
      {
        "name": "counter-reset"
      },
      {
        "name": "counter-set"
      },
      {
        "name": "cursor"
      },
      {
        "name": "cx"
      },
      {
        "name": "cy"
      },
      {
        "name": "d"
      },
      {
        "name": "descent-override"
      },
      {
        "name": "direction"
      },
      {
        "name": "display"
      },
      {
        "name": "dominant-baseline"
      },
      {
        "name": "dynamic-range-limit"
      },
      {
        "name": "empty-cells"
      },
      {
        "name": "enable-background"
      },
      {
        "name": "fallback"
      },
      {
        "name": "field-sizing"
      },
      {
        "name": "fill"
      },
      {
        "name": "fill-opacity"
      },
      {
        "name": "fill-rule"
      },
      {
        "name": "filter"
      },
      {
        "name": "flex"
      },
      {
        "name": "flex-basis"
      },
      {
        "name": "flex-direction"
      },
      {
        "name": "flex-flow"
      },
      {
        "name": "flex-grow"
      },
      {
        "name": "flex-shrink"
      },
      {
        "name": "flex-wrap"
      },
      {
        "name": "float"
      },
      {
        "name": "flood-color"
      },
      {
        "name": "flood-opacity"
      },
      {
        "name": "font"
      },
      {
        "name": "font-display"
      },
      {
        "name": "font-family"
      },
      {
        "name": "font-feature-settings"
      },
      {
        "name": "font-kerning"
      },
      {
        "name": "font-language-override"
      },
      {
        "name": "font-optical-sizing"
      },
      {
        "name": "font-palette"
      },
      {
        "name": "font-size"
      },
      {
        "name": "font-size-adjust"
      },
      {
        "name": "font-smooth",
        "status": "nonstandard"
      },
      {
        "name": "font-stretch",
        "status": "obsolete"
      },
      {
        "name": "font-style"
      },
      {
        "name": "font-synthesis"
      },
      {
        "name": "font-synthesis-position",
        "status": "experimental"
      },
      {
        "name": "font-synthesis-small-caps"
      },
      {
        "name": "font-synthesis-style"
      },
      {
        "name": "font-synthesis-weight"
      },
      {
        "name": "font-variant"
      },
      {
        "name": "font-variant-alternates"
      },
      {
        "name": "font-variant-caps"
      },
      {
        "name": "font-variant-east-asian"
      },
      {
        "name": "font-variant-emoji"
      },
      {
        "name": "font-variant-ligatures"
      },
      {
        "name": "font-variant-numeric"
      },
      {
        "name": "font-variant-position"
      },
      {
        "name": "font-variation-settings"
      },
      {
        "name": "font-weight"
      },
      {
        "name": "font-width",
        "status": "experimental"
      },
      {
        "name": "forced-color-adjust"
      },
      {
        "name": "gap"
      },
      {
        "name": "glyph-orientation-horizontal"
      },
      {
        "name": "glyph-orientation-vertical"
      },
      {
        "name": "grid"
      },
      {
        "name": "grid-area"
      },
      {
        "name": "grid-auto-columns"
      },
      {
        "name": "grid-auto-flow"
      },
      {
        "name": "grid-auto-rows"
      },
      {
        "name": "grid-column"
      },
      {
        "name": "grid-column-end"
      },
      {
        "name": "grid-column-gap",
        "status": "obsolete"
      },
      {
        "name": "grid-column-start"
      },
      {
        "name": "grid-gap",
        "status": "obsolete"
      },
      {
        "name": "grid-row"
      },
      {
        "name": "grid-row-end"
      },
      {
        "name": "grid-row-gap",
        "status": "obsolete"
      },
      {
        "name": "grid-row-start"
      },
      {
        "name": "grid-template"
      },
      {
        "name": "grid-template-areas"
      },
      {
        "name": "grid-template-columns"
      },
      {
        "name": "grid-template-rows"
      },
      {
        "name": "hanging-punctuation"
      },
      {
        "name": "height"
      },
      {
        "name": "hyphenate-character"
      },
      {
        "name": "hyphenate-limit-chars"
      },
      {
        "name": "hyphens"
      },
      {
        "name": "image-orientation"
      },
      {
        "name": "image-rendering"
      },
      {
        "name": "image-resolution",
        "status": "experimental"
      },
      {
        "name": "ime-mode",
        "status": "obsolete"
      },
      {
        "name": "inherits"
      },
      {
        "name": "initial-letter"
      },
      {
        "name": "initial-letter-align",
        "status": "experimental"
      },
      {
        "name": "initial-value"
      },
      {
        "name": "inline-size"
      },
      {
        "name": "inset"
      },
      {
        "name": "inset-block"
      },
      {
        "name": "inset-block-end"
      },
      {
        "name": "inset-block-start"
      },
      {
        "name": "inset-inline"
      },
      {
        "name": "inset-inline-end"
      },
      {
        "name": "inset-inline-start"
      },
      {
        "name": "interactivity"
      },
      {
        "name": "interest-delay"
      },
      {
        "name": "interest-delay-end"
      },
      {
        "name": "interest-delay-start"
      },
      {
        "name": "interpolate-size",
        "status": "experimental"
      },
      {
        "name": "isolation"
      },
      {
        "name": "justify-content"
      },
      {
        "name": "justify-items"
      },
      {
        "name": "justify-self"
      },
      {
        "name": "justify-tracks",
        "status": "nonstandard"
      },
      {
        "name": "kerning"
      },
      {
        "name": "left"
      },
      {
        "name": "letter-spacing"
      },
      {
        "name": "lighting-color"
      },
      {
        "name": "line-break"
      },
      {
        "name": "line-clamp"
      },
      {
        "name": "line-gap-override"
      },
      {
        "name": "line-height"
      },
      {
        "name": "line-height-step",
        "status": "experimental"
      },
      {
        "name": "list-style"
      },
      {
        "name": "list-style-image"
      },
      {
        "name": "list-style-position"
      },
      {
        "name": "list-style-type"
      },
      {
        "name": "margin"
      },
      {
        "name": "margin-block"
      },
      {
        "name": "margin-block-end"
      },
      {
        "name": "margin-block-start"
      },
      {
        "name": "margin-bottom"
      },
      {
        "name": "margin-inline"
      },
      {
        "name": "margin-inline-end"
      },
      {
        "name": "margin-inline-start"
      },
      {
        "name": "margin-left"
      },
      {
        "name": "margin-right"
      },
      {
        "name": "margin-top"
      },
      {
        "name": "margin-trim",
        "status": "experimental"
      },
      {
        "name": "marker"
      },
      {
        "name": "marker-end"
      },
      {
        "name": "marker-mid"
      },
      {
        "name": "marker-start"
      },
      {
        "name": "marks"
      },
      {
        "name": "mask"
      },
      {
        "name": "mask-border"
      },
      {
        "name": "mask-border-mode"
      },
      {
        "name": "mask-border-outset"
      },
      {
        "name": "mask-border-repeat"
      },
      {
        "name": "mask-border-slice"
      },
      {
        "name": "mask-border-source"
      },
      {
        "name": "mask-border-width"
      },
      {
        "name": "mask-clip"
      },
      {
        "name": "mask-composite"
      },
      {
        "name": "mask-image"
      },
      {
        "name": "mask-mode"
      },
      {
        "name": "mask-origin"
      },
      {
        "name": "mask-position"
      },
      {
        "name": "mask-repeat"
      },
      {
        "name": "mask-size"
      },
      {
        "name": "mask-type"
      },
      {
        "name": "masonry-auto-flow",
        "status": "nonstandard"
      },
      {
        "name": "math-depth"
      },
      {
        "name": "math-shift"
      },
      {
        "name": "math-style"
      },
      {
        "name": "max-block-size"
      },
      {
        "name": "max-height"
      },
      {
        "name": "max-inline-size"
      },
      {
        "name": "max-lines",
        "status": "experimental"
      },
      {
        "name": "max-width"
      },
      {
        "name": "min-block-size"
      },
      {
        "name": "min-height"
      },
      {
        "name": "min-inline-size"
      },
      {
        "name": "min-width"
      },
      {
        "name": "mix-blend-mode"
      },
      {
        "name": "motion"
      },
      {
        "name": "motion-offset"
      },
      {
        "name": "motion-path"
      },
      {
        "name": "motion-rotation"
      },
      {
        "name": "nav-down"
      },
      {
        "name": "nav-index"
      },
      {
        "name": "nav-left"
      },
      {
        "name": "nav-right"
      },
      {
        "name": "nav-up"
      },
      {
        "name": "navigation"
      },
      {
        "name": "negative"
      },
      {
        "name": "object-fit"
      },
      {
        "name": "object-position"
      },
      {
        "name": "object-view-box",
        "status": "experimental"
      },
      {
        "name": "offset"
      },
      {
        "name": "offset-anchor"
      },
      {
        "name": "offset-block-end"
      },
      {
        "name": "offset-block-start"
      },
      {
        "name": "offset-distance"
      },
      {
        "name": "offset-inline-end"
      },
      {
        "name": "offset-inline-start"
      },
      {
        "name": "offset-path"
      },
      {
        "name": "offset-position"
      },
      {
        "name": "offset-rotate"
      },
      {
        "name": "opacity"
      },
      {
        "name": "order"
      },
      {
        "name": "orphans"
      },
      {
        "name": "outline"
      },
      {
        "name": "outline-color"
      },
      {
        "name": "outline-offset"
      },
      {
        "name": "outline-style"
      },
      {
        "name": "outline-width"
      },
      {
        "name": "overflow"
      },
      {
        "name": "overflow-anchor"
      },
      {
        "name": "overflow-block"
      },
      {
        "name": "overflow-clip-box",
        "status": "nonstandard"
      },
      {
        "name": "overflow-clip-margin"
      },
      {
        "name": "overflow-inline"
      },
      {
        "name": "overflow-wrap"
      },
      {
        "name": "overflow-x"
      },
      {
        "name": "overflow-y"
      },
      {
        "name": "overlay",
        "status": "experimental"
      },
      {
        "name": "override-colors"
      },
      {
        "name": "overscroll-behavior"
      },
      {
        "name": "overscroll-behavior-block"
      },
      {
        "name": "overscroll-behavior-inline"
      },
      {
        "name": "overscroll-behavior-x"
      },
      {
        "name": "overscroll-behavior-y"
      },
      {
        "name": "pad"
      },
      {
        "name": "padding"
      },
      {
        "name": "padding-block"
      },
      {
        "name": "padding-block-end"
      },
      {
        "name": "padding-block-start"
      },
      {
        "name": "padding-bottom"
      },
      {
        "name": "padding-inline"
      },
      {
        "name": "padding-inline-end"
      },
      {
        "name": "padding-inline-start"
      },
      {
        "name": "padding-left"
      },
      {
        "name": "padding-right"
      },
      {
        "name": "padding-top"
      },
      {
        "name": "page"
      },
      {
        "name": "page-break-after",
        "status": "obsolete"
      },
      {
        "name": "page-break-before",
        "status": "obsolete"
      },
      {
        "name": "page-break-inside",
        "status": "obsolete"
      },
      {
        "name": "page-orientation"
      },
      {
        "name": "paint-order"
      },
      {
        "name": "perspective"
      },
      {
        "name": "perspective-origin"
      },
      {
        "name": "place-content"
      },
      {
        "name": "place-items"
      },
      {
        "name": "place-self"
      },
      {
        "name": "pointer-events"
      },
      {
        "name": "position"
      },
      {
        "name": "position-anchor"
      },
      {
        "name": "position-area"
      },
      {
        "name": "position-try"
      },
      {
        "name": "position-try-fallbacks"
      },
      {
        "name": "position-try-order"
      },
      {
        "name": "position-visibility"
      },
      {
        "name": "prefix"
      },
      {
        "name": "print-color-adjust"
      },
      {
        "name": "quotes"
      },
      {
        "name": "r"
      },
      {
        "name": "range"
      },
      {
        "name": "reading-flow"
      },
      {
        "name": "reading-order"
      },
      {
        "name": "resize"
      },
      {
        "name": "right"
      },
      {
        "name": "rotate"
      },
      {
        "name": "row-gap"
      },
      {
        "name": "ruby-align"
      },
      {
        "name": "ruby-merge",
        "status": "experimental"
      },
      {
        "name": "ruby-overhang"
      },
      {
        "name": "ruby-position"
      },
      {
        "name": "ruby-span"
      },
      {
        "name": "rx"
      },
      {
        "name": "ry"
      },
      {
        "name": "scale"
      },
      {
        "name": "scroll-behavior"
      },
      {
        "name": "scroll-initial-target",
        "status": "experimental"
      },
      {
        "name": "scroll-margin"
      },
      {
        "name": "scroll-margin-block"
      },
      {
        "name": "scroll-margin-block-end"
      },
      {
        "name": "scroll-margin-block-start"
      },
      {
        "name": "scroll-margin-bottom"
      },
      {
        "name": "scroll-margin-inline"
      },
      {
        "name": "scroll-margin-inline-end"
      },
      {
        "name": "scroll-margin-inline-start"
      },
      {
        "name": "scroll-margin-left"
      },
      {
        "name": "scroll-margin-right"
      },
      {
        "name": "scroll-margin-top"
      },
      {
        "name": "scroll-marker-group"
      },
      {
        "name": "scroll-padding"
      },
      {
        "name": "scroll-padding-block"
      },
      {
        "name": "scroll-padding-block-end"
      },
      {
        "name": "scroll-padding-block-start"
      },
      {
        "name": "scroll-padding-bottom"
      },
      {
        "name": "scroll-padding-inline"
      },
      {
        "name": "scroll-padding-inline-end"
      },
      {
        "name": "scroll-padding-inline-start"
      },
      {
        "name": "scroll-padding-left"
      },
      {
        "name": "scroll-padding-right"
      },
      {
        "name": "scroll-padding-top"
      },
      {
        "name": "scroll-snap-align"
      },
      {
        "name": "scroll-snap-coordinate",
        "status": "obsolete"
      },
      {
        "name": "scroll-snap-destination",
        "status": "obsolete"
      },
      {
        "name": "scroll-snap-points-x",
        "status": "obsolete"
      },
      {
        "name": "scroll-snap-points-y",
        "status": "obsolete"
      },
      {
        "name": "scroll-snap-stop"
      },
      {
        "name": "scroll-snap-type"
      },
      {
        "name": "scroll-snap-type-x",
        "status": "obsolete"
      },
      {
        "name": "scroll-snap-type-y",
        "status": "obsolete"
      },
      {
        "name": "scroll-target-group"
      },
      {
        "name": "scroll-timeline"
      },
      {
        "name": "scroll-timeline-axis"
      },
      {
        "name": "scroll-timeline-name"
      },
      {
        "name": "scrollbar-3dlight-color"
      },
      {
        "name": "scrollbar-arrow-color"
      },
      {
        "name": "scrollbar-base-color"
      },
      {
        "name": "scrollbar-color"
      },
      {
        "name": "scrollbar-darkshadow-color"
      },
      {
        "name": "scrollbar-face-color"
      },
      {
        "name": "scrollbar-gutter"
      },
      {
        "name": "scrollbar-highlight-color"
      },
      {
        "name": "scrollbar-shadow-color"
      },
      {
        "name": "scrollbar-track-color"
      },
      {
        "name": "scrollbar-width"
      },
      {
        "name": "shape-image-threshold"
      },
      {
        "name": "shape-margin"
      },
      {
        "name": "shape-outside"
      },
      {
        "name": "shape-rendering"
      },
      {
        "name": "size"
      },
      {
        "name": "size-adjust"
      },
      {
        "name": "speak-as"
      },
      {
        "name": "src"
      },
      {
        "name": "stop-color"
      },
      {
        "name": "stop-opacity"
      },
      {
        "name": "stroke"
      },
      {
        "name": "stroke-color",
        "status": "experimental"
      },
      {
        "name": "stroke-dasharray"
      },
      {
        "name": "stroke-dashoffset"
      },
      {
        "name": "stroke-linecap"
      },
      {
        "name": "stroke-linejoin"
      },
      {
        "name": "stroke-miterlimit"
      },
      {
        "name": "stroke-opacity"
      },
      {
        "name": "stroke-width"
      },
      {
        "name": "suffix"
      },
      {
        "name": "symbols"
      },
      {
        "name": "syntax"
      },
      {
        "name": "system"
      },
      {
        "name": "tab-size"
      },
      {
        "name": "table-layout"
      },
      {
        "name": "text-align"
      },
      {
        "name": "text-align-last"
      },
      {
        "name": "text-anchor"
      },
      {
        "name": "text-autospace"
      },
      {
        "name": "text-box"
      },
      {
        "name": "text-box-edge"
      },
      {
        "name": "text-box-trim"
      },
      {
        "name": "text-combine-upright"
      },
      {
        "name": "text-decoration"
      },
      {
        "name": "text-decoration-color"
      },
      {
        "name": "text-decoration-inset"
      },
      {
        "name": "text-decoration-line"
      },
      {
        "name": "text-decoration-skip",
        "status": "experimental"
      },
      {
        "name": "text-decoration-skip-ink"
      },
      {
        "name": "text-decoration-style"
      },
      {
        "name": "text-decoration-thickness"
      },
      {
        "name": "text-emphasis"
      },
      {
        "name": "text-emphasis-color"
      },
      {
        "name": "text-emphasis-position"
      },
      {
        "name": "text-emphasis-style"
      },
      {
        "name": "text-indent"
      },
      {
        "name": "text-justify"
      },
      {
        "name": "text-orientation"
      },
      {
        "name": "text-overflow"
      },
      {
        "name": "text-rendering"
      },
      {
        "name": "text-shadow"
      },
      {
        "name": "text-size-adjust",
        "status": "experimental"
      },
      {
        "name": "text-spacing-trim",
        "status": "experimental"
      },
      {
        "name": "text-transform"
      },
      {
        "name": "text-underline-offset"
      },
      {
        "name": "text-underline-position"
      },
      {
        "name": "text-wrap"
      },
      {
        "name": "text-wrap-mode"
      },
      {
        "name": "text-wrap-style"
      },
      {
        "name": "timeline-scope"
      },
      {
        "name": "timeline-trigger"
      },
      {
        "name": "timeline-trigger-exit-range"
      },
      {
        "name": "timeline-trigger-exit-range-end"
      },
      {
        "name": "timeline-trigger-exit-range-start"
      },
      {
        "name": "timeline-trigger-name"
      },
      {
        "name": "timeline-trigger-range"
      },
      {
        "name": "timeline-trigger-range-end"
      },
      {
        "name": "timeline-trigger-range-start"
      },
      {
        "name": "timeline-trigger-source"
      },
      {
        "name": "top"
      },
      {
        "name": "touch-action"
      },
      {
        "name": "transform"
      },
      {
        "name": "transform-box"
      },
      {
        "name": "transform-origin"
      },
      {
        "name": "transform-style"
      },
      {
        "name": "transition"
      },
      {
        "name": "transition-behavior"
      },
      {
        "name": "transition-delay"
      },
      {
        "name": "transition-duration"
      },
      {
        "name": "transition-property"
      },
      {
        "name": "transition-timing-function"
      },
      {
        "name": "translate"
      },
      {
        "name": "trigger-scope"
      },
      {
        "name": "types"
      },
      {
        "name": "unicode-bidi"
      },
      {
        "name": "unicode-range"
      },
      {
        "name": "user-select"
      },
      {
        "name": "vector-effect"
      },
      {
        "name": "vertical-align"
      },
      {
        "name": "view-timeline"
      },
      {
        "name": "view-timeline-axis"
      },
      {
        "name": "view-timeline-inset"
      },
      {
        "name": "view-timeline-name"
      },
      {
        "name": "view-transition-class"
      },
      {
        "name": "view-transition-name"
      },
      {
        "name": "visibility"
      },
      {
        "name": "white-space"
      },
      {
        "name": "white-space-collapse"
      },
      {
        "name": "widows"
      },
      {
        "name": "width"
      },
      {
        "name": "will-change"
      },
      {
        "name": "word-break"
      },
      {
        "name": "word-spacing"
      },
      {
        "name": "word-wrap"
      },
      {
        "name": "writing-mode"
      },
      {
        "name": "x"
      },
      {
        "name": "y"
      },
      {
        "name": "z-index"
      },
      {
        "name": "zoom"
      }
    ],
    "atDirectives": [
      {
        "name": "@-moz-document"
      },
      {
        "name": "@-moz-keyframes"
      },
      {
        "name": "@-ms-viewport"
      },
      {
        "name": "@-o-keyframes"
      },
      {
        "name": "@-o-viewport"
      },
      {
        "name": "@-webkit-keyframes"
      },
      {
        "name": "@charset"
      },
      {
        "name": "@container"
      },
      {
        "name": "@counter-style"
      },
      {
        "name": "@document"
      },
      {
        "name": "@font-face"
      },
      {
        "name": "@font-feature-values"
      },
      {
        "name": "@font-palette-values"
      },
      {
        "name": "@import"
      },
      {
        "name": "@keyframes"
      },
      {
        "name": "@layer"
      },
      {
        "name": "@media"
      },
      {
        "name": "@namespace"
      },
      {
        "name": "@page"
      },
      {
        "name": "@position-try"
      },
      {
        "name": "@property"
      },
      {
        "name": "@scope"
      },
      {
        "name": "@starting-style"
      },
      {
        "name": "@supports"
      },
      {
        "name": "@view-transition"
      }
    ],
    "pseudoClasses": [],
    "pseudoElements": []
  };

  // src/workers/css-diagnostics-service.ts
  function createFacade(parser, validation) {
    return {
      configure: (settings) => {
        validation.configure(settings);
      },
      doValidation: validation.doValidation.bind(validation),
      parseStylesheet: parser.parseStylesheet.bind(parser)
    };
  }
  var defaultLanguageServiceOptions = {};
  function getCSSDiagnosticsService(options = defaultLanguageServiceOptions) {
    const cssDataManager = new CSSDataManager(options);
    return createFacade(new Parser(), new CSSValidation(cssDataManager));
  }
  function getSCSSDiagnosticsService(options = defaultLanguageServiceOptions) {
    const cssDataManager = new CSSDataManager(options);
    return createFacade(new SCSSParser(), new CSSValidation(cssDataManager));
  }
  function getLESSDiagnosticsService(options = defaultLanguageServiceOptions) {
    const cssDataManager = new CSSDataManager(options);
    return createFacade(new LESSParser(), new CSSValidation(cssDataManager));
  }
  var CSSDataManager = class {
    constructor(options) {
      this.dataProviders = [];
      this._propertySet = {};
      this._atDirectiveSet = {};
      this._pseudoClassSet = {};
      this._pseudoElementSet = {};
      this._properties = [];
      this._atDirectives = [];
      this._pseudoClasses = [];
      this._pseudoElements = [];
      this.setDataProviders((options == null ? void 0 : options.useDefaultDataProvider) !== false, (options == null ? void 0 : options.customDataProviders) || []);
    }
    setDataProviders(builtIn, providers) {
      this.dataProviders = [];
      if (builtIn) {
        this.dataProviders.push(new CSSDataProvider(cssData));
      }
      this.dataProviders.push(...providers);
      this.collectData();
    }
    /**
     * Collect all data  & handle duplicates
     */
    collectData() {
      this._propertySet = {};
      this._atDirectiveSet = {};
      this._pseudoClassSet = {};
      this._pseudoElementSet = {};
      this.dataProviders.forEach((provider) => {
        provider.provideProperties().forEach((p) => {
          if (!this._propertySet[p.name]) {
            this._propertySet[p.name] = p;
          }
        });
        provider.provideAtDirectives().forEach((p) => {
          if (!this._atDirectiveSet[p.name]) {
            this._atDirectiveSet[p.name] = p;
          }
        });
        provider.providePseudoClasses().forEach((p) => {
          if (!this._pseudoClassSet[p.name]) {
            this._pseudoClassSet[p.name] = p;
          }
        });
        provider.providePseudoElements().forEach((p) => {
          if (!this._pseudoElementSet[p.name]) {
            this._pseudoElementSet[p.name] = p;
          }
        });
      });
      this._properties = values(this._propertySet);
      this._atDirectives = values(this._atDirectiveSet);
      this._pseudoClasses = values(this._pseudoClassSet);
      this._pseudoElements = values(this._pseudoElementSet);
    }
    getProperty(name) {
      return this._propertySet[name];
    }
    getAtDirective(name) {
      return this._atDirectiveSet[name];
    }
    getPseudoClass(name) {
      return this._pseudoClassSet[name];
    }
    getPseudoElement(name) {
      return this._pseudoElementSet[name];
    }
    getProperties() {
      return this._properties;
    }
    getAtDirectives() {
      return this._atDirectives;
    }
    getPseudoClasses() {
      return this._pseudoClasses;
    }
    getPseudoElements() {
      return this._pseudoElements;
    }
    isKnownProperty(name) {
      return name.toLowerCase() in this._propertySet;
    }
    isStandardProperty(name) {
      return this.isKnownProperty(name) && (!this._propertySet[name.toLowerCase()].status || this._propertySet[name.toLowerCase()].status === "standard");
    }
  };

  // src/workers/css-worker.ts
  var CssWorker = class extends Mirror {
    constructor(sender) {
      super(sender);
      this.$languageId = "css";
      this.setTimeout(500);
      this.service = getCSSDiagnosticsService();
    }
    setOptions(opts) {
      this.mode = opts && opts.mode;
      this.$configureService();
    }
    $configureService() {
      switch (this.mode) {
        case "less":
          this.$languageId = "less";
          this.service = getLESSDiagnosticsService();
          break;
        case "scss":
          this.$languageId = "scss";
          this.service = getSCSSDiagnosticsService();
          break;
        case "css":
        default:
          this.$languageId = "css";
          this.service = getCSSDiagnosticsService();
          break;
      }
    }
    onUpdate() {
      return __async(this, null, function* () {
        var value = this.doc.getValue();
        var errors = [];
        var fullDocument = new MinTextDocument("file:///foo." + this.$languageId, this.$languageId, 1, value);
        try {
          let cssDocument = this.service.parseStylesheet(fullDocument);
          errors = toAnnotations(this.service.doValidation(fullDocument, cssDocument));
        } catch (e) {
          console.error(e);
        }
        this.sender.emit("annotate", errors);
      });
    }
  };
  return __toCommonJS(css_worker_exports);
})();
aceLegacyWorkerModule = aceLegacyWorkerModule.default || aceLegacyWorkerModule;

exports.Worker = aceLegacyWorkerModule.CssWorker;
});
