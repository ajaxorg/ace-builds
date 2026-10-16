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

ace.define("ace/mode/html_worker", [], function(require, exports, module) {
"use strict";
var define = undefined;
var aceLegacyWorkerModule;
var aceLegacyWorkerModule = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
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

  // ../../node_modules/htmlhint/dist/core/htmlparser.js
  var require_htmlparser = __commonJS({
    "../../node_modules/htmlhint/dist/core/htmlparser.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var HTMLParser = class {
        constructor() {
          this._listeners = {};
          this._mapCdataTags = this.makeMap("script,style");
          this._arrBlocks = [];
          this.lastEvent = null;
        }
        makeMap(str) {
          const obj = {};
          const items = str.split(",");
          for (let i = 0; i < items.length; i++) {
            obj[items[i]] = true;
          }
          return obj;
        }
        parse(html) {
          const mapCdataTags = this._mapCdataTags;
          const regTag = /<(?:\/([^\s>]+)\s*|!--([\s\S]*?)--|!([^>]*?)|([\w\-:]+)((?:\s+[^\s"'>\/=\x00-\x0F\x7F\x80-\x9F]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]*))?)*?)\s*(\/?))>/g;
          const regAttr = /\s*([^\s"'>\/=\x00-\x0F\x7F\x80-\x9F]+)(?:\s*=\s*(?:(")([^"]*)"|(')([^']*)'|([^\s"'>]*)))?/g;
          const regLine = /\r?\n/g;
          let match;
          let matchIndex;
          let lastIndex = 0;
          let tagName;
          let arrAttrs;
          let tagCDATA = null;
          let attrsCDATA;
          let arrCDATA = [];
          let lastCDATAIndex = 0;
          let text;
          let lastLineIndex = 0;
          let line = 1;
          const arrBlocks = this._arrBlocks;
          this.fire("start", {
            pos: 0,
            line: 1,
            col: 1
          });
          const isMapCdataTagsRequired = () => {
            const attrType = arrAttrs.find((attr) => attr.name === "type") || {
              value: ""
            };
            return mapCdataTags[tagName] && attrType.value.indexOf("text/ng-template") === -1;
          };
          const saveBlock = (type, raw, pos, data) => {
            const col = pos - lastLineIndex + 1;
            if (data === void 0) {
              data = {};
            }
            data.raw = raw;
            data.pos = pos;
            data.line = line;
            data.col = col;
            arrBlocks.push(data);
            this.fire(type, data);
            while (regLine.exec(raw)) {
              line++;
              lastLineIndex = pos + regLine.lastIndex;
            }
          };
          while (match = regTag.exec(html)) {
            matchIndex = match.index;
            if (matchIndex > lastIndex) {
              text = html.substring(lastIndex, matchIndex);
              if (tagCDATA) {
                arrCDATA.push(text);
              } else {
                saveBlock("text", text, lastIndex);
              }
            }
            lastIndex = regTag.lastIndex;
            if (tagName = match[1]) {
              if (tagCDATA && tagName === tagCDATA) {
                text = arrCDATA.join("");
                saveBlock("cdata", text, lastCDATAIndex, {
                  tagName: tagCDATA,
                  attrs: attrsCDATA
                });
                tagCDATA = null;
                attrsCDATA = void 0;
                arrCDATA = [];
              }
              if (!tagCDATA) {
                saveBlock("tagend", match[0], matchIndex, {
                  tagName
                });
                continue;
              }
            }
            if (tagCDATA) {
              arrCDATA.push(match[0]);
            } else {
              if (tagName = match[4]) {
                arrAttrs = [];
                const attrs = match[5];
                let attrMatch;
                let attrMatchCount = 0;
                while (attrMatch = regAttr.exec(attrs)) {
                  const name = attrMatch[1];
                  const quote = attrMatch[2] ? attrMatch[2] : attrMatch[4] ? attrMatch[4] : "";
                  const value = attrMatch[3] ? attrMatch[3] : attrMatch[5] ? attrMatch[5] : attrMatch[6] ? attrMatch[6] : "";
                  arrAttrs.push({
                    name,
                    value,
                    quote,
                    index: attrMatch.index,
                    raw: attrMatch[0]
                  });
                  attrMatchCount += attrMatch[0].length;
                }
                if (attrMatchCount === attrs.length) {
                  saveBlock("tagstart", match[0], matchIndex, {
                    tagName,
                    attrs: arrAttrs,
                    close: match[6]
                  });
                  if (isMapCdataTagsRequired()) {
                    tagCDATA = tagName;
                    attrsCDATA = arrAttrs.concat();
                    arrCDATA = [];
                    lastCDATAIndex = lastIndex;
                  }
                } else {
                  saveBlock("text", match[0], matchIndex);
                }
              } else if (match[2] || match[3]) {
                saveBlock("comment", match[0], matchIndex, {
                  content: match[2] || match[3],
                  long: match[2] ? true : false
                });
              }
            }
          }
          if (html.length > lastIndex) {
            text = html.substring(lastIndex, html.length);
            saveBlock("text", text, lastIndex);
          }
          this.fire("end", {
            pos: lastIndex,
            line,
            col: html.length - lastLineIndex + 1
          });
        }
        addListener(types, listener) {
          const _listeners = this._listeners;
          const arrTypes = types.split(/[,\s]/);
          let type;
          for (let i = 0, l = arrTypes.length; i < l; i++) {
            type = arrTypes[i];
            if (_listeners[type] === void 0) {
              _listeners[type] = [];
            }
            _listeners[type].push(listener);
          }
        }
        fire(type, data) {
          if (data === void 0) {
            data = {};
          }
          data.type = type;
          let listeners = [];
          const listenersType = this._listeners[type];
          const listenersAll = this._listeners["all"];
          if (listenersType !== void 0) {
            listeners = listeners.concat(listenersType);
          }
          if (listenersAll !== void 0) {
            listeners = listeners.concat(listenersAll);
          }
          const lastEvent = this.lastEvent;
          if (lastEvent !== null) {
            delete lastEvent["lastEvent"];
            data.lastEvent = lastEvent;
          }
          this.lastEvent = data;
          for (let i = 0, l = listeners.length; i < l; i++) {
            listeners[i].call(this, data);
          }
        }
        removeListener(type, listener) {
          const listenersType = this._listeners[type];
          if (listenersType !== void 0) {
            for (let i = 0, l = listenersType.length; i < l; i++) {
              if (listenersType[i] === listener) {
                listenersType.splice(i, 1);
                break;
              }
            }
          }
        }
        fixPos(event, index) {
          const text = event.raw.substr(0, index);
          const arrLines = text.split(/\r?\n/);
          const lineCount = arrLines.length - 1;
          let line = event.line;
          let col;
          if (lineCount > 0) {
            line += lineCount;
            col = arrLines[lineCount].length + 1;
          } else {
            col = event.col + index;
          }
          return {
            line,
            col
          };
        }
        getMapAttrs(arrAttrs) {
          const mapAttrs = {};
          let attr;
          for (let i = 0, l = arrAttrs.length; i < l; i++) {
            attr = arrAttrs[i];
            mapAttrs[attr.name] = attr.value;
          }
          return mapAttrs;
        }
      };
      exports.default = HTMLParser;
    }
  });

  // ../../node_modules/htmlhint/dist/core/reporter.js
  var require_reporter = __commonJS({
    "../../node_modules/htmlhint/dist/core/reporter.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var Reporter = class {
        constructor(html, ruleset, disabledRulesMap = {}) {
          this.html = html;
          this.lines = html.split(/\r?\n/);
          const match = /\r?\n/.exec(html);
          this.brLen = match !== null ? match[0].length : 0;
          this.ruleset = ruleset;
          this.messages = [];
          this.disabledRulesMap = disabledRulesMap;
        }
        info(message, line, col, rule, raw) {
          this.report("info", message, line, col, rule, raw);
        }
        warn(message, line, col, rule, raw) {
          this.report("warning", message, line, col, rule, raw);
        }
        error(message, line, col, rule, raw) {
          this.report("error", message, line, col, rule, raw);
        }
        report(type, message, line, col, rule, raw) {
          const lineDisabled = this.disabledRulesMap[line];
          if (lineDisabled) {
            if (lineDisabled.all === true) {
              return;
            }
            if (lineDisabled.rules && lineDisabled.rules.has(rule.id)) {
              return;
            }
          }
          const lines = this.lines;
          const brLen = this.brLen;
          let evidence = "";
          let evidenceLen = 0;
          for (let i = line - 1, lineCount = lines.length; i < lineCount; i++) {
            evidence = lines[i];
            evidenceLen = evidence.length;
            if (col > evidenceLen && line < lineCount) {
              line++;
              col -= evidenceLen;
              if (col !== 1) {
                col -= brLen;
              }
            } else {
              break;
            }
          }
          this.messages.push({
            type,
            message,
            raw,
            evidence,
            line,
            col,
            rule: {
              id: rule.id,
              description: rule.description,
              link: `https://htmlhint.com/rules/${rule.id}`
            }
          });
        }
      };
      exports.default = Reporter;
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/alt-require.js
  var require_alt_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/alt-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "alt-require",
        description: "The alt attribute of an <img> element must be present and alt attribute of area[href] and input[type=image] must have a value.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName.toLowerCase();
            const mapAttrs = parser.getMapAttrs(event.attrs);
            const col = event.col + tagName.length + 1;
            let selector;
            if (tagName === "img" && !("alt" in mapAttrs)) {
              reporter.warn("An alt attribute must be present on <img> elements.", event.line, col, this, event.raw);
            } else if (tagName === "area" && "href" in mapAttrs || tagName === "input" && mapAttrs["type"] === "image") {
              if (!("alt" in mapAttrs) || mapAttrs["alt"] === "") {
                selector = tagName === "area" ? "area[href]" : "input[type=image]";
                reporter.warn(`The alt attribute of ${selector} must have a value.`, event.line, col, this, event.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-lowercase.js
  var require_attr_lowercase = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-lowercase.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var svgIgnores = [
        "allowReorder",
        "attributeName",
        "attributeType",
        "autoReverse",
        "baseFrequency",
        "baseProfile",
        "calcMode",
        "clipPath",
        "clipPathUnits",
        "contentScriptType",
        "contentStyleType",
        "diffuseConstant",
        "edgeMode",
        "externalResourcesRequired",
        "filterRes",
        "filterUnits",
        "glyphRef",
        "gradientTransform",
        "gradientUnits",
        "kernelMatrix",
        "kernelUnitLength",
        "keyPoints",
        "keySplines",
        "keyTimes",
        "lengthAdjust",
        "limitingConeAngle",
        "markerHeight",
        "markerUnits",
        "markerWidth",
        "maskContentUnits",
        "maskUnits",
        "numOctaves",
        "onBlur",
        "onChange",
        "onClick",
        "onFocus",
        "onKeyUp",
        "onLoad",
        "pathLength",
        "patternContentUnits",
        "patternTransform",
        "patternUnits",
        "pointsAtX",
        "pointsAtY",
        "pointsAtZ",
        "preserveAlpha",
        "preserveAspectRatio",
        "primitiveUnits",
        "refX",
        "refY",
        "repeatCount",
        "repeatDur",
        "requiredExtensions",
        "requiredFeatures",
        "specularConstant",
        "specularExponent",
        "spreadMethod",
        "startOffset",
        "stdDeviation",
        "stitchTiles",
        "surfaceScale",
        "systemLanguage",
        "tableValues",
        "targetX",
        "targetY",
        "textLength",
        "viewBox",
        "viewTarget",
        "xChannelSelector",
        "yChannelSelector",
        "zoomAndPan"
      ];
      function testAgainstStringOrRegExp(value, comparison) {
        if (comparison instanceof RegExp) {
          return comparison.test(value) ? { match: value, pattern: comparison } : false;
        }
        const firstComparisonChar = comparison[0];
        const lastComparisonChar = comparison[comparison.length - 1];
        const secondToLastComparisonChar = comparison[comparison.length - 2];
        const comparisonIsRegex = firstComparisonChar === "/" && (lastComparisonChar === "/" || secondToLastComparisonChar === "/" && lastComparisonChar === "i");
        const hasCaseInsensitiveFlag = comparisonIsRegex && lastComparisonChar === "i";
        if (comparisonIsRegex) {
          const valueMatches = hasCaseInsensitiveFlag ? new RegExp(comparison.slice(1, -2), "i").test(value) : new RegExp(comparison.slice(1, -1)).test(value);
          return valueMatches;
        }
        return value === comparison;
      }
      exports.default = {
        id: "attr-lowercase",
        description: "All attribute names must be in lowercase.",
        init(parser, reporter, options) {
          const exceptions = (Array.isArray(options) ? options : []).concat(svgIgnores);
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              const attrName = attr.name;
              if (!exceptions.find((exp) => testAgainstStringOrRegExp(attrName, exp)) && attrName !== attrName.toLowerCase()) {
                reporter.error(`The attribute name of [ ${attrName} ] must be in lowercase.`, event.line, col + attr.index, this, attr.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-no-duplication.js
  var require_attr_no_duplication = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-no-duplication.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-no-duplication",
        description: "Elements cannot have duplicate attributes.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            let attrName;
            const col = event.col + event.tagName.length + 1;
            const mapAttrName = {};
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              attrName = attr.name;
              if (mapAttrName[attrName] === true) {
                reporter.error(`Duplicate of attribute name [ ${attr.name} ] was found.`, event.line, col + attr.index, this, attr.raw);
              }
              mapAttrName[attrName] = true;
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-no-unnecessary-whitespace.js
  var require_attr_no_unnecessary_whitespace = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-no-unnecessary-whitespace.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-no-unnecessary-whitespace",
        description: "No spaces between attribute names and values.",
        init(parser, reporter, options) {
          const exceptions = Array.isArray(options) ? options : [];
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0; i < attrs.length; i++) {
              if (exceptions.indexOf(attrs[i].name) === -1) {
                const match = /(\s*)=(\s*)/.exec(attrs[i].raw.trim());
                if (match && (match[1].length !== 0 || match[2].length !== 0)) {
                  reporter.error(`The attribute '${attrs[i].name}' must not have spaces between the name and value.`, event.line, col + attrs[i].index, this, attrs[i].raw);
                }
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-value-no-duplication.js
  var require_attr_value_no_duplication = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-value-no-duplication.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-value-no-duplication",
        description: "Class attributes should not contain duplicate values. Other attributes can be checked via configuration.",
        init(parser, reporter, options) {
          const defaultAttributesToCheck = ["class"];
          const attributesToCheck = Array.isArray(options) ? options : defaultAttributesToCheck;
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              const attrName = attr.name.toLowerCase();
              if (!attributesToCheck.includes(attrName)) {
                continue;
              }
              if (!attr.value || !/\s/.test(attr.value)) {
                continue;
              }
              const values = attr.value.trim().split(/\s+/);
              const duplicateMap = {};
              for (const value of values) {
                if (value && duplicateMap[value] === true) {
                  reporter.error(`Duplicate value [ ${value} ] was found in attribute [ ${attr.name} ].`, event.line, col + attr.index, this, attr.raw);
                  break;
                }
                duplicateMap[value] = true;
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-sorted.js
  var require_attr_sorted = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-sorted.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-sorted",
        description: "Attribute tags must be in proper order.",
        init(parser, reporter) {
          const orderMap = {};
          const sortOrder = [
            "class",
            "id",
            "name",
            "src",
            "for",
            "type",
            "rel",
            "href",
            "value",
            "title",
            "alt",
            "role"
          ];
          for (let i = 0; i < sortOrder.length; i++) {
            orderMap[sortOrder[i]] = i;
          }
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            const listOfAttributes = [];
            for (let i = 0; i < attrs.length; i++) {
              listOfAttributes.push(attrs[i].name);
            }
            const originalAttrs = JSON.stringify(listOfAttributes);
            listOfAttributes.sort((a, b) => {
              if (orderMap[a] !== void 0) {
                if (orderMap[b] !== void 0) {
                  return orderMap[a] - orderMap[b];
                }
                return -1;
              }
              if (a.startsWith("data-")) {
                if (b.startsWith("data-")) {
                  return a.localeCompare(b);
                }
                return 1;
              }
              if (orderMap[b] !== void 0) {
                return 1;
              }
              if (b.startsWith("data-")) {
                return -1;
              }
              return a.localeCompare(b);
            });
            if (originalAttrs !== JSON.stringify(listOfAttributes)) {
              reporter.error(`Inaccurate order ${originalAttrs} should be in hierarchy ${JSON.stringify(listOfAttributes)} `, event.line, event.col, this, event.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-unsafe-chars.js
  var require_attr_unsafe_chars = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-unsafe-chars.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-unsafe-chars",
        description: "Attribute values cannot contain unsafe chars.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            const regUnsafe = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/;
            let match;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              match = regUnsafe.exec(attr.value);
              if (match !== null) {
                const unsafeCode = escape(match[0]).replace(/%u/, "\\u").replace(/%/, "\\x");
                reporter.warn(`The value of attribute [ ${attr.name} ] cannot contain an unsafe char [ ${unsafeCode} ].`, event.line, col + attr.index, this, attr.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-value-double-quotes.js
  var require_attr_value_double_quotes = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-value-double-quotes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-value-double-quotes",
        description: "Attribute values must be in double quotes.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              if (attr.value !== "" && attr.quote !== '"' || attr.value === "" && attr.quote === "'") {
                reporter.error(`The value of attribute [ ${attr.name} ] must be in double quotes.`, event.line, col + attr.index, this, attr.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-value-not-empty.js
  var require_attr_value_not_empty = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-value-not-empty.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-value-not-empty",
        description: "All attributes must have values.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              if (attr.quote === "" && attr.value === "") {
                reporter.warn(`The attribute [ ${attr.name} ] must have a value.`, event.line, col + attr.index, this, attr.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-value-single-quotes.js
  var require_attr_value_single_quotes = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-value-single-quotes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-value-single-quotes",
        description: "Attribute values must be in single quotes.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              if (attr.value !== "" && attr.quote !== "'" || attr.value === "" && attr.quote === '"') {
                reporter.error(`The value of attribute [ ${attr.name} ] must be in single quotes.`, event.line, col + attr.index, this, attr.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/attr-whitespace.js
  var require_attr_whitespace = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/attr-whitespace.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "attr-whitespace",
        description: "All attributes should be separated by only one space and not have leading/trailing whitespace.",
        init(parser, reporter, options) {
          const exceptions = Array.isArray(options) ? options : [];
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            attrs.forEach((elem) => {
              attr = elem;
              const attrName = elem.name;
              if (exceptions.indexOf(attrName) !== -1) {
                return;
              }
              if (elem.value.trim() !== elem.value) {
                reporter.error(`The attributes of [ ${attrName} ] must not have leading or trailing whitespace.`, event.line, col + attr.index, this, attr.raw);
              }
              if (elem.value.replace(/ +(?= )/g, "") !== elem.value) {
                reporter.error(`The attributes of [ ${attrName} ] must be separated by only one space.`, event.line, col + attr.index, this, attr.raw);
              }
            });
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/button-type-require.js
  var require_button_type_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/button-type-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "button-type-require",
        description: 'The type attribute of a <button> element must be present with a valid value: "button", "submit", or "reset".',
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "button") {
              const mapAttrs = parser.getMapAttrs(event.attrs);
              const col = event.col + tagName.length + 1;
              if (mapAttrs.type === void 0) {
                reporter.warn("The type attribute must be present on <button> elements.", event.line, col, this, event.raw);
              } else {
                const typeValue = mapAttrs.type.toLowerCase();
                if (typeValue !== "button" && typeValue !== "submit" && typeValue !== "reset") {
                  reporter.warn('The type attribute of <button> must have a valid value: "button", "submit", or "reset".', event.line, col, this, event.raw);
                }
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/doctype-first.js
  var require_doctype_first = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/doctype-first.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "doctype-first",
        description: "Doctype must be declared first (comments and whitespace allowed before DOCTYPE).",
        init(parser, reporter) {
          let doctypeFound = false;
          let nonCommentContentBeforeDoctype = false;
          const allEvent = (event) => {
            if (event.type === "start" || event.type === "text" && /^\s*$/.test(event.raw)) {
              return;
            }
            if (doctypeFound) {
              return;
            }
            if (event.type === "comment" && event.long === false && /^DOCTYPE\s+/i.test(event.content)) {
              doctypeFound = true;
              if (nonCommentContentBeforeDoctype) {
                reporter.error("Doctype must be declared before any non-comment content.", event.line, event.col, this, event.raw);
              }
              return;
            }
            if (event.type === "comment") {
              return;
            }
            nonCommentContentBeforeDoctype = true;
            reporter.error("Doctype must be declared before any non-comment content.", event.line, event.col, this, event.raw);
            parser.removeListener("all", allEvent);
          };
          parser.addListener("all", allEvent);
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/doctype-html5.js
  var require_doctype_html5 = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/doctype-html5.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "doctype-html5",
        description: 'Invalid doctype. Use: "<!DOCTYPE html>"',
        init(parser, reporter) {
          const onComment = (event) => {
            if (event.long === false && event.content.toLowerCase() !== "doctype html") {
              reporter.warn('Invalid doctype. Use: "<!DOCTYPE html>"', event.line, event.col, this, event.raw);
            }
          };
          const onTagStart = () => {
            parser.removeListener("comment", onComment);
            parser.removeListener("tagstart", onTagStart);
          };
          parser.addListener("all", onComment);
          parser.addListener("tagstart", onTagStart);
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/empty-tag-not-self-closed.js
  var require_empty_tag_not_self_closed = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/empty-tag-not-self-closed.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "empty-tag-not-self-closed",
        description: "Empty tags must not use self closed syntax.",
        init(parser, reporter) {
          const mapEmptyTags = parser.makeMap("area,base,basefont,bgsound,br,col,frame,hr,img,input,isindex,link,meta,param,embed,track,command,source,keygen,wbr");
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName.toLowerCase();
            if (mapEmptyTags[tagName] !== void 0) {
              if (event.close) {
                reporter.error(`The empty tag : [ ${tagName} ] must not use self closed syntax.`, event.line, event.col, this, event.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/form-method-require.js
  var require_form_method_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/form-method-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "form-method-require",
        description: 'The method attribute of a <form> element must be present with a valid value: "get", "post", or "dialog".',
        init(parser, reporter) {
          const onTagStart = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "form") {
              const mapAttrs = parser.getMapAttrs(event.attrs);
              const col = event.col + tagName.length + 1;
              if (mapAttrs.method === void 0) {
                reporter.warn("The method attribute must be present on <form> elements.", event.line, col, this, event.raw);
              } else {
                const methodValue = mapAttrs.method.toLowerCase();
                if (methodValue !== "get" && methodValue !== "post" && methodValue !== "dialog") {
                  reporter.warn('The method attribute of <form> must have a valid value: "get", "post", or "dialog".', event.line, col, this, event.raw);
                }
              }
            }
          };
          parser.addListener("tagstart", onTagStart);
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/frame-title-require.js
  var require_frame_title_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/frame-title-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "frame-title-require",
        description: "A <frame> or <iframe> element must have an accessible name.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName.toLowerCase();
            const mapAttrs = parser.getMapAttrs(event.attrs);
            const col = event.col + tagName.length + 1;
            if (tagName === "frame" || tagName === "iframe") {
              const role = mapAttrs["role"];
              if (role === "presentation" || role === "none") {
                return;
              }
              const hasAriaLabel = "aria-label" in mapAttrs && mapAttrs["aria-label"].trim() !== "";
              const hasAriaLabelledby = "aria-labelledby" in mapAttrs && mapAttrs["aria-labelledby"].trim() !== "";
              const hasTitle = "title" in mapAttrs && mapAttrs["title"].trim() !== "";
              if (!hasAriaLabel && !hasAriaLabelledby && !hasTitle) {
                reporter.warn(`A <${tagName}> element must have an accessible name.`, event.line, col, this, event.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/h1-require.js
  var require_h1_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/h1-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "h1-require",
        description: "<h1> must be present in <body> tag and not be empty.",
        init(parser, reporter) {
          let bodyDepth = 0;
          let hasH1InBody = false;
          let bodyTagEvent = null;
          let currentH1Event = null;
          let h1IsEmpty = false;
          const onTagStart = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "body") {
              bodyDepth++;
              if (bodyDepth === 1) {
                hasH1InBody = false;
                bodyTagEvent = event;
              }
            } else if (tagName === "h1" && bodyDepth > 0) {
              hasH1InBody = true;
              currentH1Event = event;
              h1IsEmpty = true;
            }
          };
          const onText = (event) => {
            if (currentH1Event && h1IsEmpty) {
              if (event.raw && !/^\s*$/.test(event.raw)) {
                h1IsEmpty = false;
              }
            }
          };
          const onTagEnd = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "h1" && currentH1Event) {
              if (h1IsEmpty) {
                reporter.warn("<h1> tag must not be empty.", currentH1Event.line, currentH1Event.col, this, currentH1Event.raw);
              }
              currentH1Event = null;
            } else if (tagName === "body") {
              if (bodyDepth === 1 && !hasH1InBody && bodyTagEvent) {
                reporter.warn("<h1> must be present in <body> tag.", bodyTagEvent.line, bodyTagEvent.col, this, bodyTagEvent.raw);
              }
              bodyDepth--;
              if (bodyDepth < 0)
                bodyDepth = 0;
            }
          };
          parser.addListener("tagstart", onTagStart);
          parser.addListener("tagend", onTagEnd);
          parser.addListener("text", onText);
          parser.addListener("end", () => {
            if (bodyDepth > 0 && !hasH1InBody && bodyTagEvent) {
              reporter.warn("<h1> must be present in <body> tag.", bodyTagEvent.line, bodyTagEvent.col, this, bodyTagEvent.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/head-script-disabled.js
  var require_head_script_disabled = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/head-script-disabled.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "head-script-disabled",
        description: "The <script> tag cannot be used in a <head> tag.",
        init(parser, reporter, options) {
          const reScript = /^(text\/javascript|application\/javascript)$/i;
          let isInHead = false;
          const onTagStart = (event) => {
            const mapAttrs = parser.getMapAttrs(event.attrs);
            const type = mapAttrs.type;
            const defer = mapAttrs.defer;
            const tagName = event.tagName.toLowerCase();
            if (tagName === "head") {
              isInHead = true;
            }
            if (isInHead === true && tagName === "script") {
              const isModule = type === "module";
              const isDeferred = defer !== void 0;
              const isAsync = mapAttrs.async !== void 0;
              const isExecutableScript = !type || reScript.test(type) === true || isModule;
              if (isExecutableScript) {
                if (options === "allow-non-blocking") {
                  if (!isModule && !isDeferred && !isAsync) {
                    reporter.warn('The <script> tag cannot be used in a <head> tag unless it has type="module", defer, or async attribute.', event.line, event.col, this, event.raw);
                  }
                } else {
                  reporter.warn("The <script> tag cannot be used in a <head> tag.", event.line, event.col, this, event.raw);
                }
              }
            }
          };
          const onTagEnd = (event) => {
            if (event.tagName.toLowerCase() === "head") {
              parser.removeListener("tagstart", onTagStart);
              parser.removeListener("tagend", onTagEnd);
            }
          };
          parser.addListener("tagstart", onTagStart);
          parser.addListener("tagend", onTagEnd);
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/href-abs-or-rel.js
  var require_href_abs_or_rel = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/href-abs-or-rel.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "href-abs-or-rel",
        description: "An href attribute must be either absolute or relative.",
        init(parser, reporter, options) {
          const hrefMode = options === "abs" ? "absolute" : "relative";
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              if (attr.name === "href") {
                if (hrefMode === "absolute" && /^\w+?:/.test(attr.value) === false || hrefMode === "relative" && /^https?:\/\//.test(attr.value) === true) {
                  reporter.warn(`The value of the href attribute [ ${attr.value} ] must be ${hrefMode}.`, event.line, col + attr.index, this, attr.raw);
                }
                break;
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/html-lang-require.js
  var require_html_lang_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/html-lang-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var regular = "(art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|zh-min|zh-min-nan|zh-xiang)";
      var irregular = "(en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)";
      var grandfathered = `(?<grandfathered>${irregular}|${regular})`;
      var privateUse = "(?<privateUse>x(-[A-Za-z0-9]{1,8})+)";
      var privateUse2 = "(?<privateUse2>x(-[A-Za-z0-9]{1,8})+)";
      var singleton = "[0-9A-WY-Za-wy-z]";
      var extension = `(?<extension>${singleton}(-[A-Za-z0-9]{2,8})+)`;
      var variant = "(?<variant>[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})";
      var region = "(?<region>[A-Za-z]{2}|[0-9]{3})";
      var script = "(?<script>[A-Za-z]{4})";
      var extlang = "(?<extlang>[A-Za-z]{3}(-[A-Za-z]{3}){0,2})";
      var language = `(?<language>([A-Za-z]{2,3}(-${extlang})?)|[A-Za-z]{4}|[A-Za-z]{5,8})`;
      var langtag = `(${language}(-${script})?(-${region})?(-${variant})*(-${extension})*(-${privateUse})?)`;
      var languageTag = `(${grandfathered}|${langtag}|${privateUse2})`;
      exports.default = {
        id: "html-lang-require",
        description: "The lang attribute of an <html> element must be present and should be valid.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName.toLowerCase();
            const mapAttrs = parser.getMapAttrs(event.attrs);
            const col = event.col + tagName.length + 1;
            const langValidityPattern = new RegExp(languageTag, "g");
            if (tagName === "html") {
              if ("lang" in mapAttrs) {
                if (!mapAttrs["lang"]) {
                  reporter.warn("The lang attribute of <html> element must have a value.", event.line, col, this, event.raw);
                } else if (!langValidityPattern.test(mapAttrs["lang"])) {
                  reporter.warn("The lang attribute value of <html> element must be a valid BCP47.", event.line, col, this, event.raw);
                }
              } else {
                reporter.warn("An lang attribute must be present on <html> elements.", event.line, col, this, event.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/id-class-ad-disabled.js
  var require_id_class_ad_disabled = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/id-class-ad-disabled.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "id-class-ad-disabled",
        description: "The id and class attributes cannot use the ad keyword, it will be blocked by adblock software.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            let attrName;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              attrName = attr.name;
              if (/^(id|class)$/i.test(attrName)) {
                if (/(^|[-_])ad([-_]|$)/i.test(attr.value)) {
                  reporter.warn(`The value of attribute ${attrName} cannot use the ad keyword.`, event.line, col + attr.index, this, attr.raw);
                }
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/id-class-value.js
  var require_id_class_value = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/id-class-value.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "id-class-value",
        description: "The id and class attribute values must meet the specified rules.",
        init(parser, reporter, options) {
          const arrRules = {
            underline: {
              regId: /^[a-z\d]+(_[a-z\d]+)*$/,
              message: "The id and class attribute values must be in lowercase and split by an underscore."
            },
            dash: {
              regId: /^[a-z\d]+(-[a-z\d]+)*$/,
              message: "The id and class attribute values must be in lowercase and split by a dash."
            },
            hump: {
              regId: /^[a-z][a-zA-Z\d]*([A-Z][a-zA-Z\d]*)*$/,
              message: "The id and class attribute values must meet the camelCase style."
            }
          };
          let rule;
          if (typeof options === "string") {
            rule = arrRules[options];
          } else {
            rule = options;
          }
          if (typeof rule === "object" && rule.regId) {
            let regId = rule.regId;
            const message = rule.message;
            if (!(regId instanceof RegExp)) {
              regId = new RegExp(regId);
            }
            parser.addListener("tagstart", (event) => {
              const attrs = event.attrs;
              let attr;
              const col = event.col + event.tagName.length + 1;
              for (let i = 0, l1 = attrs.length; i < l1; i++) {
                attr = attrs[i];
                if (attr.name.toLowerCase() === "id") {
                  if (regId.test(attr.value) === false) {
                    reporter.warn(message, event.line, col + attr.index, this, attr.raw);
                  }
                }
                if (attr.name.toLowerCase() === "class") {
                  const arrClass = attr.value.split(/\s+/g);
                  let classValue;
                  for (let j = 0, l2 = arrClass.length; j < l2; j++) {
                    classValue = arrClass[j];
                    if (classValue && regId.test(classValue) === false) {
                      reporter.warn(message, event.line, col + attr.index, this, classValue);
                    }
                  }
                }
              }
            });
          }
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/id-unique.js
  var require_id_unique = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/id-unique.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "id-unique",
        description: "The value of id attributes must be unique.",
        init(parser, reporter) {
          const mapIdCount = {};
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            let id;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              if (attr.name.toLowerCase() === "id") {
                id = attr.value;
                if (id) {
                  if (mapIdCount[id] === void 0) {
                    mapIdCount[id] = 1;
                  } else {
                    mapIdCount[id]++;
                  }
                  if (mapIdCount[id] > 1) {
                    reporter.error(`The id value [ ${id} ] must be unique.`, event.line, col + attr.index, this, attr.raw);
                  }
                }
                break;
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/inline-script-disabled.js
  var require_inline_script_disabled = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/inline-script-disabled.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "inline-script-disabled",
        description: "Inline script cannot be used.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            let attrName;
            const reEvent = /^on(unload|message|submit|select|scroll|resize|mouseover|mouseout|mousemove|mouseleave|mouseenter|mousedown|load|keyup|keypress|keydown|focus|dblclick|click|change|blur|error)$/i;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              attrName = attr.name.toLowerCase();
              if (reEvent.test(attrName) === true) {
                reporter.warn(`Inline script [ ${attr.raw} ] cannot be used.`, event.line, col + attr.index, this, attr.raw);
              } else if (attrName === "src" || attrName === "href") {
                if (/^\s*javascript:/i.test(attr.value)) {
                  reporter.warn(`Inline script [ ${attr.raw} ] cannot be used.`, event.line, col + attr.index, this, attr.raw);
                }
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/inline-style-disabled.js
  var require_inline_style_disabled = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/inline-style-disabled.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "inline-style-disabled",
        description: "Inline style cannot be used.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            let attr;
            const col = event.col + event.tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              if (attr.name.toLowerCase() === "style") {
                reporter.warn(`Inline style [ ${attr.raw} ] cannot be used.`, event.line, col + attr.index, this, attr.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/input-requires-label.js
  var require_input_requires_label = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/input-requires-label.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "input-requires-label",
        description: "All [ input ] tags must have a corresponding [ label ] tag. ",
        init(parser, reporter) {
          const labelTags = [];
          const inputTags = [];
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName.toLowerCase();
            const mapAttrs = parser.getMapAttrs(event.attrs);
            const col = event.col + tagName.length + 1;
            if (tagName === "input") {
              if (mapAttrs["type"] !== "hidden") {
                inputTags.push({ event, col, id: mapAttrs["id"] });
              }
            }
            if (tagName === "label") {
              if ("for" in mapAttrs && mapAttrs["for"] !== "") {
                labelTags.push({ event, col, forValue: mapAttrs["for"] });
              }
            }
          });
          parser.addListener("end", () => {
            inputTags.forEach((inputTag) => {
              if (!hasMatchingLabelTag(inputTag)) {
                reporter.warn("No matching [ label ] tag found.", inputTag.event.line, inputTag.col, this, inputTag.event.raw);
              }
            });
          });
          function hasMatchingLabelTag(inputTag) {
            let found = false;
            labelTags.forEach((labelTag) => {
              if (inputTag.id && inputTag.id === labelTag.forValue) {
                found = true;
              }
            });
            return found;
          }
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/link-rel-canonical-require.js
  var require_link_rel_canonical_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/link-rel-canonical-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "link-rel-canonical-require",
        description: '<link rel="canonical"> with non-blank href must be present in <head> tag.',
        init(parser, reporter) {
          let headSeen = false;
          let linkCanonicalSeen = false;
          let linkCanonicalHref = "";
          let headEvent = null;
          const onTagStart = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "head") {
              headSeen = true;
              headEvent = event;
            } else if (tagName === "link") {
              const mapAttrs = parser.getMapAttrs(event.attrs);
              if (mapAttrs["rel"] && mapAttrs["rel"].toLowerCase() === "canonical") {
                linkCanonicalSeen = true;
                linkCanonicalHref = mapAttrs["href"] || "";
              }
            }
          };
          parser.addListener("tagstart", onTagStart);
          parser.addListener("end", () => {
            if (headSeen && headEvent) {
              if (!linkCanonicalSeen) {
                reporter.error('<link rel="canonical"> must be present in <head> tag.', headEvent.line, headEvent.col, this, headEvent.raw);
              } else if (linkCanonicalHref.trim() === "") {
                reporter.error('<link rel="canonical"> href attribute must not be empty.', headEvent.line, headEvent.col, this, headEvent.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/main-require.js
  var require_main_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/main-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "main-require",
        description: "<main> must be present in <body> tag.",
        init(parser, reporter) {
          let bodyDepth = 0;
          let hasMainInBody = false;
          let bodyTagEvent = null;
          const onTagStart = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "body") {
              bodyDepth++;
              if (bodyDepth === 1) {
                hasMainInBody = false;
                bodyTagEvent = event;
              }
            } else if (tagName === "main" && bodyDepth > 0) {
              hasMainInBody = true;
            }
          };
          const onTagEnd = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "body") {
              if (bodyDepth === 1 && !hasMainInBody && bodyTagEvent) {
                reporter.warn("<main> must be present in <body> tag.", bodyTagEvent.line, bodyTagEvent.col, this, bodyTagEvent.raw);
              }
              bodyDepth--;
              if (bodyDepth < 0)
                bodyDepth = 0;
            }
          };
          parser.addListener("tagstart", onTagStart);
          parser.addListener("tagend", onTagEnd);
          parser.addListener("end", () => {
            if (bodyDepth > 0 && !hasMainInBody && bodyTagEvent) {
              reporter.warn("<main> must be present in <body> tag.", bodyTagEvent.line, bodyTagEvent.col, this, bodyTagEvent.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/meta-charset-require.js
  var require_meta_charset_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/meta-charset-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "meta-charset-require",
        description: '<meta charset=""> must be present in <head> tag.',
        init(parser, reporter) {
          let headSeen = false;
          let metaCharsetSeen = false;
          let metaCharsetContent = "";
          let headEvent = null;
          const onTagStart = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "head") {
              headSeen = true;
              headEvent = event;
            } else if (tagName === "meta") {
              const mapAttrs = parser.getMapAttrs(event.attrs);
              if (mapAttrs["charset"] !== void 0) {
                metaCharsetSeen = true;
                metaCharsetContent = mapAttrs["charset"] || "";
              }
            }
          };
          parser.addListener("tagstart", onTagStart);
          parser.addListener("end", () => {
            if (headSeen && headEvent) {
              if (!metaCharsetSeen) {
                reporter.error('<meta charset=""> must be present in <head> tag.', headEvent.line, headEvent.col, this, headEvent.raw);
              } else if (metaCharsetContent.trim() === "") {
                reporter.error('<meta charset=""> value must not be empty.', headEvent.line, headEvent.col, this, headEvent.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/meta-description-require.js
  var require_meta_description_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/meta-description-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "meta-description-require",
        description: '<meta name="description"> with non-blank content must be present in <head> tag.',
        init(parser, reporter) {
          let headSeen = false;
          let metaDescriptionSeen = false;
          let metaDescriptionContent = "";
          let headEvent = null;
          const onTagStart = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "head") {
              headSeen = true;
              headEvent = event;
            } else if (tagName === "meta") {
              const mapAttrs = parser.getMapAttrs(event.attrs);
              if (mapAttrs["name"] && mapAttrs["name"].toLowerCase() === "description") {
                metaDescriptionSeen = true;
                metaDescriptionContent = mapAttrs["content"] || "";
              }
            }
          };
          parser.addListener("tagstart", onTagStart);
          parser.addListener("end", () => {
            if (headSeen && headEvent) {
              if (!metaDescriptionSeen) {
                reporter.error('<meta name="description"> must be present in <head> tag.', headEvent.line, headEvent.col, this, headEvent.raw);
              } else if (metaDescriptionContent.trim() === "") {
                reporter.error('<meta name="description"> content attribute must not be empty.', headEvent.line, headEvent.col, this, headEvent.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/meta-viewport-require.js
  var require_meta_viewport_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/meta-viewport-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "meta-viewport-require",
        description: '<meta name="viewport"> with non-blank content must be present in <head> tag.',
        init(parser, reporter) {
          let headSeen = false;
          let metaViewportSeen = false;
          let metaViewportContent = "";
          let headEvent = null;
          const onTagStart = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "head") {
              headSeen = true;
              headEvent = event;
            } else if (tagName === "meta") {
              const mapAttrs = parser.getMapAttrs(event.attrs);
              if (mapAttrs["name"] && mapAttrs["name"].toLowerCase() === "viewport") {
                metaViewportSeen = true;
                metaViewportContent = mapAttrs["content"] || "";
              }
            }
          };
          parser.addListener("tagstart", onTagStart);
          parser.addListener("end", () => {
            if (headSeen && headEvent) {
              if (!metaViewportSeen) {
                reporter.error('<meta name="viewport"> must be present in <head> tag.', headEvent.line, headEvent.col, this, headEvent.raw);
              } else if (metaViewportContent.trim() === "") {
                reporter.error('<meta name="viewport"> content attribute must not be empty.', headEvent.line, headEvent.col, this, headEvent.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/script-disabled.js
  var require_script_disabled = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/script-disabled.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "script-disabled",
        description: "The <script> tag cannot be used.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            if (event.tagName.toLowerCase() === "script") {
              reporter.error("The <script> tag cannot be used.", event.line, event.col, this, event.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/space-tab-mixed-disabled.js
  var require_space_tab_mixed_disabled = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/space-tab-mixed-disabled.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "space-tab-mixed-disabled",
        description: "Do not mix tabs and spaces for indentation.",
        init(parser, reporter, options) {
          let indentMode = "nomix";
          let spaceLengthRequire = null;
          if (typeof options === "string") {
            const match = /^([a-z]+)(\d+)?/.exec(options);
            if (match) {
              indentMode = match[1];
              spaceLengthRequire = match[2] && parseInt(match[2], 10);
            }
          }
          parser.addListener("text", (event) => {
            const raw = event.raw;
            const reMixed = /(^|\r?\n)([ \t]+)/g;
            let match;
            while (match = reMixed.exec(raw)) {
              const fixedPos = parser.fixPos(event, match.index + match[1].length);
              if (fixedPos.col !== 1) {
                continue;
              }
              const whiteSpace = match[2];
              if (indentMode === "space") {
                if (spaceLengthRequire) {
                  if (/^ +$/.test(whiteSpace) === false || whiteSpace.length % spaceLengthRequire !== 0) {
                    reporter.warn(`Please use space for indentation and keep ${spaceLengthRequire} length.`, fixedPos.line, 1, this, event.raw);
                  }
                } else {
                  if (/^ +$/.test(whiteSpace) === false) {
                    reporter.warn("Please use space for indentation.", fixedPos.line, 1, this, event.raw);
                  }
                }
              } else if (indentMode === "tab" && /^\t+$/.test(whiteSpace) === false) {
                reporter.warn("Please use tab for indentation.", fixedPos.line, 1, this, event.raw);
              } else if (/ +\t|\t+ /.test(whiteSpace) === true) {
                reporter.warn("Do not mix tabs and spaces for indentation.", fixedPos.line, 1, this, event.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/spec-char-escape.js
  var require_spec_char_escape = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/spec-char-escape.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "spec-char-escape",
        description: "Special characters must be escaped.",
        init(parser, reporter) {
          parser.addListener("text", (event) => {
            const raw = event.raw;
            const reSpecChar = /([<>])/g;
            let match;
            while (match = reSpecChar.exec(raw)) {
              const fixedPos = parser.fixPos(event, match.index);
              reporter.error(`Special characters must be escaped : [ ${match[0]} ].`, fixedPos.line, fixedPos.col, this, event.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/src-not-empty.js
  var require_src_not_empty = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/src-not-empty.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "src-not-empty",
        description: "The src attribute of an img(script,link) must have a value.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName;
            const attrs = event.attrs;
            let attr;
            const col = event.col + tagName.length + 1;
            for (let i = 0, l = attrs.length; i < l; i++) {
              attr = attrs[i];
              if ((/^(img|script|embed|bgsound|iframe)$/.test(tagName) === true && attr.name === "src" || tagName === "link" && attr.name === "href" || tagName === "object" && attr.name === "data") && attr.value === "") {
                reporter.error(`The attribute [ ${attr.name} ] of the tag [ ${tagName} ] must have a value.`, event.line, col + attr.index, this, attr.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/style-disabled.js
  var require_style_disabled = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/style-disabled.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "style-disabled",
        description: "<style> tags cannot be used.",
        init(parser, reporter) {
          parser.addListener("tagstart", (event) => {
            if (event.tagName.toLowerCase() === "style") {
              reporter.warn("The <style> tag cannot be used.", event.line, event.col, this, event.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/tag-no-obsolete.js
  var require_tag_no_obsolete = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/tag-no-obsolete.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var OBSOLETE_TAGS = [
        "applet",
        "acronym",
        "bgsound",
        "dir",
        "frame",
        "frameset",
        "noframes",
        "isindex",
        "keygen",
        "listing",
        "menuitem",
        "nextid",
        "noembed",
        "plaintext",
        "rb",
        "rtc",
        "strike",
        "xmp",
        "basefont",
        "big",
        "blink",
        "center",
        "font",
        "marquee",
        "multicol",
        "nobr",
        "spacer",
        "tt"
      ];
      exports.default = {
        id: "tag-no-obsolete",
        description: "Disallows the use of obsolete HTML tags.",
        init(parser, reporter, _options) {
          parser.addListener("tagstart,tagend", (event) => {
            const tagName = event.tagName.toLowerCase();
            if (OBSOLETE_TAGS.includes(tagName)) {
              reporter.error(`The tag [ ${event.tagName} ] is obsolete in HTML5 and should not be used.`, event.line, event.col, this, event.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/tagname-lowercase.js
  var require_tagname_lowercase = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/tagname-lowercase.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var svgTagNameIgnores = [
        "animateMotion",
        "animateTransform",
        "clipPath",
        "feBlend",
        "feColorMatrix",
        "feComponentTransfer",
        "feComposite",
        "feConvolveMatrix",
        "feDiffuseLighting",
        "feDisplacementMap",
        "feDistantLight",
        "feDropShadow",
        "feFlood",
        "feFuncA",
        "feFuncB",
        "feFuncG",
        "feFuncR",
        "feGaussianBlur",
        "feImage",
        "feMerge",
        "feMergeNode",
        "feMorphology",
        "feOffset",
        "fePointLight",
        "feSpecularLighting",
        "feSpotLight",
        "feTile",
        "feTurbulence",
        "foreignObject",
        "linearGradient",
        "radialGradient",
        "textPath"
      ];
      function testAgainstStringOrRegExp(value, comparison) {
        if (comparison instanceof RegExp) {
          return comparison.test(value) ? { match: value, pattern: comparison } : false;
        }
        const firstComparisonChar = comparison[0];
        const lastComparisonChar = comparison[comparison.length - 1];
        const secondToLastComparisonChar = comparison[comparison.length - 2];
        const comparisonIsRegex = firstComparisonChar === "/" && (lastComparisonChar === "/" || secondToLastComparisonChar === "/" && lastComparisonChar === "i");
        const hasCaseInsensitiveFlag = comparisonIsRegex && lastComparisonChar === "i";
        if (comparisonIsRegex) {
          const valueMatches = hasCaseInsensitiveFlag ? new RegExp(comparison.slice(1, -2), "i").test(value) : new RegExp(comparison.slice(1, -1)).test(value);
          return valueMatches;
        }
        return value === comparison;
      }
      exports.default = {
        id: "tagname-lowercase",
        description: "All html element names must be in lowercase.",
        init(parser, reporter, options) {
          const exceptions = (Array.isArray(options) ? options : []).concat(svgTagNameIgnores);
          parser.addListener("tagstart,tagend", (event) => {
            const tagName = event.tagName;
            if (!exceptions.find((exp) => testAgainstStringOrRegExp(tagName, exp)) && tagName !== tagName.toLowerCase()) {
              reporter.error(`The html element name of [ ${tagName} ] must be in lowercase.`, event.line, event.col, this, event.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/tagname-specialchars.js
  var require_tagname_specialchars = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/tagname-specialchars.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "tagname-specialchars",
        description: "All special characters must be escaped.",
        init(parser, reporter) {
          const specialchars = /[^a-zA-Z0-9\-:_]/;
          parser.addListener("tagstart,tagend", (event) => {
            const tagName = event.tagName;
            if (specialchars.test(tagName)) {
              reporter.error(`The html element name of [ ${tagName} ] contains special character.`, event.line, event.col, this, event.raw);
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/tag-pair.js
  var require_tag_pair = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/tag-pair.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "tag-pair",
        description: "Tag must be paired.",
        init(parser, reporter) {
          const stack = [];
          const mapEmptyTags = parser.makeMap("area,base,basefont,br,col,frame,hr,img,input,isindex,link,meta,param,embed,track,command,source,keygen,wbr");
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName.toLowerCase();
            if (mapEmptyTags[tagName] === void 0 && !event.close) {
              stack.push({
                tagName,
                line: event.line,
                col: event.col,
                raw: event.raw
              });
            }
          });
          parser.addListener("tagend", (event) => {
            const tagName = event.tagName.toLowerCase();
            let pos;
            for (pos = stack.length - 1; pos >= 0; pos--) {
              if (stack[pos].tagName === tagName) {
                break;
              }
            }
            if (pos >= 0) {
              const arrTags = [];
              for (let i = stack.length - 1; i > pos; i--) {
                arrTags.push(`</${stack[i].tagName}>`);
              }
              if (arrTags.length > 0) {
                const lastEvent = stack[stack.length - 1];
                reporter.error(`Tag must be paired, missing: [ ${arrTags.join("")} ], start tag match failed [ ${lastEvent.raw} ] on line ${lastEvent.line}.`, lastEvent.line || event.line, lastEvent.col || event.col, this, event.raw);
              }
              stack.length = pos;
            } else {
              reporter.error(`Tag must be paired, no start tag: [ ${event.raw} ]`, event.line, event.col, this, event.raw);
            }
          });
          parser.addListener("end", (event) => {
            const arrTags = [];
            for (let i = stack.length - 1; i >= 0; i--) {
              arrTags.push(`</${stack[i].tagName}>`);
            }
            if (arrTags.length > 0) {
              const lastEvent = stack[stack.length - 1];
              reporter.error(`Tag must be paired, missing: [ ${arrTags.join("")} ], open tag match failed [ ${lastEvent.raw} ] on line ${lastEvent.line}.`, event.line, event.col, this, "");
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/tags-check.js
  var require_tags_check = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/tags-check.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var tagsTypings = {
        a: {
          selfclosing: false,
          attrsRequired: ["href", "title"],
          redundantAttrs: ["alt"]
        },
        div: {
          selfclosing: false
        },
        main: {
          selfclosing: false,
          redundantAttrs: ["role"]
        },
        nav: {
          selfclosing: false,
          redundantAttrs: ["role"]
        },
        script: {
          attrsOptional: [
            ["async", "async"],
            ["defer", "defer"]
          ]
        },
        img: {
          selfclosing: true,
          attrsRequired: ["src", "alt", "title"]
        }
      };
      exports.default = {
        id: "tags-check",
        description: "Checks html tags.",
        init(parser, reporter, options) {
          tagsTypings = __spreadValues(__spreadValues({}, tagsTypings), options);
          parser.addListener("tagstart", (event) => {
            const attrs = event.attrs;
            const col = event.col + event.tagName.length + 1;
            const tagName = event.tagName.toLowerCase();
            if (tagsTypings[tagName]) {
              const currentTagType = tagsTypings[tagName];
              if (currentTagType.selfclosing === true && !event.close) {
                reporter.warn(`The <${tagName}> tag must be selfclosing.`, event.line, event.col, this, event.raw);
              } else if (currentTagType.selfclosing === false && event.close) {
                reporter.warn(`The <${tagName}> tag must not be selfclosing.`, event.line, event.col, this, event.raw);
              }
              if (Array.isArray(currentTagType.attrsRequired)) {
                const attrsRequired = currentTagType.attrsRequired;
                attrsRequired.forEach((id) => {
                  if (Array.isArray(id)) {
                    const copyOfId = id.map((a) => a);
                    const realID = copyOfId.shift();
                    const values = copyOfId;
                    if (attrs.some((attr) => attr.name === realID)) {
                      attrs.forEach((attr) => {
                        if (attr.name === realID && values.indexOf(attr.value) === -1) {
                          reporter.error(`The <${tagName}> tag must have attr '${realID}' with one value of '${values.join("' or '")}'.`, event.line, col, this, event.raw);
                        }
                      });
                    } else {
                      reporter.error(`The <${tagName}> tag must have attr '${realID}'.`, event.line, col, this, event.raw);
                    }
                  } else if (!attrs.some((attr) => id.split("|").indexOf(attr.name) !== -1)) {
                    reporter.error(`The <${tagName}> tag must have attr '${id}'.`, event.line, col, this, event.raw);
                  }
                });
              }
              if (Array.isArray(currentTagType.attrsOptional)) {
                const attrsOptional = currentTagType.attrsOptional;
                attrsOptional.forEach((id) => {
                  if (Array.isArray(id)) {
                    const copyOfId = id.map((a) => a);
                    const realID = copyOfId.shift();
                    const values = copyOfId;
                    if (attrs.some((attr) => attr.name === realID)) {
                      attrs.forEach((attr) => {
                        if (attr.name === realID && values.indexOf(attr.value) === -1) {
                          reporter.error(`The <${tagName}> tag must have optional attr '${realID}' with one value of '${values.join("' or '")}'.`, event.line, col, this, event.raw);
                        }
                      });
                    }
                  }
                });
              }
              if (Array.isArray(currentTagType.redundantAttrs)) {
                const redundantAttrs = currentTagType.redundantAttrs;
                redundantAttrs.forEach((attrName) => {
                  if (attrs.some((attr) => attr.name === attrName)) {
                    reporter.error(`The attr '${attrName}' is redundant for <${tagName}> and should be omitted.`, event.line, col, this, event.raw);
                  }
                });
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/tag-self-close.js
  var require_tag_self_close = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/tag-self-close.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "tag-self-close",
        description: "Empty tags must be self closed.",
        init(parser, reporter) {
          const mapEmptyTags = parser.makeMap("area,base,basefont,bgsound,br,col,frame,hr,img,input,isindex,link,meta,param,embed,track,command,source,keygen,wbr");
          parser.addListener("tagstart", (event) => {
            const tagName = event.tagName.toLowerCase();
            if (mapEmptyTags[tagName] !== void 0) {
              if (!event.close) {
                reporter.warn(`The empty tag : [ ${tagName} ] must be self closed.`, event.line, event.col, this, event.raw);
              }
            }
          });
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/title-require.js
  var require_title_require = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/title-require.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.default = {
        id: "title-require",
        description: "<title> must be present in <head> tag.",
        init(parser, reporter) {
          let headBegin = false;
          let hasTitle = false;
          const onTagStart = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (tagName === "head") {
              headBegin = true;
            } else if (tagName === "title" && headBegin) {
              hasTitle = true;
            }
          };
          const onTagEnd = (event) => {
            const tagName = event.tagName.toLowerCase();
            if (hasTitle && tagName === "title") {
              const lastEvent = event.lastEvent;
              if (lastEvent.type !== "text" || lastEvent.type === "text" && /^\s*$/.test(lastEvent.raw) === true) {
                reporter.error("<title></title> must not be empty.", event.line, event.col, this, event.raw);
              }
            } else if (tagName === "head") {
              if (hasTitle === false) {
                reporter.error("<title> must be present in <head> tag.", event.line, event.col, this, event.raw);
              }
              parser.removeListener("tagstart", onTagStart);
              parser.removeListener("tagend", onTagEnd);
            }
          };
          parser.addListener("tagstart", onTagStart);
          parser.addListener("tagend", onTagEnd);
        }
      };
    }
  });

  // ../../node_modules/htmlhint/dist/core/rules/index.js
  var require_rules = __commonJS({
    "../../node_modules/htmlhint/dist/core/rules/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.titleRequire = exports.tagSelfClose = exports.tagsCheck = exports.tagPair = exports.tagnameSpecialChars = exports.tagnameLowercase = exports.tagNoObsolete = exports.styleDisabled = exports.srcNotEmpty = exports.specCharEscape = exports.spaceTabMixedDisabled = exports.scriptDisabled = exports.metaViewportRequire = exports.metaDescriptionRequire = exports.metaCharsetRequire = exports.mainRequire = exports.linkRelCanonicalRequire = exports.inputRequiresLabel = exports.inlineStyleDisabled = exports.inlineScriptDisabled = exports.idUnique = exports.idClassValue = exports.idClassAdDisabled = exports.htmlLangRequire = exports.hrefAbsOrRel = exports.headScriptDisabled = exports.h1Require = exports.frameTitleRequire = exports.formMethodRequire = exports.emptyTagNotSelfClosed = exports.doctypeHTML5 = exports.doctypeFirst = exports.buttonTypeRequire = exports.attrWhitespace = exports.attrValueSingleQuotes = exports.attrValueNotEmpty = exports.attrValueDoubleQuotes = exports.attrUnsafeChars = exports.attrSort = exports.attrValueNoDuplication = exports.attrNoUnnecessaryWhitespace = exports.attrNoDuplication = exports.attrLowercase = exports.altRequire = void 0;
      var alt_require_1 = require_alt_require();
      Object.defineProperty(exports, "altRequire", { enumerable: true, get: function() {
        return alt_require_1.default;
      } });
      var attr_lowercase_1 = require_attr_lowercase();
      Object.defineProperty(exports, "attrLowercase", { enumerable: true, get: function() {
        return attr_lowercase_1.default;
      } });
      var attr_no_duplication_1 = require_attr_no_duplication();
      Object.defineProperty(exports, "attrNoDuplication", { enumerable: true, get: function() {
        return attr_no_duplication_1.default;
      } });
      var attr_no_unnecessary_whitespace_1 = require_attr_no_unnecessary_whitespace();
      Object.defineProperty(exports, "attrNoUnnecessaryWhitespace", { enumerable: true, get: function() {
        return attr_no_unnecessary_whitespace_1.default;
      } });
      var attr_value_no_duplication_1 = require_attr_value_no_duplication();
      Object.defineProperty(exports, "attrValueNoDuplication", { enumerable: true, get: function() {
        return attr_value_no_duplication_1.default;
      } });
      var attr_sorted_1 = require_attr_sorted();
      Object.defineProperty(exports, "attrSort", { enumerable: true, get: function() {
        return attr_sorted_1.default;
      } });
      var attr_unsafe_chars_1 = require_attr_unsafe_chars();
      Object.defineProperty(exports, "attrUnsafeChars", { enumerable: true, get: function() {
        return attr_unsafe_chars_1.default;
      } });
      var attr_value_double_quotes_1 = require_attr_value_double_quotes();
      Object.defineProperty(exports, "attrValueDoubleQuotes", { enumerable: true, get: function() {
        return attr_value_double_quotes_1.default;
      } });
      var attr_value_not_empty_1 = require_attr_value_not_empty();
      Object.defineProperty(exports, "attrValueNotEmpty", { enumerable: true, get: function() {
        return attr_value_not_empty_1.default;
      } });
      var attr_value_single_quotes_1 = require_attr_value_single_quotes();
      Object.defineProperty(exports, "attrValueSingleQuotes", { enumerable: true, get: function() {
        return attr_value_single_quotes_1.default;
      } });
      var attr_whitespace_1 = require_attr_whitespace();
      Object.defineProperty(exports, "attrWhitespace", { enumerable: true, get: function() {
        return attr_whitespace_1.default;
      } });
      var button_type_require_1 = require_button_type_require();
      Object.defineProperty(exports, "buttonTypeRequire", { enumerable: true, get: function() {
        return button_type_require_1.default;
      } });
      var doctype_first_1 = require_doctype_first();
      Object.defineProperty(exports, "doctypeFirst", { enumerable: true, get: function() {
        return doctype_first_1.default;
      } });
      var doctype_html5_1 = require_doctype_html5();
      Object.defineProperty(exports, "doctypeHTML5", { enumerable: true, get: function() {
        return doctype_html5_1.default;
      } });
      var empty_tag_not_self_closed_1 = require_empty_tag_not_self_closed();
      Object.defineProperty(exports, "emptyTagNotSelfClosed", { enumerable: true, get: function() {
        return empty_tag_not_self_closed_1.default;
      } });
      var form_method_require_1 = require_form_method_require();
      Object.defineProperty(exports, "formMethodRequire", { enumerable: true, get: function() {
        return form_method_require_1.default;
      } });
      var frame_title_require_1 = require_frame_title_require();
      Object.defineProperty(exports, "frameTitleRequire", { enumerable: true, get: function() {
        return frame_title_require_1.default;
      } });
      var h1_require_1 = require_h1_require();
      Object.defineProperty(exports, "h1Require", { enumerable: true, get: function() {
        return h1_require_1.default;
      } });
      var head_script_disabled_1 = require_head_script_disabled();
      Object.defineProperty(exports, "headScriptDisabled", { enumerable: true, get: function() {
        return head_script_disabled_1.default;
      } });
      var href_abs_or_rel_1 = require_href_abs_or_rel();
      Object.defineProperty(exports, "hrefAbsOrRel", { enumerable: true, get: function() {
        return href_abs_or_rel_1.default;
      } });
      var html_lang_require_1 = require_html_lang_require();
      Object.defineProperty(exports, "htmlLangRequire", { enumerable: true, get: function() {
        return html_lang_require_1.default;
      } });
      var id_class_ad_disabled_1 = require_id_class_ad_disabled();
      Object.defineProperty(exports, "idClassAdDisabled", { enumerable: true, get: function() {
        return id_class_ad_disabled_1.default;
      } });
      var id_class_value_1 = require_id_class_value();
      Object.defineProperty(exports, "idClassValue", { enumerable: true, get: function() {
        return id_class_value_1.default;
      } });
      var id_unique_1 = require_id_unique();
      Object.defineProperty(exports, "idUnique", { enumerable: true, get: function() {
        return id_unique_1.default;
      } });
      var inline_script_disabled_1 = require_inline_script_disabled();
      Object.defineProperty(exports, "inlineScriptDisabled", { enumerable: true, get: function() {
        return inline_script_disabled_1.default;
      } });
      var inline_style_disabled_1 = require_inline_style_disabled();
      Object.defineProperty(exports, "inlineStyleDisabled", { enumerable: true, get: function() {
        return inline_style_disabled_1.default;
      } });
      var input_requires_label_1 = require_input_requires_label();
      Object.defineProperty(exports, "inputRequiresLabel", { enumerable: true, get: function() {
        return input_requires_label_1.default;
      } });
      var link_rel_canonical_require_1 = require_link_rel_canonical_require();
      Object.defineProperty(exports, "linkRelCanonicalRequire", { enumerable: true, get: function() {
        return link_rel_canonical_require_1.default;
      } });
      var main_require_1 = require_main_require();
      Object.defineProperty(exports, "mainRequire", { enumerable: true, get: function() {
        return main_require_1.default;
      } });
      var meta_charset_require_1 = require_meta_charset_require();
      Object.defineProperty(exports, "metaCharsetRequire", { enumerable: true, get: function() {
        return meta_charset_require_1.default;
      } });
      var meta_description_require_1 = require_meta_description_require();
      Object.defineProperty(exports, "metaDescriptionRequire", { enumerable: true, get: function() {
        return meta_description_require_1.default;
      } });
      var meta_viewport_require_1 = require_meta_viewport_require();
      Object.defineProperty(exports, "metaViewportRequire", { enumerable: true, get: function() {
        return meta_viewport_require_1.default;
      } });
      var script_disabled_1 = require_script_disabled();
      Object.defineProperty(exports, "scriptDisabled", { enumerable: true, get: function() {
        return script_disabled_1.default;
      } });
      var space_tab_mixed_disabled_1 = require_space_tab_mixed_disabled();
      Object.defineProperty(exports, "spaceTabMixedDisabled", { enumerable: true, get: function() {
        return space_tab_mixed_disabled_1.default;
      } });
      var spec_char_escape_1 = require_spec_char_escape();
      Object.defineProperty(exports, "specCharEscape", { enumerable: true, get: function() {
        return spec_char_escape_1.default;
      } });
      var src_not_empty_1 = require_src_not_empty();
      Object.defineProperty(exports, "srcNotEmpty", { enumerable: true, get: function() {
        return src_not_empty_1.default;
      } });
      var style_disabled_1 = require_style_disabled();
      Object.defineProperty(exports, "styleDisabled", { enumerable: true, get: function() {
        return style_disabled_1.default;
      } });
      var tag_no_obsolete_1 = require_tag_no_obsolete();
      Object.defineProperty(exports, "tagNoObsolete", { enumerable: true, get: function() {
        return tag_no_obsolete_1.default;
      } });
      var tagname_lowercase_1 = require_tagname_lowercase();
      Object.defineProperty(exports, "tagnameLowercase", { enumerable: true, get: function() {
        return tagname_lowercase_1.default;
      } });
      var tagname_specialchars_1 = require_tagname_specialchars();
      Object.defineProperty(exports, "tagnameSpecialChars", { enumerable: true, get: function() {
        return tagname_specialchars_1.default;
      } });
      var tag_pair_1 = require_tag_pair();
      Object.defineProperty(exports, "tagPair", { enumerable: true, get: function() {
        return tag_pair_1.default;
      } });
      var tags_check_1 = require_tags_check();
      Object.defineProperty(exports, "tagsCheck", { enumerable: true, get: function() {
        return tags_check_1.default;
      } });
      var tag_self_close_1 = require_tag_self_close();
      Object.defineProperty(exports, "tagSelfClose", { enumerable: true, get: function() {
        return tag_self_close_1.default;
      } });
      var title_require_1 = require_title_require();
      Object.defineProperty(exports, "titleRequire", { enumerable: true, get: function() {
        return title_require_1.default;
      } });
    }
  });

  // ../../node_modules/htmlhint/dist/core/core.js
  var require_core = __commonJS({
    "../../node_modules/htmlhint/dist/core/core.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.HTMLParser = exports.Reporter = exports.HTMLRules = exports.HTMLHint = void 0;
      var htmlparser_1 = require_htmlparser();
      exports.HTMLParser = htmlparser_1.default;
      var reporter_1 = require_reporter();
      exports.Reporter = reporter_1.default;
      var HTMLRules = require_rules();
      exports.HTMLRules = HTMLRules;
      var HTMLHintCore = class {
        constructor() {
          this.rules = {};
          this.defaultRuleset = {
            "tagname-lowercase": true,
            "attr-lowercase": true,
            "attr-value-double-quotes": true,
            "doctype-first": true,
            "tag-pair": true,
            "spec-char-escape": true,
            "id-unique": true,
            "src-not-empty": true,
            "attr-no-duplication": true,
            "title-require": true
          };
        }
        addRule(rule) {
          this.rules[rule.id] = rule;
        }
        verify(html, ruleset = this.defaultRuleset) {
          if (Object.keys(ruleset).length === 0) {
            ruleset = this.defaultRuleset;
          }
          html = html.replace(/^\s*<!--\s*htmlhint\s+([^\r\n]+?)\s*-->/i, (all, strRuleset) => {
            strRuleset.replace(/(?:^|,)\s*([^:,]+)\s*(?:\:\s*([^,\s]+))?/g, (all2, ruleId, value) => {
              ruleset[ruleId] = value !== void 0 && value.length > 0 ? JSON.parse(value) : true;
              return "";
            });
            return "";
          });
          const disabledRulesMap = this.parseDisableComments(html);
          const parser = new htmlparser_1.default();
          const reporter = new reporter_1.default(html, ruleset, disabledRulesMap);
          const rules = this.rules;
          let rule;
          for (const id in ruleset) {
            rule = rules[id];
            if (rule !== void 0 && ruleset[id] !== false) {
              rule.init(parser, reporter, ruleset[id]);
            }
          }
          parser.parse(html);
          return reporter.messages;
        }
        parseDisableComments(html) {
          var _a;
          const disabledRulesMap = {};
          const lines = html.split(/\r?\n/);
          const regComment = /<!--\s*htmlhint-(disable|enable)(?:-next-line)?(?:\s+([^\r\n]+?))?\s*-->/gi;
          const comments = [];
          let match;
          while ((match = regComment.exec(html)) !== null) {
            const beforeMatch = html.substring(0, match.index);
            const lineNumber = beforeMatch.split(/\r?\n/).length;
            const command = match[1].toLowerCase();
            const isNextLine = match[0].includes("-next-line");
            const rulesStr = (_a = match[2]) === null || _a === void 0 ? void 0 : _a.trim();
            comments.push({
              line: lineNumber,
              command,
              isNextLine,
              rulesStr
            });
          }
          let currentDisabledRules = null;
          let isAllDisabled = false;
          for (let i = 0; i < lines.length; i++) {
            const line = i + 1;
            const commentOnLine = comments.find((c) => c.line === line);
            if (commentOnLine) {
              if (commentOnLine.command === "disable") {
                if (commentOnLine.isNextLine) {
                  const nextLine = line + 1;
                  if (commentOnLine.rulesStr) {
                    const rules = commentOnLine.rulesStr.split(/\s+/).filter((r) => r.length > 0);
                    if (!disabledRulesMap[nextLine]) {
                      disabledRulesMap[nextLine] = {};
                    }
                    if (!disabledRulesMap[nextLine].rules) {
                      disabledRulesMap[nextLine].rules = /* @__PURE__ */ new Set();
                    }
                    rules.forEach((r) => disabledRulesMap[nextLine].rules.add(r));
                  } else {
                    if (!disabledRulesMap[nextLine]) {
                      disabledRulesMap[nextLine] = {};
                    }
                    disabledRulesMap[nextLine].all = true;
                  }
                } else {
                  if (commentOnLine.rulesStr) {
                    const rules = commentOnLine.rulesStr.split(/\s+/).filter((r) => r.length > 0);
                    currentDisabledRules = new Set(rules);
                    isAllDisabled = false;
                  } else {
                    currentDisabledRules = null;
                    isAllDisabled = true;
                  }
                }
              } else if (commentOnLine.command === "enable") {
                currentDisabledRules = null;
                isAllDisabled = false;
              }
            }
            if (currentDisabledRules !== null || isAllDisabled) {
              if (!disabledRulesMap[line]) {
                disabledRulesMap[line] = {};
              }
              if (isAllDisabled && disabledRulesMap[line].all !== true) {
                disabledRulesMap[line].all = true;
              } else if (currentDisabledRules) {
                if (!disabledRulesMap[line].rules) {
                  disabledRulesMap[line].rules = /* @__PURE__ */ new Set();
                }
                currentDisabledRules.forEach((r) => disabledRulesMap[line].rules.add(r));
              }
            }
          }
          return disabledRulesMap;
        }
        format(arrMessages, options = {}) {
          const arrLogs = [];
          const colors = {
            white: "",
            grey: "",
            red: "",
            reset: ""
          };
          if (options.colors) {
            colors.white = "\x1B[37m";
            colors.grey = "\x1B[90m";
            colors.red = "\x1B[31m";
            colors.reset = "\x1B[39m";
          }
          const indent = options.indent || 0;
          arrMessages.forEach((hint) => {
            const leftWindow = 40;
            const rightWindow = leftWindow + 20;
            let evidence = hint.evidence;
            const line = hint.line;
            const col = hint.col;
            const evidenceCount = evidence.length;
            let leftCol = col > leftWindow + 1 ? col - leftWindow : 1;
            let rightCol = evidence.length > col + rightWindow ? col + rightWindow : evidenceCount;
            if (col < leftWindow + 1) {
              rightCol += leftWindow - col + 1;
            }
            evidence = evidence.replace(/\t/g, " ").substring(leftCol - 1, rightCol);
            if (leftCol > 1) {
              evidence = `...${evidence}`;
              leftCol -= 3;
            }
            if (rightCol < evidenceCount) {
              evidence += "...";
            }
            arrLogs.push(`${colors.white + repeatStr(indent)}L${line} |${colors.grey}${evidence}${colors.reset}`);
            let pointCol = col - leftCol;
            const match = evidence.substring(0, pointCol).match(/[^\u0000-\u00ff]/g);
            if (match !== null) {
              pointCol += match.length;
            }
            arrLogs.push(`${colors.white + repeatStr(indent) + repeatStr(String(line).length + 3 + pointCol)}^ ${colors.red}${hint.message} (${hint.rule.id})${colors.reset}`);
          });
          return arrLogs;
        }
      };
      function repeatStr(n, str) {
        return new Array(n + 1).join(str || " ");
      }
      exports.HTMLHint = new HTMLHintCore();
      Object.values(HTMLRules).forEach((rule) => {
        exports.HTMLHint.addRule(rule);
      });
    }
  });

  // src/workers/html-worker.ts
  var html_worker_exports = {};
  __export(html_worker_exports, {
    HtmlWorker: () => HtmlWorker
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

  // src/workers/html-worker.ts
  var import_htmlhint = __toESM(require_core());
  var HtmlWorker = class extends Mirror {
    constructor(sender) {
      super(sender);
      this.defaultValidationOptions = {
        "attr-no-duplication": true,
        "body-no-duplicates": true,
        "head-body-descendents-html": true,
        "head-no-duplicates": true,
        "head-valid-children": true,
        "html-no-duplicates": true,
        "html-root-node": true,
        "html-valid-children": true,
        "html-valid-children-order": true,
        "img-src-required": true,
        "invalid-attribute-char": true,
        "nested-paragraphs": true,
        "spec-char-escape": true,
        "src-not-empty": true,
        "tag-pair": true
      };
      this.setTimeout(500);
      this.parser = import_htmlhint.HTMLHint;
    }
    setOptions(options) {
      if (options && options.context) {
        delete options.context;
      }
      this.validationOptions = options.validationOptions;
    }
    onUpdate() {
      var _a;
      var value = this.doc.getValue();
      var errors = [];
      try {
        let options = (_a = this.validationOptions) != null ? _a : this.defaultValidationOptions;
        errors = this.parser.verify(value, options).map((el) => {
          return {
            row: el.line - 1,
            column: el.col - 1,
            text: el.message,
            type: el.type === "error" ? "error" : el.type === "warning" ? "warning" : "info"
          };
        });
      } catch (e) {
        console.error(e);
      }
      this.sender.emit("error", errors);
    }
  };
  return __toCommonJS(html_worker_exports);
})();
aceLegacyWorkerModule = aceLegacyWorkerModule.default || aceLegacyWorkerModule;

exports.Worker = aceLegacyWorkerModule.HtmlWorker;
});
