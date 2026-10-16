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

define("ace/mode/lua_worker", [], function(require, exports, module) {
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

  // ../../node_modules/luaparse/luaparse.js
  var require_luaparse = __commonJS({
    "../../node_modules/luaparse/luaparse.js"(exports, module) {
      (function(root, name, factory) {
        "use strict";
        var objectTypes = {
          "function": true,
          "object": true
        }, freeExports = objectTypes[typeof exports] && exports && !exports.nodeType && exports, freeModule = objectTypes[typeof module] && module && !module.nodeType && module, freeGlobal = freeExports && freeModule && typeof global === "object" && global, moduleExports = freeModule && freeModule.exports === freeExports && freeExports;
        if (freeGlobal && (freeGlobal.global === freeGlobal || /* istanbul ignore next */
        freeGlobal.window === freeGlobal || /* istanbul ignore next */
        freeGlobal.self === freeGlobal)) {
          root = freeGlobal;
        }
        if (typeof define === "function" && /* istanbul ignore next */
        typeof define.amd === "object" && /* istanbul ignore next */
        define.amd) {
          define(["exports"], factory);
          if (freeExports && moduleExports) factory(freeModule.exports);
        } else if (freeExports && freeModule) {
          if (moduleExports) factory(freeModule.exports);
          else factory(freeExports);
        } else {
          factory(root[name] = {});
        }
      })(exports, "luaparse", function(exports2) {
        "use strict";
        exports2.version = "0.3.1";
        var input, options, length, features, encodingMode;
        var defaultOptions = exports2.defaultOptions = {
          // Explicitly tell the parser when the input ends.
          wait: false,
          comments: true,
          scope: false,
          locations: false,
          ranges: false,
          onCreateNode: null,
          onCreateScope: null,
          onDestroyScope: null,
          onLocalDeclaration: null,
          luaVersion: "5.1",
          encodingMode: "none"
        };
        function encodeUTF8(codepoint, highMask) {
          highMask = highMask || 0;
          if (codepoint < 128) {
            return String.fromCharCode(codepoint);
          } else if (codepoint < 2048) {
            return String.fromCharCode(
              highMask | 192 | codepoint >> 6,
              highMask | 128 | codepoint & 63
            );
          } else if (codepoint < 65536) {
            return String.fromCharCode(
              highMask | 224 | codepoint >> 12,
              highMask | 128 | codepoint >> 6 & 63,
              highMask | 128 | codepoint & 63
            );
          } else if (codepoint < 1114112) {
            return String.fromCharCode(
              highMask | 240 | codepoint >> 18,
              highMask | 128 | codepoint >> 12 & 63,
              highMask | 128 | codepoint >> 6 & 63,
              highMask | 128 | codepoint & 63
            );
          } else {
            return null;
          }
        }
        function toHex(num, digits) {
          var result = num.toString(16);
          while (result.length < digits)
            result = "0" + result;
          return result;
        }
        function checkChars(rx) {
          return function(s) {
            var m = rx.exec(s);
            if (!m)
              return s;
            raise(null, errors.invalidCodeUnit, toHex(m[0].charCodeAt(0), 4).toUpperCase());
          };
        }
        var encodingModes = {
          // `pseudo-latin1` encoding mode: assume the input was decoded with the latin1 encoding
          // WARNING: latin1 does **NOT** mean cp1252 here like in the bone-headed WHATWG standard;
          // it means true ISO/IEC 8859-1 identity-mapped to Basic Latin and Latin-1 Supplement blocks
          "pseudo-latin1": {
            fixup: checkChars(/[^\x00-\xff]/),
            encodeByte: function(value) {
              if (value === null)
                return "";
              return String.fromCharCode(value);
            },
            encodeUTF8: function(codepoint) {
              return encodeUTF8(codepoint);
            }
          },
          // `x-user-defined` encoding mode: assume the input was decoded with the WHATWG `x-user-defined` encoding
          "x-user-defined": {
            fixup: checkChars(/[^\x00-\x7f\uf780-\uf7ff]/),
            encodeByte: function(value) {
              if (value === null)
                return "";
              if (value >= 128)
                return String.fromCharCode(value | 63232);
              return String.fromCharCode(value);
            },
            encodeUTF8: function(codepoint) {
              return encodeUTF8(codepoint, 63232);
            }
          },
          // `none` encoding mode: disregard intrepretation of string literals, leave identifiers as-is
          "none": {
            discardStrings: true,
            fixup: function(s) {
              return s;
            },
            encodeByte: function(value) {
              return "";
            },
            encodeUTF8: function(codepoint) {
              return "";
            }
          }
        };
        var EOF = 1, StringLiteral = 2, Keyword = 4, Identifier = 8, NumericLiteral = 16, Punctuator = 32, BooleanLiteral = 64, NilLiteral = 128, VarargLiteral = 256;
        exports2.tokenTypes = {
          EOF,
          StringLiteral,
          Keyword,
          Identifier,
          NumericLiteral,
          Punctuator,
          BooleanLiteral,
          NilLiteral,
          VarargLiteral
        };
        var errors = exports2.errors = {
          unexpected: "unexpected %1 '%2' near '%3'",
          unexpectedEOF: "unexpected symbol near '<eof>'",
          expected: "'%1' expected near '%2'",
          expectedToken: "%1 expected near '%2'",
          unfinishedString: "unfinished string near '%1'",
          malformedNumber: "malformed number near '%1'",
          decimalEscapeTooLarge: "decimal escape too large near '%1'",
          invalidEscape: "invalid escape sequence near '%1'",
          hexadecimalDigitExpected: "hexadecimal digit expected near '%1'",
          braceExpected: "missing '%1' near '%2'",
          tooLargeCodepoint: "UTF-8 value too large near '%1'",
          unfinishedLongString: "unfinished long string (starting at line %1) near '%2'",
          unfinishedLongComment: "unfinished long comment (starting at line %1) near '%2'",
          ambiguousSyntax: "ambiguous syntax (function call x new statement) near '%1'",
          noLoopToBreak: "no loop to break near '%1'",
          labelAlreadyDefined: "label '%1' already defined on line %2",
          labelNotVisible: "no visible label '%1' for <goto>",
          gotoJumpInLocalScope: "<goto %1> jumps into the scope of local '%2'",
          cannotUseVararg: "cannot use '...' outside a vararg function near '%1'",
          invalidCodeUnit: "code unit U+%1 is not allowed in the current encoding mode"
        };
        var ast = exports2.ast = {
          labelStatement: function(label) {
            return {
              type: "LabelStatement",
              label
            };
          },
          breakStatement: function() {
            return {
              type: "BreakStatement"
            };
          },
          gotoStatement: function(label) {
            return {
              type: "GotoStatement",
              label
            };
          },
          returnStatement: function(args) {
            return {
              type: "ReturnStatement",
              "arguments": args
            };
          },
          ifStatement: function(clauses) {
            return {
              type: "IfStatement",
              clauses
            };
          },
          ifClause: function(condition, body) {
            return {
              type: "IfClause",
              condition,
              body
            };
          },
          elseifClause: function(condition, body) {
            return {
              type: "ElseifClause",
              condition,
              body
            };
          },
          elseClause: function(body) {
            return {
              type: "ElseClause",
              body
            };
          },
          whileStatement: function(condition, body) {
            return {
              type: "WhileStatement",
              condition,
              body
            };
          },
          doStatement: function(body) {
            return {
              type: "DoStatement",
              body
            };
          },
          repeatStatement: function(condition, body) {
            return {
              type: "RepeatStatement",
              condition,
              body
            };
          },
          localStatement: function(variables, init) {
            return {
              type: "LocalStatement",
              variables,
              init
            };
          },
          assignmentStatement: function(variables, init) {
            return {
              type: "AssignmentStatement",
              variables,
              init
            };
          },
          callStatement: function(expression) {
            return {
              type: "CallStatement",
              expression
            };
          },
          functionStatement: function(identifier, parameters, isLocal, body) {
            return {
              type: "FunctionDeclaration",
              identifier,
              isLocal,
              parameters,
              body
            };
          },
          forNumericStatement: function(variable, start, end2, step, body) {
            return {
              type: "ForNumericStatement",
              variable,
              start,
              end: end2,
              step,
              body
            };
          },
          forGenericStatement: function(variables, iterators, body) {
            return {
              type: "ForGenericStatement",
              variables,
              iterators,
              body
            };
          },
          chunk: function(body) {
            return {
              type: "Chunk",
              body
            };
          },
          identifier: function(name) {
            return {
              type: "Identifier",
              name
            };
          },
          literal: function(type, value, raw) {
            type = type === StringLiteral ? "StringLiteral" : type === NumericLiteral ? "NumericLiteral" : type === BooleanLiteral ? "BooleanLiteral" : type === NilLiteral ? "NilLiteral" : "VarargLiteral";
            return {
              type,
              value,
              raw
            };
          },
          tableKey: function(key, value) {
            return {
              type: "TableKey",
              key,
              value
            };
          },
          tableKeyString: function(key, value) {
            return {
              type: "TableKeyString",
              key,
              value
            };
          },
          tableValue: function(value) {
            return {
              type: "TableValue",
              value
            };
          },
          tableConstructorExpression: function(fields) {
            return {
              type: "TableConstructorExpression",
              fields
            };
          },
          binaryExpression: function(operator, left, right) {
            var type = "and" === operator || "or" === operator ? "LogicalExpression" : "BinaryExpression";
            return {
              type,
              operator,
              left,
              right
            };
          },
          unaryExpression: function(operator, argument) {
            return {
              type: "UnaryExpression",
              operator,
              argument
            };
          },
          memberExpression: function(base, indexer, identifier) {
            return {
              type: "MemberExpression",
              indexer,
              identifier,
              base
            };
          },
          indexExpression: function(base, index2) {
            return {
              type: "IndexExpression",
              base,
              index: index2
            };
          },
          callExpression: function(base, args) {
            return {
              type: "CallExpression",
              base,
              "arguments": args
            };
          },
          tableCallExpression: function(base, args) {
            return {
              type: "TableCallExpression",
              base,
              "arguments": args
            };
          },
          stringCallExpression: function(base, argument) {
            return {
              type: "StringCallExpression",
              base,
              argument
            };
          },
          comment: function(value, raw) {
            return {
              type: "Comment",
              value,
              raw
            };
          }
        };
        function finishNode(node) {
          if (trackLocations) {
            var location = locations.pop();
            location.complete();
            location.bless(node);
          }
          if (options.onCreateNode) options.onCreateNode(node);
          return node;
        }
        var slice = Array.prototype.slice, toString = Object.prototype.toString;
        var indexOf = (
          /* istanbul ignore next */
          function(array, element) {
            for (var i = 0, length2 = array.length; i < length2; ++i) {
              if (array[i] === element) return i;
            }
            return -1;
          }
        );
        if (Array.prototype.indexOf)
          indexOf = function(array, element) {
            return array.indexOf(element);
          };
        function indexOfObject(array, property, element) {
          for (var i = 0, length2 = array.length; i < length2; ++i) {
            if (array[i][property] === element) return i;
          }
          return -1;
        }
        function sprintf(format) {
          var args = slice.call(arguments, 1);
          format = format.replace(/%(\d)/g, function(match, index2) {
            return "" + args[index2 - 1] || /* istanbul ignore next */
            "";
          });
          return format;
        }
        var assign = (
          /* istanbul ignore next */
          function(dest) {
            var args = slice.call(arguments, 1), src, prop;
            for (var i = 0, length2 = args.length; i < length2; ++i) {
              src = args[i];
              for (prop in src)
                if (Object.prototype.hasOwnProperty.call(src, prop)) {
                  dest[prop] = src[prop];
                }
            }
            return dest;
          }
        );
        if (Object.assign)
          assign = Object.assign;
        exports2.SyntaxError = SyntaxError;
        function fixupError(e) {
          if (!Object.create)
            return e;
          return Object.create(e, {
            "line": { "writable": true, value: e.line },
            "index": { "writable": true, value: e.index },
            "column": { "writable": true, value: e.column }
          });
        }
        function raise(token2) {
          var message = sprintf.apply(null, slice.call(arguments, 1)), error, col;
          if (token2 === null || typeof token2.line === "undefined") {
            col = index - lineStart + 1;
            error = fixupError(new SyntaxError(sprintf("[%1:%2] %3", line, col, message)));
            error.index = index;
            error.line = line;
            error.column = col;
          } else {
            col = token2.range[0] - token2.lineStart;
            error = fixupError(new SyntaxError(sprintf("[%1:%2] %3", token2.line, col, message)));
            error.line = token2.line;
            error.index = token2.range[0];
            error.column = col;
          }
          throw error;
        }
        function tokenValue(token2) {
          var raw = input.slice(token2.range[0], token2.range[1]);
          if (raw)
            return raw;
          return token2.value;
        }
        function raiseUnexpectedToken(type, token2) {
          raise(token2, errors.expectedToken, type, tokenValue(token2));
        }
        function unexpected(found) {
          var near = tokenValue(lookahead);
          if ("undefined" !== typeof found.type) {
            var type;
            switch (found.type) {
              case StringLiteral:
                type = "string";
                break;
              case Keyword:
                type = "keyword";
                break;
              case Identifier:
                type = "identifier";
                break;
              case NumericLiteral:
                type = "number";
                break;
              case Punctuator:
                type = "symbol";
                break;
              case BooleanLiteral:
                type = "boolean";
                break;
              case NilLiteral:
                return raise(found, errors.unexpected, "symbol", "nil", near);
              case EOF:
                return raise(found, errors.unexpectedEOF);
            }
            return raise(found, errors.unexpected, type, tokenValue(found), near);
          }
          return raise(found, errors.unexpected, "symbol", found, near);
        }
        var index, token, previousToken, lookahead, comments, tokenStart, line, lineStart;
        exports2.lex = lex;
        function lex() {
          skipWhiteSpace();
          while (45 === input.charCodeAt(index) && 45 === input.charCodeAt(index + 1)) {
            scanComment();
            skipWhiteSpace();
          }
          if (index >= length) return {
            type: EOF,
            value: "<eof>",
            line,
            lineStart,
            range: [index, index]
          };
          var charCode = input.charCodeAt(index), next2 = input.charCodeAt(index + 1);
          tokenStart = index;
          if (isIdentifierStart(charCode)) return scanIdentifierOrKeyword();
          switch (charCode) {
            case 39:
            case 34:
              return scanStringLiteral();
            case 48:
            case 49:
            case 50:
            case 51:
            case 52:
            case 53:
            case 54:
            case 55:
            case 56:
            case 57:
              return scanNumericLiteral();
            case 46:
              if (isDecDigit(next2)) return scanNumericLiteral();
              if (46 === next2) {
                if (46 === input.charCodeAt(index + 2)) return scanVarargLiteral();
                return scanPunctuator("..");
              }
              return scanPunctuator(".");
            case 61:
              if (61 === next2) return scanPunctuator("==");
              return scanPunctuator("=");
            case 62:
              if (features.bitwiseOperators) {
                if (62 === next2) return scanPunctuator(">>");
              }
              if (61 === next2) return scanPunctuator(">=");
              return scanPunctuator(">");
            case 60:
              if (features.bitwiseOperators) {
                if (60 === next2) return scanPunctuator("<<");
              }
              if (61 === next2) return scanPunctuator("<=");
              return scanPunctuator("<");
            case 126:
              if (61 === next2) return scanPunctuator("~=");
              if (!features.bitwiseOperators)
                break;
              return scanPunctuator("~");
            case 58:
              if (features.labels) {
                if (58 === next2) return scanPunctuator("::");
              }
              return scanPunctuator(":");
            case 91:
              if (91 === next2 || 61 === next2) return scanLongStringLiteral();
              return scanPunctuator("[");
            case 47:
              if (features.integerDivision) {
                if (47 === next2) return scanPunctuator("//");
              }
              return scanPunctuator("/");
            case 38:
            case 124:
              if (!features.bitwiseOperators)
                break;
            /* fall through */
            case 42:
            case 94:
            case 37:
            case 44:
            case 123:
            case 125:
            case 93:
            case 40:
            case 41:
            case 59:
            case 35:
            case 45:
            case 43:
              return scanPunctuator(input.charAt(index));
          }
          return unexpected(input.charAt(index));
        }
        function consumeEOL() {
          var charCode = input.charCodeAt(index), peekCharCode = input.charCodeAt(index + 1);
          if (isLineTerminator(charCode)) {
            if (10 === charCode && 13 === peekCharCode) ++index;
            if (13 === charCode && 10 === peekCharCode) ++index;
            ++line;
            lineStart = ++index;
            return true;
          }
          return false;
        }
        function skipWhiteSpace() {
          while (index < length) {
            var charCode = input.charCodeAt(index);
            if (isWhiteSpace(charCode)) {
              ++index;
            } else if (!consumeEOL()) {
              break;
            }
          }
        }
        function scanIdentifierOrKeyword() {
          var value, type;
          while (isIdentifierPart(input.charCodeAt(++index))) ;
          value = encodingMode.fixup(input.slice(tokenStart, index));
          if (isKeyword(value)) {
            type = Keyword;
          } else if ("true" === value || "false" === value) {
            type = BooleanLiteral;
            value = "true" === value;
          } else if ("nil" === value) {
            type = NilLiteral;
            value = null;
          } else {
            type = Identifier;
          }
          return {
            type,
            value,
            line,
            lineStart,
            range: [tokenStart, index]
          };
        }
        function scanPunctuator(value) {
          index += value.length;
          return {
            type: Punctuator,
            value,
            line,
            lineStart,
            range: [tokenStart, index]
          };
        }
        function scanVarargLiteral() {
          index += 3;
          return {
            type: VarargLiteral,
            value: "...",
            line,
            lineStart,
            range: [tokenStart, index]
          };
        }
        function scanStringLiteral() {
          var delimiter = input.charCodeAt(index++), beginLine = line, beginLineStart = lineStart, stringStart = index, string = encodingMode.discardStrings ? null : "", charCode;
          for (; ; ) {
            charCode = input.charCodeAt(index++);
            if (delimiter === charCode) break;
            if (index > length || isLineTerminator(charCode)) {
              string += input.slice(stringStart, index - 1);
              raise(null, errors.unfinishedString, input.slice(tokenStart, index - 1));
            }
            if (92 === charCode) {
              if (!encodingMode.discardStrings) {
                var beforeEscape = input.slice(stringStart, index - 1);
                string += encodingMode.fixup(beforeEscape);
              }
              var escapeValue = readEscapeSequence();
              if (!encodingMode.discardStrings)
                string += escapeValue;
              stringStart = index;
            }
          }
          if (!encodingMode.discardStrings) {
            string += encodingMode.encodeByte(null);
            string += encodingMode.fixup(input.slice(stringStart, index - 1));
          }
          return {
            type: StringLiteral,
            value: string,
            line: beginLine,
            lineStart: beginLineStart,
            lastLine: line,
            lastLineStart: lineStart,
            range: [tokenStart, index]
          };
        }
        function scanLongStringLiteral() {
          var beginLine = line, beginLineStart = lineStart, string = readLongString(false);
          if (false === string) raise(token, errors.expected, "[", tokenValue(token));
          return {
            type: StringLiteral,
            value: encodingMode.discardStrings ? null : encodingMode.fixup(string),
            line: beginLine,
            lineStart: beginLineStart,
            lastLine: line,
            lastLineStart: lineStart,
            range: [tokenStart, index]
          };
        }
        function scanNumericLiteral() {
          var character = input.charAt(index), next2 = input.charAt(index + 1);
          var literal = "0" === character && "xX".indexOf(next2 || null) >= 0 ? readHexLiteral() : readDecLiteral();
          var foundImaginaryUnit = readImaginaryUnitSuffix(), foundInt64Suffix = readInt64Suffix();
          if (foundInt64Suffix && (foundImaginaryUnit || literal.hasFractionPart)) {
            raise(null, errors.malformedNumber, input.slice(tokenStart, index));
          }
          return {
            type: NumericLiteral,
            value: literal.value,
            line,
            lineStart,
            range: [tokenStart, index]
          };
        }
        function readImaginaryUnitSuffix() {
          if (!features.imaginaryNumbers) return;
          if ("iI".indexOf(input.charAt(index) || null) >= 0) {
            ++index;
            return true;
          } else {
            return false;
          }
        }
        function readInt64Suffix() {
          if (!features.integerSuffixes) return;
          if ("uU".indexOf(input.charAt(index) || null) >= 0) {
            ++index;
            if ("lL".indexOf(input.charAt(index) || null) >= 0) {
              ++index;
              if ("lL".indexOf(input.charAt(index) || null) >= 0) {
                ++index;
                return "ULL";
              } else {
                raise(null, errors.malformedNumber, input.slice(tokenStart, index));
              }
            } else {
              raise(null, errors.malformedNumber, input.slice(tokenStart, index));
            }
          } else if ("lL".indexOf(input.charAt(index) || null) >= 0) {
            ++index;
            if ("lL".indexOf(input.charAt(index) || null) >= 0) {
              ++index;
              return "LL";
            } else {
              raise(null, errors.malformedNumber, input.slice(tokenStart, index));
            }
          }
        }
        function readHexLiteral() {
          var fraction = 0, binaryExponent = 1, binarySign = 1, digit, fractionStart, exponentStart, digitStart;
          digitStart = index += 2;
          if (!isHexDigit(input.charCodeAt(index)))
            raise(null, errors.malformedNumber, input.slice(tokenStart, index));
          while (isHexDigit(input.charCodeAt(index))) ++index;
          digit = parseInt(input.slice(digitStart, index), 16);
          var foundFraction = false;
          if ("." === input.charAt(index)) {
            foundFraction = true;
            fractionStart = ++index;
            while (isHexDigit(input.charCodeAt(index))) ++index;
            fraction = input.slice(fractionStart, index);
            fraction = fractionStart === index ? 0 : parseInt(fraction, 16) / Math.pow(16, index - fractionStart);
          }
          var foundBinaryExponent = false;
          if ("pP".indexOf(input.charAt(index) || null) >= 0) {
            foundBinaryExponent = true;
            ++index;
            if ("+-".indexOf(input.charAt(index) || null) >= 0)
              binarySign = "+" === input.charAt(index++) ? 1 : -1;
            exponentStart = index;
            if (!isDecDigit(input.charCodeAt(index)))
              raise(null, errors.malformedNumber, input.slice(tokenStart, index));
            while (isDecDigit(input.charCodeAt(index))) ++index;
            binaryExponent = input.slice(exponentStart, index);
            binaryExponent = Math.pow(2, binaryExponent * binarySign);
          }
          return {
            value: (digit + fraction) * binaryExponent,
            hasFractionPart: foundFraction || foundBinaryExponent
          };
        }
        function readDecLiteral() {
          while (isDecDigit(input.charCodeAt(index))) ++index;
          var foundFraction = false;
          if ("." === input.charAt(index)) {
            foundFraction = true;
            ++index;
            while (isDecDigit(input.charCodeAt(index))) ++index;
          }
          var foundExponent = false;
          if ("eE".indexOf(input.charAt(index) || null) >= 0) {
            foundExponent = true;
            ++index;
            if ("+-".indexOf(input.charAt(index) || null) >= 0) ++index;
            if (!isDecDigit(input.charCodeAt(index)))
              raise(null, errors.malformedNumber, input.slice(tokenStart, index));
            while (isDecDigit(input.charCodeAt(index))) ++index;
          }
          return {
            value: parseFloat(input.slice(tokenStart, index)),
            hasFractionPart: foundFraction || foundExponent
          };
        }
        function readUnicodeEscapeSequence() {
          var sequenceStart = index++;
          if (input.charAt(index++) !== "{")
            raise(null, errors.braceExpected, "{", "\\" + input.slice(sequenceStart, index));
          if (!isHexDigit(input.charCodeAt(index)))
            raise(null, errors.hexadecimalDigitExpected, "\\" + input.slice(sequenceStart, index));
          while (input.charCodeAt(index) === 48) ++index;
          var escStart = index;
          while (isHexDigit(input.charCodeAt(index))) {
            ++index;
            if (index - escStart > 6)
              raise(null, errors.tooLargeCodepoint, "\\" + input.slice(sequenceStart, index));
          }
          var b = input.charAt(index++);
          if (b !== "}") {
            if (b === '"' || b === "'")
              raise(null, errors.braceExpected, "}", "\\" + input.slice(sequenceStart, index--));
            else
              raise(null, errors.hexadecimalDigitExpected, "\\" + input.slice(sequenceStart, index));
          }
          var codepoint = parseInt(input.slice(escStart, index - 1) || "0", 16);
          var frag = "\\" + input.slice(sequenceStart, index);
          if (codepoint > 1114111) {
            raise(null, errors.tooLargeCodepoint, frag);
          }
          return encodingMode.encodeUTF8(codepoint, frag);
        }
        function readEscapeSequence() {
          var sequenceStart = index;
          switch (input.charAt(index)) {
            // Lua allow the following escape sequences.
            case "a":
              ++index;
              return "\x07";
            case "n":
              ++index;
              return "\n";
            case "r":
              ++index;
              return "\r";
            case "t":
              ++index;
              return "	";
            case "v":
              ++index;
              return "\v";
            case "b":
              ++index;
              return "\b";
            case "f":
              ++index;
              return "\f";
            // Backslash at the end of the line. We treat all line endings as equivalent,
            // and as representing the [LF] character (code 10). Lua 5.1 through 5.3
            // have been verified to behave the same way.
            case "\r":
            case "\n":
              consumeEOL();
              return "\n";
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7":
            case "8":
            case "9":
              while (isDecDigit(input.charCodeAt(index)) && index - sequenceStart < 3) ++index;
              var frag = input.slice(sequenceStart, index);
              var ddd = parseInt(frag, 10);
              if (ddd > 255) {
                raise(null, errors.decimalEscapeTooLarge, "\\" + ddd);
              }
              return encodingMode.encodeByte(ddd, "\\" + frag);
            case "z":
              if (features.skipWhitespaceEscape) {
                ++index;
                skipWhiteSpace();
                return "";
              }
              break;
            case "x":
              if (features.hexEscapes) {
                if (isHexDigit(input.charCodeAt(index + 1)) && isHexDigit(input.charCodeAt(index + 2))) {
                  index += 3;
                  return encodingMode.encodeByte(parseInt(input.slice(sequenceStart + 1, index), 16), "\\" + input.slice(sequenceStart, index));
                }
                raise(null, errors.hexadecimalDigitExpected, "\\" + input.slice(sequenceStart, index + 2));
              }
              break;
            case "u":
              if (features.unicodeEscapes)
                return readUnicodeEscapeSequence();
              break;
            case "\\":
            case '"':
            case "'":
              return input.charAt(index++);
          }
          if (features.strictEscapes)
            raise(null, errors.invalidEscape, "\\" + input.slice(sequenceStart, index + 1));
          return input.charAt(index++);
        }
        function scanComment() {
          tokenStart = index;
          index += 2;
          var character = input.charAt(index), content = "", isLong = false, commentStart = index, lineStartComment = lineStart, lineComment = line;
          if ("[" === character) {
            content = readLongString(true);
            if (false === content) content = character;
            else isLong = true;
          }
          if (!isLong) {
            while (index < length) {
              if (isLineTerminator(input.charCodeAt(index))) break;
              ++index;
            }
            if (options.comments) content = input.slice(commentStart, index);
          }
          if (options.comments) {
            var node = ast.comment(content, input.slice(tokenStart, index));
            if (options.locations) {
              node.loc = {
                start: { line: lineComment, column: tokenStart - lineStartComment },
                end: { line, column: index - lineStart }
              };
            }
            if (options.ranges) {
              node.range = [tokenStart, index];
            }
            if (options.onCreateNode) options.onCreateNode(node);
            comments.push(node);
          }
        }
        function readLongString(isComment) {
          var level = 0, content = "", terminator = false, character, stringStart, firstLine = line;
          ++index;
          while ("=" === input.charAt(index + level)) ++level;
          if ("[" !== input.charAt(index + level)) return false;
          index += level + 1;
          if (isLineTerminator(input.charCodeAt(index))) consumeEOL();
          stringStart = index;
          while (index < length) {
            while (isLineTerminator(input.charCodeAt(index))) consumeEOL();
            character = input.charAt(index++);
            if ("]" === character) {
              terminator = true;
              for (var i = 0; i < level; ++i) {
                if ("=" !== input.charAt(index + i)) terminator = false;
              }
              if ("]" !== input.charAt(index + level)) terminator = false;
            }
            if (terminator) {
              content += input.slice(stringStart, index - 1);
              index += level + 1;
              return content;
            }
          }
          raise(
            null,
            isComment ? errors.unfinishedLongComment : errors.unfinishedLongString,
            firstLine,
            "<eof>"
          );
        }
        function next() {
          previousToken = token;
          token = lookahead;
          lookahead = lex();
        }
        function consume(value) {
          if (value === token.value) {
            next();
            return true;
          }
          return false;
        }
        function expect(value) {
          if (value === token.value) next();
          else raise(token, errors.expected, value, tokenValue(token));
        }
        function isWhiteSpace(charCode) {
          return 9 === charCode || 32 === charCode || 11 === charCode || 12 === charCode;
        }
        function isLineTerminator(charCode) {
          return 10 === charCode || 13 === charCode;
        }
        function isDecDigit(charCode) {
          return charCode >= 48 && charCode <= 57;
        }
        function isHexDigit(charCode) {
          return charCode >= 48 && charCode <= 57 || charCode >= 97 && charCode <= 102 || charCode >= 65 && charCode <= 70;
        }
        function isIdentifierStart(charCode) {
          if (charCode >= 65 && charCode <= 90 || charCode >= 97 && charCode <= 122 || 95 === charCode)
            return true;
          if (features.extendedIdentifiers && charCode >= 128)
            return true;
          return false;
        }
        function isIdentifierPart(charCode) {
          if (charCode >= 65 && charCode <= 90 || charCode >= 97 && charCode <= 122 || 95 === charCode || charCode >= 48 && charCode <= 57)
            return true;
          if (features.extendedIdentifiers && charCode >= 128)
            return true;
          return false;
        }
        function isKeyword(id) {
          switch (id.length) {
            case 2:
              return "do" === id || "if" === id || "in" === id || "or" === id;
            case 3:
              return "and" === id || "end" === id || "for" === id || "not" === id;
            case 4:
              if ("else" === id || "then" === id)
                return true;
              if (features.labels && !features.contextualGoto)
                return "goto" === id;
              return false;
            case 5:
              return "break" === id || "local" === id || "until" === id || "while" === id;
            case 6:
              return "elseif" === id || "repeat" === id || "return" === id;
            case 8:
              return "function" === id;
          }
          return false;
        }
        function isUnary(token2) {
          if (Punctuator === token2.type) return "#-~".indexOf(token2.value) >= 0;
          if (Keyword === token2.type) return "not" === token2.value;
          return false;
        }
        function isBlockFollow(token2) {
          if (EOF === token2.type) return true;
          if (Keyword !== token2.type) return false;
          switch (token2.value) {
            case "else":
            case "elseif":
            case "end":
            case "until":
              return true;
            default:
              return false;
          }
        }
        var scopes, scopeDepth, globals;
        function createScope() {
          var scope = scopes[scopeDepth++].slice();
          scopes.push(scope);
          if (options.onCreateScope) options.onCreateScope();
        }
        function destroyScope() {
          var scope = scopes.pop();
          --scopeDepth;
          if (options.onDestroyScope) options.onDestroyScope();
        }
        function scopeIdentifierName(name) {
          if (options.onLocalDeclaration) options.onLocalDeclaration(name);
          if (-1 !== indexOf(scopes[scopeDepth], name)) return;
          scopes[scopeDepth].push(name);
        }
        function scopeIdentifier(node) {
          scopeIdentifierName(node.name);
          attachScope(node, true);
        }
        function attachScope(node, isLocal) {
          if (!isLocal && -1 === indexOfObject(globals, "name", node.name))
            globals.push(node);
          node.isLocal = isLocal;
        }
        function scopeHasName(name) {
          return -1 !== indexOf(scopes[scopeDepth], name);
        }
        var locations = [], trackLocations;
        function createLocationMarker() {
          return new Marker(token);
        }
        function Marker(token2) {
          if (options.locations) {
            this.loc = {
              start: {
                line: token2.line,
                column: token2.range[0] - token2.lineStart
              },
              end: {
                line: 0,
                column: 0
              }
            };
          }
          if (options.ranges) this.range = [token2.range[0], 0];
        }
        Marker.prototype.complete = function() {
          if (options.locations) {
            this.loc.end.line = previousToken.lastLine || previousToken.line;
            this.loc.end.column = previousToken.range[1] - (previousToken.lastLineStart || previousToken.lineStart);
          }
          if (options.ranges) {
            this.range[1] = previousToken.range[1];
          }
        };
        Marker.prototype.bless = function(node) {
          if (this.loc) {
            var loc = this.loc;
            node.loc = {
              start: {
                line: loc.start.line,
                column: loc.start.column
              },
              end: {
                line: loc.end.line,
                column: loc.end.column
              }
            };
          }
          if (this.range) {
            node.range = [
              this.range[0],
              this.range[1]
            ];
          }
        };
        function markLocation() {
          if (trackLocations) locations.push(createLocationMarker());
        }
        function pushLocation(marker) {
          if (trackLocations) locations.push(marker);
        }
        function FullFlowContext() {
          this.scopes = [];
          this.pendingGotos = [];
        }
        FullFlowContext.prototype.isInLoop = function() {
          var i = this.scopes.length;
          while (i-- > 0) {
            if (this.scopes[i].isLoop)
              return true;
          }
          return false;
        };
        FullFlowContext.prototype.pushScope = function(isLoop) {
          var scope = {
            labels: {},
            locals: [],
            deferredGotos: [],
            isLoop: !!isLoop
          };
          this.scopes.push(scope);
        };
        FullFlowContext.prototype.popScope = function() {
          for (var i = 0; i < this.pendingGotos.length; ++i) {
            var theGoto = this.pendingGotos[i];
            if (theGoto.maxDepth >= this.scopes.length) {
              if (--theGoto.maxDepth <= 0)
                raise(theGoto.token, errors.labelNotVisible, theGoto.target);
            }
          }
          this.scopes.pop();
        };
        FullFlowContext.prototype.addGoto = function(target, token2) {
          var localCounts = [];
          for (var i = 0; i < this.scopes.length; ++i) {
            var scope = this.scopes[i];
            localCounts.push(scope.locals.length);
            if (Object.prototype.hasOwnProperty.call(scope.labels, target))
              return;
          }
          this.pendingGotos.push({
            maxDepth: this.scopes.length,
            target,
            token: token2,
            localCounts
          });
        };
        FullFlowContext.prototype.addLabel = function(name, token2) {
          var scope = this.currentScope();
          if (Object.prototype.hasOwnProperty.call(scope.labels, name)) {
            raise(token2, errors.labelAlreadyDefined, name, scope.labels[name].line);
          } else {
            var newGotos = [];
            for (var i = 0; i < this.pendingGotos.length; ++i) {
              var theGoto = this.pendingGotos[i];
              if (theGoto.maxDepth >= this.scopes.length && theGoto.target === name) {
                if (theGoto.localCounts[this.scopes.length - 1] < scope.locals.length) {
                  scope.deferredGotos.push(theGoto);
                }
                continue;
              }
              newGotos.push(theGoto);
            }
            this.pendingGotos = newGotos;
          }
          scope.labels[name] = {
            localCount: scope.locals.length,
            line: token2.line
          };
        };
        FullFlowContext.prototype.addLocal = function(name, token2) {
          this.currentScope().locals.push({
            name,
            token: token2
          });
        };
        FullFlowContext.prototype.currentScope = function() {
          return this.scopes[this.scopes.length - 1];
        };
        FullFlowContext.prototype.raiseDeferredErrors = function() {
          var scope = this.currentScope();
          var bads = scope.deferredGotos;
          for (var i = 0; i < bads.length; ++i) {
            var theGoto = bads[i];
            raise(theGoto.token, errors.gotoJumpInLocalScope, theGoto.target, scope.locals[theGoto.localCounts[this.scopes.length - 1]].name);
          }
        };
        function LoopFlowContext() {
          this.level = 0;
          this.loopLevels = [];
        }
        LoopFlowContext.prototype.isInLoop = function() {
          return !!this.loopLevels.length;
        };
        LoopFlowContext.prototype.pushScope = function(isLoop) {
          ++this.level;
          if (isLoop)
            this.loopLevels.push(this.level);
        };
        LoopFlowContext.prototype.popScope = function() {
          var levels = this.loopLevels;
          var levlen = levels.length;
          if (levlen) {
            if (levels[levlen - 1] === this.level)
              levels.pop();
          }
          --this.level;
        };
        LoopFlowContext.prototype.addGoto = LoopFlowContext.prototype.addLabel = /* istanbul ignore next */
        function() {
          throw new Error("This should never happen");
        };
        LoopFlowContext.prototype.addLocal = LoopFlowContext.prototype.raiseDeferredErrors = function() {
        };
        function makeFlowContext() {
          return features.labels ? new FullFlowContext() : new LoopFlowContext();
        }
        function parseChunk() {
          next();
          markLocation();
          if (options.scope) createScope();
          var flowContext = makeFlowContext();
          flowContext.allowVararg = true;
          flowContext.pushScope();
          var body = parseBlock(flowContext);
          flowContext.popScope();
          if (options.scope) destroyScope();
          if (EOF !== token.type) unexpected(token);
          if (trackLocations && !body.length) previousToken = token;
          return finishNode(ast.chunk(body));
        }
        function parseBlock(flowContext) {
          var block = [], statement;
          while (!isBlockFollow(token)) {
            if ("return" === token.value || !features.relaxedBreak && "break" === token.value) {
              block.push(parseStatement(flowContext));
              break;
            }
            statement = parseStatement(flowContext);
            consume(";");
            if (statement) block.push(statement);
          }
          return block;
        }
        function parseStatement(flowContext) {
          markLocation();
          if (Punctuator === token.type) {
            if (consume("::")) return parseLabelStatement(flowContext);
          }
          if (features.emptyStatement) {
            if (consume(";")) {
              if (trackLocations) locations.pop();
              return;
            }
          }
          flowContext.raiseDeferredErrors();
          if (Keyword === token.type) {
            switch (token.value) {
              case "local":
                next();
                return parseLocalStatement(flowContext);
              case "if":
                next();
                return parseIfStatement(flowContext);
              case "return":
                next();
                return parseReturnStatement(flowContext);
              case "function":
                next();
                var name = parseFunctionName();
                return parseFunctionDeclaration(name);
              case "while":
                next();
                return parseWhileStatement(flowContext);
              case "for":
                next();
                return parseForStatement(flowContext);
              case "repeat":
                next();
                return parseRepeatStatement(flowContext);
              case "break":
                next();
                if (!flowContext.isInLoop())
                  raise(token, errors.noLoopToBreak, token.value);
                return parseBreakStatement();
              case "do":
                next();
                return parseDoStatement(flowContext);
              case "goto":
                next();
                return parseGotoStatement(flowContext);
            }
          }
          if (features.contextualGoto && token.type === Identifier && token.value === "goto" && lookahead.type === Identifier && lookahead.value !== "goto") {
            next();
            return parseGotoStatement(flowContext);
          }
          if (trackLocations) locations.pop();
          return parseAssignmentOrCallStatement(flowContext);
        }
        function parseLabelStatement(flowContext) {
          var nameToken = token, label = parseIdentifier();
          if (options.scope) {
            scopeIdentifierName("::" + nameToken.value + "::");
            attachScope(label, true);
          }
          expect("::");
          flowContext.addLabel(nameToken.value, nameToken);
          return finishNode(ast.labelStatement(label));
        }
        function parseBreakStatement() {
          return finishNode(ast.breakStatement());
        }
        function parseGotoStatement(flowContext) {
          var name = token.value, gotoToken = previousToken, label = parseIdentifier();
          flowContext.addGoto(name, gotoToken);
          return finishNode(ast.gotoStatement(label));
        }
        function parseDoStatement(flowContext) {
          if (options.scope) createScope();
          flowContext.pushScope();
          var body = parseBlock(flowContext);
          flowContext.popScope();
          if (options.scope) destroyScope();
          expect("end");
          return finishNode(ast.doStatement(body));
        }
        function parseWhileStatement(flowContext) {
          var condition = parseExpectedExpression(flowContext);
          expect("do");
          if (options.scope) createScope();
          flowContext.pushScope(true);
          var body = parseBlock(flowContext);
          flowContext.popScope();
          if (options.scope) destroyScope();
          expect("end");
          return finishNode(ast.whileStatement(condition, body));
        }
        function parseRepeatStatement(flowContext) {
          if (options.scope) createScope();
          flowContext.pushScope(true);
          var body = parseBlock(flowContext);
          expect("until");
          flowContext.raiseDeferredErrors();
          var condition = parseExpectedExpression(flowContext);
          flowContext.popScope();
          if (options.scope) destroyScope();
          return finishNode(ast.repeatStatement(condition, body));
        }
        function parseReturnStatement(flowContext) {
          var expressions = [];
          if ("end" !== token.value) {
            var expression = parseExpression(flowContext);
            if (null != expression) expressions.push(expression);
            while (consume(",")) {
              expression = parseExpectedExpression(flowContext);
              expressions.push(expression);
            }
            consume(";");
          }
          return finishNode(ast.returnStatement(expressions));
        }
        function parseIfStatement(flowContext) {
          var clauses = [], condition, body, marker;
          if (trackLocations) {
            marker = locations[locations.length - 1];
            locations.push(marker);
          }
          condition = parseExpectedExpression(flowContext);
          expect("then");
          if (options.scope) createScope();
          flowContext.pushScope();
          body = parseBlock(flowContext);
          flowContext.popScope();
          if (options.scope) destroyScope();
          clauses.push(finishNode(ast.ifClause(condition, body)));
          if (trackLocations) marker = createLocationMarker();
          while (consume("elseif")) {
            pushLocation(marker);
            condition = parseExpectedExpression(flowContext);
            expect("then");
            if (options.scope) createScope();
            flowContext.pushScope();
            body = parseBlock(flowContext);
            flowContext.popScope();
            if (options.scope) destroyScope();
            clauses.push(finishNode(ast.elseifClause(condition, body)));
            if (trackLocations) marker = createLocationMarker();
          }
          if (consume("else")) {
            if (trackLocations) {
              marker = new Marker(previousToken);
              locations.push(marker);
            }
            if (options.scope) createScope();
            flowContext.pushScope();
            body = parseBlock(flowContext);
            flowContext.popScope();
            if (options.scope) destroyScope();
            clauses.push(finishNode(ast.elseClause(body)));
          }
          expect("end");
          return finishNode(ast.ifStatement(clauses));
        }
        function parseForStatement(flowContext) {
          var variable = parseIdentifier(), body;
          if (options.scope) {
            createScope();
            scopeIdentifier(variable);
          }
          if (consume("=")) {
            var start = parseExpectedExpression(flowContext);
            expect(",");
            var end2 = parseExpectedExpression(flowContext);
            var step = consume(",") ? parseExpectedExpression(flowContext) : null;
            expect("do");
            flowContext.pushScope(true);
            body = parseBlock(flowContext);
            flowContext.popScope();
            expect("end");
            if (options.scope) destroyScope();
            return finishNode(ast.forNumericStatement(variable, start, end2, step, body));
          } else {
            var variables = [variable];
            while (consume(",")) {
              variable = parseIdentifier();
              if (options.scope) scopeIdentifier(variable);
              variables.push(variable);
            }
            expect("in");
            var iterators = [];
            do {
              var expression = parseExpectedExpression(flowContext);
              iterators.push(expression);
            } while (consume(","));
            expect("do");
            flowContext.pushScope(true);
            body = parseBlock(flowContext);
            flowContext.popScope();
            expect("end");
            if (options.scope) destroyScope();
            return finishNode(ast.forGenericStatement(variables, iterators, body));
          }
        }
        function parseLocalStatement(flowContext) {
          var name, declToken = previousToken;
          if (Identifier === token.type) {
            var variables = [], init = [];
            do {
              name = parseIdentifier();
              variables.push(name);
              flowContext.addLocal(name.name, declToken);
            } while (consume(","));
            if (consume("=")) {
              do {
                var expression = parseExpectedExpression(flowContext);
                init.push(expression);
              } while (consume(","));
            }
            if (options.scope) {
              for (var i = 0, l = variables.length; i < l; ++i) {
                scopeIdentifier(variables[i]);
              }
            }
            return finishNode(ast.localStatement(variables, init));
          }
          if (consume("function")) {
            name = parseIdentifier();
            flowContext.addLocal(name.name, declToken);
            if (options.scope) {
              scopeIdentifier(name);
              createScope();
            }
            return parseFunctionDeclaration(name, true);
          } else {
            raiseUnexpectedToken("<name>", token);
          }
        }
        function parseAssignmentOrCallStatement(flowContext) {
          var previous = token, marker, startMarker;
          var lvalue, base, name;
          var targets = [];
          if (trackLocations) startMarker = createLocationMarker();
          do {
            if (trackLocations) marker = createLocationMarker();
            if (Identifier === token.type) {
              name = token.value;
              base = parseIdentifier();
              if (options.scope) attachScope(base, scopeHasName(name));
              lvalue = true;
            } else if ("(" === token.value) {
              next();
              base = parseExpectedExpression(flowContext);
              expect(")");
              lvalue = false;
            } else {
              return unexpected(token);
            }
            both: for (; ; ) {
              var newBase;
              switch (StringLiteral === token.type ? '"' : token.value) {
                case ".":
                case "[":
                  lvalue = true;
                  break;
                case ":":
                case "(":
                case "{":
                case '"':
                  lvalue = null;
                  break;
                default:
                  break both;
              }
              base = parsePrefixExpressionPart(base, marker, flowContext);
            }
            targets.push(base);
            if ("," !== token.value)
              break;
            if (!lvalue) {
              return unexpected(token);
            }
            next();
          } while (true);
          if (targets.length === 1 && lvalue === null) {
            pushLocation(marker);
            return finishNode(ast.callStatement(targets[0]));
          } else if (!lvalue) {
            return unexpected(token);
          }
          expect("=");
          var values = [];
          do {
            values.push(parseExpectedExpression(flowContext));
          } while (consume(","));
          pushLocation(startMarker);
          return finishNode(ast.assignmentStatement(targets, values));
        }
        function parseIdentifier() {
          markLocation();
          var identifier = token.value;
          if (Identifier !== token.type) raiseUnexpectedToken("<name>", token);
          next();
          return finishNode(ast.identifier(identifier));
        }
        function parseFunctionDeclaration(name, isLocal) {
          var flowContext = makeFlowContext();
          flowContext.pushScope();
          var parameters = [];
          expect("(");
          if (!consume(")")) {
            while (true) {
              if (Identifier === token.type) {
                var parameter = parseIdentifier();
                if (options.scope) scopeIdentifier(parameter);
                parameters.push(parameter);
                if (consume(",")) continue;
              } else if (VarargLiteral === token.type) {
                flowContext.allowVararg = true;
                parameters.push(parsePrimaryExpression(flowContext));
              } else {
                raiseUnexpectedToken("<name> or '...'", token);
              }
              expect(")");
              break;
            }
          }
          var body = parseBlock(flowContext);
          flowContext.popScope();
          expect("end");
          if (options.scope) destroyScope();
          isLocal = isLocal || false;
          return finishNode(ast.functionStatement(name, parameters, isLocal, body));
        }
        function parseFunctionName() {
          var base, name, marker;
          if (trackLocations) marker = createLocationMarker();
          base = parseIdentifier();
          if (options.scope) {
            attachScope(base, scopeHasName(base.name));
            createScope();
          }
          while (consume(".")) {
            pushLocation(marker);
            name = parseIdentifier();
            base = finishNode(ast.memberExpression(base, ".", name));
          }
          if (consume(":")) {
            pushLocation(marker);
            name = parseIdentifier();
            base = finishNode(ast.memberExpression(base, ":", name));
            if (options.scope) scopeIdentifierName("self");
          }
          return base;
        }
        function parseTableConstructor(flowContext) {
          var fields = [], key, value;
          while (true) {
            markLocation();
            if (Punctuator === token.type && consume("[")) {
              key = parseExpectedExpression(flowContext);
              expect("]");
              expect("=");
              value = parseExpectedExpression(flowContext);
              fields.push(finishNode(ast.tableKey(key, value)));
            } else if (Identifier === token.type) {
              if ("=" === lookahead.value) {
                key = parseIdentifier();
                next();
                value = parseExpectedExpression(flowContext);
                fields.push(finishNode(ast.tableKeyString(key, value)));
              } else {
                value = parseExpectedExpression(flowContext);
                fields.push(finishNode(ast.tableValue(value)));
              }
            } else {
              if (null == (value = parseExpression(flowContext))) {
                locations.pop();
                break;
              }
              fields.push(finishNode(ast.tableValue(value)));
            }
            if (",;".indexOf(token.value) >= 0) {
              next();
              continue;
            }
            break;
          }
          expect("}");
          return finishNode(ast.tableConstructorExpression(fields));
        }
        function parseExpression(flowContext) {
          var expression = parseSubExpression(0, flowContext);
          return expression;
        }
        function parseExpectedExpression(flowContext) {
          var expression = parseExpression(flowContext);
          if (null == expression) raiseUnexpectedToken("<expression>", token);
          else return expression;
        }
        function binaryPrecedence(operator) {
          var charCode = operator.charCodeAt(0), length2 = operator.length;
          if (1 === length2) {
            switch (charCode) {
              case 94:
                return 12;
              // ^
              case 42:
              case 47:
              case 37:
                return 10;
              // * / %
              case 43:
              case 45:
                return 9;
              // + -
              case 38:
                return 6;
              // &
              case 126:
                return 5;
              // ~
              case 124:
                return 4;
              // |
              case 60:
              case 62:
                return 3;
            }
          } else if (2 === length2) {
            switch (charCode) {
              case 47:
                return 10;
              // //
              case 46:
                return 8;
              // ..
              case 60:
              case 62:
                if ("<<" === operator || ">>" === operator) return 7;
                return 3;
              // <= >=
              case 61:
              case 126:
                return 3;
              // == ~=
              case 111:
                return 1;
            }
          } else if (97 === charCode && "and" === operator) return 2;
          return 0;
        }
        function parseSubExpression(minPrecedence, flowContext) {
          var operator = token.value, expression, marker;
          if (trackLocations) marker = createLocationMarker();
          if (isUnary(token)) {
            markLocation();
            next();
            var argument = parseSubExpression(10, flowContext);
            if (argument == null) raiseUnexpectedToken("<expression>", token);
            expression = finishNode(ast.unaryExpression(operator, argument));
          }
          if (null == expression) {
            expression = parsePrimaryExpression(flowContext);
            if (null == expression) {
              expression = parsePrefixExpression(flowContext);
            }
          }
          if (null == expression) return null;
          var precedence;
          while (true) {
            operator = token.value;
            precedence = Punctuator === token.type || Keyword === token.type ? binaryPrecedence(operator) : 0;
            if (precedence === 0 || precedence <= minPrecedence) break;
            if ("^" === operator || ".." === operator) --precedence;
            next();
            var right = parseSubExpression(precedence, flowContext);
            if (null == right) raiseUnexpectedToken("<expression>", token);
            if (trackLocations) locations.push(marker);
            expression = finishNode(ast.binaryExpression(operator, expression, right));
          }
          return expression;
        }
        function parsePrefixExpressionPart(base, marker, flowContext) {
          var expression, identifier;
          if (Punctuator === token.type) {
            switch (token.value) {
              case "[":
                pushLocation(marker);
                next();
                expression = parseExpectedExpression(flowContext);
                expect("]");
                return finishNode(ast.indexExpression(base, expression));
              case ".":
                pushLocation(marker);
                next();
                identifier = parseIdentifier();
                return finishNode(ast.memberExpression(base, ".", identifier));
              case ":":
                pushLocation(marker);
                next();
                identifier = parseIdentifier();
                base = finishNode(ast.memberExpression(base, ":", identifier));
                pushLocation(marker);
                return parseCallExpression(base, flowContext);
              case "(":
              case "{":
                pushLocation(marker);
                return parseCallExpression(base, flowContext);
            }
          } else if (StringLiteral === token.type) {
            pushLocation(marker);
            return parseCallExpression(base, flowContext);
          }
          return null;
        }
        function parsePrefixExpression(flowContext) {
          var base, name, marker;
          if (trackLocations) marker = createLocationMarker();
          if (Identifier === token.type) {
            name = token.value;
            base = parseIdentifier();
            if (options.scope) attachScope(base, scopeHasName(name));
          } else if (consume("(")) {
            base = parseExpectedExpression(flowContext);
            expect(")");
          } else {
            return null;
          }
          for (; ; ) {
            var newBase = parsePrefixExpressionPart(base, marker, flowContext);
            if (newBase === null)
              break;
            base = newBase;
          }
          return base;
        }
        function parseCallExpression(base, flowContext) {
          if (Punctuator === token.type) {
            switch (token.value) {
              case "(":
                if (!features.emptyStatement) {
                  if (token.line !== previousToken.line)
                    raise(null, errors.ambiguousSyntax, token.value);
                }
                next();
                var expressions = [];
                var expression = parseExpression(flowContext);
                if (null != expression) expressions.push(expression);
                while (consume(",")) {
                  expression = parseExpectedExpression(flowContext);
                  expressions.push(expression);
                }
                expect(")");
                return finishNode(ast.callExpression(base, expressions));
              case "{":
                markLocation();
                next();
                var table = parseTableConstructor(flowContext);
                return finishNode(ast.tableCallExpression(base, table));
            }
          } else if (StringLiteral === token.type) {
            return finishNode(ast.stringCallExpression(base, parsePrimaryExpression(flowContext)));
          }
          raiseUnexpectedToken("function arguments", token);
        }
        function parsePrimaryExpression(flowContext) {
          var literals = StringLiteral | NumericLiteral | BooleanLiteral | NilLiteral | VarargLiteral, value = token.value, type = token.type, marker;
          if (trackLocations) marker = createLocationMarker();
          if (type === VarargLiteral && !flowContext.allowVararg) {
            raise(token, errors.cannotUseVararg, token.value);
          }
          if (type & literals) {
            pushLocation(marker);
            var raw = input.slice(token.range[0], token.range[1]);
            next();
            return finishNode(ast.literal(type, value, raw));
          } else if (Keyword === type && "function" === value) {
            pushLocation(marker);
            next();
            if (options.scope) createScope();
            return parseFunctionDeclaration(null);
          } else if (consume("{")) {
            pushLocation(marker);
            return parseTableConstructor(flowContext);
          }
        }
        exports2.parse = parse;
        var versionFeatures = {
          "5.1": {},
          "5.2": {
            labels: true,
            emptyStatement: true,
            hexEscapes: true,
            skipWhitespaceEscape: true,
            strictEscapes: true,
            relaxedBreak: true
          },
          "5.3": {
            labels: true,
            emptyStatement: true,
            hexEscapes: true,
            skipWhitespaceEscape: true,
            strictEscapes: true,
            unicodeEscapes: true,
            bitwiseOperators: true,
            integerDivision: true,
            relaxedBreak: true
          },
          "LuaJIT": {
            // XXX: LuaJIT language features may depend on compilation options; may need to
            // rethink how to handle this. Specifically, there is a LUAJIT_ENABLE_LUA52COMPAT
            // that removes contextual goto. Maybe add 'LuaJIT-5.2compat' as well?
            labels: true,
            contextualGoto: true,
            hexEscapes: true,
            skipWhitespaceEscape: true,
            strictEscapes: true,
            unicodeEscapes: true,
            imaginaryNumbers: true,
            integerSuffixes: true
          }
        };
        function parse(_input, _options) {
          if ("undefined" === typeof _options && "object" === typeof _input) {
            _options = _input;
            _input = void 0;
          }
          if (!_options) _options = {};
          input = _input || "";
          options = assign({}, defaultOptions, _options);
          index = 0;
          line = 1;
          lineStart = 0;
          length = input.length;
          scopes = [[]];
          scopeDepth = 0;
          globals = [];
          locations = [];
          if (!Object.prototype.hasOwnProperty.call(versionFeatures, options.luaVersion)) {
            throw new Error(sprintf("Lua version '%1' not supported", options.luaVersion));
          }
          features = assign({}, versionFeatures[options.luaVersion]);
          if (options.extendedIdentifiers !== void 0)
            features.extendedIdentifiers = !!options.extendedIdentifiers;
          if (!Object.prototype.hasOwnProperty.call(encodingModes, options.encodingMode)) {
            throw new Error(sprintf("Encoding mode '%1' not supported", options.encodingMode));
          }
          encodingMode = encodingModes[options.encodingMode];
          if (options.comments) comments = [];
          if (!options.wait) return end();
          return exports2;
        }
        exports2.write = write;
        function write(_input) {
          input += String(_input);
          length = input.length;
          return exports2;
        }
        exports2.end = end;
        function end(_input) {
          if ("undefined" !== typeof _input) write(_input);
          if (input && input.substr(0, 2) === "#!") input = input.replace(/^.*/, function(line2) {
            return line2.replace(/./g, " ");
          });
          length = input.length;
          trackLocations = options.locations || options.ranges;
          lookahead = lex();
          var chunk = parseChunk();
          if (options.comments) chunk.comments = comments;
          if (options.scope) chunk.globals = globals;
          if (locations.length > 0)
            throw new Error("Location tracking failed. This is most likely a bug in luaparse");
          return chunk;
        }
      });
    }
  });

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

  // src/workers/lua-worker.ts
  var lua_worker_exports = {};
  __export(lua_worker_exports, {
    LuaWorker: () => LuaWorker
  });
  var lua = __toESM(require_luaparse());

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

  // src/workers/lua-worker.ts
  var LuaWorker = class extends Mirror {
    constructor(sender) {
      super(sender);
      this.setTimeout(500);
      this.parser = lua;
    }
    onUpdate() {
      var value = this.doc.getValue();
      var errors = [];
      try {
        this.parser.parse(value);
      } catch (e) {
        if (e instanceof this.parser.SyntaxError) {
          errors.push({
            row: e.line - 1,
            column: e.column,
            text: e.message,
            type: "error"
          });
        }
      }
      this.sender.emit("annotate", errors);
    }
  };
  return __toCommonJS(lua_worker_exports);
})();
aceLegacyWorkerModule = aceLegacyWorkerModule.default || aceLegacyWorkerModule;

exports.Worker = aceLegacyWorkerModule.LuaWorker;
});
