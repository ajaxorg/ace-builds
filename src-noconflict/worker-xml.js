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

ace.define("ace/mode/xml_worker", [], function(require, exports, module) {
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
    "../../node_modules/ace-code/src/lib/deep_copy.js"(exports2) {
      exports2.deepCopy = function deepCopy(obj) {
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
    "../../node_modules/ace-code/src/lib/lang.js"(exports2) {
      "use strict";
      exports2.last = function(a) {
        return a[a.length - 1];
      };
      exports2.stringReverse = function(string) {
        return string.split("").reverse().join("");
      };
      exports2.stringRepeat = function(string, count) {
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
      exports2.stringTrimLeft = function(string) {
        return string.replace(trimBeginRegexp, "");
      };
      exports2.stringTrimRight = function(string) {
        return string.replace(trimEndRegexp, "");
      };
      exports2.copyObject = function(obj) {
        var copy = {};
        for (var key in obj) {
          copy[key] = obj[key];
        }
        return copy;
      };
      exports2.copyArray = function(array) {
        var copy = [];
        for (var i = 0, l = array.length; i < l; i++) {
          if (array[i] && typeof array[i] == "object")
            copy[i] = this.copyObject(array[i]);
          else
            copy[i] = array[i];
        }
        return copy;
      };
      exports2.deepCopy = require_deep_copy().deepCopy;
      exports2.arrayToMap = function(arr) {
        var map2 = {};
        for (var i = 0; i < arr.length; i++) {
          map2[arr[i]] = 1;
        }
        return map2;
      };
      exports2.createMap = function(props) {
        var map2 = /* @__PURE__ */ Object.create(null);
        for (var i in props) {
          map2[i] = props[i];
        }
        return map2;
      };
      exports2.arrayRemove = function(array, value) {
        for (var i = 0; i <= array.length; i++) {
          if (value === array[i]) {
            array.splice(i, 1);
          }
        }
      };
      exports2.escapeRegExp = function(str) {
        return str.replace(/([.*+?^${}()|[\]\/\\])/g, "\\$1");
      };
      exports2.escapeHTML = function(str) {
        return ("" + str).replace(/&/g, "&#38;").replace(/"/g, "&#34;").replace(/'/g, "&#39;").replace(/</g, "&#60;");
      };
      exports2.getMatchOffsets = function(string, regExp) {
        var matches = [];
        string.replace(regExp, function(str) {
          matches.push({
            offset: arguments[arguments.length - 2],
            length: str.length
          });
        });
        return matches;
      };
      exports2.deferredCall = function(fcn) {
        var timer2 = null;
        var callback = function() {
          timer2 = null;
          fcn();
        };
        var deferred = function(timeout) {
          deferred.cancel();
          timer2 = setTimeout(callback, timeout || 0);
          return deferred;
        };
        deferred.schedule = deferred;
        deferred.call = function() {
          this.cancel();
          fcn();
          return deferred;
        };
        deferred.cancel = function() {
          clearTimeout(timer2);
          timer2 = null;
          return deferred;
        };
        deferred.isPending = function() {
          return timer2;
        };
        return deferred;
      };
      exports2.delayedCall = function(fcn, defaultTimeout) {
        var timer2 = null;
        var callback = function() {
          timer2 = null;
          fcn();
        };
        var _self = function(timeout) {
          if (timer2 == null)
            timer2 = setTimeout(callback, timeout || defaultTimeout);
        };
        _self.delay = function(timeout) {
          timer2 && clearTimeout(timer2);
          timer2 = setTimeout(callback, timeout || defaultTimeout);
        };
        _self.schedule = _self;
        _self.call = function() {
          this.cancel();
          fcn();
        };
        _self.cancel = function() {
          timer2 && clearTimeout(timer2);
          timer2 = null;
        };
        _self.isPending = function() {
          return timer2;
        };
        return _self;
      };
      exports2.supportsLookbehind = function() {
        try {
          new RegExp("(?<=.)");
        } catch (e) {
          return false;
        }
        return true;
      };
      exports2.skipEmptyMatch = function(line, last2, supportsUnicodeFlag) {
        return supportsUnicodeFlag && line.codePointAt(last2) > 65535 ? 2 : 1;
      };
    }
  });

  // ../../node_modules/ace-code/src/lib/oop.js
  var require_oop = __commonJS({
    "../../node_modules/ace-code/src/lib/oop.js"(exports2) {
      "use strict";
      exports2.inherits = function(ctor, superCtor) {
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
      exports2.mixin = function(obj, mixin) {
        for (var key in mixin) {
          obj[key] = mixin[key];
        }
        return obj;
      };
      exports2.implement = function(proto, mixin) {
        exports2.mixin(proto, mixin);
      };
    }
  });

  // ../../node_modules/ace-code/src/apply_delta.js
  var require_apply_delta = __commonJS({
    "../../node_modules/ace-code/src/apply_delta.js"(exports2) {
      "use strict";
      exports2.applyDelta = function(docLines, delta, doNotValidate) {
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
    "../../node_modules/ace-code/src/lib/event_emitter.js"(exports2) {
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
      exports2.EventEmitter = EventEmitter2;
    }
  });

  // ../../node_modules/ace-code/src/range.js
  var require_range = __commonJS({
    "../../node_modules/ace-code/src/range.js"(exports2) {
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
      exports2.Range = Range2;
    }
  });

  // ../../node_modules/chevrotain/lib/src/version.js
  var require_version = __commonJS({
    "../../node_modules/chevrotain/lib/src/version.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.VERSION = void 0;
      exports2.VERSION = "7.1.1";
    }
  });

  // ../../node_modules/chevrotain/lib/src/utils/utils.js
  var require_utils = __commonJS({
    "../../node_modules/chevrotain/lib/src/utils/utils.js"(exports, module) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.peek = exports.toFastProperties = exports.applyMixins = exports.isES2015MapSupported = exports.PRINT_WARNING = exports.PRINT_ERROR = exports.packArray = exports.IDENTITY = exports.NOOP = exports.merge = exports.groupBy = exports.defaults = exports.assignNoOverwrite = exports.assign = exports.zipObject = exports.sortBy = exports.indexOf = exports.some = exports.difference = exports.every = exports.isObject = exports.isRegExp = exports.isArray = exports.partial = exports.uniq = exports.compact = exports.reduce = exports.findAll = exports.find = exports.cloneObj = exports.cloneArr = exports.contains = exports.has = exports.pick = exports.reject = exports.filter = exports.dropRight = exports.drop = exports.isFunction = exports.isUndefined = exports.isString = exports.forEach = exports.last = exports.first = exports.flatten = exports.map = exports.mapValues = exports.values = exports.keys = exports.isEmpty = void 0;
      exports.timer = void 0;
      function isEmpty(arr) {
        return arr && arr.length === 0;
      }
      exports.isEmpty = isEmpty;
      function keys(obj) {
        if (obj === void 0 || obj === null) {
          return [];
        }
        return Object.keys(obj);
      }
      exports.keys = keys;
      function values(obj) {
        var vals = [];
        var keys2 = Object.keys(obj);
        for (var i = 0; i < keys2.length; i++) {
          vals.push(obj[keys2[i]]);
        }
        return vals;
      }
      exports.values = values;
      function mapValues(obj, callback) {
        var result = [];
        var objKeys = keys(obj);
        for (var idx = 0; idx < objKeys.length; idx++) {
          var currKey = objKeys[idx];
          result.push(callback.call(null, obj[currKey], currKey));
        }
        return result;
      }
      exports.mapValues = mapValues;
      function map(arr, callback) {
        var result = [];
        for (var idx = 0; idx < arr.length; idx++) {
          result.push(callback.call(null, arr[idx], idx));
        }
        return result;
      }
      exports.map = map;
      function flatten(arr) {
        var result = [];
        for (var idx = 0; idx < arr.length; idx++) {
          var currItem = arr[idx];
          if (Array.isArray(currItem)) {
            result = result.concat(flatten(currItem));
          } else {
            result.push(currItem);
          }
        }
        return result;
      }
      exports.flatten = flatten;
      function first(arr) {
        return isEmpty(arr) ? void 0 : arr[0];
      }
      exports.first = first;
      function last(arr) {
        var len = arr && arr.length;
        return len ? arr[len - 1] : void 0;
      }
      exports.last = last;
      function forEach(collection, iteratorCallback) {
        if (Array.isArray(collection)) {
          for (var i = 0; i < collection.length; i++) {
            iteratorCallback.call(null, collection[i], i);
          }
        } else if (isObject(collection)) {
          var colKeys = keys(collection);
          for (var i = 0; i < colKeys.length; i++) {
            var key = colKeys[i];
            var value = collection[key];
            iteratorCallback.call(null, value, key);
          }
        } else {
          throw Error("non exhaustive match");
        }
      }
      exports.forEach = forEach;
      function isString(item) {
        return typeof item === "string";
      }
      exports.isString = isString;
      function isUndefined(item) {
        return item === void 0;
      }
      exports.isUndefined = isUndefined;
      function isFunction(item) {
        return item instanceof Function;
      }
      exports.isFunction = isFunction;
      function drop(arr, howMuch) {
        if (howMuch === void 0) {
          howMuch = 1;
        }
        return arr.slice(howMuch, arr.length);
      }
      exports.drop = drop;
      function dropRight(arr, howMuch) {
        if (howMuch === void 0) {
          howMuch = 1;
        }
        return arr.slice(0, arr.length - howMuch);
      }
      exports.dropRight = dropRight;
      function filter(arr, predicate) {
        var result = [];
        if (Array.isArray(arr)) {
          for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            if (predicate.call(null, item)) {
              result.push(item);
            }
          }
        }
        return result;
      }
      exports.filter = filter;
      function reject(arr, predicate) {
        return filter(arr, function(item) {
          return !predicate(item);
        });
      }
      exports.reject = reject;
      function pick(obj, predicate) {
        var keys2 = Object.keys(obj);
        var result = {};
        for (var i = 0; i < keys2.length; i++) {
          var currKey = keys2[i];
          var currItem = obj[currKey];
          if (predicate(currItem)) {
            result[currKey] = currItem;
          }
        }
        return result;
      }
      exports.pick = pick;
      function has(obj, prop) {
        if (isObject(obj)) {
          return obj.hasOwnProperty(prop);
        }
        return false;
      }
      exports.has = has;
      function contains(arr, item) {
        return find(arr, function(currItem) {
          return currItem === item;
        }) !== void 0 ? true : false;
      }
      exports.contains = contains;
      function cloneArr(arr) {
        var newArr = [];
        for (var i = 0; i < arr.length; i++) {
          newArr.push(arr[i]);
        }
        return newArr;
      }
      exports.cloneArr = cloneArr;
      function cloneObj(obj) {
        var clonedObj = {};
        for (var key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            clonedObj[key] = obj[key];
          }
        }
        return clonedObj;
      }
      exports.cloneObj = cloneObj;
      function find(arr, predicate) {
        for (var i = 0; i < arr.length; i++) {
          var item = arr[i];
          if (predicate.call(null, item)) {
            return item;
          }
        }
        return void 0;
      }
      exports.find = find;
      function findAll(arr, predicate) {
        var found = [];
        for (var i = 0; i < arr.length; i++) {
          var item = arr[i];
          if (predicate.call(null, item)) {
            found.push(item);
          }
        }
        return found;
      }
      exports.findAll = findAll;
      function reduce(arrOrObj, iterator, initial) {
        var isArr = Array.isArray(arrOrObj);
        var vals = isArr ? arrOrObj : values(arrOrObj);
        var objKeys = isArr ? [] : keys(arrOrObj);
        var accumulator = initial;
        for (var i = 0; i < vals.length; i++) {
          accumulator = iterator.call(null, accumulator, vals[i], isArr ? i : objKeys[i]);
        }
        return accumulator;
      }
      exports.reduce = reduce;
      function compact(arr) {
        return reject(arr, function(item) {
          return item === null || item === void 0;
        });
      }
      exports.compact = compact;
      function uniq(arr, identity) {
        if (identity === void 0) {
          identity = function(item) {
            return item;
          };
        }
        var identities = [];
        return reduce(arr, function(result, currItem) {
          var currIdentity = identity(currItem);
          if (contains(identities, currIdentity)) {
            return result;
          } else {
            identities.push(currIdentity);
            return result.concat(currItem);
          }
        }, []);
      }
      exports.uniq = uniq;
      function partial(func) {
        var restArgs = [];
        for (var _i = 1; _i < arguments.length; _i++) {
          restArgs[_i - 1] = arguments[_i];
        }
        var firstArg = [null];
        var allArgs = firstArg.concat(restArgs);
        return Function.bind.apply(func, allArgs);
      }
      exports.partial = partial;
      function isArray(obj) {
        return Array.isArray(obj);
      }
      exports.isArray = isArray;
      function isRegExp(obj) {
        return obj instanceof RegExp;
      }
      exports.isRegExp = isRegExp;
      function isObject(obj) {
        return obj instanceof Object;
      }
      exports.isObject = isObject;
      function every(arr, predicate) {
        for (var i = 0; i < arr.length; i++) {
          if (!predicate(arr[i], i)) {
            return false;
          }
        }
        return true;
      }
      exports.every = every;
      function difference(arr, values2) {
        return reject(arr, function(item) {
          return contains(values2, item);
        });
      }
      exports.difference = difference;
      function some(arr, predicate) {
        for (var i = 0; i < arr.length; i++) {
          if (predicate(arr[i])) {
            return true;
          }
        }
        return false;
      }
      exports.some = some;
      function indexOf(arr, value) {
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] === value) {
            return i;
          }
        }
        return -1;
      }
      exports.indexOf = indexOf;
      function sortBy(arr, orderFunc) {
        var result = cloneArr(arr);
        result.sort(function(a, b) {
          return orderFunc(a) - orderFunc(b);
        });
        return result;
      }
      exports.sortBy = sortBy;
      function zipObject(keys2, values2) {
        if (keys2.length !== values2.length) {
          throw Error("can't zipObject with different number of keys and values!");
        }
        var result = {};
        for (var i = 0; i < keys2.length; i++) {
          result[keys2[i]] = values2[i];
        }
        return result;
      }
      exports.zipObject = zipObject;
      function assign(target) {
        var sources = [];
        for (var _i = 1; _i < arguments.length; _i++) {
          sources[_i - 1] = arguments[_i];
        }
        for (var i = 0; i < sources.length; i++) {
          var curSource = sources[i];
          var currSourceKeys = keys(curSource);
          for (var j = 0; j < currSourceKeys.length; j++) {
            var currKey = currSourceKeys[j];
            target[currKey] = curSource[currKey];
          }
        }
        return target;
      }
      exports.assign = assign;
      function assignNoOverwrite(target) {
        var sources = [];
        for (var _i = 1; _i < arguments.length; _i++) {
          sources[_i - 1] = arguments[_i];
        }
        for (var i = 0; i < sources.length; i++) {
          var curSource = sources[i];
          var currSourceKeys = keys(curSource);
          for (var j = 0; j < currSourceKeys.length; j++) {
            var currKey = currSourceKeys[j];
            if (!has(target, currKey)) {
              target[currKey] = curSource[currKey];
            }
          }
        }
        return target;
      }
      exports.assignNoOverwrite = assignNoOverwrite;
      function defaults() {
        var sources = [];
        for (var _i = 0; _i < arguments.length; _i++) {
          sources[_i] = arguments[_i];
        }
        return assignNoOverwrite.apply(null, [{}].concat(sources));
      }
      exports.defaults = defaults;
      function groupBy(arr, groupKeyFunc) {
        var result = {};
        forEach(arr, function(item) {
          var currGroupKey = groupKeyFunc(item);
          var currGroupArr = result[currGroupKey];
          if (currGroupArr) {
            currGroupArr.push(item);
          } else {
            result[currGroupKey] = [item];
          }
        });
        return result;
      }
      exports.groupBy = groupBy;
      function merge(obj1, obj2) {
        var result = cloneObj(obj1);
        var keys2 = keys(obj2);
        for (var i = 0; i < keys2.length; i++) {
          var key = keys2[i];
          var value = obj2[key];
          result[key] = value;
        }
        return result;
      }
      exports.merge = merge;
      function NOOP() {
      }
      exports.NOOP = NOOP;
      function IDENTITY(item) {
        return item;
      }
      exports.IDENTITY = IDENTITY;
      function packArray(holeyArr) {
        var result = [];
        for (var i = 0; i < holeyArr.length; i++) {
          var orgValue = holeyArr[i];
          result.push(orgValue !== void 0 ? orgValue : void 0);
        }
        return result;
      }
      exports.packArray = packArray;
      function PRINT_ERROR(msg) {
        if (console && console.error) {
          console.error("Error: " + msg);
        }
      }
      exports.PRINT_ERROR = PRINT_ERROR;
      function PRINT_WARNING(msg) {
        if (console && console.warn) {
          console.warn("Warning: " + msg);
        }
      }
      exports.PRINT_WARNING = PRINT_WARNING;
      function isES2015MapSupported() {
        return typeof Map === "function";
      }
      exports.isES2015MapSupported = isES2015MapSupported;
      function applyMixins(derivedCtor, baseCtors) {
        baseCtors.forEach(function(baseCtor) {
          var baseProto = baseCtor.prototype;
          Object.getOwnPropertyNames(baseProto).forEach(function(propName) {
            if (propName === "constructor") {
              return;
            }
            var basePropDescriptor = Object.getOwnPropertyDescriptor(baseProto, propName);
            if (basePropDescriptor && (basePropDescriptor.get || basePropDescriptor.set)) {
              Object.defineProperty(derivedCtor.prototype, propName, basePropDescriptor);
            } else {
              derivedCtor.prototype[propName] = baseCtor.prototype[propName];
            }
          });
        });
      }
      exports.applyMixins = applyMixins;
      function toFastProperties(toBecomeFast) {
        function FakeConstructor() {
        }
        FakeConstructor.prototype = toBecomeFast;
        var fakeInstance = new FakeConstructor();
        function fakeAccess() {
          return typeof fakeInstance.bar;
        }
        fakeAccess();
        fakeAccess();
        return toBecomeFast;
        eval(toBecomeFast);
      }
      exports.toFastProperties = toFastProperties;
      function peek(arr) {
        return arr[arr.length - 1];
      }
      exports.peek = peek;
      function timer(func) {
        var start = (/* @__PURE__ */ new Date()).getTime();
        var val = func();
        var end = (/* @__PURE__ */ new Date()).getTime();
        var total = end - start;
        return { time: total, value: val };
      }
      exports.timer = timer;
    }
  });

  // ../../node_modules/regexp-to-ast/lib/regexp-to-ast.js
  var require_regexp_to_ast = __commonJS({
    "../../node_modules/regexp-to-ast/lib/regexp-to-ast.js"(exports2, module2) {
      (function(root, factory) {
        if (typeof define === "function" && define.amd) {
          define([], factory);
        } else if (typeof module2 === "object" && module2.exports) {
          module2.exports = factory();
        } else {
          root.regexpToAst = factory();
        }
      })(
        typeof self !== "undefined" ? (
          // istanbul ignore next
          self
        ) : exports2,
        function() {
          function RegExpParser() {
          }
          RegExpParser.prototype.saveState = function() {
            return {
              idx: this.idx,
              input: this.input,
              groupIdx: this.groupIdx
            };
          };
          RegExpParser.prototype.restoreState = function(newState) {
            this.idx = newState.idx;
            this.input = newState.input;
            this.groupIdx = newState.groupIdx;
          };
          RegExpParser.prototype.pattern = function(input) {
            this.idx = 0;
            this.input = input;
            this.groupIdx = 0;
            this.consumeChar("/");
            var value = this.disjunction();
            this.consumeChar("/");
            var flags = {
              type: "Flags",
              loc: { begin: this.idx, end: input.length },
              global: false,
              ignoreCase: false,
              multiLine: false,
              unicode: false,
              sticky: false
            };
            while (this.isRegExpFlag()) {
              switch (this.popChar()) {
                case "g":
                  addFlag(flags, "global");
                  break;
                case "i":
                  addFlag(flags, "ignoreCase");
                  break;
                case "m":
                  addFlag(flags, "multiLine");
                  break;
                case "u":
                  addFlag(flags, "unicode");
                  break;
                case "y":
                  addFlag(flags, "sticky");
                  break;
              }
            }
            if (this.idx !== this.input.length) {
              throw Error(
                "Redundant input: " + this.input.substring(this.idx)
              );
            }
            return {
              type: "Pattern",
              flags,
              value,
              loc: this.loc(0)
            };
          };
          RegExpParser.prototype.disjunction = function() {
            var alts = [];
            var begin = this.idx;
            alts.push(this.alternative());
            while (this.peekChar() === "|") {
              this.consumeChar("|");
              alts.push(this.alternative());
            }
            return { type: "Disjunction", value: alts, loc: this.loc(begin) };
          };
          RegExpParser.prototype.alternative = function() {
            var terms = [];
            var begin = this.idx;
            while (this.isTerm()) {
              terms.push(this.term());
            }
            return { type: "Alternative", value: terms, loc: this.loc(begin) };
          };
          RegExpParser.prototype.term = function() {
            if (this.isAssertion()) {
              return this.assertion();
            } else {
              return this.atom();
            }
          };
          RegExpParser.prototype.assertion = function() {
            var begin = this.idx;
            switch (this.popChar()) {
              case "^":
                return {
                  type: "StartAnchor",
                  loc: this.loc(begin)
                };
              case "$":
                return { type: "EndAnchor", loc: this.loc(begin) };
              // '\b' or '\B'
              case "\\":
                switch (this.popChar()) {
                  case "b":
                    return {
                      type: "WordBoundary",
                      loc: this.loc(begin)
                    };
                  case "B":
                    return {
                      type: "NonWordBoundary",
                      loc: this.loc(begin)
                    };
                }
                throw Error("Invalid Assertion Escape");
              // '(?=' or '(?!'
              case "(":
                this.consumeChar("?");
                var type;
                switch (this.popChar()) {
                  case "=":
                    type = "Lookahead";
                    break;
                  case "!":
                    type = "NegativeLookahead";
                    break;
                }
                ASSERT_EXISTS(type);
                var disjunction = this.disjunction();
                this.consumeChar(")");
                return {
                  type,
                  value: disjunction,
                  loc: this.loc(begin)
                };
            }
            ASSERT_NEVER_REACH_HERE();
          };
          RegExpParser.prototype.quantifier = function(isBacktracking) {
            var range;
            var begin = this.idx;
            switch (this.popChar()) {
              case "*":
                range = {
                  atLeast: 0,
                  atMost: Infinity
                };
                break;
              case "+":
                range = {
                  atLeast: 1,
                  atMost: Infinity
                };
                break;
              case "?":
                range = {
                  atLeast: 0,
                  atMost: 1
                };
                break;
              case "{":
                var atLeast = this.integerIncludingZero();
                switch (this.popChar()) {
                  case "}":
                    range = {
                      atLeast,
                      atMost: atLeast
                    };
                    break;
                  case ",":
                    var atMost;
                    if (this.isDigit()) {
                      atMost = this.integerIncludingZero();
                      range = {
                        atLeast,
                        atMost
                      };
                    } else {
                      range = {
                        atLeast,
                        atMost: Infinity
                      };
                    }
                    this.consumeChar("}");
                    break;
                }
                if (isBacktracking === true && range === void 0) {
                  return void 0;
                }
                ASSERT_EXISTS(range);
                break;
            }
            if (isBacktracking === true && range === void 0) {
              return void 0;
            }
            ASSERT_EXISTS(range);
            if (this.peekChar(0) === "?") {
              this.consumeChar("?");
              range.greedy = false;
            } else {
              range.greedy = true;
            }
            range.type = "Quantifier";
            range.loc = this.loc(begin);
            return range;
          };
          RegExpParser.prototype.atom = function() {
            var atom;
            var begin = this.idx;
            switch (this.peekChar()) {
              case ".":
                atom = this.dotAll();
                break;
              case "\\":
                atom = this.atomEscape();
                break;
              case "[":
                atom = this.characterClass();
                break;
              case "(":
                atom = this.group();
                break;
            }
            if (atom === void 0 && this.isPatternCharacter()) {
              atom = this.patternCharacter();
            }
            ASSERT_EXISTS(atom);
            atom.loc = this.loc(begin);
            if (this.isQuantifier()) {
              atom.quantifier = this.quantifier();
            }
            return atom;
          };
          RegExpParser.prototype.dotAll = function() {
            this.consumeChar(".");
            return {
              type: "Set",
              complement: true,
              value: [cc("\n"), cc("\r"), cc("\u2028"), cc("\u2029")]
            };
          };
          RegExpParser.prototype.atomEscape = function() {
            this.consumeChar("\\");
            switch (this.peekChar()) {
              case "1":
              case "2":
              case "3":
              case "4":
              case "5":
              case "6":
              case "7":
              case "8":
              case "9":
                return this.decimalEscapeAtom();
              case "d":
              case "D":
              case "s":
              case "S":
              case "w":
              case "W":
                return this.characterClassEscape();
              case "f":
              case "n":
              case "r":
              case "t":
              case "v":
                return this.controlEscapeAtom();
              case "c":
                return this.controlLetterEscapeAtom();
              case "0":
                return this.nulCharacterAtom();
              case "x":
                return this.hexEscapeSequenceAtom();
              case "u":
                return this.regExpUnicodeEscapeSequenceAtom();
              default:
                return this.identityEscapeAtom();
            }
          };
          RegExpParser.prototype.decimalEscapeAtom = function() {
            var value = this.positiveInteger();
            return { type: "GroupBackReference", value };
          };
          RegExpParser.prototype.characterClassEscape = function() {
            var set;
            var complement = false;
            switch (this.popChar()) {
              case "d":
                set = digitsCharCodes;
                break;
              case "D":
                set = digitsCharCodes;
                complement = true;
                break;
              case "s":
                set = whitespaceCodes;
                break;
              case "S":
                set = whitespaceCodes;
                complement = true;
                break;
              case "w":
                set = wordCharCodes;
                break;
              case "W":
                set = wordCharCodes;
                complement = true;
                break;
            }
            ASSERT_EXISTS(set);
            return { type: "Set", value: set, complement };
          };
          RegExpParser.prototype.controlEscapeAtom = function() {
            var escapeCode;
            switch (this.popChar()) {
              case "f":
                escapeCode = cc("\f");
                break;
              case "n":
                escapeCode = cc("\n");
                break;
              case "r":
                escapeCode = cc("\r");
                break;
              case "t":
                escapeCode = cc("	");
                break;
              case "v":
                escapeCode = cc("\v");
                break;
            }
            ASSERT_EXISTS(escapeCode);
            return { type: "Character", value: escapeCode };
          };
          RegExpParser.prototype.controlLetterEscapeAtom = function() {
            this.consumeChar("c");
            var letter = this.popChar();
            if (/[a-zA-Z]/.test(letter) === false) {
              throw Error("Invalid ");
            }
            var letterCode = letter.toUpperCase().charCodeAt(0) - 64;
            return { type: "Character", value: letterCode };
          };
          RegExpParser.prototype.nulCharacterAtom = function() {
            this.consumeChar("0");
            return { type: "Character", value: cc("\0") };
          };
          RegExpParser.prototype.hexEscapeSequenceAtom = function() {
            this.consumeChar("x");
            return this.parseHexDigits(2);
          };
          RegExpParser.prototype.regExpUnicodeEscapeSequenceAtom = function() {
            this.consumeChar("u");
            return this.parseHexDigits(4);
          };
          RegExpParser.prototype.identityEscapeAtom = function() {
            var escapedChar = this.popChar();
            return { type: "Character", value: cc(escapedChar) };
          };
          RegExpParser.prototype.classPatternCharacterAtom = function() {
            switch (this.peekChar()) {
              // istanbul ignore next
              case "\n":
              // istanbul ignore next
              case "\r":
              // istanbul ignore next
              case "\u2028":
              // istanbul ignore next
              case "\u2029":
              // istanbul ignore next
              case "\\":
              // istanbul ignore next
              case "]":
                throw Error("TBD");
              default:
                var nextChar = this.popChar();
                return { type: "Character", value: cc(nextChar) };
            }
          };
          RegExpParser.prototype.characterClass = function() {
            var set = [];
            var complement = false;
            this.consumeChar("[");
            if (this.peekChar(0) === "^") {
              this.consumeChar("^");
              complement = true;
            }
            while (this.isClassAtom()) {
              var from = this.classAtom();
              var isFromSingleChar = from.type === "Character";
              if (isFromSingleChar && this.isRangeDash()) {
                this.consumeChar("-");
                var to = this.classAtom();
                var isToSingleChar = to.type === "Character";
                if (isToSingleChar) {
                  if (to.value < from.value) {
                    throw Error("Range out of order in character class");
                  }
                  set.push({ from: from.value, to: to.value });
                } else {
                  insertToSet(from.value, set);
                  set.push(cc("-"));
                  insertToSet(to.value, set);
                }
              } else {
                insertToSet(from.value, set);
              }
            }
            this.consumeChar("]");
            return { type: "Set", complement, value: set };
          };
          RegExpParser.prototype.classAtom = function() {
            switch (this.peekChar()) {
              // istanbul ignore next
              case "]":
              // istanbul ignore next
              case "\n":
              // istanbul ignore next
              case "\r":
              // istanbul ignore next
              case "\u2028":
              // istanbul ignore next
              case "\u2029":
                throw Error("TBD");
              case "\\":
                return this.classEscape();
              default:
                return this.classPatternCharacterAtom();
            }
          };
          RegExpParser.prototype.classEscape = function() {
            this.consumeChar("\\");
            switch (this.peekChar()) {
              // Matches a backspace.
              // (Not to be confused with \b word boundary outside characterClass)
              case "b":
                this.consumeChar("b");
                return { type: "Character", value: cc("\b") };
              case "d":
              case "D":
              case "s":
              case "S":
              case "w":
              case "W":
                return this.characterClassEscape();
              case "f":
              case "n":
              case "r":
              case "t":
              case "v":
                return this.controlEscapeAtom();
              case "c":
                return this.controlLetterEscapeAtom();
              case "0":
                return this.nulCharacterAtom();
              case "x":
                return this.hexEscapeSequenceAtom();
              case "u":
                return this.regExpUnicodeEscapeSequenceAtom();
              default:
                return this.identityEscapeAtom();
            }
          };
          RegExpParser.prototype.group = function() {
            var capturing = true;
            this.consumeChar("(");
            switch (this.peekChar(0)) {
              case "?":
                this.consumeChar("?");
                this.consumeChar(":");
                capturing = false;
                break;
              default:
                this.groupIdx++;
                break;
            }
            var value = this.disjunction();
            this.consumeChar(")");
            var groupAst = {
              type: "Group",
              capturing,
              value
            };
            if (capturing) {
              groupAst.idx = this.groupIdx;
            }
            return groupAst;
          };
          RegExpParser.prototype.positiveInteger = function() {
            var number = this.popChar();
            if (decimalPatternNoZero.test(number) === false) {
              throw Error("Expecting a positive integer");
            }
            while (decimalPattern.test(this.peekChar(0))) {
              number += this.popChar();
            }
            return parseInt(number, 10);
          };
          RegExpParser.prototype.integerIncludingZero = function() {
            var number = this.popChar();
            if (decimalPattern.test(number) === false) {
              throw Error("Expecting an integer");
            }
            while (decimalPattern.test(this.peekChar(0))) {
              number += this.popChar();
            }
            return parseInt(number, 10);
          };
          RegExpParser.prototype.patternCharacter = function() {
            var nextChar = this.popChar();
            switch (nextChar) {
              // istanbul ignore next
              case "\n":
              // istanbul ignore next
              case "\r":
              // istanbul ignore next
              case "\u2028":
              // istanbul ignore next
              case "\u2029":
              // istanbul ignore next
              case "^":
              // istanbul ignore next
              case "$":
              // istanbul ignore next
              case "\\":
              // istanbul ignore next
              case ".":
              // istanbul ignore next
              case "*":
              // istanbul ignore next
              case "+":
              // istanbul ignore next
              case "?":
              // istanbul ignore next
              case "(":
              // istanbul ignore next
              case ")":
              // istanbul ignore next
              case "[":
              // istanbul ignore next
              case "|":
                throw Error("TBD");
              default:
                return { type: "Character", value: cc(nextChar) };
            }
          };
          RegExpParser.prototype.isRegExpFlag = function() {
            switch (this.peekChar(0)) {
              case "g":
              case "i":
              case "m":
              case "u":
              case "y":
                return true;
              default:
                return false;
            }
          };
          RegExpParser.prototype.isRangeDash = function() {
            return this.peekChar() === "-" && this.isClassAtom(1);
          };
          RegExpParser.prototype.isDigit = function() {
            return decimalPattern.test(this.peekChar(0));
          };
          RegExpParser.prototype.isClassAtom = function(howMuch) {
            if (howMuch === void 0) {
              howMuch = 0;
            }
            switch (this.peekChar(howMuch)) {
              case "]":
              case "\n":
              case "\r":
              case "\u2028":
              case "\u2029":
                return false;
              default:
                return true;
            }
          };
          RegExpParser.prototype.isTerm = function() {
            return this.isAtom() || this.isAssertion();
          };
          RegExpParser.prototype.isAtom = function() {
            if (this.isPatternCharacter()) {
              return true;
            }
            switch (this.peekChar(0)) {
              case ".":
              case "\\":
              // atomEscape
              case "[":
              // characterClass
              // TODO: isAtom must be called before isAssertion - disambiguate
              case "(":
                return true;
              default:
                return false;
            }
          };
          RegExpParser.prototype.isAssertion = function() {
            switch (this.peekChar(0)) {
              case "^":
              case "$":
                return true;
              // '\b' or '\B'
              case "\\":
                switch (this.peekChar(1)) {
                  case "b":
                  case "B":
                    return true;
                  default:
                    return false;
                }
              // '(?=' or '(?!'
              case "(":
                return this.peekChar(1) === "?" && (this.peekChar(2) === "=" || this.peekChar(2) === "!");
              default:
                return false;
            }
          };
          RegExpParser.prototype.isQuantifier = function() {
            var prevState = this.saveState();
            try {
              return this.quantifier(true) !== void 0;
            } catch (e) {
              return false;
            } finally {
              this.restoreState(prevState);
            }
          };
          RegExpParser.prototype.isPatternCharacter = function() {
            switch (this.peekChar()) {
              case "^":
              case "$":
              case "\\":
              case ".":
              case "*":
              case "+":
              case "?":
              case "(":
              case ")":
              case "[":
              case "|":
              case "/":
              case "\n":
              case "\r":
              case "\u2028":
              case "\u2029":
                return false;
              default:
                return true;
            }
          };
          RegExpParser.prototype.parseHexDigits = function(howMany) {
            var hexString = "";
            for (var i2 = 0; i2 < howMany; i2++) {
              var hexChar = this.popChar();
              if (hexDigitPattern.test(hexChar) === false) {
                throw Error("Expecting a HexDecimal digits");
              }
              hexString += hexChar;
            }
            var charCode = parseInt(hexString, 16);
            return { type: "Character", value: charCode };
          };
          RegExpParser.prototype.peekChar = function(howMuch) {
            if (howMuch === void 0) {
              howMuch = 0;
            }
            return this.input[this.idx + howMuch];
          };
          RegExpParser.prototype.popChar = function() {
            var nextChar = this.peekChar(0);
            this.consumeChar();
            return nextChar;
          };
          RegExpParser.prototype.consumeChar = function(char) {
            if (char !== void 0 && this.input[this.idx] !== char) {
              throw Error(
                "Expected: '" + char + "' but found: '" + this.input[this.idx] + "' at offset: " + this.idx
              );
            }
            if (this.idx >= this.input.length) {
              throw Error("Unexpected end of input");
            }
            this.idx++;
          };
          RegExpParser.prototype.loc = function(begin) {
            return { begin, end: this.idx };
          };
          var hexDigitPattern = /[0-9a-fA-F]/;
          var decimalPattern = /[0-9]/;
          var decimalPatternNoZero = /[1-9]/;
          function cc(char) {
            return char.charCodeAt(0);
          }
          function insertToSet(item, set) {
            if (item.length !== void 0) {
              item.forEach(function(subItem) {
                set.push(subItem);
              });
            } else {
              set.push(item);
            }
          }
          function addFlag(flagObj, flagKey) {
            if (flagObj[flagKey] === true) {
              throw "duplicate flag " + flagKey;
            }
            flagObj[flagKey] = true;
          }
          function ASSERT_EXISTS(obj) {
            if (obj === void 0) {
              throw Error("Internal Error - Should never get here!");
            }
          }
          function ASSERT_NEVER_REACH_HERE() {
            throw Error("Internal Error - Should never get here!");
          }
          var i;
          var digitsCharCodes = [];
          for (i = cc("0"); i <= cc("9"); i++) {
            digitsCharCodes.push(i);
          }
          var wordCharCodes = [cc("_")].concat(digitsCharCodes);
          for (i = cc("a"); i <= cc("z"); i++) {
            wordCharCodes.push(i);
          }
          for (i = cc("A"); i <= cc("Z"); i++) {
            wordCharCodes.push(i);
          }
          var whitespaceCodes = [
            cc(" "),
            cc("\f"),
            cc("\n"),
            cc("\r"),
            cc("	"),
            cc("\v"),
            cc("	"),
            cc("\xA0"),
            cc("\u1680"),
            cc("\u2000"),
            cc("\u2001"),
            cc("\u2002"),
            cc("\u2003"),
            cc("\u2004"),
            cc("\u2005"),
            cc("\u2006"),
            cc("\u2007"),
            cc("\u2008"),
            cc("\u2009"),
            cc("\u200A"),
            cc("\u2028"),
            cc("\u2029"),
            cc("\u202F"),
            cc("\u205F"),
            cc("\u3000"),
            cc("\uFEFF")
          ];
          function BaseRegExpVisitor() {
          }
          BaseRegExpVisitor.prototype.visitChildren = function(node) {
            for (var key in node) {
              var child = node[key];
              if (node.hasOwnProperty(key)) {
                if (child.type !== void 0) {
                  this.visit(child);
                } else if (Array.isArray(child)) {
                  child.forEach(function(subChild) {
                    this.visit(subChild);
                  }, this);
                }
              }
            }
          };
          BaseRegExpVisitor.prototype.visit = function(node) {
            switch (node.type) {
              case "Pattern":
                this.visitPattern(node);
                break;
              case "Flags":
                this.visitFlags(node);
                break;
              case "Disjunction":
                this.visitDisjunction(node);
                break;
              case "Alternative":
                this.visitAlternative(node);
                break;
              case "StartAnchor":
                this.visitStartAnchor(node);
                break;
              case "EndAnchor":
                this.visitEndAnchor(node);
                break;
              case "WordBoundary":
                this.visitWordBoundary(node);
                break;
              case "NonWordBoundary":
                this.visitNonWordBoundary(node);
                break;
              case "Lookahead":
                this.visitLookahead(node);
                break;
              case "NegativeLookahead":
                this.visitNegativeLookahead(node);
                break;
              case "Character":
                this.visitCharacter(node);
                break;
              case "Set":
                this.visitSet(node);
                break;
              case "Group":
                this.visitGroup(node);
                break;
              case "GroupBackReference":
                this.visitGroupBackReference(node);
                break;
              case "Quantifier":
                this.visitQuantifier(node);
                break;
            }
            this.visitChildren(node);
          };
          BaseRegExpVisitor.prototype.visitPattern = function(node) {
          };
          BaseRegExpVisitor.prototype.visitFlags = function(node) {
          };
          BaseRegExpVisitor.prototype.visitDisjunction = function(node) {
          };
          BaseRegExpVisitor.prototype.visitAlternative = function(node) {
          };
          BaseRegExpVisitor.prototype.visitStartAnchor = function(node) {
          };
          BaseRegExpVisitor.prototype.visitEndAnchor = function(node) {
          };
          BaseRegExpVisitor.prototype.visitWordBoundary = function(node) {
          };
          BaseRegExpVisitor.prototype.visitNonWordBoundary = function(node) {
          };
          BaseRegExpVisitor.prototype.visitLookahead = function(node) {
          };
          BaseRegExpVisitor.prototype.visitNegativeLookahead = function(node) {
          };
          BaseRegExpVisitor.prototype.visitCharacter = function(node) {
          };
          BaseRegExpVisitor.prototype.visitSet = function(node) {
          };
          BaseRegExpVisitor.prototype.visitGroup = function(node) {
          };
          BaseRegExpVisitor.prototype.visitGroupBackReference = function(node) {
          };
          BaseRegExpVisitor.prototype.visitQuantifier = function(node) {
          };
          return {
            RegExpParser,
            BaseRegExpVisitor,
            VERSION: "0.5.0"
          };
        }
      );
    }
  });

  // ../../node_modules/chevrotain/lib/src/scan/reg_exp_parser.js
  var require_reg_exp_parser = __commonJS({
    "../../node_modules/chevrotain/lib/src/scan/reg_exp_parser.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.clearRegExpParserCache = exports2.getRegExpAst = void 0;
      var regexp_to_ast_1 = require_regexp_to_ast();
      var regExpAstCache = {};
      var regExpParser = new regexp_to_ast_1.RegExpParser();
      function getRegExpAst(regExp) {
        var regExpStr = regExp.toString();
        if (regExpAstCache.hasOwnProperty(regExpStr)) {
          return regExpAstCache[regExpStr];
        } else {
          var regExpAst = regExpParser.pattern(regExpStr);
          regExpAstCache[regExpStr] = regExpAst;
          return regExpAst;
        }
      }
      exports2.getRegExpAst = getRegExpAst;
      function clearRegExpParserCache() {
        regExpAstCache = {};
      }
      exports2.clearRegExpParserCache = clearRegExpParserCache;
    }
  });

  // ../../node_modules/chevrotain/lib/src/scan/reg_exp.js
  var require_reg_exp = __commonJS({
    "../../node_modules/chevrotain/lib/src/scan/reg_exp.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.canMatchCharCode = exports2.firstCharOptimizedIndices = exports2.getOptimizedStartCodesIndices = exports2.failedOptimizationPrefixMsg = void 0;
      var regexp_to_ast_1 = require_regexp_to_ast();
      var utils_1 = require_utils();
      var reg_exp_parser_1 = require_reg_exp_parser();
      var lexer_1 = require_lexer();
      var complementErrorMessage = "Complement Sets are not supported for first char optimization";
      exports2.failedOptimizationPrefixMsg = 'Unable to use "first char" lexer optimizations:\n';
      function getOptimizedStartCodesIndices(regExp, ensureOptimizations) {
        if (ensureOptimizations === void 0) {
          ensureOptimizations = false;
        }
        try {
          var ast = reg_exp_parser_1.getRegExpAst(regExp);
          var firstChars = firstCharOptimizedIndices(ast.value, {}, ast.flags.ignoreCase);
          return firstChars;
        } catch (e) {
          if (e.message === complementErrorMessage) {
            if (ensureOptimizations) {
              utils_1.PRINT_WARNING("" + exports2.failedOptimizationPrefixMsg + ("	Unable to optimize: < " + regExp.toString() + " >\n") + "	Complement Sets cannot be automatically optimized.\n	This will disable the lexer's first char optimizations.\n	See: https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#COMPLEMENT for details.");
            }
          } else {
            var msgSuffix = "";
            if (ensureOptimizations) {
              msgSuffix = "\n	This will disable the lexer's first char optimizations.\n	See: https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#REGEXP_PARSING for details.";
            }
            utils_1.PRINT_ERROR(exports2.failedOptimizationPrefixMsg + "\n" + ("	Failed parsing: < " + regExp.toString() + " >\n") + ("	Using the regexp-to-ast library version: " + regexp_to_ast_1.VERSION + "\n") + "	Please open an issue at: https://github.com/bd82/regexp-to-ast/issues" + msgSuffix);
          }
        }
        return [];
      }
      exports2.getOptimizedStartCodesIndices = getOptimizedStartCodesIndices;
      function firstCharOptimizedIndices(ast, result, ignoreCase) {
        switch (ast.type) {
          case "Disjunction":
            for (var i = 0; i < ast.value.length; i++) {
              firstCharOptimizedIndices(ast.value[i], result, ignoreCase);
            }
            break;
          case "Alternative":
            var terms = ast.value;
            for (var i = 0; i < terms.length; i++) {
              var term = terms[i];
              switch (term.type) {
                case "EndAnchor":
                // A group back reference cannot affect potential starting char.
                // because if a back reference is the first production than automatically
                // the group being referenced has had to come BEFORE so its codes have already been added
                case "GroupBackReference":
                // assertions do not affect potential starting codes
                case "Lookahead":
                case "NegativeLookahead":
                case "StartAnchor":
                case "WordBoundary":
                case "NonWordBoundary":
                  continue;
              }
              var atom = term;
              switch (atom.type) {
                case "Character":
                  addOptimizedIdxToResult(atom.value, result, ignoreCase);
                  break;
                case "Set":
                  if (atom.complement === true) {
                    throw Error(complementErrorMessage);
                  }
                  utils_1.forEach(atom.value, function(code) {
                    if (typeof code === "number") {
                      addOptimizedIdxToResult(code, result, ignoreCase);
                    } else {
                      var range = code;
                      if (ignoreCase === true) {
                        for (var rangeCode = range.from; rangeCode <= range.to; rangeCode++) {
                          addOptimizedIdxToResult(rangeCode, result, ignoreCase);
                        }
                      } else {
                        for (var rangeCode = range.from; rangeCode <= range.to && rangeCode < lexer_1.minOptimizationVal; rangeCode++) {
                          addOptimizedIdxToResult(rangeCode, result, ignoreCase);
                        }
                        if (range.to >= lexer_1.minOptimizationVal) {
                          var minUnOptVal = range.from >= lexer_1.minOptimizationVal ? range.from : lexer_1.minOptimizationVal;
                          var maxUnOptVal = range.to;
                          var minOptIdx = lexer_1.charCodeToOptimizedIndex(minUnOptVal);
                          var maxOptIdx = lexer_1.charCodeToOptimizedIndex(maxUnOptVal);
                          for (var currOptIdx = minOptIdx; currOptIdx <= maxOptIdx; currOptIdx++) {
                            result[currOptIdx] = currOptIdx;
                          }
                        }
                      }
                    }
                  });
                  break;
                case "Group":
                  firstCharOptimizedIndices(atom.value, result, ignoreCase);
                  break;
                /* istanbul ignore next */
                default:
                  throw Error("Non Exhaustive Match");
              }
              var isOptionalQuantifier = atom.quantifier !== void 0 && atom.quantifier.atLeast === 0;
              if (
                // A group may be optional due to empty contents /(?:)/
                // or if everything inside it is optional /((a)?)/
                atom.type === "Group" && isWholeOptional(atom) === false || // If this term is not a group it may only be optional if it has an optional quantifier
                atom.type !== "Group" && isOptionalQuantifier === false
              ) {
                break;
              }
            }
            break;
          /* istanbul ignore next */
          default:
            throw Error("non exhaustive match!");
        }
        return utils_1.values(result);
      }
      exports2.firstCharOptimizedIndices = firstCharOptimizedIndices;
      function addOptimizedIdxToResult(code, result, ignoreCase) {
        var optimizedCharIdx = lexer_1.charCodeToOptimizedIndex(code);
        result[optimizedCharIdx] = optimizedCharIdx;
        if (ignoreCase === true) {
          handleIgnoreCase(code, result);
        }
      }
      function handleIgnoreCase(code, result) {
        var char = String.fromCharCode(code);
        var upperChar = char.toUpperCase();
        if (upperChar !== char) {
          var optimizedCharIdx = lexer_1.charCodeToOptimizedIndex(upperChar.charCodeAt(0));
          result[optimizedCharIdx] = optimizedCharIdx;
        } else {
          var lowerChar = char.toLowerCase();
          if (lowerChar !== char) {
            var optimizedCharIdx = lexer_1.charCodeToOptimizedIndex(lowerChar.charCodeAt(0));
            result[optimizedCharIdx] = optimizedCharIdx;
          }
        }
      }
      function findCode(setNode, targetCharCodes) {
        return utils_1.find(setNode.value, function(codeOrRange) {
          if (typeof codeOrRange === "number") {
            return utils_1.contains(targetCharCodes, codeOrRange);
          } else {
            var range_1 = codeOrRange;
            return utils_1.find(targetCharCodes, function(targetCode) {
              return range_1.from <= targetCode && targetCode <= range_1.to;
            }) !== void 0;
          }
        });
      }
      function isWholeOptional(ast) {
        if (ast.quantifier && ast.quantifier.atLeast === 0) {
          return true;
        }
        if (!ast.value) {
          return false;
        }
        return utils_1.isArray(ast.value) ? utils_1.every(ast.value, isWholeOptional) : isWholeOptional(ast.value);
      }
      var CharCodeFinder = (
        /** @class */
        (function(_super) {
          __extends(CharCodeFinder2, _super);
          function CharCodeFinder2(targetCharCodes) {
            var _this = _super.call(this) || this;
            _this.targetCharCodes = targetCharCodes;
            _this.found = false;
            return _this;
          }
          CharCodeFinder2.prototype.visitChildren = function(node) {
            if (this.found === true) {
              return;
            }
            switch (node.type) {
              case "Lookahead":
                this.visitLookahead(node);
                return;
              case "NegativeLookahead":
                this.visitNegativeLookahead(node);
                return;
            }
            _super.prototype.visitChildren.call(this, node);
          };
          CharCodeFinder2.prototype.visitCharacter = function(node) {
            if (utils_1.contains(this.targetCharCodes, node.value)) {
              this.found = true;
            }
          };
          CharCodeFinder2.prototype.visitSet = function(node) {
            if (node.complement) {
              if (findCode(node, this.targetCharCodes) === void 0) {
                this.found = true;
              }
            } else {
              if (findCode(node, this.targetCharCodes) !== void 0) {
                this.found = true;
              }
            }
          };
          return CharCodeFinder2;
        })(regexp_to_ast_1.BaseRegExpVisitor)
      );
      function canMatchCharCode(charCodes, pattern) {
        if (pattern instanceof RegExp) {
          var ast = reg_exp_parser_1.getRegExpAst(pattern);
          var charCodeFinder = new CharCodeFinder(charCodes);
          charCodeFinder.visit(ast);
          return charCodeFinder.found;
        } else {
          return utils_1.find(pattern, function(char) {
            return utils_1.contains(charCodes, char.charCodeAt(0));
          }) !== void 0;
        }
      }
      exports2.canMatchCharCode = canMatchCharCode;
    }
  });

  // ../../node_modules/chevrotain/lib/src/scan/lexer.js
  var require_lexer = __commonJS({
    "../../node_modules/chevrotain/lib/src/scan/lexer.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.charCodeToOptimizedIndex = exports2.minOptimizationVal = exports2.buildLineBreakIssueMessage = exports2.LineTerminatorOptimizedTester = exports2.isShortPattern = exports2.isCustomPattern = exports2.cloneEmptyGroups = exports2.performWarningRuntimeChecks = exports2.performRuntimeChecks = exports2.addStickyFlag = exports2.addStartOfInput = exports2.findUnreachablePatterns = exports2.findModesThatDoNotExist = exports2.findInvalidGroupType = exports2.findDuplicatePatterns = exports2.findUnsupportedFlags = exports2.findStartOfInputAnchor = exports2.findEmptyMatchRegExps = exports2.findEndOfInputAnchor = exports2.findInvalidPatterns = exports2.findMissingPatterns = exports2.validatePatterns = exports2.analyzeTokenTypes = exports2.enableSticky = exports2.disableSticky = exports2.SUPPORT_STICKY = exports2.MODES = exports2.DEFAULT_MODE = void 0;
      var regexp_to_ast_1 = require_regexp_to_ast();
      var lexer_public_1 = require_lexer_public();
      var utils_1 = require_utils();
      var reg_exp_1 = require_reg_exp();
      var reg_exp_parser_1 = require_reg_exp_parser();
      var PATTERN = "PATTERN";
      exports2.DEFAULT_MODE = "defaultMode";
      exports2.MODES = "modes";
      exports2.SUPPORT_STICKY = typeof new RegExp("(?:)").sticky === "boolean";
      function disableSticky() {
        exports2.SUPPORT_STICKY = false;
      }
      exports2.disableSticky = disableSticky;
      function enableSticky() {
        exports2.SUPPORT_STICKY = true;
      }
      exports2.enableSticky = enableSticky;
      function analyzeTokenTypes(tokenTypes, options) {
        options = utils_1.defaults(options, {
          useSticky: exports2.SUPPORT_STICKY,
          debug: false,
          safeMode: false,
          positionTracking: "full",
          lineTerminatorCharacters: ["\r", "\n"],
          tracer: function(msg, action) {
            return action();
          }
        });
        var tracer = options.tracer;
        tracer("initCharCodeToOptimizedIndexMap", function() {
          initCharCodeToOptimizedIndexMap();
        });
        var onlyRelevantTypes;
        tracer("Reject Lexer.NA", function() {
          onlyRelevantTypes = utils_1.reject(tokenTypes, function(currType) {
            return currType[PATTERN] === lexer_public_1.Lexer.NA;
          });
        });
        var hasCustom = false;
        var allTransformedPatterns;
        tracer("Transform Patterns", function() {
          hasCustom = false;
          allTransformedPatterns = utils_1.map(onlyRelevantTypes, function(currType) {
            var currPattern = currType[PATTERN];
            if (utils_1.isRegExp(currPattern)) {
              var regExpSource = currPattern.source;
              if (regExpSource.length === 1 && // only these regExp meta characters which can appear in a length one regExp
              regExpSource !== "^" && regExpSource !== "$" && regExpSource !== "." && !currPattern.ignoreCase) {
                return regExpSource;
              } else if (regExpSource.length === 2 && regExpSource[0] === "\\" && // not a meta character
              !utils_1.contains([
                "d",
                "D",
                "s",
                "S",
                "t",
                "r",
                "n",
                "t",
                "0",
                "c",
                "b",
                "B",
                "f",
                "v",
                "w",
                "W"
              ], regExpSource[1])) {
                return regExpSource[1];
              } else {
                return options.useSticky ? addStickyFlag(currPattern) : addStartOfInput(currPattern);
              }
            } else if (utils_1.isFunction(currPattern)) {
              hasCustom = true;
              return { exec: currPattern };
            } else if (utils_1.has(currPattern, "exec")) {
              hasCustom = true;
              return currPattern;
            } else if (typeof currPattern === "string") {
              if (currPattern.length === 1) {
                return currPattern;
              } else {
                var escapedRegExpString = currPattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
                var wrappedRegExp = new RegExp(escapedRegExpString);
                return options.useSticky ? addStickyFlag(wrappedRegExp) : addStartOfInput(wrappedRegExp);
              }
            } else {
              throw Error("non exhaustive match");
            }
          });
        });
        var patternIdxToType;
        var patternIdxToGroup;
        var patternIdxToLongerAltIdx;
        var patternIdxToPushMode;
        var patternIdxToPopMode;
        tracer("misc mapping", function() {
          patternIdxToType = utils_1.map(onlyRelevantTypes, function(currType) {
            return currType.tokenTypeIdx;
          });
          patternIdxToGroup = utils_1.map(onlyRelevantTypes, function(clazz) {
            var groupName = clazz.GROUP;
            if (groupName === lexer_public_1.Lexer.SKIPPED) {
              return void 0;
            } else if (utils_1.isString(groupName)) {
              return groupName;
            } else if (utils_1.isUndefined(groupName)) {
              return false;
            } else {
              throw Error("non exhaustive match");
            }
          });
          patternIdxToLongerAltIdx = utils_1.map(onlyRelevantTypes, function(clazz) {
            var longerAltType = clazz.LONGER_ALT;
            if (longerAltType) {
              var longerAltIdx = utils_1.indexOf(onlyRelevantTypes, longerAltType);
              return longerAltIdx;
            }
          });
          patternIdxToPushMode = utils_1.map(onlyRelevantTypes, function(clazz) {
            return clazz.PUSH_MODE;
          });
          patternIdxToPopMode = utils_1.map(onlyRelevantTypes, function(clazz) {
            return utils_1.has(clazz, "POP_MODE");
          });
        });
        var patternIdxToCanLineTerminator;
        tracer("Line Terminator Handling", function() {
          var lineTerminatorCharCodes = getCharCodes(options.lineTerminatorCharacters);
          patternIdxToCanLineTerminator = utils_1.map(onlyRelevantTypes, function(tokType) {
            return false;
          });
          if (options.positionTracking !== "onlyOffset") {
            patternIdxToCanLineTerminator = utils_1.map(onlyRelevantTypes, function(tokType) {
              if (utils_1.has(tokType, "LINE_BREAKS")) {
                return tokType.LINE_BREAKS;
              } else {
                if (checkLineBreaksIssues(tokType, lineTerminatorCharCodes) === false) {
                  return reg_exp_1.canMatchCharCode(lineTerminatorCharCodes, tokType.PATTERN);
                }
              }
            });
          }
        });
        var patternIdxToIsCustom;
        var patternIdxToShort;
        var emptyGroups;
        var patternIdxToConfig;
        tracer("Misc Mapping #2", function() {
          patternIdxToIsCustom = utils_1.map(onlyRelevantTypes, isCustomPattern);
          patternIdxToShort = utils_1.map(allTransformedPatterns, isShortPattern);
          emptyGroups = utils_1.reduce(onlyRelevantTypes, function(acc, clazz) {
            var groupName = clazz.GROUP;
            if (utils_1.isString(groupName) && !(groupName === lexer_public_1.Lexer.SKIPPED)) {
              acc[groupName] = [];
            }
            return acc;
          }, {});
          patternIdxToConfig = utils_1.map(allTransformedPatterns, function(x, idx) {
            return {
              pattern: allTransformedPatterns[idx],
              longerAlt: patternIdxToLongerAltIdx[idx],
              canLineTerminator: patternIdxToCanLineTerminator[idx],
              isCustom: patternIdxToIsCustom[idx],
              short: patternIdxToShort[idx],
              group: patternIdxToGroup[idx],
              push: patternIdxToPushMode[idx],
              pop: patternIdxToPopMode[idx],
              tokenTypeIdx: patternIdxToType[idx],
              tokenType: onlyRelevantTypes[idx]
            };
          });
        });
        var canBeOptimized = true;
        var charCodeToPatternIdxToConfig = [];
        if (!options.safeMode) {
          tracer("First Char Optimization", function() {
            charCodeToPatternIdxToConfig = utils_1.reduce(onlyRelevantTypes, function(result, currTokType, idx) {
              if (typeof currTokType.PATTERN === "string") {
                var charCode = currTokType.PATTERN.charCodeAt(0);
                var optimizedIdx = charCodeToOptimizedIndex(charCode);
                addToMapOfArrays(result, optimizedIdx, patternIdxToConfig[idx]);
              } else if (utils_1.isArray(currTokType.START_CHARS_HINT)) {
                var lastOptimizedIdx_1;
                utils_1.forEach(currTokType.START_CHARS_HINT, function(charOrInt) {
                  var charCode2 = typeof charOrInt === "string" ? charOrInt.charCodeAt(0) : charOrInt;
                  var currOptimizedIdx = charCodeToOptimizedIndex(charCode2);
                  if (lastOptimizedIdx_1 !== currOptimizedIdx) {
                    lastOptimizedIdx_1 = currOptimizedIdx;
                    addToMapOfArrays(result, currOptimizedIdx, patternIdxToConfig[idx]);
                  }
                });
              } else if (utils_1.isRegExp(currTokType.PATTERN)) {
                if (currTokType.PATTERN.unicode) {
                  canBeOptimized = false;
                  if (options.ensureOptimizations) {
                    utils_1.PRINT_ERROR("" + reg_exp_1.failedOptimizationPrefixMsg + ("	Unable to analyze < " + currTokType.PATTERN.toString() + " > pattern.\n") + "	The regexp unicode flag is not currently supported by the regexp-to-ast library.\n	This will disable the lexer's first char optimizations.\n	For details See: https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#UNICODE_OPTIMIZE");
                  }
                } else {
                  var optimizedCodes = reg_exp_1.getOptimizedStartCodesIndices(currTokType.PATTERN, options.ensureOptimizations);
                  if (utils_1.isEmpty(optimizedCodes)) {
                    canBeOptimized = false;
                  }
                  utils_1.forEach(optimizedCodes, function(code) {
                    addToMapOfArrays(result, code, patternIdxToConfig[idx]);
                  });
                }
              } else {
                if (options.ensureOptimizations) {
                  utils_1.PRINT_ERROR("" + reg_exp_1.failedOptimizationPrefixMsg + ("	TokenType: <" + currTokType.name + "> is using a custom token pattern without providing <start_chars_hint> parameter.\n") + "	This will disable the lexer's first char optimizations.\n	For details See: https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#CUSTOM_OPTIMIZE");
                }
                canBeOptimized = false;
              }
              return result;
            }, []);
          });
        }
        tracer("ArrayPacking", function() {
          charCodeToPatternIdxToConfig = utils_1.packArray(charCodeToPatternIdxToConfig);
        });
        return {
          emptyGroups,
          patternIdxToConfig,
          charCodeToPatternIdxToConfig,
          hasCustom,
          canBeOptimized
        };
      }
      exports2.analyzeTokenTypes = analyzeTokenTypes;
      function validatePatterns(tokenTypes, validModesNames) {
        var errors = [];
        var missingResult = findMissingPatterns(tokenTypes);
        errors = errors.concat(missingResult.errors);
        var invalidResult = findInvalidPatterns(missingResult.valid);
        var validTokenTypes = invalidResult.valid;
        errors = errors.concat(invalidResult.errors);
        errors = errors.concat(validateRegExpPattern(validTokenTypes));
        errors = errors.concat(findInvalidGroupType(validTokenTypes));
        errors = errors.concat(findModesThatDoNotExist(validTokenTypes, validModesNames));
        errors = errors.concat(findUnreachablePatterns(validTokenTypes));
        return errors;
      }
      exports2.validatePatterns = validatePatterns;
      function validateRegExpPattern(tokenTypes) {
        var errors = [];
        var withRegExpPatterns = utils_1.filter(tokenTypes, function(currTokType) {
          return utils_1.isRegExp(currTokType[PATTERN]);
        });
        errors = errors.concat(findEndOfInputAnchor(withRegExpPatterns));
        errors = errors.concat(findStartOfInputAnchor(withRegExpPatterns));
        errors = errors.concat(findUnsupportedFlags(withRegExpPatterns));
        errors = errors.concat(findDuplicatePatterns(withRegExpPatterns));
        errors = errors.concat(findEmptyMatchRegExps(withRegExpPatterns));
        return errors;
      }
      function findMissingPatterns(tokenTypes) {
        var tokenTypesWithMissingPattern = utils_1.filter(tokenTypes, function(currType) {
          return !utils_1.has(currType, PATTERN);
        });
        var errors = utils_1.map(tokenTypesWithMissingPattern, function(currType) {
          return {
            message: "Token Type: ->" + currType.name + "<- missing static 'PATTERN' property",
            type: lexer_public_1.LexerDefinitionErrorType.MISSING_PATTERN,
            tokenTypes: [currType]
          };
        });
        var valid = utils_1.difference(tokenTypes, tokenTypesWithMissingPattern);
        return { errors, valid };
      }
      exports2.findMissingPatterns = findMissingPatterns;
      function findInvalidPatterns(tokenTypes) {
        var tokenTypesWithInvalidPattern = utils_1.filter(tokenTypes, function(currType) {
          var pattern = currType[PATTERN];
          return !utils_1.isRegExp(pattern) && !utils_1.isFunction(pattern) && !utils_1.has(pattern, "exec") && !utils_1.isString(pattern);
        });
        var errors = utils_1.map(tokenTypesWithInvalidPattern, function(currType) {
          return {
            message: "Token Type: ->" + currType.name + "<- static 'PATTERN' can only be a RegExp, a Function matching the {CustomPatternMatcherFunc} type or an Object matching the {ICustomPattern} interface.",
            type: lexer_public_1.LexerDefinitionErrorType.INVALID_PATTERN,
            tokenTypes: [currType]
          };
        });
        var valid = utils_1.difference(tokenTypes, tokenTypesWithInvalidPattern);
        return { errors, valid };
      }
      exports2.findInvalidPatterns = findInvalidPatterns;
      var end_of_input = /[^\\][\$]/;
      function findEndOfInputAnchor(tokenTypes) {
        var EndAnchorFinder = (
          /** @class */
          (function(_super) {
            __extends(EndAnchorFinder2, _super);
            function EndAnchorFinder2() {
              var _this = _super !== null && _super.apply(this, arguments) || this;
              _this.found = false;
              return _this;
            }
            EndAnchorFinder2.prototype.visitEndAnchor = function(node) {
              this.found = true;
            };
            return EndAnchorFinder2;
          })(regexp_to_ast_1.BaseRegExpVisitor)
        );
        var invalidRegex = utils_1.filter(tokenTypes, function(currType) {
          var pattern = currType[PATTERN];
          try {
            var regexpAst = reg_exp_parser_1.getRegExpAst(pattern);
            var endAnchorVisitor = new EndAnchorFinder();
            endAnchorVisitor.visit(regexpAst);
            return endAnchorVisitor.found;
          } catch (e) {
            return end_of_input.test(pattern.source);
          }
        });
        var errors = utils_1.map(invalidRegex, function(currType) {
          return {
            message: "Unexpected RegExp Anchor Error:\n	Token Type: ->" + currType.name + "<- static 'PATTERN' cannot contain end of input anchor '$'\n	See sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#ANCHORS	for details.",
            type: lexer_public_1.LexerDefinitionErrorType.EOI_ANCHOR_FOUND,
            tokenTypes: [currType]
          };
        });
        return errors;
      }
      exports2.findEndOfInputAnchor = findEndOfInputAnchor;
      function findEmptyMatchRegExps(tokenTypes) {
        var matchesEmptyString = utils_1.filter(tokenTypes, function(currType) {
          var pattern = currType[PATTERN];
          return pattern.test("");
        });
        var errors = utils_1.map(matchesEmptyString, function(currType) {
          return {
            message: "Token Type: ->" + currType.name + "<- static 'PATTERN' must not match an empty string",
            type: lexer_public_1.LexerDefinitionErrorType.EMPTY_MATCH_PATTERN,
            tokenTypes: [currType]
          };
        });
        return errors;
      }
      exports2.findEmptyMatchRegExps = findEmptyMatchRegExps;
      var start_of_input = /[^\\[][\^]|^\^/;
      function findStartOfInputAnchor(tokenTypes) {
        var StartAnchorFinder = (
          /** @class */
          (function(_super) {
            __extends(StartAnchorFinder2, _super);
            function StartAnchorFinder2() {
              var _this = _super !== null && _super.apply(this, arguments) || this;
              _this.found = false;
              return _this;
            }
            StartAnchorFinder2.prototype.visitStartAnchor = function(node) {
              this.found = true;
            };
            return StartAnchorFinder2;
          })(regexp_to_ast_1.BaseRegExpVisitor)
        );
        var invalidRegex = utils_1.filter(tokenTypes, function(currType) {
          var pattern = currType[PATTERN];
          try {
            var regexpAst = reg_exp_parser_1.getRegExpAst(pattern);
            var startAnchorVisitor = new StartAnchorFinder();
            startAnchorVisitor.visit(regexpAst);
            return startAnchorVisitor.found;
          } catch (e) {
            return start_of_input.test(pattern.source);
          }
        });
        var errors = utils_1.map(invalidRegex, function(currType) {
          return {
            message: "Unexpected RegExp Anchor Error:\n	Token Type: ->" + currType.name + "<- static 'PATTERN' cannot contain start of input anchor '^'\n	See https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#ANCHORS	for details.",
            type: lexer_public_1.LexerDefinitionErrorType.SOI_ANCHOR_FOUND,
            tokenTypes: [currType]
          };
        });
        return errors;
      }
      exports2.findStartOfInputAnchor = findStartOfInputAnchor;
      function findUnsupportedFlags(tokenTypes) {
        var invalidFlags = utils_1.filter(tokenTypes, function(currType) {
          var pattern = currType[PATTERN];
          return pattern instanceof RegExp && (pattern.multiline || pattern.global);
        });
        var errors = utils_1.map(invalidFlags, function(currType) {
          return {
            message: "Token Type: ->" + currType.name + "<- static 'PATTERN' may NOT contain global('g') or multiline('m')",
            type: lexer_public_1.LexerDefinitionErrorType.UNSUPPORTED_FLAGS_FOUND,
            tokenTypes: [currType]
          };
        });
        return errors;
      }
      exports2.findUnsupportedFlags = findUnsupportedFlags;
      function findDuplicatePatterns(tokenTypes) {
        var found = [];
        var identicalPatterns = utils_1.map(tokenTypes, function(outerType) {
          return utils_1.reduce(tokenTypes, function(result, innerType) {
            if (outerType.PATTERN.source === innerType.PATTERN.source && !utils_1.contains(found, innerType) && innerType.PATTERN !== lexer_public_1.Lexer.NA) {
              found.push(innerType);
              result.push(innerType);
              return result;
            }
            return result;
          }, []);
        });
        identicalPatterns = utils_1.compact(identicalPatterns);
        var duplicatePatterns = utils_1.filter(identicalPatterns, function(currIdenticalSet) {
          return currIdenticalSet.length > 1;
        });
        var errors = utils_1.map(duplicatePatterns, function(setOfIdentical) {
          var tokenTypeNames = utils_1.map(setOfIdentical, function(currType) {
            return currType.name;
          });
          var dupPatternSrc = utils_1.first(setOfIdentical).PATTERN;
          return {
            message: "The same RegExp pattern ->" + dupPatternSrc + "<-" + ("has been used in all of the following Token Types: " + tokenTypeNames.join(", ") + " <-"),
            type: lexer_public_1.LexerDefinitionErrorType.DUPLICATE_PATTERNS_FOUND,
            tokenTypes: setOfIdentical
          };
        });
        return errors;
      }
      exports2.findDuplicatePatterns = findDuplicatePatterns;
      function findInvalidGroupType(tokenTypes) {
        var invalidTypes = utils_1.filter(tokenTypes, function(clazz) {
          if (!utils_1.has(clazz, "GROUP")) {
            return false;
          }
          var group = clazz.GROUP;
          return group !== lexer_public_1.Lexer.SKIPPED && group !== lexer_public_1.Lexer.NA && !utils_1.isString(group);
        });
        var errors = utils_1.map(invalidTypes, function(currType) {
          return {
            message: "Token Type: ->" + currType.name + "<- static 'GROUP' can only be Lexer.SKIPPED/Lexer.NA/A String",
            type: lexer_public_1.LexerDefinitionErrorType.INVALID_GROUP_TYPE_FOUND,
            tokenTypes: [currType]
          };
        });
        return errors;
      }
      exports2.findInvalidGroupType = findInvalidGroupType;
      function findModesThatDoNotExist(tokenTypes, validModes) {
        var invalidModes = utils_1.filter(tokenTypes, function(clazz) {
          return clazz.PUSH_MODE !== void 0 && !utils_1.contains(validModes, clazz.PUSH_MODE);
        });
        var errors = utils_1.map(invalidModes, function(tokType) {
          var msg = "Token Type: ->" + tokType.name + "<- static 'PUSH_MODE' value cannot refer to a Lexer Mode ->" + tokType.PUSH_MODE + "<-which does not exist";
          return {
            message: msg,
            type: lexer_public_1.LexerDefinitionErrorType.PUSH_MODE_DOES_NOT_EXIST,
            tokenTypes: [tokType]
          };
        });
        return errors;
      }
      exports2.findModesThatDoNotExist = findModesThatDoNotExist;
      function findUnreachablePatterns(tokenTypes) {
        var errors = [];
        var canBeTested = utils_1.reduce(tokenTypes, function(result, tokType, idx) {
          var pattern = tokType.PATTERN;
          if (pattern === lexer_public_1.Lexer.NA) {
            return result;
          }
          if (utils_1.isString(pattern)) {
            result.push({ str: pattern, idx, tokenType: tokType });
          } else if (utils_1.isRegExp(pattern) && noMetaChar(pattern)) {
            result.push({ str: pattern.source, idx, tokenType: tokType });
          }
          return result;
        }, []);
        utils_1.forEach(tokenTypes, function(tokType, testIdx) {
          utils_1.forEach(canBeTested, function(_a) {
            var str = _a.str, idx = _a.idx, tokenType = _a.tokenType;
            if (testIdx < idx && testTokenType(str, tokType.PATTERN)) {
              var msg = "Token: ->" + tokenType.name + "<- can never be matched.\n" + ("Because it appears AFTER the Token Type ->" + tokType.name + "<-") + "in the lexer's definition.\nSee https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#UNREACHABLE";
              errors.push({
                message: msg,
                type: lexer_public_1.LexerDefinitionErrorType.UNREACHABLE_PATTERN,
                tokenTypes: [tokType, tokenType]
              });
            }
          });
        });
        return errors;
      }
      exports2.findUnreachablePatterns = findUnreachablePatterns;
      function testTokenType(str, pattern) {
        if (utils_1.isRegExp(pattern)) {
          var regExpArray = pattern.exec(str);
          return regExpArray !== null && regExpArray.index === 0;
        } else if (utils_1.isFunction(pattern)) {
          return pattern(str, 0, [], {});
        } else if (utils_1.has(pattern, "exec")) {
          return pattern.exec(str, 0, [], {});
        } else if (typeof pattern === "string") {
          return pattern === str;
        } else {
          throw Error("non exhaustive match");
        }
      }
      function noMetaChar(regExp) {
        var metaChars = [
          ".",
          "\\",
          "[",
          "]",
          "|",
          "^",
          "$",
          "(",
          ")",
          "?",
          "*",
          "+",
          "{"
        ];
        return utils_1.find(metaChars, function(char) {
          return regExp.source.indexOf(char) !== -1;
        }) === void 0;
      }
      function addStartOfInput(pattern) {
        var flags = pattern.ignoreCase ? "i" : "";
        return new RegExp("^(?:" + pattern.source + ")", flags);
      }
      exports2.addStartOfInput = addStartOfInput;
      function addStickyFlag(pattern) {
        var flags = pattern.ignoreCase ? "iy" : "y";
        return new RegExp("" + pattern.source, flags);
      }
      exports2.addStickyFlag = addStickyFlag;
      function performRuntimeChecks(lexerDefinition, trackLines, lineTerminatorCharacters) {
        var errors = [];
        if (!utils_1.has(lexerDefinition, exports2.DEFAULT_MODE)) {
          errors.push({
            message: "A MultiMode Lexer cannot be initialized without a <" + exports2.DEFAULT_MODE + "> property in its definition\n",
            type: lexer_public_1.LexerDefinitionErrorType.MULTI_MODE_LEXER_WITHOUT_DEFAULT_MODE
          });
        }
        if (!utils_1.has(lexerDefinition, exports2.MODES)) {
          errors.push({
            message: "A MultiMode Lexer cannot be initialized without a <" + exports2.MODES + "> property in its definition\n",
            type: lexer_public_1.LexerDefinitionErrorType.MULTI_MODE_LEXER_WITHOUT_MODES_PROPERTY
          });
        }
        if (utils_1.has(lexerDefinition, exports2.MODES) && utils_1.has(lexerDefinition, exports2.DEFAULT_MODE) && !utils_1.has(lexerDefinition.modes, lexerDefinition.defaultMode)) {
          errors.push({
            message: "A MultiMode Lexer cannot be initialized with a " + exports2.DEFAULT_MODE + ": <" + lexerDefinition.defaultMode + ">which does not exist\n",
            type: lexer_public_1.LexerDefinitionErrorType.MULTI_MODE_LEXER_DEFAULT_MODE_VALUE_DOES_NOT_EXIST
          });
        }
        if (utils_1.has(lexerDefinition, exports2.MODES)) {
          utils_1.forEach(lexerDefinition.modes, function(currModeValue, currModeName) {
            utils_1.forEach(currModeValue, function(currTokType, currIdx) {
              if (utils_1.isUndefined(currTokType)) {
                errors.push({
                  message: "A Lexer cannot be initialized using an undefined Token Type. Mode:" + ("<" + currModeName + "> at index: <" + currIdx + ">\n"),
                  type: lexer_public_1.LexerDefinitionErrorType.LEXER_DEFINITION_CANNOT_CONTAIN_UNDEFINED
                });
              }
            });
          });
        }
        return errors;
      }
      exports2.performRuntimeChecks = performRuntimeChecks;
      function performWarningRuntimeChecks(lexerDefinition, trackLines, lineTerminatorCharacters) {
        var warnings = [];
        var hasAnyLineBreak = false;
        var allTokenTypes = utils_1.compact(utils_1.flatten(utils_1.mapValues(lexerDefinition.modes, function(tokTypes) {
          return tokTypes;
        })));
        var concreteTokenTypes = utils_1.reject(allTokenTypes, function(currType) {
          return currType[PATTERN] === lexer_public_1.Lexer.NA;
        });
        var terminatorCharCodes = getCharCodes(lineTerminatorCharacters);
        if (trackLines) {
          utils_1.forEach(concreteTokenTypes, function(tokType) {
            var currIssue = checkLineBreaksIssues(tokType, terminatorCharCodes);
            if (currIssue !== false) {
              var message = buildLineBreakIssueMessage(tokType, currIssue);
              var warningDescriptor = {
                message,
                type: currIssue.issue,
                tokenType: tokType
              };
              warnings.push(warningDescriptor);
            } else {
              if (utils_1.has(tokType, "LINE_BREAKS")) {
                if (tokType.LINE_BREAKS === true) {
                  hasAnyLineBreak = true;
                }
              } else {
                if (reg_exp_1.canMatchCharCode(terminatorCharCodes, tokType.PATTERN)) {
                  hasAnyLineBreak = true;
                }
              }
            }
          });
        }
        if (trackLines && !hasAnyLineBreak) {
          warnings.push({
            message: "Warning: No LINE_BREAKS Found.\n	This Lexer has been defined to track line and column information,\n	But none of the Token Types can be identified as matching a line terminator.\n	See https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#LINE_BREAKS \n	for details.",
            type: lexer_public_1.LexerDefinitionErrorType.NO_LINE_BREAKS_FLAGS
          });
        }
        return warnings;
      }
      exports2.performWarningRuntimeChecks = performWarningRuntimeChecks;
      function cloneEmptyGroups(emptyGroups) {
        var clonedResult = {};
        var groupKeys = utils_1.keys(emptyGroups);
        utils_1.forEach(groupKeys, function(currKey) {
          var currGroupValue = emptyGroups[currKey];
          if (utils_1.isArray(currGroupValue)) {
            clonedResult[currKey] = [];
          } else {
            throw Error("non exhaustive match");
          }
        });
        return clonedResult;
      }
      exports2.cloneEmptyGroups = cloneEmptyGroups;
      function isCustomPattern(tokenType) {
        var pattern = tokenType.PATTERN;
        if (utils_1.isRegExp(pattern)) {
          return false;
        } else if (utils_1.isFunction(pattern)) {
          return true;
        } else if (utils_1.has(pattern, "exec")) {
          return true;
        } else if (utils_1.isString(pattern)) {
          return false;
        } else {
          throw Error("non exhaustive match");
        }
      }
      exports2.isCustomPattern = isCustomPattern;
      function isShortPattern(pattern) {
        if (utils_1.isString(pattern) && pattern.length === 1) {
          return pattern.charCodeAt(0);
        } else {
          return false;
        }
      }
      exports2.isShortPattern = isShortPattern;
      exports2.LineTerminatorOptimizedTester = {
        // implements /\n|\r\n?/g.test
        test: function(text) {
          var len = text.length;
          for (var i = this.lastIndex; i < len; i++) {
            var c = text.charCodeAt(i);
            if (c === 10) {
              this.lastIndex = i + 1;
              return true;
            } else if (c === 13) {
              if (text.charCodeAt(i + 1) === 10) {
                this.lastIndex = i + 2;
              } else {
                this.lastIndex = i + 1;
              }
              return true;
            }
          }
          return false;
        },
        lastIndex: 0
      };
      function checkLineBreaksIssues(tokType, lineTerminatorCharCodes) {
        if (utils_1.has(tokType, "LINE_BREAKS")) {
          return false;
        } else {
          if (utils_1.isRegExp(tokType.PATTERN)) {
            try {
              reg_exp_1.canMatchCharCode(lineTerminatorCharCodes, tokType.PATTERN);
            } catch (e) {
              return {
                issue: lexer_public_1.LexerDefinitionErrorType.IDENTIFY_TERMINATOR,
                errMsg: e.message
              };
            }
            return false;
          } else if (utils_1.isString(tokType.PATTERN)) {
            return false;
          } else if (isCustomPattern(tokType)) {
            return { issue: lexer_public_1.LexerDefinitionErrorType.CUSTOM_LINE_BREAK };
          } else {
            throw Error("non exhaustive match");
          }
        }
      }
      function buildLineBreakIssueMessage(tokType, details) {
        if (details.issue === lexer_public_1.LexerDefinitionErrorType.IDENTIFY_TERMINATOR) {
          return "Warning: unable to identify line terminator usage in pattern.\n" + ("	The problem is in the <" + tokType.name + "> Token Type\n") + ("	 Root cause: " + details.errMsg + ".\n") + "	For details See: https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#IDENTIFY_TERMINATOR";
        } else if (details.issue === lexer_public_1.LexerDefinitionErrorType.CUSTOM_LINE_BREAK) {
          return "Warning: A Custom Token Pattern should specify the <line_breaks> option.\n" + ("	The problem is in the <" + tokType.name + "> Token Type\n") + "	For details See: https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#CUSTOM_LINE_BREAK";
        } else {
          throw Error("non exhaustive match");
        }
      }
      exports2.buildLineBreakIssueMessage = buildLineBreakIssueMessage;
      function getCharCodes(charsOrCodes) {
        var charCodes = utils_1.map(charsOrCodes, function(numOrString) {
          if (utils_1.isString(numOrString) && numOrString.length > 0) {
            return numOrString.charCodeAt(0);
          } else {
            return numOrString;
          }
        });
        return charCodes;
      }
      function addToMapOfArrays(map2, key, value) {
        if (map2[key] === void 0) {
          map2[key] = [value];
        } else {
          map2[key].push(value);
        }
      }
      exports2.minOptimizationVal = 256;
      function charCodeToOptimizedIndex(charCode) {
        return charCode < exports2.minOptimizationVal ? charCode : charCodeToOptimizedIdxMap[charCode];
      }
      exports2.charCodeToOptimizedIndex = charCodeToOptimizedIndex;
      var charCodeToOptimizedIdxMap = [];
      function initCharCodeToOptimizedIndexMap() {
        if (utils_1.isEmpty(charCodeToOptimizedIdxMap)) {
          charCodeToOptimizedIdxMap = new Array(65536);
          for (var i = 0; i < 65536; i++) {
            charCodeToOptimizedIdxMap[i] = i > 255 ? 255 + ~~(i / 255) : i;
          }
        }
      }
    }
  });

  // ../../node_modules/chevrotain/lib/src/scan/tokens.js
  var require_tokens = __commonJS({
    "../../node_modules/chevrotain/lib/src/scan/tokens.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.isTokenType = exports2.hasExtendingTokensTypesMapProperty = exports2.hasExtendingTokensTypesProperty = exports2.hasCategoriesProperty = exports2.hasShortKeyProperty = exports2.singleAssignCategoriesToksMap = exports2.assignCategoriesMapProp = exports2.assignCategoriesTokensProp = exports2.assignTokenDefaultProps = exports2.expandCategories = exports2.augmentTokenTypes = exports2.tokenIdxToClass = exports2.tokenShortNameIdx = exports2.tokenStructuredMatcherNoCategories = exports2.tokenStructuredMatcher = void 0;
      var utils_1 = require_utils();
      function tokenStructuredMatcher(tokInstance, tokConstructor) {
        var instanceType = tokInstance.tokenTypeIdx;
        if (instanceType === tokConstructor.tokenTypeIdx) {
          return true;
        } else {
          return tokConstructor.isParent === true && tokConstructor.categoryMatchesMap[instanceType] === true;
        }
      }
      exports2.tokenStructuredMatcher = tokenStructuredMatcher;
      function tokenStructuredMatcherNoCategories(token, tokType) {
        return token.tokenTypeIdx === tokType.tokenTypeIdx;
      }
      exports2.tokenStructuredMatcherNoCategories = tokenStructuredMatcherNoCategories;
      exports2.tokenShortNameIdx = 1;
      exports2.tokenIdxToClass = {};
      function augmentTokenTypes(tokenTypes) {
        var tokenTypesAndParents = expandCategories(tokenTypes);
        assignTokenDefaultProps(tokenTypesAndParents);
        assignCategoriesMapProp(tokenTypesAndParents);
        assignCategoriesTokensProp(tokenTypesAndParents);
        utils_1.forEach(tokenTypesAndParents, function(tokType) {
          tokType.isParent = tokType.categoryMatches.length > 0;
        });
      }
      exports2.augmentTokenTypes = augmentTokenTypes;
      function expandCategories(tokenTypes) {
        var result = utils_1.cloneArr(tokenTypes);
        var categories = tokenTypes;
        var searching = true;
        while (searching) {
          categories = utils_1.compact(utils_1.flatten(utils_1.map(categories, function(currTokType) {
            return currTokType.CATEGORIES;
          })));
          var newCategories = utils_1.difference(categories, result);
          result = result.concat(newCategories);
          if (utils_1.isEmpty(newCategories)) {
            searching = false;
          } else {
            categories = newCategories;
          }
        }
        return result;
      }
      exports2.expandCategories = expandCategories;
      function assignTokenDefaultProps(tokenTypes) {
        utils_1.forEach(tokenTypes, function(currTokType) {
          if (!hasShortKeyProperty(currTokType)) {
            exports2.tokenIdxToClass[exports2.tokenShortNameIdx] = currTokType;
            currTokType.tokenTypeIdx = exports2.tokenShortNameIdx++;
          }
          if (hasCategoriesProperty(currTokType) && !utils_1.isArray(currTokType.CATEGORIES)) {
            currTokType.CATEGORIES = [currTokType.CATEGORIES];
          }
          if (!hasCategoriesProperty(currTokType)) {
            currTokType.CATEGORIES = [];
          }
          if (!hasExtendingTokensTypesProperty(currTokType)) {
            currTokType.categoryMatches = [];
          }
          if (!hasExtendingTokensTypesMapProperty(currTokType)) {
            currTokType.categoryMatchesMap = {};
          }
        });
      }
      exports2.assignTokenDefaultProps = assignTokenDefaultProps;
      function assignCategoriesTokensProp(tokenTypes) {
        utils_1.forEach(tokenTypes, function(currTokType) {
          currTokType.categoryMatches = [];
          utils_1.forEach(currTokType.categoryMatchesMap, function(val, key) {
            currTokType.categoryMatches.push(exports2.tokenIdxToClass[key].tokenTypeIdx);
          });
        });
      }
      exports2.assignCategoriesTokensProp = assignCategoriesTokensProp;
      function assignCategoriesMapProp(tokenTypes) {
        utils_1.forEach(tokenTypes, function(currTokType) {
          singleAssignCategoriesToksMap([], currTokType);
        });
      }
      exports2.assignCategoriesMapProp = assignCategoriesMapProp;
      function singleAssignCategoriesToksMap(path, nextNode) {
        utils_1.forEach(path, function(pathNode) {
          nextNode.categoryMatchesMap[pathNode.tokenTypeIdx] = true;
        });
        utils_1.forEach(nextNode.CATEGORIES, function(nextCategory) {
          var newPath = path.concat(nextNode);
          if (!utils_1.contains(newPath, nextCategory)) {
            singleAssignCategoriesToksMap(newPath, nextCategory);
          }
        });
      }
      exports2.singleAssignCategoriesToksMap = singleAssignCategoriesToksMap;
      function hasShortKeyProperty(tokType) {
        return utils_1.has(tokType, "tokenTypeIdx");
      }
      exports2.hasShortKeyProperty = hasShortKeyProperty;
      function hasCategoriesProperty(tokType) {
        return utils_1.has(tokType, "CATEGORIES");
      }
      exports2.hasCategoriesProperty = hasCategoriesProperty;
      function hasExtendingTokensTypesProperty(tokType) {
        return utils_1.has(tokType, "categoryMatches");
      }
      exports2.hasExtendingTokensTypesProperty = hasExtendingTokensTypesProperty;
      function hasExtendingTokensTypesMapProperty(tokType) {
        return utils_1.has(tokType, "categoryMatchesMap");
      }
      exports2.hasExtendingTokensTypesMapProperty = hasExtendingTokensTypesMapProperty;
      function isTokenType(tokType) {
        return utils_1.has(tokType, "tokenTypeIdx");
      }
      exports2.isTokenType = isTokenType;
    }
  });

  // ../../node_modules/chevrotain/lib/src/scan/lexer_errors_public.js
  var require_lexer_errors_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/scan/lexer_errors_public.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.defaultLexerErrorProvider = void 0;
      exports2.defaultLexerErrorProvider = {
        buildUnableToPopLexerModeMessage: function(token) {
          return "Unable to pop Lexer Mode after encountering Token ->" + token.image + "<- The Mode Stack is empty";
        },
        buildUnexpectedCharactersMessage: function(fullText, startOffset, length, line, column) {
          return "unexpected character: ->" + fullText.charAt(startOffset) + "<- at offset: " + startOffset + "," + (" skipped " + length + " characters.");
        }
      };
    }
  });

  // ../../node_modules/chevrotain/lib/src/scan/lexer_public.js
  var require_lexer_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/scan/lexer_public.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.Lexer = exports2.LexerDefinitionErrorType = void 0;
      var lexer_1 = require_lexer();
      var utils_1 = require_utils();
      var tokens_1 = require_tokens();
      var lexer_errors_public_1 = require_lexer_errors_public();
      var reg_exp_parser_1 = require_reg_exp_parser();
      var LexerDefinitionErrorType;
      (function(LexerDefinitionErrorType2) {
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["MISSING_PATTERN"] = 0] = "MISSING_PATTERN";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["INVALID_PATTERN"] = 1] = "INVALID_PATTERN";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["EOI_ANCHOR_FOUND"] = 2] = "EOI_ANCHOR_FOUND";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["UNSUPPORTED_FLAGS_FOUND"] = 3] = "UNSUPPORTED_FLAGS_FOUND";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["DUPLICATE_PATTERNS_FOUND"] = 4] = "DUPLICATE_PATTERNS_FOUND";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["INVALID_GROUP_TYPE_FOUND"] = 5] = "INVALID_GROUP_TYPE_FOUND";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["PUSH_MODE_DOES_NOT_EXIST"] = 6] = "PUSH_MODE_DOES_NOT_EXIST";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["MULTI_MODE_LEXER_WITHOUT_DEFAULT_MODE"] = 7] = "MULTI_MODE_LEXER_WITHOUT_DEFAULT_MODE";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["MULTI_MODE_LEXER_WITHOUT_MODES_PROPERTY"] = 8] = "MULTI_MODE_LEXER_WITHOUT_MODES_PROPERTY";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["MULTI_MODE_LEXER_DEFAULT_MODE_VALUE_DOES_NOT_EXIST"] = 9] = "MULTI_MODE_LEXER_DEFAULT_MODE_VALUE_DOES_NOT_EXIST";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["LEXER_DEFINITION_CANNOT_CONTAIN_UNDEFINED"] = 10] = "LEXER_DEFINITION_CANNOT_CONTAIN_UNDEFINED";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["SOI_ANCHOR_FOUND"] = 11] = "SOI_ANCHOR_FOUND";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["EMPTY_MATCH_PATTERN"] = 12] = "EMPTY_MATCH_PATTERN";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["NO_LINE_BREAKS_FLAGS"] = 13] = "NO_LINE_BREAKS_FLAGS";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["UNREACHABLE_PATTERN"] = 14] = "UNREACHABLE_PATTERN";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["IDENTIFY_TERMINATOR"] = 15] = "IDENTIFY_TERMINATOR";
        LexerDefinitionErrorType2[LexerDefinitionErrorType2["CUSTOM_LINE_BREAK"] = 16] = "CUSTOM_LINE_BREAK";
      })(LexerDefinitionErrorType = exports2.LexerDefinitionErrorType || (exports2.LexerDefinitionErrorType = {}));
      var DEFAULT_LEXER_CONFIG = {
        deferDefinitionErrorsHandling: false,
        positionTracking: "full",
        lineTerminatorsPattern: /\n|\r\n?/g,
        lineTerminatorCharacters: ["\n", "\r"],
        ensureOptimizations: false,
        safeMode: false,
        errorMessageProvider: lexer_errors_public_1.defaultLexerErrorProvider,
        traceInitPerf: false,
        skipValidations: false
      };
      Object.freeze(DEFAULT_LEXER_CONFIG);
      var Lexer = (
        /** @class */
        (function() {
          function Lexer2(lexerDefinition, config) {
            var _this = this;
            if (config === void 0) {
              config = DEFAULT_LEXER_CONFIG;
            }
            this.lexerDefinition = lexerDefinition;
            this.lexerDefinitionErrors = [];
            this.lexerDefinitionWarning = [];
            this.patternIdxToConfig = {};
            this.charCodeToPatternIdxToConfig = {};
            this.modes = [];
            this.emptyGroups = {};
            this.config = void 0;
            this.trackStartLines = true;
            this.trackEndLines = true;
            this.hasCustom = false;
            this.canModeBeOptimized = {};
            if (typeof config === "boolean") {
              throw Error("The second argument to the Lexer constructor is now an ILexerConfig Object.\na boolean 2nd argument is no longer supported");
            }
            this.config = utils_1.merge(DEFAULT_LEXER_CONFIG, config);
            var traceInitVal = this.config.traceInitPerf;
            if (traceInitVal === true) {
              this.traceInitMaxIdent = Infinity;
              this.traceInitPerf = true;
            } else if (typeof traceInitVal === "number") {
              this.traceInitMaxIdent = traceInitVal;
              this.traceInitPerf = true;
            }
            this.traceInitIndent = -1;
            this.TRACE_INIT("Lexer Constructor", function() {
              var actualDefinition;
              var hasOnlySingleMode = true;
              _this.TRACE_INIT("Lexer Config handling", function() {
                if (_this.config.lineTerminatorsPattern === DEFAULT_LEXER_CONFIG.lineTerminatorsPattern) {
                  _this.config.lineTerminatorsPattern = lexer_1.LineTerminatorOptimizedTester;
                } else {
                  if (_this.config.lineTerminatorCharacters === DEFAULT_LEXER_CONFIG.lineTerminatorCharacters) {
                    throw Error("Error: Missing <lineTerminatorCharacters> property on the Lexer config.\n	For details See: https://sap.github.io/chevrotain/docs/guide/resolving_lexer_errors.html#MISSING_LINE_TERM_CHARS");
                  }
                }
                if (config.safeMode && config.ensureOptimizations) {
                  throw Error('"safeMode" and "ensureOptimizations" flags are mutually exclusive.');
                }
                _this.trackStartLines = /full|onlyStart/i.test(_this.config.positionTracking);
                _this.trackEndLines = /full/i.test(_this.config.positionTracking);
                if (utils_1.isArray(lexerDefinition)) {
                  actualDefinition = { modes: {} };
                  actualDefinition.modes[lexer_1.DEFAULT_MODE] = utils_1.cloneArr(lexerDefinition);
                  actualDefinition[lexer_1.DEFAULT_MODE] = lexer_1.DEFAULT_MODE;
                } else {
                  hasOnlySingleMode = false;
                  actualDefinition = utils_1.cloneObj(lexerDefinition);
                }
              });
              if (_this.config.skipValidations === false) {
                _this.TRACE_INIT("performRuntimeChecks", function() {
                  _this.lexerDefinitionErrors = _this.lexerDefinitionErrors.concat(lexer_1.performRuntimeChecks(actualDefinition, _this.trackStartLines, _this.config.lineTerminatorCharacters));
                });
                _this.TRACE_INIT("performWarningRuntimeChecks", function() {
                  _this.lexerDefinitionWarning = _this.lexerDefinitionWarning.concat(lexer_1.performWarningRuntimeChecks(actualDefinition, _this.trackStartLines, _this.config.lineTerminatorCharacters));
                });
              }
              actualDefinition.modes = actualDefinition.modes ? actualDefinition.modes : {};
              utils_1.forEach(actualDefinition.modes, function(currModeValue, currModeName) {
                actualDefinition.modes[currModeName] = utils_1.reject(currModeValue, function(currTokType) {
                  return utils_1.isUndefined(currTokType);
                });
              });
              var allModeNames = utils_1.keys(actualDefinition.modes);
              utils_1.forEach(actualDefinition.modes, function(currModDef, currModName) {
                _this.TRACE_INIT("Mode: <" + currModName + "> processing", function() {
                  _this.modes.push(currModName);
                  if (_this.config.skipValidations === false) {
                    _this.TRACE_INIT("validatePatterns", function() {
                      _this.lexerDefinitionErrors = _this.lexerDefinitionErrors.concat(lexer_1.validatePatterns(currModDef, allModeNames));
                    });
                  }
                  if (utils_1.isEmpty(_this.lexerDefinitionErrors)) {
                    tokens_1.augmentTokenTypes(currModDef);
                    var currAnalyzeResult_1;
                    _this.TRACE_INIT("analyzeTokenTypes", function() {
                      currAnalyzeResult_1 = lexer_1.analyzeTokenTypes(currModDef, {
                        lineTerminatorCharacters: _this.config.lineTerminatorCharacters,
                        positionTracking: config.positionTracking,
                        ensureOptimizations: config.ensureOptimizations,
                        safeMode: config.safeMode,
                        tracer: _this.TRACE_INIT.bind(_this)
                      });
                    });
                    _this.patternIdxToConfig[currModName] = currAnalyzeResult_1.patternIdxToConfig;
                    _this.charCodeToPatternIdxToConfig[currModName] = currAnalyzeResult_1.charCodeToPatternIdxToConfig;
                    _this.emptyGroups = utils_1.merge(_this.emptyGroups, currAnalyzeResult_1.emptyGroups);
                    _this.hasCustom = currAnalyzeResult_1.hasCustom || _this.hasCustom;
                    _this.canModeBeOptimized[currModName] = currAnalyzeResult_1.canBeOptimized;
                  }
                });
              });
              _this.defaultMode = actualDefinition.defaultMode;
              if (!utils_1.isEmpty(_this.lexerDefinitionErrors) && !_this.config.deferDefinitionErrorsHandling) {
                var allErrMessages = utils_1.map(_this.lexerDefinitionErrors, function(error) {
                  return error.message;
                });
                var allErrMessagesString = allErrMessages.join("-----------------------\n");
                throw new Error("Errors detected in definition of Lexer:\n" + allErrMessagesString);
              }
              utils_1.forEach(_this.lexerDefinitionWarning, function(warningDescriptor) {
                utils_1.PRINT_WARNING(warningDescriptor.message);
              });
              _this.TRACE_INIT("Choosing sub-methods implementations", function() {
                if (lexer_1.SUPPORT_STICKY) {
                  _this.chopInput = utils_1.IDENTITY;
                  _this.match = _this.matchWithTest;
                } else {
                  _this.updateLastIndex = utils_1.NOOP;
                  _this.match = _this.matchWithExec;
                }
                if (hasOnlySingleMode) {
                  _this.handleModes = utils_1.NOOP;
                }
                if (_this.trackStartLines === false) {
                  _this.computeNewColumn = utils_1.IDENTITY;
                }
                if (_this.trackEndLines === false) {
                  _this.updateTokenEndLineColumnLocation = utils_1.NOOP;
                }
                if (/full/i.test(_this.config.positionTracking)) {
                  _this.createTokenInstance = _this.createFullToken;
                } else if (/onlyStart/i.test(_this.config.positionTracking)) {
                  _this.createTokenInstance = _this.createStartOnlyToken;
                } else if (/onlyOffset/i.test(_this.config.positionTracking)) {
                  _this.createTokenInstance = _this.createOffsetOnlyToken;
                } else {
                  throw Error('Invalid <positionTracking> config option: "' + _this.config.positionTracking + '"');
                }
                if (_this.hasCustom) {
                  _this.addToken = _this.addTokenUsingPush;
                  _this.handlePayload = _this.handlePayloadWithCustom;
                } else {
                  _this.addToken = _this.addTokenUsingMemberAccess;
                  _this.handlePayload = _this.handlePayloadNoCustom;
                }
              });
              _this.TRACE_INIT("Failed Optimization Warnings", function() {
                var unOptimizedModes = utils_1.reduce(_this.canModeBeOptimized, function(cannotBeOptimized, canBeOptimized, modeName) {
                  if (canBeOptimized === false) {
                    cannotBeOptimized.push(modeName);
                  }
                  return cannotBeOptimized;
                }, []);
                if (config.ensureOptimizations && !utils_1.isEmpty(unOptimizedModes)) {
                  throw Error("Lexer Modes: < " + unOptimizedModes.join(", ") + ' > cannot be optimized.\n	 Disable the "ensureOptimizations" lexer config flag to silently ignore this and run the lexer in an un-optimized mode.\n	 Or inspect the console log for details on how to resolve these issues.');
                }
              });
              _this.TRACE_INIT("clearRegExpParserCache", function() {
                reg_exp_parser_1.clearRegExpParserCache();
              });
              _this.TRACE_INIT("toFastProperties", function() {
                utils_1.toFastProperties(_this);
              });
            });
          }
          Lexer2.prototype.tokenize = function(text, initialMode) {
            if (initialMode === void 0) {
              initialMode = this.defaultMode;
            }
            if (!utils_1.isEmpty(this.lexerDefinitionErrors)) {
              var allErrMessages = utils_1.map(this.lexerDefinitionErrors, function(error) {
                return error.message;
              });
              var allErrMessagesString = allErrMessages.join("-----------------------\n");
              throw new Error("Unable to Tokenize because Errors detected in definition of Lexer:\n" + allErrMessagesString);
            }
            var lexResult = this.tokenizeInternal(text, initialMode);
            return lexResult;
          };
          Lexer2.prototype.tokenizeInternal = function(text, initialMode) {
            var _this = this;
            var i, j, matchAltImage, longerAltIdx, matchedImage, payload, altPayload, imageLength, group, tokType, newToken, errLength, droppedChar, msg, match;
            var orgText = text;
            var orgLength = orgText.length;
            var offset = 0;
            var matchedTokensIndex = 0;
            var guessedNumberOfTokens = this.hasCustom ? 0 : Math.floor(text.length / 10);
            var matchedTokens = new Array(guessedNumberOfTokens);
            var errors = [];
            var line = this.trackStartLines ? 1 : void 0;
            var column = this.trackStartLines ? 1 : void 0;
            var groups = lexer_1.cloneEmptyGroups(this.emptyGroups);
            var trackLines = this.trackStartLines;
            var lineTerminatorPattern = this.config.lineTerminatorsPattern;
            var currModePatternsLength = 0;
            var patternIdxToConfig = [];
            var currCharCodeToPatternIdxToConfig = [];
            var modeStack = [];
            var emptyArray = [];
            Object.freeze(emptyArray);
            var getPossiblePatterns = void 0;
            function getPossiblePatternsSlow() {
              return patternIdxToConfig;
            }
            function getPossiblePatternsOptimized(charCode) {
              var optimizedCharIdx = lexer_1.charCodeToOptimizedIndex(charCode);
              var possiblePatterns = currCharCodeToPatternIdxToConfig[optimizedCharIdx];
              if (possiblePatterns === void 0) {
                return emptyArray;
              } else {
                return possiblePatterns;
              }
            }
            var pop_mode = function(popToken) {
              if (modeStack.length === 1 && // if we have both a POP_MODE and a PUSH_MODE this is in-fact a "transition"
              // So no error should occur.
              popToken.tokenType.PUSH_MODE === void 0) {
                var msg_1 = _this.config.errorMessageProvider.buildUnableToPopLexerModeMessage(popToken);
                errors.push({
                  offset: popToken.startOffset,
                  line: popToken.startLine !== void 0 ? popToken.startLine : void 0,
                  column: popToken.startColumn !== void 0 ? popToken.startColumn : void 0,
                  length: popToken.image.length,
                  message: msg_1
                });
              } else {
                modeStack.pop();
                var newMode = utils_1.last(modeStack);
                patternIdxToConfig = _this.patternIdxToConfig[newMode];
                currCharCodeToPatternIdxToConfig = _this.charCodeToPatternIdxToConfig[newMode];
                currModePatternsLength = patternIdxToConfig.length;
                var modeCanBeOptimized = _this.canModeBeOptimized[newMode] && _this.config.safeMode === false;
                if (currCharCodeToPatternIdxToConfig && modeCanBeOptimized) {
                  getPossiblePatterns = getPossiblePatternsOptimized;
                } else {
                  getPossiblePatterns = getPossiblePatternsSlow;
                }
              }
            };
            function push_mode(newMode) {
              modeStack.push(newMode);
              currCharCodeToPatternIdxToConfig = this.charCodeToPatternIdxToConfig[newMode];
              patternIdxToConfig = this.patternIdxToConfig[newMode];
              currModePatternsLength = patternIdxToConfig.length;
              currModePatternsLength = patternIdxToConfig.length;
              var modeCanBeOptimized = this.canModeBeOptimized[newMode] && this.config.safeMode === false;
              if (currCharCodeToPatternIdxToConfig && modeCanBeOptimized) {
                getPossiblePatterns = getPossiblePatternsOptimized;
              } else {
                getPossiblePatterns = getPossiblePatternsSlow;
              }
            }
            push_mode.call(this, initialMode);
            var currConfig;
            while (offset < orgLength) {
              matchedImage = null;
              var nextCharCode = orgText.charCodeAt(offset);
              var chosenPatternIdxToConfig = getPossiblePatterns(nextCharCode);
              var chosenPatternsLength = chosenPatternIdxToConfig.length;
              for (i = 0; i < chosenPatternsLength; i++) {
                currConfig = chosenPatternIdxToConfig[i];
                var currPattern = currConfig.pattern;
                payload = null;
                var singleCharCode = currConfig.short;
                if (singleCharCode !== false) {
                  if (nextCharCode === singleCharCode) {
                    matchedImage = currPattern;
                  }
                } else if (currConfig.isCustom === true) {
                  match = currPattern.exec(orgText, offset, matchedTokens, groups);
                  if (match !== null) {
                    matchedImage = match[0];
                    if (match.payload !== void 0) {
                      payload = match.payload;
                    }
                  } else {
                    matchedImage = null;
                  }
                } else {
                  this.updateLastIndex(currPattern, offset);
                  matchedImage = this.match(currPattern, text, offset);
                }
                if (matchedImage !== null) {
                  longerAltIdx = currConfig.longerAlt;
                  if (longerAltIdx !== void 0) {
                    var longerAltConfig = patternIdxToConfig[longerAltIdx];
                    var longerAltPattern = longerAltConfig.pattern;
                    altPayload = null;
                    if (longerAltConfig.isCustom === true) {
                      match = longerAltPattern.exec(orgText, offset, matchedTokens, groups);
                      if (match !== null) {
                        matchAltImage = match[0];
                        if (match.payload !== void 0) {
                          altPayload = match.payload;
                        }
                      } else {
                        matchAltImage = null;
                      }
                    } else {
                      this.updateLastIndex(longerAltPattern, offset);
                      matchAltImage = this.match(longerAltPattern, text, offset);
                    }
                    if (matchAltImage && matchAltImage.length > matchedImage.length) {
                      matchedImage = matchAltImage;
                      payload = altPayload;
                      currConfig = longerAltConfig;
                    }
                  }
                  break;
                }
              }
              if (matchedImage !== null) {
                imageLength = matchedImage.length;
                group = currConfig.group;
                if (group !== void 0) {
                  tokType = currConfig.tokenTypeIdx;
                  newToken = this.createTokenInstance(matchedImage, offset, tokType, currConfig.tokenType, line, column, imageLength);
                  this.handlePayload(newToken, payload);
                  if (group === false) {
                    matchedTokensIndex = this.addToken(matchedTokens, matchedTokensIndex, newToken);
                  } else {
                    groups[group].push(newToken);
                  }
                }
                text = this.chopInput(text, imageLength);
                offset = offset + imageLength;
                column = this.computeNewColumn(column, imageLength);
                if (trackLines === true && currConfig.canLineTerminator === true) {
                  var numOfLTsInMatch = 0;
                  var foundTerminator = void 0;
                  var lastLTEndOffset = void 0;
                  lineTerminatorPattern.lastIndex = 0;
                  do {
                    foundTerminator = lineTerminatorPattern.test(matchedImage);
                    if (foundTerminator === true) {
                      lastLTEndOffset = lineTerminatorPattern.lastIndex - 1;
                      numOfLTsInMatch++;
                    }
                  } while (foundTerminator === true);
                  if (numOfLTsInMatch !== 0) {
                    line = line + numOfLTsInMatch;
                    column = imageLength - lastLTEndOffset;
                    this.updateTokenEndLineColumnLocation(newToken, group, lastLTEndOffset, numOfLTsInMatch, line, column, imageLength);
                  }
                }
                this.handleModes(currConfig, pop_mode, push_mode, newToken);
              } else {
                var errorStartOffset = offset;
                var errorLine = line;
                var errorColumn = column;
                var foundResyncPoint = false;
                while (!foundResyncPoint && offset < orgLength) {
                  droppedChar = orgText.charCodeAt(offset);
                  text = this.chopInput(text, 1);
                  offset++;
                  for (j = 0; j < currModePatternsLength; j++) {
                    var currConfig_1 = patternIdxToConfig[j];
                    var currPattern = currConfig_1.pattern;
                    var singleCharCode = currConfig_1.short;
                    if (singleCharCode !== false) {
                      if (orgText.charCodeAt(offset) === singleCharCode) {
                        foundResyncPoint = true;
                      }
                    } else if (currConfig_1.isCustom === true) {
                      foundResyncPoint = currPattern.exec(orgText, offset, matchedTokens, groups) !== null;
                    } else {
                      this.updateLastIndex(currPattern, offset);
                      foundResyncPoint = currPattern.exec(text) !== null;
                    }
                    if (foundResyncPoint === true) {
                      break;
                    }
                  }
                }
                errLength = offset - errorStartOffset;
                msg = this.config.errorMessageProvider.buildUnexpectedCharactersMessage(orgText, errorStartOffset, errLength, errorLine, errorColumn);
                errors.push({
                  offset: errorStartOffset,
                  line: errorLine,
                  column: errorColumn,
                  length: errLength,
                  message: msg
                });
              }
            }
            if (!this.hasCustom) {
              matchedTokens.length = matchedTokensIndex;
            }
            return {
              tokens: matchedTokens,
              groups,
              errors
            };
          };
          Lexer2.prototype.handleModes = function(config, pop_mode, push_mode, newToken) {
            if (config.pop === true) {
              var pushMode = config.push;
              pop_mode(newToken);
              if (pushMode !== void 0) {
                push_mode.call(this, pushMode);
              }
            } else if (config.push !== void 0) {
              push_mode.call(this, config.push);
            }
          };
          Lexer2.prototype.chopInput = function(text, length) {
            return text.substring(length);
          };
          Lexer2.prototype.updateLastIndex = function(regExp, newLastIndex) {
            regExp.lastIndex = newLastIndex;
          };
          Lexer2.prototype.updateTokenEndLineColumnLocation = function(newToken, group, lastLTIdx, numOfLTsInMatch, line, column, imageLength) {
            var lastCharIsLT, fixForEndingInLT;
            if (group !== void 0) {
              lastCharIsLT = lastLTIdx === imageLength - 1;
              fixForEndingInLT = lastCharIsLT ? -1 : 0;
              if (!(numOfLTsInMatch === 1 && lastCharIsLT === true)) {
                newToken.endLine = line + fixForEndingInLT;
                newToken.endColumn = column - 1 + -fixForEndingInLT;
              }
            }
          };
          Lexer2.prototype.computeNewColumn = function(oldColumn, imageLength) {
            return oldColumn + imageLength;
          };
          Lexer2.prototype.createTokenInstance = function() {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
              args[_i] = arguments[_i];
            }
            return null;
          };
          Lexer2.prototype.createOffsetOnlyToken = function(image, startOffset, tokenTypeIdx, tokenType) {
            return {
              image,
              startOffset,
              tokenTypeIdx,
              tokenType
            };
          };
          Lexer2.prototype.createStartOnlyToken = function(image, startOffset, tokenTypeIdx, tokenType, startLine, startColumn) {
            return {
              image,
              startOffset,
              startLine,
              startColumn,
              tokenTypeIdx,
              tokenType
            };
          };
          Lexer2.prototype.createFullToken = function(image, startOffset, tokenTypeIdx, tokenType, startLine, startColumn, imageLength) {
            return {
              image,
              startOffset,
              endOffset: startOffset + imageLength - 1,
              startLine,
              endLine: startLine,
              startColumn,
              endColumn: startColumn + imageLength - 1,
              tokenTypeIdx,
              tokenType
            };
          };
          Lexer2.prototype.addToken = function(tokenVector, index, tokenToAdd) {
            return 666;
          };
          Lexer2.prototype.addTokenUsingPush = function(tokenVector, index, tokenToAdd) {
            tokenVector.push(tokenToAdd);
            return index;
          };
          Lexer2.prototype.addTokenUsingMemberAccess = function(tokenVector, index, tokenToAdd) {
            tokenVector[index] = tokenToAdd;
            index++;
            return index;
          };
          Lexer2.prototype.handlePayload = function(token, payload) {
          };
          Lexer2.prototype.handlePayloadNoCustom = function(token, payload) {
          };
          Lexer2.prototype.handlePayloadWithCustom = function(token, payload) {
            if (payload !== null) {
              token.payload = payload;
            }
          };
          Lexer2.prototype.match = function(pattern, text, offset) {
            return null;
          };
          Lexer2.prototype.matchWithTest = function(pattern, text, offset) {
            var found = pattern.test(text);
            if (found === true) {
              return text.substring(offset, pattern.lastIndex);
            }
            return null;
          };
          Lexer2.prototype.matchWithExec = function(pattern, text) {
            var regExpArray = pattern.exec(text);
            return regExpArray !== null ? regExpArray[0] : regExpArray;
          };
          Lexer2.prototype.TRACE_INIT = function(phaseDesc, phaseImpl) {
            if (this.traceInitPerf === true) {
              this.traceInitIndent++;
              var indent = new Array(this.traceInitIndent + 1).join("	");
              if (this.traceInitIndent < this.traceInitMaxIdent) {
                console.log(indent + "--> <" + phaseDesc + ">");
              }
              var _a = utils_1.timer(phaseImpl), time = _a.time, value = _a.value;
              var traceMethod = time > 10 ? console.warn : console.log;
              if (this.traceInitIndent < this.traceInitMaxIdent) {
                traceMethod(indent + "<-- <" + phaseDesc + "> time: " + time + "ms");
              }
              this.traceInitIndent--;
              return value;
            } else {
              return phaseImpl();
            }
          };
          Lexer2.SKIPPED = "This marks a skipped Token pattern, this means each token identified by it willbe consumed and then thrown into oblivion, this can be used to for example to completely ignore whitespace.";
          Lexer2.NA = /NOT_APPLICABLE/;
          return Lexer2;
        })()
      );
      exports2.Lexer = Lexer;
    }
  });

  // ../../node_modules/chevrotain/lib/src/scan/tokens_public.js
  var require_tokens_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/scan/tokens_public.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.tokenMatcher = exports2.createTokenInstance = exports2.EOF = exports2.createToken = exports2.hasTokenLabel = exports2.tokenName = exports2.tokenLabel = void 0;
      var utils_1 = require_utils();
      var lexer_public_1 = require_lexer_public();
      var tokens_1 = require_tokens();
      function tokenLabel(tokType) {
        if (hasTokenLabel(tokType)) {
          return tokType.LABEL;
        } else {
          return tokType.name;
        }
      }
      exports2.tokenLabel = tokenLabel;
      function tokenName(tokType) {
        return tokType.name;
      }
      exports2.tokenName = tokenName;
      function hasTokenLabel(obj) {
        return utils_1.isString(obj.LABEL) && obj.LABEL !== "";
      }
      exports2.hasTokenLabel = hasTokenLabel;
      var PARENT = "parent";
      var CATEGORIES = "categories";
      var LABEL = "label";
      var GROUP = "group";
      var PUSH_MODE = "push_mode";
      var POP_MODE = "pop_mode";
      var LONGER_ALT = "longer_alt";
      var LINE_BREAKS = "line_breaks";
      var START_CHARS_HINT = "start_chars_hint";
      function createToken(config) {
        return createTokenInternal(config);
      }
      exports2.createToken = createToken;
      function createTokenInternal(config) {
        var pattern = config.pattern;
        var tokenType = {};
        tokenType.name = config.name;
        if (!utils_1.isUndefined(pattern)) {
          tokenType.PATTERN = pattern;
        }
        if (utils_1.has(config, PARENT)) {
          throw "The parent property is no longer supported.\nSee: https://github.com/SAP/chevrotain/issues/564#issuecomment-349062346 for details.";
        }
        if (utils_1.has(config, CATEGORIES)) {
          tokenType.CATEGORIES = config[CATEGORIES];
        }
        tokens_1.augmentTokenTypes([tokenType]);
        if (utils_1.has(config, LABEL)) {
          tokenType.LABEL = config[LABEL];
        }
        if (utils_1.has(config, GROUP)) {
          tokenType.GROUP = config[GROUP];
        }
        if (utils_1.has(config, POP_MODE)) {
          tokenType.POP_MODE = config[POP_MODE];
        }
        if (utils_1.has(config, PUSH_MODE)) {
          tokenType.PUSH_MODE = config[PUSH_MODE];
        }
        if (utils_1.has(config, LONGER_ALT)) {
          tokenType.LONGER_ALT = config[LONGER_ALT];
        }
        if (utils_1.has(config, LINE_BREAKS)) {
          tokenType.LINE_BREAKS = config[LINE_BREAKS];
        }
        if (utils_1.has(config, START_CHARS_HINT)) {
          tokenType.START_CHARS_HINT = config[START_CHARS_HINT];
        }
        return tokenType;
      }
      exports2.EOF = createToken({ name: "EOF", pattern: lexer_public_1.Lexer.NA });
      tokens_1.augmentTokenTypes([exports2.EOF]);
      function createTokenInstance(tokType, image, startOffset, endOffset, startLine, endLine, startColumn, endColumn) {
        return {
          image,
          startOffset,
          endOffset,
          startLine,
          endLine,
          startColumn,
          endColumn,
          tokenTypeIdx: tokType.tokenTypeIdx,
          tokenType: tokType
        };
      }
      exports2.createTokenInstance = createTokenInstance;
      function tokenMatcher(token, tokType) {
        return tokens_1.tokenStructuredMatcher(token, tokType);
      }
      exports2.tokenMatcher = tokenMatcher;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/gast/gast_public.js
  var require_gast_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/gast/gast_public.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.serializeProduction = exports2.serializeGrammar = exports2.Terminal = exports2.Alternation = exports2.RepetitionWithSeparator = exports2.Repetition = exports2.RepetitionMandatoryWithSeparator = exports2.RepetitionMandatory = exports2.Option = exports2.Alternative = exports2.Rule = exports2.NonTerminal = exports2.AbstractProduction = void 0;
      var utils_1 = require_utils();
      var tokens_public_1 = require_tokens_public();
      var AbstractProduction = (
        /** @class */
        (function() {
          function AbstractProduction2(_definition) {
            this._definition = _definition;
          }
          Object.defineProperty(AbstractProduction2.prototype, "definition", {
            get: function() {
              return this._definition;
            },
            set: function(value) {
              this._definition = value;
            },
            enumerable: false,
            configurable: true
          });
          AbstractProduction2.prototype.accept = function(visitor) {
            visitor.visit(this);
            utils_1.forEach(this.definition, function(prod) {
              prod.accept(visitor);
            });
          };
          return AbstractProduction2;
        })()
      );
      exports2.AbstractProduction = AbstractProduction;
      var NonTerminal = (
        /** @class */
        (function(_super) {
          __extends(NonTerminal2, _super);
          function NonTerminal2(options) {
            var _this = _super.call(this, []) || this;
            _this.idx = 1;
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          Object.defineProperty(NonTerminal2.prototype, "definition", {
            get: function() {
              if (this.referencedRule !== void 0) {
                return this.referencedRule.definition;
              }
              return [];
            },
            set: function(definition) {
            },
            enumerable: false,
            configurable: true
          });
          NonTerminal2.prototype.accept = function(visitor) {
            visitor.visit(this);
          };
          return NonTerminal2;
        })(AbstractProduction)
      );
      exports2.NonTerminal = NonTerminal;
      var Rule = (
        /** @class */
        (function(_super) {
          __extends(Rule2, _super);
          function Rule2(options) {
            var _this = _super.call(this, options.definition) || this;
            _this.orgText = "";
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          return Rule2;
        })(AbstractProduction)
      );
      exports2.Rule = Rule;
      var Alternative = (
        /** @class */
        (function(_super) {
          __extends(Alternative2, _super);
          function Alternative2(options) {
            var _this = _super.call(this, options.definition) || this;
            _this.ignoreAmbiguities = false;
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          return Alternative2;
        })(AbstractProduction)
      );
      exports2.Alternative = Alternative;
      var Option = (
        /** @class */
        (function(_super) {
          __extends(Option2, _super);
          function Option2(options) {
            var _this = _super.call(this, options.definition) || this;
            _this.idx = 1;
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          return Option2;
        })(AbstractProduction)
      );
      exports2.Option = Option;
      var RepetitionMandatory = (
        /** @class */
        (function(_super) {
          __extends(RepetitionMandatory2, _super);
          function RepetitionMandatory2(options) {
            var _this = _super.call(this, options.definition) || this;
            _this.idx = 1;
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          return RepetitionMandatory2;
        })(AbstractProduction)
      );
      exports2.RepetitionMandatory = RepetitionMandatory;
      var RepetitionMandatoryWithSeparator = (
        /** @class */
        (function(_super) {
          __extends(RepetitionMandatoryWithSeparator2, _super);
          function RepetitionMandatoryWithSeparator2(options) {
            var _this = _super.call(this, options.definition) || this;
            _this.idx = 1;
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          return RepetitionMandatoryWithSeparator2;
        })(AbstractProduction)
      );
      exports2.RepetitionMandatoryWithSeparator = RepetitionMandatoryWithSeparator;
      var Repetition = (
        /** @class */
        (function(_super) {
          __extends(Repetition2, _super);
          function Repetition2(options) {
            var _this = _super.call(this, options.definition) || this;
            _this.idx = 1;
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          return Repetition2;
        })(AbstractProduction)
      );
      exports2.Repetition = Repetition;
      var RepetitionWithSeparator = (
        /** @class */
        (function(_super) {
          __extends(RepetitionWithSeparator2, _super);
          function RepetitionWithSeparator2(options) {
            var _this = _super.call(this, options.definition) || this;
            _this.idx = 1;
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          return RepetitionWithSeparator2;
        })(AbstractProduction)
      );
      exports2.RepetitionWithSeparator = RepetitionWithSeparator;
      var Alternation = (
        /** @class */
        (function(_super) {
          __extends(Alternation2, _super);
          function Alternation2(options) {
            var _this = _super.call(this, options.definition) || this;
            _this.idx = 1;
            _this.ignoreAmbiguities = false;
            _this.hasPredicates = false;
            utils_1.assign(_this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
            return _this;
          }
          Object.defineProperty(Alternation2.prototype, "definition", {
            get: function() {
              return this._definition;
            },
            set: function(value) {
              this._definition = value;
            },
            enumerable: false,
            configurable: true
          });
          return Alternation2;
        })(AbstractProduction)
      );
      exports2.Alternation = Alternation;
      var Terminal = (
        /** @class */
        (function() {
          function Terminal2(options) {
            this.idx = 1;
            utils_1.assign(this, utils_1.pick(options, function(v) {
              return v !== void 0;
            }));
          }
          Terminal2.prototype.accept = function(visitor) {
            visitor.visit(this);
          };
          return Terminal2;
        })()
      );
      exports2.Terminal = Terminal;
      function serializeGrammar(topRules) {
        return utils_1.map(topRules, serializeProduction);
      }
      exports2.serializeGrammar = serializeGrammar;
      function serializeProduction(node) {
        function convertDefinition(definition) {
          return utils_1.map(definition, serializeProduction);
        }
        if (node instanceof NonTerminal) {
          return {
            type: "NonTerminal",
            name: node.nonTerminalName,
            idx: node.idx
          };
        } else if (node instanceof Alternative) {
          return {
            type: "Alternative",
            definition: convertDefinition(node.definition)
          };
        } else if (node instanceof Option) {
          return {
            type: "Option",
            idx: node.idx,
            definition: convertDefinition(node.definition)
          };
        } else if (node instanceof RepetitionMandatory) {
          return {
            type: "RepetitionMandatory",
            idx: node.idx,
            definition: convertDefinition(node.definition)
          };
        } else if (node instanceof RepetitionMandatoryWithSeparator) {
          return {
            type: "RepetitionMandatoryWithSeparator",
            idx: node.idx,
            separator: serializeProduction(new Terminal({ terminalType: node.separator })),
            definition: convertDefinition(node.definition)
          };
        } else if (node instanceof RepetitionWithSeparator) {
          return {
            type: "RepetitionWithSeparator",
            idx: node.idx,
            separator: serializeProduction(new Terminal({ terminalType: node.separator })),
            definition: convertDefinition(node.definition)
          };
        } else if (node instanceof Repetition) {
          return {
            type: "Repetition",
            idx: node.idx,
            definition: convertDefinition(node.definition)
          };
        } else if (node instanceof Alternation) {
          return {
            type: "Alternation",
            idx: node.idx,
            definition: convertDefinition(node.definition)
          };
        } else if (node instanceof Terminal) {
          var serializedTerminal = {
            type: "Terminal",
            name: node.terminalType.name,
            label: tokens_public_1.tokenLabel(node.terminalType),
            idx: node.idx
          };
          var pattern = node.terminalType.PATTERN;
          if (node.terminalType.PATTERN) {
            serializedTerminal.pattern = utils_1.isRegExp(pattern) ? pattern.source : pattern;
          }
          return serializedTerminal;
        } else if (node instanceof Rule) {
          return {
            type: "Rule",
            name: node.name,
            orgText: node.orgText,
            definition: convertDefinition(node.definition)
          };
        } else {
          throw Error("non exhaustive match");
        }
      }
      exports2.serializeProduction = serializeProduction;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/rest.js
  var require_rest = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/rest.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.RestWalker = void 0;
      var utils_1 = require_utils();
      var gast_public_1 = require_gast_public();
      var RestWalker = (
        /** @class */
        (function() {
          function RestWalker2() {
          }
          RestWalker2.prototype.walk = function(prod, prevRest) {
            var _this = this;
            if (prevRest === void 0) {
              prevRest = [];
            }
            utils_1.forEach(prod.definition, function(subProd, index) {
              var currRest = utils_1.drop(prod.definition, index + 1);
              if (subProd instanceof gast_public_1.NonTerminal) {
                _this.walkProdRef(subProd, currRest, prevRest);
              } else if (subProd instanceof gast_public_1.Terminal) {
                _this.walkTerminal(subProd, currRest, prevRest);
              } else if (subProd instanceof gast_public_1.Alternative) {
                _this.walkFlat(subProd, currRest, prevRest);
              } else if (subProd instanceof gast_public_1.Option) {
                _this.walkOption(subProd, currRest, prevRest);
              } else if (subProd instanceof gast_public_1.RepetitionMandatory) {
                _this.walkAtLeastOne(subProd, currRest, prevRest);
              } else if (subProd instanceof gast_public_1.RepetitionMandatoryWithSeparator) {
                _this.walkAtLeastOneSep(subProd, currRest, prevRest);
              } else if (subProd instanceof gast_public_1.RepetitionWithSeparator) {
                _this.walkManySep(subProd, currRest, prevRest);
              } else if (subProd instanceof gast_public_1.Repetition) {
                _this.walkMany(subProd, currRest, prevRest);
              } else if (subProd instanceof gast_public_1.Alternation) {
                _this.walkOr(subProd, currRest, prevRest);
              } else {
                throw Error("non exhaustive match");
              }
            });
          };
          RestWalker2.prototype.walkTerminal = function(terminal, currRest, prevRest) {
          };
          RestWalker2.prototype.walkProdRef = function(refProd, currRest, prevRest) {
          };
          RestWalker2.prototype.walkFlat = function(flatProd, currRest, prevRest) {
            var fullOrRest = currRest.concat(prevRest);
            this.walk(flatProd, fullOrRest);
          };
          RestWalker2.prototype.walkOption = function(optionProd, currRest, prevRest) {
            var fullOrRest = currRest.concat(prevRest);
            this.walk(optionProd, fullOrRest);
          };
          RestWalker2.prototype.walkAtLeastOne = function(atLeastOneProd, currRest, prevRest) {
            var fullAtLeastOneRest = [
              new gast_public_1.Option({ definition: atLeastOneProd.definition })
            ].concat(currRest, prevRest);
            this.walk(atLeastOneProd, fullAtLeastOneRest);
          };
          RestWalker2.prototype.walkAtLeastOneSep = function(atLeastOneSepProd, currRest, prevRest) {
            var fullAtLeastOneSepRest = restForRepetitionWithSeparator(atLeastOneSepProd, currRest, prevRest);
            this.walk(atLeastOneSepProd, fullAtLeastOneSepRest);
          };
          RestWalker2.prototype.walkMany = function(manyProd, currRest, prevRest) {
            var fullManyRest = [
              new gast_public_1.Option({ definition: manyProd.definition })
            ].concat(currRest, prevRest);
            this.walk(manyProd, fullManyRest);
          };
          RestWalker2.prototype.walkManySep = function(manySepProd, currRest, prevRest) {
            var fullManySepRest = restForRepetitionWithSeparator(manySepProd, currRest, prevRest);
            this.walk(manySepProd, fullManySepRest);
          };
          RestWalker2.prototype.walkOr = function(orProd, currRest, prevRest) {
            var _this = this;
            var fullOrRest = currRest.concat(prevRest);
            utils_1.forEach(orProd.definition, function(alt) {
              var prodWrapper = new gast_public_1.Alternative({ definition: [alt] });
              _this.walk(prodWrapper, fullOrRest);
            });
          };
          return RestWalker2;
        })()
      );
      exports2.RestWalker = RestWalker;
      function restForRepetitionWithSeparator(repSepProd, currRest, prevRest) {
        var repSepRest = [
          new gast_public_1.Option({
            definition: [new gast_public_1.Terminal({ terminalType: repSepProd.separator })].concat(repSepProd.definition)
          })
        ];
        var fullRepSepRest = repSepRest.concat(currRest, prevRest);
        return fullRepSepRest;
      }
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/gast/gast_visitor_public.js
  var require_gast_visitor_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/gast/gast_visitor_public.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.GAstVisitor = void 0;
      var gast_public_1 = require_gast_public();
      var GAstVisitor = (
        /** @class */
        (function() {
          function GAstVisitor2() {
          }
          GAstVisitor2.prototype.visit = function(node) {
            var nodeAny = node;
            switch (nodeAny.constructor) {
              case gast_public_1.NonTerminal:
                return this.visitNonTerminal(nodeAny);
              case gast_public_1.Alternative:
                return this.visitAlternative(nodeAny);
              case gast_public_1.Option:
                return this.visitOption(nodeAny);
              case gast_public_1.RepetitionMandatory:
                return this.visitRepetitionMandatory(nodeAny);
              case gast_public_1.RepetitionMandatoryWithSeparator:
                return this.visitRepetitionMandatoryWithSeparator(nodeAny);
              case gast_public_1.RepetitionWithSeparator:
                return this.visitRepetitionWithSeparator(nodeAny);
              case gast_public_1.Repetition:
                return this.visitRepetition(nodeAny);
              case gast_public_1.Alternation:
                return this.visitAlternation(nodeAny);
              case gast_public_1.Terminal:
                return this.visitTerminal(nodeAny);
              case gast_public_1.Rule:
                return this.visitRule(nodeAny);
              /* istanbul ignore next */
              default:
                throw Error("non exhaustive match");
            }
          };
          GAstVisitor2.prototype.visitNonTerminal = function(node) {
          };
          GAstVisitor2.prototype.visitAlternative = function(node) {
          };
          GAstVisitor2.prototype.visitOption = function(node) {
          };
          GAstVisitor2.prototype.visitRepetition = function(node) {
          };
          GAstVisitor2.prototype.visitRepetitionMandatory = function(node) {
          };
          GAstVisitor2.prototype.visitRepetitionMandatoryWithSeparator = function(node) {
          };
          GAstVisitor2.prototype.visitRepetitionWithSeparator = function(node) {
          };
          GAstVisitor2.prototype.visitAlternation = function(node) {
          };
          GAstVisitor2.prototype.visitTerminal = function(node) {
          };
          GAstVisitor2.prototype.visitRule = function(node) {
          };
          return GAstVisitor2;
        })()
      );
      exports2.GAstVisitor = GAstVisitor;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/gast/gast.js
  var require_gast = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/gast/gast.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.collectMethods = exports2.DslMethodsCollectorVisitor = exports2.getProductionDslName = exports2.isBranchingProd = exports2.isOptionalProd = exports2.isSequenceProd = void 0;
      var utils_1 = require_utils();
      var gast_public_1 = require_gast_public();
      var gast_visitor_public_1 = require_gast_visitor_public();
      function isSequenceProd(prod) {
        return prod instanceof gast_public_1.Alternative || prod instanceof gast_public_1.Option || prod instanceof gast_public_1.Repetition || prod instanceof gast_public_1.RepetitionMandatory || prod instanceof gast_public_1.RepetitionMandatoryWithSeparator || prod instanceof gast_public_1.RepetitionWithSeparator || prod instanceof gast_public_1.Terminal || prod instanceof gast_public_1.Rule;
      }
      exports2.isSequenceProd = isSequenceProd;
      function isOptionalProd(prod, alreadyVisited) {
        if (alreadyVisited === void 0) {
          alreadyVisited = [];
        }
        var isDirectlyOptional = prod instanceof gast_public_1.Option || prod instanceof gast_public_1.Repetition || prod instanceof gast_public_1.RepetitionWithSeparator;
        if (isDirectlyOptional) {
          return true;
        }
        if (prod instanceof gast_public_1.Alternation) {
          return utils_1.some(prod.definition, function(subProd) {
            return isOptionalProd(subProd, alreadyVisited);
          });
        } else if (prod instanceof gast_public_1.NonTerminal && utils_1.contains(alreadyVisited, prod)) {
          return false;
        } else if (prod instanceof gast_public_1.AbstractProduction) {
          if (prod instanceof gast_public_1.NonTerminal) {
            alreadyVisited.push(prod);
          }
          return utils_1.every(prod.definition, function(subProd) {
            return isOptionalProd(subProd, alreadyVisited);
          });
        } else {
          return false;
        }
      }
      exports2.isOptionalProd = isOptionalProd;
      function isBranchingProd(prod) {
        return prod instanceof gast_public_1.Alternation;
      }
      exports2.isBranchingProd = isBranchingProd;
      function getProductionDslName(prod) {
        if (prod instanceof gast_public_1.NonTerminal) {
          return "SUBRULE";
        } else if (prod instanceof gast_public_1.Option) {
          return "OPTION";
        } else if (prod instanceof gast_public_1.Alternation) {
          return "OR";
        } else if (prod instanceof gast_public_1.RepetitionMandatory) {
          return "AT_LEAST_ONE";
        } else if (prod instanceof gast_public_1.RepetitionMandatoryWithSeparator) {
          return "AT_LEAST_ONE_SEP";
        } else if (prod instanceof gast_public_1.RepetitionWithSeparator) {
          return "MANY_SEP";
        } else if (prod instanceof gast_public_1.Repetition) {
          return "MANY";
        } else if (prod instanceof gast_public_1.Terminal) {
          return "CONSUME";
        } else {
          throw Error("non exhaustive match");
        }
      }
      exports2.getProductionDslName = getProductionDslName;
      var DslMethodsCollectorVisitor = (
        /** @class */
        (function(_super) {
          __extends(DslMethodsCollectorVisitor2, _super);
          function DslMethodsCollectorVisitor2() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.separator = "-";
            _this.dslMethods = {
              option: [],
              alternation: [],
              repetition: [],
              repetitionWithSeparator: [],
              repetitionMandatory: [],
              repetitionMandatoryWithSeparator: []
            };
            return _this;
          }
          DslMethodsCollectorVisitor2.prototype.reset = function() {
            this.dslMethods = {
              option: [],
              alternation: [],
              repetition: [],
              repetitionWithSeparator: [],
              repetitionMandatory: [],
              repetitionMandatoryWithSeparator: []
            };
          };
          DslMethodsCollectorVisitor2.prototype.visitTerminal = function(terminal) {
            var key = terminal.terminalType.name + this.separator + "Terminal";
            if (!utils_1.has(this.dslMethods, key)) {
              this.dslMethods[key] = [];
            }
            this.dslMethods[key].push(terminal);
          };
          DslMethodsCollectorVisitor2.prototype.visitNonTerminal = function(subrule) {
            var key = subrule.nonTerminalName + this.separator + "Terminal";
            if (!utils_1.has(this.dslMethods, key)) {
              this.dslMethods[key] = [];
            }
            this.dslMethods[key].push(subrule);
          };
          DslMethodsCollectorVisitor2.prototype.visitOption = function(option) {
            this.dslMethods.option.push(option);
          };
          DslMethodsCollectorVisitor2.prototype.visitRepetitionWithSeparator = function(manySep) {
            this.dslMethods.repetitionWithSeparator.push(manySep);
          };
          DslMethodsCollectorVisitor2.prototype.visitRepetitionMandatory = function(atLeastOne) {
            this.dslMethods.repetitionMandatory.push(atLeastOne);
          };
          DslMethodsCollectorVisitor2.prototype.visitRepetitionMandatoryWithSeparator = function(atLeastOneSep) {
            this.dslMethods.repetitionMandatoryWithSeparator.push(atLeastOneSep);
          };
          DslMethodsCollectorVisitor2.prototype.visitRepetition = function(many) {
            this.dslMethods.repetition.push(many);
          };
          DslMethodsCollectorVisitor2.prototype.visitAlternation = function(or) {
            this.dslMethods.alternation.push(or);
          };
          return DslMethodsCollectorVisitor2;
        })(gast_visitor_public_1.GAstVisitor)
      );
      exports2.DslMethodsCollectorVisitor = DslMethodsCollectorVisitor;
      var collectorVisitor = new DslMethodsCollectorVisitor();
      function collectMethods(rule) {
        collectorVisitor.reset();
        rule.accept(collectorVisitor);
        var dslMethods = collectorVisitor.dslMethods;
        collectorVisitor.reset();
        return dslMethods;
      }
      exports2.collectMethods = collectMethods;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/first.js
  var require_first = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/first.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.firstForTerminal = exports2.firstForBranching = exports2.firstForSequence = exports2.first = void 0;
      var utils_1 = require_utils();
      var gast_public_1 = require_gast_public();
      var gast_1 = require_gast();
      function first2(prod) {
        if (prod instanceof gast_public_1.NonTerminal) {
          return first2(prod.referencedRule);
        } else if (prod instanceof gast_public_1.Terminal) {
          return firstForTerminal(prod);
        } else if (gast_1.isSequenceProd(prod)) {
          return firstForSequence(prod);
        } else if (gast_1.isBranchingProd(prod)) {
          return firstForBranching(prod);
        } else {
          throw Error("non exhaustive match");
        }
      }
      exports2.first = first2;
      function firstForSequence(prod) {
        var firstSet = [];
        var seq = prod.definition;
        var nextSubProdIdx = 0;
        var hasInnerProdsRemaining = seq.length > nextSubProdIdx;
        var currSubProd;
        var isLastInnerProdOptional = true;
        while (hasInnerProdsRemaining && isLastInnerProdOptional) {
          currSubProd = seq[nextSubProdIdx];
          isLastInnerProdOptional = gast_1.isOptionalProd(currSubProd);
          firstSet = firstSet.concat(first2(currSubProd));
          nextSubProdIdx = nextSubProdIdx + 1;
          hasInnerProdsRemaining = seq.length > nextSubProdIdx;
        }
        return utils_1.uniq(firstSet);
      }
      exports2.firstForSequence = firstForSequence;
      function firstForBranching(prod) {
        var allAlternativesFirsts = utils_1.map(prod.definition, function(innerProd) {
          return first2(innerProd);
        });
        return utils_1.uniq(utils_1.flatten(allAlternativesFirsts));
      }
      exports2.firstForBranching = firstForBranching;
      function firstForTerminal(terminal) {
        return [terminal.terminalType];
      }
      exports2.firstForTerminal = firstForTerminal;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/constants.js
  var require_constants = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/constants.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.IN = void 0;
      exports2.IN = "_~IN~_";
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/follow.js
  var require_follow = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/follow.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.buildInProdFollowPrefix = exports2.buildBetweenProdsFollowPrefix = exports2.computeAllProdsFollows = exports2.ResyncFollowsWalker = void 0;
      var rest_1 = require_rest();
      var first_1 = require_first();
      var utils_1 = require_utils();
      var constants_1 = require_constants();
      var gast_public_1 = require_gast_public();
      var ResyncFollowsWalker = (
        /** @class */
        (function(_super) {
          __extends(ResyncFollowsWalker2, _super);
          function ResyncFollowsWalker2(topProd) {
            var _this = _super.call(this) || this;
            _this.topProd = topProd;
            _this.follows = {};
            return _this;
          }
          ResyncFollowsWalker2.prototype.startWalking = function() {
            this.walk(this.topProd);
            return this.follows;
          };
          ResyncFollowsWalker2.prototype.walkTerminal = function(terminal, currRest, prevRest) {
          };
          ResyncFollowsWalker2.prototype.walkProdRef = function(refProd, currRest, prevRest) {
            var followName = buildBetweenProdsFollowPrefix(refProd.referencedRule, refProd.idx) + this.topProd.name;
            var fullRest = currRest.concat(prevRest);
            var restProd = new gast_public_1.Alternative({ definition: fullRest });
            var t_in_topProd_follows = first_1.first(restProd);
            this.follows[followName] = t_in_topProd_follows;
          };
          return ResyncFollowsWalker2;
        })(rest_1.RestWalker)
      );
      exports2.ResyncFollowsWalker = ResyncFollowsWalker;
      function computeAllProdsFollows(topProductions) {
        var reSyncFollows = {};
        utils_1.forEach(topProductions, function(topProd) {
          var currRefsFollow = new ResyncFollowsWalker(topProd).startWalking();
          utils_1.assign(reSyncFollows, currRefsFollow);
        });
        return reSyncFollows;
      }
      exports2.computeAllProdsFollows = computeAllProdsFollows;
      function buildBetweenProdsFollowPrefix(inner, occurenceInParent) {
        return inner.name + occurenceInParent + constants_1.IN;
      }
      exports2.buildBetweenProdsFollowPrefix = buildBetweenProdsFollowPrefix;
      function buildInProdFollowPrefix(terminal) {
        var terminalName = terminal.terminalType.name;
        return terminalName + terminal.idx + constants_1.IN;
      }
      exports2.buildInProdFollowPrefix = buildInProdFollowPrefix;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/errors_public.js
  var require_errors_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/errors_public.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.defaultGrammarValidatorErrorProvider = exports2.defaultGrammarResolverErrorProvider = exports2.defaultParserErrorProvider = void 0;
      var tokens_public_1 = require_tokens_public();
      var utils = require_utils();
      var utils_1 = require_utils();
      var gast_public_1 = require_gast_public();
      var gast_1 = require_gast();
      exports2.defaultParserErrorProvider = {
        buildMismatchTokenMessage: function(_a) {
          var expected = _a.expected, actual = _a.actual, previous = _a.previous, ruleName = _a.ruleName;
          var hasLabel = tokens_public_1.hasTokenLabel(expected);
          var expectedMsg = hasLabel ? "--> " + tokens_public_1.tokenLabel(expected) + " <--" : "token of type --> " + expected.name + " <--";
          var msg = "Expecting " + expectedMsg + " but found --> '" + actual.image + "' <--";
          return msg;
        },
        buildNotAllInputParsedMessage: function(_a) {
          var firstRedundant = _a.firstRedundant, ruleName = _a.ruleName;
          return "Redundant input, expecting EOF but found: " + firstRedundant.image;
        },
        buildNoViableAltMessage: function(_a) {
          var expectedPathsPerAlt = _a.expectedPathsPerAlt, actual = _a.actual, previous = _a.previous, customUserDescription = _a.customUserDescription, ruleName = _a.ruleName;
          var errPrefix = "Expecting: ";
          var actualText = utils_1.first(actual).image;
          var errSuffix = "\nbut found: '" + actualText + "'";
          if (customUserDescription) {
            return errPrefix + customUserDescription + errSuffix;
          } else {
            var allLookAheadPaths = utils_1.reduce(expectedPathsPerAlt, function(result, currAltPaths) {
              return result.concat(currAltPaths);
            }, []);
            var nextValidTokenSequences = utils_1.map(allLookAheadPaths, function(currPath) {
              return "[" + utils_1.map(currPath, function(currTokenType) {
                return tokens_public_1.tokenLabel(currTokenType);
              }).join(", ") + "]";
            });
            var nextValidSequenceItems = utils_1.map(nextValidTokenSequences, function(itemMsg, idx) {
              return "  " + (idx + 1) + ". " + itemMsg;
            });
            var calculatedDescription = "one of these possible Token sequences:\n" + nextValidSequenceItems.join("\n");
            return errPrefix + calculatedDescription + errSuffix;
          }
        },
        buildEarlyExitMessage: function(_a) {
          var expectedIterationPaths = _a.expectedIterationPaths, actual = _a.actual, customUserDescription = _a.customUserDescription, ruleName = _a.ruleName;
          var errPrefix = "Expecting: ";
          var actualText = utils_1.first(actual).image;
          var errSuffix = "\nbut found: '" + actualText + "'";
          if (customUserDescription) {
            return errPrefix + customUserDescription + errSuffix;
          } else {
            var nextValidTokenSequences = utils_1.map(expectedIterationPaths, function(currPath) {
              return "[" + utils_1.map(currPath, function(currTokenType) {
                return tokens_public_1.tokenLabel(currTokenType);
              }).join(",") + "]";
            });
            var calculatedDescription = "expecting at least one iteration which starts with one of these possible Token sequences::\n  " + ("<" + nextValidTokenSequences.join(" ,") + ">");
            return errPrefix + calculatedDescription + errSuffix;
          }
        }
      };
      Object.freeze(exports2.defaultParserErrorProvider);
      exports2.defaultGrammarResolverErrorProvider = {
        buildRuleNotFoundError: function(topLevelRule, undefinedRule) {
          var msg = "Invalid grammar, reference to a rule which is not defined: ->" + undefinedRule.nonTerminalName + "<-\ninside top level rule: ->" + topLevelRule.name + "<-";
          return msg;
        }
      };
      exports2.defaultGrammarValidatorErrorProvider = {
        buildDuplicateFoundError: function(topLevelRule, duplicateProds) {
          function getExtraProductionArgument(prod) {
            if (prod instanceof gast_public_1.Terminal) {
              return prod.terminalType.name;
            } else if (prod instanceof gast_public_1.NonTerminal) {
              return prod.nonTerminalName;
            } else {
              return "";
            }
          }
          var topLevelName = topLevelRule.name;
          var duplicateProd = utils_1.first(duplicateProds);
          var index = duplicateProd.idx;
          var dslName = gast_1.getProductionDslName(duplicateProd);
          var extraArgument = getExtraProductionArgument(duplicateProd);
          var hasExplicitIndex = index > 0;
          var msg = "->" + dslName + (hasExplicitIndex ? index : "") + "<- " + (extraArgument ? "with argument: ->" + extraArgument + "<-" : "") + "\n                  appears more than once (" + duplicateProds.length + " times) in the top level rule: ->" + topLevelName + "<-.                  \n                  For further details see: https://sap.github.io/chevrotain/docs/FAQ.html#NUMERICAL_SUFFIXES \n                  ";
          msg = msg.replace(/[ \t]+/g, " ");
          msg = msg.replace(/\s\s+/g, "\n");
          return msg;
        },
        buildNamespaceConflictError: function(rule) {
          var errMsg = "Namespace conflict found in grammar.\n" + ("The grammar has both a Terminal(Token) and a Non-Terminal(Rule) named: <" + rule.name + ">.\n") + "To resolve this make sure each Terminal and Non-Terminal names are unique\nThis is easy to accomplish by using the convention that Terminal names start with an uppercase letter\nand Non-Terminal names start with a lower case letter.";
          return errMsg;
        },
        buildAlternationPrefixAmbiguityError: function(options) {
          var pathMsg = utils_1.map(options.prefixPath, function(currTok) {
            return tokens_public_1.tokenLabel(currTok);
          }).join(", ");
          var occurrence = options.alternation.idx === 0 ? "" : options.alternation.idx;
          var errMsg = "Ambiguous alternatives: <" + options.ambiguityIndices.join(" ,") + "> due to common lookahead prefix\n" + ("in <OR" + occurrence + "> inside <" + options.topLevelRule.name + "> Rule,\n") + ("<" + pathMsg + "> may appears as a prefix path in all these alternatives.\n") + "See: https://sap.github.io/chevrotain/docs/guide/resolving_grammar_errors.html#COMMON_PREFIX\nFor Further details.";
          return errMsg;
        },
        buildAlternationAmbiguityError: function(options) {
          var pathMsg = utils_1.map(options.prefixPath, function(currtok) {
            return tokens_public_1.tokenLabel(currtok);
          }).join(", ");
          var occurrence = options.alternation.idx === 0 ? "" : options.alternation.idx;
          var currMessage = "Ambiguous Alternatives Detected: <" + options.ambiguityIndices.join(" ,") + "> in <OR" + occurrence + ">" + (" inside <" + options.topLevelRule.name + "> Rule,\n") + ("<" + pathMsg + "> may appears as a prefix path in all these alternatives.\n");
          currMessage = currMessage + "See: https://sap.github.io/chevrotain/docs/guide/resolving_grammar_errors.html#AMBIGUOUS_ALTERNATIVES\nFor Further details.";
          return currMessage;
        },
        buildEmptyRepetitionError: function(options) {
          var dslName = gast_1.getProductionDslName(options.repetition);
          if (options.repetition.idx !== 0) {
            dslName += options.repetition.idx;
          }
          var errMsg = "The repetition <" + dslName + "> within Rule <" + options.topLevelRule.name + "> can never consume any tokens.\nThis could lead to an infinite loop.";
          return errMsg;
        },
        // TODO: remove - `errors_public` from nyc.config.js exclude
        //       once this method is fully removed from this file
        buildTokenNameError: function(options) {
          return "deprecated";
        },
        buildEmptyAlternationError: function(options) {
          var errMsg = "Ambiguous empty alternative: <" + (options.emptyChoiceIdx + 1) + ">" + (" in <OR" + options.alternation.idx + "> inside <" + options.topLevelRule.name + "> Rule.\n") + "Only the last alternative may be an empty alternative.";
          return errMsg;
        },
        buildTooManyAlternativesError: function(options) {
          var errMsg = "An Alternation cannot have more than 256 alternatives:\n" + ("<OR" + options.alternation.idx + "> inside <" + options.topLevelRule.name + "> Rule.\n has " + (options.alternation.definition.length + 1) + " alternatives.");
          return errMsg;
        },
        buildLeftRecursionError: function(options) {
          var ruleName = options.topLevelRule.name;
          var pathNames = utils.map(options.leftRecursionPath, function(currRule) {
            return currRule.name;
          });
          var leftRecursivePath = ruleName + " --> " + pathNames.concat([ruleName]).join(" --> ");
          var errMsg = "Left Recursion found in grammar.\n" + ("rule: <" + ruleName + "> can be invoked from itself (directly or indirectly)\n") + ("without consuming any Tokens. The grammar path that causes this is: \n " + leftRecursivePath + "\n") + " To fix this refactor your grammar to remove the left recursion.\nsee: https://en.wikipedia.org/wiki/LL_parser#Left_Factoring.";
          return errMsg;
        },
        // TODO: remove - `errors_public` from nyc.config.js exclude
        //       once this method is fully removed from this file
        buildInvalidRuleNameError: function(options) {
          return "deprecated";
        },
        buildDuplicateRuleNameError: function(options) {
          var ruleName;
          if (options.topLevelRule instanceof gast_public_1.Rule) {
            ruleName = options.topLevelRule.name;
          } else {
            ruleName = options.topLevelRule;
          }
          var errMsg = "Duplicate definition, rule: ->" + ruleName + "<- is already defined in the grammar: ->" + options.grammarName + "<-";
          return errMsg;
        }
      };
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/resolver.js
  var require_resolver = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/resolver.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.GastRefResolverVisitor = exports2.resolveGrammar = void 0;
      var parser_1 = require_parser();
      var utils_1 = require_utils();
      var gast_visitor_public_1 = require_gast_visitor_public();
      function resolveGrammar(topLevels, errMsgProvider) {
        var refResolver = new GastRefResolverVisitor(topLevels, errMsgProvider);
        refResolver.resolveRefs();
        return refResolver.errors;
      }
      exports2.resolveGrammar = resolveGrammar;
      var GastRefResolverVisitor = (
        /** @class */
        (function(_super) {
          __extends(GastRefResolverVisitor2, _super);
          function GastRefResolverVisitor2(nameToTopRule, errMsgProvider) {
            var _this = _super.call(this) || this;
            _this.nameToTopRule = nameToTopRule;
            _this.errMsgProvider = errMsgProvider;
            _this.errors = [];
            return _this;
          }
          GastRefResolverVisitor2.prototype.resolveRefs = function() {
            var _this = this;
            utils_1.forEach(utils_1.values(this.nameToTopRule), function(prod) {
              _this.currTopLevel = prod;
              prod.accept(_this);
            });
          };
          GastRefResolverVisitor2.prototype.visitNonTerminal = function(node) {
            var ref = this.nameToTopRule[node.nonTerminalName];
            if (!ref) {
              var msg = this.errMsgProvider.buildRuleNotFoundError(this.currTopLevel, node);
              this.errors.push({
                message: msg,
                type: parser_1.ParserDefinitionErrorType.UNRESOLVED_SUBRULE_REF,
                ruleName: this.currTopLevel.name,
                unresolvedRefName: node.nonTerminalName
              });
            } else {
              node.referencedRule = ref;
            }
          };
          return GastRefResolverVisitor2;
        })(gast_visitor_public_1.GAstVisitor)
      );
      exports2.GastRefResolverVisitor = GastRefResolverVisitor;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/interpreter.js
  var require_interpreter = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/interpreter.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.nextPossibleTokensAfter = exports2.possiblePathsFrom = exports2.NextTerminalAfterAtLeastOneSepWalker = exports2.NextTerminalAfterAtLeastOneWalker = exports2.NextTerminalAfterManySepWalker = exports2.NextTerminalAfterManyWalker = exports2.AbstractNextTerminalAfterProductionWalker = exports2.NextAfterTokenWalker = exports2.AbstractNextPossibleTokensWalker = void 0;
      var rest_1 = require_rest();
      var utils_1 = require_utils();
      var first_1 = require_first();
      var gast_public_1 = require_gast_public();
      var AbstractNextPossibleTokensWalker = (
        /** @class */
        (function(_super) {
          __extends(AbstractNextPossibleTokensWalker2, _super);
          function AbstractNextPossibleTokensWalker2(topProd, path) {
            var _this = _super.call(this) || this;
            _this.topProd = topProd;
            _this.path = path;
            _this.possibleTokTypes = [];
            _this.nextProductionName = "";
            _this.nextProductionOccurrence = 0;
            _this.found = false;
            _this.isAtEndOfPath = false;
            return _this;
          }
          AbstractNextPossibleTokensWalker2.prototype.startWalking = function() {
            this.found = false;
            if (this.path.ruleStack[0] !== this.topProd.name) {
              throw Error("The path does not start with the walker's top Rule!");
            }
            this.ruleStack = utils_1.cloneArr(this.path.ruleStack).reverse();
            this.occurrenceStack = utils_1.cloneArr(this.path.occurrenceStack).reverse();
            this.ruleStack.pop();
            this.occurrenceStack.pop();
            this.updateExpectedNext();
            this.walk(this.topProd);
            return this.possibleTokTypes;
          };
          AbstractNextPossibleTokensWalker2.prototype.walk = function(prod, prevRest) {
            if (prevRest === void 0) {
              prevRest = [];
            }
            if (!this.found) {
              _super.prototype.walk.call(this, prod, prevRest);
            }
          };
          AbstractNextPossibleTokensWalker2.prototype.walkProdRef = function(refProd, currRest, prevRest) {
            if (refProd.referencedRule.name === this.nextProductionName && refProd.idx === this.nextProductionOccurrence) {
              var fullRest = currRest.concat(prevRest);
              this.updateExpectedNext();
              this.walk(refProd.referencedRule, fullRest);
            }
          };
          AbstractNextPossibleTokensWalker2.prototype.updateExpectedNext = function() {
            if (utils_1.isEmpty(this.ruleStack)) {
              this.nextProductionName = "";
              this.nextProductionOccurrence = 0;
              this.isAtEndOfPath = true;
            } else {
              this.nextProductionName = this.ruleStack.pop();
              this.nextProductionOccurrence = this.occurrenceStack.pop();
            }
          };
          return AbstractNextPossibleTokensWalker2;
        })(rest_1.RestWalker)
      );
      exports2.AbstractNextPossibleTokensWalker = AbstractNextPossibleTokensWalker;
      var NextAfterTokenWalker = (
        /** @class */
        (function(_super) {
          __extends(NextAfterTokenWalker2, _super);
          function NextAfterTokenWalker2(topProd, path) {
            var _this = _super.call(this, topProd, path) || this;
            _this.path = path;
            _this.nextTerminalName = "";
            _this.nextTerminalOccurrence = 0;
            _this.nextTerminalName = _this.path.lastTok.name;
            _this.nextTerminalOccurrence = _this.path.lastTokOccurrence;
            return _this;
          }
          NextAfterTokenWalker2.prototype.walkTerminal = function(terminal, currRest, prevRest) {
            if (this.isAtEndOfPath && terminal.terminalType.name === this.nextTerminalName && terminal.idx === this.nextTerminalOccurrence && !this.found) {
              var fullRest = currRest.concat(prevRest);
              var restProd = new gast_public_1.Alternative({ definition: fullRest });
              this.possibleTokTypes = first_1.first(restProd);
              this.found = true;
            }
          };
          return NextAfterTokenWalker2;
        })(AbstractNextPossibleTokensWalker)
      );
      exports2.NextAfterTokenWalker = NextAfterTokenWalker;
      var AbstractNextTerminalAfterProductionWalker = (
        /** @class */
        (function(_super) {
          __extends(AbstractNextTerminalAfterProductionWalker2, _super);
          function AbstractNextTerminalAfterProductionWalker2(topRule, occurrence) {
            var _this = _super.call(this) || this;
            _this.topRule = topRule;
            _this.occurrence = occurrence;
            _this.result = {
              token: void 0,
              occurrence: void 0,
              isEndOfRule: void 0
            };
            return _this;
          }
          AbstractNextTerminalAfterProductionWalker2.prototype.startWalking = function() {
            this.walk(this.topRule);
            return this.result;
          };
          return AbstractNextTerminalAfterProductionWalker2;
        })(rest_1.RestWalker)
      );
      exports2.AbstractNextTerminalAfterProductionWalker = AbstractNextTerminalAfterProductionWalker;
      var NextTerminalAfterManyWalker = (
        /** @class */
        (function(_super) {
          __extends(NextTerminalAfterManyWalker2, _super);
          function NextTerminalAfterManyWalker2() {
            return _super !== null && _super.apply(this, arguments) || this;
          }
          NextTerminalAfterManyWalker2.prototype.walkMany = function(manyProd, currRest, prevRest) {
            if (manyProd.idx === this.occurrence) {
              var firstAfterMany = utils_1.first(currRest.concat(prevRest));
              this.result.isEndOfRule = firstAfterMany === void 0;
              if (firstAfterMany instanceof gast_public_1.Terminal) {
                this.result.token = firstAfterMany.terminalType;
                this.result.occurrence = firstAfterMany.idx;
              }
            } else {
              _super.prototype.walkMany.call(this, manyProd, currRest, prevRest);
            }
          };
          return NextTerminalAfterManyWalker2;
        })(AbstractNextTerminalAfterProductionWalker)
      );
      exports2.NextTerminalAfterManyWalker = NextTerminalAfterManyWalker;
      var NextTerminalAfterManySepWalker = (
        /** @class */
        (function(_super) {
          __extends(NextTerminalAfterManySepWalker2, _super);
          function NextTerminalAfterManySepWalker2() {
            return _super !== null && _super.apply(this, arguments) || this;
          }
          NextTerminalAfterManySepWalker2.prototype.walkManySep = function(manySepProd, currRest, prevRest) {
            if (manySepProd.idx === this.occurrence) {
              var firstAfterManySep = utils_1.first(currRest.concat(prevRest));
              this.result.isEndOfRule = firstAfterManySep === void 0;
              if (firstAfterManySep instanceof gast_public_1.Terminal) {
                this.result.token = firstAfterManySep.terminalType;
                this.result.occurrence = firstAfterManySep.idx;
              }
            } else {
              _super.prototype.walkManySep.call(this, manySepProd, currRest, prevRest);
            }
          };
          return NextTerminalAfterManySepWalker2;
        })(AbstractNextTerminalAfterProductionWalker)
      );
      exports2.NextTerminalAfterManySepWalker = NextTerminalAfterManySepWalker;
      var NextTerminalAfterAtLeastOneWalker = (
        /** @class */
        (function(_super) {
          __extends(NextTerminalAfterAtLeastOneWalker2, _super);
          function NextTerminalAfterAtLeastOneWalker2() {
            return _super !== null && _super.apply(this, arguments) || this;
          }
          NextTerminalAfterAtLeastOneWalker2.prototype.walkAtLeastOne = function(atLeastOneProd, currRest, prevRest) {
            if (atLeastOneProd.idx === this.occurrence) {
              var firstAfterAtLeastOne = utils_1.first(currRest.concat(prevRest));
              this.result.isEndOfRule = firstAfterAtLeastOne === void 0;
              if (firstAfterAtLeastOne instanceof gast_public_1.Terminal) {
                this.result.token = firstAfterAtLeastOne.terminalType;
                this.result.occurrence = firstAfterAtLeastOne.idx;
              }
            } else {
              _super.prototype.walkAtLeastOne.call(this, atLeastOneProd, currRest, prevRest);
            }
          };
          return NextTerminalAfterAtLeastOneWalker2;
        })(AbstractNextTerminalAfterProductionWalker)
      );
      exports2.NextTerminalAfterAtLeastOneWalker = NextTerminalAfterAtLeastOneWalker;
      var NextTerminalAfterAtLeastOneSepWalker = (
        /** @class */
        (function(_super) {
          __extends(NextTerminalAfterAtLeastOneSepWalker2, _super);
          function NextTerminalAfterAtLeastOneSepWalker2() {
            return _super !== null && _super.apply(this, arguments) || this;
          }
          NextTerminalAfterAtLeastOneSepWalker2.prototype.walkAtLeastOneSep = function(atleastOneSepProd, currRest, prevRest) {
            if (atleastOneSepProd.idx === this.occurrence) {
              var firstAfterfirstAfterAtLeastOneSep = utils_1.first(currRest.concat(prevRest));
              this.result.isEndOfRule = firstAfterfirstAfterAtLeastOneSep === void 0;
              if (firstAfterfirstAfterAtLeastOneSep instanceof gast_public_1.Terminal) {
                this.result.token = firstAfterfirstAfterAtLeastOneSep.terminalType;
                this.result.occurrence = firstAfterfirstAfterAtLeastOneSep.idx;
              }
            } else {
              _super.prototype.walkAtLeastOneSep.call(this, atleastOneSepProd, currRest, prevRest);
            }
          };
          return NextTerminalAfterAtLeastOneSepWalker2;
        })(AbstractNextTerminalAfterProductionWalker)
      );
      exports2.NextTerminalAfterAtLeastOneSepWalker = NextTerminalAfterAtLeastOneSepWalker;
      function possiblePathsFrom(targetDef, maxLength, currPath) {
        if (currPath === void 0) {
          currPath = [];
        }
        currPath = utils_1.cloneArr(currPath);
        var result = [];
        var i = 0;
        function remainingPathWith(nextDef) {
          return nextDef.concat(utils_1.drop(targetDef, i + 1));
        }
        function getAlternativesForProd(definition) {
          var alternatives = possiblePathsFrom(remainingPathWith(definition), maxLength, currPath);
          return result.concat(alternatives);
        }
        while (currPath.length < maxLength && i < targetDef.length) {
          var prod = targetDef[i];
          if (prod instanceof gast_public_1.Alternative) {
            return getAlternativesForProd(prod.definition);
          } else if (prod instanceof gast_public_1.NonTerminal) {
            return getAlternativesForProd(prod.definition);
          } else if (prod instanceof gast_public_1.Option) {
            result = getAlternativesForProd(prod.definition);
          } else if (prod instanceof gast_public_1.RepetitionMandatory) {
            var newDef = prod.definition.concat([
              new gast_public_1.Repetition({
                definition: prod.definition
              })
            ]);
            return getAlternativesForProd(newDef);
          } else if (prod instanceof gast_public_1.RepetitionMandatoryWithSeparator) {
            var newDef = [
              new gast_public_1.Alternative({ definition: prod.definition }),
              new gast_public_1.Repetition({
                definition: [new gast_public_1.Terminal({ terminalType: prod.separator })].concat(prod.definition)
              })
            ];
            return getAlternativesForProd(newDef);
          } else if (prod instanceof gast_public_1.RepetitionWithSeparator) {
            var newDef = prod.definition.concat([
              new gast_public_1.Repetition({
                definition: [new gast_public_1.Terminal({ terminalType: prod.separator })].concat(prod.definition)
              })
            ]);
            result = getAlternativesForProd(newDef);
          } else if (prod instanceof gast_public_1.Repetition) {
            var newDef = prod.definition.concat([
              new gast_public_1.Repetition({
                definition: prod.definition
              })
            ]);
            result = getAlternativesForProd(newDef);
          } else if (prod instanceof gast_public_1.Alternation) {
            utils_1.forEach(prod.definition, function(currAlt) {
              if (utils_1.isEmpty(currAlt.definition) === false) {
                result = getAlternativesForProd(currAlt.definition);
              }
            });
            return result;
          } else if (prod instanceof gast_public_1.Terminal) {
            currPath.push(prod.terminalType);
          } else {
            throw Error("non exhaustive match");
          }
          i++;
        }
        result.push({
          partialPath: currPath,
          suffixDef: utils_1.drop(targetDef, i)
        });
        return result;
      }
      exports2.possiblePathsFrom = possiblePathsFrom;
      function nextPossibleTokensAfter(initialDef, tokenVector, tokMatcher, maxLookAhead) {
        var EXIT_NON_TERMINAL = "EXIT_NONE_TERMINAL";
        var EXIT_NON_TERMINAL_ARR = [EXIT_NON_TERMINAL];
        var EXIT_ALTERNATIVE = "EXIT_ALTERNATIVE";
        var foundCompletePath = false;
        var tokenVectorLength = tokenVector.length;
        var minimalAlternativesIndex = tokenVectorLength - maxLookAhead - 1;
        var result = [];
        var possiblePaths = [];
        possiblePaths.push({
          idx: -1,
          def: initialDef,
          ruleStack: [],
          occurrenceStack: []
        });
        while (!utils_1.isEmpty(possiblePaths)) {
          var currPath = possiblePaths.pop();
          if (currPath === EXIT_ALTERNATIVE) {
            if (foundCompletePath && utils_1.last(possiblePaths).idx <= minimalAlternativesIndex) {
              possiblePaths.pop();
            }
            continue;
          }
          var currDef = currPath.def;
          var currIdx = currPath.idx;
          var currRuleStack = currPath.ruleStack;
          var currOccurrenceStack = currPath.occurrenceStack;
          if (utils_1.isEmpty(currDef)) {
            continue;
          }
          var prod = currDef[0];
          if (prod === EXIT_NON_TERMINAL) {
            var nextPath = {
              idx: currIdx,
              def: utils_1.drop(currDef),
              ruleStack: utils_1.dropRight(currRuleStack),
              occurrenceStack: utils_1.dropRight(currOccurrenceStack)
            };
            possiblePaths.push(nextPath);
          } else if (prod instanceof gast_public_1.Terminal) {
            if (currIdx < tokenVectorLength - 1) {
              var nextIdx = currIdx + 1;
              var actualToken = tokenVector[nextIdx];
              if (tokMatcher(actualToken, prod.terminalType)) {
                var nextPath = {
                  idx: nextIdx,
                  def: utils_1.drop(currDef),
                  ruleStack: currRuleStack,
                  occurrenceStack: currOccurrenceStack
                };
                possiblePaths.push(nextPath);
              }
            } else if (currIdx === tokenVectorLength - 1) {
              result.push({
                nextTokenType: prod.terminalType,
                nextTokenOccurrence: prod.idx,
                ruleStack: currRuleStack,
                occurrenceStack: currOccurrenceStack
              });
              foundCompletePath = true;
            } else {
              throw Error("non exhaustive match");
            }
          } else if (prod instanceof gast_public_1.NonTerminal) {
            var newRuleStack = utils_1.cloneArr(currRuleStack);
            newRuleStack.push(prod.nonTerminalName);
            var newOccurrenceStack = utils_1.cloneArr(currOccurrenceStack);
            newOccurrenceStack.push(prod.idx);
            var nextPath = {
              idx: currIdx,
              def: prod.definition.concat(EXIT_NON_TERMINAL_ARR, utils_1.drop(currDef)),
              ruleStack: newRuleStack,
              occurrenceStack: newOccurrenceStack
            };
            possiblePaths.push(nextPath);
          } else if (prod instanceof gast_public_1.Option) {
            var nextPathWithout = {
              idx: currIdx,
              def: utils_1.drop(currDef),
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            };
            possiblePaths.push(nextPathWithout);
            possiblePaths.push(EXIT_ALTERNATIVE);
            var nextPathWith = {
              idx: currIdx,
              def: prod.definition.concat(utils_1.drop(currDef)),
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            };
            possiblePaths.push(nextPathWith);
          } else if (prod instanceof gast_public_1.RepetitionMandatory) {
            var secondIteration = new gast_public_1.Repetition({
              definition: prod.definition,
              idx: prod.idx
            });
            var nextDef = prod.definition.concat([secondIteration], utils_1.drop(currDef));
            var nextPath = {
              idx: currIdx,
              def: nextDef,
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            };
            possiblePaths.push(nextPath);
          } else if (prod instanceof gast_public_1.RepetitionMandatoryWithSeparator) {
            var separatorGast = new gast_public_1.Terminal({
              terminalType: prod.separator
            });
            var secondIteration = new gast_public_1.Repetition({
              definition: [separatorGast].concat(prod.definition),
              idx: prod.idx
            });
            var nextDef = prod.definition.concat([secondIteration], utils_1.drop(currDef));
            var nextPath = {
              idx: currIdx,
              def: nextDef,
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            };
            possiblePaths.push(nextPath);
          } else if (prod instanceof gast_public_1.RepetitionWithSeparator) {
            var nextPathWithout = {
              idx: currIdx,
              def: utils_1.drop(currDef),
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            };
            possiblePaths.push(nextPathWithout);
            possiblePaths.push(EXIT_ALTERNATIVE);
            var separatorGast = new gast_public_1.Terminal({
              terminalType: prod.separator
            });
            var nthRepetition = new gast_public_1.Repetition({
              definition: [separatorGast].concat(prod.definition),
              idx: prod.idx
            });
            var nextDef = prod.definition.concat([nthRepetition], utils_1.drop(currDef));
            var nextPathWith = {
              idx: currIdx,
              def: nextDef,
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            };
            possiblePaths.push(nextPathWith);
          } else if (prod instanceof gast_public_1.Repetition) {
            var nextPathWithout = {
              idx: currIdx,
              def: utils_1.drop(currDef),
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            };
            possiblePaths.push(nextPathWithout);
            possiblePaths.push(EXIT_ALTERNATIVE);
            var nthRepetition = new gast_public_1.Repetition({
              definition: prod.definition,
              idx: prod.idx
            });
            var nextDef = prod.definition.concat([nthRepetition], utils_1.drop(currDef));
            var nextPathWith = {
              idx: currIdx,
              def: nextDef,
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            };
            possiblePaths.push(nextPathWith);
          } else if (prod instanceof gast_public_1.Alternation) {
            for (var i = prod.definition.length - 1; i >= 0; i--) {
              var currAlt = prod.definition[i];
              var currAltPath = {
                idx: currIdx,
                def: currAlt.definition.concat(utils_1.drop(currDef)),
                ruleStack: currRuleStack,
                occurrenceStack: currOccurrenceStack
              };
              possiblePaths.push(currAltPath);
              possiblePaths.push(EXIT_ALTERNATIVE);
            }
          } else if (prod instanceof gast_public_1.Alternative) {
            possiblePaths.push({
              idx: currIdx,
              def: prod.definition.concat(utils_1.drop(currDef)),
              ruleStack: currRuleStack,
              occurrenceStack: currOccurrenceStack
            });
          } else if (prod instanceof gast_public_1.Rule) {
            possiblePaths.push(expandTopLevelRule(prod, currIdx, currRuleStack, currOccurrenceStack));
          } else {
            throw Error("non exhaustive match");
          }
        }
        return result;
      }
      exports2.nextPossibleTokensAfter = nextPossibleTokensAfter;
      function expandTopLevelRule(topRule, currIdx, currRuleStack, currOccurrenceStack) {
        var newRuleStack = utils_1.cloneArr(currRuleStack);
        newRuleStack.push(topRule.name);
        var newCurrOccurrenceStack = utils_1.cloneArr(currOccurrenceStack);
        newCurrOccurrenceStack.push(1);
        return {
          idx: currIdx,
          def: topRule.definition,
          ruleStack: newRuleStack,
          occurrenceStack: newCurrOccurrenceStack
        };
      }
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/lookahead.js
  var require_lookahead = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/lookahead.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.areTokenCategoriesNotUsed = exports2.isStrictPrefixOfPath = exports2.containsPath = exports2.getLookaheadPathsForOptionalProd = exports2.getLookaheadPathsForOr = exports2.lookAheadSequenceFromAlternatives = exports2.buildSingleAlternativeLookaheadFunction = exports2.buildAlternativesLookAheadFunc = exports2.buildLookaheadFuncForOptionalProd = exports2.buildLookaheadFuncForOr = exports2.getProdType = exports2.PROD_TYPE = void 0;
      var utils_1 = require_utils();
      var interpreter_1 = require_interpreter();
      var rest_1 = require_rest();
      var tokens_1 = require_tokens();
      var gast_public_1 = require_gast_public();
      var gast_visitor_public_1 = require_gast_visitor_public();
      var PROD_TYPE;
      (function(PROD_TYPE2) {
        PROD_TYPE2[PROD_TYPE2["OPTION"] = 0] = "OPTION";
        PROD_TYPE2[PROD_TYPE2["REPETITION"] = 1] = "REPETITION";
        PROD_TYPE2[PROD_TYPE2["REPETITION_MANDATORY"] = 2] = "REPETITION_MANDATORY";
        PROD_TYPE2[PROD_TYPE2["REPETITION_MANDATORY_WITH_SEPARATOR"] = 3] = "REPETITION_MANDATORY_WITH_SEPARATOR";
        PROD_TYPE2[PROD_TYPE2["REPETITION_WITH_SEPARATOR"] = 4] = "REPETITION_WITH_SEPARATOR";
        PROD_TYPE2[PROD_TYPE2["ALTERNATION"] = 5] = "ALTERNATION";
      })(PROD_TYPE = exports2.PROD_TYPE || (exports2.PROD_TYPE = {}));
      function getProdType(prod) {
        if (prod instanceof gast_public_1.Option) {
          return PROD_TYPE.OPTION;
        } else if (prod instanceof gast_public_1.Repetition) {
          return PROD_TYPE.REPETITION;
        } else if (prod instanceof gast_public_1.RepetitionMandatory) {
          return PROD_TYPE.REPETITION_MANDATORY;
        } else if (prod instanceof gast_public_1.RepetitionMandatoryWithSeparator) {
          return PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR;
        } else if (prod instanceof gast_public_1.RepetitionWithSeparator) {
          return PROD_TYPE.REPETITION_WITH_SEPARATOR;
        } else if (prod instanceof gast_public_1.Alternation) {
          return PROD_TYPE.ALTERNATION;
        } else {
          throw Error("non exhaustive match");
        }
      }
      exports2.getProdType = getProdType;
      function buildLookaheadFuncForOr(occurrence, ruleGrammar, maxLookahead, hasPredicates, dynamicTokensEnabled, laFuncBuilder) {
        var lookAheadPaths = getLookaheadPathsForOr(occurrence, ruleGrammar, maxLookahead);
        var tokenMatcher = areTokenCategoriesNotUsed(lookAheadPaths) ? tokens_1.tokenStructuredMatcherNoCategories : tokens_1.tokenStructuredMatcher;
        return laFuncBuilder(lookAheadPaths, hasPredicates, tokenMatcher, dynamicTokensEnabled);
      }
      exports2.buildLookaheadFuncForOr = buildLookaheadFuncForOr;
      function buildLookaheadFuncForOptionalProd(occurrence, ruleGrammar, k, dynamicTokensEnabled, prodType, lookaheadBuilder) {
        var lookAheadPaths = getLookaheadPathsForOptionalProd(occurrence, ruleGrammar, prodType, k);
        var tokenMatcher = areTokenCategoriesNotUsed(lookAheadPaths) ? tokens_1.tokenStructuredMatcherNoCategories : tokens_1.tokenStructuredMatcher;
        return lookaheadBuilder(lookAheadPaths[0], tokenMatcher, dynamicTokensEnabled);
      }
      exports2.buildLookaheadFuncForOptionalProd = buildLookaheadFuncForOptionalProd;
      function buildAlternativesLookAheadFunc(alts, hasPredicates, tokenMatcher, dynamicTokensEnabled) {
        var numOfAlts = alts.length;
        var areAllOneTokenLookahead = utils_1.every(alts, function(currAlt) {
          return utils_1.every(currAlt, function(currPath) {
            return currPath.length === 1;
          });
        });
        if (hasPredicates) {
          return function(orAlts) {
            var predicates = utils_1.map(orAlts, function(currAlt2) {
              return currAlt2.GATE;
            });
            for (var t = 0; t < numOfAlts; t++) {
              var currAlt = alts[t];
              var currNumOfPaths = currAlt.length;
              var currPredicate = predicates[t];
              if (currPredicate !== void 0 && currPredicate.call(this) === false) {
                continue;
              }
              nextPath: for (var j = 0; j < currNumOfPaths; j++) {
                var currPath = currAlt[j];
                var currPathLength = currPath.length;
                for (var i = 0; i < currPathLength; i++) {
                  var nextToken = this.LA(i + 1);
                  if (tokenMatcher(nextToken, currPath[i]) === false) {
                    continue nextPath;
                  }
                }
                return t;
              }
            }
            return void 0;
          };
        } else if (areAllOneTokenLookahead && !dynamicTokensEnabled) {
          var singleTokenAlts = utils_1.map(alts, function(currAlt) {
            return utils_1.flatten(currAlt);
          });
          var choiceToAlt_1 = utils_1.reduce(singleTokenAlts, function(result, currAlt, idx) {
            utils_1.forEach(currAlt, function(currTokType) {
              if (!utils_1.has(result, currTokType.tokenTypeIdx)) {
                result[currTokType.tokenTypeIdx] = idx;
              }
              utils_1.forEach(currTokType.categoryMatches, function(currExtendingType) {
                if (!utils_1.has(result, currExtendingType)) {
                  result[currExtendingType] = idx;
                }
              });
            });
            return result;
          }, []);
          return function() {
            var nextToken = this.LA(1);
            return choiceToAlt_1[nextToken.tokenTypeIdx];
          };
        } else {
          return function() {
            for (var t = 0; t < numOfAlts; t++) {
              var currAlt = alts[t];
              var currNumOfPaths = currAlt.length;
              nextPath: for (var j = 0; j < currNumOfPaths; j++) {
                var currPath = currAlt[j];
                var currPathLength = currPath.length;
                for (var i = 0; i < currPathLength; i++) {
                  var nextToken = this.LA(i + 1);
                  if (tokenMatcher(nextToken, currPath[i]) === false) {
                    continue nextPath;
                  }
                }
                return t;
              }
            }
            return void 0;
          };
        }
      }
      exports2.buildAlternativesLookAheadFunc = buildAlternativesLookAheadFunc;
      function buildSingleAlternativeLookaheadFunction(alt, tokenMatcher, dynamicTokensEnabled) {
        var areAllOneTokenLookahead = utils_1.every(alt, function(currPath) {
          return currPath.length === 1;
        });
        var numOfPaths = alt.length;
        if (areAllOneTokenLookahead && !dynamicTokensEnabled) {
          var singleTokensTypes = utils_1.flatten(alt);
          if (singleTokensTypes.length === 1 && utils_1.isEmpty(singleTokensTypes[0].categoryMatches)) {
            var expectedTokenType = singleTokensTypes[0];
            var expectedTokenUniqueKey_1 = expectedTokenType.tokenTypeIdx;
            return function() {
              return this.LA(1).tokenTypeIdx === expectedTokenUniqueKey_1;
            };
          } else {
            var choiceToAlt_2 = utils_1.reduce(singleTokensTypes, function(result, currTokType, idx) {
              result[currTokType.tokenTypeIdx] = true;
              utils_1.forEach(currTokType.categoryMatches, function(currExtendingType) {
                result[currExtendingType] = true;
              });
              return result;
            }, []);
            return function() {
              var nextToken = this.LA(1);
              return choiceToAlt_2[nextToken.tokenTypeIdx] === true;
            };
          }
        } else {
          return function() {
            nextPath: for (var j = 0; j < numOfPaths; j++) {
              var currPath = alt[j];
              var currPathLength = currPath.length;
              for (var i = 0; i < currPathLength; i++) {
                var nextToken = this.LA(i + 1);
                if (tokenMatcher(nextToken, currPath[i]) === false) {
                  continue nextPath;
                }
              }
              return true;
            }
            return false;
          };
        }
      }
      exports2.buildSingleAlternativeLookaheadFunction = buildSingleAlternativeLookaheadFunction;
      var RestDefinitionFinderWalker = (
        /** @class */
        (function(_super) {
          __extends(RestDefinitionFinderWalker2, _super);
          function RestDefinitionFinderWalker2(topProd, targetOccurrence, targetProdType) {
            var _this = _super.call(this) || this;
            _this.topProd = topProd;
            _this.targetOccurrence = targetOccurrence;
            _this.targetProdType = targetProdType;
            return _this;
          }
          RestDefinitionFinderWalker2.prototype.startWalking = function() {
            this.walk(this.topProd);
            return this.restDef;
          };
          RestDefinitionFinderWalker2.prototype.checkIsTarget = function(node, expectedProdType, currRest, prevRest) {
            if (node.idx === this.targetOccurrence && this.targetProdType === expectedProdType) {
              this.restDef = currRest.concat(prevRest);
              return true;
            }
            return false;
          };
          RestDefinitionFinderWalker2.prototype.walkOption = function(optionProd, currRest, prevRest) {
            if (!this.checkIsTarget(optionProd, PROD_TYPE.OPTION, currRest, prevRest)) {
              _super.prototype.walkOption.call(this, optionProd, currRest, prevRest);
            }
          };
          RestDefinitionFinderWalker2.prototype.walkAtLeastOne = function(atLeastOneProd, currRest, prevRest) {
            if (!this.checkIsTarget(atLeastOneProd, PROD_TYPE.REPETITION_MANDATORY, currRest, prevRest)) {
              _super.prototype.walkOption.call(this, atLeastOneProd, currRest, prevRest);
            }
          };
          RestDefinitionFinderWalker2.prototype.walkAtLeastOneSep = function(atLeastOneSepProd, currRest, prevRest) {
            if (!this.checkIsTarget(atLeastOneSepProd, PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR, currRest, prevRest)) {
              _super.prototype.walkOption.call(this, atLeastOneSepProd, currRest, prevRest);
            }
          };
          RestDefinitionFinderWalker2.prototype.walkMany = function(manyProd, currRest, prevRest) {
            if (!this.checkIsTarget(manyProd, PROD_TYPE.REPETITION, currRest, prevRest)) {
              _super.prototype.walkOption.call(this, manyProd, currRest, prevRest);
            }
          };
          RestDefinitionFinderWalker2.prototype.walkManySep = function(manySepProd, currRest, prevRest) {
            if (!this.checkIsTarget(manySepProd, PROD_TYPE.REPETITION_WITH_SEPARATOR, currRest, prevRest)) {
              _super.prototype.walkOption.call(this, manySepProd, currRest, prevRest);
            }
          };
          return RestDefinitionFinderWalker2;
        })(rest_1.RestWalker)
      );
      var InsideDefinitionFinderVisitor = (
        /** @class */
        (function(_super) {
          __extends(InsideDefinitionFinderVisitor2, _super);
          function InsideDefinitionFinderVisitor2(targetOccurrence, targetProdType, targetRef) {
            var _this = _super.call(this) || this;
            _this.targetOccurrence = targetOccurrence;
            _this.targetProdType = targetProdType;
            _this.targetRef = targetRef;
            _this.result = [];
            return _this;
          }
          InsideDefinitionFinderVisitor2.prototype.checkIsTarget = function(node, expectedProdName) {
            if (node.idx === this.targetOccurrence && this.targetProdType === expectedProdName && (this.targetRef === void 0 || node === this.targetRef)) {
              this.result = node.definition;
            }
          };
          InsideDefinitionFinderVisitor2.prototype.visitOption = function(node) {
            this.checkIsTarget(node, PROD_TYPE.OPTION);
          };
          InsideDefinitionFinderVisitor2.prototype.visitRepetition = function(node) {
            this.checkIsTarget(node, PROD_TYPE.REPETITION);
          };
          InsideDefinitionFinderVisitor2.prototype.visitRepetitionMandatory = function(node) {
            this.checkIsTarget(node, PROD_TYPE.REPETITION_MANDATORY);
          };
          InsideDefinitionFinderVisitor2.prototype.visitRepetitionMandatoryWithSeparator = function(node) {
            this.checkIsTarget(node, PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR);
          };
          InsideDefinitionFinderVisitor2.prototype.visitRepetitionWithSeparator = function(node) {
            this.checkIsTarget(node, PROD_TYPE.REPETITION_WITH_SEPARATOR);
          };
          InsideDefinitionFinderVisitor2.prototype.visitAlternation = function(node) {
            this.checkIsTarget(node, PROD_TYPE.ALTERNATION);
          };
          return InsideDefinitionFinderVisitor2;
        })(gast_visitor_public_1.GAstVisitor)
      );
      function initializeArrayOfArrays(size) {
        var result = new Array(size);
        for (var i = 0; i < size; i++) {
          result[i] = [];
        }
        return result;
      }
      function pathToHashKeys(path) {
        var keys2 = [""];
        for (var i = 0; i < path.length; i++) {
          var tokType = path[i];
          var longerKeys = [];
          for (var j = 0; j < keys2.length; j++) {
            var currShorterKey = keys2[j];
            longerKeys.push(currShorterKey + "_" + tokType.tokenTypeIdx);
            for (var t = 0; t < tokType.categoryMatches.length; t++) {
              var categoriesKeySuffix = "_" + tokType.categoryMatches[t];
              longerKeys.push(currShorterKey + categoriesKeySuffix);
            }
          }
          keys2 = longerKeys;
        }
        return keys2;
      }
      function isUniquePrefixHash(altKnownPathsKeys, searchPathKeys, idx) {
        for (var currAltIdx = 0; currAltIdx < altKnownPathsKeys.length; currAltIdx++) {
          if (currAltIdx === idx) {
            continue;
          }
          var otherAltKnownPathsKeys = altKnownPathsKeys[currAltIdx];
          for (var searchIdx = 0; searchIdx < searchPathKeys.length; searchIdx++) {
            var searchKey = searchPathKeys[searchIdx];
            if (otherAltKnownPathsKeys[searchKey] === true) {
              return false;
            }
          }
        }
        return true;
      }
      function lookAheadSequenceFromAlternatives(altsDefs, k) {
        var partialAlts = utils_1.map(altsDefs, function(currAlt) {
          return interpreter_1.possiblePathsFrom([currAlt], 1);
        });
        var finalResult = initializeArrayOfArrays(partialAlts.length);
        var altsHashes = utils_1.map(partialAlts, function(currAltPaths) {
          var dict = {};
          utils_1.forEach(currAltPaths, function(item) {
            var keys2 = pathToHashKeys(item.partialPath);
            utils_1.forEach(keys2, function(currKey) {
              dict[currKey] = true;
            });
          });
          return dict;
        });
        var newData = partialAlts;
        for (var pathLength = 1; pathLength <= k; pathLength++) {
          var currDataset = newData;
          newData = initializeArrayOfArrays(currDataset.length);
          var _loop_1 = function(altIdx2) {
            var currAltPathsAndSuffixes = currDataset[altIdx2];
            for (var currPathIdx = 0; currPathIdx < currAltPathsAndSuffixes.length; currPathIdx++) {
              var currPathPrefix = currAltPathsAndSuffixes[currPathIdx].partialPath;
              var suffixDef = currAltPathsAndSuffixes[currPathIdx].suffixDef;
              var prefixKeys = pathToHashKeys(currPathPrefix);
              var isUnique = isUniquePrefixHash(altsHashes, prefixKeys, altIdx2);
              if (isUnique || utils_1.isEmpty(suffixDef) || currPathPrefix.length === k) {
                var currAltResult = finalResult[altIdx2];
                if (containsPath(currAltResult, currPathPrefix) === false) {
                  currAltResult.push(currPathPrefix);
                  for (var j = 0; j < prefixKeys.length; j++) {
                    var currKey = prefixKeys[j];
                    altsHashes[altIdx2][currKey] = true;
                  }
                }
              } else {
                var newPartialPathsAndSuffixes = interpreter_1.possiblePathsFrom(suffixDef, pathLength + 1, currPathPrefix);
                newData[altIdx2] = newData[altIdx2].concat(newPartialPathsAndSuffixes);
                utils_1.forEach(newPartialPathsAndSuffixes, function(item) {
                  var prefixKeys2 = pathToHashKeys(item.partialPath);
                  utils_1.forEach(prefixKeys2, function(key) {
                    altsHashes[altIdx2][key] = true;
                  });
                });
              }
            }
          };
          for (var altIdx = 0; altIdx < currDataset.length; altIdx++) {
            _loop_1(altIdx);
          }
        }
        return finalResult;
      }
      exports2.lookAheadSequenceFromAlternatives = lookAheadSequenceFromAlternatives;
      function getLookaheadPathsForOr(occurrence, ruleGrammar, k, orProd) {
        var visitor = new InsideDefinitionFinderVisitor(occurrence, PROD_TYPE.ALTERNATION, orProd);
        ruleGrammar.accept(visitor);
        return lookAheadSequenceFromAlternatives(visitor.result, k);
      }
      exports2.getLookaheadPathsForOr = getLookaheadPathsForOr;
      function getLookaheadPathsForOptionalProd(occurrence, ruleGrammar, prodType, k) {
        var insideDefVisitor = new InsideDefinitionFinderVisitor(occurrence, prodType);
        ruleGrammar.accept(insideDefVisitor);
        var insideDef = insideDefVisitor.result;
        var afterDefWalker = new RestDefinitionFinderWalker(ruleGrammar, occurrence, prodType);
        var afterDef = afterDefWalker.startWalking();
        var insideFlat = new gast_public_1.Alternative({ definition: insideDef });
        var afterFlat = new gast_public_1.Alternative({ definition: afterDef });
        return lookAheadSequenceFromAlternatives([insideFlat, afterFlat], k);
      }
      exports2.getLookaheadPathsForOptionalProd = getLookaheadPathsForOptionalProd;
      function containsPath(alternative, searchPath) {
        compareOtherPath: for (var i = 0; i < alternative.length; i++) {
          var otherPath = alternative[i];
          if (otherPath.length !== searchPath.length) {
            continue;
          }
          for (var j = 0; j < otherPath.length; j++) {
            var searchTok = searchPath[j];
            var otherTok = otherPath[j];
            var matchingTokens = searchTok === otherTok || otherTok.categoryMatchesMap[searchTok.tokenTypeIdx] !== void 0;
            if (matchingTokens === false) {
              continue compareOtherPath;
            }
          }
          return true;
        }
        return false;
      }
      exports2.containsPath = containsPath;
      function isStrictPrefixOfPath(prefix, other) {
        return prefix.length < other.length && utils_1.every(prefix, function(tokType, idx) {
          var otherTokType = other[idx];
          return tokType === otherTokType || otherTokType.categoryMatchesMap[tokType.tokenTypeIdx];
        });
      }
      exports2.isStrictPrefixOfPath = isStrictPrefixOfPath;
      function areTokenCategoriesNotUsed(lookAheadPaths) {
        return utils_1.every(lookAheadPaths, function(singleAltPaths) {
          return utils_1.every(singleAltPaths, function(singlePath) {
            return utils_1.every(singlePath, function(token) {
              return utils_1.isEmpty(token.categoryMatches);
            });
          });
        });
      }
      exports2.areTokenCategoriesNotUsed = areTokenCategoriesNotUsed;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/checks.js
  var require_checks = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/checks.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.checkPrefixAlternativesAmbiguities = exports2.validateSomeNonEmptyLookaheadPath = exports2.validateTooManyAlts = exports2.RepetionCollector = exports2.validateAmbiguousAlternationAlternatives = exports2.validateEmptyOrAlternative = exports2.getFirstNoneTerminal = exports2.validateNoLeftRecursion = exports2.validateRuleIsOverridden = exports2.validateRuleDoesNotAlreadyExist = exports2.OccurrenceValidationCollector = exports2.identifyProductionForDuplicates = exports2.validateGrammar = void 0;
      var utils = require_utils();
      var utils_1 = require_utils();
      var parser_1 = require_parser();
      var gast_1 = require_gast();
      var lookahead_1 = require_lookahead();
      var interpreter_1 = require_interpreter();
      var gast_public_1 = require_gast_public();
      var gast_visitor_public_1 = require_gast_visitor_public();
      function validateGrammar(topLevels, globalMaxLookahead, tokenTypes, errMsgProvider, grammarName) {
        var duplicateErrors = utils.map(topLevels, function(currTopLevel) {
          return validateDuplicateProductions(currTopLevel, errMsgProvider);
        });
        var leftRecursionErrors = utils.map(topLevels, function(currTopRule) {
          return validateNoLeftRecursion(currTopRule, currTopRule, errMsgProvider);
        });
        var emptyAltErrors = [];
        var ambiguousAltsErrors = [];
        var emptyRepetitionErrors = [];
        if (utils_1.every(leftRecursionErrors, utils_1.isEmpty)) {
          emptyAltErrors = utils_1.map(topLevels, function(currTopRule) {
            return validateEmptyOrAlternative(currTopRule, errMsgProvider);
          });
          ambiguousAltsErrors = utils_1.map(topLevels, function(currTopRule) {
            return validateAmbiguousAlternationAlternatives(currTopRule, globalMaxLookahead, errMsgProvider);
          });
          emptyRepetitionErrors = validateSomeNonEmptyLookaheadPath(topLevels, globalMaxLookahead, errMsgProvider);
        }
        var termsNamespaceConflictErrors = checkTerminalAndNoneTerminalsNameSpace(topLevels, tokenTypes, errMsgProvider);
        var tooManyAltsErrors = utils_1.map(topLevels, function(curRule) {
          return validateTooManyAlts(curRule, errMsgProvider);
        });
        var duplicateRulesError = utils_1.map(topLevels, function(curRule) {
          return validateRuleDoesNotAlreadyExist(curRule, topLevels, grammarName, errMsgProvider);
        });
        return utils.flatten(duplicateErrors.concat(emptyRepetitionErrors, leftRecursionErrors, emptyAltErrors, ambiguousAltsErrors, termsNamespaceConflictErrors, tooManyAltsErrors, duplicateRulesError));
      }
      exports2.validateGrammar = validateGrammar;
      function validateDuplicateProductions(topLevelRule, errMsgProvider) {
        var collectorVisitor = new OccurrenceValidationCollector();
        topLevelRule.accept(collectorVisitor);
        var allRuleProductions = collectorVisitor.allProductions;
        var productionGroups = utils.groupBy(allRuleProductions, identifyProductionForDuplicates);
        var duplicates = utils.pick(productionGroups, function(currGroup) {
          return currGroup.length > 1;
        });
        var errors = utils.map(utils.values(duplicates), function(currDuplicates) {
          var firstProd = utils.first(currDuplicates);
          var msg = errMsgProvider.buildDuplicateFoundError(topLevelRule, currDuplicates);
          var dslName = gast_1.getProductionDslName(firstProd);
          var defError = {
            message: msg,
            type: parser_1.ParserDefinitionErrorType.DUPLICATE_PRODUCTIONS,
            ruleName: topLevelRule.name,
            dslName,
            occurrence: firstProd.idx
          };
          var param = getExtraProductionArgument(firstProd);
          if (param) {
            defError.parameter = param;
          }
          return defError;
        });
        return errors;
      }
      function identifyProductionForDuplicates(prod) {
        return gast_1.getProductionDslName(prod) + "_#_" + prod.idx + "_#_" + getExtraProductionArgument(prod);
      }
      exports2.identifyProductionForDuplicates = identifyProductionForDuplicates;
      function getExtraProductionArgument(prod) {
        if (prod instanceof gast_public_1.Terminal) {
          return prod.terminalType.name;
        } else if (prod instanceof gast_public_1.NonTerminal) {
          return prod.nonTerminalName;
        } else {
          return "";
        }
      }
      var OccurrenceValidationCollector = (
        /** @class */
        (function(_super) {
          __extends(OccurrenceValidationCollector2, _super);
          function OccurrenceValidationCollector2() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.allProductions = [];
            return _this;
          }
          OccurrenceValidationCollector2.prototype.visitNonTerminal = function(subrule) {
            this.allProductions.push(subrule);
          };
          OccurrenceValidationCollector2.prototype.visitOption = function(option) {
            this.allProductions.push(option);
          };
          OccurrenceValidationCollector2.prototype.visitRepetitionWithSeparator = function(manySep) {
            this.allProductions.push(manySep);
          };
          OccurrenceValidationCollector2.prototype.visitRepetitionMandatory = function(atLeastOne) {
            this.allProductions.push(atLeastOne);
          };
          OccurrenceValidationCollector2.prototype.visitRepetitionMandatoryWithSeparator = function(atLeastOneSep) {
            this.allProductions.push(atLeastOneSep);
          };
          OccurrenceValidationCollector2.prototype.visitRepetition = function(many) {
            this.allProductions.push(many);
          };
          OccurrenceValidationCollector2.prototype.visitAlternation = function(or) {
            this.allProductions.push(or);
          };
          OccurrenceValidationCollector2.prototype.visitTerminal = function(terminal) {
            this.allProductions.push(terminal);
          };
          return OccurrenceValidationCollector2;
        })(gast_visitor_public_1.GAstVisitor)
      );
      exports2.OccurrenceValidationCollector = OccurrenceValidationCollector;
      function validateRuleDoesNotAlreadyExist(rule, allRules, className, errMsgProvider) {
        var errors = [];
        var occurrences = utils_1.reduce(allRules, function(result, curRule) {
          if (curRule.name === rule.name) {
            return result + 1;
          }
          return result;
        }, 0);
        if (occurrences > 1) {
          var errMsg = errMsgProvider.buildDuplicateRuleNameError({
            topLevelRule: rule,
            grammarName: className
          });
          errors.push({
            message: errMsg,
            type: parser_1.ParserDefinitionErrorType.DUPLICATE_RULE_NAME,
            ruleName: rule.name
          });
        }
        return errors;
      }
      exports2.validateRuleDoesNotAlreadyExist = validateRuleDoesNotAlreadyExist;
      function validateRuleIsOverridden(ruleName, definedRulesNames, className) {
        var errors = [];
        var errMsg;
        if (!utils.contains(definedRulesNames, ruleName)) {
          errMsg = "Invalid rule override, rule: ->" + ruleName + "<- cannot be overridden in the grammar: ->" + className + "<-as it is not defined in any of the super grammars ";
          errors.push({
            message: errMsg,
            type: parser_1.ParserDefinitionErrorType.INVALID_RULE_OVERRIDE,
            ruleName
          });
        }
        return errors;
      }
      exports2.validateRuleIsOverridden = validateRuleIsOverridden;
      function validateNoLeftRecursion(topRule, currRule, errMsgProvider, path) {
        if (path === void 0) {
          path = [];
        }
        var errors = [];
        var nextNonTerminals = getFirstNoneTerminal(currRule.definition);
        if (utils.isEmpty(nextNonTerminals)) {
          return [];
        } else {
          var ruleName = topRule.name;
          var foundLeftRecursion = utils.contains(nextNonTerminals, topRule);
          if (foundLeftRecursion) {
            errors.push({
              message: errMsgProvider.buildLeftRecursionError({
                topLevelRule: topRule,
                leftRecursionPath: path
              }),
              type: parser_1.ParserDefinitionErrorType.LEFT_RECURSION,
              ruleName
            });
          }
          var validNextSteps = utils.difference(nextNonTerminals, path.concat([topRule]));
          var errorsFromNextSteps = utils.map(validNextSteps, function(currRefRule) {
            var newPath = utils.cloneArr(path);
            newPath.push(currRefRule);
            return validateNoLeftRecursion(topRule, currRefRule, errMsgProvider, newPath);
          });
          return errors.concat(utils.flatten(errorsFromNextSteps));
        }
      }
      exports2.validateNoLeftRecursion = validateNoLeftRecursion;
      function getFirstNoneTerminal(definition) {
        var result = [];
        if (utils.isEmpty(definition)) {
          return result;
        }
        var firstProd = utils.first(definition);
        if (firstProd instanceof gast_public_1.NonTerminal) {
          result.push(firstProd.referencedRule);
        } else if (firstProd instanceof gast_public_1.Alternative || firstProd instanceof gast_public_1.Option || firstProd instanceof gast_public_1.RepetitionMandatory || firstProd instanceof gast_public_1.RepetitionMandatoryWithSeparator || firstProd instanceof gast_public_1.RepetitionWithSeparator || firstProd instanceof gast_public_1.Repetition) {
          result = result.concat(getFirstNoneTerminal(firstProd.definition));
        } else if (firstProd instanceof gast_public_1.Alternation) {
          result = utils.flatten(utils.map(firstProd.definition, function(currSubDef) {
            return getFirstNoneTerminal(currSubDef.definition);
          }));
        } else if (firstProd instanceof gast_public_1.Terminal) {
        } else {
          throw Error("non exhaustive match");
        }
        var isFirstOptional = gast_1.isOptionalProd(firstProd);
        var hasMore = definition.length > 1;
        if (isFirstOptional && hasMore) {
          var rest = utils.drop(definition);
          return result.concat(getFirstNoneTerminal(rest));
        } else {
          return result;
        }
      }
      exports2.getFirstNoneTerminal = getFirstNoneTerminal;
      var OrCollector = (
        /** @class */
        (function(_super) {
          __extends(OrCollector2, _super);
          function OrCollector2() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.alternations = [];
            return _this;
          }
          OrCollector2.prototype.visitAlternation = function(node) {
            this.alternations.push(node);
          };
          return OrCollector2;
        })(gast_visitor_public_1.GAstVisitor)
      );
      function validateEmptyOrAlternative(topLevelRule, errMsgProvider) {
        var orCollector = new OrCollector();
        topLevelRule.accept(orCollector);
        var ors = orCollector.alternations;
        var errors = utils.reduce(ors, function(errors2, currOr) {
          var exceptLast = utils.dropRight(currOr.definition);
          var currErrors = utils.map(exceptLast, function(currAlternative, currAltIdx) {
            var possibleFirstInAlt = interpreter_1.nextPossibleTokensAfter([currAlternative], [], null, 1);
            if (utils.isEmpty(possibleFirstInAlt)) {
              return {
                message: errMsgProvider.buildEmptyAlternationError({
                  topLevelRule,
                  alternation: currOr,
                  emptyChoiceIdx: currAltIdx
                }),
                type: parser_1.ParserDefinitionErrorType.NONE_LAST_EMPTY_ALT,
                ruleName: topLevelRule.name,
                occurrence: currOr.idx,
                alternative: currAltIdx + 1
              };
            } else {
              return null;
            }
          });
          return errors2.concat(utils.compact(currErrors));
        }, []);
        return errors;
      }
      exports2.validateEmptyOrAlternative = validateEmptyOrAlternative;
      function validateAmbiguousAlternationAlternatives(topLevelRule, globalMaxLookahead, errMsgProvider) {
        var orCollector = new OrCollector();
        topLevelRule.accept(orCollector);
        var ors = orCollector.alternations;
        ors = utils_1.reject(ors, function(currOr) {
          return currOr.ignoreAmbiguities === true;
        });
        var errors = utils.reduce(ors, function(result, currOr) {
          var currOccurrence = currOr.idx;
          var actualMaxLookahead = currOr.maxLookahead || globalMaxLookahead;
          var alternatives = lookahead_1.getLookaheadPathsForOr(currOccurrence, topLevelRule, actualMaxLookahead, currOr);
          var altsAmbiguityErrors = checkAlternativesAmbiguities(alternatives, currOr, topLevelRule, errMsgProvider);
          var altsPrefixAmbiguityErrors = checkPrefixAlternativesAmbiguities(alternatives, currOr, topLevelRule, errMsgProvider);
          return result.concat(altsAmbiguityErrors, altsPrefixAmbiguityErrors);
        }, []);
        return errors;
      }
      exports2.validateAmbiguousAlternationAlternatives = validateAmbiguousAlternationAlternatives;
      var RepetionCollector = (
        /** @class */
        (function(_super) {
          __extends(RepetionCollector2, _super);
          function RepetionCollector2() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.allProductions = [];
            return _this;
          }
          RepetionCollector2.prototype.visitRepetitionWithSeparator = function(manySep) {
            this.allProductions.push(manySep);
          };
          RepetionCollector2.prototype.visitRepetitionMandatory = function(atLeastOne) {
            this.allProductions.push(atLeastOne);
          };
          RepetionCollector2.prototype.visitRepetitionMandatoryWithSeparator = function(atLeastOneSep) {
            this.allProductions.push(atLeastOneSep);
          };
          RepetionCollector2.prototype.visitRepetition = function(many) {
            this.allProductions.push(many);
          };
          return RepetionCollector2;
        })(gast_visitor_public_1.GAstVisitor)
      );
      exports2.RepetionCollector = RepetionCollector;
      function validateTooManyAlts(topLevelRule, errMsgProvider) {
        var orCollector = new OrCollector();
        topLevelRule.accept(orCollector);
        var ors = orCollector.alternations;
        var errors = utils.reduce(ors, function(errors2, currOr) {
          if (currOr.definition.length > 255) {
            errors2.push({
              message: errMsgProvider.buildTooManyAlternativesError({
                topLevelRule,
                alternation: currOr
              }),
              type: parser_1.ParserDefinitionErrorType.TOO_MANY_ALTS,
              ruleName: topLevelRule.name,
              occurrence: currOr.idx
            });
          }
          return errors2;
        }, []);
        return errors;
      }
      exports2.validateTooManyAlts = validateTooManyAlts;
      function validateSomeNonEmptyLookaheadPath(topLevelRules, maxLookahead, errMsgProvider) {
        var errors = [];
        utils_1.forEach(topLevelRules, function(currTopRule) {
          var collectorVisitor = new RepetionCollector();
          currTopRule.accept(collectorVisitor);
          var allRuleProductions = collectorVisitor.allProductions;
          utils_1.forEach(allRuleProductions, function(currProd) {
            var prodType = lookahead_1.getProdType(currProd);
            var actualMaxLookahead = currProd.maxLookahead || maxLookahead;
            var currOccurrence = currProd.idx;
            var paths = lookahead_1.getLookaheadPathsForOptionalProd(currOccurrence, currTopRule, prodType, actualMaxLookahead);
            var pathsInsideProduction = paths[0];
            if (utils_1.isEmpty(utils_1.flatten(pathsInsideProduction))) {
              var errMsg = errMsgProvider.buildEmptyRepetitionError({
                topLevelRule: currTopRule,
                repetition: currProd
              });
              errors.push({
                message: errMsg,
                type: parser_1.ParserDefinitionErrorType.NO_NON_EMPTY_LOOKAHEAD,
                ruleName: currTopRule.name
              });
            }
          });
        });
        return errors;
      }
      exports2.validateSomeNonEmptyLookaheadPath = validateSomeNonEmptyLookaheadPath;
      function checkAlternativesAmbiguities(alternatives, alternation, rule, errMsgProvider) {
        var foundAmbiguousPaths = [];
        var identicalAmbiguities = utils_1.reduce(alternatives, function(result, currAlt, currAltIdx) {
          if (alternation.definition[currAltIdx].ignoreAmbiguities === true) {
            return result;
          }
          utils_1.forEach(currAlt, function(currPath) {
            var altsCurrPathAppearsIn = [currAltIdx];
            utils_1.forEach(alternatives, function(currOtherAlt, currOtherAltIdx) {
              if (currAltIdx !== currOtherAltIdx && lookahead_1.containsPath(currOtherAlt, currPath) && // ignore (skip) ambiguities with this "other" alternative
              alternation.definition[currOtherAltIdx].ignoreAmbiguities !== true) {
                altsCurrPathAppearsIn.push(currOtherAltIdx);
              }
            });
            if (altsCurrPathAppearsIn.length > 1 && !lookahead_1.containsPath(foundAmbiguousPaths, currPath)) {
              foundAmbiguousPaths.push(currPath);
              result.push({
                alts: altsCurrPathAppearsIn,
                path: currPath
              });
            }
          });
          return result;
        }, []);
        var currErrors = utils.map(identicalAmbiguities, function(currAmbDescriptor) {
          var ambgIndices = utils_1.map(currAmbDescriptor.alts, function(currAltIdx) {
            return currAltIdx + 1;
          });
          var currMessage = errMsgProvider.buildAlternationAmbiguityError({
            topLevelRule: rule,
            alternation,
            ambiguityIndices: ambgIndices,
            prefixPath: currAmbDescriptor.path
          });
          return {
            message: currMessage,
            type: parser_1.ParserDefinitionErrorType.AMBIGUOUS_ALTS,
            ruleName: rule.name,
            occurrence: alternation.idx,
            alternatives: [currAmbDescriptor.alts]
          };
        });
        return currErrors;
      }
      function checkPrefixAlternativesAmbiguities(alternatives, alternation, rule, errMsgProvider) {
        var errors = [];
        var pathsAndIndices = utils_1.reduce(alternatives, function(result, currAlt, idx) {
          var currPathsAndIdx = utils_1.map(currAlt, function(currPath) {
            return { idx, path: currPath };
          });
          return result.concat(currPathsAndIdx);
        }, []);
        utils_1.forEach(pathsAndIndices, function(currPathAndIdx) {
          var alternativeGast = alternation.definition[currPathAndIdx.idx];
          if (alternativeGast.ignoreAmbiguities === true) {
            return;
          }
          var targetIdx = currPathAndIdx.idx;
          var targetPath = currPathAndIdx.path;
          var prefixAmbiguitiesPathsAndIndices = utils_1.findAll(pathsAndIndices, function(searchPathAndIdx) {
            return (
              // ignore (skip) ambiguities with this "other" alternative
              alternation.definition[searchPathAndIdx.idx].ignoreAmbiguities !== true && searchPathAndIdx.idx < targetIdx && // checking for strict prefix because identical lookaheads
              // will be be detected using a different validation.
              lookahead_1.isStrictPrefixOfPath(searchPathAndIdx.path, targetPath)
            );
          });
          var currPathPrefixErrors = utils_1.map(prefixAmbiguitiesPathsAndIndices, function(currAmbPathAndIdx) {
            var ambgIndices = [currAmbPathAndIdx.idx + 1, targetIdx + 1];
            var occurrence = alternation.idx === 0 ? "" : alternation.idx;
            var message = errMsgProvider.buildAlternationPrefixAmbiguityError({
              topLevelRule: rule,
              alternation,
              ambiguityIndices: ambgIndices,
              prefixPath: currAmbPathAndIdx.path
            });
            return {
              message,
              type: parser_1.ParserDefinitionErrorType.AMBIGUOUS_PREFIX_ALTS,
              ruleName: rule.name,
              occurrence,
              alternatives: ambgIndices
            };
          });
          errors = errors.concat(currPathPrefixErrors);
        });
        return errors;
      }
      exports2.checkPrefixAlternativesAmbiguities = checkPrefixAlternativesAmbiguities;
      function checkTerminalAndNoneTerminalsNameSpace(topLevels, tokenTypes, errMsgProvider) {
        var errors = [];
        var tokenNames = utils_1.map(tokenTypes, function(currToken) {
          return currToken.name;
        });
        utils_1.forEach(topLevels, function(currRule) {
          var currRuleName = currRule.name;
          if (utils_1.contains(tokenNames, currRuleName)) {
            var errMsg = errMsgProvider.buildNamespaceConflictError(currRule);
            errors.push({
              message: errMsg,
              type: parser_1.ParserDefinitionErrorType.CONFLICT_TOKENS_RULES_NAMESPACE,
              ruleName: currRuleName
            });
          }
        });
        return errors;
      }
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/gast/gast_resolver_public.js
  var require_gast_resolver_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/gast/gast_resolver_public.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.assignOccurrenceIndices = exports2.validateGrammar = exports2.resolveGrammar = void 0;
      var utils_1 = require_utils();
      var resolver_1 = require_resolver();
      var checks_1 = require_checks();
      var errors_public_1 = require_errors_public();
      var gast_1 = require_gast();
      function resolveGrammar(options) {
        options = utils_1.defaults(options, {
          errMsgProvider: errors_public_1.defaultGrammarResolverErrorProvider
        });
        var topRulesTable = {};
        utils_1.forEach(options.rules, function(rule) {
          topRulesTable[rule.name] = rule;
        });
        return resolver_1.resolveGrammar(topRulesTable, options.errMsgProvider);
      }
      exports2.resolveGrammar = resolveGrammar;
      function validateGrammar(options) {
        options = utils_1.defaults(options, {
          errMsgProvider: errors_public_1.defaultGrammarValidatorErrorProvider
        });
        return checks_1.validateGrammar(options.rules, options.maxLookahead, options.tokenTypes, options.errMsgProvider, options.grammarName);
      }
      exports2.validateGrammar = validateGrammar;
      function assignOccurrenceIndices(options) {
        utils_1.forEach(options.rules, function(currRule) {
          var methodsCollector = new gast_1.DslMethodsCollectorVisitor();
          currRule.accept(methodsCollector);
          utils_1.forEach(methodsCollector.dslMethods, function(methods) {
            utils_1.forEach(methods, function(currMethod, arrIdx) {
              currMethod.idx = arrIdx + 1;
            });
          });
        });
      }
      exports2.assignOccurrenceIndices = assignOccurrenceIndices;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/exceptions_public.js
  var require_exceptions_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/exceptions_public.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.EarlyExitException = exports2.NotAllInputParsedException = exports2.NoViableAltException = exports2.MismatchedTokenException = exports2.isRecognitionException = void 0;
      var utils_1 = require_utils();
      var MISMATCHED_TOKEN_EXCEPTION = "MismatchedTokenException";
      var NO_VIABLE_ALT_EXCEPTION = "NoViableAltException";
      var EARLY_EXIT_EXCEPTION = "EarlyExitException";
      var NOT_ALL_INPUT_PARSED_EXCEPTION = "NotAllInputParsedException";
      var RECOGNITION_EXCEPTION_NAMES = [
        MISMATCHED_TOKEN_EXCEPTION,
        NO_VIABLE_ALT_EXCEPTION,
        EARLY_EXIT_EXCEPTION,
        NOT_ALL_INPUT_PARSED_EXCEPTION
      ];
      Object.freeze(RECOGNITION_EXCEPTION_NAMES);
      function isRecognitionException(error) {
        return utils_1.contains(RECOGNITION_EXCEPTION_NAMES, error.name);
      }
      exports2.isRecognitionException = isRecognitionException;
      var RecognitionException = (
        /** @class */
        (function(_super) {
          __extends(RecognitionException2, _super);
          function RecognitionException2(message, token) {
            var _newTarget = this.constructor;
            var _this = _super.call(this, message) || this;
            _this.token = token;
            _this.resyncedTokens = [];
            Object.setPrototypeOf(_this, _newTarget.prototype);
            if (Error.captureStackTrace) {
              Error.captureStackTrace(_this, _this.constructor);
            }
            return _this;
          }
          return RecognitionException2;
        })(Error)
      );
      var MismatchedTokenException = (
        /** @class */
        (function(_super) {
          __extends(MismatchedTokenException2, _super);
          function MismatchedTokenException2(message, token, previousToken) {
            var _this = _super.call(this, message, token) || this;
            _this.previousToken = previousToken;
            _this.name = MISMATCHED_TOKEN_EXCEPTION;
            return _this;
          }
          return MismatchedTokenException2;
        })(RecognitionException)
      );
      exports2.MismatchedTokenException = MismatchedTokenException;
      var NoViableAltException = (
        /** @class */
        (function(_super) {
          __extends(NoViableAltException2, _super);
          function NoViableAltException2(message, token, previousToken) {
            var _this = _super.call(this, message, token) || this;
            _this.previousToken = previousToken;
            _this.name = NO_VIABLE_ALT_EXCEPTION;
            return _this;
          }
          return NoViableAltException2;
        })(RecognitionException)
      );
      exports2.NoViableAltException = NoViableAltException;
      var NotAllInputParsedException = (
        /** @class */
        (function(_super) {
          __extends(NotAllInputParsedException2, _super);
          function NotAllInputParsedException2(message, token) {
            var _this = _super.call(this, message, token) || this;
            _this.name = NOT_ALL_INPUT_PARSED_EXCEPTION;
            return _this;
          }
          return NotAllInputParsedException2;
        })(RecognitionException)
      );
      exports2.NotAllInputParsedException = NotAllInputParsedException;
      var EarlyExitException = (
        /** @class */
        (function(_super) {
          __extends(EarlyExitException2, _super);
          function EarlyExitException2(message, token, previousToken) {
            var _this = _super.call(this, message, token) || this;
            _this.previousToken = previousToken;
            _this.name = EARLY_EXIT_EXCEPTION;
            return _this;
          }
          return EarlyExitException2;
        })(RecognitionException)
      );
      exports2.EarlyExitException = EarlyExitException;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/recoverable.js
  var require_recoverable = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/recoverable.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.attemptInRepetitionRecovery = exports2.Recoverable = exports2.InRuleRecoveryException = exports2.IN_RULE_RECOVERY_EXCEPTION = exports2.EOF_FOLLOW_KEY = void 0;
      var tokens_public_1 = require_tokens_public();
      var utils_1 = require_utils();
      var exceptions_public_1 = require_exceptions_public();
      var constants_1 = require_constants();
      var parser_1 = require_parser();
      exports2.EOF_FOLLOW_KEY = {};
      exports2.IN_RULE_RECOVERY_EXCEPTION = "InRuleRecoveryException";
      function InRuleRecoveryException(message) {
        this.name = exports2.IN_RULE_RECOVERY_EXCEPTION;
        this.message = message;
      }
      exports2.InRuleRecoveryException = InRuleRecoveryException;
      InRuleRecoveryException.prototype = Error.prototype;
      var Recoverable = (
        /** @class */
        (function() {
          function Recoverable2() {
          }
          Recoverable2.prototype.initRecoverable = function(config) {
            this.firstAfterRepMap = {};
            this.resyncFollows = {};
            this.recoveryEnabled = utils_1.has(config, "recoveryEnabled") ? config.recoveryEnabled : parser_1.DEFAULT_PARSER_CONFIG.recoveryEnabled;
            if (this.recoveryEnabled) {
              this.attemptInRepetitionRecovery = attemptInRepetitionRecovery;
            }
          };
          Recoverable2.prototype.getTokenToInsert = function(tokType) {
            var tokToInsert = tokens_public_1.createTokenInstance(tokType, "", NaN, NaN, NaN, NaN, NaN, NaN);
            tokToInsert.isInsertedInRecovery = true;
            return tokToInsert;
          };
          Recoverable2.prototype.canTokenTypeBeInsertedInRecovery = function(tokType) {
            return true;
          };
          Recoverable2.prototype.tryInRepetitionRecovery = function(grammarRule, grammarRuleArgs, lookAheadFunc, expectedTokType) {
            var _this = this;
            var reSyncTokType = this.findReSyncTokenType();
            var savedLexerState = this.exportLexerState();
            var resyncedTokens = [];
            var passedResyncPoint = false;
            var nextTokenWithoutResync = this.LA(1);
            var currToken = this.LA(1);
            var generateErrorMessage = function() {
              var previousToken = _this.LA(0);
              var msg = _this.errorMessageProvider.buildMismatchTokenMessage({
                expected: expectedTokType,
                actual: nextTokenWithoutResync,
                previous: previousToken,
                ruleName: _this.getCurrRuleFullName()
              });
              var error = new exceptions_public_1.MismatchedTokenException(msg, nextTokenWithoutResync, _this.LA(0));
              error.resyncedTokens = utils_1.dropRight(resyncedTokens);
              _this.SAVE_ERROR(error);
            };
            while (!passedResyncPoint) {
              if (this.tokenMatcher(currToken, expectedTokType)) {
                generateErrorMessage();
                return;
              } else if (lookAheadFunc.call(this)) {
                generateErrorMessage();
                grammarRule.apply(this, grammarRuleArgs);
                return;
              } else if (this.tokenMatcher(currToken, reSyncTokType)) {
                passedResyncPoint = true;
              } else {
                currToken = this.SKIP_TOKEN();
                this.addToResyncTokens(currToken, resyncedTokens);
              }
            }
            this.importLexerState(savedLexerState);
          };
          Recoverable2.prototype.shouldInRepetitionRecoveryBeTried = function(expectTokAfterLastMatch, nextTokIdx, notStuck) {
            if (notStuck === false) {
              return false;
            }
            if (expectTokAfterLastMatch === void 0 || nextTokIdx === void 0) {
              return false;
            }
            if (this.tokenMatcher(this.LA(1), expectTokAfterLastMatch)) {
              return false;
            }
            if (this.isBackTracking()) {
              return false;
            }
            if (this.canPerformInRuleRecovery(expectTokAfterLastMatch, this.getFollowsForInRuleRecovery(expectTokAfterLastMatch, nextTokIdx))) {
              return false;
            }
            return true;
          };
          Recoverable2.prototype.getFollowsForInRuleRecovery = function(tokType, tokIdxInRule) {
            var grammarPath = this.getCurrentGrammarPath(tokType, tokIdxInRule);
            var follows = this.getNextPossibleTokenTypes(grammarPath);
            return follows;
          };
          Recoverable2.prototype.tryInRuleRecovery = function(expectedTokType, follows) {
            if (this.canRecoverWithSingleTokenInsertion(expectedTokType, follows)) {
              var tokToInsert = this.getTokenToInsert(expectedTokType);
              return tokToInsert;
            }
            if (this.canRecoverWithSingleTokenDeletion(expectedTokType)) {
              var nextTok = this.SKIP_TOKEN();
              this.consumeToken();
              return nextTok;
            }
            throw new InRuleRecoveryException("sad sad panda");
          };
          Recoverable2.prototype.canPerformInRuleRecovery = function(expectedToken, follows) {
            return this.canRecoverWithSingleTokenInsertion(expectedToken, follows) || this.canRecoverWithSingleTokenDeletion(expectedToken);
          };
          Recoverable2.prototype.canRecoverWithSingleTokenInsertion = function(expectedTokType, follows) {
            var _this = this;
            if (!this.canTokenTypeBeInsertedInRecovery(expectedTokType)) {
              return false;
            }
            if (utils_1.isEmpty(follows)) {
              return false;
            }
            var mismatchedTok = this.LA(1);
            var isMisMatchedTokInFollows = utils_1.find(follows, function(possibleFollowsTokType) {
              return _this.tokenMatcher(mismatchedTok, possibleFollowsTokType);
            }) !== void 0;
            return isMisMatchedTokInFollows;
          };
          Recoverable2.prototype.canRecoverWithSingleTokenDeletion = function(expectedTokType) {
            var isNextTokenWhatIsExpected = this.tokenMatcher(this.LA(2), expectedTokType);
            return isNextTokenWhatIsExpected;
          };
          Recoverable2.prototype.isInCurrentRuleReSyncSet = function(tokenTypeIdx) {
            var followKey = this.getCurrFollowKey();
            var currentRuleReSyncSet = this.getFollowSetFromFollowKey(followKey);
            return utils_1.contains(currentRuleReSyncSet, tokenTypeIdx);
          };
          Recoverable2.prototype.findReSyncTokenType = function() {
            var allPossibleReSyncTokTypes = this.flattenFollowSet();
            var nextToken = this.LA(1);
            var k = 2;
            while (true) {
              var nextTokenType = nextToken.tokenType;
              if (utils_1.contains(allPossibleReSyncTokTypes, nextTokenType)) {
                return nextTokenType;
              }
              nextToken = this.LA(k);
              k++;
            }
          };
          Recoverable2.prototype.getCurrFollowKey = function() {
            if (this.RULE_STACK.length === 1) {
              return exports2.EOF_FOLLOW_KEY;
            }
            var currRuleShortName = this.getLastExplicitRuleShortName();
            var currRuleIdx = this.getLastExplicitRuleOccurrenceIndex();
            var prevRuleShortName = this.getPreviousExplicitRuleShortName();
            return {
              ruleName: this.shortRuleNameToFullName(currRuleShortName),
              idxInCallingRule: currRuleIdx,
              inRule: this.shortRuleNameToFullName(prevRuleShortName)
            };
          };
          Recoverable2.prototype.buildFullFollowKeyStack = function() {
            var _this = this;
            var explicitRuleStack = this.RULE_STACK;
            var explicitOccurrenceStack = this.RULE_OCCURRENCE_STACK;
            return utils_1.map(explicitRuleStack, function(ruleName, idx) {
              if (idx === 0) {
                return exports2.EOF_FOLLOW_KEY;
              }
              return {
                ruleName: _this.shortRuleNameToFullName(ruleName),
                idxInCallingRule: explicitOccurrenceStack[idx],
                inRule: _this.shortRuleNameToFullName(explicitRuleStack[idx - 1])
              };
            });
          };
          Recoverable2.prototype.flattenFollowSet = function() {
            var _this = this;
            var followStack = utils_1.map(this.buildFullFollowKeyStack(), function(currKey) {
              return _this.getFollowSetFromFollowKey(currKey);
            });
            return utils_1.flatten(followStack);
          };
          Recoverable2.prototype.getFollowSetFromFollowKey = function(followKey) {
            if (followKey === exports2.EOF_FOLLOW_KEY) {
              return [tokens_public_1.EOF];
            }
            var followName = followKey.ruleName + followKey.idxInCallingRule + constants_1.IN + followKey.inRule;
            return this.resyncFollows[followName];
          };
          Recoverable2.prototype.addToResyncTokens = function(token, resyncTokens) {
            if (!this.tokenMatcher(token, tokens_public_1.EOF)) {
              resyncTokens.push(token);
            }
            return resyncTokens;
          };
          Recoverable2.prototype.reSyncTo = function(tokType) {
            var resyncedTokens = [];
            var nextTok = this.LA(1);
            while (this.tokenMatcher(nextTok, tokType) === false) {
              nextTok = this.SKIP_TOKEN();
              this.addToResyncTokens(nextTok, resyncedTokens);
            }
            return utils_1.dropRight(resyncedTokens);
          };
          Recoverable2.prototype.attemptInRepetitionRecovery = function(prodFunc, args, lookaheadFunc, dslMethodIdx, prodOccurrence, nextToksWalker, notStuck) {
          };
          Recoverable2.prototype.getCurrentGrammarPath = function(tokType, tokIdxInRule) {
            var pathRuleStack = this.getHumanReadableRuleStack();
            var pathOccurrenceStack = utils_1.cloneArr(this.RULE_OCCURRENCE_STACK);
            var grammarPath = {
              ruleStack: pathRuleStack,
              occurrenceStack: pathOccurrenceStack,
              lastTok: tokType,
              lastTokOccurrence: tokIdxInRule
            };
            return grammarPath;
          };
          Recoverable2.prototype.getHumanReadableRuleStack = function() {
            var _this = this;
            return utils_1.map(this.RULE_STACK, function(currShortName) {
              return _this.shortRuleNameToFullName(currShortName);
            });
          };
          return Recoverable2;
        })()
      );
      exports2.Recoverable = Recoverable;
      function attemptInRepetitionRecovery(prodFunc, args, lookaheadFunc, dslMethodIdx, prodOccurrence, nextToksWalker, notStuck) {
        var key = this.getKeyForAutomaticLookahead(dslMethodIdx, prodOccurrence);
        var firstAfterRepInfo = this.firstAfterRepMap[key];
        if (firstAfterRepInfo === void 0) {
          var currRuleName = this.getCurrRuleFullName();
          var ruleGrammar = this.getGAstProductions()[currRuleName];
          var walker = new nextToksWalker(ruleGrammar, prodOccurrence);
          firstAfterRepInfo = walker.startWalking();
          this.firstAfterRepMap[key] = firstAfterRepInfo;
        }
        var expectTokAfterLastMatch = firstAfterRepInfo.token;
        var nextTokIdx = firstAfterRepInfo.occurrence;
        var isEndOfRule = firstAfterRepInfo.isEndOfRule;
        if (this.RULE_STACK.length === 1 && isEndOfRule && expectTokAfterLastMatch === void 0) {
          expectTokAfterLastMatch = tokens_public_1.EOF;
          nextTokIdx = 1;
        }
        if (this.shouldInRepetitionRecoveryBeTried(expectTokAfterLastMatch, nextTokIdx, notStuck)) {
          this.tryInRepetitionRecovery(prodFunc, args, lookaheadFunc, expectTokAfterLastMatch);
        }
      }
      exports2.attemptInRepetitionRecovery = attemptInRepetitionRecovery;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/grammar/keys.js
  var require_keys = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/grammar/keys.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.getKeyForAutomaticLookahead = exports2.AT_LEAST_ONE_SEP_IDX = exports2.MANY_SEP_IDX = exports2.AT_LEAST_ONE_IDX = exports2.MANY_IDX = exports2.OPTION_IDX = exports2.OR_IDX = exports2.BITS_FOR_ALT_IDX = exports2.BITS_FOR_RULE_IDX = exports2.BITS_FOR_OCCURRENCE_IDX = exports2.BITS_FOR_METHOD_TYPE = void 0;
      exports2.BITS_FOR_METHOD_TYPE = 4;
      exports2.BITS_FOR_OCCURRENCE_IDX = 8;
      exports2.BITS_FOR_RULE_IDX = 12;
      exports2.BITS_FOR_ALT_IDX = 8;
      exports2.OR_IDX = 1 << exports2.BITS_FOR_OCCURRENCE_IDX;
      exports2.OPTION_IDX = 2 << exports2.BITS_FOR_OCCURRENCE_IDX;
      exports2.MANY_IDX = 3 << exports2.BITS_FOR_OCCURRENCE_IDX;
      exports2.AT_LEAST_ONE_IDX = 4 << exports2.BITS_FOR_OCCURRENCE_IDX;
      exports2.MANY_SEP_IDX = 5 << exports2.BITS_FOR_OCCURRENCE_IDX;
      exports2.AT_LEAST_ONE_SEP_IDX = 6 << exports2.BITS_FOR_OCCURRENCE_IDX;
      function getKeyForAutomaticLookahead(ruleIdx, dslMethodIdx, occurrence) {
        return occurrence | dslMethodIdx | ruleIdx;
      }
      exports2.getKeyForAutomaticLookahead = getKeyForAutomaticLookahead;
      var BITS_START_FOR_ALT_IDX = 32 - exports2.BITS_FOR_ALT_IDX;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/looksahead.js
  var require_looksahead = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/looksahead.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.LooksAhead = void 0;
      var lookahead_1 = require_lookahead();
      var utils_1 = require_utils();
      var parser_1 = require_parser();
      var keys_1 = require_keys();
      var gast_1 = require_gast();
      var LooksAhead = (
        /** @class */
        (function() {
          function LooksAhead2() {
          }
          LooksAhead2.prototype.initLooksAhead = function(config) {
            this.dynamicTokensEnabled = utils_1.has(config, "dynamicTokensEnabled") ? config.dynamicTokensEnabled : parser_1.DEFAULT_PARSER_CONFIG.dynamicTokensEnabled;
            this.maxLookahead = utils_1.has(config, "maxLookahead") ? config.maxLookahead : parser_1.DEFAULT_PARSER_CONFIG.maxLookahead;
            this.lookAheadFuncsCache = utils_1.isES2015MapSupported() ? /* @__PURE__ */ new Map() : [];
            if (utils_1.isES2015MapSupported()) {
              this.getLaFuncFromCache = this.getLaFuncFromMap;
              this.setLaFuncCache = this.setLaFuncCacheUsingMap;
            } else {
              this.getLaFuncFromCache = this.getLaFuncFromObj;
              this.setLaFuncCache = this.setLaFuncUsingObj;
            }
          };
          LooksAhead2.prototype.preComputeLookaheadFunctions = function(rules) {
            var _this = this;
            utils_1.forEach(rules, function(currRule) {
              _this.TRACE_INIT(currRule.name + " Rule Lookahead", function() {
                var _a = gast_1.collectMethods(currRule), alternation = _a.alternation, repetition = _a.repetition, option = _a.option, repetitionMandatory = _a.repetitionMandatory, repetitionMandatoryWithSeparator = _a.repetitionMandatoryWithSeparator, repetitionWithSeparator = _a.repetitionWithSeparator;
                utils_1.forEach(alternation, function(currProd) {
                  var prodIdx = currProd.idx === 0 ? "" : currProd.idx;
                  _this.TRACE_INIT("" + gast_1.getProductionDslName(currProd) + prodIdx, function() {
                    var laFunc = lookahead_1.buildLookaheadFuncForOr(currProd.idx, currRule, currProd.maxLookahead || _this.maxLookahead, currProd.hasPredicates, _this.dynamicTokensEnabled, _this.lookAheadBuilderForAlternatives);
                    var key = keys_1.getKeyForAutomaticLookahead(_this.fullRuleNameToShort[currRule.name], keys_1.OR_IDX, currProd.idx);
                    _this.setLaFuncCache(key, laFunc);
                  });
                });
                utils_1.forEach(repetition, function(currProd) {
                  _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.MANY_IDX, lookahead_1.PROD_TYPE.REPETITION, currProd.maxLookahead, gast_1.getProductionDslName(currProd));
                });
                utils_1.forEach(option, function(currProd) {
                  _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.OPTION_IDX, lookahead_1.PROD_TYPE.OPTION, currProd.maxLookahead, gast_1.getProductionDslName(currProd));
                });
                utils_1.forEach(repetitionMandatory, function(currProd) {
                  _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.AT_LEAST_ONE_IDX, lookahead_1.PROD_TYPE.REPETITION_MANDATORY, currProd.maxLookahead, gast_1.getProductionDslName(currProd));
                });
                utils_1.forEach(repetitionMandatoryWithSeparator, function(currProd) {
                  _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.AT_LEAST_ONE_SEP_IDX, lookahead_1.PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR, currProd.maxLookahead, gast_1.getProductionDslName(currProd));
                });
                utils_1.forEach(repetitionWithSeparator, function(currProd) {
                  _this.computeLookaheadFunc(currRule, currProd.idx, keys_1.MANY_SEP_IDX, lookahead_1.PROD_TYPE.REPETITION_WITH_SEPARATOR, currProd.maxLookahead, gast_1.getProductionDslName(currProd));
                });
              });
            });
          };
          LooksAhead2.prototype.computeLookaheadFunc = function(rule, prodOccurrence, prodKey, prodType, prodMaxLookahead, dslMethodName) {
            var _this = this;
            this.TRACE_INIT("" + dslMethodName + (prodOccurrence === 0 ? "" : prodOccurrence), function() {
              var laFunc = lookahead_1.buildLookaheadFuncForOptionalProd(prodOccurrence, rule, prodMaxLookahead || _this.maxLookahead, _this.dynamicTokensEnabled, prodType, _this.lookAheadBuilderForOptional);
              var key = keys_1.getKeyForAutomaticLookahead(_this.fullRuleNameToShort[rule.name], prodKey, prodOccurrence);
              _this.setLaFuncCache(key, laFunc);
            });
          };
          LooksAhead2.prototype.lookAheadBuilderForOptional = function(alt, tokenMatcher, dynamicTokensEnabled) {
            return lookahead_1.buildSingleAlternativeLookaheadFunction(alt, tokenMatcher, dynamicTokensEnabled);
          };
          LooksAhead2.prototype.lookAheadBuilderForAlternatives = function(alts, hasPredicates, tokenMatcher, dynamicTokensEnabled) {
            return lookahead_1.buildAlternativesLookAheadFunc(alts, hasPredicates, tokenMatcher, dynamicTokensEnabled);
          };
          LooksAhead2.prototype.getKeyForAutomaticLookahead = function(dslMethodIdx, occurrence) {
            var currRuleShortName = this.getLastExplicitRuleShortName();
            return keys_1.getKeyForAutomaticLookahead(currRuleShortName, dslMethodIdx, occurrence);
          };
          LooksAhead2.prototype.getLaFuncFromCache = function(key) {
            return void 0;
          };
          LooksAhead2.prototype.getLaFuncFromMap = function(key) {
            return this.lookAheadFuncsCache.get(key);
          };
          LooksAhead2.prototype.getLaFuncFromObj = function(key) {
            return this.lookAheadFuncsCache[key];
          };
          LooksAhead2.prototype.setLaFuncCache = function(key, value) {
          };
          LooksAhead2.prototype.setLaFuncCacheUsingMap = function(key, value) {
            this.lookAheadFuncsCache.set(key, value);
          };
          LooksAhead2.prototype.setLaFuncUsingObj = function(key, value) {
            this.lookAheadFuncsCache[key] = value;
          };
          return LooksAhead2;
        })()
      );
      exports2.LooksAhead = LooksAhead;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/cst/cst.js
  var require_cst = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/cst/cst.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.addNoneTerminalToCst = exports2.addTerminalToCst = exports2.setNodeLocationFull = exports2.setNodeLocationOnlyOffset = void 0;
      function setNodeLocationOnlyOffset(currNodeLocation, newLocationInfo) {
        if (isNaN(currNodeLocation.startOffset) === true) {
          currNodeLocation.startOffset = newLocationInfo.startOffset;
          currNodeLocation.endOffset = newLocationInfo.endOffset;
        } else if (currNodeLocation.endOffset < newLocationInfo.endOffset === true) {
          currNodeLocation.endOffset = newLocationInfo.endOffset;
        }
      }
      exports2.setNodeLocationOnlyOffset = setNodeLocationOnlyOffset;
      function setNodeLocationFull(currNodeLocation, newLocationInfo) {
        if (isNaN(currNodeLocation.startOffset) === true) {
          currNodeLocation.startOffset = newLocationInfo.startOffset;
          currNodeLocation.startColumn = newLocationInfo.startColumn;
          currNodeLocation.startLine = newLocationInfo.startLine;
          currNodeLocation.endOffset = newLocationInfo.endOffset;
          currNodeLocation.endColumn = newLocationInfo.endColumn;
          currNodeLocation.endLine = newLocationInfo.endLine;
        } else if (currNodeLocation.endOffset < newLocationInfo.endOffset === true) {
          currNodeLocation.endOffset = newLocationInfo.endOffset;
          currNodeLocation.endColumn = newLocationInfo.endColumn;
          currNodeLocation.endLine = newLocationInfo.endLine;
        }
      }
      exports2.setNodeLocationFull = setNodeLocationFull;
      function addTerminalToCst(node, token, tokenTypeName) {
        if (node.children[tokenTypeName] === void 0) {
          node.children[tokenTypeName] = [token];
        } else {
          node.children[tokenTypeName].push(token);
        }
      }
      exports2.addTerminalToCst = addTerminalToCst;
      function addNoneTerminalToCst(node, ruleName, ruleResult) {
        if (node.children[ruleName] === void 0) {
          node.children[ruleName] = [ruleResult];
        } else {
          node.children[ruleName].push(ruleResult);
        }
      }
      exports2.addNoneTerminalToCst = addNoneTerminalToCst;
    }
  });

  // ../../node_modules/chevrotain/lib/src/lang/lang_extensions.js
  var require_lang_extensions = __commonJS({
    "../../node_modules/chevrotain/lib/src/lang/lang_extensions.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.defineNameProp = exports2.functionName = exports2.classNameFromInstance = void 0;
      var utils_1 = require_utils();
      function classNameFromInstance(instance) {
        return functionName(instance.constructor);
      }
      exports2.classNameFromInstance = classNameFromInstance;
      var NAME = "name";
      function functionName(func) {
        var existingNameProp = func.name;
        if (existingNameProp) {
          return existingNameProp;
        } else {
          return "anonymous";
        }
      }
      exports2.functionName = functionName;
      function defineNameProp(obj, nameValue) {
        var namePropDescriptor = Object.getOwnPropertyDescriptor(obj, NAME);
        if (utils_1.isUndefined(namePropDescriptor) || namePropDescriptor.configurable) {
          Object.defineProperty(obj, NAME, {
            enumerable: false,
            configurable: true,
            writable: false,
            value: nameValue
          });
          return true;
        }
        return false;
      }
      exports2.defineNameProp = defineNameProp;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/cst/cst_visitor.js
  var require_cst_visitor = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/cst/cst_visitor.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.validateRedundantMethods = exports2.validateMissingCstMethods = exports2.validateVisitor = exports2.CstVisitorDefinitionError = exports2.createBaseVisitorConstructorWithDefaults = exports2.createBaseSemanticVisitorConstructor = exports2.defaultVisit = void 0;
      var utils_1 = require_utils();
      var lang_extensions_1 = require_lang_extensions();
      function defaultVisit(ctx, param) {
        var childrenNames = utils_1.keys(ctx);
        var childrenNamesLength = childrenNames.length;
        for (var i = 0; i < childrenNamesLength; i++) {
          var currChildName = childrenNames[i];
          var currChildArray = ctx[currChildName];
          var currChildArrayLength = currChildArray.length;
          for (var j = 0; j < currChildArrayLength; j++) {
            var currChild = currChildArray[j];
            if (currChild.tokenTypeIdx === void 0) {
              this[currChild.name](currChild.children, param);
            }
          }
        }
        return void 0;
      }
      exports2.defaultVisit = defaultVisit;
      function createBaseSemanticVisitorConstructor(grammarName, ruleNames) {
        var derivedConstructor = function() {
        };
        lang_extensions_1.defineNameProp(derivedConstructor, grammarName + "BaseSemantics");
        var semanticProto = {
          visit: function(cstNode, param) {
            if (utils_1.isArray(cstNode)) {
              cstNode = cstNode[0];
            }
            if (utils_1.isUndefined(cstNode)) {
              return void 0;
            }
            return this[cstNode.name](cstNode.children, param);
          },
          validateVisitor: function() {
            var semanticDefinitionErrors = validateVisitor(this, ruleNames);
            if (!utils_1.isEmpty(semanticDefinitionErrors)) {
              var errorMessages = utils_1.map(semanticDefinitionErrors, function(currDefError) {
                return currDefError.msg;
              });
              throw Error("Errors Detected in CST Visitor <" + lang_extensions_1.functionName(this.constructor) + ">:\n	" + ("" + errorMessages.join("\n\n").replace(/\n/g, "\n	")));
            }
          }
        };
        derivedConstructor.prototype = semanticProto;
        derivedConstructor.prototype.constructor = derivedConstructor;
        derivedConstructor._RULE_NAMES = ruleNames;
        return derivedConstructor;
      }
      exports2.createBaseSemanticVisitorConstructor = createBaseSemanticVisitorConstructor;
      function createBaseVisitorConstructorWithDefaults(grammarName, ruleNames, baseConstructor) {
        var derivedConstructor = function() {
        };
        lang_extensions_1.defineNameProp(derivedConstructor, grammarName + "BaseSemanticsWithDefaults");
        var withDefaultsProto = Object.create(baseConstructor.prototype);
        utils_1.forEach(ruleNames, function(ruleName) {
          withDefaultsProto[ruleName] = defaultVisit;
        });
        derivedConstructor.prototype = withDefaultsProto;
        derivedConstructor.prototype.constructor = derivedConstructor;
        return derivedConstructor;
      }
      exports2.createBaseVisitorConstructorWithDefaults = createBaseVisitorConstructorWithDefaults;
      var CstVisitorDefinitionError;
      (function(CstVisitorDefinitionError2) {
        CstVisitorDefinitionError2[CstVisitorDefinitionError2["REDUNDANT_METHOD"] = 0] = "REDUNDANT_METHOD";
        CstVisitorDefinitionError2[CstVisitorDefinitionError2["MISSING_METHOD"] = 1] = "MISSING_METHOD";
      })(CstVisitorDefinitionError = exports2.CstVisitorDefinitionError || (exports2.CstVisitorDefinitionError = {}));
      function validateVisitor(visitorInstance, ruleNames) {
        var missingErrors = validateMissingCstMethods(visitorInstance, ruleNames);
        var redundantErrors = validateRedundantMethods(visitorInstance, ruleNames);
        return missingErrors.concat(redundantErrors);
      }
      exports2.validateVisitor = validateVisitor;
      function validateMissingCstMethods(visitorInstance, ruleNames) {
        var errors = utils_1.map(ruleNames, function(currRuleName) {
          if (!utils_1.isFunction(visitorInstance[currRuleName])) {
            return {
              msg: "Missing visitor method: <" + currRuleName + "> on " + lang_extensions_1.functionName(visitorInstance.constructor) + " CST Visitor.",
              type: CstVisitorDefinitionError.MISSING_METHOD,
              methodName: currRuleName
            };
          }
        });
        return utils_1.compact(errors);
      }
      exports2.validateMissingCstMethods = validateMissingCstMethods;
      var VALID_PROP_NAMES = ["constructor", "visit", "validateVisitor"];
      function validateRedundantMethods(visitorInstance, ruleNames) {
        var errors = [];
        for (var prop in visitorInstance) {
          if (utils_1.isFunction(visitorInstance[prop]) && !utils_1.contains(VALID_PROP_NAMES, prop) && !utils_1.contains(ruleNames, prop)) {
            errors.push({
              msg: "Redundant visitor method: <" + prop + "> on " + lang_extensions_1.functionName(visitorInstance.constructor) + " CST Visitor\nThere is no Grammar Rule corresponding to this method's name.\n",
              type: CstVisitorDefinitionError.REDUNDANT_METHOD,
              methodName: prop
            });
          }
        }
        return errors;
      }
      exports2.validateRedundantMethods = validateRedundantMethods;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/tree_builder.js
  var require_tree_builder = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/tree_builder.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.TreeBuilder = void 0;
      var cst_1 = require_cst();
      var utils_1 = require_utils();
      var cst_visitor_1 = require_cst_visitor();
      var parser_1 = require_parser();
      var TreeBuilder = (
        /** @class */
        (function() {
          function TreeBuilder2() {
          }
          TreeBuilder2.prototype.initTreeBuilder = function(config) {
            this.CST_STACK = [];
            this.outputCst = config.outputCst;
            this.nodeLocationTracking = utils_1.has(config, "nodeLocationTracking") ? config.nodeLocationTracking : parser_1.DEFAULT_PARSER_CONFIG.nodeLocationTracking;
            if (!this.outputCst) {
              this.cstInvocationStateUpdate = utils_1.NOOP;
              this.cstFinallyStateUpdate = utils_1.NOOP;
              this.cstPostTerminal = utils_1.NOOP;
              this.cstPostNonTerminal = utils_1.NOOP;
              this.cstPostRule = utils_1.NOOP;
            } else {
              if (/full/i.test(this.nodeLocationTracking)) {
                if (this.recoveryEnabled) {
                  this.setNodeLocationFromToken = cst_1.setNodeLocationFull;
                  this.setNodeLocationFromNode = cst_1.setNodeLocationFull;
                  this.cstPostRule = utils_1.NOOP;
                  this.setInitialNodeLocation = this.setInitialNodeLocationFullRecovery;
                } else {
                  this.setNodeLocationFromToken = utils_1.NOOP;
                  this.setNodeLocationFromNode = utils_1.NOOP;
                  this.cstPostRule = this.cstPostRuleFull;
                  this.setInitialNodeLocation = this.setInitialNodeLocationFullRegular;
                }
              } else if (/onlyOffset/i.test(this.nodeLocationTracking)) {
                if (this.recoveryEnabled) {
                  this.setNodeLocationFromToken = cst_1.setNodeLocationOnlyOffset;
                  this.setNodeLocationFromNode = cst_1.setNodeLocationOnlyOffset;
                  this.cstPostRule = utils_1.NOOP;
                  this.setInitialNodeLocation = this.setInitialNodeLocationOnlyOffsetRecovery;
                } else {
                  this.setNodeLocationFromToken = utils_1.NOOP;
                  this.setNodeLocationFromNode = utils_1.NOOP;
                  this.cstPostRule = this.cstPostRuleOnlyOffset;
                  this.setInitialNodeLocation = this.setInitialNodeLocationOnlyOffsetRegular;
                }
              } else if (/none/i.test(this.nodeLocationTracking)) {
                this.setNodeLocationFromToken = utils_1.NOOP;
                this.setNodeLocationFromNode = utils_1.NOOP;
                this.cstPostRule = utils_1.NOOP;
                this.setInitialNodeLocation = utils_1.NOOP;
              } else {
                throw Error('Invalid <nodeLocationTracking> config option: "' + config.nodeLocationTracking + '"');
              }
            }
          };
          TreeBuilder2.prototype.setInitialNodeLocationOnlyOffsetRecovery = function(cstNode) {
            cstNode.location = {
              startOffset: NaN,
              endOffset: NaN
            };
          };
          TreeBuilder2.prototype.setInitialNodeLocationOnlyOffsetRegular = function(cstNode) {
            cstNode.location = {
              // without error recovery the starting Location of a new CstNode is guaranteed
              // To be the next Token's startOffset (for valid inputs).
              // For invalid inputs there won't be any CSTOutput so this potential
              // inaccuracy does not matter
              startOffset: this.LA(1).startOffset,
              endOffset: NaN
            };
          };
          TreeBuilder2.prototype.setInitialNodeLocationFullRecovery = function(cstNode) {
            cstNode.location = {
              startOffset: NaN,
              startLine: NaN,
              startColumn: NaN,
              endOffset: NaN,
              endLine: NaN,
              endColumn: NaN
            };
          };
          TreeBuilder2.prototype.setInitialNodeLocationFullRegular = function(cstNode) {
            var nextToken = this.LA(1);
            cstNode.location = {
              startOffset: nextToken.startOffset,
              startLine: nextToken.startLine,
              startColumn: nextToken.startColumn,
              endOffset: NaN,
              endLine: NaN,
              endColumn: NaN
            };
          };
          TreeBuilder2.prototype.cstInvocationStateUpdate = function(fullRuleName, shortName) {
            var cstNode = {
              name: fullRuleName,
              children: {}
            };
            this.setInitialNodeLocation(cstNode);
            this.CST_STACK.push(cstNode);
          };
          TreeBuilder2.prototype.cstFinallyStateUpdate = function() {
            this.CST_STACK.pop();
          };
          TreeBuilder2.prototype.cstPostRuleFull = function(ruleCstNode) {
            var prevToken = this.LA(0);
            var loc = ruleCstNode.location;
            if (loc.startOffset <= prevToken.startOffset === true) {
              loc.endOffset = prevToken.endOffset;
              loc.endLine = prevToken.endLine;
              loc.endColumn = prevToken.endColumn;
            } else {
              loc.startOffset = NaN;
              loc.startLine = NaN;
              loc.startColumn = NaN;
            }
          };
          TreeBuilder2.prototype.cstPostRuleOnlyOffset = function(ruleCstNode) {
            var prevToken = this.LA(0);
            var loc = ruleCstNode.location;
            if (loc.startOffset <= prevToken.startOffset === true) {
              loc.endOffset = prevToken.endOffset;
            } else {
              loc.startOffset = NaN;
            }
          };
          TreeBuilder2.prototype.cstPostTerminal = function(key, consumedToken) {
            var rootCst = this.CST_STACK[this.CST_STACK.length - 1];
            cst_1.addTerminalToCst(rootCst, consumedToken, key);
            this.setNodeLocationFromToken(rootCst.location, consumedToken);
          };
          TreeBuilder2.prototype.cstPostNonTerminal = function(ruleCstResult, ruleName) {
            var preCstNode = this.CST_STACK[this.CST_STACK.length - 1];
            cst_1.addNoneTerminalToCst(preCstNode, ruleName, ruleCstResult);
            this.setNodeLocationFromNode(preCstNode.location, ruleCstResult.location);
          };
          TreeBuilder2.prototype.getBaseCstVisitorConstructor = function() {
            if (utils_1.isUndefined(this.baseCstVisitorConstructor)) {
              var newBaseCstVisitorConstructor = cst_visitor_1.createBaseSemanticVisitorConstructor(this.className, utils_1.keys(this.gastProductionsCache));
              this.baseCstVisitorConstructor = newBaseCstVisitorConstructor;
              return newBaseCstVisitorConstructor;
            }
            return this.baseCstVisitorConstructor;
          };
          TreeBuilder2.prototype.getBaseCstVisitorConstructorWithDefaults = function() {
            if (utils_1.isUndefined(this.baseCstVisitorWithDefaultsConstructor)) {
              var newConstructor = cst_visitor_1.createBaseVisitorConstructorWithDefaults(this.className, utils_1.keys(this.gastProductionsCache), this.getBaseCstVisitorConstructor());
              this.baseCstVisitorWithDefaultsConstructor = newConstructor;
              return newConstructor;
            }
            return this.baseCstVisitorWithDefaultsConstructor;
          };
          TreeBuilder2.prototype.getLastExplicitRuleShortName = function() {
            var ruleStack = this.RULE_STACK;
            return ruleStack[ruleStack.length - 1];
          };
          TreeBuilder2.prototype.getPreviousExplicitRuleShortName = function() {
            var ruleStack = this.RULE_STACK;
            return ruleStack[ruleStack.length - 2];
          };
          TreeBuilder2.prototype.getLastExplicitRuleOccurrenceIndex = function() {
            var occurrenceStack = this.RULE_OCCURRENCE_STACK;
            return occurrenceStack[occurrenceStack.length - 1];
          };
          return TreeBuilder2;
        })()
      );
      exports2.TreeBuilder = TreeBuilder;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/lexer_adapter.js
  var require_lexer_adapter = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/lexer_adapter.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.LexerAdapter = void 0;
      var parser_1 = require_parser();
      var LexerAdapter = (
        /** @class */
        (function() {
          function LexerAdapter2() {
          }
          LexerAdapter2.prototype.initLexerAdapter = function() {
            this.tokVector = [];
            this.tokVectorLength = 0;
            this.currIdx = -1;
          };
          Object.defineProperty(LexerAdapter2.prototype, "input", {
            get: function() {
              return this.tokVector;
            },
            set: function(newInput) {
              if (this.selfAnalysisDone !== true) {
                throw Error("Missing <performSelfAnalysis> invocation at the end of the Parser's constructor.");
              }
              this.reset();
              this.tokVector = newInput;
              this.tokVectorLength = newInput.length;
            },
            enumerable: false,
            configurable: true
          });
          LexerAdapter2.prototype.SKIP_TOKEN = function() {
            if (this.currIdx <= this.tokVector.length - 2) {
              this.consumeToken();
              return this.LA(1);
            } else {
              return parser_1.END_OF_FILE;
            }
          };
          LexerAdapter2.prototype.LA = function(howMuch) {
            var soughtIdx = this.currIdx + howMuch;
            if (soughtIdx < 0 || this.tokVectorLength <= soughtIdx) {
              return parser_1.END_OF_FILE;
            } else {
              return this.tokVector[soughtIdx];
            }
          };
          LexerAdapter2.prototype.consumeToken = function() {
            this.currIdx++;
          };
          LexerAdapter2.prototype.exportLexerState = function() {
            return this.currIdx;
          };
          LexerAdapter2.prototype.importLexerState = function(newState) {
            this.currIdx = newState;
          };
          LexerAdapter2.prototype.resetLexerState = function() {
            this.currIdx = -1;
          };
          LexerAdapter2.prototype.moveToTerminatedState = function() {
            this.currIdx = this.tokVector.length - 1;
          };
          LexerAdapter2.prototype.getLexerPosition = function() {
            return this.exportLexerState();
          };
          return LexerAdapter2;
        })()
      );
      exports2.LexerAdapter = LexerAdapter;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/recognizer_api.js
  var require_recognizer_api = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/recognizer_api.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.RecognizerApi = void 0;
      var utils_1 = require_utils();
      var exceptions_public_1 = require_exceptions_public();
      var parser_1 = require_parser();
      var errors_public_1 = require_errors_public();
      var checks_1 = require_checks();
      var gast_public_1 = require_gast_public();
      var RecognizerApi = (
        /** @class */
        (function() {
          function RecognizerApi2() {
          }
          RecognizerApi2.prototype.ACTION = function(impl) {
            return impl.call(this);
          };
          RecognizerApi2.prototype.consume = function(idx, tokType, options) {
            return this.consumeInternal(tokType, idx, options);
          };
          RecognizerApi2.prototype.subrule = function(idx, ruleToCall, options) {
            return this.subruleInternal(ruleToCall, idx, options);
          };
          RecognizerApi2.prototype.option = function(idx, actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, idx);
          };
          RecognizerApi2.prototype.or = function(idx, altsOrOpts) {
            return this.orInternal(altsOrOpts, idx);
          };
          RecognizerApi2.prototype.many = function(idx, actionORMethodDef) {
            return this.manyInternal(idx, actionORMethodDef);
          };
          RecognizerApi2.prototype.atLeastOne = function(idx, actionORMethodDef) {
            return this.atLeastOneInternal(idx, actionORMethodDef);
          };
          RecognizerApi2.prototype.CONSUME = function(tokType, options) {
            return this.consumeInternal(tokType, 0, options);
          };
          RecognizerApi2.prototype.CONSUME1 = function(tokType, options) {
            return this.consumeInternal(tokType, 1, options);
          };
          RecognizerApi2.prototype.CONSUME2 = function(tokType, options) {
            return this.consumeInternal(tokType, 2, options);
          };
          RecognizerApi2.prototype.CONSUME3 = function(tokType, options) {
            return this.consumeInternal(tokType, 3, options);
          };
          RecognizerApi2.prototype.CONSUME4 = function(tokType, options) {
            return this.consumeInternal(tokType, 4, options);
          };
          RecognizerApi2.prototype.CONSUME5 = function(tokType, options) {
            return this.consumeInternal(tokType, 5, options);
          };
          RecognizerApi2.prototype.CONSUME6 = function(tokType, options) {
            return this.consumeInternal(tokType, 6, options);
          };
          RecognizerApi2.prototype.CONSUME7 = function(tokType, options) {
            return this.consumeInternal(tokType, 7, options);
          };
          RecognizerApi2.prototype.CONSUME8 = function(tokType, options) {
            return this.consumeInternal(tokType, 8, options);
          };
          RecognizerApi2.prototype.CONSUME9 = function(tokType, options) {
            return this.consumeInternal(tokType, 9, options);
          };
          RecognizerApi2.prototype.SUBRULE = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 0, options);
          };
          RecognizerApi2.prototype.SUBRULE1 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 1, options);
          };
          RecognizerApi2.prototype.SUBRULE2 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 2, options);
          };
          RecognizerApi2.prototype.SUBRULE3 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 3, options);
          };
          RecognizerApi2.prototype.SUBRULE4 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 4, options);
          };
          RecognizerApi2.prototype.SUBRULE5 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 5, options);
          };
          RecognizerApi2.prototype.SUBRULE6 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 6, options);
          };
          RecognizerApi2.prototype.SUBRULE7 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 7, options);
          };
          RecognizerApi2.prototype.SUBRULE8 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 8, options);
          };
          RecognizerApi2.prototype.SUBRULE9 = function(ruleToCall, options) {
            return this.subruleInternal(ruleToCall, 9, options);
          };
          RecognizerApi2.prototype.OPTION = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 0);
          };
          RecognizerApi2.prototype.OPTION1 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 1);
          };
          RecognizerApi2.prototype.OPTION2 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 2);
          };
          RecognizerApi2.prototype.OPTION3 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 3);
          };
          RecognizerApi2.prototype.OPTION4 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 4);
          };
          RecognizerApi2.prototype.OPTION5 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 5);
          };
          RecognizerApi2.prototype.OPTION6 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 6);
          };
          RecognizerApi2.prototype.OPTION7 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 7);
          };
          RecognizerApi2.prototype.OPTION8 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 8);
          };
          RecognizerApi2.prototype.OPTION9 = function(actionORMethodDef) {
            return this.optionInternal(actionORMethodDef, 9);
          };
          RecognizerApi2.prototype.OR = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 0);
          };
          RecognizerApi2.prototype.OR1 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 1);
          };
          RecognizerApi2.prototype.OR2 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 2);
          };
          RecognizerApi2.prototype.OR3 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 3);
          };
          RecognizerApi2.prototype.OR4 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 4);
          };
          RecognizerApi2.prototype.OR5 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 5);
          };
          RecognizerApi2.prototype.OR6 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 6);
          };
          RecognizerApi2.prototype.OR7 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 7);
          };
          RecognizerApi2.prototype.OR8 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 8);
          };
          RecognizerApi2.prototype.OR9 = function(altsOrOpts) {
            return this.orInternal(altsOrOpts, 9);
          };
          RecognizerApi2.prototype.MANY = function(actionORMethodDef) {
            this.manyInternal(0, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY1 = function(actionORMethodDef) {
            this.manyInternal(1, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY2 = function(actionORMethodDef) {
            this.manyInternal(2, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY3 = function(actionORMethodDef) {
            this.manyInternal(3, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY4 = function(actionORMethodDef) {
            this.manyInternal(4, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY5 = function(actionORMethodDef) {
            this.manyInternal(5, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY6 = function(actionORMethodDef) {
            this.manyInternal(6, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY7 = function(actionORMethodDef) {
            this.manyInternal(7, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY8 = function(actionORMethodDef) {
            this.manyInternal(8, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY9 = function(actionORMethodDef) {
            this.manyInternal(9, actionORMethodDef);
          };
          RecognizerApi2.prototype.MANY_SEP = function(options) {
            this.manySepFirstInternal(0, options);
          };
          RecognizerApi2.prototype.MANY_SEP1 = function(options) {
            this.manySepFirstInternal(1, options);
          };
          RecognizerApi2.prototype.MANY_SEP2 = function(options) {
            this.manySepFirstInternal(2, options);
          };
          RecognizerApi2.prototype.MANY_SEP3 = function(options) {
            this.manySepFirstInternal(3, options);
          };
          RecognizerApi2.prototype.MANY_SEP4 = function(options) {
            this.manySepFirstInternal(4, options);
          };
          RecognizerApi2.prototype.MANY_SEP5 = function(options) {
            this.manySepFirstInternal(5, options);
          };
          RecognizerApi2.prototype.MANY_SEP6 = function(options) {
            this.manySepFirstInternal(6, options);
          };
          RecognizerApi2.prototype.MANY_SEP7 = function(options) {
            this.manySepFirstInternal(7, options);
          };
          RecognizerApi2.prototype.MANY_SEP8 = function(options) {
            this.manySepFirstInternal(8, options);
          };
          RecognizerApi2.prototype.MANY_SEP9 = function(options) {
            this.manySepFirstInternal(9, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE = function(actionORMethodDef) {
            this.atLeastOneInternal(0, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE1 = function(actionORMethodDef) {
            return this.atLeastOneInternal(1, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE2 = function(actionORMethodDef) {
            this.atLeastOneInternal(2, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE3 = function(actionORMethodDef) {
            this.atLeastOneInternal(3, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE4 = function(actionORMethodDef) {
            this.atLeastOneInternal(4, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE5 = function(actionORMethodDef) {
            this.atLeastOneInternal(5, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE6 = function(actionORMethodDef) {
            this.atLeastOneInternal(6, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE7 = function(actionORMethodDef) {
            this.atLeastOneInternal(7, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE8 = function(actionORMethodDef) {
            this.atLeastOneInternal(8, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE9 = function(actionORMethodDef) {
            this.atLeastOneInternal(9, actionORMethodDef);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP = function(options) {
            this.atLeastOneSepFirstInternal(0, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP1 = function(options) {
            this.atLeastOneSepFirstInternal(1, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP2 = function(options) {
            this.atLeastOneSepFirstInternal(2, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP3 = function(options) {
            this.atLeastOneSepFirstInternal(3, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP4 = function(options) {
            this.atLeastOneSepFirstInternal(4, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP5 = function(options) {
            this.atLeastOneSepFirstInternal(5, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP6 = function(options) {
            this.atLeastOneSepFirstInternal(6, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP7 = function(options) {
            this.atLeastOneSepFirstInternal(7, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP8 = function(options) {
            this.atLeastOneSepFirstInternal(8, options);
          };
          RecognizerApi2.prototype.AT_LEAST_ONE_SEP9 = function(options) {
            this.atLeastOneSepFirstInternal(9, options);
          };
          RecognizerApi2.prototype.RULE = function(name, implementation, config) {
            if (config === void 0) {
              config = parser_1.DEFAULT_RULE_CONFIG;
            }
            if (utils_1.contains(this.definedRulesNames, name)) {
              var errMsg = errors_public_1.defaultGrammarValidatorErrorProvider.buildDuplicateRuleNameError({
                topLevelRule: name,
                grammarName: this.className
              });
              var error = {
                message: errMsg,
                type: parser_1.ParserDefinitionErrorType.DUPLICATE_RULE_NAME,
                ruleName: name
              };
              this.definitionErrors.push(error);
            }
            this.definedRulesNames.push(name);
            var ruleImplementation = this.defineRule(name, implementation, config);
            this[name] = ruleImplementation;
            return ruleImplementation;
          };
          RecognizerApi2.prototype.OVERRIDE_RULE = function(name, impl, config) {
            if (config === void 0) {
              config = parser_1.DEFAULT_RULE_CONFIG;
            }
            var ruleErrors = [];
            ruleErrors = ruleErrors.concat(checks_1.validateRuleIsOverridden(name, this.definedRulesNames, this.className));
            this.definitionErrors.push.apply(this.definitionErrors, ruleErrors);
            var ruleImplementation = this.defineRule(name, impl, config);
            this[name] = ruleImplementation;
            return ruleImplementation;
          };
          RecognizerApi2.prototype.BACKTRACK = function(grammarRule, args) {
            return function() {
              this.isBackTrackingStack.push(1);
              var orgState = this.saveRecogState();
              try {
                grammarRule.apply(this, args);
                return true;
              } catch (e) {
                if (exceptions_public_1.isRecognitionException(e)) {
                  return false;
                } else {
                  throw e;
                }
              } finally {
                this.reloadRecogState(orgState);
                this.isBackTrackingStack.pop();
              }
            };
          };
          RecognizerApi2.prototype.getGAstProductions = function() {
            return this.gastProductionsCache;
          };
          RecognizerApi2.prototype.getSerializedGastProductions = function() {
            return gast_public_1.serializeGrammar(utils_1.values(this.gastProductionsCache));
          };
          return RecognizerApi2;
        })()
      );
      exports2.RecognizerApi = RecognizerApi;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/recognizer_engine.js
  var require_recognizer_engine = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/recognizer_engine.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.RecognizerEngine = void 0;
      var utils_1 = require_utils();
      var keys_1 = require_keys();
      var exceptions_public_1 = require_exceptions_public();
      var lookahead_1 = require_lookahead();
      var interpreter_1 = require_interpreter();
      var parser_1 = require_parser();
      var recoverable_1 = require_recoverable();
      var tokens_public_1 = require_tokens_public();
      var tokens_1 = require_tokens();
      var lang_extensions_1 = require_lang_extensions();
      var RecognizerEngine = (
        /** @class */
        (function() {
          function RecognizerEngine2() {
          }
          RecognizerEngine2.prototype.initRecognizerEngine = function(tokenVocabulary, config) {
            this.className = lang_extensions_1.classNameFromInstance(this);
            this.shortRuleNameToFull = {};
            this.fullRuleNameToShort = {};
            this.ruleShortNameIdx = 256;
            this.tokenMatcher = tokens_1.tokenStructuredMatcherNoCategories;
            this.definedRulesNames = [];
            this.tokensMap = {};
            this.isBackTrackingStack = [];
            this.RULE_STACK = [];
            this.RULE_OCCURRENCE_STACK = [];
            this.gastProductionsCache = {};
            if (utils_1.has(config, "serializedGrammar")) {
              throw Error("The Parser's configuration can no longer contain a <serializedGrammar> property.\n	See: https://sap.github.io/chevrotain/docs/changes/BREAKING_CHANGES.html#_6-0-0\n	For Further details.");
            }
            if (utils_1.isArray(tokenVocabulary)) {
              if (utils_1.isEmpty(tokenVocabulary)) {
                throw Error("A Token Vocabulary cannot be empty.\n	Note that the first argument for the parser constructor\n	is no longer a Token vector (since v4.0).");
              }
              if (typeof tokenVocabulary[0].startOffset === "number") {
                throw Error("The Parser constructor no longer accepts a token vector as the first argument.\n	See: https://sap.github.io/chevrotain/docs/changes/BREAKING_CHANGES.html#_4-0-0\n	For Further details.");
              }
            }
            if (utils_1.isArray(tokenVocabulary)) {
              this.tokensMap = utils_1.reduce(tokenVocabulary, function(acc, tokType) {
                acc[tokType.name] = tokType;
                return acc;
              }, {});
            } else if (utils_1.has(tokenVocabulary, "modes") && utils_1.every(utils_1.flatten(utils_1.values(tokenVocabulary.modes)), tokens_1.isTokenType)) {
              var allTokenTypes = utils_1.flatten(utils_1.values(tokenVocabulary.modes));
              var uniqueTokens = utils_1.uniq(allTokenTypes);
              this.tokensMap = utils_1.reduce(uniqueTokens, function(acc, tokType) {
                acc[tokType.name] = tokType;
                return acc;
              }, {});
            } else if (utils_1.isObject(tokenVocabulary)) {
              this.tokensMap = utils_1.cloneObj(tokenVocabulary);
            } else {
              throw new Error("<tokensDictionary> argument must be An Array of Token constructors, A dictionary of Token constructors or an IMultiModeLexerDefinition");
            }
            this.tokensMap["EOF"] = tokens_public_1.EOF;
            var noTokenCategoriesUsed = utils_1.every(utils_1.values(tokenVocabulary), function(tokenConstructor) {
              return utils_1.isEmpty(tokenConstructor.categoryMatches);
            });
            this.tokenMatcher = noTokenCategoriesUsed ? tokens_1.tokenStructuredMatcherNoCategories : tokens_1.tokenStructuredMatcher;
            tokens_1.augmentTokenTypes(utils_1.values(this.tokensMap));
          };
          RecognizerEngine2.prototype.defineRule = function(ruleName, impl, config) {
            if (this.selfAnalysisDone) {
              throw Error("Grammar rule <" + ruleName + "> may not be defined after the 'performSelfAnalysis' method has been called'\nMake sure that all grammar rule definitions are done before 'performSelfAnalysis' is called.");
            }
            var resyncEnabled = utils_1.has(config, "resyncEnabled") ? config.resyncEnabled : parser_1.DEFAULT_RULE_CONFIG.resyncEnabled;
            var recoveryValueFunc = utils_1.has(config, "recoveryValueFunc") ? config.recoveryValueFunc : parser_1.DEFAULT_RULE_CONFIG.recoveryValueFunc;
            var shortName = this.ruleShortNameIdx << keys_1.BITS_FOR_METHOD_TYPE + keys_1.BITS_FOR_OCCURRENCE_IDX;
            this.ruleShortNameIdx++;
            this.shortRuleNameToFull[shortName] = ruleName;
            this.fullRuleNameToShort[ruleName] = shortName;
            function invokeRuleWithTry(args) {
              try {
                if (this.outputCst === true) {
                  impl.apply(this, args);
                  var cst = this.CST_STACK[this.CST_STACK.length - 1];
                  this.cstPostRule(cst);
                  return cst;
                } else {
                  return impl.apply(this, args);
                }
              } catch (e) {
                return this.invokeRuleCatch(e, resyncEnabled, recoveryValueFunc);
              } finally {
                this.ruleFinallyStateUpdate();
              }
            }
            var wrappedGrammarRule;
            wrappedGrammarRule = function(idxInCallingRule, args) {
              if (idxInCallingRule === void 0) {
                idxInCallingRule = 0;
              }
              this.ruleInvocationStateUpdate(shortName, ruleName, idxInCallingRule);
              return invokeRuleWithTry.call(this, args);
            };
            var ruleNamePropName = "ruleName";
            wrappedGrammarRule[ruleNamePropName] = ruleName;
            wrappedGrammarRule["originalGrammarAction"] = impl;
            return wrappedGrammarRule;
          };
          RecognizerEngine2.prototype.invokeRuleCatch = function(e, resyncEnabledConfig, recoveryValueFunc) {
            var isFirstInvokedRule = this.RULE_STACK.length === 1;
            var reSyncEnabled = resyncEnabledConfig && !this.isBackTracking() && this.recoveryEnabled;
            if (exceptions_public_1.isRecognitionException(e)) {
              var recogError = e;
              if (reSyncEnabled) {
                var reSyncTokType = this.findReSyncTokenType();
                if (this.isInCurrentRuleReSyncSet(reSyncTokType)) {
                  recogError.resyncedTokens = this.reSyncTo(reSyncTokType);
                  if (this.outputCst) {
                    var partialCstResult = this.CST_STACK[this.CST_STACK.length - 1];
                    partialCstResult.recoveredNode = true;
                    return partialCstResult;
                  } else {
                    return recoveryValueFunc();
                  }
                } else {
                  if (this.outputCst) {
                    var partialCstResult = this.CST_STACK[this.CST_STACK.length - 1];
                    partialCstResult.recoveredNode = true;
                    recogError.partialCstResult = partialCstResult;
                  }
                  throw recogError;
                }
              } else if (isFirstInvokedRule) {
                this.moveToTerminatedState();
                return recoveryValueFunc();
              } else {
                throw recogError;
              }
            } else {
              throw e;
            }
          };
          RecognizerEngine2.prototype.optionInternal = function(actionORMethodDef, occurrence) {
            var key = this.getKeyForAutomaticLookahead(keys_1.OPTION_IDX, occurrence);
            return this.optionInternalLogic(actionORMethodDef, occurrence, key);
          };
          RecognizerEngine2.prototype.optionInternalLogic = function(actionORMethodDef, occurrence, key) {
            var _this = this;
            var lookAheadFunc = this.getLaFuncFromCache(key);
            var action;
            var predicate;
            if (actionORMethodDef.DEF !== void 0) {
              action = actionORMethodDef.DEF;
              predicate = actionORMethodDef.GATE;
              if (predicate !== void 0) {
                var orgLookaheadFunction_1 = lookAheadFunc;
                lookAheadFunc = function() {
                  return predicate.call(_this) && orgLookaheadFunction_1.call(_this);
                };
              }
            } else {
              action = actionORMethodDef;
            }
            if (lookAheadFunc.call(this) === true) {
              return action.call(this);
            }
            return void 0;
          };
          RecognizerEngine2.prototype.atLeastOneInternal = function(prodOccurrence, actionORMethodDef) {
            var laKey = this.getKeyForAutomaticLookahead(keys_1.AT_LEAST_ONE_IDX, prodOccurrence);
            return this.atLeastOneInternalLogic(prodOccurrence, actionORMethodDef, laKey);
          };
          RecognizerEngine2.prototype.atLeastOneInternalLogic = function(prodOccurrence, actionORMethodDef, key) {
            var _this = this;
            var lookAheadFunc = this.getLaFuncFromCache(key);
            var action;
            var predicate;
            if (actionORMethodDef.DEF !== void 0) {
              action = actionORMethodDef.DEF;
              predicate = actionORMethodDef.GATE;
              if (predicate !== void 0) {
                var orgLookaheadFunction_2 = lookAheadFunc;
                lookAheadFunc = function() {
                  return predicate.call(_this) && orgLookaheadFunction_2.call(_this);
                };
              }
            } else {
              action = actionORMethodDef;
            }
            if (lookAheadFunc.call(this) === true) {
              var notStuck = this.doSingleRepetition(action);
              while (lookAheadFunc.call(this) === true && notStuck === true) {
                notStuck = this.doSingleRepetition(action);
              }
            } else {
              throw this.raiseEarlyExitException(prodOccurrence, lookahead_1.PROD_TYPE.REPETITION_MANDATORY, actionORMethodDef.ERR_MSG);
            }
            this.attemptInRepetitionRecovery(this.atLeastOneInternal, [prodOccurrence, actionORMethodDef], lookAheadFunc, keys_1.AT_LEAST_ONE_IDX, prodOccurrence, interpreter_1.NextTerminalAfterAtLeastOneWalker);
          };
          RecognizerEngine2.prototype.atLeastOneSepFirstInternal = function(prodOccurrence, options) {
            var laKey = this.getKeyForAutomaticLookahead(keys_1.AT_LEAST_ONE_SEP_IDX, prodOccurrence);
            this.atLeastOneSepFirstInternalLogic(prodOccurrence, options, laKey);
          };
          RecognizerEngine2.prototype.atLeastOneSepFirstInternalLogic = function(prodOccurrence, options, key) {
            var _this = this;
            var action = options.DEF;
            var separator = options.SEP;
            var firstIterationLookaheadFunc = this.getLaFuncFromCache(key);
            if (firstIterationLookaheadFunc.call(this) === true) {
              ;
              action.call(this);
              var separatorLookAheadFunc = function() {
                return _this.tokenMatcher(_this.LA(1), separator);
              };
              while (this.tokenMatcher(this.LA(1), separator) === true) {
                this.CONSUME(separator);
                action.call(this);
              }
              this.attemptInRepetitionRecovery(this.repetitionSepSecondInternal, [
                prodOccurrence,
                separator,
                separatorLookAheadFunc,
                action,
                interpreter_1.NextTerminalAfterAtLeastOneSepWalker
              ], separatorLookAheadFunc, keys_1.AT_LEAST_ONE_SEP_IDX, prodOccurrence, interpreter_1.NextTerminalAfterAtLeastOneSepWalker);
            } else {
              throw this.raiseEarlyExitException(prodOccurrence, lookahead_1.PROD_TYPE.REPETITION_MANDATORY_WITH_SEPARATOR, options.ERR_MSG);
            }
          };
          RecognizerEngine2.prototype.manyInternal = function(prodOccurrence, actionORMethodDef) {
            var laKey = this.getKeyForAutomaticLookahead(keys_1.MANY_IDX, prodOccurrence);
            return this.manyInternalLogic(prodOccurrence, actionORMethodDef, laKey);
          };
          RecognizerEngine2.prototype.manyInternalLogic = function(prodOccurrence, actionORMethodDef, key) {
            var _this = this;
            var lookaheadFunction = this.getLaFuncFromCache(key);
            var action;
            var predicate;
            if (actionORMethodDef.DEF !== void 0) {
              action = actionORMethodDef.DEF;
              predicate = actionORMethodDef.GATE;
              if (predicate !== void 0) {
                var orgLookaheadFunction_3 = lookaheadFunction;
                lookaheadFunction = function() {
                  return predicate.call(_this) && orgLookaheadFunction_3.call(_this);
                };
              }
            } else {
              action = actionORMethodDef;
            }
            var notStuck = true;
            while (lookaheadFunction.call(this) === true && notStuck === true) {
              notStuck = this.doSingleRepetition(action);
            }
            this.attemptInRepetitionRecovery(
              this.manyInternal,
              [prodOccurrence, actionORMethodDef],
              lookaheadFunction,
              keys_1.MANY_IDX,
              prodOccurrence,
              interpreter_1.NextTerminalAfterManyWalker,
              // The notStuck parameter is only relevant when "attemptInRepetitionRecovery"
              // is invoked from manyInternal, in the MANY_SEP case and AT_LEAST_ONE[_SEP]
              // An infinite loop cannot occur as:
              // - Either the lookahead is guaranteed to consume something (Single Token Separator)
              // - AT_LEAST_ONE by definition is guaranteed to consume something (or error out).
              notStuck
            );
          };
          RecognizerEngine2.prototype.manySepFirstInternal = function(prodOccurrence, options) {
            var laKey = this.getKeyForAutomaticLookahead(keys_1.MANY_SEP_IDX, prodOccurrence);
            this.manySepFirstInternalLogic(prodOccurrence, options, laKey);
          };
          RecognizerEngine2.prototype.manySepFirstInternalLogic = function(prodOccurrence, options, key) {
            var _this = this;
            var action = options.DEF;
            var separator = options.SEP;
            var firstIterationLaFunc = this.getLaFuncFromCache(key);
            if (firstIterationLaFunc.call(this) === true) {
              action.call(this);
              var separatorLookAheadFunc = function() {
                return _this.tokenMatcher(_this.LA(1), separator);
              };
              while (this.tokenMatcher(this.LA(1), separator) === true) {
                this.CONSUME(separator);
                action.call(this);
              }
              this.attemptInRepetitionRecovery(this.repetitionSepSecondInternal, [
                prodOccurrence,
                separator,
                separatorLookAheadFunc,
                action,
                interpreter_1.NextTerminalAfterManySepWalker
              ], separatorLookAheadFunc, keys_1.MANY_SEP_IDX, prodOccurrence, interpreter_1.NextTerminalAfterManySepWalker);
            }
          };
          RecognizerEngine2.prototype.repetitionSepSecondInternal = function(prodOccurrence, separator, separatorLookAheadFunc, action, nextTerminalAfterWalker) {
            while (separatorLookAheadFunc()) {
              this.CONSUME(separator);
              action.call(this);
            }
            this.attemptInRepetitionRecovery(this.repetitionSepSecondInternal, [
              prodOccurrence,
              separator,
              separatorLookAheadFunc,
              action,
              nextTerminalAfterWalker
            ], separatorLookAheadFunc, keys_1.AT_LEAST_ONE_SEP_IDX, prodOccurrence, nextTerminalAfterWalker);
          };
          RecognizerEngine2.prototype.doSingleRepetition = function(action) {
            var beforeIteration = this.getLexerPosition();
            action.call(this);
            var afterIteration = this.getLexerPosition();
            return afterIteration > beforeIteration;
          };
          RecognizerEngine2.prototype.orInternal = function(altsOrOpts, occurrence) {
            var laKey = this.getKeyForAutomaticLookahead(keys_1.OR_IDX, occurrence);
            var alts = utils_1.isArray(altsOrOpts) ? altsOrOpts : altsOrOpts.DEF;
            var laFunc = this.getLaFuncFromCache(laKey);
            var altIdxToTake = laFunc.call(this, alts);
            if (altIdxToTake !== void 0) {
              var chosenAlternative = alts[altIdxToTake];
              return chosenAlternative.ALT.call(this);
            }
            this.raiseNoAltException(occurrence, altsOrOpts.ERR_MSG);
          };
          RecognizerEngine2.prototype.ruleFinallyStateUpdate = function() {
            this.RULE_STACK.pop();
            this.RULE_OCCURRENCE_STACK.pop();
            this.cstFinallyStateUpdate();
            if (this.RULE_STACK.length === 0 && this.isAtEndOfInput() === false) {
              var firstRedundantTok = this.LA(1);
              var errMsg = this.errorMessageProvider.buildNotAllInputParsedMessage({
                firstRedundant: firstRedundantTok,
                ruleName: this.getCurrRuleFullName()
              });
              this.SAVE_ERROR(new exceptions_public_1.NotAllInputParsedException(errMsg, firstRedundantTok));
            }
          };
          RecognizerEngine2.prototype.subruleInternal = function(ruleToCall, idx, options) {
            var ruleResult;
            try {
              var args = options !== void 0 ? options.ARGS : void 0;
              ruleResult = ruleToCall.call(this, idx, args);
              this.cstPostNonTerminal(ruleResult, options !== void 0 && options.LABEL !== void 0 ? options.LABEL : ruleToCall.ruleName);
              return ruleResult;
            } catch (e) {
              this.subruleInternalError(e, options, ruleToCall.ruleName);
            }
          };
          RecognizerEngine2.prototype.subruleInternalError = function(e, options, ruleName) {
            if (exceptions_public_1.isRecognitionException(e) && e.partialCstResult !== void 0) {
              this.cstPostNonTerminal(e.partialCstResult, options !== void 0 && options.LABEL !== void 0 ? options.LABEL : ruleName);
              delete e.partialCstResult;
            }
            throw e;
          };
          RecognizerEngine2.prototype.consumeInternal = function(tokType, idx, options) {
            var consumedToken;
            try {
              var nextToken = this.LA(1);
              if (this.tokenMatcher(nextToken, tokType) === true) {
                this.consumeToken();
                consumedToken = nextToken;
              } else {
                this.consumeInternalError(tokType, nextToken, options);
              }
            } catch (eFromConsumption) {
              consumedToken = this.consumeInternalRecovery(tokType, idx, eFromConsumption);
            }
            this.cstPostTerminal(options !== void 0 && options.LABEL !== void 0 ? options.LABEL : tokType.name, consumedToken);
            return consumedToken;
          };
          RecognizerEngine2.prototype.consumeInternalError = function(tokType, nextToken, options) {
            var msg;
            var previousToken = this.LA(0);
            if (options !== void 0 && options.ERR_MSG) {
              msg = options.ERR_MSG;
            } else {
              msg = this.errorMessageProvider.buildMismatchTokenMessage({
                expected: tokType,
                actual: nextToken,
                previous: previousToken,
                ruleName: this.getCurrRuleFullName()
              });
            }
            throw this.SAVE_ERROR(new exceptions_public_1.MismatchedTokenException(msg, nextToken, previousToken));
          };
          RecognizerEngine2.prototype.consumeInternalRecovery = function(tokType, idx, eFromConsumption) {
            if (this.recoveryEnabled && // TODO: more robust checking of the exception type. Perhaps Typescript extending expressions?
            eFromConsumption.name === "MismatchedTokenException" && !this.isBackTracking()) {
              var follows = this.getFollowsForInRuleRecovery(tokType, idx);
              try {
                return this.tryInRuleRecovery(tokType, follows);
              } catch (eFromInRuleRecovery) {
                if (eFromInRuleRecovery.name === recoverable_1.IN_RULE_RECOVERY_EXCEPTION) {
                  throw eFromConsumption;
                } else {
                  throw eFromInRuleRecovery;
                }
              }
            } else {
              throw eFromConsumption;
            }
          };
          RecognizerEngine2.prototype.saveRecogState = function() {
            var savedErrors = this.errors;
            var savedRuleStack = utils_1.cloneArr(this.RULE_STACK);
            return {
              errors: savedErrors,
              lexerState: this.exportLexerState(),
              RULE_STACK: savedRuleStack,
              CST_STACK: this.CST_STACK
            };
          };
          RecognizerEngine2.prototype.reloadRecogState = function(newState) {
            this.errors = newState.errors;
            this.importLexerState(newState.lexerState);
            this.RULE_STACK = newState.RULE_STACK;
          };
          RecognizerEngine2.prototype.ruleInvocationStateUpdate = function(shortName, fullName, idxInCallingRule) {
            this.RULE_OCCURRENCE_STACK.push(idxInCallingRule);
            this.RULE_STACK.push(shortName);
            this.cstInvocationStateUpdate(fullName, shortName);
          };
          RecognizerEngine2.prototype.isBackTracking = function() {
            return this.isBackTrackingStack.length !== 0;
          };
          RecognizerEngine2.prototype.getCurrRuleFullName = function() {
            var shortName = this.getLastExplicitRuleShortName();
            return this.shortRuleNameToFull[shortName];
          };
          RecognizerEngine2.prototype.shortRuleNameToFullName = function(shortName) {
            return this.shortRuleNameToFull[shortName];
          };
          RecognizerEngine2.prototype.isAtEndOfInput = function() {
            return this.tokenMatcher(this.LA(1), tokens_public_1.EOF);
          };
          RecognizerEngine2.prototype.reset = function() {
            this.resetLexerState();
            this.isBackTrackingStack = [];
            this.errors = [];
            this.RULE_STACK = [];
            this.CST_STACK = [];
            this.RULE_OCCURRENCE_STACK = [];
          };
          return RecognizerEngine2;
        })()
      );
      exports2.RecognizerEngine = RecognizerEngine;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/error_handler.js
  var require_error_handler = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/error_handler.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.ErrorHandler = void 0;
      var exceptions_public_1 = require_exceptions_public();
      var utils_1 = require_utils();
      var lookahead_1 = require_lookahead();
      var parser_1 = require_parser();
      var ErrorHandler = (
        /** @class */
        (function() {
          function ErrorHandler2() {
          }
          ErrorHandler2.prototype.initErrorHandler = function(config) {
            this._errors = [];
            this.errorMessageProvider = utils_1.has(config, "errorMessageProvider") ? config.errorMessageProvider : parser_1.DEFAULT_PARSER_CONFIG.errorMessageProvider;
          };
          ErrorHandler2.prototype.SAVE_ERROR = function(error) {
            if (exceptions_public_1.isRecognitionException(error)) {
              error.context = {
                ruleStack: this.getHumanReadableRuleStack(),
                ruleOccurrenceStack: utils_1.cloneArr(this.RULE_OCCURRENCE_STACK)
              };
              this._errors.push(error);
              return error;
            } else {
              throw Error("Trying to save an Error which is not a RecognitionException");
            }
          };
          Object.defineProperty(ErrorHandler2.prototype, "errors", {
            get: function() {
              return utils_1.cloneArr(this._errors);
            },
            set: function(newErrors) {
              this._errors = newErrors;
            },
            enumerable: false,
            configurable: true
          });
          ErrorHandler2.prototype.raiseEarlyExitException = function(occurrence, prodType, userDefinedErrMsg) {
            var ruleName = this.getCurrRuleFullName();
            var ruleGrammar = this.getGAstProductions()[ruleName];
            var lookAheadPathsPerAlternative = lookahead_1.getLookaheadPathsForOptionalProd(occurrence, ruleGrammar, prodType, this.maxLookahead);
            var insideProdPaths = lookAheadPathsPerAlternative[0];
            var actualTokens = [];
            for (var i = 1; i <= this.maxLookahead; i++) {
              actualTokens.push(this.LA(i));
            }
            var msg = this.errorMessageProvider.buildEarlyExitMessage({
              expectedIterationPaths: insideProdPaths,
              actual: actualTokens,
              previous: this.LA(0),
              customUserDescription: userDefinedErrMsg,
              ruleName
            });
            throw this.SAVE_ERROR(new exceptions_public_1.EarlyExitException(msg, this.LA(1), this.LA(0)));
          };
          ErrorHandler2.prototype.raiseNoAltException = function(occurrence, errMsgTypes) {
            var ruleName = this.getCurrRuleFullName();
            var ruleGrammar = this.getGAstProductions()[ruleName];
            var lookAheadPathsPerAlternative = lookahead_1.getLookaheadPathsForOr(occurrence, ruleGrammar, this.maxLookahead);
            var actualTokens = [];
            for (var i = 1; i <= this.maxLookahead; i++) {
              actualTokens.push(this.LA(i));
            }
            var previousToken = this.LA(0);
            var errMsg = this.errorMessageProvider.buildNoViableAltMessage({
              expectedPathsPerAlt: lookAheadPathsPerAlternative,
              actual: actualTokens,
              previous: previousToken,
              customUserDescription: errMsgTypes,
              ruleName: this.getCurrRuleFullName()
            });
            throw this.SAVE_ERROR(new exceptions_public_1.NoViableAltException(errMsg, this.LA(1), previousToken));
          };
          return ErrorHandler2;
        })()
      );
      exports2.ErrorHandler = ErrorHandler;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/context_assist.js
  var require_context_assist = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/context_assist.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.ContentAssist = void 0;
      var interpreter_1 = require_interpreter();
      var utils_1 = require_utils();
      var ContentAssist = (
        /** @class */
        (function() {
          function ContentAssist2() {
          }
          ContentAssist2.prototype.initContentAssist = function() {
          };
          ContentAssist2.prototype.computeContentAssist = function(startRuleName, precedingInput) {
            var startRuleGast = this.gastProductionsCache[startRuleName];
            if (utils_1.isUndefined(startRuleGast)) {
              throw Error("Rule ->" + startRuleName + "<- does not exist in this grammar.");
            }
            return interpreter_1.nextPossibleTokensAfter([startRuleGast], precedingInput, this.tokenMatcher, this.maxLookahead);
          };
          ContentAssist2.prototype.getNextPossibleTokenTypes = function(grammarPath) {
            var topRuleName = utils_1.first(grammarPath.ruleStack);
            var gastProductions = this.getGAstProductions();
            var topProduction = gastProductions[topRuleName];
            var nextPossibleTokenTypes = new interpreter_1.NextAfterTokenWalker(topProduction, grammarPath).startWalking();
            return nextPossibleTokenTypes;
          };
          return ContentAssist2;
        })()
      );
      exports2.ContentAssist = ContentAssist;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/gast_recorder.js
  var require_gast_recorder = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/gast_recorder.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.GastRecorder = void 0;
      var utils_1 = require_utils();
      var gast_public_1 = require_gast_public();
      var lexer_public_1 = require_lexer_public();
      var tokens_1 = require_tokens();
      var tokens_public_1 = require_tokens_public();
      var parser_1 = require_parser();
      var keys_1 = require_keys();
      var RECORDING_NULL_OBJECT = {
        description: "This Object indicates the Parser is during Recording Phase"
      };
      Object.freeze(RECORDING_NULL_OBJECT);
      var HANDLE_SEPARATOR = true;
      var MAX_METHOD_IDX = Math.pow(2, keys_1.BITS_FOR_OCCURRENCE_IDX) - 1;
      var RFT = tokens_public_1.createToken({ name: "RECORDING_PHASE_TOKEN", pattern: lexer_public_1.Lexer.NA });
      tokens_1.augmentTokenTypes([RFT]);
      var RECORDING_PHASE_TOKEN = tokens_public_1.createTokenInstance(
        RFT,
        "This IToken indicates the Parser is in Recording Phase\n	See: https://sap.github.io/chevrotain/docs/guide/internals.html#grammar-recording for details",
        // Using "-1" instead of NaN (as in EOF) because an actual number is less likely to
        // cause errors if the output of LA or CONSUME would be (incorrectly) used during the recording phase.
        -1,
        -1,
        -1,
        -1,
        -1,
        -1
      );
      Object.freeze(RECORDING_PHASE_TOKEN);
      var RECORDING_PHASE_CSTNODE = {
        name: "This CSTNode indicates the Parser is in Recording Phase\n	See: https://sap.github.io/chevrotain/docs/guide/internals.html#grammar-recording for details",
        children: {}
      };
      var GastRecorder = (
        /** @class */
        (function() {
          function GastRecorder2() {
          }
          GastRecorder2.prototype.initGastRecorder = function(config) {
            this.recordingProdStack = [];
            this.RECORDING_PHASE = false;
          };
          GastRecorder2.prototype.enableRecording = function() {
            var _this = this;
            this.RECORDING_PHASE = true;
            this.TRACE_INIT("Enable Recording", function() {
              var _loop_1 = function(i2) {
                var idx = i2 > 0 ? i2 : "";
                _this["CONSUME" + idx] = function(arg1, arg2) {
                  return this.consumeInternalRecord(arg1, i2, arg2);
                };
                _this["SUBRULE" + idx] = function(arg1, arg2) {
                  return this.subruleInternalRecord(arg1, i2, arg2);
                };
                _this["OPTION" + idx] = function(arg1) {
                  return this.optionInternalRecord(arg1, i2);
                };
                _this["OR" + idx] = function(arg1) {
                  return this.orInternalRecord(arg1, i2);
                };
                _this["MANY" + idx] = function(arg1) {
                  this.manyInternalRecord(i2, arg1);
                };
                _this["MANY_SEP" + idx] = function(arg1) {
                  this.manySepFirstInternalRecord(i2, arg1);
                };
                _this["AT_LEAST_ONE" + idx] = function(arg1) {
                  this.atLeastOneInternalRecord(i2, arg1);
                };
                _this["AT_LEAST_ONE_SEP" + idx] = function(arg1) {
                  this.atLeastOneSepFirstInternalRecord(i2, arg1);
                };
              };
              for (var i = 0; i < 10; i++) {
                _loop_1(i);
              }
              _this["consume"] = function(idx, arg1, arg2) {
                return this.consumeInternalRecord(arg1, idx, arg2);
              };
              _this["subrule"] = function(idx, arg1, arg2) {
                return this.subruleInternalRecord(arg1, idx, arg2);
              };
              _this["option"] = function(idx, arg1) {
                return this.optionInternalRecord(arg1, idx);
              };
              _this["or"] = function(idx, arg1) {
                return this.orInternalRecord(arg1, idx);
              };
              _this["many"] = function(idx, arg1) {
                this.manyInternalRecord(idx, arg1);
              };
              _this["atLeastOne"] = function(idx, arg1) {
                this.atLeastOneInternalRecord(idx, arg1);
              };
              _this.ACTION = _this.ACTION_RECORD;
              _this.BACKTRACK = _this.BACKTRACK_RECORD;
              _this.LA = _this.LA_RECORD;
            });
          };
          GastRecorder2.prototype.disableRecording = function() {
            var _this = this;
            this.RECORDING_PHASE = false;
            this.TRACE_INIT("Deleting Recording methods", function() {
              for (var i = 0; i < 10; i++) {
                var idx = i > 0 ? i : "";
                delete _this["CONSUME" + idx];
                delete _this["SUBRULE" + idx];
                delete _this["OPTION" + idx];
                delete _this["OR" + idx];
                delete _this["MANY" + idx];
                delete _this["MANY_SEP" + idx];
                delete _this["AT_LEAST_ONE" + idx];
                delete _this["AT_LEAST_ONE_SEP" + idx];
              }
              delete _this["consume"];
              delete _this["subrule"];
              delete _this["option"];
              delete _this["or"];
              delete _this["many"];
              delete _this["atLeastOne"];
              delete _this.ACTION;
              delete _this.BACKTRACK;
              delete _this.LA;
            });
          };
          GastRecorder2.prototype.ACTION_RECORD = function(impl) {
            return;
          };
          GastRecorder2.prototype.BACKTRACK_RECORD = function(grammarRule, args) {
            return function() {
              return true;
            };
          };
          GastRecorder2.prototype.LA_RECORD = function(howMuch) {
            return parser_1.END_OF_FILE;
          };
          GastRecorder2.prototype.topLevelRuleRecord = function(name, def) {
            try {
              var newTopLevelRule = new gast_public_1.Rule({ definition: [], name });
              newTopLevelRule.name = name;
              this.recordingProdStack.push(newTopLevelRule);
              def.call(this);
              this.recordingProdStack.pop();
              return newTopLevelRule;
            } catch (originalError) {
              if (originalError.KNOWN_RECORDER_ERROR !== true) {
                try {
                  originalError.message = originalError.message + '\n	 This error was thrown during the "grammar recording phase" For more info see:\n	https://sap.github.io/chevrotain/docs/guide/internals.html#grammar-recording';
                } catch (mutabilityError) {
                  throw originalError;
                }
              }
              throw originalError;
            }
          };
          GastRecorder2.prototype.optionInternalRecord = function(actionORMethodDef, occurrence) {
            return recordProd.call(this, gast_public_1.Option, actionORMethodDef, occurrence);
          };
          GastRecorder2.prototype.atLeastOneInternalRecord = function(occurrence, actionORMethodDef) {
            recordProd.call(this, gast_public_1.RepetitionMandatory, actionORMethodDef, occurrence);
          };
          GastRecorder2.prototype.atLeastOneSepFirstInternalRecord = function(occurrence, options) {
            recordProd.call(this, gast_public_1.RepetitionMandatoryWithSeparator, options, occurrence, HANDLE_SEPARATOR);
          };
          GastRecorder2.prototype.manyInternalRecord = function(occurrence, actionORMethodDef) {
            recordProd.call(this, gast_public_1.Repetition, actionORMethodDef, occurrence);
          };
          GastRecorder2.prototype.manySepFirstInternalRecord = function(occurrence, options) {
            recordProd.call(this, gast_public_1.RepetitionWithSeparator, options, occurrence, HANDLE_SEPARATOR);
          };
          GastRecorder2.prototype.orInternalRecord = function(altsOrOpts, occurrence) {
            return recordOrProd.call(this, altsOrOpts, occurrence);
          };
          GastRecorder2.prototype.subruleInternalRecord = function(ruleToCall, occurrence, options) {
            assertMethodIdxIsValid(occurrence);
            if (!ruleToCall || utils_1.has(ruleToCall, "ruleName") === false) {
              var error = new Error("<SUBRULE" + getIdxSuffix(occurrence) + "> argument is invalid" + (" expecting a Parser method reference but got: <" + JSON.stringify(ruleToCall) + ">") + ("\n inside top level rule: <" + this.recordingProdStack[0].name + ">"));
              error.KNOWN_RECORDER_ERROR = true;
              throw error;
            }
            var prevProd = utils_1.peek(this.recordingProdStack);
            var ruleName = ruleToCall["ruleName"];
            var newNoneTerminal = new gast_public_1.NonTerminal({
              idx: occurrence,
              nonTerminalName: ruleName,
              // The resolving of the `referencedRule` property will be done once all the Rule's GASTs have been created
              referencedRule: void 0
            });
            prevProd.definition.push(newNoneTerminal);
            return this.outputCst ? RECORDING_PHASE_CSTNODE : RECORDING_NULL_OBJECT;
          };
          GastRecorder2.prototype.consumeInternalRecord = function(tokType, occurrence, options) {
            assertMethodIdxIsValid(occurrence);
            if (!tokens_1.hasShortKeyProperty(tokType)) {
              var error = new Error("<CONSUME" + getIdxSuffix(occurrence) + "> argument is invalid" + (" expecting a TokenType reference but got: <" + JSON.stringify(tokType) + ">") + ("\n inside top level rule: <" + this.recordingProdStack[0].name + ">"));
              error.KNOWN_RECORDER_ERROR = true;
              throw error;
            }
            var prevProd = utils_1.peek(this.recordingProdStack);
            var newNoneTerminal = new gast_public_1.Terminal({
              idx: occurrence,
              terminalType: tokType
            });
            prevProd.definition.push(newNoneTerminal);
            return RECORDING_PHASE_TOKEN;
          };
          return GastRecorder2;
        })()
      );
      exports2.GastRecorder = GastRecorder;
      function recordProd(prodConstructor, mainProdArg, occurrence, handleSep) {
        if (handleSep === void 0) {
          handleSep = false;
        }
        assertMethodIdxIsValid(occurrence);
        var prevProd = utils_1.peek(this.recordingProdStack);
        var grammarAction = utils_1.isFunction(mainProdArg) ? mainProdArg : mainProdArg.DEF;
        var newProd = new prodConstructor({ definition: [], idx: occurrence });
        if (handleSep) {
          newProd.separator = mainProdArg.SEP;
        }
        if (utils_1.has(mainProdArg, "MAX_LOOKAHEAD")) {
          newProd.maxLookahead = mainProdArg.MAX_LOOKAHEAD;
        }
        this.recordingProdStack.push(newProd);
        grammarAction.call(this);
        prevProd.definition.push(newProd);
        this.recordingProdStack.pop();
        return RECORDING_NULL_OBJECT;
      }
      function recordOrProd(mainProdArg, occurrence) {
        var _this = this;
        assertMethodIdxIsValid(occurrence);
        var prevProd = utils_1.peek(this.recordingProdStack);
        var hasOptions = utils_1.isArray(mainProdArg) === false;
        var alts = hasOptions === false ? mainProdArg : mainProdArg.DEF;
        var newOrProd = new gast_public_1.Alternation({
          definition: [],
          idx: occurrence,
          ignoreAmbiguities: hasOptions && mainProdArg.IGNORE_AMBIGUITIES === true
        });
        if (utils_1.has(mainProdArg, "MAX_LOOKAHEAD")) {
          newOrProd.maxLookahead = mainProdArg.MAX_LOOKAHEAD;
        }
        var hasPredicates = utils_1.some(alts, function(currAlt) {
          return utils_1.isFunction(currAlt.GATE);
        });
        newOrProd.hasPredicates = hasPredicates;
        prevProd.definition.push(newOrProd);
        utils_1.forEach(alts, function(currAlt) {
          var currAltFlat = new gast_public_1.Alternative({ definition: [] });
          newOrProd.definition.push(currAltFlat);
          if (utils_1.has(currAlt, "IGNORE_AMBIGUITIES")) {
            currAltFlat.ignoreAmbiguities = currAlt.IGNORE_AMBIGUITIES;
          } else if (utils_1.has(currAlt, "GATE")) {
            currAltFlat.ignoreAmbiguities = true;
          }
          _this.recordingProdStack.push(currAltFlat);
          currAlt.ALT.call(_this);
          _this.recordingProdStack.pop();
        });
        return RECORDING_NULL_OBJECT;
      }
      function getIdxSuffix(idx) {
        return idx === 0 ? "" : "" + idx;
      }
      function assertMethodIdxIsValid(idx) {
        if (idx < 0 || idx > MAX_METHOD_IDX) {
          var error = new Error(
            // The stack trace will contain all the needed details
            "Invalid DSL Method idx value: <" + idx + ">\n	" + ("Idx value must be a none negative value smaller than " + (MAX_METHOD_IDX + 1))
          );
          error.KNOWN_RECORDER_ERROR = true;
          throw error;
        }
      }
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/traits/perf_tracer.js
  var require_perf_tracer = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/traits/perf_tracer.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.PerformanceTracer = void 0;
      var utils_1 = require_utils();
      var parser_1 = require_parser();
      var PerformanceTracer = (
        /** @class */
        (function() {
          function PerformanceTracer2() {
          }
          PerformanceTracer2.prototype.initPerformanceTracer = function(config) {
            if (utils_1.has(config, "traceInitPerf")) {
              var userTraceInitPerf = config.traceInitPerf;
              var traceIsNumber = typeof userTraceInitPerf === "number";
              this.traceInitMaxIdent = traceIsNumber ? userTraceInitPerf : Infinity;
              this.traceInitPerf = traceIsNumber ? userTraceInitPerf > 0 : userTraceInitPerf;
            } else {
              this.traceInitMaxIdent = 0;
              this.traceInitPerf = parser_1.DEFAULT_PARSER_CONFIG.traceInitPerf;
            }
            this.traceInitIndent = -1;
          };
          PerformanceTracer2.prototype.TRACE_INIT = function(phaseDesc, phaseImpl) {
            if (this.traceInitPerf === true) {
              this.traceInitIndent++;
              var indent = new Array(this.traceInitIndent + 1).join("	");
              if (this.traceInitIndent < this.traceInitMaxIdent) {
                console.log(indent + "--> <" + phaseDesc + ">");
              }
              var _a = utils_1.timer(phaseImpl), time = _a.time, value = _a.value;
              var traceMethod = time > 10 ? console.warn : console.log;
              if (this.traceInitIndent < this.traceInitMaxIdent) {
                traceMethod(indent + "<-- <" + phaseDesc + "> time: " + time + "ms");
              }
              this.traceInitIndent--;
              return value;
            } else {
              return phaseImpl();
            }
          };
          return PerformanceTracer2;
        })()
      );
      exports2.PerformanceTracer = PerformanceTracer;
    }
  });

  // ../../node_modules/chevrotain/lib/src/parse/parser/parser.js
  var require_parser = __commonJS({
    "../../node_modules/chevrotain/lib/src/parse/parser/parser.js"(exports2) {
      "use strict";
      var __extends = exports2 && exports2.__extends || /* @__PURE__ */ (function() {
        var extendStatics = function(d, b) {
          extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d2, b2) {
            d2.__proto__ = b2;
          } || function(d2, b2) {
            for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];
          };
          return extendStatics(d, b);
        };
        return function(d, b) {
          extendStatics(d, b);
          function __() {
            this.constructor = d;
          }
          d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
        };
      })();
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.EmbeddedActionsParser = exports2.CstParser = exports2.Parser = exports2.EMPTY_ALT = exports2.ParserDefinitionErrorType = exports2.DEFAULT_RULE_CONFIG = exports2.DEFAULT_PARSER_CONFIG = exports2.END_OF_FILE = void 0;
      var utils_1 = require_utils();
      var follow_1 = require_follow();
      var tokens_public_1 = require_tokens_public();
      var errors_public_1 = require_errors_public();
      var gast_resolver_public_1 = require_gast_resolver_public();
      var recoverable_1 = require_recoverable();
      var looksahead_1 = require_looksahead();
      var tree_builder_1 = require_tree_builder();
      var lexer_adapter_1 = require_lexer_adapter();
      var recognizer_api_1 = require_recognizer_api();
      var recognizer_engine_1 = require_recognizer_engine();
      var error_handler_1 = require_error_handler();
      var context_assist_1 = require_context_assist();
      var gast_recorder_1 = require_gast_recorder();
      var perf_tracer_1 = require_perf_tracer();
      exports2.END_OF_FILE = tokens_public_1.createTokenInstance(tokens_public_1.EOF, "", NaN, NaN, NaN, NaN, NaN, NaN);
      Object.freeze(exports2.END_OF_FILE);
      exports2.DEFAULT_PARSER_CONFIG = Object.freeze({
        recoveryEnabled: false,
        maxLookahead: 3,
        dynamicTokensEnabled: false,
        outputCst: true,
        errorMessageProvider: errors_public_1.defaultParserErrorProvider,
        nodeLocationTracking: "none",
        traceInitPerf: false,
        skipValidations: false
      });
      exports2.DEFAULT_RULE_CONFIG = Object.freeze({
        recoveryValueFunc: function() {
          return void 0;
        },
        resyncEnabled: true
      });
      var ParserDefinitionErrorType;
      (function(ParserDefinitionErrorType2) {
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["INVALID_RULE_NAME"] = 0] = "INVALID_RULE_NAME";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["DUPLICATE_RULE_NAME"] = 1] = "DUPLICATE_RULE_NAME";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["INVALID_RULE_OVERRIDE"] = 2] = "INVALID_RULE_OVERRIDE";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["DUPLICATE_PRODUCTIONS"] = 3] = "DUPLICATE_PRODUCTIONS";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["UNRESOLVED_SUBRULE_REF"] = 4] = "UNRESOLVED_SUBRULE_REF";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["LEFT_RECURSION"] = 5] = "LEFT_RECURSION";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["NONE_LAST_EMPTY_ALT"] = 6] = "NONE_LAST_EMPTY_ALT";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["AMBIGUOUS_ALTS"] = 7] = "AMBIGUOUS_ALTS";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["CONFLICT_TOKENS_RULES_NAMESPACE"] = 8] = "CONFLICT_TOKENS_RULES_NAMESPACE";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["INVALID_TOKEN_NAME"] = 9] = "INVALID_TOKEN_NAME";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["NO_NON_EMPTY_LOOKAHEAD"] = 10] = "NO_NON_EMPTY_LOOKAHEAD";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["AMBIGUOUS_PREFIX_ALTS"] = 11] = "AMBIGUOUS_PREFIX_ALTS";
        ParserDefinitionErrorType2[ParserDefinitionErrorType2["TOO_MANY_ALTS"] = 12] = "TOO_MANY_ALTS";
      })(ParserDefinitionErrorType = exports2.ParserDefinitionErrorType || (exports2.ParserDefinitionErrorType = {}));
      function EMPTY_ALT(value) {
        if (value === void 0) {
          value = void 0;
        }
        return function() {
          return value;
        };
      }
      exports2.EMPTY_ALT = EMPTY_ALT;
      var Parser = (
        /** @class */
        (function() {
          function Parser2(tokenVocabulary, config) {
            this.definitionErrors = [];
            this.selfAnalysisDone = false;
            var that = this;
            that.initErrorHandler(config);
            that.initLexerAdapter();
            that.initLooksAhead(config);
            that.initRecognizerEngine(tokenVocabulary, config);
            that.initRecoverable(config);
            that.initTreeBuilder(config);
            that.initContentAssist();
            that.initGastRecorder(config);
            that.initPerformanceTracer(config);
            if (utils_1.has(config, "ignoredIssues")) {
              throw new Error("The <ignoredIssues> IParserConfig property has been deprecated.\n	Please use the <IGNORE_AMBIGUITIES> flag on the relevant DSL method instead.\n	See: https://sap.github.io/chevrotain/docs/guide/resolving_grammar_errors.html#IGNORING_AMBIGUITIES\n	For further details.");
            }
            this.skipValidations = utils_1.has(config, "skipValidations") ? config.skipValidations : exports2.DEFAULT_PARSER_CONFIG.skipValidations;
          }
          Parser2.performSelfAnalysis = function(parserInstance) {
            throw Error("The **static** `performSelfAnalysis` method has been deprecated.	\nUse the **instance** method with the same name instead.");
          };
          Parser2.prototype.performSelfAnalysis = function() {
            var _this = this;
            this.TRACE_INIT("performSelfAnalysis", function() {
              var defErrorsMsgs;
              _this.selfAnalysisDone = true;
              var className = _this.className;
              _this.TRACE_INIT("toFastProps", function() {
                utils_1.toFastProperties(_this);
              });
              _this.TRACE_INIT("Grammar Recording", function() {
                try {
                  _this.enableRecording();
                  utils_1.forEach(_this.definedRulesNames, function(currRuleName) {
                    var wrappedRule = _this[currRuleName];
                    var originalGrammarAction = wrappedRule["originalGrammarAction"];
                    var recordedRuleGast = void 0;
                    _this.TRACE_INIT(currRuleName + " Rule", function() {
                      recordedRuleGast = _this.topLevelRuleRecord(currRuleName, originalGrammarAction);
                    });
                    _this.gastProductionsCache[currRuleName] = recordedRuleGast;
                  });
                } finally {
                  _this.disableRecording();
                }
              });
              var resolverErrors = [];
              _this.TRACE_INIT("Grammar Resolving", function() {
                resolverErrors = gast_resolver_public_1.resolveGrammar({
                  rules: utils_1.values(_this.gastProductionsCache)
                });
                _this.definitionErrors.push.apply(_this.definitionErrors, resolverErrors);
              });
              _this.TRACE_INIT("Grammar Validations", function() {
                if (utils_1.isEmpty(resolverErrors) && _this.skipValidations === false) {
                  var validationErrors = gast_resolver_public_1.validateGrammar({
                    rules: utils_1.values(_this.gastProductionsCache),
                    maxLookahead: _this.maxLookahead,
                    tokenTypes: utils_1.values(_this.tokensMap),
                    errMsgProvider: errors_public_1.defaultGrammarValidatorErrorProvider,
                    grammarName: className
                  });
                  _this.definitionErrors.push.apply(_this.definitionErrors, validationErrors);
                }
              });
              if (utils_1.isEmpty(_this.definitionErrors)) {
                if (_this.recoveryEnabled) {
                  _this.TRACE_INIT("computeAllProdsFollows", function() {
                    var allFollows = follow_1.computeAllProdsFollows(utils_1.values(_this.gastProductionsCache));
                    _this.resyncFollows = allFollows;
                  });
                }
                _this.TRACE_INIT("ComputeLookaheadFunctions", function() {
                  _this.preComputeLookaheadFunctions(utils_1.values(_this.gastProductionsCache));
                });
              }
              if (!Parser2.DEFER_DEFINITION_ERRORS_HANDLING && !utils_1.isEmpty(_this.definitionErrors)) {
                defErrorsMsgs = utils_1.map(_this.definitionErrors, function(defError) {
                  return defError.message;
                });
                throw new Error("Parser Definition Errors detected:\n " + defErrorsMsgs.join("\n-------------------------------\n"));
              }
            });
          };
          Parser2.DEFER_DEFINITION_ERRORS_HANDLING = false;
          return Parser2;
        })()
      );
      exports2.Parser = Parser;
      utils_1.applyMixins(Parser, [
        recoverable_1.Recoverable,
        looksahead_1.LooksAhead,
        tree_builder_1.TreeBuilder,
        lexer_adapter_1.LexerAdapter,
        recognizer_engine_1.RecognizerEngine,
        recognizer_api_1.RecognizerApi,
        error_handler_1.ErrorHandler,
        context_assist_1.ContentAssist,
        gast_recorder_1.GastRecorder,
        perf_tracer_1.PerformanceTracer
      ]);
      var CstParser = (
        /** @class */
        (function(_super) {
          __extends(CstParser2, _super);
          function CstParser2(tokenVocabulary, config) {
            if (config === void 0) {
              config = exports2.DEFAULT_PARSER_CONFIG;
            }
            var _this = this;
            var configClone = utils_1.cloneObj(config);
            configClone.outputCst = true;
            _this = _super.call(this, tokenVocabulary, configClone) || this;
            return _this;
          }
          return CstParser2;
        })(Parser)
      );
      exports2.CstParser = CstParser;
      var EmbeddedActionsParser = (
        /** @class */
        (function(_super) {
          __extends(EmbeddedActionsParser2, _super);
          function EmbeddedActionsParser2(tokenVocabulary, config) {
            if (config === void 0) {
              config = exports2.DEFAULT_PARSER_CONFIG;
            }
            var _this = this;
            var configClone = utils_1.cloneObj(config);
            configClone.outputCst = false;
            _this = _super.call(this, tokenVocabulary, configClone) || this;
            return _this;
          }
          return EmbeddedActionsParser2;
        })(Parser)
      );
      exports2.EmbeddedActionsParser = EmbeddedActionsParser;
    }
  });

  // ../../node_modules/chevrotain/lib/src/diagrams/render_public.js
  var require_render_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/diagrams/render_public.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.createSyntaxDiagramsCode = void 0;
      var version_1 = require_version();
      function createSyntaxDiagramsCode(grammar, _a) {
        var _b = _a === void 0 ? {} : _a, _c = _b.resourceBase, resourceBase = _c === void 0 ? "https://unpkg.com/chevrotain@" + version_1.VERSION + "/diagrams/" : _c, _d = _b.css, css = _d === void 0 ? "https://unpkg.com/chevrotain@" + version_1.VERSION + "/diagrams/diagrams.css" : _d;
        var header = '\n<!-- This is a generated file -->\n<!DOCTYPE html>\n<meta charset="utf-8">\n<style>\n  body {\n    background-color: hsl(30, 20%, 95%)\n  }\n</style>\n\n';
        var cssHtml = "\n<link rel='stylesheet' href='" + css + "'>\n";
        var scripts = "\n<script src='" + resourceBase + "vendor/railroad-diagrams.js'><\/script>\n<script src='" + resourceBase + "src/diagrams_builder.js'><\/script>\n<script src='" + resourceBase + "src/diagrams_behavior.js'><\/script>\n<script src='" + resourceBase + "src/main.js'><\/script>\n";
        var diagramsDiv = '\n<div id="diagrams" align="center"></div>    \n';
        var serializedGrammar = "\n<script>\n    window.serializedGrammar = " + JSON.stringify(grammar, null, "  ") + ";\n<\/script>\n";
        var initLogic = '\n<script>\n    var diagramsDiv = document.getElementById("diagrams");\n    main.drawDiagramsFromSerializedGrammar(serializedGrammar, diagramsDiv);\n<\/script>\n';
        return header + cssHtml + scripts + diagramsDiv + serializedGrammar + initLogic;
      }
      exports2.createSyntaxDiagramsCode = createSyntaxDiagramsCode;
    }
  });

  // ../../node_modules/chevrotain/lib/src/generate/generate.js
  var require_generate = __commonJS({
    "../../node_modules/chevrotain/lib/src/generate/generate.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.genSingleAlt = exports2.genAlternation = exports2.genNonTerminal = exports2.genTerminal = exports2.genRule = exports2.genAllRules = exports2.genClass = exports2.genWrapperFunction = exports2.genUmdModule = void 0;
      var utils_1 = require_utils();
      var gast_public_1 = require_gast_public();
      var NL = "\n";
      function genUmdModule(options) {
        return "\n(function (root, factory) {\n    if (typeof define === 'function' && define.amd) {\n        // AMD. Register as an anonymous module.\n        define(['chevrotain'], factory);\n    } else if (typeof module === 'object' && module.exports) {\n        // Node. Does not work with strict CommonJS, but\n        // only CommonJS-like environments that support module.exports,\n        // like Node.\n        module.exports = factory(require('chevrotain'));\n    } else {\n        // Browser globals (root is window)\n        root.returnExports = factory(root.b);\n    }\n}(typeof self !== 'undefined' ? self : this, function (chevrotain) {\n\n" + genClass(options) + "\n    \nreturn {\n    " + options.name + ": " + options.name + " \n}\n}));\n";
      }
      exports2.genUmdModule = genUmdModule;
      function genWrapperFunction(options) {
        return "    \n" + genClass(options) + "\nreturn new " + options.name + "(tokenVocabulary, config)    \n";
      }
      exports2.genWrapperFunction = genWrapperFunction;
      function genClass(options) {
        var result = "\nfunction " + options.name + "(tokenVocabulary, config) {\n    // invoke super constructor\n    // No support for embedded actions currently, so we can 'hardcode'\n    // The use of CstParser.\n    chevrotain.CstParser.call(this, tokenVocabulary, config)\n\n    const $ = this\n\n    " + genAllRules(options.rules) + "\n\n    // very important to call this after all the rules have been defined.\n    // otherwise the parser may not work correctly as it will lack information\n    // derived during the self analysis phase.\n    this.performSelfAnalysis(this)\n}\n\n// inheritance as implemented in javascript in the previous decade... :(\n" + options.name + ".prototype = Object.create(chevrotain.CstParser.prototype)\n" + options.name + ".prototype.constructor = " + options.name + "    \n    ";
        return result;
      }
      exports2.genClass = genClass;
      function genAllRules(rules) {
        var rulesText = utils_1.map(rules, function(currRule) {
          return genRule(currRule, 1);
        });
        return rulesText.join("\n");
      }
      exports2.genAllRules = genAllRules;
      function genRule(prod, n) {
        var result = indent(n, '$.RULE("' + prod.name + '", function() {') + NL;
        result += genDefinition(prod.definition, n + 1);
        result += indent(n + 1, "})") + NL;
        return result;
      }
      exports2.genRule = genRule;
      function genTerminal(prod, n) {
        var name = prod.terminalType.name;
        return indent(n, "$.CONSUME" + prod.idx + "(this.tokensMap." + name + ")" + NL);
      }
      exports2.genTerminal = genTerminal;
      function genNonTerminal(prod, n) {
        return indent(n, "$.SUBRULE" + prod.idx + "($." + prod.nonTerminalName + ")" + NL);
      }
      exports2.genNonTerminal = genNonTerminal;
      function genAlternation(prod, n) {
        var result = indent(n, "$.OR" + prod.idx + "([") + NL;
        var alts = utils_1.map(prod.definition, function(altDef) {
          return genSingleAlt(altDef, n + 1);
        });
        result += alts.join("," + NL);
        result += NL + indent(n, "])" + NL);
        return result;
      }
      exports2.genAlternation = genAlternation;
      function genSingleAlt(prod, n) {
        var result = indent(n, "{") + NL;
        result += indent(n + 1, "ALT: function() {") + NL;
        result += genDefinition(prod.definition, n + 1);
        result += indent(n + 1, "}") + NL;
        result += indent(n, "}");
        return result;
      }
      exports2.genSingleAlt = genSingleAlt;
      function genProd(prod, n) {
        if (prod instanceof gast_public_1.NonTerminal) {
          return genNonTerminal(prod, n);
        } else if (prod instanceof gast_public_1.Option) {
          return genDSLRule("OPTION", prod, n);
        } else if (prod instanceof gast_public_1.RepetitionMandatory) {
          return genDSLRule("AT_LEAST_ONE", prod, n);
        } else if (prod instanceof gast_public_1.RepetitionMandatoryWithSeparator) {
          return genDSLRule("AT_LEAST_ONE_SEP", prod, n);
        } else if (prod instanceof gast_public_1.RepetitionWithSeparator) {
          return genDSLRule("MANY_SEP", prod, n);
        } else if (prod instanceof gast_public_1.Repetition) {
          return genDSLRule("MANY", prod, n);
        } else if (prod instanceof gast_public_1.Alternation) {
          return genAlternation(prod, n);
        } else if (prod instanceof gast_public_1.Terminal) {
          return genTerminal(prod, n);
        } else if (prod instanceof gast_public_1.Alternative) {
          return genDefinition(prod.definition, n);
        } else {
          throw Error("non exhaustive match");
        }
      }
      function genDSLRule(dslName, prod, n) {
        var result = indent(n, "$." + (dslName + prod.idx) + "(");
        if (prod.separator) {
          result += "{" + NL;
          result += indent(n + 1, "SEP: this.tokensMap." + prod.separator.name) + "," + NL;
          result += "DEF: " + genDefFunction(prod.definition, n + 2) + NL;
          result += indent(n, "}") + NL;
        } else {
          result += genDefFunction(prod.definition, n + 1);
        }
        result += indent(n, ")") + NL;
        return result;
      }
      function genDefFunction(definition, n) {
        var def = "function() {" + NL;
        def += genDefinition(definition, n);
        def += indent(n, "}") + NL;
        return def;
      }
      function genDefinition(def, n) {
        var result = "";
        utils_1.forEach(def, function(prod) {
          result += genProd(prod, n + 1);
        });
        return result;
      }
      function indent(howMuch, text) {
        var spaces = Array(howMuch * 4 + 1).join(" ");
        return spaces + text;
      }
    }
  });

  // ../../node_modules/chevrotain/lib/src/generate/generate_public.js
  var require_generate_public = __commonJS({
    "../../node_modules/chevrotain/lib/src/generate/generate_public.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.generateParserModule = exports2.generateParserFactory = void 0;
      var generate_1 = require_generate();
      function generateParserFactory(options) {
        var wrapperText = generate_1.genWrapperFunction({
          name: options.name,
          rules: options.rules
        });
        var constructorWrapper = new Function("tokenVocabulary", "config", "chevrotain", wrapperText);
        return function(config) {
          return constructorWrapper(
            options.tokenVocabulary,
            config,
            // TODO: check how the require is transpiled/webpacked
            require_api()
          );
        };
      }
      exports2.generateParserFactory = generateParserFactory;
      function generateParserModule(options) {
        return generate_1.genUmdModule({ name: options.name, rules: options.rules });
      }
      exports2.generateParserModule = generateParserModule;
    }
  });

  // ../../node_modules/chevrotain/lib/src/api.js
  var require_api = __commonJS({
    "../../node_modules/chevrotain/lib/src/api.js"(exports2) {
      "use strict";
      Object.defineProperty(exports2, "__esModule", { value: true });
      exports2.Parser = exports2.generateParserModule = exports2.generateParserFactory = exports2.createSyntaxDiagramsCode = exports2.clearCache = exports2.validateGrammar = exports2.resolveGrammar = exports2.assignOccurrenceIndices = exports2.GAstVisitor = exports2.serializeProduction = exports2.serializeGrammar = exports2.Terminal = exports2.Rule = exports2.RepetitionWithSeparator = exports2.RepetitionMandatoryWithSeparator = exports2.RepetitionMandatory = exports2.Repetition = exports2.Option = exports2.NonTerminal = exports2.Alternative = exports2.Alternation = exports2.defaultLexerErrorProvider = exports2.NoViableAltException = exports2.NotAllInputParsedException = exports2.MismatchedTokenException = exports2.isRecognitionException = exports2.EarlyExitException = exports2.defaultParserErrorProvider = exports2.defaultGrammarValidatorErrorProvider = exports2.defaultGrammarResolverErrorProvider = exports2.tokenName = exports2.tokenMatcher = exports2.tokenLabel = exports2.EOF = exports2.createTokenInstance = exports2.createToken = exports2.LexerDefinitionErrorType = exports2.Lexer = exports2.EMPTY_ALT = exports2.ParserDefinitionErrorType = exports2.EmbeddedActionsParser = exports2.CstParser = exports2.VERSION = void 0;
      var version_1 = require_version();
      Object.defineProperty(exports2, "VERSION", { enumerable: true, get: function() {
        return version_1.VERSION;
      } });
      var parser_1 = require_parser();
      Object.defineProperty(exports2, "CstParser", { enumerable: true, get: function() {
        return parser_1.CstParser;
      } });
      Object.defineProperty(exports2, "EmbeddedActionsParser", { enumerable: true, get: function() {
        return parser_1.EmbeddedActionsParser;
      } });
      Object.defineProperty(exports2, "ParserDefinitionErrorType", { enumerable: true, get: function() {
        return parser_1.ParserDefinitionErrorType;
      } });
      Object.defineProperty(exports2, "EMPTY_ALT", { enumerable: true, get: function() {
        return parser_1.EMPTY_ALT;
      } });
      var lexer_public_1 = require_lexer_public();
      Object.defineProperty(exports2, "Lexer", { enumerable: true, get: function() {
        return lexer_public_1.Lexer;
      } });
      Object.defineProperty(exports2, "LexerDefinitionErrorType", { enumerable: true, get: function() {
        return lexer_public_1.LexerDefinitionErrorType;
      } });
      var tokens_public_1 = require_tokens_public();
      Object.defineProperty(exports2, "createToken", { enumerable: true, get: function() {
        return tokens_public_1.createToken;
      } });
      Object.defineProperty(exports2, "createTokenInstance", { enumerable: true, get: function() {
        return tokens_public_1.createTokenInstance;
      } });
      Object.defineProperty(exports2, "EOF", { enumerable: true, get: function() {
        return tokens_public_1.EOF;
      } });
      Object.defineProperty(exports2, "tokenLabel", { enumerable: true, get: function() {
        return tokens_public_1.tokenLabel;
      } });
      Object.defineProperty(exports2, "tokenMatcher", { enumerable: true, get: function() {
        return tokens_public_1.tokenMatcher;
      } });
      Object.defineProperty(exports2, "tokenName", { enumerable: true, get: function() {
        return tokens_public_1.tokenName;
      } });
      var errors_public_1 = require_errors_public();
      Object.defineProperty(exports2, "defaultGrammarResolverErrorProvider", { enumerable: true, get: function() {
        return errors_public_1.defaultGrammarResolverErrorProvider;
      } });
      Object.defineProperty(exports2, "defaultGrammarValidatorErrorProvider", { enumerable: true, get: function() {
        return errors_public_1.defaultGrammarValidatorErrorProvider;
      } });
      Object.defineProperty(exports2, "defaultParserErrorProvider", { enumerable: true, get: function() {
        return errors_public_1.defaultParserErrorProvider;
      } });
      var exceptions_public_1 = require_exceptions_public();
      Object.defineProperty(exports2, "EarlyExitException", { enumerable: true, get: function() {
        return exceptions_public_1.EarlyExitException;
      } });
      Object.defineProperty(exports2, "isRecognitionException", { enumerable: true, get: function() {
        return exceptions_public_1.isRecognitionException;
      } });
      Object.defineProperty(exports2, "MismatchedTokenException", { enumerable: true, get: function() {
        return exceptions_public_1.MismatchedTokenException;
      } });
      Object.defineProperty(exports2, "NotAllInputParsedException", { enumerable: true, get: function() {
        return exceptions_public_1.NotAllInputParsedException;
      } });
      Object.defineProperty(exports2, "NoViableAltException", { enumerable: true, get: function() {
        return exceptions_public_1.NoViableAltException;
      } });
      var lexer_errors_public_1 = require_lexer_errors_public();
      Object.defineProperty(exports2, "defaultLexerErrorProvider", { enumerable: true, get: function() {
        return lexer_errors_public_1.defaultLexerErrorProvider;
      } });
      var gast_public_1 = require_gast_public();
      Object.defineProperty(exports2, "Alternation", { enumerable: true, get: function() {
        return gast_public_1.Alternation;
      } });
      Object.defineProperty(exports2, "Alternative", { enumerable: true, get: function() {
        return gast_public_1.Alternative;
      } });
      Object.defineProperty(exports2, "NonTerminal", { enumerable: true, get: function() {
        return gast_public_1.NonTerminal;
      } });
      Object.defineProperty(exports2, "Option", { enumerable: true, get: function() {
        return gast_public_1.Option;
      } });
      Object.defineProperty(exports2, "Repetition", { enumerable: true, get: function() {
        return gast_public_1.Repetition;
      } });
      Object.defineProperty(exports2, "RepetitionMandatory", { enumerable: true, get: function() {
        return gast_public_1.RepetitionMandatory;
      } });
      Object.defineProperty(exports2, "RepetitionMandatoryWithSeparator", { enumerable: true, get: function() {
        return gast_public_1.RepetitionMandatoryWithSeparator;
      } });
      Object.defineProperty(exports2, "RepetitionWithSeparator", { enumerable: true, get: function() {
        return gast_public_1.RepetitionWithSeparator;
      } });
      Object.defineProperty(exports2, "Rule", { enumerable: true, get: function() {
        return gast_public_1.Rule;
      } });
      Object.defineProperty(exports2, "Terminal", { enumerable: true, get: function() {
        return gast_public_1.Terminal;
      } });
      var gast_public_2 = require_gast_public();
      Object.defineProperty(exports2, "serializeGrammar", { enumerable: true, get: function() {
        return gast_public_2.serializeGrammar;
      } });
      Object.defineProperty(exports2, "serializeProduction", { enumerable: true, get: function() {
        return gast_public_2.serializeProduction;
      } });
      var gast_visitor_public_1 = require_gast_visitor_public();
      Object.defineProperty(exports2, "GAstVisitor", { enumerable: true, get: function() {
        return gast_visitor_public_1.GAstVisitor;
      } });
      var gast_resolver_public_1 = require_gast_resolver_public();
      Object.defineProperty(exports2, "assignOccurrenceIndices", { enumerable: true, get: function() {
        return gast_resolver_public_1.assignOccurrenceIndices;
      } });
      Object.defineProperty(exports2, "resolveGrammar", { enumerable: true, get: function() {
        return gast_resolver_public_1.resolveGrammar;
      } });
      Object.defineProperty(exports2, "validateGrammar", { enumerable: true, get: function() {
        return gast_resolver_public_1.validateGrammar;
      } });
      function clearCache() {
        console.warn("The clearCache function was 'soft' removed from the Chevrotain API.\n	 It performs no action other than printing this message.\n	 Please avoid using it as it will be completely removed in the future");
      }
      exports2.clearCache = clearCache;
      var render_public_1 = require_render_public();
      Object.defineProperty(exports2, "createSyntaxDiagramsCode", { enumerable: true, get: function() {
        return render_public_1.createSyntaxDiagramsCode;
      } });
      var generate_public_1 = require_generate_public();
      Object.defineProperty(exports2, "generateParserFactory", { enumerable: true, get: function() {
        return generate_public_1.generateParserFactory;
      } });
      Object.defineProperty(exports2, "generateParserModule", { enumerable: true, get: function() {
        return generate_public_1.generateParserModule;
      } });
      var Parser = (
        /** @class */
        /* @__PURE__ */ (function() {
          function Parser2() {
            throw new Error("The Parser class has been deprecated, use CstParser or EmbeddedActionsParser instead.	\nSee: https://sap.github.io/chevrotain/docs/changes/BREAKING_CHANGES.html#_7-0-0");
          }
          return Parser2;
        })()
      );
      exports2.Parser = Parser;
    }
  });

  // ../../node_modules/@xml-tools/parser/lib/lexer.js
  var require_lexer2 = __commonJS({
    "../../node_modules/@xml-tools/parser/lib/lexer.js"(exports2, module2) {
      var { createToken: createTokenOrg, Lexer } = require_api();
      var fragments = {};
      var f = fragments;
      function FRAGMENT(name, def) {
        fragments[name] = typeof def === "string" ? def : def.source;
      }
      function makePattern(strings, ...args) {
        let combined = "";
        for (let i = 0; i < strings.length; i++) {
          combined += strings[i];
          if (i < args.length) {
            let pattern = args[i];
            combined += `(?:${pattern})`;
          }
        }
        return new RegExp(combined);
      }
      var tokensArray = [];
      var tokensDictionary = {};
      function createToken(options) {
        const newTokenType = createTokenOrg(options);
        tokensArray.push(newTokenType);
        tokensDictionary[options.name] = newTokenType;
        return newTokenType;
      }
      FRAGMENT(
        "NameStartChar",
        "(:|[a-zA-Z]|_|\\u2070-\\u218F|\\u2C00-\\u2FEF|\\u3001-\\uD7FF|\\uF900-\\uFDCF|\\uFDF0-\\uFFFD)"
      );
      FRAGMENT(
        "NameChar",
        makePattern`${f.NameStartChar}|-|\\.|\\d|\\u00B7||[\\u0300-\\u036F]|[\\u203F-\\u2040]`
      );
      FRAGMENT("Name", makePattern`${f.NameStartChar}(${f.NameChar})*`);
      var Comment = createToken({
        name: "Comment",
        pattern: /<!--(.|\r?\n)*?-->/,
        // A Comment may span multiple lines.
        line_breaks: true
      });
      var CData = createToken({
        name: "CData",
        pattern: /<!\[CDATA\[(.|\r?\n)*?]]>/,
        line_breaks: true
      });
      var DocType = createToken({
        name: "DocType",
        pattern: /<!DOCTYPE/,
        push_mode: "INSIDE"
      });
      var IgnoredDTD = createToken({
        name: "DTD",
        pattern: /<!.*?>/,
        group: Lexer.SKIPPED
      });
      var EntityRef = createToken({
        name: "EntityRef",
        pattern: makePattern`&${f.Name};`
      });
      var CharRef = createToken({
        name: "CharRef",
        pattern: /&#\d+;|&#x[a-fA-F0-9]/
      });
      var SEA_WS = createToken({
        name: "SEA_WS",
        pattern: /( |\t|\n|\r\n)+/
      });
      var XMLDeclOpen = createToken({
        name: "XMLDeclOpen",
        pattern: /<\?xml[ \t\r\n]/,
        push_mode: "INSIDE"
      });
      var SLASH_OPEN = createToken({
        name: "SLASH_OPEN",
        pattern: /<\//,
        push_mode: "INSIDE"
      });
      var INVALID_SLASH_OPEN = createToken({
        name: "INVALID_SLASH_OPEN",
        pattern: /<\//,
        categories: [SLASH_OPEN]
      });
      var PROCESSING_INSTRUCTION = createToken({
        name: "PROCESSING_INSTRUCTION",
        pattern: makePattern`<\\?${f.Name}.*\\?>`
      });
      var OPEN = createToken({ name: "OPEN", pattern: /</, push_mode: "INSIDE" });
      var INVALID_OPEN_INSIDE = createToken({
        name: "INVALID_OPEN_INSIDE",
        pattern: /</,
        categories: [OPEN]
      });
      var TEXT = createToken({ name: "TEXT", pattern: /[^<&]+/ });
      var CLOSE = createToken({ name: "CLOSE", pattern: />/, pop_mode: true });
      var SPECIAL_CLOSE = createToken({
        name: "SPECIAL_CLOSE",
        pattern: /\?>/,
        pop_mode: true
      });
      var SLASH_CLOSE = createToken({
        name: "SLASH_CLOSE",
        pattern: /\/>/,
        pop_mode: true
      });
      var SLASH = createToken({ name: "SLASH", pattern: /\// });
      var STRING = createToken({
        name: "STRING",
        pattern: /"[^<"]*"|'[^<']*'/
      });
      var EQUALS = createToken({ name: "EQUALS", pattern: /=/ });
      var Name = createToken({ name: "Name", pattern: makePattern`${f.Name}` });
      var S = createToken({
        name: "S",
        pattern: /[ \t\r\n]/,
        group: Lexer.SKIPPED
      });
      var xmlLexerDefinition = {
        defaultMode: "OUTSIDE",
        modes: {
          OUTSIDE: [
            Comment,
            CData,
            DocType,
            IgnoredDTD,
            EntityRef,
            CharRef,
            SEA_WS,
            XMLDeclOpen,
            SLASH_OPEN,
            PROCESSING_INSTRUCTION,
            OPEN,
            TEXT
          ],
          INSIDE: [
            // Tokens from `OUTSIDE` to improve error recovery behavior
            Comment,
            INVALID_SLASH_OPEN,
            INVALID_OPEN_INSIDE,
            // "Real" `INSIDE` tokens
            CLOSE,
            SPECIAL_CLOSE,
            SLASH_CLOSE,
            SLASH,
            EQUALS,
            STRING,
            Name,
            S
          ]
        }
      };
      var xmlLexer = new Lexer(xmlLexerDefinition, {
        // Reducing the amount of position tracking can provide a small performance boost (<10%)
        // Likely best to keep the full info for better error position reporting and
        // to expose "fuller" ITokens from the Lexer.
        positionTracking: "full",
        ensureOptimizations: false,
        // TODO: inspect definitions for XML line terminators
        lineTerminatorCharacters: ["\n"],
        lineTerminatorsPattern: /\n|\r\n/g
      });
      module2.exports = {
        xmlLexer,
        tokensDictionary
      };
    }
  });

  // ../../node_modules/@xml-tools/parser/lib/parser.js
  var require_parser2 = __commonJS({
    "../../node_modules/@xml-tools/parser/lib/parser.js"(exports2, module2) {
      var { CstParser, tokenMatcher } = require_api();
      var { tokensDictionary: t } = require_lexer2();
      var Parser = class extends CstParser {
        constructor() {
          super(t, {
            maxLookahead: 1,
            recoveryEnabled: true,
            nodeLocationTracking: "full"
          });
          this.deletionRecoveryEnabled = true;
          const $ = this;
          $.RULE("document", () => {
            $.OPTION(() => {
              $.SUBRULE($.prolog);
            });
            $.MANY(() => {
              $.SUBRULE($.misc);
            });
            $.OPTION2(() => {
              $.SUBRULE($.docTypeDecl);
            });
            $.MANY2(() => {
              $.SUBRULE2($.misc);
            });
            $.SUBRULE($.element);
            $.MANY3(() => {
              $.SUBRULE3($.misc);
            });
          });
          $.RULE("prolog", () => {
            $.CONSUME(t.XMLDeclOpen);
            $.MANY(() => {
              $.SUBRULE($.attribute);
            });
            $.CONSUME(t.SPECIAL_CLOSE);
          });
          $.RULE("docTypeDecl", () => {
            $.CONSUME(t.DocType);
            $.CONSUME(t.Name);
            $.OPTION(() => {
              $.SUBRULE($.externalID);
            });
            $.CONSUME(t.CLOSE);
          });
          $.RULE("externalID", () => {
            $.OR([
              {
                GATE: () => $.LA(1).image === "SYSTEM",
                ALT: () => {
                  $.CONSUME2(t.Name, { LABEL: "System" });
                  $.CONSUME(t.STRING, { LABEL: "SystemLiteral" });
                }
              },
              {
                GATE: () => $.LA(1).image === "PUBLIC",
                ALT: () => {
                  $.CONSUME3(t.Name, { LABEL: "Public" });
                  $.CONSUME2(t.STRING, { LABEL: "PubIDLiteral" });
                  $.CONSUME3(t.STRING, { LABEL: "SystemLiteral" });
                }
              }
            ]);
          });
          $.RULE("content", () => {
            $.MANY(() => {
              $.OR([
                { ALT: () => $.SUBRULE($.element) },
                { ALT: () => $.SUBRULE($.chardata) },
                { ALT: () => $.SUBRULE($.reference) },
                { ALT: () => $.CONSUME(t.CData) },
                { ALT: () => $.CONSUME(t.PROCESSING_INSTRUCTION) },
                { ALT: () => $.CONSUME(t.Comment) }
              ]);
            });
          });
          $.RULE("element", () => {
            $.CONSUME(t.OPEN);
            try {
              this.deletionRecoveryEnabled = false;
              $.CONSUME(t.Name);
            } finally {
              this.deletionRecoveryEnabled = true;
            }
            $.MANY(() => {
              $.SUBRULE($.attribute);
            });
            $.OR([
              {
                ALT: () => {
                  $.CONSUME(t.CLOSE, { LABEL: "START_CLOSE" });
                  $.SUBRULE($.content);
                  $.CONSUME(t.SLASH_OPEN);
                  $.CONSUME2(t.Name, { LABEL: "END_NAME" });
                  $.CONSUME2(t.CLOSE, { LABEL: "END" });
                }
              },
              {
                ALT: () => {
                  $.CONSUME(t.SLASH_CLOSE);
                }
              }
            ]);
          });
          $.RULE("reference", () => {
            $.OR([
              { ALT: () => $.CONSUME(t.EntityRef) },
              { ALT: () => $.CONSUME(t.CharRef) }
            ]);
          });
          $.RULE("attribute", () => {
            $.CONSUME(t.Name);
            try {
              this.deletionRecoveryEnabled = false;
              $.CONSUME(t.EQUALS);
              $.CONSUME(t.STRING);
            } finally {
              this.deletionRecoveryEnabled = true;
            }
          });
          $.RULE("chardata", () => {
            $.OR([
              { ALT: () => $.CONSUME(t.TEXT) },
              { ALT: () => $.CONSUME(t.SEA_WS) }
            ]);
          });
          $.RULE("misc", () => {
            $.OR([
              { ALT: () => $.CONSUME(t.Comment) },
              { ALT: () => $.CONSUME(t.PROCESSING_INSTRUCTION) },
              { ALT: () => $.CONSUME(t.SEA_WS) }
            ]);
          });
          this.performSelfAnalysis();
        }
        canRecoverWithSingleTokenDeletion(expectedTokType) {
          if (this.deletionRecoveryEnabled === false) {
            return false;
          }
          return super.canRecoverWithSingleTokenDeletion(expectedTokType);
        }
        // TODO: provide this fix upstream to chevrotain
        // https://github.com/SAP/chevrotain/issues/1055
        /* istanbul ignore next - should be tested as part of Chevrotain */
        findReSyncTokenType() {
          const allPossibleReSyncTokTypes = this.flattenFollowSet();
          let nextToken = this.LA(1);
          let k = 2;
          while (true) {
            const foundMatch = allPossibleReSyncTokTypes.find((resyncTokType) => {
              const canMatch = tokenMatcher(nextToken, resyncTokType);
              return canMatch;
            });
            if (foundMatch !== void 0) {
              return foundMatch;
            }
            nextToken = this.LA(k);
            k++;
          }
        }
      };
      var xmlParser = new Parser();
      module2.exports = {
        xmlParser
      };
    }
  });

  // ../../node_modules/@xml-tools/parser/lib/api.js
  var require_api2 = __commonJS({
    "../../node_modules/@xml-tools/parser/lib/api.js"(exports2, module2) {
      var { xmlLexer } = require_lexer2();
      var { xmlParser } = require_parser2();
      module2.exports = {
        parse: function parse2(text) {
          const lexResult = xmlLexer.tokenize(text);
          xmlParser.input = lexResult.tokens;
          const cst = xmlParser.document();
          return {
            cst,
            tokenVector: lexResult.tokens,
            lexErrors: lexResult.errors,
            parseErrors: xmlParser.errors
          };
        },
        BaseXmlCstVisitor: xmlParser.getBaseCstVisitorConstructor()
      };
    }
  });

  // ../../node_modules/lodash/lodash.js
  var require_lodash = __commonJS({
    "../../node_modules/lodash/lodash.js"(exports2, module2) {
      (function() {
        var undefined2;
        var VERSION = "4.17.21";
        var LARGE_ARRAY_SIZE = 200;
        var CORE_ERROR_TEXT = "Unsupported core-js use. Try https://npms.io/search?q=ponyfill.", FUNC_ERROR_TEXT = "Expected a function", INVALID_TEMPL_VAR_ERROR_TEXT = "Invalid `variable` option passed into `_.template`";
        var HASH_UNDEFINED = "__lodash_hash_undefined__";
        var MAX_MEMOIZE_SIZE = 500;
        var PLACEHOLDER = "__lodash_placeholder__";
        var CLONE_DEEP_FLAG = 1, CLONE_FLAT_FLAG = 2, CLONE_SYMBOLS_FLAG = 4;
        var COMPARE_PARTIAL_FLAG = 1, COMPARE_UNORDERED_FLAG = 2;
        var WRAP_BIND_FLAG = 1, WRAP_BIND_KEY_FLAG = 2, WRAP_CURRY_BOUND_FLAG = 4, WRAP_CURRY_FLAG = 8, WRAP_CURRY_RIGHT_FLAG = 16, WRAP_PARTIAL_FLAG = 32, WRAP_PARTIAL_RIGHT_FLAG = 64, WRAP_ARY_FLAG = 128, WRAP_REARG_FLAG = 256, WRAP_FLIP_FLAG = 512;
        var DEFAULT_TRUNC_LENGTH = 30, DEFAULT_TRUNC_OMISSION = "...";
        var HOT_COUNT = 800, HOT_SPAN = 16;
        var LAZY_FILTER_FLAG = 1, LAZY_MAP_FLAG = 2, LAZY_WHILE_FLAG = 3;
        var INFINITY = 1 / 0, MAX_SAFE_INTEGER = 9007199254740991, MAX_INTEGER = 17976931348623157e292, NAN = 0 / 0;
        var MAX_ARRAY_LENGTH = 4294967295, MAX_ARRAY_INDEX = MAX_ARRAY_LENGTH - 1, HALF_MAX_ARRAY_LENGTH = MAX_ARRAY_LENGTH >>> 1;
        var wrapFlags = [
          ["ary", WRAP_ARY_FLAG],
          ["bind", WRAP_BIND_FLAG],
          ["bindKey", WRAP_BIND_KEY_FLAG],
          ["curry", WRAP_CURRY_FLAG],
          ["curryRight", WRAP_CURRY_RIGHT_FLAG],
          ["flip", WRAP_FLIP_FLAG],
          ["partial", WRAP_PARTIAL_FLAG],
          ["partialRight", WRAP_PARTIAL_RIGHT_FLAG],
          ["rearg", WRAP_REARG_FLAG]
        ];
        var argsTag = "[object Arguments]", arrayTag = "[object Array]", asyncTag = "[object AsyncFunction]", boolTag = "[object Boolean]", dateTag = "[object Date]", domExcTag = "[object DOMException]", errorTag = "[object Error]", funcTag = "[object Function]", genTag = "[object GeneratorFunction]", mapTag = "[object Map]", numberTag = "[object Number]", nullTag = "[object Null]", objectTag = "[object Object]", promiseTag = "[object Promise]", proxyTag = "[object Proxy]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", symbolTag = "[object Symbol]", undefinedTag = "[object Undefined]", weakMapTag = "[object WeakMap]", weakSetTag = "[object WeakSet]";
        var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]", float32Tag = "[object Float32Array]", float64Tag = "[object Float64Array]", int8Tag = "[object Int8Array]", int16Tag = "[object Int16Array]", int32Tag = "[object Int32Array]", uint8Tag = "[object Uint8Array]", uint8ClampedTag = "[object Uint8ClampedArray]", uint16Tag = "[object Uint16Array]", uint32Tag = "[object Uint32Array]";
        var reEmptyStringLeading = /\b__p \+= '';/g, reEmptyStringMiddle = /\b(__p \+=) '' \+/g, reEmptyStringTrailing = /(__e\(.*?\)|\b__t\)) \+\n'';/g;
        var reEscapedHtml = /&(?:amp|lt|gt|quot|#39);/g, reUnescapedHtml = /[&<>"']/g, reHasEscapedHtml = RegExp(reEscapedHtml.source), reHasUnescapedHtml = RegExp(reUnescapedHtml.source);
        var reEscape = /<%-([\s\S]+?)%>/g, reEvaluate = /<%([\s\S]+?)%>/g, reInterpolate = /<%=([\s\S]+?)%>/g;
        var reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/, reIsPlainProp = /^\w*$/, rePropName = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;
        var reRegExpChar = /[\\^$.*+?()[\]{}|]/g, reHasRegExpChar = RegExp(reRegExpChar.source);
        var reTrimStart = /^\s+/;
        var reWhitespace = /\s/;
        var reWrapComment = /\{(?:\n\/\* \[wrapped with .+\] \*\/)?\n?/, reWrapDetails = /\{\n\/\* \[wrapped with (.+)\] \*/, reSplitDetails = /,? & /;
        var reAsciiWord = /[^\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g;
        var reForbiddenIdentifierChars = /[()=,{}\[\]\/\s]/;
        var reEscapeChar = /\\(\\)?/g;
        var reEsTemplate = /\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g;
        var reFlags = /\w*$/;
        var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
        var reIsBinary = /^0b[01]+$/i;
        var reIsHostCtor = /^\[object .+?Constructor\]$/;
        var reIsOctal = /^0o[0-7]+$/i;
        var reIsUint = /^(?:0|[1-9]\d*)$/;
        var reLatin = /[\xc0-\xd6\xd8-\xf6\xf8-\xff\u0100-\u017f]/g;
        var reNoMatch = /($^)/;
        var reUnescapedString = /['\n\r\u2028\u2029\\]/g;
        var rsAstralRange = "\\ud800-\\udfff", rsComboMarksRange = "\\u0300-\\u036f", reComboHalfMarksRange = "\\ufe20-\\ufe2f", rsComboSymbolsRange = "\\u20d0-\\u20ff", rsComboRange = rsComboMarksRange + reComboHalfMarksRange + rsComboSymbolsRange, rsDingbatRange = "\\u2700-\\u27bf", rsLowerRange = "a-z\\xdf-\\xf6\\xf8-\\xff", rsMathOpRange = "\\xac\\xb1\\xd7\\xf7", rsNonCharRange = "\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf", rsPunctuationRange = "\\u2000-\\u206f", rsSpaceRange = " \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000", rsUpperRange = "A-Z\\xc0-\\xd6\\xd8-\\xde", rsVarRange = "\\ufe0e\\ufe0f", rsBreakRange = rsMathOpRange + rsNonCharRange + rsPunctuationRange + rsSpaceRange;
        var rsApos = "['\u2019]", rsAstral = "[" + rsAstralRange + "]", rsBreak = "[" + rsBreakRange + "]", rsCombo = "[" + rsComboRange + "]", rsDigits = "\\d+", rsDingbat = "[" + rsDingbatRange + "]", rsLower = "[" + rsLowerRange + "]", rsMisc = "[^" + rsAstralRange + rsBreakRange + rsDigits + rsDingbatRange + rsLowerRange + rsUpperRange + "]", rsFitz = "\\ud83c[\\udffb-\\udfff]", rsModifier = "(?:" + rsCombo + "|" + rsFitz + ")", rsNonAstral = "[^" + rsAstralRange + "]", rsRegional = "(?:\\ud83c[\\udde6-\\uddff]){2}", rsSurrPair = "[\\ud800-\\udbff][\\udc00-\\udfff]", rsUpper = "[" + rsUpperRange + "]", rsZWJ = "\\u200d";
        var rsMiscLower = "(?:" + rsLower + "|" + rsMisc + ")", rsMiscUpper = "(?:" + rsUpper + "|" + rsMisc + ")", rsOptContrLower = "(?:" + rsApos + "(?:d|ll|m|re|s|t|ve))?", rsOptContrUpper = "(?:" + rsApos + "(?:D|LL|M|RE|S|T|VE))?", reOptMod = rsModifier + "?", rsOptVar = "[" + rsVarRange + "]?", rsOptJoin = "(?:" + rsZWJ + "(?:" + [rsNonAstral, rsRegional, rsSurrPair].join("|") + ")" + rsOptVar + reOptMod + ")*", rsOrdLower = "\\d*(?:1st|2nd|3rd|(?![123])\\dth)(?=\\b|[A-Z_])", rsOrdUpper = "\\d*(?:1ST|2ND|3RD|(?![123])\\dTH)(?=\\b|[a-z_])", rsSeq = rsOptVar + reOptMod + rsOptJoin, rsEmoji = "(?:" + [rsDingbat, rsRegional, rsSurrPair].join("|") + ")" + rsSeq, rsSymbol = "(?:" + [rsNonAstral + rsCombo + "?", rsCombo, rsRegional, rsSurrPair, rsAstral].join("|") + ")";
        var reApos = RegExp(rsApos, "g");
        var reComboMark = RegExp(rsCombo, "g");
        var reUnicode = RegExp(rsFitz + "(?=" + rsFitz + ")|" + rsSymbol + rsSeq, "g");
        var reUnicodeWord = RegExp([
          rsUpper + "?" + rsLower + "+" + rsOptContrLower + "(?=" + [rsBreak, rsUpper, "$"].join("|") + ")",
          rsMiscUpper + "+" + rsOptContrUpper + "(?=" + [rsBreak, rsUpper + rsMiscLower, "$"].join("|") + ")",
          rsUpper + "?" + rsMiscLower + "+" + rsOptContrLower,
          rsUpper + "+" + rsOptContrUpper,
          rsOrdUpper,
          rsOrdLower,
          rsDigits,
          rsEmoji
        ].join("|"), "g");
        var reHasUnicode = RegExp("[" + rsZWJ + rsAstralRange + rsComboRange + rsVarRange + "]");
        var reHasUnicodeWord = /[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/;
        var contextProps = [
          "Array",
          "Buffer",
          "DataView",
          "Date",
          "Error",
          "Float32Array",
          "Float64Array",
          "Function",
          "Int8Array",
          "Int16Array",
          "Int32Array",
          "Map",
          "Math",
          "Object",
          "Promise",
          "RegExp",
          "Set",
          "String",
          "Symbol",
          "TypeError",
          "Uint8Array",
          "Uint8ClampedArray",
          "Uint16Array",
          "Uint32Array",
          "WeakMap",
          "_",
          "clearTimeout",
          "isFinite",
          "parseInt",
          "setTimeout"
        ];
        var templateCounter = -1;
        var typedArrayTags = {};
        typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
        typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dataViewTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
        var cloneableTags = {};
        cloneableTags[argsTag] = cloneableTags[arrayTag] = cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] = cloneableTags[boolTag] = cloneableTags[dateTag] = cloneableTags[float32Tag] = cloneableTags[float64Tag] = cloneableTags[int8Tag] = cloneableTags[int16Tag] = cloneableTags[int32Tag] = cloneableTags[mapTag] = cloneableTags[numberTag] = cloneableTags[objectTag] = cloneableTags[regexpTag] = cloneableTags[setTag] = cloneableTags[stringTag] = cloneableTags[symbolTag] = cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] = cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
        cloneableTags[errorTag] = cloneableTags[funcTag] = cloneableTags[weakMapTag] = false;
        var deburredLetters = {
          // Latin-1 Supplement block.
          "\xC0": "A",
          "\xC1": "A",
          "\xC2": "A",
          "\xC3": "A",
          "\xC4": "A",
          "\xC5": "A",
          "\xE0": "a",
          "\xE1": "a",
          "\xE2": "a",
          "\xE3": "a",
          "\xE4": "a",
          "\xE5": "a",
          "\xC7": "C",
          "\xE7": "c",
          "\xD0": "D",
          "\xF0": "d",
          "\xC8": "E",
          "\xC9": "E",
          "\xCA": "E",
          "\xCB": "E",
          "\xE8": "e",
          "\xE9": "e",
          "\xEA": "e",
          "\xEB": "e",
          "\xCC": "I",
          "\xCD": "I",
          "\xCE": "I",
          "\xCF": "I",
          "\xEC": "i",
          "\xED": "i",
          "\xEE": "i",
          "\xEF": "i",
          "\xD1": "N",
          "\xF1": "n",
          "\xD2": "O",
          "\xD3": "O",
          "\xD4": "O",
          "\xD5": "O",
          "\xD6": "O",
          "\xD8": "O",
          "\xF2": "o",
          "\xF3": "o",
          "\xF4": "o",
          "\xF5": "o",
          "\xF6": "o",
          "\xF8": "o",
          "\xD9": "U",
          "\xDA": "U",
          "\xDB": "U",
          "\xDC": "U",
          "\xF9": "u",
          "\xFA": "u",
          "\xFB": "u",
          "\xFC": "u",
          "\xDD": "Y",
          "\xFD": "y",
          "\xFF": "y",
          "\xC6": "Ae",
          "\xE6": "ae",
          "\xDE": "Th",
          "\xFE": "th",
          "\xDF": "ss",
          // Latin Extended-A block.
          "\u0100": "A",
          "\u0102": "A",
          "\u0104": "A",
          "\u0101": "a",
          "\u0103": "a",
          "\u0105": "a",
          "\u0106": "C",
          "\u0108": "C",
          "\u010A": "C",
          "\u010C": "C",
          "\u0107": "c",
          "\u0109": "c",
          "\u010B": "c",
          "\u010D": "c",
          "\u010E": "D",
          "\u0110": "D",
          "\u010F": "d",
          "\u0111": "d",
          "\u0112": "E",
          "\u0114": "E",
          "\u0116": "E",
          "\u0118": "E",
          "\u011A": "E",
          "\u0113": "e",
          "\u0115": "e",
          "\u0117": "e",
          "\u0119": "e",
          "\u011B": "e",
          "\u011C": "G",
          "\u011E": "G",
          "\u0120": "G",
          "\u0122": "G",
          "\u011D": "g",
          "\u011F": "g",
          "\u0121": "g",
          "\u0123": "g",
          "\u0124": "H",
          "\u0126": "H",
          "\u0125": "h",
          "\u0127": "h",
          "\u0128": "I",
          "\u012A": "I",
          "\u012C": "I",
          "\u012E": "I",
          "\u0130": "I",
          "\u0129": "i",
          "\u012B": "i",
          "\u012D": "i",
          "\u012F": "i",
          "\u0131": "i",
          "\u0134": "J",
          "\u0135": "j",
          "\u0136": "K",
          "\u0137": "k",
          "\u0138": "k",
          "\u0139": "L",
          "\u013B": "L",
          "\u013D": "L",
          "\u013F": "L",
          "\u0141": "L",
          "\u013A": "l",
          "\u013C": "l",
          "\u013E": "l",
          "\u0140": "l",
          "\u0142": "l",
          "\u0143": "N",
          "\u0145": "N",
          "\u0147": "N",
          "\u014A": "N",
          "\u0144": "n",
          "\u0146": "n",
          "\u0148": "n",
          "\u014B": "n",
          "\u014C": "O",
          "\u014E": "O",
          "\u0150": "O",
          "\u014D": "o",
          "\u014F": "o",
          "\u0151": "o",
          "\u0154": "R",
          "\u0156": "R",
          "\u0158": "R",
          "\u0155": "r",
          "\u0157": "r",
          "\u0159": "r",
          "\u015A": "S",
          "\u015C": "S",
          "\u015E": "S",
          "\u0160": "S",
          "\u015B": "s",
          "\u015D": "s",
          "\u015F": "s",
          "\u0161": "s",
          "\u0162": "T",
          "\u0164": "T",
          "\u0166": "T",
          "\u0163": "t",
          "\u0165": "t",
          "\u0167": "t",
          "\u0168": "U",
          "\u016A": "U",
          "\u016C": "U",
          "\u016E": "U",
          "\u0170": "U",
          "\u0172": "U",
          "\u0169": "u",
          "\u016B": "u",
          "\u016D": "u",
          "\u016F": "u",
          "\u0171": "u",
          "\u0173": "u",
          "\u0174": "W",
          "\u0175": "w",
          "\u0176": "Y",
          "\u0177": "y",
          "\u0178": "Y",
          "\u0179": "Z",
          "\u017B": "Z",
          "\u017D": "Z",
          "\u017A": "z",
          "\u017C": "z",
          "\u017E": "z",
          "\u0132": "IJ",
          "\u0133": "ij",
          "\u0152": "Oe",
          "\u0153": "oe",
          "\u0149": "'n",
          "\u017F": "s"
        };
        var htmlEscapes = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        };
        var htmlUnescapes = {
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&#39;": "'"
        };
        var stringEscapes = {
          "\\": "\\",
          "'": "'",
          "\n": "n",
          "\r": "r",
          "\u2028": "u2028",
          "\u2029": "u2029"
        };
        var freeParseFloat = parseFloat, freeParseInt = parseInt;
        var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
        var freeSelf = typeof self == "object" && self && self.Object === Object && self;
        var root = freeGlobal || freeSelf || Function("return this")();
        var freeExports = typeof exports2 == "object" && exports2 && !exports2.nodeType && exports2;
        var freeModule = freeExports && typeof module2 == "object" && module2 && !module2.nodeType && module2;
        var moduleExports = freeModule && freeModule.exports === freeExports;
        var freeProcess = moduleExports && freeGlobal.process;
        var nodeUtil = (function() {
          try {
            var types = freeModule && freeModule.require && freeModule.require("util").types;
            if (types) {
              return types;
            }
            return freeProcess && freeProcess.binding && freeProcess.binding("util");
          } catch (e) {
          }
        })();
        var nodeIsArrayBuffer = nodeUtil && nodeUtil.isArrayBuffer, nodeIsDate = nodeUtil && nodeUtil.isDate, nodeIsMap = nodeUtil && nodeUtil.isMap, nodeIsRegExp = nodeUtil && nodeUtil.isRegExp, nodeIsSet = nodeUtil && nodeUtil.isSet, nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;
        function apply(func, thisArg, args) {
          switch (args.length) {
            case 0:
              return func.call(thisArg);
            case 1:
              return func.call(thisArg, args[0]);
            case 2:
              return func.call(thisArg, args[0], args[1]);
            case 3:
              return func.call(thisArg, args[0], args[1], args[2]);
          }
          return func.apply(thisArg, args);
        }
        function arrayAggregator(array, setter, iteratee, accumulator) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            var value = array[index];
            setter(accumulator, value, iteratee(value), array);
          }
          return accumulator;
        }
        function arrayEach(array, iteratee) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            if (iteratee(array[index], index, array) === false) {
              break;
            }
          }
          return array;
        }
        function arrayEachRight(array, iteratee) {
          var length = array == null ? 0 : array.length;
          while (length--) {
            if (iteratee(array[length], length, array) === false) {
              break;
            }
          }
          return array;
        }
        function arrayEvery(array, predicate) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            if (!predicate(array[index], index, array)) {
              return false;
            }
          }
          return true;
        }
        function arrayFilter(array, predicate) {
          var index = -1, length = array == null ? 0 : array.length, resIndex = 0, result = [];
          while (++index < length) {
            var value = array[index];
            if (predicate(value, index, array)) {
              result[resIndex++] = value;
            }
          }
          return result;
        }
        function arrayIncludes(array, value) {
          var length = array == null ? 0 : array.length;
          return !!length && baseIndexOf(array, value, 0) > -1;
        }
        function arrayIncludesWith(array, value, comparator) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            if (comparator(value, array[index])) {
              return true;
            }
          }
          return false;
        }
        function arrayMap(array, iteratee) {
          var index = -1, length = array == null ? 0 : array.length, result = Array(length);
          while (++index < length) {
            result[index] = iteratee(array[index], index, array);
          }
          return result;
        }
        function arrayPush(array, values2) {
          var index = -1, length = values2.length, offset = array.length;
          while (++index < length) {
            array[offset + index] = values2[index];
          }
          return array;
        }
        function arrayReduce(array, iteratee, accumulator, initAccum) {
          var index = -1, length = array == null ? 0 : array.length;
          if (initAccum && length) {
            accumulator = array[++index];
          }
          while (++index < length) {
            accumulator = iteratee(accumulator, array[index], index, array);
          }
          return accumulator;
        }
        function arrayReduceRight(array, iteratee, accumulator, initAccum) {
          var length = array == null ? 0 : array.length;
          if (initAccum && length) {
            accumulator = array[--length];
          }
          while (length--) {
            accumulator = iteratee(accumulator, array[length], length, array);
          }
          return accumulator;
        }
        function arraySome(array, predicate) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            if (predicate(array[index], index, array)) {
              return true;
            }
          }
          return false;
        }
        var asciiSize = baseProperty("length");
        function asciiToArray(string) {
          return string.split("");
        }
        function asciiWords(string) {
          return string.match(reAsciiWord) || [];
        }
        function baseFindKey(collection, predicate, eachFunc) {
          var result;
          eachFunc(collection, function(value, key, collection2) {
            if (predicate(value, key, collection2)) {
              result = key;
              return false;
            }
          });
          return result;
        }
        function baseFindIndex(array, predicate, fromIndex, fromRight) {
          var length = array.length, index = fromIndex + (fromRight ? 1 : -1);
          while (fromRight ? index-- : ++index < length) {
            if (predicate(array[index], index, array)) {
              return index;
            }
          }
          return -1;
        }
        function baseIndexOf(array, value, fromIndex) {
          return value === value ? strictIndexOf(array, value, fromIndex) : baseFindIndex(array, baseIsNaN, fromIndex);
        }
        function baseIndexOfWith(array, value, fromIndex, comparator) {
          var index = fromIndex - 1, length = array.length;
          while (++index < length) {
            if (comparator(array[index], value)) {
              return index;
            }
          }
          return -1;
        }
        function baseIsNaN(value) {
          return value !== value;
        }
        function baseMean(array, iteratee) {
          var length = array == null ? 0 : array.length;
          return length ? baseSum(array, iteratee) / length : NAN;
        }
        function baseProperty(key) {
          return function(object) {
            return object == null ? undefined2 : object[key];
          };
        }
        function basePropertyOf(object) {
          return function(key) {
            return object == null ? undefined2 : object[key];
          };
        }
        function baseReduce(collection, iteratee, accumulator, initAccum, eachFunc) {
          eachFunc(collection, function(value, index, collection2) {
            accumulator = initAccum ? (initAccum = false, value) : iteratee(accumulator, value, index, collection2);
          });
          return accumulator;
        }
        function baseSortBy(array, comparer) {
          var length = array.length;
          array.sort(comparer);
          while (length--) {
            array[length] = array[length].value;
          }
          return array;
        }
        function baseSum(array, iteratee) {
          var result, index = -1, length = array.length;
          while (++index < length) {
            var current = iteratee(array[index]);
            if (current !== undefined2) {
              result = result === undefined2 ? current : result + current;
            }
          }
          return result;
        }
        function baseTimes(n, iteratee) {
          var index = -1, result = Array(n);
          while (++index < n) {
            result[index] = iteratee(index);
          }
          return result;
        }
        function baseToPairs(object, props) {
          return arrayMap(props, function(key) {
            return [key, object[key]];
          });
        }
        function baseTrim(string) {
          return string ? string.slice(0, trimmedEndIndex(string) + 1).replace(reTrimStart, "") : string;
        }
        function baseUnary(func) {
          return function(value) {
            return func(value);
          };
        }
        function baseValues(object, props) {
          return arrayMap(props, function(key) {
            return object[key];
          });
        }
        function cacheHas(cache, key) {
          return cache.has(key);
        }
        function charsStartIndex(strSymbols, chrSymbols) {
          var index = -1, length = strSymbols.length;
          while (++index < length && baseIndexOf(chrSymbols, strSymbols[index], 0) > -1) {
          }
          return index;
        }
        function charsEndIndex(strSymbols, chrSymbols) {
          var index = strSymbols.length;
          while (index-- && baseIndexOf(chrSymbols, strSymbols[index], 0) > -1) {
          }
          return index;
        }
        function countHolders(array, placeholder) {
          var length = array.length, result = 0;
          while (length--) {
            if (array[length] === placeholder) {
              ++result;
            }
          }
          return result;
        }
        var deburrLetter = basePropertyOf(deburredLetters);
        var escapeHtmlChar = basePropertyOf(htmlEscapes);
        function escapeStringChar(chr) {
          return "\\" + stringEscapes[chr];
        }
        function getValue(object, key) {
          return object == null ? undefined2 : object[key];
        }
        function hasUnicode(string) {
          return reHasUnicode.test(string);
        }
        function hasUnicodeWord(string) {
          return reHasUnicodeWord.test(string);
        }
        function iteratorToArray(iterator) {
          var data, result = [];
          while (!(data = iterator.next()).done) {
            result.push(data.value);
          }
          return result;
        }
        function mapToArray(map2) {
          var index = -1, result = Array(map2.size);
          map2.forEach(function(value, key) {
            result[++index] = [key, value];
          });
          return result;
        }
        function overArg(func, transform) {
          return function(arg) {
            return func(transform(arg));
          };
        }
        function replaceHolders(array, placeholder) {
          var index = -1, length = array.length, resIndex = 0, result = [];
          while (++index < length) {
            var value = array[index];
            if (value === placeholder || value === PLACEHOLDER) {
              array[index] = PLACEHOLDER;
              result[resIndex++] = index;
            }
          }
          return result;
        }
        function setToArray(set) {
          var index = -1, result = Array(set.size);
          set.forEach(function(value) {
            result[++index] = value;
          });
          return result;
        }
        function setToPairs(set) {
          var index = -1, result = Array(set.size);
          set.forEach(function(value) {
            result[++index] = [value, value];
          });
          return result;
        }
        function strictIndexOf(array, value, fromIndex) {
          var index = fromIndex - 1, length = array.length;
          while (++index < length) {
            if (array[index] === value) {
              return index;
            }
          }
          return -1;
        }
        function strictLastIndexOf(array, value, fromIndex) {
          var index = fromIndex + 1;
          while (index--) {
            if (array[index] === value) {
              return index;
            }
          }
          return index;
        }
        function stringSize(string) {
          return hasUnicode(string) ? unicodeSize(string) : asciiSize(string);
        }
        function stringToArray(string) {
          return hasUnicode(string) ? unicodeToArray(string) : asciiToArray(string);
        }
        function trimmedEndIndex(string) {
          var index = string.length;
          while (index-- && reWhitespace.test(string.charAt(index))) {
          }
          return index;
        }
        var unescapeHtmlChar = basePropertyOf(htmlUnescapes);
        function unicodeSize(string) {
          var result = reUnicode.lastIndex = 0;
          while (reUnicode.test(string)) {
            ++result;
          }
          return result;
        }
        function unicodeToArray(string) {
          return string.match(reUnicode) || [];
        }
        function unicodeWords(string) {
          return string.match(reUnicodeWord) || [];
        }
        var runInContext = (function runInContext2(context) {
          context = context == null ? root : _.defaults(root.Object(), context, _.pick(root, contextProps));
          var Array2 = context.Array, Date2 = context.Date, Error2 = context.Error, Function2 = context.Function, Math2 = context.Math, Object2 = context.Object, RegExp2 = context.RegExp, String2 = context.String, TypeError2 = context.TypeError;
          var arrayProto = Array2.prototype, funcProto = Function2.prototype, objectProto = Object2.prototype;
          var coreJsData = context["__core-js_shared__"];
          var funcToString = funcProto.toString;
          var hasOwnProperty = objectProto.hasOwnProperty;
          var idCounter = 0;
          var maskSrcKey = (function() {
            var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
            return uid ? "Symbol(src)_1." + uid : "";
          })();
          var nativeObjectToString = objectProto.toString;
          var objectCtorString = funcToString.call(Object2);
          var oldDash = root._;
          var reIsNative = RegExp2(
            "^" + funcToString.call(hasOwnProperty).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
          );
          var Buffer2 = moduleExports ? context.Buffer : undefined2, Symbol2 = context.Symbol, Uint8Array2 = context.Uint8Array, allocUnsafe = Buffer2 ? Buffer2.allocUnsafe : undefined2, getPrototype = overArg(Object2.getPrototypeOf, Object2), objectCreate = Object2.create, propertyIsEnumerable = objectProto.propertyIsEnumerable, splice = arrayProto.splice, spreadableSymbol = Symbol2 ? Symbol2.isConcatSpreadable : undefined2, symIterator = Symbol2 ? Symbol2.iterator : undefined2, symToStringTag = Symbol2 ? Symbol2.toStringTag : undefined2;
          var defineProperty = (function() {
            try {
              var func = getNative(Object2, "defineProperty");
              func({}, "", {});
              return func;
            } catch (e) {
            }
          })();
          var ctxClearTimeout = context.clearTimeout !== root.clearTimeout && context.clearTimeout, ctxNow = Date2 && Date2.now !== root.Date.now && Date2.now, ctxSetTimeout = context.setTimeout !== root.setTimeout && context.setTimeout;
          var nativeCeil = Math2.ceil, nativeFloor = Math2.floor, nativeGetSymbols = Object2.getOwnPropertySymbols, nativeIsBuffer = Buffer2 ? Buffer2.isBuffer : undefined2, nativeIsFinite = context.isFinite, nativeJoin = arrayProto.join, nativeKeys = overArg(Object2.keys, Object2), nativeMax = Math2.max, nativeMin = Math2.min, nativeNow = Date2.now, nativeParseInt = context.parseInt, nativeRandom = Math2.random, nativeReverse = arrayProto.reverse;
          var DataView = getNative(context, "DataView"), Map2 = getNative(context, "Map"), Promise2 = getNative(context, "Promise"), Set = getNative(context, "Set"), WeakMap = getNative(context, "WeakMap"), nativeCreate = getNative(Object2, "create");
          var metaMap = WeakMap && new WeakMap();
          var realNames = {};
          var dataViewCtorString = toSource(DataView), mapCtorString = toSource(Map2), promiseCtorString = toSource(Promise2), setCtorString = toSource(Set), weakMapCtorString = toSource(WeakMap);
          var symbolProto = Symbol2 ? Symbol2.prototype : undefined2, symbolValueOf = symbolProto ? symbolProto.valueOf : undefined2, symbolToString = symbolProto ? symbolProto.toString : undefined2;
          function lodash(value) {
            if (isObjectLike(value) && !isArray2(value) && !(value instanceof LazyWrapper)) {
              if (value instanceof LodashWrapper) {
                return value;
              }
              if (hasOwnProperty.call(value, "__wrapped__")) {
                return wrapperClone(value);
              }
            }
            return new LodashWrapper(value);
          }
          var baseCreate = /* @__PURE__ */ (function() {
            function object() {
            }
            return function(proto) {
              if (!isObject2(proto)) {
                return {};
              }
              if (objectCreate) {
                return objectCreate(proto);
              }
              object.prototype = proto;
              var result2 = new object();
              object.prototype = undefined2;
              return result2;
            };
          })();
          function baseLodash() {
          }
          function LodashWrapper(value, chainAll) {
            this.__wrapped__ = value;
            this.__actions__ = [];
            this.__chain__ = !!chainAll;
            this.__index__ = 0;
            this.__values__ = undefined2;
          }
          lodash.templateSettings = {
            /**
             * Used to detect `data` property values to be HTML-escaped.
             *
             * @memberOf _.templateSettings
             * @type {RegExp}
             */
            "escape": reEscape,
            /**
             * Used to detect code to be evaluated.
             *
             * @memberOf _.templateSettings
             * @type {RegExp}
             */
            "evaluate": reEvaluate,
            /**
             * Used to detect `data` property values to inject.
             *
             * @memberOf _.templateSettings
             * @type {RegExp}
             */
            "interpolate": reInterpolate,
            /**
             * Used to reference the data object in the template text.
             *
             * @memberOf _.templateSettings
             * @type {string}
             */
            "variable": "",
            /**
             * Used to import variables into the compiled template.
             *
             * @memberOf _.templateSettings
             * @type {Object}
             */
            "imports": {
              /**
               * A reference to the `lodash` function.
               *
               * @memberOf _.templateSettings.imports
               * @type {Function}
               */
              "_": lodash
            }
          };
          lodash.prototype = baseLodash.prototype;
          lodash.prototype.constructor = lodash;
          LodashWrapper.prototype = baseCreate(baseLodash.prototype);
          LodashWrapper.prototype.constructor = LodashWrapper;
          function LazyWrapper(value) {
            this.__wrapped__ = value;
            this.__actions__ = [];
            this.__dir__ = 1;
            this.__filtered__ = false;
            this.__iteratees__ = [];
            this.__takeCount__ = MAX_ARRAY_LENGTH;
            this.__views__ = [];
          }
          function lazyClone() {
            var result2 = new LazyWrapper(this.__wrapped__);
            result2.__actions__ = copyArray(this.__actions__);
            result2.__dir__ = this.__dir__;
            result2.__filtered__ = this.__filtered__;
            result2.__iteratees__ = copyArray(this.__iteratees__);
            result2.__takeCount__ = this.__takeCount__;
            result2.__views__ = copyArray(this.__views__);
            return result2;
          }
          function lazyReverse() {
            if (this.__filtered__) {
              var result2 = new LazyWrapper(this);
              result2.__dir__ = -1;
              result2.__filtered__ = true;
            } else {
              result2 = this.clone();
              result2.__dir__ *= -1;
            }
            return result2;
          }
          function lazyValue() {
            var array = this.__wrapped__.value(), dir = this.__dir__, isArr = isArray2(array), isRight = dir < 0, arrLength = isArr ? array.length : 0, view = getView(0, arrLength, this.__views__), start = view.start, end = view.end, length = end - start, index = isRight ? end : start - 1, iteratees = this.__iteratees__, iterLength = iteratees.length, resIndex = 0, takeCount = nativeMin(length, this.__takeCount__);
            if (!isArr || !isRight && arrLength == length && takeCount == length) {
              return baseWrapperValue(array, this.__actions__);
            }
            var result2 = [];
            outer:
              while (length-- && resIndex < takeCount) {
                index += dir;
                var iterIndex = -1, value = array[index];
                while (++iterIndex < iterLength) {
                  var data = iteratees[iterIndex], iteratee2 = data.iteratee, type = data.type, computed = iteratee2(value);
                  if (type == LAZY_MAP_FLAG) {
                    value = computed;
                  } else if (!computed) {
                    if (type == LAZY_FILTER_FLAG) {
                      continue outer;
                    } else {
                      break outer;
                    }
                  }
                }
                result2[resIndex++] = value;
              }
            return result2;
          }
          LazyWrapper.prototype = baseCreate(baseLodash.prototype);
          LazyWrapper.prototype.constructor = LazyWrapper;
          function Hash(entries) {
            var index = -1, length = entries == null ? 0 : entries.length;
            this.clear();
            while (++index < length) {
              var entry = entries[index];
              this.set(entry[0], entry[1]);
            }
          }
          function hashClear() {
            this.__data__ = nativeCreate ? nativeCreate(null) : {};
            this.size = 0;
          }
          function hashDelete(key) {
            var result2 = this.has(key) && delete this.__data__[key];
            this.size -= result2 ? 1 : 0;
            return result2;
          }
          function hashGet(key) {
            var data = this.__data__;
            if (nativeCreate) {
              var result2 = data[key];
              return result2 === HASH_UNDEFINED ? undefined2 : result2;
            }
            return hasOwnProperty.call(data, key) ? data[key] : undefined2;
          }
          function hashHas(key) {
            var data = this.__data__;
            return nativeCreate ? data[key] !== undefined2 : hasOwnProperty.call(data, key);
          }
          function hashSet(key, value) {
            var data = this.__data__;
            this.size += this.has(key) ? 0 : 1;
            data[key] = nativeCreate && value === undefined2 ? HASH_UNDEFINED : value;
            return this;
          }
          Hash.prototype.clear = hashClear;
          Hash.prototype["delete"] = hashDelete;
          Hash.prototype.get = hashGet;
          Hash.prototype.has = hashHas;
          Hash.prototype.set = hashSet;
          function ListCache(entries) {
            var index = -1, length = entries == null ? 0 : entries.length;
            this.clear();
            while (++index < length) {
              var entry = entries[index];
              this.set(entry[0], entry[1]);
            }
          }
          function listCacheClear() {
            this.__data__ = [];
            this.size = 0;
          }
          function listCacheDelete(key) {
            var data = this.__data__, index = assocIndexOf(data, key);
            if (index < 0) {
              return false;
            }
            var lastIndex = data.length - 1;
            if (index == lastIndex) {
              data.pop();
            } else {
              splice.call(data, index, 1);
            }
            --this.size;
            return true;
          }
          function listCacheGet(key) {
            var data = this.__data__, index = assocIndexOf(data, key);
            return index < 0 ? undefined2 : data[index][1];
          }
          function listCacheHas(key) {
            return assocIndexOf(this.__data__, key) > -1;
          }
          function listCacheSet(key, value) {
            var data = this.__data__, index = assocIndexOf(data, key);
            if (index < 0) {
              ++this.size;
              data.push([key, value]);
            } else {
              data[index][1] = value;
            }
            return this;
          }
          ListCache.prototype.clear = listCacheClear;
          ListCache.prototype["delete"] = listCacheDelete;
          ListCache.prototype.get = listCacheGet;
          ListCache.prototype.has = listCacheHas;
          ListCache.prototype.set = listCacheSet;
          function MapCache(entries) {
            var index = -1, length = entries == null ? 0 : entries.length;
            this.clear();
            while (++index < length) {
              var entry = entries[index];
              this.set(entry[0], entry[1]);
            }
          }
          function mapCacheClear() {
            this.size = 0;
            this.__data__ = {
              "hash": new Hash(),
              "map": new (Map2 || ListCache)(),
              "string": new Hash()
            };
          }
          function mapCacheDelete(key) {
            var result2 = getMapData(this, key)["delete"](key);
            this.size -= result2 ? 1 : 0;
            return result2;
          }
          function mapCacheGet(key) {
            return getMapData(this, key).get(key);
          }
          function mapCacheHas(key) {
            return getMapData(this, key).has(key);
          }
          function mapCacheSet(key, value) {
            var data = getMapData(this, key), size2 = data.size;
            data.set(key, value);
            this.size += data.size == size2 ? 0 : 1;
            return this;
          }
          MapCache.prototype.clear = mapCacheClear;
          MapCache.prototype["delete"] = mapCacheDelete;
          MapCache.prototype.get = mapCacheGet;
          MapCache.prototype.has = mapCacheHas;
          MapCache.prototype.set = mapCacheSet;
          function SetCache(values3) {
            var index = -1, length = values3 == null ? 0 : values3.length;
            this.__data__ = new MapCache();
            while (++index < length) {
              this.add(values3[index]);
            }
          }
          function setCacheAdd(value) {
            this.__data__.set(value, HASH_UNDEFINED);
            return this;
          }
          function setCacheHas(value) {
            return this.__data__.has(value);
          }
          SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
          SetCache.prototype.has = setCacheHas;
          function Stack(entries) {
            var data = this.__data__ = new ListCache(entries);
            this.size = data.size;
          }
          function stackClear() {
            this.__data__ = new ListCache();
            this.size = 0;
          }
          function stackDelete(key) {
            var data = this.__data__, result2 = data["delete"](key);
            this.size = data.size;
            return result2;
          }
          function stackGet(key) {
            return this.__data__.get(key);
          }
          function stackHas(key) {
            return this.__data__.has(key);
          }
          function stackSet(key, value) {
            var data = this.__data__;
            if (data instanceof ListCache) {
              var pairs = data.__data__;
              if (!Map2 || pairs.length < LARGE_ARRAY_SIZE - 1) {
                pairs.push([key, value]);
                this.size = ++data.size;
                return this;
              }
              data = this.__data__ = new MapCache(pairs);
            }
            data.set(key, value);
            this.size = data.size;
            return this;
          }
          Stack.prototype.clear = stackClear;
          Stack.prototype["delete"] = stackDelete;
          Stack.prototype.get = stackGet;
          Stack.prototype.has = stackHas;
          Stack.prototype.set = stackSet;
          function arrayLikeKeys(value, inherited) {
            var isArr = isArray2(value), isArg = !isArr && isArguments(value), isBuff = !isArr && !isArg && isBuffer(value), isType = !isArr && !isArg && !isBuff && isTypedArray(value), skipIndexes = isArr || isArg || isBuff || isType, result2 = skipIndexes ? baseTimes(value.length, String2) : [], length = result2.length;
            for (var key in value) {
              if ((inherited || hasOwnProperty.call(value, key)) && !(skipIndexes && // Safari 9 has enumerable `arguments.length` in strict mode.
              (key == "length" || // Node.js 0.10 has enumerable non-index properties on buffers.
              isBuff && (key == "offset" || key == "parent") || // PhantomJS 2 has enumerable non-index properties on typed arrays.
              isType && (key == "buffer" || key == "byteLength" || key == "byteOffset") || // Skip index properties.
              isIndex(key, length)))) {
                result2.push(key);
              }
            }
            return result2;
          }
          function arraySample(array) {
            var length = array.length;
            return length ? array[baseRandom(0, length - 1)] : undefined2;
          }
          function arraySampleSize(array, n) {
            return shuffleSelf(copyArray(array), baseClamp(n, 0, array.length));
          }
          function arrayShuffle(array) {
            return shuffleSelf(copyArray(array));
          }
          function assignMergeValue(object, key, value) {
            if (value !== undefined2 && !eq(object[key], value) || value === undefined2 && !(key in object)) {
              baseAssignValue(object, key, value);
            }
          }
          function assignValue(object, key, value) {
            var objValue = object[key];
            if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) || value === undefined2 && !(key in object)) {
              baseAssignValue(object, key, value);
            }
          }
          function assocIndexOf(array, key) {
            var length = array.length;
            while (length--) {
              if (eq(array[length][0], key)) {
                return length;
              }
            }
            return -1;
          }
          function baseAggregator(collection, setter, iteratee2, accumulator) {
            baseEach(collection, function(value, key, collection2) {
              setter(accumulator, value, iteratee2(value), collection2);
            });
            return accumulator;
          }
          function baseAssign(object, source) {
            return object && copyObject(source, keys2(source), object);
          }
          function baseAssignIn(object, source) {
            return object && copyObject(source, keysIn(source), object);
          }
          function baseAssignValue(object, key, value) {
            if (key == "__proto__" && defineProperty) {
              defineProperty(object, key, {
                "configurable": true,
                "enumerable": true,
                "value": value,
                "writable": true
              });
            } else {
              object[key] = value;
            }
          }
          function baseAt(object, paths) {
            var index = -1, length = paths.length, result2 = Array2(length), skip = object == null;
            while (++index < length) {
              result2[index] = skip ? undefined2 : get(object, paths[index]);
            }
            return result2;
          }
          function baseClamp(number, lower, upper) {
            if (number === number) {
              if (upper !== undefined2) {
                number = number <= upper ? number : upper;
              }
              if (lower !== undefined2) {
                number = number >= lower ? number : lower;
              }
            }
            return number;
          }
          function baseClone(value, bitmask, customizer, key, object, stack) {
            var result2, isDeep = bitmask & CLONE_DEEP_FLAG, isFlat = bitmask & CLONE_FLAT_FLAG, isFull = bitmask & CLONE_SYMBOLS_FLAG;
            if (customizer) {
              result2 = object ? customizer(value, key, object, stack) : customizer(value);
            }
            if (result2 !== undefined2) {
              return result2;
            }
            if (!isObject2(value)) {
              return value;
            }
            var isArr = isArray2(value);
            if (isArr) {
              result2 = initCloneArray(value);
              if (!isDeep) {
                return copyArray(value, result2);
              }
            } else {
              var tag = getTag(value), isFunc = tag == funcTag || tag == genTag;
              if (isBuffer(value)) {
                return cloneBuffer(value, isDeep);
              }
              if (tag == objectTag || tag == argsTag || isFunc && !object) {
                result2 = isFlat || isFunc ? {} : initCloneObject(value);
                if (!isDeep) {
                  return isFlat ? copySymbolsIn(value, baseAssignIn(result2, value)) : copySymbols(value, baseAssign(result2, value));
                }
              } else {
                if (!cloneableTags[tag]) {
                  return object ? value : {};
                }
                result2 = initCloneByTag(value, tag, isDeep);
              }
            }
            stack || (stack = new Stack());
            var stacked = stack.get(value);
            if (stacked) {
              return stacked;
            }
            stack.set(value, result2);
            if (isSet(value)) {
              value.forEach(function(subValue) {
                result2.add(baseClone(subValue, bitmask, customizer, subValue, value, stack));
              });
            } else if (isMap(value)) {
              value.forEach(function(subValue, key2) {
                result2.set(key2, baseClone(subValue, bitmask, customizer, key2, value, stack));
              });
            }
            var keysFunc = isFull ? isFlat ? getAllKeysIn : getAllKeys : isFlat ? keysIn : keys2;
            var props = isArr ? undefined2 : keysFunc(value);
            arrayEach(props || value, function(subValue, key2) {
              if (props) {
                key2 = subValue;
                subValue = value[key2];
              }
              assignValue(result2, key2, baseClone(subValue, bitmask, customizer, key2, value, stack));
            });
            return result2;
          }
          function baseConforms(source) {
            var props = keys2(source);
            return function(object) {
              return baseConformsTo(object, source, props);
            };
          }
          function baseConformsTo(object, source, props) {
            var length = props.length;
            if (object == null) {
              return !length;
            }
            object = Object2(object);
            while (length--) {
              var key = props[length], predicate = source[key], value = object[key];
              if (value === undefined2 && !(key in object) || !predicate(value)) {
                return false;
              }
            }
            return true;
          }
          function baseDelay(func, wait, args) {
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            return setTimeout2(function() {
              func.apply(undefined2, args);
            }, wait);
          }
          function baseDifference(array, values3, iteratee2, comparator) {
            var index = -1, includes2 = arrayIncludes, isCommon = true, length = array.length, result2 = [], valuesLength = values3.length;
            if (!length) {
              return result2;
            }
            if (iteratee2) {
              values3 = arrayMap(values3, baseUnary(iteratee2));
            }
            if (comparator) {
              includes2 = arrayIncludesWith;
              isCommon = false;
            } else if (values3.length >= LARGE_ARRAY_SIZE) {
              includes2 = cacheHas;
              isCommon = false;
              values3 = new SetCache(values3);
            }
            outer:
              while (++index < length) {
                var value = array[index], computed = iteratee2 == null ? value : iteratee2(value);
                value = comparator || value !== 0 ? value : 0;
                if (isCommon && computed === computed) {
                  var valuesIndex = valuesLength;
                  while (valuesIndex--) {
                    if (values3[valuesIndex] === computed) {
                      continue outer;
                    }
                  }
                  result2.push(value);
                } else if (!includes2(values3, computed, comparator)) {
                  result2.push(value);
                }
              }
            return result2;
          }
          var baseEach = createBaseEach(baseForOwn);
          var baseEachRight = createBaseEach(baseForOwnRight, true);
          function baseEvery(collection, predicate) {
            var result2 = true;
            baseEach(collection, function(value, index, collection2) {
              result2 = !!predicate(value, index, collection2);
              return result2;
            });
            return result2;
          }
          function baseExtremum(array, iteratee2, comparator) {
            var index = -1, length = array.length;
            while (++index < length) {
              var value = array[index], current = iteratee2(value);
              if (current != null && (computed === undefined2 ? current === current && !isSymbol(current) : comparator(current, computed))) {
                var computed = current, result2 = value;
              }
            }
            return result2;
          }
          function baseFill(array, value, start, end) {
            var length = array.length;
            start = toInteger(start);
            if (start < 0) {
              start = -start > length ? 0 : length + start;
            }
            end = end === undefined2 || end > length ? length : toInteger(end);
            if (end < 0) {
              end += length;
            }
            end = start > end ? 0 : toLength(end);
            while (start < end) {
              array[start++] = value;
            }
            return array;
          }
          function baseFilter(collection, predicate) {
            var result2 = [];
            baseEach(collection, function(value, index, collection2) {
              if (predicate(value, index, collection2)) {
                result2.push(value);
              }
            });
            return result2;
          }
          function baseFlatten(array, depth, predicate, isStrict, result2) {
            var index = -1, length = array.length;
            predicate || (predicate = isFlattenable);
            result2 || (result2 = []);
            while (++index < length) {
              var value = array[index];
              if (depth > 0 && predicate(value)) {
                if (depth > 1) {
                  baseFlatten(value, depth - 1, predicate, isStrict, result2);
                } else {
                  arrayPush(result2, value);
                }
              } else if (!isStrict) {
                result2[result2.length] = value;
              }
            }
            return result2;
          }
          var baseFor = createBaseFor();
          var baseForRight = createBaseFor(true);
          function baseForOwn(object, iteratee2) {
            return object && baseFor(object, iteratee2, keys2);
          }
          function baseForOwnRight(object, iteratee2) {
            return object && baseForRight(object, iteratee2, keys2);
          }
          function baseFunctions(object, props) {
            return arrayFilter(props, function(key) {
              return isFunction2(object[key]);
            });
          }
          function baseGet(object, path) {
            path = castPath(path, object);
            var index = 0, length = path.length;
            while (object != null && index < length) {
              object = object[toKey(path[index++])];
            }
            return index && index == length ? object : undefined2;
          }
          function baseGetAllKeys(object, keysFunc, symbolsFunc) {
            var result2 = keysFunc(object);
            return isArray2(object) ? result2 : arrayPush(result2, symbolsFunc(object));
          }
          function baseGetTag(value) {
            if (value == null) {
              return value === undefined2 ? undefinedTag : nullTag;
            }
            return symToStringTag && symToStringTag in Object2(value) ? getRawTag(value) : objectToString(value);
          }
          function baseGt(value, other) {
            return value > other;
          }
          function baseHas(object, key) {
            return object != null && hasOwnProperty.call(object, key);
          }
          function baseHasIn(object, key) {
            return object != null && key in Object2(object);
          }
          function baseInRange(number, start, end) {
            return number >= nativeMin(start, end) && number < nativeMax(start, end);
          }
          function baseIntersection(arrays, iteratee2, comparator) {
            var includes2 = comparator ? arrayIncludesWith : arrayIncludes, length = arrays[0].length, othLength = arrays.length, othIndex = othLength, caches = Array2(othLength), maxLength = Infinity, result2 = [];
            while (othIndex--) {
              var array = arrays[othIndex];
              if (othIndex && iteratee2) {
                array = arrayMap(array, baseUnary(iteratee2));
              }
              maxLength = nativeMin(array.length, maxLength);
              caches[othIndex] = !comparator && (iteratee2 || length >= 120 && array.length >= 120) ? new SetCache(othIndex && array) : undefined2;
            }
            array = arrays[0];
            var index = -1, seen = caches[0];
            outer:
              while (++index < length && result2.length < maxLength) {
                var value = array[index], computed = iteratee2 ? iteratee2(value) : value;
                value = comparator || value !== 0 ? value : 0;
                if (!(seen ? cacheHas(seen, computed) : includes2(result2, computed, comparator))) {
                  othIndex = othLength;
                  while (--othIndex) {
                    var cache = caches[othIndex];
                    if (!(cache ? cacheHas(cache, computed) : includes2(arrays[othIndex], computed, comparator))) {
                      continue outer;
                    }
                  }
                  if (seen) {
                    seen.push(computed);
                  }
                  result2.push(value);
                }
              }
            return result2;
          }
          function baseInverter(object, setter, iteratee2, accumulator) {
            baseForOwn(object, function(value, key, object2) {
              setter(accumulator, iteratee2(value), key, object2);
            });
            return accumulator;
          }
          function baseInvoke(object, path, args) {
            path = castPath(path, object);
            object = parent(object, path);
            var func = object == null ? object : object[toKey(last2(path))];
            return func == null ? undefined2 : apply(func, object, args);
          }
          function baseIsArguments(value) {
            return isObjectLike(value) && baseGetTag(value) == argsTag;
          }
          function baseIsArrayBuffer(value) {
            return isObjectLike(value) && baseGetTag(value) == arrayBufferTag;
          }
          function baseIsDate(value) {
            return isObjectLike(value) && baseGetTag(value) == dateTag;
          }
          function baseIsEqual(value, other, bitmask, customizer, stack) {
            if (value === other) {
              return true;
            }
            if (value == null || other == null || !isObjectLike(value) && !isObjectLike(other)) {
              return value !== value && other !== other;
            }
            return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual, stack);
          }
          function baseIsEqualDeep(object, other, bitmask, customizer, equalFunc, stack) {
            var objIsArr = isArray2(object), othIsArr = isArray2(other), objTag = objIsArr ? arrayTag : getTag(object), othTag = othIsArr ? arrayTag : getTag(other);
            objTag = objTag == argsTag ? objectTag : objTag;
            othTag = othTag == argsTag ? objectTag : othTag;
            var objIsObj = objTag == objectTag, othIsObj = othTag == objectTag, isSameTag = objTag == othTag;
            if (isSameTag && isBuffer(object)) {
              if (!isBuffer(other)) {
                return false;
              }
              objIsArr = true;
              objIsObj = false;
            }
            if (isSameTag && !objIsObj) {
              stack || (stack = new Stack());
              return objIsArr || isTypedArray(object) ? equalArrays(object, other, bitmask, customizer, equalFunc, stack) : equalByTag(object, other, objTag, bitmask, customizer, equalFunc, stack);
            }
            if (!(bitmask & COMPARE_PARTIAL_FLAG)) {
              var objIsWrapped = objIsObj && hasOwnProperty.call(object, "__wrapped__"), othIsWrapped = othIsObj && hasOwnProperty.call(other, "__wrapped__");
              if (objIsWrapped || othIsWrapped) {
                var objUnwrapped = objIsWrapped ? object.value() : object, othUnwrapped = othIsWrapped ? other.value() : other;
                stack || (stack = new Stack());
                return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
              }
            }
            if (!isSameTag) {
              return false;
            }
            stack || (stack = new Stack());
            return equalObjects(object, other, bitmask, customizer, equalFunc, stack);
          }
          function baseIsMap(value) {
            return isObjectLike(value) && getTag(value) == mapTag;
          }
          function baseIsMatch(object, source, matchData, customizer) {
            var index = matchData.length, length = index, noCustomizer = !customizer;
            if (object == null) {
              return !length;
            }
            object = Object2(object);
            while (index--) {
              var data = matchData[index];
              if (noCustomizer && data[2] ? data[1] !== object[data[0]] : !(data[0] in object)) {
                return false;
              }
            }
            while (++index < length) {
              data = matchData[index];
              var key = data[0], objValue = object[key], srcValue = data[1];
              if (noCustomizer && data[2]) {
                if (objValue === undefined2 && !(key in object)) {
                  return false;
                }
              } else {
                var stack = new Stack();
                if (customizer) {
                  var result2 = customizer(objValue, srcValue, key, object, source, stack);
                }
                if (!(result2 === undefined2 ? baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG, customizer, stack) : result2)) {
                  return false;
                }
              }
            }
            return true;
          }
          function baseIsNative(value) {
            if (!isObject2(value) || isMasked(value)) {
              return false;
            }
            var pattern = isFunction2(value) ? reIsNative : reIsHostCtor;
            return pattern.test(toSource(value));
          }
          function baseIsRegExp(value) {
            return isObjectLike(value) && baseGetTag(value) == regexpTag;
          }
          function baseIsSet(value) {
            return isObjectLike(value) && getTag(value) == setTag;
          }
          function baseIsTypedArray(value) {
            return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
          }
          function baseIteratee(value) {
            if (typeof value == "function") {
              return value;
            }
            if (value == null) {
              return identity;
            }
            if (typeof value == "object") {
              return isArray2(value) ? baseMatchesProperty(value[0], value[1]) : baseMatches(value);
            }
            return property(value);
          }
          function baseKeys(object) {
            if (!isPrototype(object)) {
              return nativeKeys(object);
            }
            var result2 = [];
            for (var key in Object2(object)) {
              if (hasOwnProperty.call(object, key) && key != "constructor") {
                result2.push(key);
              }
            }
            return result2;
          }
          function baseKeysIn(object) {
            if (!isObject2(object)) {
              return nativeKeysIn(object);
            }
            var isProto = isPrototype(object), result2 = [];
            for (var key in object) {
              if (!(key == "constructor" && (isProto || !hasOwnProperty.call(object, key)))) {
                result2.push(key);
              }
            }
            return result2;
          }
          function baseLt(value, other) {
            return value < other;
          }
          function baseMap(collection, iteratee2) {
            var index = -1, result2 = isArrayLike(collection) ? Array2(collection.length) : [];
            baseEach(collection, function(value, key, collection2) {
              result2[++index] = iteratee2(value, key, collection2);
            });
            return result2;
          }
          function baseMatches(source) {
            var matchData = getMatchData(source);
            if (matchData.length == 1 && matchData[0][2]) {
              return matchesStrictComparable(matchData[0][0], matchData[0][1]);
            }
            return function(object) {
              return object === source || baseIsMatch(object, source, matchData);
            };
          }
          function baseMatchesProperty(path, srcValue) {
            if (isKey(path) && isStrictComparable(srcValue)) {
              return matchesStrictComparable(toKey(path), srcValue);
            }
            return function(object) {
              var objValue = get(object, path);
              return objValue === undefined2 && objValue === srcValue ? hasIn(object, path) : baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG);
            };
          }
          function baseMerge(object, source, srcIndex, customizer, stack) {
            if (object === source) {
              return;
            }
            baseFor(source, function(srcValue, key) {
              stack || (stack = new Stack());
              if (isObject2(srcValue)) {
                baseMergeDeep(object, source, key, srcIndex, baseMerge, customizer, stack);
              } else {
                var newValue = customizer ? customizer(safeGet(object, key), srcValue, key + "", object, source, stack) : undefined2;
                if (newValue === undefined2) {
                  newValue = srcValue;
                }
                assignMergeValue(object, key, newValue);
              }
            }, keysIn);
          }
          function baseMergeDeep(object, source, key, srcIndex, mergeFunc, customizer, stack) {
            var objValue = safeGet(object, key), srcValue = safeGet(source, key), stacked = stack.get(srcValue);
            if (stacked) {
              assignMergeValue(object, key, stacked);
              return;
            }
            var newValue = customizer ? customizer(objValue, srcValue, key + "", object, source, stack) : undefined2;
            var isCommon = newValue === undefined2;
            if (isCommon) {
              var isArr = isArray2(srcValue), isBuff = !isArr && isBuffer(srcValue), isTyped = !isArr && !isBuff && isTypedArray(srcValue);
              newValue = srcValue;
              if (isArr || isBuff || isTyped) {
                if (isArray2(objValue)) {
                  newValue = objValue;
                } else if (isArrayLikeObject(objValue)) {
                  newValue = copyArray(objValue);
                } else if (isBuff) {
                  isCommon = false;
                  newValue = cloneBuffer(srcValue, true);
                } else if (isTyped) {
                  isCommon = false;
                  newValue = cloneTypedArray(srcValue, true);
                } else {
                  newValue = [];
                }
              } else if (isPlainObject(srcValue) || isArguments(srcValue)) {
                newValue = objValue;
                if (isArguments(objValue)) {
                  newValue = toPlainObject(objValue);
                } else if (!isObject2(objValue) || isFunction2(objValue)) {
                  newValue = initCloneObject(srcValue);
                }
              } else {
                isCommon = false;
              }
            }
            if (isCommon) {
              stack.set(srcValue, newValue);
              mergeFunc(newValue, srcValue, srcIndex, customizer, stack);
              stack["delete"](srcValue);
            }
            assignMergeValue(object, key, newValue);
          }
          function baseNth(array, n) {
            var length = array.length;
            if (!length) {
              return;
            }
            n += n < 0 ? length : 0;
            return isIndex(n, length) ? array[n] : undefined2;
          }
          function baseOrderBy(collection, iteratees, orders) {
            if (iteratees.length) {
              iteratees = arrayMap(iteratees, function(iteratee2) {
                if (isArray2(iteratee2)) {
                  return function(value) {
                    return baseGet(value, iteratee2.length === 1 ? iteratee2[0] : iteratee2);
                  };
                }
                return iteratee2;
              });
            } else {
              iteratees = [identity];
            }
            var index = -1;
            iteratees = arrayMap(iteratees, baseUnary(getIteratee()));
            var result2 = baseMap(collection, function(value, key, collection2) {
              var criteria = arrayMap(iteratees, function(iteratee2) {
                return iteratee2(value);
              });
              return { "criteria": criteria, "index": ++index, "value": value };
            });
            return baseSortBy(result2, function(object, other) {
              return compareMultiple(object, other, orders);
            });
          }
          function basePick(object, paths) {
            return basePickBy(object, paths, function(value, path) {
              return hasIn(object, path);
            });
          }
          function basePickBy(object, paths, predicate) {
            var index = -1, length = paths.length, result2 = {};
            while (++index < length) {
              var path = paths[index], value = baseGet(object, path);
              if (predicate(value, path)) {
                baseSet(result2, castPath(path, object), value);
              }
            }
            return result2;
          }
          function basePropertyDeep(path) {
            return function(object) {
              return baseGet(object, path);
            };
          }
          function basePullAll(array, values3, iteratee2, comparator) {
            var indexOf3 = comparator ? baseIndexOfWith : baseIndexOf, index = -1, length = values3.length, seen = array;
            if (array === values3) {
              values3 = copyArray(values3);
            }
            if (iteratee2) {
              seen = arrayMap(array, baseUnary(iteratee2));
            }
            while (++index < length) {
              var fromIndex = 0, value = values3[index], computed = iteratee2 ? iteratee2(value) : value;
              while ((fromIndex = indexOf3(seen, computed, fromIndex, comparator)) > -1) {
                if (seen !== array) {
                  splice.call(seen, fromIndex, 1);
                }
                splice.call(array, fromIndex, 1);
              }
            }
            return array;
          }
          function basePullAt(array, indexes) {
            var length = array ? indexes.length : 0, lastIndex = length - 1;
            while (length--) {
              var index = indexes[length];
              if (length == lastIndex || index !== previous) {
                var previous = index;
                if (isIndex(index)) {
                  splice.call(array, index, 1);
                } else {
                  baseUnset(array, index);
                }
              }
            }
            return array;
          }
          function baseRandom(lower, upper) {
            return lower + nativeFloor(nativeRandom() * (upper - lower + 1));
          }
          function baseRange(start, end, step, fromRight) {
            var index = -1, length = nativeMax(nativeCeil((end - start) / (step || 1)), 0), result2 = Array2(length);
            while (length--) {
              result2[fromRight ? length : ++index] = start;
              start += step;
            }
            return result2;
          }
          function baseRepeat(string, n) {
            var result2 = "";
            if (!string || n < 1 || n > MAX_SAFE_INTEGER) {
              return result2;
            }
            do {
              if (n % 2) {
                result2 += string;
              }
              n = nativeFloor(n / 2);
              if (n) {
                string += string;
              }
            } while (n);
            return result2;
          }
          function baseRest(func, start) {
            return setToString(overRest(func, start, identity), func + "");
          }
          function baseSample(collection) {
            return arraySample(values2(collection));
          }
          function baseSampleSize(collection, n) {
            var array = values2(collection);
            return shuffleSelf(array, baseClamp(n, 0, array.length));
          }
          function baseSet(object, path, value, customizer) {
            if (!isObject2(object)) {
              return object;
            }
            path = castPath(path, object);
            var index = -1, length = path.length, lastIndex = length - 1, nested = object;
            while (nested != null && ++index < length) {
              var key = toKey(path[index]), newValue = value;
              if (key === "__proto__" || key === "constructor" || key === "prototype") {
                return object;
              }
              if (index != lastIndex) {
                var objValue = nested[key];
                newValue = customizer ? customizer(objValue, key, nested) : undefined2;
                if (newValue === undefined2) {
                  newValue = isObject2(objValue) ? objValue : isIndex(path[index + 1]) ? [] : {};
                }
              }
              assignValue(nested, key, newValue);
              nested = nested[key];
            }
            return object;
          }
          var baseSetData = !metaMap ? identity : function(func, data) {
            metaMap.set(func, data);
            return func;
          };
          var baseSetToString = !defineProperty ? identity : function(func, string) {
            return defineProperty(func, "toString", {
              "configurable": true,
              "enumerable": false,
              "value": constant(string),
              "writable": true
            });
          };
          function baseShuffle(collection) {
            return shuffleSelf(values2(collection));
          }
          function baseSlice(array, start, end) {
            var index = -1, length = array.length;
            if (start < 0) {
              start = -start > length ? 0 : length + start;
            }
            end = end > length ? length : end;
            if (end < 0) {
              end += length;
            }
            length = start > end ? 0 : end - start >>> 0;
            start >>>= 0;
            var result2 = Array2(length);
            while (++index < length) {
              result2[index] = array[index + start];
            }
            return result2;
          }
          function baseSome(collection, predicate) {
            var result2;
            baseEach(collection, function(value, index, collection2) {
              result2 = predicate(value, index, collection2);
              return !result2;
            });
            return !!result2;
          }
          function baseSortedIndex(array, value, retHighest) {
            var low = 0, high = array == null ? low : array.length;
            if (typeof value == "number" && value === value && high <= HALF_MAX_ARRAY_LENGTH) {
              while (low < high) {
                var mid = low + high >>> 1, computed = array[mid];
                if (computed !== null && !isSymbol(computed) && (retHighest ? computed <= value : computed < value)) {
                  low = mid + 1;
                } else {
                  high = mid;
                }
              }
              return high;
            }
            return baseSortedIndexBy(array, value, identity, retHighest);
          }
          function baseSortedIndexBy(array, value, iteratee2, retHighest) {
            var low = 0, high = array == null ? 0 : array.length;
            if (high === 0) {
              return 0;
            }
            value = iteratee2(value);
            var valIsNaN = value !== value, valIsNull = value === null, valIsSymbol = isSymbol(value), valIsUndefined = value === undefined2;
            while (low < high) {
              var mid = nativeFloor((low + high) / 2), computed = iteratee2(array[mid]), othIsDefined = computed !== undefined2, othIsNull = computed === null, othIsReflexive = computed === computed, othIsSymbol = isSymbol(computed);
              if (valIsNaN) {
                var setLow = retHighest || othIsReflexive;
              } else if (valIsUndefined) {
                setLow = othIsReflexive && (retHighest || othIsDefined);
              } else if (valIsNull) {
                setLow = othIsReflexive && othIsDefined && (retHighest || !othIsNull);
              } else if (valIsSymbol) {
                setLow = othIsReflexive && othIsDefined && !othIsNull && (retHighest || !othIsSymbol);
              } else if (othIsNull || othIsSymbol) {
                setLow = false;
              } else {
                setLow = retHighest ? computed <= value : computed < value;
              }
              if (setLow) {
                low = mid + 1;
              } else {
                high = mid;
              }
            }
            return nativeMin(high, MAX_ARRAY_INDEX);
          }
          function baseSortedUniq(array, iteratee2) {
            var index = -1, length = array.length, resIndex = 0, result2 = [];
            while (++index < length) {
              var value = array[index], computed = iteratee2 ? iteratee2(value) : value;
              if (!index || !eq(computed, seen)) {
                var seen = computed;
                result2[resIndex++] = value === 0 ? 0 : value;
              }
            }
            return result2;
          }
          function baseToNumber(value) {
            if (typeof value == "number") {
              return value;
            }
            if (isSymbol(value)) {
              return NAN;
            }
            return +value;
          }
          function baseToString(value) {
            if (typeof value == "string") {
              return value;
            }
            if (isArray2(value)) {
              return arrayMap(value, baseToString) + "";
            }
            if (isSymbol(value)) {
              return symbolToString ? symbolToString.call(value) : "";
            }
            var result2 = value + "";
            return result2 == "0" && 1 / value == -INFINITY ? "-0" : result2;
          }
          function baseUniq(array, iteratee2, comparator) {
            var index = -1, includes2 = arrayIncludes, length = array.length, isCommon = true, result2 = [], seen = result2;
            if (comparator) {
              isCommon = false;
              includes2 = arrayIncludesWith;
            } else if (length >= LARGE_ARRAY_SIZE) {
              var set2 = iteratee2 ? null : createSet(array);
              if (set2) {
                return setToArray(set2);
              }
              isCommon = false;
              includes2 = cacheHas;
              seen = new SetCache();
            } else {
              seen = iteratee2 ? [] : result2;
            }
            outer:
              while (++index < length) {
                var value = array[index], computed = iteratee2 ? iteratee2(value) : value;
                value = comparator || value !== 0 ? value : 0;
                if (isCommon && computed === computed) {
                  var seenIndex = seen.length;
                  while (seenIndex--) {
                    if (seen[seenIndex] === computed) {
                      continue outer;
                    }
                  }
                  if (iteratee2) {
                    seen.push(computed);
                  }
                  result2.push(value);
                } else if (!includes2(seen, computed, comparator)) {
                  if (seen !== result2) {
                    seen.push(computed);
                  }
                  result2.push(value);
                }
              }
            return result2;
          }
          function baseUnset(object, path) {
            path = castPath(path, object);
            object = parent(object, path);
            return object == null || delete object[toKey(last2(path))];
          }
          function baseUpdate(object, path, updater, customizer) {
            return baseSet(object, path, updater(baseGet(object, path)), customizer);
          }
          function baseWhile(array, predicate, isDrop, fromRight) {
            var length = array.length, index = fromRight ? length : -1;
            while ((fromRight ? index-- : ++index < length) && predicate(array[index], index, array)) {
            }
            return isDrop ? baseSlice(array, fromRight ? 0 : index, fromRight ? index + 1 : length) : baseSlice(array, fromRight ? index + 1 : 0, fromRight ? length : index);
          }
          function baseWrapperValue(value, actions) {
            var result2 = value;
            if (result2 instanceof LazyWrapper) {
              result2 = result2.value();
            }
            return arrayReduce(actions, function(result3, action) {
              return action.func.apply(action.thisArg, arrayPush([result3], action.args));
            }, result2);
          }
          function baseXor(arrays, iteratee2, comparator) {
            var length = arrays.length;
            if (length < 2) {
              return length ? baseUniq(arrays[0]) : [];
            }
            var index = -1, result2 = Array2(length);
            while (++index < length) {
              var array = arrays[index], othIndex = -1;
              while (++othIndex < length) {
                if (othIndex != index) {
                  result2[index] = baseDifference(result2[index] || array, arrays[othIndex], iteratee2, comparator);
                }
              }
            }
            return baseUniq(baseFlatten(result2, 1), iteratee2, comparator);
          }
          function baseZipObject(props, values3, assignFunc) {
            var index = -1, length = props.length, valsLength = values3.length, result2 = {};
            while (++index < length) {
              var value = index < valsLength ? values3[index] : undefined2;
              assignFunc(result2, props[index], value);
            }
            return result2;
          }
          function castArrayLikeObject(value) {
            return isArrayLikeObject(value) ? value : [];
          }
          function castFunction(value) {
            return typeof value == "function" ? value : identity;
          }
          function castPath(value, object) {
            if (isArray2(value)) {
              return value;
            }
            return isKey(value, object) ? [value] : stringToPath(toString(value));
          }
          var castRest = baseRest;
          function castSlice(array, start, end) {
            var length = array.length;
            end = end === undefined2 ? length : end;
            return !start && end >= length ? array : baseSlice(array, start, end);
          }
          var clearTimeout2 = ctxClearTimeout || function(id) {
            return root.clearTimeout(id);
          };
          function cloneBuffer(buffer, isDeep) {
            if (isDeep) {
              return buffer.slice();
            }
            var length = buffer.length, result2 = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);
            buffer.copy(result2);
            return result2;
          }
          function cloneArrayBuffer(arrayBuffer) {
            var result2 = new arrayBuffer.constructor(arrayBuffer.byteLength);
            new Uint8Array2(result2).set(new Uint8Array2(arrayBuffer));
            return result2;
          }
          function cloneDataView(dataView, isDeep) {
            var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
            return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
          }
          function cloneRegExp(regexp) {
            var result2 = new regexp.constructor(regexp.source, reFlags.exec(regexp));
            result2.lastIndex = regexp.lastIndex;
            return result2;
          }
          function cloneSymbol(symbol) {
            return symbolValueOf ? Object2(symbolValueOf.call(symbol)) : {};
          }
          function cloneTypedArray(typedArray, isDeep) {
            var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
            return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
          }
          function compareAscending(value, other) {
            if (value !== other) {
              var valIsDefined = value !== undefined2, valIsNull = value === null, valIsReflexive = value === value, valIsSymbol = isSymbol(value);
              var othIsDefined = other !== undefined2, othIsNull = other === null, othIsReflexive = other === other, othIsSymbol = isSymbol(other);
              if (!othIsNull && !othIsSymbol && !valIsSymbol && value > other || valIsSymbol && othIsDefined && othIsReflexive && !othIsNull && !othIsSymbol || valIsNull && othIsDefined && othIsReflexive || !valIsDefined && othIsReflexive || !valIsReflexive) {
                return 1;
              }
              if (!valIsNull && !valIsSymbol && !othIsSymbol && value < other || othIsSymbol && valIsDefined && valIsReflexive && !valIsNull && !valIsSymbol || othIsNull && valIsDefined && valIsReflexive || !othIsDefined && valIsReflexive || !othIsReflexive) {
                return -1;
              }
            }
            return 0;
          }
          function compareMultiple(object, other, orders) {
            var index = -1, objCriteria = object.criteria, othCriteria = other.criteria, length = objCriteria.length, ordersLength = orders.length;
            while (++index < length) {
              var result2 = compareAscending(objCriteria[index], othCriteria[index]);
              if (result2) {
                if (index >= ordersLength) {
                  return result2;
                }
                var order = orders[index];
                return result2 * (order == "desc" ? -1 : 1);
              }
            }
            return object.index - other.index;
          }
          function composeArgs(args, partials, holders, isCurried) {
            var argsIndex = -1, argsLength = args.length, holdersLength = holders.length, leftIndex = -1, leftLength = partials.length, rangeLength = nativeMax(argsLength - holdersLength, 0), result2 = Array2(leftLength + rangeLength), isUncurried = !isCurried;
            while (++leftIndex < leftLength) {
              result2[leftIndex] = partials[leftIndex];
            }
            while (++argsIndex < holdersLength) {
              if (isUncurried || argsIndex < argsLength) {
                result2[holders[argsIndex]] = args[argsIndex];
              }
            }
            while (rangeLength--) {
              result2[leftIndex++] = args[argsIndex++];
            }
            return result2;
          }
          function composeArgsRight(args, partials, holders, isCurried) {
            var argsIndex = -1, argsLength = args.length, holdersIndex = -1, holdersLength = holders.length, rightIndex = -1, rightLength = partials.length, rangeLength = nativeMax(argsLength - holdersLength, 0), result2 = Array2(rangeLength + rightLength), isUncurried = !isCurried;
            while (++argsIndex < rangeLength) {
              result2[argsIndex] = args[argsIndex];
            }
            var offset = argsIndex;
            while (++rightIndex < rightLength) {
              result2[offset + rightIndex] = partials[rightIndex];
            }
            while (++holdersIndex < holdersLength) {
              if (isUncurried || argsIndex < argsLength) {
                result2[offset + holders[holdersIndex]] = args[argsIndex++];
              }
            }
            return result2;
          }
          function copyArray(source, array) {
            var index = -1, length = source.length;
            array || (array = Array2(length));
            while (++index < length) {
              array[index] = source[index];
            }
            return array;
          }
          function copyObject(source, props, object, customizer) {
            var isNew = !object;
            object || (object = {});
            var index = -1, length = props.length;
            while (++index < length) {
              var key = props[index];
              var newValue = customizer ? customizer(object[key], source[key], key, object, source) : undefined2;
              if (newValue === undefined2) {
                newValue = source[key];
              }
              if (isNew) {
                baseAssignValue(object, key, newValue);
              } else {
                assignValue(object, key, newValue);
              }
            }
            return object;
          }
          function copySymbols(source, object) {
            return copyObject(source, getSymbols(source), object);
          }
          function copySymbolsIn(source, object) {
            return copyObject(source, getSymbolsIn(source), object);
          }
          function createAggregator(setter, initializer) {
            return function(collection, iteratee2) {
              var func = isArray2(collection) ? arrayAggregator : baseAggregator, accumulator = initializer ? initializer() : {};
              return func(collection, setter, getIteratee(iteratee2, 2), accumulator);
            };
          }
          function createAssigner(assigner) {
            return baseRest(function(object, sources) {
              var index = -1, length = sources.length, customizer = length > 1 ? sources[length - 1] : undefined2, guard = length > 2 ? sources[2] : undefined2;
              customizer = assigner.length > 3 && typeof customizer == "function" ? (length--, customizer) : undefined2;
              if (guard && isIterateeCall(sources[0], sources[1], guard)) {
                customizer = length < 3 ? undefined2 : customizer;
                length = 1;
              }
              object = Object2(object);
              while (++index < length) {
                var source = sources[index];
                if (source) {
                  assigner(object, source, index, customizer);
                }
              }
              return object;
            });
          }
          function createBaseEach(eachFunc, fromRight) {
            return function(collection, iteratee2) {
              if (collection == null) {
                return collection;
              }
              if (!isArrayLike(collection)) {
                return eachFunc(collection, iteratee2);
              }
              var length = collection.length, index = fromRight ? length : -1, iterable = Object2(collection);
              while (fromRight ? index-- : ++index < length) {
                if (iteratee2(iterable[index], index, iterable) === false) {
                  break;
                }
              }
              return collection;
            };
          }
          function createBaseFor(fromRight) {
            return function(object, iteratee2, keysFunc) {
              var index = -1, iterable = Object2(object), props = keysFunc(object), length = props.length;
              while (length--) {
                var key = props[fromRight ? length : ++index];
                if (iteratee2(iterable[key], key, iterable) === false) {
                  break;
                }
              }
              return object;
            };
          }
          function createBind(func, bitmask, thisArg) {
            var isBind = bitmask & WRAP_BIND_FLAG, Ctor = createCtor(func);
            function wrapper() {
              var fn = this && this !== root && this instanceof wrapper ? Ctor : func;
              return fn.apply(isBind ? thisArg : this, arguments);
            }
            return wrapper;
          }
          function createCaseFirst(methodName) {
            return function(string) {
              string = toString(string);
              var strSymbols = hasUnicode(string) ? stringToArray(string) : undefined2;
              var chr = strSymbols ? strSymbols[0] : string.charAt(0);
              var trailing = strSymbols ? castSlice(strSymbols, 1).join("") : string.slice(1);
              return chr[methodName]() + trailing;
            };
          }
          function createCompounder(callback) {
            return function(string) {
              return arrayReduce(words(deburr(string).replace(reApos, "")), callback, "");
            };
          }
          function createCtor(Ctor) {
            return function() {
              var args = arguments;
              switch (args.length) {
                case 0:
                  return new Ctor();
                case 1:
                  return new Ctor(args[0]);
                case 2:
                  return new Ctor(args[0], args[1]);
                case 3:
                  return new Ctor(args[0], args[1], args[2]);
                case 4:
                  return new Ctor(args[0], args[1], args[2], args[3]);
                case 5:
                  return new Ctor(args[0], args[1], args[2], args[3], args[4]);
                case 6:
                  return new Ctor(args[0], args[1], args[2], args[3], args[4], args[5]);
                case 7:
                  return new Ctor(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
              }
              var thisBinding = baseCreate(Ctor.prototype), result2 = Ctor.apply(thisBinding, args);
              return isObject2(result2) ? result2 : thisBinding;
            };
          }
          function createCurry(func, bitmask, arity) {
            var Ctor = createCtor(func);
            function wrapper() {
              var length = arguments.length, args = Array2(length), index = length, placeholder = getHolder(wrapper);
              while (index--) {
                args[index] = arguments[index];
              }
              var holders = length < 3 && args[0] !== placeholder && args[length - 1] !== placeholder ? [] : replaceHolders(args, placeholder);
              length -= holders.length;
              if (length < arity) {
                return createRecurry(
                  func,
                  bitmask,
                  createHybrid,
                  wrapper.placeholder,
                  undefined2,
                  args,
                  holders,
                  undefined2,
                  undefined2,
                  arity - length
                );
              }
              var fn = this && this !== root && this instanceof wrapper ? Ctor : func;
              return apply(fn, this, args);
            }
            return wrapper;
          }
          function createFind(findIndexFunc) {
            return function(collection, predicate, fromIndex) {
              var iterable = Object2(collection);
              if (!isArrayLike(collection)) {
                var iteratee2 = getIteratee(predicate, 3);
                collection = keys2(collection);
                predicate = function(key) {
                  return iteratee2(iterable[key], key, iterable);
                };
              }
              var index = findIndexFunc(collection, predicate, fromIndex);
              return index > -1 ? iterable[iteratee2 ? collection[index] : index] : undefined2;
            };
          }
          function createFlow(fromRight) {
            return flatRest(function(funcs) {
              var length = funcs.length, index = length, prereq = LodashWrapper.prototype.thru;
              if (fromRight) {
                funcs.reverse();
              }
              while (index--) {
                var func = funcs[index];
                if (typeof func != "function") {
                  throw new TypeError2(FUNC_ERROR_TEXT);
                }
                if (prereq && !wrapper && getFuncName(func) == "wrapper") {
                  var wrapper = new LodashWrapper([], true);
                }
              }
              index = wrapper ? index : length;
              while (++index < length) {
                func = funcs[index];
                var funcName = getFuncName(func), data = funcName == "wrapper" ? getData(func) : undefined2;
                if (data && isLaziable(data[0]) && data[1] == (WRAP_ARY_FLAG | WRAP_CURRY_FLAG | WRAP_PARTIAL_FLAG | WRAP_REARG_FLAG) && !data[4].length && data[9] == 1) {
                  wrapper = wrapper[getFuncName(data[0])].apply(wrapper, data[3]);
                } else {
                  wrapper = func.length == 1 && isLaziable(func) ? wrapper[funcName]() : wrapper.thru(func);
                }
              }
              return function() {
                var args = arguments, value = args[0];
                if (wrapper && args.length == 1 && isArray2(value)) {
                  return wrapper.plant(value).value();
                }
                var index2 = 0, result2 = length ? funcs[index2].apply(this, args) : value;
                while (++index2 < length) {
                  result2 = funcs[index2].call(this, result2);
                }
                return result2;
              };
            });
          }
          function createHybrid(func, bitmask, thisArg, partials, holders, partialsRight, holdersRight, argPos, ary2, arity) {
            var isAry = bitmask & WRAP_ARY_FLAG, isBind = bitmask & WRAP_BIND_FLAG, isBindKey = bitmask & WRAP_BIND_KEY_FLAG, isCurried = bitmask & (WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG), isFlip = bitmask & WRAP_FLIP_FLAG, Ctor = isBindKey ? undefined2 : createCtor(func);
            function wrapper() {
              var length = arguments.length, args = Array2(length), index = length;
              while (index--) {
                args[index] = arguments[index];
              }
              if (isCurried) {
                var placeholder = getHolder(wrapper), holdersCount = countHolders(args, placeholder);
              }
              if (partials) {
                args = composeArgs(args, partials, holders, isCurried);
              }
              if (partialsRight) {
                args = composeArgsRight(args, partialsRight, holdersRight, isCurried);
              }
              length -= holdersCount;
              if (isCurried && length < arity) {
                var newHolders = replaceHolders(args, placeholder);
                return createRecurry(
                  func,
                  bitmask,
                  createHybrid,
                  wrapper.placeholder,
                  thisArg,
                  args,
                  newHolders,
                  argPos,
                  ary2,
                  arity - length
                );
              }
              var thisBinding = isBind ? thisArg : this, fn = isBindKey ? thisBinding[func] : func;
              length = args.length;
              if (argPos) {
                args = reorder(args, argPos);
              } else if (isFlip && length > 1) {
                args.reverse();
              }
              if (isAry && ary2 < length) {
                args.length = ary2;
              }
              if (this && this !== root && this instanceof wrapper) {
                fn = Ctor || createCtor(fn);
              }
              return fn.apply(thisBinding, args);
            }
            return wrapper;
          }
          function createInverter(setter, toIteratee) {
            return function(object, iteratee2) {
              return baseInverter(object, setter, toIteratee(iteratee2), {});
            };
          }
          function createMathOperation(operator, defaultValue) {
            return function(value, other) {
              var result2;
              if (value === undefined2 && other === undefined2) {
                return defaultValue;
              }
              if (value !== undefined2) {
                result2 = value;
              }
              if (other !== undefined2) {
                if (result2 === undefined2) {
                  return other;
                }
                if (typeof value == "string" || typeof other == "string") {
                  value = baseToString(value);
                  other = baseToString(other);
                } else {
                  value = baseToNumber(value);
                  other = baseToNumber(other);
                }
                result2 = operator(value, other);
              }
              return result2;
            };
          }
          function createOver(arrayFunc) {
            return flatRest(function(iteratees) {
              iteratees = arrayMap(iteratees, baseUnary(getIteratee()));
              return baseRest(function(args) {
                var thisArg = this;
                return arrayFunc(iteratees, function(iteratee2) {
                  return apply(iteratee2, thisArg, args);
                });
              });
            });
          }
          function createPadding(length, chars) {
            chars = chars === undefined2 ? " " : baseToString(chars);
            var charsLength = chars.length;
            if (charsLength < 2) {
              return charsLength ? baseRepeat(chars, length) : chars;
            }
            var result2 = baseRepeat(chars, nativeCeil(length / stringSize(chars)));
            return hasUnicode(chars) ? castSlice(stringToArray(result2), 0, length).join("") : result2.slice(0, length);
          }
          function createPartial(func, bitmask, thisArg, partials) {
            var isBind = bitmask & WRAP_BIND_FLAG, Ctor = createCtor(func);
            function wrapper() {
              var argsIndex = -1, argsLength = arguments.length, leftIndex = -1, leftLength = partials.length, args = Array2(leftLength + argsLength), fn = this && this !== root && this instanceof wrapper ? Ctor : func;
              while (++leftIndex < leftLength) {
                args[leftIndex] = partials[leftIndex];
              }
              while (argsLength--) {
                args[leftIndex++] = arguments[++argsIndex];
              }
              return apply(fn, isBind ? thisArg : this, args);
            }
            return wrapper;
          }
          function createRange(fromRight) {
            return function(start, end, step) {
              if (step && typeof step != "number" && isIterateeCall(start, end, step)) {
                end = step = undefined2;
              }
              start = toFinite(start);
              if (end === undefined2) {
                end = start;
                start = 0;
              } else {
                end = toFinite(end);
              }
              step = step === undefined2 ? start < end ? 1 : -1 : toFinite(step);
              return baseRange(start, end, step, fromRight);
            };
          }
          function createRelationalOperation(operator) {
            return function(value, other) {
              if (!(typeof value == "string" && typeof other == "string")) {
                value = toNumber(value);
                other = toNumber(other);
              }
              return operator(value, other);
            };
          }
          function createRecurry(func, bitmask, wrapFunc, placeholder, thisArg, partials, holders, argPos, ary2, arity) {
            var isCurry = bitmask & WRAP_CURRY_FLAG, newHolders = isCurry ? holders : undefined2, newHoldersRight = isCurry ? undefined2 : holders, newPartials = isCurry ? partials : undefined2, newPartialsRight = isCurry ? undefined2 : partials;
            bitmask |= isCurry ? WRAP_PARTIAL_FLAG : WRAP_PARTIAL_RIGHT_FLAG;
            bitmask &= ~(isCurry ? WRAP_PARTIAL_RIGHT_FLAG : WRAP_PARTIAL_FLAG);
            if (!(bitmask & WRAP_CURRY_BOUND_FLAG)) {
              bitmask &= ~(WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG);
            }
            var newData = [
              func,
              bitmask,
              thisArg,
              newPartials,
              newHolders,
              newPartialsRight,
              newHoldersRight,
              argPos,
              ary2,
              arity
            ];
            var result2 = wrapFunc.apply(undefined2, newData);
            if (isLaziable(func)) {
              setData(result2, newData);
            }
            result2.placeholder = placeholder;
            return setWrapToString(result2, func, bitmask);
          }
          function createRound(methodName) {
            var func = Math2[methodName];
            return function(number, precision) {
              number = toNumber(number);
              precision = precision == null ? 0 : nativeMin(toInteger(precision), 292);
              if (precision && nativeIsFinite(number)) {
                var pair = (toString(number) + "e").split("e"), value = func(pair[0] + "e" + (+pair[1] + precision));
                pair = (toString(value) + "e").split("e");
                return +(pair[0] + "e" + (+pair[1] - precision));
              }
              return func(number);
            };
          }
          var createSet = !(Set && 1 / setToArray(new Set([, -0]))[1] == INFINITY) ? noop : function(values3) {
            return new Set(values3);
          };
          function createToPairs(keysFunc) {
            return function(object) {
              var tag = getTag(object);
              if (tag == mapTag) {
                return mapToArray(object);
              }
              if (tag == setTag) {
                return setToPairs(object);
              }
              return baseToPairs(object, keysFunc(object));
            };
          }
          function createWrap(func, bitmask, thisArg, partials, holders, argPos, ary2, arity) {
            var isBindKey = bitmask & WRAP_BIND_KEY_FLAG;
            if (!isBindKey && typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            var length = partials ? partials.length : 0;
            if (!length) {
              bitmask &= ~(WRAP_PARTIAL_FLAG | WRAP_PARTIAL_RIGHT_FLAG);
              partials = holders = undefined2;
            }
            ary2 = ary2 === undefined2 ? ary2 : nativeMax(toInteger(ary2), 0);
            arity = arity === undefined2 ? arity : toInteger(arity);
            length -= holders ? holders.length : 0;
            if (bitmask & WRAP_PARTIAL_RIGHT_FLAG) {
              var partialsRight = partials, holdersRight = holders;
              partials = holders = undefined2;
            }
            var data = isBindKey ? undefined2 : getData(func);
            var newData = [
              func,
              bitmask,
              thisArg,
              partials,
              holders,
              partialsRight,
              holdersRight,
              argPos,
              ary2,
              arity
            ];
            if (data) {
              mergeData(newData, data);
            }
            func = newData[0];
            bitmask = newData[1];
            thisArg = newData[2];
            partials = newData[3];
            holders = newData[4];
            arity = newData[9] = newData[9] === undefined2 ? isBindKey ? 0 : func.length : nativeMax(newData[9] - length, 0);
            if (!arity && bitmask & (WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG)) {
              bitmask &= ~(WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG);
            }
            if (!bitmask || bitmask == WRAP_BIND_FLAG) {
              var result2 = createBind(func, bitmask, thisArg);
            } else if (bitmask == WRAP_CURRY_FLAG || bitmask == WRAP_CURRY_RIGHT_FLAG) {
              result2 = createCurry(func, bitmask, arity);
            } else if ((bitmask == WRAP_PARTIAL_FLAG || bitmask == (WRAP_BIND_FLAG | WRAP_PARTIAL_FLAG)) && !holders.length) {
              result2 = createPartial(func, bitmask, thisArg, partials);
            } else {
              result2 = createHybrid.apply(undefined2, newData);
            }
            var setter = data ? baseSetData : setData;
            return setWrapToString(setter(result2, newData), func, bitmask);
          }
          function customDefaultsAssignIn(objValue, srcValue, key, object) {
            if (objValue === undefined2 || eq(objValue, objectProto[key]) && !hasOwnProperty.call(object, key)) {
              return srcValue;
            }
            return objValue;
          }
          function customDefaultsMerge(objValue, srcValue, key, object, source, stack) {
            if (isObject2(objValue) && isObject2(srcValue)) {
              stack.set(srcValue, objValue);
              baseMerge(objValue, srcValue, undefined2, customDefaultsMerge, stack);
              stack["delete"](srcValue);
            }
            return objValue;
          }
          function customOmitClone(value) {
            return isPlainObject(value) ? undefined2 : value;
          }
          function equalArrays(array, other, bitmask, customizer, equalFunc, stack) {
            var isPartial = bitmask & COMPARE_PARTIAL_FLAG, arrLength = array.length, othLength = other.length;
            if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
              return false;
            }
            var arrStacked = stack.get(array);
            var othStacked = stack.get(other);
            if (arrStacked && othStacked) {
              return arrStacked == other && othStacked == array;
            }
            var index = -1, result2 = true, seen = bitmask & COMPARE_UNORDERED_FLAG ? new SetCache() : undefined2;
            stack.set(array, other);
            stack.set(other, array);
            while (++index < arrLength) {
              var arrValue = array[index], othValue = other[index];
              if (customizer) {
                var compared = isPartial ? customizer(othValue, arrValue, index, other, array, stack) : customizer(arrValue, othValue, index, array, other, stack);
              }
              if (compared !== undefined2) {
                if (compared) {
                  continue;
                }
                result2 = false;
                break;
              }
              if (seen) {
                if (!arraySome(other, function(othValue2, othIndex) {
                  if (!cacheHas(seen, othIndex) && (arrValue === othValue2 || equalFunc(arrValue, othValue2, bitmask, customizer, stack))) {
                    return seen.push(othIndex);
                  }
                })) {
                  result2 = false;
                  break;
                }
              } else if (!(arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
                result2 = false;
                break;
              }
            }
            stack["delete"](array);
            stack["delete"](other);
            return result2;
          }
          function equalByTag(object, other, tag, bitmask, customizer, equalFunc, stack) {
            switch (tag) {
              case dataViewTag:
                if (object.byteLength != other.byteLength || object.byteOffset != other.byteOffset) {
                  return false;
                }
                object = object.buffer;
                other = other.buffer;
              case arrayBufferTag:
                if (object.byteLength != other.byteLength || !equalFunc(new Uint8Array2(object), new Uint8Array2(other))) {
                  return false;
                }
                return true;
              case boolTag:
              case dateTag:
              case numberTag:
                return eq(+object, +other);
              case errorTag:
                return object.name == other.name && object.message == other.message;
              case regexpTag:
              case stringTag:
                return object == other + "";
              case mapTag:
                var convert = mapToArray;
              case setTag:
                var isPartial = bitmask & COMPARE_PARTIAL_FLAG;
                convert || (convert = setToArray);
                if (object.size != other.size && !isPartial) {
                  return false;
                }
                var stacked = stack.get(object);
                if (stacked) {
                  return stacked == other;
                }
                bitmask |= COMPARE_UNORDERED_FLAG;
                stack.set(object, other);
                var result2 = equalArrays(convert(object), convert(other), bitmask, customizer, equalFunc, stack);
                stack["delete"](object);
                return result2;
              case symbolTag:
                if (symbolValueOf) {
                  return symbolValueOf.call(object) == symbolValueOf.call(other);
                }
            }
            return false;
          }
          function equalObjects(object, other, bitmask, customizer, equalFunc, stack) {
            var isPartial = bitmask & COMPARE_PARTIAL_FLAG, objProps = getAllKeys(object), objLength = objProps.length, othProps = getAllKeys(other), othLength = othProps.length;
            if (objLength != othLength && !isPartial) {
              return false;
            }
            var index = objLength;
            while (index--) {
              var key = objProps[index];
              if (!(isPartial ? key in other : hasOwnProperty.call(other, key))) {
                return false;
              }
            }
            var objStacked = stack.get(object);
            var othStacked = stack.get(other);
            if (objStacked && othStacked) {
              return objStacked == other && othStacked == object;
            }
            var result2 = true;
            stack.set(object, other);
            stack.set(other, object);
            var skipCtor = isPartial;
            while (++index < objLength) {
              key = objProps[index];
              var objValue = object[key], othValue = other[key];
              if (customizer) {
                var compared = isPartial ? customizer(othValue, objValue, key, other, object, stack) : customizer(objValue, othValue, key, object, other, stack);
              }
              if (!(compared === undefined2 ? objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack) : compared)) {
                result2 = false;
                break;
              }
              skipCtor || (skipCtor = key == "constructor");
            }
            if (result2 && !skipCtor) {
              var objCtor = object.constructor, othCtor = other.constructor;
              if (objCtor != othCtor && ("constructor" in object && "constructor" in other) && !(typeof objCtor == "function" && objCtor instanceof objCtor && typeof othCtor == "function" && othCtor instanceof othCtor)) {
                result2 = false;
              }
            }
            stack["delete"](object);
            stack["delete"](other);
            return result2;
          }
          function flatRest(func) {
            return setToString(overRest(func, undefined2, flatten2), func + "");
          }
          function getAllKeys(object) {
            return baseGetAllKeys(object, keys2, getSymbols);
          }
          function getAllKeysIn(object) {
            return baseGetAllKeys(object, keysIn, getSymbolsIn);
          }
          var getData = !metaMap ? noop : function(func) {
            return metaMap.get(func);
          };
          function getFuncName(func) {
            var result2 = func.name + "", array = realNames[result2], length = hasOwnProperty.call(realNames, result2) ? array.length : 0;
            while (length--) {
              var data = array[length], otherFunc = data.func;
              if (otherFunc == null || otherFunc == func) {
                return data.name;
              }
            }
            return result2;
          }
          function getHolder(func) {
            var object = hasOwnProperty.call(lodash, "placeholder") ? lodash : func;
            return object.placeholder;
          }
          function getIteratee() {
            var result2 = lodash.iteratee || iteratee;
            result2 = result2 === iteratee ? baseIteratee : result2;
            return arguments.length ? result2(arguments[0], arguments[1]) : result2;
          }
          function getMapData(map3, key) {
            var data = map3.__data__;
            return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
          }
          function getMatchData(object) {
            var result2 = keys2(object), length = result2.length;
            while (length--) {
              var key = result2[length], value = object[key];
              result2[length] = [key, value, isStrictComparable(value)];
            }
            return result2;
          }
          function getNative(object, key) {
            var value = getValue(object, key);
            return baseIsNative(value) ? value : undefined2;
          }
          function getRawTag(value) {
            var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
            try {
              value[symToStringTag] = undefined2;
              var unmasked = true;
            } catch (e) {
            }
            var result2 = nativeObjectToString.call(value);
            if (unmasked) {
              if (isOwn) {
                value[symToStringTag] = tag;
              } else {
                delete value[symToStringTag];
              }
            }
            return result2;
          }
          var getSymbols = !nativeGetSymbols ? stubArray : function(object) {
            if (object == null) {
              return [];
            }
            object = Object2(object);
            return arrayFilter(nativeGetSymbols(object), function(symbol) {
              return propertyIsEnumerable.call(object, symbol);
            });
          };
          var getSymbolsIn = !nativeGetSymbols ? stubArray : function(object) {
            var result2 = [];
            while (object) {
              arrayPush(result2, getSymbols(object));
              object = getPrototype(object);
            }
            return result2;
          };
          var getTag = baseGetTag;
          if (DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag || Map2 && getTag(new Map2()) != mapTag || Promise2 && getTag(Promise2.resolve()) != promiseTag || Set && getTag(new Set()) != setTag || WeakMap && getTag(new WeakMap()) != weakMapTag) {
            getTag = function(value) {
              var result2 = baseGetTag(value), Ctor = result2 == objectTag ? value.constructor : undefined2, ctorString = Ctor ? toSource(Ctor) : "";
              if (ctorString) {
                switch (ctorString) {
                  case dataViewCtorString:
                    return dataViewTag;
                  case mapCtorString:
                    return mapTag;
                  case promiseCtorString:
                    return promiseTag;
                  case setCtorString:
                    return setTag;
                  case weakMapCtorString:
                    return weakMapTag;
                }
              }
              return result2;
            };
          }
          function getView(start, end, transforms) {
            var index = -1, length = transforms.length;
            while (++index < length) {
              var data = transforms[index], size2 = data.size;
              switch (data.type) {
                case "drop":
                  start += size2;
                  break;
                case "dropRight":
                  end -= size2;
                  break;
                case "take":
                  end = nativeMin(end, start + size2);
                  break;
                case "takeRight":
                  start = nativeMax(start, end - size2);
                  break;
              }
            }
            return { "start": start, "end": end };
          }
          function getWrapDetails(source) {
            var match = source.match(reWrapDetails);
            return match ? match[1].split(reSplitDetails) : [];
          }
          function hasPath(object, path, hasFunc) {
            path = castPath(path, object);
            var index = -1, length = path.length, result2 = false;
            while (++index < length) {
              var key = toKey(path[index]);
              if (!(result2 = object != null && hasFunc(object, key))) {
                break;
              }
              object = object[key];
            }
            if (result2 || ++index != length) {
              return result2;
            }
            length = object == null ? 0 : object.length;
            return !!length && isLength(length) && isIndex(key, length) && (isArray2(object) || isArguments(object));
          }
          function initCloneArray(array) {
            var length = array.length, result2 = new array.constructor(length);
            if (length && typeof array[0] == "string" && hasOwnProperty.call(array, "index")) {
              result2.index = array.index;
              result2.input = array.input;
            }
            return result2;
          }
          function initCloneObject(object) {
            return typeof object.constructor == "function" && !isPrototype(object) ? baseCreate(getPrototype(object)) : {};
          }
          function initCloneByTag(object, tag, isDeep) {
            var Ctor = object.constructor;
            switch (tag) {
              case arrayBufferTag:
                return cloneArrayBuffer(object);
              case boolTag:
              case dateTag:
                return new Ctor(+object);
              case dataViewTag:
                return cloneDataView(object, isDeep);
              case float32Tag:
              case float64Tag:
              case int8Tag:
              case int16Tag:
              case int32Tag:
              case uint8Tag:
              case uint8ClampedTag:
              case uint16Tag:
              case uint32Tag:
                return cloneTypedArray(object, isDeep);
              case mapTag:
                return new Ctor();
              case numberTag:
              case stringTag:
                return new Ctor(object);
              case regexpTag:
                return cloneRegExp(object);
              case setTag:
                return new Ctor();
              case symbolTag:
                return cloneSymbol(object);
            }
          }
          function insertWrapDetails(source, details) {
            var length = details.length;
            if (!length) {
              return source;
            }
            var lastIndex = length - 1;
            details[lastIndex] = (length > 1 ? "& " : "") + details[lastIndex];
            details = details.join(length > 2 ? ", " : " ");
            return source.replace(reWrapComment, "{\n/* [wrapped with " + details + "] */\n");
          }
          function isFlattenable(value) {
            return isArray2(value) || isArguments(value) || !!(spreadableSymbol && value && value[spreadableSymbol]);
          }
          function isIndex(value, length) {
            var type = typeof value;
            length = length == null ? MAX_SAFE_INTEGER : length;
            return !!length && (type == "number" || type != "symbol" && reIsUint.test(value)) && (value > -1 && value % 1 == 0 && value < length);
          }
          function isIterateeCall(value, index, object) {
            if (!isObject2(object)) {
              return false;
            }
            var type = typeof index;
            if (type == "number" ? isArrayLike(object) && isIndex(index, object.length) : type == "string" && index in object) {
              return eq(object[index], value);
            }
            return false;
          }
          function isKey(value, object) {
            if (isArray2(value)) {
              return false;
            }
            var type = typeof value;
            if (type == "number" || type == "symbol" || type == "boolean" || value == null || isSymbol(value)) {
              return true;
            }
            return reIsPlainProp.test(value) || !reIsDeepProp.test(value) || object != null && value in Object2(object);
          }
          function isKeyable(value) {
            var type = typeof value;
            return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
          }
          function isLaziable(func) {
            var funcName = getFuncName(func), other = lodash[funcName];
            if (typeof other != "function" || !(funcName in LazyWrapper.prototype)) {
              return false;
            }
            if (func === other) {
              return true;
            }
            var data = getData(other);
            return !!data && func === data[0];
          }
          function isMasked(func) {
            return !!maskSrcKey && maskSrcKey in func;
          }
          var isMaskable = coreJsData ? isFunction2 : stubFalse;
          function isPrototype(value) {
            var Ctor = value && value.constructor, proto = typeof Ctor == "function" && Ctor.prototype || objectProto;
            return value === proto;
          }
          function isStrictComparable(value) {
            return value === value && !isObject2(value);
          }
          function matchesStrictComparable(key, srcValue) {
            return function(object) {
              if (object == null) {
                return false;
              }
              return object[key] === srcValue && (srcValue !== undefined2 || key in Object2(object));
            };
          }
          function memoizeCapped(func) {
            var result2 = memoize(func, function(key) {
              if (cache.size === MAX_MEMOIZE_SIZE) {
                cache.clear();
              }
              return key;
            });
            var cache = result2.cache;
            return result2;
          }
          function mergeData(data, source) {
            var bitmask = data[1], srcBitmask = source[1], newBitmask = bitmask | srcBitmask, isCommon = newBitmask < (WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG | WRAP_ARY_FLAG);
            var isCombo = srcBitmask == WRAP_ARY_FLAG && bitmask == WRAP_CURRY_FLAG || srcBitmask == WRAP_ARY_FLAG && bitmask == WRAP_REARG_FLAG && data[7].length <= source[8] || srcBitmask == (WRAP_ARY_FLAG | WRAP_REARG_FLAG) && source[7].length <= source[8] && bitmask == WRAP_CURRY_FLAG;
            if (!(isCommon || isCombo)) {
              return data;
            }
            if (srcBitmask & WRAP_BIND_FLAG) {
              data[2] = source[2];
              newBitmask |= bitmask & WRAP_BIND_FLAG ? 0 : WRAP_CURRY_BOUND_FLAG;
            }
            var value = source[3];
            if (value) {
              var partials = data[3];
              data[3] = partials ? composeArgs(partials, value, source[4]) : value;
              data[4] = partials ? replaceHolders(data[3], PLACEHOLDER) : source[4];
            }
            value = source[5];
            if (value) {
              partials = data[5];
              data[5] = partials ? composeArgsRight(partials, value, source[6]) : value;
              data[6] = partials ? replaceHolders(data[5], PLACEHOLDER) : source[6];
            }
            value = source[7];
            if (value) {
              data[7] = value;
            }
            if (srcBitmask & WRAP_ARY_FLAG) {
              data[8] = data[8] == null ? source[8] : nativeMin(data[8], source[8]);
            }
            if (data[9] == null) {
              data[9] = source[9];
            }
            data[0] = source[0];
            data[1] = newBitmask;
            return data;
          }
          function nativeKeysIn(object) {
            var result2 = [];
            if (object != null) {
              for (var key in Object2(object)) {
                result2.push(key);
              }
            }
            return result2;
          }
          function objectToString(value) {
            return nativeObjectToString.call(value);
          }
          function overRest(func, start, transform2) {
            start = nativeMax(start === undefined2 ? func.length - 1 : start, 0);
            return function() {
              var args = arguments, index = -1, length = nativeMax(args.length - start, 0), array = Array2(length);
              while (++index < length) {
                array[index] = args[start + index];
              }
              index = -1;
              var otherArgs = Array2(start + 1);
              while (++index < start) {
                otherArgs[index] = args[index];
              }
              otherArgs[start] = transform2(array);
              return apply(func, this, otherArgs);
            };
          }
          function parent(object, path) {
            return path.length < 2 ? object : baseGet(object, baseSlice(path, 0, -1));
          }
          function reorder(array, indexes) {
            var arrLength = array.length, length = nativeMin(indexes.length, arrLength), oldArray = copyArray(array);
            while (length--) {
              var index = indexes[length];
              array[length] = isIndex(index, arrLength) ? oldArray[index] : undefined2;
            }
            return array;
          }
          function safeGet(object, key) {
            if (key === "constructor" && typeof object[key] === "function") {
              return;
            }
            if (key == "__proto__") {
              return;
            }
            return object[key];
          }
          var setData = shortOut(baseSetData);
          var setTimeout2 = ctxSetTimeout || function(func, wait) {
            return root.setTimeout(func, wait);
          };
          var setToString = shortOut(baseSetToString);
          function setWrapToString(wrapper, reference, bitmask) {
            var source = reference + "";
            return setToString(wrapper, insertWrapDetails(source, updateWrapDetails(getWrapDetails(source), bitmask)));
          }
          function shortOut(func) {
            var count = 0, lastCalled = 0;
            return function() {
              var stamp = nativeNow(), remaining = HOT_SPAN - (stamp - lastCalled);
              lastCalled = stamp;
              if (remaining > 0) {
                if (++count >= HOT_COUNT) {
                  return arguments[0];
                }
              } else {
                count = 0;
              }
              return func.apply(undefined2, arguments);
            };
          }
          function shuffleSelf(array, size2) {
            var index = -1, length = array.length, lastIndex = length - 1;
            size2 = size2 === undefined2 ? length : size2;
            while (++index < size2) {
              var rand = baseRandom(index, lastIndex), value = array[rand];
              array[rand] = array[index];
              array[index] = value;
            }
            array.length = size2;
            return array;
          }
          var stringToPath = memoizeCapped(function(string) {
            var result2 = [];
            if (string.charCodeAt(0) === 46) {
              result2.push("");
            }
            string.replace(rePropName, function(match, number, quote, subString) {
              result2.push(quote ? subString.replace(reEscapeChar, "$1") : number || match);
            });
            return result2;
          });
          function toKey(value) {
            if (typeof value == "string" || isSymbol(value)) {
              return value;
            }
            var result2 = value + "";
            return result2 == "0" && 1 / value == -INFINITY ? "-0" : result2;
          }
          function toSource(func) {
            if (func != null) {
              try {
                return funcToString.call(func);
              } catch (e) {
              }
              try {
                return func + "";
              } catch (e) {
              }
            }
            return "";
          }
          function updateWrapDetails(details, bitmask) {
            arrayEach(wrapFlags, function(pair) {
              var value = "_." + pair[0];
              if (bitmask & pair[1] && !arrayIncludes(details, value)) {
                details.push(value);
              }
            });
            return details.sort();
          }
          function wrapperClone(wrapper) {
            if (wrapper instanceof LazyWrapper) {
              return wrapper.clone();
            }
            var result2 = new LodashWrapper(wrapper.__wrapped__, wrapper.__chain__);
            result2.__actions__ = copyArray(wrapper.__actions__);
            result2.__index__ = wrapper.__index__;
            result2.__values__ = wrapper.__values__;
            return result2;
          }
          function chunk(array, size2, guard) {
            if (guard ? isIterateeCall(array, size2, guard) : size2 === undefined2) {
              size2 = 1;
            } else {
              size2 = nativeMax(toInteger(size2), 0);
            }
            var length = array == null ? 0 : array.length;
            if (!length || size2 < 1) {
              return [];
            }
            var index = 0, resIndex = 0, result2 = Array2(nativeCeil(length / size2));
            while (index < length) {
              result2[resIndex++] = baseSlice(array, index, index += size2);
            }
            return result2;
          }
          function compact2(array) {
            var index = -1, length = array == null ? 0 : array.length, resIndex = 0, result2 = [];
            while (++index < length) {
              var value = array[index];
              if (value) {
                result2[resIndex++] = value;
              }
            }
            return result2;
          }
          function concat() {
            var length = arguments.length;
            if (!length) {
              return [];
            }
            var args = Array2(length - 1), array = arguments[0], index = length;
            while (index--) {
              args[index - 1] = arguments[index];
            }
            return arrayPush(isArray2(array) ? copyArray(array) : [array], baseFlatten(args, 1));
          }
          var difference2 = baseRest(function(array, values3) {
            return isArrayLikeObject(array) ? baseDifference(array, baseFlatten(values3, 1, isArrayLikeObject, true)) : [];
          });
          var differenceBy = baseRest(function(array, values3) {
            var iteratee2 = last2(values3);
            if (isArrayLikeObject(iteratee2)) {
              iteratee2 = undefined2;
            }
            return isArrayLikeObject(array) ? baseDifference(array, baseFlatten(values3, 1, isArrayLikeObject, true), getIteratee(iteratee2, 2)) : [];
          });
          var differenceWith = baseRest(function(array, values3) {
            var comparator = last2(values3);
            if (isArrayLikeObject(comparator)) {
              comparator = undefined2;
            }
            return isArrayLikeObject(array) ? baseDifference(array, baseFlatten(values3, 1, isArrayLikeObject, true), undefined2, comparator) : [];
          });
          function drop2(array, n, guard) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            n = guard || n === undefined2 ? 1 : toInteger(n);
            return baseSlice(array, n < 0 ? 0 : n, length);
          }
          function dropRight2(array, n, guard) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            n = guard || n === undefined2 ? 1 : toInteger(n);
            n = length - n;
            return baseSlice(array, 0, n < 0 ? 0 : n);
          }
          function dropRightWhile(array, predicate) {
            return array && array.length ? baseWhile(array, getIteratee(predicate, 3), true, true) : [];
          }
          function dropWhile(array, predicate) {
            return array && array.length ? baseWhile(array, getIteratee(predicate, 3), true) : [];
          }
          function fill(array, value, start, end) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            if (start && typeof start != "number" && isIterateeCall(array, value, start)) {
              start = 0;
              end = length;
            }
            return baseFill(array, value, start, end);
          }
          function findIndex(array, predicate, fromIndex) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return -1;
            }
            var index = fromIndex == null ? 0 : toInteger(fromIndex);
            if (index < 0) {
              index = nativeMax(length + index, 0);
            }
            return baseFindIndex(array, getIteratee(predicate, 3), index);
          }
          function findLastIndex(array, predicate, fromIndex) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return -1;
            }
            var index = length - 1;
            if (fromIndex !== undefined2) {
              index = toInteger(fromIndex);
              index = fromIndex < 0 ? nativeMax(length + index, 0) : nativeMin(index, length - 1);
            }
            return baseFindIndex(array, getIteratee(predicate, 3), index, true);
          }
          function flatten2(array) {
            var length = array == null ? 0 : array.length;
            return length ? baseFlatten(array, 1) : [];
          }
          function flattenDeep(array) {
            var length = array == null ? 0 : array.length;
            return length ? baseFlatten(array, INFINITY) : [];
          }
          function flattenDepth(array, depth) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            depth = depth === undefined2 ? 1 : toInteger(depth);
            return baseFlatten(array, depth);
          }
          function fromPairs(pairs) {
            var index = -1, length = pairs == null ? 0 : pairs.length, result2 = {};
            while (++index < length) {
              var pair = pairs[index];
              result2[pair[0]] = pair[1];
            }
            return result2;
          }
          function head(array) {
            return array && array.length ? array[0] : undefined2;
          }
          function indexOf2(array, value, fromIndex) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return -1;
            }
            var index = fromIndex == null ? 0 : toInteger(fromIndex);
            if (index < 0) {
              index = nativeMax(length + index, 0);
            }
            return baseIndexOf(array, value, index);
          }
          function initial(array) {
            var length = array == null ? 0 : array.length;
            return length ? baseSlice(array, 0, -1) : [];
          }
          var intersection = baseRest(function(arrays) {
            var mapped = arrayMap(arrays, castArrayLikeObject);
            return mapped.length && mapped[0] === arrays[0] ? baseIntersection(mapped) : [];
          });
          var intersectionBy = baseRest(function(arrays) {
            var iteratee2 = last2(arrays), mapped = arrayMap(arrays, castArrayLikeObject);
            if (iteratee2 === last2(mapped)) {
              iteratee2 = undefined2;
            } else {
              mapped.pop();
            }
            return mapped.length && mapped[0] === arrays[0] ? baseIntersection(mapped, getIteratee(iteratee2, 2)) : [];
          });
          var intersectionWith = baseRest(function(arrays) {
            var comparator = last2(arrays), mapped = arrayMap(arrays, castArrayLikeObject);
            comparator = typeof comparator == "function" ? comparator : undefined2;
            if (comparator) {
              mapped.pop();
            }
            return mapped.length && mapped[0] === arrays[0] ? baseIntersection(mapped, undefined2, comparator) : [];
          });
          function join(array, separator) {
            return array == null ? "" : nativeJoin.call(array, separator);
          }
          function last2(array) {
            var length = array == null ? 0 : array.length;
            return length ? array[length - 1] : undefined2;
          }
          function lastIndexOf(array, value, fromIndex) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return -1;
            }
            var index = length;
            if (fromIndex !== undefined2) {
              index = toInteger(fromIndex);
              index = index < 0 ? nativeMax(length + index, 0) : nativeMin(index, length - 1);
            }
            return value === value ? strictLastIndexOf(array, value, index) : baseFindIndex(array, baseIsNaN, index, true);
          }
          function nth(array, n) {
            return array && array.length ? baseNth(array, toInteger(n)) : undefined2;
          }
          var pull = baseRest(pullAll);
          function pullAll(array, values3) {
            return array && array.length && values3 && values3.length ? basePullAll(array, values3) : array;
          }
          function pullAllBy(array, values3, iteratee2) {
            return array && array.length && values3 && values3.length ? basePullAll(array, values3, getIteratee(iteratee2, 2)) : array;
          }
          function pullAllWith(array, values3, comparator) {
            return array && array.length && values3 && values3.length ? basePullAll(array, values3, undefined2, comparator) : array;
          }
          var pullAt = flatRest(function(array, indexes) {
            var length = array == null ? 0 : array.length, result2 = baseAt(array, indexes);
            basePullAt(array, arrayMap(indexes, function(index) {
              return isIndex(index, length) ? +index : index;
            }).sort(compareAscending));
            return result2;
          });
          function remove(array, predicate) {
            var result2 = [];
            if (!(array && array.length)) {
              return result2;
            }
            var index = -1, indexes = [], length = array.length;
            predicate = getIteratee(predicate, 3);
            while (++index < length) {
              var value = array[index];
              if (predicate(value, index, array)) {
                result2.push(value);
                indexes.push(index);
              }
            }
            basePullAt(array, indexes);
            return result2;
          }
          function reverse(array) {
            return array == null ? array : nativeReverse.call(array);
          }
          function slice(array, start, end) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            if (end && typeof end != "number" && isIterateeCall(array, start, end)) {
              start = 0;
              end = length;
            } else {
              start = start == null ? 0 : toInteger(start);
              end = end === undefined2 ? length : toInteger(end);
            }
            return baseSlice(array, start, end);
          }
          function sortedIndex(array, value) {
            return baseSortedIndex(array, value);
          }
          function sortedIndexBy(array, value, iteratee2) {
            return baseSortedIndexBy(array, value, getIteratee(iteratee2, 2));
          }
          function sortedIndexOf(array, value) {
            var length = array == null ? 0 : array.length;
            if (length) {
              var index = baseSortedIndex(array, value);
              if (index < length && eq(array[index], value)) {
                return index;
              }
            }
            return -1;
          }
          function sortedLastIndex(array, value) {
            return baseSortedIndex(array, value, true);
          }
          function sortedLastIndexBy(array, value, iteratee2) {
            return baseSortedIndexBy(array, value, getIteratee(iteratee2, 2), true);
          }
          function sortedLastIndexOf(array, value) {
            var length = array == null ? 0 : array.length;
            if (length) {
              var index = baseSortedIndex(array, value, true) - 1;
              if (eq(array[index], value)) {
                return index;
              }
            }
            return -1;
          }
          function sortedUniq(array) {
            return array && array.length ? baseSortedUniq(array) : [];
          }
          function sortedUniqBy(array, iteratee2) {
            return array && array.length ? baseSortedUniq(array, getIteratee(iteratee2, 2)) : [];
          }
          function tail(array) {
            var length = array == null ? 0 : array.length;
            return length ? baseSlice(array, 1, length) : [];
          }
          function take(array, n, guard) {
            if (!(array && array.length)) {
              return [];
            }
            n = guard || n === undefined2 ? 1 : toInteger(n);
            return baseSlice(array, 0, n < 0 ? 0 : n);
          }
          function takeRight(array, n, guard) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            n = guard || n === undefined2 ? 1 : toInteger(n);
            n = length - n;
            return baseSlice(array, n < 0 ? 0 : n, length);
          }
          function takeRightWhile(array, predicate) {
            return array && array.length ? baseWhile(array, getIteratee(predicate, 3), false, true) : [];
          }
          function takeWhile(array, predicate) {
            return array && array.length ? baseWhile(array, getIteratee(predicate, 3)) : [];
          }
          var union = baseRest(function(arrays) {
            return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true));
          });
          var unionBy = baseRest(function(arrays) {
            var iteratee2 = last2(arrays);
            if (isArrayLikeObject(iteratee2)) {
              iteratee2 = undefined2;
            }
            return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true), getIteratee(iteratee2, 2));
          });
          var unionWith = baseRest(function(arrays) {
            var comparator = last2(arrays);
            comparator = typeof comparator == "function" ? comparator : undefined2;
            return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true), undefined2, comparator);
          });
          function uniq2(array) {
            return array && array.length ? baseUniq(array) : [];
          }
          function uniqBy(array, iteratee2) {
            return array && array.length ? baseUniq(array, getIteratee(iteratee2, 2)) : [];
          }
          function uniqWith(array, comparator) {
            comparator = typeof comparator == "function" ? comparator : undefined2;
            return array && array.length ? baseUniq(array, undefined2, comparator) : [];
          }
          function unzip(array) {
            if (!(array && array.length)) {
              return [];
            }
            var length = 0;
            array = arrayFilter(array, function(group) {
              if (isArrayLikeObject(group)) {
                length = nativeMax(group.length, length);
                return true;
              }
            });
            return baseTimes(length, function(index) {
              return arrayMap(array, baseProperty(index));
            });
          }
          function unzipWith(array, iteratee2) {
            if (!(array && array.length)) {
              return [];
            }
            var result2 = unzip(array);
            if (iteratee2 == null) {
              return result2;
            }
            return arrayMap(result2, function(group) {
              return apply(iteratee2, undefined2, group);
            });
          }
          var without = baseRest(function(array, values3) {
            return isArrayLikeObject(array) ? baseDifference(array, values3) : [];
          });
          var xor = baseRest(function(arrays) {
            return baseXor(arrayFilter(arrays, isArrayLikeObject));
          });
          var xorBy = baseRest(function(arrays) {
            var iteratee2 = last2(arrays);
            if (isArrayLikeObject(iteratee2)) {
              iteratee2 = undefined2;
            }
            return baseXor(arrayFilter(arrays, isArrayLikeObject), getIteratee(iteratee2, 2));
          });
          var xorWith = baseRest(function(arrays) {
            var comparator = last2(arrays);
            comparator = typeof comparator == "function" ? comparator : undefined2;
            return baseXor(arrayFilter(arrays, isArrayLikeObject), undefined2, comparator);
          });
          var zip = baseRest(unzip);
          function zipObject2(props, values3) {
            return baseZipObject(props || [], values3 || [], assignValue);
          }
          function zipObjectDeep(props, values3) {
            return baseZipObject(props || [], values3 || [], baseSet);
          }
          var zipWith = baseRest(function(arrays) {
            var length = arrays.length, iteratee2 = length > 1 ? arrays[length - 1] : undefined2;
            iteratee2 = typeof iteratee2 == "function" ? (arrays.pop(), iteratee2) : undefined2;
            return unzipWith(arrays, iteratee2);
          });
          function chain(value) {
            var result2 = lodash(value);
            result2.__chain__ = true;
            return result2;
          }
          function tap(value, interceptor) {
            interceptor(value);
            return value;
          }
          function thru(value, interceptor) {
            return interceptor(value);
          }
          var wrapperAt = flatRest(function(paths) {
            var length = paths.length, start = length ? paths[0] : 0, value = this.__wrapped__, interceptor = function(object) {
              return baseAt(object, paths);
            };
            if (length > 1 || this.__actions__.length || !(value instanceof LazyWrapper) || !isIndex(start)) {
              return this.thru(interceptor);
            }
            value = value.slice(start, +start + (length ? 1 : 0));
            value.__actions__.push({
              "func": thru,
              "args": [interceptor],
              "thisArg": undefined2
            });
            return new LodashWrapper(value, this.__chain__).thru(function(array) {
              if (length && !array.length) {
                array.push(undefined2);
              }
              return array;
            });
          });
          function wrapperChain() {
            return chain(this);
          }
          function wrapperCommit() {
            return new LodashWrapper(this.value(), this.__chain__);
          }
          function wrapperNext() {
            if (this.__values__ === undefined2) {
              this.__values__ = toArray(this.value());
            }
            var done = this.__index__ >= this.__values__.length, value = done ? undefined2 : this.__values__[this.__index__++];
            return { "done": done, "value": value };
          }
          function wrapperToIterator() {
            return this;
          }
          function wrapperPlant(value) {
            var result2, parent2 = this;
            while (parent2 instanceof baseLodash) {
              var clone2 = wrapperClone(parent2);
              clone2.__index__ = 0;
              clone2.__values__ = undefined2;
              if (result2) {
                previous.__wrapped__ = clone2;
              } else {
                result2 = clone2;
              }
              var previous = clone2;
              parent2 = parent2.__wrapped__;
            }
            previous.__wrapped__ = value;
            return result2;
          }
          function wrapperReverse() {
            var value = this.__wrapped__;
            if (value instanceof LazyWrapper) {
              var wrapped = value;
              if (this.__actions__.length) {
                wrapped = new LazyWrapper(this);
              }
              wrapped = wrapped.reverse();
              wrapped.__actions__.push({
                "func": thru,
                "args": [reverse],
                "thisArg": undefined2
              });
              return new LodashWrapper(wrapped, this.__chain__);
            }
            return this.thru(reverse);
          }
          function wrapperValue() {
            return baseWrapperValue(this.__wrapped__, this.__actions__);
          }
          var countBy = createAggregator(function(result2, value, key) {
            if (hasOwnProperty.call(result2, key)) {
              ++result2[key];
            } else {
              baseAssignValue(result2, key, 1);
            }
          });
          function every2(collection, predicate, guard) {
            var func = isArray2(collection) ? arrayEvery : baseEvery;
            if (guard && isIterateeCall(collection, predicate, guard)) {
              predicate = undefined2;
            }
            return func(collection, getIteratee(predicate, 3));
          }
          function filter2(collection, predicate) {
            var func = isArray2(collection) ? arrayFilter : baseFilter;
            return func(collection, getIteratee(predicate, 3));
          }
          var find2 = createFind(findIndex);
          var findLast = createFind(findLastIndex);
          function flatMap(collection, iteratee2) {
            return baseFlatten(map2(collection, iteratee2), 1);
          }
          function flatMapDeep(collection, iteratee2) {
            return baseFlatten(map2(collection, iteratee2), INFINITY);
          }
          function flatMapDepth(collection, iteratee2, depth) {
            depth = depth === undefined2 ? 1 : toInteger(depth);
            return baseFlatten(map2(collection, iteratee2), depth);
          }
          function forEach2(collection, iteratee2) {
            var func = isArray2(collection) ? arrayEach : baseEach;
            return func(collection, getIteratee(iteratee2, 3));
          }
          function forEachRight(collection, iteratee2) {
            var func = isArray2(collection) ? arrayEachRight : baseEachRight;
            return func(collection, getIteratee(iteratee2, 3));
          }
          var groupBy2 = createAggregator(function(result2, value, key) {
            if (hasOwnProperty.call(result2, key)) {
              result2[key].push(value);
            } else {
              baseAssignValue(result2, key, [value]);
            }
          });
          function includes(collection, value, fromIndex, guard) {
            collection = isArrayLike(collection) ? collection : values2(collection);
            fromIndex = fromIndex && !guard ? toInteger(fromIndex) : 0;
            var length = collection.length;
            if (fromIndex < 0) {
              fromIndex = nativeMax(length + fromIndex, 0);
            }
            return isString2(collection) ? fromIndex <= length && collection.indexOf(value, fromIndex) > -1 : !!length && baseIndexOf(collection, value, fromIndex) > -1;
          }
          var invokeMap = baseRest(function(collection, path, args) {
            var index = -1, isFunc = typeof path == "function", result2 = isArrayLike(collection) ? Array2(collection.length) : [];
            baseEach(collection, function(value) {
              result2[++index] = isFunc ? apply(path, value, args) : baseInvoke(value, path, args);
            });
            return result2;
          });
          var keyBy = createAggregator(function(result2, value, key) {
            baseAssignValue(result2, key, value);
          });
          function map2(collection, iteratee2) {
            var func = isArray2(collection) ? arrayMap : baseMap;
            return func(collection, getIteratee(iteratee2, 3));
          }
          function orderBy(collection, iteratees, orders, guard) {
            if (collection == null) {
              return [];
            }
            if (!isArray2(iteratees)) {
              iteratees = iteratees == null ? [] : [iteratees];
            }
            orders = guard ? undefined2 : orders;
            if (!isArray2(orders)) {
              orders = orders == null ? [] : [orders];
            }
            return baseOrderBy(collection, iteratees, orders);
          }
          var partition = createAggregator(function(result2, value, key) {
            result2[key ? 0 : 1].push(value);
          }, function() {
            return [[], []];
          });
          function reduce2(collection, iteratee2, accumulator) {
            var func = isArray2(collection) ? arrayReduce : baseReduce, initAccum = arguments.length < 3;
            return func(collection, getIteratee(iteratee2, 4), accumulator, initAccum, baseEach);
          }
          function reduceRight(collection, iteratee2, accumulator) {
            var func = isArray2(collection) ? arrayReduceRight : baseReduce, initAccum = arguments.length < 3;
            return func(collection, getIteratee(iteratee2, 4), accumulator, initAccum, baseEachRight);
          }
          function reject2(collection, predicate) {
            var func = isArray2(collection) ? arrayFilter : baseFilter;
            return func(collection, negate(getIteratee(predicate, 3)));
          }
          function sample(collection) {
            var func = isArray2(collection) ? arraySample : baseSample;
            return func(collection);
          }
          function sampleSize(collection, n, guard) {
            if (guard ? isIterateeCall(collection, n, guard) : n === undefined2) {
              n = 1;
            } else {
              n = toInteger(n);
            }
            var func = isArray2(collection) ? arraySampleSize : baseSampleSize;
            return func(collection, n);
          }
          function shuffle(collection) {
            var func = isArray2(collection) ? arrayShuffle : baseShuffle;
            return func(collection);
          }
          function size(collection) {
            if (collection == null) {
              return 0;
            }
            if (isArrayLike(collection)) {
              return isString2(collection) ? stringSize(collection) : collection.length;
            }
            var tag = getTag(collection);
            if (tag == mapTag || tag == setTag) {
              return collection.size;
            }
            return baseKeys(collection).length;
          }
          function some2(collection, predicate, guard) {
            var func = isArray2(collection) ? arraySome : baseSome;
            if (guard && isIterateeCall(collection, predicate, guard)) {
              predicate = undefined2;
            }
            return func(collection, getIteratee(predicate, 3));
          }
          var sortBy2 = baseRest(function(collection, iteratees) {
            if (collection == null) {
              return [];
            }
            var length = iteratees.length;
            if (length > 1 && isIterateeCall(collection, iteratees[0], iteratees[1])) {
              iteratees = [];
            } else if (length > 2 && isIterateeCall(iteratees[0], iteratees[1], iteratees[2])) {
              iteratees = [iteratees[0]];
            }
            return baseOrderBy(collection, baseFlatten(iteratees, 1), []);
          });
          var now = ctxNow || function() {
            return root.Date.now();
          };
          function after(n, func) {
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            n = toInteger(n);
            return function() {
              if (--n < 1) {
                return func.apply(this, arguments);
              }
            };
          }
          function ary(func, n, guard) {
            n = guard ? undefined2 : n;
            n = func && n == null ? func.length : n;
            return createWrap(func, WRAP_ARY_FLAG, undefined2, undefined2, undefined2, undefined2, n);
          }
          function before(n, func) {
            var result2;
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            n = toInteger(n);
            return function() {
              if (--n > 0) {
                result2 = func.apply(this, arguments);
              }
              if (n <= 1) {
                func = undefined2;
              }
              return result2;
            };
          }
          var bind = baseRest(function(func, thisArg, partials) {
            var bitmask = WRAP_BIND_FLAG;
            if (partials.length) {
              var holders = replaceHolders(partials, getHolder(bind));
              bitmask |= WRAP_PARTIAL_FLAG;
            }
            return createWrap(func, bitmask, thisArg, partials, holders);
          });
          var bindKey = baseRest(function(object, key, partials) {
            var bitmask = WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG;
            if (partials.length) {
              var holders = replaceHolders(partials, getHolder(bindKey));
              bitmask |= WRAP_PARTIAL_FLAG;
            }
            return createWrap(key, bitmask, object, partials, holders);
          });
          function curry(func, arity, guard) {
            arity = guard ? undefined2 : arity;
            var result2 = createWrap(func, WRAP_CURRY_FLAG, undefined2, undefined2, undefined2, undefined2, undefined2, arity);
            result2.placeholder = curry.placeholder;
            return result2;
          }
          function curryRight(func, arity, guard) {
            arity = guard ? undefined2 : arity;
            var result2 = createWrap(func, WRAP_CURRY_RIGHT_FLAG, undefined2, undefined2, undefined2, undefined2, undefined2, arity);
            result2.placeholder = curryRight.placeholder;
            return result2;
          }
          function debounce(func, wait, options) {
            var lastArgs, lastThis, maxWait, result2, timerId, lastCallTime, lastInvokeTime = 0, leading = false, maxing = false, trailing = true;
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            wait = toNumber(wait) || 0;
            if (isObject2(options)) {
              leading = !!options.leading;
              maxing = "maxWait" in options;
              maxWait = maxing ? nativeMax(toNumber(options.maxWait) || 0, wait) : maxWait;
              trailing = "trailing" in options ? !!options.trailing : trailing;
            }
            function invokeFunc(time) {
              var args = lastArgs, thisArg = lastThis;
              lastArgs = lastThis = undefined2;
              lastInvokeTime = time;
              result2 = func.apply(thisArg, args);
              return result2;
            }
            function leadingEdge(time) {
              lastInvokeTime = time;
              timerId = setTimeout2(timerExpired, wait);
              return leading ? invokeFunc(time) : result2;
            }
            function remainingWait(time) {
              var timeSinceLastCall = time - lastCallTime, timeSinceLastInvoke = time - lastInvokeTime, timeWaiting = wait - timeSinceLastCall;
              return maxing ? nativeMin(timeWaiting, maxWait - timeSinceLastInvoke) : timeWaiting;
            }
            function shouldInvoke(time) {
              var timeSinceLastCall = time - lastCallTime, timeSinceLastInvoke = time - lastInvokeTime;
              return lastCallTime === undefined2 || timeSinceLastCall >= wait || timeSinceLastCall < 0 || maxing && timeSinceLastInvoke >= maxWait;
            }
            function timerExpired() {
              var time = now();
              if (shouldInvoke(time)) {
                return trailingEdge(time);
              }
              timerId = setTimeout2(timerExpired, remainingWait(time));
            }
            function trailingEdge(time) {
              timerId = undefined2;
              if (trailing && lastArgs) {
                return invokeFunc(time);
              }
              lastArgs = lastThis = undefined2;
              return result2;
            }
            function cancel() {
              if (timerId !== undefined2) {
                clearTimeout2(timerId);
              }
              lastInvokeTime = 0;
              lastArgs = lastCallTime = lastThis = timerId = undefined2;
            }
            function flush() {
              return timerId === undefined2 ? result2 : trailingEdge(now());
            }
            function debounced() {
              var time = now(), isInvoking = shouldInvoke(time);
              lastArgs = arguments;
              lastThis = this;
              lastCallTime = time;
              if (isInvoking) {
                if (timerId === undefined2) {
                  return leadingEdge(lastCallTime);
                }
                if (maxing) {
                  clearTimeout2(timerId);
                  timerId = setTimeout2(timerExpired, wait);
                  return invokeFunc(lastCallTime);
                }
              }
              if (timerId === undefined2) {
                timerId = setTimeout2(timerExpired, wait);
              }
              return result2;
            }
            debounced.cancel = cancel;
            debounced.flush = flush;
            return debounced;
          }
          var defer = baseRest(function(func, args) {
            return baseDelay(func, 1, args);
          });
          var delay = baseRest(function(func, wait, args) {
            return baseDelay(func, toNumber(wait) || 0, args);
          });
          function flip(func) {
            return createWrap(func, WRAP_FLIP_FLAG);
          }
          function memoize(func, resolver) {
            if (typeof func != "function" || resolver != null && typeof resolver != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            var memoized = function() {
              var args = arguments, key = resolver ? resolver.apply(this, args) : args[0], cache = memoized.cache;
              if (cache.has(key)) {
                return cache.get(key);
              }
              var result2 = func.apply(this, args);
              memoized.cache = cache.set(key, result2) || cache;
              return result2;
            };
            memoized.cache = new (memoize.Cache || MapCache)();
            return memoized;
          }
          memoize.Cache = MapCache;
          function negate(predicate) {
            if (typeof predicate != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            return function() {
              var args = arguments;
              switch (args.length) {
                case 0:
                  return !predicate.call(this);
                case 1:
                  return !predicate.call(this, args[0]);
                case 2:
                  return !predicate.call(this, args[0], args[1]);
                case 3:
                  return !predicate.call(this, args[0], args[1], args[2]);
              }
              return !predicate.apply(this, args);
            };
          }
          function once(func) {
            return before(2, func);
          }
          var overArgs = castRest(function(func, transforms) {
            transforms = transforms.length == 1 && isArray2(transforms[0]) ? arrayMap(transforms[0], baseUnary(getIteratee())) : arrayMap(baseFlatten(transforms, 1), baseUnary(getIteratee()));
            var funcsLength = transforms.length;
            return baseRest(function(args) {
              var index = -1, length = nativeMin(args.length, funcsLength);
              while (++index < length) {
                args[index] = transforms[index].call(this, args[index]);
              }
              return apply(func, this, args);
            });
          });
          var partial2 = baseRest(function(func, partials) {
            var holders = replaceHolders(partials, getHolder(partial2));
            return createWrap(func, WRAP_PARTIAL_FLAG, undefined2, partials, holders);
          });
          var partialRight = baseRest(function(func, partials) {
            var holders = replaceHolders(partials, getHolder(partialRight));
            return createWrap(func, WRAP_PARTIAL_RIGHT_FLAG, undefined2, partials, holders);
          });
          var rearg = flatRest(function(func, indexes) {
            return createWrap(func, WRAP_REARG_FLAG, undefined2, undefined2, undefined2, indexes);
          });
          function rest(func, start) {
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            start = start === undefined2 ? start : toInteger(start);
            return baseRest(func, start);
          }
          function spread(func, start) {
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            start = start == null ? 0 : nativeMax(toInteger(start), 0);
            return baseRest(function(args) {
              var array = args[start], otherArgs = castSlice(args, 0, start);
              if (array) {
                arrayPush(otherArgs, array);
              }
              return apply(func, this, otherArgs);
            });
          }
          function throttle(func, wait, options) {
            var leading = true, trailing = true;
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            if (isObject2(options)) {
              leading = "leading" in options ? !!options.leading : leading;
              trailing = "trailing" in options ? !!options.trailing : trailing;
            }
            return debounce(func, wait, {
              "leading": leading,
              "maxWait": wait,
              "trailing": trailing
            });
          }
          function unary(func) {
            return ary(func, 1);
          }
          function wrap(value, wrapper) {
            return partial2(castFunction(wrapper), value);
          }
          function castArray() {
            if (!arguments.length) {
              return [];
            }
            var value = arguments[0];
            return isArray2(value) ? value : [value];
          }
          function clone(value) {
            return baseClone(value, CLONE_SYMBOLS_FLAG);
          }
          function cloneWith(value, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return baseClone(value, CLONE_SYMBOLS_FLAG, customizer);
          }
          function cloneDeep(value) {
            return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG);
          }
          function cloneDeepWith(value, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG, customizer);
          }
          function conformsTo(object, source) {
            return source == null || baseConformsTo(object, source, keys2(source));
          }
          function eq(value, other) {
            return value === other || value !== value && other !== other;
          }
          var gt = createRelationalOperation(baseGt);
          var gte = createRelationalOperation(function(value, other) {
            return value >= other;
          });
          var isArguments = baseIsArguments(/* @__PURE__ */ (function() {
            return arguments;
          })()) ? baseIsArguments : function(value) {
            return isObjectLike(value) && hasOwnProperty.call(value, "callee") && !propertyIsEnumerable.call(value, "callee");
          };
          var isArray2 = Array2.isArray;
          var isArrayBuffer = nodeIsArrayBuffer ? baseUnary(nodeIsArrayBuffer) : baseIsArrayBuffer;
          function isArrayLike(value) {
            return value != null && isLength(value.length) && !isFunction2(value);
          }
          function isArrayLikeObject(value) {
            return isObjectLike(value) && isArrayLike(value);
          }
          function isBoolean(value) {
            return value === true || value === false || isObjectLike(value) && baseGetTag(value) == boolTag;
          }
          var isBuffer = nativeIsBuffer || stubFalse;
          var isDate = nodeIsDate ? baseUnary(nodeIsDate) : baseIsDate;
          function isElement(value) {
            return isObjectLike(value) && value.nodeType === 1 && !isPlainObject(value);
          }
          function isEmpty2(value) {
            if (value == null) {
              return true;
            }
            if (isArrayLike(value) && (isArray2(value) || typeof value == "string" || typeof value.splice == "function" || isBuffer(value) || isTypedArray(value) || isArguments(value))) {
              return !value.length;
            }
            var tag = getTag(value);
            if (tag == mapTag || tag == setTag) {
              return !value.size;
            }
            if (isPrototype(value)) {
              return !baseKeys(value).length;
            }
            for (var key in value) {
              if (hasOwnProperty.call(value, key)) {
                return false;
              }
            }
            return true;
          }
          function isEqual(value, other) {
            return baseIsEqual(value, other);
          }
          function isEqualWith(value, other, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            var result2 = customizer ? customizer(value, other) : undefined2;
            return result2 === undefined2 ? baseIsEqual(value, other, undefined2, customizer) : !!result2;
          }
          function isError(value) {
            if (!isObjectLike(value)) {
              return false;
            }
            var tag = baseGetTag(value);
            return tag == errorTag || tag == domExcTag || typeof value.message == "string" && typeof value.name == "string" && !isPlainObject(value);
          }
          function isFinite(value) {
            return typeof value == "number" && nativeIsFinite(value);
          }
          function isFunction2(value) {
            if (!isObject2(value)) {
              return false;
            }
            var tag = baseGetTag(value);
            return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
          }
          function isInteger(value) {
            return typeof value == "number" && value == toInteger(value);
          }
          function isLength(value) {
            return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
          }
          function isObject2(value) {
            var type = typeof value;
            return value != null && (type == "object" || type == "function");
          }
          function isObjectLike(value) {
            return value != null && typeof value == "object";
          }
          var isMap = nodeIsMap ? baseUnary(nodeIsMap) : baseIsMap;
          function isMatch(object, source) {
            return object === source || baseIsMatch(object, source, getMatchData(source));
          }
          function isMatchWith(object, source, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return baseIsMatch(object, source, getMatchData(source), customizer);
          }
          function isNaN2(value) {
            return isNumber(value) && value != +value;
          }
          function isNative(value) {
            if (isMaskable(value)) {
              throw new Error2(CORE_ERROR_TEXT);
            }
            return baseIsNative(value);
          }
          function isNull(value) {
            return value === null;
          }
          function isNil(value) {
            return value == null;
          }
          function isNumber(value) {
            return typeof value == "number" || isObjectLike(value) && baseGetTag(value) == numberTag;
          }
          function isPlainObject(value) {
            if (!isObjectLike(value) || baseGetTag(value) != objectTag) {
              return false;
            }
            var proto = getPrototype(value);
            if (proto === null) {
              return true;
            }
            var Ctor = hasOwnProperty.call(proto, "constructor") && proto.constructor;
            return typeof Ctor == "function" && Ctor instanceof Ctor && funcToString.call(Ctor) == objectCtorString;
          }
          var isRegExp2 = nodeIsRegExp ? baseUnary(nodeIsRegExp) : baseIsRegExp;
          function isSafeInteger(value) {
            return isInteger(value) && value >= -MAX_SAFE_INTEGER && value <= MAX_SAFE_INTEGER;
          }
          var isSet = nodeIsSet ? baseUnary(nodeIsSet) : baseIsSet;
          function isString2(value) {
            return typeof value == "string" || !isArray2(value) && isObjectLike(value) && baseGetTag(value) == stringTag;
          }
          function isSymbol(value) {
            return typeof value == "symbol" || isObjectLike(value) && baseGetTag(value) == symbolTag;
          }
          var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
          function isUndefined2(value) {
            return value === undefined2;
          }
          function isWeakMap(value) {
            return isObjectLike(value) && getTag(value) == weakMapTag;
          }
          function isWeakSet(value) {
            return isObjectLike(value) && baseGetTag(value) == weakSetTag;
          }
          var lt = createRelationalOperation(baseLt);
          var lte = createRelationalOperation(function(value, other) {
            return value <= other;
          });
          function toArray(value) {
            if (!value) {
              return [];
            }
            if (isArrayLike(value)) {
              return isString2(value) ? stringToArray(value) : copyArray(value);
            }
            if (symIterator && value[symIterator]) {
              return iteratorToArray(value[symIterator]());
            }
            var tag = getTag(value), func = tag == mapTag ? mapToArray : tag == setTag ? setToArray : values2;
            return func(value);
          }
          function toFinite(value) {
            if (!value) {
              return value === 0 ? value : 0;
            }
            value = toNumber(value);
            if (value === INFINITY || value === -INFINITY) {
              var sign = value < 0 ? -1 : 1;
              return sign * MAX_INTEGER;
            }
            return value === value ? value : 0;
          }
          function toInteger(value) {
            var result2 = toFinite(value), remainder = result2 % 1;
            return result2 === result2 ? remainder ? result2 - remainder : result2 : 0;
          }
          function toLength(value) {
            return value ? baseClamp(toInteger(value), 0, MAX_ARRAY_LENGTH) : 0;
          }
          function toNumber(value) {
            if (typeof value == "number") {
              return value;
            }
            if (isSymbol(value)) {
              return NAN;
            }
            if (isObject2(value)) {
              var other = typeof value.valueOf == "function" ? value.valueOf() : value;
              value = isObject2(other) ? other + "" : other;
            }
            if (typeof value != "string") {
              return value === 0 ? value : +value;
            }
            value = baseTrim(value);
            var isBinary = reIsBinary.test(value);
            return isBinary || reIsOctal.test(value) ? freeParseInt(value.slice(2), isBinary ? 2 : 8) : reIsBadHex.test(value) ? NAN : +value;
          }
          function toPlainObject(value) {
            return copyObject(value, keysIn(value));
          }
          function toSafeInteger(value) {
            return value ? baseClamp(toInteger(value), -MAX_SAFE_INTEGER, MAX_SAFE_INTEGER) : value === 0 ? value : 0;
          }
          function toString(value) {
            return value == null ? "" : baseToString(value);
          }
          var assign2 = createAssigner(function(object, source) {
            if (isPrototype(source) || isArrayLike(source)) {
              copyObject(source, keys2(source), object);
              return;
            }
            for (var key in source) {
              if (hasOwnProperty.call(source, key)) {
                assignValue(object, key, source[key]);
              }
            }
          });
          var assignIn = createAssigner(function(object, source) {
            copyObject(source, keysIn(source), object);
          });
          var assignInWith = createAssigner(function(object, source, srcIndex, customizer) {
            copyObject(source, keysIn(source), object, customizer);
          });
          var assignWith = createAssigner(function(object, source, srcIndex, customizer) {
            copyObject(source, keys2(source), object, customizer);
          });
          var at = flatRest(baseAt);
          function create(prototype, properties) {
            var result2 = baseCreate(prototype);
            return properties == null ? result2 : baseAssign(result2, properties);
          }
          var defaults2 = baseRest(function(object, sources) {
            object = Object2(object);
            var index = -1;
            var length = sources.length;
            var guard = length > 2 ? sources[2] : undefined2;
            if (guard && isIterateeCall(sources[0], sources[1], guard)) {
              length = 1;
            }
            while (++index < length) {
              var source = sources[index];
              var props = keysIn(source);
              var propsIndex = -1;
              var propsLength = props.length;
              while (++propsIndex < propsLength) {
                var key = props[propsIndex];
                var value = object[key];
                if (value === undefined2 || eq(value, objectProto[key]) && !hasOwnProperty.call(object, key)) {
                  object[key] = source[key];
                }
              }
            }
            return object;
          });
          var defaultsDeep = baseRest(function(args) {
            args.push(undefined2, customDefaultsMerge);
            return apply(mergeWith, undefined2, args);
          });
          function findKey(object, predicate) {
            return baseFindKey(object, getIteratee(predicate, 3), baseForOwn);
          }
          function findLastKey(object, predicate) {
            return baseFindKey(object, getIteratee(predicate, 3), baseForOwnRight);
          }
          function forIn(object, iteratee2) {
            return object == null ? object : baseFor(object, getIteratee(iteratee2, 3), keysIn);
          }
          function forInRight(object, iteratee2) {
            return object == null ? object : baseForRight(object, getIteratee(iteratee2, 3), keysIn);
          }
          function forOwn(object, iteratee2) {
            return object && baseForOwn(object, getIteratee(iteratee2, 3));
          }
          function forOwnRight(object, iteratee2) {
            return object && baseForOwnRight(object, getIteratee(iteratee2, 3));
          }
          function functions(object) {
            return object == null ? [] : baseFunctions(object, keys2(object));
          }
          function functionsIn(object) {
            return object == null ? [] : baseFunctions(object, keysIn(object));
          }
          function get(object, path, defaultValue) {
            var result2 = object == null ? undefined2 : baseGet(object, path);
            return result2 === undefined2 ? defaultValue : result2;
          }
          function has2(object, path) {
            return object != null && hasPath(object, path, baseHas);
          }
          function hasIn(object, path) {
            return object != null && hasPath(object, path, baseHasIn);
          }
          var invert = createInverter(function(result2, value, key) {
            if (value != null && typeof value.toString != "function") {
              value = nativeObjectToString.call(value);
            }
            result2[value] = key;
          }, constant(identity));
          var invertBy = createInverter(function(result2, value, key) {
            if (value != null && typeof value.toString != "function") {
              value = nativeObjectToString.call(value);
            }
            if (hasOwnProperty.call(result2, value)) {
              result2[value].push(key);
            } else {
              result2[value] = [key];
            }
          }, getIteratee);
          var invoke = baseRest(baseInvoke);
          function keys2(object) {
            return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
          }
          function keysIn(object) {
            return isArrayLike(object) ? arrayLikeKeys(object, true) : baseKeysIn(object);
          }
          function mapKeys(object, iteratee2) {
            var result2 = {};
            iteratee2 = getIteratee(iteratee2, 3);
            baseForOwn(object, function(value, key, object2) {
              baseAssignValue(result2, iteratee2(value, key, object2), value);
            });
            return result2;
          }
          function mapValues2(object, iteratee2) {
            var result2 = {};
            iteratee2 = getIteratee(iteratee2, 3);
            baseForOwn(object, function(value, key, object2) {
              baseAssignValue(result2, key, iteratee2(value, key, object2));
            });
            return result2;
          }
          var merge2 = createAssigner(function(object, source, srcIndex) {
            baseMerge(object, source, srcIndex);
          });
          var mergeWith = createAssigner(function(object, source, srcIndex, customizer) {
            baseMerge(object, source, srcIndex, customizer);
          });
          var omit = flatRest(function(object, paths) {
            var result2 = {};
            if (object == null) {
              return result2;
            }
            var isDeep = false;
            paths = arrayMap(paths, function(path) {
              path = castPath(path, object);
              isDeep || (isDeep = path.length > 1);
              return path;
            });
            copyObject(object, getAllKeysIn(object), result2);
            if (isDeep) {
              result2 = baseClone(result2, CLONE_DEEP_FLAG | CLONE_FLAT_FLAG | CLONE_SYMBOLS_FLAG, customOmitClone);
            }
            var length = paths.length;
            while (length--) {
              baseUnset(result2, paths[length]);
            }
            return result2;
          });
          function omitBy(object, predicate) {
            return pickBy(object, negate(getIteratee(predicate)));
          }
          var pick2 = flatRest(function(object, paths) {
            return object == null ? {} : basePick(object, paths);
          });
          function pickBy(object, predicate) {
            if (object == null) {
              return {};
            }
            var props = arrayMap(getAllKeysIn(object), function(prop) {
              return [prop];
            });
            predicate = getIteratee(predicate);
            return basePickBy(object, props, function(value, path) {
              return predicate(value, path[0]);
            });
          }
          function result(object, path, defaultValue) {
            path = castPath(path, object);
            var index = -1, length = path.length;
            if (!length) {
              length = 1;
              object = undefined2;
            }
            while (++index < length) {
              var value = object == null ? undefined2 : object[toKey(path[index])];
              if (value === undefined2) {
                index = length;
                value = defaultValue;
              }
              object = isFunction2(value) ? value.call(object) : value;
            }
            return object;
          }
          function set(object, path, value) {
            return object == null ? object : baseSet(object, path, value);
          }
          function setWith(object, path, value, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return object == null ? object : baseSet(object, path, value, customizer);
          }
          var toPairs = createToPairs(keys2);
          var toPairsIn = createToPairs(keysIn);
          function transform(object, iteratee2, accumulator) {
            var isArr = isArray2(object), isArrLike = isArr || isBuffer(object) || isTypedArray(object);
            iteratee2 = getIteratee(iteratee2, 4);
            if (accumulator == null) {
              var Ctor = object && object.constructor;
              if (isArrLike) {
                accumulator = isArr ? new Ctor() : [];
              } else if (isObject2(object)) {
                accumulator = isFunction2(Ctor) ? baseCreate(getPrototype(object)) : {};
              } else {
                accumulator = {};
              }
            }
            (isArrLike ? arrayEach : baseForOwn)(object, function(value, index, object2) {
              return iteratee2(accumulator, value, index, object2);
            });
            return accumulator;
          }
          function unset(object, path) {
            return object == null ? true : baseUnset(object, path);
          }
          function update(object, path, updater) {
            return object == null ? object : baseUpdate(object, path, castFunction(updater));
          }
          function updateWith(object, path, updater, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return object == null ? object : baseUpdate(object, path, castFunction(updater), customizer);
          }
          function values2(object) {
            return object == null ? [] : baseValues(object, keys2(object));
          }
          function valuesIn(object) {
            return object == null ? [] : baseValues(object, keysIn(object));
          }
          function clamp(number, lower, upper) {
            if (upper === undefined2) {
              upper = lower;
              lower = undefined2;
            }
            if (upper !== undefined2) {
              upper = toNumber(upper);
              upper = upper === upper ? upper : 0;
            }
            if (lower !== undefined2) {
              lower = toNumber(lower);
              lower = lower === lower ? lower : 0;
            }
            return baseClamp(toNumber(number), lower, upper);
          }
          function inRange(number, start, end) {
            start = toFinite(start);
            if (end === undefined2) {
              end = start;
              start = 0;
            } else {
              end = toFinite(end);
            }
            number = toNumber(number);
            return baseInRange(number, start, end);
          }
          function random(lower, upper, floating) {
            if (floating && typeof floating != "boolean" && isIterateeCall(lower, upper, floating)) {
              upper = floating = undefined2;
            }
            if (floating === undefined2) {
              if (typeof upper == "boolean") {
                floating = upper;
                upper = undefined2;
              } else if (typeof lower == "boolean") {
                floating = lower;
                lower = undefined2;
              }
            }
            if (lower === undefined2 && upper === undefined2) {
              lower = 0;
              upper = 1;
            } else {
              lower = toFinite(lower);
              if (upper === undefined2) {
                upper = lower;
                lower = 0;
              } else {
                upper = toFinite(upper);
              }
            }
            if (lower > upper) {
              var temp = lower;
              lower = upper;
              upper = temp;
            }
            if (floating || lower % 1 || upper % 1) {
              var rand = nativeRandom();
              return nativeMin(lower + rand * (upper - lower + freeParseFloat("1e-" + ((rand + "").length - 1))), upper);
            }
            return baseRandom(lower, upper);
          }
          var camelCase = createCompounder(function(result2, word, index) {
            word = word.toLowerCase();
            return result2 + (index ? capitalize(word) : word);
          });
          function capitalize(string) {
            return upperFirst(toString(string).toLowerCase());
          }
          function deburr(string) {
            string = toString(string);
            return string && string.replace(reLatin, deburrLetter).replace(reComboMark, "");
          }
          function endsWith(string, target, position) {
            string = toString(string);
            target = baseToString(target);
            var length = string.length;
            position = position === undefined2 ? length : baseClamp(toInteger(position), 0, length);
            var end = position;
            position -= target.length;
            return position >= 0 && string.slice(position, end) == target;
          }
          function escape(string) {
            string = toString(string);
            return string && reHasUnescapedHtml.test(string) ? string.replace(reUnescapedHtml, escapeHtmlChar) : string;
          }
          function escapeRegExp(string) {
            string = toString(string);
            return string && reHasRegExpChar.test(string) ? string.replace(reRegExpChar, "\\$&") : string;
          }
          var kebabCase = createCompounder(function(result2, word, index) {
            return result2 + (index ? "-" : "") + word.toLowerCase();
          });
          var lowerCase = createCompounder(function(result2, word, index) {
            return result2 + (index ? " " : "") + word.toLowerCase();
          });
          var lowerFirst = createCaseFirst("toLowerCase");
          function pad(string, length, chars) {
            string = toString(string);
            length = toInteger(length);
            var strLength = length ? stringSize(string) : 0;
            if (!length || strLength >= length) {
              return string;
            }
            var mid = (length - strLength) / 2;
            return createPadding(nativeFloor(mid), chars) + string + createPadding(nativeCeil(mid), chars);
          }
          function padEnd(string, length, chars) {
            string = toString(string);
            length = toInteger(length);
            var strLength = length ? stringSize(string) : 0;
            return length && strLength < length ? string + createPadding(length - strLength, chars) : string;
          }
          function padStart(string, length, chars) {
            string = toString(string);
            length = toInteger(length);
            var strLength = length ? stringSize(string) : 0;
            return length && strLength < length ? createPadding(length - strLength, chars) + string : string;
          }
          function parseInt2(string, radix, guard) {
            if (guard || radix == null) {
              radix = 0;
            } else if (radix) {
              radix = +radix;
            }
            return nativeParseInt(toString(string).replace(reTrimStart, ""), radix || 0);
          }
          function repeat(string, n, guard) {
            if (guard ? isIterateeCall(string, n, guard) : n === undefined2) {
              n = 1;
            } else {
              n = toInteger(n);
            }
            return baseRepeat(toString(string), n);
          }
          function replace() {
            var args = arguments, string = toString(args[0]);
            return args.length < 3 ? string : string.replace(args[1], args[2]);
          }
          var snakeCase = createCompounder(function(result2, word, index) {
            return result2 + (index ? "_" : "") + word.toLowerCase();
          });
          function split(string, separator, limit) {
            if (limit && typeof limit != "number" && isIterateeCall(string, separator, limit)) {
              separator = limit = undefined2;
            }
            limit = limit === undefined2 ? MAX_ARRAY_LENGTH : limit >>> 0;
            if (!limit) {
              return [];
            }
            string = toString(string);
            if (string && (typeof separator == "string" || separator != null && !isRegExp2(separator))) {
              separator = baseToString(separator);
              if (!separator && hasUnicode(string)) {
                return castSlice(stringToArray(string), 0, limit);
              }
            }
            return string.split(separator, limit);
          }
          var startCase = createCompounder(function(result2, word, index) {
            return result2 + (index ? " " : "") + upperFirst(word);
          });
          function startsWith(string, target, position) {
            string = toString(string);
            position = position == null ? 0 : baseClamp(toInteger(position), 0, string.length);
            target = baseToString(target);
            return string.slice(position, position + target.length) == target;
          }
          function template(string, options, guard) {
            var settings = lodash.templateSettings;
            if (guard && isIterateeCall(string, options, guard)) {
              options = undefined2;
            }
            string = toString(string);
            options = assignInWith({}, options, settings, customDefaultsAssignIn);
            var imports = assignInWith({}, options.imports, settings.imports, customDefaultsAssignIn), importsKeys = keys2(imports), importsValues = baseValues(imports, importsKeys);
            var isEscaping, isEvaluating, index = 0, interpolate = options.interpolate || reNoMatch, source = "__p += '";
            var reDelimiters = RegExp2(
              (options.escape || reNoMatch).source + "|" + interpolate.source + "|" + (interpolate === reInterpolate ? reEsTemplate : reNoMatch).source + "|" + (options.evaluate || reNoMatch).source + "|$",
              "g"
            );
            var sourceURL = "//# sourceURL=" + (hasOwnProperty.call(options, "sourceURL") ? (options.sourceURL + "").replace(/\s/g, " ") : "lodash.templateSources[" + ++templateCounter + "]") + "\n";
            string.replace(reDelimiters, function(match, escapeValue, interpolateValue, esTemplateValue, evaluateValue, offset) {
              interpolateValue || (interpolateValue = esTemplateValue);
              source += string.slice(index, offset).replace(reUnescapedString, escapeStringChar);
              if (escapeValue) {
                isEscaping = true;
                source += "' +\n__e(" + escapeValue + ") +\n'";
              }
              if (evaluateValue) {
                isEvaluating = true;
                source += "';\n" + evaluateValue + ";\n__p += '";
              }
              if (interpolateValue) {
                source += "' +\n((__t = (" + interpolateValue + ")) == null ? '' : __t) +\n'";
              }
              index = offset + match.length;
              return match;
            });
            source += "';\n";
            var variable = hasOwnProperty.call(options, "variable") && options.variable;
            if (!variable) {
              source = "with (obj) {\n" + source + "\n}\n";
            } else if (reForbiddenIdentifierChars.test(variable)) {
              throw new Error2(INVALID_TEMPL_VAR_ERROR_TEXT);
            }
            source = (isEvaluating ? source.replace(reEmptyStringLeading, "") : source).replace(reEmptyStringMiddle, "$1").replace(reEmptyStringTrailing, "$1;");
            source = "function(" + (variable || "obj") + ") {\n" + (variable ? "" : "obj || (obj = {});\n") + "var __t, __p = ''" + (isEscaping ? ", __e = _.escape" : "") + (isEvaluating ? ", __j = Array.prototype.join;\nfunction print() { __p += __j.call(arguments, '') }\n" : ";\n") + source + "return __p\n}";
            var result2 = attempt(function() {
              return Function2(importsKeys, sourceURL + "return " + source).apply(undefined2, importsValues);
            });
            result2.source = source;
            if (isError(result2)) {
              throw result2;
            }
            return result2;
          }
          function toLower(value) {
            return toString(value).toLowerCase();
          }
          function toUpper(value) {
            return toString(value).toUpperCase();
          }
          function trim(string, chars, guard) {
            string = toString(string);
            if (string && (guard || chars === undefined2)) {
              return baseTrim(string);
            }
            if (!string || !(chars = baseToString(chars))) {
              return string;
            }
            var strSymbols = stringToArray(string), chrSymbols = stringToArray(chars), start = charsStartIndex(strSymbols, chrSymbols), end = charsEndIndex(strSymbols, chrSymbols) + 1;
            return castSlice(strSymbols, start, end).join("");
          }
          function trimEnd(string, chars, guard) {
            string = toString(string);
            if (string && (guard || chars === undefined2)) {
              return string.slice(0, trimmedEndIndex(string) + 1);
            }
            if (!string || !(chars = baseToString(chars))) {
              return string;
            }
            var strSymbols = stringToArray(string), end = charsEndIndex(strSymbols, stringToArray(chars)) + 1;
            return castSlice(strSymbols, 0, end).join("");
          }
          function trimStart(string, chars, guard) {
            string = toString(string);
            if (string && (guard || chars === undefined2)) {
              return string.replace(reTrimStart, "");
            }
            if (!string || !(chars = baseToString(chars))) {
              return string;
            }
            var strSymbols = stringToArray(string), start = charsStartIndex(strSymbols, stringToArray(chars));
            return castSlice(strSymbols, start).join("");
          }
          function truncate(string, options) {
            var length = DEFAULT_TRUNC_LENGTH, omission = DEFAULT_TRUNC_OMISSION;
            if (isObject2(options)) {
              var separator = "separator" in options ? options.separator : separator;
              length = "length" in options ? toInteger(options.length) : length;
              omission = "omission" in options ? baseToString(options.omission) : omission;
            }
            string = toString(string);
            var strLength = string.length;
            if (hasUnicode(string)) {
              var strSymbols = stringToArray(string);
              strLength = strSymbols.length;
            }
            if (length >= strLength) {
              return string;
            }
            var end = length - stringSize(omission);
            if (end < 1) {
              return omission;
            }
            var result2 = strSymbols ? castSlice(strSymbols, 0, end).join("") : string.slice(0, end);
            if (separator === undefined2) {
              return result2 + omission;
            }
            if (strSymbols) {
              end += result2.length - end;
            }
            if (isRegExp2(separator)) {
              if (string.slice(end).search(separator)) {
                var match, substring = result2;
                if (!separator.global) {
                  separator = RegExp2(separator.source, toString(reFlags.exec(separator)) + "g");
                }
                separator.lastIndex = 0;
                while (match = separator.exec(substring)) {
                  var newEnd = match.index;
                }
                result2 = result2.slice(0, newEnd === undefined2 ? end : newEnd);
              }
            } else if (string.indexOf(baseToString(separator), end) != end) {
              var index = result2.lastIndexOf(separator);
              if (index > -1) {
                result2 = result2.slice(0, index);
              }
            }
            return result2 + omission;
          }
          function unescape(string) {
            string = toString(string);
            return string && reHasEscapedHtml.test(string) ? string.replace(reEscapedHtml, unescapeHtmlChar) : string;
          }
          var upperCase = createCompounder(function(result2, word, index) {
            return result2 + (index ? " " : "") + word.toUpperCase();
          });
          var upperFirst = createCaseFirst("toUpperCase");
          function words(string, pattern, guard) {
            string = toString(string);
            pattern = guard ? undefined2 : pattern;
            if (pattern === undefined2) {
              return hasUnicodeWord(string) ? unicodeWords(string) : asciiWords(string);
            }
            return string.match(pattern) || [];
          }
          var attempt = baseRest(function(func, args) {
            try {
              return apply(func, undefined2, args);
            } catch (e) {
              return isError(e) ? e : new Error2(e);
            }
          });
          var bindAll = flatRest(function(object, methodNames) {
            arrayEach(methodNames, function(key) {
              key = toKey(key);
              baseAssignValue(object, key, bind(object[key], object));
            });
            return object;
          });
          function cond(pairs) {
            var length = pairs == null ? 0 : pairs.length, toIteratee = getIteratee();
            pairs = !length ? [] : arrayMap(pairs, function(pair) {
              if (typeof pair[1] != "function") {
                throw new TypeError2(FUNC_ERROR_TEXT);
              }
              return [toIteratee(pair[0]), pair[1]];
            });
            return baseRest(function(args) {
              var index = -1;
              while (++index < length) {
                var pair = pairs[index];
                if (apply(pair[0], this, args)) {
                  return apply(pair[1], this, args);
                }
              }
            });
          }
          function conforms(source) {
            return baseConforms(baseClone(source, CLONE_DEEP_FLAG));
          }
          function constant(value) {
            return function() {
              return value;
            };
          }
          function defaultTo(value, defaultValue) {
            return value == null || value !== value ? defaultValue : value;
          }
          var flow = createFlow();
          var flowRight = createFlow(true);
          function identity(value) {
            return value;
          }
          function iteratee(func) {
            return baseIteratee(typeof func == "function" ? func : baseClone(func, CLONE_DEEP_FLAG));
          }
          function matches(source) {
            return baseMatches(baseClone(source, CLONE_DEEP_FLAG));
          }
          function matchesProperty(path, srcValue) {
            return baseMatchesProperty(path, baseClone(srcValue, CLONE_DEEP_FLAG));
          }
          var method = baseRest(function(path, args) {
            return function(object) {
              return baseInvoke(object, path, args);
            };
          });
          var methodOf = baseRest(function(object, args) {
            return function(path) {
              return baseInvoke(object, path, args);
            };
          });
          function mixin(object, source, options) {
            var props = keys2(source), methodNames = baseFunctions(source, props);
            if (options == null && !(isObject2(source) && (methodNames.length || !props.length))) {
              options = source;
              source = object;
              object = this;
              methodNames = baseFunctions(source, keys2(source));
            }
            var chain2 = !(isObject2(options) && "chain" in options) || !!options.chain, isFunc = isFunction2(object);
            arrayEach(methodNames, function(methodName) {
              var func = source[methodName];
              object[methodName] = func;
              if (isFunc) {
                object.prototype[methodName] = function() {
                  var chainAll = this.__chain__;
                  if (chain2 || chainAll) {
                    var result2 = object(this.__wrapped__), actions = result2.__actions__ = copyArray(this.__actions__);
                    actions.push({ "func": func, "args": arguments, "thisArg": object });
                    result2.__chain__ = chainAll;
                    return result2;
                  }
                  return func.apply(object, arrayPush([this.value()], arguments));
                };
              }
            });
            return object;
          }
          function noConflict() {
            if (root._ === this) {
              root._ = oldDash;
            }
            return this;
          }
          function noop() {
          }
          function nthArg(n) {
            n = toInteger(n);
            return baseRest(function(args) {
              return baseNth(args, n);
            });
          }
          var over = createOver(arrayMap);
          var overEvery = createOver(arrayEvery);
          var overSome = createOver(arraySome);
          function property(path) {
            return isKey(path) ? baseProperty(toKey(path)) : basePropertyDeep(path);
          }
          function propertyOf(object) {
            return function(path) {
              return object == null ? undefined2 : baseGet(object, path);
            };
          }
          var range = createRange();
          var rangeRight = createRange(true);
          function stubArray() {
            return [];
          }
          function stubFalse() {
            return false;
          }
          function stubObject() {
            return {};
          }
          function stubString() {
            return "";
          }
          function stubTrue() {
            return true;
          }
          function times(n, iteratee2) {
            n = toInteger(n);
            if (n < 1 || n > MAX_SAFE_INTEGER) {
              return [];
            }
            var index = MAX_ARRAY_LENGTH, length = nativeMin(n, MAX_ARRAY_LENGTH);
            iteratee2 = getIteratee(iteratee2);
            n -= MAX_ARRAY_LENGTH;
            var result2 = baseTimes(length, iteratee2);
            while (++index < n) {
              iteratee2(index);
            }
            return result2;
          }
          function toPath(value) {
            if (isArray2(value)) {
              return arrayMap(value, toKey);
            }
            return isSymbol(value) ? [value] : copyArray(stringToPath(toString(value)));
          }
          function uniqueId(prefix) {
            var id = ++idCounter;
            return toString(prefix) + id;
          }
          var add = createMathOperation(function(augend, addend) {
            return augend + addend;
          }, 0);
          var ceil = createRound("ceil");
          var divide = createMathOperation(function(dividend, divisor) {
            return dividend / divisor;
          }, 1);
          var floor = createRound("floor");
          function max(array) {
            return array && array.length ? baseExtremum(array, identity, baseGt) : undefined2;
          }
          function maxBy(array, iteratee2) {
            return array && array.length ? baseExtremum(array, getIteratee(iteratee2, 2), baseGt) : undefined2;
          }
          function mean(array) {
            return baseMean(array, identity);
          }
          function meanBy(array, iteratee2) {
            return baseMean(array, getIteratee(iteratee2, 2));
          }
          function min(array) {
            return array && array.length ? baseExtremum(array, identity, baseLt) : undefined2;
          }
          function minBy(array, iteratee2) {
            return array && array.length ? baseExtremum(array, getIteratee(iteratee2, 2), baseLt) : undefined2;
          }
          var multiply = createMathOperation(function(multiplier, multiplicand) {
            return multiplier * multiplicand;
          }, 1);
          var round = createRound("round");
          var subtract = createMathOperation(function(minuend, subtrahend) {
            return minuend - subtrahend;
          }, 0);
          function sum(array) {
            return array && array.length ? baseSum(array, identity) : 0;
          }
          function sumBy(array, iteratee2) {
            return array && array.length ? baseSum(array, getIteratee(iteratee2, 2)) : 0;
          }
          lodash.after = after;
          lodash.ary = ary;
          lodash.assign = assign2;
          lodash.assignIn = assignIn;
          lodash.assignInWith = assignInWith;
          lodash.assignWith = assignWith;
          lodash.at = at;
          lodash.before = before;
          lodash.bind = bind;
          lodash.bindAll = bindAll;
          lodash.bindKey = bindKey;
          lodash.castArray = castArray;
          lodash.chain = chain;
          lodash.chunk = chunk;
          lodash.compact = compact2;
          lodash.concat = concat;
          lodash.cond = cond;
          lodash.conforms = conforms;
          lodash.constant = constant;
          lodash.countBy = countBy;
          lodash.create = create;
          lodash.curry = curry;
          lodash.curryRight = curryRight;
          lodash.debounce = debounce;
          lodash.defaults = defaults2;
          lodash.defaultsDeep = defaultsDeep;
          lodash.defer = defer;
          lodash.delay = delay;
          lodash.difference = difference2;
          lodash.differenceBy = differenceBy;
          lodash.differenceWith = differenceWith;
          lodash.drop = drop2;
          lodash.dropRight = dropRight2;
          lodash.dropRightWhile = dropRightWhile;
          lodash.dropWhile = dropWhile;
          lodash.fill = fill;
          lodash.filter = filter2;
          lodash.flatMap = flatMap;
          lodash.flatMapDeep = flatMapDeep;
          lodash.flatMapDepth = flatMapDepth;
          lodash.flatten = flatten2;
          lodash.flattenDeep = flattenDeep;
          lodash.flattenDepth = flattenDepth;
          lodash.flip = flip;
          lodash.flow = flow;
          lodash.flowRight = flowRight;
          lodash.fromPairs = fromPairs;
          lodash.functions = functions;
          lodash.functionsIn = functionsIn;
          lodash.groupBy = groupBy2;
          lodash.initial = initial;
          lodash.intersection = intersection;
          lodash.intersectionBy = intersectionBy;
          lodash.intersectionWith = intersectionWith;
          lodash.invert = invert;
          lodash.invertBy = invertBy;
          lodash.invokeMap = invokeMap;
          lodash.iteratee = iteratee;
          lodash.keyBy = keyBy;
          lodash.keys = keys2;
          lodash.keysIn = keysIn;
          lodash.map = map2;
          lodash.mapKeys = mapKeys;
          lodash.mapValues = mapValues2;
          lodash.matches = matches;
          lodash.matchesProperty = matchesProperty;
          lodash.memoize = memoize;
          lodash.merge = merge2;
          lodash.mergeWith = mergeWith;
          lodash.method = method;
          lodash.methodOf = methodOf;
          lodash.mixin = mixin;
          lodash.negate = negate;
          lodash.nthArg = nthArg;
          lodash.omit = omit;
          lodash.omitBy = omitBy;
          lodash.once = once;
          lodash.orderBy = orderBy;
          lodash.over = over;
          lodash.overArgs = overArgs;
          lodash.overEvery = overEvery;
          lodash.overSome = overSome;
          lodash.partial = partial2;
          lodash.partialRight = partialRight;
          lodash.partition = partition;
          lodash.pick = pick2;
          lodash.pickBy = pickBy;
          lodash.property = property;
          lodash.propertyOf = propertyOf;
          lodash.pull = pull;
          lodash.pullAll = pullAll;
          lodash.pullAllBy = pullAllBy;
          lodash.pullAllWith = pullAllWith;
          lodash.pullAt = pullAt;
          lodash.range = range;
          lodash.rangeRight = rangeRight;
          lodash.rearg = rearg;
          lodash.reject = reject2;
          lodash.remove = remove;
          lodash.rest = rest;
          lodash.reverse = reverse;
          lodash.sampleSize = sampleSize;
          lodash.set = set;
          lodash.setWith = setWith;
          lodash.shuffle = shuffle;
          lodash.slice = slice;
          lodash.sortBy = sortBy2;
          lodash.sortedUniq = sortedUniq;
          lodash.sortedUniqBy = sortedUniqBy;
          lodash.split = split;
          lodash.spread = spread;
          lodash.tail = tail;
          lodash.take = take;
          lodash.takeRight = takeRight;
          lodash.takeRightWhile = takeRightWhile;
          lodash.takeWhile = takeWhile;
          lodash.tap = tap;
          lodash.throttle = throttle;
          lodash.thru = thru;
          lodash.toArray = toArray;
          lodash.toPairs = toPairs;
          lodash.toPairsIn = toPairsIn;
          lodash.toPath = toPath;
          lodash.toPlainObject = toPlainObject;
          lodash.transform = transform;
          lodash.unary = unary;
          lodash.union = union;
          lodash.unionBy = unionBy;
          lodash.unionWith = unionWith;
          lodash.uniq = uniq2;
          lodash.uniqBy = uniqBy;
          lodash.uniqWith = uniqWith;
          lodash.unset = unset;
          lodash.unzip = unzip;
          lodash.unzipWith = unzipWith;
          lodash.update = update;
          lodash.updateWith = updateWith;
          lodash.values = values2;
          lodash.valuesIn = valuesIn;
          lodash.without = without;
          lodash.words = words;
          lodash.wrap = wrap;
          lodash.xor = xor;
          lodash.xorBy = xorBy;
          lodash.xorWith = xorWith;
          lodash.zip = zip;
          lodash.zipObject = zipObject2;
          lodash.zipObjectDeep = zipObjectDeep;
          lodash.zipWith = zipWith;
          lodash.entries = toPairs;
          lodash.entriesIn = toPairsIn;
          lodash.extend = assignIn;
          lodash.extendWith = assignInWith;
          mixin(lodash, lodash);
          lodash.add = add;
          lodash.attempt = attempt;
          lodash.camelCase = camelCase;
          lodash.capitalize = capitalize;
          lodash.ceil = ceil;
          lodash.clamp = clamp;
          lodash.clone = clone;
          lodash.cloneDeep = cloneDeep;
          lodash.cloneDeepWith = cloneDeepWith;
          lodash.cloneWith = cloneWith;
          lodash.conformsTo = conformsTo;
          lodash.deburr = deburr;
          lodash.defaultTo = defaultTo;
          lodash.divide = divide;
          lodash.endsWith = endsWith;
          lodash.eq = eq;
          lodash.escape = escape;
          lodash.escapeRegExp = escapeRegExp;
          lodash.every = every2;
          lodash.find = find2;
          lodash.findIndex = findIndex;
          lodash.findKey = findKey;
          lodash.findLast = findLast;
          lodash.findLastIndex = findLastIndex;
          lodash.findLastKey = findLastKey;
          lodash.floor = floor;
          lodash.forEach = forEach2;
          lodash.forEachRight = forEachRight;
          lodash.forIn = forIn;
          lodash.forInRight = forInRight;
          lodash.forOwn = forOwn;
          lodash.forOwnRight = forOwnRight;
          lodash.get = get;
          lodash.gt = gt;
          lodash.gte = gte;
          lodash.has = has2;
          lodash.hasIn = hasIn;
          lodash.head = head;
          lodash.identity = identity;
          lodash.includes = includes;
          lodash.indexOf = indexOf2;
          lodash.inRange = inRange;
          lodash.invoke = invoke;
          lodash.isArguments = isArguments;
          lodash.isArray = isArray2;
          lodash.isArrayBuffer = isArrayBuffer;
          lodash.isArrayLike = isArrayLike;
          lodash.isArrayLikeObject = isArrayLikeObject;
          lodash.isBoolean = isBoolean;
          lodash.isBuffer = isBuffer;
          lodash.isDate = isDate;
          lodash.isElement = isElement;
          lodash.isEmpty = isEmpty2;
          lodash.isEqual = isEqual;
          lodash.isEqualWith = isEqualWith;
          lodash.isError = isError;
          lodash.isFinite = isFinite;
          lodash.isFunction = isFunction2;
          lodash.isInteger = isInteger;
          lodash.isLength = isLength;
          lodash.isMap = isMap;
          lodash.isMatch = isMatch;
          lodash.isMatchWith = isMatchWith;
          lodash.isNaN = isNaN2;
          lodash.isNative = isNative;
          lodash.isNil = isNil;
          lodash.isNull = isNull;
          lodash.isNumber = isNumber;
          lodash.isObject = isObject2;
          lodash.isObjectLike = isObjectLike;
          lodash.isPlainObject = isPlainObject;
          lodash.isRegExp = isRegExp2;
          lodash.isSafeInteger = isSafeInteger;
          lodash.isSet = isSet;
          lodash.isString = isString2;
          lodash.isSymbol = isSymbol;
          lodash.isTypedArray = isTypedArray;
          lodash.isUndefined = isUndefined2;
          lodash.isWeakMap = isWeakMap;
          lodash.isWeakSet = isWeakSet;
          lodash.join = join;
          lodash.kebabCase = kebabCase;
          lodash.last = last2;
          lodash.lastIndexOf = lastIndexOf;
          lodash.lowerCase = lowerCase;
          lodash.lowerFirst = lowerFirst;
          lodash.lt = lt;
          lodash.lte = lte;
          lodash.max = max;
          lodash.maxBy = maxBy;
          lodash.mean = mean;
          lodash.meanBy = meanBy;
          lodash.min = min;
          lodash.minBy = minBy;
          lodash.stubArray = stubArray;
          lodash.stubFalse = stubFalse;
          lodash.stubObject = stubObject;
          lodash.stubString = stubString;
          lodash.stubTrue = stubTrue;
          lodash.multiply = multiply;
          lodash.nth = nth;
          lodash.noConflict = noConflict;
          lodash.noop = noop;
          lodash.now = now;
          lodash.pad = pad;
          lodash.padEnd = padEnd;
          lodash.padStart = padStart;
          lodash.parseInt = parseInt2;
          lodash.random = random;
          lodash.reduce = reduce2;
          lodash.reduceRight = reduceRight;
          lodash.repeat = repeat;
          lodash.replace = replace;
          lodash.result = result;
          lodash.round = round;
          lodash.runInContext = runInContext2;
          lodash.sample = sample;
          lodash.size = size;
          lodash.snakeCase = snakeCase;
          lodash.some = some2;
          lodash.sortedIndex = sortedIndex;
          lodash.sortedIndexBy = sortedIndexBy;
          lodash.sortedIndexOf = sortedIndexOf;
          lodash.sortedLastIndex = sortedLastIndex;
          lodash.sortedLastIndexBy = sortedLastIndexBy;
          lodash.sortedLastIndexOf = sortedLastIndexOf;
          lodash.startCase = startCase;
          lodash.startsWith = startsWith;
          lodash.subtract = subtract;
          lodash.sum = sum;
          lodash.sumBy = sumBy;
          lodash.template = template;
          lodash.times = times;
          lodash.toFinite = toFinite;
          lodash.toInteger = toInteger;
          lodash.toLength = toLength;
          lodash.toLower = toLower;
          lodash.toNumber = toNumber;
          lodash.toSafeInteger = toSafeInteger;
          lodash.toString = toString;
          lodash.toUpper = toUpper;
          lodash.trim = trim;
          lodash.trimEnd = trimEnd;
          lodash.trimStart = trimStart;
          lodash.truncate = truncate;
          lodash.unescape = unescape;
          lodash.uniqueId = uniqueId;
          lodash.upperCase = upperCase;
          lodash.upperFirst = upperFirst;
          lodash.each = forEach2;
          lodash.eachRight = forEachRight;
          lodash.first = head;
          mixin(lodash, (function() {
            var source = {};
            baseForOwn(lodash, function(func, methodName) {
              if (!hasOwnProperty.call(lodash.prototype, methodName)) {
                source[methodName] = func;
              }
            });
            return source;
          })(), { "chain": false });
          lodash.VERSION = VERSION;
          arrayEach(["bind", "bindKey", "curry", "curryRight", "partial", "partialRight"], function(methodName) {
            lodash[methodName].placeholder = lodash;
          });
          arrayEach(["drop", "take"], function(methodName, index) {
            LazyWrapper.prototype[methodName] = function(n) {
              n = n === undefined2 ? 1 : nativeMax(toInteger(n), 0);
              var result2 = this.__filtered__ && !index ? new LazyWrapper(this) : this.clone();
              if (result2.__filtered__) {
                result2.__takeCount__ = nativeMin(n, result2.__takeCount__);
              } else {
                result2.__views__.push({
                  "size": nativeMin(n, MAX_ARRAY_LENGTH),
                  "type": methodName + (result2.__dir__ < 0 ? "Right" : "")
                });
              }
              return result2;
            };
            LazyWrapper.prototype[methodName + "Right"] = function(n) {
              return this.reverse()[methodName](n).reverse();
            };
          });
          arrayEach(["filter", "map", "takeWhile"], function(methodName, index) {
            var type = index + 1, isFilter = type == LAZY_FILTER_FLAG || type == LAZY_WHILE_FLAG;
            LazyWrapper.prototype[methodName] = function(iteratee2) {
              var result2 = this.clone();
              result2.__iteratees__.push({
                "iteratee": getIteratee(iteratee2, 3),
                "type": type
              });
              result2.__filtered__ = result2.__filtered__ || isFilter;
              return result2;
            };
          });
          arrayEach(["head", "last"], function(methodName, index) {
            var takeName = "take" + (index ? "Right" : "");
            LazyWrapper.prototype[methodName] = function() {
              return this[takeName](1).value()[0];
            };
          });
          arrayEach(["initial", "tail"], function(methodName, index) {
            var dropName = "drop" + (index ? "" : "Right");
            LazyWrapper.prototype[methodName] = function() {
              return this.__filtered__ ? new LazyWrapper(this) : this[dropName](1);
            };
          });
          LazyWrapper.prototype.compact = function() {
            return this.filter(identity);
          };
          LazyWrapper.prototype.find = function(predicate) {
            return this.filter(predicate).head();
          };
          LazyWrapper.prototype.findLast = function(predicate) {
            return this.reverse().find(predicate);
          };
          LazyWrapper.prototype.invokeMap = baseRest(function(path, args) {
            if (typeof path == "function") {
              return new LazyWrapper(this);
            }
            return this.map(function(value) {
              return baseInvoke(value, path, args);
            });
          });
          LazyWrapper.prototype.reject = function(predicate) {
            return this.filter(negate(getIteratee(predicate)));
          };
          LazyWrapper.prototype.slice = function(start, end) {
            start = toInteger(start);
            var result2 = this;
            if (result2.__filtered__ && (start > 0 || end < 0)) {
              return new LazyWrapper(result2);
            }
            if (start < 0) {
              result2 = result2.takeRight(-start);
            } else if (start) {
              result2 = result2.drop(start);
            }
            if (end !== undefined2) {
              end = toInteger(end);
              result2 = end < 0 ? result2.dropRight(-end) : result2.take(end - start);
            }
            return result2;
          };
          LazyWrapper.prototype.takeRightWhile = function(predicate) {
            return this.reverse().takeWhile(predicate).reverse();
          };
          LazyWrapper.prototype.toArray = function() {
            return this.take(MAX_ARRAY_LENGTH);
          };
          baseForOwn(LazyWrapper.prototype, function(func, methodName) {
            var checkIteratee = /^(?:filter|find|map|reject)|While$/.test(methodName), isTaker = /^(?:head|last)$/.test(methodName), lodashFunc = lodash[isTaker ? "take" + (methodName == "last" ? "Right" : "") : methodName], retUnwrapped = isTaker || /^find/.test(methodName);
            if (!lodashFunc) {
              return;
            }
            lodash.prototype[methodName] = function() {
              var value = this.__wrapped__, args = isTaker ? [1] : arguments, isLazy = value instanceof LazyWrapper, iteratee2 = args[0], useLazy = isLazy || isArray2(value);
              var interceptor = function(value2) {
                var result3 = lodashFunc.apply(lodash, arrayPush([value2], args));
                return isTaker && chainAll ? result3[0] : result3;
              };
              if (useLazy && checkIteratee && typeof iteratee2 == "function" && iteratee2.length != 1) {
                isLazy = useLazy = false;
              }
              var chainAll = this.__chain__, isHybrid = !!this.__actions__.length, isUnwrapped = retUnwrapped && !chainAll, onlyLazy = isLazy && !isHybrid;
              if (!retUnwrapped && useLazy) {
                value = onlyLazy ? value : new LazyWrapper(this);
                var result2 = func.apply(value, args);
                result2.__actions__.push({ "func": thru, "args": [interceptor], "thisArg": undefined2 });
                return new LodashWrapper(result2, chainAll);
              }
              if (isUnwrapped && onlyLazy) {
                return func.apply(this, args);
              }
              result2 = this.thru(interceptor);
              return isUnwrapped ? isTaker ? result2.value()[0] : result2.value() : result2;
            };
          });
          arrayEach(["pop", "push", "shift", "sort", "splice", "unshift"], function(methodName) {
            var func = arrayProto[methodName], chainName = /^(?:push|sort|unshift)$/.test(methodName) ? "tap" : "thru", retUnwrapped = /^(?:pop|shift)$/.test(methodName);
            lodash.prototype[methodName] = function() {
              var args = arguments;
              if (retUnwrapped && !this.__chain__) {
                var value = this.value();
                return func.apply(isArray2(value) ? value : [], args);
              }
              return this[chainName](function(value2) {
                return func.apply(isArray2(value2) ? value2 : [], args);
              });
            };
          });
          baseForOwn(LazyWrapper.prototype, function(func, methodName) {
            var lodashFunc = lodash[methodName];
            if (lodashFunc) {
              var key = lodashFunc.name + "";
              if (!hasOwnProperty.call(realNames, key)) {
                realNames[key] = [];
              }
              realNames[key].push({ "name": methodName, "func": lodashFunc });
            }
          });
          realNames[createHybrid(undefined2, WRAP_BIND_KEY_FLAG).name] = [{
            "name": "wrapper",
            "func": undefined2
          }];
          LazyWrapper.prototype.clone = lazyClone;
          LazyWrapper.prototype.reverse = lazyReverse;
          LazyWrapper.prototype.value = lazyValue;
          lodash.prototype.at = wrapperAt;
          lodash.prototype.chain = wrapperChain;
          lodash.prototype.commit = wrapperCommit;
          lodash.prototype.next = wrapperNext;
          lodash.prototype.plant = wrapperPlant;
          lodash.prototype.reverse = wrapperReverse;
          lodash.prototype.toJSON = lodash.prototype.valueOf = lodash.prototype.value = wrapperValue;
          lodash.prototype.first = lodash.prototype.head;
          if (symIterator) {
            lodash.prototype[symIterator] = wrapperToIterator;
          }
          return lodash;
        });
        var _ = runInContext();
        if (typeof define == "function" && typeof define.amd == "object" && define.amd) {
          root._ = _;
          define(function() {
            return _;
          });
        } else if (freeModule) {
          (freeModule.exports = _)._ = _;
          freeExports._ = _;
        } else {
          root._ = _;
        }
      }).call(exports2);
    }
  });

  // ../../node_modules/@xml-tools/common/lib/find-next-textual-token.js
  var require_find_next_textual_token = __commonJS({
    "../../node_modules/@xml-tools/common/lib/find-next-textual-token.js"(exports2, module2) {
      var { findIndex } = require_lodash();
      function findNextTextualToken(tokenVector, prevTokenEndOffset) {
        const prevTokenIdx = findIndex(
          tokenVector,
          (tok) => tok.endOffset === prevTokenEndOffset
        );
        let nextTokenIdx = prevTokenIdx;
        let found = false;
        while (found === false) {
          nextTokenIdx++;
          const nextPossibleToken = tokenVector[nextTokenIdx];
          if (nextPossibleToken === void 0) {
            return null;
          }
          if (nextPossibleToken.tokenType.name === "SEA_WS") {
          } else {
            return nextPossibleToken;
          }
        }
      }
      module2.exports = {
        findNextTextualToken
      };
    }
  });

  // ../../node_modules/@xml-tools/common/lib/xml-ns-key.js
  var require_xml_ns_key = __commonJS({
    "../../node_modules/@xml-tools/common/lib/xml-ns-key.js"(exports2, module2) {
      var namespaceRegex = new RegExp("^xmlns(?<prefixWithColon>:(?<prefix>[^:]*))?$");
      function isXMLNamespaceKey({ key, includeEmptyPrefix }) {
        if (typeof key !== "string") {
          return false;
        }
        const matchArr = key.match(namespaceRegex);
        if (matchArr === null) {
          return false;
        }
        return !!(includeEmptyPrefix === true || // "xmlns" case
        !matchArr.groups.prefixWithColon || // "xmlns:<prefix>" case
        matchArr.groups.prefix);
      }
      function getXMLNamespaceKeyPrefix(key) {
        if (typeof key !== "string") {
          return void 0;
        }
        const matchArr = key.match(namespaceRegex);
        if (matchArr === null) {
          return void 0;
        }
        return matchArr.groups && matchArr.groups.prefix || "";
      }
      module2.exports = {
        isXMLNamespaceKey,
        getXMLNamespaceKeyPrefix
      };
    }
  });

  // ../../node_modules/@xml-tools/common/lib/api.js
  var require_api3 = __commonJS({
    "../../node_modules/@xml-tools/common/lib/api.js"(exports2, module2) {
      var { findNextTextualToken } = require_find_next_textual_token();
      var {
        isXMLNamespaceKey,
        getXMLNamespaceKeyPrefix
      } = require_xml_ns_key();
      module2.exports = {
        findNextTextualToken,
        isXMLNamespaceKey,
        getXMLNamespaceKeyPrefix
      };
    }
  });

  // ../../node_modules/@xml-tools/ast/lib/utils.js
  var require_utils2 = __commonJS({
    "../../node_modules/@xml-tools/ast/lib/utils.js"(exports2, module2) {
      var { reduce: reduce2, has: has2, isArray: isArray2 } = require_lodash();
      function getAstChildrenReflective(astParent) {
        const astChildren = reduce2(
          astParent,
          (result, prop, name) => {
            if (name === "parent") {
            } else if (has2(prop, "type")) {
              result.push(prop);
            } else if (isArray2(prop) && prop.length > 0 && has2(prop[0], "type")) {
              result = result.concat(prop);
            }
            return result;
          },
          []
        );
        return astChildren;
      }
      module2.exports = {
        getAstChildrenReflective
      };
    }
  });

  // ../../node_modules/@xml-tools/ast/lib/constants.js
  var require_constants2 = __commonJS({
    "../../node_modules/@xml-tools/ast/lib/constants.js"(exports2, module2) {
      module2.exports = {
        DEFAULT_NS: "::DEFAULT"
      };
    }
  });

  // ../../node_modules/@xml-tools/ast/lib/build-ast.js
  var require_build_ast = __commonJS({
    "../../node_modules/@xml-tools/ast/lib/build-ast.js"(exports2, module2) {
      var { BaseXmlCstVisitor } = require_api2();
      var {
        last: last2,
        forEach: forEach2,
        reduce: reduce2,
        map: map2,
        pick: pick2,
        sortBy: sortBy2,
        isEmpty: isEmpty2,
        isArray: isArray2,
        assign: assign2
      } = require_lodash();
      var {
        findNextTextualToken,
        isXMLNamespaceKey,
        getXMLNamespaceKeyPrefix
      } = require_api3();
      var { getAstChildrenReflective } = require_utils2();
      var { DEFAULT_NS } = require_constants2();
      function buildAst2(docCst, tokenVector) {
        AstBuilder.setState({ tokenVector });
        const xmlDocAst = AstBuilder.visit(docCst);
        if (xmlDocAst.rootElement !== invalidSyntax) {
          updateNamespaces(xmlDocAst.rootElement);
        }
        return xmlDocAst;
      }
      var CstToAstVisitor = class extends BaseXmlCstVisitor {
        constructor() {
          super();
        }
        setState({ tokenVector }) {
          this.tokenVector = tokenVector;
        }
        visit(cstNode, params = {}) {
          return super.visit(cstNode, __spreadValues({ location: cstNode.location }, params));
        }
        /**
         * @param ctx {DocumentCtx}
         * @param opts {Object}
         * @param opts.location {SourcePosition}
         *
         * @returns {XMLDocument}
         */
        document(ctx, { location }) {
          const astNode = {
            type: "XMLDocument",
            rootElement: invalidSyntax,
            position: location
          };
          if (ctx.prolog !== void 0) {
            astNode.prolog = this.visit(ctx.prolog[0]);
          }
          if (ctx.element !== void 0 && isEmpty2(ctx.element[0].children) === false) {
            astNode.rootElement = this.visit(ctx.element[0]);
          }
          setChildrenParent(astNode);
          return astNode;
        }
        /**
         * @param ctx {PrologCtx}
         * @param opts {Object}
         * @param opts.location {SourcePosition}
         */
        prolog(ctx, { location }) {
          const astNode = {
            type: "XMLProlog",
            attributes: [],
            position: location
          };
          if (ctx.attribute !== void 0) {
            astNode.attributes = map2(
              ctx.attribute,
              (_) => this.visit(_, { isPrologParent: true })
            );
          }
          setChildrenParent(astNode);
          return astNode;
        }
        /**
         * @param {docTypeDeclCtx} ctx
         */
        /* istanbul ignore next - place holder*/
        docTypeDecl(ctx, astNode) {
        }
        /**
         * @param {ExternalIDCtx} ctx
         */
        /* istanbul ignore next - place holder*/
        externalID(ctx, astNode) {
        }
        /**
         * @param ctx {ContentCtx}
         * @param opts {Object}
         * @param opts.location {SourcePosition}
         *
         * @return {{elements, textContents}}
         */
        content(ctx, { location }) {
          let elements = [];
          let textContents = [];
          if (ctx.element !== void 0) {
            elements = map2(ctx.element, this.visit.bind(this));
          }
          if (ctx.chardata !== void 0) {
            textContents = map2(ctx.chardata, this.visit.bind(this));
          }
          return { elements, textContents };
        }
        /**
         * @param ctx {ElementCtx}
         * @param opts {Object}
         * @param opts.location {SourcePosition}
         */
        element(ctx, { location }) {
          const astNode = {
            type: "XMLElement",
            // Avoid Accidental Keys in this map
            namespaces: /* @__PURE__ */ Object.create(null),
            name: invalidSyntax,
            attributes: [],
            subElements: [],
            textContents: [],
            position: location,
            syntax: {}
          };
          if (ctx.attribute !== void 0) {
            astNode.attributes = map2(ctx.attribute, this.visit.bind(this));
          }
          if (ctx.content !== void 0) {
            const { elements, textContents } = this.visit(ctx.content[0]);
            astNode.subElements = elements;
            astNode.textContents = textContents;
          }
          handleElementOpenCloseNameRanges(astNode, ctx);
          handleElementOpenCloseBodyRanges(astNode, ctx);
          handleElementAttributeRanges(astNode, ctx, this.tokenVector);
          setChildrenParent(astNode);
          return astNode;
        }
        /**
         * @param ctx {ReferenceCtx}
         * @param opts {Object}
         * @param opts.location {SourcePosition}
         */
        /* istanbul ignore next - place holder*/
        reference(ctx, { location }) {
        }
        /**
         * @param ctx {AttributeCtx}
         * @param opts {Object}
         * @param opts.location {SourcePosition}
         * @param opts.isPrologParent {boolean}
         */
        attribute(ctx, { location, isPrologParent }) {
          const astNode = {
            type: isPrologParent ? "XMLPrologAttribute" : "XMLAttribute",
            position: location,
            key: invalidSyntax,
            value: invalidSyntax,
            syntax: {}
          };
          if (ctx.Name !== void 0 && ctx.Name[0].isInsertedInRecovery !== true) {
            const keyToken = ctx.Name[0];
            astNode.key = keyToken.image;
            astNode.syntax.key = toXMLToken(keyToken);
          }
          if (ctx.STRING !== void 0 && ctx.STRING[0].isInsertedInRecovery !== true) {
            const valueToken = ctx.STRING[0];
            astNode.value = stripQuotes(valueToken.image);
            astNode.syntax.value = toXMLToken(valueToken);
          }
          setChildrenParent(astNode);
          return astNode;
        }
        /**
         * @param ctx {ChardataCtx}
         * @param opts {Object}
         * @param opts.location {SourcePosition}
         */
        chardata(ctx, { location }) {
          const astNode = {
            type: "XMLTextContent",
            position: location,
            text: invalidSyntax
          };
          let allTokens = [];
          if (ctx.SEA_WS !== void 0) {
            allTokens = allTokens.concat(ctx.SEA_WS);
          }
          if (ctx.TEXT !== void 0) {
            allTokens = allTokens.concat(ctx.TEXT);
          }
          const sortedTokens = sortBy2(allTokens, ["startOffset"]);
          const fullText = map2(sortedTokens, "image").join("");
          astNode.text = fullText;
          return astNode;
        }
        /**
         * @param ctx {MiscCtx}
         * @param opts {Object}
         * @param opts.location {SourcePosition}
         */
        /* istanbul ignore next - place holder*/
        misc(ctx, { location }) {
        }
      };
      var AstBuilder = new CstToAstVisitor();
      function setChildrenParent(astParent) {
        const astChildren = getAstChildrenReflective(astParent);
        forEach2(astChildren, (child) => child.parent = astParent);
      }
      function updateNamespaces(element, prevNamespaces = []) {
        const currElemNamespaces = reduce2(
          element.attributes,
          (result, attrib) => {
            if (attrib.key !== invalidSyntax) {
              if (isXMLNamespaceKey({ key: attrib.key, includeEmptyPrefix: false }) === true) {
                const prefix = getXMLNamespaceKeyPrefix(attrib.key);
                if (attrib.value) {
                  const uri = attrib.value;
                  if (prefix !== "") {
                    result[prefix] = uri;
                  } else {
                    result[DEFAULT_NS] = uri;
                  }
                }
              }
            }
            return result;
          },
          {}
        );
        const emptyMap = /* @__PURE__ */ Object.create(null);
        element.namespaces = assign2(emptyMap, prevNamespaces, currElemNamespaces);
        forEach2(
          element.subElements,
          (subElem) => updateNamespaces(subElem, element.namespaces)
        );
      }
      function toXMLToken(token) {
        return pick2(token, [
          "image",
          "startOffset",
          "endOffset",
          "startLine",
          "endLine",
          "startColumn",
          "endColumn"
        ]);
      }
      function startOfXMLToken(token) {
        return pick2(token, ["startOffset", "startLine", "startColumn"]);
      }
      function endOfXMLToken(token) {
        return pick2(token, ["endOffset", "endLine", "endColumn"]);
      }
      function exists(tokArr) {
        return isArray2(tokArr) && tokArr.length === 1 && tokArr[0].isInsertedInRecovery !== true;
      }
      function stripQuotes(quotedText) {
        return quotedText.substring(1, quotedText.length - 1);
      }
      function nsToParts(text) {
        const matchResult = /^([^:]+):([^:]+)$/.exec(text);
        if (matchResult === null) {
          return null;
        }
        const ns = matchResult[1];
        const name = matchResult[2];
        return { ns, name };
      }
      var invalidSyntax = null;
      function handleElementOpenCloseNameRanges(astNode, ctx) {
        if (ctx.Name !== void 0 && ctx.Name[0].isInsertedInRecovery !== true) {
          const openNameToken = ctx.Name[0];
          astNode.syntax.openName = toXMLToken(openNameToken);
          const nsParts = nsToParts(openNameToken.image);
          if (nsParts !== null) {
            astNode.ns = nsParts.ns;
            astNode.name = nsParts.name;
          } else {
            astNode.name = openNameToken.image;
          }
        }
        if (ctx.END_NAME !== void 0 && ctx.END_NAME[0].isInsertedInRecovery !== true) {
          astNode.syntax.closeName = toXMLToken(ctx.END_NAME[0]);
        }
      }
      function handleElementOpenCloseBodyRanges(astNode, ctx) {
        if (exists(ctx.OPEN)) {
          let openBodyCloseTok = void 0;
          if (exists(ctx.START_CLOSE)) {
            openBodyCloseTok = ctx.START_CLOSE[0];
            astNode.syntax.isSelfClosing = false;
          } else if (exists(ctx.SLASH_CLOSE)) {
            openBodyCloseTok = ctx.SLASH_CLOSE[0];
            astNode.syntax.isSelfClosing = true;
          }
          if (openBodyCloseTok !== void 0) {
            astNode.syntax.openBody = __spreadValues(__spreadValues({}, startOfXMLToken(ctx.OPEN[0])), endOfXMLToken(openBodyCloseTok));
          }
          if (exists(ctx.SLASH_OPEN) && exists(ctx.END)) {
            astNode.syntax.closeBody = __spreadValues(__spreadValues({}, startOfXMLToken(ctx.SLASH_OPEN[0])), endOfXMLToken(ctx.END[0]));
          }
        }
      }
      function handleElementAttributeRanges(astNode, ctx, tokenVector) {
        if (exists(ctx.Name)) {
          const startOffset = ctx.Name[0].endOffset + 2;
          if (exists(ctx.START_CLOSE) || exists(ctx.SLASH_CLOSE)) {
            const endOffset = (exists(ctx.START_CLOSE) ? ctx.START_CLOSE[0].startOffset : ctx.SLASH_CLOSE[0].startOffset) - 1;
            astNode.syntax.attributesRange = { startOffset, endOffset };
          } else {
            const hasAttributes = isArray2(ctx.attribute);
            const lastKnownAttribRangeTokenEnd = hasAttributes ? last2(ctx.attribute).location.endOffset : ctx.Name[0].endOffset;
            const nextTextualToken = findNextTextualToken(
              tokenVector,
              lastKnownAttribRangeTokenEnd
            );
            if (nextTextualToken !== null) {
              astNode.syntax.guessedAttributesRange = {
                startOffset,
                endOffset: nextTextualToken.endOffset - 1
              };
            }
          }
        }
      }
      module2.exports = {
        buildAst: buildAst2
      };
    }
  });

  // ../../node_modules/@xml-tools/ast/lib/visit-ast.js
  var require_visit_ast = __commonJS({
    "../../node_modules/@xml-tools/ast/lib/visit-ast.js"(exports2, module2) {
      var { forEach: forEach2, isFunction: isFunction2 } = require_lodash();
      var { getAstChildrenReflective } = require_utils2();
      function accept(node, visitor) {
        switch (node.type) {
          case "XMLDocument": {
            if (isFunction2(visitor.visitXMLDocument)) {
              visitor.visitXMLDocument(node);
            }
            break;
          }
          case "XMLProlog": {
            if (isFunction2(visitor.visitXMLProlog)) {
              visitor.visitXMLProlog(node);
            }
            break;
          }
          case "XMLPrologAttribute": {
            if (isFunction2(visitor.visitXMLPrologAttribute)) {
              visitor.visitXMLPrologAttribute(node);
            }
            break;
          }
          case "XMLElement": {
            if (isFunction2(visitor.visitXMLElement)) {
              visitor.visitXMLElement(node);
            }
            break;
          }
          case "XMLAttribute": {
            if (isFunction2(visitor.visitXMLAttribute)) {
              visitor.visitXMLAttribute(node);
            }
            break;
          }
          case "XMLTextContent": {
            if (isFunction2(visitor.visitXMLTextContent)) {
              visitor.visitXMLTextContent(node);
            }
            break;
          }
          /* istanbul ignore next  defensive programming */
          default:
            throw Error("None Exhaustive Match");
        }
        const astChildren = getAstChildrenReflective(node);
        forEach2(astChildren, (childNode) => {
          accept(childNode, visitor);
        });
      }
      module2.exports = {
        accept
      };
    }
  });

  // ../../node_modules/@xml-tools/ast/lib/api.js
  var require_api4 = __commonJS({
    "../../node_modules/@xml-tools/ast/lib/api.js"(exports2, module2) {
      var { buildAst: buildAst2 } = require_build_ast();
      var { accept } = require_visit_ast();
      var { DEFAULT_NS } = require_constants2();
      module2.exports = {
        buildAst: buildAst2,
        accept,
        DEFAULT_NS
      };
    }
  });

  // ../../node_modules/@xml-tools/validation/lib/validate.js
  var require_validate = __commonJS({
    "../../node_modules/@xml-tools/validation/lib/validate.js"(exports2, module2) {
      var { accept } = require_api4();
      var { defaultsDeep, flatMap } = require_lodash();
      function validate2(options) {
        const actualOptions = defaultsDeep(options, {
          validators: {
            attribute: [],
            element: []
          }
        });
        let issues = [];
        const validateVisitor = {
          visitXMLElement: function(node) {
            const newIssues = flatMap(
              actualOptions.validators.element,
              (validator) => validator(node)
            );
            issues = issues.concat(newIssues);
          },
          visitXMLAttribute: function(node) {
            const newIssues = flatMap(
              actualOptions.validators.attribute,
              (validator) => validator(node)
            );
            issues = issues.concat(newIssues);
          }
        };
        accept(actualOptions.doc, validateVisitor);
        return issues;
      }
      module2.exports = {
        validate: validate2
      };
    }
  });

  // ../../node_modules/@xml-tools/validation/lib/api.js
  var require_api5 = __commonJS({
    "../../node_modules/@xml-tools/validation/lib/api.js"(exports2, module2) {
      var { validate: validate2 } = require_validate();
      module2.exports = {
        validate: validate2
      };
    }
  });

  // ../../node_modules/@xml-tools/constraints/lib/constraints/unique-attribute-keys.js
  var require_unique_attribute_keys = __commonJS({
    "../../node_modules/@xml-tools/constraints/lib/constraints/unique-attribute-keys.js"(exports2, module2) {
      var { groupBy: groupBy2, pickBy, reduce: reduce2, map: map2, filter: filter2 } = require_lodash();
      function validateUniqueAttributeKeys(elem) {
        const attributesWithKeys = filter2(elem.attributes, (_) => _.key !== null);
        const attribByKey = groupBy2(attributesWithKeys, "key");
        const nonUniqueAttribsGroups = pickBy(attribByKey, (_) => _.length > 1);
        const nonUniqueAttribs = reduce2(
          nonUniqueAttribsGroups,
          (result, attribsGroup) => result.concat(attribsGroup),
          []
        );
        const validationIssues = map2(nonUniqueAttribs, (_) => {
          const keyToken = _.syntax.key;
          return {
            msg: `duplicate attribute: "${_.key}"`,
            node: _,
            severity: "error",
            position: {
              startOffset: keyToken.startOffset,
              endOffset: keyToken.endOffset
            }
          };
        });
        return validationIssues;
      }
      module2.exports = {
        validateUniqueAttributeKeys
      };
    }
  });

  // ../../node_modules/@xml-tools/constraints/lib/constraints/tag-closing-name-match.js
  var require_tag_closing_name_match = __commonJS({
    "../../node_modules/@xml-tools/constraints/lib/constraints/tag-closing-name-match.js"(exports2, module2) {
      function validateTagClosingNameMatch(elem) {
        const openTagToken = elem.syntax.openName;
        const closeTagToken = elem.syntax.closeName;
        if (!openTagToken || !closeTagToken) {
          return [];
        }
        if (openTagToken.image === closeTagToken.image) {
          return [];
        } else {
          return [
            {
              msg: `tags mismatch: "${openTagToken.image}" must match closing tag: "${closeTagToken.image}"`,
              node: elem,
              severity: "error",
              position: {
                startOffset: openTagToken.startOffset,
                endOffset: openTagToken.endOffset
              }
            },
            {
              msg: `tags mismatch: "${closeTagToken.image}" must match opening tag: "${openTagToken.image}"`,
              node: elem,
              severity: "error",
              position: {
                startOffset: closeTagToken.startOffset,
                endOffset: closeTagToken.endOffset
              }
            }
          ];
        }
      }
      module2.exports = {
        validateTagClosingNameMatch
      };
    }
  });

  // ../../node_modules/@xml-tools/constraints/lib/api.js
  var require_api6 = __commonJS({
    "../../node_modules/@xml-tools/constraints/lib/api.js"(exports2, module2) {
      var { validate: validate2 } = require_api5();
      var {
        validateUniqueAttributeKeys
      } = require_unique_attribute_keys();
      var {
        validateTagClosingNameMatch
      } = require_tag_closing_name_match();
      function checkConstraints2(ast) {
        const constraintIssues = validate2({
          doc: ast,
          validators: {
            element: [validateTagClosingNameMatch, validateUniqueAttributeKeys]
          }
        });
        return constraintIssues;
      }
      module2.exports = {
        checkConstraints: checkConstraints2
      };
    }
  });

  // src/workers/xml-worker.ts
  var xml_worker_exports = {};
  __export(xml_worker_exports, {
    XmlWorker: () => XmlWorker,
    issuesToDiagnostic: () => issuesToDiagnostic,
    lexingErrorsToDiagnostic: () => lexingErrorsToDiagnostic,
    parsingErrorsToDiagnostic: () => parsingErrorsToDiagnostic
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

  // src/workers/xml-worker.ts
  var import_parser = __toESM(require_api2());
  var import_ast = __toESM(require_api4());
  var import_constraints = __toESM(require_api6());
  var import_validation = __toESM(require_api5());

  // ../ace-linters/src/services/xml/validators.ts
  function namespaceValidator(element) {
    var _a;
    const issues = [];
    const declared = (_a = element.namespaces) != null ? _a : {};
    function checkPrefix(prefix, node) {
      if (!prefix) return;
      if (prefix === "xml") return;
      if (!declared[prefix]) {
        issues.push({
          msg: `Namespace prefix '${prefix}' is not declared`,
          node,
          position: node.position,
          severity: "error"
        });
      }
    }
    if (element.ns) {
      checkPrefix(element.ns, element);
    }
    return issues;
  }

  // src/workers/xml-worker.ts
  var XmlWorker = class extends Mirror {
    constructor(sender) {
      super(sender);
      this.setTimeout(500);
    }
    onUpdate() {
      var value = this.doc.getValue();
      var errors = [];
      if (!new RegExp("^\\s*$", "s").test(value)) {
        try {
          const { cst, tokenVector, lexErrors, parseErrors } = (0, import_parser.parse)(
            value
          );
          const xmlDoc = (0, import_ast.buildAst)(cst, tokenVector);
          const constraintsIssues = (0, import_constraints.checkConstraints)(xmlDoc);
          const elementValidators = [namespaceValidator];
          const attributeValidators = [];
          const customIssues = (0, import_validation.validate)({
            doc: xmlDoc,
            validators: {
              element: elementValidators,
              attribute: attributeValidators
            }
          });
          errors = [
            ...lexingErrorsToDiagnostic(
              lexErrors,
              this.doc
            ),
            ...parsingErrorsToDiagnostic(
              parseErrors,
              this.doc
            ),
            ...issuesToDiagnostic(
              constraintsIssues,
              this.doc
            ),
            ...issuesToDiagnostic(
              customIssues,
              this.doc
            )
          ];
        } catch (e) {
          console.error(e);
        }
      }
      this.sender.emit("error", errors);
    }
  };
  function lexingErrorsToDiagnostic(errors, document) {
    return errors.map((el) => {
      var _a;
      var position = document.indexToPosition(el.offset);
      return {
        text: el.message,
        row: position.row,
        column: position.column,
        type: (_a = el.severity) != null ? _a : "error"
      };
    });
  }
  function parsingErrorsToDiagnostic(errors, document) {
    return errors.map((el) => {
      var _a;
      var position = document.indexToPosition(el.token.startOffset);
      return {
        text: el.message,
        row: position.row,
        column: position.column,
        type: (_a = el.severity) != null ? _a : "error"
      };
    });
  }
  function issuesToDiagnostic(errors, document) {
    return errors.map((el) => {
      var _a;
      var position = document.indexToPosition(el.position.startOffset);
      return {
        text: el.msg,
        row: position.row,
        column: position.column,
        type: (_a = el.severity) != null ? _a : "error"
      };
    });
  }
  return __toCommonJS(xml_worker_exports);
})();
/*! Bundled license information:

lodash/lodash.js:
  (**
   * @license
   * Lodash <https://lodash.com/>
   * Copyright OpenJS Foundation and other contributors <https://openjsf.org/>
   * Released under MIT license <https://lodash.com/license>
   * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
   * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
   *)
*/
aceLegacyWorkerModule = aceLegacyWorkerModule.default || aceLegacyWorkerModule;

exports.Worker = aceLegacyWorkerModule.XmlWorker;
});
