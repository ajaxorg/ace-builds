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

ace.define("ace/mode/php_worker", [], function(require, exports, module) {
"use strict";
var globalObj = typeof globalThis !== "undefined" ? globalThis : self;
var processShim = globalObj.process = globalObj.process || {};
processShim.arch = processShim.arch || "x64";
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
        var matches = [];
        string.replace(regExp, function(str) {
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

  // ../../node_modules/php-parser/dist/php-parser.js
  var require_php_parser = __commonJS({
    "../../node_modules/php-parser/dist/php-parser.js"(exports, module) {
      (function webpackUniversalModuleDefinition(root, factory) {
        if (typeof exports === "object" && typeof module === "object")
          module.exports = factory();
        else if (typeof define === "function" && define.amd)
          define([], factory);
        else if (typeof exports === "object")
          exports["PhpParser"] = factory();
        else
          root["PhpParser"] = factory();
      })(self, () => {
        return (
          /******/
          (() => {
            "use strict";
            var __webpack_modules__ = {
              /***/
              8938(module2, __unused_webpack_exports, __webpack_require__2) {
                var Location = __webpack_require__2(4778);
                var Position = __webpack_require__2(8822);
                var AST = function AST2(withPositions, withSource) {
                  this.withPositions = withPositions;
                  this.withSource = withSource;
                };
                AST.precedence = {};
                [
                  ["or"],
                  ["xor"],
                  ["and"],
                  ["="],
                  ["?"],
                  ["??"],
                  ["||"],
                  ["&&"],
                  ["|"],
                  ["^"],
                  ["&"],
                  [
                    "==",
                    "!=",
                    "===",
                    "!==",
                    /* '<>', */
                    "<=>"
                  ],
                  ["<", "<=", ">", ">="],
                  ["<<", ">>"],
                  ["+", "-", "."],
                  ["*", "/", "%"],
                  ["!"],
                  ["instanceof"],
                  ["cast", "silent"],
                  ["**"]
                  // TODO: [ (array)
                  // TODO: clone, new
                ].forEach(function(list, index) {
                  list.forEach(function(operator) {
                    AST.precedence[operator] = index + 1;
                  });
                });
                AST.prototype.isRightAssociative = function(operator) {
                  return operator === "**" || operator === "??";
                };
                AST.prototype.swapLocations = function(target, first, last, parser) {
                  if (this.withPositions) {
                    target.loc.start = first.loc.start;
                    target.loc.end = last.loc.end;
                    if (this.withSource) {
                      target.loc.source = parser.lexer._input.substring(target.loc.start.offset, target.loc.end.offset);
                    }
                  }
                };
                AST.prototype.resolveLocations = function(target, first, last, parser) {
                  if (this.withPositions) {
                    if (target.loc.start.offset > first.loc.start.offset) {
                      target.loc.start = first.loc.start;
                    }
                    if (target.loc.end.offset < last.loc.end.offset) {
                      target.loc.end = last.loc.end;
                    }
                    if (this.withSource) {
                      target.loc.source = parser.lexer._input.substring(target.loc.start.offset, target.loc.end.offset);
                    }
                  }
                };
                AST.prototype.resolvePrecedence = function(result, parser) {
                  var buffer, lLevel, rLevel;
                  if (result.kind === "call") {
                    this.resolveLocations(result, result.what, result, parser);
                  } else if (result.kind === "propertylookup" || result.kind === "staticlookup" || result.kind === "offsetlookup" && result.offset) {
                    this.resolveLocations(result, result.what, result.offset, parser);
                  } else if (result.kind === "bin") {
                    if (result.right && !result.right.parenthesizedExpression) {
                      if (result.right.kind === "bin") {
                        lLevel = AST.precedence[result.type];
                        rLevel = AST.precedence[result.right.type];
                        if (lLevel && rLevel && rLevel <= lLevel && (result.type !== result.right.type || !this.isRightAssociative(result.type))) {
                          buffer = result.right;
                          result.right = result.right.left;
                          this.swapLocations(result, result.left, result.right, parser);
                          buffer.left = this.resolvePrecedence(result, parser);
                          this.swapLocations(buffer, buffer.left, buffer.right, parser);
                          result = buffer;
                        }
                      } else if (result.right.kind === "retif") {
                        lLevel = AST.precedence[result.type];
                        rLevel = AST.precedence["?"];
                        if (lLevel && rLevel && rLevel <= lLevel) {
                          buffer = result.right;
                          result.right = result.right.test;
                          this.swapLocations(result, result.left, result.right, parser);
                          buffer.test = this.resolvePrecedence(result, parser);
                          this.swapLocations(buffer, buffer.test, buffer.falseExpr, parser);
                          result = buffer;
                        }
                      }
                    }
                  } else if ((result.kind === "silent" || result.kind === "cast") && result.expr && !result.expr.parenthesizedExpression) {
                    if (result.expr.kind === "bin") {
                      buffer = result.expr;
                      result.expr = result.expr.left;
                      this.swapLocations(result, result, result.expr, parser);
                      buffer.left = this.resolvePrecedence(result, parser);
                      this.swapLocations(buffer, buffer.left, buffer.right, parser);
                      result = buffer;
                    } else if (result.expr.kind === "retif") {
                      buffer = result.expr;
                      result.expr = result.expr.test;
                      this.swapLocations(result, result, result.expr, parser);
                      buffer.test = this.resolvePrecedence(result, parser);
                      this.swapLocations(buffer, buffer.test, buffer.falseExpr, parser);
                      result = buffer;
                    }
                  } else if (result.kind === "unary") {
                    if (result.what && !result.what.parenthesizedExpression) {
                      if (result.what.kind === "bin") {
                        buffer = result.what;
                        result.what = result.what.left;
                        this.swapLocations(result, result, result.what, parser);
                        buffer.left = this.resolvePrecedence(result, parser);
                        this.swapLocations(buffer, buffer.left, buffer.right, parser);
                        result = buffer;
                      } else if (result.what.kind === "retif") {
                        buffer = result.what;
                        result.what = result.what.test;
                        this.swapLocations(result, result, result.what, parser);
                        buffer.test = this.resolvePrecedence(result, parser);
                        this.swapLocations(buffer, buffer.test, buffer.falseExpr, parser);
                        result = buffer;
                      }
                    }
                  } else if (result.kind === "retif") {
                    if (result.falseExpr && result.falseExpr.kind === "retif" && !result.falseExpr.parenthesizedExpression) {
                      buffer = result.falseExpr;
                      result.falseExpr = buffer.test;
                      this.swapLocations(result, result.test, result.falseExpr, parser);
                      buffer.test = this.resolvePrecedence(result, parser);
                      this.swapLocations(buffer, buffer.test, buffer.falseExpr, parser);
                      result = buffer;
                    }
                  } else if (result.kind === "assign") {
                    if (result.right && result.right.kind === "bin" && !result.right.parenthesizedExpression) {
                      lLevel = AST.precedence["="];
                      rLevel = AST.precedence[result.right.type];
                      if (lLevel && rLevel && rLevel < lLevel) {
                        buffer = result.right;
                        result.right = result.right.left;
                        buffer.left = result;
                        this.swapLocations(buffer, buffer.left, result.right, parser);
                        result = buffer;
                      }
                    }
                  } else if (result.kind === "expressionstatement") {
                    this.swapLocations(result, result.expression, result, parser);
                  }
                  return result;
                };
                AST.prototype.prepare = function(kind, docs, parser) {
                  var start = null;
                  if (this.withPositions || this.withSource) {
                    start = parser.position();
                  }
                  var self2 = this;
                  var _result = function result() {
                    var args = Array.prototype.slice.call(arguments);
                    args.push(docs);
                    if (self2.withPositions || self2.withSource) {
                      var src = null;
                      if (self2.withSource) {
                        src = parser.lexer._input.substring(start.offset, parser.prev[2]);
                      }
                      var location = new Location(src, start, new Position(parser.prev[0], parser.prev[1], parser.prev[2]));
                      args.push(location);
                    }
                    if (!kind) {
                      kind = args.shift();
                    }
                    var node = self2[kind];
                    if (typeof node !== "function") {
                      throw new Error('Undefined node "' + kind + '"');
                    }
                    var astNode = Object.create(node.prototype);
                    node.apply(astNode, args);
                    _result.instance = astNode;
                    if (_result.trailingComments) {
                      astNode.trailingComments = _result.trailingComments;
                    }
                    if (typeof _result.postBuild === "function") {
                      _result.postBuild(astNode);
                    }
                    if (parser.debug) {
                      delete self2.stack[_result.stackUid];
                    }
                    return self2.resolvePrecedence(astNode, parser);
                  };
                  if (parser.debug) {
                    if (!this.stack) {
                      this.stack = {};
                      this.stackUid = 1;
                    }
                    this.stack[++this.stackUid] = {
                      position: start,
                      stack: new Error().stack.split("\n").slice(3, 5)
                    };
                    _result.stackUid = this.stackUid;
                  }
                  _result.setTrailingComments = function(docs2) {
                    if (_result.instance) {
                      _result.instance.setTrailingComments(docs2);
                    } else {
                      _result.trailingComments = docs2;
                    }
                  };
                  _result.destroy = function(target) {
                    if (docs) {
                      if (target) {
                        if (!target.leadingComments) {
                          target.leadingComments = docs;
                        } else {
                          target.leadingComments = docs.concat(target.leadingComments);
                        }
                      } else {
                        parser._docIndex = parser._docs.length - docs.length;
                      }
                    }
                    if (parser.debug) {
                      delete self2.stack[_result.stackUid];
                    }
                  };
                  return _result;
                };
                AST.prototype.checkNodes = function() {
                  var errors = [];
                  for (var k in this.stack) {
                    if (Object.prototype.hasOwnProperty.call(this.stack, k)) {
                      this.stack[k].key = k;
                      errors.push(this.stack[k]);
                    }
                  }
                  this.stack = {};
                  return errors;
                };
                [__webpack_require__2(3160), __webpack_require__2(1654), __webpack_require__2(1240), __webpack_require__2(3979), __webpack_require__2(5553), __webpack_require__2(2207), __webpack_require__2(2916), __webpack_require__2(4628), __webpack_require__2(7509), __webpack_require__2(2906), __webpack_require__2(5723), __webpack_require__2(7561), __webpack_require__2(6473), __webpack_require__2(9626), __webpack_require__2(4782), __webpack_require__2(8477), __webpack_require__2(5045), __webpack_require__2(900), __webpack_require__2(4824), __webpack_require__2(1020), __webpack_require__2(9847), __webpack_require__2(2790), __webpack_require__2(1333), __webpack_require__2(2112), __webpack_require__2(9960), __webpack_require__2(8533), __webpack_require__2(5947), __webpack_require__2(7786), __webpack_require__2(5436), __webpack_require__2(1136), __webpack_require__2(380), __webpack_require__2(6129), __webpack_require__2(9723), __webpack_require__2(5125), __webpack_require__2(9632), __webpack_require__2(4300), __webpack_require__2(1515), __webpack_require__2(3411), __webpack_require__2(9781), __webpack_require__2(839), __webpack_require__2(8374), __webpack_require__2(9754), __webpack_require__2(4251), __webpack_require__2(6553), __webpack_require__2(8630), __webpack_require__2(9786), __webpack_require__2(9742), __webpack_require__2(1234), __webpack_require__2(6), __webpack_require__2(8861), __webpack_require__2(7860), __webpack_require__2(9834), __webpack_require__2(2724), __webpack_require__2(6025), __webpack_require__2(2687), __webpack_require__2(7633), __webpack_require__2(5514), __webpack_require__2(7427), __webpack_require__2(1122), __webpack_require__2(7256), __webpack_require__2(7416), __webpack_require__2(8140), __webpack_require__2(6258), __webpack_require__2(9474), __webpack_require__2(6827), __webpack_require__2(4427), __webpack_require__2(4065), __webpack_require__2(4297), __webpack_require__2(5859), __webpack_require__2(6985), __webpack_require__2(9302), __webpack_require__2(8212), __webpack_require__2(864), __webpack_require__2(8268), __webpack_require__2(7190), __webpack_require__2(8519), __webpack_require__2(4835), __webpack_require__2(2056), __webpack_require__2(4838), __webpack_require__2(7869), __webpack_require__2(1908), __webpack_require__2(170), __webpack_require__2(1091), __webpack_require__2(8276), __webpack_require__2(1842), __webpack_require__2(5739), __webpack_require__2(1274), __webpack_require__2(4352), __webpack_require__2(9672), __webpack_require__2(711), __webpack_require__2(1231), __webpack_require__2(1865), __webpack_require__2(1102), __webpack_require__2(7472), __webpack_require__2(6133), __webpack_require__2(1197), __webpack_require__2(6649), __webpack_require__2(1837), __webpack_require__2(2277), __webpack_require__2(8010), __webpack_require__2(7579), __webpack_require__2(3460), __webpack_require__2(2702), __webpack_require__2(514), __webpack_require__2(5684), __webpack_require__2(8019), __webpack_require__2(7721), __webpack_require__2(4369), __webpack_require__2(40), __webpack_require__2(4919), __webpack_require__2(7676), __webpack_require__2(2596), __webpack_require__2(6744)].forEach(function(ctor) {
                  AST.prototype[ctor.kind] = ctor;
                });
                module2.exports = AST;
              },
              /***/
              3160(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expr = __webpack_require__2(839);
                var KIND = "array";
                module2.exports = Expr["extends"](KIND, function Array2(shortForm, items, docs, location) {
                  Expr.apply(this, [KIND, docs, location]);
                  this.items = items;
                  this.shortForm = shortForm;
                });
              },
              /***/
              1654(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "arrowfunc";
                module2.exports = Expression["extends"](KIND, function Closure(args, byref, body, type, nullable, isStatic, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.arguments = args;
                  this.byref = byref;
                  this.body = body;
                  this.type = type;
                  this.nullable = nullable;
                  this.isStatic = isStatic || false;
                });
              },
              /***/
              1240(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "assign";
                module2.exports = Expression["extends"](KIND, function Assign(left, right, operator, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.left = left;
                  this.right = right;
                  this.operator = operator;
                });
              },
              /***/
              3979(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "assignref";
                module2.exports = Expression["extends"](KIND, function AssignRef(left, right, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.left = left;
                  this.right = right;
                });
              },
              /***/
              2207(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "attrgroup";
                module2.exports = Node["extends"](KIND, function AttrGroup(attrs, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.attrs = attrs || [];
                });
              },
              /***/
              5553(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "attribute";
                module2.exports = Node["extends"](KIND, function Attribute(name, args, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.args = args;
                });
              },
              /***/
              2916(module2, __unused_webpack_exports, __webpack_require__2) {
                var Operation = __webpack_require__2(8268);
                var KIND = "bin";
                module2.exports = Operation["extends"](KIND, function Bin(type, left, right, docs, location) {
                  Operation.apply(this, [KIND, docs, location]);
                  this.type = type;
                  this.left = left;
                  this.right = right;
                });
              },
              /***/
              4628(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "block";
                module2.exports = Statement["extends"](KIND, function Block(kind, children, docs, location) {
                  Statement.apply(this, [kind || KIND, docs, location]);
                  this.children = children.filter(Boolean);
                });
              },
              /***/
              7509(module2, __unused_webpack_exports, __webpack_require__2) {
                var Literal = __webpack_require__2(5514);
                var KIND = "boolean";
                module2.exports = Literal["extends"](KIND, function Boolean2(value, raw, docs, location) {
                  Literal.apply(this, [KIND, value, raw, docs, location]);
                });
              },
              /***/
              2906(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "break";
                module2.exports = Statement["extends"](KIND, function Break(level, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.level = level;
                });
              },
              /***/
              5723(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "byref";
                module2.exports = Expression["extends"](KIND, function ByRef(what, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.what = what;
                });
              },
              /***/
              7561(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "call";
                module2.exports = Expression["extends"](KIND, function Call(what, args, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.what = what;
                  this.arguments = args;
                });
              },
              /***/
              6473(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "case";
                module2.exports = Statement["extends"](KIND, function Case(test, body, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.test = test;
                  this.body = body;
                });
              },
              /***/
              9626(module2, __unused_webpack_exports, __webpack_require__2) {
                var Operation = __webpack_require__2(8268);
                var KIND = "cast";
                module2.exports = Operation["extends"](KIND, function Cast(type, raw, expr, docs, location) {
                  Operation.apply(this, [KIND, docs, location]);
                  this.type = type;
                  this.raw = raw;
                  this.expr = expr;
                });
              },
              /***/
              4782(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "catch";
                module2.exports = Statement["extends"](KIND, function Catch(body, what, variable, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.body = body;
                  this.what = what;
                  this.variable = variable;
                });
              },
              /***/
              8477(module2, __unused_webpack_exports, __webpack_require__2) {
                var Declaration = __webpack_require__2(8533);
                var KIND = "class";
                module2.exports = Declaration["extends"](KIND, function Class(name, ext, impl, body, flags, docs, location) {
                  Declaration.apply(this, [KIND, name, docs, location]);
                  this.isAnonymous = name ? false : true;
                  this["extends"] = ext;
                  this["implements"] = impl;
                  this.body = body;
                  this.attrGroups = [];
                  this.parseFlags(flags);
                });
              },
              /***/
              5045(module2, __unused_webpack_exports, __webpack_require__2) {
                var ConstantStatement = __webpack_require__2(2112);
                var KIND = "classconstant";
                var IS_UNDEFINED = "";
                var IS_PUBLIC = "public";
                var IS_PROTECTED = "protected";
                var IS_PRIVATE = "private";
                var ClassConstant = ConstantStatement["extends"](KIND, function ClassConstant2(kind, constants, flags, nullable, type, attrGroups, docs, location) {
                  ConstantStatement.apply(this, [kind || KIND, constants, docs, location]);
                  this.parseFlags(flags);
                  this.nullable = nullable;
                  this.type = type;
                  this.attrGroups = attrGroups;
                });
                ClassConstant.prototype.parseFlags = function(flags) {
                  if (flags[0] === -1) {
                    this.visibility = IS_UNDEFINED;
                  } else if (flags[0] === null) {
                    this.visibility = null;
                  } else if (flags[0] === 0) {
                    this.visibility = IS_PUBLIC;
                  } else if (flags[0] === 1) {
                    this.visibility = IS_PROTECTED;
                  } else if (flags[0] === 2) {
                    this.visibility = IS_PRIVATE;
                  }
                  this["final"] = flags[2] === 2;
                };
                module2.exports = ClassConstant;
              },
              /***/
              900(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "clone";
                module2.exports = Expression["extends"](KIND, function Clone(what, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.what = what;
                });
              },
              /***/
              4824(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "closure";
                module2.exports = Expression["extends"](KIND, function Closure(args, byref, uses, type, nullable, isStatic, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.uses = uses;
                  this.arguments = args;
                  this.byref = byref;
                  this.type = type;
                  this.nullable = nullable;
                  this.isStatic = isStatic || false;
                  this.body = null;
                  this.attrGroups = [];
                });
              },
              /***/
              1020(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                module2.exports = Node["extends"]("comment", function Comment(kind, value, docs, location) {
                  Node.apply(this, [kind, docs, location]);
                  this.value = value;
                });
              },
              /***/
              9847(module2, __unused_webpack_exports, __webpack_require__2) {
                var Comment = __webpack_require__2(1020);
                var KIND = "commentblock";
                module2.exports = Comment["extends"](KIND, function CommentBlock(value, docs, location) {
                  Comment.apply(this, [KIND, value, docs, location]);
                });
              },
              /***/
              2790(module2, __unused_webpack_exports, __webpack_require__2) {
                var Comment = __webpack_require__2(1020);
                var KIND = "commentline";
                module2.exports = Comment["extends"](KIND, function CommentLine(value, docs, location) {
                  Comment.apply(this, [KIND, value, docs, location]);
                });
              },
              /***/
              1333(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "constant";
                module2.exports = Node["extends"](KIND, function Constant(name, value, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.value = value;
                });
              },
              /***/
              2112(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "constantstatement";
                module2.exports = Statement["extends"](KIND, function ConstantStatement(kind, constants, docs, location) {
                  Statement.apply(this, [kind || KIND, docs, location]);
                  this.constants = constants;
                });
              },
              /***/
              9960(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "continue";
                module2.exports = Statement["extends"](KIND, function Continue(level, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.level = level;
                });
              },
              /***/
              8533(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "declaration";
                var IS_UNDEFINED = "";
                var IS_PUBLIC = "public";
                var IS_PROTECTED = "protected";
                var IS_PRIVATE = "private";
                var Declaration = Statement["extends"](KIND, function Declaration2(kind, name, docs, location) {
                  Statement.apply(this, [kind || KIND, docs, location]);
                  this.name = name;
                });
                Declaration.prototype.parseFlags = function(flags) {
                  this.isAbstract = flags[2] === 1;
                  this.isFinal = flags[2] === 2;
                  this.isReadonly = flags[3] === 1;
                  if (this.kind !== "class") {
                    if (flags[0] === -1) {
                      this.visibility = IS_UNDEFINED;
                    } else if (flags[0] === null) {
                      this.visibility = null;
                    } else if (flags[0] === 0) {
                      this.visibility = IS_PUBLIC;
                    } else if (flags[0] === 1) {
                      this.visibility = IS_PROTECTED;
                    } else if (flags[0] === 2) {
                      this.visibility = IS_PRIVATE;
                    }
                    this.isStatic = flags[1] === 1;
                  }
                };
                module2.exports = Declaration;
              },
              /***/
              5947(module2, __unused_webpack_exports, __webpack_require__2) {
                var Block = __webpack_require__2(4628);
                var KIND = "declare";
                var Declare = Block["extends"](KIND, function Declare2(directives, body, mode, docs, location) {
                  Block.apply(this, [KIND, body, docs, location]);
                  this.directives = directives;
                  this.mode = mode;
                });
                Declare.MODE_SHORT = "short";
                Declare.MODE_BLOCK = "block";
                Declare.MODE_NONE = "none";
                module2.exports = Declare;
              },
              /***/
              7786(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "declaredirective";
                module2.exports = Node["extends"](KIND, function DeclareDirective(key, value, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.key = key;
                  this.value = value;
                });
              },
              /***/
              5436(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "do";
                module2.exports = Statement["extends"](KIND, function Do(test, body, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.test = test;
                  this.body = body;
                });
              },
              /***/
              1136(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "echo";
                module2.exports = Statement["extends"](KIND, function Echo(expressions, shortForm, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.shortForm = shortForm;
                  this.expressions = expressions;
                });
              },
              /***/
              380(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "empty";
                module2.exports = Expression["extends"](KIND, function Empty(expression, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.expression = expression;
                });
              },
              /***/
              6129(module2, __unused_webpack_exports, __webpack_require__2) {
                var Literal = __webpack_require__2(5514);
                var KIND = "encapsed";
                var Encapsed = Literal["extends"](KIND, function Encapsed2(value, raw, type, docs, location) {
                  Literal.apply(this, [KIND, value, raw, docs, location]);
                  this.type = type;
                });
                Encapsed.TYPE_STRING = "string";
                Encapsed.TYPE_SHELL = "shell";
                Encapsed.TYPE_HEREDOC = "heredoc";
                Encapsed.TYPE_OFFSET = "offset";
                module2.exports = Encapsed;
              },
              /***/
              9723(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "encapsedpart";
                module2.exports = Expression["extends"](KIND, function EncapsedPart(expression, syntax, curly, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.expression = expression;
                  this.syntax = syntax;
                  this.curly = curly;
                });
              },
              /***/
              5125(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "entry";
                module2.exports = Expression["extends"](KIND, function Entry(key, value, byRef, unpack, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.key = key;
                  this.value = value;
                  this.byRef = byRef;
                  this.unpack = unpack;
                });
              },
              /***/
              9632(module2, __unused_webpack_exports, __webpack_require__2) {
                var Declaration = __webpack_require__2(8533);
                var KIND = "enum";
                module2.exports = Declaration["extends"](KIND, function Enum(name, valueType, impl, body, docs, location) {
                  Declaration.apply(this, [KIND, name, docs, location]);
                  this.valueType = valueType;
                  this["implements"] = impl;
                  this.body = body;
                  this.attrGroups = [];
                });
              },
              /***/
              4300(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "enumcase";
                module2.exports = Node["extends"](KIND, function EnumCase(name, value, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.value = value;
                });
              },
              /***/
              1515(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "error";
                module2.exports = Node["extends"](KIND, function Error2(message, token, line, expected, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.message = message;
                  this.token = token;
                  this.line = line;
                  this.expected = expected;
                });
              },
              /***/
              3411(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "eval";
                module2.exports = Expression["extends"](KIND, function Eval(source, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.source = source;
                });
              },
              /***/
              9781(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "exit";
                module2.exports = Expression["extends"](KIND, function Exit(expression, useDie, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.expression = expression;
                  this.useDie = useDie;
                });
              },
              /***/
              839(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "expression";
                module2.exports = Node["extends"](KIND, function Expression(kind, docs, location) {
                  Node.apply(this, [kind || KIND, docs, location]);
                });
              },
              /***/
              8374(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "expressionstatement";
                module2.exports = Statement["extends"](KIND, function ExpressionStatement(expr, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.expression = expr;
                });
              },
              /***/
              9754(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "for";
                module2.exports = Statement["extends"](KIND, function For(init, test, increment, body, shortForm, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.init = init;
                  this.test = test;
                  this.increment = increment;
                  this.shortForm = shortForm;
                  this.body = body;
                });
              },
              /***/
              4251(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "foreach";
                module2.exports = Statement["extends"](KIND, function Foreach(source, key, value, body, shortForm, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.source = source;
                  this.key = key;
                  this.value = value;
                  this.shortForm = shortForm;
                  this.body = body;
                });
              },
              /***/
              6553(module2, __unused_webpack_exports, __webpack_require__2) {
                var Declaration = __webpack_require__2(8533);
                var KIND = "function";
                module2.exports = Declaration["extends"](KIND, function _Function(name, args, byref, type, nullable, docs, location) {
                  Declaration.apply(this, [KIND, name, docs, location]);
                  this.arguments = args;
                  this.byref = byref;
                  this.type = type;
                  this.nullable = nullable;
                  this.body = null;
                  this.attrGroups = [];
                });
              },
              /***/
              8630(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "global";
                module2.exports = Statement["extends"](KIND, function Global(items, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.items = items;
                });
              },
              /***/
              9786(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "goto";
                module2.exports = Statement["extends"](KIND, function Goto(label, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.label = label;
                });
              },
              /***/
              9742(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "halt";
                module2.exports = Statement["extends"](KIND, function Halt(after, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.after = after;
                });
              },
              /***/
              1234(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "identifier";
                var Identifier = Node["extends"](KIND, function Identifier2(name, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.name = name;
                });
                module2.exports = Identifier;
              },
              /***/
              6(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "if";
                module2.exports = Statement["extends"](KIND, function If(test, body, alternate, shortForm, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.test = test;
                  this.body = body;
                  this.alternate = alternate;
                  this.shortForm = shortForm;
                });
              },
              /***/
              8861(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "include";
                module2.exports = Expression["extends"](KIND, function Include(once, require2, target, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.once = once;
                  this.require = require2;
                  this.target = target;
                });
              },
              /***/
              7860(module2, __unused_webpack_exports, __webpack_require__2) {
                var Literal = __webpack_require__2(5514);
                var KIND = "inline";
                module2.exports = Literal["extends"](KIND, function Inline(value, raw, docs, location) {
                  Literal.apply(this, [KIND, value, raw, docs, location]);
                });
              },
              /***/
              9834(module2, __unused_webpack_exports, __webpack_require__2) {
                var Declaration = __webpack_require__2(8533);
                var KIND = "interface";
                module2.exports = Declaration["extends"](KIND, function Interface(name, ext, body, attrGroups, docs, location) {
                  Declaration.apply(this, [KIND, name, docs, location]);
                  this["extends"] = ext;
                  this.body = body;
                  this.attrGroups = attrGroups;
                });
              },
              /***/
              2724(module2, __unused_webpack_exports, __webpack_require__2) {
                var Declaration = __webpack_require__2(8533);
                var KIND = "intersectiontype";
                module2.exports = Declaration["extends"](KIND, function IntersectionType(types, docs, location) {
                  Declaration.apply(this, [KIND, null, docs, location]);
                  this.types = types;
                });
              },
              /***/
              6025(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "isset";
                module2.exports = Expression["extends"](KIND, function Isset(variables, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.variables = variables;
                });
              },
              /***/
              2687(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "label";
                module2.exports = Statement["extends"](KIND, function Label(name, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.name = name;
                });
              },
              /***/
              7633(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "list";
                module2.exports = Expression["extends"](KIND, function List(items, shortForm, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.items = items;
                  this.shortForm = shortForm;
                });
              },
              /***/
              5514(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "literal";
                module2.exports = Expression["extends"](KIND, function Literal(kind, value, raw, docs, location) {
                  Expression.apply(this, [kind || KIND, docs, location]);
                  this.value = value;
                  if (raw) {
                    this.raw = raw;
                  }
                });
              },
              /***/
              4778(module2) {
                var Location = function Location2(source, start, end) {
                  this.source = source;
                  this.start = start;
                  this.end = end;
                };
                module2.exports = Location;
              },
              /***/
              7427(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expr = __webpack_require__2(839);
                var KIND = "lookup";
                module2.exports = Expr["extends"](KIND, function Lookup(kind, what, offset, docs, location) {
                  Expr.apply(this, [kind || KIND, docs, location]);
                  this.what = what;
                  this.offset = offset;
                });
              },
              /***/
              1122(module2, __unused_webpack_exports, __webpack_require__2) {
                var Literal = __webpack_require__2(5514);
                var KIND = "magic";
                module2.exports = Literal["extends"](KIND, function Magic(value, raw, docs, location) {
                  Literal.apply(this, [KIND, value, raw, docs, location]);
                });
              },
              /***/
              7256(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "match";
                module2.exports = Expression["extends"](KIND, function Match(cond, arms, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.cond = cond;
                  this.arms = arms;
                });
              },
              /***/
              7416(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "matcharm";
                module2.exports = Expression["extends"](KIND, function MatchArm(conds, body, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.conds = conds;
                  this.body = body;
                });
              },
              /***/
              8140(module2, __unused_webpack_exports, __webpack_require__2) {
                var Function_ = __webpack_require__2(6553);
                var KIND = "method";
                module2.exports = Function_["extends"](KIND, function Method() {
                  Function_.apply(this, arguments);
                  this.kind = KIND;
                });
              },
              /***/
              6258(module2, __unused_webpack_exports, __webpack_require__2) {
                var Reference = __webpack_require__2(8276);
                var KIND = "name";
                var Name = Reference["extends"](KIND, function Name2(name, resolution, docs, location) {
                  Reference.apply(this, [KIND, docs, location]);
                  this.name = name.replace(/\\$/, "");
                  this.resolution = resolution;
                });
                Name.UNQUALIFIED_NAME = "uqn";
                Name.QUALIFIED_NAME = "qn";
                Name.FULL_QUALIFIED_NAME = "fqn";
                Name.RELATIVE_NAME = "rn";
                module2.exports = Name;
              },
              /***/
              6827(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "namedargument";
                module2.exports = Expression["extends"](KIND, function namedargument(name, value, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.value = value;
                });
              },
              /***/
              9474(module2, __unused_webpack_exports, __webpack_require__2) {
                var Block = __webpack_require__2(4628);
                var KIND = "namespace";
                module2.exports = Block["extends"](KIND, function Namespace(name, children, withBrackets, docs, location) {
                  Block.apply(this, [KIND, children, docs, location]);
                  this.name = name;
                  this.withBrackets = withBrackets || false;
                });
              },
              /***/
              4427(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "new";
                module2.exports = Expression["extends"](KIND, function New(what, args, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.what = what;
                  this.arguments = args;
                });
              },
              /***/
              4065(module2) {
                var Node = function Node2(kind, docs, location) {
                  this.kind = kind;
                  if (docs) {
                    this.leadingComments = docs;
                  }
                  if (location) {
                    this.loc = location;
                  }
                };
                Node.prototype.setTrailingComments = function(docs) {
                  this.trailingComments = docs;
                };
                Node.prototype.destroy = function(node) {
                  if (!node) {
                    throw new Error("Node already initialized, you must swap with another node");
                  }
                  if (this.leadingComments) {
                    if (node.leadingComments) {
                      node.leadingComments = Array.concat(this.leadingComments, node.leadingComments);
                    } else {
                      node.leadingComments = this.leadingComments;
                    }
                  }
                  if (this.trailingComments) {
                    if (node.trailingComments) {
                      node.trailingComments = Array.concat(this.trailingComments, node.trailingComments);
                    } else {
                      node.trailingComments = this.trailingComments;
                    }
                  }
                  return node;
                };
                Node.prototype.includeToken = function(parser) {
                  if (this.loc) {
                    if (this.loc.end) {
                      this.loc.end.line = parser.lexer.yylloc.last_line;
                      this.loc.end.column = parser.lexer.yylloc.last_column;
                      this.loc.end.offset = parser.lexer.offset;
                    }
                    if (parser.ast.withSource) {
                      this.loc.source = parser.lexer._input.substring(this.loc.start.offset, parser.lexer.offset);
                    }
                  }
                  return this;
                };
                Node["extends"] = function(type, constructor) {
                  constructor.prototype = Object.create(this.prototype);
                  constructor["extends"] = this["extends"];
                  constructor.prototype.constructor = constructor;
                  constructor.kind = type;
                  return constructor;
                };
                module2.exports = Node;
              },
              /***/
              4297(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "noop";
                module2.exports = Node["extends"](KIND, function Noop(docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                });
              },
              /***/
              5859(module2, __unused_webpack_exports, __webpack_require__2) {
                var Literal = __webpack_require__2(5514);
                var KIND = "nowdoc";
                module2.exports = Literal["extends"](KIND, function Nowdoc(value, raw, label, docs, location) {
                  Literal.apply(this, [KIND, value, raw, docs, location]);
                  this.label = label;
                });
              },
              /***/
              6985(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "nullkeyword";
                module2.exports = Node["extends"](KIND, function NullKeyword(raw, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.raw = raw;
                });
              },
              /***/
              9302(module2, __unused_webpack_exports, __webpack_require__2) {
                var Lookup = __webpack_require__2(7427);
                var KIND = "nullsafepropertylookup";
                module2.exports = Lookup["extends"](KIND, function NullSafePropertyLookup(what, offset, docs, location) {
                  Lookup.apply(this, [KIND, what, offset, docs, location]);
                });
              },
              /***/
              8212(module2, __unused_webpack_exports, __webpack_require__2) {
                var Literal = __webpack_require__2(5514);
                var KIND = "number";
                module2.exports = Literal["extends"](KIND, function Number2(value, raw, docs, location) {
                  Literal.apply(this, [KIND, value, raw, docs, location]);
                });
              },
              /***/
              864(module2, __unused_webpack_exports, __webpack_require__2) {
                var Lookup = __webpack_require__2(7427);
                var KIND = "offsetlookup";
                module2.exports = Lookup["extends"](KIND, function OffsetLookup(what, offset, docs, location) {
                  Lookup.apply(this, [KIND, what, offset, docs, location]);
                });
              },
              /***/
              8268(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expr = __webpack_require__2(839);
                var KIND = "operation";
                module2.exports = Expr["extends"](KIND, function Operation(kind, docs, location) {
                  Expr.apply(this, [kind || KIND, docs, location]);
                });
              },
              /***/
              7190(module2, __unused_webpack_exports, __webpack_require__2) {
                var Declaration = __webpack_require__2(8533);
                var KIND = "parameter";
                module2.exports = Declaration["extends"](KIND, function Parameter(name, type, value, isRef, isVariadic, readonly, nullable, flags, docs, location) {
                  Declaration.apply(this, [KIND, name, docs, location]);
                  this.value = value;
                  this.type = type;
                  this.byref = isRef;
                  this.variadic = isVariadic;
                  this.readonly = readonly;
                  this.nullable = nullable;
                  this.flags = flags || 0;
                  this.attrGroups = [];
                });
              },
              /***/
              8519(module2, __unused_webpack_exports, __webpack_require__2) {
                var Reference = __webpack_require__2(8276);
                var KIND = "parentreference";
                var ParentReference = Reference["extends"](KIND, function ParentReference2(raw, docs, location) {
                  Reference.apply(this, [KIND, docs, location]);
                  this.raw = raw;
                });
                module2.exports = ParentReference;
              },
              /***/
              8822(module2) {
                var Position = function Position2(line, column, offset) {
                  this.line = line;
                  this.column = column;
                  this.offset = offset;
                };
                module2.exports = Position;
              },
              /***/
              4835(module2, __unused_webpack_exports, __webpack_require__2) {
                var Operation = __webpack_require__2(8268);
                var KIND = "post";
                module2.exports = Operation["extends"](KIND, function Post(type, what, docs, location) {
                  Operation.apply(this, [KIND, docs, location]);
                  this.type = type;
                  this.what = what;
                });
              },
              /***/
              2056(module2, __unused_webpack_exports, __webpack_require__2) {
                var Operation = __webpack_require__2(8268);
                var KIND = "pre";
                module2.exports = Operation["extends"](KIND, function Pre(type, what, docs, location) {
                  Operation.apply(this, [KIND, docs, location]);
                  this.type = type;
                  this.what = what;
                });
              },
              /***/
              4838(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "print";
                module2.exports = Expression["extends"](KIND, function Print(expression, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.expression = expression;
                });
              },
              /***/
              7869(module2, __unused_webpack_exports, __webpack_require__2) {
                var Block = __webpack_require__2(4628);
                var KIND = "program";
                module2.exports = Block["extends"](KIND, function Program(children, errors, comments, tokens, docs, location) {
                  Block.apply(this, [KIND, children, docs, location]);
                  this.errors = errors;
                  if (comments) {
                    this.comments = comments;
                  }
                  if (tokens) {
                    this.tokens = tokens;
                  }
                });
              },
              /***/
              1908(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "property";
                module2.exports = Statement["extends"](KIND, function Property(name, value, readonly, nullable, type, attrGroups, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.value = value;
                  this.readonly = readonly;
                  this.nullable = nullable;
                  this.type = type;
                  this.attrGroups = attrGroups;
                });
              },
              /***/
              170(module2, __unused_webpack_exports, __webpack_require__2) {
                var Lookup = __webpack_require__2(7427);
                var KIND = "propertylookup";
                module2.exports = Lookup["extends"](KIND, function PropertyLookup(what, offset, docs, location) {
                  Lookup.apply(this, [KIND, what, offset, docs, location]);
                });
              },
              /***/
              1091(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "propertystatement";
                var IS_UNDEFINED = "";
                var IS_PUBLIC = "public";
                var IS_PROTECTED = "protected";
                var IS_PRIVATE = "private";
                var PropertyStatement = Statement["extends"](KIND, function PropertyStatement2(kind, properties, flags, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.properties = properties;
                  this.parseFlags(flags);
                });
                PropertyStatement.prototype.parseFlags = function(flags) {
                  if (flags[0] === -1) {
                    this.visibility = IS_UNDEFINED;
                  } else if (flags[0] === null) {
                    this.visibility = null;
                  } else if (flags[0] === 0) {
                    this.visibility = IS_PUBLIC;
                  } else if (flags[0] === 1) {
                    this.visibility = IS_PROTECTED;
                  } else if (flags[0] === 2) {
                    this.visibility = IS_PRIVATE;
                  }
                  this.isStatic = flags[1] === 1;
                };
                module2.exports = PropertyStatement;
              },
              /***/
              8276(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "reference";
                var Reference = Node["extends"](KIND, function Reference2(kind, docs, location) {
                  Node.apply(this, [kind || KIND, docs, location]);
                });
                module2.exports = Reference;
              },
              /***/
              1842(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "retif";
                module2.exports = Expression["extends"](KIND, function RetIf(test, trueExpr, falseExpr, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.test = test;
                  this.trueExpr = trueExpr;
                  this.falseExpr = falseExpr;
                });
              },
              /***/
              5739(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "return";
                module2.exports = Statement["extends"](KIND, function Return(expr, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.expr = expr;
                });
              },
              /***/
              1274(module2, __unused_webpack_exports, __webpack_require__2) {
                var Reference = __webpack_require__2(8276);
                var KIND = "selfreference";
                var SelfReference = Reference["extends"](KIND, function SelfReference2(raw, docs, location) {
                  Reference.apply(this, [KIND, docs, location]);
                  this.raw = raw;
                });
                module2.exports = SelfReference;
              },
              /***/
              4352(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "silent";
                module2.exports = Expression["extends"](KIND, function Silent(expr, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.expr = expr;
                });
              },
              /***/
              9672(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "statement";
                module2.exports = Node["extends"](KIND, function Statement(kind, docs, location) {
                  Node.apply(this, [kind || KIND, docs, location]);
                });
              },
              /***/
              711(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "static";
                module2.exports = Statement["extends"](KIND, function Static(variables, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.variables = variables;
                });
              },
              /***/
              1865(module2, __unused_webpack_exports, __webpack_require__2) {
                var Lookup = __webpack_require__2(7427);
                var KIND = "staticlookup";
                module2.exports = Lookup["extends"](KIND, function StaticLookup(what, offset, docs, location) {
                  Lookup.apply(this, [KIND, what, offset, docs, location]);
                });
              },
              /***/
              1102(module2, __unused_webpack_exports, __webpack_require__2) {
                var Reference = __webpack_require__2(8276);
                var KIND = "staticreference";
                var StaticReference = Reference["extends"](KIND, function StaticReference2(raw, docs, location) {
                  Reference.apply(this, [KIND, docs, location]);
                  this.raw = raw;
                });
                module2.exports = StaticReference;
              },
              /***/
              1231(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "staticvariable";
                module2.exports = Node["extends"](KIND, function StaticVariable(variable, defaultValue, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.variable = variable;
                  this.defaultValue = defaultValue;
                });
              },
              /***/
              7472(module2, __unused_webpack_exports, __webpack_require__2) {
                var Literal = __webpack_require__2(5514);
                var KIND = "string";
                module2.exports = Literal["extends"](KIND, function String2(isDoubleQuote, value, unicode, raw, docs, location) {
                  Literal.apply(this, [KIND, value, raw, docs, location]);
                  this.unicode = unicode;
                  this.isDoubleQuote = isDoubleQuote;
                });
              },
              /***/
              6133(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "switch";
                module2.exports = Statement["extends"](KIND, function Switch(test, body, shortForm, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.test = test;
                  this.body = body;
                  this.shortForm = shortForm;
                });
              },
              /***/
              1197(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "throw";
                module2.exports = Statement["extends"](KIND, function Throw(what, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.what = what;
                });
              },
              /***/
              6649(module2, __unused_webpack_exports, __webpack_require__2) {
                var Declaration = __webpack_require__2(8533);
                var KIND = "trait";
                module2.exports = Declaration["extends"](KIND, function Trait(name, body, docs, location) {
                  Declaration.apply(this, [KIND, name, docs, location]);
                  this.body = body;
                });
              },
              /***/
              1837(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "traitalias";
                var IS_UNDEFINED = "";
                var IS_PUBLIC = "public";
                var IS_PROTECTED = "protected";
                var IS_PRIVATE = "private";
                module2.exports = Node["extends"](KIND, function TraitAlias(trait, method, as, flags, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.trait = trait;
                  this.method = method;
                  this.as = as;
                  this.visibility = IS_UNDEFINED;
                  if (flags) {
                    if (flags[0] === 0) {
                      this.visibility = IS_PUBLIC;
                    } else if (flags[0] === 1) {
                      this.visibility = IS_PROTECTED;
                    } else if (flags[0] === 2) {
                      this.visibility = IS_PRIVATE;
                    }
                  }
                });
              },
              /***/
              2277(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "traitprecedence";
                module2.exports = Node["extends"](KIND, function TraitPrecedence(trait, method, instead, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.trait = trait;
                  this.method = method;
                  this.instead = instead;
                });
              },
              /***/
              8010(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "traituse";
                module2.exports = Node["extends"](KIND, function TraitUse(traits, adaptations, docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                  this.traits = traits;
                  this.adaptations = adaptations;
                });
              },
              /***/
              7579(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "try";
                module2.exports = Statement["extends"](KIND, function Try(body, catches, always, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.body = body;
                  this.catches = catches;
                  this.always = always;
                });
              },
              /***/
              3460(module2, __unused_webpack_exports, __webpack_require__2) {
                var Reference = __webpack_require__2(8276);
                var KIND = "typereference";
                var TypeReference = Reference["extends"](KIND, function TypeReference2(name, raw, docs, location) {
                  Reference.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.raw = raw;
                });
                TypeReference.types = ["int", "float", "string", "bool", "object", "array", "callable", "iterable", "void", "static"];
                module2.exports = TypeReference;
              },
              /***/
              2702(module2, __unused_webpack_exports, __webpack_require__2) {
                var Operation = __webpack_require__2(8268);
                var KIND = "unary";
                module2.exports = Operation["extends"](KIND, function Unary(type, what, docs, location) {
                  Operation.apply(this, [KIND, docs, location]);
                  this.type = type;
                  this.what = what;
                });
              },
              /***/
              514(module2, __unused_webpack_exports, __webpack_require__2) {
                var Declaration = __webpack_require__2(8533);
                var KIND = "uniontype";
                module2.exports = Declaration["extends"](KIND, function UnionType(types, docs, location) {
                  Declaration.apply(this, [KIND, null, docs, location]);
                  this.types = types;
                });
              },
              /***/
              5684(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "unset";
                module2.exports = Statement["extends"](KIND, function Unset(variables, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.variables = variables;
                });
              },
              /***/
              8019(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "usegroup";
                module2.exports = Statement["extends"](KIND, function UseGroup(name, type, items, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.type = type;
                  this.items = items;
                });
              },
              /***/
              7721(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "useitem";
                var UseItem = Statement["extends"](KIND, function UseItem2(name, alias, type, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.alias = alias;
                  this.type = type;
                });
                UseItem.TYPE_CONST = "const";
                UseItem.TYPE_FUNCTION = "function";
                module2.exports = UseItem;
              },
              /***/
              4369(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "variable";
                module2.exports = Expression["extends"](KIND, function Variable(name, curly, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.name = name;
                  this.curly = curly || false;
                });
              },
              /***/
              40(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "variadic";
                module2.exports = Expression["extends"](KIND, function variadic(what, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.what = what;
                });
              },
              /***/
              4919(module2, __unused_webpack_exports, __webpack_require__2) {
                var Node = __webpack_require__2(4065);
                var KIND = "variadicplaceholder";
                module2.exports = Node["extends"](KIND, function VariadicPlaceholder(docs, location) {
                  Node.apply(this, [KIND, docs, location]);
                });
              },
              /***/
              7676(module2, __unused_webpack_exports, __webpack_require__2) {
                var Statement = __webpack_require__2(9672);
                var KIND = "while";
                module2.exports = Statement["extends"](KIND, function While(test, body, shortForm, docs, location) {
                  Statement.apply(this, [KIND, docs, location]);
                  this.test = test;
                  this.body = body;
                  this.shortForm = shortForm;
                });
              },
              /***/
              2596(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "yield";
                module2.exports = Expression["extends"](KIND, function Yield(value, key, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.value = value;
                  this.key = key;
                });
              },
              /***/
              6744(module2, __unused_webpack_exports, __webpack_require__2) {
                var Expression = __webpack_require__2(839);
                var KIND = "yieldfrom";
                module2.exports = Expression["extends"](KIND, function YieldFrom(value, docs, location) {
                  Expression.apply(this, [KIND, docs, location]);
                  this.value = value;
                });
              },
              /***/
              5362(module2, __unused_webpack_exports, __webpack_require__2) {
                function _typeof(o) {
                  "@babel/helpers - typeof";
                  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
                    return typeof o2;
                  } : function(o2) {
                    return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
                  }, _typeof(o);
                }
                var lexer = __webpack_require__2(9108);
                var parser = __webpack_require__2(7259);
                var tokens = __webpack_require__2(1906);
                var AST = __webpack_require__2(8938);
                function combine(src, to) {
                  var keys = Object.keys(src);
                  var i = keys.length;
                  while (i--) {
                    var k = keys[i];
                    var val = src[k];
                    if (val === null) {
                      delete to[k];
                    } else if (typeof val === "function") {
                      to[k] = val.bind(to);
                    } else if (Array.isArray(val)) {
                      to[k] = Array.isArray(to[k]) ? to[k].concat(val) : val;
                    } else if (_typeof(val) === "object") {
                      to[k] = _typeof(to[k]) === "object" ? combine(val, to[k]) : val;
                    } else {
                      to[k] = val;
                    }
                  }
                  return to;
                }
                var Engine2 = function Engine3(options) {
                  if (typeof this === "function") {
                    return new this(options);
                  }
                  this.tokens = tokens;
                  this.lexer = new lexer(this);
                  this.ast = new AST();
                  this.parser = new parser(this.lexer, this.ast);
                  if (options && _typeof(options) === "object") {
                    if (options.parser) {
                      if (!options.lexer) {
                        options.lexer = {};
                      }
                      if (options.parser.version) {
                        if (typeof options.parser.version === "string") {
                          var version = options.parser.version.split(".");
                          version = parseInt(version[0]) * 100 + parseInt(version[1]);
                          if (isNaN(version)) {
                            throw new Error("Bad version number : " + options.parser.version);
                          } else {
                            options.parser.version = version;
                          }
                        } else if (typeof options.parser.version !== "number") {
                          throw new Error("Expecting a number for version");
                        }
                        if (options.parser.version < 500 || options.parser.version > 900) {
                          throw new Error("Can only handle versions between 5.x to 8.x");
                        }
                      }
                    }
                    combine(options, this);
                    this.lexer.version = this.parser.version;
                  }
                };
                var getStringBuffer = function getStringBuffer2(buffer) {
                  return typeof buffer.write === "function" ? buffer.toString() : buffer;
                };
                Engine2.create = function(options) {
                  return new Engine2(options);
                };
                Engine2.parseEval = function(buffer, options) {
                  var self2 = new Engine2(options);
                  return self2.parseEval(buffer);
                };
                Engine2.prototype.parseEval = function(buffer) {
                  this.lexer.mode_eval = true;
                  this.lexer.all_tokens = false;
                  buffer = getStringBuffer(buffer);
                  return this.parser.parse(buffer, "eval");
                };
                Engine2.parseCode = function(buffer, filename, options) {
                  if (_typeof(filename) === "object" && !options) {
                    options = filename;
                    filename = "unknown";
                  }
                  var self2 = new Engine2(options);
                  return self2.parseCode(buffer, filename);
                };
                Engine2.prototype.parseCode = function(buffer, filename) {
                  this.lexer.mode_eval = false;
                  this.lexer.all_tokens = false;
                  buffer = getStringBuffer(buffer);
                  return this.parser.parse(buffer, filename);
                };
                Engine2.tokenGetAll = function(buffer, options) {
                  var self2 = new Engine2(options);
                  return self2.tokenGetAll(buffer);
                };
                Engine2.prototype.tokenGetAll = function(buffer) {
                  this.lexer.mode_eval = false;
                  this.lexer.all_tokens = true;
                  buffer = getStringBuffer(buffer);
                  var EOF = this.lexer.EOF;
                  var names = this.tokens.values;
                  this.lexer.setInput(buffer);
                  var token = this.lexer.lex() || EOF;
                  var result = [];
                  while (token != EOF) {
                    var entry = this.lexer.yytext;
                    if (Object.prototype.hasOwnProperty.call(names, token)) {
                      entry = [names[token], entry, this.lexer.yylloc.first_line];
                    }
                    result.push(entry);
                    token = this.lexer.lex() || EOF;
                  }
                  return result;
                };
                module2.exports = Engine2;
                module2.exports.tokens = tokens;
                module2.exports.lexer = lexer;
                module2.exports.AST = AST;
                module2.exports.parser = parser;
                module2.exports.combine = combine;
                module2.exports.Engine = Engine2;
                module2.exports["default"] = Engine2;
              },
              /***/
              9108(module2, __unused_webpack_exports, __webpack_require__2) {
                function _typeof(o) {
                  "@babel/helpers - typeof";
                  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
                    return typeof o2;
                  } : function(o2) {
                    return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
                  }, _typeof(o);
                }
                var Lexer = function Lexer2(engine) {
                  this.engine = engine;
                  this.tok = this.engine.tokens.names;
                  this.EOF = 1;
                  this.debug = false;
                  this.all_tokens = true;
                  this.comment_tokens = false;
                  this.mode_eval = false;
                  this.asp_tags = false;
                  this.short_tags = false;
                  this.version = 803;
                  this.yyprevcol = 0;
                  this.keywords = {
                    __class__: this.tok.T_CLASS_C,
                    __trait__: this.tok.T_TRAIT_C,
                    __function__: this.tok.T_FUNC_C,
                    __method__: this.tok.T_METHOD_C,
                    __line__: this.tok.T_LINE,
                    __file__: this.tok.T_FILE,
                    __dir__: this.tok.T_DIR,
                    __namespace__: this.tok.T_NS_C,
                    exit: this.tok.T_EXIT,
                    die: this.tok.T_EXIT,
                    "function": this.tok.T_FUNCTION,
                    "const": this.tok.T_CONST,
                    "return": this.tok.T_RETURN,
                    "try": this.tok.T_TRY,
                    "catch": this.tok.T_CATCH,
                    "finally": this.tok.T_FINALLY,
                    "throw": this.tok.T_THROW,
                    "if": this.tok.T_IF,
                    elseif: this.tok.T_ELSEIF,
                    endif: this.tok.T_ENDIF,
                    "else": this.tok.T_ELSE,
                    "while": this.tok.T_WHILE,
                    endwhile: this.tok.T_ENDWHILE,
                    "do": this.tok.T_DO,
                    "for": this.tok.T_FOR,
                    endfor: this.tok.T_ENDFOR,
                    foreach: this.tok.T_FOREACH,
                    endforeach: this.tok.T_ENDFOREACH,
                    declare: this.tok.T_DECLARE,
                    enddeclare: this.tok.T_ENDDECLARE,
                    "instanceof": this.tok.T_INSTANCEOF,
                    as: this.tok.T_AS,
                    "switch": this.tok.T_SWITCH,
                    endswitch: this.tok.T_ENDSWITCH,
                    "case": this.tok.T_CASE,
                    "default": this.tok.T_DEFAULT,
                    "break": this.tok.T_BREAK,
                    "continue": this.tok.T_CONTINUE,
                    "goto": this.tok.T_GOTO,
                    echo: this.tok.T_ECHO,
                    print: this.tok.T_PRINT,
                    "class": this.tok.T_CLASS,
                    "interface": this.tok.T_INTERFACE,
                    trait: this.tok.T_TRAIT,
                    "enum": this.tok.T_ENUM,
                    "extends": this.tok.T_EXTENDS,
                    "implements": this.tok.T_IMPLEMENTS,
                    "new": this.tok.T_NEW,
                    clone: this.tok.T_CLONE,
                    "var": this.tok.T_VAR,
                    eval: this.tok.T_EVAL,
                    include: this.tok.T_INCLUDE,
                    include_once: this.tok.T_INCLUDE_ONCE,
                    require: this.tok.T_REQUIRE,
                    require_once: this.tok.T_REQUIRE_ONCE,
                    namespace: this.tok.T_NAMESPACE,
                    use: this.tok.T_USE,
                    insteadof: this.tok.T_INSTEADOF,
                    global: this.tok.T_GLOBAL,
                    isset: this.tok.T_ISSET,
                    empty: this.tok.T_EMPTY,
                    __halt_compiler: this.tok.T_HALT_COMPILER,
                    "static": this.tok.T_STATIC,
                    "abstract": this.tok.T_ABSTRACT,
                    "final": this.tok.T_FINAL,
                    "private": this.tok.T_PRIVATE,
                    "protected": this.tok.T_PROTECTED,
                    "public": this.tok.T_PUBLIC,
                    unset: this.tok.T_UNSET,
                    list: this.tok.T_LIST,
                    array: this.tok.T_ARRAY,
                    callable: this.tok.T_CALLABLE,
                    or: this.tok.T_LOGICAL_OR,
                    and: this.tok.T_LOGICAL_AND,
                    xor: this.tok.T_LOGICAL_XOR,
                    match: this.tok.T_MATCH,
                    readonly: this.tok.T_READ_ONLY
                  };
                  this.castKeywords = {
                    "int": this.tok.T_INT_CAST,
                    integer: this.tok.T_INT_CAST,
                    real: this.tok.T_DOUBLE_CAST,
                    "double": this.tok.T_DOUBLE_CAST,
                    "float": this.tok.T_DOUBLE_CAST,
                    string: this.tok.T_STRING_CAST,
                    binary: this.tok.T_STRING_CAST,
                    array: this.tok.T_ARRAY_CAST,
                    object: this.tok.T_OBJECT_CAST,
                    bool: this.tok.T_BOOL_CAST,
                    "boolean": this.tok.T_BOOL_CAST,
                    unset: this.tok.T_UNSET_CAST
                  };
                };
                Lexer.prototype.setInput = function(input) {
                  this._input = input;
                  this.size = input.length;
                  this.yylineno = 1;
                  this.offset = 0;
                  this.yyprevcol = 0;
                  this.yytext = "";
                  this.yylloc = {
                    first_offset: 0,
                    first_line: 1,
                    first_column: 0,
                    prev_offset: 0,
                    prev_line: 1,
                    prev_column: 0,
                    last_line: 1,
                    last_column: 0
                  };
                  this.tokens = [];
                  if (this.version > 703) {
                    this.keywords.fn = this.tok.T_FN;
                  } else {
                    delete this.keywords.fn;
                  }
                  this.done = this.offset >= this.size;
                  if (!this.all_tokens && this.mode_eval) {
                    this.conditionStack = ["INITIAL"];
                    this.begin("ST_IN_SCRIPTING");
                  } else {
                    this.conditionStack = [];
                    this.begin("INITIAL");
                  }
                  this.heredoc_label = {
                    label: "",
                    length: 0,
                    indentation: 0,
                    indentation_uses_spaces: false,
                    finished: false,
                    /*
                     * this used for parser to detemine the if current node segment is first encaps node.
                     * if ture, the indentation will remove from the begining. and if false, the prev node
                     * might be a variable '}' ,and the leading spaces should not be removed util meet the
                     * first \n
                     */
                    first_encaps_node: false,
                    // for backward compatible
                    /* istanbul ignore next */
                    toString: function toString() {
                      this.label;
                    }
                  };
                  return this;
                };
                Lexer.prototype.input = function() {
                  var ch = this._input[this.offset];
                  if (!ch) return "";
                  this.yytext += ch;
                  this.offset++;
                  if (ch === "\r" && this._input[this.offset] === "\n") {
                    this.yytext += "\n";
                    this.offset++;
                  }
                  if (ch === "\n" || ch === "\r") {
                    this.yylloc.last_line = ++this.yylineno;
                    this.yyprevcol = this.yylloc.last_column;
                    this.yylloc.last_column = 0;
                  } else {
                    this.yylloc.last_column++;
                  }
                  return ch;
                };
                Lexer.prototype.unput = function(size) {
                  if (size === 1) {
                    this.offset--;
                    if (this._input[this.offset] === "\n" && this._input[this.offset - 1] === "\r") {
                      this.offset--;
                      size++;
                    }
                    if (this._input[this.offset] === "\r" || this._input[this.offset] === "\n") {
                      this.yylloc.last_line--;
                      this.yylineno--;
                      this.yylloc.last_column = this.yyprevcol;
                    } else {
                      this.yylloc.last_column--;
                    }
                    this.yytext = this.yytext.substring(0, this.yytext.length - size);
                  } else if (size > 0) {
                    this.offset -= size;
                    if (size < this.yytext.length) {
                      this.yytext = this.yytext.substring(0, this.yytext.length - size);
                      this.yylloc.last_line = this.yylloc.first_line;
                      this.yylloc.last_column = this.yyprevcol = this.yylloc.first_column;
                      for (var i = 0; i < this.yytext.length; i++) {
                        var c = this.yytext[i];
                        if (c === "\r") {
                          c = this.yytext[++i];
                          this.yyprevcol = this.yylloc.last_column;
                          this.yylloc.last_line++;
                          this.yylloc.last_column = 0;
                          if (c !== "\n") {
                            if (c === "\r") {
                              this.yylloc.last_line++;
                            } else {
                              this.yylloc.last_column++;
                            }
                          }
                        } else if (c === "\n") {
                          this.yyprevcol = this.yylloc.last_column;
                          this.yylloc.last_line++;
                          this.yylloc.last_column = 0;
                        } else {
                          this.yylloc.last_column++;
                        }
                      }
                      this.yylineno = this.yylloc.last_line;
                    } else {
                      this.yytext = "";
                      this.yylloc.last_line = this.yylineno = this.yylloc.first_line;
                      this.yylloc.last_column = this.yylloc.first_column;
                    }
                  }
                  return this;
                };
                Lexer.prototype.tryMatch = function(text) {
                  return text === this.ahead(text.length);
                };
                Lexer.prototype.tryMatchCaseless = function(text) {
                  return text === this.ahead(text.length).toLowerCase();
                };
                Lexer.prototype.ahead = function(size) {
                  var text = this._input.substring(this.offset, this.offset + size);
                  if (text[text.length - 1] === "\r" && this._input[this.offset + size + 1] === "\n") {
                    text += "\n";
                  }
                  return text;
                };
                Lexer.prototype.consume = function(size) {
                  for (var i = 0; i < size; i++) {
                    var ch = this._input[this.offset];
                    if (!ch) break;
                    this.yytext += ch;
                    this.offset++;
                    if (ch === "\r" && this._input[this.offset] === "\n") {
                      this.yytext += "\n";
                      this.offset++;
                      i++;
                    }
                    if (ch === "\n" || ch === "\r") {
                      this.yylloc.last_line = ++this.yylineno;
                      this.yyprevcol = this.yylloc.last_column;
                      this.yylloc.last_column = 0;
                    } else {
                      this.yylloc.last_column++;
                    }
                  }
                  return this;
                };
                Lexer.prototype.getState = function() {
                  return {
                    yytext: this.yytext,
                    offset: this.offset,
                    yylineno: this.yylineno,
                    yyprevcol: this.yyprevcol,
                    yylloc: {
                      first_offset: this.yylloc.first_offset,
                      first_line: this.yylloc.first_line,
                      first_column: this.yylloc.first_column,
                      last_line: this.yylloc.last_line,
                      last_column: this.yylloc.last_column
                    },
                    heredoc_label: this.heredoc_label
                  };
                };
                Lexer.prototype.setState = function(state) {
                  this.yytext = state.yytext;
                  this.offset = state.offset;
                  this.yylineno = state.yylineno;
                  this.yyprevcol = state.yyprevcol;
                  this.yylloc = state.yylloc;
                  if (state.heredoc_label) {
                    this.heredoc_label = state.heredoc_label;
                  }
                  return this;
                };
                Lexer.prototype.appendToken = function(value, ahead) {
                  this.tokens.push([value, ahead]);
                  return this;
                };
                Lexer.prototype.lex = function() {
                  this.yylloc.prev_offset = this.offset;
                  this.yylloc.prev_line = this.yylloc.last_line;
                  this.yylloc.prev_column = this.yylloc.last_column;
                  var token = this.next() || this.lex();
                  if (!this.all_tokens) {
                    while (token === this.tok.T_WHITESPACE || // ignore white space
                    !this.comment_tokens && (token === this.tok.T_COMMENT || // ignore single lines comments
                    token === this.tok.T_DOC_COMMENT) || // ignore doc comments
                    // ignore open tags
                    token === this.tok.T_OPEN_TAG) {
                      token = this.next() || this.lex();
                    }
                    if (token == this.tok.T_OPEN_TAG_WITH_ECHO) {
                      return this.tok.T_ECHO;
                    } else if (token === this.tok.T_CLOSE_TAG) {
                      return ";";
                    }
                  }
                  if (!this.yylloc.prev_offset) {
                    this.yylloc.prev_offset = this.yylloc.first_offset;
                    this.yylloc.prev_line = this.yylloc.first_line;
                    this.yylloc.prev_column = this.yylloc.first_column;
                  }
                  return token;
                };
                Lexer.prototype.begin = function(condition) {
                  this.conditionStack.push(condition);
                  this.curCondition = condition;
                  this.stateCb = this["match" + condition];
                  if (typeof this.stateCb !== "function") {
                    throw new Error('Undefined condition state "' + condition + '"');
                  }
                  return this;
                };
                Lexer.prototype.popState = function() {
                  var n = this.conditionStack.length - 1;
                  var condition = n > 0 ? this.conditionStack.pop() : this.conditionStack[0];
                  this.curCondition = this.conditionStack[this.conditionStack.length - 1];
                  this.stateCb = this["match" + this.curCondition];
                  if (typeof this.stateCb !== "function") {
                    throw new Error('Undefined condition state "' + this.curCondition + '"');
                  }
                  return condition;
                };
                Lexer.prototype.next = function() {
                  var token;
                  if (!this._input) {
                    this.done = true;
                  }
                  this.yylloc.first_offset = this.offset;
                  this.yylloc.first_line = this.yylloc.last_line;
                  this.yylloc.first_column = this.yylloc.last_column;
                  this.yytext = "";
                  if (this.done) {
                    this.yylloc.prev_offset = this.yylloc.first_offset;
                    this.yylloc.prev_line = this.yylloc.first_line;
                    this.yylloc.prev_column = this.yylloc.first_column;
                    return this.EOF;
                  }
                  if (this.tokens.length > 0) {
                    token = this.tokens.shift();
                    if (_typeof(token[1]) === "object") {
                      this.setState(token[1]);
                    } else {
                      this.consume(token[1]);
                    }
                    token = token[0];
                  } else {
                    token = this.stateCb.apply(this, []);
                  }
                  if (this.offset >= this.size && this.tokens.length === 0) {
                    this.done = true;
                  }
                  if (this.debug) {
                    var tName = token;
                    if (typeof tName === "number") {
                      tName = this.engine.tokens.values[tName];
                    } else {
                      tName = '"' + tName + '"';
                    }
                    var e = new Error(tName + "	from " + this.yylloc.first_line + "," + this.yylloc.first_column + "	 - to " + this.yylloc.last_line + "," + this.yylloc.last_column + '	"' + this.yytext + '"');
                    console.error(e.stack);
                  }
                  return token;
                };
                [__webpack_require__2(9671), __webpack_require__2(2429), __webpack_require__2(3683), __webpack_require__2(6545), __webpack_require__2(3810), __webpack_require__2(8510), __webpack_require__2(4401), __webpack_require__2(4349), __webpack_require__2(8582)].forEach(function(ext) {
                  for (var k in ext) {
                    Lexer.prototype[k] = ext[k];
                  }
                });
                module2.exports = Lexer;
              },
              /***/
              9671(module2) {
                module2.exports = {
                  attributeIndex: 0,
                  attributeListDepth: {},
                  matchST_ATTRIBUTE: function matchST_ATTRIBUTE() {
                    var ch = this.input();
                    if (this.is_WHITESPACE()) {
                      do {
                        this.input();
                      } while (this.is_WHITESPACE());
                      this.unput(1);
                      return null;
                    }
                    switch (ch) {
                      case "]":
                        if (this.attributeListDepth[this.attributeIndex] === 0) {
                          delete this.attributeListDepth[this.attributeIndex];
                          this.attributeIndex--;
                          this.popState();
                        } else {
                          this.attributeListDepth[this.attributeIndex]--;
                        }
                        return "]";
                      case "(":
                      case ")":
                      case ":":
                      case "=":
                      case "|":
                      case "&":
                      case "^":
                      case "-":
                      case "+":
                      case "*":
                      case "%":
                      case "~":
                      case "<":
                      case ">":
                      case "!":
                      case ".":
                        return this.consume_TOKEN();
                      case "[":
                        this.attributeListDepth[this.attributeIndex]++;
                        return "[";
                      case ",":
                        return ",";
                      case '"':
                        return this.ST_DOUBLE_QUOTES();
                      case "'":
                        return this.T_CONSTANT_ENCAPSED_STRING();
                      case "/":
                        if (this._input[this.offset] === "/") {
                          return this.T_COMMENT();
                        } else if (this._input[this.offset] === "*") {
                          this.input();
                          return this.T_DOC_COMMENT();
                        } else {
                          return this.consume_TOKEN();
                        }
                    }
                    if (this.is_LABEL_START() || ch === "\\") {
                      while (this.offset < this.size) {
                        var _ch = this.input();
                        if (!(this.is_LABEL() || _ch === "\\")) {
                          if (_ch) this.unput(1);
                          break;
                        }
                      }
                      return this.T_STRING();
                    } else if (this.is_NUM()) {
                      return this.consume_NUM();
                    }
                    throw new Error('Bad terminal sequence "'.concat(ch, '" at line ').concat(this.yylineno, " (offset ").concat(this.offset, ")"));
                  }
                };
              },
              /***/
              2429(module2) {
                module2.exports = {
                  /*
                   * Reads a single line comment
                   */
                  T_COMMENT: function T_COMMENT() {
                    while (this.offset < this.size) {
                      var ch = this.input();
                      if (ch === "\n" || ch === "\r") {
                        return this.tok.T_COMMENT;
                      } else if (ch === "?" && !this.aspTagMode && this._input[this.offset] === ">") {
                        this.unput(1);
                        return this.tok.T_COMMENT;
                      } else if (ch === "%" && this.aspTagMode && this._input[this.offset] === ">") {
                        this.unput(1);
                        return this.tok.T_COMMENT;
                      }
                    }
                    return this.tok.T_COMMENT;
                  },
                  /*
                   * Behaviour : https://github.com/php/php-src/blob/master/Zend/zend_language_scanner.l#L1927
                   */
                  T_DOC_COMMENT: function T_DOC_COMMENT() {
                    var ch = this.input();
                    var token = this.tok.T_COMMENT;
                    if (ch === "*") {
                      ch = this.input();
                      if (this.is_WHITESPACE()) {
                        token = this.tok.T_DOC_COMMENT;
                      }
                      if (ch === "/") {
                        return token;
                      } else {
                        this.unput(1);
                      }
                    }
                    while (this.offset < this.size) {
                      ch = this.input();
                      if (ch === "*" && this._input[this.offset] === "/") {
                        this.input();
                        break;
                      }
                    }
                    return token;
                  }
                };
              },
              /***/
              3683(module2) {
                module2.exports = {
                  nextINITIAL: function nextINITIAL() {
                    if (this.conditionStack.length > 1 && this.conditionStack[this.conditionStack.length - 1] === "INITIAL") {
                      this.popState();
                    } else {
                      this.begin("ST_IN_SCRIPTING");
                    }
                    return this;
                  },
                  matchINITIAL: function matchINITIAL() {
                    while (this.offset < this.size) {
                      var ch = this.input();
                      if (ch == "<") {
                        ch = this.ahead(1);
                        if (ch == "?") {
                          if (this.tryMatch("?=")) {
                            this.unput(1).appendToken(this.tok.T_OPEN_TAG_WITH_ECHO, 3).nextINITIAL();
                            break;
                          } else if (this.tryMatchCaseless("?php")) {
                            ch = this._input[this.offset + 4];
                            if (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
                              this.unput(1).appendToken(this.tok.T_OPEN_TAG, 6).nextINITIAL();
                              break;
                            }
                          }
                          if (this.short_tags) {
                            this.unput(1).appendToken(this.tok.T_OPEN_TAG, 2).nextINITIAL();
                            break;
                          }
                        } else if (this.asp_tags && ch == "%") {
                          if (this.tryMatch("%=")) {
                            this.aspTagMode = true;
                            this.unput(1).appendToken(this.tok.T_OPEN_TAG_WITH_ECHO, 3).nextINITIAL();
                            break;
                          } else {
                            this.aspTagMode = true;
                            this.unput(1).appendToken(this.tok.T_OPEN_TAG, 2).nextINITIAL();
                            break;
                          }
                        }
                      }
                    }
                    if (this.yytext.length > 0) {
                      return this.tok.T_INLINE_HTML;
                    } else {
                      return false;
                    }
                  }
                };
              },
              /***/
              6545(module2) {
                var MAX_LENGTH_OF_LONG = 10;
                var long_min_digits = "2147483648";
                if (process.arch == "x64") {
                  MAX_LENGTH_OF_LONG = 19;
                  long_min_digits = "9223372036854775808";
                }
                module2.exports = {
                  consume_NUM: function consume_NUM() {
                    var ch = this.yytext[0];
                    var hasPoint = ch === ".";
                    if (ch === "0") {
                      ch = this.input();
                      if (ch === "x" || ch === "X") {
                        ch = this.input();
                        if (ch !== "_" && this.is_HEX()) {
                          return this.consume_HNUM();
                        } else {
                          this.unput(ch ? 2 : 1);
                        }
                      } else if (ch === "b" || ch === "B") {
                        ch = this.input();
                        if (ch !== "_" && ch === "0" || ch === "1") {
                          return this.consume_BNUM();
                        } else {
                          this.unput(ch ? 2 : 1);
                        }
                      } else if (ch === "o" || ch === "O") {
                        ch = this.input();
                        if (ch !== "_" && this.is_OCTAL()) {
                          return this.consume_ONUM();
                        } else {
                          this.unput(ch ? 2 : 1);
                        }
                      } else if (!this.is_NUM()) {
                        if (ch) this.unput(1);
                      }
                    }
                    while (this.offset < this.size) {
                      var prev = ch;
                      ch = this.input();
                      if (ch === "_") {
                        if (prev === "_") {
                          this.unput(2);
                          break;
                        }
                        if (prev === ".") {
                          this.unput(1);
                          break;
                        }
                        if (prev === "e" || prev === "E") {
                          this.unput(2);
                          break;
                        }
                      } else if (ch === ".") {
                        if (hasPoint) {
                          this.unput(1);
                          break;
                        }
                        if (prev === "_") {
                          this.unput(2);
                          break;
                        }
                        hasPoint = true;
                        continue;
                      } else if (ch === "e" || ch === "E") {
                        if (prev === "_") {
                          this.unput(1);
                          break;
                        }
                        var undo = 2;
                        ch = this.input();
                        if (ch === "+" || ch === "-") {
                          undo = 3;
                          ch = this.input();
                        }
                        if (this.is_NUM_START()) {
                          this.consume_LNUM();
                          return this.tok.T_DNUMBER;
                        }
                        this.unput(ch ? undo : undo - 1);
                        break;
                      }
                      if (!this.is_NUM()) {
                        if (ch) this.unput(1);
                        break;
                      }
                    }
                    if (hasPoint) {
                      return this.tok.T_DNUMBER;
                    } else if (this.yytext.length < MAX_LENGTH_OF_LONG - 1) {
                      return this.tok.T_LNUMBER;
                    } else {
                      if (this.yytext.length < MAX_LENGTH_OF_LONG || this.yytext.length == MAX_LENGTH_OF_LONG && this.yytext < long_min_digits) {
                        return this.tok.T_LNUMBER;
                      }
                      return this.tok.T_DNUMBER;
                    }
                  },
                  // read hexa
                  consume_HNUM: function consume_HNUM() {
                    while (this.offset < this.size) {
                      var ch = this.input();
                      if (!this.is_HEX()) {
                        if (ch) this.unput(1);
                        break;
                      }
                    }
                    return this.tok.T_LNUMBER;
                  },
                  // read a generic number
                  consume_LNUM: function consume_LNUM() {
                    while (this.offset < this.size) {
                      var ch = this.input();
                      if (!this.is_NUM()) {
                        if (ch) this.unput(1);
                        break;
                      }
                    }
                    return this.tok.T_LNUMBER;
                  },
                  // read binary
                  consume_BNUM: function consume_BNUM() {
                    var ch;
                    while (this.offset < this.size) {
                      ch = this.input();
                      if (ch !== "0" && ch !== "1" && ch !== "_") {
                        if (ch) this.unput(1);
                        break;
                      }
                    }
                    return this.tok.T_LNUMBER;
                  },
                  // read an octal number
                  consume_ONUM: function consume_ONUM() {
                    while (this.offset < this.size) {
                      var ch = this.input();
                      if (!this.is_OCTAL()) {
                        if (ch) this.unput(1);
                        break;
                      }
                    }
                    return this.tok.T_LNUMBER;
                  }
                };
              },
              /***/
              3810(module2) {
                module2.exports = {
                  matchST_LOOKING_FOR_PROPERTY: function matchST_LOOKING_FOR_PROPERTY() {
                    var ch = this.input();
                    if (ch === "-") {
                      ch = this.input();
                      if (ch === ">") {
                        return this.tok.T_OBJECT_OPERATOR;
                      }
                      if (ch) this.unput(1);
                    } else if (this.is_WHITESPACE()) {
                      return this.tok.T_WHITESPACE;
                    } else if (this.is_LABEL_START()) {
                      this.consume_LABEL();
                      this.popState();
                      return this.tok.T_STRING;
                    }
                    this.popState();
                    if (ch) this.unput(1);
                    return false;
                  },
                  matchST_LOOKING_FOR_VARNAME: function matchST_LOOKING_FOR_VARNAME() {
                    var ch = this.input();
                    this.popState();
                    this.begin("ST_IN_SCRIPTING");
                    if (this.is_LABEL_START()) {
                      this.consume_LABEL();
                      ch = this.input();
                      if (ch === "[" || ch === "}") {
                        this.unput(1);
                        return this.tok.T_STRING_VARNAME;
                      } else {
                        this.unput(this.yytext.length);
                      }
                    } else {
                      if (ch) this.unput(1);
                    }
                    return false;
                  },
                  matchST_VAR_OFFSET: function matchST_VAR_OFFSET() {
                    var ch = this.input();
                    if (this.is_NUM_START()) {
                      this.consume_NUM();
                      return this.tok.T_NUM_STRING;
                    } else if (ch === "]") {
                      this.popState();
                      return "]";
                    } else if (ch === "$") {
                      this.input();
                      if (this.is_LABEL_START()) {
                        this.consume_LABEL();
                        return this.tok.T_VARIABLE;
                      } else {
                        throw new Error("Unexpected terminal");
                      }
                    } else if (this.is_LABEL_START()) {
                      this.consume_LABEL();
                      return this.tok.T_STRING;
                    } else if (this.is_WHITESPACE() || ch === "\\" || ch === "'" || ch === "#") {
                      return this.tok.T_ENCAPSED_AND_WHITESPACE;
                    } else if (ch === "[" || ch === "{" || ch === "}" || ch === '"' || ch === "`" || this.is_TOKEN()) {
                      return ch;
                    } else {
                      throw new Error("Unexpected terminal");
                    }
                  }
                };
              },
              /***/
              8510(module2) {
                module2.exports = {
                  matchST_IN_SCRIPTING: function matchST_IN_SCRIPTING() {
                    var ch = this.input();
                    switch (ch) {
                      case " ":
                      case "	":
                      case "\n":
                      case "\r":
                      case "\r\n":
                        return this.T_WHITESPACE();
                      case "#":
                        if (this.version >= 800 && this._input[this.offset] === "[") {
                          this.input();
                          this.attributeListDepth[++this.attributeIndex] = 0;
                          this.begin("ST_ATTRIBUTE");
                          return this.tok.T_ATTRIBUTE;
                        }
                        return this.T_COMMENT();
                      case "/":
                        if (this._input[this.offset] === "/") {
                          return this.T_COMMENT();
                        } else if (this._input[this.offset] === "*") {
                          this.input();
                          return this.T_DOC_COMMENT();
                        }
                        return this.consume_TOKEN();
                      case "'":
                        return this.T_CONSTANT_ENCAPSED_STRING();
                      case '"':
                        return this.ST_DOUBLE_QUOTES();
                      case "`":
                        this.begin("ST_BACKQUOTE");
                        return "`";
                      case "?":
                        if (!this.aspTagMode && this.tryMatch(">")) {
                          this.input();
                          var nextCH = this._input[this.offset];
                          if (nextCH === "\n" || nextCH === "\r") this.input();
                          if (this.conditionStack.length > 1) {
                            this.begin("INITIAL");
                          }
                          return this.tok.T_CLOSE_TAG;
                        }
                        return this.consume_TOKEN();
                      case "%":
                        if (this.aspTagMode && this._input[this.offset] === ">") {
                          this.input();
                          ch = this._input[this.offset];
                          if (ch === "\n" || ch === "\r") {
                            this.input();
                          }
                          this.aspTagMode = false;
                          if (this.conditionStack.length > 1) {
                            this.begin("INITIAL");
                          }
                          return this.tok.T_CLOSE_TAG;
                        }
                        return this.consume_TOKEN();
                      case "{":
                        this.begin("ST_IN_SCRIPTING");
                        return "{";
                      case "}":
                        if (this.conditionStack.length > 2) {
                          this.popState();
                        }
                        return "}";
                      default:
                        if (ch === ".") {
                          ch = this.input();
                          if (this.is_NUM_START()) {
                            return this.consume_NUM();
                          } else {
                            if (ch) this.unput(1);
                          }
                        }
                        if (this.is_NUM_START()) {
                          return this.consume_NUM();
                        } else if (this.is_LABEL_START()) {
                          return this.consume_LABEL().T_STRING();
                        } else if (this.is_TOKEN()) {
                          return this.consume_TOKEN();
                        }
                    }
                    throw new Error('Bad terminal sequence "' + ch + '" at line ' + this.yylineno + " (offset " + this.offset + ")");
                  },
                  T_WHITESPACE: function T_WHITESPACE() {
                    while (this.offset < this.size) {
                      var ch = this.input();
                      if (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
                        continue;
                      }
                      if (ch) this.unput(1);
                      break;
                    }
                    return this.tok.T_WHITESPACE;
                  }
                };
              },
              /***/
              4401(module2) {
                var newline = ["\n", "\r"];
                var valid_after_heredoc = ["\n", "\r", ";"];
                var valid_after_heredoc_73 = valid_after_heredoc.concat(["	", " ", ",", "]", ")", "/", "=", "!", "."]);
                module2.exports = {
                  T_CONSTANT_ENCAPSED_STRING: function T_CONSTANT_ENCAPSED_STRING() {
                    var ch;
                    while (this.offset < this.size) {
                      ch = this.input();
                      if (ch == "\\") {
                        this.input();
                      } else if (ch == "'") {
                        break;
                      }
                    }
                    return this.tok.T_CONSTANT_ENCAPSED_STRING;
                  },
                  // check if matching a HEREDOC state
                  is_HEREDOC: function is_HEREDOC() {
                    var revert = this.offset;
                    if (this._input[this.offset - 1] === "<" && this._input[this.offset] === "<" && this._input[this.offset + 1] === "<") {
                      this.offset += 3;
                      if (this.is_TABSPACE()) {
                        while (this.offset < this.size) {
                          this.offset++;
                          if (!this.is_TABSPACE()) {
                            break;
                          }
                        }
                      }
                      var tChar = this._input[this.offset - 1];
                      if (tChar === "'" || tChar === '"') {
                        this.offset++;
                      } else {
                        tChar = null;
                      }
                      if (this.is_LABEL_START()) {
                        var yyoffset = this.offset - 1;
                        while (this.offset < this.size) {
                          this.offset++;
                          if (!this.is_LABEL()) {
                            break;
                          }
                        }
                        var yylabel = this._input.substring(yyoffset, this.offset - 1);
                        if (!tChar || tChar === this._input[this.offset - 1]) {
                          if (tChar) this.offset++;
                          if (newline.includes(this._input[this.offset - 1])) {
                            this.heredoc_label.label = yylabel;
                            this.heredoc_label.length = yylabel.length;
                            this.heredoc_label.finished = false;
                            yyoffset = this.offset - revert;
                            this.offset = revert;
                            this.consume(yyoffset);
                            if (tChar === "'") {
                              this.begin("ST_NOWDOC");
                            } else {
                              this.begin("ST_HEREDOC");
                            }
                            this.prematch_ENDOFDOC();
                            return this.tok.T_START_HEREDOC;
                          }
                        }
                      }
                    }
                    this.offset = revert;
                    return false;
                  },
                  ST_DOUBLE_QUOTES: function ST_DOUBLE_QUOTES() {
                    var ch;
                    while (this.offset < this.size) {
                      ch = this.input();
                      if (ch == "\\") {
                        this.input();
                      } else if (ch == '"') {
                        break;
                      } else if (ch == "$") {
                        ch = this.input();
                        if (ch == "{" || this.is_LABEL_START()) {
                          this.unput(2);
                          break;
                        }
                        if (ch) this.unput(1);
                      } else if (ch == "{") {
                        ch = this.input();
                        if (ch == "$") {
                          this.unput(2);
                          break;
                        }
                        if (ch) this.unput(1);
                      }
                    }
                    if (ch == '"') {
                      return this.tok.T_CONSTANT_ENCAPSED_STRING;
                    } else {
                      var prefix = 1;
                      if (this.yytext[0] === "b" || this.yytext[0] === "B") {
                        prefix = 2;
                      }
                      if (this.yytext.length > 2) {
                        this.appendToken(this.tok.T_ENCAPSED_AND_WHITESPACE, this.yytext.length - prefix);
                      }
                      this.unput(this.yytext.length - prefix);
                      this.begin("ST_DOUBLE_QUOTES");
                      return this.yytext;
                    }
                  },
                  // check if its a DOC end sequence
                  isDOC_MATCH: function isDOC_MATCH(offset, consumeLeadingSpaces) {
                    var prev_ch = this._input[offset - 2];
                    if (!newline.includes(prev_ch)) {
                      return false;
                    }
                    var indentation_uses_spaces = false;
                    var indentation_uses_tabs = false;
                    var indentation = 0;
                    var leading_ch = this._input[offset - 1];
                    if (this.version >= 703) {
                      while (leading_ch === "	" || leading_ch === " ") {
                        if (leading_ch === " ") {
                          indentation_uses_spaces = true;
                        } else if (leading_ch === "	") {
                          indentation_uses_tabs = true;
                        }
                        leading_ch = this._input[offset + indentation];
                        indentation++;
                      }
                      offset = offset + indentation;
                      if (newline.includes(this._input[offset - 1])) {
                        return false;
                      }
                    }
                    if (this._input.substring(offset - 1, offset - 1 + this.heredoc_label.length) === this.heredoc_label.label) {
                      var ch = this._input[offset - 1 + this.heredoc_label.length];
                      if ((this.version >= 703 ? valid_after_heredoc_73 : valid_after_heredoc).includes(ch)) {
                        if (consumeLeadingSpaces) {
                          this.consume(indentation);
                          if (indentation_uses_spaces && indentation_uses_tabs) {
                            throw new Error("Parse error:  mixing spaces and tabs in ending marker at line " + this.yylineno + " (offset " + this.offset + ")");
                          }
                        } else {
                          this.heredoc_label.indentation = indentation;
                          this.heredoc_label.indentation_uses_spaces = indentation_uses_spaces;
                          this.heredoc_label.first_encaps_node = true;
                        }
                        return true;
                      }
                    }
                    return false;
                  },
                  /*
                   * Prematch the end of HEREDOC/NOWDOC end tag to preset the
                   * context of this.heredoc_label
                   */
                  prematch_ENDOFDOC: function prematch_ENDOFDOC() {
                    this.heredoc_label.indentation_uses_spaces = false;
                    this.heredoc_label.indentation = 0;
                    this.heredoc_label.first_encaps_node = true;
                    var offset = this.offset + 1;
                    while (offset < this._input.length) {
                      if (this.isDOC_MATCH(offset, false)) {
                        return;
                      }
                      if (!newline.includes(this._input[offset - 1])) {
                        while (!newline.includes(this._input[offset++]) && offset < this._input.length) {
                        }
                      }
                      offset++;
                    }
                  },
                  matchST_NOWDOC: function matchST_NOWDOC() {
                    if (this.isDOC_MATCH(this.offset, true)) {
                      this.consume(this.heredoc_label.length);
                      this.popState();
                      return this.tok.T_END_HEREDOC;
                    }
                    var ch = this._input[this.offset - 1];
                    while (this.offset < this.size) {
                      if (newline.includes(ch)) {
                        ch = this.input();
                        if (this.isDOC_MATCH(this.offset, true)) {
                          this.unput(1).popState();
                          this.appendToken(this.tok.T_END_HEREDOC, this.heredoc_label.length);
                          return this.tok.T_ENCAPSED_AND_WHITESPACE;
                        }
                      } else {
                        ch = this.input();
                      }
                    }
                    return this.tok.T_ENCAPSED_AND_WHITESPACE;
                  },
                  matchST_HEREDOC: function matchST_HEREDOC() {
                    var ch = this.input();
                    if (this.isDOC_MATCH(this.offset, true)) {
                      this.consume(this.heredoc_label.length - 1);
                      this.popState();
                      return this.tok.T_END_HEREDOC;
                    }
                    while (this.offset < this.size) {
                      if (ch === "\\") {
                        ch = this.input();
                        if (!newline.includes(ch)) {
                          ch = this.input();
                        }
                      }
                      if (newline.includes(ch)) {
                        ch = this.input();
                        if (this.isDOC_MATCH(this.offset, true)) {
                          this.unput(1).popState();
                          this.appendToken(this.tok.T_END_HEREDOC, this.heredoc_label.length);
                          return this.tok.T_ENCAPSED_AND_WHITESPACE;
                        }
                      } else if (ch === "$") {
                        ch = this.input();
                        if (ch === "{") {
                          this.begin("ST_LOOKING_FOR_VARNAME");
                          if (this.yytext.length > 2) {
                            this.appendToken(this.tok.T_DOLLAR_OPEN_CURLY_BRACES, 2);
                            this.unput(2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            return this.tok.T_DOLLAR_OPEN_CURLY_BRACES;
                          }
                        } else if (this.is_LABEL_START()) {
                          var yyoffset = this.offset;
                          var next = this.consume_VARIABLE();
                          if (this.yytext.length > this.offset - yyoffset + 2) {
                            this.appendToken(next, this.offset - yyoffset + 2);
                            this.unput(this.offset - yyoffset + 2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            return next;
                          }
                        }
                      } else if (ch === "{") {
                        ch = this.input();
                        if (ch === "$") {
                          this.begin("ST_IN_SCRIPTING");
                          if (this.yytext.length > 2) {
                            this.appendToken(this.tok.T_CURLY_OPEN, 1);
                            this.unput(2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            this.unput(1);
                            return this.tok.T_CURLY_OPEN;
                          }
                        }
                      } else {
                        ch = this.input();
                      }
                    }
                    return this.tok.T_ENCAPSED_AND_WHITESPACE;
                  },
                  consume_VARIABLE: function consume_VARIABLE() {
                    this.consume_LABEL();
                    var ch = this.input();
                    if (ch == "[") {
                      this.unput(1);
                      this.begin("ST_VAR_OFFSET");
                      return this.tok.T_VARIABLE;
                    } else if (ch === "-") {
                      if (this.input() === ">") {
                        this.input();
                        if (this.is_LABEL_START()) {
                          this.begin("ST_LOOKING_FOR_PROPERTY");
                        }
                        this.unput(3);
                        return this.tok.T_VARIABLE;
                      } else {
                        this.unput(2);
                      }
                    } else {
                      if (ch) this.unput(1);
                    }
                    return this.tok.T_VARIABLE;
                  },
                  // HANDLES BACKQUOTES
                  matchST_BACKQUOTE: function matchST_BACKQUOTE() {
                    var ch = this.input();
                    if (ch === "$") {
                      ch = this.input();
                      if (ch === "{") {
                        this.begin("ST_LOOKING_FOR_VARNAME");
                        return this.tok.T_DOLLAR_OPEN_CURLY_BRACES;
                      } else if (this.is_LABEL_START()) {
                        var tok = this.consume_VARIABLE();
                        return tok;
                      }
                    } else if (ch === "{") {
                      if (this._input[this.offset] === "$") {
                        this.begin("ST_IN_SCRIPTING");
                        return this.tok.T_CURLY_OPEN;
                      }
                    } else if (ch === "`") {
                      this.popState();
                      return "`";
                    }
                    while (this.offset < this.size) {
                      if (ch === "\\") {
                        this.input();
                      } else if (ch === "`") {
                        this.unput(1);
                        this.popState();
                        this.appendToken("`", 1);
                        break;
                      } else if (ch === "$") {
                        ch = this.input();
                        if (ch === "{") {
                          this.begin("ST_LOOKING_FOR_VARNAME");
                          if (this.yytext.length > 2) {
                            this.appendToken(this.tok.T_DOLLAR_OPEN_CURLY_BRACES, 2);
                            this.unput(2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            return this.tok.T_DOLLAR_OPEN_CURLY_BRACES;
                          }
                        } else if (this.is_LABEL_START()) {
                          var yyoffset = this.offset;
                          var next = this.consume_VARIABLE();
                          if (this.yytext.length > this.offset - yyoffset + 2) {
                            this.appendToken(next, this.offset - yyoffset + 2);
                            this.unput(this.offset - yyoffset + 2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            return next;
                          }
                        }
                        continue;
                      } else if (ch === "{") {
                        ch = this.input();
                        if (ch === "$") {
                          this.begin("ST_IN_SCRIPTING");
                          if (this.yytext.length > 2) {
                            this.appendToken(this.tok.T_CURLY_OPEN, 1);
                            this.unput(2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            this.unput(1);
                            return this.tok.T_CURLY_OPEN;
                          }
                        }
                        continue;
                      }
                      ch = this.input();
                    }
                    return this.tok.T_ENCAPSED_AND_WHITESPACE;
                  },
                  matchST_DOUBLE_QUOTES: function matchST_DOUBLE_QUOTES() {
                    var ch = this.input();
                    if (ch === "$") {
                      ch = this.input();
                      if (ch === "{") {
                        this.begin("ST_LOOKING_FOR_VARNAME");
                        return this.tok.T_DOLLAR_OPEN_CURLY_BRACES;
                      } else if (this.is_LABEL_START()) {
                        var tok = this.consume_VARIABLE();
                        return tok;
                      }
                    } else if (ch === "{") {
                      if (this._input[this.offset] === "$") {
                        this.begin("ST_IN_SCRIPTING");
                        return this.tok.T_CURLY_OPEN;
                      }
                    } else if (ch === '"') {
                      this.popState();
                      return '"';
                    }
                    while (this.offset < this.size) {
                      if (ch === "\\") {
                        this.input();
                      } else if (ch === '"') {
                        this.unput(1);
                        this.popState();
                        this.appendToken('"', 1);
                        break;
                      } else if (ch === "$") {
                        ch = this.input();
                        if (ch === "{") {
                          this.begin("ST_LOOKING_FOR_VARNAME");
                          if (this.yytext.length > 2) {
                            this.appendToken(this.tok.T_DOLLAR_OPEN_CURLY_BRACES, 2);
                            this.unput(2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            return this.tok.T_DOLLAR_OPEN_CURLY_BRACES;
                          }
                        } else if (this.is_LABEL_START()) {
                          var yyoffset = this.offset;
                          var next = this.consume_VARIABLE();
                          if (this.yytext.length > this.offset - yyoffset + 2) {
                            this.appendToken(next, this.offset - yyoffset + 2);
                            this.unput(this.offset - yyoffset + 2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            return next;
                          }
                        }
                        if (ch) this.unput(1);
                      } else if (ch === "{") {
                        ch = this.input();
                        if (ch === "$") {
                          this.begin("ST_IN_SCRIPTING");
                          if (this.yytext.length > 2) {
                            this.appendToken(this.tok.T_CURLY_OPEN, 1);
                            this.unput(2);
                            return this.tok.T_ENCAPSED_AND_WHITESPACE;
                          } else {
                            this.unput(1);
                            return this.tok.T_CURLY_OPEN;
                          }
                        }
                        if (ch) this.unput(1);
                      }
                      ch = this.input();
                    }
                    return this.tok.T_ENCAPSED_AND_WHITESPACE;
                  }
                };
              },
              /***/
              4349(module2) {
                module2.exports = {
                  T_STRING: function T_STRING() {
                    var token = this.yytext.toLowerCase();
                    var id = this.keywords[token];
                    if (typeof id !== "number") {
                      if (token === "yield") {
                        if (this.version >= 700 && this.tryMatch(" from")) {
                          this.consume(5);
                          id = this.tok.T_YIELD_FROM;
                        } else {
                          id = this.tok.T_YIELD;
                        }
                      } else {
                        id = this.tok.T_STRING;
                        if (token === "b" || token === "B") {
                          var ch = this.input();
                          if (ch === '"') {
                            return this.ST_DOUBLE_QUOTES();
                          } else if (ch === "'") {
                            return this.T_CONSTANT_ENCAPSED_STRING();
                          } else if (ch) {
                            this.unput(1);
                          }
                        }
                      }
                    }
                    if (id === this.tok.T_ENUM) {
                      if (this.version < 801) {
                        return this.tok.T_STRING;
                      }
                      var initial = this.offset;
                      var _ch = this.input();
                      while (_ch == " ") {
                        _ch = this.input();
                      }
                      var isEnum = false;
                      if (this.is_LABEL_START()) {
                        while (this.is_LABEL()) {
                          _ch += this.input();
                        }
                        var label = _ch.slice(0, -1).toLowerCase();
                        isEnum = label !== "extends" && label !== "implements";
                      }
                      this.unput(this.offset - initial);
                      return isEnum ? this.tok.T_ENUM : this.tok.T_STRING;
                    }
                    if (this.offset < this.size && id !== this.tok.T_YIELD_FROM) {
                      var _ch2 = this.input();
                      if (_ch2 === "\\") {
                        id = token === "namespace" ? this.tok.T_NAME_RELATIVE : this.tok.T_NAME_QUALIFIED;
                        do {
                          if (this._input[this.offset] === "{") {
                            this.input();
                            break;
                          }
                          this.consume_LABEL();
                          _ch2 = this.input();
                        } while (_ch2 === "\\");
                      }
                      if (_ch2) {
                        this.unput(1);
                      }
                    }
                    return id;
                  },
                  // reads a custom token
                  consume_TOKEN: function consume_TOKEN() {
                    var ch = this._input[this.offset - 1];
                    var fn = this.tokenTerminals[ch];
                    if (fn) {
                      return fn.apply(this, []);
                    } else {
                      return this.yytext;
                    }
                  },
                  // list of special char tokens
                  tokenTerminals: {
                    $: function $() {
                      this.offset++;
                      if (this.is_LABEL_START()) {
                        this.offset--;
                        this.consume_LABEL();
                        return this.tok.T_VARIABLE;
                      } else {
                        this.offset--;
                        return "$";
                      }
                    },
                    "-": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === ">") {
                        this.begin("ST_LOOKING_FOR_PROPERTY").input();
                        return this.tok.T_OBJECT_OPERATOR;
                      } else if (nchar === "-") {
                        this.input();
                        return this.tok.T_DEC;
                      } else if (nchar === "=") {
                        this.input();
                        return this.tok.T_MINUS_EQUAL;
                      }
                      return "-";
                    },
                    "\\": function _() {
                      if (this.offset < this.size) {
                        this.input();
                        if (this.is_LABEL_START()) {
                          var ch;
                          do {
                            if (this._input[this.offset] === "{") {
                              this.input();
                              break;
                            }
                            this.consume_LABEL();
                            ch = this.input();
                          } while (ch === "\\");
                          this.unput(1);
                          return this.tok.T_NAME_FULLY_QUALIFIED;
                        } else {
                          this.unput(1);
                        }
                      }
                      return this.tok.T_NS_SEPARATOR;
                    },
                    "/": function _() {
                      if (this._input[this.offset] === "=") {
                        this.input();
                        return this.tok.T_DIV_EQUAL;
                      }
                      return "/";
                    },
                    ":": function _() {
                      if (this._input[this.offset] === ":") {
                        this.input();
                        return this.tok.T_DOUBLE_COLON;
                      } else {
                        return ":";
                      }
                    },
                    "(": function _() {
                      var initial = this.offset;
                      this.input();
                      if (this.is_TABSPACE()) {
                        this.consume_TABSPACE().input();
                      }
                      if (this.is_LABEL_START()) {
                        var yylen = this.yytext.length;
                        this.consume_LABEL();
                        var castToken = this.yytext.substring(yylen - 1).toLowerCase();
                        var castId = this.castKeywords[castToken];
                        if (typeof castId === "number") {
                          this.input();
                          if (this.is_TABSPACE()) {
                            this.consume_TABSPACE().input();
                          }
                          if (this._input[this.offset - 1] === ")") {
                            return castId;
                          }
                        }
                      }
                      this.unput(this.offset - initial);
                      return "(";
                    },
                    "=": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === ">") {
                        this.input();
                        return this.tok.T_DOUBLE_ARROW;
                      } else if (nchar === "=") {
                        if (this._input[this.offset + 1] === "=") {
                          this.consume(2);
                          return this.tok.T_IS_IDENTICAL;
                        } else {
                          this.input();
                          return this.tok.T_IS_EQUAL;
                        }
                      }
                      return "=";
                    },
                    "+": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === "+") {
                        this.input();
                        return this.tok.T_INC;
                      } else if (nchar === "=") {
                        this.input();
                        return this.tok.T_PLUS_EQUAL;
                      }
                      return "+";
                    },
                    "!": function _() {
                      if (this._input[this.offset] === "=") {
                        if (this._input[this.offset + 1] === "=") {
                          this.consume(2);
                          return this.tok.T_IS_NOT_IDENTICAL;
                        } else {
                          this.input();
                          return this.tok.T_IS_NOT_EQUAL;
                        }
                      }
                      return "!";
                    },
                    "?": function _() {
                      if (this.version >= 700 && this._input[this.offset] === "?") {
                        if (this.version >= 704 && this._input[this.offset + 1] === "=") {
                          this.consume(2);
                          return this.tok.T_COALESCE_EQUAL;
                        } else {
                          this.input();
                          return this.tok.T_COALESCE;
                        }
                      }
                      if (this.version >= 800 && this._input[this.offset] === "-" && this._input[this.offset + 1] === ">") {
                        this.consume(1);
                        this.begin("ST_LOOKING_FOR_PROPERTY").input();
                        return this.tok.T_NULLSAFE_OBJECT_OPERATOR;
                      }
                      return "?";
                    },
                    "<": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === "<") {
                        nchar = this._input[this.offset + 1];
                        if (nchar === "=") {
                          this.consume(2);
                          return this.tok.T_SL_EQUAL;
                        } else if (nchar === "<") {
                          if (this.is_HEREDOC()) {
                            return this.tok.T_START_HEREDOC;
                          }
                        }
                        this.input();
                        return this.tok.T_SL;
                      } else if (nchar === "=") {
                        this.input();
                        if (this.version >= 700 && this._input[this.offset] === ">") {
                          this.input();
                          return this.tok.T_SPACESHIP;
                        } else {
                          return this.tok.T_IS_SMALLER_OR_EQUAL;
                        }
                      } else if (nchar === ">") {
                        this.input();
                        return this.tok.T_IS_NOT_EQUAL;
                      }
                      return "<";
                    },
                    ">": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === "=") {
                        this.input();
                        return this.tok.T_IS_GREATER_OR_EQUAL;
                      } else if (nchar === ">") {
                        nchar = this._input[this.offset + 1];
                        if (nchar === "=") {
                          this.consume(2);
                          return this.tok.T_SR_EQUAL;
                        } else {
                          this.input();
                          return this.tok.T_SR;
                        }
                      }
                      return ">";
                    },
                    "*": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === "=") {
                        this.input();
                        return this.tok.T_MUL_EQUAL;
                      } else if (nchar === "*") {
                        this.input();
                        if (this._input[this.offset] === "=") {
                          this.input();
                          return this.tok.T_POW_EQUAL;
                        } else {
                          return this.tok.T_POW;
                        }
                      }
                      return "*";
                    },
                    ".": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === "=") {
                        this.input();
                        return this.tok.T_CONCAT_EQUAL;
                      } else if (nchar === "." && this._input[this.offset + 1] === ".") {
                        this.consume(2);
                        return this.tok.T_ELLIPSIS;
                      }
                      return ".";
                    },
                    "%": function _() {
                      if (this._input[this.offset] === "=") {
                        this.input();
                        return this.tok.T_MOD_EQUAL;
                      }
                      return "%";
                    },
                    "&": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === "=") {
                        this.input();
                        return this.tok.T_AND_EQUAL;
                      } else if (nchar === "&") {
                        this.input();
                        return this.tok.T_BOOLEAN_AND;
                      }
                      return "&";
                    },
                    "|": function _() {
                      var nchar = this._input[this.offset];
                      if (nchar === "=") {
                        this.input();
                        return this.tok.T_OR_EQUAL;
                      } else if (nchar === "|") {
                        this.input();
                        return this.tok.T_BOOLEAN_OR;
                      } else if (nchar === ">") {
                        this.input();
                        return this.tok.T_PIPE;
                      }
                      return "|";
                    },
                    "^": function _() {
                      if (this._input[this.offset] === "=") {
                        this.input();
                        return this.tok.T_XOR_EQUAL;
                      }
                      return "^";
                    }
                  }
                };
              },
              /***/
              8582(module2) {
                var tokens = ";:,.\\[]()|^&+-/*=%!~$<>?@";
                module2.exports = {
                  // check if the char can be a numeric
                  is_NUM: function is_NUM() {
                    var ch = this._input.charCodeAt(this.offset - 1);
                    return ch > 47 && ch < 58 || ch === 95;
                  },
                  // check if the char can be a numeric
                  is_NUM_START: function is_NUM_START() {
                    var ch = this._input.charCodeAt(this.offset - 1);
                    return ch > 47 && ch < 58;
                  },
                  // check if current char can be a label
                  is_LABEL: function is_LABEL() {
                    var ch = this._input.charCodeAt(this.offset - 1);
                    return ch > 96 && ch < 123 || ch > 64 && ch < 91 || ch === 95 || ch > 47 && ch < 58 || ch > 126;
                  },
                  // check if current char can be a label
                  is_LABEL_START: function is_LABEL_START() {
                    var ch = this._input.charCodeAt(this.offset - 1);
                    if (ch > 64 && ch < 91) return true;
                    if (ch > 96 && ch < 123) return true;
                    if (ch === 95) return true;
                    if (ch > 126) return true;
                    return false;
                  },
                  // reads each char of the label
                  consume_LABEL: function consume_LABEL() {
                    while (this.offset < this.size) {
                      var ch = this.input();
                      if (!this.is_LABEL()) {
                        if (ch) this.unput(1);
                        break;
                      }
                    }
                    return this;
                  },
                  // check if current char is a token char
                  is_TOKEN: function is_TOKEN() {
                    var ch = this._input[this.offset - 1];
                    return tokens.indexOf(ch) !== -1;
                  },
                  // check if current char is a whitespace
                  is_WHITESPACE: function is_WHITESPACE() {
                    var ch = this._input[this.offset - 1];
                    return ch === " " || ch === "	" || ch === "\n" || ch === "\r";
                  },
                  // check if current char is a whitespace (without newlines)
                  is_TABSPACE: function is_TABSPACE() {
                    var ch = this._input[this.offset - 1];
                    return ch === " " || ch === "	";
                  },
                  // consume all whitespaces (excluding newlines)
                  consume_TABSPACE: function consume_TABSPACE() {
                    while (this.offset < this.size) {
                      var ch = this.input();
                      if (!this.is_TABSPACE()) {
                        if (ch) this.unput(1);
                        break;
                      }
                    }
                    return this;
                  },
                  // check if current char can be a hexadecimal number
                  is_HEX: function is_HEX() {
                    var ch = this._input.charCodeAt(this.offset - 1);
                    if (ch > 47 && ch < 58) return true;
                    if (ch > 64 && ch < 71) return true;
                    if (ch > 96 && ch < 103) return true;
                    if (ch === 95) return true;
                    return false;
                  },
                  // check if current char can be an octal number
                  is_OCTAL: function is_OCTAL() {
                    var ch = this._input.charCodeAt(this.offset - 1);
                    if (ch > 47 && ch < 56) return true;
                    if (ch === 95) return true;
                    return false;
                  }
                };
              },
              /***/
              7259(module2, __unused_webpack_exports, __webpack_require__2) {
                var Position = __webpack_require__2(8822);
                function isNumber(n) {
                  return n != "." && n != "," && !isNaN(parseFloat(n)) && isFinite(n);
                }
                var Parser = function Parser2(lexer, ast) {
                  this.lexer = lexer;
                  this.ast = ast;
                  this.tok = lexer.tok;
                  this.EOF = lexer.EOF;
                  this.token = null;
                  this.prev = null;
                  this.debug = false;
                  this.version = 803;
                  this.extractDoc = false;
                  this.extractTokens = false;
                  this.suppressErrors = false;
                  var mapIt = function mapIt2(item) {
                    return [item, null];
                  };
                  this.entries = {
                    // reserved_non_modifiers
                    IDENTIFIER: new Map([this.tok.T_ABSTRACT, this.tok.T_ARRAY, this.tok.T_AS, this.tok.T_BREAK, this.tok.T_CALLABLE, this.tok.T_CASE, this.tok.T_CATCH, this.tok.T_CLASS, this.tok.T_CLASS_C, this.tok.T_CLONE, this.tok.T_CONST, this.tok.T_CONTINUE, this.tok.T_DECLARE, this.tok.T_DEFAULT, this.tok.T_DIR, this.tok.T_DO, this.tok.T_ECHO, this.tok.T_ELSE, this.tok.T_ELSEIF, this.tok.T_EMPTY, this.tok.T_ENDDECLARE, this.tok.T_ENDFOR, this.tok.T_ENDFOREACH, this.tok.T_ENDIF, this.tok.T_ENDSWITCH, this.tok.T_ENDWHILE, this.tok.T_ENUM, this.tok.T_EVAL, this.tok.T_EXIT, this.tok.T_EXTENDS, this.tok.T_FILE, this.tok.T_FINAL, this.tok.T_FINALLY, this.tok.T_FN, this.tok.T_FOR, this.tok.T_FOREACH, this.tok.T_FUNC_C, this.tok.T_FUNCTION, this.tok.T_GLOBAL, this.tok.T_GOTO, this.tok.T_IF, this.tok.T_IMPLEMENTS, this.tok.T_INCLUDE, this.tok.T_INCLUDE_ONCE, this.tok.T_INSTANCEOF, this.tok.T_INSTEADOF, this.tok.T_INTERFACE, this.tok.T_ISSET, this.tok.T_LINE, this.tok.T_LIST, this.tok.T_LOGICAL_AND, this.tok.T_LOGICAL_OR, this.tok.T_LOGICAL_XOR, this.tok.T_MATCH, this.tok.T_METHOD_C, this.tok.T_NAMESPACE, this.tok.T_NEW, this.tok.T_NS_C, this.tok.T_PRINT, this.tok.T_PRIVATE, this.tok.T_PROTECTED, this.tok.T_PUBLIC, this.tok.T_READ_ONLY, this.tok.T_REQUIRE, this.tok.T_REQUIRE_ONCE, this.tok.T_RETURN, this.tok.T_STATIC, this.tok.T_SWITCH, this.tok.T_THROW, this.tok.T_TRAIT, this.tok.T_TRY, this.tok.T_UNSET, this.tok.T_USE, this.tok.T_VAR, this.tok.T_WHILE, this.tok.T_YIELD].map(mapIt)),
                    VARIABLE: new Map([this.tok.T_VARIABLE, "$", "&", this.tok.T_STRING, this.tok.T_NAME_RELATIVE, this.tok.T_NAME_QUALIFIED, this.tok.T_NAME_FULLY_QUALIFIED, this.tok.T_NAMESPACE, this.tok.T_STATIC].map(mapIt)),
                    SCALAR: new Map([this.tok.T_CONSTANT_ENCAPSED_STRING, this.tok.T_START_HEREDOC, this.tok.T_LNUMBER, this.tok.T_DNUMBER, this.tok.T_ARRAY, "[", this.tok.T_CLASS_C, this.tok.T_TRAIT_C, this.tok.T_FUNC_C, this.tok.T_METHOD_C, this.tok.T_LINE, this.tok.T_FILE, this.tok.T_DIR, this.tok.T_NS_C, '"', 'b"', 'B"', "-", this.tok.T_NS_SEPARATOR].map(mapIt)),
                    T_MAGIC_CONST: new Map([this.tok.T_CLASS_C, this.tok.T_TRAIT_C, this.tok.T_FUNC_C, this.tok.T_METHOD_C, this.tok.T_LINE, this.tok.T_FILE, this.tok.T_DIR, this.tok.T_NS_C].map(mapIt)),
                    T_MEMBER_FLAGS: new Map([this.tok.T_PUBLIC, this.tok.T_PRIVATE, this.tok.T_PROTECTED, this.tok.T_STATIC, this.tok.T_ABSTRACT, this.tok.T_FINAL].map(mapIt)),
                    EOS: new Map([";", this.EOF, this.tok.T_INLINE_HTML].map(mapIt)),
                    EXPR: new Map([
                      "@",
                      "-",
                      "+",
                      "!",
                      "~",
                      "(",
                      "`",
                      this.tok.T_LIST,
                      this.tok.T_CLONE,
                      this.tok.T_INC,
                      this.tok.T_DEC,
                      this.tok.T_NEW,
                      this.tok.T_ISSET,
                      this.tok.T_EMPTY,
                      this.tok.T_MATCH,
                      this.tok.T_INCLUDE,
                      this.tok.T_INCLUDE_ONCE,
                      this.tok.T_REQUIRE,
                      this.tok.T_REQUIRE_ONCE,
                      this.tok.T_EVAL,
                      this.tok.T_INT_CAST,
                      this.tok.T_DOUBLE_CAST,
                      this.tok.T_STRING_CAST,
                      this.tok.T_ARRAY_CAST,
                      this.tok.T_OBJECT_CAST,
                      this.tok.T_BOOL_CAST,
                      this.tok.T_UNSET_CAST,
                      this.tok.T_EXIT,
                      this.tok.T_PRINT,
                      this.tok.T_YIELD,
                      this.tok.T_STATIC,
                      this.tok.T_FUNCTION,
                      this.tok.T_FN,
                      // using VARIABLES :
                      this.tok.T_VARIABLE,
                      "$",
                      this.tok.T_NS_SEPARATOR,
                      this.tok.T_STRING,
                      this.tok.T_NAME_RELATIVE,
                      this.tok.T_NAME_QUALIFIED,
                      this.tok.T_NAME_FULLY_QUALIFIED,
                      // using SCALAR :
                      this.tok.T_STRING,
                      // @see variable.js line 45 > conflict with variable = shift/reduce :)
                      this.tok.T_CONSTANT_ENCAPSED_STRING,
                      this.tok.T_START_HEREDOC,
                      this.tok.T_LNUMBER,
                      this.tok.T_DNUMBER,
                      this.tok.T_ARRAY,
                      "[",
                      this.tok.T_CLASS_C,
                      this.tok.T_TRAIT_C,
                      this.tok.T_FUNC_C,
                      this.tok.T_METHOD_C,
                      this.tok.T_LINE,
                      this.tok.T_FILE,
                      this.tok.T_DIR,
                      this.tok.T_NS_C,
                      '"',
                      'b"',
                      'B"',
                      "-",
                      this.tok.T_NS_SEPARATOR
                    ].map(mapIt))
                  };
                };
                Parser.prototype.getTokenName = function(token) {
                  if (!isNumber(token)) {
                    return "'" + token + "'";
                  } else {
                    if (token == this.EOF) return "the end of file (EOF)";
                    return this.lexer.engine.tokens.values[token];
                  }
                };
                Parser.prototype.parse = function(code, filename) {
                  this._errors = [];
                  this.filename = filename || "eval";
                  this.currentNamespace = [""];
                  if (this.extractDoc) {
                    this._docs = [];
                  } else {
                    this._docs = null;
                  }
                  if (this.extractTokens) {
                    this._tokens = [];
                  } else {
                    this._tokens = null;
                  }
                  this._docIndex = 0;
                  this._lastNode = null;
                  this.lexer.setInput(code);
                  this.lexer.all_tokens = this.extractTokens;
                  this.lexer.comment_tokens = this.extractDoc;
                  this.length = this.lexer._input.length;
                  this.innerList = false;
                  this.innerListForm = false;
                  var program = this.node("program");
                  var childs = [];
                  this.next();
                  while (this.token != this.EOF) {
                    childs.push(this.read_start());
                  }
                  if (childs.length === 0 && this.extractDoc && this._docs.length > this._docIndex) {
                    childs.push(this.node("noop")());
                  }
                  this.prev = [this.lexer.yylloc.last_line, this.lexer.yylloc.last_column, this.lexer.offset];
                  var result = program(childs, this._errors, this._docs, this._tokens);
                  if (this.debug) {
                    var errors = this.ast.checkNodes();
                    if (errors.length > 0) {
                      errors.forEach(function(error) {
                        if (error.position) {
                          console.log("Node at line " + error.position.line + ", column " + error.position.column);
                        }
                        console.log(error.stack.join("\n"));
                      });
                      throw new Error("Some nodes are not closed");
                    }
                  }
                  return result;
                };
                Parser.prototype.raiseError = function(message, msgExpect, expect, token) {
                  message += " on line " + this.lexer.yylloc.first_line;
                  if (!this.suppressErrors) {
                    var err = new SyntaxError(message, this.filename, this.lexer.yylloc.first_line);
                    err.lineNumber = this.lexer.yylloc.first_line;
                    err.fileName = this.filename;
                    err.columnNumber = this.lexer.yylloc.first_column;
                    throw err;
                  }
                  var node = this.ast.prepare("error", null, this)(message, token, this.lexer.yylloc.first_line, expect);
                  this._errors.push(node);
                  return node;
                };
                Parser.prototype.error = function(expect) {
                  var msg = "Parse Error : syntax error";
                  var token = this.getTokenName(this.token);
                  var msgExpect = "";
                  if (this.token !== this.EOF) {
                    if (isNumber(this.token)) {
                      var symbol = this.text();
                      if (symbol.length > 10) {
                        symbol = symbol.substring(0, 7) + "...";
                      }
                      token = "'" + symbol + "' (" + token + ")";
                    }
                    msg += ", unexpected " + token;
                  }
                  if (expect && !Array.isArray(expect)) {
                    if (isNumber(expect) || expect.length === 1) {
                      msgExpect = ", expecting " + this.getTokenName(expect);
                    }
                    msg += msgExpect;
                  }
                  return this.raiseError(msg, msgExpect, expect, token);
                };
                Parser.prototype.position = function() {
                  return new Position(this.lexer.yylloc.first_line, this.lexer.yylloc.first_column, this.lexer.yylloc.first_offset);
                };
                Parser.prototype.node = function(name) {
                  if (this.extractDoc) {
                    var docs = null;
                    if (this._docIndex < this._docs.length) {
                      docs = this._docs.slice(this._docIndex);
                      this._docIndex = this._docs.length;
                      if (this.debug) {
                        console.log(new Error("Append docs on " + name));
                        console.log(docs);
                      }
                    }
                    var node = this.ast.prepare(name, docs, this);
                    node.postBuild = function(self2) {
                      if (this._docIndex < this._docs.length) {
                        if (this._lastNode) {
                          var offset = this.prev[2];
                          var max = this._docIndex;
                          for (; max < this._docs.length; max++) {
                            if (this._docs[max].offset > offset) {
                              break;
                            }
                          }
                          if (max > this._docIndex) {
                            this._lastNode.setTrailingComments(this._docs.slice(this._docIndex, max));
                            this._docIndex = max;
                          }
                        } else if (this.token === this.EOF) {
                          self2.setTrailingComments(this._docs.slice(this._docIndex));
                          this._docIndex = this._docs.length;
                        }
                      }
                      this._lastNode = self2;
                    }.bind(this);
                    return node;
                  }
                  return this.ast.prepare(name, null, this);
                };
                Parser.prototype.expectEndOfStatement = function(node) {
                  if (this.token === ";") {
                    if (node && this.lexer.yytext === ";") {
                      node.includeToken(this);
                    }
                  } else if (this.token !== this.tok.T_INLINE_HTML && this.token !== this.EOF) {
                    this.error(";");
                    return false;
                  }
                  this.next();
                  return true;
                };
                var ignoreStack = ["parser.next", "parser.node", "parser.showlog"];
                Parser.prototype.showlog = function() {
                  var stack = new Error().stack.split("\n");
                  var line;
                  for (var offset = 2; offset < stack.length; offset++) {
                    line = stack[offset].trim();
                    var found = false;
                    for (var i = 0; i < ignoreStack.length; i++) {
                      if (line.substring(3, 3 + ignoreStack[i].length) === ignoreStack[i]) {
                        found = true;
                        break;
                      }
                    }
                    if (!found) {
                      break;
                    }
                  }
                  console.log("Line " + this.lexer.yylloc.first_line + " : " + this.getTokenName(this.token) + ">" + this.lexer.yytext + "< @-->" + line);
                  return this;
                };
                Parser.prototype.expect = function(token) {
                  if (Array.isArray(token)) {
                    if (token.indexOf(this.token) === -1) {
                      this.error(token);
                      return false;
                    }
                  } else if (this.token != token) {
                    this.error(token);
                    return false;
                  }
                  return true;
                };
                Parser.prototype.text = function() {
                  return this.lexer.yytext;
                };
                Parser.prototype.next = function() {
                  if (this.token !== ";" || this.lexer.yytext === ";") {
                    this.prev = [this.lexer.yylloc.last_line, this.lexer.yylloc.last_column, this.lexer.offset];
                  }
                  this.lex();
                  if (this.debug) {
                    this.showlog();
                  }
                  if (this.extractDoc) {
                    while (this.token === this.tok.T_COMMENT || this.token === this.tok.T_DOC_COMMENT) {
                      if (this.token === this.tok.T_COMMENT) {
                        this._docs.push(this.read_comment());
                      } else {
                        this._docs.push(this.read_doc_comment());
                      }
                    }
                  }
                  return this;
                };
                Parser.prototype.peek = function() {
                  var lexerState = this.lexer.getState();
                  var nextToken = this.lexer.lex();
                  this.lexer.setState(lexerState);
                  return nextToken;
                };
                Parser.prototype.lex = function() {
                  if (this.extractTokens) {
                    do {
                      this.token = this.lexer.lex() || /* istanbul ignore next */
                      this.EOF;
                      if (this.token === this.EOF) return this;
                      var entry = this.lexer.yytext;
                      if (Object.prototype.hasOwnProperty.call(this.lexer.engine.tokens.values, this.token)) {
                        entry = [this.lexer.engine.tokens.values[this.token], entry, this.lexer.yylloc.first_line, this.lexer.yylloc.first_offset, this.lexer.offset];
                      } else {
                        entry = [null, entry, this.lexer.yylloc.first_line, this.lexer.yylloc.first_offset, this.lexer.offset];
                      }
                      this._tokens.push(entry);
                      if (this.token === this.tok.T_CLOSE_TAG) {
                        this.token = ";";
                        return this;
                      } else if (this.token === this.tok.T_OPEN_TAG_WITH_ECHO) {
                        this.token = this.tok.T_ECHO;
                        return this;
                      }
                    } while (this.token === this.tok.T_WHITESPACE || // ignore white space
                    !this.extractDoc && (this.token === this.tok.T_COMMENT || // ignore single lines comments
                    this.token === this.tok.T_DOC_COMMENT) || // ignore doc comments
                    // ignore open tags
                    this.token === this.tok.T_OPEN_TAG);
                  } else {
                    this.token = this.lexer.lex() || /* istanbul ignore next */
                    this.EOF;
                  }
                  return this;
                };
                Parser.prototype.is = function(type) {
                  if (Array.isArray(type)) {
                    return type.indexOf(this.token) !== -1;
                  }
                  return this.entries[type].has(this.token);
                };
                [__webpack_require__2(5525), __webpack_require__2(7072), __webpack_require__2(3997), __webpack_require__2(6477), __webpack_require__2(979), __webpack_require__2(8214), __webpack_require__2(9461), __webpack_require__2(5931), __webpack_require__2(9147), __webpack_require__2(9219), __webpack_require__2(7170), __webpack_require__2(6261), __webpack_require__2(2478), __webpack_require__2(77), __webpack_require__2(6077), __webpack_require__2(1130)].forEach(function(ext) {
                  for (var k in ext) {
                    if (Object.prototype.hasOwnProperty.call(Parser.prototype, k)) {
                      throw new Error("Function " + k + " is already defined - collision");
                    }
                    Parser.prototype[k] = ext[k];
                  }
                });
                module2.exports = Parser;
              },
              /***/
              5525(module2) {
                module2.exports = {
                  /*
                   * Parse an array
                   * ```ebnf
                   * array ::= T_ARRAY '(' array_pair_list ')' |
                   *   '[' array_pair_list ']'
                   * ```
                   */
                  read_array: function read_array() {
                    var expect;
                    var shortForm = false;
                    var result = this.node("array");
                    if (this.token === this.tok.T_ARRAY) {
                      this.next().expect("(");
                      expect = ")";
                    } else {
                      shortForm = true;
                      expect = "]";
                    }
                    var items = [];
                    if (this.next().token !== expect) {
                      items = this.read_array_pair_list(shortForm);
                    }
                    this.expect(expect);
                    this.next();
                    return result(shortForm, items);
                  },
                  /*
                   * Reads an array of items
                   * ```ebnf
                   * array_pair_list ::= array_pair (',' array_pair?)*
                   * ```
                   */
                  read_array_pair_list: function read_array_pair_list(shortForm) {
                    var self2 = this;
                    return this.read_list(function() {
                      return self2.read_array_pair(shortForm);
                    }, ",", true);
                  },
                  /*
                   * Reads an entry
                   * array_pair:
                   *  expr T_DOUBLE_ARROW expr
                   *  | expr
                   *  | expr T_DOUBLE_ARROW '&' variable
                   *  | '&' variable
                   *  | expr T_DOUBLE_ARROW T_LIST '(' array_pair_list ')'
                   *  | T_LIST '(' array_pair_list ')'
                   */
                  read_array_pair: function read_array_pair(shortForm) {
                    if (!shortForm && this.token === ")" || shortForm && this.token === "]") {
                      return;
                    }
                    if (this.token === ",") {
                      return this.node("noop")();
                    }
                    var entry = this.node("entry");
                    var key = null;
                    var value;
                    var byRef = false;
                    var unpack = false;
                    if (this.token === "&") {
                      this.next();
                      byRef = true;
                      value = this.read_variable(true, false);
                    } else if (this.token === this.tok.T_ELLIPSIS && this.version >= 704) {
                      this.next();
                      if (this.token === "&") {
                        this.error();
                      }
                      unpack = true;
                      value = this.read_expr();
                    } else {
                      var expr = this.read_expr();
                      if (this.token === this.tok.T_DOUBLE_ARROW) {
                        this.next();
                        key = expr;
                        if (this.token === "&") {
                          this.next();
                          byRef = true;
                          value = this.read_variable(true, false);
                        } else {
                          value = this.read_expr();
                        }
                      } else {
                        value = expr;
                      }
                    }
                    return entry(key, value, byRef, unpack);
                  }
                };
              },
              /***/
              7072(module2) {
                function _slicedToArray(r, e) {
                  return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
                }
                function _nonIterableRest() {
                  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
                }
                function _iterableToArrayLimit(r, l) {
                  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
                  if (null != t) {
                    var e, n, i, u, a = [], f = true, o = false;
                    try {
                      if (i = (t = t.call(r)).next, 0 === l) {
                        if (Object(t) !== t) return;
                        f = false;
                      } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
                    } catch (r2) {
                      o = true, n = r2;
                    } finally {
                      try {
                        if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
                      } finally {
                        if (o) throw n;
                      }
                    }
                    return a;
                  }
                }
                function _arrayWithHoles(r) {
                  if (Array.isArray(r)) return r;
                }
                function _toConsumableArray(r) {
                  return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
                }
                function _nonIterableSpread() {
                  throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
                }
                function _unsupportedIterableToArray(r, a) {
                  if (r) {
                    if ("string" == typeof r) return _arrayLikeToArray(r, a);
                    var t = {}.toString.call(r).slice(8, -1);
                    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
                  }
                }
                function _iterableToArray(r) {
                  if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
                }
                function _arrayWithoutHoles(r) {
                  if (Array.isArray(r)) return _arrayLikeToArray(r);
                }
                function _arrayLikeToArray(r, a) {
                  (null == a || a > r.length) && (a = r.length);
                  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
                  return n;
                }
                module2.exports = {
                  /*
                   * reading a class
                   * ```ebnf
                   * class ::= class_scope? T_CLASS T_STRING (T_EXTENDS NAMESPACE_NAME)? (T_IMPLEMENTS (NAMESPACE_NAME ',')* NAMESPACE_NAME)? '{' CLASS_BODY '}'
                   * ```
                   */
                  read_class_declaration_statement: function read_class_declaration_statement(attrs) {
                    var result = this.node("class");
                    var flag = this.read_class_modifiers();
                    if (this.token !== this.tok.T_CLASS) {
                      this.error(this.tok.T_CLASS);
                      this.next();
                      return null;
                    }
                    this.next().expect(this.tok.T_STRING);
                    var propName = this.node("identifier");
                    var name = this.text();
                    this.next();
                    propName = propName(name);
                    var propExtends = this.read_extends_from();
                    var propImplements = this.read_implements_list();
                    this.expect("{");
                    var body = this.next().read_class_body(true, false);
                    var node = result(propName, propExtends, propImplements, body, flag);
                    if (attrs) node.attrGroups = attrs;
                    return node;
                  },
                  read_class_modifiers: function read_class_modifiers() {
                    var modifier = this.read_class_modifier({
                      readonly: 0,
                      final_or_abstract: 0
                    });
                    return [0, 0, modifier.final_or_abstract, modifier.readonly];
                  },
                  read_class_modifier: function read_class_modifier(memo) {
                    if (this.token === this.tok.T_READ_ONLY) {
                      this.next();
                      memo.readonly = 1;
                      memo = this.read_class_modifier(memo);
                    } else if (memo.final_or_abstract === 0 && this.token === this.tok.T_ABSTRACT) {
                      this.next();
                      memo.final_or_abstract = 1;
                      memo = this.read_class_modifier(memo);
                    } else if (memo.final_or_abstract === 0 && this.token === this.tok.T_FINAL) {
                      this.next();
                      memo.final_or_abstract = 2;
                      memo = this.read_class_modifier(memo);
                    }
                    return memo;
                  },
                  /*
                   * Reads a class body
                   * ```ebnf
                   *   class_body ::= (member_flags? (T_VAR | T_STRING | T_FUNCTION))*
                   * ```
                   */
                  read_class_body: function read_class_body(allow_variables, allow_enum_cases) {
                    var result = [];
                    var attrs = [];
                    while (this.token !== this.EOF && this.token !== "}") {
                      if (this.token === this.tok.T_COMMENT) {
                        result.push(this.read_comment());
                        continue;
                      }
                      if (this.token === this.tok.T_DOC_COMMENT) {
                        result.push(this.read_doc_comment());
                        continue;
                      }
                      if (this.token === this.tok.T_USE) {
                        result = result.concat(this.read_trait_use_statement());
                        continue;
                      }
                      if (allow_enum_cases && this.token === this.tok.T_CASE) {
                        var enumcase = this.read_enum_case();
                        if (this.expect(";")) {
                          this.next();
                        }
                        result = result.concat(enumcase);
                        continue;
                      }
                      if (this.token === this.tok.T_ATTRIBUTE) {
                        attrs = this.read_attr_list();
                      }
                      var locStart = this.position();
                      var flags = this.read_member_flags(false);
                      if (this.token === this.tok.T_CONST) {
                        var constants = this.read_constant_list(flags, attrs);
                        if (this.expect(";")) {
                          this.next();
                        }
                        result = result.concat(constants);
                        continue;
                      }
                      if (allow_variables && this.token === this.tok.T_VAR) {
                        this.next().expect(this.tok.T_VARIABLE);
                        flags[0] = null;
                        flags[1] = 0;
                      }
                      if (this.token === this.tok.T_FUNCTION) {
                        result.push(this.read_function(false, flags, attrs, locStart));
                        attrs = [];
                      } else if (allow_variables && (this.token === this.tok.T_VARIABLE || this.version >= 801 && this.token === this.tok.T_READ_ONLY || // support https://wiki.php.net/rfc/typed_properties_v2
                      this.version >= 704 && (this.token === "?" || this.token === this.tok.T_ARRAY || this.token === this.tok.T_CALLABLE || this.token === this.tok.T_NAMESPACE || this.token === this.tok.T_NAME_FULLY_QUALIFIED || this.token === this.tok.T_NAME_QUALIFIED || this.token === this.tok.T_NAME_RELATIVE || this.token === this.tok.T_NS_SEPARATOR || this.token === this.tok.T_STRING))) {
                        var variables = this.read_variable_list(flags, attrs);
                        attrs = [];
                        this.expect(";");
                        this.next();
                        result = result.concat(variables);
                      } else {
                        this.error([this.tok.T_CONST].concat(_toConsumableArray(allow_variables ? [this.tok.T_VARIABLE] : []), _toConsumableArray(allow_enum_cases ? [this.tok.T_CASE] : []), [this.tok.T_FUNCTION]));
                        this.next();
                      }
                    }
                    this.expect("}");
                    this.next();
                    return result;
                  },
                  /*
                   * Reads variable list
                   * ```ebnf
                   *  variable_list ::= (variable_declaration ',')* variable_declaration
                   * ```
                   */
                  read_variable_list: function read_variable_list(flags, attrs) {
                    var result = this.node("propertystatement");
                    var properties = this.read_list(
                      /*
                       * Reads a variable declaration
                       *
                       * ```ebnf
                       *  variable_declaration ::= T_VARIABLE '=' scalar
                       * ```
                       */
                      function read_variable_declaration() {
                        var result2 = this.node("property");
                        var readonly = false;
                        if (this.token === this.tok.T_READ_ONLY) {
                          readonly = true;
                          this.next();
                        }
                        var _this$read_optional_t = this.read_optional_type(), _this$read_optional_t2 = _slicedToArray(_this$read_optional_t, 2), nullable = _this$read_optional_t2[0], type = _this$read_optional_t2[1];
                        this.expect(this.tok.T_VARIABLE);
                        var propName = this.node("identifier");
                        var name = this.text().substring(1);
                        this.next();
                        propName = propName(name);
                        var value = null;
                        this.expect([",", ";", "="]);
                        if (this.token === "=") {
                          value = this.next().read_expr();
                        }
                        return result2(propName, value, readonly, nullable, type, attrs || []);
                      },
                      ","
                    );
                    return result(null, properties, flags);
                  },
                  /*
                   * Reads constant list
                   * ```ebnf
                   *  constant_list ::= T_CONST [type] (constant_declaration ',')* constant_declaration
                   * ```
                   */
                  read_constant_list: function read_constant_list(flags, attrs) {
                    if (this.expect(this.tok.T_CONST)) {
                      this.next();
                    }
                    var _ref = this.version >= 803 ? this.read_optional_type() : [false, null], _ref2 = _slicedToArray(_ref, 2), nullable = _ref2[0], type = _ref2[1];
                    var result = this.node("classconstant");
                    var items = this.read_list(
                      /*
                       * Reads a constant declaration
                       *
                       * ```ebnf
                       *  constant_declaration ::= (T_STRING | IDENTIFIER) '=' expr
                       * ```
                       * @return {Constant} [:link:](AST.md#constant)
                       */
                      function read_constant_declaration() {
                        var result2 = this.node("constant");
                        var constName = null;
                        var value = null;
                        if (this.token === this.tok.T_STRING || this.version >= 700 && this.is("IDENTIFIER")) {
                          constName = this.node("identifier");
                          var name = this.text();
                          this.next();
                          constName = constName(name);
                        } else {
                          this.expect("IDENTIFIER");
                        }
                        if (this.expect("=")) {
                          value = this.next().read_expr();
                        }
                        return result2(constName, value);
                      },
                      ","
                    );
                    return result(null, items, flags, nullable, type, attrs || []);
                  },
                  /*
                   * Read member flags
                   * @return array
                   *  1st index : 0 => public, 1 => protected, 2 => private
                   *  2nd index : 0 => instance member, 1 => static member
                   *  3rd index : 0 => normal, 1 => abstract member, 2 => final member
                   */
                  read_member_flags: function read_member_flags(asInterface) {
                    var result = [-1, -1, -1];
                    if (this.is("T_MEMBER_FLAGS")) {
                      var idx = 0, val = 0;
                      do {
                        switch (this.token) {
                          case this.tok.T_PUBLIC:
                            idx = 0;
                            val = 0;
                            break;
                          case this.tok.T_PROTECTED:
                            idx = 0;
                            val = 1;
                            break;
                          case this.tok.T_PRIVATE:
                            idx = 0;
                            val = 2;
                            break;
                          case this.tok.T_STATIC:
                            idx = 1;
                            val = 1;
                            break;
                          case this.tok.T_ABSTRACT:
                            idx = 2;
                            val = 1;
                            break;
                          case this.tok.T_FINAL:
                            idx = 2;
                            val = 2;
                            break;
                        }
                        if (asInterface) {
                          if (idx === 0 && val === 2) {
                            this.expect([this.tok.T_PUBLIC, this.tok.T_PROTECTED]);
                            val = -1;
                          } else if (idx === 2 && val === 1) {
                            this.error();
                            val = -1;
                          }
                        }
                        if (result[idx] !== -1) {
                          this.error();
                        } else if (val !== -1) {
                          result[idx] = val;
                        }
                      } while (this.next().is("T_MEMBER_FLAGS"));
                    }
                    if (result[1] === -1) result[1] = 0;
                    if (result[2] === -1) result[2] = 0;
                    return result;
                  },
                  /*
                   * optional_type:
                   *	  /- empty -/	{ $$ = NULL; }
                   *   |	type_expr	{ $$ = $1; }
                   * ;
                   *
                   * type_expr:
                   *		type		{ $$ = $1; }
                   *	|	'?' type	{ $$ = $2; $$->attr |= ZEND_TYPE_NULLABLE; }
                   *	|	union_type	{ $$ = $1; }
                   * ;
                   *
                   * type:
                   * 		T_ARRAY		{ $$ = zend_ast_create_ex(ZEND_AST_TYPE, IS_ARRAY); }
                   * 	|	T_CALLABLE	{ $$ = zend_ast_create_ex(ZEND_AST_TYPE, IS_CALLABLE); }
                   * 	|	name		{ $$ = $1; }
                   * ;
                   *
                   * union_type:
                   * 		type '|' type       { $$ = zend_ast_create_list(2, ZEND_AST_TYPE_UNION, $1, $3); }
                   * 	|	union_type '|' type { $$ = zend_ast_list_add($1, $3); }
                   * ;
                   */
                  read_optional_type: function read_optional_type() {
                    var nullable = this.token === "?";
                    if (nullable) {
                      this.next();
                    }
                    if (this.peekSkipComments() === "=") {
                      return [false, null];
                    }
                    var type = this.read_types();
                    if (nullable && !type) {
                      this.raiseError("Expecting a type definition combined with nullable operator");
                    }
                    if (!nullable && !type) {
                      return [false, null];
                    }
                    if (this.token === "|") {
                      type = [type];
                      do {
                        this.next();
                        var variant = this.read_type();
                        if (!variant) {
                          this.raiseError("Expecting a type definition");
                          break;
                        }
                        type.push(variant);
                      } while (this.token === "|");
                    }
                    return [nullable, type];
                  },
                  peekSkipComments: function peekSkipComments() {
                    var lexerState = this.lexer.getState();
                    var nextToken;
                    do {
                      nextToken = this.lexer.lex();
                    } while (nextToken === this.tok.T_COMMENT || nextToken === this.tok.T_WHITESPACE);
                    this.lexer.setState(lexerState);
                    return nextToken;
                  },
                  /*
                   * reading an interface
                   * ```ebnf
                   * interface ::= T_INTERFACE T_STRING (T_EXTENDS (NAMESPACE_NAME ',')* NAMESPACE_NAME)? '{' INTERFACE_BODY '}'
                   * ```
                   */
                  read_interface_declaration_statement: function read_interface_declaration_statement(attrs) {
                    var result = this.node("interface");
                    if (this.token !== this.tok.T_INTERFACE) {
                      this.error(this.tok.T_INTERFACE);
                      this.next();
                      return null;
                    }
                    this.next().expect(this.tok.T_STRING);
                    var propName = this.node("identifier");
                    var name = this.text();
                    this.next();
                    propName = propName(name);
                    var propExtends = this.read_interface_extends_list();
                    this.expect("{");
                    var body = this.next().read_interface_body();
                    return result(propName, propExtends, body, attrs || []);
                  },
                  /*
                   * Reads an interface body
                   * ```ebnf
                   *   interface_body ::= (member_flags? (T_CONST | T_FUNCTION))*
                   * ```
                   */
                  read_interface_body: function read_interface_body() {
                    var result = [];
                    var attrs;
                    while (this.token !== this.EOF && this.token !== "}") {
                      if (this.token === this.tok.T_COMMENT) {
                        result.push(this.read_comment());
                        continue;
                      }
                      if (this.token === this.tok.T_DOC_COMMENT) {
                        result.push(this.read_doc_comment());
                        continue;
                      }
                      var locStart = this.position();
                      attrs = this.read_attr_list();
                      var flags = this.read_member_flags(true);
                      if (this.token === this.tok.T_CONST) {
                        var constants = this.read_constant_list(flags, attrs);
                        if (this.expect(";")) {
                          this.next();
                        }
                        result = result.concat(constants);
                      } else if (this.token === this.tok.T_FUNCTION) {
                        var method = this.read_function_declaration(2, flags, attrs, locStart);
                        method.parseFlags(flags);
                        result.push(method);
                        if (this.expect(";")) {
                          this.next();
                        }
                      } else {
                        this.error([this.tok.T_CONST, this.tok.T_FUNCTION]);
                        this.next();
                      }
                    }
                    if (this.expect("}")) {
                      this.next();
                    }
                    return result;
                  },
                  /*
                   * reading a trait
                   * ```ebnf
                   * trait ::= T_TRAIT T_STRING (T_EXTENDS (NAMESPACE_NAME ',')* NAMESPACE_NAME)? '{' FUNCTION* '}'
                   * ```
                   */
                  read_trait_declaration_statement: function read_trait_declaration_statement() {
                    var result = this.node("trait");
                    if (this.token !== this.tok.T_TRAIT) {
                      this.error(this.tok.T_TRAIT);
                      this.next();
                      return null;
                    }
                    this.next().expect(this.tok.T_STRING);
                    var propName = this.node("identifier");
                    var name = this.text();
                    this.next();
                    propName = propName(name);
                    this.expect("{");
                    var body = this.next().read_class_body(true, false);
                    return result(propName, body);
                  },
                  /*
                   * reading a use statement
                   * ```ebnf
                   * trait_use_statement ::= namespace_name (',' namespace_name)* ('{' trait_use_alias '}')?
                   * ```
                   */
                  read_trait_use_statement: function read_trait_use_statement() {
                    var node = this.node("traituse");
                    this.expect(this.tok.T_USE) && this.next();
                    var traits = [this.read_namespace_name()];
                    var adaptations = null;
                    while (this.token === ",") {
                      traits.push(this.next().read_namespace_name());
                    }
                    if (this.token === "{") {
                      adaptations = [];
                      while (this.next().token !== this.EOF) {
                        if (this.token === "}") break;
                        adaptations.push(this.read_trait_use_alias());
                        this.expect(";");
                      }
                      if (this.expect("}")) {
                        this.next();
                      }
                    } else {
                      if (this.expect(";")) {
                        this.next();
                      }
                    }
                    return node(traits, adaptations);
                  },
                  /*
                   * Reading trait alias
                   * ```ebnf
                   * trait_use_alias ::= namespace_name ( T_DOUBLE_COLON T_STRING )? (T_INSTEADOF namespace_name) | (T_AS member_flags? T_STRING)
                   * ```
                   * name list : https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L303
                   * trait adaptation : https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L742
                   */
                  read_trait_use_alias: function read_trait_use_alias() {
                    var node = this.node();
                    var trait = null;
                    var method;
                    if (this.is("IDENTIFIER")) {
                      method = this.node("identifier");
                      var methodName = this.text();
                      this.next();
                      method = method(methodName);
                    } else {
                      method = this.read_namespace_name();
                      if (this.token === this.tok.T_DOUBLE_COLON) {
                        this.next();
                        if (this.token === this.tok.T_STRING || this.version >= 700 && this.is("IDENTIFIER")) {
                          trait = method;
                          method = this.node("identifier");
                          var _methodName = this.text();
                          this.next();
                          method = method(_methodName);
                        } else {
                          this.expect(this.tok.T_STRING);
                        }
                      } else {
                        method = method.name;
                      }
                    }
                    if (this.token === this.tok.T_INSTEADOF) {
                      return node("traitprecedence", trait, method, this.next().read_name_list());
                    } else if (this.token === this.tok.T_AS) {
                      var flags = null;
                      var alias = null;
                      if (this.next().is("T_MEMBER_FLAGS")) {
                        flags = this.read_member_flags();
                      }
                      if (this.token === this.tok.T_STRING || this.version >= 700 && this.is("IDENTIFIER")) {
                        alias = this.node("identifier");
                        var name = this.text();
                        this.next();
                        alias = alias(name);
                      } else if (flags === false) {
                        this.expect(this.tok.T_STRING);
                      }
                      return node("traitalias", trait, method, alias, flags);
                    }
                    this.expect([this.tok.T_AS, this.tok.T_INSTEADOF]);
                    return node("traitalias", trait, method, null, null);
                  }
                };
              },
              /***/
              3997(module2) {
                module2.exports = {
                  /*
                   *  Comments with // or # or / * ... * /
                   */
                  read_comment: function read_comment() {
                    var text = this.text();
                    var result = this.ast.prepare(text.substring(0, 2) === "/*" ? "commentblock" : "commentline", null, this);
                    var offset = this.lexer.yylloc.first_offset;
                    var prev = this.prev;
                    this.prev = [this.lexer.yylloc.last_line, this.lexer.yylloc.last_column, this.lexer.offset];
                    this.lex();
                    result = result(text);
                    result.offset = offset;
                    this.prev = prev;
                    return result;
                  },
                  /*
                   * Comments with / ** ... * /
                   */
                  read_doc_comment: function read_doc_comment() {
                    var result = this.ast.prepare("commentblock", null, this);
                    var offset = this.lexer.yylloc.first_offset;
                    var text = this.text();
                    var prev = this.prev;
                    this.prev = [this.lexer.yylloc.last_line, this.lexer.yylloc.last_column, this.lexer.offset];
                    this.lex();
                    result = result(text);
                    result.offset = offset;
                    this.prev = prev;
                    return result;
                  }
                };
              },
              /***/
              979(module2) {
                module2.exports = {
                  /*
                   * reading an enum
                   * ```ebnf
                   * enum ::= enum_scope? T_ENUM T_STRING (':' NAMESPACE_NAME)? (T_IMPLEMENTS (NAMESPACE_NAME ',')* NAMESPACE_NAME)? '{' ENUM_BODY '}'
                   * ```
                   */
                  read_enum_declaration_statement: function read_enum_declaration_statement(attrs) {
                    var result = this.node("enum");
                    if (!this.expect(this.tok.T_ENUM)) {
                      return null;
                    }
                    this.next().expect(this.tok.T_STRING);
                    var propName = this.node("identifier");
                    var name = this.text();
                    this.next();
                    propName = propName(name);
                    var valueType = this.read_enum_value_type();
                    var propImplements = this.read_implements_list();
                    this.expect("{");
                    var body = this.next().read_class_body(false, true);
                    var node = result(propName, valueType, propImplements, body);
                    if (attrs) node.attrGroups = attrs;
                    return node;
                  },
                  read_enum_value_type: function read_enum_value_type() {
                    if (this.token === ":") {
                      return this.next().read_namespace_name();
                    }
                    return null;
                  },
                  read_enum_case: function read_enum_case() {
                    this.expect(this.tok.T_CASE);
                    var result = this.node("enumcase");
                    var caseName = this.node("identifier");
                    var name = this.next().text();
                    this.next();
                    caseName = caseName(name);
                    var value = this.token === "=" ? this.next().read_expr() : null;
                    this.expect(";");
                    return result(caseName, value);
                  }
                };
              },
              /***/
              6477(module2) {
                module2.exports = {
                  read_expr: function read_expr(expr) {
                    var result = this.node();
                    if (this.token === "@") {
                      if (!expr) {
                        expr = this.next().read_expr();
                      }
                      return result("silent", expr);
                    }
                    if (!expr) {
                      expr = this.read_expr_item();
                    }
                    if (this.token === "|") {
                      return result("bin", "|", expr, this.next().read_expr());
                    }
                    if (this.token === "&") {
                      return result("bin", "&", expr, this.next().read_expr());
                    }
                    if (this.token === "^") {
                      return result("bin", "^", expr, this.next().read_expr());
                    }
                    if (this.token === ".") {
                      return result("bin", ".", expr, this.next().read_expr());
                    }
                    if (this.token === "+") {
                      return result("bin", "+", expr, this.next().read_expr());
                    }
                    if (this.token === "-") {
                      return result("bin", "-", expr, this.next().read_expr());
                    }
                    if (this.token === "*") {
                      return result("bin", "*", expr, this.next().read_expr());
                    }
                    if (this.token === "/") {
                      return result("bin", "/", expr, this.next().read_expr());
                    }
                    if (this.token === "%") {
                      return result("bin", "%", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_POW) {
                      return result("bin", "**", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_SL) {
                      return result("bin", "<<", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_SR) {
                      return result("bin", ">>", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_BOOLEAN_OR) {
                      return result("bin", "||", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_LOGICAL_OR) {
                      return result("bin", "or", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_BOOLEAN_AND) {
                      return result("bin", "&&", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_LOGICAL_AND) {
                      return result("bin", "and", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_LOGICAL_XOR) {
                      return result("bin", "xor", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_IS_IDENTICAL) {
                      return result("bin", "===", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_IS_NOT_IDENTICAL) {
                      return result("bin", "!==", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_IS_EQUAL) {
                      return result("bin", "==", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_IS_NOT_EQUAL) {
                      return result("bin", "!=", expr, this.next().read_expr());
                    }
                    if (this.token === "<") {
                      return result("bin", "<", expr, this.next().read_expr());
                    }
                    if (this.token === ">") {
                      return result("bin", ">", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_IS_SMALLER_OR_EQUAL) {
                      return result("bin", "<=", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_IS_GREATER_OR_EQUAL) {
                      return result("bin", ">=", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_SPACESHIP) {
                      return result("bin", "<=>", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_INSTANCEOF) {
                      expr = result("bin", "instanceof", expr, this.next().read_class_name_reference());
                      if (this.token !== ";" && this.token !== this.tok.T_INLINE_HTML && this.token !== this.EOF) {
                        expr = this.read_expr(expr);
                      }
                    }
                    if (this.token === this.tok.T_NULLSAFE_OBJECT_OPERATOR) {
                      expr = result("nullsafepropertylookup", expr, this.read_what());
                      expr = this.recursive_variable_chain_scan(expr, false, true);
                    }
                    if (this.token === this.tok.T_COALESCE) {
                      return result("bin", "??", expr, this.next().read_expr());
                    }
                    if (this.token === this.tok.T_PIPE) {
                      if (this.version < 805) {
                        this.raiseError("PHP 8.5+ is required to use pipe operator");
                      }
                      return result("bin", "|>", expr, this.next().read_expr());
                    }
                    if (this.token === "?") {
                      var trueArg = null;
                      if (this.next().token !== ":") {
                        trueArg = this.read_expr();
                      }
                      this.expect(":") && this.next();
                      return result("retif", expr, trueArg, this.read_expr());
                    } else {
                      result.destroy(expr);
                    }
                    return expr;
                  },
                  /*
                   * Reads a cast expression
                   */
                  read_expr_cast: function read_expr_cast(type) {
                    return this.node("cast")(type, this.text(), this.next().read_expr());
                  },
                  /*
                   * Read a isset variable
                   */
                  read_isset_variable: function read_isset_variable() {
                    return this.read_expr();
                  },
                  /*
                   * Reads isset variables
                   */
                  read_isset_variables: function read_isset_variables() {
                    return this.read_function_list(this.read_isset_variable, ",");
                  },
                  /*
                   * Reads internal PHP functions
                   */
                  read_internal_functions_in_yacc: function read_internal_functions_in_yacc() {
                    var result = null;
                    switch (this.token) {
                      case this.tok.T_ISSET:
                        {
                          result = this.node("isset");
                          if (this.next().expect("(")) {
                            this.next();
                          }
                          var variables = this.read_isset_variables();
                          if (this.expect(")")) {
                            this.next();
                          }
                          result = result(variables);
                        }
                        break;
                      case this.tok.T_EMPTY:
                        {
                          result = this.node("empty");
                          if (this.next().expect("(")) {
                            this.next();
                          }
                          var expression = this.read_expr();
                          if (this.expect(")")) {
                            this.next();
                          }
                          result = result(expression);
                        }
                        break;
                      case this.tok.T_INCLUDE:
                        result = this.node("include")(false, false, this.next().read_expr());
                        break;
                      case this.tok.T_INCLUDE_ONCE:
                        result = this.node("include")(true, false, this.next().read_expr());
                        break;
                      case this.tok.T_EVAL:
                        {
                          result = this.node("eval");
                          if (this.next().expect("(")) {
                            this.next();
                          }
                          var expr = this.read_expr();
                          if (this.expect(")")) {
                            this.next();
                          }
                          result = result(expr);
                        }
                        break;
                      case this.tok.T_REQUIRE:
                        result = this.node("include")(false, true, this.next().read_expr());
                        break;
                      case this.tok.T_REQUIRE_ONCE:
                        result = this.node("include")(true, true, this.next().read_expr());
                        break;
                    }
                    return result;
                  },
                  /*
                   * Reads optional expression
                   */
                  read_optional_expr: function read_optional_expr(stopToken) {
                    if (this.token !== stopToken) {
                      return this.read_expr();
                    }
                    return null;
                  },
                  /*
                   * Reads exit expression
                   */
                  read_exit_expr: function read_exit_expr() {
                    var expression = null;
                    if (this.token === "(") {
                      this.next();
                      expression = this.read_optional_expr(")");
                      this.expect(")") && this.next();
                    }
                    return expression;
                  },
                  /*
                   * ```ebnf
                   * Reads an expression
                   *  expr ::= @todo
                   * ```
                   */
                  read_expr_item: function read_expr_item() {
                    var result, expr, attrs = [];
                    if (this.token === "+") {
                      return this.node("unary")("+", this.next().read_expr());
                    }
                    if (this.token === "-") {
                      return this.node("unary")("-", this.next().read_expr());
                    }
                    if (this.token === "!") {
                      return this.node("unary")("!", this.next().read_expr());
                    }
                    if (this.token === "~") {
                      return this.node("unary")("~", this.next().read_expr());
                    }
                    if (this.token === "(") {
                      expr = this.next().read_expr();
                      expr.parenthesizedExpression = true;
                      this.expect(")") && this.next();
                      return this.handleDereferencable(expr);
                    }
                    if (this.token === "`") {
                      return this.read_encapsed_string("`");
                    }
                    if (this.token === this.tok.T_LIST) {
                      var assign = null;
                      var isInner = this.innerList;
                      result = this.node("list");
                      if (!isInner) {
                        assign = this.node("assign");
                      }
                      if (this.next().expect("(")) {
                        this.next();
                      }
                      if (!this.innerList) this.innerList = true;
                      var assignList = this.read_array_pair_list(false);
                      if (this.expect(")")) {
                        this.next();
                      }
                      var hasItem = false;
                      for (var i = 0; i < assignList.length; i++) {
                        if (assignList[i] !== null && assignList[i].kind !== "noop") {
                          hasItem = true;
                          break;
                        }
                      }
                      if (!hasItem) {
                        this.raiseError("Fatal Error :  Cannot use empty list on line " + this.lexer.yylloc.first_line);
                      }
                      if (!isInner) {
                        this.innerList = false;
                        if (this.expect("=")) {
                          return assign(result(assignList, false), this.next().read_expr(), "=");
                        } else {
                          return result(assignList, false);
                        }
                      } else {
                        return result(assignList, false);
                      }
                    }
                    if (this.token === this.tok.T_ATTRIBUTE) {
                      attrs = this.read_attr_list();
                    }
                    if (this.token === this.tok.T_CLONE) {
                      return this.node("clone")(this.next().read_expr());
                    }
                    switch (this.token) {
                      case this.tok.T_INC:
                        return this.node("pre")("+", this.next().read_variable(false, false));
                      case this.tok.T_DEC:
                        return this.node("pre")("-", this.next().read_variable(false, false));
                      case this.tok.T_NEW:
                        expr = this.read_new_expr();
                        if (this.token === this.tok.T_OBJECT_OPERATOR && this.version < 804) {
                          this.raiseError("New without parenthesis is not allowed before PHP 8.4");
                        }
                        return this.handleDereferencable(expr);
                      case this.tok.T_ISSET:
                      case this.tok.T_EMPTY:
                      case this.tok.T_INCLUDE:
                      case this.tok.T_INCLUDE_ONCE:
                      case this.tok.T_EVAL:
                      case this.tok.T_REQUIRE:
                      case this.tok.T_REQUIRE_ONCE:
                        return this.read_internal_functions_in_yacc();
                      case this.tok.T_MATCH:
                        return this.read_match_expression();
                      case this.tok.T_INT_CAST:
                        return this.read_expr_cast("int");
                      case this.tok.T_DOUBLE_CAST:
                        return this.read_expr_cast("float");
                      case this.tok.T_STRING_CAST:
                        return this.read_expr_cast(this.text().indexOf("binary") !== -1 ? "binary" : "string");
                      case this.tok.T_ARRAY_CAST:
                        return this.read_expr_cast("array");
                      case this.tok.T_OBJECT_CAST:
                        return this.read_expr_cast("object");
                      case this.tok.T_BOOL_CAST:
                        return this.read_expr_cast("bool");
                      case this.tok.T_UNSET_CAST:
                        return this.read_expr_cast("unset");
                      case this.tok.T_THROW: {
                        if (this.version < 800) {
                          this.raiseError("PHP 8+ is required to use throw as an expression");
                        }
                        var _result = this.node("throw");
                        var _expr = this.next().read_expr();
                        return _result(_expr);
                      }
                      case this.tok.T_EXIT: {
                        var useDie = this.lexer.yytext.toLowerCase() === "die";
                        result = this.node("exit");
                        this.next();
                        var expression = this.read_exit_expr();
                        return result(expression, useDie);
                      }
                      case this.tok.T_PRINT:
                        return this.node("print")(this.next().read_expr());
                      // T_YIELD (expr (T_DOUBLE_ARROW expr)?)?
                      case this.tok.T_YIELD: {
                        var value = null;
                        var key = null;
                        result = this.node("yield");
                        if (this.next().is("EXPR")) {
                          value = this.read_expr();
                          if (this.token === this.tok.T_DOUBLE_ARROW) {
                            key = value;
                            value = this.next().read_expr();
                          }
                        }
                        return result(value, key);
                      }
                      // T_YIELD_FROM expr
                      case this.tok.T_YIELD_FROM:
                        result = this.node("yieldfrom");
                        expr = this.next().read_expr();
                        return result(expr);
                      case this.tok.T_FN:
                      case this.tok.T_FUNCTION:
                        return this.read_inline_function(void 0, attrs);
                      case this.tok.T_STATIC: {
                        var backup = [this.token, this.lexer.getState()];
                        this.next();
                        if (this.token === this.tok.T_FUNCTION || this.version >= 704 && this.token === this.tok.T_FN) {
                          return this.read_inline_function([0, 1, 0], attrs);
                        } else {
                          this.lexer.tokens.push(backup);
                          this.next();
                        }
                      }
                    }
                    if (this.is("VARIABLE")) {
                      result = this.node();
                      expr = this.read_variable(false, false);
                      var isConst = expr.kind === "identifier" || expr.kind === "staticlookup" && expr.offset.kind === "identifier";
                      switch (this.token) {
                        case "=": {
                          if (isConst) this.error("VARIABLE");
                          if (this.next().token == "&") {
                            return this.read_assignref(result, expr);
                          }
                          return result("assign", expr, this.read_expr(), "=");
                        }
                        // operations :
                        case this.tok.T_PLUS_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "+=");
                        case this.tok.T_MINUS_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "-=");
                        case this.tok.T_MUL_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "*=");
                        case this.tok.T_POW_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "**=");
                        case this.tok.T_DIV_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "/=");
                        case this.tok.T_CONCAT_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), ".=");
                        case this.tok.T_MOD_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "%=");
                        case this.tok.T_AND_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "&=");
                        case this.tok.T_OR_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "|=");
                        case this.tok.T_XOR_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "^=");
                        case this.tok.T_SL_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "<<=");
                        case this.tok.T_SR_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), ">>=");
                        case this.tok.T_COALESCE_EQUAL:
                          if (isConst) this.error("VARIABLE");
                          return result("assign", expr, this.next().read_expr(), "??=");
                        case this.tok.T_INC:
                          if (isConst) this.error("VARIABLE");
                          this.next();
                          return result("post", "+", expr);
                        case this.tok.T_DEC:
                          if (isConst) this.error("VARIABLE");
                          this.next();
                          return result("post", "-", expr);
                        default:
                          result.destroy(expr);
                      }
                    } else if (this.is("SCALAR")) {
                      result = this.node();
                      expr = this.read_scalar();
                      if (expr.kind === "array" && expr.shortForm && this.token === "=") {
                        var list = this.convertToList(expr);
                        if (expr.loc) list.loc = expr.loc;
                        var right = this.next().read_expr();
                        return result("assign", list, right, "=");
                      } else {
                        result.destroy(expr);
                      }
                      return this.handleDereferencable(expr);
                    } else {
                      this.error("EXPR");
                      this.next();
                    }
                    return expr;
                  },
                  /*
                   * Recursively convert nested array to nested list.
                   */
                  convertToList: function convertToList(array) {
                    var _this = this;
                    var convertedItems = array.items.map(function(entry) {
                      if (entry.value && entry.value.kind === "array" && entry.value.shortForm) {
                        entry.value = _this.convertToList(entry.value);
                      }
                      return entry;
                    });
                    var node = this.node("list")(convertedItems, true);
                    if (array.loc) node.loc = array.loc;
                    if (array.leadingComments) node.leadingComments = array.leadingComments;
                    if (array.trailingComments) node.trailingComments = array.trailingComments;
                    return node;
                  },
                  /*
                   * Reads assignment
                   * @param {*} left
                   */
                  read_assignref: function read_assignref(result, left) {
                    this.next();
                    var right;
                    if (this.token === this.tok.T_NEW) {
                      if (this.version >= 700) {
                        this.error();
                      }
                      right = this.read_new_expr();
                    } else {
                      right = this.read_variable(false, false);
                    }
                    return result("assignref", left, right);
                  },
                  /*
                   *
                   * inline_function:
                   * 		function returns_ref backup_doc_comment '(' parameter_list ')' lexical_vars return_type
                   * 		backup_fn_flags '{' inner_statement_list '}' backup_fn_flags
                   * 			{ $$ = zend_ast_create_decl(ZEND_AST_CLOSURE, $2 | $13, $1, $3,
                   * 				  zend_string_init("{closure}", sizeof("{closure}") - 1, 0),
                   * 				  $5, $7, $11, $8); CG(extra_fn_flags) = $9; }
                   * 	|	fn returns_ref '(' parameter_list ')' return_type backup_doc_comment T_DOUBLE_ARROW backup_fn_flags backup_lex_pos expr backup_fn_flags
                   * 			{ $$ = zend_ast_create_decl(ZEND_AST_ARROW_FUNC, $2 | $12, $1, $7,
                   * 				  zend_string_init("{closure}", sizeof("{closure}") - 1, 0), $4, NULL,
                   * 				  zend_ast_create(ZEND_AST_RETURN, $11), $6);
                   * 				  ((zend_ast_decl *) $$)->lex_pos = $10;
                   * 				  CG(extra_fn_flags) = $9; }   *
                   */
                  read_inline_function: function read_inline_function(flags, attrs) {
                    if (this.token === this.tok.T_FUNCTION) {
                      var _result2 = this.read_function(true, flags, attrs);
                      _result2.attrGroups = attrs;
                      return _result2;
                    }
                    if (!this.version >= 704) {
                      this.raiseError("Arrow Functions are not allowed");
                    }
                    var node = this.node("arrowfunc");
                    if (this.expect(this.tok.T_FN)) this.next();
                    var isRef = this.is_reference();
                    if (this.expect("(")) this.next();
                    var params = this.read_parameter_list();
                    if (this.expect(")")) this.next();
                    var nullable = false;
                    var returnType = null;
                    if (this.token === ":") {
                      if (this.next().token === "?") {
                        nullable = true;
                        this.next();
                      }
                      returnType = this.read_types();
                    }
                    if (this.expect(this.tok.T_DOUBLE_ARROW)) this.next();
                    var body = this.read_expr();
                    var result = node(params, isRef, body, returnType, nullable, flags ? true : false);
                    result.attrGroups = attrs;
                    return result;
                  },
                  read_match_expression: function read_match_expression() {
                    var node = this.node("match");
                    this.expect(this.tok.T_MATCH) && this.next();
                    if (this.version < 800) {
                      this.raiseError("Match statements are not allowed before PHP 8");
                    }
                    if (this.expect("(")) this.next();
                    var cond = this.read_expr();
                    if (this.expect(")")) this.next();
                    if (this.expect("{")) this.next();
                    var arms = this.read_match_arms();
                    if (this.expect("}")) this.next();
                    return node(cond, arms);
                  },
                  read_match_arms: function read_match_arms() {
                    var _this2 = this;
                    return this.read_list(function() {
                      return _this2.read_match_arm();
                    }, ",", true);
                  },
                  read_match_arm: function read_match_arm() {
                    if (this.token === "}") {
                      return;
                    }
                    return this.node("matcharm")(this.read_match_arm_conds(), this.read_expr());
                  },
                  read_match_arm_conds: function read_match_arm_conds() {
                    var conds = [];
                    if (this.token === this.tok.T_DEFAULT) {
                      conds = null;
                      this.next();
                    } else {
                      conds.push(this.read_expr());
                      while (this.token === ",") {
                        this.next();
                        if (this.token === this.tok.T_DOUBLE_ARROW) {
                          this.next();
                          return conds;
                        }
                        conds.push(this.read_expr());
                      }
                    }
                    if (this.expect(this.tok.T_DOUBLE_ARROW)) {
                      this.next();
                    }
                    return conds;
                  },
                  read_attribute: function read_attribute() {
                    var name = this.text();
                    var args = [];
                    this.next();
                    if (this.token === "(") {
                      args = this.read_argument_list();
                    }
                    return this.node("attribute")(name, args);
                  },
                  read_attr_list: function read_attr_list() {
                    var list = [];
                    if (this.token === this.tok.T_ATTRIBUTE) {
                      do {
                        var attrGr = this.node("attrgroup")([]);
                        this.next();
                        attrGr.attrs.push(this.read_attribute());
                        while (this.token === ",") {
                          this.next();
                          if (this.token !== "]") attrGr.attrs.push(this.read_attribute());
                        }
                        list.push(attrGr);
                        this.expect("]");
                        this.next();
                      } while (this.token === this.tok.T_ATTRIBUTE);
                    }
                    return list;
                  },
                  /*
                   * ```ebnf
                   *    new_expr ::= T_NEW (namespace_name function_argument_list) | (T_CLASS ... class declaration)
                   * ```
                   * https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L850
                   */
                  read_new_expr: function read_new_expr() {
                    var result = this.node("new");
                    this.expect(this.tok.T_NEW) && this.next();
                    var args = [];
                    if (this.token === "(") {
                      this.next();
                      var newExp = this.read_expr();
                      this.expect(")");
                      this.next();
                      if (this.token === "(") {
                        args = this.read_argument_list();
                      }
                      return result(newExp, args);
                    }
                    var attrs = this.read_attr_list();
                    var isReadonly = this.token === this.tok.T_READ_ONLY;
                    if (isReadonly) {
                      if (this.version < 803) {
                        this.raiseError("Anonymous readonly classes are not allowed before PHP 8.3");
                      }
                      this.next();
                    }
                    if (this.token === this.tok.T_CLASS) {
                      var what = this.node("class");
                      if (this.next().token === "(") {
                        args = this.read_argument_list();
                      }
                      var propExtends = this.read_extends_from();
                      var propImplements = this.read_implements_list();
                      var body = null;
                      if (this.expect("{")) {
                        body = this.next().read_class_body(true, false);
                      }
                      var whatNode = what(null, propExtends, propImplements, body, [0, 0, 0, isReadonly ? 1 : 0]);
                      whatNode.attrGroups = attrs;
                      return result(whatNode, args);
                    }
                    var name = this.read_new_class_name();
                    while (this.token === "[") {
                      var offsetNode = this.node("offsetlookup");
                      var offset = this.next().read_encaps_var_offset();
                      this.expect("]") && this.next();
                      name = offsetNode(name, offset);
                    }
                    if (this.token === "(") {
                      args = this.read_argument_list();
                    }
                    return result(name, args);
                  },
                  /*
                   * Reads a class name
                   * ```ebnf
                   * read_new_class_name ::= namespace_name | variable
                   * ```
                   */
                  read_new_class_name: function read_new_class_name() {
                    if (this.token === this.tok.T_NS_SEPARATOR || this.token === this.tok.T_NAME_RELATIVE || this.token === this.tok.T_NAME_QUALIFIED || this.token === this.tok.T_NAME_FULLY_QUALIFIED || this.token === this.tok.T_STRING || this.token === this.tok.T_NAMESPACE) {
                      var result = this.read_namespace_name(true);
                      if (this.token === this.tok.T_DOUBLE_COLON) {
                        result = this.read_static_getter(result);
                      }
                      return result;
                    } else if (this.is("VARIABLE")) {
                      return this.read_variable(true, false);
                    } else {
                      this.expect([this.tok.T_STRING, "VARIABLE"]);
                    }
                  },
                  handleDereferencable: function handleDereferencable(expr) {
                    while (this.token !== this.EOF) {
                      if (this.token === this.tok.T_OBJECT_OPERATOR || this.token === this.tok.T_DOUBLE_COLON || this.token === this.tok.T_NULLSAFE_OBJECT_OPERATOR) {
                        expr = this.recursive_variable_chain_scan(expr, false, false, true);
                      } else if (this.token === this.tok.T_CURLY_OPEN || this.token === "[") {
                        expr = this.read_dereferencable(expr);
                      } else if (this.token === "(") {
                        expr = this.node("call")(expr, this.read_argument_list());
                      } else {
                        return expr;
                      }
                    }
                    return expr;
                  }
                };
              },
              /***/
              8214(module2) {
                module2.exports = {
                  /*
                   * checks if current token is a reference keyword
                   */
                  is_reference: function is_reference() {
                    if (this.token === "&") {
                      this.next();
                      return true;
                    }
                    return false;
                  },
                  /*
                   * checks if current token is a variadic keyword
                   */
                  is_variadic: function is_variadic() {
                    if (this.token === this.tok.T_ELLIPSIS) {
                      this.next();
                      return true;
                    }
                    return false;
                  },
                  /*
                   * reading a function
                   * ```ebnf
                   * function ::= function_declaration code_block
                   * ```
                   */
                  read_function: function read_function(closure, flag, attrs, locStart) {
                    var result = this.read_function_declaration(closure ? 1 : flag ? 2 : 0, flag && flag[1] === 1, attrs || [], locStart);
                    if (flag && flag[2] == 1) {
                      result.parseFlags(flag);
                      if (this.expect(";")) {
                        this.next();
                      }
                    } else {
                      if (this.expect("{")) {
                        result.body = this.read_code_block(false);
                        if (result.loc && result.body.loc) {
                          result.loc.end = result.body.loc.end;
                        }
                      }
                      if (!closure && flag) {
                        result.parseFlags(flag);
                      }
                    }
                    return result;
                  },
                  /*
                   * reads a function declaration (without his body)
                   * ```ebnf
                   * function_declaration ::= T_FUNCTION '&'?  T_STRING '(' parameter_list ')'
                   * ```
                   */
                  read_function_declaration: function read_function_declaration(type, isStatic, attrs, locStart) {
                    var _this = this;
                    var nodeName = "function";
                    if (type === 1) {
                      nodeName = "closure";
                    } else if (type === 2) {
                      nodeName = "method";
                    }
                    var result = this.node(nodeName);
                    if (this.expect(this.tok.T_FUNCTION)) {
                      this.next();
                    }
                    var isRef = this.is_reference();
                    var name = false, use = [], returnType = null, nullable = false;
                    if (type !== 1) {
                      var nameNode = this.node("identifier");
                      if (type === 2) {
                        if (this.version >= 700) {
                          if (this.token === this.tok.T_STRING || this.is("IDENTIFIER")) {
                            name = this.text();
                            this.next();
                          } else if (this.version < 704) {
                            this.error("IDENTIFIER");
                          }
                        } else if (this.token === this.tok.T_STRING) {
                          name = this.text();
                          this.next();
                        } else {
                          this.error("IDENTIFIER");
                        }
                      } else {
                        if (this.version >= 700) {
                          if (this.token === this.tok.T_STRING) {
                            name = this.text();
                            this.next();
                          } else if (this.version >= 704) {
                            if (!this.expect("(")) {
                              this.next();
                            }
                          } else {
                            this.error(this.tok.T_STRING);
                            this.next();
                          }
                        } else {
                          if (this.expect(this.tok.T_STRING)) {
                            name = this.text();
                          }
                          this.next();
                        }
                      }
                      name = nameNode(name);
                    }
                    if (this.expect("(")) this.next();
                    var params = this.read_parameter_list(name.name === "__construct");
                    if (this.expect(")")) this.next();
                    if (type === 1) {
                      use = this.read_lexical_vars();
                    }
                    if (this.token === ":") {
                      if (this.next().token === "?") {
                        nullable = true;
                        this.next();
                      }
                      returnType = this.read_types();
                    }
                    var apply_attrgroup_location = function apply_attrgroup_location2(node) {
                      node.attrGroups = attrs || [];
                      if (locStart && node.loc) {
                        node.loc.start = locStart;
                        if (node.loc.source) {
                          node.loc.source = _this.lexer._input.substr(node.loc.start.offset, node.loc.end.offset - node.loc.start.offset);
                        }
                      }
                      return node;
                    };
                    if (type === 1) {
                      return apply_attrgroup_location(result(params, isRef, use, returnType, nullable, isStatic));
                    }
                    return apply_attrgroup_location(result(name, params, isRef, returnType, nullable));
                  },
                  read_lexical_vars: function read_lexical_vars() {
                    var result = [];
                    if (this.token === this.tok.T_USE) {
                      this.next();
                      this.expect("(") && this.next();
                      result = this.read_lexical_var_list();
                      this.expect(")") && this.next();
                    }
                    return result;
                  },
                  read_list_with_dangling_comma: function read_list_with_dangling_comma(item) {
                    var result = [];
                    while (this.token != this.EOF) {
                      result.push(item());
                      if (this.token == ",") {
                        this.next();
                        if (this.version >= 800 && this.token === ")") {
                          return result;
                        }
                      } else if (this.token == ")") {
                        break;
                      } else {
                        this.error([",", ")"]);
                        break;
                      }
                    }
                    return result;
                  },
                  read_lexical_var_list: function read_lexical_var_list() {
                    return this.read_list_with_dangling_comma(this.read_lexical_var.bind(this));
                  },
                  /*
                   * ```ebnf
                   * lexical_var ::= '&'? T_VARIABLE
                   * ```
                   */
                  read_lexical_var: function read_lexical_var() {
                    if (this.token === "&") {
                      return this.read_byref(this.read_lexical_var.bind(this));
                    }
                    var result = this.node("variable");
                    this.expect(this.tok.T_VARIABLE);
                    var name = this.text().substring(1);
                    this.next();
                    return result(name, false);
                  },
                  /*
                   * reads a list of parameters
                   * ```ebnf
                   *  parameter_list ::= (parameter ',')* parameter?
                   * ```
                   */
                  read_parameter_list: function read_parameter_list(is_class_constructor) {
                    if (this.token !== ")") {
                      var wasVariadic = false;
                      return this.read_list_with_dangling_comma(function() {
                        var parameter = this.read_parameter(is_class_constructor);
                        if (parameter) {
                          if (wasVariadic) {
                            this.raiseError("Unexpected parameter after a variadic parameter");
                          }
                          if (parameter.variadic) {
                            wasVariadic = true;
                          }
                        }
                        return parameter;
                      }.bind(this), ",");
                    }
                    return [];
                  },
                  /*
                   * ```ebnf
                   *  parameter ::= type? '&'? T_ELLIPSIS? T_VARIABLE ('=' expr)?
                   * ```
                   * @see https://github.com/php/php-src/blob/493524454d66adde84e00d249d607ecd540de99f/Zend/zend_language_parser.y#L640
                   */
                  read_parameter: function read_parameter(is_class_constructor) {
                    var node = this.node("parameter");
                    var parameterName = null;
                    var value = null;
                    var nullable = false;
                    var readonly = false;
                    var attrs = [];
                    if (this.token === this.tok.T_ATTRIBUTE) attrs = this.read_attr_list();
                    if (this.version >= 801 && this.token === this.tok.T_READ_ONLY) {
                      if (is_class_constructor) {
                        this.next();
                        readonly = true;
                      } else {
                        this.raiseError("readonly properties can be used only on class constructor");
                      }
                    }
                    var flags = this.read_promoted();
                    if (!readonly && this.version >= 801 && this.token === this.tok.T_READ_ONLY) {
                      if (is_class_constructor) {
                        this.next();
                        readonly = true;
                      } else {
                        this.raiseError("readonly properties can be used only on class constructor");
                      }
                    }
                    if (this.token === "?") {
                      this.next();
                      nullable = true;
                    }
                    var types = this.read_types();
                    if (nullable && !types) {
                      this.raiseError("Expecting a type definition combined with nullable operator");
                    }
                    var isRef = this.is_reference();
                    var isVariadic = this.is_variadic();
                    if (this.expect(this.tok.T_VARIABLE)) {
                      parameterName = this.node("identifier");
                      var name = this.text().substring(1);
                      this.next();
                      parameterName = parameterName(name);
                    }
                    if (this.token == "=") {
                      value = this.next().read_expr();
                    }
                    var result = node(parameterName, types, value, isRef, isVariadic, readonly, nullable, flags);
                    if (attrs) result.attrGroups = attrs;
                    return result;
                  },
                  read_types: function read_types() {
                    var MODE_UNSET = "unset";
                    var MODE_UNION = "union";
                    var MODE_INTERSECTION = "intersection";
                    var types = [];
                    var mode = MODE_UNSET;
                    var type = this.read_type();
                    if (!type) return null;
                    types.push(type);
                    while (this.token === "|" || this.version >= 801 && this.token === "&") {
                      var nextToken = this.peek();
                      if (nextToken === this.tok.T_ELLIPSIS || nextToken === this.tok.T_VARIABLE) {
                        break;
                      }
                      if (mode === MODE_UNSET) {
                        mode = this.token === "|" ? MODE_UNION : MODE_INTERSECTION;
                      } else {
                        if (mode === MODE_UNION && this.token !== "|" || mode === MODE_INTERSECTION && this.token !== "&") {
                          this.raiseError('Unexpect token "' + this.token + '", "|" and "&" can not be mixed');
                        }
                      }
                      this.next();
                      types.push(this.read_type());
                    }
                    if (types.length === 1) {
                      return types[0];
                    } else {
                      return mode === MODE_INTERSECTION ? this.node("intersectiontype")(types) : this.node("uniontype")(types);
                    }
                  },
                  read_promoted: function read_promoted() {
                    var MODIFIER_PUBLIC = 1;
                    var MODIFIER_PROTECTED = 2;
                    var MODIFIER_PRIVATE = 4;
                    if (this.token === this.tok.T_PUBLIC) {
                      this.next();
                      return MODIFIER_PUBLIC;
                    } else if (this.token === this.tok.T_PROTECTED) {
                      this.next();
                      return MODIFIER_PROTECTED;
                    } else if (this.token === this.tok.T_PRIVATE) {
                      this.next();
                      return MODIFIER_PRIVATE;
                    }
                    return 0;
                  },
                  /*
                   * Reads a list of arguments
                   * ```ebnf
                   *  function_argument_list ::= '(' (argument_list (',' argument_list)*)? ')'
                   * ```
                   */
                  read_argument_list: function read_argument_list() {
                    var result = [];
                    this.expect("(") && this.next();
                    if (this.version >= 801 && this.token === this.tok.T_ELLIPSIS && this.peek() === ")") {
                      result.push(this.node("variadicplaceholder")());
                      this.next();
                    } else if (this.token !== ")") {
                      result = this.read_non_empty_argument_list();
                    }
                    this.expect(")") && this.next();
                    return result;
                  },
                  /*
                   * Reads non empty argument list
                   */
                  read_non_empty_argument_list: function read_non_empty_argument_list() {
                    var wasVariadic = false;
                    return this.read_function_list(function() {
                      var argument = this.read_argument();
                      if (argument) {
                        var isVariadic = argument.kind === "variadic";
                        if (wasVariadic && !isVariadic) {
                          this.raiseError("Unexpected non-variadic argument after a variadic argument");
                        }
                        if (isVariadic) {
                          wasVariadic = true;
                        }
                      }
                      return argument;
                    }.bind(this), ",");
                  },
                  /*
                   * ```ebnf
                   *    argument_list ::= T_STRING ':' expr | T_ELLIPSIS? expr
                   * ```
                   */
                  read_argument: function read_argument() {
                    if (this.token === this.tok.T_ELLIPSIS) {
                      return this.node("variadic")(this.next().read_expr());
                    }
                    if (this.token === this.tok.T_STRING || Object.values(this.lexer.keywords).includes(this.token)) {
                      var nextToken = this.peek();
                      if (nextToken === ":") {
                        if (this.version < 800) {
                          this.raiseError("PHP 8+ is required to use named arguments");
                        }
                        return this.node("namedargument")(this.text(), this.next().next().read_expr());
                      }
                    }
                    return this.read_expr();
                  },
                  /*
                   * read type hinting
                   * ```ebnf
                   *  type ::= T_ARRAY | T_CALLABLE | namespace_name
                   * ```
                   */
                  read_type: function read_type() {
                    var result = this.node();
                    if (this.token === this.tok.T_ARRAY || this.token === this.tok.T_CALLABLE) {
                      var type = this.text();
                      this.next();
                      return result("typereference", type.toLowerCase(), type);
                    } else if (this.token === this.tok.T_NAME_RELATIVE || this.token === this.tok.T_NAME_QUALIFIED || this.token === this.tok.T_NAME_FULLY_QUALIFIED || this.token === this.tok.T_STRING || this.token === this.tok.T_STATIC) {
                      var _type = this.text();
                      var backup = [this.token, this.lexer.getState()];
                      this.next();
                      if (this.token !== this.tok.T_NS_SEPARATOR && this.ast.typereference.types.indexOf(_type.toLowerCase()) > -1) {
                        return result("typereference", _type.toLowerCase(), _type);
                      } else {
                        this.lexer.tokens.push(backup);
                        this.next();
                        result.destroy();
                        return this.read_namespace_name();
                      }
                    }
                    result.destroy();
                    return null;
                  }
                };
              },
              /***/
              9461(module2) {
                module2.exports = {
                  /*
                   * Reads an IF statement
                   *
                   * ```ebnf
                   *  if ::= T_IF '(' expr ')' ':' ...
                   * ```
                   */
                  read_if: function read_if() {
                    var result = this.node("if");
                    var test = this.next().read_if_expr();
                    var body;
                    var alternate = null;
                    var shortForm = false;
                    if (this.token === ":") {
                      shortForm = true;
                      this.next();
                      body = this.node("block");
                      var items = [];
                      while (this.token !== this.EOF && this.token !== this.tok.T_ENDIF) {
                        if (this.token === this.tok.T_ELSEIF) {
                          alternate = this.read_elseif_short();
                          break;
                        } else if (this.token === this.tok.T_ELSE) {
                          alternate = this.read_else_short();
                          break;
                        }
                        items.push(this.read_inner_statement());
                      }
                      body = body(null, items);
                      this.expect(this.tok.T_ENDIF) && this.next();
                      this.expectEndOfStatement();
                    } else {
                      body = this.read_statement();
                      if (this.token === this.tok.T_ELSEIF) {
                        alternate = this.read_if();
                      } else if (this.token === this.tok.T_ELSE) {
                        alternate = this.next().read_statement();
                      }
                    }
                    return result(test, body, alternate, shortForm);
                  },
                  /*
                   * reads an if expression : '(' expr ')'
                   */
                  read_if_expr: function read_if_expr() {
                    this.expect("(") && this.next();
                    var result = this.read_expr();
                    this.expect(")") && this.next();
                    return result;
                  },
                  /*
                   * reads an elseif (expr): statements
                   */
                  read_elseif_short: function read_elseif_short() {
                    var alternate = null;
                    var result = this.node("if");
                    var test = this.next().read_if_expr();
                    if (this.expect(":")) this.next();
                    var body = this.node("block");
                    var items = [];
                    while (this.token != this.EOF && this.token !== this.tok.T_ENDIF) {
                      if (this.token === this.tok.T_ELSEIF) {
                        alternate = this.read_elseif_short();
                        break;
                      } else if (this.token === this.tok.T_ELSE) {
                        alternate = this.read_else_short();
                        break;
                      }
                      items.push(this.read_inner_statement());
                    }
                    return result(test, body(null, items), alternate, true);
                  },
                  /*
                   *
                   */
                  read_else_short: function read_else_short() {
                    if (this.next().expect(":")) this.next();
                    var body = this.node("block");
                    var items = [];
                    while (this.token != this.EOF && this.token !== this.tok.T_ENDIF) {
                      items.push(this.read_inner_statement());
                    }
                    return body(null, items);
                  }
                };
              },
              /***/
              5931(module2) {
                module2.exports = {
                  /*
                   * Reads a while statement
                   * ```ebnf
                   * while ::= T_WHILE (statement | ':' inner_statement_list T_ENDWHILE ';')
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L587
                   * @return {While}
                   */
                  read_while: function read_while() {
                    var result = this.node("while");
                    this.expect(this.tok.T_WHILE) && this.next();
                    var body;
                    var shortForm = false;
                    if (this.expect("(")) this.next();
                    var test = this.read_expr();
                    if (this.expect(")")) this.next();
                    if (this.token === ":") {
                      shortForm = true;
                      body = this.read_short_form(this.tok.T_ENDWHILE);
                    } else {
                      body = this.read_statement();
                    }
                    return result(test, body, shortForm);
                  },
                  /*
                   * Reads a do / while loop
                   * ```ebnf
                   * do ::= T_DO statement T_WHILE '(' expr ')' ';'
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L423
                   * @return {Do}
                   */
                  read_do: function read_do() {
                    var result = this.node("do");
                    this.expect(this.tok.T_DO) && this.next();
                    var test = null;
                    var body = this.read_statement();
                    if (this.expect(this.tok.T_WHILE)) {
                      if (this.next().expect("(")) this.next();
                      test = this.read_expr();
                      if (this.expect(")")) this.next();
                      if (this.expect(";")) this.next();
                    }
                    return result(test, body);
                  },
                  /*
                   * Read a for incremental loop
                   * ```ebnf
                   * for ::= T_FOR '(' for_exprs ';' for_exprs ';' for_exprs ')' for_statement
                   * for_statement ::= statement | ':' inner_statement_list T_ENDFOR ';'
                   * for_exprs ::= expr? (',' expr)*
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L425
                   * @return {For}
                   */
                  read_for: function read_for() {
                    var result = this.node("for");
                    this.expect(this.tok.T_FOR) && this.next();
                    var init = [];
                    var test = [];
                    var increment = [];
                    var body;
                    var shortForm = false;
                    if (this.expect("(")) this.next();
                    if (this.token !== ";") {
                      init = this.read_list(this.read_expr, ",");
                      if (this.expect(";")) this.next();
                    } else {
                      this.next();
                    }
                    if (this.token !== ";") {
                      test = this.read_list(this.read_expr, ",");
                      if (this.expect(";")) this.next();
                    } else {
                      this.next();
                    }
                    if (this.token !== ")") {
                      increment = this.read_list(this.read_expr, ",");
                      if (this.expect(")")) this.next();
                    } else {
                      this.next();
                    }
                    if (this.token === ":") {
                      shortForm = true;
                      body = this.read_short_form(this.tok.T_ENDFOR);
                    } else {
                      body = this.read_statement();
                    }
                    return result(init, test, increment, body, shortForm);
                  },
                  /*
                   * Reads a foreach loop
                   * ```ebnf
                   * foreach ::= '(' expr T_AS foreach_variable (T_DOUBLE_ARROW foreach_variable)? ')' statement
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L438
                   * @return {Foreach}
                   */
                  read_foreach: function read_foreach() {
                    var result = this.node("foreach");
                    this.expect(this.tok.T_FOREACH) && this.next();
                    var key = null;
                    var value = null;
                    var body;
                    var shortForm = false;
                    if (this.expect("(")) this.next();
                    var source = this.read_expr();
                    if (this.expect(this.tok.T_AS)) {
                      this.next();
                      value = this.read_foreach_variable();
                      if (this.token === this.tok.T_DOUBLE_ARROW) {
                        key = value;
                        value = this.next().read_foreach_variable();
                      }
                    }
                    if (key && key.kind === "list") {
                      this.raiseError("Fatal Error : Cannot use list as key element");
                    }
                    if (this.expect(")")) this.next();
                    if (this.token === ":") {
                      shortForm = true;
                      body = this.read_short_form(this.tok.T_ENDFOREACH);
                    } else {
                      body = this.read_statement();
                    }
                    return result(source, key, value, body, shortForm);
                  },
                  /*
                   * Reads a foreach variable statement
                   * ```ebnf
                   * foreach_variable =
                   *    variable |
                   *    '&' variable |
                   *    T_LIST '(' assignment_list ')' |
                   *    '[' assignment_list ']'
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L544
                   * @return {Expression}
                   */
                  read_foreach_variable: function read_foreach_variable() {
                    if (this.token === this.tok.T_LIST || this.token === "[") {
                      var isShort = this.token === "[";
                      var result = this.node("list");
                      this.next();
                      if (!isShort && this.expect("(")) this.next();
                      var assignList = this.read_array_pair_list(isShort);
                      if (this.expect(isShort ? "]" : ")")) this.next();
                      return result(assignList, isShort);
                    } else {
                      return this.read_variable(false, false);
                    }
                  }
                };
              },
              /***/
              9147(module2) {
                module2.exports = {
                  /*
                   * ```ebnf
                   * start ::= (namespace | top_statement)*
                   * ```
                   */
                  read_start: function read_start() {
                    if (this.token == this.tok.T_NAMESPACE) {
                      return this.read_namespace();
                    } else {
                      return this.read_top_statement();
                    }
                  }
                };
              },
              /***/
              9219(module2) {
                module2.exports = {
                  /*
                   * Reads a namespace declaration block
                   * ```ebnf
                   * namespace ::= T_NAMESPACE namespace_name? '{'
                   *    top_statements
                   * '}'
                   * | T_NAMESPACE namespace_name ';' top_statements
                   * ```
                   * @see http://php.net/manual/en/language.namespaces.php
                   * @return {Namespace}
                   */
                  read_namespace: function read_namespace() {
                    var result = this.node("namespace");
                    var body;
                    this.expect(this.tok.T_NAMESPACE) && this.next();
                    var name;
                    if (this.token === "{") {
                      name = {
                        name: [""]
                      };
                    } else {
                      name = this.read_namespace_name();
                    }
                    this.currentNamespace = name;
                    if (this.token === ";") {
                      this.currentNamespace = name;
                      body = this.next().read_top_statements();
                      this.expect(this.EOF);
                      return result(name.name, body, false);
                    } else if (this.token === "{") {
                      this.currentNamespace = name;
                      body = this.next().read_top_statements();
                      this.expect("}") && this.next();
                      if (body.length === 0 && this.extractDoc && this._docs.length > this._docIndex) {
                        body.push(this.node("noop")());
                      }
                      return result(name.name, body, true);
                    } else {
                      this.error(["{", ";"]);
                      this.currentNamespace = name;
                      body = this.read_top_statements();
                      this.expect(this.EOF);
                      return result(name, body, false);
                    }
                  },
                  /*
                   * Reads a namespace name
                   * ```ebnf
                   *  namespace_name ::= T_NS_SEPARATOR? (T_STRING T_NS_SEPARATOR)* T_STRING
                   * ```
                   * @see http://php.net/manual/en/language.namespaces.rules.php
                   * @return {Reference}
                   */
                  read_namespace_name: function read_namespace_name(resolveReference) {
                    var result = this.node();
                    var resolution;
                    var name = this.text();
                    switch (this.token) {
                      case this.tok.T_NAME_RELATIVE:
                        resolution = this.ast.name.RELATIVE_NAME;
                        name = name.replace(/^namespace\\/, "");
                        break;
                      case this.tok.T_NAME_QUALIFIED:
                        resolution = this.ast.name.QUALIFIED_NAME;
                        break;
                      case this.tok.T_NAME_FULLY_QUALIFIED:
                        resolution = this.ast.name.FULL_QUALIFIED_NAME;
                        break;
                      default:
                        resolution = this.ast.name.UNQUALIFIED_NAME;
                        if (!this.expect(this.tok.T_STRING)) {
                          return result("name", "", this.ast.name.FULL_QUALIFIED_NAME);
                        }
                    }
                    this.next();
                    if (resolveReference || this.token !== "(") {
                      if (name.toLowerCase() === "parent") {
                        return result("parentreference", name);
                      } else if (name.toLowerCase() === "self") {
                        return result("selfreference", name);
                      }
                    }
                    return result("name", name, resolution);
                  },
                  /*
                   * Reads a use statement
                   * ```ebnf
                   * use_statement ::= T_USE
                   *   use_type? use_declarations |
                   *   use_type use_statement '{' use_declarations '}' |
                   *   use_statement '{' use_declarations(=>typed) '}'
                   * ';'
                   * ```
                   * @see http://php.net/manual/en/language.namespaces.importing.php
                   * @return {UseGroup}
                   */
                  read_use_statement: function read_use_statement() {
                    var result = this.node("usegroup");
                    var items = [];
                    var name = null;
                    this.expect(this.tok.T_USE) && this.next();
                    var type = this.read_use_type();
                    items.push(this.read_use_declaration(false));
                    if (this.token === ",") {
                      items = items.concat(this.next().read_use_declarations(false));
                    } else if (this.token === "{") {
                      name = items[0].name;
                      items = this.next().read_use_declarations(type === null);
                      this.expect("}") && this.next();
                    }
                    result = result(name, type, items);
                    this.expect(";") && this.next();
                    return result;
                  },
                  /*
                   *
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L1045
                   */
                  read_class_name_reference: function read_class_name_reference() {
                    return this.read_variable(true, false);
                  },
                  /*
                   * Reads a use declaration
                   * ```ebnf
                   * use_declaration ::= use_type? namespace_name use_alias
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L380
                   * @return {UseItem}
                   */
                  read_use_declaration: function read_use_declaration(typed) {
                    var result = this.node("useitem");
                    var type = null;
                    if (typed) type = this.read_use_type();
                    var name = this.read_namespace_name();
                    var alias = this.read_use_alias();
                    return result(name.name, alias, type);
                  },
                  /*
                   * Reads a list of use declarations
                   * ```ebnf
                   * use_declarations ::= use_declaration (',' use_declaration)*
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L380
                   * @return {UseItem[]}
                   */
                  read_use_declarations: function read_use_declarations(typed) {
                    var result = [this.read_use_declaration(typed)];
                    while (this.token === ",") {
                      this.next();
                      if (typed) {
                        if (this.token !== this.tok.T_NAME_RELATIVE && this.token !== this.tok.T_NAME_QUALIFIED && this.token !== this.tok.T_NAME_FULLY_QUALIFIED && this.token !== this.tok.T_FUNCTION && this.token !== this.tok.T_CONST && this.token !== this.tok.T_STRING) {
                          break;
                        }
                      } else if (this.token !== this.tok.T_NAME_RELATIVE && this.token !== this.tok.T_NAME_QUALIFIED && this.token !== this.tok.T_NAME_FULLY_QUALIFIED && this.token !== this.tok.T_STRING && this.token !== this.tok.T_NS_SEPARATOR) {
                        break;
                      }
                      result.push(this.read_use_declaration(typed));
                    }
                    return result;
                  },
                  /*
                   * Reads a use statement
                   * ```ebnf
                   * use_alias ::= (T_AS T_STRING)?
                   * ```
                   * @return {String|null}
                   */
                  read_use_alias: function read_use_alias() {
                    var result = null;
                    if (this.token === this.tok.T_AS) {
                      if (this.next().expect(this.tok.T_STRING)) {
                        var aliasName = this.node("identifier");
                        var name = this.text();
                        this.next();
                        result = aliasName(name);
                      }
                    }
                    return result;
                  },
                  /*
                   * Reads the namespace type declaration
                   * ```ebnf
                   * use_type ::= (T_FUNCTION | T_CONST)?
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L335
                   * @return {String|null} Possible values : function, const
                   */
                  read_use_type: function read_use_type() {
                    if (this.token === this.tok.T_FUNCTION) {
                      this.next();
                      return this.ast.useitem.TYPE_FUNCTION;
                    } else if (this.token === this.tok.T_CONST) {
                      this.next();
                      return this.ast.useitem.TYPE_CONST;
                    }
                    return null;
                  }
                };
              },
              /***/
              7170(module2) {
                var specialChar = {
                  "\\": "\\",
                  $: "$",
                  n: "\n",
                  r: "\r",
                  t: "	",
                  f: String.fromCharCode(12),
                  v: String.fromCharCode(11),
                  e: String.fromCharCode(27)
                };
                module2.exports = {
                  /*
                   * Unescape special chars
                   */
                  resolve_special_chars: function resolve_special_chars(text, doubleQuote) {
                    if (!doubleQuote) {
                      return text.replace(/\\\\/g, "\\").replace(/\\'/g, "'");
                    }
                    return text.replace(/\\"/, '"').replace(/\\([\\$nrtfve]|[xX][0-9a-fA-F]{1,2}|[0-7]{1,3}|u{([0-9a-fA-F]+)})/g, function($match, p1, p2) {
                      if (specialChar[p1]) {
                        return specialChar[p1];
                      } else if ("x" === p1[0] || "X" === p1[0]) {
                        return String.fromCodePoint(parseInt(p1.substr(1), 16));
                      } else if ("u" === p1[0]) {
                        return String.fromCodePoint(parseInt(p2, 16));
                      } else {
                        return String.fromCodePoint(parseInt(p1, 8));
                      }
                    });
                  },
                  /*
                   * Remove all leading spaces each line for heredoc text if there is a indentation
                   * @param {string} text
                   * @param {number} indentation
                   * @param {boolean} indentation_uses_spaces
                   * @param {boolean} first_encaps_node if it is behind a variable, the first N spaces should not be removed
                   */
                  remove_heredoc_leading_whitespace_chars: function remove_heredoc_leading_whitespace_chars(text, indentation, indentation_uses_spaces, first_encaps_node) {
                    if (indentation === 0) {
                      return text;
                    }
                    this.check_heredoc_indentation_level(text, indentation, indentation_uses_spaces, first_encaps_node);
                    var matchedChar = indentation_uses_spaces ? " " : "	";
                    var removementRegExp = new RegExp("\\n".concat(matchedChar, "{").concat(indentation, "}"), "g");
                    var removementFirstEncapsNodeRegExp = new RegExp("^".concat(matchedChar, "{").concat(indentation, "}"));
                    if (first_encaps_node) {
                      text = text.replace(removementFirstEncapsNodeRegExp, "");
                    }
                    return text.replace(removementRegExp, "\n");
                  },
                  /*
                   * Check indentation level of heredoc in text, if mismatch, raiseError
                   * @param {string} text
                   * @param {number} indentation
                   * @param {boolean} indentation_uses_spaces
                   * @param {boolean} first_encaps_node if it is behind a variable, the first N spaces should not be removed
                   */
                  check_heredoc_indentation_level: function check_heredoc_indentation_level(text, indentation, indentation_uses_spaces, first_encaps_node) {
                    var textSize = text.length;
                    var offset = 0;
                    var leadingWhitespaceCharCount = 0;
                    var inCoutingState = true;
                    var chToCheck = indentation_uses_spaces ? " " : "	";
                    var inCheckState = false;
                    if (!first_encaps_node) {
                      offset = text.indexOf("\n");
                      if (offset === -1) {
                        return;
                      }
                      offset++;
                    }
                    while (offset < textSize) {
                      if (inCoutingState) {
                        if (text[offset] === chToCheck) {
                          leadingWhitespaceCharCount++;
                        } else {
                          inCheckState = true;
                        }
                      } else {
                        inCoutingState = false;
                      }
                      if (text[offset] !== "\n" && inCheckState && leadingWhitespaceCharCount < indentation) {
                        this.raiseError("Invalid body indentation level (expecting an indentation at least ".concat(indentation, ")"));
                      } else {
                        inCheckState = false;
                      }
                      if (text[offset] === "\n") {
                        inCoutingState = true;
                        leadingWhitespaceCharCount = 0;
                      }
                      offset++;
                    }
                  },
                  /*
                   * Reads dereferencable scalar
                   */
                  read_dereferencable_scalar: function read_dereferencable_scalar() {
                    var result = null;
                    switch (this.token) {
                      case this.tok.T_CONSTANT_ENCAPSED_STRING:
                        {
                          var value = this.node("string");
                          var text = this.text();
                          var offset = 0;
                          if (text[0] === "b" || text[0] === "B") {
                            offset = 1;
                          }
                          var isDoubleQuote = text[offset] === '"';
                          this.next();
                          var textValue = this.resolve_special_chars(text.substring(offset + 1, text.length - 1), isDoubleQuote);
                          value = value(
                            isDoubleQuote,
                            textValue,
                            offset === 1,
                            // unicode flag
                            text
                          );
                          if (this.token === this.tok.T_DOUBLE_COLON) {
                            result = this.read_static_getter(value);
                          } else {
                            result = value;
                          }
                        }
                        break;
                      case this.tok.T_ARRAY:
                        result = this.read_array();
                        break;
                      case "[":
                        result = this.read_array();
                        break;
                    }
                    return result;
                  },
                  /*
                   * ```ebnf
                   *  scalar ::= T_MAGIC_CONST
                   *       | T_LNUMBER | T_DNUMBER
                   *       | T_START_HEREDOC T_ENCAPSED_AND_WHITESPACE? T_END_HEREDOC
                   *       | '"' encaps_list '"'
                   *       | T_START_HEREDOC encaps_list T_END_HEREDOC
                   *       | namespace_name (T_DOUBLE_COLON T_STRING)?
                   * ```
                   */
                  read_scalar: function read_scalar() {
                    if (this.is("T_MAGIC_CONST")) {
                      return this.get_magic_constant();
                    } else {
                      var value, node;
                      switch (this.token) {
                        // NUMERIC
                        case this.tok.T_LNUMBER:
                        // long
                        case this.tok.T_DNUMBER: {
                          var result = this.node("number");
                          value = this.text();
                          this.next();
                          return result(value, null);
                        }
                        case this.tok.T_START_HEREDOC:
                          if (this.lexer.curCondition === "ST_NOWDOC") {
                            var start = this.lexer.yylloc.first_offset;
                            node = this.node("nowdoc");
                            value = this.next().text();
                            if (this.lexer.heredoc_label.indentation > 0) {
                              value = value.substring(0, value.length - this.lexer.heredoc_label.indentation);
                            }
                            var lastCh = value[value.length - 1];
                            if (lastCh === "\n") {
                              if (value[value.length - 2] === "\r") {
                                value = value.substring(0, value.length - 2);
                              } else {
                                value = value.substring(0, value.length - 1);
                              }
                            } else if (lastCh === "\r") {
                              value = value.substring(0, value.length - 1);
                            }
                            this.expect(this.tok.T_ENCAPSED_AND_WHITESPACE) && this.next();
                            this.expect(this.tok.T_END_HEREDOC) && this.next();
                            var raw = this.lexer._input.substring(start, this.lexer.yylloc.first_offset);
                            node = node(this.remove_heredoc_leading_whitespace_chars(value, this.lexer.heredoc_label.indentation, this.lexer.heredoc_label.indentation_uses_spaces, this.lexer.heredoc_label.first_encaps_node), raw, this.lexer.heredoc_label.label);
                            this.lexer.heredoc_label.finished = true;
                            return node;
                          } else {
                            return this.read_encapsed_string(this.tok.T_END_HEREDOC);
                          }
                        case '"':
                          return this.read_encapsed_string('"');
                        case 'b"':
                        case 'B"': {
                          return this.read_encapsed_string('"', true);
                        }
                        // TEXTS
                        case this.tok.T_CONSTANT_ENCAPSED_STRING:
                        case this.tok.T_ARRAY:
                        // array parser
                        case "[":
                          return this.read_dereferencable_scalar();
                        default: {
                          var err = this.error("SCALAR");
                          this.next();
                          return err;
                        }
                      }
                    }
                  },
                  /*
                   * Handles the dereferencing
                   */
                  read_dereferencable: function read_dereferencable(expr) {
                    var result, offset;
                    var node = this.node("offsetlookup");
                    if (this.token === "[") {
                      offset = this.next().read_expr();
                      if (this.expect("]")) this.next();
                      result = node(expr, offset);
                    } else if (this.token === this.tok.T_DOLLAR_OPEN_CURLY_BRACES) {
                      offset = this.read_encapsed_string_item(false);
                      result = node(expr, offset);
                    }
                    return result;
                  },
                  /*
                   * Reads and extracts an encapsed item
                   * ```ebnf
                   * encapsed_string_item ::= T_ENCAPSED_AND_WHITESPACE
                   *  | T_DOLLAR_OPEN_CURLY_BRACES expr '}'
                   *  | T_DOLLAR_OPEN_CURLY_BRACES T_STRING_VARNAME '}'
                   *  | T_DOLLAR_OPEN_CURLY_BRACES T_STRING_VARNAME '[' expr ']' '}'
                   *  | T_CURLY_OPEN variable '}'
                   *  | variable
                   *  | variable '[' expr ']'
                   *  | variable T_OBJECT_OPERATOR T_STRING
                   * ```
                   * @return {String|Variable|Expr|Lookup}
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L1219
                   */
                  read_encapsed_string_item: function read_encapsed_string_item(isDoubleQuote) {
                    var encapsedPart = this.node("encapsedpart");
                    var syntax = null;
                    var curly = false;
                    var result = this.node(), offset, node, name;
                    if (this.token === this.tok.T_ENCAPSED_AND_WHITESPACE) {
                      var text = this.text();
                      this.next();
                      result = result("string", false, this.version >= 703 && !this.lexer.heredoc_label.finished ? this.remove_heredoc_leading_whitespace_chars(this.resolve_special_chars(text, isDoubleQuote), this.lexer.heredoc_label.indentation, this.lexer.heredoc_label.indentation_uses_spaces, this.lexer.heredoc_label.first_encaps_node) : text, false, text);
                    } else if (this.token === this.tok.T_DOLLAR_OPEN_CURLY_BRACES) {
                      syntax = "simple";
                      curly = true;
                      if (this.next().token === this.tok.T_STRING_VARNAME) {
                        name = this.node("variable");
                        var varName = this.text();
                        this.next();
                        result.destroy();
                        if (this.token === "[") {
                          name = name(varName, false);
                          node = this.node("offsetlookup");
                          offset = this.next().read_expr();
                          this.expect("]") && this.next();
                          result = node(name, offset);
                        } else {
                          result = name(varName, false);
                        }
                      } else {
                        result = result("variable", this.read_expr(), false);
                      }
                      this.expect("}") && this.next();
                    } else if (this.token === this.tok.T_CURLY_OPEN) {
                      syntax = "complex";
                      result.destroy();
                      result = this.next().read_variable(false, false);
                      this.expect("}") && this.next();
                    } else if (this.token === this.tok.T_VARIABLE) {
                      syntax = "simple";
                      result.destroy();
                      result = this.read_simple_variable();
                      if (this.token === "[") {
                        node = this.node("offsetlookup");
                        offset = this.next().read_encaps_var_offset();
                        this.expect("]") && this.next();
                        result = node(result, offset);
                      }
                      if (this.token === this.tok.T_OBJECT_OPERATOR) {
                        node = this.node("propertylookup");
                        this.next().expect(this.tok.T_STRING);
                        var what = this.node("identifier");
                        name = this.text();
                        this.next();
                        result = node(result, what(name));
                      }
                    } else {
                      this.expect(this.tok.T_ENCAPSED_AND_WHITESPACE);
                      var value = this.text();
                      this.next();
                      result.destroy();
                      result = result("string", false, value, false, value);
                    }
                    this.lexer.heredoc_label.first_encaps_node = false;
                    return encapsedPart(result, syntax, curly);
                  },
                  /*
                   * Reads an encapsed string
                   */
                  read_encapsed_string: function read_encapsed_string(expect) {
                    var isBinary = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
                    var labelStart = this.lexer.yylloc.first_offset;
                    var node = this.node("encapsed");
                    this.next();
                    var start = this.lexer.yylloc.prev_offset - (isBinary ? 1 : 0);
                    var value = [];
                    var type;
                    if (expect === "`") {
                      type = this.ast.encapsed.TYPE_SHELL;
                    } else if (expect === '"') {
                      type = this.ast.encapsed.TYPE_STRING;
                    } else {
                      type = this.ast.encapsed.TYPE_HEREDOC;
                    }
                    while (this.token !== expect && this.token !== this.EOF) {
                      value.push(this.read_encapsed_string_item(true));
                    }
                    if (value.length > 0 && value[value.length - 1].kind === "encapsedpart" && value[value.length - 1].expression.kind === "string") {
                      var _node = value[value.length - 1].expression;
                      var lastCh = _node.value[_node.value.length - 1];
                      if (lastCh === "\n") {
                        if (_node.value[_node.value.length - 2] === "\r") {
                          _node.value = _node.value.substring(0, _node.value.length - 2);
                        } else {
                          _node.value = _node.value.substring(0, _node.value.length - 1);
                        }
                      } else if (lastCh === "\r") {
                        _node.value = _node.value.substring(0, _node.value.length - 1);
                      }
                    }
                    this.expect(expect) && this.next();
                    var raw = this.lexer._input.substring(type === "heredoc" ? labelStart : start - 1, this.lexer.yylloc.first_offset);
                    node = node(value, raw, type);
                    if (expect === this.tok.T_END_HEREDOC) {
                      node.label = this.lexer.heredoc_label.label;
                      this.lexer.heredoc_label.finished = true;
                    }
                    return node;
                  },
                  /*
                   * Constant token
                   */
                  get_magic_constant: function get_magic_constant() {
                    var result = this.node("magic");
                    var name = this.text();
                    this.next();
                    return result(name.toUpperCase(), name);
                  }
                };
              },
              /***/
              6261(module2) {
                module2.exports = {
                  /*
                   * reading a list of top statements (helper for top_statement*)
                   * ```ebnf
                   *  top_statements ::= top_statement*
                   * ```
                   */
                  read_top_statements: function read_top_statements() {
                    var result = [];
                    while (this.token !== this.EOF && this.token !== "}") {
                      var statement = this.read_top_statement();
                      if (statement) {
                        if (Array.isArray(statement)) {
                          result = result.concat(statement);
                        } else {
                          result.push(statement);
                        }
                      }
                    }
                    return result;
                  },
                  /*
                   * reading a top statement
                   * ```ebnf
                   *  top_statement ::=
                   *       namespace | function | class
                   *       | interface | trait
                   *       | use_statements | const_list
                   *       | statement
                   * ```
                   */
                  read_top_statement: function read_top_statement() {
                    var attrs = [];
                    if (this.token === this.tok.T_ATTRIBUTE) {
                      attrs = this.read_attr_list();
                    }
                    switch (this.token) {
                      case this.tok.T_FUNCTION:
                        return this.read_function(false, false, attrs);
                      // optional flags
                      case this.tok.T_ABSTRACT:
                      case this.tok.T_FINAL:
                      case this.tok.T_READ_ONLY:
                      case this.tok.T_CLASS:
                        return this.read_class_declaration_statement(attrs);
                      case this.tok.T_INTERFACE:
                        return this.read_interface_declaration_statement(attrs);
                      case this.tok.T_TRAIT:
                        return this.read_trait_declaration_statement();
                      case this.tok.T_ENUM:
                        return this.read_enum_declaration_statement(attrs);
                      case this.tok.T_USE:
                        return this.read_use_statement();
                      case this.tok.T_CONST: {
                        var result = this.node("constantstatement");
                        var items = this.next().read_const_list();
                        this.expectEndOfStatement();
                        return result(null, items);
                      }
                      case this.tok.T_NAMESPACE:
                        return this.read_namespace();
                      case this.tok.T_HALT_COMPILER: {
                        var _result = this.node("halt");
                        if (this.next().expect("(")) this.next();
                        if (this.expect(")")) this.next();
                        this.expect(";");
                        this.lexer.done = true;
                        return _result(this.lexer._input.substring(this.lexer.offset));
                      }
                      default:
                        return this.read_statement();
                    }
                  },
                  /*
                   * reads a list of simple inner statements (helper for inner_statement*)
                   * ```ebnf
                   *  inner_statements ::= inner_statement*
                   * ```
                   */
                  read_inner_statements: function read_inner_statements() {
                    var result = [];
                    while (this.token != this.EOF && this.token !== "}") {
                      var statement = this.read_inner_statement();
                      if (statement) {
                        if (Array.isArray(statement)) {
                          result = result.concat(statement);
                        } else {
                          result.push(statement);
                        }
                      }
                    }
                    return result;
                  },
                  /*
                   * Reads a list of constants declaration
                   * ```ebnf
                   *   const_list ::= T_CONST T_STRING '=' expr (',' T_STRING '=' expr)* ';'
                   * ```
                   */
                  read_const_list: function read_const_list() {
                    return this.read_list(function() {
                      this.expect(this.tok.T_STRING);
                      var result = this.node("constant");
                      var constName = this.node("identifier");
                      var name = this.text();
                      this.next();
                      constName = constName(name);
                      if (this.expect("=")) {
                        return result(constName, this.next().read_expr());
                      } else {
                        return result(constName, null);
                      }
                    }, ",", false);
                  },
                  /*
                   * Reads a list of constants declaration
                   * ```ebnf
                   *   declare_list ::= IDENTIFIER '=' expr (',' IDENTIFIER '=' expr)*
                   * ```
                   * @retrurn {Array}
                   */
                  read_declare_list: function read_declare_list() {
                    var result = [];
                    while (this.token != this.EOF && this.token !== ")") {
                      this.expect(this.tok.T_STRING);
                      var directive = this.node("declaredirective");
                      var key = this.node("identifier");
                      var name = this.text();
                      this.next();
                      key = key(name);
                      var value = null;
                      if (this.expect("=")) {
                        value = this.next().read_expr();
                      }
                      result.push(directive(key, value));
                      if (this.token !== ",") break;
                      this.next();
                    }
                    return result;
                  },
                  /*
                   * reads a simple inner statement
                   * ```ebnf
                   *  inner_statement ::= '{' inner_statements '}' | token
                   * ```
                   */
                  read_inner_statement: function read_inner_statement() {
                    var attrs = [];
                    if (this.token === this.tok.T_ATTRIBUTE) {
                      attrs = this.read_attr_list();
                    }
                    switch (this.token) {
                      case this.tok.T_FUNCTION: {
                        var result = this.read_function(false, false);
                        result.attrGroups = attrs;
                        return result;
                      }
                      // optional flags
                      case this.tok.T_ABSTRACT:
                      case this.tok.T_FINAL:
                      case this.tok.T_CLASS:
                        return this.read_class_declaration_statement();
                      case this.tok.T_INTERFACE:
                        return this.read_interface_declaration_statement();
                      case this.tok.T_TRAIT:
                        return this.read_trait_declaration_statement();
                      case this.tok.T_ENUM:
                        return this.read_enum_declaration_statement();
                      case this.tok.T_HALT_COMPILER: {
                        this.raiseError("__HALT_COMPILER() can only be used from the outermost scope");
                        var node = this.node("halt");
                        this.next().expect("(") && this.next();
                        this.expect(")") && this.next();
                        node = node(this.lexer._input.substring(this.lexer.offset));
                        this.expect(";") && this.next();
                        return node;
                      }
                      default:
                        return this.read_statement();
                    }
                  },
                  /*
                   * Reads statements
                   */
                  read_statement: function read_statement() {
                    switch (this.token) {
                      case "{":
                        return this.read_code_block(false);
                      case this.tok.T_IF:
                        return this.read_if();
                      case this.tok.T_SWITCH:
                        return this.read_switch();
                      case this.tok.T_FOR:
                        return this.read_for();
                      case this.tok.T_FOREACH:
                        return this.read_foreach();
                      case this.tok.T_WHILE:
                        return this.read_while();
                      case this.tok.T_DO:
                        return this.read_do();
                      case this.tok.T_COMMENT:
                        return this.read_comment();
                      case this.tok.T_DOC_COMMENT:
                        return this.read_doc_comment();
                      case this.tok.T_RETURN: {
                        var result = this.node("return");
                        this.next();
                        var expr = this.read_optional_expr(";");
                        this.expectEndOfStatement();
                        return result(expr);
                      }
                      // https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L429
                      case this.tok.T_BREAK:
                      case this.tok.T_CONTINUE: {
                        var _result2 = this.node(this.token === this.tok.T_CONTINUE ? "continue" : "break");
                        this.next();
                        var level = this.read_optional_expr(";");
                        this.expectEndOfStatement();
                        return _result2(level);
                      }
                      case this.tok.T_GLOBAL: {
                        var _result3 = this.node("global");
                        var items = this.next().read_list(this.read_simple_variable, ",");
                        this.expectEndOfStatement();
                        return _result3(items);
                      }
                      case this.tok.T_STATIC: {
                        var current = [this.token, this.lexer.getState()];
                        var _result4 = this.node();
                        if (this.next().token === this.tok.T_DOUBLE_COLON) {
                          this.lexer.tokens.push(current);
                          var _expr = this.next().read_expr();
                          this.expectEndOfStatement(_expr);
                          return _result4("expressionstatement", _expr);
                        }
                        if (this.token === this.tok.T_FUNCTION) {
                          return this.read_function(true, [0, 1, 0]);
                        }
                        var _items = this.read_variable_declarations();
                        this.expectEndOfStatement();
                        return _result4("static", _items);
                      }
                      case this.tok.T_ECHO: {
                        var _result5 = this.node("echo");
                        var text = this.text();
                        var shortForm = text === "<?=" || text === "<%=";
                        var expressions = this.next().read_function_list(this.read_expr, ",");
                        this.expectEndOfStatement();
                        return _result5(expressions, shortForm);
                      }
                      case this.tok.T_INLINE_HTML: {
                        var value = this.text();
                        var prevChar = this.lexer.yylloc.first_offset > 0 ? this.lexer._input[this.lexer.yylloc.first_offset - 1] : null;
                        var fixFirstLine = prevChar === "\r" || prevChar === "\n";
                        if (fixFirstLine) {
                          if (prevChar === "\n" && this.lexer.yylloc.first_offset > 1 && this.lexer._input[this.lexer.yylloc.first_offset - 2] === "\r") {
                            prevChar = "\r\n";
                          }
                        }
                        var _result6 = this.node("inline");
                        this.next();
                        return _result6(value, fixFirstLine ? prevChar + value : value);
                      }
                      case this.tok.T_UNSET: {
                        var _result7 = this.node("unset");
                        this.next().expect("(") && this.next();
                        var variables = this.read_function_list(this.read_variable, ",");
                        this.expect(")") && this.next();
                        this.expect(";") && this.next();
                        return _result7(variables);
                      }
                      case this.tok.T_DECLARE: {
                        var _result8 = this.node("declare");
                        var body = [];
                        var mode;
                        this.next().expect("(") && this.next();
                        var directives = this.read_declare_list();
                        this.expect(")") && this.next();
                        if (this.token === ":") {
                          this.next();
                          while (this.token != this.EOF && this.token !== this.tok.T_ENDDECLARE) {
                            body.push(this.read_top_statement());
                          }
                          if (body.length === 0 && this.extractDoc && this._docs.length > this._docIndex) {
                            body.push(this.node("noop")());
                          }
                          this.expect(this.tok.T_ENDDECLARE) && this.next();
                          this.expectEndOfStatement();
                          mode = this.ast.declare.MODE_SHORT;
                        } else if (this.token === "{") {
                          this.next();
                          while (this.token != this.EOF && this.token !== "}") {
                            body.push(this.read_top_statement());
                          }
                          if (body.length === 0 && this.extractDoc && this._docs.length > this._docIndex) {
                            body.push(this.node("noop")());
                          }
                          this.expect("}") && this.next();
                          mode = this.ast.declare.MODE_BLOCK;
                        } else {
                          this.expect(";") && this.next();
                          mode = this.ast.declare.MODE_NONE;
                        }
                        return _result8(directives, body, mode);
                      }
                      case this.tok.T_TRY:
                        return this.read_try();
                      case this.tok.T_THROW: {
                        var _result9 = this.node("throw");
                        var _expr2 = this.next().read_expr();
                        this.expectEndOfStatement();
                        return _result9(_expr2);
                      }
                      // ignore this (extra ponctuation)
                      case ";": {
                        this.next();
                        return null;
                      }
                      case this.tok.T_STRING: {
                        var _result0 = this.node();
                        var _current = [this.token, this.lexer.getState()];
                        var labelNameText = this.text();
                        var labelName = this.node("identifier");
                        if (this.next().token === ":") {
                          labelName = labelName(labelNameText);
                          this.next();
                          return _result0("label", labelName);
                        } else {
                          labelName.destroy();
                        }
                        _result0.destroy();
                        this.lexer.tokens.push(_current);
                        var statement = this.node("expressionstatement");
                        var _expr3 = this.next().read_expr();
                        this.expectEndOfStatement(_expr3);
                        return statement(_expr3);
                      }
                      case this.tok.T_GOTO: {
                        var _result1 = this.node("goto");
                        var _labelName = null;
                        if (this.next().expect(this.tok.T_STRING)) {
                          _labelName = this.node("identifier");
                          var name = this.text();
                          this.next();
                          _labelName = _labelName(name);
                          this.expectEndOfStatement();
                        }
                        return _result1(_labelName);
                      }
                      default: {
                        var _statement = this.node("expressionstatement");
                        var _expr4 = this.read_expr();
                        this.expectEndOfStatement(_expr4);
                        return _statement(_expr4);
                      }
                    }
                  },
                  /*
                   * ```ebnf
                   *  code_block ::= '{' (inner_statements | top_statements) '}'
                   * ```
                   */
                  read_code_block: function read_code_block(top) {
                    var result = this.node("block");
                    this.expect("{") && this.next();
                    var body = top ? this.read_top_statements() : this.read_inner_statements();
                    if (body.length === 0 && this.extractDoc && this._docs.length > this._docIndex) {
                      body.push(this.node("noop")());
                    }
                    this.expect("}") && this.next();
                    return result(null, body);
                  }
                };
              },
              /***/
              2478(module2) {
                module2.exports = {
                  /*
                   * Reads a switch statement
                   * ```ebnf
                   *  switch ::= T_SWITCH '(' expr ')' switch_case_list
                   * ```
                   * @return {Switch}
                   * @see http://php.net/manual/en/control-structures.switch.php
                   */
                  read_switch: function read_switch() {
                    var result = this.node("switch");
                    this.expect(this.tok.T_SWITCH) && this.next();
                    this.expect("(") && this.next();
                    var test = this.read_expr();
                    this.expect(")") && this.next();
                    var shortForm = this.token === ":";
                    var body = this.read_switch_case_list();
                    return result(test, body, shortForm);
                  },
                  /*
                   * ```ebnf
                   *  switch_case_list ::= '{' ';'? case_list* '}' | ':' ';'? case_list* T_ENDSWITCH ';'
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L566
                   */
                  read_switch_case_list: function read_switch_case_list() {
                    var expect = null;
                    var result = this.node("block");
                    var items = [];
                    if (this.token === "{") {
                      expect = "}";
                    } else if (this.token === ":") {
                      expect = this.tok.T_ENDSWITCH;
                    } else {
                      this.expect(["{", ":"]);
                    }
                    this.next();
                    if (this.token === ";") {
                      this.next();
                    }
                    while (this.token !== this.EOF && this.token !== expect) {
                      items.push(this.read_case_list(expect));
                    }
                    if (items.length === 0 && this.extractDoc && this._docs.length > this._docIndex) {
                      items.push(this.node("noop")());
                    }
                    this.expect(expect) && this.next();
                    if (expect === this.tok.T_ENDSWITCH) {
                      this.expectEndOfStatement();
                    }
                    return result(null, items);
                  },
                  /*
                   * ```ebnf
                   *   case_list ::= ((T_CASE expr) | T_DEFAULT) (':' | ';') inner_statement*
                   * ```
                   */
                  read_case_list: function read_case_list(stopToken) {
                    var result = this.node("case");
                    var test = null;
                    if (this.token === this.tok.T_CASE) {
                      test = this.next().read_expr();
                    } else if (this.token === this.tok.T_DEFAULT) {
                      this.next();
                    } else {
                      this.expect([this.tok.T_CASE, this.tok.T_DEFAULT]);
                    }
                    this.expect([":", ";"]) && this.next();
                    var body = this.node("block");
                    var items = [];
                    while (this.token !== this.EOF && this.token !== stopToken && this.token !== this.tok.T_CASE && this.token !== this.tok.T_DEFAULT) {
                      items.push(this.read_inner_statement());
                    }
                    return result(test, body(null, items));
                  }
                };
              },
              /***/
              77(module2) {
                module2.exports = {
                  /*
                   * ```ebnf
                   *  try ::= T_TRY '{' inner_statement* '}'
                   *          (
                   *              T_CATCH '(' namespace_name (variable)? ')' '{'  inner_statement* '}'
                   *          )*
                   *          (T_FINALLY '{' inner_statement* '}')?
                   * ```
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L448
                   * @return {Try}
                   */
                  read_try: function read_try() {
                    this.expect(this.tok.T_TRY);
                    var result = this.node("try");
                    var always = null;
                    var catches = [];
                    var body = this.next().read_statement();
                    while (this.token === this.tok.T_CATCH) {
                      var item = this.node("catch");
                      this.next().expect("(") && this.next();
                      var what = this.read_list(this.read_namespace_name, "|", false);
                      var variable = null;
                      if (this.version < 800 || this.token === this.tok.T_VARIABLE) {
                        variable = this.read_variable(true, false);
                      }
                      this.expect(")");
                      catches.push(item(this.next().read_statement(), what, variable));
                    }
                    if (this.token === this.tok.T_FINALLY) {
                      always = this.next().read_statement();
                    }
                    return result(body, catches, always);
                  }
                };
              },
              /***/
              6077(module2) {
                module2.exports = {
                  /*
                   * Reads a short form of tokens
                   * @param {Number} token - The ending token
                   * @return {Block}
                   */
                  read_short_form: function read_short_form(token) {
                    var body = this.node("block");
                    var items = [];
                    if (this.expect(":")) this.next();
                    while (this.token != this.EOF && this.token !== token) {
                      items.push(this.read_inner_statement());
                    }
                    if (items.length === 0 && this.extractDoc && this._docs.length > this._docIndex) {
                      items.push(this.node("noop")());
                    }
                    if (this.expect(token)) this.next();
                    this.expectEndOfStatement();
                    return body(null, items);
                  },
                  /*
                   * https://wiki.php.net/rfc/trailing-comma-function-calls
                   * @param {*} item
                   * @param {*} separator
                   */
                  read_function_list: function read_function_list(item, separator) {
                    var result = [];
                    do {
                      if (this.token == separator && this.version >= 703 && result.length > 0) {
                        result.push(this.node("noop")());
                        break;
                      }
                      result.push(item.apply(this, []));
                      if (this.token != separator) {
                        break;
                      }
                      if (this.next().token == ")" && this.version >= 703) {
                        break;
                      }
                    } while (this.token != this.EOF);
                    return result;
                  },
                  /*
                   * Helper : reads a list of tokens / sample : T_STRING ',' T_STRING ...
                   * ```ebnf
                   * list ::= separator? ( item separator )* item
                   * ```
                   */
                  read_list: function read_list(item, separator, preserveFirstSeparator) {
                    var result = [];
                    if (this.token == separator) {
                      if (preserveFirstSeparator) {
                        result.push(typeof item === "function" ? this.node("noop")() : null);
                      }
                      this.next();
                    }
                    if (typeof item === "function") {
                      do {
                        var itemResult = item.apply(this, []);
                        if (itemResult) {
                          result.push(itemResult);
                        }
                        if (this.token != separator) {
                          break;
                        }
                      } while (this.next().token != this.EOF);
                    } else {
                      if (this.expect(item)) {
                        result.push(this.text());
                      } else {
                        return [];
                      }
                      while (this.next().token != this.EOF) {
                        if (this.token != separator) break;
                        if (this.next().token != item) break;
                        result.push(this.text());
                      }
                    }
                    return result;
                  },
                  /*
                   * Reads a list of names separated by a comma
                   *
                   * ```ebnf
                   * name_list ::= namespace (',' namespace)*
                   * ```
                   *
                   * Sample code :
                   * ```php
                   * <?php class foo extends bar, baz { }
                   * ```
                   *
                   * @see https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L726
                   * @return {Reference[]}
                   */
                  read_name_list: function read_name_list() {
                    return this.read_list(this.read_namespace_name, ",", false);
                  },
                  /*
                   * Reads the byref token and assign it to the specified node
                   * @param {*} cb
                   */
                  read_byref: function read_byref(cb) {
                    var byref = this.node("byref");
                    this.next();
                    byref = byref(null);
                    var result = cb();
                    if (result) {
                      this.ast.swapLocations(result, byref, result, this);
                      result.byref = true;
                    }
                    return result;
                  },
                  /*
                   * Reads a list of variables declarations
                   *
                   * ```ebnf
                   * variable_declaration ::= T_VARIABLE ('=' expr)?*
                   * variable_declarations ::= variable_declaration (',' variable_declaration)*
                   * ```
                   *
                   * Sample code :
                   * ```php
                   * <?php static $a = 'hello', $b = 'world';
                   * ```
                   * @return {StaticVariable[]} Returns an array composed by a list of variables, or
                   * assign values
                   */
                  read_variable_declarations: function read_variable_declarations() {
                    return this.read_list(function() {
                      var node = this.node("staticvariable");
                      var variable = this.node("variable");
                      if (this.expect(this.tok.T_VARIABLE)) {
                        var name = this.text().substring(1);
                        this.next();
                        variable = variable(name, false);
                      } else {
                        variable = variable("#ERR", false);
                      }
                      if (this.token === "=") {
                        return node(variable, this.next().read_expr());
                      } else {
                        return variable;
                      }
                    }, ",");
                  },
                  /*
                   * Reads class extends
                   */
                  read_extends_from: function read_extends_from() {
                    if (this.token === this.tok.T_EXTENDS) {
                      return this.next().read_namespace_name();
                    }
                    return null;
                  },
                  /*
                   * Reads interface extends list
                   */
                  read_interface_extends_list: function read_interface_extends_list() {
                    if (this.token === this.tok.T_EXTENDS) {
                      return this.next().read_name_list();
                    }
                    return null;
                  },
                  /*
                   * Reads implements list
                   */
                  read_implements_list: function read_implements_list() {
                    if (this.token === this.tok.T_IMPLEMENTS) {
                      return this.next().read_name_list();
                    }
                    return null;
                  }
                };
              },
              /***/
              1130(module2) {
                module2.exports = {
                  /*
                   * Reads a variable
                   *
                   * ```ebnf
                   *   variable ::= &? ...complex @todo
                   * ```
                   *
                   * Some samples of parsed code :
                   * ```php
                   *  &$var                      // simple var
                   *  $var                      // simple var
                   *  classname::CONST_NAME     // dynamic class name with const retrieval
                   *  foo()                     // function call
                   *  $var->func()->property    // chained calls
                   * ```
                   */
                  read_variable: function read_variable(read_only, encapsed) {
                    var result;
                    if (this.token === "&") {
                      return this.read_byref(this.read_variable.bind(this, read_only, encapsed));
                    }
                    if (this.is([this.tok.T_VARIABLE, "$"])) {
                      result = this.read_reference_variable(encapsed);
                    } else if (this.is([this.tok.T_NS_SEPARATOR, this.tok.T_STRING, this.tok.T_NAME_RELATIVE, this.tok.T_NAME_QUALIFIED, this.tok.T_NAME_FULLY_QUALIFIED, this.tok.T_NAMESPACE])) {
                      result = this.node();
                      var name = this.read_namespace_name();
                      if (this.token != this.tok.T_DOUBLE_COLON && this.token != "(" && ["parentreference", "selfreference"].indexOf(name.kind) === -1) {
                        var literal = name.name.toLowerCase();
                        if (literal === "true") {
                          result = name.destroy(result("boolean", true, name.name));
                        } else if (literal === "false") {
                          result = name.destroy(result("boolean", false, name.name));
                        } else if (literal === "null") {
                          result = name.destroy(result("nullkeyword", name.name));
                        } else {
                          result.destroy(name);
                          result = name;
                        }
                      } else {
                        result.destroy(name);
                        result = name;
                      }
                    } else if (this.token === this.tok.T_STATIC) {
                      result = this.node("staticreference");
                      var raw = this.text();
                      this.next();
                      result = result(raw);
                    } else {
                      this.expect("VARIABLE");
                    }
                    if (this.token === this.tok.T_DOUBLE_COLON) {
                      result = this.read_static_getter(result, encapsed);
                    }
                    return this.recursive_variable_chain_scan(result, read_only, encapsed);
                  },
                  // resolves a static call
                  read_static_getter: function read_static_getter(what, encapsed) {
                    var result = this.node("staticlookup");
                    var offset, name;
                    if (this.next().is([this.tok.T_VARIABLE, "$"])) {
                      offset = this.read_reference_variable(encapsed);
                    } else if (this.token === this.tok.T_STRING || this.token === this.tok.T_CLASS || this.version >= 700 && this.is("IDENTIFIER")) {
                      offset = this.node("identifier");
                      name = this.text();
                      this.next();
                      offset = offset(name);
                    } else if (this.token === "{") {
                      offset = this.node("literal");
                      name = this.next().read_expr();
                      this.expect("}") && this.next();
                      offset = offset("literal", name, null);
                    } else {
                      this.error([this.tok.T_VARIABLE, this.tok.T_STRING]);
                      offset = this.node("identifier");
                      name = this.text();
                      this.next();
                      offset = offset(name);
                    }
                    return result(what, offset);
                  },
                  read_what: function read_what() {
                    var is_static_lookup = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : false;
                    var what;
                    var name;
                    switch (this.next().token) {
                      case this.tok.T_STRING:
                        what = this.node("identifier");
                        name = this.text();
                        this.next();
                        what = what(name);
                        if (is_static_lookup && this.token === this.tok.T_OBJECT_OPERATOR) {
                          this.error();
                        }
                        break;
                      case this.tok.T_VARIABLE:
                        what = this.node("variable");
                        name = this.text().substring(1);
                        this.next();
                        what = what(name, false);
                        break;
                      case this.tok.T_CLASS:
                        if (!is_static_lookup) {
                          this.error();
                        }
                        what = this.node("identifier");
                        name = this.text();
                        this.next();
                        what = what(name, false);
                        break;
                      case "$":
                        what = this.node();
                        this.next().expect(["$", "{", this.tok.T_VARIABLE]);
                        if (this.token === "{") {
                          name = this.next().read_expr();
                          this.expect("}") && this.next();
                          what = what("variable", name, true);
                        } else {
                          name = this.read_expr();
                          what = what("variable", name, false);
                        }
                        break;
                      case "{":
                        what = this.node("encapsedpart");
                        name = this.next().read_expr();
                        this.expect("}") && this.next();
                        what = what(name, "complex", false);
                        break;
                      default:
                        this.error([this.tok.T_STRING, this.tok.T_VARIABLE, "$", "{"]);
                        what = this.node("identifier");
                        name = this.text();
                        this.next();
                        what = what(name);
                        break;
                    }
                    return what;
                  },
                  recursive_variable_chain_scan: function recursive_variable_chain_scan(result, read_only, encapsed) {
                    var node, offset;
                    recursive_scan_loop: while (this.token != this.EOF) {
                      switch (this.token) {
                        case "(":
                          if (read_only) {
                            return result;
                          } else {
                            result = this.node("call")(result, this.read_argument_list());
                          }
                          break;
                        case "[":
                        case "{": {
                          var backet = this.token;
                          var isSquareBracket = backet === "[";
                          node = this.node("offsetlookup");
                          this.next();
                          offset = false;
                          if (encapsed) {
                            offset = this.read_encaps_var_offset();
                            this.expect(isSquareBracket ? "]" : "}") && this.next();
                          } else {
                            var isCallableVariable = isSquareBracket ? this.token !== "]" : this.token !== "}";
                            if (isCallableVariable) {
                              offset = this.read_expr();
                              this.expect(isSquareBracket ? "]" : "}") && this.next();
                            } else {
                              this.next();
                            }
                          }
                          result = node(result, offset);
                          break;
                        }
                        case this.tok.T_DOUBLE_COLON:
                          if (result.kind === "staticlookup" && result.offset.kind === "identifier") {
                            this.error();
                          }
                          node = this.node("staticlookup");
                          result = node(result, this.read_what(true));
                          break;
                        case this.tok.T_OBJECT_OPERATOR: {
                          node = this.node("propertylookup");
                          result = node(result, this.read_what());
                          break;
                        }
                        case this.tok.T_NULLSAFE_OBJECT_OPERATOR: {
                          node = this.node("nullsafepropertylookup");
                          result = node(result, this.read_what());
                          break;
                        }
                        default:
                          break recursive_scan_loop;
                      }
                    }
                    return result;
                  },
                  /*
                   * https://github.com/php/php-src/blob/493524454d66adde84e00d249d607ecd540de99f/Zend/zend_language_parser.y#L1231
                   */
                  read_encaps_var_offset: function read_encaps_var_offset() {
                    var offset = this.node();
                    if (this.token === this.tok.T_STRING) {
                      var text = this.text();
                      this.next();
                      offset = offset("identifier", text);
                    } else if (this.token === this.tok.T_NUM_STRING) {
                      var num = this.text();
                      this.next();
                      offset = offset("number", num, null);
                    } else if (this.token === "-") {
                      this.next();
                      var _num = -1 * this.text();
                      this.expect(this.tok.T_NUM_STRING) && this.next();
                      offset = offset("number", _num, null);
                    } else if (this.token === this.tok.T_VARIABLE) {
                      var name = this.text().substring(1);
                      this.next();
                      offset = offset("variable", name, false);
                    } else {
                      this.expect([this.tok.T_STRING, this.tok.T_NUM_STRING, "-", this.tok.T_VARIABLE]);
                      var _text = this.text();
                      this.next();
                      offset = offset("identifier", _text);
                    }
                    return offset;
                  },
                  /*
                   * ```ebnf
                   *  reference_variable ::=  simple_variable ('[' OFFSET ']')* | '{' EXPR '}'
                   * ```
                   * <code>
                   *  $foo[123];      // foo is an array ==> gets its entry
                   *  $foo{1};        // foo is a string ==> get the 2nd char offset
                   *  ${'foo'}[123];  // get the dynamic var $foo
                   *  $foo[123]{1};   // gets the 2nd char from the 123 array entry
                   * </code>
                   */
                  read_reference_variable: function read_reference_variable(encapsed) {
                    var result = this.read_simple_variable();
                    var offset;
                    while (this.token != this.EOF) {
                      var node = this.node();
                      if (this.token == "{" && !encapsed) {
                        offset = this.next().read_expr();
                        this.expect("}") && this.next();
                        result = node("offsetlookup", result, offset);
                      } else {
                        node.destroy();
                        break;
                      }
                    }
                    return result;
                  },
                  /*
                   * ```ebnf
                   *  simple_variable ::= T_VARIABLE | '$' '{' expr '}' | '$' simple_variable
                   * ```
                   */
                  read_simple_variable: function read_simple_variable() {
                    var result = this.node("variable");
                    var name;
                    if (this.expect([this.tok.T_VARIABLE, "$"]) && this.token === this.tok.T_VARIABLE) {
                      name = this.text().substring(1);
                      this.next();
                      result = result(name, false);
                    } else {
                      if (this.token === "$") this.next();
                      switch (this.token) {
                        case "{": {
                          var expr = this.next().read_expr();
                          this.expect("}") && this.next();
                          result = result(expr, true);
                          break;
                        }
                        case "$":
                          result = result(this.read_simple_variable(), false);
                          break;
                        case this.tok.T_VARIABLE: {
                          name = this.text().substring(1);
                          var node = this.node("variable");
                          this.next();
                          result = result(node(name, false), false);
                          break;
                        }
                        default:
                          this.error(["{", "$", this.tok.T_VARIABLE]);
                          name = this.text();
                          this.next();
                          result = result(name, false);
                      }
                    }
                    return result;
                  }
                };
              },
              /***/
              1906(module2) {
                function _typeof(o) {
                  "@babel/helpers - typeof";
                  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
                    return typeof o2;
                  } : function(o2) {
                    return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
                  }, _typeof(o);
                }
                function ownKeys(e, r) {
                  var t = Object.keys(e);
                  if (Object.getOwnPropertySymbols) {
                    var o = Object.getOwnPropertySymbols(e);
                    r && (o = o.filter(function(r2) {
                      return Object.getOwnPropertyDescriptor(e, r2).enumerable;
                    })), t.push.apply(t, o);
                  }
                  return t;
                }
                function _objectSpread(e) {
                  for (var r = 1; r < arguments.length; r++) {
                    var t = null != arguments[r] ? arguments[r] : {};
                    r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
                      _defineProperty(e, r2, t[r2]);
                    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
                      Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
                    });
                  }
                  return e;
                }
                function _defineProperty(e, r, t) {
                  return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e;
                }
                function _toPropertyKey(t) {
                  var i = _toPrimitive(t, "string");
                  return "symbol" == _typeof(i) ? i : i + "";
                }
                function _toPrimitive(t, r) {
                  if ("object" != _typeof(t) || !t) return t;
                  var e = t[Symbol.toPrimitive];
                  if (void 0 !== e) {
                    var i = e.call(t, r || "default");
                    if ("object" != _typeof(i)) return i;
                    throw new TypeError("@@toPrimitive must return a primitive value.");
                  }
                  return ("string" === r ? String : Number)(t);
                }
                function _slicedToArray(r, e) {
                  return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
                }
                function _nonIterableRest() {
                  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
                }
                function _unsupportedIterableToArray(r, a) {
                  if (r) {
                    if ("string" == typeof r) return _arrayLikeToArray(r, a);
                    var t = {}.toString.call(r).slice(8, -1);
                    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
                  }
                }
                function _arrayLikeToArray(r, a) {
                  (null == a || a > r.length) && (a = r.length);
                  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
                  return n;
                }
                function _iterableToArrayLimit(r, l) {
                  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
                  if (null != t) {
                    var e, n, i, u, a = [], f = true, o = false;
                    try {
                      if (i = (t = t.call(r)).next, 0 === l) {
                        if (Object(t) !== t) return;
                        f = false;
                      } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
                    } catch (r2) {
                      o = true, n = r2;
                    } finally {
                      try {
                        if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
                      } finally {
                        if (o) throw n;
                      }
                    }
                    return a;
                  }
                }
                function _arrayWithHoles(r) {
                  if (Array.isArray(r)) return r;
                }
                var TokenNames = {
                  T_HALT_COMPILER: 101,
                  T_USE: 102,
                  T_ENCAPSED_AND_WHITESPACE: 103,
                  T_OBJECT_OPERATOR: 104,
                  T_STRING: 105,
                  T_DOLLAR_OPEN_CURLY_BRACES: 106,
                  T_STRING_VARNAME: 107,
                  T_CURLY_OPEN: 108,
                  T_NUM_STRING: 109,
                  T_ISSET: 110,
                  T_EMPTY: 111,
                  T_INCLUDE: 112,
                  T_INCLUDE_ONCE: 113,
                  T_EVAL: 114,
                  T_REQUIRE: 115,
                  T_REQUIRE_ONCE: 116,
                  T_NAMESPACE: 117,
                  T_NS_SEPARATOR: 118,
                  T_AS: 119,
                  T_IF: 120,
                  T_ENDIF: 121,
                  T_WHILE: 122,
                  T_DO: 123,
                  T_FOR: 124,
                  T_SWITCH: 125,
                  T_BREAK: 126,
                  T_CONTINUE: 127,
                  T_RETURN: 128,
                  T_GLOBAL: 129,
                  T_STATIC: 130,
                  T_ECHO: 131,
                  T_INLINE_HTML: 132,
                  T_UNSET: 133,
                  T_FOREACH: 134,
                  T_DECLARE: 135,
                  T_TRY: 136,
                  T_THROW: 137,
                  T_GOTO: 138,
                  T_FINALLY: 139,
                  T_CATCH: 140,
                  T_ENDDECLARE: 141,
                  T_LIST: 142,
                  T_CLONE: 143,
                  T_PLUS_EQUAL: 144,
                  T_MINUS_EQUAL: 145,
                  T_MUL_EQUAL: 146,
                  T_DIV_EQUAL: 147,
                  T_CONCAT_EQUAL: 148,
                  T_MOD_EQUAL: 149,
                  T_AND_EQUAL: 150,
                  T_OR_EQUAL: 151,
                  T_XOR_EQUAL: 152,
                  T_SL_EQUAL: 153,
                  T_SR_EQUAL: 154,
                  T_INC: 155,
                  T_DEC: 156,
                  T_BOOLEAN_OR: 157,
                  T_BOOLEAN_AND: 158,
                  T_LOGICAL_OR: 159,
                  T_LOGICAL_AND: 160,
                  T_LOGICAL_XOR: 161,
                  T_SL: 162,
                  T_SR: 163,
                  T_IS_IDENTICAL: 164,
                  T_IS_NOT_IDENTICAL: 165,
                  T_IS_EQUAL: 166,
                  T_IS_NOT_EQUAL: 167,
                  T_IS_SMALLER_OR_EQUAL: 168,
                  T_IS_GREATER_OR_EQUAL: 169,
                  T_INSTANCEOF: 170,
                  T_INT_CAST: 171,
                  T_DOUBLE_CAST: 172,
                  T_STRING_CAST: 173,
                  T_ARRAY_CAST: 174,
                  T_OBJECT_CAST: 175,
                  T_BOOL_CAST: 176,
                  T_UNSET_CAST: 177,
                  T_EXIT: 178,
                  T_PRINT: 179,
                  T_YIELD: 180,
                  T_YIELD_FROM: 181,
                  T_FUNCTION: 182,
                  T_DOUBLE_ARROW: 183,
                  T_DOUBLE_COLON: 184,
                  T_ARRAY: 185,
                  T_CALLABLE: 186,
                  T_CLASS: 187,
                  T_ABSTRACT: 188,
                  T_TRAIT: 189,
                  T_FINAL: 190,
                  T_EXTENDS: 191,
                  T_INTERFACE: 192,
                  T_IMPLEMENTS: 193,
                  T_VAR: 194,
                  T_PUBLIC: 195,
                  T_PROTECTED: 196,
                  T_PRIVATE: 197,
                  T_CONST: 198,
                  T_NEW: 199,
                  T_INSTEADOF: 200,
                  T_ELSEIF: 201,
                  T_ELSE: 202,
                  T_ENDSWITCH: 203,
                  T_CASE: 204,
                  T_DEFAULT: 205,
                  T_ENDFOR: 206,
                  T_ENDFOREACH: 207,
                  T_ENDWHILE: 208,
                  T_CONSTANT_ENCAPSED_STRING: 209,
                  T_LNUMBER: 210,
                  T_DNUMBER: 211,
                  T_LINE: 212,
                  T_FILE: 213,
                  T_DIR: 214,
                  T_TRAIT_C: 215,
                  T_METHOD_C: 216,
                  T_FUNC_C: 217,
                  T_NS_C: 218,
                  T_START_HEREDOC: 219,
                  T_END_HEREDOC: 220,
                  T_CLASS_C: 221,
                  T_VARIABLE: 222,
                  T_OPEN_TAG: 223,
                  T_OPEN_TAG_WITH_ECHO: 224,
                  T_CLOSE_TAG: 225,
                  T_WHITESPACE: 226,
                  T_COMMENT: 227,
                  T_DOC_COMMENT: 228,
                  T_ELLIPSIS: 229,
                  T_COALESCE: 230,
                  T_POW: 231,
                  T_POW_EQUAL: 232,
                  T_SPACESHIP: 233,
                  T_COALESCE_EQUAL: 234,
                  T_FN: 235,
                  T_NULLSAFE_OBJECT_OPERATOR: 236,
                  T_MATCH: 237,
                  T_ATTRIBUTE: 238,
                  T_ENUM: 239,
                  T_READ_ONLY: 240,
                  T_NAME_RELATIVE: 241,
                  T_NAME_QUALIFIED: 242,
                  T_NAME_FULLY_QUALIFIED: 243,
                  T_PIPE: 244
                };
                var tokens = {
                  values: Object.entries(TokenNames).reduce(function(result, _ref) {
                    var _ref2 = _slicedToArray(_ref, 2), key = _ref2[0], value = _ref2[1];
                    return _objectSpread(_objectSpread({}, result), {}, _defineProperty({}, value, key));
                  }, {}),
                  names: TokenNames
                };
                module2.exports = Object.freeze(tokens);
              }
              /******/
            };
            var __webpack_module_cache__ = {};
            function __webpack_require__(moduleId) {
              var cachedModule = __webpack_module_cache__[moduleId];
              if (cachedModule !== void 0) {
                return cachedModule.exports;
              }
              var module2 = __webpack_module_cache__[moduleId] = {
                /******/
                // no module.id needed
                /******/
                // no module.loaded needed
                /******/
                exports: {}
                /******/
              };
              __webpack_modules__[moduleId](module2, module2.exports, __webpack_require__);
              return module2.exports;
            }
            var __webpack_exports__ = __webpack_require__(5362);
            __webpack_exports__ = __webpack_exports__["default"];
            return __webpack_exports__;
          })()
        );
      });
    }
  });

  // src/workers/php-worker.ts
  var php_worker_exports = {};
  __export(php_worker_exports, {
    PhpWorker: () => PhpWorker
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

  // src/workers/php-worker.ts
  var import_php_parser = __toESM(require_php_parser());
  var PhpWorker = class extends Mirror {
    constructor(sender) {
      super(sender);
      this.inlinePhp = false;
      this.setTimeout(500);
      this.parser = new import_php_parser.Engine({
        parser: {
          extractDoc: false,
          suppressErrors: true
        },
        ast: {
          withPositions: false,
          withSource: false
        },
        lexer: {
          all_tokens: false,
          comment_tokens: false,
          mode_eval: false,
          asp_tags: false,
          short_tags: true
        }
      });
    }
    setOptions(opts) {
      this.inlinePhp = opts && opts.inline;
    }
    onUpdate() {
      var value = this.doc.getValue();
      var errors = [];
      try {
        let result;
        if (this.inlinePhp) {
          result = this.parser.parseEval(value);
        } else {
          result = this.parser.parseCode(value, "foo.php");
        }
        if (result && result.errors) {
          errors = result.errors.map((el) => {
            return {
              row: el.line - 1,
              column: null,
              text: el.message,
              type: "error"
            };
          });
        }
      } catch (e) {
        console.error(e);
      }
      this.sender.emit("annotate", errors);
    }
  };
  return __toCommonJS(php_worker_exports);
})();
/*! Bundled license information:

php-parser/dist/php-parser.js:
  (*!
   * 
   *   Package: php-parser
   *   Parse PHP code from JS and returns its AST
   *   Build: 8ca15bdec2f54ee92ab1 - 2/21/2026
   *   Copyright (C) 2021 Glayzzle (BSD-3-Clause)
   *   @authors https://github.com/glayzzle/php-parser/graphs/contributors
   *   @url http://glayzzle.com
   *
   *)
*/
aceLegacyWorkerModule = aceLegacyWorkerModule.default || aceLegacyWorkerModule;

exports.PhpWorker = aceLegacyWorkerModule.PhpWorker;
});
