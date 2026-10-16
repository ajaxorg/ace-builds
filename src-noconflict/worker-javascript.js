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

ace.define("ace/mode/javascript_worker", [], function(require, exports, module) {
"use strict";
var define = undefined;
var aceLegacyWorkerModule;
var aceLegacyWorkerModule = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
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
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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

  // ../../node_modules/@babel/parser/lib/index.js
  var require_lib = __commonJS({
    "../../node_modules/@babel/parser/lib/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      function _objectWithoutPropertiesLoose(r, e) {
        if (null == r) return {};
        var t = {};
        for (var n in r) if ({}.hasOwnProperty.call(r, n)) {
          if (-1 !== e.indexOf(n)) continue;
          t[n] = r[n];
        }
        return t;
      }
      var Position = class {
        constructor(line, col, index) {
          this.line = void 0;
          this.column = void 0;
          this.index = void 0;
          this.line = line;
          this.column = col;
          this.index = index;
        }
      };
      var SourceLocation = class {
        constructor(start, end) {
          this.start = void 0;
          this.end = void 0;
          this.filename = void 0;
          this.identifierName = void 0;
          this.start = start;
          this.end = end;
        }
      };
      function createPositionWithColumnOffset(position, columnOffset) {
        const {
          line,
          column,
          index
        } = position;
        return new Position(line, column + columnOffset, index + columnOffset);
      }
      var code = "BABEL_PARSER_SOURCETYPE_MODULE_REQUIRED";
      var ModuleErrors = {
        ImportMetaOutsideModule: {
          message: `import.meta may appear only with 'sourceType: "module"'`,
          code
        },
        ImportOutsideModule: {
          message: `'import' and 'export' may appear only with 'sourceType: "module"'`,
          code
        }
      };
      var NodeDescriptions = {
        ArrayPattern: "array destructuring pattern",
        AssignmentExpression: "assignment expression",
        AssignmentPattern: "assignment expression",
        ArrowFunctionExpression: "arrow function expression",
        ConditionalExpression: "conditional expression",
        CatchClause: "catch clause",
        ForOfStatement: "for-of statement",
        ForInStatement: "for-in statement",
        ForStatement: "for-loop",
        FormalParameters: "function parameter list",
        Identifier: "identifier",
        ImportSpecifier: "import specifier",
        ImportDefaultSpecifier: "import default specifier",
        ImportNamespaceSpecifier: "import namespace specifier",
        ObjectPattern: "object destructuring pattern",
        ParenthesizedExpression: "parenthesized expression",
        RestElement: "rest element",
        UpdateExpression: {
          true: "prefix operation",
          false: "postfix operation"
        },
        VariableDeclarator: "variable declaration",
        YieldExpression: "yield expression"
      };
      var toNodeDescription = (node) => node.type === "UpdateExpression" ? NodeDescriptions.UpdateExpression[`${node.prefix}`] : NodeDescriptions[node.type];
      var StandardErrors = {
        AccessorIsGenerator: ({
          kind
        }) => `A ${kind}ter cannot be a generator.`,
        ArgumentsInClass: "'arguments' is only allowed in functions and class methods.",
        AsyncFunctionInSingleStatementContext: "Async functions can only be declared at the top level or inside a block.",
        AwaitBindingIdentifier: "Can not use 'await' as identifier inside an async function.",
        AwaitBindingIdentifierInStaticBlock: "Can not use 'await' as identifier inside a static block.",
        AwaitExpressionFormalParameter: "'await' is not allowed in async function parameters.",
        AwaitUsingNotInAsyncContext: "'await using' is only allowed within async functions and at the top levels of modules.",
        AwaitNotInAsyncContext: "'await' is only allowed within async functions and at the top levels of modules.",
        BadGetterArity: "A 'get' accessor must not have any formal parameters.",
        BadSetterArity: "A 'set' accessor must have exactly one formal parameter.",
        BadSetterRestParameter: "A 'set' accessor function argument must not be a rest parameter.",
        ConstructorClassField: "Classes may not have a field named 'constructor'.",
        ConstructorClassPrivateField: "Classes may not have a private field named '#constructor'.",
        ConstructorIsAccessor: "Class constructor may not be an accessor.",
        ConstructorIsAsync: "Constructor can't be an async function.",
        ConstructorIsGenerator: "Constructor can't be a generator.",
        DeclarationMissingInitializer: ({
          kind
        }) => `Missing initializer in ${kind} declaration.`,
        DecoratorArgumentsOutsideParentheses: "Decorator arguments must be moved inside parentheses: use '@(decorator(args))' instead of '@(decorator)(args)'.",
        DecoratorBeforeExport: "Decorators must be placed *before* the 'export' keyword. Remove the 'decoratorsBeforeExport: true' option to use the 'export @decorator class {}' syntax.",
        DecoratorsBeforeAfterExport: "Decorators can be placed *either* before or after the 'export' keyword, but not in both locations at the same time.",
        DecoratorConstructor: "Decorators can't be used with a constructor. Did you mean '@dec class { ... }'?",
        DecoratorExportClass: "Decorators must be placed *after* the 'export' keyword. Remove the 'decoratorsBeforeExport: false' option to use the '@decorator export class {}' syntax.",
        DecoratorSemicolon: "Decorators must not be followed by a semicolon.",
        DecoratorStaticBlock: "Decorators can't be used with a static block.",
        DeferImportRequiresNamespace: 'Only `import defer * as x from "./module"` is valid.',
        DeletePrivateField: "Deleting a private field is not allowed.",
        DestructureNamedImport: "ES2015 named imports do not destructure. Use another statement for destructuring after the import.",
        DuplicateConstructor: "Duplicate constructor in the same class.",
        DuplicateDefaultExport: "Only one default export allowed per module.",
        DuplicateExport: ({
          exportName
        }) => `\`${exportName}\` has already been exported. Exported identifiers must be unique.`,
        DuplicateProto: "Redefinition of __proto__ property.",
        DuplicateRegExpFlags: "Duplicate regular expression flag.",
        ElementAfterRest: "Rest element must be last element.",
        EscapedCharNotAnIdentifier: "Invalid Unicode escape.",
        ExportBindingIsString: ({
          localName,
          exportName
        }) => `A string literal cannot be used as an exported binding without \`from\`.
- Did you mean \`export { '${localName}' as '${exportName}' } from 'some-module'\`?`,
        ExportDefaultFromAsIdentifier: "'from' is not allowed as an identifier after 'export default'.",
        ForInOfLoopInitializer: ({
          type
        }) => `'${type === "ForInStatement" ? "for-in" : "for-of"}' loop variable declaration may not have an initializer.`,
        ForInUsing: "For-in loop may not start with 'using' declaration.",
        ForOfAsync: "The left-hand side of a for-of loop may not be 'async'.",
        ForOfLet: "The left-hand side of a for-of loop may not start with 'let'.",
        GeneratorInSingleStatementContext: "Generators can only be declared at the top level or inside a block.",
        IllegalBreakContinue: ({
          type
        }) => `Unsyntactic ${type === "BreakStatement" ? "break" : "continue"}.`,
        IllegalLanguageModeDirective: "Illegal 'use strict' directive in function with non-simple parameter list.",
        IllegalReturn: "'return' outside of function.",
        ImportAttributesUseAssert: "The `assert` keyword in import attributes is deprecated and it has been replaced by the `with` keyword. You can enable the `deprecatedImportAssert` parser plugin to suppress this error.",
        ImportBindingIsString: ({
          importName
        }) => `A string literal cannot be used as an imported binding.
- Did you mean \`import { "${importName}" as foo }\`?`,
        ImportCallArity: `\`import()\` requires exactly one or two arguments.`,
        ImportCallNotNewExpression: "Cannot use new with import(...).",
        ImportCallSpreadArgument: "`...` is not allowed in `import()`.",
        ImportJSONBindingNotDefault: "A JSON module can only be imported with `default`.",
        ImportReflectionHasAssertion: "`import module x` cannot have assertions.",
        ImportReflectionNotBinding: 'Only `import module x from "./module"` is valid.',
        IncompatibleRegExpUVFlags: "The 'u' and 'v' regular expression flags cannot be enabled at the same time.",
        InvalidBigIntLiteral: "Invalid BigIntLiteral.",
        InvalidCodePoint: "Code point out of bounds.",
        InvalidCoverDiscardElement: "'void' must be followed by an expression when not used in a binding position.",
        InvalidCoverInitializedName: "Invalid shorthand property initializer.",
        InvalidDecimal: "Invalid decimal.",
        InvalidDigit: ({
          radix
        }) => `Expected number in radix ${radix}.`,
        InvalidEscapeSequence: "Bad character escape sequence.",
        InvalidEscapeSequenceTemplate: "Invalid escape sequence in template.",
        InvalidEscapedReservedWord: ({
          reservedWord
        }) => `Escape sequence in keyword ${reservedWord}.`,
        InvalidIdentifier: ({
          identifierName
        }) => `Invalid identifier ${identifierName}.`,
        InvalidLhs: ({
          ancestor
        }) => `Invalid left-hand side in ${toNodeDescription(ancestor)}.`,
        InvalidLhsBinding: ({
          ancestor
        }) => `Binding invalid left-hand side in ${toNodeDescription(ancestor)}.`,
        InvalidLhsOptionalChaining: ({
          ancestor
        }) => `Invalid optional chaining in the left-hand side of ${toNodeDescription(ancestor)}.`,
        InvalidNumber: "Invalid number.",
        InvalidOrMissingExponent: "Floating-point numbers require a valid exponent after the 'e'.",
        InvalidOrUnexpectedToken: ({
          unexpected
        }) => `Unexpected character '${unexpected}'.`,
        InvalidParenthesizedAssignment: "Invalid parenthesized assignment pattern.",
        InvalidPrivateFieldResolution: ({
          identifierName
        }) => `Private name #${identifierName} is not defined.`,
        InvalidPropertyBindingPattern: "Binding member expression.",
        InvalidRecordProperty: "Only properties and spread elements are allowed in record definitions.",
        InvalidRestAssignmentPattern: "Invalid rest operator's argument.",
        LabelRedeclaration: ({
          labelName
        }) => `Label '${labelName}' is already declared.`,
        LetInLexicalBinding: "'let' is disallowed as a lexically bound name.",
        LineTerminatorBeforeArrow: "No line break is allowed before '=>'.",
        MalformedRegExpFlags: "Invalid regular expression flag.",
        MissingClassName: "A class name is required.",
        MissingEqInAssignment: "Only '=' operator can be used for specifying default value.",
        MissingSemicolon: "Missing semicolon.",
        MissingPlugin: ({
          missingPlugin
        }) => `This experimental syntax requires enabling the parser plugin: ${missingPlugin.map((name) => JSON.stringify(name)).join(", ")}.`,
        MissingOneOfPlugins: ({
          missingPlugin
        }) => `This experimental syntax requires enabling one of the following parser plugin(s): ${missingPlugin.map((name) => JSON.stringify(name)).join(", ")}.`,
        MissingUnicodeEscape: "Expecting Unicode escape sequence \\uXXXX.",
        MixingCoalesceWithLogical: "Nullish coalescing operator(??) requires parens when mixing with logical operators.",
        ModuleAttributeDifferentFromType: "The only accepted module attribute is `type`.",
        ModuleAttributeInvalidValue: "Only string literals are allowed as module attribute values.",
        ModuleAttributesWithDuplicateKeys: ({
          key
        }) => `Duplicate key "${key}" is not allowed in module attributes.`,
        ModuleExportNameHasLoneSurrogate: ({
          surrogateCharCode
        }) => `An export name cannot include a lone surrogate, found '\\u${surrogateCharCode.toString(16)}'.`,
        ModuleExportUndefined: ({
          localName
        }) => `Export '${localName}' is not defined.`,
        MultipleDefaultsInSwitch: "Multiple default clauses.",
        NewlineAfterThrow: "Illegal newline after throw.",
        NoCatchOrFinally: "Missing catch or finally clause.",
        NumberIdentifier: "Identifier directly after number.",
        NumericSeparatorInEscapeSequence: "Numeric separators are not allowed inside unicode escape sequences or hex escape sequences.",
        ObsoleteAwaitStar: "'await*' has been removed from the async functions proposal. Use Promise.all() instead.",
        OptionalChainingNoNew: "Constructors in/after an Optional Chain are not allowed.",
        OptionalChainingNoTemplate: "Tagged Template Literals are not allowed in optionalChain.",
        OverrideOnConstructor: "'override' modifier cannot appear on a constructor declaration.",
        ParamDupe: "Argument name clash.",
        PatternHasAccessor: "Object pattern can't contain getter or setter.",
        PatternHasMethod: "Object pattern can't contain methods.",
        PrivateInExpectedIn: ({
          identifierName
        }) => `Private names are only allowed in property accesses (\`obj.#${identifierName}\`) or in \`in\` expressions (\`#${identifierName} in obj\`).`,
        PrivateNameRedeclaration: ({
          identifierName
        }) => `Duplicate private name #${identifierName}.`,
        RecordExpressionBarIncorrectEndSyntaxType: "Record expressions ending with '|}' are only allowed when the 'syntaxType' option of the 'recordAndTuple' plugin is set to 'bar'.",
        RecordExpressionBarIncorrectStartSyntaxType: "Record expressions starting with '{|' are only allowed when the 'syntaxType' option of the 'recordAndTuple' plugin is set to 'bar'.",
        RecordExpressionHashIncorrectStartSyntaxType: "Record expressions starting with '#{' are only allowed when the 'syntaxType' option of the 'recordAndTuple' plugin is set to 'hash'.",
        RecordNoProto: "'__proto__' is not allowed in Record expressions.",
        RestTrailingComma: "Unexpected trailing comma after rest element.",
        SloppyFunction: "In non-strict mode code, functions can only be declared at top level or inside a block.",
        SloppyFunctionAnnexB: "In non-strict mode code, functions can only be declared at top level, inside a block, or as the body of an if statement.",
        SourcePhaseImportRequiresDefault: 'Only `import source x from "./module"` is valid.',
        StaticPrototype: "Classes may not have static property named prototype.",
        SuperNotAllowed: "`super()` is only valid inside a class constructor of a subclass. Maybe a typo in the method name ('constructor') or not extending another class?",
        SuperPrivateField: "Private fields can't be accessed on super.",
        TrailingDecorator: "Decorators must be attached to a class element.",
        TupleExpressionBarIncorrectEndSyntaxType: "Tuple expressions ending with '|]' are only allowed when the 'syntaxType' option of the 'recordAndTuple' plugin is set to 'bar'.",
        TupleExpressionBarIncorrectStartSyntaxType: "Tuple expressions starting with '[|' are only allowed when the 'syntaxType' option of the 'recordAndTuple' plugin is set to 'bar'.",
        TupleExpressionHashIncorrectStartSyntaxType: "Tuple expressions starting with '#[' are only allowed when the 'syntaxType' option of the 'recordAndTuple' plugin is set to 'hash'.",
        UnexpectedArgumentPlaceholder: "Unexpected argument placeholder.",
        UnexpectedAwaitAfterPipelineBody: 'Unexpected "await" after pipeline body; await must have parentheses in minimal proposal.',
        UnexpectedDigitAfterHash: "Unexpected digit after hash token.",
        UnexpectedImportExport: "'import' and 'export' may only appear at the top level.",
        UnexpectedKeyword: ({
          keyword
        }) => `Unexpected keyword '${keyword}'.`,
        UnexpectedLeadingDecorator: "Leading decorators must be attached to a class declaration.",
        UnexpectedLexicalDeclaration: "Lexical declaration cannot appear in a single-statement context.",
        UnexpectedNewTarget: "`new.target` can only be used in functions or class properties.",
        UnexpectedNumericSeparator: "A numeric separator is only allowed between two digits.",
        UnexpectedPrivateField: "Unexpected private name.",
        UnexpectedReservedWord: ({
          reservedWord
        }) => `Unexpected reserved word '${reservedWord}'.`,
        UnexpectedSuper: "'super' is only allowed in object methods and classes.",
        UnexpectedToken: ({
          expected,
          unexpected
        }) => `Unexpected token${unexpected ? ` '${unexpected}'.` : ""}${expected ? `, expected "${expected}"` : ""}`,
        UnexpectedTokenUnaryExponentiation: "Illegal expression. Wrap left hand side or entire exponentiation in parentheses.",
        UnexpectedUsingDeclaration: "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement.",
        UnexpectedVoidPattern: "Unexpected void binding.",
        UnsupportedBind: "Binding should be performed on object property.",
        UnsupportedDecoratorExport: "A decorated export must export a class declaration.",
        UnsupportedDefaultExport: "Only expressions, functions or classes are allowed as the `default` export.",
        UnsupportedImport: "`import` can only be used in `import()` or `import.meta`.",
        UnsupportedMetaProperty: ({
          target,
          onlyValidPropertyName
        }) => `The only valid meta property for ${target} is ${target}.${onlyValidPropertyName}.`,
        UnsupportedParameterDecorator: "Decorators cannot be used to decorate parameters.",
        UnsupportedPropertyDecorator: "Decorators cannot be used to decorate object literal properties.",
        UnsupportedSuper: "'super' can only be used with function calls (i.e. super()) or in property accesses (i.e. super.prop or super[prop]).",
        UnterminatedComment: "Unterminated comment.",
        UnterminatedRegExp: "Unterminated regular expression.",
        UnterminatedString: "Unterminated string constant.",
        UnterminatedTemplate: "Unterminated template.",
        UsingDeclarationExport: "Using declaration cannot be exported.",
        UsingDeclarationHasBindingPattern: "Using declaration cannot have destructuring patterns.",
        VarRedeclaration: ({
          identifierName
        }) => `Identifier '${identifierName}' has already been declared.`,
        VoidPatternCatchClauseParam: "A void binding can not be the catch clause parameter. Use `try { ... } catch { ... }` if you want to discard the caught error.",
        VoidPatternInitializer: "A void binding may not have an initializer.",
        YieldBindingIdentifier: "Can not use 'yield' as identifier inside a generator.",
        YieldInParameter: "Yield expression is not allowed in formal parameters.",
        YieldNotInGeneratorFunction: "'yield' is only allowed within generator functions.",
        ZeroDigitNumericSeparator: "Numeric separator can not be used after leading 0."
      };
      var StrictModeErrors = {
        StrictDelete: "Deleting local variable in strict mode.",
        StrictEvalArguments: ({
          referenceName
        }) => `Assigning to '${referenceName}' in strict mode.`,
        StrictEvalArgumentsBinding: ({
          bindingName
        }) => `Binding '${bindingName}' in strict mode.`,
        StrictFunction: "In strict mode code, functions can only be declared at top level or inside a block.",
        StrictNumericEscape: "The only valid numeric escape in strict mode is '\\0'.",
        StrictOctalLiteral: "Legacy octal literals are not allowed in strict mode.",
        StrictWith: "'with' in strict mode."
      };
      var ParseExpressionErrors = {
        ParseExpressionEmptyInput: "Unexpected parseExpression() input: The input is empty or contains only comments.",
        ParseExpressionExpectsEOF: ({
          unexpected
        }) => `Unexpected parseExpression() input: The input should contain exactly one expression, but the first expression is followed by the unexpected character \`${String.fromCodePoint(unexpected)}\`.`
      };
      var UnparenthesizedPipeBodyDescriptions = /* @__PURE__ */ new Set(["ArrowFunctionExpression", "AssignmentExpression", "ConditionalExpression", "YieldExpression"]);
      var PipelineOperatorErrors = Object.assign({
        PipeBodyIsTighter: "Unexpected yield after pipeline body; any yield expression acting as Hack-style pipe body must be parenthesized due to its loose operator precedence.",
        PipeTopicRequiresHackPipes: 'Topic reference is used, but the pipelineOperator plugin was not passed a "proposal": "hack" or "smart" option.',
        PipeTopicUnbound: "Topic reference is unbound; it must be inside a pipe body.",
        PipeTopicUnconfiguredToken: ({
          token
        }) => `Invalid topic token ${token}. In order to use ${token} as a topic reference, the pipelineOperator plugin must be configured with { "proposal": "hack", "topicToken": "${token}" }.`,
        PipeTopicUnused: "Hack-style pipe body does not contain a topic reference; Hack-style pipes must use topic at least once.",
        PipeUnparenthesizedBody: ({
          type
        }) => `Hack-style pipe body cannot be an unparenthesized ${toNodeDescription({
          type
        })}; please wrap it in parentheses.`
      }, {
        PipelineBodyNoArrow: 'Unexpected arrow "=>" after pipeline body; arrow function in pipeline body must be parenthesized.',
        PipelineBodySequenceExpression: "Pipeline body may not be a comma-separated sequence expression.",
        PipelineHeadSequenceExpression: "Pipeline head should not be a comma-separated sequence expression.",
        PipelineTopicUnused: "Pipeline is in topic style but does not use topic reference.",
        PrimaryTopicNotAllowed: "Topic reference was used in a lexical context without topic binding.",
        PrimaryTopicRequiresSmartPipeline: 'Topic reference is used, but the pipelineOperator plugin was not passed a "proposal": "hack" or "smart" option.'
      });
      var _excluded = ["message"];
      function defineHidden(obj, key, value) {
        Object.defineProperty(obj, key, {
          enumerable: false,
          configurable: true,
          value
        });
      }
      function toParseErrorConstructor({
        toMessage,
        code: code2,
        reasonCode,
        syntaxPlugin
      }) {
        const hasMissingPlugin = reasonCode === "MissingPlugin" || reasonCode === "MissingOneOfPlugins";
        const oldReasonCodes = {
          AccessorCannotDeclareThisParameter: "AccesorCannotDeclareThisParameter",
          AccessorCannotHaveTypeParameters: "AccesorCannotHaveTypeParameters",
          ConstInitializerMustBeStringOrNumericLiteralOrLiteralEnumReference: "ConstInitiailizerMustBeStringOrNumericLiteralOrLiteralEnumReference",
          SetAccessorCannotHaveOptionalParameter: "SetAccesorCannotHaveOptionalParameter",
          SetAccessorCannotHaveRestParameter: "SetAccesorCannotHaveRestParameter",
          SetAccessorCannotHaveReturnType: "SetAccesorCannotHaveReturnType"
        };
        if (oldReasonCodes[reasonCode]) {
          reasonCode = oldReasonCodes[reasonCode];
        }
        return function constructor(loc, details) {
          const error = new SyntaxError();
          error.code = code2;
          error.reasonCode = reasonCode;
          error.loc = loc;
          error.pos = loc.index;
          error.syntaxPlugin = syntaxPlugin;
          if (hasMissingPlugin) {
            error.missingPlugin = details.missingPlugin;
          }
          defineHidden(error, "clone", function clone(overrides = {}) {
            var _overrides$loc;
            const {
              line,
              column,
              index
            } = (_overrides$loc = overrides.loc) != null ? _overrides$loc : loc;
            return constructor(new Position(line, column, index), Object.assign({}, details, overrides.details));
          });
          defineHidden(error, "details", details);
          Object.defineProperty(error, "message", {
            configurable: true,
            get() {
              const message = `${toMessage(details)} (${loc.line}:${loc.column})`;
              this.message = message;
              return message;
            },
            set(value) {
              Object.defineProperty(this, "message", {
                value,
                writable: true
              });
            }
          });
          return error;
        };
      }
      function ParseErrorEnum(argument, syntaxPlugin) {
        if (Array.isArray(argument)) {
          return (parseErrorTemplates) => ParseErrorEnum(parseErrorTemplates, argument[0]);
        }
        const ParseErrorConstructors = {};
        for (const reasonCode of Object.keys(argument)) {
          const template = argument[reasonCode];
          const _ref = typeof template === "string" ? {
            message: () => template
          } : typeof template === "function" ? {
            message: template
          } : template, {
            message
          } = _ref, rest = _objectWithoutPropertiesLoose(_ref, _excluded);
          const toMessage = typeof message === "string" ? () => message : message;
          ParseErrorConstructors[reasonCode] = toParseErrorConstructor(Object.assign({
            code: "BABEL_PARSER_SYNTAX_ERROR",
            reasonCode,
            toMessage
          }, syntaxPlugin ? {
            syntaxPlugin
          } : {}, rest));
        }
        return ParseErrorConstructors;
      }
      var Errors = Object.assign({}, ParseErrorEnum(ModuleErrors), ParseErrorEnum(StandardErrors), ParseErrorEnum(StrictModeErrors), ParseErrorEnum(ParseExpressionErrors), ParseErrorEnum`pipelineOperator`(PipelineOperatorErrors));
      function createDefaultOptions() {
        return {
          sourceType: "script",
          sourceFilename: void 0,
          startIndex: 0,
          startColumn: 0,
          startLine: 1,
          allowAwaitOutsideFunction: false,
          allowReturnOutsideFunction: false,
          allowNewTargetOutsideFunction: false,
          allowImportExportEverywhere: false,
          allowSuperOutsideMethod: false,
          allowUndeclaredExports: false,
          allowYieldOutsideFunction: false,
          plugins: [],
          strictMode: void 0,
          ranges: false,
          tokens: false,
          createImportExpressions: false,
          createParenthesizedExpressions: false,
          errorRecovery: false,
          attachComment: true,
          annexB: true
        };
      }
      function getOptions(opts) {
        const options = createDefaultOptions();
        if (opts == null) {
          return options;
        }
        if (opts.annexB != null && opts.annexB !== false) {
          throw new Error("The `annexB` option can only be set to `false`.");
        }
        for (const key of Object.keys(options)) {
          if (opts[key] != null) options[key] = opts[key];
        }
        if (options.startLine === 1) {
          if (opts.startIndex == null && options.startColumn > 0) {
            options.startIndex = options.startColumn;
          } else if (opts.startColumn == null && options.startIndex > 0) {
            options.startColumn = options.startIndex;
          }
        } else if (opts.startColumn == null || opts.startIndex == null) {
          if (opts.startIndex != null) {
            throw new Error("With a `startLine > 1` you must also specify `startIndex` and `startColumn`.");
          }
        }
        if (options.sourceType === "commonjs") {
          if (opts.allowAwaitOutsideFunction != null) {
            throw new Error("The `allowAwaitOutsideFunction` option cannot be used with `sourceType: 'commonjs'`.");
          }
          if (opts.allowReturnOutsideFunction != null) {
            throw new Error("`sourceType: 'commonjs'` implies `allowReturnOutsideFunction: true`, please remove the `allowReturnOutsideFunction` option or use `sourceType: 'script'`.");
          }
          if (opts.allowNewTargetOutsideFunction != null) {
            throw new Error("`sourceType: 'commonjs'` implies `allowNewTargetOutsideFunction: true`, please remove the `allowNewTargetOutsideFunction` option or use `sourceType: 'script'`.");
          }
        }
        return options;
      }
      var {
        defineProperty
      } = Object;
      var toUnenumerable = (object, key) => {
        if (object) {
          defineProperty(object, key, {
            enumerable: false,
            value: object[key]
          });
        }
      };
      function toESTreeLocation(node) {
        toUnenumerable(node.loc.start, "index");
        toUnenumerable(node.loc.end, "index");
        return node;
      }
      var estree = (superClass) => class ESTreeParserMixin extends superClass {
        parse() {
          const file = toESTreeLocation(super.parse());
          if (this.optionFlags & 256) {
            file.tokens = file.tokens.map(toESTreeLocation);
          }
          return file;
        }
        parseRegExpLiteral({
          pattern,
          flags
        }) {
          let regex = null;
          try {
            regex = new RegExp(pattern, flags);
          } catch (_) {
          }
          const node = this.estreeParseLiteral(regex);
          node.regex = {
            pattern,
            flags
          };
          return node;
        }
        parseBigIntLiteral(value) {
          let bigInt;
          try {
            bigInt = BigInt(value);
          } catch (_unused) {
            bigInt = null;
          }
          const node = this.estreeParseLiteral(bigInt);
          node.bigint = String(node.value || value);
          return node;
        }
        parseDecimalLiteral(value) {
          const decimal = null;
          const node = this.estreeParseLiteral(decimal);
          node.decimal = String(node.value || value);
          return node;
        }
        estreeParseLiteral(value) {
          return this.parseLiteral(value, "Literal");
        }
        parseStringLiteral(value) {
          return this.estreeParseLiteral(value);
        }
        parseNumericLiteral(value) {
          return this.estreeParseLiteral(value);
        }
        parseNullLiteral() {
          return this.estreeParseLiteral(null);
        }
        parseBooleanLiteral(value) {
          return this.estreeParseLiteral(value);
        }
        estreeParseChainExpression(node, endLoc) {
          const chain = this.startNodeAtNode(node);
          chain.expression = node;
          return this.finishNodeAt(chain, "ChainExpression", endLoc);
        }
        directiveToStmt(directive) {
          const expression = directive.value;
          delete directive.value;
          this.castNodeTo(expression, "Literal");
          expression.raw = expression.extra.raw;
          expression.value = expression.extra.expressionValue;
          const stmt = this.castNodeTo(directive, "ExpressionStatement");
          stmt.expression = expression;
          stmt.directive = expression.extra.rawValue;
          delete expression.extra;
          return stmt;
        }
        fillOptionalPropertiesForTSESLint(node) {
        }
        cloneEstreeStringLiteral(node) {
          const {
            start,
            end,
            loc,
            range,
            raw,
            value
          } = node;
          const cloned = Object.create(node.constructor.prototype);
          cloned.type = "Literal";
          cloned.start = start;
          cloned.end = end;
          cloned.loc = loc;
          cloned.range = range;
          cloned.raw = raw;
          cloned.value = value;
          return cloned;
        }
        initFunction(node, isAsync) {
          super.initFunction(node, isAsync);
          node.expression = false;
        }
        checkDeclaration(node) {
          if (node != null && this.isObjectProperty(node)) {
            this.checkDeclaration(node.value);
          } else {
            super.checkDeclaration(node);
          }
        }
        getObjectOrClassMethodParams(method) {
          return method.value.params;
        }
        isValidDirective(stmt) {
          var _stmt$expression$extr;
          return stmt.type === "ExpressionStatement" && stmt.expression.type === "Literal" && typeof stmt.expression.value === "string" && !((_stmt$expression$extr = stmt.expression.extra) != null && _stmt$expression$extr.parenthesized);
        }
        parseBlockBody(node, allowDirectives, topLevel, end, afterBlockParse) {
          super.parseBlockBody(node, allowDirectives, topLevel, end, afterBlockParse);
          const directiveStatements = node.directives.map((d) => this.directiveToStmt(d));
          node.body = directiveStatements.concat(node.body);
          delete node.directives;
        }
        parsePrivateName() {
          const node = super.parsePrivateName();
          if (!this.getPluginOption("estree", "classFeatures")) {
            return node;
          }
          return this.convertPrivateNameToPrivateIdentifier(node);
        }
        convertPrivateNameToPrivateIdentifier(node) {
          const name = super.getPrivateNameSV(node);
          delete node.id;
          node.name = name;
          return this.castNodeTo(node, "PrivateIdentifier");
        }
        isPrivateName(node) {
          if (!this.getPluginOption("estree", "classFeatures")) {
            return super.isPrivateName(node);
          }
          return node.type === "PrivateIdentifier";
        }
        getPrivateNameSV(node) {
          if (!this.getPluginOption("estree", "classFeatures")) {
            return super.getPrivateNameSV(node);
          }
          return node.name;
        }
        parseLiteral(value, type) {
          const node = super.parseLiteral(value, type);
          node.raw = node.extra.raw;
          delete node.extra;
          return node;
        }
        parseFunctionBody(node, allowExpression, isMethod = false) {
          super.parseFunctionBody(node, allowExpression, isMethod);
          node.expression = node.body.type !== "BlockStatement";
        }
        parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope = false) {
          let funcNode = this.startNode();
          funcNode.kind = node.kind;
          funcNode = super.parseMethod(funcNode, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope);
          delete funcNode.kind;
          const {
            typeParameters
          } = node;
          if (typeParameters) {
            delete node.typeParameters;
            funcNode.typeParameters = typeParameters;
            this.resetStartLocationFromNode(funcNode, typeParameters);
          }
          const valueNode = this.castNodeTo(funcNode, "FunctionExpression");
          node.value = valueNode;
          if (type === "ClassPrivateMethod") {
            node.computed = false;
          }
          if (type === "ObjectMethod") {
            if (node.kind === "method") {
              node.kind = "init";
            }
            node.shorthand = false;
            return this.finishNode(node, "Property");
          } else {
            return this.finishNode(node, "MethodDefinition");
          }
        }
        nameIsConstructor(key) {
          if (key.type === "Literal") return key.value === "constructor";
          return super.nameIsConstructor(key);
        }
        parseClassProperty(...args) {
          const propertyNode = super.parseClassProperty(...args);
          if (!this.getPluginOption("estree", "classFeatures")) {
            return propertyNode;
          }
          this.castNodeTo(propertyNode, "PropertyDefinition");
          return propertyNode;
        }
        parseClassPrivateProperty(...args) {
          const propertyNode = super.parseClassPrivateProperty(...args);
          if (!this.getPluginOption("estree", "classFeatures")) {
            return propertyNode;
          }
          this.castNodeTo(propertyNode, "PropertyDefinition");
          propertyNode.computed = false;
          return propertyNode;
        }
        parseClassAccessorProperty(node) {
          const accessorPropertyNode = super.parseClassAccessorProperty(node);
          if (!this.getPluginOption("estree", "classFeatures")) {
            return accessorPropertyNode;
          }
          if (accessorPropertyNode.abstract && this.hasPlugin("typescript")) {
            delete accessorPropertyNode.abstract;
            this.castNodeTo(accessorPropertyNode, "TSAbstractAccessorProperty");
          } else {
            this.castNodeTo(accessorPropertyNode, "AccessorProperty");
          }
          return accessorPropertyNode;
        }
        parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors) {
          const node = super.parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors);
          if (node) {
            node.kind = "init";
            this.castNodeTo(node, "Property");
          }
          return node;
        }
        finishObjectProperty(node) {
          node.kind = "init";
          return this.finishNode(node, "Property");
        }
        isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding) {
          return type === "Property" ? "value" : super.isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding);
        }
        isAssignable(node, isBinding) {
          if (node != null && this.isObjectProperty(node)) {
            return this.isAssignable(node.value, isBinding);
          }
          return super.isAssignable(node, isBinding);
        }
        toAssignable(node, isLHS = false) {
          if (node != null && this.isObjectProperty(node)) {
            const {
              key,
              value
            } = node;
            if (this.isPrivateName(key)) {
              this.classScope.usePrivateName(this.getPrivateNameSV(key), key.loc.start);
            }
            this.toAssignable(value, isLHS);
          } else {
            super.toAssignable(node, isLHS);
          }
        }
        toAssignableObjectExpressionProp(prop, isLast, isLHS) {
          if (prop.type === "Property" && (prop.kind === "get" || prop.kind === "set")) {
            this.raise(Errors.PatternHasAccessor, prop.key);
          } else if (prop.type === "Property" && prop.method) {
            this.raise(Errors.PatternHasMethod, prop.key);
          } else {
            super.toAssignableObjectExpressionProp(prop, isLast, isLHS);
          }
        }
        finishCallExpression(unfinished, optional) {
          const node = super.finishCallExpression(unfinished, optional);
          if (node.callee.type === "Import") {
            var _ref, _ref2;
            this.castNodeTo(node, "ImportExpression");
            node.source = node.arguments[0];
            node.options = (_ref = node.arguments[1]) != null ? _ref : null;
            node.attributes = (_ref2 = node.arguments[1]) != null ? _ref2 : null;
            delete node.arguments;
            delete node.callee;
          } else if (node.type === "OptionalCallExpression") {
            this.castNodeTo(node, "CallExpression");
          } else {
            node.optional = false;
          }
          return node;
        }
        toReferencedArguments(node) {
          if (node.type === "ImportExpression") {
            return;
          }
          super.toReferencedArguments(node);
        }
        parseExport(unfinished, decorators) {
          const exportStartLoc = this.state.lastTokStartLoc;
          const node = super.parseExport(unfinished, decorators);
          switch (node.type) {
            case "ExportAllDeclaration":
              node.exported = null;
              break;
            case "ExportNamedDeclaration":
              if (node.specifiers.length === 1 && node.specifiers[0].type === "ExportNamespaceSpecifier") {
                this.castNodeTo(node, "ExportAllDeclaration");
                node.exported = node.specifiers[0].exported;
                delete node.specifiers;
              }
            case "ExportDefaultDeclaration":
              {
                var _declaration$decorato;
                const {
                  declaration
                } = node;
                if ((declaration == null ? void 0 : declaration.type) === "ClassDeclaration" && ((_declaration$decorato = declaration.decorators) == null ? void 0 : _declaration$decorato.length) > 0 && declaration.start === node.start) {
                  this.resetStartLocation(node, exportStartLoc);
                }
              }
              break;
          }
          return node;
        }
        stopParseSubscript(base, state) {
          const node = super.stopParseSubscript(base, state);
          if (state.optionalChainMember) {
            return this.estreeParseChainExpression(node, base.loc.end);
          }
          return node;
        }
        parseMember(base, startLoc, state, computed, optional) {
          const node = super.parseMember(base, startLoc, state, computed, optional);
          if (node.type === "OptionalMemberExpression") {
            this.castNodeTo(node, "MemberExpression");
          } else {
            node.optional = false;
          }
          return node;
        }
        isOptionalMemberExpression(node) {
          if (node.type === "ChainExpression") {
            return node.expression.type === "MemberExpression";
          }
          return super.isOptionalMemberExpression(node);
        }
        hasPropertyAsPrivateName(node) {
          if (node.type === "ChainExpression") {
            node = node.expression;
          }
          return super.hasPropertyAsPrivateName(node);
        }
        isObjectProperty(node) {
          return node.type === "Property" && node.kind === "init" && !node.method;
        }
        isObjectMethod(node) {
          return node.type === "Property" && (node.method || node.kind === "get" || node.kind === "set");
        }
        castNodeTo(node, type) {
          const result = super.castNodeTo(node, type);
          this.fillOptionalPropertiesForTSESLint(result);
          return result;
        }
        cloneIdentifier(node) {
          const cloned = super.cloneIdentifier(node);
          this.fillOptionalPropertiesForTSESLint(cloned);
          return cloned;
        }
        cloneStringLiteral(node) {
          if (node.type === "Literal") {
            return this.cloneEstreeStringLiteral(node);
          }
          return super.cloneStringLiteral(node);
        }
        finishNodeAt(node, type, endLoc) {
          return toESTreeLocation(super.finishNodeAt(node, type, endLoc));
        }
        finishNode(node, type) {
          const result = super.finishNode(node, type);
          this.fillOptionalPropertiesForTSESLint(result);
          return result;
        }
        resetStartLocation(node, startLoc) {
          super.resetStartLocation(node, startLoc);
          toESTreeLocation(node);
        }
        resetEndLocation(node, endLoc = this.state.lastTokEndLoc) {
          super.resetEndLocation(node, endLoc);
          toESTreeLocation(node);
        }
      };
      var TokContext = class {
        constructor(token, preserveSpace) {
          this.token = void 0;
          this.preserveSpace = void 0;
          this.token = token;
          this.preserveSpace = !!preserveSpace;
        }
      };
      var types = {
        brace: new TokContext("{"),
        j_oTag: new TokContext("<tag"),
        j_cTag: new TokContext("</tag"),
        j_expr: new TokContext("<tag>...</tag>", true)
      };
      types.template = new TokContext("`", true);
      var beforeExpr = true;
      var startsExpr = true;
      var isLoop2 = true;
      var isAssign = true;
      var prefix = true;
      var postfix = true;
      var ExportedTokenType = class {
        constructor(label, conf = {}) {
          this.label = void 0;
          this.keyword = void 0;
          this.beforeExpr = void 0;
          this.startsExpr = void 0;
          this.rightAssociative = void 0;
          this.isLoop = void 0;
          this.isAssign = void 0;
          this.prefix = void 0;
          this.postfix = void 0;
          this.binop = void 0;
          this.label = label;
          this.keyword = conf.keyword;
          this.beforeExpr = !!conf.beforeExpr;
          this.startsExpr = !!conf.startsExpr;
          this.rightAssociative = !!conf.rightAssociative;
          this.isLoop = !!conf.isLoop;
          this.isAssign = !!conf.isAssign;
          this.prefix = !!conf.prefix;
          this.postfix = !!conf.postfix;
          this.binop = conf.binop != null ? conf.binop : null;
          this.updateContext = null;
        }
      };
      var keywords$1 = /* @__PURE__ */ new Map();
      function createKeyword(name, options = {}) {
        options.keyword = name;
        const token = createToken(name, options);
        keywords$1.set(name, token);
        return token;
      }
      function createBinop(name, binop) {
        return createToken(name, {
          beforeExpr,
          binop
        });
      }
      var tokenTypeCounter = -1;
      var tokenTypes = [];
      var tokenLabels = [];
      var tokenBinops = [];
      var tokenBeforeExprs = [];
      var tokenStartsExprs = [];
      var tokenPrefixes = [];
      function createToken(name, options = {}) {
        var _options$binop, _options$beforeExpr, _options$startsExpr, _options$prefix;
        ++tokenTypeCounter;
        tokenLabels.push(name);
        tokenBinops.push((_options$binop = options.binop) != null ? _options$binop : -1);
        tokenBeforeExprs.push((_options$beforeExpr = options.beforeExpr) != null ? _options$beforeExpr : false);
        tokenStartsExprs.push((_options$startsExpr = options.startsExpr) != null ? _options$startsExpr : false);
        tokenPrefixes.push((_options$prefix = options.prefix) != null ? _options$prefix : false);
        tokenTypes.push(new ExportedTokenType(name, options));
        return tokenTypeCounter;
      }
      function createKeywordLike(name, options = {}) {
        var _options$binop2, _options$beforeExpr2, _options$startsExpr2, _options$prefix2;
        ++tokenTypeCounter;
        keywords$1.set(name, tokenTypeCounter);
        tokenLabels.push(name);
        tokenBinops.push((_options$binop2 = options.binop) != null ? _options$binop2 : -1);
        tokenBeforeExprs.push((_options$beforeExpr2 = options.beforeExpr) != null ? _options$beforeExpr2 : false);
        tokenStartsExprs.push((_options$startsExpr2 = options.startsExpr) != null ? _options$startsExpr2 : false);
        tokenPrefixes.push((_options$prefix2 = options.prefix) != null ? _options$prefix2 : false);
        tokenTypes.push(new ExportedTokenType("name", options));
        return tokenTypeCounter;
      }
      var tt = {
        bracketL: createToken("[", {
          beforeExpr,
          startsExpr
        }),
        bracketHashL: createToken("#[", {
          beforeExpr,
          startsExpr
        }),
        bracketBarL: createToken("[|", {
          beforeExpr,
          startsExpr
        }),
        bracketR: createToken("]"),
        bracketBarR: createToken("|]"),
        braceL: createToken("{", {
          beforeExpr,
          startsExpr
        }),
        braceBarL: createToken("{|", {
          beforeExpr,
          startsExpr
        }),
        braceHashL: createToken("#{", {
          beforeExpr,
          startsExpr
        }),
        braceR: createToken("}"),
        braceBarR: createToken("|}"),
        parenL: createToken("(", {
          beforeExpr,
          startsExpr
        }),
        parenR: createToken(")"),
        comma: createToken(",", {
          beforeExpr
        }),
        semi: createToken(";", {
          beforeExpr
        }),
        colon: createToken(":", {
          beforeExpr
        }),
        doubleColon: createToken("::", {
          beforeExpr
        }),
        dot: createToken("."),
        question: createToken("?", {
          beforeExpr
        }),
        questionDot: createToken("?."),
        arrow: createToken("=>", {
          beforeExpr
        }),
        template: createToken("template"),
        ellipsis: createToken("...", {
          beforeExpr
        }),
        backQuote: createToken("`", {
          startsExpr
        }),
        dollarBraceL: createToken("${", {
          beforeExpr,
          startsExpr
        }),
        templateTail: createToken("...`", {
          startsExpr
        }),
        templateNonTail: createToken("...${", {
          beforeExpr,
          startsExpr
        }),
        at: createToken("@"),
        hash: createToken("#", {
          startsExpr
        }),
        interpreterDirective: createToken("#!..."),
        eq: createToken("=", {
          beforeExpr,
          isAssign
        }),
        assign: createToken("_=", {
          beforeExpr,
          isAssign
        }),
        slashAssign: createToken("_=", {
          beforeExpr,
          isAssign
        }),
        xorAssign: createToken("_=", {
          beforeExpr,
          isAssign
        }),
        moduloAssign: createToken("_=", {
          beforeExpr,
          isAssign
        }),
        incDec: createToken("++/--", {
          prefix,
          postfix,
          startsExpr
        }),
        bang: createToken("!", {
          beforeExpr,
          prefix,
          startsExpr
        }),
        tilde: createToken("~", {
          beforeExpr,
          prefix,
          startsExpr
        }),
        doubleCaret: createToken("^^", {
          startsExpr
        }),
        doubleAt: createToken("@@", {
          startsExpr
        }),
        pipeline: createBinop("|>", 0),
        nullishCoalescing: createBinop("??", 1),
        logicalOR: createBinop("||", 1),
        logicalAND: createBinop("&&", 2),
        bitwiseOR: createBinop("|", 3),
        bitwiseXOR: createBinop("^", 4),
        bitwiseAND: createBinop("&", 5),
        equality: createBinop("==/!=/===/!==", 6),
        lt: createBinop("</>/<=/>=", 7),
        gt: createBinop("</>/<=/>=", 7),
        relational: createBinop("</>/<=/>=", 7),
        bitShift: createBinop("<</>>/>>>", 8),
        bitShiftL: createBinop("<</>>/>>>", 8),
        bitShiftR: createBinop("<</>>/>>>", 8),
        plusMin: createToken("+/-", {
          beforeExpr,
          binop: 9,
          prefix,
          startsExpr
        }),
        modulo: createToken("%", {
          binop: 10,
          startsExpr
        }),
        star: createToken("*", {
          binop: 10
        }),
        slash: createBinop("/", 10),
        exponent: createToken("**", {
          beforeExpr,
          binop: 11,
          rightAssociative: true
        }),
        _in: createKeyword("in", {
          beforeExpr,
          binop: 7
        }),
        _instanceof: createKeyword("instanceof", {
          beforeExpr,
          binop: 7
        }),
        _break: createKeyword("break"),
        _case: createKeyword("case", {
          beforeExpr
        }),
        _catch: createKeyword("catch"),
        _continue: createKeyword("continue"),
        _debugger: createKeyword("debugger"),
        _default: createKeyword("default", {
          beforeExpr
        }),
        _else: createKeyword("else", {
          beforeExpr
        }),
        _finally: createKeyword("finally"),
        _function: createKeyword("function", {
          startsExpr
        }),
        _if: createKeyword("if"),
        _return: createKeyword("return", {
          beforeExpr
        }),
        _switch: createKeyword("switch"),
        _throw: createKeyword("throw", {
          beforeExpr,
          prefix,
          startsExpr
        }),
        _try: createKeyword("try"),
        _var: createKeyword("var"),
        _const: createKeyword("const"),
        _with: createKeyword("with"),
        _new: createKeyword("new", {
          beforeExpr,
          startsExpr
        }),
        _this: createKeyword("this", {
          startsExpr
        }),
        _super: createKeyword("super", {
          startsExpr
        }),
        _class: createKeyword("class", {
          startsExpr
        }),
        _extends: createKeyword("extends", {
          beforeExpr
        }),
        _export: createKeyword("export"),
        _import: createKeyword("import", {
          startsExpr
        }),
        _null: createKeyword("null", {
          startsExpr
        }),
        _true: createKeyword("true", {
          startsExpr
        }),
        _false: createKeyword("false", {
          startsExpr
        }),
        _typeof: createKeyword("typeof", {
          beforeExpr,
          prefix,
          startsExpr
        }),
        _void: createKeyword("void", {
          beforeExpr,
          prefix,
          startsExpr
        }),
        _delete: createKeyword("delete", {
          beforeExpr,
          prefix,
          startsExpr
        }),
        _do: createKeyword("do", {
          isLoop: isLoop2,
          beforeExpr
        }),
        _for: createKeyword("for", {
          isLoop: isLoop2
        }),
        _while: createKeyword("while", {
          isLoop: isLoop2
        }),
        _as: createKeywordLike("as", {
          startsExpr
        }),
        _assert: createKeywordLike("assert", {
          startsExpr
        }),
        _async: createKeywordLike("async", {
          startsExpr
        }),
        _await: createKeywordLike("await", {
          startsExpr
        }),
        _defer: createKeywordLike("defer", {
          startsExpr
        }),
        _from: createKeywordLike("from", {
          startsExpr
        }),
        _get: createKeywordLike("get", {
          startsExpr
        }),
        _let: createKeywordLike("let", {
          startsExpr
        }),
        _meta: createKeywordLike("meta", {
          startsExpr
        }),
        _of: createKeywordLike("of", {
          startsExpr
        }),
        _sent: createKeywordLike("sent", {
          startsExpr
        }),
        _set: createKeywordLike("set", {
          startsExpr
        }),
        _source: createKeywordLike("source", {
          startsExpr
        }),
        _static: createKeywordLike("static", {
          startsExpr
        }),
        _using: createKeywordLike("using", {
          startsExpr
        }),
        _yield: createKeywordLike("yield", {
          startsExpr
        }),
        _asserts: createKeywordLike("asserts", {
          startsExpr
        }),
        _checks: createKeywordLike("checks", {
          startsExpr
        }),
        _exports: createKeywordLike("exports", {
          startsExpr
        }),
        _global: createKeywordLike("global", {
          startsExpr
        }),
        _implements: createKeywordLike("implements", {
          startsExpr
        }),
        _intrinsic: createKeywordLike("intrinsic", {
          startsExpr
        }),
        _infer: createKeywordLike("infer", {
          startsExpr
        }),
        _is: createKeywordLike("is", {
          startsExpr
        }),
        _mixins: createKeywordLike("mixins", {
          startsExpr
        }),
        _proto: createKeywordLike("proto", {
          startsExpr
        }),
        _require: createKeywordLike("require", {
          startsExpr
        }),
        _satisfies: createKeywordLike("satisfies", {
          startsExpr
        }),
        _keyof: createKeywordLike("keyof", {
          startsExpr
        }),
        _readonly: createKeywordLike("readonly", {
          startsExpr
        }),
        _unique: createKeywordLike("unique", {
          startsExpr
        }),
        _abstract: createKeywordLike("abstract", {
          startsExpr
        }),
        _declare: createKeywordLike("declare", {
          startsExpr
        }),
        _enum: createKeywordLike("enum", {
          startsExpr
        }),
        _module: createKeywordLike("module", {
          startsExpr
        }),
        _namespace: createKeywordLike("namespace", {
          startsExpr
        }),
        _interface: createKeywordLike("interface", {
          startsExpr
        }),
        _type: createKeywordLike("type", {
          startsExpr
        }),
        _opaque: createKeywordLike("opaque", {
          startsExpr
        }),
        name: createToken("name", {
          startsExpr
        }),
        placeholder: createToken("%%", {
          startsExpr
        }),
        string: createToken("string", {
          startsExpr
        }),
        num: createToken("num", {
          startsExpr
        }),
        bigint: createToken("bigint", {
          startsExpr
        }),
        decimal: createToken("decimal", {
          startsExpr
        }),
        regexp: createToken("regexp", {
          startsExpr
        }),
        privateName: createToken("#name", {
          startsExpr
        }),
        eof: createToken("eof"),
        jsxName: createToken("jsxName"),
        jsxText: createToken("jsxText", {
          beforeExpr
        }),
        jsxTagStart: createToken("jsxTagStart", {
          startsExpr
        }),
        jsxTagEnd: createToken("jsxTagEnd")
      };
      function tokenIsIdentifier(token) {
        return token >= 93 && token <= 133;
      }
      function tokenKeywordOrIdentifierIsKeyword(token) {
        return token <= 92;
      }
      function tokenIsKeywordOrIdentifier(token) {
        return token >= 58 && token <= 133;
      }
      function tokenIsLiteralPropertyName(token) {
        return token >= 58 && token <= 137;
      }
      function tokenComesBeforeExpression(token) {
        return tokenBeforeExprs[token];
      }
      function tokenCanStartExpression(token) {
        return tokenStartsExprs[token];
      }
      function tokenIsAssignment(token) {
        return token >= 29 && token <= 33;
      }
      function tokenIsFlowInterfaceOrTypeOrOpaque(token) {
        return token >= 129 && token <= 131;
      }
      function tokenIsLoop(token) {
        return token >= 90 && token <= 92;
      }
      function tokenIsKeyword(token) {
        return token >= 58 && token <= 92;
      }
      function tokenIsOperator(token) {
        return token >= 39 && token <= 59;
      }
      function tokenIsPostfix(token) {
        return token === 34;
      }
      function tokenIsPrefix(token) {
        return tokenPrefixes[token];
      }
      function tokenIsTSTypeOperator(token) {
        return token >= 121 && token <= 123;
      }
      function tokenIsTSDeclarationStart(token) {
        return token >= 124 && token <= 130;
      }
      function tokenLabelName(token) {
        return tokenLabels[token];
      }
      function tokenOperatorPrecedence(token) {
        return tokenBinops[token];
      }
      function tokenIsRightAssociative(token) {
        return token === 57;
      }
      function tokenIsTemplate(token) {
        return token >= 24 && token <= 25;
      }
      function getExportedToken(token) {
        return tokenTypes[token];
      }
      tokenTypes[8].updateContext = (context) => {
        context.pop();
      };
      tokenTypes[5].updateContext = tokenTypes[7].updateContext = tokenTypes[23].updateContext = (context) => {
        context.push(types.brace);
      };
      tokenTypes[22].updateContext = (context) => {
        if (context[context.length - 1] === types.template) {
          context.pop();
        } else {
          context.push(types.template);
        }
      };
      tokenTypes[143].updateContext = (context) => {
        context.push(types.j_expr, types.j_oTag);
      };
      var nonASCIIidentifierStartChars = "\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0560-\u0588\u05D0-\u05EA\u05EF-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u0860-\u086A\u0870-\u0887\u0889-\u088F\u08A0-\u08C9\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u09FC\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C5C\u0C5D\u0C60\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDC-\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D04-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E86-\u0E8A\u0E8C-\u0EA3\u0EA5\u0EA7-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u1711\u171F-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1878\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4C\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C8A\u1C90-\u1CBA\u1CBD-\u1CBF\u1CE9-\u1CEC\u1CEE-\u1CF3\u1CF5\u1CF6\u1CFA\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312F\u3131-\u318E\u31A0-\u31BF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7DC\uA7F1-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA8FE\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB69\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC";
      var nonASCIIidentifierChars = "\xB7\u0300-\u036F\u0387\u0483-\u0487\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u0669\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u06F0-\u06F9\u0711\u0730-\u074A\u07A6-\u07B0\u07C0-\u07C9\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u0897-\u089F\u08CA-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0966-\u096F\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09E6-\u09EF\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A66-\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AE6-\u0AEF\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B55-\u0B57\u0B62\u0B63\u0B66-\u0B6F\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0BE6-\u0BEF\u0C00-\u0C04\u0C3C\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0CE6-\u0CEF\u0CF3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D66-\u0D6F\u0D81-\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0E50-\u0E59\u0EB1\u0EB4-\u0EBC\u0EC8-\u0ECE\u0ED0-\u0ED9\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1040-\u1049\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F-\u109D\u135D-\u135F\u1369-\u1371\u1712-\u1715\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u17E0-\u17E9\u180B-\u180D\u180F-\u1819\u18A9\u1920-\u192B\u1930-\u193B\u1946-\u194F\u19D0-\u19DA\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AB0-\u1ABD\u1ABF-\u1ADD\u1AE0-\u1AEB\u1B00-\u1B04\u1B34-\u1B44\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BB0-\u1BB9\u1BE6-\u1BF3\u1C24-\u1C37\u1C40-\u1C49\u1C50-\u1C59\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DFF\u200C\u200D\u203F\u2040\u2054\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\u30FB\uA620-\uA629\uA66F\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA82C\uA880\uA881\uA8B4-\uA8C5\uA8D0-\uA8D9\uA8E0-\uA8F1\uA8FF-\uA909\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9D0-\uA9D9\uA9E5\uA9F0-\uA9F9\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA50-\uAA59\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uABF0-\uABF9\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFF10-\uFF19\uFF3F\uFF65";
      var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
      var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");
      nonASCIIidentifierStartChars = nonASCIIidentifierChars = null;
      var astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 13, 10, 2, 14, 2, 6, 2, 1, 2, 10, 2, 14, 2, 6, 2, 1, 4, 51, 13, 310, 10, 21, 11, 7, 25, 5, 2, 41, 2, 8, 70, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 7, 25, 39, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 39, 27, 10, 22, 251, 41, 7, 1, 17, 5, 57, 28, 11, 0, 9, 21, 43, 17, 47, 20, 28, 22, 13, 52, 58, 1, 3, 0, 14, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 20, 1, 64, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 31, 9, 2, 0, 3, 0, 2, 37, 2, 0, 26, 0, 2, 0, 45, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 38, 6, 186, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 19, 72, 200, 32, 32, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 24, 43, 261, 18, 16, 0, 2, 12, 2, 33, 125, 0, 80, 921, 103, 110, 18, 195, 2637, 96, 16, 1071, 18, 5, 26, 3994, 6, 582, 6842, 29, 1763, 568, 8, 30, 18, 78, 18, 29, 19, 47, 17, 3, 32, 20, 6, 18, 433, 44, 212, 63, 33, 24, 3, 24, 45, 74, 6, 0, 67, 12, 65, 1, 2, 0, 15, 4, 10, 7381, 42, 31, 98, 114, 8702, 3, 2, 6, 2, 1, 2, 290, 16, 0, 30, 2, 3, 0, 15, 3, 9, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 1845, 30, 7, 5, 262, 61, 147, 44, 11, 6, 17, 0, 322, 29, 19, 43, 485, 27, 229, 29, 3, 0, 208, 30, 2, 2, 2, 1, 2, 6, 3, 4, 10, 1, 225, 6, 2, 3, 2, 1, 2, 14, 2, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42719, 33, 4381, 3, 5773, 3, 7472, 16, 621, 2467, 541, 1507, 4938, 6, 8489];
      var astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 7, 9, 32, 4, 318, 1, 78, 5, 71, 10, 50, 3, 123, 2, 54, 14, 32, 10, 3, 1, 11, 3, 46, 10, 8, 0, 46, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 3, 0, 158, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 68, 8, 2, 0, 3, 0, 2, 3, 2, 4, 2, 0, 15, 1, 83, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 7, 19, 58, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 199, 7, 137, 9, 54, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 55, 9, 266, 3, 10, 1, 2, 0, 49, 6, 4, 4, 14, 10, 5350, 0, 7, 14, 11465, 27, 2343, 9, 87, 9, 39, 4, 60, 6, 26, 9, 535, 9, 470, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 4178, 9, 519, 45, 3, 22, 543, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 101, 0, 161, 6, 10, 9, 357, 0, 62, 13, 499, 13, 245, 1, 2, 9, 233, 0, 3, 0, 8, 1, 6, 0, 475, 6, 110, 6, 6, 9, 4759, 9, 787719, 239];
      function isInAstralSet(code2, set) {
        let pos = 65536;
        for (let i = 0, length = set.length; i < length; i += 2) {
          pos += set[i];
          if (pos > code2) return false;
          pos += set[i + 1];
          if (pos >= code2) return true;
        }
        return false;
      }
      function isIdentifierStart(code2) {
        if (code2 < 65) return code2 === 36;
        if (code2 <= 90) return true;
        if (code2 < 97) return code2 === 95;
        if (code2 <= 122) return true;
        if (code2 <= 65535) {
          return code2 >= 170 && nonASCIIidentifierStart.test(String.fromCharCode(code2));
        }
        return isInAstralSet(code2, astralIdentifierStartCodes);
      }
      function isIdentifierChar(code2) {
        if (code2 < 48) return code2 === 36;
        if (code2 < 58) return true;
        if (code2 < 65) return false;
        if (code2 <= 90) return true;
        if (code2 < 97) return code2 === 95;
        if (code2 <= 122) return true;
        if (code2 <= 65535) {
          return code2 >= 170 && nonASCIIidentifier.test(String.fromCharCode(code2));
        }
        return isInAstralSet(code2, astralIdentifierStartCodes) || isInAstralSet(code2, astralIdentifierCodes);
      }
      var reservedWords = {
        keyword: ["break", "case", "catch", "continue", "debugger", "default", "do", "else", "finally", "for", "function", "if", "return", "switch", "throw", "try", "var", "const", "while", "with", "new", "this", "super", "class", "extends", "export", "import", "null", "true", "false", "in", "instanceof", "typeof", "void", "delete"],
        strict: ["implements", "interface", "let", "package", "private", "protected", "public", "static", "yield"],
        strictBind: ["eval", "arguments"]
      };
      var keywords = new Set(reservedWords.keyword);
      var reservedWordsStrictSet = new Set(reservedWords.strict);
      var reservedWordsStrictBindSet = new Set(reservedWords.strictBind);
      function isReservedWord(word, inModule) {
        return inModule && word === "await" || word === "enum";
      }
      function isStrictReservedWord(word, inModule) {
        return isReservedWord(word, inModule) || reservedWordsStrictSet.has(word);
      }
      function isStrictBindOnlyReservedWord(word) {
        return reservedWordsStrictBindSet.has(word);
      }
      function isStrictBindReservedWord(word, inModule) {
        return isStrictReservedWord(word, inModule) || isStrictBindOnlyReservedWord(word);
      }
      function isKeyword(word) {
        return keywords.has(word);
      }
      function isIteratorStart(current, next, next2) {
        return current === 64 && next === 64 && isIdentifierStart(next2);
      }
      var reservedWordLikeSet = /* @__PURE__ */ new Set(["break", "case", "catch", "continue", "debugger", "default", "do", "else", "finally", "for", "function", "if", "return", "switch", "throw", "try", "var", "const", "while", "with", "new", "this", "super", "class", "extends", "export", "import", "null", "true", "false", "in", "instanceof", "typeof", "void", "delete", "implements", "interface", "let", "package", "private", "protected", "public", "static", "yield", "eval", "arguments", "enum", "await"]);
      function canBeReservedWord(word) {
        return reservedWordLikeSet.has(word);
      }
      var Scope3 = class {
        constructor(flags) {
          this.flags = 0;
          this.names = /* @__PURE__ */ new Map();
          this.firstLexicalName = "";
          this.flags = flags;
        }
      };
      var ScopeHandler = class {
        constructor(parser, inModule) {
          this.parser = void 0;
          this.scopeStack = [];
          this.inModule = void 0;
          this.undefinedExports = /* @__PURE__ */ new Map();
          this.parser = parser;
          this.inModule = inModule;
        }
        get inTopLevel() {
          return (this.currentScope().flags & 1) > 0;
        }
        get inFunction() {
          return (this.currentVarScopeFlags() & 2) > 0;
        }
        get allowSuper() {
          return (this.currentThisScopeFlags() & 16) > 0;
        }
        get allowDirectSuper() {
          return (this.currentThisScopeFlags() & 32) > 0;
        }
        get allowNewTarget() {
          return (this.currentThisScopeFlags() & 512) > 0;
        }
        get inClass() {
          return (this.currentThisScopeFlags() & 64) > 0;
        }
        get inClassAndNotInNonArrowFunction() {
          const flags = this.currentThisScopeFlags();
          return (flags & 64) > 0 && (flags & 2) === 0;
        }
        get inStaticBlock() {
          for (let i = this.scopeStack.length - 1; ; i--) {
            const {
              flags
            } = this.scopeStack[i];
            if (flags & 128) {
              return true;
            }
            if (flags & (1667 | 64)) {
              return false;
            }
          }
        }
        get inNonArrowFunction() {
          return (this.currentThisScopeFlags() & 2) > 0;
        }
        get inBareCaseStatement() {
          return (this.currentScope().flags & 256) > 0;
        }
        get treatFunctionsAsVar() {
          return this.treatFunctionsAsVarInScope(this.currentScope());
        }
        createScope(flags) {
          return new Scope3(flags);
        }
        enter(flags) {
          this.scopeStack.push(this.createScope(flags));
        }
        exit() {
          const scope = this.scopeStack.pop();
          return scope.flags;
        }
        treatFunctionsAsVarInScope(scope) {
          return !!(scope.flags & (2 | 128) || !this.parser.inModule && scope.flags & 1);
        }
        declareName(name, bindingType, loc) {
          let scope = this.currentScope();
          if (bindingType & 8 || bindingType & 16) {
            this.checkRedeclarationInScope(scope, name, bindingType, loc);
            let type = scope.names.get(name) || 0;
            if (bindingType & 16) {
              type = type | 4;
            } else {
              if (!scope.firstLexicalName) {
                scope.firstLexicalName = name;
              }
              type = type | 2;
            }
            scope.names.set(name, type);
            if (bindingType & 8) {
              this.maybeExportDefined(scope, name);
            }
          } else if (bindingType & 4) {
            for (let i = this.scopeStack.length - 1; i >= 0; --i) {
              scope = this.scopeStack[i];
              this.checkRedeclarationInScope(scope, name, bindingType, loc);
              scope.names.set(name, (scope.names.get(name) || 0) | 1);
              this.maybeExportDefined(scope, name);
              if (scope.flags & 1667) break;
            }
          }
          if (this.parser.inModule && scope.flags & 1) {
            this.undefinedExports.delete(name);
          }
        }
        maybeExportDefined(scope, name) {
          if (this.parser.inModule && scope.flags & 1) {
            this.undefinedExports.delete(name);
          }
        }
        checkRedeclarationInScope(scope, name, bindingType, loc) {
          if (this.isRedeclaredInScope(scope, name, bindingType)) {
            this.parser.raise(Errors.VarRedeclaration, loc, {
              identifierName: name
            });
          }
        }
        isRedeclaredInScope(scope, name, bindingType) {
          if (!(bindingType & 1)) return false;
          if (bindingType & 8) {
            return scope.names.has(name);
          }
          const type = scope.names.get(name) || 0;
          if (bindingType & 16) {
            return (type & 2) > 0 || !this.treatFunctionsAsVarInScope(scope) && (type & 1) > 0;
          }
          return (type & 2) > 0 && !(scope.flags & 8 && scope.firstLexicalName === name) || !this.treatFunctionsAsVarInScope(scope) && (type & 4) > 0;
        }
        checkLocalExport(id) {
          const {
            name
          } = id;
          const topLevelScope = this.scopeStack[0];
          if (!topLevelScope.names.has(name)) {
            this.undefinedExports.set(name, id.loc.start);
          }
        }
        currentScope() {
          return this.scopeStack[this.scopeStack.length - 1];
        }
        currentVarScopeFlags() {
          for (let i = this.scopeStack.length - 1; ; i--) {
            const {
              flags
            } = this.scopeStack[i];
            if (flags & 1667) {
              return flags;
            }
          }
        }
        currentThisScopeFlags() {
          for (let i = this.scopeStack.length - 1; ; i--) {
            const {
              flags
            } = this.scopeStack[i];
            if (flags & (1667 | 64) && !(flags & 4)) {
              return flags;
            }
          }
        }
      };
      var FlowScope = class extends Scope3 {
        constructor(...args) {
          super(...args);
          this.declareFunctions = /* @__PURE__ */ new Set();
        }
      };
      var FlowScopeHandler = class extends ScopeHandler {
        createScope(flags) {
          return new FlowScope(flags);
        }
        declareName(name, bindingType, loc) {
          const scope = this.currentScope();
          if (bindingType & 2048) {
            this.checkRedeclarationInScope(scope, name, bindingType, loc);
            this.maybeExportDefined(scope, name);
            scope.declareFunctions.add(name);
            return;
          }
          super.declareName(name, bindingType, loc);
        }
        isRedeclaredInScope(scope, name, bindingType) {
          if (super.isRedeclaredInScope(scope, name, bindingType)) return true;
          if (bindingType & 2048 && !scope.declareFunctions.has(name)) {
            const type = scope.names.get(name);
            return (type & 4) > 0 || (type & 2) > 0;
          }
          return false;
        }
        checkLocalExport(id) {
          if (!this.scopeStack[0].declareFunctions.has(id.name)) {
            super.checkLocalExport(id);
          }
        }
      };
      var reservedTypes = /* @__PURE__ */ new Set(["_", "any", "bool", "boolean", "empty", "extends", "false", "interface", "mixed", "null", "number", "static", "string", "true", "typeof", "void"]);
      var FlowErrors = ParseErrorEnum`flow`({
        AmbiguousConditionalArrow: "Ambiguous expression: wrap the arrow functions in parentheses to disambiguate.",
        AmbiguousDeclareModuleKind: "Found both `declare module.exports` and `declare export` in the same module. Modules can only have 1 since they are either an ES module or they are a CommonJS module.",
        AssignReservedType: ({
          reservedType
        }) => `Cannot overwrite reserved type ${reservedType}.`,
        DeclareClassElement: "The `declare` modifier can only appear on class fields.",
        DeclareClassFieldInitializer: "Initializers are not allowed in fields with the `declare` modifier.",
        DuplicateDeclareModuleExports: "Duplicate `declare module.exports` statement.",
        EnumBooleanMemberNotInitialized: ({
          memberName,
          enumName
        }) => `Boolean enum members need to be initialized. Use either \`${memberName} = true,\` or \`${memberName} = false,\` in enum \`${enumName}\`.`,
        EnumDuplicateMemberName: ({
          memberName,
          enumName
        }) => `Enum member names need to be unique, but the name \`${memberName}\` has already been used before in enum \`${enumName}\`.`,
        EnumInconsistentMemberValues: ({
          enumName
        }) => `Enum \`${enumName}\` has inconsistent member initializers. Either use no initializers, or consistently use literals (either booleans, numbers, or strings) for all member initializers.`,
        EnumInvalidExplicitType: ({
          invalidEnumType,
          enumName
        }) => `Enum type \`${invalidEnumType}\` is not valid. Use one of \`boolean\`, \`number\`, \`string\`, or \`symbol\` in enum \`${enumName}\`.`,
        EnumInvalidExplicitTypeUnknownSupplied: ({
          enumName
        }) => `Supplied enum type is not valid. Use one of \`boolean\`, \`number\`, \`string\`, or \`symbol\` in enum \`${enumName}\`.`,
        EnumInvalidMemberInitializerPrimaryType: ({
          enumName,
          memberName,
          explicitType
        }) => `Enum \`${enumName}\` has type \`${explicitType}\`, so the initializer of \`${memberName}\` needs to be a ${explicitType} literal.`,
        EnumInvalidMemberInitializerSymbolType: ({
          enumName,
          memberName
        }) => `Symbol enum members cannot be initialized. Use \`${memberName},\` in enum \`${enumName}\`.`,
        EnumInvalidMemberInitializerUnknownType: ({
          enumName,
          memberName
        }) => `The enum member initializer for \`${memberName}\` needs to be a literal (either a boolean, number, or string) in enum \`${enumName}\`.`,
        EnumInvalidMemberName: ({
          enumName,
          memberName,
          suggestion
        }) => `Enum member names cannot start with lowercase 'a' through 'z'. Instead of using \`${memberName}\`, consider using \`${suggestion}\`, in enum \`${enumName}\`.`,
        EnumNumberMemberNotInitialized: ({
          enumName,
          memberName
        }) => `Number enum members need to be initialized, e.g. \`${memberName} = 1\` in enum \`${enumName}\`.`,
        EnumStringMemberInconsistentlyInitialized: ({
          enumName
        }) => `String enum members need to consistently either all use initializers, or use no initializers, in enum \`${enumName}\`.`,
        GetterMayNotHaveThisParam: "A getter cannot have a `this` parameter.",
        ImportReflectionHasImportType: "An `import module` declaration can not use `type` or `typeof` keyword.",
        ImportTypeShorthandOnlyInPureImport: "The `type` and `typeof` keywords on named imports can only be used on regular `import` statements. It cannot be used with `import type` or `import typeof` statements.",
        InexactInsideExact: "Explicit inexact syntax cannot appear inside an explicit exact object type.",
        InexactInsideNonObject: "Explicit inexact syntax cannot appear in class or interface definitions.",
        InexactVariance: "Explicit inexact syntax cannot have variance.",
        InvalidNonTypeImportInDeclareModule: "Imports within a `declare module` body must always be `import type` or `import typeof`.",
        MissingTypeParamDefault: "Type parameter declaration needs a default, since a preceding type parameter declaration has a default.",
        NestedDeclareModule: "`declare module` cannot be used inside another `declare module`.",
        NestedFlowComment: "Cannot have a flow comment inside another flow comment.",
        PatternIsOptional: Object.assign({
          message: "A binding pattern parameter cannot be optional in an implementation signature."
        }, {
          reasonCode: "OptionalBindingPattern"
        }),
        SetterMayNotHaveThisParam: "A setter cannot have a `this` parameter.",
        SpreadVariance: "Spread properties cannot have variance.",
        ThisParamAnnotationRequired: "A type annotation is required for the `this` parameter.",
        ThisParamBannedInConstructor: "Constructors cannot have a `this` parameter; constructors don't bind `this` like other functions.",
        ThisParamMayNotBeOptional: "The `this` parameter cannot be optional.",
        ThisParamMustBeFirst: "The `this` parameter must be the first function parameter.",
        ThisParamNoDefault: "The `this` parameter may not have a default value.",
        TypeBeforeInitializer: "Type annotations must come before default assignments, e.g. instead of `age = 25: number` use `age: number = 25`.",
        TypeCastInPattern: "The type cast expression is expected to be wrapped with parenthesis.",
        UnexpectedExplicitInexactInObject: "Explicit inexact syntax must appear at the end of an inexact object.",
        UnexpectedReservedType: ({
          reservedType
        }) => `Unexpected reserved type ${reservedType}.`,
        UnexpectedReservedUnderscore: "`_` is only allowed as a type argument to call or new.",
        UnexpectedSpaceBetweenModuloChecks: "Spaces between `%` and `checks` are not allowed here.",
        UnexpectedSpreadType: "Spread operator cannot appear in class or interface definitions.",
        UnexpectedSubtractionOperand: 'Unexpected token, expected "number" or "bigint".',
        UnexpectedTokenAfterTypeParameter: "Expected an arrow function after this type parameter declaration.",
        UnexpectedTypeParameterBeforeAsyncArrowFunction: "Type parameters must come after the async keyword, e.g. instead of `<T> async () => {}`, use `async <T>() => {}`.",
        UnsupportedDeclareExportKind: ({
          unsupportedExportKind,
          suggestion
        }) => `\`declare export ${unsupportedExportKind}\` is not supported. Use \`${suggestion}\` instead.`,
        UnsupportedStatementInDeclareModule: "Only declares and type imports are allowed inside declare module.",
        UnterminatedFlowComment: "Unterminated flow-comment."
      });
      function isEsModuleType(bodyElement) {
        return bodyElement.type === "DeclareExportAllDeclaration" || bodyElement.type === "DeclareExportDeclaration" && (!bodyElement.declaration || bodyElement.declaration.type !== "TypeAlias" && bodyElement.declaration.type !== "InterfaceDeclaration");
      }
      function hasTypeImportKind(node) {
        return node.importKind === "type" || node.importKind === "typeof";
      }
      var exportSuggestions = {
        const: "declare export var",
        let: "declare export var",
        type: "export type",
        interface: "export interface"
      };
      function partition(list, test) {
        const list1 = [];
        const list2 = [];
        for (let i = 0; i < list.length; i++) {
          (test(list[i], i, list) ? list1 : list2).push(list[i]);
        }
        return [list1, list2];
      }
      var FLOW_PRAGMA_REGEX = /\*?\s*@((?:no)?flow)\b/;
      var flow = (superClass) => class FlowParserMixin extends superClass {
        constructor(...args) {
          super(...args);
          this.flowPragma = void 0;
        }
        getScopeHandler() {
          return FlowScopeHandler;
        }
        shouldParseTypes() {
          return this.getPluginOption("flow", "all") || this.flowPragma === "flow";
        }
        finishToken(type, val) {
          if (type !== 134 && type !== 13 && type !== 28) {
            if (this.flowPragma === void 0) {
              this.flowPragma = null;
            }
          }
          super.finishToken(type, val);
        }
        addComment(comment) {
          if (this.flowPragma === void 0) {
            const matches = FLOW_PRAGMA_REGEX.exec(comment.value);
            if (!matches) ;
            else if (matches[1] === "flow") {
              this.flowPragma = "flow";
            } else if (matches[1] === "noflow") {
              this.flowPragma = "noflow";
            } else {
              throw new Error("Unexpected flow pragma");
            }
          }
          super.addComment(comment);
        }
        flowParseTypeInitialiser(tok) {
          const oldInType = this.state.inType;
          this.state.inType = true;
          this.expect(tok || 14);
          const type = this.flowParseType();
          this.state.inType = oldInType;
          return type;
        }
        flowParsePredicate() {
          const node = this.startNode();
          const moduloLoc = this.state.startLoc;
          this.next();
          this.expectContextual(110);
          if (this.state.lastTokStartLoc.index > moduloLoc.index + 1) {
            this.raise(FlowErrors.UnexpectedSpaceBetweenModuloChecks, moduloLoc);
          }
          if (this.eat(10)) {
            node.value = super.parseExpression();
            this.expect(11);
            return this.finishNode(node, "DeclaredPredicate");
          } else {
            return this.finishNode(node, "InferredPredicate");
          }
        }
        flowParseTypeAndPredicateInitialiser() {
          const oldInType = this.state.inType;
          this.state.inType = true;
          this.expect(14);
          let type = null;
          let predicate = null;
          if (this.match(54)) {
            this.state.inType = oldInType;
            predicate = this.flowParsePredicate();
          } else {
            type = this.flowParseType();
            this.state.inType = oldInType;
            if (this.match(54)) {
              predicate = this.flowParsePredicate();
            }
          }
          return [type, predicate];
        }
        flowParseDeclareClass(node) {
          this.next();
          this.flowParseInterfaceish(node, true);
          return this.finishNode(node, "DeclareClass");
        }
        flowParseDeclareFunction(node) {
          this.next();
          const id = node.id = this.parseIdentifier();
          const typeNode = this.startNode();
          const typeContainer = this.startNode();
          if (this.match(47)) {
            typeNode.typeParameters = this.flowParseTypeParameterDeclaration();
          } else {
            typeNode.typeParameters = null;
          }
          this.expect(10);
          const tmp = this.flowParseFunctionTypeParams();
          typeNode.params = tmp.params;
          typeNode.rest = tmp.rest;
          typeNode.this = tmp._this;
          this.expect(11);
          [typeNode.returnType, node.predicate] = this.flowParseTypeAndPredicateInitialiser();
          typeContainer.typeAnnotation = this.finishNode(typeNode, "FunctionTypeAnnotation");
          id.typeAnnotation = this.finishNode(typeContainer, "TypeAnnotation");
          this.resetEndLocation(id);
          this.semicolon();
          this.scope.declareName(node.id.name, 2048, node.id.loc.start);
          return this.finishNode(node, "DeclareFunction");
        }
        flowParseDeclare(node, insideModule) {
          if (this.match(80)) {
            return this.flowParseDeclareClass(node);
          } else if (this.match(68)) {
            return this.flowParseDeclareFunction(node);
          } else if (this.match(74)) {
            return this.flowParseDeclareVariable(node);
          } else if (this.eatContextual(127)) {
            if (this.match(16)) {
              return this.flowParseDeclareModuleExports(node);
            } else {
              if (insideModule) {
                this.raise(FlowErrors.NestedDeclareModule, this.state.lastTokStartLoc);
              }
              return this.flowParseDeclareModule(node);
            }
          } else if (this.isContextual(130)) {
            return this.flowParseDeclareTypeAlias(node);
          } else if (this.isContextual(131)) {
            return this.flowParseDeclareOpaqueType(node);
          } else if (this.isContextual(129)) {
            return this.flowParseDeclareInterface(node);
          } else if (this.match(82)) {
            return this.flowParseDeclareExportDeclaration(node, insideModule);
          }
          throw this.unexpected();
        }
        flowParseDeclareVariable(node) {
          this.next();
          node.id = this.flowParseTypeAnnotatableIdentifier(true);
          this.scope.declareName(node.id.name, 5, node.id.loc.start);
          this.semicolon();
          return this.finishNode(node, "DeclareVariable");
        }
        flowParseDeclareModule(node) {
          this.scope.enter(0);
          if (this.match(134)) {
            node.id = super.parseExprAtom();
          } else {
            node.id = this.parseIdentifier();
          }
          const bodyNode = node.body = this.startNode();
          const body = bodyNode.body = [];
          this.expect(5);
          while (!this.match(8)) {
            const bodyNode2 = this.startNode();
            if (this.match(83)) {
              this.next();
              if (!this.isContextual(130) && !this.match(87)) {
                this.raise(FlowErrors.InvalidNonTypeImportInDeclareModule, this.state.lastTokStartLoc);
              }
              body.push(super.parseImport(bodyNode2));
            } else {
              this.expectContextual(125, FlowErrors.UnsupportedStatementInDeclareModule);
              body.push(this.flowParseDeclare(bodyNode2, true));
            }
          }
          this.scope.exit();
          this.expect(8);
          this.finishNode(bodyNode, "BlockStatement");
          let kind = null;
          let hasModuleExport = false;
          body.forEach((bodyElement) => {
            if (isEsModuleType(bodyElement)) {
              if (kind === "CommonJS") {
                this.raise(FlowErrors.AmbiguousDeclareModuleKind, bodyElement);
              }
              kind = "ES";
            } else if (bodyElement.type === "DeclareModuleExports") {
              if (hasModuleExport) {
                this.raise(FlowErrors.DuplicateDeclareModuleExports, bodyElement);
              }
              if (kind === "ES") {
                this.raise(FlowErrors.AmbiguousDeclareModuleKind, bodyElement);
              }
              kind = "CommonJS";
              hasModuleExport = true;
            }
          });
          node.kind = kind || "CommonJS";
          return this.finishNode(node, "DeclareModule");
        }
        flowParseDeclareExportDeclaration(node, insideModule) {
          this.expect(82);
          if (this.eat(65)) {
            if (this.match(68) || this.match(80)) {
              node.declaration = this.flowParseDeclare(this.startNode());
            } else {
              node.declaration = this.flowParseType();
              this.semicolon();
            }
            node.default = true;
            return this.finishNode(node, "DeclareExportDeclaration");
          } else {
            if (this.match(75) || this.isLet() || (this.isContextual(130) || this.isContextual(129)) && !insideModule) {
              const label = this.state.value;
              throw this.raise(FlowErrors.UnsupportedDeclareExportKind, this.state.startLoc, {
                unsupportedExportKind: label,
                suggestion: exportSuggestions[label]
              });
            }
            if (this.match(74) || this.match(68) || this.match(80) || this.isContextual(131)) {
              node.declaration = this.flowParseDeclare(this.startNode());
              node.default = false;
              return this.finishNode(node, "DeclareExportDeclaration");
            } else if (this.match(55) || this.match(5) || this.isContextual(129) || this.isContextual(130) || this.isContextual(131)) {
              node = this.parseExport(node, null);
              if (node.type === "ExportNamedDeclaration") {
                node.default = false;
                delete node.exportKind;
                return this.castNodeTo(node, "DeclareExportDeclaration");
              } else {
                return this.castNodeTo(node, "DeclareExportAllDeclaration");
              }
            }
          }
          throw this.unexpected();
        }
        flowParseDeclareModuleExports(node) {
          this.next();
          this.expectContextual(111);
          node.typeAnnotation = this.flowParseTypeAnnotation();
          this.semicolon();
          return this.finishNode(node, "DeclareModuleExports");
        }
        flowParseDeclareTypeAlias(node) {
          this.next();
          const finished = this.flowParseTypeAlias(node);
          this.castNodeTo(finished, "DeclareTypeAlias");
          return finished;
        }
        flowParseDeclareOpaqueType(node) {
          this.next();
          const finished = this.flowParseOpaqueType(node, true);
          this.castNodeTo(finished, "DeclareOpaqueType");
          return finished;
        }
        flowParseDeclareInterface(node) {
          this.next();
          this.flowParseInterfaceish(node, false);
          return this.finishNode(node, "DeclareInterface");
        }
        flowParseInterfaceish(node, isClass) {
          node.id = this.flowParseRestrictedIdentifier(!isClass, true);
          this.scope.declareName(node.id.name, isClass ? 17 : 8201, node.id.loc.start);
          if (this.match(47)) {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
          } else {
            node.typeParameters = null;
          }
          node.extends = [];
          if (this.eat(81)) {
            do {
              node.extends.push(this.flowParseInterfaceExtends());
            } while (!isClass && this.eat(12));
          }
          if (isClass) {
            node.implements = [];
            node.mixins = [];
            if (this.eatContextual(117)) {
              do {
                node.mixins.push(this.flowParseInterfaceExtends());
              } while (this.eat(12));
            }
            if (this.eatContextual(113)) {
              do {
                node.implements.push(this.flowParseInterfaceExtends());
              } while (this.eat(12));
            }
          }
          node.body = this.flowParseObjectType({
            allowStatic: isClass,
            allowExact: false,
            allowSpread: false,
            allowProto: isClass,
            allowInexact: false
          });
        }
        flowParseInterfaceExtends() {
          const node = this.startNode();
          node.id = this.flowParseQualifiedTypeIdentifier();
          if (this.match(47)) {
            node.typeParameters = this.flowParseTypeParameterInstantiation();
          } else {
            node.typeParameters = null;
          }
          return this.finishNode(node, "InterfaceExtends");
        }
        flowParseInterface(node) {
          this.flowParseInterfaceish(node, false);
          return this.finishNode(node, "InterfaceDeclaration");
        }
        checkNotUnderscore(word) {
          if (word === "_") {
            this.raise(FlowErrors.UnexpectedReservedUnderscore, this.state.startLoc);
          }
        }
        checkReservedType(word, startLoc, declaration) {
          if (!reservedTypes.has(word)) return;
          this.raise(declaration ? FlowErrors.AssignReservedType : FlowErrors.UnexpectedReservedType, startLoc, {
            reservedType: word
          });
        }
        flowParseRestrictedIdentifier(liberal, declaration) {
          this.checkReservedType(this.state.value, this.state.startLoc, declaration);
          return this.parseIdentifier(liberal);
        }
        flowParseTypeAlias(node) {
          node.id = this.flowParseRestrictedIdentifier(false, true);
          this.scope.declareName(node.id.name, 8201, node.id.loc.start);
          if (this.match(47)) {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
          } else {
            node.typeParameters = null;
          }
          node.right = this.flowParseTypeInitialiser(29);
          this.semicolon();
          return this.finishNode(node, "TypeAlias");
        }
        flowParseOpaqueType(node, declare) {
          this.expectContextual(130);
          node.id = this.flowParseRestrictedIdentifier(true, true);
          this.scope.declareName(node.id.name, 8201, node.id.loc.start);
          if (this.match(47)) {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
          } else {
            node.typeParameters = null;
          }
          node.supertype = null;
          if (this.match(14)) {
            node.supertype = this.flowParseTypeInitialiser(14);
          }
          node.impltype = null;
          if (!declare) {
            node.impltype = this.flowParseTypeInitialiser(29);
          }
          this.semicolon();
          return this.finishNode(node, "OpaqueType");
        }
        flowParseTypeParameter(requireDefault = false) {
          const nodeStartLoc = this.state.startLoc;
          const node = this.startNode();
          const variance = this.flowParseVariance();
          const ident = this.flowParseTypeAnnotatableIdentifier();
          node.name = ident.name;
          node.variance = variance;
          node.bound = ident.typeAnnotation;
          if (this.match(29)) {
            this.eat(29);
            node.default = this.flowParseType();
          } else {
            if (requireDefault) {
              this.raise(FlowErrors.MissingTypeParamDefault, nodeStartLoc);
            }
          }
          return this.finishNode(node, "TypeParameter");
        }
        flowParseTypeParameterDeclaration() {
          const oldInType = this.state.inType;
          const node = this.startNode();
          node.params = [];
          this.state.inType = true;
          if (this.match(47) || this.match(143)) {
            this.next();
          } else {
            this.unexpected();
          }
          let defaultRequired = false;
          do {
            const typeParameter = this.flowParseTypeParameter(defaultRequired);
            node.params.push(typeParameter);
            if (typeParameter.default) {
              defaultRequired = true;
            }
            if (!this.match(48)) {
              this.expect(12);
            }
          } while (!this.match(48));
          this.expect(48);
          this.state.inType = oldInType;
          return this.finishNode(node, "TypeParameterDeclaration");
        }
        flowInTopLevelContext(cb) {
          if (this.curContext() !== types.brace) {
            const oldContext = this.state.context;
            this.state.context = [oldContext[0]];
            try {
              return cb();
            } finally {
              this.state.context = oldContext;
            }
          } else {
            return cb();
          }
        }
        flowParseTypeParameterInstantiationInExpression() {
          if (this.reScan_lt() !== 47) return;
          return this.flowParseTypeParameterInstantiation();
        }
        flowParseTypeParameterInstantiation() {
          const node = this.startNode();
          const oldInType = this.state.inType;
          this.state.inType = true;
          node.params = [];
          this.flowInTopLevelContext(() => {
            this.expect(47);
            const oldNoAnonFunctionType = this.state.noAnonFunctionType;
            this.state.noAnonFunctionType = false;
            while (!this.match(48)) {
              node.params.push(this.flowParseType());
              if (!this.match(48)) {
                this.expect(12);
              }
            }
            this.state.noAnonFunctionType = oldNoAnonFunctionType;
          });
          this.state.inType = oldInType;
          if (!this.state.inType && this.curContext() === types.brace) {
            this.reScan_lt_gt();
          }
          this.expect(48);
          return this.finishNode(node, "TypeParameterInstantiation");
        }
        flowParseTypeParameterInstantiationCallOrNew() {
          if (this.reScan_lt() !== 47) return null;
          const node = this.startNode();
          const oldInType = this.state.inType;
          node.params = [];
          this.state.inType = true;
          this.expect(47);
          while (!this.match(48)) {
            node.params.push(this.flowParseTypeOrImplicitInstantiation());
            if (!this.match(48)) {
              this.expect(12);
            }
          }
          this.expect(48);
          this.state.inType = oldInType;
          return this.finishNode(node, "TypeParameterInstantiation");
        }
        flowParseInterfaceType() {
          const node = this.startNode();
          this.expectContextual(129);
          node.extends = [];
          if (this.eat(81)) {
            do {
              node.extends.push(this.flowParseInterfaceExtends());
            } while (this.eat(12));
          }
          node.body = this.flowParseObjectType({
            allowStatic: false,
            allowExact: false,
            allowSpread: false,
            allowProto: false,
            allowInexact: false
          });
          return this.finishNode(node, "InterfaceTypeAnnotation");
        }
        flowParseObjectPropertyKey() {
          return this.match(135) || this.match(134) ? super.parseExprAtom() : this.parseIdentifier(true);
        }
        flowParseObjectTypeIndexer(node, isStatic, variance) {
          node.static = isStatic;
          if (this.lookahead().type === 14) {
            node.id = this.flowParseObjectPropertyKey();
            node.key = this.flowParseTypeInitialiser();
          } else {
            node.id = null;
            node.key = this.flowParseType();
          }
          this.expect(3);
          node.value = this.flowParseTypeInitialiser();
          node.variance = variance;
          return this.finishNode(node, "ObjectTypeIndexer");
        }
        flowParseObjectTypeInternalSlot(node, isStatic) {
          node.static = isStatic;
          node.id = this.flowParseObjectPropertyKey();
          this.expect(3);
          this.expect(3);
          if (this.match(47) || this.match(10)) {
            node.method = true;
            node.optional = false;
            node.value = this.flowParseObjectTypeMethodish(this.startNodeAt(node.loc.start));
          } else {
            node.method = false;
            if (this.eat(17)) {
              node.optional = true;
            }
            node.value = this.flowParseTypeInitialiser();
          }
          return this.finishNode(node, "ObjectTypeInternalSlot");
        }
        flowParseObjectTypeMethodish(node) {
          node.params = [];
          node.rest = null;
          node.typeParameters = null;
          node.this = null;
          if (this.match(47)) {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
          }
          this.expect(10);
          if (this.match(78)) {
            node.this = this.flowParseFunctionTypeParam(true);
            node.this.name = null;
            if (!this.match(11)) {
              this.expect(12);
            }
          }
          while (!this.match(11) && !this.match(21)) {
            node.params.push(this.flowParseFunctionTypeParam(false));
            if (!this.match(11)) {
              this.expect(12);
            }
          }
          if (this.eat(21)) {
            node.rest = this.flowParseFunctionTypeParam(false);
          }
          this.expect(11);
          node.returnType = this.flowParseTypeInitialiser();
          return this.finishNode(node, "FunctionTypeAnnotation");
        }
        flowParseObjectTypeCallProperty(node, isStatic) {
          const valueNode = this.startNode();
          node.static = isStatic;
          node.value = this.flowParseObjectTypeMethodish(valueNode);
          return this.finishNode(node, "ObjectTypeCallProperty");
        }
        flowParseObjectType({
          allowStatic,
          allowExact,
          allowSpread,
          allowProto,
          allowInexact
        }) {
          const oldInType = this.state.inType;
          this.state.inType = true;
          const nodeStart = this.startNode();
          nodeStart.callProperties = [];
          nodeStart.properties = [];
          nodeStart.indexers = [];
          nodeStart.internalSlots = [];
          let endDelim;
          let exact;
          let inexact = false;
          if (allowExact && this.match(6)) {
            this.expect(6);
            endDelim = 9;
            exact = true;
          } else {
            this.expect(5);
            endDelim = 8;
            exact = false;
          }
          nodeStart.exact = exact;
          while (!this.match(endDelim)) {
            let isStatic = false;
            let protoStartLoc = null;
            let inexactStartLoc = null;
            const node = this.startNode();
            if (allowProto && this.isContextual(118)) {
              const lookahead = this.lookahead();
              if (lookahead.type !== 14 && lookahead.type !== 17) {
                this.next();
                protoStartLoc = this.state.startLoc;
                allowStatic = false;
              }
            }
            if (allowStatic && this.isContextual(106)) {
              const lookahead = this.lookahead();
              if (lookahead.type !== 14 && lookahead.type !== 17) {
                this.next();
                isStatic = true;
              }
            }
            const variance = this.flowParseVariance();
            if (this.eat(0)) {
              if (protoStartLoc != null) {
                this.unexpected(protoStartLoc);
              }
              if (this.eat(0)) {
                if (variance) {
                  this.unexpected(variance.loc.start);
                }
                nodeStart.internalSlots.push(this.flowParseObjectTypeInternalSlot(node, isStatic));
              } else {
                nodeStart.indexers.push(this.flowParseObjectTypeIndexer(node, isStatic, variance));
              }
            } else if (this.match(10) || this.match(47)) {
              if (protoStartLoc != null) {
                this.unexpected(protoStartLoc);
              }
              if (variance) {
                this.unexpected(variance.loc.start);
              }
              nodeStart.callProperties.push(this.flowParseObjectTypeCallProperty(node, isStatic));
            } else {
              let kind = "init";
              if (this.isContextual(99) || this.isContextual(104)) {
                const lookahead = this.lookahead();
                if (tokenIsLiteralPropertyName(lookahead.type)) {
                  kind = this.state.value;
                  this.next();
                }
              }
              const propOrInexact = this.flowParseObjectTypeProperty(node, isStatic, protoStartLoc, variance, kind, allowSpread, allowInexact != null ? allowInexact : !exact);
              if (propOrInexact === null) {
                inexact = true;
                inexactStartLoc = this.state.lastTokStartLoc;
              } else {
                nodeStart.properties.push(propOrInexact);
              }
            }
            this.flowObjectTypeSemicolon();
            if (inexactStartLoc && !this.match(8) && !this.match(9)) {
              this.raise(FlowErrors.UnexpectedExplicitInexactInObject, inexactStartLoc);
            }
          }
          this.expect(endDelim);
          if (allowSpread) {
            nodeStart.inexact = inexact;
          }
          const out = this.finishNode(nodeStart, "ObjectTypeAnnotation");
          this.state.inType = oldInType;
          return out;
        }
        flowParseObjectTypeProperty(node, isStatic, protoStartLoc, variance, kind, allowSpread, allowInexact) {
          if (this.eat(21)) {
            const isInexactToken = this.match(12) || this.match(13) || this.match(8) || this.match(9);
            if (isInexactToken) {
              if (!allowSpread) {
                this.raise(FlowErrors.InexactInsideNonObject, this.state.lastTokStartLoc);
              } else if (!allowInexact) {
                this.raise(FlowErrors.InexactInsideExact, this.state.lastTokStartLoc);
              }
              if (variance) {
                this.raise(FlowErrors.InexactVariance, variance);
              }
              return null;
            }
            if (!allowSpread) {
              this.raise(FlowErrors.UnexpectedSpreadType, this.state.lastTokStartLoc);
            }
            if (protoStartLoc != null) {
              this.unexpected(protoStartLoc);
            }
            if (variance) {
              this.raise(FlowErrors.SpreadVariance, variance);
            }
            node.argument = this.flowParseType();
            return this.finishNode(node, "ObjectTypeSpreadProperty");
          } else {
            node.key = this.flowParseObjectPropertyKey();
            node.static = isStatic;
            node.proto = protoStartLoc != null;
            node.kind = kind;
            let optional = false;
            if (this.match(47) || this.match(10)) {
              node.method = true;
              if (protoStartLoc != null) {
                this.unexpected(protoStartLoc);
              }
              if (variance) {
                this.unexpected(variance.loc.start);
              }
              node.value = this.flowParseObjectTypeMethodish(this.startNodeAt(node.loc.start));
              if (kind === "get" || kind === "set") {
                this.flowCheckGetterSetterParams(node);
              }
              if (!allowSpread && node.key.name === "constructor" && node.value.this) {
                this.raise(FlowErrors.ThisParamBannedInConstructor, node.value.this);
              }
            } else {
              if (kind !== "init") this.unexpected();
              node.method = false;
              if (this.eat(17)) {
                optional = true;
              }
              node.value = this.flowParseTypeInitialiser();
              node.variance = variance;
            }
            node.optional = optional;
            return this.finishNode(node, "ObjectTypeProperty");
          }
        }
        flowCheckGetterSetterParams(property) {
          const paramCount = property.kind === "get" ? 0 : 1;
          const length = property.value.params.length + (property.value.rest ? 1 : 0);
          if (property.value.this) {
            this.raise(property.kind === "get" ? FlowErrors.GetterMayNotHaveThisParam : FlowErrors.SetterMayNotHaveThisParam, property.value.this);
          }
          if (length !== paramCount) {
            this.raise(property.kind === "get" ? Errors.BadGetterArity : Errors.BadSetterArity, property);
          }
          if (property.kind === "set" && property.value.rest) {
            this.raise(Errors.BadSetterRestParameter, property);
          }
        }
        flowObjectTypeSemicolon() {
          if (!this.eat(13) && !this.eat(12) && !this.match(8) && !this.match(9)) {
            this.unexpected();
          }
        }
        flowParseQualifiedTypeIdentifier(startLoc, id) {
          startLoc != null ? startLoc : startLoc = this.state.startLoc;
          let node = id || this.flowParseRestrictedIdentifier(true);
          while (this.eat(16)) {
            const node2 = this.startNodeAt(startLoc);
            node2.qualification = node;
            node2.id = this.flowParseRestrictedIdentifier(true);
            node = this.finishNode(node2, "QualifiedTypeIdentifier");
          }
          return node;
        }
        flowParseGenericType(startLoc, id) {
          const node = this.startNodeAt(startLoc);
          node.typeParameters = null;
          node.id = this.flowParseQualifiedTypeIdentifier(startLoc, id);
          if (this.match(47)) {
            node.typeParameters = this.flowParseTypeParameterInstantiation();
          }
          return this.finishNode(node, "GenericTypeAnnotation");
        }
        flowParseTypeofType() {
          const node = this.startNode();
          this.expect(87);
          node.argument = this.flowParsePrimaryType();
          return this.finishNode(node, "TypeofTypeAnnotation");
        }
        flowParseTupleType() {
          const node = this.startNode();
          node.types = [];
          this.expect(0);
          while (this.state.pos < this.length && !this.match(3)) {
            node.types.push(this.flowParseType());
            if (this.match(3)) break;
            this.expect(12);
          }
          this.expect(3);
          return this.finishNode(node, "TupleTypeAnnotation");
        }
        flowParseFunctionTypeParam(first) {
          let name = null;
          let optional = false;
          let typeAnnotation = null;
          const node = this.startNode();
          const lh = this.lookahead();
          const isThis = this.state.type === 78;
          if (lh.type === 14 || lh.type === 17) {
            if (isThis && !first) {
              this.raise(FlowErrors.ThisParamMustBeFirst, node);
            }
            name = this.parseIdentifier(isThis);
            if (this.eat(17)) {
              optional = true;
              if (isThis) {
                this.raise(FlowErrors.ThisParamMayNotBeOptional, node);
              }
            }
            typeAnnotation = this.flowParseTypeInitialiser();
          } else {
            typeAnnotation = this.flowParseType();
          }
          node.name = name;
          node.optional = optional;
          node.typeAnnotation = typeAnnotation;
          return this.finishNode(node, "FunctionTypeParam");
        }
        reinterpretTypeAsFunctionTypeParam(type) {
          const node = this.startNodeAt(type.loc.start);
          node.name = null;
          node.optional = false;
          node.typeAnnotation = type;
          return this.finishNode(node, "FunctionTypeParam");
        }
        flowParseFunctionTypeParams(params = []) {
          let rest = null;
          let _this = null;
          if (this.match(78)) {
            _this = this.flowParseFunctionTypeParam(true);
            _this.name = null;
            if (!this.match(11)) {
              this.expect(12);
            }
          }
          while (!this.match(11) && !this.match(21)) {
            params.push(this.flowParseFunctionTypeParam(false));
            if (!this.match(11)) {
              this.expect(12);
            }
          }
          if (this.eat(21)) {
            rest = this.flowParseFunctionTypeParam(false);
          }
          return {
            params,
            rest,
            _this
          };
        }
        flowIdentToTypeAnnotation(startLoc, node, id) {
          switch (id.name) {
            case "any":
              return this.finishNode(node, "AnyTypeAnnotation");
            case "bool":
            case "boolean":
              return this.finishNode(node, "BooleanTypeAnnotation");
            case "mixed":
              return this.finishNode(node, "MixedTypeAnnotation");
            case "empty":
              return this.finishNode(node, "EmptyTypeAnnotation");
            case "number":
              return this.finishNode(node, "NumberTypeAnnotation");
            case "string":
              return this.finishNode(node, "StringTypeAnnotation");
            case "symbol":
              return this.finishNode(node, "SymbolTypeAnnotation");
            default:
              this.checkNotUnderscore(id.name);
              return this.flowParseGenericType(startLoc, id);
          }
        }
        flowParsePrimaryType() {
          const startLoc = this.state.startLoc;
          const node = this.startNode();
          let tmp;
          let type;
          let isGroupedType = false;
          const oldNoAnonFunctionType = this.state.noAnonFunctionType;
          switch (this.state.type) {
            case 5:
              return this.flowParseObjectType({
                allowStatic: false,
                allowExact: false,
                allowSpread: true,
                allowProto: false,
                allowInexact: true
              });
            case 6:
              return this.flowParseObjectType({
                allowStatic: false,
                allowExact: true,
                allowSpread: true,
                allowProto: false,
                allowInexact: false
              });
            case 0:
              this.state.noAnonFunctionType = false;
              type = this.flowParseTupleType();
              this.state.noAnonFunctionType = oldNoAnonFunctionType;
              return type;
            case 47: {
              const node2 = this.startNode();
              node2.typeParameters = this.flowParseTypeParameterDeclaration();
              this.expect(10);
              tmp = this.flowParseFunctionTypeParams();
              node2.params = tmp.params;
              node2.rest = tmp.rest;
              node2.this = tmp._this;
              this.expect(11);
              this.expect(19);
              node2.returnType = this.flowParseType();
              return this.finishNode(node2, "FunctionTypeAnnotation");
            }
            case 10: {
              const node2 = this.startNode();
              this.next();
              if (!this.match(11) && !this.match(21)) {
                if (tokenIsIdentifier(this.state.type) || this.match(78)) {
                  const token = this.lookahead().type;
                  isGroupedType = token !== 17 && token !== 14;
                } else {
                  isGroupedType = true;
                }
              }
              if (isGroupedType) {
                this.state.noAnonFunctionType = false;
                type = this.flowParseType();
                this.state.noAnonFunctionType = oldNoAnonFunctionType;
                if (this.state.noAnonFunctionType || !(this.match(12) || this.match(11) && this.lookahead().type === 19)) {
                  this.expect(11);
                  return type;
                } else {
                  this.eat(12);
                }
              }
              if (type) {
                tmp = this.flowParseFunctionTypeParams([this.reinterpretTypeAsFunctionTypeParam(type)]);
              } else {
                tmp = this.flowParseFunctionTypeParams();
              }
              node2.params = tmp.params;
              node2.rest = tmp.rest;
              node2.this = tmp._this;
              this.expect(11);
              this.expect(19);
              node2.returnType = this.flowParseType();
              node2.typeParameters = null;
              return this.finishNode(node2, "FunctionTypeAnnotation");
            }
            case 134:
              return this.parseLiteral(this.state.value, "StringLiteralTypeAnnotation");
            case 85:
            case 86:
              node.value = this.match(85);
              this.next();
              return this.finishNode(node, "BooleanLiteralTypeAnnotation");
            case 53:
              if (this.state.value === "-") {
                this.next();
                if (this.match(135)) {
                  return this.parseLiteralAtNode(-this.state.value, "NumberLiteralTypeAnnotation", node);
                }
                if (this.match(136)) {
                  return this.parseLiteralAtNode(-this.state.value, "BigIntLiteralTypeAnnotation", node);
                }
                throw this.raise(FlowErrors.UnexpectedSubtractionOperand, this.state.startLoc);
              }
              throw this.unexpected();
            case 135:
              return this.parseLiteral(this.state.value, "NumberLiteralTypeAnnotation");
            case 136:
              return this.parseLiteral(this.state.value, "BigIntLiteralTypeAnnotation");
            case 88:
              this.next();
              return this.finishNode(node, "VoidTypeAnnotation");
            case 84:
              this.next();
              return this.finishNode(node, "NullLiteralTypeAnnotation");
            case 78:
              this.next();
              return this.finishNode(node, "ThisTypeAnnotation");
            case 55:
              this.next();
              return this.finishNode(node, "ExistsTypeAnnotation");
            case 87:
              return this.flowParseTypeofType();
            default:
              if (tokenIsKeyword(this.state.type)) {
                const label = tokenLabelName(this.state.type);
                this.next();
                return super.createIdentifier(node, label);
              } else if (tokenIsIdentifier(this.state.type)) {
                if (this.isContextual(129)) {
                  return this.flowParseInterfaceType();
                }
                return this.flowIdentToTypeAnnotation(startLoc, node, this.parseIdentifier());
              }
          }
          throw this.unexpected();
        }
        flowParsePostfixType() {
          const startLoc = this.state.startLoc;
          let type = this.flowParsePrimaryType();
          let seenOptionalIndexedAccess = false;
          while ((this.match(0) || this.match(18)) && !this.canInsertSemicolon()) {
            const node = this.startNodeAt(startLoc);
            const optional = this.eat(18);
            seenOptionalIndexedAccess = seenOptionalIndexedAccess || optional;
            this.expect(0);
            if (!optional && this.match(3)) {
              node.elementType = type;
              this.next();
              type = this.finishNode(node, "ArrayTypeAnnotation");
            } else {
              node.objectType = type;
              node.indexType = this.flowParseType();
              this.expect(3);
              if (seenOptionalIndexedAccess) {
                node.optional = optional;
                type = this.finishNode(node, "OptionalIndexedAccessType");
              } else {
                type = this.finishNode(node, "IndexedAccessType");
              }
            }
          }
          return type;
        }
        flowParsePrefixType() {
          const node = this.startNode();
          if (this.eat(17)) {
            node.typeAnnotation = this.flowParsePrefixType();
            return this.finishNode(node, "NullableTypeAnnotation");
          } else {
            return this.flowParsePostfixType();
          }
        }
        flowParseAnonFunctionWithoutParens() {
          const param = this.flowParsePrefixType();
          if (!this.state.noAnonFunctionType && this.eat(19)) {
            const node = this.startNodeAt(param.loc.start);
            node.params = [this.reinterpretTypeAsFunctionTypeParam(param)];
            node.rest = null;
            node.this = null;
            node.returnType = this.flowParseType();
            node.typeParameters = null;
            return this.finishNode(node, "FunctionTypeAnnotation");
          }
          return param;
        }
        flowParseIntersectionType() {
          const node = this.startNode();
          this.eat(45);
          const type = this.flowParseAnonFunctionWithoutParens();
          node.types = [type];
          while (this.eat(45)) {
            node.types.push(this.flowParseAnonFunctionWithoutParens());
          }
          return node.types.length === 1 ? type : this.finishNode(node, "IntersectionTypeAnnotation");
        }
        flowParseUnionType() {
          const node = this.startNode();
          this.eat(43);
          const type = this.flowParseIntersectionType();
          node.types = [type];
          while (this.eat(43)) {
            node.types.push(this.flowParseIntersectionType());
          }
          return node.types.length === 1 ? type : this.finishNode(node, "UnionTypeAnnotation");
        }
        flowParseType() {
          const oldInType = this.state.inType;
          this.state.inType = true;
          const type = this.flowParseUnionType();
          this.state.inType = oldInType;
          return type;
        }
        flowParseTypeOrImplicitInstantiation() {
          if (this.state.type === 132 && this.state.value === "_") {
            const startLoc = this.state.startLoc;
            const node = this.parseIdentifier();
            return this.flowParseGenericType(startLoc, node);
          } else {
            return this.flowParseType();
          }
        }
        flowParseTypeAnnotation() {
          const node = this.startNode();
          node.typeAnnotation = this.flowParseTypeInitialiser();
          return this.finishNode(node, "TypeAnnotation");
        }
        flowParseTypeAnnotatableIdentifier(allowPrimitiveOverride) {
          const ident = allowPrimitiveOverride ? this.parseIdentifier() : this.flowParseRestrictedIdentifier();
          if (this.match(14)) {
            ident.typeAnnotation = this.flowParseTypeAnnotation();
            this.resetEndLocation(ident);
          }
          return ident;
        }
        typeCastToParameter(node) {
          node.expression.typeAnnotation = node.typeAnnotation;
          this.resetEndLocation(node.expression, node.typeAnnotation.loc.end);
          return node.expression;
        }
        flowParseVariance() {
          let variance = null;
          if (this.match(53)) {
            variance = this.startNode();
            if (this.state.value === "+") {
              variance.kind = "plus";
            } else {
              variance.kind = "minus";
            }
            this.next();
            return this.finishNode(variance, "Variance");
          }
          return variance;
        }
        parseFunctionBody(node, allowExpressionBody, isMethod = false) {
          if (allowExpressionBody) {
            this.forwardNoArrowParamsConversionAt(node, () => super.parseFunctionBody(node, true, isMethod));
            return;
          }
          super.parseFunctionBody(node, false, isMethod);
        }
        parseFunctionBodyAndFinish(node, type, isMethod = false) {
          if (this.match(14)) {
            const typeNode = this.startNode();
            [typeNode.typeAnnotation, node.predicate] = this.flowParseTypeAndPredicateInitialiser();
            node.returnType = typeNode.typeAnnotation ? this.finishNode(typeNode, "TypeAnnotation") : null;
          }
          return super.parseFunctionBodyAndFinish(node, type, isMethod);
        }
        parseStatementLike(flags) {
          if (this.state.strict && this.isContextual(129)) {
            const lookahead = this.lookahead();
            if (tokenIsKeywordOrIdentifier(lookahead.type)) {
              const node = this.startNode();
              this.next();
              return this.flowParseInterface(node);
            }
          } else if (this.isContextual(126)) {
            const node = this.startNode();
            this.next();
            return this.flowParseEnumDeclaration(node);
          }
          const stmt = super.parseStatementLike(flags);
          if (this.flowPragma === void 0 && !this.isValidDirective(stmt)) {
            this.flowPragma = null;
          }
          return stmt;
        }
        parseExpressionStatement(node, expr, decorators) {
          if (expr.type === "Identifier") {
            if (expr.name === "declare") {
              if (this.match(80) || tokenIsIdentifier(this.state.type) || this.match(68) || this.match(74) || this.match(82)) {
                return this.flowParseDeclare(node);
              }
            } else if (tokenIsIdentifier(this.state.type)) {
              if (expr.name === "interface") {
                return this.flowParseInterface(node);
              } else if (expr.name === "type") {
                return this.flowParseTypeAlias(node);
              } else if (expr.name === "opaque") {
                return this.flowParseOpaqueType(node, false);
              }
            }
          }
          return super.parseExpressionStatement(node, expr, decorators);
        }
        shouldParseExportDeclaration() {
          const {
            type
          } = this.state;
          if (type === 126 || tokenIsFlowInterfaceOrTypeOrOpaque(type)) {
            return !this.state.containsEsc;
          }
          return super.shouldParseExportDeclaration();
        }
        isExportDefaultSpecifier() {
          const {
            type
          } = this.state;
          if (type === 126 || tokenIsFlowInterfaceOrTypeOrOpaque(type)) {
            return this.state.containsEsc;
          }
          return super.isExportDefaultSpecifier();
        }
        parseExportDefaultExpression() {
          if (this.isContextual(126)) {
            const node = this.startNode();
            this.next();
            return this.flowParseEnumDeclaration(node);
          }
          return super.parseExportDefaultExpression();
        }
        parseConditional(expr, startLoc, refExpressionErrors) {
          if (!this.match(17)) return expr;
          if (this.state.maybeInArrowParameters) {
            const nextCh = this.lookaheadCharCode();
            if (nextCh === 44 || nextCh === 61 || nextCh === 58 || nextCh === 41) {
              this.setOptionalParametersError(refExpressionErrors);
              return expr;
            }
          }
          this.expect(17);
          const state = this.state.clone();
          const originalNoArrowAt = this.state.noArrowAt;
          const node = this.startNodeAt(startLoc);
          let {
            consequent,
            failed
          } = this.tryParseConditionalConsequent();
          let [valid, invalid] = this.getArrowLikeExpressions(consequent);
          if (failed || invalid.length > 0) {
            const noArrowAt = [...originalNoArrowAt];
            if (invalid.length > 0) {
              this.state = state;
              this.state.noArrowAt = noArrowAt;
              for (let i = 0; i < invalid.length; i++) {
                noArrowAt.push(invalid[i].start);
              }
              ({
                consequent,
                failed
              } = this.tryParseConditionalConsequent());
              [valid, invalid] = this.getArrowLikeExpressions(consequent);
            }
            if (failed && valid.length > 1) {
              this.raise(FlowErrors.AmbiguousConditionalArrow, state.startLoc);
            }
            if (failed && valid.length === 1) {
              this.state = state;
              noArrowAt.push(valid[0].start);
              this.state.noArrowAt = noArrowAt;
              ({
                consequent,
                failed
              } = this.tryParseConditionalConsequent());
            }
          }
          this.getArrowLikeExpressions(consequent, true);
          this.state.noArrowAt = originalNoArrowAt;
          this.expect(14);
          node.test = expr;
          node.consequent = consequent;
          node.alternate = this.forwardNoArrowParamsConversionAt(node, () => this.parseMaybeAssign(void 0, void 0));
          return this.finishNode(node, "ConditionalExpression");
        }
        tryParseConditionalConsequent() {
          this.state.noArrowParamsConversionAt.push(this.state.start);
          const consequent = this.parseMaybeAssignAllowIn();
          const failed = !this.match(14);
          this.state.noArrowParamsConversionAt.pop();
          return {
            consequent,
            failed
          };
        }
        getArrowLikeExpressions(node, disallowInvalid) {
          const stack = [node];
          const arrows = [];
          while (stack.length !== 0) {
            const node2 = stack.pop();
            if (node2.type === "ArrowFunctionExpression" && node2.body.type !== "BlockStatement") {
              if (node2.typeParameters || !node2.returnType) {
                this.finishArrowValidation(node2);
              } else {
                arrows.push(node2);
              }
              stack.push(node2.body);
            } else if (node2.type === "ConditionalExpression") {
              stack.push(node2.consequent);
              stack.push(node2.alternate);
            }
          }
          if (disallowInvalid) {
            arrows.forEach((node2) => this.finishArrowValidation(node2));
            return [arrows, []];
          }
          return partition(arrows, (node2) => node2.params.every((param) => this.isAssignable(param, true)));
        }
        finishArrowValidation(node) {
          var _node$extra;
          this.toAssignableList(node.params, (_node$extra = node.extra) == null ? void 0 : _node$extra.trailingCommaLoc, false);
          this.scope.enter(514 | 4);
          super.checkParams(node, false, true);
          this.scope.exit();
        }
        forwardNoArrowParamsConversionAt(node, parse3) {
          let result;
          if (this.state.noArrowParamsConversionAt.includes(this.offsetToSourcePos(node.start))) {
            this.state.noArrowParamsConversionAt.push(this.state.start);
            result = parse3();
            this.state.noArrowParamsConversionAt.pop();
          } else {
            result = parse3();
          }
          return result;
        }
        parseParenItem(node, startLoc) {
          const newNode = super.parseParenItem(node, startLoc);
          if (this.eat(17)) {
            newNode.optional = true;
            this.resetEndLocation(node);
          }
          if (this.match(14)) {
            const typeCastNode = this.startNodeAt(startLoc);
            typeCastNode.expression = newNode;
            typeCastNode.typeAnnotation = this.flowParseTypeAnnotation();
            return this.finishNode(typeCastNode, "TypeCastExpression");
          }
          return newNode;
        }
        assertModuleNodeAllowed(node) {
          if (node.type === "ImportDeclaration" && (node.importKind === "type" || node.importKind === "typeof") || node.type === "ExportNamedDeclaration" && node.exportKind === "type" || node.type === "ExportAllDeclaration" && node.exportKind === "type") {
            return;
          }
          super.assertModuleNodeAllowed(node);
        }
        parseExportDeclaration(node) {
          if (this.isContextual(130)) {
            node.exportKind = "type";
            const declarationNode = this.startNode();
            this.next();
            if (this.match(5)) {
              node.specifiers = this.parseExportSpecifiers(true);
              super.parseExportFrom(node);
              return null;
            } else {
              return this.flowParseTypeAlias(declarationNode);
            }
          } else if (this.isContextual(131)) {
            node.exportKind = "type";
            const declarationNode = this.startNode();
            this.next();
            return this.flowParseOpaqueType(declarationNode, false);
          } else if (this.isContextual(129)) {
            node.exportKind = "type";
            const declarationNode = this.startNode();
            this.next();
            return this.flowParseInterface(declarationNode);
          } else if (this.isContextual(126)) {
            node.exportKind = "value";
            const declarationNode = this.startNode();
            this.next();
            return this.flowParseEnumDeclaration(declarationNode);
          } else {
            return super.parseExportDeclaration(node);
          }
        }
        eatExportStar(node) {
          if (super.eatExportStar(node)) return true;
          if (this.isContextual(130) && this.lookahead().type === 55) {
            node.exportKind = "type";
            this.next();
            this.next();
            return true;
          }
          return false;
        }
        maybeParseExportNamespaceSpecifier(node) {
          const {
            startLoc
          } = this.state;
          const hasNamespace = super.maybeParseExportNamespaceSpecifier(node);
          if (hasNamespace && node.exportKind === "type") {
            this.unexpected(startLoc);
          }
          return hasNamespace;
        }
        parseClassId(node, isStatement, optionalId) {
          super.parseClassId(node, isStatement, optionalId);
          if (this.match(47)) {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
          }
        }
        parseClassMember(classBody, member, state) {
          const {
            startLoc
          } = this.state;
          if (this.isContextual(125)) {
            if (super.parseClassMemberFromModifier(classBody, member)) {
              return;
            }
            member.declare = true;
          }
          super.parseClassMember(classBody, member, state);
          if (member.declare) {
            if (member.type !== "ClassProperty" && member.type !== "ClassPrivateProperty" && member.type !== "PropertyDefinition") {
              this.raise(FlowErrors.DeclareClassElement, startLoc);
            } else if (member.value) {
              this.raise(FlowErrors.DeclareClassFieldInitializer, member.value);
            }
          }
        }
        isIterator(word) {
          return word === "iterator" || word === "asyncIterator";
        }
        readIterator() {
          const word = super.readWord1();
          const fullWord = "@@" + word;
          if (!this.isIterator(word) || !this.state.inType) {
            this.raise(Errors.InvalidIdentifier, this.state.curPosition(), {
              identifierName: fullWord
            });
          }
          this.finishToken(132, fullWord);
        }
        getTokenFromCode(code2) {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (code2 === 123 && next === 124) {
            this.finishOp(6, 2);
          } else if (this.state.inType && (code2 === 62 || code2 === 60)) {
            this.finishOp(code2 === 62 ? 48 : 47, 1);
          } else if (this.state.inType && code2 === 63) {
            if (next === 46) {
              this.finishOp(18, 2);
            } else {
              this.finishOp(17, 1);
            }
          } else if (isIteratorStart(code2, next, this.input.charCodeAt(this.state.pos + 2))) {
            this.state.pos += 2;
            this.readIterator();
          } else {
            super.getTokenFromCode(code2);
          }
        }
        isAssignable(node, isBinding) {
          if (node.type === "TypeCastExpression") {
            return this.isAssignable(node.expression, isBinding);
          } else {
            return super.isAssignable(node, isBinding);
          }
        }
        toAssignable(node, isLHS = false) {
          if (!isLHS && node.type === "AssignmentExpression" && node.left.type === "TypeCastExpression") {
            node.left = this.typeCastToParameter(node.left);
          }
          super.toAssignable(node, isLHS);
        }
        toAssignableList(exprList, trailingCommaLoc, isLHS) {
          for (let i = 0; i < exprList.length; i++) {
            const expr = exprList[i];
            if ((expr == null ? void 0 : expr.type) === "TypeCastExpression") {
              exprList[i] = this.typeCastToParameter(expr);
            }
          }
          super.toAssignableList(exprList, trailingCommaLoc, isLHS);
        }
        toReferencedList(exprList, isParenthesizedExpr) {
          for (let i = 0; i < exprList.length; i++) {
            var _expr$extra;
            const expr = exprList[i];
            if (expr && expr.type === "TypeCastExpression" && !((_expr$extra = expr.extra) != null && _expr$extra.parenthesized) && (exprList.length > 1 || !isParenthesizedExpr)) {
              this.raise(FlowErrors.TypeCastInPattern, expr.typeAnnotation);
            }
          }
          return exprList;
        }
        parseArrayLike(close, isTuple, refExpressionErrors) {
          const node = super.parseArrayLike(close, isTuple, refExpressionErrors);
          if (refExpressionErrors != null && !this.state.maybeInArrowParameters) {
            this.toReferencedList(node.elements);
          }
          return node;
        }
        isValidLVal(type, disallowCallExpression, isParenthesized, binding) {
          return type === "TypeCastExpression" || super.isValidLVal(type, disallowCallExpression, isParenthesized, binding);
        }
        parseClassProperty(node) {
          if (this.match(14)) {
            node.typeAnnotation = this.flowParseTypeAnnotation();
          }
          return super.parseClassProperty(node);
        }
        parseClassPrivateProperty(node) {
          if (this.match(14)) {
            node.typeAnnotation = this.flowParseTypeAnnotation();
          }
          return super.parseClassPrivateProperty(node);
        }
        isClassMethod() {
          return this.match(47) || super.isClassMethod();
        }
        isClassProperty() {
          return this.match(14) || super.isClassProperty();
        }
        isNonstaticConstructor(method) {
          return !this.match(14) && super.isNonstaticConstructor(method);
        }
        pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper) {
          if (method.variance) {
            this.unexpected(method.variance.loc.start);
          }
          delete method.variance;
          if (this.match(47)) {
            method.typeParameters = this.flowParseTypeParameterDeclaration();
          }
          super.pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper);
          if (method.params && isConstructor) {
            const params = method.params;
            if (params.length > 0 && this.isThisParam(params[0])) {
              this.raise(FlowErrors.ThisParamBannedInConstructor, method);
            }
          } else if (method.type === "MethodDefinition" && isConstructor && method.value.params) {
            const params = method.value.params;
            if (params.length > 0 && this.isThisParam(params[0])) {
              this.raise(FlowErrors.ThisParamBannedInConstructor, method);
            }
          }
        }
        pushClassPrivateMethod(classBody, method, isGenerator, isAsync) {
          if (method.variance) {
            this.unexpected(method.variance.loc.start);
          }
          delete method.variance;
          if (this.match(47)) {
            method.typeParameters = this.flowParseTypeParameterDeclaration();
          }
          super.pushClassPrivateMethod(classBody, method, isGenerator, isAsync);
        }
        parseClassSuper(node) {
          super.parseClassSuper(node);
          if (node.superClass && (this.match(47) || this.match(51))) {
            node.superTypeParameters = this.flowParseTypeParameterInstantiationInExpression();
          }
          if (this.isContextual(113)) {
            this.next();
            const implemented = node.implements = [];
            do {
              const node2 = this.startNode();
              node2.id = this.flowParseRestrictedIdentifier(true);
              if (this.match(47)) {
                node2.typeParameters = this.flowParseTypeParameterInstantiation();
              } else {
                node2.typeParameters = null;
              }
              implemented.push(this.finishNode(node2, "ClassImplements"));
            } while (this.eat(12));
          }
        }
        checkGetterSetterParams(method) {
          super.checkGetterSetterParams(method);
          const params = this.getObjectOrClassMethodParams(method);
          if (params.length > 0) {
            const param = params[0];
            if (this.isThisParam(param) && method.kind === "get") {
              this.raise(FlowErrors.GetterMayNotHaveThisParam, param);
            } else if (this.isThisParam(param)) {
              this.raise(FlowErrors.SetterMayNotHaveThisParam, param);
            }
          }
        }
        parsePropertyNamePrefixOperator(node) {
          node.variance = this.flowParseVariance();
        }
        parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors) {
          if (prop.variance) {
            this.unexpected(prop.variance.loc.start);
          }
          delete prop.variance;
          let typeParameters;
          if (this.match(47) && !isAccessor) {
            typeParameters = this.flowParseTypeParameterDeclaration();
            if (!this.match(10)) this.unexpected();
          }
          const result = super.parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors);
          if (typeParameters) {
            (result.value || result).typeParameters = typeParameters;
          }
          return result;
        }
        parseFunctionParamType(param) {
          if (this.eat(17)) {
            if (param.type !== "Identifier") {
              this.raise(FlowErrors.PatternIsOptional, param);
            }
            if (this.isThisParam(param)) {
              this.raise(FlowErrors.ThisParamMayNotBeOptional, param);
            }
            param.optional = true;
          }
          if (this.match(14)) {
            param.typeAnnotation = this.flowParseTypeAnnotation();
          } else if (this.isThisParam(param)) {
            this.raise(FlowErrors.ThisParamAnnotationRequired, param);
          }
          if (this.match(29) && this.isThisParam(param)) {
            this.raise(FlowErrors.ThisParamNoDefault, param);
          }
          this.resetEndLocation(param);
          return param;
        }
        parseMaybeDefault(startLoc, left) {
          const node = super.parseMaybeDefault(startLoc, left);
          if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
            this.raise(FlowErrors.TypeBeforeInitializer, node.typeAnnotation);
          }
          return node;
        }
        checkImportReflection(node) {
          super.checkImportReflection(node);
          if (node.module && node.importKind !== "value") {
            this.raise(FlowErrors.ImportReflectionHasImportType, node.specifiers[0].loc.start);
          }
        }
        parseImportSpecifierLocal(node, specifier, type) {
          specifier.local = hasTypeImportKind(node) ? this.flowParseRestrictedIdentifier(true, true) : this.parseIdentifier();
          node.specifiers.push(this.finishImportSpecifier(specifier, type));
        }
        isPotentialImportPhase(isExport) {
          if (super.isPotentialImportPhase(isExport)) return true;
          if (this.isContextual(130)) {
            if (!isExport) return true;
            const ch = this.lookaheadCharCode();
            return ch === 123 || ch === 42;
          }
          return !isExport && this.isContextual(87);
        }
        applyImportPhase(node, isExport, phase, loc) {
          super.applyImportPhase(node, isExport, phase, loc);
          if (isExport) {
            if (!phase && this.match(65)) {
              return;
            }
            node.exportKind = phase === "type" ? phase : "value";
          } else {
            if (phase === "type" && this.match(55)) this.unexpected();
            node.importKind = phase === "type" || phase === "typeof" ? phase : "value";
          }
        }
        parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly, bindingType) {
          const firstIdent = specifier.imported;
          let specifierTypeKind = null;
          if (firstIdent.type === "Identifier") {
            if (firstIdent.name === "type") {
              specifierTypeKind = "type";
            } else if (firstIdent.name === "typeof") {
              specifierTypeKind = "typeof";
            }
          }
          let isBinding = false;
          if (this.isContextual(93) && !this.isLookaheadContextual("as")) {
            const as_ident = this.parseIdentifier(true);
            if (specifierTypeKind !== null && !tokenIsKeywordOrIdentifier(this.state.type)) {
              specifier.imported = as_ident;
              specifier.importKind = specifierTypeKind;
              specifier.local = this.cloneIdentifier(as_ident);
            } else {
              specifier.imported = firstIdent;
              specifier.importKind = null;
              specifier.local = this.parseIdentifier();
            }
          } else {
            if (specifierTypeKind !== null && tokenIsKeywordOrIdentifier(this.state.type)) {
              specifier.imported = this.parseIdentifier(true);
              specifier.importKind = specifierTypeKind;
            } else {
              if (importedIsString) {
                throw this.raise(Errors.ImportBindingIsString, specifier, {
                  importName: firstIdent.value
                });
              }
              specifier.imported = firstIdent;
              specifier.importKind = null;
            }
            if (this.eatContextual(93)) {
              specifier.local = this.parseIdentifier();
            } else {
              isBinding = true;
              specifier.local = this.cloneIdentifier(specifier.imported);
            }
          }
          const specifierIsTypeImport = hasTypeImportKind(specifier);
          if (isInTypeOnlyImport && specifierIsTypeImport) {
            this.raise(FlowErrors.ImportTypeShorthandOnlyInPureImport, specifier);
          }
          if (isInTypeOnlyImport || specifierIsTypeImport) {
            this.checkReservedType(specifier.local.name, specifier.local.loc.start, true);
          }
          if (isBinding && !isInTypeOnlyImport && !specifierIsTypeImport) {
            this.checkReservedWord(specifier.local.name, specifier.loc.start, true, true);
          }
          return this.finishImportSpecifier(specifier, "ImportSpecifier");
        }
        parseBindingAtom() {
          switch (this.state.type) {
            case 78:
              return this.parseIdentifier(true);
            default:
              return super.parseBindingAtom();
          }
        }
        parseFunctionParams(node, isConstructor) {
          const kind = node.kind;
          if (kind !== "get" && kind !== "set" && this.match(47)) {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
          }
          super.parseFunctionParams(node, isConstructor);
        }
        parseVarId(decl, kind) {
          super.parseVarId(decl, kind);
          if (this.match(14)) {
            decl.id.typeAnnotation = this.flowParseTypeAnnotation();
            this.resetEndLocation(decl.id);
          }
        }
        parseAsyncArrowFromCallExpression(node, call) {
          if (this.match(14)) {
            const oldNoAnonFunctionType = this.state.noAnonFunctionType;
            this.state.noAnonFunctionType = true;
            node.returnType = this.flowParseTypeAnnotation();
            this.state.noAnonFunctionType = oldNoAnonFunctionType;
          }
          return super.parseAsyncArrowFromCallExpression(node, call);
        }
        shouldParseAsyncArrow() {
          return this.match(14) || super.shouldParseAsyncArrow();
        }
        parseMaybeAssign(refExpressionErrors, afterLeftParse) {
          var _jsx;
          let state = null;
          let jsx2;
          if (this.hasPlugin("jsx") && (this.match(143) || this.match(47))) {
            state = this.state.clone();
            jsx2 = this.tryParse(() => super.parseMaybeAssign(refExpressionErrors, afterLeftParse), state);
            if (!jsx2.error) return jsx2.node;
            const {
              context
            } = this.state;
            const currentContext = context[context.length - 1];
            if (currentContext === types.j_oTag || currentContext === types.j_expr) {
              context.pop();
            }
          }
          if ((_jsx = jsx2) != null && _jsx.error || this.match(47)) {
            var _jsx2, _jsx3;
            state = state || this.state.clone();
            let typeParameters;
            const arrow = this.tryParse((abort) => {
              var _arrowExpression$extr;
              typeParameters = this.flowParseTypeParameterDeclaration();
              const arrowExpression2 = this.forwardNoArrowParamsConversionAt(typeParameters, () => {
                const result = super.parseMaybeAssign(refExpressionErrors, afterLeftParse);
                this.resetStartLocationFromNode(result, typeParameters);
                return result;
              });
              if ((_arrowExpression$extr = arrowExpression2.extra) != null && _arrowExpression$extr.parenthesized) abort();
              const expr = this.maybeUnwrapTypeCastExpression(arrowExpression2);
              if (expr.type !== "ArrowFunctionExpression") abort();
              expr.typeParameters = typeParameters;
              this.resetStartLocationFromNode(expr, typeParameters);
              return arrowExpression2;
            }, state);
            let arrowExpression = null;
            if (arrow.node && this.maybeUnwrapTypeCastExpression(arrow.node).type === "ArrowFunctionExpression") {
              if (!arrow.error && !arrow.aborted) {
                if (arrow.node.async) {
                  this.raise(FlowErrors.UnexpectedTypeParameterBeforeAsyncArrowFunction, typeParameters);
                }
                return arrow.node;
              }
              arrowExpression = arrow.node;
            }
            if ((_jsx2 = jsx2) != null && _jsx2.node) {
              this.state = jsx2.failState;
              return jsx2.node;
            }
            if (arrowExpression) {
              this.state = arrow.failState;
              return arrowExpression;
            }
            if ((_jsx3 = jsx2) != null && _jsx3.thrown) throw jsx2.error;
            if (arrow.thrown) throw arrow.error;
            throw this.raise(FlowErrors.UnexpectedTokenAfterTypeParameter, typeParameters);
          }
          return super.parseMaybeAssign(refExpressionErrors, afterLeftParse);
        }
        parseArrow(node) {
          if (this.match(14)) {
            const result = this.tryParse(() => {
              const oldNoAnonFunctionType = this.state.noAnonFunctionType;
              this.state.noAnonFunctionType = true;
              const typeNode = this.startNode();
              [typeNode.typeAnnotation, node.predicate] = this.flowParseTypeAndPredicateInitialiser();
              this.state.noAnonFunctionType = oldNoAnonFunctionType;
              if (this.canInsertSemicolon()) this.unexpected();
              if (!this.match(19)) this.unexpected();
              return typeNode;
            });
            if (result.thrown) return null;
            if (result.error) this.state = result.failState;
            node.returnType = result.node.typeAnnotation ? this.finishNode(result.node, "TypeAnnotation") : null;
          }
          return super.parseArrow(node);
        }
        shouldParseArrow(params) {
          return this.match(14) || super.shouldParseArrow(params);
        }
        setArrowFunctionParameters(node, params) {
          if (this.state.noArrowParamsConversionAt.includes(this.offsetToSourcePos(node.start))) {
            node.params = params;
          } else {
            super.setArrowFunctionParameters(node, params);
          }
        }
        checkParams(node, allowDuplicates, isArrowFunction, strictModeChanged = true) {
          if (isArrowFunction && this.state.noArrowParamsConversionAt.includes(this.offsetToSourcePos(node.start))) {
            return;
          }
          for (let i = 0; i < node.params.length; i++) {
            if (this.isThisParam(node.params[i]) && i > 0) {
              this.raise(FlowErrors.ThisParamMustBeFirst, node.params[i]);
            }
          }
          super.checkParams(node, allowDuplicates, isArrowFunction, strictModeChanged);
        }
        parseParenAndDistinguishExpression(canBeArrow) {
          return super.parseParenAndDistinguishExpression(canBeArrow && !this.state.noArrowAt.includes(this.sourceToOffsetPos(this.state.start)));
        }
        parseSubscripts(base, startLoc, noCalls) {
          if (base.type === "Identifier" && base.name === "async" && this.state.noArrowAt.includes(startLoc.index)) {
            this.next();
            const node = this.startNodeAt(startLoc);
            node.callee = base;
            node.arguments = super.parseCallExpressionArguments();
            base = this.finishNode(node, "CallExpression");
          } else if (base.type === "Identifier" && base.name === "async" && this.match(47)) {
            const state = this.state.clone();
            const arrow = this.tryParse((abort) => this.parseAsyncArrowWithTypeParameters(startLoc) || abort(), state);
            if (!arrow.error && !arrow.aborted) return arrow.node;
            const result = this.tryParse(() => super.parseSubscripts(base, startLoc, noCalls), state);
            if (result.node && !result.error) return result.node;
            if (arrow.node) {
              this.state = arrow.failState;
              return arrow.node;
            }
            if (result.node) {
              this.state = result.failState;
              return result.node;
            }
            throw arrow.error || result.error;
          }
          return super.parseSubscripts(base, startLoc, noCalls);
        }
        parseSubscript(base, startLoc, noCalls, subscriptState) {
          if (this.match(18) && this.isLookaheadToken_lt()) {
            subscriptState.optionalChainMember = true;
            if (noCalls) {
              subscriptState.stop = true;
              return base;
            }
            this.next();
            const node = this.startNodeAt(startLoc);
            node.callee = base;
            node.typeArguments = this.flowParseTypeParameterInstantiationInExpression();
            this.expect(10);
            node.arguments = this.parseCallExpressionArguments();
            node.optional = true;
            return this.finishCallExpression(node, true);
          } else if (!noCalls && this.shouldParseTypes() && (this.match(47) || this.match(51))) {
            const node = this.startNodeAt(startLoc);
            node.callee = base;
            const result = this.tryParse(() => {
              node.typeArguments = this.flowParseTypeParameterInstantiationCallOrNew();
              this.expect(10);
              node.arguments = super.parseCallExpressionArguments();
              if (subscriptState.optionalChainMember) {
                node.optional = false;
              }
              return this.finishCallExpression(node, subscriptState.optionalChainMember);
            });
            if (result.node) {
              if (result.error) this.state = result.failState;
              return result.node;
            }
          }
          return super.parseSubscript(base, startLoc, noCalls, subscriptState);
        }
        parseNewCallee(node) {
          super.parseNewCallee(node);
          let targs = null;
          if (this.shouldParseTypes() && this.match(47)) {
            targs = this.tryParse(() => this.flowParseTypeParameterInstantiationCallOrNew()).node;
          }
          node.typeArguments = targs;
        }
        parseAsyncArrowWithTypeParameters(startLoc) {
          const node = this.startNodeAt(startLoc);
          this.parseFunctionParams(node, false);
          if (!this.parseArrow(node)) return;
          return super.parseArrowExpression(node, void 0, true);
        }
        readToken_mult_modulo(code2) {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (code2 === 42 && next === 47 && this.state.hasFlowComment) {
            this.state.hasFlowComment = false;
            this.state.pos += 2;
            this.nextToken();
            return;
          }
          super.readToken_mult_modulo(code2);
        }
        readToken_pipe_amp(code2) {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (code2 === 124 && next === 125) {
            this.finishOp(9, 2);
            return;
          }
          super.readToken_pipe_amp(code2);
        }
        parseTopLevel(file, program) {
          const fileNode = super.parseTopLevel(file, program);
          if (this.state.hasFlowComment) {
            this.raise(FlowErrors.UnterminatedFlowComment, this.state.curPosition());
          }
          return fileNode;
        }
        skipBlockComment() {
          if (this.hasPlugin("flowComments") && this.skipFlowComment()) {
            if (this.state.hasFlowComment) {
              throw this.raise(FlowErrors.NestedFlowComment, this.state.startLoc);
            }
            this.hasFlowCommentCompletion();
            const commentSkip = this.skipFlowComment();
            if (commentSkip) {
              this.state.pos += commentSkip;
              this.state.hasFlowComment = true;
            }
            return;
          }
          return super.skipBlockComment(this.state.hasFlowComment ? "*-/" : "*/");
        }
        skipFlowComment() {
          const {
            pos
          } = this.state;
          let shiftToFirstNonWhiteSpace = 2;
          while ([32, 9].includes(this.input.charCodeAt(pos + shiftToFirstNonWhiteSpace))) {
            shiftToFirstNonWhiteSpace++;
          }
          const ch2 = this.input.charCodeAt(shiftToFirstNonWhiteSpace + pos);
          const ch3 = this.input.charCodeAt(shiftToFirstNonWhiteSpace + pos + 1);
          if (ch2 === 58 && ch3 === 58) {
            return shiftToFirstNonWhiteSpace + 2;
          }
          if (this.input.slice(shiftToFirstNonWhiteSpace + pos, shiftToFirstNonWhiteSpace + pos + 12) === "flow-include") {
            return shiftToFirstNonWhiteSpace + 12;
          }
          if (ch2 === 58 && ch3 !== 58) {
            return shiftToFirstNonWhiteSpace;
          }
          return false;
        }
        hasFlowCommentCompletion() {
          const end = this.input.indexOf("*/", this.state.pos);
          if (end === -1) {
            throw this.raise(Errors.UnterminatedComment, this.state.curPosition());
          }
        }
        flowEnumErrorBooleanMemberNotInitialized(loc, {
          enumName,
          memberName
        }) {
          this.raise(FlowErrors.EnumBooleanMemberNotInitialized, loc, {
            memberName,
            enumName
          });
        }
        flowEnumErrorInvalidMemberInitializer(loc, enumContext) {
          return this.raise(!enumContext.explicitType ? FlowErrors.EnumInvalidMemberInitializerUnknownType : enumContext.explicitType === "symbol" ? FlowErrors.EnumInvalidMemberInitializerSymbolType : FlowErrors.EnumInvalidMemberInitializerPrimaryType, loc, enumContext);
        }
        flowEnumErrorNumberMemberNotInitialized(loc, details) {
          this.raise(FlowErrors.EnumNumberMemberNotInitialized, loc, details);
        }
        flowEnumErrorStringMemberInconsistentlyInitialized(node, details) {
          this.raise(FlowErrors.EnumStringMemberInconsistentlyInitialized, node, details);
        }
        flowEnumMemberInit() {
          const startLoc = this.state.startLoc;
          const endOfInit = () => this.match(12) || this.match(8);
          switch (this.state.type) {
            case 135: {
              const literal = this.parseNumericLiteral(this.state.value);
              if (endOfInit()) {
                return {
                  type: "number",
                  loc: literal.loc.start,
                  value: literal
                };
              }
              return {
                type: "invalid",
                loc: startLoc
              };
            }
            case 134: {
              const literal = this.parseStringLiteral(this.state.value);
              if (endOfInit()) {
                return {
                  type: "string",
                  loc: literal.loc.start,
                  value: literal
                };
              }
              return {
                type: "invalid",
                loc: startLoc
              };
            }
            case 85:
            case 86: {
              const literal = this.parseBooleanLiteral(this.match(85));
              if (endOfInit()) {
                return {
                  type: "boolean",
                  loc: literal.loc.start,
                  value: literal
                };
              }
              return {
                type: "invalid",
                loc: startLoc
              };
            }
            default:
              return {
                type: "invalid",
                loc: startLoc
              };
          }
        }
        flowEnumMemberRaw() {
          const loc = this.state.startLoc;
          const id = this.parseIdentifier(true);
          const init = this.eat(29) ? this.flowEnumMemberInit() : {
            type: "none",
            loc
          };
          return {
            id,
            init
          };
        }
        flowEnumCheckExplicitTypeMismatch(loc, context, expectedType) {
          const {
            explicitType
          } = context;
          if (explicitType === null) {
            return;
          }
          if (explicitType !== expectedType) {
            this.flowEnumErrorInvalidMemberInitializer(loc, context);
          }
        }
        flowEnumMembers({
          enumName,
          explicitType
        }) {
          const seenNames = /* @__PURE__ */ new Set();
          const members = {
            booleanMembers: [],
            numberMembers: [],
            stringMembers: [],
            defaultedMembers: []
          };
          let hasUnknownMembers = false;
          while (!this.match(8)) {
            if (this.eat(21)) {
              hasUnknownMembers = true;
              break;
            }
            const memberNode = this.startNode();
            const {
              id,
              init
            } = this.flowEnumMemberRaw();
            const memberName = id.name;
            if (memberName === "") {
              continue;
            }
            if (/^[a-z]/.test(memberName)) {
              this.raise(FlowErrors.EnumInvalidMemberName, id, {
                memberName,
                suggestion: memberName[0].toUpperCase() + memberName.slice(1),
                enumName
              });
            }
            if (seenNames.has(memberName)) {
              this.raise(FlowErrors.EnumDuplicateMemberName, id, {
                memberName,
                enumName
              });
            }
            seenNames.add(memberName);
            const context = {
              enumName,
              explicitType,
              memberName
            };
            memberNode.id = id;
            switch (init.type) {
              case "boolean": {
                this.flowEnumCheckExplicitTypeMismatch(init.loc, context, "boolean");
                memberNode.init = init.value;
                members.booleanMembers.push(this.finishNode(memberNode, "EnumBooleanMember"));
                break;
              }
              case "number": {
                this.flowEnumCheckExplicitTypeMismatch(init.loc, context, "number");
                memberNode.init = init.value;
                members.numberMembers.push(this.finishNode(memberNode, "EnumNumberMember"));
                break;
              }
              case "string": {
                this.flowEnumCheckExplicitTypeMismatch(init.loc, context, "string");
                memberNode.init = init.value;
                members.stringMembers.push(this.finishNode(memberNode, "EnumStringMember"));
                break;
              }
              case "invalid": {
                throw this.flowEnumErrorInvalidMemberInitializer(init.loc, context);
              }
              case "none": {
                switch (explicitType) {
                  case "boolean":
                    this.flowEnumErrorBooleanMemberNotInitialized(init.loc, context);
                    break;
                  case "number":
                    this.flowEnumErrorNumberMemberNotInitialized(init.loc, context);
                    break;
                  default:
                    members.defaultedMembers.push(this.finishNode(memberNode, "EnumDefaultedMember"));
                }
              }
            }
            if (!this.match(8)) {
              this.expect(12);
            }
          }
          return {
            members,
            hasUnknownMembers
          };
        }
        flowEnumStringMembers(initializedMembers, defaultedMembers, {
          enumName
        }) {
          if (initializedMembers.length === 0) {
            return defaultedMembers;
          } else if (defaultedMembers.length === 0) {
            return initializedMembers;
          } else if (defaultedMembers.length > initializedMembers.length) {
            for (const member of initializedMembers) {
              this.flowEnumErrorStringMemberInconsistentlyInitialized(member, {
                enumName
              });
            }
            return defaultedMembers;
          } else {
            for (const member of defaultedMembers) {
              this.flowEnumErrorStringMemberInconsistentlyInitialized(member, {
                enumName
              });
            }
            return initializedMembers;
          }
        }
        flowEnumParseExplicitType({
          enumName
        }) {
          if (!this.eatContextual(102)) return null;
          if (!tokenIsIdentifier(this.state.type)) {
            throw this.raise(FlowErrors.EnumInvalidExplicitTypeUnknownSupplied, this.state.startLoc, {
              enumName
            });
          }
          const {
            value
          } = this.state;
          this.next();
          if (value !== "boolean" && value !== "number" && value !== "string" && value !== "symbol") {
            this.raise(FlowErrors.EnumInvalidExplicitType, this.state.startLoc, {
              enumName,
              invalidEnumType: value
            });
          }
          return value;
        }
        flowEnumBody(node, id) {
          const enumName = id.name;
          const nameLoc = id.loc.start;
          const explicitType = this.flowEnumParseExplicitType({
            enumName
          });
          this.expect(5);
          const {
            members,
            hasUnknownMembers
          } = this.flowEnumMembers({
            enumName,
            explicitType
          });
          node.hasUnknownMembers = hasUnknownMembers;
          switch (explicitType) {
            case "boolean":
              node.explicitType = true;
              node.members = members.booleanMembers;
              this.expect(8);
              return this.finishNode(node, "EnumBooleanBody");
            case "number":
              node.explicitType = true;
              node.members = members.numberMembers;
              this.expect(8);
              return this.finishNode(node, "EnumNumberBody");
            case "string":
              node.explicitType = true;
              node.members = this.flowEnumStringMembers(members.stringMembers, members.defaultedMembers, {
                enumName
              });
              this.expect(8);
              return this.finishNode(node, "EnumStringBody");
            case "symbol":
              node.members = members.defaultedMembers;
              this.expect(8);
              return this.finishNode(node, "EnumSymbolBody");
            default: {
              const empty = () => {
                node.members = [];
                this.expect(8);
                return this.finishNode(node, "EnumStringBody");
              };
              node.explicitType = false;
              const boolsLen = members.booleanMembers.length;
              const numsLen = members.numberMembers.length;
              const strsLen = members.stringMembers.length;
              const defaultedLen = members.defaultedMembers.length;
              if (!boolsLen && !numsLen && !strsLen && !defaultedLen) {
                return empty();
              } else if (!boolsLen && !numsLen) {
                node.members = this.flowEnumStringMembers(members.stringMembers, members.defaultedMembers, {
                  enumName
                });
                this.expect(8);
                return this.finishNode(node, "EnumStringBody");
              } else if (!numsLen && !strsLen && boolsLen >= defaultedLen) {
                for (const member of members.defaultedMembers) {
                  this.flowEnumErrorBooleanMemberNotInitialized(member.loc.start, {
                    enumName,
                    memberName: member.id.name
                  });
                }
                node.members = members.booleanMembers;
                this.expect(8);
                return this.finishNode(node, "EnumBooleanBody");
              } else if (!boolsLen && !strsLen && numsLen >= defaultedLen) {
                for (const member of members.defaultedMembers) {
                  this.flowEnumErrorNumberMemberNotInitialized(member.loc.start, {
                    enumName,
                    memberName: member.id.name
                  });
                }
                node.members = members.numberMembers;
                this.expect(8);
                return this.finishNode(node, "EnumNumberBody");
              } else {
                this.raise(FlowErrors.EnumInconsistentMemberValues, nameLoc, {
                  enumName
                });
                return empty();
              }
            }
          }
        }
        flowParseEnumDeclaration(node) {
          const id = this.parseIdentifier();
          node.id = id;
          node.body = this.flowEnumBody(this.startNode(), id);
          return this.finishNode(node, "EnumDeclaration");
        }
        jsxParseOpeningElementAfterName(node) {
          if (this.shouldParseTypes()) {
            if (this.match(47) || this.match(51)) {
              node.typeArguments = this.flowParseTypeParameterInstantiationInExpression();
            }
          }
          return super.jsxParseOpeningElementAfterName(node);
        }
        isLookaheadToken_lt() {
          const next = this.nextTokenStart();
          if (this.input.charCodeAt(next) === 60) {
            const afterNext = this.input.charCodeAt(next + 1);
            return afterNext !== 60 && afterNext !== 61;
          }
          return false;
        }
        reScan_lt_gt() {
          const {
            type
          } = this.state;
          if (type === 47) {
            this.state.pos -= 1;
            this.readToken_lt();
          } else if (type === 48) {
            this.state.pos -= 1;
            this.readToken_gt();
          }
        }
        reScan_lt() {
          const {
            type
          } = this.state;
          if (type === 51) {
            this.state.pos -= 2;
            this.finishOp(47, 1);
            return 47;
          }
          return type;
        }
        maybeUnwrapTypeCastExpression(node) {
          return node.type === "TypeCastExpression" ? node.expression : node;
        }
      };
      var entities = {
        __proto__: null,
        quot: '"',
        amp: "&",
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: "\xA0",
        iexcl: "\xA1",
        cent: "\xA2",
        pound: "\xA3",
        curren: "\xA4",
        yen: "\xA5",
        brvbar: "\xA6",
        sect: "\xA7",
        uml: "\xA8",
        copy: "\xA9",
        ordf: "\xAA",
        laquo: "\xAB",
        not: "\xAC",
        shy: "\xAD",
        reg: "\xAE",
        macr: "\xAF",
        deg: "\xB0",
        plusmn: "\xB1",
        sup2: "\xB2",
        sup3: "\xB3",
        acute: "\xB4",
        micro: "\xB5",
        para: "\xB6",
        middot: "\xB7",
        cedil: "\xB8",
        sup1: "\xB9",
        ordm: "\xBA",
        raquo: "\xBB",
        frac14: "\xBC",
        frac12: "\xBD",
        frac34: "\xBE",
        iquest: "\xBF",
        Agrave: "\xC0",
        Aacute: "\xC1",
        Acirc: "\xC2",
        Atilde: "\xC3",
        Auml: "\xC4",
        Aring: "\xC5",
        AElig: "\xC6",
        Ccedil: "\xC7",
        Egrave: "\xC8",
        Eacute: "\xC9",
        Ecirc: "\xCA",
        Euml: "\xCB",
        Igrave: "\xCC",
        Iacute: "\xCD",
        Icirc: "\xCE",
        Iuml: "\xCF",
        ETH: "\xD0",
        Ntilde: "\xD1",
        Ograve: "\xD2",
        Oacute: "\xD3",
        Ocirc: "\xD4",
        Otilde: "\xD5",
        Ouml: "\xD6",
        times: "\xD7",
        Oslash: "\xD8",
        Ugrave: "\xD9",
        Uacute: "\xDA",
        Ucirc: "\xDB",
        Uuml: "\xDC",
        Yacute: "\xDD",
        THORN: "\xDE",
        szlig: "\xDF",
        agrave: "\xE0",
        aacute: "\xE1",
        acirc: "\xE2",
        atilde: "\xE3",
        auml: "\xE4",
        aring: "\xE5",
        aelig: "\xE6",
        ccedil: "\xE7",
        egrave: "\xE8",
        eacute: "\xE9",
        ecirc: "\xEA",
        euml: "\xEB",
        igrave: "\xEC",
        iacute: "\xED",
        icirc: "\xEE",
        iuml: "\xEF",
        eth: "\xF0",
        ntilde: "\xF1",
        ograve: "\xF2",
        oacute: "\xF3",
        ocirc: "\xF4",
        otilde: "\xF5",
        ouml: "\xF6",
        divide: "\xF7",
        oslash: "\xF8",
        ugrave: "\xF9",
        uacute: "\xFA",
        ucirc: "\xFB",
        uuml: "\xFC",
        yacute: "\xFD",
        thorn: "\xFE",
        yuml: "\xFF",
        OElig: "\u0152",
        oelig: "\u0153",
        Scaron: "\u0160",
        scaron: "\u0161",
        Yuml: "\u0178",
        fnof: "\u0192",
        circ: "\u02C6",
        tilde: "\u02DC",
        Alpha: "\u0391",
        Beta: "\u0392",
        Gamma: "\u0393",
        Delta: "\u0394",
        Epsilon: "\u0395",
        Zeta: "\u0396",
        Eta: "\u0397",
        Theta: "\u0398",
        Iota: "\u0399",
        Kappa: "\u039A",
        Lambda: "\u039B",
        Mu: "\u039C",
        Nu: "\u039D",
        Xi: "\u039E",
        Omicron: "\u039F",
        Pi: "\u03A0",
        Rho: "\u03A1",
        Sigma: "\u03A3",
        Tau: "\u03A4",
        Upsilon: "\u03A5",
        Phi: "\u03A6",
        Chi: "\u03A7",
        Psi: "\u03A8",
        Omega: "\u03A9",
        alpha: "\u03B1",
        beta: "\u03B2",
        gamma: "\u03B3",
        delta: "\u03B4",
        epsilon: "\u03B5",
        zeta: "\u03B6",
        eta: "\u03B7",
        theta: "\u03B8",
        iota: "\u03B9",
        kappa: "\u03BA",
        lambda: "\u03BB",
        mu: "\u03BC",
        nu: "\u03BD",
        xi: "\u03BE",
        omicron: "\u03BF",
        pi: "\u03C0",
        rho: "\u03C1",
        sigmaf: "\u03C2",
        sigma: "\u03C3",
        tau: "\u03C4",
        upsilon: "\u03C5",
        phi: "\u03C6",
        chi: "\u03C7",
        psi: "\u03C8",
        omega: "\u03C9",
        thetasym: "\u03D1",
        upsih: "\u03D2",
        piv: "\u03D6",
        ensp: "\u2002",
        emsp: "\u2003",
        thinsp: "\u2009",
        zwnj: "\u200C",
        zwj: "\u200D",
        lrm: "\u200E",
        rlm: "\u200F",
        ndash: "\u2013",
        mdash: "\u2014",
        lsquo: "\u2018",
        rsquo: "\u2019",
        sbquo: "\u201A",
        ldquo: "\u201C",
        rdquo: "\u201D",
        bdquo: "\u201E",
        dagger: "\u2020",
        Dagger: "\u2021",
        bull: "\u2022",
        hellip: "\u2026",
        permil: "\u2030",
        prime: "\u2032",
        Prime: "\u2033",
        lsaquo: "\u2039",
        rsaquo: "\u203A",
        oline: "\u203E",
        frasl: "\u2044",
        euro: "\u20AC",
        image: "\u2111",
        weierp: "\u2118",
        real: "\u211C",
        trade: "\u2122",
        alefsym: "\u2135",
        larr: "\u2190",
        uarr: "\u2191",
        rarr: "\u2192",
        darr: "\u2193",
        harr: "\u2194",
        crarr: "\u21B5",
        lArr: "\u21D0",
        uArr: "\u21D1",
        rArr: "\u21D2",
        dArr: "\u21D3",
        hArr: "\u21D4",
        forall: "\u2200",
        part: "\u2202",
        exist: "\u2203",
        empty: "\u2205",
        nabla: "\u2207",
        isin: "\u2208",
        notin: "\u2209",
        ni: "\u220B",
        prod: "\u220F",
        sum: "\u2211",
        minus: "\u2212",
        lowast: "\u2217",
        radic: "\u221A",
        prop: "\u221D",
        infin: "\u221E",
        ang: "\u2220",
        and: "\u2227",
        or: "\u2228",
        cap: "\u2229",
        cup: "\u222A",
        int: "\u222B",
        there4: "\u2234",
        sim: "\u223C",
        cong: "\u2245",
        asymp: "\u2248",
        ne: "\u2260",
        equiv: "\u2261",
        le: "\u2264",
        ge: "\u2265",
        sub: "\u2282",
        sup: "\u2283",
        nsub: "\u2284",
        sube: "\u2286",
        supe: "\u2287",
        oplus: "\u2295",
        otimes: "\u2297",
        perp: "\u22A5",
        sdot: "\u22C5",
        lceil: "\u2308",
        rceil: "\u2309",
        lfloor: "\u230A",
        rfloor: "\u230B",
        lang: "\u2329",
        rang: "\u232A",
        loz: "\u25CA",
        spades: "\u2660",
        clubs: "\u2663",
        hearts: "\u2665",
        diams: "\u2666"
      };
      var lineBreak = /\r\n|[\r\n\u2028\u2029]/;
      var lineBreakG = new RegExp(lineBreak.source, "g");
      function isNewLine(code2) {
        switch (code2) {
          case 10:
          case 13:
          case 8232:
          case 8233:
            return true;
          default:
            return false;
        }
      }
      function hasNewLine(input, start, end) {
        for (let i = start; i < end; i++) {
          if (isNewLine(input.charCodeAt(i))) {
            return true;
          }
        }
        return false;
      }
      var skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;
      var skipWhiteSpaceInLine = /(?:[^\S\n\r\u2028\u2029]|\/\/.*|\/\*.*?\*\/)*/g;
      function isWhitespace(code2) {
        switch (code2) {
          case 9:
          case 11:
          case 12:
          case 32:
          case 160:
          case 5760:
          case 8192:
          case 8193:
          case 8194:
          case 8195:
          case 8196:
          case 8197:
          case 8198:
          case 8199:
          case 8200:
          case 8201:
          case 8202:
          case 8239:
          case 8287:
          case 12288:
          case 65279:
            return true;
          default:
            return false;
        }
      }
      var JsxErrors = ParseErrorEnum`jsx`({
        AttributeIsEmpty: "JSX attributes must only be assigned a non-empty expression.",
        MissingClosingTagElement: ({
          openingTagName
        }) => `Expected corresponding JSX closing tag for <${openingTagName}>.`,
        MissingClosingTagFragment: "Expected corresponding JSX closing tag for <>.",
        UnexpectedSequenceExpression: "Sequence expressions cannot be directly nested inside JSX. Did you mean to wrap it in parentheses (...)?",
        UnexpectedToken: ({
          unexpected,
          HTMLEntity
        }) => `Unexpected token \`${unexpected}\`. Did you mean \`${HTMLEntity}\` or \`{'${unexpected}'}\`?`,
        UnsupportedJsxValue: "JSX value should be either an expression or a quoted JSX text.",
        UnterminatedJsxContent: "Unterminated JSX contents.",
        UnwrappedAdjacentJSXElements: "Adjacent JSX elements must be wrapped in an enclosing tag. Did you want a JSX fragment <>...</>?"
      });
      function isFragment(object) {
        return object ? object.type === "JSXOpeningFragment" || object.type === "JSXClosingFragment" : false;
      }
      function getQualifiedJSXName(object) {
        if (object.type === "JSXIdentifier") {
          return object.name;
        }
        if (object.type === "JSXNamespacedName") {
          return object.namespace.name + ":" + object.name.name;
        }
        if (object.type === "JSXMemberExpression") {
          return getQualifiedJSXName(object.object) + "." + getQualifiedJSXName(object.property);
        }
        throw new Error("Node had unexpected type: " + object.type);
      }
      var jsx = (superClass) => class JSXParserMixin extends superClass {
        jsxReadToken() {
          let out = "";
          let chunkStart = this.state.pos;
          for (; ; ) {
            if (this.state.pos >= this.length) {
              throw this.raise(JsxErrors.UnterminatedJsxContent, this.state.startLoc);
            }
            const ch = this.input.charCodeAt(this.state.pos);
            switch (ch) {
              case 60:
              case 123:
                if (this.state.pos === this.state.start) {
                  if (ch === 60 && this.state.canStartJSXElement) {
                    ++this.state.pos;
                    this.finishToken(143);
                  } else {
                    super.getTokenFromCode(ch);
                  }
                  return;
                }
                out += this.input.slice(chunkStart, this.state.pos);
                this.finishToken(142, out);
                return;
              case 38:
                out += this.input.slice(chunkStart, this.state.pos);
                out += this.jsxReadEntity();
                chunkStart = this.state.pos;
                break;
              case 62:
              case 125:
              default:
                if (isNewLine(ch)) {
                  out += this.input.slice(chunkStart, this.state.pos);
                  out += this.jsxReadNewLine(true);
                  chunkStart = this.state.pos;
                } else {
                  ++this.state.pos;
                }
            }
          }
        }
        jsxReadNewLine(normalizeCRLF) {
          const ch = this.input.charCodeAt(this.state.pos);
          let out;
          ++this.state.pos;
          if (ch === 13 && this.input.charCodeAt(this.state.pos) === 10) {
            ++this.state.pos;
            out = normalizeCRLF ? "\n" : "\r\n";
          } else {
            out = String.fromCharCode(ch);
          }
          ++this.state.curLine;
          this.state.lineStart = this.state.pos;
          return out;
        }
        jsxReadString(quote) {
          let out = "";
          let chunkStart = ++this.state.pos;
          for (; ; ) {
            if (this.state.pos >= this.length) {
              throw this.raise(Errors.UnterminatedString, this.state.startLoc);
            }
            const ch = this.input.charCodeAt(this.state.pos);
            if (ch === quote) break;
            if (ch === 38) {
              out += this.input.slice(chunkStart, this.state.pos);
              out += this.jsxReadEntity();
              chunkStart = this.state.pos;
            } else if (isNewLine(ch)) {
              out += this.input.slice(chunkStart, this.state.pos);
              out += this.jsxReadNewLine(false);
              chunkStart = this.state.pos;
            } else {
              ++this.state.pos;
            }
          }
          out += this.input.slice(chunkStart, this.state.pos++);
          this.finishToken(134, out);
        }
        jsxReadEntity() {
          const startPos = ++this.state.pos;
          if (this.codePointAtPos(this.state.pos) === 35) {
            ++this.state.pos;
            let radix = 10;
            if (this.codePointAtPos(this.state.pos) === 120) {
              radix = 16;
              ++this.state.pos;
            }
            const codePoint = this.readInt(radix, void 0, false, "bail");
            if (codePoint !== null && this.codePointAtPos(this.state.pos) === 59) {
              ++this.state.pos;
              return String.fromCodePoint(codePoint);
            }
          } else {
            let count = 0;
            let semi = false;
            while (count++ < 10 && this.state.pos < this.length && !(semi = this.codePointAtPos(this.state.pos) === 59)) {
              ++this.state.pos;
            }
            if (semi) {
              const desc = this.input.slice(startPos, this.state.pos);
              const entity = entities[desc];
              ++this.state.pos;
              if (entity) {
                return entity;
              }
            }
          }
          this.state.pos = startPos;
          return "&";
        }
        jsxReadWord() {
          let ch;
          const start = this.state.pos;
          do {
            ch = this.input.charCodeAt(++this.state.pos);
          } while (isIdentifierChar(ch) || ch === 45);
          this.finishToken(141, this.input.slice(start, this.state.pos));
        }
        jsxParseIdentifier() {
          const node = this.startNode();
          if (this.match(141)) {
            node.name = this.state.value;
          } else if (tokenIsKeyword(this.state.type)) {
            node.name = tokenLabelName(this.state.type);
          } else {
            this.unexpected();
          }
          this.next();
          return this.finishNode(node, "JSXIdentifier");
        }
        jsxParseNamespacedName() {
          const startLoc = this.state.startLoc;
          const name = this.jsxParseIdentifier();
          if (!this.eat(14)) return name;
          const node = this.startNodeAt(startLoc);
          node.namespace = name;
          node.name = this.jsxParseIdentifier();
          return this.finishNode(node, "JSXNamespacedName");
        }
        jsxParseElementName() {
          const startLoc = this.state.startLoc;
          let node = this.jsxParseNamespacedName();
          if (node.type === "JSXNamespacedName") {
            return node;
          }
          while (this.eat(16)) {
            const newNode = this.startNodeAt(startLoc);
            newNode.object = node;
            newNode.property = this.jsxParseIdentifier();
            node = this.finishNode(newNode, "JSXMemberExpression");
          }
          return node;
        }
        jsxParseAttributeValue() {
          let node;
          switch (this.state.type) {
            case 5:
              node = this.startNode();
              this.setContext(types.brace);
              this.next();
              node = this.jsxParseExpressionContainer(node, types.j_oTag);
              if (node.expression.type === "JSXEmptyExpression") {
                this.raise(JsxErrors.AttributeIsEmpty, node);
              }
              return node;
            case 143:
            case 134:
              return this.parseExprAtom();
            default:
              throw this.raise(JsxErrors.UnsupportedJsxValue, this.state.startLoc);
          }
        }
        jsxParseEmptyExpression() {
          const node = this.startNodeAt(this.state.lastTokEndLoc);
          return this.finishNodeAt(node, "JSXEmptyExpression", this.state.startLoc);
        }
        jsxParseSpreadChild(node) {
          this.next();
          node.expression = this.parseExpression();
          this.setContext(types.j_expr);
          this.state.canStartJSXElement = true;
          this.expect(8);
          return this.finishNode(node, "JSXSpreadChild");
        }
        jsxParseExpressionContainer(node, previousContext) {
          if (this.match(8)) {
            node.expression = this.jsxParseEmptyExpression();
          } else {
            const expression = this.parseExpression();
            node.expression = expression;
          }
          this.setContext(previousContext);
          this.state.canStartJSXElement = true;
          this.expect(8);
          return this.finishNode(node, "JSXExpressionContainer");
        }
        jsxParseAttribute() {
          const node = this.startNode();
          if (this.match(5)) {
            this.setContext(types.brace);
            this.next();
            this.expect(21);
            node.argument = this.parseMaybeAssignAllowIn();
            this.setContext(types.j_oTag);
            this.state.canStartJSXElement = true;
            this.expect(8);
            return this.finishNode(node, "JSXSpreadAttribute");
          }
          node.name = this.jsxParseNamespacedName();
          node.value = this.eat(29) ? this.jsxParseAttributeValue() : null;
          return this.finishNode(node, "JSXAttribute");
        }
        jsxParseOpeningElementAt(startLoc) {
          const node = this.startNodeAt(startLoc);
          if (this.eat(144)) {
            return this.finishNode(node, "JSXOpeningFragment");
          }
          node.name = this.jsxParseElementName();
          return this.jsxParseOpeningElementAfterName(node);
        }
        jsxParseOpeningElementAfterName(node) {
          const attributes = [];
          while (!this.match(56) && !this.match(144)) {
            attributes.push(this.jsxParseAttribute());
          }
          node.attributes = attributes;
          node.selfClosing = this.eat(56);
          this.expect(144);
          return this.finishNode(node, "JSXOpeningElement");
        }
        jsxParseClosingElementAt(startLoc) {
          const node = this.startNodeAt(startLoc);
          if (this.eat(144)) {
            return this.finishNode(node, "JSXClosingFragment");
          }
          node.name = this.jsxParseElementName();
          this.expect(144);
          return this.finishNode(node, "JSXClosingElement");
        }
        jsxParseElementAt(startLoc) {
          const node = this.startNodeAt(startLoc);
          const children = [];
          const openingElement = this.jsxParseOpeningElementAt(startLoc);
          let closingElement = null;
          if (!openingElement.selfClosing) {
            contents: for (; ; ) {
              switch (this.state.type) {
                case 143:
                  startLoc = this.state.startLoc;
                  this.next();
                  if (this.eat(56)) {
                    closingElement = this.jsxParseClosingElementAt(startLoc);
                    break contents;
                  }
                  children.push(this.jsxParseElementAt(startLoc));
                  break;
                case 142:
                  children.push(this.parseLiteral(this.state.value, "JSXText"));
                  break;
                case 5: {
                  const node2 = this.startNode();
                  this.setContext(types.brace);
                  this.next();
                  if (this.match(21)) {
                    children.push(this.jsxParseSpreadChild(node2));
                  } else {
                    children.push(this.jsxParseExpressionContainer(node2, types.j_expr));
                  }
                  break;
                }
                default:
                  this.unexpected();
              }
            }
            if (isFragment(openingElement) && !isFragment(closingElement) && closingElement !== null) {
              this.raise(JsxErrors.MissingClosingTagFragment, closingElement);
            } else if (!isFragment(openingElement) && isFragment(closingElement)) {
              this.raise(JsxErrors.MissingClosingTagElement, closingElement, {
                openingTagName: getQualifiedJSXName(openingElement.name)
              });
            } else if (!isFragment(openingElement) && !isFragment(closingElement)) {
              if (getQualifiedJSXName(closingElement.name) !== getQualifiedJSXName(openingElement.name)) {
                this.raise(JsxErrors.MissingClosingTagElement, closingElement, {
                  openingTagName: getQualifiedJSXName(openingElement.name)
                });
              }
            }
          }
          if (isFragment(openingElement)) {
            node.openingFragment = openingElement;
            node.closingFragment = closingElement;
          } else {
            node.openingElement = openingElement;
            node.closingElement = closingElement;
          }
          node.children = children;
          if (this.match(47)) {
            throw this.raise(JsxErrors.UnwrappedAdjacentJSXElements, this.state.startLoc);
          }
          return isFragment(openingElement) ? this.finishNode(node, "JSXFragment") : this.finishNode(node, "JSXElement");
        }
        jsxParseElement() {
          const startLoc = this.state.startLoc;
          this.next();
          return this.jsxParseElementAt(startLoc);
        }
        setContext(newContext) {
          const {
            context
          } = this.state;
          context[context.length - 1] = newContext;
        }
        parseExprAtom(refExpressionErrors) {
          if (this.match(143)) {
            return this.jsxParseElement();
          } else if (this.match(47) && this.input.charCodeAt(this.state.pos) !== 33) {
            this.replaceToken(143);
            return this.jsxParseElement();
          } else {
            return super.parseExprAtom(refExpressionErrors);
          }
        }
        skipSpace() {
          const curContext = this.curContext();
          if (!curContext.preserveSpace) super.skipSpace();
        }
        getTokenFromCode(code2) {
          const context = this.curContext();
          if (context === types.j_expr) {
            this.jsxReadToken();
            return;
          }
          if (context === types.j_oTag || context === types.j_cTag) {
            if (isIdentifierStart(code2)) {
              this.jsxReadWord();
              return;
            }
            if (code2 === 62) {
              ++this.state.pos;
              this.finishToken(144);
              return;
            }
            if ((code2 === 34 || code2 === 39) && context === types.j_oTag) {
              this.jsxReadString(code2);
              return;
            }
          }
          if (code2 === 60 && this.state.canStartJSXElement && this.input.charCodeAt(this.state.pos + 1) !== 33) {
            ++this.state.pos;
            this.finishToken(143);
            return;
          }
          super.getTokenFromCode(code2);
        }
        updateContext(prevType) {
          const {
            context,
            type
          } = this.state;
          if (type === 56 && prevType === 143) {
            context.splice(-2, 2, types.j_cTag);
            this.state.canStartJSXElement = false;
          } else if (type === 143) {
            context.push(types.j_oTag);
          } else if (type === 144) {
            const out = context[context.length - 1];
            if (out === types.j_oTag && prevType === 56 || out === types.j_cTag) {
              context.pop();
              this.state.canStartJSXElement = context[context.length - 1] === types.j_expr;
            } else {
              this.setContext(types.j_expr);
              this.state.canStartJSXElement = true;
            }
          } else {
            this.state.canStartJSXElement = tokenComesBeforeExpression(type);
          }
        }
      };
      var TypeScriptScope = class extends Scope3 {
        constructor(...args) {
          super(...args);
          this.tsNames = /* @__PURE__ */ new Map();
        }
      };
      var TypeScriptScopeHandler = class extends ScopeHandler {
        constructor(...args) {
          super(...args);
          this.importsStack = [];
        }
        createScope(flags) {
          this.importsStack.push(/* @__PURE__ */ new Set());
          return new TypeScriptScope(flags);
        }
        enter(flags) {
          if (flags === 1024) {
            this.importsStack.push(/* @__PURE__ */ new Set());
          }
          super.enter(flags);
        }
        exit() {
          const flags = super.exit();
          if (flags === 1024) {
            this.importsStack.pop();
          }
          return flags;
        }
        hasImport(name, allowShadow) {
          const len = this.importsStack.length;
          if (this.importsStack[len - 1].has(name)) {
            return true;
          }
          if (!allowShadow && len > 1) {
            for (let i = 0; i < len - 1; i++) {
              if (this.importsStack[i].has(name)) return true;
            }
          }
          return false;
        }
        declareName(name, bindingType, loc) {
          if (bindingType & 4096) {
            if (this.hasImport(name, true)) {
              this.parser.raise(Errors.VarRedeclaration, loc, {
                identifierName: name
              });
            }
            this.importsStack[this.importsStack.length - 1].add(name);
            return;
          }
          const scope = this.currentScope();
          let type = scope.tsNames.get(name) || 0;
          if (bindingType & 1024) {
            this.maybeExportDefined(scope, name);
            scope.tsNames.set(name, type | 16);
            return;
          }
          super.declareName(name, bindingType, loc);
          if (bindingType & 2) {
            if (!(bindingType & 1)) {
              this.checkRedeclarationInScope(scope, name, bindingType, loc);
              this.maybeExportDefined(scope, name);
            }
            type = type | 1;
          }
          if (bindingType & 256) {
            type = type | 2;
          }
          if (bindingType & 512) {
            type = type | 4;
          }
          if (bindingType & 128) {
            type = type | 8;
          }
          if (type) scope.tsNames.set(name, type);
        }
        isRedeclaredInScope(scope, name, bindingType) {
          const type = scope.tsNames.get(name);
          if ((type & 2) > 0) {
            if (bindingType & 256) {
              const isConst = !!(bindingType & 512);
              const wasConst = (type & 4) > 0;
              return isConst !== wasConst;
            }
            return true;
          }
          if (bindingType & 128 && (type & 8) > 0) {
            if (scope.names.get(name) & 2) {
              return !!(bindingType & 1);
            } else {
              return false;
            }
          }
          if (bindingType & 2 && (type & 1) > 0) {
            return true;
          }
          return super.isRedeclaredInScope(scope, name, bindingType);
        }
        checkLocalExport(id) {
          const {
            name
          } = id;
          if (this.hasImport(name)) return;
          const len = this.scopeStack.length;
          for (let i = len - 1; i >= 0; i--) {
            const scope = this.scopeStack[i];
            const type = scope.tsNames.get(name);
            if ((type & 1) > 0 || (type & 16) > 0) {
              return;
            }
          }
          super.checkLocalExport(id);
        }
      };
      var ProductionParameterHandler = class {
        constructor() {
          this.stacks = [];
        }
        enter(flags) {
          this.stacks.push(flags);
        }
        exit() {
          this.stacks.pop();
        }
        currentFlags() {
          return this.stacks[this.stacks.length - 1];
        }
        get hasAwait() {
          return (this.currentFlags() & 2) > 0;
        }
        get hasYield() {
          return (this.currentFlags() & 1) > 0;
        }
        get hasReturn() {
          return (this.currentFlags() & 4) > 0;
        }
        get hasIn() {
          return (this.currentFlags() & 8) > 0;
        }
      };
      function functionFlags(isAsync, isGenerator) {
        return (isAsync ? 2 : 0) | (isGenerator ? 1 : 0);
      }
      var BaseParser = class {
        constructor() {
          this.sawUnambiguousESM = false;
          this.ambiguousScriptDifferentAst = false;
        }
        sourceToOffsetPos(sourcePos) {
          return sourcePos + this.startIndex;
        }
        offsetToSourcePos(offsetPos) {
          return offsetPos - this.startIndex;
        }
        hasPlugin(pluginConfig) {
          if (typeof pluginConfig === "string") {
            return this.plugins.has(pluginConfig);
          } else {
            const [pluginName, pluginOptions] = pluginConfig;
            if (!this.hasPlugin(pluginName)) {
              return false;
            }
            const actualOptions = this.plugins.get(pluginName);
            for (const key of Object.keys(pluginOptions)) {
              if ((actualOptions == null ? void 0 : actualOptions[key]) !== pluginOptions[key]) {
                return false;
              }
            }
            return true;
          }
        }
        getPluginOption(plugin, name) {
          var _this$plugins$get;
          return (_this$plugins$get = this.plugins.get(plugin)) == null ? void 0 : _this$plugins$get[name];
        }
      };
      function setTrailingComments(node, comments) {
        if (node.trailingComments === void 0) {
          node.trailingComments = comments;
        } else {
          node.trailingComments.unshift(...comments);
        }
      }
      function setLeadingComments(node, comments) {
        if (node.leadingComments === void 0) {
          node.leadingComments = comments;
        } else {
          node.leadingComments.unshift(...comments);
        }
      }
      function setInnerComments(node, comments) {
        if (node.innerComments === void 0) {
          node.innerComments = comments;
        } else {
          node.innerComments.unshift(...comments);
        }
      }
      function adjustInnerComments(node, elements, commentWS) {
        let lastElement = null;
        let i = elements.length;
        while (lastElement === null && i > 0) {
          lastElement = elements[--i];
        }
        if (lastElement === null || lastElement.start > commentWS.start) {
          setInnerComments(node, commentWS.comments);
        } else {
          setTrailingComments(lastElement, commentWS.comments);
        }
      }
      var CommentsParser = class extends BaseParser {
        addComment(comment) {
          if (this.filename) comment.loc.filename = this.filename;
          const {
            commentsLen
          } = this.state;
          if (this.comments.length !== commentsLen) {
            this.comments.length = commentsLen;
          }
          this.comments.push(comment);
          this.state.commentsLen++;
        }
        processComment(node) {
          const {
            commentStack
          } = this.state;
          const commentStackLength = commentStack.length;
          if (commentStackLength === 0) return;
          let i = commentStackLength - 1;
          const lastCommentWS = commentStack[i];
          if (lastCommentWS.start === node.end) {
            lastCommentWS.leadingNode = node;
            i--;
          }
          const {
            start: nodeStart
          } = node;
          for (; i >= 0; i--) {
            const commentWS = commentStack[i];
            const commentEnd = commentWS.end;
            if (commentEnd > nodeStart) {
              commentWS.containingNode = node;
              this.finalizeComment(commentWS);
              commentStack.splice(i, 1);
            } else {
              if (commentEnd === nodeStart) {
                commentWS.trailingNode = node;
              }
              break;
            }
          }
        }
        finalizeComment(commentWS) {
          var _node$options;
          const {
            comments
          } = commentWS;
          if (commentWS.leadingNode !== null || commentWS.trailingNode !== null) {
            if (commentWS.leadingNode !== null) {
              setTrailingComments(commentWS.leadingNode, comments);
            }
            if (commentWS.trailingNode !== null) {
              setLeadingComments(commentWS.trailingNode, comments);
            }
          } else {
            const node = commentWS.containingNode;
            const commentStart = commentWS.start;
            if (this.input.charCodeAt(this.offsetToSourcePos(commentStart) - 1) === 44) {
              switch (node.type) {
                case "ObjectExpression":
                case "ObjectPattern":
                  adjustInnerComments(node, node.properties, commentWS);
                  break;
                case "CallExpression":
                case "OptionalCallExpression":
                  adjustInnerComments(node, node.arguments, commentWS);
                  break;
                case "ImportExpression":
                  adjustInnerComments(node, [node.source, (_node$options = node.options) != null ? _node$options : null], commentWS);
                  break;
                case "FunctionDeclaration":
                case "FunctionExpression":
                case "ArrowFunctionExpression":
                case "ObjectMethod":
                case "ClassMethod":
                case "ClassPrivateMethod":
                  adjustInnerComments(node, node.params, commentWS);
                  break;
                case "ArrayExpression":
                case "ArrayPattern":
                  adjustInnerComments(node, node.elements, commentWS);
                  break;
                case "ExportNamedDeclaration":
                case "ImportDeclaration":
                  adjustInnerComments(node, node.specifiers, commentWS);
                  break;
                case "TSEnumDeclaration":
                  adjustInnerComments(node, node.members, commentWS);
                  break;
                case "TSEnumBody":
                  adjustInnerComments(node, node.members, commentWS);
                  break;
                default: {
                  if (node.type === "RecordExpression") {
                    adjustInnerComments(node, node.properties, commentWS);
                    break;
                  }
                  if (node.type === "TupleExpression") {
                    adjustInnerComments(node, node.elements, commentWS);
                    break;
                  }
                  setInnerComments(node, comments);
                }
              }
            } else {
              setInnerComments(node, comments);
            }
          }
        }
        finalizeRemainingComments() {
          const {
            commentStack
          } = this.state;
          for (let i = commentStack.length - 1; i >= 0; i--) {
            this.finalizeComment(commentStack[i]);
          }
          this.state.commentStack = [];
        }
        resetPreviousNodeTrailingComments(node) {
          const {
            commentStack
          } = this.state;
          const {
            length
          } = commentStack;
          if (length === 0) return;
          const commentWS = commentStack[length - 1];
          if (commentWS.leadingNode === node) {
            commentWS.leadingNode = null;
          }
        }
        takeSurroundingComments(node, start, end) {
          const {
            commentStack
          } = this.state;
          const commentStackLength = commentStack.length;
          if (commentStackLength === 0) return;
          let i = commentStackLength - 1;
          for (; i >= 0; i--) {
            const commentWS = commentStack[i];
            const commentEnd = commentWS.end;
            const commentStart = commentWS.start;
            if (commentStart === end) {
              commentWS.leadingNode = node;
            } else if (commentEnd === start) {
              commentWS.trailingNode = node;
            } else if (commentEnd < start) {
              break;
            }
          }
        }
      };
      var State = class _State {
        constructor() {
          this.flags = 1024;
          this.startIndex = void 0;
          this.curLine = void 0;
          this.lineStart = void 0;
          this.startLoc = void 0;
          this.endLoc = void 0;
          this.errors = [];
          this.potentialArrowAt = -1;
          this.noArrowAt = [];
          this.noArrowParamsConversionAt = [];
          this.topicContext = {
            maxNumOfResolvableTopics: 0,
            maxTopicIndex: null
          };
          this.labels = [];
          this.commentsLen = 0;
          this.commentStack = [];
          this.pos = 0;
          this.type = 140;
          this.value = null;
          this.start = 0;
          this.end = 0;
          this.lastTokEndLoc = null;
          this.lastTokStartLoc = null;
          this.context = [types.brace];
          this.firstInvalidTemplateEscapePos = null;
          this.strictErrors = /* @__PURE__ */ new Map();
          this.tokensLength = 0;
        }
        get strict() {
          return (this.flags & 1) > 0;
        }
        set strict(v) {
          if (v) this.flags |= 1;
          else this.flags &= -2;
        }
        init({
          strictMode,
          sourceType,
          startIndex,
          startLine,
          startColumn
        }) {
          this.strict = strictMode === false ? false : strictMode === true ? true : sourceType === "module";
          this.startIndex = startIndex;
          this.curLine = startLine;
          this.lineStart = -startColumn;
          this.startLoc = this.endLoc = new Position(startLine, startColumn, startIndex);
        }
        get maybeInArrowParameters() {
          return (this.flags & 2) > 0;
        }
        set maybeInArrowParameters(v) {
          if (v) this.flags |= 2;
          else this.flags &= -3;
        }
        get inType() {
          return (this.flags & 4) > 0;
        }
        set inType(v) {
          if (v) this.flags |= 4;
          else this.flags &= -5;
        }
        get noAnonFunctionType() {
          return (this.flags & 8) > 0;
        }
        set noAnonFunctionType(v) {
          if (v) this.flags |= 8;
          else this.flags &= -9;
        }
        get hasFlowComment() {
          return (this.flags & 16) > 0;
        }
        set hasFlowComment(v) {
          if (v) this.flags |= 16;
          else this.flags &= -17;
        }
        get isAmbientContext() {
          return (this.flags & 32) > 0;
        }
        set isAmbientContext(v) {
          if (v) this.flags |= 32;
          else this.flags &= -33;
        }
        get inAbstractClass() {
          return (this.flags & 64) > 0;
        }
        set inAbstractClass(v) {
          if (v) this.flags |= 64;
          else this.flags &= -65;
        }
        get inDisallowConditionalTypesContext() {
          return (this.flags & 128) > 0;
        }
        set inDisallowConditionalTypesContext(v) {
          if (v) this.flags |= 128;
          else this.flags &= -129;
        }
        get soloAwait() {
          return (this.flags & 256) > 0;
        }
        set soloAwait(v) {
          if (v) this.flags |= 256;
          else this.flags &= -257;
        }
        get inFSharpPipelineDirectBody() {
          return (this.flags & 512) > 0;
        }
        set inFSharpPipelineDirectBody(v) {
          if (v) this.flags |= 512;
          else this.flags &= -513;
        }
        get canStartJSXElement() {
          return (this.flags & 1024) > 0;
        }
        set canStartJSXElement(v) {
          if (v) this.flags |= 1024;
          else this.flags &= -1025;
        }
        get containsEsc() {
          return (this.flags & 2048) > 0;
        }
        set containsEsc(v) {
          if (v) this.flags |= 2048;
          else this.flags &= -2049;
        }
        get hasTopLevelAwait() {
          return (this.flags & 4096) > 0;
        }
        set hasTopLevelAwait(v) {
          if (v) this.flags |= 4096;
          else this.flags &= -4097;
        }
        curPosition() {
          return new Position(this.curLine, this.pos - this.lineStart, this.pos + this.startIndex);
        }
        clone() {
          const state = new _State();
          state.flags = this.flags;
          state.startIndex = this.startIndex;
          state.curLine = this.curLine;
          state.lineStart = this.lineStart;
          state.startLoc = this.startLoc;
          state.endLoc = this.endLoc;
          state.errors = this.errors.slice();
          state.potentialArrowAt = this.potentialArrowAt;
          state.noArrowAt = this.noArrowAt.slice();
          state.noArrowParamsConversionAt = this.noArrowParamsConversionAt.slice();
          state.topicContext = this.topicContext;
          state.labels = this.labels.slice();
          state.commentsLen = this.commentsLen;
          state.commentStack = this.commentStack.slice();
          state.pos = this.pos;
          state.type = this.type;
          state.value = this.value;
          state.start = this.start;
          state.end = this.end;
          state.lastTokEndLoc = this.lastTokEndLoc;
          state.lastTokStartLoc = this.lastTokStartLoc;
          state.context = this.context.slice();
          state.firstInvalidTemplateEscapePos = this.firstInvalidTemplateEscapePos;
          state.strictErrors = this.strictErrors;
          state.tokensLength = this.tokensLength;
          return state;
        }
      };
      var _isDigit = function isDigit(code2) {
        return code2 >= 48 && code2 <= 57;
      };
      var forbiddenNumericSeparatorSiblings = {
        decBinOct: /* @__PURE__ */ new Set([46, 66, 69, 79, 95, 98, 101, 111]),
        hex: /* @__PURE__ */ new Set([46, 88, 95, 120])
      };
      var isAllowedNumericSeparatorSibling = {
        bin: (ch) => ch === 48 || ch === 49,
        oct: (ch) => ch >= 48 && ch <= 55,
        dec: (ch) => ch >= 48 && ch <= 57,
        hex: (ch) => ch >= 48 && ch <= 57 || ch >= 65 && ch <= 70 || ch >= 97 && ch <= 102
      };
      function readStringContents(type, input, pos, lineStart, curLine, errors) {
        const initialPos = pos;
        const initialLineStart = lineStart;
        const initialCurLine = curLine;
        let out = "";
        let firstInvalidLoc = null;
        let chunkStart = pos;
        const {
          length
        } = input;
        for (; ; ) {
          if (pos >= length) {
            errors.unterminated(initialPos, initialLineStart, initialCurLine);
            out += input.slice(chunkStart, pos);
            break;
          }
          const ch = input.charCodeAt(pos);
          if (isStringEnd(type, ch, input, pos)) {
            out += input.slice(chunkStart, pos);
            break;
          }
          if (ch === 92) {
            out += input.slice(chunkStart, pos);
            const res = readEscapedChar(input, pos, lineStart, curLine, type === "template", errors);
            if (res.ch === null && !firstInvalidLoc) {
              firstInvalidLoc = {
                pos,
                lineStart,
                curLine
              };
            } else {
              out += res.ch;
            }
            ({
              pos,
              lineStart,
              curLine
            } = res);
            chunkStart = pos;
          } else if (ch === 8232 || ch === 8233) {
            ++pos;
            ++curLine;
            lineStart = pos;
          } else if (ch === 10 || ch === 13) {
            if (type === "template") {
              out += input.slice(chunkStart, pos) + "\n";
              ++pos;
              if (ch === 13 && input.charCodeAt(pos) === 10) {
                ++pos;
              }
              ++curLine;
              chunkStart = lineStart = pos;
            } else {
              errors.unterminated(initialPos, initialLineStart, initialCurLine);
            }
          } else {
            ++pos;
          }
        }
        return {
          pos,
          str: out,
          firstInvalidLoc,
          lineStart,
          curLine,
          containsInvalid: !!firstInvalidLoc
        };
      }
      function isStringEnd(type, ch, input, pos) {
        if (type === "template") {
          return ch === 96 || ch === 36 && input.charCodeAt(pos + 1) === 123;
        }
        return ch === (type === "double" ? 34 : 39);
      }
      function readEscapedChar(input, pos, lineStart, curLine, inTemplate, errors) {
        const throwOnInvalid = !inTemplate;
        pos++;
        const res = (ch2) => ({
          pos,
          ch: ch2,
          lineStart,
          curLine
        });
        const ch = input.charCodeAt(pos++);
        switch (ch) {
          case 110:
            return res("\n");
          case 114:
            return res("\r");
          case 120: {
            let code2;
            ({
              code: code2,
              pos
            } = readHexChar(input, pos, lineStart, curLine, 2, false, throwOnInvalid, errors));
            return res(code2 === null ? null : String.fromCharCode(code2));
          }
          case 117: {
            let code2;
            ({
              code: code2,
              pos
            } = readCodePoint(input, pos, lineStart, curLine, throwOnInvalid, errors));
            return res(code2 === null ? null : String.fromCodePoint(code2));
          }
          case 116:
            return res("	");
          case 98:
            return res("\b");
          case 118:
            return res("\v");
          case 102:
            return res("\f");
          case 13:
            if (input.charCodeAt(pos) === 10) {
              ++pos;
            }
          case 10:
            lineStart = pos;
            ++curLine;
          case 8232:
          case 8233:
            return res("");
          case 56:
          case 57:
            if (inTemplate) {
              return res(null);
            } else {
              errors.strictNumericEscape(pos - 1, lineStart, curLine);
            }
          default:
            if (ch >= 48 && ch <= 55) {
              const startPos = pos - 1;
              const match = /^[0-7]+/.exec(input.slice(startPos, pos + 2));
              let octalStr = match[0];
              let octal = parseInt(octalStr, 8);
              if (octal > 255) {
                octalStr = octalStr.slice(0, -1);
                octal = parseInt(octalStr, 8);
              }
              pos += octalStr.length - 1;
              const next = input.charCodeAt(pos);
              if (octalStr !== "0" || next === 56 || next === 57) {
                if (inTemplate) {
                  return res(null);
                } else {
                  errors.strictNumericEscape(startPos, lineStart, curLine);
                }
              }
              return res(String.fromCharCode(octal));
            }
            return res(String.fromCharCode(ch));
        }
      }
      function readHexChar(input, pos, lineStart, curLine, len, forceLen, throwOnInvalid, errors) {
        const initialPos = pos;
        let n;
        ({
          n,
          pos
        } = readInt(input, pos, lineStart, curLine, 16, len, forceLen, false, errors, !throwOnInvalid));
        if (n === null) {
          if (throwOnInvalid) {
            errors.invalidEscapeSequence(initialPos, lineStart, curLine);
          } else {
            pos = initialPos - 1;
          }
        }
        return {
          code: n,
          pos
        };
      }
      function readInt(input, pos, lineStart, curLine, radix, len, forceLen, allowNumSeparator, errors, bailOnError) {
        const start = pos;
        const forbiddenSiblings = radix === 16 ? forbiddenNumericSeparatorSiblings.hex : forbiddenNumericSeparatorSiblings.decBinOct;
        const isAllowedSibling = radix === 16 ? isAllowedNumericSeparatorSibling.hex : radix === 10 ? isAllowedNumericSeparatorSibling.dec : radix === 8 ? isAllowedNumericSeparatorSibling.oct : isAllowedNumericSeparatorSibling.bin;
        let invalid = false;
        let total = 0;
        for (let i = 0, e = len == null ? Infinity : len; i < e; ++i) {
          const code2 = input.charCodeAt(pos);
          let val;
          if (code2 === 95 && allowNumSeparator !== "bail") {
            const prev = input.charCodeAt(pos - 1);
            const next = input.charCodeAt(pos + 1);
            if (!allowNumSeparator) {
              if (bailOnError) return {
                n: null,
                pos
              };
              errors.numericSeparatorInEscapeSequence(pos, lineStart, curLine);
            } else if (Number.isNaN(next) || !isAllowedSibling(next) || forbiddenSiblings.has(prev) || forbiddenSiblings.has(next)) {
              if (bailOnError) return {
                n: null,
                pos
              };
              errors.unexpectedNumericSeparator(pos, lineStart, curLine);
            }
            ++pos;
            continue;
          }
          if (code2 >= 97) {
            val = code2 - 97 + 10;
          } else if (code2 >= 65) {
            val = code2 - 65 + 10;
          } else if (_isDigit(code2)) {
            val = code2 - 48;
          } else {
            val = Infinity;
          }
          if (val >= radix) {
            if (val <= 9 && bailOnError) {
              return {
                n: null,
                pos
              };
            } else if (val <= 9 && errors.invalidDigit(pos, lineStart, curLine, radix)) {
              val = 0;
            } else if (forceLen) {
              val = 0;
              invalid = true;
            } else {
              break;
            }
          }
          ++pos;
          total = total * radix + val;
        }
        if (pos === start || len != null && pos - start !== len || invalid) {
          return {
            n: null,
            pos
          };
        }
        return {
          n: total,
          pos
        };
      }
      function readCodePoint(input, pos, lineStart, curLine, throwOnInvalid, errors) {
        const ch = input.charCodeAt(pos);
        let code2;
        if (ch === 123) {
          ++pos;
          ({
            code: code2,
            pos
          } = readHexChar(input, pos, lineStart, curLine, input.indexOf("}", pos) - pos, true, throwOnInvalid, errors));
          ++pos;
          if (code2 !== null && code2 > 1114111) {
            if (throwOnInvalid) {
              errors.invalidCodePoint(pos, lineStart, curLine);
            } else {
              return {
                code: null,
                pos
              };
            }
          }
        } else {
          ({
            code: code2,
            pos
          } = readHexChar(input, pos, lineStart, curLine, 4, false, throwOnInvalid, errors));
        }
        return {
          code: code2,
          pos
        };
      }
      function buildPosition(pos, lineStart, curLine) {
        return new Position(curLine, pos - lineStart, pos);
      }
      var VALID_REGEX_FLAGS = /* @__PURE__ */ new Set([103, 109, 115, 105, 121, 117, 100, 118]);
      var Token = class {
        constructor(state) {
          const startIndex = state.startIndex || 0;
          this.type = state.type;
          this.value = state.value;
          this.start = startIndex + state.start;
          this.end = startIndex + state.end;
          this.loc = new SourceLocation(state.startLoc, state.endLoc);
        }
      };
      var Tokenizer = class extends CommentsParser {
        constructor(options, input) {
          super();
          this.isLookahead = void 0;
          this.tokens = [];
          this.errorHandlers_readInt = {
            invalidDigit: (pos, lineStart, curLine, radix) => {
              if (!(this.optionFlags & 2048)) return false;
              this.raise(Errors.InvalidDigit, buildPosition(pos, lineStart, curLine), {
                radix
              });
              return true;
            },
            numericSeparatorInEscapeSequence: this.errorBuilder(Errors.NumericSeparatorInEscapeSequence),
            unexpectedNumericSeparator: this.errorBuilder(Errors.UnexpectedNumericSeparator)
          };
          this.errorHandlers_readCodePoint = Object.assign({}, this.errorHandlers_readInt, {
            invalidEscapeSequence: this.errorBuilder(Errors.InvalidEscapeSequence),
            invalidCodePoint: this.errorBuilder(Errors.InvalidCodePoint)
          });
          this.errorHandlers_readStringContents_string = Object.assign({}, this.errorHandlers_readCodePoint, {
            strictNumericEscape: (pos, lineStart, curLine) => {
              this.recordStrictModeErrors(Errors.StrictNumericEscape, buildPosition(pos, lineStart, curLine));
            },
            unterminated: (pos, lineStart, curLine) => {
              throw this.raise(Errors.UnterminatedString, buildPosition(pos - 1, lineStart, curLine));
            }
          });
          this.errorHandlers_readStringContents_template = Object.assign({}, this.errorHandlers_readCodePoint, {
            strictNumericEscape: this.errorBuilder(Errors.StrictNumericEscape),
            unterminated: (pos, lineStart, curLine) => {
              throw this.raise(Errors.UnterminatedTemplate, buildPosition(pos, lineStart, curLine));
            }
          });
          this.state = new State();
          this.state.init(options);
          this.input = input;
          this.length = input.length;
          this.comments = [];
          this.isLookahead = false;
        }
        pushToken(token) {
          this.tokens.length = this.state.tokensLength;
          this.tokens.push(token);
          ++this.state.tokensLength;
        }
        next() {
          this.checkKeywordEscapes();
          if (this.optionFlags & 256) {
            this.pushToken(new Token(this.state));
          }
          this.state.lastTokEndLoc = this.state.endLoc;
          this.state.lastTokStartLoc = this.state.startLoc;
          this.nextToken();
        }
        eat(type) {
          if (this.match(type)) {
            this.next();
            return true;
          } else {
            return false;
          }
        }
        match(type) {
          return this.state.type === type;
        }
        createLookaheadState(state) {
          return {
            pos: state.pos,
            value: null,
            type: state.type,
            start: state.start,
            end: state.end,
            context: [this.curContext()],
            inType: state.inType,
            startLoc: state.startLoc,
            lastTokEndLoc: state.lastTokEndLoc,
            curLine: state.curLine,
            lineStart: state.lineStart,
            curPosition: state.curPosition
          };
        }
        lookahead() {
          const old = this.state;
          this.state = this.createLookaheadState(old);
          this.isLookahead = true;
          this.nextToken();
          this.isLookahead = false;
          const curr = this.state;
          this.state = old;
          return curr;
        }
        nextTokenStart() {
          return this.nextTokenStartSince(this.state.pos);
        }
        nextTokenStartSince(pos) {
          skipWhiteSpace.lastIndex = pos;
          return skipWhiteSpace.test(this.input) ? skipWhiteSpace.lastIndex : pos;
        }
        lookaheadCharCode() {
          return this.lookaheadCharCodeSince(this.state.pos);
        }
        lookaheadCharCodeSince(pos) {
          return this.input.charCodeAt(this.nextTokenStartSince(pos));
        }
        nextTokenInLineStart() {
          return this.nextTokenInLineStartSince(this.state.pos);
        }
        nextTokenInLineStartSince(pos) {
          skipWhiteSpaceInLine.lastIndex = pos;
          return skipWhiteSpaceInLine.test(this.input) ? skipWhiteSpaceInLine.lastIndex : pos;
        }
        lookaheadInLineCharCode() {
          return this.input.charCodeAt(this.nextTokenInLineStart());
        }
        codePointAtPos(pos) {
          let cp = this.input.charCodeAt(pos);
          if ((cp & 64512) === 55296 && ++pos < this.input.length) {
            const trail = this.input.charCodeAt(pos);
            if ((trail & 64512) === 56320) {
              cp = 65536 + ((cp & 1023) << 10) + (trail & 1023);
            }
          }
          return cp;
        }
        setStrict(strict) {
          this.state.strict = strict;
          if (strict) {
            this.state.strictErrors.forEach(([toParseError, at]) => this.raise(toParseError, at));
            this.state.strictErrors.clear();
          }
        }
        curContext() {
          return this.state.context[this.state.context.length - 1];
        }
        nextToken() {
          this.skipSpace();
          this.state.start = this.state.pos;
          if (!this.isLookahead) this.state.startLoc = this.state.curPosition();
          if (this.state.pos >= this.length) {
            this.finishToken(140);
            return;
          }
          this.getTokenFromCode(this.codePointAtPos(this.state.pos));
        }
        skipBlockComment(commentEnd) {
          let startLoc;
          if (!this.isLookahead) startLoc = this.state.curPosition();
          const start = this.state.pos;
          const end = this.input.indexOf(commentEnd, start + 2);
          if (end === -1) {
            throw this.raise(Errors.UnterminatedComment, this.state.curPosition());
          }
          this.state.pos = end + commentEnd.length;
          lineBreakG.lastIndex = start + 2;
          while (lineBreakG.test(this.input) && lineBreakG.lastIndex <= end) {
            ++this.state.curLine;
            this.state.lineStart = lineBreakG.lastIndex;
          }
          if (this.isLookahead) return;
          const comment = {
            type: "CommentBlock",
            value: this.input.slice(start + 2, end),
            start: this.sourceToOffsetPos(start),
            end: this.sourceToOffsetPos(end + commentEnd.length),
            loc: new SourceLocation(startLoc, this.state.curPosition())
          };
          if (this.optionFlags & 256) this.pushToken(comment);
          return comment;
        }
        skipLineComment(startSkip) {
          const start = this.state.pos;
          let startLoc;
          if (!this.isLookahead) startLoc = this.state.curPosition();
          let ch = this.input.charCodeAt(this.state.pos += startSkip);
          if (this.state.pos < this.length) {
            while (!isNewLine(ch) && ++this.state.pos < this.length) {
              ch = this.input.charCodeAt(this.state.pos);
            }
          }
          if (this.isLookahead) return;
          const end = this.state.pos;
          const value = this.input.slice(start + startSkip, end);
          const comment = {
            type: "CommentLine",
            value,
            start: this.sourceToOffsetPos(start),
            end: this.sourceToOffsetPos(end),
            loc: new SourceLocation(startLoc, this.state.curPosition())
          };
          if (this.optionFlags & 256) this.pushToken(comment);
          return comment;
        }
        skipSpace() {
          const spaceStart = this.state.pos;
          const comments = this.optionFlags & 4096 ? [] : null;
          loop: while (this.state.pos < this.length) {
            const ch = this.input.charCodeAt(this.state.pos);
            switch (ch) {
              case 32:
              case 160:
              case 9:
                ++this.state.pos;
                break;
              case 13:
                if (this.input.charCodeAt(this.state.pos + 1) === 10) {
                  ++this.state.pos;
                }
              case 10:
              case 8232:
              case 8233:
                ++this.state.pos;
                ++this.state.curLine;
                this.state.lineStart = this.state.pos;
                break;
              case 47:
                switch (this.input.charCodeAt(this.state.pos + 1)) {
                  case 42: {
                    const comment = this.skipBlockComment("*/");
                    if (comment !== void 0) {
                      this.addComment(comment);
                      comments == null || comments.push(comment);
                    }
                    break;
                  }
                  case 47: {
                    const comment = this.skipLineComment(2);
                    if (comment !== void 0) {
                      this.addComment(comment);
                      comments == null || comments.push(comment);
                    }
                    break;
                  }
                  default:
                    break loop;
                }
                break;
              default:
                if (isWhitespace(ch)) {
                  ++this.state.pos;
                } else if (ch === 45 && !this.inModule && this.optionFlags & 8192) {
                  const pos = this.state.pos;
                  if (this.input.charCodeAt(pos + 1) === 45 && this.input.charCodeAt(pos + 2) === 62 && (spaceStart === 0 || this.state.lineStart > spaceStart)) {
                    const comment = this.skipLineComment(3);
                    if (comment !== void 0) {
                      this.addComment(comment);
                      comments == null || comments.push(comment);
                    }
                  } else {
                    break loop;
                  }
                } else if (ch === 60 && !this.inModule && this.optionFlags & 8192) {
                  const pos = this.state.pos;
                  if (this.input.charCodeAt(pos + 1) === 33 && this.input.charCodeAt(pos + 2) === 45 && this.input.charCodeAt(pos + 3) === 45) {
                    const comment = this.skipLineComment(4);
                    if (comment !== void 0) {
                      this.addComment(comment);
                      comments == null || comments.push(comment);
                    }
                  } else {
                    break loop;
                  }
                } else {
                  break loop;
                }
            }
          }
          if ((comments == null ? void 0 : comments.length) > 0) {
            const end = this.state.pos;
            const commentWhitespace = {
              start: this.sourceToOffsetPos(spaceStart),
              end: this.sourceToOffsetPos(end),
              comments,
              leadingNode: null,
              trailingNode: null,
              containingNode: null
            };
            this.state.commentStack.push(commentWhitespace);
          }
        }
        finishToken(type, val) {
          this.state.end = this.state.pos;
          this.state.endLoc = this.state.curPosition();
          const prevType = this.state.type;
          this.state.type = type;
          this.state.value = val;
          if (!this.isLookahead) {
            this.updateContext(prevType);
          }
        }
        replaceToken(type) {
          this.state.type = type;
          this.updateContext();
        }
        readToken_numberSign() {
          if (this.state.pos === 0 && this.readToken_interpreter()) {
            return;
          }
          const nextPos = this.state.pos + 1;
          const next = this.codePointAtPos(nextPos);
          if (next >= 48 && next <= 57) {
            throw this.raise(Errors.UnexpectedDigitAfterHash, this.state.curPosition());
          }
          if (next === 123 || next === 91 && this.hasPlugin("recordAndTuple")) {
            this.expectPlugin("recordAndTuple");
            if (this.getPluginOption("recordAndTuple", "syntaxType") === "bar") {
              throw this.raise(next === 123 ? Errors.RecordExpressionHashIncorrectStartSyntaxType : Errors.TupleExpressionHashIncorrectStartSyntaxType, this.state.curPosition());
            }
            this.state.pos += 2;
            if (next === 123) {
              this.finishToken(7);
            } else {
              this.finishToken(1);
            }
          } else if (isIdentifierStart(next)) {
            ++this.state.pos;
            this.finishToken(139, this.readWord1(next));
          } else if (next === 92) {
            ++this.state.pos;
            this.finishToken(139, this.readWord1());
          } else {
            this.finishOp(27, 1);
          }
        }
        readToken_dot() {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (next >= 48 && next <= 57) {
            this.readNumber(true);
            return;
          }
          if (next === 46 && this.input.charCodeAt(this.state.pos + 2) === 46) {
            this.state.pos += 3;
            this.finishToken(21);
          } else {
            ++this.state.pos;
            this.finishToken(16);
          }
        }
        readToken_slash() {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (next === 61) {
            this.finishOp(31, 2);
          } else {
            this.finishOp(56, 1);
          }
        }
        readToken_interpreter() {
          if (this.state.pos !== 0 || this.length < 2) return false;
          let ch = this.input.charCodeAt(this.state.pos + 1);
          if (ch !== 33) return false;
          const start = this.state.pos;
          this.state.pos += 1;
          while (!isNewLine(ch) && ++this.state.pos < this.length) {
            ch = this.input.charCodeAt(this.state.pos);
          }
          const value = this.input.slice(start + 2, this.state.pos);
          this.finishToken(28, value);
          return true;
        }
        readToken_mult_modulo(code2) {
          let type = code2 === 42 ? 55 : 54;
          let width = 1;
          let next = this.input.charCodeAt(this.state.pos + 1);
          if (code2 === 42 && next === 42) {
            width++;
            next = this.input.charCodeAt(this.state.pos + 2);
            type = 57;
          }
          if (next === 61 && !this.state.inType) {
            width++;
            type = code2 === 37 ? 33 : 30;
          }
          this.finishOp(type, width);
        }
        readToken_pipe_amp(code2) {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (next === code2) {
            if (this.input.charCodeAt(this.state.pos + 2) === 61) {
              this.finishOp(30, 3);
            } else {
              this.finishOp(code2 === 124 ? 41 : 42, 2);
            }
            return;
          }
          if (code2 === 124) {
            if (next === 62) {
              this.finishOp(39, 2);
              return;
            }
            if (this.hasPlugin("recordAndTuple") && next === 125) {
              if (this.getPluginOption("recordAndTuple", "syntaxType") !== "bar") {
                throw this.raise(Errors.RecordExpressionBarIncorrectEndSyntaxType, this.state.curPosition());
              }
              this.state.pos += 2;
              this.finishToken(9);
              return;
            }
            if (this.hasPlugin("recordAndTuple") && next === 93) {
              if (this.getPluginOption("recordAndTuple", "syntaxType") !== "bar") {
                throw this.raise(Errors.TupleExpressionBarIncorrectEndSyntaxType, this.state.curPosition());
              }
              this.state.pos += 2;
              this.finishToken(4);
              return;
            }
          }
          if (next === 61) {
            this.finishOp(30, 2);
            return;
          }
          this.finishOp(code2 === 124 ? 43 : 45, 1);
        }
        readToken_caret() {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (next === 61 && !this.state.inType) {
            this.finishOp(32, 2);
          } else if (next === 94 && this.hasPlugin(["pipelineOperator", {
            proposal: "hack",
            topicToken: "^^"
          }])) {
            this.finishOp(37, 2);
            const lookaheadCh = this.input.codePointAt(this.state.pos);
            if (lookaheadCh === 94) {
              this.unexpected();
            }
          } else {
            this.finishOp(44, 1);
          }
        }
        readToken_atSign() {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (next === 64 && this.hasPlugin(["pipelineOperator", {
            proposal: "hack",
            topicToken: "@@"
          }])) {
            this.finishOp(38, 2);
          } else {
            this.finishOp(26, 1);
          }
        }
        readToken_plus_min(code2) {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (next === code2) {
            this.finishOp(34, 2);
            return;
          }
          if (next === 61) {
            this.finishOp(30, 2);
          } else {
            this.finishOp(53, 1);
          }
        }
        readToken_lt() {
          const {
            pos
          } = this.state;
          const next = this.input.charCodeAt(pos + 1);
          if (next === 60) {
            if (this.input.charCodeAt(pos + 2) === 61) {
              this.finishOp(30, 3);
              return;
            }
            this.finishOp(51, 2);
            return;
          }
          if (next === 61) {
            this.finishOp(49, 2);
            return;
          }
          this.finishOp(47, 1);
        }
        readToken_gt() {
          const {
            pos
          } = this.state;
          const next = this.input.charCodeAt(pos + 1);
          if (next === 62) {
            const size = this.input.charCodeAt(pos + 2) === 62 ? 3 : 2;
            if (this.input.charCodeAt(pos + size) === 61) {
              this.finishOp(30, size + 1);
              return;
            }
            this.finishOp(52, size);
            return;
          }
          if (next === 61) {
            this.finishOp(49, 2);
            return;
          }
          this.finishOp(48, 1);
        }
        readToken_eq_excl(code2) {
          const next = this.input.charCodeAt(this.state.pos + 1);
          if (next === 61) {
            this.finishOp(46, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);
            return;
          }
          if (code2 === 61 && next === 62) {
            this.state.pos += 2;
            this.finishToken(19);
            return;
          }
          this.finishOp(code2 === 61 ? 29 : 35, 1);
        }
        readToken_question() {
          const next = this.input.charCodeAt(this.state.pos + 1);
          const next2 = this.input.charCodeAt(this.state.pos + 2);
          if (next === 63) {
            if (next2 === 61) {
              this.finishOp(30, 3);
            } else {
              this.finishOp(40, 2);
            }
          } else if (next === 46 && !(next2 >= 48 && next2 <= 57)) {
            this.state.pos += 2;
            this.finishToken(18);
          } else {
            ++this.state.pos;
            this.finishToken(17);
          }
        }
        getTokenFromCode(code2) {
          switch (code2) {
            case 46:
              this.readToken_dot();
              return;
            case 40:
              ++this.state.pos;
              this.finishToken(10);
              return;
            case 41:
              ++this.state.pos;
              this.finishToken(11);
              return;
            case 59:
              ++this.state.pos;
              this.finishToken(13);
              return;
            case 44:
              ++this.state.pos;
              this.finishToken(12);
              return;
            case 91:
              if (this.hasPlugin("recordAndTuple") && this.input.charCodeAt(this.state.pos + 1) === 124) {
                if (this.getPluginOption("recordAndTuple", "syntaxType") !== "bar") {
                  throw this.raise(Errors.TupleExpressionBarIncorrectStartSyntaxType, this.state.curPosition());
                }
                this.state.pos += 2;
                this.finishToken(2);
              } else {
                ++this.state.pos;
                this.finishToken(0);
              }
              return;
            case 93:
              ++this.state.pos;
              this.finishToken(3);
              return;
            case 123:
              if (this.hasPlugin("recordAndTuple") && this.input.charCodeAt(this.state.pos + 1) === 124) {
                if (this.getPluginOption("recordAndTuple", "syntaxType") !== "bar") {
                  throw this.raise(Errors.RecordExpressionBarIncorrectStartSyntaxType, this.state.curPosition());
                }
                this.state.pos += 2;
                this.finishToken(6);
              } else {
                ++this.state.pos;
                this.finishToken(5);
              }
              return;
            case 125:
              ++this.state.pos;
              this.finishToken(8);
              return;
            case 58:
              if (this.hasPlugin("functionBind") && this.input.charCodeAt(this.state.pos + 1) === 58) {
                this.finishOp(15, 2);
              } else {
                ++this.state.pos;
                this.finishToken(14);
              }
              return;
            case 63:
              this.readToken_question();
              return;
            case 96:
              this.readTemplateToken();
              return;
            case 48: {
              const next = this.input.charCodeAt(this.state.pos + 1);
              if (next === 120 || next === 88) {
                this.readRadixNumber(16);
                return;
              }
              if (next === 111 || next === 79) {
                this.readRadixNumber(8);
                return;
              }
              if (next === 98 || next === 66) {
                this.readRadixNumber(2);
                return;
              }
            }
            case 49:
            case 50:
            case 51:
            case 52:
            case 53:
            case 54:
            case 55:
            case 56:
            case 57:
              this.readNumber(false);
              return;
            case 34:
            case 39:
              this.readString(code2);
              return;
            case 47:
              this.readToken_slash();
              return;
            case 37:
            case 42:
              this.readToken_mult_modulo(code2);
              return;
            case 124:
            case 38:
              this.readToken_pipe_amp(code2);
              return;
            case 94:
              this.readToken_caret();
              return;
            case 43:
            case 45:
              this.readToken_plus_min(code2);
              return;
            case 60:
              this.readToken_lt();
              return;
            case 62:
              this.readToken_gt();
              return;
            case 61:
            case 33:
              this.readToken_eq_excl(code2);
              return;
            case 126:
              this.finishOp(36, 1);
              return;
            case 64:
              this.readToken_atSign();
              return;
            case 35:
              this.readToken_numberSign();
              return;
            case 92:
              this.readWord();
              return;
            default:
              if (isIdentifierStart(code2)) {
                this.readWord(code2);
                return;
              }
          }
          throw this.raise(Errors.InvalidOrUnexpectedToken, this.state.curPosition(), {
            unexpected: String.fromCodePoint(code2)
          });
        }
        finishOp(type, size) {
          const str = this.input.slice(this.state.pos, this.state.pos + size);
          this.state.pos += size;
          this.finishToken(type, str);
        }
        readRegexp() {
          const startLoc = this.state.startLoc;
          const start = this.state.start + 1;
          let escaped, inClass;
          let {
            pos
          } = this.state;
          for (; ; ++pos) {
            if (pos >= this.length) {
              throw this.raise(Errors.UnterminatedRegExp, createPositionWithColumnOffset(startLoc, 1));
            }
            const ch = this.input.charCodeAt(pos);
            if (isNewLine(ch)) {
              throw this.raise(Errors.UnterminatedRegExp, createPositionWithColumnOffset(startLoc, 1));
            }
            if (escaped) {
              escaped = false;
            } else {
              if (ch === 91) {
                inClass = true;
              } else if (ch === 93 && inClass) {
                inClass = false;
              } else if (ch === 47 && !inClass) {
                break;
              }
              escaped = ch === 92;
            }
          }
          const content = this.input.slice(start, pos);
          ++pos;
          let mods = "";
          const nextPos = () => createPositionWithColumnOffset(startLoc, pos + 2 - start);
          while (pos < this.length) {
            const cp = this.codePointAtPos(pos);
            const char = String.fromCharCode(cp);
            if (VALID_REGEX_FLAGS.has(cp)) {
              if (cp === 118) {
                if (mods.includes("u")) {
                  this.raise(Errors.IncompatibleRegExpUVFlags, nextPos());
                }
              } else if (cp === 117) {
                if (mods.includes("v")) {
                  this.raise(Errors.IncompatibleRegExpUVFlags, nextPos());
                }
              }
              if (mods.includes(char)) {
                this.raise(Errors.DuplicateRegExpFlags, nextPos());
              }
            } else if (isIdentifierChar(cp) || cp === 92) {
              this.raise(Errors.MalformedRegExpFlags, nextPos());
            } else {
              break;
            }
            ++pos;
            mods += char;
          }
          this.state.pos = pos;
          this.finishToken(138, {
            pattern: content,
            flags: mods
          });
        }
        readInt(radix, len, forceLen = false, allowNumSeparator = true) {
          const {
            n,
            pos
          } = readInt(this.input, this.state.pos, this.state.lineStart, this.state.curLine, radix, len, forceLen, allowNumSeparator, this.errorHandlers_readInt, false);
          this.state.pos = pos;
          return n;
        }
        readRadixNumber(radix) {
          const start = this.state.pos;
          const startLoc = this.state.curPosition();
          let isBigInt = false;
          this.state.pos += 2;
          const val = this.readInt(radix);
          if (val == null) {
            this.raise(Errors.InvalidDigit, createPositionWithColumnOffset(startLoc, 2), {
              radix
            });
          }
          const next = this.input.charCodeAt(this.state.pos);
          if (next === 110) {
            ++this.state.pos;
            isBigInt = true;
          } else if (next === 109) {
            throw this.raise(Errors.InvalidDecimal, startLoc);
          }
          if (isIdentifierStart(this.codePointAtPos(this.state.pos))) {
            throw this.raise(Errors.NumberIdentifier, this.state.curPosition());
          }
          if (isBigInt) {
            const str = this.input.slice(start, this.state.pos).replace(/[_n]/g, "");
            this.finishToken(136, str);
            return;
          }
          this.finishToken(135, val);
        }
        readNumber(startsWithDot) {
          const start = this.state.pos;
          const startLoc = this.state.curPosition();
          let isFloat = false;
          let isBigInt = false;
          let hasExponent = false;
          let isOctal = false;
          if (!startsWithDot && this.readInt(10) === null) {
            this.raise(Errors.InvalidNumber, this.state.curPosition());
          }
          const hasLeadingZero = this.state.pos - start >= 2 && this.input.charCodeAt(start) === 48;
          if (hasLeadingZero) {
            const integer = this.input.slice(start, this.state.pos);
            this.recordStrictModeErrors(Errors.StrictOctalLiteral, startLoc);
            if (!this.state.strict) {
              const underscorePos = integer.indexOf("_");
              if (underscorePos > 0) {
                this.raise(Errors.ZeroDigitNumericSeparator, createPositionWithColumnOffset(startLoc, underscorePos));
              }
            }
            isOctal = hasLeadingZero && !/[89]/.test(integer);
          }
          let next = this.input.charCodeAt(this.state.pos);
          if (next === 46 && !isOctal) {
            ++this.state.pos;
            this.readInt(10);
            isFloat = true;
            next = this.input.charCodeAt(this.state.pos);
          }
          if ((next === 69 || next === 101) && !isOctal) {
            next = this.input.charCodeAt(++this.state.pos);
            if (next === 43 || next === 45) {
              ++this.state.pos;
            }
            if (this.readInt(10) === null) {
              this.raise(Errors.InvalidOrMissingExponent, startLoc);
            }
            isFloat = true;
            hasExponent = true;
            next = this.input.charCodeAt(this.state.pos);
          }
          if (next === 110) {
            if (isFloat || hasLeadingZero) {
              this.raise(Errors.InvalidBigIntLiteral, startLoc);
            }
            ++this.state.pos;
            isBigInt = true;
          }
          if (next === 109) {
            this.expectPlugin("decimal", this.state.curPosition());
            if (hasExponent || hasLeadingZero) {
              this.raise(Errors.InvalidDecimal, startLoc);
            }
            ++this.state.pos;
            var isDecimal = true;
          }
          if (isIdentifierStart(this.codePointAtPos(this.state.pos))) {
            throw this.raise(Errors.NumberIdentifier, this.state.curPosition());
          }
          const str = this.input.slice(start, this.state.pos).replace(/[_mn]/g, "");
          if (isBigInt) {
            this.finishToken(136, str);
            return;
          }
          if (isDecimal) {
            this.finishToken(137, str);
            return;
          }
          const val = isOctal ? parseInt(str, 8) : parseFloat(str);
          this.finishToken(135, val);
        }
        readCodePoint(throwOnInvalid) {
          const {
            code: code2,
            pos
          } = readCodePoint(this.input, this.state.pos, this.state.lineStart, this.state.curLine, throwOnInvalid, this.errorHandlers_readCodePoint);
          this.state.pos = pos;
          return code2;
        }
        readString(quote) {
          const {
            str,
            pos,
            curLine,
            lineStart
          } = readStringContents(quote === 34 ? "double" : "single", this.input, this.state.pos + 1, this.state.lineStart, this.state.curLine, this.errorHandlers_readStringContents_string);
          this.state.pos = pos + 1;
          this.state.lineStart = lineStart;
          this.state.curLine = curLine;
          this.finishToken(134, str);
        }
        readTemplateContinuation() {
          if (!this.match(8)) {
            this.unexpected(null, 8);
          }
          this.state.pos--;
          this.readTemplateToken();
        }
        readTemplateToken() {
          const opening = this.input[this.state.pos];
          const {
            str,
            firstInvalidLoc,
            pos,
            curLine,
            lineStart
          } = readStringContents("template", this.input, this.state.pos + 1, this.state.lineStart, this.state.curLine, this.errorHandlers_readStringContents_template);
          this.state.pos = pos + 1;
          this.state.lineStart = lineStart;
          this.state.curLine = curLine;
          if (firstInvalidLoc) {
            this.state.firstInvalidTemplateEscapePos = new Position(firstInvalidLoc.curLine, firstInvalidLoc.pos - firstInvalidLoc.lineStart, this.sourceToOffsetPos(firstInvalidLoc.pos));
          }
          if (this.input.codePointAt(pos) === 96) {
            this.finishToken(24, firstInvalidLoc ? null : opening + str + "`");
          } else {
            this.state.pos++;
            this.finishToken(25, firstInvalidLoc ? null : opening + str + "${");
          }
        }
        recordStrictModeErrors(toParseError, at) {
          const index = at.index;
          if (this.state.strict && !this.state.strictErrors.has(index)) {
            this.raise(toParseError, at);
          } else {
            this.state.strictErrors.set(index, [toParseError, at]);
          }
        }
        readWord1(firstCode) {
          this.state.containsEsc = false;
          let word = "";
          const start = this.state.pos;
          let chunkStart = this.state.pos;
          if (firstCode !== void 0) {
            this.state.pos += firstCode <= 65535 ? 1 : 2;
          }
          while (this.state.pos < this.length) {
            const ch = this.codePointAtPos(this.state.pos);
            if (isIdentifierChar(ch)) {
              this.state.pos += ch <= 65535 ? 1 : 2;
            } else if (ch === 92) {
              this.state.containsEsc = true;
              word += this.input.slice(chunkStart, this.state.pos);
              const escStart = this.state.curPosition();
              const identifierCheck = this.state.pos === start ? isIdentifierStart : isIdentifierChar;
              if (this.input.charCodeAt(++this.state.pos) !== 117) {
                this.raise(Errors.MissingUnicodeEscape, this.state.curPosition());
                chunkStart = this.state.pos - 1;
                continue;
              }
              ++this.state.pos;
              const esc = this.readCodePoint(true);
              if (esc !== null) {
                if (!identifierCheck(esc)) {
                  this.raise(Errors.EscapedCharNotAnIdentifier, escStart);
                }
                word += String.fromCodePoint(esc);
              }
              chunkStart = this.state.pos;
            } else {
              break;
            }
          }
          return word + this.input.slice(chunkStart, this.state.pos);
        }
        readWord(firstCode) {
          const word = this.readWord1(firstCode);
          const type = keywords$1.get(word);
          if (type !== void 0) {
            this.finishToken(type, tokenLabelName(type));
          } else {
            this.finishToken(132, word);
          }
        }
        checkKeywordEscapes() {
          const {
            type
          } = this.state;
          if (tokenIsKeyword(type) && this.state.containsEsc) {
            this.raise(Errors.InvalidEscapedReservedWord, this.state.startLoc, {
              reservedWord: tokenLabelName(type)
            });
          }
        }
        raise(toParseError, at, details = {}) {
          const loc = at instanceof Position ? at : at.loc.start;
          const error = toParseError(loc, details);
          if (!(this.optionFlags & 2048)) throw error;
          if (!this.isLookahead) this.state.errors.push(error);
          return error;
        }
        raiseOverwrite(toParseError, at, details = {}) {
          const loc = at instanceof Position ? at : at.loc.start;
          const pos = loc.index;
          const errors = this.state.errors;
          for (let i = errors.length - 1; i >= 0; i--) {
            const error = errors[i];
            if (error.loc.index === pos) {
              return errors[i] = toParseError(loc, details);
            }
            if (error.loc.index < pos) break;
          }
          return this.raise(toParseError, at, details);
        }
        updateContext(prevType) {
        }
        unexpected(loc, type) {
          throw this.raise(Errors.UnexpectedToken, loc != null ? loc : this.state.startLoc, {
            expected: type ? tokenLabelName(type) : null
          });
        }
        expectPlugin(pluginName, loc) {
          if (this.hasPlugin(pluginName)) {
            return true;
          }
          throw this.raise(Errors.MissingPlugin, loc != null ? loc : this.state.startLoc, {
            missingPlugin: [pluginName]
          });
        }
        expectOnePlugin(pluginNames) {
          if (!pluginNames.some((name) => this.hasPlugin(name))) {
            throw this.raise(Errors.MissingOneOfPlugins, this.state.startLoc, {
              missingPlugin: pluginNames
            });
          }
        }
        errorBuilder(error) {
          return (pos, lineStart, curLine) => {
            this.raise(error, buildPosition(pos, lineStart, curLine));
          };
        }
      };
      var ClassScope2 = class {
        constructor() {
          this.privateNames = /* @__PURE__ */ new Set();
          this.loneAccessors = /* @__PURE__ */ new Map();
          this.undefinedPrivateNames = /* @__PURE__ */ new Map();
        }
      };
      var ClassScopeHandler = class {
        constructor(parser) {
          this.parser = void 0;
          this.stack = [];
          this.undefinedPrivateNames = /* @__PURE__ */ new Map();
          this.parser = parser;
        }
        current() {
          return this.stack[this.stack.length - 1];
        }
        enter() {
          this.stack.push(new ClassScope2());
        }
        exit() {
          const oldClassScope = this.stack.pop();
          const current = this.current();
          for (const [name, loc] of Array.from(oldClassScope.undefinedPrivateNames)) {
            if (current) {
              if (!current.undefinedPrivateNames.has(name)) {
                current.undefinedPrivateNames.set(name, loc);
              }
            } else {
              this.parser.raise(Errors.InvalidPrivateFieldResolution, loc, {
                identifierName: name
              });
            }
          }
        }
        declarePrivateName(name, elementType, loc) {
          const {
            privateNames,
            loneAccessors,
            undefinedPrivateNames
          } = this.current();
          let redefined = privateNames.has(name);
          if (elementType & 3) {
            const accessor = redefined && loneAccessors.get(name);
            if (accessor) {
              const oldStatic = accessor & 4;
              const newStatic = elementType & 4;
              const oldKind = accessor & 3;
              const newKind = elementType & 3;
              redefined = oldKind === newKind || oldStatic !== newStatic;
              if (!redefined) loneAccessors.delete(name);
            } else if (!redefined) {
              loneAccessors.set(name, elementType);
            }
          }
          if (redefined) {
            this.parser.raise(Errors.PrivateNameRedeclaration, loc, {
              identifierName: name
            });
          }
          privateNames.add(name);
          undefinedPrivateNames.delete(name);
        }
        usePrivateName(name, loc) {
          let classScope;
          for (classScope of this.stack) {
            if (classScope.privateNames.has(name)) return;
          }
          if (classScope) {
            classScope.undefinedPrivateNames.set(name, loc);
          } else {
            this.parser.raise(Errors.InvalidPrivateFieldResolution, loc, {
              identifierName: name
            });
          }
        }
      };
      var ExpressionScope = class {
        constructor(type = 0) {
          this.type = type;
        }
        canBeArrowParameterDeclaration() {
          return this.type === 2 || this.type === 1;
        }
        isCertainlyParameterDeclaration() {
          return this.type === 3;
        }
      };
      var ArrowHeadParsingScope = class extends ExpressionScope {
        constructor(type) {
          super(type);
          this.declarationErrors = /* @__PURE__ */ new Map();
        }
        recordDeclarationError(ParsingErrorClass, at) {
          const index = at.index;
          this.declarationErrors.set(index, [ParsingErrorClass, at]);
        }
        clearDeclarationError(index) {
          this.declarationErrors.delete(index);
        }
        iterateErrors(iterator) {
          this.declarationErrors.forEach(iterator);
        }
      };
      var ExpressionScopeHandler = class {
        constructor(parser) {
          this.parser = void 0;
          this.stack = [new ExpressionScope()];
          this.parser = parser;
        }
        enter(scope) {
          this.stack.push(scope);
        }
        exit() {
          this.stack.pop();
        }
        recordParameterInitializerError(toParseError, node) {
          const origin = node.loc.start;
          const {
            stack
          } = this;
          let i = stack.length - 1;
          let scope = stack[i];
          while (!scope.isCertainlyParameterDeclaration()) {
            if (scope.canBeArrowParameterDeclaration()) {
              scope.recordDeclarationError(toParseError, origin);
            } else {
              return;
            }
            scope = stack[--i];
          }
          this.parser.raise(toParseError, origin);
        }
        recordArrowParameterBindingError(error, node) {
          const {
            stack
          } = this;
          const scope = stack[stack.length - 1];
          const origin = node.loc.start;
          if (scope.isCertainlyParameterDeclaration()) {
            this.parser.raise(error, origin);
          } else if (scope.canBeArrowParameterDeclaration()) {
            scope.recordDeclarationError(error, origin);
          } else {
            return;
          }
        }
        recordAsyncArrowParametersError(at) {
          const {
            stack
          } = this;
          let i = stack.length - 1;
          let scope = stack[i];
          while (scope.canBeArrowParameterDeclaration()) {
            if (scope.type === 2) {
              scope.recordDeclarationError(Errors.AwaitBindingIdentifier, at);
            }
            scope = stack[--i];
          }
        }
        validateAsPattern() {
          const {
            stack
          } = this;
          const currentScope = stack[stack.length - 1];
          if (!currentScope.canBeArrowParameterDeclaration()) return;
          currentScope.iterateErrors(([toParseError, loc]) => {
            this.parser.raise(toParseError, loc);
            let i = stack.length - 2;
            let scope = stack[i];
            while (scope.canBeArrowParameterDeclaration()) {
              scope.clearDeclarationError(loc.index);
              scope = stack[--i];
            }
          });
        }
      };
      function newParameterDeclarationScope() {
        return new ExpressionScope(3);
      }
      function newArrowHeadScope() {
        return new ArrowHeadParsingScope(1);
      }
      function newAsyncArrowScope() {
        return new ArrowHeadParsingScope(2);
      }
      function newExpressionScope() {
        return new ExpressionScope();
      }
      var UtilParser = class extends Tokenizer {
        addExtra(node, key, value, enumerable = true) {
          if (!node) return;
          let {
            extra
          } = node;
          if (extra == null) {
            extra = {};
            node.extra = extra;
          }
          if (enumerable) {
            extra[key] = value;
          } else {
            Object.defineProperty(extra, key, {
              enumerable,
              value
            });
          }
        }
        isContextual(token) {
          return this.state.type === token && !this.state.containsEsc;
        }
        isUnparsedContextual(nameStart, name) {
          if (this.input.startsWith(name, nameStart)) {
            const nextCh = this.input.charCodeAt(nameStart + name.length);
            return !(isIdentifierChar(nextCh) || (nextCh & 64512) === 55296);
          }
          return false;
        }
        isLookaheadContextual(name) {
          const next = this.nextTokenStart();
          return this.isUnparsedContextual(next, name);
        }
        eatContextual(token) {
          if (this.isContextual(token)) {
            this.next();
            return true;
          }
          return false;
        }
        expectContextual(token, toParseError) {
          if (!this.eatContextual(token)) {
            if (toParseError != null) {
              throw this.raise(toParseError, this.state.startLoc);
            }
            this.unexpected(null, token);
          }
        }
        canInsertSemicolon() {
          return this.match(140) || this.match(8) || this.hasPrecedingLineBreak();
        }
        hasPrecedingLineBreak() {
          return hasNewLine(this.input, this.offsetToSourcePos(this.state.lastTokEndLoc.index), this.state.start);
        }
        hasFollowingLineBreak() {
          return hasNewLine(this.input, this.state.end, this.nextTokenStart());
        }
        isLineTerminator() {
          return this.eat(13) || this.canInsertSemicolon();
        }
        semicolon(allowAsi = true) {
          if (allowAsi ? this.isLineTerminator() : this.eat(13)) return;
          this.raise(Errors.MissingSemicolon, this.state.lastTokEndLoc);
        }
        expect(type, loc) {
          if (!this.eat(type)) {
            this.unexpected(loc, type);
          }
        }
        tryParse(fn, oldState = this.state.clone()) {
          const abortSignal = {
            node: null
          };
          try {
            const node = fn((node2 = null) => {
              abortSignal.node = node2;
              throw abortSignal;
            });
            if (this.state.errors.length > oldState.errors.length) {
              const failState = this.state;
              this.state = oldState;
              this.state.tokensLength = failState.tokensLength;
              return {
                node,
                error: failState.errors[oldState.errors.length],
                thrown: false,
                aborted: false,
                failState
              };
            }
            return {
              node,
              error: null,
              thrown: false,
              aborted: false,
              failState: null
            };
          } catch (error) {
            const failState = this.state;
            this.state = oldState;
            if (error instanceof SyntaxError) {
              return {
                node: null,
                error,
                thrown: true,
                aborted: false,
                failState
              };
            }
            if (error === abortSignal) {
              return {
                node: abortSignal.node,
                error: null,
                thrown: false,
                aborted: true,
                failState
              };
            }
            throw error;
          }
        }
        checkExpressionErrors(refExpressionErrors, andThrow) {
          if (!refExpressionErrors) return false;
          const {
            shorthandAssignLoc,
            doubleProtoLoc,
            privateKeyLoc,
            optionalParametersLoc,
            voidPatternLoc
          } = refExpressionErrors;
          const hasErrors = !!shorthandAssignLoc || !!doubleProtoLoc || !!optionalParametersLoc || !!privateKeyLoc || !!voidPatternLoc;
          if (!andThrow) {
            return hasErrors;
          }
          if (shorthandAssignLoc != null) {
            this.raise(Errors.InvalidCoverInitializedName, shorthandAssignLoc);
          }
          if (doubleProtoLoc != null) {
            this.raise(Errors.DuplicateProto, doubleProtoLoc);
          }
          if (privateKeyLoc != null) {
            this.raise(Errors.UnexpectedPrivateField, privateKeyLoc);
          }
          if (optionalParametersLoc != null) {
            this.unexpected(optionalParametersLoc);
          }
          if (voidPatternLoc != null) {
            this.raise(Errors.InvalidCoverDiscardElement, voidPatternLoc);
          }
        }
        isLiteralPropertyName() {
          return tokenIsLiteralPropertyName(this.state.type);
        }
        isPrivateName(node) {
          return node.type === "PrivateName";
        }
        getPrivateNameSV(node) {
          return node.id.name;
        }
        hasPropertyAsPrivateName(node) {
          return (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && this.isPrivateName(node.property);
        }
        isObjectProperty(node) {
          return node.type === "ObjectProperty";
        }
        isObjectMethod(node) {
          return node.type === "ObjectMethod";
        }
        initializeScopes(inModule = this.options.sourceType === "module") {
          const oldLabels = this.state.labels;
          this.state.labels = [];
          const oldExportedIdentifiers = this.exportedIdentifiers;
          this.exportedIdentifiers = /* @__PURE__ */ new Set();
          const oldInModule = this.inModule;
          this.inModule = inModule;
          const oldScope = this.scope;
          const ScopeHandler2 = this.getScopeHandler();
          this.scope = new ScopeHandler2(this, inModule);
          const oldProdParam = this.prodParam;
          this.prodParam = new ProductionParameterHandler();
          const oldClassScope = this.classScope;
          this.classScope = new ClassScopeHandler(this);
          const oldExpressionScope = this.expressionScope;
          this.expressionScope = new ExpressionScopeHandler(this);
          return () => {
            this.state.labels = oldLabels;
            this.exportedIdentifiers = oldExportedIdentifiers;
            this.inModule = oldInModule;
            this.scope = oldScope;
            this.prodParam = oldProdParam;
            this.classScope = oldClassScope;
            this.expressionScope = oldExpressionScope;
          };
        }
        enterInitialScopes() {
          let paramFlags = 0;
          if (this.inModule || this.optionFlags & 1) {
            paramFlags |= 2;
          }
          if (this.optionFlags & 32) {
            paramFlags |= 1;
          }
          const isCommonJS = !this.inModule && this.options.sourceType === "commonjs";
          if (isCommonJS || this.optionFlags & 2) {
            paramFlags |= 4;
          }
          this.prodParam.enter(paramFlags);
          let scopeFlags = isCommonJS ? 514 : 1;
          if (this.optionFlags & 4) {
            scopeFlags |= 512;
          }
          this.scope.enter(scopeFlags);
        }
        checkDestructuringPrivate(refExpressionErrors) {
          const {
            privateKeyLoc
          } = refExpressionErrors;
          if (privateKeyLoc !== null) {
            this.expectPlugin("destructuringPrivate", privateKeyLoc);
          }
        }
      };
      var ExpressionErrors = class {
        constructor() {
          this.shorthandAssignLoc = null;
          this.doubleProtoLoc = null;
          this.privateKeyLoc = null;
          this.optionalParametersLoc = null;
          this.voidPatternLoc = null;
        }
      };
      var Node = class {
        constructor(parser, pos, loc) {
          this.type = "";
          this.start = pos;
          this.end = 0;
          this.loc = new SourceLocation(loc);
          if ((parser == null ? void 0 : parser.optionFlags) & 128) this.range = [pos, 0];
          if (parser != null && parser.filename) this.loc.filename = parser.filename;
        }
      };
      var NodePrototype = Node.prototype;
      NodePrototype.__clone = function() {
        const newNode = new Node(void 0, this.start, this.loc.start);
        const keys = Object.keys(this);
        for (let i = 0, length = keys.length; i < length; i++) {
          const key = keys[i];
          if (key !== "leadingComments" && key !== "trailingComments" && key !== "innerComments") {
            newNode[key] = this[key];
          }
        }
        return newNode;
      };
      var NodeUtils = class extends UtilParser {
        startNode() {
          const loc = this.state.startLoc;
          return new Node(this, loc.index, loc);
        }
        startNodeAt(loc) {
          return new Node(this, loc.index, loc);
        }
        startNodeAtNode(type) {
          return this.startNodeAt(type.loc.start);
        }
        finishNode(node, type) {
          return this.finishNodeAt(node, type, this.state.lastTokEndLoc);
        }
        finishNodeAt(node, type, endLoc) {
          node.type = type;
          node.end = endLoc.index;
          node.loc.end = endLoc;
          if (this.optionFlags & 128) node.range[1] = endLoc.index;
          if (this.optionFlags & 4096) {
            this.processComment(node);
          }
          return node;
        }
        resetStartLocation(node, startLoc) {
          node.start = startLoc.index;
          node.loc.start = startLoc;
          if (this.optionFlags & 128) node.range[0] = startLoc.index;
        }
        resetEndLocation(node, endLoc = this.state.lastTokEndLoc) {
          node.end = endLoc.index;
          node.loc.end = endLoc;
          if (this.optionFlags & 128) node.range[1] = endLoc.index;
        }
        resetStartLocationFromNode(node, locationNode) {
          this.resetStartLocation(node, locationNode.loc.start);
        }
        castNodeTo(node, type) {
          node.type = type;
          return node;
        }
        cloneIdentifier(node) {
          const {
            type,
            start,
            end,
            loc,
            range,
            name
          } = node;
          const cloned = Object.create(NodePrototype);
          cloned.type = type;
          cloned.start = start;
          cloned.end = end;
          cloned.loc = loc;
          cloned.range = range;
          cloned.name = name;
          if (node.extra) cloned.extra = node.extra;
          return cloned;
        }
        cloneStringLiteral(node) {
          const {
            type,
            start,
            end,
            loc,
            range,
            extra
          } = node;
          const cloned = Object.create(NodePrototype);
          cloned.type = type;
          cloned.start = start;
          cloned.end = end;
          cloned.loc = loc;
          cloned.range = range;
          cloned.extra = extra;
          cloned.value = node.value;
          return cloned;
        }
      };
      var unwrapParenthesizedExpression = (node) => {
        return node.type === "ParenthesizedExpression" ? unwrapParenthesizedExpression(node.expression) : node;
      };
      var LValParser = class extends NodeUtils {
        toAssignable(node, isLHS = false) {
          var _node$extra, _node$extra3;
          let parenthesized = void 0;
          if (node.type === "ParenthesizedExpression" || (_node$extra = node.extra) != null && _node$extra.parenthesized) {
            parenthesized = unwrapParenthesizedExpression(node);
            if (isLHS) {
              if (parenthesized.type === "Identifier") {
                this.expressionScope.recordArrowParameterBindingError(Errors.InvalidParenthesizedAssignment, node);
              } else if (parenthesized.type !== "CallExpression" && parenthesized.type !== "MemberExpression" && !this.isOptionalMemberExpression(parenthesized)) {
                this.raise(Errors.InvalidParenthesizedAssignment, node);
              }
            } else {
              this.raise(Errors.InvalidParenthesizedAssignment, node);
            }
          }
          switch (node.type) {
            case "Identifier":
            case "ObjectPattern":
            case "ArrayPattern":
            case "AssignmentPattern":
            case "RestElement":
            case "VoidPattern":
              break;
            case "ObjectExpression":
              this.castNodeTo(node, "ObjectPattern");
              for (let i = 0, length = node.properties.length, last = length - 1; i < length; i++) {
                var _node$extra2;
                const prop = node.properties[i];
                const isLast = i === last;
                this.toAssignableObjectExpressionProp(prop, isLast, isLHS);
                if (isLast && prop.type === "RestElement" && (_node$extra2 = node.extra) != null && _node$extra2.trailingCommaLoc) {
                  this.raise(Errors.RestTrailingComma, node.extra.trailingCommaLoc);
                }
              }
              break;
            case "ObjectProperty": {
              const {
                key,
                value
              } = node;
              if (this.isPrivateName(key)) {
                this.classScope.usePrivateName(this.getPrivateNameSV(key), key.loc.start);
              }
              this.toAssignable(value, isLHS);
              break;
            }
            case "SpreadElement": {
              throw new Error("Internal @babel/parser error (this is a bug, please report it). SpreadElement should be converted by .toAssignable's caller.");
            }
            case "ArrayExpression":
              this.castNodeTo(node, "ArrayPattern");
              this.toAssignableList(node.elements, (_node$extra3 = node.extra) == null ? void 0 : _node$extra3.trailingCommaLoc, isLHS);
              break;
            case "AssignmentExpression":
              if (node.operator !== "=") {
                this.raise(Errors.MissingEqInAssignment, node.left.loc.end);
              }
              this.castNodeTo(node, "AssignmentPattern");
              delete node.operator;
              if (node.left.type === "VoidPattern") {
                this.raise(Errors.VoidPatternInitializer, node.left);
              }
              this.toAssignable(node.left, isLHS);
              break;
            case "ParenthesizedExpression":
              this.toAssignable(parenthesized, isLHS);
              break;
          }
        }
        toAssignableObjectExpressionProp(prop, isLast, isLHS) {
          if (prop.type === "ObjectMethod") {
            this.raise(prop.kind === "get" || prop.kind === "set" ? Errors.PatternHasAccessor : Errors.PatternHasMethod, prop.key);
          } else if (prop.type === "SpreadElement") {
            this.castNodeTo(prop, "RestElement");
            const arg = prop.argument;
            this.checkToRestConversion(arg, false);
            this.toAssignable(arg, isLHS);
            if (!isLast) {
              this.raise(Errors.RestTrailingComma, prop);
            }
          } else {
            this.toAssignable(prop, isLHS);
          }
        }
        toAssignableList(exprList, trailingCommaLoc, isLHS) {
          const end = exprList.length - 1;
          for (let i = 0; i <= end; i++) {
            const elt = exprList[i];
            if (!elt) continue;
            this.toAssignableListItem(exprList, i, isLHS);
            if (elt.type === "RestElement") {
              if (i < end) {
                this.raise(Errors.RestTrailingComma, elt);
              } else if (trailingCommaLoc) {
                this.raise(Errors.RestTrailingComma, trailingCommaLoc);
              }
            }
          }
        }
        toAssignableListItem(exprList, index, isLHS) {
          const node = exprList[index];
          if (node.type === "SpreadElement") {
            this.castNodeTo(node, "RestElement");
            const arg = node.argument;
            this.checkToRestConversion(arg, true);
            this.toAssignable(arg, isLHS);
          } else {
            this.toAssignable(node, isLHS);
          }
        }
        isAssignable(node, isBinding) {
          switch (node.type) {
            case "Identifier":
            case "ObjectPattern":
            case "ArrayPattern":
            case "AssignmentPattern":
            case "RestElement":
            case "VoidPattern":
              return true;
            case "ObjectExpression": {
              const last = node.properties.length - 1;
              return node.properties.every((prop, i) => {
                return prop.type !== "ObjectMethod" && (i === last || prop.type !== "SpreadElement") && this.isAssignable(prop);
              });
            }
            case "ObjectProperty":
              return this.isAssignable(node.value);
            case "SpreadElement":
              return this.isAssignable(node.argument);
            case "ArrayExpression":
              return node.elements.every((element) => element === null || this.isAssignable(element));
            case "AssignmentExpression":
              return node.operator === "=";
            case "ParenthesizedExpression":
              return this.isAssignable(node.expression);
            case "MemberExpression":
            case "OptionalMemberExpression":
              return !isBinding;
            default:
              return false;
          }
        }
        toReferencedList(exprList, isParenthesizedExpr) {
          return exprList;
        }
        toReferencedListDeep(exprList, isParenthesizedExpr) {
          this.toReferencedList(exprList, isParenthesizedExpr);
          for (const expr of exprList) {
            if ((expr == null ? void 0 : expr.type) === "ArrayExpression") {
              this.toReferencedListDeep(expr.elements);
            }
          }
        }
        parseSpread(refExpressionErrors) {
          const node = this.startNode();
          this.next();
          node.argument = this.parseMaybeAssignAllowIn(refExpressionErrors, void 0);
          return this.finishNode(node, "SpreadElement");
        }
        parseRestBinding() {
          const node = this.startNode();
          this.next();
          const argument = this.parseBindingAtom();
          if (argument.type === "VoidPattern") {
            this.raise(Errors.UnexpectedVoidPattern, argument);
          }
          node.argument = argument;
          return this.finishNode(node, "RestElement");
        }
        parseBindingAtom() {
          switch (this.state.type) {
            case 0: {
              const node = this.startNode();
              this.next();
              node.elements = this.parseBindingList(3, 93, 1);
              return this.finishNode(node, "ArrayPattern");
            }
            case 5:
              return this.parseObjectLike(8, true);
            case 88:
              return this.parseVoidPattern(null);
          }
          return this.parseIdentifier();
        }
        parseBindingList(close, closeCharCode, flags) {
          const allowEmpty = flags & 1;
          const elts = [];
          let first = true;
          while (!this.eat(close)) {
            if (first) {
              first = false;
            } else {
              this.expect(12);
            }
            if (allowEmpty && this.match(12)) {
              elts.push(null);
            } else if (this.eat(close)) {
              break;
            } else if (this.match(21)) {
              let rest = this.parseRestBinding();
              if (this.hasPlugin("flow") || flags & 2) {
                rest = this.parseFunctionParamType(rest);
              }
              elts.push(rest);
              if (!this.checkCommaAfterRest(closeCharCode)) {
                this.expect(close);
                break;
              }
            } else {
              const decorators = [];
              if (flags & 2) {
                if (this.match(26) && this.hasPlugin("decorators")) {
                  this.raise(Errors.UnsupportedParameterDecorator, this.state.startLoc);
                }
                while (this.match(26)) {
                  decorators.push(this.parseDecorator());
                }
              }
              elts.push(this.parseBindingElement(flags, decorators));
            }
          }
          return elts;
        }
        parseBindingRestProperty(prop) {
          this.next();
          if (this.hasPlugin("discardBinding") && this.match(88)) {
            prop.argument = this.parseVoidPattern(null);
            this.raise(Errors.UnexpectedVoidPattern, prop.argument);
          } else {
            prop.argument = this.parseIdentifier();
          }
          this.checkCommaAfterRest(125);
          return this.finishNode(prop, "RestElement");
        }
        parseBindingProperty() {
          const {
            type,
            startLoc
          } = this.state;
          if (type === 21) {
            return this.parseBindingRestProperty(this.startNode());
          }
          const prop = this.startNode();
          if (type === 139) {
            this.expectPlugin("destructuringPrivate", startLoc);
            this.classScope.usePrivateName(this.state.value, startLoc);
            prop.key = this.parsePrivateName();
          } else {
            this.parsePropertyName(prop);
          }
          prop.method = false;
          return this.parseObjPropValue(prop, startLoc, false, false, true, false);
        }
        parseBindingElement(flags, decorators) {
          const left = this.parseMaybeDefault();
          if (this.hasPlugin("flow") || flags & 2) {
            this.parseFunctionParamType(left);
          }
          if (decorators.length) {
            left.decorators = decorators;
            this.resetStartLocationFromNode(left, decorators[0]);
          }
          const elt = this.parseMaybeDefault(left.loc.start, left);
          return elt;
        }
        parseFunctionParamType(param) {
          return param;
        }
        parseMaybeDefault(startLoc, left) {
          startLoc != null ? startLoc : startLoc = this.state.startLoc;
          left = left != null ? left : this.parseBindingAtom();
          if (!this.eat(29)) return left;
          const node = this.startNodeAt(startLoc);
          if (left.type === "VoidPattern") {
            this.raise(Errors.VoidPatternInitializer, left);
          }
          node.left = left;
          node.right = this.parseMaybeAssignAllowIn();
          return this.finishNode(node, "AssignmentPattern");
        }
        isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding) {
          switch (type) {
            case "AssignmentPattern":
              return "left";
            case "RestElement":
              return "argument";
            case "ObjectProperty":
              return "value";
            case "ParenthesizedExpression":
              return "expression";
            case "ArrayPattern":
              return "elements";
            case "ObjectPattern":
              return "properties";
            case "VoidPattern":
              return true;
            case "CallExpression":
              if (!disallowCallExpression && !this.state.strict && this.optionFlags & 8192) {
                return true;
              }
          }
          return false;
        }
        isOptionalMemberExpression(expression) {
          return expression.type === "OptionalMemberExpression";
        }
        checkLVal(expression, ancestor, binding = 64, checkClashes = false, strictModeChanged = false, hasParenthesizedAncestor = false, disallowCallExpression = false) {
          var _expression$extra;
          const type = expression.type;
          if (this.isObjectMethod(expression)) return;
          const isOptionalMemberExpression = this.isOptionalMemberExpression(expression);
          if (isOptionalMemberExpression || type === "MemberExpression") {
            if (isOptionalMemberExpression) {
              this.expectPlugin("optionalChainingAssign", expression.loc.start);
              if (ancestor.type !== "AssignmentExpression") {
                this.raise(Errors.InvalidLhsOptionalChaining, expression, {
                  ancestor
                });
              }
            }
            if (binding !== 64) {
              this.raise(Errors.InvalidPropertyBindingPattern, expression);
            }
            return;
          }
          if (type === "Identifier") {
            this.checkIdentifier(expression, binding, strictModeChanged);
            const {
              name
            } = expression;
            if (checkClashes) {
              if (checkClashes.has(name)) {
                this.raise(Errors.ParamDupe, expression);
              } else {
                checkClashes.add(name);
              }
            }
            return;
          } else if (type === "VoidPattern" && ancestor.type === "CatchClause") {
            this.raise(Errors.VoidPatternCatchClauseParam, expression);
          }
          const unwrappedExpression = unwrapParenthesizedExpression(expression);
          disallowCallExpression || (disallowCallExpression = unwrappedExpression.type === "CallExpression" && (unwrappedExpression.callee.type === "Import" || unwrappedExpression.callee.type === "Super"));
          const validity = this.isValidLVal(type, disallowCallExpression, !(hasParenthesizedAncestor || (_expression$extra = expression.extra) != null && _expression$extra.parenthesized) && ancestor.type === "AssignmentExpression", binding);
          if (validity === true) return;
          if (validity === false) {
            const ParseErrorClass = binding === 64 ? Errors.InvalidLhs : Errors.InvalidLhsBinding;
            this.raise(ParseErrorClass, expression, {
              ancestor
            });
            return;
          }
          let key, isParenthesizedExpression;
          if (typeof validity === "string") {
            key = validity;
            isParenthesizedExpression = type === "ParenthesizedExpression";
          } else {
            [key, isParenthesizedExpression] = validity;
          }
          const nextAncestor = type === "ArrayPattern" || type === "ObjectPattern" ? {
            type
          } : ancestor;
          const val = expression[key];
          if (Array.isArray(val)) {
            for (const child of val) {
              if (child) {
                this.checkLVal(child, nextAncestor, binding, checkClashes, strictModeChanged, isParenthesizedExpression, true);
              }
            }
          } else if (val) {
            this.checkLVal(val, nextAncestor, binding, checkClashes, strictModeChanged, isParenthesizedExpression, disallowCallExpression);
          }
        }
        checkIdentifier(at, bindingType, strictModeChanged = false) {
          if (this.state.strict && (strictModeChanged ? isStrictBindReservedWord(at.name, this.inModule) : isStrictBindOnlyReservedWord(at.name))) {
            if (bindingType === 64) {
              this.raise(Errors.StrictEvalArguments, at, {
                referenceName: at.name
              });
            } else {
              this.raise(Errors.StrictEvalArgumentsBinding, at, {
                bindingName: at.name
              });
            }
          }
          if (bindingType & 8192 && at.name === "let") {
            this.raise(Errors.LetInLexicalBinding, at);
          }
          if (!(bindingType & 64)) {
            this.declareNameFromIdentifier(at, bindingType);
          }
        }
        declareNameFromIdentifier(identifier, binding) {
          this.scope.declareName(identifier.name, binding, identifier.loc.start);
        }
        checkToRestConversion(node, allowPattern) {
          switch (node.type) {
            case "ParenthesizedExpression":
              this.checkToRestConversion(node.expression, allowPattern);
              break;
            case "Identifier":
            case "MemberExpression":
              break;
            case "ArrayExpression":
            case "ObjectExpression":
              if (allowPattern) break;
            default:
              this.raise(Errors.InvalidRestAssignmentPattern, node);
          }
        }
        checkCommaAfterRest(close) {
          if (!this.match(12)) {
            return false;
          }
          this.raise(this.lookaheadCharCode() === close ? Errors.RestTrailingComma : Errors.ElementAfterRest, this.state.startLoc);
          return true;
        }
      };
      var keywordAndTSRelationalOperator = /in(?:stanceof)?|as|satisfies/y;
      function nonNull(x) {
        if (x == null) {
          throw new Error(`Unexpected ${x} value.`);
        }
        return x;
      }
      function assert2(x) {
        if (!x) {
          throw new Error("Assert fail");
        }
      }
      var TSErrors = ParseErrorEnum`typescript`({
        AbstractMethodHasImplementation: ({
          methodName
        }) => `Method '${methodName}' cannot have an implementation because it is marked abstract.`,
        AbstractPropertyHasInitializer: ({
          propertyName
        }) => `Property '${propertyName}' cannot have an initializer because it is marked abstract.`,
        AccessorCannotBeOptional: "An 'accessor' property cannot be declared optional.",
        AccessorCannotDeclareThisParameter: "'get' and 'set' accessors cannot declare 'this' parameters.",
        AccessorCannotHaveTypeParameters: "An accessor cannot have type parameters.",
        ClassMethodHasDeclare: "Class methods cannot have the 'declare' modifier.",
        ClassMethodHasReadonly: "Class methods cannot have the 'readonly' modifier.",
        ConstInitializerMustBeStringOrNumericLiteralOrLiteralEnumReference: "A 'const' initializer in an ambient context must be a string or numeric literal or literal enum reference.",
        ConstructorHasTypeParameters: "Type parameters cannot appear on a constructor declaration.",
        DeclareAccessor: ({
          kind
        }) => `'declare' is not allowed in ${kind}ters.`,
        DeclareClassFieldHasInitializer: "Initializers are not allowed in ambient contexts.",
        DeclareFunctionHasImplementation: "An implementation cannot be declared in ambient contexts.",
        DuplicateAccessibilityModifier: ({
          modifier
        }) => `Accessibility modifier already seen: '${modifier}'.`,
        DuplicateModifier: ({
          modifier
        }) => `Duplicate modifier: '${modifier}'.`,
        EmptyHeritageClauseType: ({
          token
        }) => `'${token}' list cannot be empty.`,
        EmptyTypeArguments: "Type argument list cannot be empty.",
        EmptyTypeParameters: "Type parameter list cannot be empty.",
        ExpectedAmbientAfterExportDeclare: "'export declare' must be followed by an ambient declaration.",
        ImportAliasHasImportType: "An import alias can not use 'import type'.",
        ImportReflectionHasImportType: "An `import module` declaration can not use `type` modifier",
        IncompatibleModifiers: ({
          modifiers
        }) => `'${modifiers[0]}' modifier cannot be used with '${modifiers[1]}' modifier.`,
        IndexSignatureHasAbstract: "Index signatures cannot have the 'abstract' modifier.",
        IndexSignatureHasAccessibility: ({
          modifier
        }) => `Index signatures cannot have an accessibility modifier ('${modifier}').`,
        IndexSignatureHasDeclare: "Index signatures cannot have the 'declare' modifier.",
        IndexSignatureHasOverride: "'override' modifier cannot appear on an index signature.",
        IndexSignatureHasStatic: "Index signatures cannot have the 'static' modifier.",
        InitializerNotAllowedInAmbientContext: "Initializers are not allowed in ambient contexts.",
        InvalidHeritageClauseType: ({
          token
        }) => `'${token}' list can only include identifiers or qualified-names with optional type arguments.`,
        InvalidModifierOnAwaitUsingDeclaration: (modifier) => `'${modifier}' modifier cannot appear on an await using declaration.`,
        InvalidModifierOnTypeMember: ({
          modifier
        }) => `'${modifier}' modifier cannot appear on a type member.`,
        InvalidModifierOnTypeParameter: ({
          modifier
        }) => `'${modifier}' modifier cannot appear on a type parameter.`,
        InvalidModifierOnTypeParameterPositions: ({
          modifier
        }) => `'${modifier}' modifier can only appear on a type parameter of a class, interface or type alias.`,
        InvalidModifierOnUsingDeclaration: (modifier) => `'${modifier}' modifier cannot appear on a using declaration.`,
        InvalidModifiersOrder: ({
          orderedModifiers
        }) => `'${orderedModifiers[0]}' modifier must precede '${orderedModifiers[1]}' modifier.`,
        InvalidPropertyAccessAfterInstantiationExpression: "Invalid property access after an instantiation expression. You can either wrap the instantiation expression in parentheses, or delete the type arguments.",
        InvalidTupleMemberLabel: "Tuple members must be labeled with a simple identifier.",
        MissingInterfaceName: "'interface' declarations must be followed by an identifier.",
        NonAbstractClassHasAbstractMethod: "Abstract methods can only appear within an abstract class.",
        NonClassMethodPropertyHasAbstractModifier: "'abstract' modifier can only appear on a class, method, or property declaration.",
        OptionalTypeBeforeRequired: "A required element cannot follow an optional element.",
        OverrideNotInSubClass: "This member cannot have an 'override' modifier because its containing class does not extend another class.",
        PatternIsOptional: "A binding pattern parameter cannot be optional in an implementation signature.",
        PrivateElementHasAbstract: "Private elements cannot have the 'abstract' modifier.",
        PrivateElementHasAccessibility: ({
          modifier
        }) => `Private elements cannot have an accessibility modifier ('${modifier}').`,
        ReadonlyForMethodSignature: "'readonly' modifier can only appear on a property declaration or index signature.",
        ReservedArrowTypeParam: "This syntax is reserved in files with the .mts or .cts extension. Add a trailing comma, as in `<T,>() => ...`.",
        ReservedTypeAssertion: "This syntax is reserved in files with the .mts or .cts extension. Use an `as` expression instead.",
        SetAccessorCannotHaveOptionalParameter: "A 'set' accessor cannot have an optional parameter.",
        SetAccessorCannotHaveRestParameter: "A 'set' accessor cannot have rest parameter.",
        SetAccessorCannotHaveReturnType: "A 'set' accessor cannot have a return type annotation.",
        SingleTypeParameterWithoutTrailingComma: ({
          typeParameterName
        }) => `Single type parameter ${typeParameterName} should have a trailing comma. Example usage: <${typeParameterName},>.`,
        StaticBlockCannotHaveModifier: "Static class blocks cannot have any modifier.",
        TupleOptionalAfterType: "A labeled tuple optional element must be declared using a question mark after the name and before the colon (`name?: type`), rather than after the type (`name: type?`).",
        TypeAnnotationAfterAssign: "Type annotations must come before default assignments, e.g. instead of `age = 25: number` use `age: number = 25`.",
        TypeImportCannotSpecifyDefaultAndNamed: "A type-only import can specify a default import or named bindings, but not both.",
        TypeModifierIsUsedInTypeExports: "The 'type' modifier cannot be used on a named export when 'export type' is used on its export statement.",
        TypeModifierIsUsedInTypeImports: "The 'type' modifier cannot be used on a named import when 'import type' is used on its import statement.",
        UnexpectedParameterModifier: "A parameter property is only allowed in a constructor implementation.",
        UnexpectedReadonly: "'readonly' type modifier is only permitted on array and tuple literal types.",
        UnexpectedTypeAnnotation: "Did not expect a type annotation here.",
        UnexpectedTypeCastInParameter: "Unexpected type cast in parameter position.",
        UnsupportedImportTypeArgument: "Argument in a type import must be a string literal.",
        UnsupportedParameterPropertyKind: "A parameter property may not be declared using a binding pattern.",
        UnsupportedSignatureParameterKind: ({
          type
        }) => `Name in a signature must be an Identifier, ObjectPattern or ArrayPattern, instead got ${type}.`,
        UsingDeclarationInAmbientContext: (kind) => `'${kind}' declarations are not allowed in ambient contexts.`
      });
      function keywordTypeFromName(value) {
        switch (value) {
          case "any":
            return "TSAnyKeyword";
          case "boolean":
            return "TSBooleanKeyword";
          case "bigint":
            return "TSBigIntKeyword";
          case "never":
            return "TSNeverKeyword";
          case "number":
            return "TSNumberKeyword";
          case "object":
            return "TSObjectKeyword";
          case "string":
            return "TSStringKeyword";
          case "symbol":
            return "TSSymbolKeyword";
          case "undefined":
            return "TSUndefinedKeyword";
          case "unknown":
            return "TSUnknownKeyword";
          default:
            return void 0;
        }
      }
      function tsIsAccessModifier(modifier) {
        return modifier === "private" || modifier === "public" || modifier === "protected";
      }
      function tsIsVarianceAnnotations(modifier) {
        return modifier === "in" || modifier === "out";
      }
      var typescript = (superClass) => class TypeScriptParserMixin extends superClass {
        constructor(...args) {
          super(...args);
          this.tsParseInOutModifiers = this.tsParseModifiers.bind(this, {
            allowedModifiers: ["in", "out"],
            disallowedModifiers: ["const", "public", "private", "protected", "readonly", "declare", "abstract", "override"],
            errorTemplate: TSErrors.InvalidModifierOnTypeParameter
          });
          this.tsParseConstModifier = this.tsParseModifiers.bind(this, {
            allowedModifiers: ["const"],
            disallowedModifiers: ["in", "out"],
            errorTemplate: TSErrors.InvalidModifierOnTypeParameterPositions
          });
          this.tsParseInOutConstModifiers = this.tsParseModifiers.bind(this, {
            allowedModifiers: ["in", "out", "const"],
            disallowedModifiers: ["public", "private", "protected", "readonly", "declare", "abstract", "override"],
            errorTemplate: TSErrors.InvalidModifierOnTypeParameter
          });
        }
        getScopeHandler() {
          return TypeScriptScopeHandler;
        }
        tsIsIdentifier() {
          return tokenIsIdentifier(this.state.type);
        }
        tsTokenCanFollowModifier() {
          return this.match(0) || this.match(5) || this.match(55) || this.match(21) || this.match(139) || this.isLiteralPropertyName();
        }
        tsNextTokenOnSameLineAndCanFollowModifier() {
          this.next();
          if (this.hasPrecedingLineBreak()) {
            return false;
          }
          return this.tsTokenCanFollowModifier();
        }
        tsNextTokenCanFollowModifier() {
          if (this.match(106)) {
            this.next();
            return this.tsTokenCanFollowModifier();
          }
          return this.tsNextTokenOnSameLineAndCanFollowModifier();
        }
        tsParseModifier(allowedModifiers, stopOnStartOfClassStaticBlock, hasSeenStaticModifier) {
          if (!tokenIsIdentifier(this.state.type) && this.state.type !== 58 && this.state.type !== 75) {
            return void 0;
          }
          const modifier = this.state.value;
          if (allowedModifiers.includes(modifier)) {
            if (hasSeenStaticModifier && this.match(106)) {
              return void 0;
            }
            if (stopOnStartOfClassStaticBlock && this.tsIsStartOfStaticBlocks()) {
              return void 0;
            }
            if (this.tsTryParse(this.tsNextTokenCanFollowModifier.bind(this))) {
              return modifier;
            }
          }
          return void 0;
        }
        tsParseModifiers({
          allowedModifiers,
          disallowedModifiers,
          stopOnStartOfClassStaticBlock,
          errorTemplate = TSErrors.InvalidModifierOnTypeMember
        }, modified) {
          const enforceOrder = (loc, modifier, before, after) => {
            if (modifier === before && modified[after]) {
              this.raise(TSErrors.InvalidModifiersOrder, loc, {
                orderedModifiers: [before, after]
              });
            }
          };
          const incompatible = (loc, modifier, mod1, mod2) => {
            if (modified[mod1] && modifier === mod2 || modified[mod2] && modifier === mod1) {
              this.raise(TSErrors.IncompatibleModifiers, loc, {
                modifiers: [mod1, mod2]
              });
            }
          };
          for (; ; ) {
            const {
              startLoc
            } = this.state;
            const modifier = this.tsParseModifier(allowedModifiers.concat(disallowedModifiers != null ? disallowedModifiers : []), stopOnStartOfClassStaticBlock, modified.static);
            if (!modifier) break;
            if (tsIsAccessModifier(modifier)) {
              if (modified.accessibility) {
                this.raise(TSErrors.DuplicateAccessibilityModifier, startLoc, {
                  modifier
                });
              } else {
                enforceOrder(startLoc, modifier, modifier, "override");
                enforceOrder(startLoc, modifier, modifier, "static");
                enforceOrder(startLoc, modifier, modifier, "readonly");
                modified.accessibility = modifier;
              }
            } else if (tsIsVarianceAnnotations(modifier)) {
              if (modified[modifier]) {
                this.raise(TSErrors.DuplicateModifier, startLoc, {
                  modifier
                });
              }
              modified[modifier] = true;
              enforceOrder(startLoc, modifier, "in", "out");
            } else {
              if (hasOwnProperty.call(modified, modifier)) {
                this.raise(TSErrors.DuplicateModifier, startLoc, {
                  modifier
                });
              } else {
                enforceOrder(startLoc, modifier, "static", "readonly");
                enforceOrder(startLoc, modifier, "static", "override");
                enforceOrder(startLoc, modifier, "override", "readonly");
                enforceOrder(startLoc, modifier, "abstract", "override");
                incompatible(startLoc, modifier, "declare", "override");
                incompatible(startLoc, modifier, "static", "abstract");
              }
              modified[modifier] = true;
            }
            if (disallowedModifiers != null && disallowedModifiers.includes(modifier)) {
              this.raise(errorTemplate, startLoc, {
                modifier
              });
            }
          }
        }
        tsIsListTerminator(kind) {
          switch (kind) {
            case "EnumMembers":
            case "TypeMembers":
              return this.match(8);
            case "HeritageClauseElement":
              return this.match(5);
            case "TupleElementTypes":
              return this.match(3);
            case "TypeParametersOrArguments":
              return this.match(48);
          }
        }
        tsParseList(kind, parseElement) {
          const result = [];
          while (!this.tsIsListTerminator(kind)) {
            result.push(parseElement());
          }
          return result;
        }
        tsParseDelimitedList(kind, parseElement, refTrailingCommaPos) {
          return nonNull(this.tsParseDelimitedListWorker(kind, parseElement, true, refTrailingCommaPos));
        }
        tsParseDelimitedListWorker(kind, parseElement, expectSuccess, refTrailingCommaPos) {
          const result = [];
          let trailingCommaPos = -1;
          for (; ; ) {
            if (this.tsIsListTerminator(kind)) {
              break;
            }
            trailingCommaPos = -1;
            const element = parseElement();
            if (element == null) {
              return void 0;
            }
            result.push(element);
            if (this.eat(12)) {
              trailingCommaPos = this.state.lastTokStartLoc.index;
              continue;
            }
            if (this.tsIsListTerminator(kind)) {
              break;
            }
            if (expectSuccess) {
              this.expect(12);
            }
            return void 0;
          }
          if (refTrailingCommaPos) {
            refTrailingCommaPos.value = trailingCommaPos;
          }
          return result;
        }
        tsParseBracketedList(kind, parseElement, bracket, skipFirstToken, refTrailingCommaPos) {
          if (!skipFirstToken) {
            if (bracket) {
              this.expect(0);
            } else {
              this.expect(47);
            }
          }
          const result = this.tsParseDelimitedList(kind, parseElement, refTrailingCommaPos);
          if (bracket) {
            this.expect(3);
          } else {
            this.expect(48);
          }
          return result;
        }
        tsParseImportType() {
          const node = this.startNode();
          this.expect(83);
          this.expect(10);
          if (!this.match(134)) {
            this.raise(TSErrors.UnsupportedImportTypeArgument, this.state.startLoc);
            node.argument = super.parseExprAtom();
          } else {
            node.argument = this.parseStringLiteral(this.state.value);
          }
          if (this.eat(12)) {
            node.options = this.tsParseImportTypeOptions();
          } else {
            node.options = null;
          }
          this.expect(11);
          if (this.eat(16)) {
            node.qualifier = this.tsParseEntityName(1 | 2);
          }
          if (this.match(47)) {
            node.typeParameters = this.tsParseTypeArguments();
          }
          return this.finishNode(node, "TSImportType");
        }
        tsParseImportTypeOptions() {
          const node = this.startNode();
          this.expect(5);
          const withProperty = this.startNode();
          if (this.isContextual(76)) {
            withProperty.method = false;
            withProperty.key = this.parseIdentifier(true);
            withProperty.computed = false;
            withProperty.shorthand = false;
          } else {
            this.unexpected(null, 76);
          }
          this.expect(14);
          withProperty.value = this.tsParseImportTypeWithPropertyValue();
          node.properties = [this.finishObjectProperty(withProperty)];
          this.eat(12);
          this.expect(8);
          return this.finishNode(node, "ObjectExpression");
        }
        tsParseImportTypeWithPropertyValue() {
          const node = this.startNode();
          const properties = [];
          this.expect(5);
          while (!this.match(8)) {
            const type = this.state.type;
            if (tokenIsIdentifier(type) || type === 134) {
              properties.push(super.parsePropertyDefinition(null));
            } else {
              this.unexpected();
            }
            this.eat(12);
          }
          node.properties = properties;
          this.next();
          return this.finishNode(node, "ObjectExpression");
        }
        tsParseEntityName(flags) {
          let entity;
          if (flags & 1 && this.match(78)) {
            if (flags & 2) {
              entity = this.parseIdentifier(true);
            } else {
              const node = this.startNode();
              this.next();
              entity = this.finishNode(node, "ThisExpression");
            }
          } else {
            entity = this.parseIdentifier(!!(flags & 1));
          }
          while (this.eat(16)) {
            const node = this.startNodeAtNode(entity);
            node.left = entity;
            node.right = this.parseIdentifier(!!(flags & 1));
            entity = this.finishNode(node, "TSQualifiedName");
          }
          return entity;
        }
        tsParseTypeReference() {
          const node = this.startNode();
          node.typeName = this.tsParseEntityName(1);
          if (!this.hasPrecedingLineBreak() && this.match(47)) {
            node.typeParameters = this.tsParseTypeArguments();
          }
          return this.finishNode(node, "TSTypeReference");
        }
        tsParseThisTypePredicate(lhs) {
          this.next();
          const node = this.startNodeAtNode(lhs);
          node.parameterName = lhs;
          node.typeAnnotation = this.tsParseTypeAnnotation(false);
          node.asserts = false;
          return this.finishNode(node, "TSTypePredicate");
        }
        tsParseThisTypeNode() {
          const node = this.startNode();
          this.next();
          return this.finishNode(node, "TSThisType");
        }
        tsParseTypeQuery() {
          const node = this.startNode();
          this.expect(87);
          if (this.match(83)) {
            node.exprName = this.tsParseImportType();
          } else {
            node.exprName = this.tsParseEntityName(1 | 2);
          }
          if (!this.hasPrecedingLineBreak() && this.match(47)) {
            node.typeParameters = this.tsParseTypeArguments();
          }
          return this.finishNode(node, "TSTypeQuery");
        }
        tsParseTypeParameter(parseModifiers) {
          const node = this.startNode();
          parseModifiers(node);
          node.name = this.tsParseTypeParameterName();
          node.constraint = this.tsEatThenParseType(81);
          node.default = this.tsEatThenParseType(29);
          return this.finishNode(node, "TSTypeParameter");
        }
        tsTryParseTypeParameters(parseModifiers) {
          if (this.match(47)) {
            return this.tsParseTypeParameters(parseModifiers);
          }
        }
        tsParseTypeParameters(parseModifiers) {
          const node = this.startNode();
          if (this.match(47) || this.match(143)) {
            this.next();
          } else {
            this.unexpected();
          }
          const refTrailingCommaPos = {
            value: -1
          };
          node.params = this.tsParseBracketedList("TypeParametersOrArguments", this.tsParseTypeParameter.bind(this, parseModifiers), false, true, refTrailingCommaPos);
          if (node.params.length === 0) {
            this.raise(TSErrors.EmptyTypeParameters, node);
          }
          if (refTrailingCommaPos.value !== -1) {
            this.addExtra(node, "trailingComma", refTrailingCommaPos.value);
          }
          return this.finishNode(node, "TSTypeParameterDeclaration");
        }
        tsFillSignature(returnToken, signature) {
          const returnTokenRequired = returnToken === 19;
          const paramsKey = "parameters";
          const returnTypeKey = "typeAnnotation";
          signature.typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
          this.expect(10);
          signature[paramsKey] = this.tsParseBindingListForSignature();
          if (returnTokenRequired) {
            signature[returnTypeKey] = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
          } else if (this.match(returnToken)) {
            signature[returnTypeKey] = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
          }
        }
        tsParseBindingListForSignature() {
          const list = super.parseBindingList(11, 41, 2);
          for (const pattern of list) {
            const {
              type
            } = pattern;
            if (type === "AssignmentPattern" || type === "TSParameterProperty") {
              this.raise(TSErrors.UnsupportedSignatureParameterKind, pattern, {
                type
              });
            }
          }
          return list;
        }
        tsParseTypeMemberSemicolon() {
          if (!this.eat(12) && !this.isLineTerminator()) {
            this.expect(13);
          }
        }
        tsParseSignatureMember(kind, node) {
          this.tsFillSignature(14, node);
          this.tsParseTypeMemberSemicolon();
          return this.finishNode(node, kind);
        }
        tsIsUnambiguouslyIndexSignature() {
          this.next();
          if (tokenIsIdentifier(this.state.type)) {
            this.next();
            return this.match(14);
          }
          return false;
        }
        tsTryParseIndexSignature(node) {
          if (!(this.match(0) && this.tsLookAhead(this.tsIsUnambiguouslyIndexSignature.bind(this)))) {
            return;
          }
          this.expect(0);
          const id = this.parseIdentifier();
          id.typeAnnotation = this.tsParseTypeAnnotation();
          this.resetEndLocation(id);
          this.expect(3);
          node.parameters = [id];
          const type = this.tsTryParseTypeAnnotation();
          if (type) node.typeAnnotation = type;
          this.tsParseTypeMemberSemicolon();
          return this.finishNode(node, "TSIndexSignature");
        }
        tsParsePropertyOrMethodSignature(node, readonly) {
          if (this.eat(17)) node.optional = true;
          if (this.match(10) || this.match(47)) {
            if (readonly) {
              this.raise(TSErrors.ReadonlyForMethodSignature, node);
            }
            const method = node;
            if (method.kind && this.match(47)) {
              this.raise(TSErrors.AccessorCannotHaveTypeParameters, this.state.curPosition());
            }
            this.tsFillSignature(14, method);
            this.tsParseTypeMemberSemicolon();
            const paramsKey = "parameters";
            const returnTypeKey = "typeAnnotation";
            if (method.kind === "get") {
              if (method[paramsKey].length > 0) {
                this.raise(Errors.BadGetterArity, this.state.curPosition());
                if (this.isThisParam(method[paramsKey][0])) {
                  this.raise(TSErrors.AccessorCannotDeclareThisParameter, this.state.curPosition());
                }
              }
            } else if (method.kind === "set") {
              if (method[paramsKey].length !== 1) {
                this.raise(Errors.BadSetterArity, this.state.curPosition());
              } else {
                const firstParameter = method[paramsKey][0];
                if (this.isThisParam(firstParameter)) {
                  this.raise(TSErrors.AccessorCannotDeclareThisParameter, this.state.curPosition());
                }
                if (firstParameter.type === "Identifier" && firstParameter.optional) {
                  this.raise(TSErrors.SetAccessorCannotHaveOptionalParameter, this.state.curPosition());
                }
                if (firstParameter.type === "RestElement") {
                  this.raise(TSErrors.SetAccessorCannotHaveRestParameter, this.state.curPosition());
                }
              }
              if (method[returnTypeKey]) {
                this.raise(TSErrors.SetAccessorCannotHaveReturnType, method[returnTypeKey]);
              }
            } else {
              method.kind = "method";
            }
            return this.finishNode(method, "TSMethodSignature");
          } else {
            const property = node;
            if (readonly) property.readonly = true;
            const type = this.tsTryParseTypeAnnotation();
            if (type) property.typeAnnotation = type;
            this.tsParseTypeMemberSemicolon();
            return this.finishNode(property, "TSPropertySignature");
          }
        }
        tsParseTypeMember() {
          const node = this.startNode();
          if (this.match(10) || this.match(47)) {
            return this.tsParseSignatureMember("TSCallSignatureDeclaration", node);
          }
          if (this.match(77)) {
            const id = this.startNode();
            this.next();
            if (this.match(10) || this.match(47)) {
              return this.tsParseSignatureMember("TSConstructSignatureDeclaration", node);
            } else {
              node.key = this.createIdentifier(id, "new");
              return this.tsParsePropertyOrMethodSignature(node, false);
            }
          }
          this.tsParseModifiers({
            allowedModifiers: ["readonly"],
            disallowedModifiers: ["declare", "abstract", "private", "protected", "public", "static", "override"]
          }, node);
          const idx = this.tsTryParseIndexSignature(node);
          if (idx) {
            return idx;
          }
          super.parsePropertyName(node);
          if (!node.computed && node.key.type === "Identifier" && (node.key.name === "get" || node.key.name === "set") && this.tsTokenCanFollowModifier()) {
            node.kind = node.key.name;
            super.parsePropertyName(node);
            if (!this.match(10) && !this.match(47)) {
              this.unexpected(null, 10);
            }
          }
          return this.tsParsePropertyOrMethodSignature(node, !!node.readonly);
        }
        tsParseTypeLiteral() {
          const node = this.startNode();
          node.members = this.tsParseObjectTypeMembers();
          return this.finishNode(node, "TSTypeLiteral");
        }
        tsParseObjectTypeMembers() {
          this.expect(5);
          const members = this.tsParseList("TypeMembers", this.tsParseTypeMember.bind(this));
          this.expect(8);
          return members;
        }
        tsIsStartOfMappedType() {
          this.next();
          if (this.eat(53)) {
            return this.isContextual(122);
          }
          if (this.isContextual(122)) {
            this.next();
          }
          if (!this.match(0)) {
            return false;
          }
          this.next();
          if (!this.tsIsIdentifier()) {
            return false;
          }
          this.next();
          return this.match(58);
        }
        tsParseMappedType() {
          const node = this.startNode();
          this.expect(5);
          if (this.match(53)) {
            node.readonly = this.state.value;
            this.next();
            this.expectContextual(122);
          } else if (this.eatContextual(122)) {
            node.readonly = true;
          }
          this.expect(0);
          const typeParameter = this.startNode();
          typeParameter.name = this.tsParseTypeParameterName();
          typeParameter.constraint = this.tsExpectThenParseType(58);
          node.typeParameter = this.finishNode(typeParameter, "TSTypeParameter");
          node.nameType = this.eatContextual(93) ? this.tsParseType() : null;
          this.expect(3);
          if (this.match(53)) {
            node.optional = this.state.value;
            this.next();
            this.expect(17);
          } else if (this.eat(17)) {
            node.optional = true;
          }
          node.typeAnnotation = this.tsTryParseType();
          this.semicolon();
          this.expect(8);
          return this.finishNode(node, "TSMappedType");
        }
        tsParseTupleType() {
          const node = this.startNode();
          node.elementTypes = this.tsParseBracketedList("TupleElementTypes", this.tsParseTupleElementType.bind(this), true, false);
          let seenOptionalElement = false;
          node.elementTypes.forEach((elementNode) => {
            const {
              type
            } = elementNode;
            if (seenOptionalElement && type !== "TSRestType" && type !== "TSOptionalType" && !(type === "TSNamedTupleMember" && elementNode.optional)) {
              this.raise(TSErrors.OptionalTypeBeforeRequired, elementNode);
            }
            seenOptionalElement || (seenOptionalElement = type === "TSNamedTupleMember" && elementNode.optional || type === "TSOptionalType");
          });
          return this.finishNode(node, "TSTupleType");
        }
        tsParseTupleElementType() {
          const restStartLoc = this.state.startLoc;
          const rest = this.eat(21);
          const {
            startLoc
          } = this.state;
          let labeled;
          let label;
          let optional;
          let type;
          const isWord = tokenIsKeywordOrIdentifier(this.state.type);
          const chAfterWord = isWord ? this.lookaheadCharCode() : null;
          if (chAfterWord === 58) {
            labeled = true;
            optional = false;
            label = this.parseIdentifier(true);
            this.expect(14);
            type = this.tsParseType();
          } else if (chAfterWord === 63) {
            optional = true;
            const wordName = this.state.value;
            const typeOrLabel = this.tsParseNonArrayType();
            if (this.lookaheadCharCode() === 58) {
              labeled = true;
              label = this.createIdentifier(this.startNodeAt(startLoc), wordName);
              this.expect(17);
              this.expect(14);
              type = this.tsParseType();
            } else {
              labeled = false;
              type = typeOrLabel;
              this.expect(17);
            }
          } else {
            type = this.tsParseType();
            optional = this.eat(17);
            labeled = this.eat(14);
          }
          if (labeled) {
            let labeledNode;
            if (label) {
              labeledNode = this.startNodeAt(startLoc);
              labeledNode.optional = optional;
              labeledNode.label = label;
              labeledNode.elementType = type;
              if (this.eat(17)) {
                labeledNode.optional = true;
                this.raise(TSErrors.TupleOptionalAfterType, this.state.lastTokStartLoc);
              }
            } else {
              labeledNode = this.startNodeAt(startLoc);
              labeledNode.optional = optional;
              this.raise(TSErrors.InvalidTupleMemberLabel, type);
              labeledNode.label = type;
              labeledNode.elementType = this.tsParseType();
            }
            type = this.finishNode(labeledNode, "TSNamedTupleMember");
          } else if (optional) {
            const optionalTypeNode = this.startNodeAt(startLoc);
            optionalTypeNode.typeAnnotation = type;
            type = this.finishNode(optionalTypeNode, "TSOptionalType");
          }
          if (rest) {
            const restNode = this.startNodeAt(restStartLoc);
            restNode.typeAnnotation = type;
            type = this.finishNode(restNode, "TSRestType");
          }
          return type;
        }
        tsParseParenthesizedType() {
          const node = this.startNode();
          this.expect(10);
          node.typeAnnotation = this.tsParseType();
          this.expect(11);
          return this.finishNode(node, "TSParenthesizedType");
        }
        tsParseFunctionOrConstructorType(type, abstract) {
          const node = this.startNode();
          if (type === "TSConstructorType") {
            node.abstract = !!abstract;
            if (abstract) this.next();
            this.next();
          }
          this.tsInAllowConditionalTypesContext(() => this.tsFillSignature(19, node));
          return this.finishNode(node, type);
        }
        tsParseLiteralTypeNode() {
          const node = this.startNode();
          switch (this.state.type) {
            case 135:
            case 136:
            case 134:
            case 85:
            case 86:
              node.literal = super.parseExprAtom();
              break;
            default:
              this.unexpected();
          }
          return this.finishNode(node, "TSLiteralType");
        }
        tsParseTemplateLiteralType() {
          const node = this.startNode();
          node.literal = super.parseTemplate(false);
          return this.finishNode(node, "TSLiteralType");
        }
        parseTemplateSubstitution() {
          if (this.state.inType) return this.tsParseType();
          return super.parseTemplateSubstitution();
        }
        tsParseThisTypeOrThisTypePredicate() {
          const thisKeyword = this.tsParseThisTypeNode();
          if (this.isContextual(116) && !this.hasPrecedingLineBreak()) {
            return this.tsParseThisTypePredicate(thisKeyword);
          } else {
            return thisKeyword;
          }
        }
        tsParseNonArrayType() {
          switch (this.state.type) {
            case 134:
            case 135:
            case 136:
            case 85:
            case 86:
              return this.tsParseLiteralTypeNode();
            case 53:
              if (this.state.value === "-") {
                const node = this.startNode();
                const nextToken = this.lookahead();
                if (nextToken.type !== 135 && nextToken.type !== 136) {
                  this.unexpected();
                }
                node.literal = this.parseMaybeUnary();
                return this.finishNode(node, "TSLiteralType");
              }
              break;
            case 78:
              return this.tsParseThisTypeOrThisTypePredicate();
            case 87:
              return this.tsParseTypeQuery();
            case 83:
              return this.tsParseImportType();
            case 5:
              return this.tsLookAhead(this.tsIsStartOfMappedType.bind(this)) ? this.tsParseMappedType() : this.tsParseTypeLiteral();
            case 0:
              return this.tsParseTupleType();
            case 10:
              return this.tsParseParenthesizedType();
            case 25:
            case 24:
              return this.tsParseTemplateLiteralType();
            default: {
              const {
                type
              } = this.state;
              if (tokenIsIdentifier(type) || type === 88 || type === 84) {
                const nodeType = type === 88 ? "TSVoidKeyword" : type === 84 ? "TSNullKeyword" : keywordTypeFromName(this.state.value);
                if (nodeType !== void 0 && this.lookaheadCharCode() !== 46) {
                  const node = this.startNode();
                  this.next();
                  return this.finishNode(node, nodeType);
                }
                return this.tsParseTypeReference();
              }
            }
          }
          throw this.unexpected();
        }
        tsParseArrayTypeOrHigher() {
          const {
            startLoc
          } = this.state;
          let type = this.tsParseNonArrayType();
          while (!this.hasPrecedingLineBreak() && this.eat(0)) {
            if (this.match(3)) {
              const node = this.startNodeAt(startLoc);
              node.elementType = type;
              this.expect(3);
              type = this.finishNode(node, "TSArrayType");
            } else {
              const node = this.startNodeAt(startLoc);
              node.objectType = type;
              node.indexType = this.tsParseType();
              this.expect(3);
              type = this.finishNode(node, "TSIndexedAccessType");
            }
          }
          return type;
        }
        tsParseTypeOperator() {
          const node = this.startNode();
          const operator = this.state.value;
          this.next();
          node.operator = operator;
          node.typeAnnotation = this.tsParseTypeOperatorOrHigher();
          if (operator === "readonly") {
            this.tsCheckTypeAnnotationForReadOnly(node);
          }
          return this.finishNode(node, "TSTypeOperator");
        }
        tsCheckTypeAnnotationForReadOnly(node) {
          switch (node.typeAnnotation.type) {
            case "TSTupleType":
            case "TSArrayType":
              return;
            default:
              this.raise(TSErrors.UnexpectedReadonly, node);
          }
        }
        tsParseInferType() {
          const node = this.startNode();
          this.expectContextual(115);
          const typeParameter = this.startNode();
          typeParameter.name = this.tsParseTypeParameterName();
          typeParameter.constraint = this.tsTryParse(() => this.tsParseConstraintForInferType());
          node.typeParameter = this.finishNode(typeParameter, "TSTypeParameter");
          return this.finishNode(node, "TSInferType");
        }
        tsParseConstraintForInferType() {
          if (this.eat(81)) {
            const constraint = this.tsInDisallowConditionalTypesContext(() => this.tsParseType());
            if (this.state.inDisallowConditionalTypesContext || !this.match(17)) {
              return constraint;
            }
          }
        }
        tsParseTypeOperatorOrHigher() {
          const isTypeOperator = tokenIsTSTypeOperator(this.state.type) && !this.state.containsEsc;
          return isTypeOperator ? this.tsParseTypeOperator() : this.isContextual(115) ? this.tsParseInferType() : this.tsInAllowConditionalTypesContext(() => this.tsParseArrayTypeOrHigher());
        }
        tsParseUnionOrIntersectionType(kind, parseConstituentType, operator) {
          const node = this.startNode();
          const hasLeadingOperator = this.eat(operator);
          const types2 = [];
          do {
            types2.push(parseConstituentType());
          } while (this.eat(operator));
          if (types2.length === 1 && !hasLeadingOperator) {
            return types2[0];
          }
          node.types = types2;
          return this.finishNode(node, kind);
        }
        tsParseIntersectionTypeOrHigher() {
          return this.tsParseUnionOrIntersectionType("TSIntersectionType", this.tsParseTypeOperatorOrHigher.bind(this), 45);
        }
        tsParseUnionTypeOrHigher() {
          return this.tsParseUnionOrIntersectionType("TSUnionType", this.tsParseIntersectionTypeOrHigher.bind(this), 43);
        }
        tsIsStartOfFunctionType() {
          if (this.match(47)) {
            return true;
          }
          return this.match(10) && this.tsLookAhead(this.tsIsUnambiguouslyStartOfFunctionType.bind(this));
        }
        tsSkipParameterStart() {
          if (tokenIsIdentifier(this.state.type) || this.match(78)) {
            this.next();
            return true;
          }
          if (this.match(5)) {
            const {
              errors
            } = this.state;
            const previousErrorCount = errors.length;
            try {
              this.parseObjectLike(8, true);
              return errors.length === previousErrorCount;
            } catch (_unused) {
              return false;
            }
          }
          if (this.match(0)) {
            this.next();
            const {
              errors
            } = this.state;
            const previousErrorCount = errors.length;
            try {
              super.parseBindingList(3, 93, 1);
              return errors.length === previousErrorCount;
            } catch (_unused2) {
              return false;
            }
          }
          return false;
        }
        tsIsUnambiguouslyStartOfFunctionType() {
          this.next();
          if (this.match(11) || this.match(21)) {
            return true;
          }
          if (this.tsSkipParameterStart()) {
            if (this.match(14) || this.match(12) || this.match(17) || this.match(29)) {
              return true;
            }
            if (this.match(11)) {
              this.next();
              if (this.match(19)) {
                return true;
              }
            }
          }
          return false;
        }
        tsParseTypeOrTypePredicateAnnotation(returnToken) {
          return this.tsInType(() => {
            const t = this.startNode();
            this.expect(returnToken);
            const node = this.startNode();
            const asserts = !!this.tsTryParse(this.tsParseTypePredicateAsserts.bind(this));
            if (asserts && this.match(78)) {
              let thisTypePredicate = this.tsParseThisTypeOrThisTypePredicate();
              if (thisTypePredicate.type === "TSThisType") {
                node.parameterName = thisTypePredicate;
                node.asserts = true;
                node.typeAnnotation = null;
                thisTypePredicate = this.finishNode(node, "TSTypePredicate");
              } else {
                this.resetStartLocationFromNode(thisTypePredicate, node);
                thisTypePredicate.asserts = true;
              }
              t.typeAnnotation = thisTypePredicate;
              return this.finishNode(t, "TSTypeAnnotation");
            }
            const typePredicateVariable = this.tsIsIdentifier() && this.tsTryParse(this.tsParseTypePredicatePrefix.bind(this));
            if (!typePredicateVariable) {
              if (!asserts) {
                return this.tsParseTypeAnnotation(false, t);
              }
              node.parameterName = this.parseIdentifier();
              node.asserts = asserts;
              node.typeAnnotation = null;
              t.typeAnnotation = this.finishNode(node, "TSTypePredicate");
              return this.finishNode(t, "TSTypeAnnotation");
            }
            const type = this.tsParseTypeAnnotation(false);
            node.parameterName = typePredicateVariable;
            node.typeAnnotation = type;
            node.asserts = asserts;
            t.typeAnnotation = this.finishNode(node, "TSTypePredicate");
            return this.finishNode(t, "TSTypeAnnotation");
          });
        }
        tsTryParseTypeOrTypePredicateAnnotation() {
          if (this.match(14)) {
            return this.tsParseTypeOrTypePredicateAnnotation(14);
          }
        }
        tsTryParseTypeAnnotation() {
          if (this.match(14)) {
            return this.tsParseTypeAnnotation();
          }
        }
        tsTryParseType() {
          return this.tsEatThenParseType(14);
        }
        tsParseTypePredicatePrefix() {
          const id = this.parseIdentifier();
          if (this.isContextual(116) && !this.hasPrecedingLineBreak()) {
            this.next();
            return id;
          }
        }
        tsParseTypePredicateAsserts() {
          if (this.state.type !== 109) {
            return false;
          }
          const containsEsc = this.state.containsEsc;
          this.next();
          if (!tokenIsIdentifier(this.state.type) && !this.match(78)) {
            return false;
          }
          if (containsEsc) {
            this.raise(Errors.InvalidEscapedReservedWord, this.state.lastTokStartLoc, {
              reservedWord: "asserts"
            });
          }
          return true;
        }
        tsParseTypeAnnotation(eatColon = true, t = this.startNode()) {
          this.tsInType(() => {
            if (eatColon) this.expect(14);
            t.typeAnnotation = this.tsParseType();
          });
          return this.finishNode(t, "TSTypeAnnotation");
        }
        tsParseType() {
          assert2(this.state.inType);
          const type = this.tsParseNonConditionalType();
          if (this.state.inDisallowConditionalTypesContext || this.hasPrecedingLineBreak() || !this.eat(81)) {
            return type;
          }
          const node = this.startNodeAtNode(type);
          node.checkType = type;
          node.extendsType = this.tsInDisallowConditionalTypesContext(() => this.tsParseNonConditionalType());
          this.expect(17);
          node.trueType = this.tsInAllowConditionalTypesContext(() => this.tsParseType());
          this.expect(14);
          node.falseType = this.tsInAllowConditionalTypesContext(() => this.tsParseType());
          return this.finishNode(node, "TSConditionalType");
        }
        isAbstractConstructorSignature() {
          return this.isContextual(124) && this.isLookaheadContextual("new");
        }
        tsParseNonConditionalType() {
          if (this.tsIsStartOfFunctionType()) {
            return this.tsParseFunctionOrConstructorType("TSFunctionType");
          }
          if (this.match(77)) {
            return this.tsParseFunctionOrConstructorType("TSConstructorType");
          } else if (this.isAbstractConstructorSignature()) {
            return this.tsParseFunctionOrConstructorType("TSConstructorType", true);
          }
          return this.tsParseUnionTypeOrHigher();
        }
        tsParseTypeAssertion() {
          if (this.getPluginOption("typescript", "disallowAmbiguousJSXLike")) {
            this.raise(TSErrors.ReservedTypeAssertion, this.state.startLoc);
          }
          const node = this.startNode();
          node.typeAnnotation = this.tsInType(() => {
            this.next();
            return this.match(75) ? this.tsParseTypeReference() : this.tsParseType();
          });
          this.expect(48);
          node.expression = this.parseMaybeUnary();
          return this.finishNode(node, "TSTypeAssertion");
        }
        tsParseHeritageClause(token) {
          const originalStartLoc = this.state.startLoc;
          const delimitedList = this.tsParseDelimitedList("HeritageClauseElement", () => {
            const node = this.startNode();
            node.expression = this.tsParseEntityName(1 | 2);
            if (this.match(47)) {
              node.typeParameters = this.tsParseTypeArguments();
            }
            return this.finishNode(node, "TSExpressionWithTypeArguments");
          });
          if (!delimitedList.length) {
            this.raise(TSErrors.EmptyHeritageClauseType, originalStartLoc, {
              token
            });
          }
          return delimitedList;
        }
        tsParseInterfaceDeclaration(node, properties = {}) {
          if (this.hasFollowingLineBreak()) return null;
          this.expectContextual(129);
          if (properties.declare) node.declare = true;
          if (tokenIsIdentifier(this.state.type)) {
            node.id = this.parseIdentifier();
            this.checkIdentifier(node.id, 130);
          } else {
            node.id = null;
            this.raise(TSErrors.MissingInterfaceName, this.state.startLoc);
          }
          node.typeParameters = this.tsTryParseTypeParameters(this.tsParseInOutConstModifiers);
          if (this.eat(81)) {
            node.extends = this.tsParseHeritageClause("extends");
          }
          const body = this.startNode();
          body.body = this.tsInType(this.tsParseObjectTypeMembers.bind(this));
          node.body = this.finishNode(body, "TSInterfaceBody");
          return this.finishNode(node, "TSInterfaceDeclaration");
        }
        tsParseTypeAliasDeclaration(node) {
          node.id = this.parseIdentifier();
          this.checkIdentifier(node.id, 2);
          node.typeAnnotation = this.tsInType(() => {
            node.typeParameters = this.tsTryParseTypeParameters(this.tsParseInOutModifiers);
            this.expect(29);
            if (this.isContextual(114) && this.lookaheadCharCode() !== 46) {
              const node2 = this.startNode();
              this.next();
              return this.finishNode(node2, "TSIntrinsicKeyword");
            }
            return this.tsParseType();
          });
          this.semicolon();
          return this.finishNode(node, "TSTypeAliasDeclaration");
        }
        tsInTopLevelContext(cb) {
          if (this.curContext() !== types.brace) {
            const oldContext = this.state.context;
            this.state.context = [oldContext[0]];
            try {
              return cb();
            } finally {
              this.state.context = oldContext;
            }
          } else {
            return cb();
          }
        }
        tsInType(cb) {
          const oldInType = this.state.inType;
          this.state.inType = true;
          try {
            return cb();
          } finally {
            this.state.inType = oldInType;
          }
        }
        tsInDisallowConditionalTypesContext(cb) {
          const oldInDisallowConditionalTypesContext = this.state.inDisallowConditionalTypesContext;
          this.state.inDisallowConditionalTypesContext = true;
          try {
            return cb();
          } finally {
            this.state.inDisallowConditionalTypesContext = oldInDisallowConditionalTypesContext;
          }
        }
        tsInAllowConditionalTypesContext(cb) {
          const oldInDisallowConditionalTypesContext = this.state.inDisallowConditionalTypesContext;
          this.state.inDisallowConditionalTypesContext = false;
          try {
            return cb();
          } finally {
            this.state.inDisallowConditionalTypesContext = oldInDisallowConditionalTypesContext;
          }
        }
        tsEatThenParseType(token) {
          if (this.match(token)) {
            return this.tsNextThenParseType();
          }
        }
        tsExpectThenParseType(token) {
          return this.tsInType(() => {
            this.expect(token);
            return this.tsParseType();
          });
        }
        tsNextThenParseType() {
          return this.tsInType(() => {
            this.next();
            return this.tsParseType();
          });
        }
        tsParseEnumMember() {
          const node = this.startNode();
          node.id = this.match(134) ? super.parseStringLiteral(this.state.value) : this.parseIdentifier(true);
          if (this.eat(29)) {
            node.initializer = super.parseMaybeAssignAllowIn();
          }
          return this.finishNode(node, "TSEnumMember");
        }
        tsParseEnumDeclaration(node, properties = {}) {
          if (properties.const) node.const = true;
          if (properties.declare) node.declare = true;
          this.expectContextual(126);
          node.id = this.parseIdentifier();
          this.checkIdentifier(node.id, node.const ? 8971 : 8459);
          this.expect(5);
          node.members = this.tsParseDelimitedList("EnumMembers", this.tsParseEnumMember.bind(this));
          this.expect(8);
          return this.finishNode(node, "TSEnumDeclaration");
        }
        tsParseEnumBody() {
          const node = this.startNode();
          this.expect(5);
          node.members = this.tsParseDelimitedList("EnumMembers", this.tsParseEnumMember.bind(this));
          this.expect(8);
          return this.finishNode(node, "TSEnumBody");
        }
        tsParseModuleBlock() {
          const node = this.startNode();
          this.scope.enter(0);
          this.expect(5);
          super.parseBlockOrModuleBlockBody(node.body = [], void 0, true, 8);
          this.scope.exit();
          return this.finishNode(node, "TSModuleBlock");
        }
        tsParseModuleOrNamespaceDeclaration(node, nested = false) {
          node.id = this.parseIdentifier();
          if (!nested) {
            this.checkIdentifier(node.id, 1024);
          }
          if (this.eat(16)) {
            const inner = this.startNode();
            this.tsParseModuleOrNamespaceDeclaration(inner, true);
            node.body = inner;
          } else {
            this.scope.enter(1024);
            this.prodParam.enter(0);
            node.body = this.tsParseModuleBlock();
            this.prodParam.exit();
            this.scope.exit();
          }
          return this.finishNode(node, "TSModuleDeclaration");
        }
        tsParseAmbientExternalModuleDeclaration(node) {
          if (this.isContextual(112)) {
            node.kind = "global";
            node.global = true;
            node.id = this.parseIdentifier();
          } else if (this.match(134)) {
            node.kind = "module";
            node.id = super.parseStringLiteral(this.state.value);
          } else {
            this.unexpected();
          }
          if (this.match(5)) {
            this.scope.enter(1024);
            this.prodParam.enter(0);
            node.body = this.tsParseModuleBlock();
            this.prodParam.exit();
            this.scope.exit();
          } else {
            this.semicolon();
          }
          return this.finishNode(node, "TSModuleDeclaration");
        }
        tsParseImportEqualsDeclaration(node, maybeDefaultIdentifier, isExport) {
          node.isExport = isExport || false;
          node.id = maybeDefaultIdentifier || this.parseIdentifier();
          this.checkIdentifier(node.id, 4096);
          this.expect(29);
          const moduleReference = this.tsParseModuleReference();
          if (node.importKind === "type" && moduleReference.type !== "TSExternalModuleReference") {
            this.raise(TSErrors.ImportAliasHasImportType, moduleReference);
          }
          node.moduleReference = moduleReference;
          this.semicolon();
          return this.finishNode(node, "TSImportEqualsDeclaration");
        }
        tsIsExternalModuleReference() {
          return this.isContextual(119) && this.lookaheadCharCode() === 40;
        }
        tsParseModuleReference() {
          return this.tsIsExternalModuleReference() ? this.tsParseExternalModuleReference() : this.tsParseEntityName(0);
        }
        tsParseExternalModuleReference() {
          const node = this.startNode();
          this.expectContextual(119);
          this.expect(10);
          if (!this.match(134)) {
            this.unexpected();
          }
          node.expression = super.parseExprAtom();
          this.expect(11);
          this.sawUnambiguousESM = true;
          return this.finishNode(node, "TSExternalModuleReference");
        }
        tsLookAhead(f) {
          const state = this.state.clone();
          const res = f();
          this.state = state;
          return res;
        }
        tsTryParseAndCatch(f) {
          const result = this.tryParse((abort) => f() || abort());
          if (result.aborted || !result.node) return;
          if (result.error) this.state = result.failState;
          return result.node;
        }
        tsTryParse(f) {
          const state = this.state.clone();
          const result = f();
          if (result !== void 0 && result !== false) {
            return result;
          }
          this.state = state;
        }
        tsTryParseDeclare(node) {
          if (this.isLineTerminator()) {
            return;
          }
          const startType = this.state.type;
          return this.tsInAmbientContext(() => {
            switch (startType) {
              case 68:
                node.declare = true;
                return super.parseFunctionStatement(node, false, false);
              case 80:
                node.declare = true;
                return this.parseClass(node, true, false);
              case 126:
                return this.tsParseEnumDeclaration(node, {
                  declare: true
                });
              case 112:
                return this.tsParseAmbientExternalModuleDeclaration(node);
              case 100:
                if (this.state.containsEsc) {
                  return;
                }
              case 75:
              case 74:
                if (!this.match(75) || !this.isLookaheadContextual("enum")) {
                  node.declare = true;
                  return this.parseVarStatement(node, this.state.value, true);
                }
                this.expect(75);
                return this.tsParseEnumDeclaration(node, {
                  const: true,
                  declare: true
                });
              case 107:
                if (this.isUsing()) {
                  this.raise(TSErrors.InvalidModifierOnUsingDeclaration, this.state.startLoc, "declare");
                  node.declare = true;
                  return this.parseVarStatement(node, "using", true);
                }
                break;
              case 96:
                if (this.isAwaitUsing()) {
                  this.raise(TSErrors.InvalidModifierOnAwaitUsingDeclaration, this.state.startLoc, "declare");
                  node.declare = true;
                  this.next();
                  return this.parseVarStatement(node, "await using", true);
                }
                break;
              case 129: {
                const result = this.tsParseInterfaceDeclaration(node, {
                  declare: true
                });
                if (result) return result;
              }
              default:
                if (tokenIsIdentifier(startType)) {
                  return this.tsParseDeclaration(node, this.state.type, true, null);
                }
            }
          });
        }
        tsTryParseExportDeclaration() {
          return this.tsParseDeclaration(this.startNode(), this.state.type, true, null);
        }
        tsParseDeclaration(node, type, next, decorators) {
          switch (type) {
            case 124:
              if (this.tsCheckLineTerminator(next) && (this.match(80) || tokenIsIdentifier(this.state.type))) {
                return this.tsParseAbstractDeclaration(node, decorators);
              }
              break;
            case 127:
              if (this.tsCheckLineTerminator(next)) {
                if (this.match(134)) {
                  return this.tsParseAmbientExternalModuleDeclaration(node);
                } else if (tokenIsIdentifier(this.state.type)) {
                  node.kind = "module";
                  return this.tsParseModuleOrNamespaceDeclaration(node);
                }
              }
              break;
            case 128:
              if (this.tsCheckLineTerminator(next) && tokenIsIdentifier(this.state.type)) {
                node.kind = "namespace";
                return this.tsParseModuleOrNamespaceDeclaration(node);
              }
              break;
            case 130:
              if (this.tsCheckLineTerminator(next) && tokenIsIdentifier(this.state.type)) {
                return this.tsParseTypeAliasDeclaration(node);
              }
              break;
          }
        }
        tsCheckLineTerminator(next) {
          if (next) {
            if (this.hasFollowingLineBreak()) return false;
            this.next();
            return true;
          }
          return !this.isLineTerminator();
        }
        tsTryParseGenericAsyncArrowFunction(startLoc) {
          if (!this.match(47)) return;
          const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
          this.state.maybeInArrowParameters = true;
          const res = this.tsTryParseAndCatch(() => {
            const node = this.startNodeAt(startLoc);
            node.typeParameters = this.tsParseTypeParameters(this.tsParseConstModifier);
            super.parseFunctionParams(node);
            node.returnType = this.tsTryParseTypeOrTypePredicateAnnotation();
            this.expect(19);
            return node;
          });
          this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
          if (!res) return;
          return super.parseArrowExpression(res, null, true);
        }
        tsParseTypeArgumentsInExpression() {
          if (this.reScan_lt() !== 47) return;
          return this.tsParseTypeArguments();
        }
        tsParseTypeArguments() {
          const node = this.startNode();
          node.params = this.tsInType(() => this.tsInTopLevelContext(() => {
            this.expect(47);
            return this.tsParseDelimitedList("TypeParametersOrArguments", this.tsParseType.bind(this));
          }));
          if (node.params.length === 0) {
            this.raise(TSErrors.EmptyTypeArguments, node);
          } else if (!this.state.inType && this.curContext() === types.brace) {
            this.reScan_lt_gt();
          }
          this.expect(48);
          return this.finishNode(node, "TSTypeParameterInstantiation");
        }
        tsIsDeclarationStart() {
          return tokenIsTSDeclarationStart(this.state.type);
        }
        isExportDefaultSpecifier() {
          if (this.tsIsDeclarationStart()) return false;
          return super.isExportDefaultSpecifier();
        }
        parseBindingElement(flags, decorators) {
          const startLoc = decorators.length ? decorators[0].loc.start : this.state.startLoc;
          const modified = {};
          this.tsParseModifiers({
            allowedModifiers: ["public", "private", "protected", "override", "readonly"]
          }, modified);
          const accessibility = modified.accessibility;
          const override = modified.override;
          const readonly = modified.readonly;
          if (!(flags & 4) && (accessibility || readonly || override)) {
            this.raise(TSErrors.UnexpectedParameterModifier, startLoc);
          }
          const left = this.parseMaybeDefault();
          if (flags & 2) {
            this.parseFunctionParamType(left);
          }
          const elt = this.parseMaybeDefault(left.loc.start, left);
          if (accessibility || readonly || override) {
            const pp = this.startNodeAt(startLoc);
            if (decorators.length) {
              pp.decorators = decorators;
            }
            if (accessibility) pp.accessibility = accessibility;
            if (readonly) pp.readonly = readonly;
            if (override) pp.override = override;
            if (elt.type !== "Identifier" && elt.type !== "AssignmentPattern") {
              this.raise(TSErrors.UnsupportedParameterPropertyKind, pp);
            }
            pp.parameter = elt;
            return this.finishNode(pp, "TSParameterProperty");
          }
          if (decorators.length) {
            left.decorators = decorators;
          }
          return elt;
        }
        isSimpleParameter(node) {
          return node.type === "TSParameterProperty" && super.isSimpleParameter(node.parameter) || super.isSimpleParameter(node);
        }
        tsDisallowOptionalPattern(node) {
          for (const param of node.params) {
            if (param.type !== "Identifier" && param.optional && !this.state.isAmbientContext) {
              this.raise(TSErrors.PatternIsOptional, param);
            }
          }
        }
        setArrowFunctionParameters(node, params, trailingCommaLoc) {
          super.setArrowFunctionParameters(node, params, trailingCommaLoc);
          this.tsDisallowOptionalPattern(node);
        }
        parseFunctionBodyAndFinish(node, type, isMethod = false) {
          if (this.match(14)) {
            node.returnType = this.tsParseTypeOrTypePredicateAnnotation(14);
          }
          const bodilessType = type === "FunctionDeclaration" ? "TSDeclareFunction" : type === "ClassMethod" || type === "ClassPrivateMethod" ? "TSDeclareMethod" : void 0;
          if (bodilessType && !this.match(5) && this.isLineTerminator()) {
            return this.finishNode(node, bodilessType);
          }
          if (bodilessType === "TSDeclareFunction" && this.state.isAmbientContext) {
            this.raise(TSErrors.DeclareFunctionHasImplementation, node);
            if (node.declare) {
              return super.parseFunctionBodyAndFinish(node, bodilessType, isMethod);
            }
          }
          this.tsDisallowOptionalPattern(node);
          return super.parseFunctionBodyAndFinish(node, type, isMethod);
        }
        registerFunctionStatementId(node) {
          if (!node.body && node.id) {
            this.checkIdentifier(node.id, 1024);
          } else {
            super.registerFunctionStatementId(node);
          }
        }
        tsCheckForInvalidTypeCasts(items) {
          items.forEach((node) => {
            if ((node == null ? void 0 : node.type) === "TSTypeCastExpression") {
              this.raise(TSErrors.UnexpectedTypeAnnotation, node.typeAnnotation);
            }
          });
        }
        toReferencedList(exprList, isInParens) {
          this.tsCheckForInvalidTypeCasts(exprList);
          return exprList;
        }
        parseArrayLike(close, isTuple, refExpressionErrors) {
          const node = super.parseArrayLike(close, isTuple, refExpressionErrors);
          if (node.type === "ArrayExpression") {
            this.tsCheckForInvalidTypeCasts(node.elements);
          }
          return node;
        }
        parseSubscript(base, startLoc, noCalls, state) {
          if (!this.hasPrecedingLineBreak() && this.match(35)) {
            this.state.canStartJSXElement = false;
            this.next();
            const nonNullExpression = this.startNodeAt(startLoc);
            nonNullExpression.expression = base;
            return this.finishNode(nonNullExpression, "TSNonNullExpression");
          }
          let isOptionalCall = false;
          if (this.match(18) && this.lookaheadCharCode() === 60) {
            if (noCalls) {
              state.stop = true;
              return base;
            }
            state.optionalChainMember = isOptionalCall = true;
            this.next();
          }
          if (this.match(47) || this.match(51)) {
            let missingParenErrorLoc;
            const result = this.tsTryParseAndCatch(() => {
              if (!noCalls && this.atPossibleAsyncArrow(base)) {
                const asyncArrowFn = this.tsTryParseGenericAsyncArrowFunction(startLoc);
                if (asyncArrowFn) {
                  state.stop = true;
                  return asyncArrowFn;
                }
              }
              const typeArguments = this.tsParseTypeArgumentsInExpression();
              if (!typeArguments) return;
              if (isOptionalCall && !this.match(10)) {
                missingParenErrorLoc = this.state.curPosition();
                return;
              }
              if (tokenIsTemplate(this.state.type)) {
                const result2 = super.parseTaggedTemplateExpression(base, startLoc, state);
                result2.typeParameters = typeArguments;
                return result2;
              }
              if (!noCalls && this.eat(10)) {
                const node2 = this.startNodeAt(startLoc);
                node2.callee = base;
                node2.arguments = this.parseCallExpressionArguments();
                this.tsCheckForInvalidTypeCasts(node2.arguments);
                node2.typeParameters = typeArguments;
                if (state.optionalChainMember) {
                  node2.optional = isOptionalCall;
                }
                return this.finishCallExpression(node2, state.optionalChainMember);
              }
              const tokenType = this.state.type;
              if (tokenType === 48 || tokenType === 52 || tokenType !== 10 && tokenType !== 93 && tokenType !== 120 && tokenCanStartExpression(tokenType) && !this.hasPrecedingLineBreak()) {
                return;
              }
              const node = this.startNodeAt(startLoc);
              node.expression = base;
              node.typeParameters = typeArguments;
              return this.finishNode(node, "TSInstantiationExpression");
            });
            if (missingParenErrorLoc) {
              this.unexpected(missingParenErrorLoc, 10);
            }
            if (result) {
              if (result.type === "TSInstantiationExpression") {
                if (this.match(16) || this.match(18) && this.lookaheadCharCode() !== 40) {
                  this.raise(TSErrors.InvalidPropertyAccessAfterInstantiationExpression, this.state.startLoc);
                }
                if (!this.match(16) && !this.match(18)) {
                  result.expression = super.stopParseSubscript(base, state);
                }
              }
              return result;
            }
          }
          return super.parseSubscript(base, startLoc, noCalls, state);
        }
        parseNewCallee(node) {
          var _callee$extra;
          super.parseNewCallee(node);
          const {
            callee
          } = node;
          if (callee.type === "TSInstantiationExpression" && !((_callee$extra = callee.extra) != null && _callee$extra.parenthesized)) {
            node.typeParameters = callee.typeParameters;
            node.callee = callee.expression;
          }
        }
        parseExprOp(left, leftStartLoc, minPrec) {
          let isSatisfies;
          if (tokenOperatorPrecedence(58) > minPrec && !this.hasPrecedingLineBreak() && (this.isContextual(93) || (isSatisfies = this.isContextual(120)))) {
            const node = this.startNodeAt(leftStartLoc);
            node.expression = left;
            node.typeAnnotation = this.tsInType(() => {
              this.next();
              if (this.match(75)) {
                if (isSatisfies) {
                  this.raise(Errors.UnexpectedKeyword, this.state.startLoc, {
                    keyword: "const"
                  });
                }
                return this.tsParseTypeReference();
              }
              return this.tsParseType();
            });
            this.finishNode(node, isSatisfies ? "TSSatisfiesExpression" : "TSAsExpression");
            this.reScan_lt_gt();
            return this.parseExprOp(node, leftStartLoc, minPrec);
          }
          return super.parseExprOp(left, leftStartLoc, minPrec);
        }
        checkReservedWord(word, startLoc, checkKeywords, isBinding) {
          if (!this.state.isAmbientContext) {
            super.checkReservedWord(word, startLoc, checkKeywords, isBinding);
          }
        }
        checkImportReflection(node) {
          super.checkImportReflection(node);
          if (node.module && node.importKind !== "value") {
            this.raise(TSErrors.ImportReflectionHasImportType, node.specifiers[0].loc.start);
          }
        }
        checkDuplicateExports() {
        }
        isPotentialImportPhase(isExport) {
          if (super.isPotentialImportPhase(isExport)) return true;
          if (this.isContextual(130)) {
            const ch = this.lookaheadCharCode();
            return isExport ? ch === 123 || ch === 42 : ch !== 61;
          }
          return !isExport && this.isContextual(87);
        }
        applyImportPhase(node, isExport, phase, loc) {
          super.applyImportPhase(node, isExport, phase, loc);
          if (isExport) {
            node.exportKind = phase === "type" ? "type" : "value";
          } else {
            node.importKind = phase === "type" || phase === "typeof" ? phase : "value";
          }
        }
        parseImport(node) {
          if (this.match(134)) {
            node.importKind = "value";
            return super.parseImport(node);
          }
          let importNode;
          if (tokenIsIdentifier(this.state.type) && this.lookaheadCharCode() === 61) {
            node.importKind = "value";
            return this.tsParseImportEqualsDeclaration(node);
          } else if (this.isContextual(130)) {
            const maybeDefaultIdentifier = this.parseMaybeImportPhase(node, false);
            if (this.lookaheadCharCode() === 61) {
              return this.tsParseImportEqualsDeclaration(node, maybeDefaultIdentifier);
            } else {
              importNode = super.parseImportSpecifiersAndAfter(node, maybeDefaultIdentifier);
            }
          } else {
            importNode = super.parseImport(node);
          }
          if (importNode.importKind === "type" && importNode.specifiers.length > 1 && importNode.specifiers[0].type === "ImportDefaultSpecifier") {
            this.raise(TSErrors.TypeImportCannotSpecifyDefaultAndNamed, importNode);
          }
          return importNode;
        }
        parseExport(node, decorators) {
          if (this.match(83)) {
            const nodeImportEquals = node;
            this.next();
            let maybeDefaultIdentifier = null;
            if (this.isContextual(130) && this.isPotentialImportPhase(false)) {
              maybeDefaultIdentifier = this.parseMaybeImportPhase(nodeImportEquals, false);
            } else {
              nodeImportEquals.importKind = "value";
            }
            const declaration = this.tsParseImportEqualsDeclaration(nodeImportEquals, maybeDefaultIdentifier, true);
            return declaration;
          } else if (this.eat(29)) {
            const assign = node;
            assign.expression = super.parseExpression();
            this.semicolon();
            this.sawUnambiguousESM = true;
            return this.finishNode(assign, "TSExportAssignment");
          } else if (this.eatContextual(93)) {
            const decl = node;
            this.expectContextual(128);
            decl.id = this.parseIdentifier();
            this.semicolon();
            return this.finishNode(decl, "TSNamespaceExportDeclaration");
          } else {
            return super.parseExport(node, decorators);
          }
        }
        isAbstractClass() {
          return this.isContextual(124) && this.isLookaheadContextual("class");
        }
        parseExportDefaultExpression() {
          if (this.isAbstractClass()) {
            const cls = this.startNode();
            this.next();
            cls.abstract = true;
            return this.parseClass(cls, true, true);
          }
          if (this.match(129)) {
            const result = this.tsParseInterfaceDeclaration(this.startNode());
            if (result) return result;
          }
          return super.parseExportDefaultExpression();
        }
        parseVarStatement(node, kind, allowMissingInitializer = false) {
          const {
            isAmbientContext
          } = this.state;
          const declaration = super.parseVarStatement(node, kind, allowMissingInitializer || isAmbientContext);
          if (!isAmbientContext) return declaration;
          if (!node.declare && (kind === "using" || kind === "await using")) {
            this.raiseOverwrite(TSErrors.UsingDeclarationInAmbientContext, node, kind);
            return declaration;
          }
          for (const {
            id,
            init
          } of declaration.declarations) {
            if (!init) continue;
            if (kind === "var" || kind === "let" || !!id.typeAnnotation) {
              this.raise(TSErrors.InitializerNotAllowedInAmbientContext, init);
            } else if (!isValidAmbientConstInitializer(init, this.hasPlugin("estree"))) {
              this.raise(TSErrors.ConstInitializerMustBeStringOrNumericLiteralOrLiteralEnumReference, init);
            }
          }
          return declaration;
        }
        parseStatementContent(flags, decorators) {
          if (!this.state.containsEsc) {
            switch (this.state.type) {
              case 75: {
                if (this.isLookaheadContextual("enum")) {
                  const node = this.startNode();
                  this.expect(75);
                  return this.tsParseEnumDeclaration(node, {
                    const: true
                  });
                }
                break;
              }
              case 124:
              case 125: {
                if (this.nextTokenIsIdentifierAndNotTSRelationalOperatorOnSameLine()) {
                  const token = this.state.type;
                  const node = this.startNode();
                  this.next();
                  const declaration = token === 125 ? this.tsTryParseDeclare(node) : this.tsParseAbstractDeclaration(node, decorators);
                  if (declaration) {
                    if (token === 125) {
                      declaration.declare = true;
                    }
                    return declaration;
                  } else {
                    node.expression = this.createIdentifier(this.startNodeAt(node.loc.start), token === 125 ? "declare" : "abstract");
                    this.semicolon(false);
                    return this.finishNode(node, "ExpressionStatement");
                  }
                }
                break;
              }
              case 126:
                return this.tsParseEnumDeclaration(this.startNode());
              case 112: {
                const nextCh = this.lookaheadCharCode();
                if (nextCh === 123) {
                  const node = this.startNode();
                  return this.tsParseAmbientExternalModuleDeclaration(node);
                }
                break;
              }
              case 129: {
                const result = this.tsParseInterfaceDeclaration(this.startNode());
                if (result) return result;
                break;
              }
              case 127: {
                if (this.nextTokenIsIdentifierOrStringLiteralOnSameLine()) {
                  const node = this.startNode();
                  this.next();
                  return this.tsParseDeclaration(node, 127, false, decorators);
                }
                break;
              }
              case 128: {
                if (this.nextTokenIsIdentifierOnSameLine()) {
                  const node = this.startNode();
                  this.next();
                  return this.tsParseDeclaration(node, 128, false, decorators);
                }
                break;
              }
              case 130: {
                if (this.nextTokenIsIdentifierOnSameLine()) {
                  const node = this.startNode();
                  this.next();
                  return this.tsParseTypeAliasDeclaration(node);
                }
                break;
              }
            }
          }
          return super.parseStatementContent(flags, decorators);
        }
        parseAccessModifier() {
          return this.tsParseModifier(["public", "protected", "private"]);
        }
        tsHasSomeModifiers(member, modifiers) {
          return modifiers.some((modifier) => {
            if (tsIsAccessModifier(modifier)) {
              return member.accessibility === modifier;
            }
            return !!member[modifier];
          });
        }
        tsIsStartOfStaticBlocks() {
          return this.isContextual(106) && this.lookaheadCharCode() === 123;
        }
        parseClassMember(classBody, member, state) {
          const modifiers = ["declare", "private", "public", "protected", "override", "abstract", "readonly", "static"];
          this.tsParseModifiers({
            allowedModifiers: modifiers,
            disallowedModifiers: ["in", "out"],
            stopOnStartOfClassStaticBlock: true,
            errorTemplate: TSErrors.InvalidModifierOnTypeParameterPositions
          }, member);
          const callParseClassMemberWithIsStatic = () => {
            if (this.tsIsStartOfStaticBlocks()) {
              this.next();
              this.next();
              if (this.tsHasSomeModifiers(member, modifiers)) {
                this.raise(TSErrors.StaticBlockCannotHaveModifier, this.state.curPosition());
              }
              super.parseClassStaticBlock(classBody, member);
            } else {
              this.parseClassMemberWithIsStatic(classBody, member, state, !!member.static);
            }
          };
          if (member.declare) {
            this.tsInAmbientContext(callParseClassMemberWithIsStatic);
          } else {
            callParseClassMemberWithIsStatic();
          }
        }
        parseClassMemberWithIsStatic(classBody, member, state, isStatic) {
          const idx = this.tsTryParseIndexSignature(member);
          if (idx) {
            classBody.body.push(idx);
            if (member.abstract) {
              this.raise(TSErrors.IndexSignatureHasAbstract, member);
            }
            if (member.accessibility) {
              this.raise(TSErrors.IndexSignatureHasAccessibility, member, {
                modifier: member.accessibility
              });
            }
            if (member.declare) {
              this.raise(TSErrors.IndexSignatureHasDeclare, member);
            }
            if (member.override) {
              this.raise(TSErrors.IndexSignatureHasOverride, member);
            }
            return;
          }
          if (!this.state.inAbstractClass && member.abstract) {
            this.raise(TSErrors.NonAbstractClassHasAbstractMethod, member);
          }
          if (member.override) {
            if (!state.hadSuperClass) {
              this.raise(TSErrors.OverrideNotInSubClass, member);
            }
          }
          super.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
        }
        parsePostMemberNameModifiers(methodOrProp) {
          const optional = this.eat(17);
          if (optional) methodOrProp.optional = true;
          if (methodOrProp.readonly && this.match(10)) {
            this.raise(TSErrors.ClassMethodHasReadonly, methodOrProp);
          }
          if (methodOrProp.declare && this.match(10)) {
            this.raise(TSErrors.ClassMethodHasDeclare, methodOrProp);
          }
        }
        shouldParseExportDeclaration() {
          if (this.tsIsDeclarationStart()) return true;
          return super.shouldParseExportDeclaration();
        }
        parseConditional(expr, startLoc, refExpressionErrors) {
          if (!this.match(17)) return expr;
          if (this.state.maybeInArrowParameters) {
            const nextCh = this.lookaheadCharCode();
            if (nextCh === 44 || nextCh === 61 || nextCh === 58 || nextCh === 41) {
              this.setOptionalParametersError(refExpressionErrors);
              return expr;
            }
          }
          return super.parseConditional(expr, startLoc, refExpressionErrors);
        }
        parseParenItem(node, startLoc) {
          const newNode = super.parseParenItem(node, startLoc);
          if (this.eat(17)) {
            newNode.optional = true;
            this.resetEndLocation(node);
          }
          if (this.match(14)) {
            const typeCastNode = this.startNodeAt(startLoc);
            typeCastNode.expression = node;
            typeCastNode.typeAnnotation = this.tsParseTypeAnnotation();
            return this.finishNode(typeCastNode, "TSTypeCastExpression");
          }
          return node;
        }
        parseExportDeclaration(node) {
          if (!this.state.isAmbientContext && this.isContextual(125)) {
            return this.tsInAmbientContext(() => this.parseExportDeclaration(node));
          }
          const startLoc = this.state.startLoc;
          const isDeclare = this.eatContextual(125);
          if (isDeclare && (this.isContextual(125) || !this.shouldParseExportDeclaration())) {
            throw this.raise(TSErrors.ExpectedAmbientAfterExportDeclare, this.state.startLoc);
          }
          const isIdentifier = tokenIsIdentifier(this.state.type);
          const declaration = isIdentifier && this.tsTryParseExportDeclaration() || super.parseExportDeclaration(node);
          if (!declaration) return null;
          if (declaration.type === "TSInterfaceDeclaration" || declaration.type === "TSTypeAliasDeclaration" || isDeclare) {
            node.exportKind = "type";
          }
          if (isDeclare && declaration.type !== "TSImportEqualsDeclaration") {
            this.resetStartLocation(declaration, startLoc);
            declaration.declare = true;
          }
          return declaration;
        }
        parseClassId(node, isStatement, optionalId, bindingType) {
          if ((!isStatement || optionalId) && this.isContextual(113)) {
            return;
          }
          super.parseClassId(node, isStatement, optionalId, node.declare ? 1024 : 8331);
          const typeParameters = this.tsTryParseTypeParameters(this.tsParseInOutConstModifiers);
          if (typeParameters) node.typeParameters = typeParameters;
        }
        parseClassPropertyAnnotation(node) {
          if (!node.optional) {
            if (this.eat(35)) {
              node.definite = true;
            } else if (this.eat(17)) {
              node.optional = true;
            }
          }
          const type = this.tsTryParseTypeAnnotation();
          if (type) node.typeAnnotation = type;
        }
        parseClassProperty(node) {
          this.parseClassPropertyAnnotation(node);
          if (this.state.isAmbientContext && !(node.readonly && !node.typeAnnotation) && this.match(29)) {
            this.raise(TSErrors.DeclareClassFieldHasInitializer, this.state.startLoc);
          }
          if (node.abstract && this.match(29)) {
            const {
              key
            } = node;
            this.raise(TSErrors.AbstractPropertyHasInitializer, this.state.startLoc, {
              propertyName: key.type === "Identifier" && !node.computed ? key.name : `[${this.input.slice(this.offsetToSourcePos(key.start), this.offsetToSourcePos(key.end))}]`
            });
          }
          return super.parseClassProperty(node);
        }
        parseClassPrivateProperty(node) {
          if (node.abstract) {
            this.raise(TSErrors.PrivateElementHasAbstract, node);
          }
          if (node.accessibility) {
            this.raise(TSErrors.PrivateElementHasAccessibility, node, {
              modifier: node.accessibility
            });
          }
          this.parseClassPropertyAnnotation(node);
          return super.parseClassPrivateProperty(node);
        }
        parseClassAccessorProperty(node) {
          this.parseClassPropertyAnnotation(node);
          if (node.optional) {
            this.raise(TSErrors.AccessorCannotBeOptional, node);
          }
          return super.parseClassAccessorProperty(node);
        }
        pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper) {
          const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
          if (typeParameters && isConstructor) {
            this.raise(TSErrors.ConstructorHasTypeParameters, typeParameters);
          }
          const {
            declare = false,
            kind
          } = method;
          if (declare && (kind === "get" || kind === "set")) {
            this.raise(TSErrors.DeclareAccessor, method, {
              kind
            });
          }
          if (typeParameters) method.typeParameters = typeParameters;
          super.pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper);
        }
        pushClassPrivateMethod(classBody, method, isGenerator, isAsync) {
          const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
          if (typeParameters) method.typeParameters = typeParameters;
          super.pushClassPrivateMethod(classBody, method, isGenerator, isAsync);
        }
        declareClassPrivateMethodInScope(node, kind) {
          if (node.type === "TSDeclareMethod") return;
          if (node.type === "MethodDefinition" && node.value.body == null) {
            return;
          }
          super.declareClassPrivateMethodInScope(node, kind);
        }
        parseClassSuper(node) {
          super.parseClassSuper(node);
          if (node.superClass) {
            if (node.superClass.type === "TSInstantiationExpression") {
              const tsInstantiationExpression = node.superClass;
              const superClass2 = tsInstantiationExpression.expression;
              this.takeSurroundingComments(superClass2, superClass2.start, superClass2.end);
              const superTypeArguments = tsInstantiationExpression.typeParameters;
              this.takeSurroundingComments(superTypeArguments, superTypeArguments.start, superTypeArguments.end);
              node.superClass = superClass2;
              node.superTypeParameters = superTypeArguments;
            } else if (this.match(47) || this.match(51)) {
              node.superTypeParameters = this.tsParseTypeArgumentsInExpression();
            }
          }
          if (this.eatContextual(113)) {
            node.implements = this.tsParseHeritageClause("implements");
          }
        }
        parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors) {
          const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
          if (typeParameters) prop.typeParameters = typeParameters;
          return super.parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors);
        }
        parseFunctionParams(node, isConstructor) {
          const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
          if (typeParameters) node.typeParameters = typeParameters;
          super.parseFunctionParams(node, isConstructor);
        }
        parseVarId(decl, kind) {
          super.parseVarId(decl, kind);
          if (decl.id.type === "Identifier" && !this.hasPrecedingLineBreak() && this.eat(35)) {
            decl.definite = true;
          }
          const type = this.tsTryParseTypeAnnotation();
          if (type) {
            decl.id.typeAnnotation = type;
            this.resetEndLocation(decl.id);
          }
        }
        parseAsyncArrowFromCallExpression(node, call) {
          if (this.match(14)) {
            node.returnType = this.tsParseTypeAnnotation();
          }
          return super.parseAsyncArrowFromCallExpression(node, call);
        }
        parseMaybeAssign(refExpressionErrors, afterLeftParse) {
          var _jsx, _jsx2, _typeCast, _jsx3, _typeCast2;
          let state;
          let jsx2;
          let typeCast;
          if (this.hasPlugin("jsx") && (this.match(143) || this.match(47))) {
            state = this.state.clone();
            jsx2 = this.tryParse(() => super.parseMaybeAssign(refExpressionErrors, afterLeftParse), state);
            if (!jsx2.error) return jsx2.node;
            const {
              context
            } = this.state;
            const currentContext = context[context.length - 1];
            if (currentContext === types.j_oTag || currentContext === types.j_expr) {
              context.pop();
            }
          }
          if (!((_jsx = jsx2) != null && _jsx.error) && !this.match(47)) {
            return super.parseMaybeAssign(refExpressionErrors, afterLeftParse);
          }
          if (!state || state === this.state) state = this.state.clone();
          let typeParameters;
          const arrow = this.tryParse((abort) => {
            var _expr$extra, _typeParameters;
            typeParameters = this.tsParseTypeParameters(this.tsParseConstModifier);
            const expr = super.parseMaybeAssign(refExpressionErrors, afterLeftParse);
            if (expr.type !== "ArrowFunctionExpression" || (_expr$extra = expr.extra) != null && _expr$extra.parenthesized) {
              abort();
            }
            if (((_typeParameters = typeParameters) == null ? void 0 : _typeParameters.params.length) !== 0) {
              this.resetStartLocationFromNode(expr, typeParameters);
            }
            expr.typeParameters = typeParameters;
            return expr;
          }, state);
          if (!arrow.error && !arrow.aborted) {
            if (typeParameters) this.reportReservedArrowTypeParam(typeParameters);
            return arrow.node;
          }
          if (!jsx2) {
            assert2(!this.hasPlugin("jsx"));
            typeCast = this.tryParse(() => super.parseMaybeAssign(refExpressionErrors, afterLeftParse), state);
            if (!typeCast.error) return typeCast.node;
          }
          if ((_jsx2 = jsx2) != null && _jsx2.node) {
            this.state = jsx2.failState;
            return jsx2.node;
          }
          if (arrow.node) {
            this.state = arrow.failState;
            if (typeParameters) this.reportReservedArrowTypeParam(typeParameters);
            return arrow.node;
          }
          if ((_typeCast = typeCast) != null && _typeCast.node) {
            this.state = typeCast.failState;
            return typeCast.node;
          }
          throw ((_jsx3 = jsx2) == null ? void 0 : _jsx3.error) || arrow.error || ((_typeCast2 = typeCast) == null ? void 0 : _typeCast2.error);
        }
        reportReservedArrowTypeParam(node) {
          var _node$extra2;
          if (node.params.length === 1 && !node.params[0].constraint && !((_node$extra2 = node.extra) != null && _node$extra2.trailingComma) && this.getPluginOption("typescript", "disallowAmbiguousJSXLike")) {
            this.raise(TSErrors.ReservedArrowTypeParam, node);
          }
        }
        parseMaybeUnary(refExpressionErrors, sawUnary) {
          if (!this.hasPlugin("jsx") && this.match(47)) {
            return this.tsParseTypeAssertion();
          }
          return super.parseMaybeUnary(refExpressionErrors, sawUnary);
        }
        parseArrow(node) {
          if (this.match(14)) {
            const result = this.tryParse((abort) => {
              const returnType = this.tsParseTypeOrTypePredicateAnnotation(14);
              if (this.canInsertSemicolon() || !this.match(19)) abort();
              return returnType;
            });
            if (result.aborted) return;
            if (!result.thrown) {
              if (result.error) this.state = result.failState;
              node.returnType = result.node;
            }
          }
          return super.parseArrow(node);
        }
        parseFunctionParamType(param) {
          if (this.eat(17)) {
            param.optional = true;
          }
          const type = this.tsTryParseTypeAnnotation();
          if (type) param.typeAnnotation = type;
          this.resetEndLocation(param);
          return param;
        }
        isAssignable(node, isBinding) {
          switch (node.type) {
            case "TSTypeCastExpression":
              return this.isAssignable(node.expression, isBinding);
            case "TSParameterProperty":
              return true;
            default:
              return super.isAssignable(node, isBinding);
          }
        }
        toAssignable(node, isLHS = false) {
          switch (node.type) {
            case "ParenthesizedExpression":
              this.toAssignableParenthesizedExpression(node, isLHS);
              break;
            case "TSAsExpression":
            case "TSSatisfiesExpression":
            case "TSNonNullExpression":
            case "TSTypeAssertion":
              if (isLHS) {
                this.expressionScope.recordArrowParameterBindingError(TSErrors.UnexpectedTypeCastInParameter, node);
              } else {
                this.raise(TSErrors.UnexpectedTypeCastInParameter, node);
              }
              this.toAssignable(node.expression, isLHS);
              break;
            case "AssignmentExpression":
              if (!isLHS && node.left.type === "TSTypeCastExpression") {
                node.left = this.typeCastToParameter(node.left);
              }
            default:
              super.toAssignable(node, isLHS);
          }
        }
        toAssignableParenthesizedExpression(node, isLHS) {
          switch (node.expression.type) {
            case "TSAsExpression":
            case "TSSatisfiesExpression":
            case "TSNonNullExpression":
            case "TSTypeAssertion":
            case "ParenthesizedExpression":
              this.toAssignable(node.expression, isLHS);
              break;
            default:
              super.toAssignable(node, isLHS);
          }
        }
        checkToRestConversion(node, allowPattern) {
          switch (node.type) {
            case "TSAsExpression":
            case "TSSatisfiesExpression":
            case "TSTypeAssertion":
            case "TSNonNullExpression":
              this.checkToRestConversion(node.expression, false);
              break;
            default:
              super.checkToRestConversion(node, allowPattern);
          }
        }
        isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding) {
          switch (type) {
            case "TSTypeCastExpression":
              return true;
            case "TSParameterProperty":
              return "parameter";
            case "TSNonNullExpression":
              return "expression";
            case "TSAsExpression":
            case "TSSatisfiesExpression":
            case "TSTypeAssertion":
              return (binding !== 64 || !isUnparenthesizedInAssign) && ["expression", true];
            default:
              return super.isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding);
          }
        }
        parseBindingAtom() {
          if (this.state.type === 78) {
            return this.parseIdentifier(true);
          }
          return super.parseBindingAtom();
        }
        parseMaybeDecoratorArguments(expr, startLoc) {
          if (this.match(47) || this.match(51)) {
            const typeArguments = this.tsParseTypeArgumentsInExpression();
            if (this.match(10)) {
              const call = super.parseMaybeDecoratorArguments(expr, startLoc);
              call.typeParameters = typeArguments;
              return call;
            }
            this.unexpected(null, 10);
          }
          return super.parseMaybeDecoratorArguments(expr, startLoc);
        }
        checkCommaAfterRest(close) {
          if (this.state.isAmbientContext && this.match(12) && this.lookaheadCharCode() === close) {
            this.next();
            return false;
          }
          return super.checkCommaAfterRest(close);
        }
        isClassMethod() {
          return this.match(47) || super.isClassMethod();
        }
        isClassProperty() {
          return this.match(35) || this.match(14) || super.isClassProperty();
        }
        parseMaybeDefault(startLoc, left) {
          const node = super.parseMaybeDefault(startLoc, left);
          if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
            this.raise(TSErrors.TypeAnnotationAfterAssign, node.typeAnnotation);
          }
          return node;
        }
        getTokenFromCode(code2) {
          if (this.state.inType) {
            if (code2 === 62) {
              this.finishOp(48, 1);
              return;
            }
            if (code2 === 60) {
              this.finishOp(47, 1);
              return;
            }
          }
          super.getTokenFromCode(code2);
        }
        reScan_lt_gt() {
          const {
            type
          } = this.state;
          if (type === 47) {
            this.state.pos -= 1;
            this.readToken_lt();
          } else if (type === 48) {
            this.state.pos -= 1;
            this.readToken_gt();
          }
        }
        reScan_lt() {
          const {
            type
          } = this.state;
          if (type === 51) {
            this.state.pos -= 2;
            this.finishOp(47, 1);
            return 47;
          }
          return type;
        }
        toAssignableListItem(exprList, index, isLHS) {
          const node = exprList[index];
          if (node.type === "TSTypeCastExpression") {
            exprList[index] = this.typeCastToParameter(node);
          }
          super.toAssignableListItem(exprList, index, isLHS);
        }
        typeCastToParameter(node) {
          node.expression.typeAnnotation = node.typeAnnotation;
          this.resetEndLocation(node.expression, node.typeAnnotation.loc.end);
          return node.expression;
        }
        shouldParseArrow(params) {
          if (this.match(14)) {
            return params.every((expr) => this.isAssignable(expr, true));
          }
          return super.shouldParseArrow(params);
        }
        shouldParseAsyncArrow() {
          return this.match(14) || super.shouldParseAsyncArrow();
        }
        canHaveLeadingDecorator() {
          return super.canHaveLeadingDecorator() || this.isAbstractClass();
        }
        jsxParseOpeningElementAfterName(node) {
          if (this.match(47) || this.match(51)) {
            const typeArguments = this.tsTryParseAndCatch(() => this.tsParseTypeArgumentsInExpression());
            if (typeArguments) {
              node.typeParameters = typeArguments;
            }
          }
          return super.jsxParseOpeningElementAfterName(node);
        }
        getGetterSetterExpectedParamCount(method) {
          const baseCount = super.getGetterSetterExpectedParamCount(method);
          const params = this.getObjectOrClassMethodParams(method);
          const firstParam = params[0];
          const hasContextParam = firstParam && this.isThisParam(firstParam);
          return hasContextParam ? baseCount + 1 : baseCount;
        }
        parseCatchClauseParam() {
          const param = super.parseCatchClauseParam();
          const type = this.tsTryParseTypeAnnotation();
          if (type) {
            param.typeAnnotation = type;
            this.resetEndLocation(param);
          }
          return param;
        }
        tsInAmbientContext(cb) {
          const {
            isAmbientContext: oldIsAmbientContext,
            strict: oldStrict
          } = this.state;
          this.state.isAmbientContext = true;
          this.state.strict = false;
          try {
            return cb();
          } finally {
            this.state.isAmbientContext = oldIsAmbientContext;
            this.state.strict = oldStrict;
          }
        }
        parseClass(node, isStatement, optionalId) {
          const oldInAbstractClass = this.state.inAbstractClass;
          this.state.inAbstractClass = !!node.abstract;
          try {
            return super.parseClass(node, isStatement, optionalId);
          } finally {
            this.state.inAbstractClass = oldInAbstractClass;
          }
        }
        tsParseAbstractDeclaration(node, decorators) {
          if (this.match(80)) {
            node.abstract = true;
            return this.maybeTakeDecorators(decorators, this.parseClass(node, true, false));
          } else if (this.isContextual(129)) {
            if (!this.hasFollowingLineBreak()) {
              node.abstract = true;
              this.raise(TSErrors.NonClassMethodPropertyHasAbstractModifier, node);
              return this.tsParseInterfaceDeclaration(node);
            } else {
              return null;
            }
          }
          throw this.unexpected(null, 80);
        }
        parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope) {
          const method = super.parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope);
          if (method.abstract || method.type === "TSAbstractMethodDefinition") {
            const hasEstreePlugin = this.hasPlugin("estree");
            const methodFn = hasEstreePlugin ? method.value : method;
            if (methodFn.body) {
              const {
                key
              } = method;
              this.raise(TSErrors.AbstractMethodHasImplementation, method, {
                methodName: key.type === "Identifier" && !method.computed ? key.name : `[${this.input.slice(this.offsetToSourcePos(key.start), this.offsetToSourcePos(key.end))}]`
              });
            }
          }
          return method;
        }
        tsParseTypeParameterName() {
          const typeName = this.parseIdentifier();
          return typeName.name;
        }
        shouldParseAsAmbientContext() {
          return !!this.getPluginOption("typescript", "dts");
        }
        parse() {
          if (this.shouldParseAsAmbientContext()) {
            this.state.isAmbientContext = true;
          }
          return super.parse();
        }
        getExpression() {
          if (this.shouldParseAsAmbientContext()) {
            this.state.isAmbientContext = true;
          }
          return super.getExpression();
        }
        parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly) {
          if (!isString && isMaybeTypeOnly) {
            this.parseTypeOnlyImportExportSpecifier(node, false, isInTypeExport);
            return this.finishNode(node, "ExportSpecifier");
          }
          node.exportKind = "value";
          return super.parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly);
        }
        parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly, bindingType) {
          if (!importedIsString && isMaybeTypeOnly) {
            this.parseTypeOnlyImportExportSpecifier(specifier, true, isInTypeOnlyImport);
            return this.finishNode(specifier, "ImportSpecifier");
          }
          specifier.importKind = "value";
          return super.parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly, isInTypeOnlyImport ? 4098 : 4096);
        }
        parseTypeOnlyImportExportSpecifier(node, isImport, isInTypeOnlyImportExport) {
          const leftOfAsKey = isImport ? "imported" : "local";
          const rightOfAsKey = isImport ? "local" : "exported";
          let leftOfAs = node[leftOfAsKey];
          let rightOfAs;
          let hasTypeSpecifier = false;
          let canParseAsKeyword = true;
          const loc = leftOfAs.loc.start;
          if (this.isContextual(93)) {
            const firstAs = this.parseIdentifier();
            if (this.isContextual(93)) {
              const secondAs = this.parseIdentifier();
              if (tokenIsKeywordOrIdentifier(this.state.type)) {
                hasTypeSpecifier = true;
                leftOfAs = firstAs;
                rightOfAs = isImport ? this.parseIdentifier() : this.parseModuleExportName();
                canParseAsKeyword = false;
              } else {
                rightOfAs = secondAs;
                canParseAsKeyword = false;
              }
            } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
              canParseAsKeyword = false;
              rightOfAs = isImport ? this.parseIdentifier() : this.parseModuleExportName();
            } else {
              hasTypeSpecifier = true;
              leftOfAs = firstAs;
            }
          } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
            hasTypeSpecifier = true;
            if (isImport) {
              leftOfAs = this.parseIdentifier(true);
              if (!this.isContextual(93)) {
                this.checkReservedWord(leftOfAs.name, leftOfAs.loc.start, true, true);
              }
            } else {
              leftOfAs = this.parseModuleExportName();
            }
          }
          if (hasTypeSpecifier && isInTypeOnlyImportExport) {
            this.raise(isImport ? TSErrors.TypeModifierIsUsedInTypeImports : TSErrors.TypeModifierIsUsedInTypeExports, loc);
          }
          node[leftOfAsKey] = leftOfAs;
          node[rightOfAsKey] = rightOfAs;
          const kindKey = isImport ? "importKind" : "exportKind";
          node[kindKey] = hasTypeSpecifier ? "type" : "value";
          if (canParseAsKeyword && this.eatContextual(93)) {
            node[rightOfAsKey] = isImport ? this.parseIdentifier() : this.parseModuleExportName();
          }
          if (!node[rightOfAsKey]) {
            node[rightOfAsKey] = this.cloneIdentifier(node[leftOfAsKey]);
          }
          if (isImport) {
            this.checkIdentifier(node[rightOfAsKey], hasTypeSpecifier ? 4098 : 4096);
          }
        }
        fillOptionalPropertiesForTSESLint(node) {
          var _node$directive, _node$decorators, _node$optional, _node$typeAnnotation, _node$accessibility, _node$decorators2, _node$override, _node$readonly, _node$static, _node$declare, _node$returnType, _node$typeParameters, _node$optional2, _node$optional3, _node$accessibility2, _node$readonly2, _node$static2, _node$declare2, _node$definite, _node$readonly3, _node$typeAnnotation2, _node$accessibility3, _node$decorators3, _node$override2, _node$optional4, _node$id, _node$abstract, _node$declare3, _node$decorators4, _node$implements, _node$superTypeArgume, _node$typeParameters2, _node$declare4, _node$definite2, _node$const, _node$declare5, _node$computed, _node$qualifier, _node$options, _node$declare6, _node$extends, _node$optional5, _node$readonly4, _node$declare7, _node$global, _node$const2, _node$in, _node$out;
          switch (node.type) {
            case "ExpressionStatement":
              (_node$directive = node.directive) != null ? _node$directive : node.directive = void 0;
              return;
            case "RestElement":
              node.value = void 0;
            case "Identifier":
            case "ArrayPattern":
            case "AssignmentPattern":
            case "ObjectPattern":
              (_node$decorators = node.decorators) != null ? _node$decorators : node.decorators = [];
              (_node$optional = node.optional) != null ? _node$optional : node.optional = false;
              (_node$typeAnnotation = node.typeAnnotation) != null ? _node$typeAnnotation : node.typeAnnotation = void 0;
              return;
            case "TSParameterProperty":
              (_node$accessibility = node.accessibility) != null ? _node$accessibility : node.accessibility = void 0;
              (_node$decorators2 = node.decorators) != null ? _node$decorators2 : node.decorators = [];
              (_node$override = node.override) != null ? _node$override : node.override = false;
              (_node$readonly = node.readonly) != null ? _node$readonly : node.readonly = false;
              (_node$static = node.static) != null ? _node$static : node.static = false;
              return;
            case "TSEmptyBodyFunctionExpression":
              node.body = null;
            case "TSDeclareFunction":
            case "FunctionDeclaration":
            case "FunctionExpression":
            case "ClassMethod":
            case "ClassPrivateMethod":
              (_node$declare = node.declare) != null ? _node$declare : node.declare = false;
              (_node$returnType = node.returnType) != null ? _node$returnType : node.returnType = void 0;
              (_node$typeParameters = node.typeParameters) != null ? _node$typeParameters : node.typeParameters = void 0;
              return;
            case "Property":
              (_node$optional2 = node.optional) != null ? _node$optional2 : node.optional = false;
              return;
            case "TSMethodSignature":
            case "TSPropertySignature":
              (_node$optional3 = node.optional) != null ? _node$optional3 : node.optional = false;
            case "TSIndexSignature":
              (_node$accessibility2 = node.accessibility) != null ? _node$accessibility2 : node.accessibility = void 0;
              (_node$readonly2 = node.readonly) != null ? _node$readonly2 : node.readonly = false;
              (_node$static2 = node.static) != null ? _node$static2 : node.static = false;
              return;
            case "TSAbstractPropertyDefinition":
            case "PropertyDefinition":
            case "TSAbstractAccessorProperty":
            case "AccessorProperty":
              (_node$declare2 = node.declare) != null ? _node$declare2 : node.declare = false;
              (_node$definite = node.definite) != null ? _node$definite : node.definite = false;
              (_node$readonly3 = node.readonly) != null ? _node$readonly3 : node.readonly = false;
              (_node$typeAnnotation2 = node.typeAnnotation) != null ? _node$typeAnnotation2 : node.typeAnnotation = void 0;
            case "TSAbstractMethodDefinition":
            case "MethodDefinition":
              (_node$accessibility3 = node.accessibility) != null ? _node$accessibility3 : node.accessibility = void 0;
              (_node$decorators3 = node.decorators) != null ? _node$decorators3 : node.decorators = [];
              (_node$override2 = node.override) != null ? _node$override2 : node.override = false;
              (_node$optional4 = node.optional) != null ? _node$optional4 : node.optional = false;
              return;
            case "ClassExpression":
              (_node$id = node.id) != null ? _node$id : node.id = null;
            case "ClassDeclaration":
              (_node$abstract = node.abstract) != null ? _node$abstract : node.abstract = false;
              (_node$declare3 = node.declare) != null ? _node$declare3 : node.declare = false;
              (_node$decorators4 = node.decorators) != null ? _node$decorators4 : node.decorators = [];
              (_node$implements = node.implements) != null ? _node$implements : node.implements = [];
              (_node$superTypeArgume = node.superTypeArguments) != null ? _node$superTypeArgume : node.superTypeArguments = void 0;
              (_node$typeParameters2 = node.typeParameters) != null ? _node$typeParameters2 : node.typeParameters = void 0;
              return;
            case "TSTypeAliasDeclaration":
            case "VariableDeclaration":
              (_node$declare4 = node.declare) != null ? _node$declare4 : node.declare = false;
              return;
            case "VariableDeclarator":
              (_node$definite2 = node.definite) != null ? _node$definite2 : node.definite = false;
              return;
            case "TSEnumDeclaration":
              (_node$const = node.const) != null ? _node$const : node.const = false;
              (_node$declare5 = node.declare) != null ? _node$declare5 : node.declare = false;
              return;
            case "TSEnumMember":
              (_node$computed = node.computed) != null ? _node$computed : node.computed = false;
              return;
            case "TSImportType":
              (_node$qualifier = node.qualifier) != null ? _node$qualifier : node.qualifier = null;
              (_node$options = node.options) != null ? _node$options : node.options = null;
              return;
            case "TSInterfaceDeclaration":
              (_node$declare6 = node.declare) != null ? _node$declare6 : node.declare = false;
              (_node$extends = node.extends) != null ? _node$extends : node.extends = [];
              return;
            case "TSMappedType":
              (_node$optional5 = node.optional) != null ? _node$optional5 : node.optional = false;
              (_node$readonly4 = node.readonly) != null ? _node$readonly4 : node.readonly = void 0;
              return;
            case "TSModuleDeclaration":
              (_node$declare7 = node.declare) != null ? _node$declare7 : node.declare = false;
              (_node$global = node.global) != null ? _node$global : node.global = node.kind === "global";
              return;
            case "TSTypeParameter":
              (_node$const2 = node.const) != null ? _node$const2 : node.const = false;
              (_node$in = node.in) != null ? _node$in : node.in = false;
              (_node$out = node.out) != null ? _node$out : node.out = false;
              return;
          }
        }
        chStartsBindingIdentifierAndNotRelationalOperator(ch, pos) {
          if (isIdentifierStart(ch)) {
            keywordAndTSRelationalOperator.lastIndex = pos;
            if (keywordAndTSRelationalOperator.test(this.input)) {
              const endCh = this.codePointAtPos(keywordAndTSRelationalOperator.lastIndex);
              if (!isIdentifierChar(endCh) && endCh !== 92) {
                return false;
              }
            }
            return true;
          } else if (ch === 92) {
            return true;
          } else {
            return false;
          }
        }
        nextTokenIsIdentifierAndNotTSRelationalOperatorOnSameLine() {
          const next = this.nextTokenInLineStart();
          const nextCh = this.codePointAtPos(next);
          return this.chStartsBindingIdentifierAndNotRelationalOperator(nextCh, next);
        }
        nextTokenIsIdentifierOrStringLiteralOnSameLine() {
          const next = this.nextTokenInLineStart();
          const nextCh = this.codePointAtPos(next);
          return this.chStartsBindingIdentifier(nextCh, next) || nextCh === 34 || nextCh === 39;
        }
      };
      function isPossiblyLiteralEnum(expression) {
        if (expression.type !== "MemberExpression") return false;
        const {
          computed,
          property
        } = expression;
        if (computed && property.type !== "StringLiteral" && (property.type !== "TemplateLiteral" || property.expressions.length > 0)) {
          return false;
        }
        return isUncomputedMemberExpressionChain(expression.object);
      }
      function isValidAmbientConstInitializer(expression, estree2) {
        var _expression$extra;
        const {
          type
        } = expression;
        if ((_expression$extra = expression.extra) != null && _expression$extra.parenthesized) {
          return false;
        }
        if (estree2) {
          if (type === "Literal") {
            const {
              value
            } = expression;
            if (typeof value === "string" || typeof value === "boolean") {
              return true;
            }
          }
        } else {
          if (type === "StringLiteral" || type === "BooleanLiteral") {
            return true;
          }
        }
        if (isNumber(expression, estree2) || isNegativeNumber(expression, estree2)) {
          return true;
        }
        if (type === "TemplateLiteral" && expression.expressions.length === 0) {
          return true;
        }
        if (isPossiblyLiteralEnum(expression)) {
          return true;
        }
        return false;
      }
      function isNumber(expression, estree2) {
        if (estree2) {
          return expression.type === "Literal" && (typeof expression.value === "number" || "bigint" in expression);
        }
        return expression.type === "NumericLiteral" || expression.type === "BigIntLiteral";
      }
      function isNegativeNumber(expression, estree2) {
        if (expression.type === "UnaryExpression") {
          const {
            operator,
            argument
          } = expression;
          if (operator === "-" && isNumber(argument, estree2)) {
            return true;
          }
        }
        return false;
      }
      function isUncomputedMemberExpressionChain(expression) {
        if (expression.type === "Identifier") return true;
        if (expression.type !== "MemberExpression" || expression.computed) {
          return false;
        }
        return isUncomputedMemberExpressionChain(expression.object);
      }
      var PlaceholderErrors = ParseErrorEnum`placeholders`({
        ClassNameIsRequired: "A class name is required.",
        UnexpectedSpace: "Unexpected space in placeholder."
      });
      var placeholders = (superClass) => class PlaceholdersParserMixin extends superClass {
        parsePlaceholder(expectedNode) {
          if (this.match(133)) {
            const node = this.startNode();
            this.next();
            this.assertNoSpace();
            node.name = super.parseIdentifier(true);
            this.assertNoSpace();
            this.expect(133);
            return this.finishPlaceholder(node, expectedNode);
          }
        }
        finishPlaceholder(node, expectedNode) {
          let placeholder = node;
          if (!placeholder.expectedNode || !placeholder.type) {
            placeholder = this.finishNode(placeholder, "Placeholder");
          }
          placeholder.expectedNode = expectedNode;
          return placeholder;
        }
        getTokenFromCode(code2) {
          if (code2 === 37 && this.input.charCodeAt(this.state.pos + 1) === 37) {
            this.finishOp(133, 2);
          } else {
            super.getTokenFromCode(code2);
          }
        }
        parseExprAtom(refExpressionErrors) {
          return this.parsePlaceholder("Expression") || super.parseExprAtom(refExpressionErrors);
        }
        parseIdentifier(liberal) {
          return this.parsePlaceholder("Identifier") || super.parseIdentifier(liberal);
        }
        checkReservedWord(word, startLoc, checkKeywords, isBinding) {
          if (word !== void 0) {
            super.checkReservedWord(word, startLoc, checkKeywords, isBinding);
          }
        }
        cloneIdentifier(node) {
          const cloned = super.cloneIdentifier(node);
          if (cloned.type === "Placeholder") {
            cloned.expectedNode = node.expectedNode;
          }
          return cloned;
        }
        cloneStringLiteral(node) {
          if (node.type === "Placeholder") {
            return this.cloneIdentifier(node);
          }
          return super.cloneStringLiteral(node);
        }
        parseBindingAtom() {
          return this.parsePlaceholder("Pattern") || super.parseBindingAtom();
        }
        isValidLVal(type, disallowCallExpression, isParenthesized, binding) {
          return type === "Placeholder" || super.isValidLVal(type, disallowCallExpression, isParenthesized, binding);
        }
        toAssignable(node, isLHS) {
          if (node && node.type === "Placeholder" && node.expectedNode === "Expression") {
            node.expectedNode = "Pattern";
          } else {
            super.toAssignable(node, isLHS);
          }
        }
        chStartsBindingIdentifier(ch, pos) {
          if (super.chStartsBindingIdentifier(ch, pos)) {
            return true;
          }
          const next = this.nextTokenStart();
          if (this.input.charCodeAt(next) === 37 && this.input.charCodeAt(next + 1) === 37) {
            return true;
          }
          return false;
        }
        verifyBreakContinue(node, isBreak) {
          var _node$label;
          if (((_node$label = node.label) == null ? void 0 : _node$label.type) === "Placeholder") return;
          super.verifyBreakContinue(node, isBreak);
        }
        parseExpressionStatement(node, expr) {
          var _expr$extra;
          if (expr.type !== "Placeholder" || (_expr$extra = expr.extra) != null && _expr$extra.parenthesized) {
            return super.parseExpressionStatement(node, expr);
          }
          if (this.match(14)) {
            const stmt = node;
            stmt.label = this.finishPlaceholder(expr, "Identifier");
            this.next();
            stmt.body = super.parseStatementOrSloppyAnnexBFunctionDeclaration();
            return this.finishNode(stmt, "LabeledStatement");
          }
          this.semicolon();
          const stmtPlaceholder = node;
          stmtPlaceholder.name = expr.name;
          return this.finishPlaceholder(stmtPlaceholder, "Statement");
        }
        parseBlock(allowDirectives, createNewLexicalScope, afterBlockParse) {
          return this.parsePlaceholder("BlockStatement") || super.parseBlock(allowDirectives, createNewLexicalScope, afterBlockParse);
        }
        parseFunctionId(requireId) {
          return this.parsePlaceholder("Identifier") || super.parseFunctionId(requireId);
        }
        parseClass(node, isStatement, optionalId) {
          const type = isStatement ? "ClassDeclaration" : "ClassExpression";
          this.next();
          const oldStrict = this.state.strict;
          const placeholder = this.parsePlaceholder("Identifier");
          if (placeholder) {
            if (this.match(81) || this.match(133) || this.match(5)) {
              node.id = placeholder;
            } else if (optionalId || !isStatement) {
              node.id = null;
              node.body = this.finishPlaceholder(placeholder, "ClassBody");
              return this.finishNode(node, type);
            } else {
              throw this.raise(PlaceholderErrors.ClassNameIsRequired, this.state.startLoc);
            }
          } else {
            this.parseClassId(node, isStatement, optionalId);
          }
          super.parseClassSuper(node);
          node.body = this.parsePlaceholder("ClassBody") || super.parseClassBody(!!node.superClass, oldStrict);
          return this.finishNode(node, type);
        }
        parseExport(node, decorators) {
          const placeholder = this.parsePlaceholder("Identifier");
          if (!placeholder) return super.parseExport(node, decorators);
          const node2 = node;
          if (!this.isContextual(98) && !this.match(12)) {
            node2.specifiers = [];
            node2.source = null;
            node2.declaration = this.finishPlaceholder(placeholder, "Declaration");
            return this.finishNode(node2, "ExportNamedDeclaration");
          }
          this.expectPlugin("exportDefaultFrom");
          const specifier = this.startNode();
          specifier.exported = placeholder;
          node2.specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
          return super.parseExport(node2, decorators);
        }
        isExportDefaultSpecifier() {
          if (this.match(65)) {
            const next = this.nextTokenStart();
            if (this.isUnparsedContextual(next, "from")) {
              if (this.input.startsWith(tokenLabelName(133), this.nextTokenStartSince(next + 4))) {
                return true;
              }
            }
          }
          return super.isExportDefaultSpecifier();
        }
        maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier) {
          var _specifiers;
          if ((_specifiers = node.specifiers) != null && _specifiers.length) {
            return true;
          }
          return super.maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier);
        }
        checkExport(node) {
          const {
            specifiers
          } = node;
          if (specifiers != null && specifiers.length) {
            node.specifiers = specifiers.filter((node2) => node2.exported.type === "Placeholder");
          }
          super.checkExport(node);
          node.specifiers = specifiers;
        }
        parseImport(node) {
          const placeholder = this.parsePlaceholder("Identifier");
          if (!placeholder) return super.parseImport(node);
          node.specifiers = [];
          if (!this.isContextual(98) && !this.match(12)) {
            node.source = this.finishPlaceholder(placeholder, "StringLiteral");
            this.semicolon();
            return this.finishNode(node, "ImportDeclaration");
          }
          const specifier = this.startNodeAtNode(placeholder);
          specifier.local = placeholder;
          node.specifiers.push(this.finishNode(specifier, "ImportDefaultSpecifier"));
          if (this.eat(12)) {
            const hasStarImport = this.maybeParseStarImportSpecifier(node);
            if (!hasStarImport) this.parseNamedImportSpecifiers(node);
          }
          this.expectContextual(98);
          node.source = this.parseImportSource();
          this.semicolon();
          return this.finishNode(node, "ImportDeclaration");
        }
        parseImportSource() {
          return this.parsePlaceholder("StringLiteral") || super.parseImportSource();
        }
        assertNoSpace() {
          if (this.state.start > this.offsetToSourcePos(this.state.lastTokEndLoc.index)) {
            this.raise(PlaceholderErrors.UnexpectedSpace, this.state.lastTokEndLoc);
          }
        }
      };
      var v8intrinsic = (superClass) => class V8IntrinsicMixin extends superClass {
        parseV8Intrinsic() {
          if (this.match(54)) {
            const v8IntrinsicStartLoc = this.state.startLoc;
            const node = this.startNode();
            this.next();
            if (tokenIsIdentifier(this.state.type)) {
              const name = this.parseIdentifierName();
              const identifier = this.createIdentifier(node, name);
              this.castNodeTo(identifier, "V8IntrinsicIdentifier");
              if (this.match(10)) {
                return identifier;
              }
            }
            this.unexpected(v8IntrinsicStartLoc);
          }
        }
        parseExprAtom(refExpressionErrors) {
          return this.parseV8Intrinsic() || super.parseExprAtom(refExpressionErrors);
        }
      };
      var PIPELINE_PROPOSALS = ["minimal", "fsharp", "hack", "smart"];
      var TOPIC_TOKENS = ["^^", "@@", "^", "%", "#"];
      function validatePlugins(pluginsMap) {
        if (pluginsMap.has("decorators")) {
          if (pluginsMap.has("decorators-legacy")) {
            throw new Error("Cannot use the decorators and decorators-legacy plugin together");
          }
          const decoratorsBeforeExport = pluginsMap.get("decorators").decoratorsBeforeExport;
          if (decoratorsBeforeExport != null && typeof decoratorsBeforeExport !== "boolean") {
            throw new Error("'decoratorsBeforeExport' must be a boolean, if specified.");
          }
          const allowCallParenthesized = pluginsMap.get("decorators").allowCallParenthesized;
          if (allowCallParenthesized != null && typeof allowCallParenthesized !== "boolean") {
            throw new Error("'allowCallParenthesized' must be a boolean.");
          }
        }
        if (pluginsMap.has("flow") && pluginsMap.has("typescript")) {
          throw new Error("Cannot combine flow and typescript plugins.");
        }
        if (pluginsMap.has("placeholders") && pluginsMap.has("v8intrinsic")) {
          throw new Error("Cannot combine placeholders and v8intrinsic plugins.");
        }
        if (pluginsMap.has("pipelineOperator")) {
          var _pluginsMap$get2;
          const proposal = pluginsMap.get("pipelineOperator").proposal;
          if (!PIPELINE_PROPOSALS.includes(proposal)) {
            const proposalList = PIPELINE_PROPOSALS.map((p) => `"${p}"`).join(", ");
            throw new Error(`"pipelineOperator" requires "proposal" option whose value must be one of: ${proposalList}.`);
          }
          if (proposal === "hack") {
            var _pluginsMap$get;
            if (pluginsMap.has("placeholders")) {
              throw new Error("Cannot combine placeholders plugin and Hack-style pipes.");
            }
            if (pluginsMap.has("v8intrinsic")) {
              throw new Error("Cannot combine v8intrinsic plugin and Hack-style pipes.");
            }
            const topicToken = pluginsMap.get("pipelineOperator").topicToken;
            if (!TOPIC_TOKENS.includes(topicToken)) {
              const tokenList = TOPIC_TOKENS.map((t) => `"${t}"`).join(", ");
              throw new Error(`"pipelineOperator" in "proposal": "hack" mode also requires a "topicToken" option whose value must be one of: ${tokenList}.`);
            }
            if (topicToken === "#" && ((_pluginsMap$get = pluginsMap.get("recordAndTuple")) == null ? void 0 : _pluginsMap$get.syntaxType) === "hash") {
              throw new Error(`Plugin conflict between \`["pipelineOperator", { proposal: "hack", topicToken: "#" }]\` and \`${JSON.stringify(["recordAndTuple", pluginsMap.get("recordAndTuple")])}\`.`);
            }
          } else if (proposal === "smart" && ((_pluginsMap$get2 = pluginsMap.get("recordAndTuple")) == null ? void 0 : _pluginsMap$get2.syntaxType) === "hash") {
            throw new Error(`Plugin conflict between \`["pipelineOperator", { proposal: "smart" }]\` and \`${JSON.stringify(["recordAndTuple", pluginsMap.get("recordAndTuple")])}\`.`);
          }
        }
        if (pluginsMap.has("moduleAttributes")) {
          if (pluginsMap.has("deprecatedImportAssert") || pluginsMap.has("importAssertions")) {
            throw new Error("Cannot combine importAssertions, deprecatedImportAssert and moduleAttributes plugins.");
          }
          const moduleAttributesVersionPluginOption = pluginsMap.get("moduleAttributes").version;
          if (moduleAttributesVersionPluginOption !== "may-2020") {
            throw new Error("The 'moduleAttributes' plugin requires a 'version' option, representing the last proposal update. Currently, the only supported value is 'may-2020'.");
          }
        }
        if (pluginsMap.has("importAssertions")) {
          if (pluginsMap.has("deprecatedImportAssert")) {
            throw new Error("Cannot combine importAssertions and deprecatedImportAssert plugins.");
          }
        }
        if (pluginsMap.has("deprecatedImportAssert")) ;
        else if (pluginsMap.has("importAttributes") && pluginsMap.get("importAttributes").deprecatedAssertSyntax) {
          pluginsMap.set("deprecatedImportAssert", {});
        }
        if (pluginsMap.has("recordAndTuple")) {
          const syntaxType = pluginsMap.get("recordAndTuple").syntaxType;
          if (syntaxType != null) {
            const RECORD_AND_TUPLE_SYNTAX_TYPES = ["hash", "bar"];
            if (!RECORD_AND_TUPLE_SYNTAX_TYPES.includes(syntaxType)) {
              throw new Error("The 'syntaxType' option of the 'recordAndTuple' plugin must be one of: " + RECORD_AND_TUPLE_SYNTAX_TYPES.map((p) => `'${p}'`).join(", "));
            }
          }
        }
        if (pluginsMap.has("asyncDoExpressions") && !pluginsMap.has("doExpressions")) {
          const error = new Error("'asyncDoExpressions' requires 'doExpressions', please add 'doExpressions' to parser plugins.");
          error.missingPlugins = "doExpressions";
          throw error;
        }
        if (pluginsMap.has("optionalChainingAssign") && pluginsMap.get("optionalChainingAssign").version !== "2023-07") {
          throw new Error("The 'optionalChainingAssign' plugin requires a 'version' option, representing the last proposal update. Currently, the only supported value is '2023-07'.");
        }
        if (pluginsMap.has("discardBinding") && pluginsMap.get("discardBinding").syntaxType !== "void") {
          throw new Error("The 'discardBinding' plugin requires a 'syntaxType' option. Currently the only supported value is 'void'.");
        }
      }
      var mixinPlugins = {
        estree,
        jsx,
        flow,
        typescript,
        v8intrinsic,
        placeholders
      };
      var mixinPluginNames = Object.keys(mixinPlugins);
      var ExpressionParser = class extends LValParser {
        checkProto(prop, isRecord, sawProto, refExpressionErrors) {
          if (prop.type === "SpreadElement" || this.isObjectMethod(prop) || prop.computed || prop.shorthand) {
            return sawProto;
          }
          const key = prop.key;
          const name = key.type === "Identifier" ? key.name : key.value;
          if (name === "__proto__") {
            if (isRecord) {
              this.raise(Errors.RecordNoProto, key);
              return true;
            }
            if (sawProto) {
              if (refExpressionErrors) {
                if (refExpressionErrors.doubleProtoLoc === null) {
                  refExpressionErrors.doubleProtoLoc = key.loc.start;
                }
              } else {
                this.raise(Errors.DuplicateProto, key);
              }
            }
            return true;
          }
          return sawProto;
        }
        shouldExitDescending(expr, potentialArrowAt) {
          return expr.type === "ArrowFunctionExpression" && this.offsetToSourcePos(expr.start) === potentialArrowAt;
        }
        getExpression() {
          this.enterInitialScopes();
          this.nextToken();
          if (this.match(140)) {
            throw this.raise(Errors.ParseExpressionEmptyInput, this.state.startLoc);
          }
          const expr = this.parseExpression();
          if (!this.match(140)) {
            throw this.raise(Errors.ParseExpressionExpectsEOF, this.state.startLoc, {
              unexpected: this.input.codePointAt(this.state.start)
            });
          }
          this.finalizeRemainingComments();
          expr.comments = this.comments;
          expr.errors = this.state.errors;
          if (this.optionFlags & 256) {
            expr.tokens = this.tokens;
          }
          return expr;
        }
        parseExpression(disallowIn, refExpressionErrors) {
          if (disallowIn) {
            return this.disallowInAnd(() => this.parseExpressionBase(refExpressionErrors));
          }
          return this.allowInAnd(() => this.parseExpressionBase(refExpressionErrors));
        }
        parseExpressionBase(refExpressionErrors) {
          const startLoc = this.state.startLoc;
          const expr = this.parseMaybeAssign(refExpressionErrors);
          if (this.match(12)) {
            const node = this.startNodeAt(startLoc);
            node.expressions = [expr];
            while (this.eat(12)) {
              node.expressions.push(this.parseMaybeAssign(refExpressionErrors));
            }
            this.toReferencedList(node.expressions);
            return this.finishNode(node, "SequenceExpression");
          }
          return expr;
        }
        parseMaybeAssignDisallowIn(refExpressionErrors, afterLeftParse) {
          return this.disallowInAnd(() => this.parseMaybeAssign(refExpressionErrors, afterLeftParse));
        }
        parseMaybeAssignAllowIn(refExpressionErrors, afterLeftParse) {
          return this.allowInAnd(() => this.parseMaybeAssign(refExpressionErrors, afterLeftParse));
        }
        setOptionalParametersError(refExpressionErrors) {
          refExpressionErrors.optionalParametersLoc = this.state.startLoc;
        }
        parseMaybeAssign(refExpressionErrors, afterLeftParse) {
          const startLoc = this.state.startLoc;
          const isYield = this.isContextual(108);
          if (isYield) {
            if (this.prodParam.hasYield) {
              this.next();
              let left2 = this.parseYield(startLoc);
              if (afterLeftParse) {
                left2 = afterLeftParse.call(this, left2, startLoc);
              }
              return left2;
            }
          }
          let ownExpressionErrors;
          if (refExpressionErrors) {
            ownExpressionErrors = false;
          } else {
            refExpressionErrors = new ExpressionErrors();
            ownExpressionErrors = true;
          }
          const {
            type
          } = this.state;
          if (type === 10 || tokenIsIdentifier(type)) {
            this.state.potentialArrowAt = this.state.start;
          }
          let left = this.parseMaybeConditional(refExpressionErrors);
          if (afterLeftParse) {
            left = afterLeftParse.call(this, left, startLoc);
          }
          if (tokenIsAssignment(this.state.type)) {
            const node = this.startNodeAt(startLoc);
            const operator = this.state.value;
            node.operator = operator;
            if (this.match(29)) {
              this.toAssignable(left, true);
              node.left = left;
              const startIndex = startLoc.index;
              if (refExpressionErrors.doubleProtoLoc != null && refExpressionErrors.doubleProtoLoc.index >= startIndex) {
                refExpressionErrors.doubleProtoLoc = null;
              }
              if (refExpressionErrors.shorthandAssignLoc != null && refExpressionErrors.shorthandAssignLoc.index >= startIndex) {
                refExpressionErrors.shorthandAssignLoc = null;
              }
              if (refExpressionErrors.privateKeyLoc != null && refExpressionErrors.privateKeyLoc.index >= startIndex) {
                this.checkDestructuringPrivate(refExpressionErrors);
                refExpressionErrors.privateKeyLoc = null;
              }
              if (refExpressionErrors.voidPatternLoc != null && refExpressionErrors.voidPatternLoc.index >= startIndex) {
                refExpressionErrors.voidPatternLoc = null;
              }
            } else {
              node.left = left;
            }
            this.next();
            node.right = this.parseMaybeAssign();
            this.checkLVal(left, this.finishNode(node, "AssignmentExpression"), void 0, void 0, void 0, void 0, operator === "||=" || operator === "&&=" || operator === "??=");
            return node;
          } else if (ownExpressionErrors) {
            this.checkExpressionErrors(refExpressionErrors, true);
          }
          if (isYield) {
            const {
              type: type2
            } = this.state;
            const startsExpr2 = this.hasPlugin("v8intrinsic") ? tokenCanStartExpression(type2) : tokenCanStartExpression(type2) && !this.match(54);
            if (startsExpr2 && !this.isAmbiguousPrefixOrIdentifier()) {
              this.raiseOverwrite(Errors.YieldNotInGeneratorFunction, startLoc);
              return this.parseYield(startLoc);
            }
          }
          return left;
        }
        parseMaybeConditional(refExpressionErrors) {
          const startLoc = this.state.startLoc;
          const potentialArrowAt = this.state.potentialArrowAt;
          const expr = this.parseExprOps(refExpressionErrors);
          if (this.shouldExitDescending(expr, potentialArrowAt)) {
            return expr;
          }
          return this.parseConditional(expr, startLoc, refExpressionErrors);
        }
        parseConditional(expr, startLoc, refExpressionErrors) {
          if (this.eat(17)) {
            const node = this.startNodeAt(startLoc);
            node.test = expr;
            node.consequent = this.parseMaybeAssignAllowIn();
            this.expect(14);
            node.alternate = this.parseMaybeAssign();
            return this.finishNode(node, "ConditionalExpression");
          }
          return expr;
        }
        parseMaybeUnaryOrPrivate(refExpressionErrors) {
          return this.match(139) ? this.parsePrivateName() : this.parseMaybeUnary(refExpressionErrors);
        }
        parseExprOps(refExpressionErrors) {
          const startLoc = this.state.startLoc;
          const potentialArrowAt = this.state.potentialArrowAt;
          const expr = this.parseMaybeUnaryOrPrivate(refExpressionErrors);
          if (this.shouldExitDescending(expr, potentialArrowAt)) {
            return expr;
          }
          return this.parseExprOp(expr, startLoc, -1);
        }
        parseExprOp(left, leftStartLoc, minPrec) {
          if (this.isPrivateName(left)) {
            const value = this.getPrivateNameSV(left);
            if (minPrec >= tokenOperatorPrecedence(58) || !this.prodParam.hasIn || !this.match(58)) {
              this.raise(Errors.PrivateInExpectedIn, left, {
                identifierName: value
              });
            }
            this.classScope.usePrivateName(value, left.loc.start);
          }
          const op = this.state.type;
          if (tokenIsOperator(op) && (this.prodParam.hasIn || !this.match(58))) {
            let prec = tokenOperatorPrecedence(op);
            if (prec > minPrec) {
              if (op === 39) {
                this.expectPlugin("pipelineOperator");
                if (this.state.inFSharpPipelineDirectBody) {
                  return left;
                }
                this.checkPipelineAtInfixOperator(left, leftStartLoc);
              }
              const node = this.startNodeAt(leftStartLoc);
              node.left = left;
              node.operator = this.state.value;
              const logical = op === 41 || op === 42;
              const coalesce = op === 40;
              if (coalesce) {
                prec = tokenOperatorPrecedence(42);
              }
              this.next();
              if (op === 39 && this.hasPlugin(["pipelineOperator", {
                proposal: "minimal"
              }])) {
                if (this.state.type === 96 && this.prodParam.hasAwait) {
                  throw this.raise(Errors.UnexpectedAwaitAfterPipelineBody, this.state.startLoc);
                }
              }
              node.right = this.parseExprOpRightExpr(op, prec);
              const finishedNode = this.finishNode(node, logical || coalesce ? "LogicalExpression" : "BinaryExpression");
              const nextOp = this.state.type;
              if (coalesce && (nextOp === 41 || nextOp === 42) || logical && nextOp === 40) {
                throw this.raise(Errors.MixingCoalesceWithLogical, this.state.startLoc);
              }
              return this.parseExprOp(finishedNode, leftStartLoc, minPrec);
            }
          }
          return left;
        }
        parseExprOpRightExpr(op, prec) {
          const startLoc = this.state.startLoc;
          switch (op) {
            case 39:
              switch (this.getPluginOption("pipelineOperator", "proposal")) {
                case "hack":
                  return this.withTopicBindingContext(() => {
                    return this.parseHackPipeBody();
                  });
                case "fsharp":
                  return this.withSoloAwaitPermittingContext(() => {
                    return this.parseFSharpPipelineBody(prec);
                  });
              }
              if (this.getPluginOption("pipelineOperator", "proposal") === "smart") {
                return this.withTopicBindingContext(() => {
                  if (this.prodParam.hasYield && this.isContextual(108)) {
                    throw this.raise(Errors.PipeBodyIsTighter, this.state.startLoc);
                  }
                  return this.parseSmartPipelineBodyInStyle(this.parseExprOpBaseRightExpr(op, prec), startLoc);
                });
              }
            default:
              return this.parseExprOpBaseRightExpr(op, prec);
          }
        }
        parseExprOpBaseRightExpr(op, prec) {
          const startLoc = this.state.startLoc;
          return this.parseExprOp(this.parseMaybeUnaryOrPrivate(), startLoc, tokenIsRightAssociative(op) ? prec - 1 : prec);
        }
        parseHackPipeBody() {
          var _body$extra;
          const {
            startLoc
          } = this.state;
          const body = this.parseMaybeAssign();
          const requiredParentheses = UnparenthesizedPipeBodyDescriptions.has(body.type);
          if (requiredParentheses && !((_body$extra = body.extra) != null && _body$extra.parenthesized)) {
            this.raise(Errors.PipeUnparenthesizedBody, startLoc, {
              type: body.type
            });
          }
          if (!this.topicReferenceWasUsedInCurrentContext()) {
            this.raise(Errors.PipeTopicUnused, startLoc);
          }
          return body;
        }
        checkExponentialAfterUnary(node) {
          if (this.match(57)) {
            this.raise(Errors.UnexpectedTokenUnaryExponentiation, node.argument);
          }
        }
        parseMaybeUnary(refExpressionErrors, sawUnary) {
          const startLoc = this.state.startLoc;
          const isAwait = this.isContextual(96);
          if (isAwait && this.recordAwaitIfAllowed()) {
            this.next();
            const expr2 = this.parseAwait(startLoc);
            if (!sawUnary) this.checkExponentialAfterUnary(expr2);
            return expr2;
          }
          const update = this.match(34);
          const node = this.startNode();
          if (tokenIsPrefix(this.state.type)) {
            node.operator = this.state.value;
            node.prefix = true;
            if (this.match(72)) {
              this.expectPlugin("throwExpressions");
            }
            const isDelete = this.match(89);
            this.next();
            node.argument = this.parseMaybeUnary(null, true);
            this.checkExpressionErrors(refExpressionErrors, true);
            if (this.state.strict && isDelete) {
              const arg = node.argument;
              if (arg.type === "Identifier") {
                this.raise(Errors.StrictDelete, node);
              } else if (this.hasPropertyAsPrivateName(arg)) {
                this.raise(Errors.DeletePrivateField, node);
              }
            }
            if (!update) {
              if (!sawUnary) {
                this.checkExponentialAfterUnary(node);
              }
              return this.finishNode(node, "UnaryExpression");
            }
          }
          const expr = this.parseUpdate(node, update, refExpressionErrors);
          if (isAwait) {
            const {
              type
            } = this.state;
            const startsExpr2 = this.hasPlugin("v8intrinsic") ? tokenCanStartExpression(type) : tokenCanStartExpression(type) && !this.match(54);
            if (startsExpr2 && !this.isAmbiguousPrefixOrIdentifier()) {
              this.raiseOverwrite(Errors.AwaitNotInAsyncContext, startLoc);
              return this.parseAwait(startLoc);
            }
          }
          return expr;
        }
        parseUpdate(node, update, refExpressionErrors) {
          if (update) {
            const updateExpressionNode = node;
            this.checkLVal(updateExpressionNode.argument, this.finishNode(updateExpressionNode, "UpdateExpression"));
            return node;
          }
          const startLoc = this.state.startLoc;
          let expr = this.parseExprSubscripts(refExpressionErrors);
          if (this.checkExpressionErrors(refExpressionErrors, false)) return expr;
          while (tokenIsPostfix(this.state.type) && !this.canInsertSemicolon()) {
            const node2 = this.startNodeAt(startLoc);
            node2.operator = this.state.value;
            node2.prefix = false;
            node2.argument = expr;
            this.next();
            this.checkLVal(expr, expr = this.finishNode(node2, "UpdateExpression"));
          }
          return expr;
        }
        parseExprSubscripts(refExpressionErrors) {
          const startLoc = this.state.startLoc;
          const potentialArrowAt = this.state.potentialArrowAt;
          const expr = this.parseExprAtom(refExpressionErrors);
          if (this.shouldExitDescending(expr, potentialArrowAt)) {
            return expr;
          }
          return this.parseSubscripts(expr, startLoc);
        }
        parseSubscripts(base, startLoc, noCalls) {
          const state = {
            optionalChainMember: false,
            maybeAsyncArrow: this.atPossibleAsyncArrow(base),
            stop: false
          };
          do {
            base = this.parseSubscript(base, startLoc, noCalls, state);
            state.maybeAsyncArrow = false;
          } while (!state.stop);
          return base;
        }
        parseSubscript(base, startLoc, noCalls, state) {
          const {
            type
          } = this.state;
          if (!noCalls && type === 15) {
            return this.parseBind(base, startLoc, noCalls, state);
          } else if (tokenIsTemplate(type)) {
            return this.parseTaggedTemplateExpression(base, startLoc, state);
          }
          let optional = false;
          if (type === 18) {
            if (noCalls) {
              this.raise(Errors.OptionalChainingNoNew, this.state.startLoc);
              if (this.lookaheadCharCode() === 40) {
                return this.stopParseSubscript(base, state);
              }
            }
            state.optionalChainMember = optional = true;
            this.next();
          }
          if (!noCalls && this.match(10)) {
            return this.parseCoverCallAndAsyncArrowHead(base, startLoc, state, optional);
          } else {
            const computed = this.eat(0);
            if (computed || optional || this.eat(16)) {
              return this.parseMember(base, startLoc, state, computed, optional);
            } else {
              return this.stopParseSubscript(base, state);
            }
          }
        }
        stopParseSubscript(base, state) {
          state.stop = true;
          return base;
        }
        parseMember(base, startLoc, state, computed, optional) {
          const node = this.startNodeAt(startLoc);
          node.object = base;
          node.computed = computed;
          if (computed) {
            node.property = this.parseExpression();
            this.expect(3);
          } else if (this.match(139)) {
            if (base.type === "Super") {
              this.raise(Errors.SuperPrivateField, startLoc);
            }
            this.classScope.usePrivateName(this.state.value, this.state.startLoc);
            node.property = this.parsePrivateName();
          } else {
            node.property = this.parseIdentifier(true);
          }
          if (state.optionalChainMember) {
            node.optional = optional;
            return this.finishNode(node, "OptionalMemberExpression");
          } else {
            return this.finishNode(node, "MemberExpression");
          }
        }
        parseBind(base, startLoc, noCalls, state) {
          const node = this.startNodeAt(startLoc);
          node.object = base;
          this.next();
          node.callee = this.parseNoCallExpr();
          state.stop = true;
          return this.parseSubscripts(this.finishNode(node, "BindExpression"), startLoc, noCalls);
        }
        parseCoverCallAndAsyncArrowHead(base, startLoc, state, optional) {
          const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
          let refExpressionErrors = null;
          this.state.maybeInArrowParameters = true;
          this.next();
          const node = this.startNodeAt(startLoc);
          node.callee = base;
          const {
            maybeAsyncArrow,
            optionalChainMember
          } = state;
          if (maybeAsyncArrow) {
            this.expressionScope.enter(newAsyncArrowScope());
            refExpressionErrors = new ExpressionErrors();
          }
          if (optionalChainMember) {
            node.optional = optional;
          }
          if (optional) {
            node.arguments = this.parseCallExpressionArguments();
          } else {
            node.arguments = this.parseCallExpressionArguments(base.type !== "Super", node, refExpressionErrors);
          }
          let finishedNode = this.finishCallExpression(node, optionalChainMember);
          if (maybeAsyncArrow && this.shouldParseAsyncArrow() && !optional) {
            state.stop = true;
            this.checkDestructuringPrivate(refExpressionErrors);
            this.expressionScope.validateAsPattern();
            this.expressionScope.exit();
            finishedNode = this.parseAsyncArrowFromCallExpression(this.startNodeAt(startLoc), finishedNode);
          } else {
            if (maybeAsyncArrow) {
              this.checkExpressionErrors(refExpressionErrors, true);
              this.expressionScope.exit();
            }
            this.toReferencedArguments(finishedNode);
          }
          this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
          return finishedNode;
        }
        toReferencedArguments(node, isParenthesizedExpr) {
          this.toReferencedListDeep(node.arguments, isParenthesizedExpr);
        }
        parseTaggedTemplateExpression(base, startLoc, state) {
          const node = this.startNodeAt(startLoc);
          node.tag = base;
          node.quasi = this.parseTemplate(true);
          if (state.optionalChainMember) {
            this.raise(Errors.OptionalChainingNoTemplate, startLoc);
          }
          return this.finishNode(node, "TaggedTemplateExpression");
        }
        atPossibleAsyncArrow(base) {
          return base.type === "Identifier" && base.name === "async" && this.state.lastTokEndLoc.index === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 && this.offsetToSourcePos(base.start) === this.state.potentialArrowAt;
        }
        finishCallExpression(node, optional) {
          if (node.callee.type === "Import") {
            if (node.arguments.length === 0 || node.arguments.length > 2) {
              this.raise(Errors.ImportCallArity, node);
            } else {
              for (const arg of node.arguments) {
                if (arg.type === "SpreadElement") {
                  this.raise(Errors.ImportCallSpreadArgument, arg);
                }
              }
            }
          }
          return this.finishNode(node, optional ? "OptionalCallExpression" : "CallExpression");
        }
        parseCallExpressionArguments(allowPlaceholder, nodeForExtra, refExpressionErrors) {
          const elts = [];
          let first = true;
          const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
          this.state.inFSharpPipelineDirectBody = false;
          while (!this.eat(11)) {
            if (first) {
              first = false;
            } else {
              this.expect(12);
              if (this.match(11)) {
                if (nodeForExtra) {
                  this.addTrailingCommaExtraToNode(nodeForExtra);
                }
                this.next();
                break;
              }
            }
            elts.push(this.parseExprListItem(11, false, refExpressionErrors, allowPlaceholder));
          }
          this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
          return elts;
        }
        shouldParseAsyncArrow() {
          return this.match(19) && !this.canInsertSemicolon();
        }
        parseAsyncArrowFromCallExpression(node, call) {
          var _call$extra;
          this.resetPreviousNodeTrailingComments(call);
          this.expect(19);
          this.parseArrowExpression(node, call.arguments, true, (_call$extra = call.extra) == null ? void 0 : _call$extra.trailingCommaLoc);
          if (call.innerComments) {
            setInnerComments(node, call.innerComments);
          }
          if (call.callee.trailingComments) {
            setInnerComments(node, call.callee.trailingComments);
          }
          return node;
        }
        parseNoCallExpr() {
          const startLoc = this.state.startLoc;
          return this.parseSubscripts(this.parseExprAtom(), startLoc, true);
        }
        parseExprAtom(refExpressionErrors) {
          let node;
          let decorators = null;
          const {
            type
          } = this.state;
          switch (type) {
            case 79:
              return this.parseSuper();
            case 83:
              node = this.startNode();
              this.next();
              if (this.match(16)) {
                return this.parseImportMetaPropertyOrPhaseCall(node);
              }
              if (this.match(10)) {
                if (this.optionFlags & 512) {
                  return this.parseImportCall(node);
                } else {
                  return this.finishNode(node, "Import");
                }
              } else {
                this.raise(Errors.UnsupportedImport, this.state.lastTokStartLoc);
                return this.finishNode(node, "Import");
              }
            case 78:
              node = this.startNode();
              this.next();
              return this.finishNode(node, "ThisExpression");
            case 90: {
              return this.parseDo(this.startNode(), false);
            }
            case 56:
            case 31: {
              this.readRegexp();
              return this.parseRegExpLiteral(this.state.value);
            }
            case 135:
              return this.parseNumericLiteral(this.state.value);
            case 136:
              return this.parseBigIntLiteral(this.state.value);
            case 134:
              return this.parseStringLiteral(this.state.value);
            case 84:
              return this.parseNullLiteral();
            case 85:
              return this.parseBooleanLiteral(true);
            case 86:
              return this.parseBooleanLiteral(false);
            case 10: {
              const canBeArrow = this.state.potentialArrowAt === this.state.start;
              return this.parseParenAndDistinguishExpression(canBeArrow);
            }
            case 0: {
              return this.parseArrayLike(3, false, refExpressionErrors);
            }
            case 5: {
              return this.parseObjectLike(8, false, false, refExpressionErrors);
            }
            case 68:
              return this.parseFunctionOrFunctionSent();
            case 26:
              decorators = this.parseDecorators();
            case 80:
              return this.parseClass(this.maybeTakeDecorators(decorators, this.startNode()), false);
            case 77:
              return this.parseNewOrNewTarget();
            case 25:
            case 24:
              return this.parseTemplate(false);
            case 15: {
              node = this.startNode();
              this.next();
              node.object = null;
              const callee = node.callee = this.parseNoCallExpr();
              if (callee.type === "MemberExpression") {
                return this.finishNode(node, "BindExpression");
              } else {
                throw this.raise(Errors.UnsupportedBind, callee);
              }
            }
            case 139: {
              this.raise(Errors.PrivateInExpectedIn, this.state.startLoc, {
                identifierName: this.state.value
              });
              return this.parsePrivateName();
            }
            case 33: {
              return this.parseTopicReferenceThenEqualsSign(54, "%");
            }
            case 32: {
              return this.parseTopicReferenceThenEqualsSign(44, "^");
            }
            case 37:
            case 38: {
              return this.parseTopicReference("hack");
            }
            case 44:
            case 54:
            case 27: {
              const pipeProposal = this.getPluginOption("pipelineOperator", "proposal");
              if (pipeProposal) {
                return this.parseTopicReference(pipeProposal);
              }
              throw this.unexpected();
            }
            case 47: {
              const lookaheadCh = this.input.codePointAt(this.nextTokenStart());
              if (isIdentifierStart(lookaheadCh) || lookaheadCh === 62) {
                throw this.expectOnePlugin(["jsx", "flow", "typescript"]);
              }
              throw this.unexpected();
            }
            default:
              if (type === 137) {
                return this.parseDecimalLiteral(this.state.value);
              } else if (type === 2 || type === 1) {
                return this.parseArrayLike(this.state.type === 2 ? 4 : 3, true);
              } else if (type === 6 || type === 7) {
                return this.parseObjectLike(this.state.type === 6 ? 9 : 8, false, true);
              }
              if (tokenIsIdentifier(type)) {
                if (this.isContextual(127) && this.lookaheadInLineCharCode() === 123) {
                  return this.parseModuleExpression();
                }
                const canBeArrow = this.state.potentialArrowAt === this.state.start;
                const containsEsc = this.state.containsEsc;
                const id = this.parseIdentifier();
                if (!containsEsc && id.name === "async" && !this.canInsertSemicolon()) {
                  const {
                    type: type2
                  } = this.state;
                  if (type2 === 68) {
                    this.resetPreviousNodeTrailingComments(id);
                    this.next();
                    return this.parseAsyncFunctionExpression(this.startNodeAtNode(id));
                  } else if (tokenIsIdentifier(type2)) {
                    if (canBeArrow && this.lookaheadCharCode() === 61) {
                      return this.parseAsyncArrowUnaryFunction(this.startNodeAtNode(id));
                    } else {
                      return id;
                    }
                  } else if (type2 === 90) {
                    this.resetPreviousNodeTrailingComments(id);
                    return this.parseDo(this.startNodeAtNode(id), true);
                  }
                }
                if (canBeArrow && this.match(19) && !this.canInsertSemicolon()) {
                  this.next();
                  return this.parseArrowExpression(this.startNodeAtNode(id), [id], false);
                }
                return id;
              } else {
                throw this.unexpected();
              }
          }
        }
        parseTopicReferenceThenEqualsSign(topicTokenType, topicTokenValue) {
          const pipeProposal = this.getPluginOption("pipelineOperator", "proposal");
          if (pipeProposal) {
            this.state.type = topicTokenType;
            this.state.value = topicTokenValue;
            this.state.pos--;
            this.state.end--;
            this.state.endLoc = createPositionWithColumnOffset(this.state.endLoc, -1);
            return this.parseTopicReference(pipeProposal);
          }
          throw this.unexpected();
        }
        parseTopicReference(pipeProposal) {
          const node = this.startNode();
          const startLoc = this.state.startLoc;
          const tokenType = this.state.type;
          this.next();
          return this.finishTopicReference(node, startLoc, pipeProposal, tokenType);
        }
        finishTopicReference(node, startLoc, pipeProposal, tokenType) {
          if (this.testTopicReferenceConfiguration(pipeProposal, startLoc, tokenType)) {
            if (pipeProposal === "hack") {
              if (!this.topicReferenceIsAllowedInCurrentContext()) {
                this.raise(Errors.PipeTopicUnbound, startLoc);
              }
              this.registerTopicReference();
              return this.finishNode(node, "TopicReference");
            } else {
              if (!this.topicReferenceIsAllowedInCurrentContext()) {
                this.raise(Errors.PrimaryTopicNotAllowed, startLoc);
              }
              this.registerTopicReference();
              return this.finishNode(node, "PipelinePrimaryTopicReference");
            }
          } else {
            throw this.raise(Errors.PipeTopicUnconfiguredToken, startLoc, {
              token: tokenLabelName(tokenType)
            });
          }
        }
        testTopicReferenceConfiguration(pipeProposal, startLoc, tokenType) {
          switch (pipeProposal) {
            case "hack": {
              return this.hasPlugin(["pipelineOperator", {
                topicToken: tokenLabelName(tokenType)
              }]);
            }
            case "smart":
              return tokenType === 27;
            default:
              throw this.raise(Errors.PipeTopicRequiresHackPipes, startLoc);
          }
        }
        parseAsyncArrowUnaryFunction(node) {
          this.prodParam.enter(functionFlags(true, this.prodParam.hasYield));
          const params = [this.parseIdentifier()];
          this.prodParam.exit();
          if (this.hasPrecedingLineBreak()) {
            this.raise(Errors.LineTerminatorBeforeArrow, this.state.curPosition());
          }
          this.expect(19);
          return this.parseArrowExpression(node, params, true);
        }
        parseDo(node, isAsync) {
          this.expectPlugin("doExpressions");
          if (isAsync) {
            this.expectPlugin("asyncDoExpressions");
          }
          node.async = isAsync;
          this.next();
          const oldLabels = this.state.labels;
          this.state.labels = [];
          if (isAsync) {
            this.prodParam.enter(2);
            node.body = this.parseBlock();
            this.prodParam.exit();
          } else {
            node.body = this.parseBlock();
          }
          this.state.labels = oldLabels;
          return this.finishNode(node, "DoExpression");
        }
        parseSuper() {
          const node = this.startNode();
          this.next();
          if (this.match(10) && !this.scope.allowDirectSuper) {
            if (!(this.optionFlags & 16)) {
              this.raise(Errors.SuperNotAllowed, node);
            }
          } else if (!this.scope.allowSuper) {
            if (!(this.optionFlags & 16)) {
              this.raise(Errors.UnexpectedSuper, node);
            }
          }
          if (!this.match(10) && !this.match(0) && !this.match(16)) {
            this.raise(Errors.UnsupportedSuper, node);
          }
          return this.finishNode(node, "Super");
        }
        parsePrivateName() {
          const node = this.startNode();
          const id = this.startNodeAt(createPositionWithColumnOffset(this.state.startLoc, 1));
          const name = this.state.value;
          this.next();
          node.id = this.createIdentifier(id, name);
          return this.finishNode(node, "PrivateName");
        }
        parseFunctionOrFunctionSent() {
          const node = this.startNode();
          this.next();
          if (this.prodParam.hasYield && this.match(16)) {
            const meta = this.createIdentifier(this.startNodeAtNode(node), "function");
            this.next();
            if (this.match(103)) {
              this.expectPlugin("functionSent");
            } else if (!this.hasPlugin("functionSent")) {
              this.unexpected();
            }
            return this.parseMetaProperty(node, meta, "sent");
          }
          return this.parseFunction(node);
        }
        parseMetaProperty(node, meta, propertyName) {
          node.meta = meta;
          const containsEsc = this.state.containsEsc;
          node.property = this.parseIdentifier(true);
          if (node.property.name !== propertyName || containsEsc) {
            this.raise(Errors.UnsupportedMetaProperty, node.property, {
              target: meta.name,
              onlyValidPropertyName: propertyName
            });
          }
          return this.finishNode(node, "MetaProperty");
        }
        parseImportMetaPropertyOrPhaseCall(node) {
          this.next();
          if (this.isContextual(105) || this.isContextual(97)) {
            const isSource = this.isContextual(105);
            this.expectPlugin(isSource ? "sourcePhaseImports" : "deferredImportEvaluation");
            this.next();
            node.phase = isSource ? "source" : "defer";
            return this.parseImportCall(node);
          } else {
            const id = this.createIdentifierAt(this.startNodeAtNode(node), "import", this.state.lastTokStartLoc);
            if (this.isContextual(101)) {
              if (!this.inModule) {
                this.raise(Errors.ImportMetaOutsideModule, id);
              }
              this.sawUnambiguousESM = true;
            }
            return this.parseMetaProperty(node, id, "meta");
          }
        }
        parseLiteralAtNode(value, type, node) {
          this.addExtra(node, "rawValue", value);
          this.addExtra(node, "raw", this.input.slice(this.offsetToSourcePos(node.start), this.state.end));
          node.value = value;
          this.next();
          return this.finishNode(node, type);
        }
        parseLiteral(value, type) {
          const node = this.startNode();
          return this.parseLiteralAtNode(value, type, node);
        }
        parseStringLiteral(value) {
          return this.parseLiteral(value, "StringLiteral");
        }
        parseNumericLiteral(value) {
          return this.parseLiteral(value, "NumericLiteral");
        }
        parseBigIntLiteral(value) {
          return this.parseLiteral(value, "BigIntLiteral");
        }
        parseDecimalLiteral(value) {
          return this.parseLiteral(value, "DecimalLiteral");
        }
        parseRegExpLiteral(value) {
          const node = this.startNode();
          this.addExtra(node, "raw", this.input.slice(this.offsetToSourcePos(node.start), this.state.end));
          node.pattern = value.pattern;
          node.flags = value.flags;
          this.next();
          return this.finishNode(node, "RegExpLiteral");
        }
        parseBooleanLiteral(value) {
          const node = this.startNode();
          node.value = value;
          this.next();
          return this.finishNode(node, "BooleanLiteral");
        }
        parseNullLiteral() {
          const node = this.startNode();
          this.next();
          return this.finishNode(node, "NullLiteral");
        }
        parseParenAndDistinguishExpression(canBeArrow) {
          const startLoc = this.state.startLoc;
          let val;
          this.next();
          this.expressionScope.enter(newArrowHeadScope());
          const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
          const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
          this.state.maybeInArrowParameters = true;
          this.state.inFSharpPipelineDirectBody = false;
          const innerStartLoc = this.state.startLoc;
          const exprList = [];
          const refExpressionErrors = new ExpressionErrors();
          let first = true;
          let spreadStartLoc;
          let optionalCommaStartLoc;
          while (!this.match(11)) {
            if (first) {
              first = false;
            } else {
              this.expect(12, refExpressionErrors.optionalParametersLoc === null ? null : refExpressionErrors.optionalParametersLoc);
              if (this.match(11)) {
                optionalCommaStartLoc = this.state.startLoc;
                break;
              }
            }
            if (this.match(21)) {
              const spreadNodeStartLoc = this.state.startLoc;
              spreadStartLoc = this.state.startLoc;
              exprList.push(this.parseParenItem(this.parseRestBinding(), spreadNodeStartLoc));
              if (!this.checkCommaAfterRest(41)) {
                break;
              }
            } else {
              exprList.push(this.parseMaybeAssignAllowInOrVoidPattern(11, refExpressionErrors, this.parseParenItem));
            }
          }
          const innerEndLoc = this.state.lastTokEndLoc;
          this.expect(11);
          this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
          this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
          let arrowNode = this.startNodeAt(startLoc);
          if (canBeArrow && this.shouldParseArrow(exprList) && (arrowNode = this.parseArrow(arrowNode))) {
            this.checkDestructuringPrivate(refExpressionErrors);
            this.expressionScope.validateAsPattern();
            this.expressionScope.exit();
            this.parseArrowExpression(arrowNode, exprList, false);
            return arrowNode;
          }
          this.expressionScope.exit();
          if (!exprList.length) {
            this.unexpected(this.state.lastTokStartLoc);
          }
          if (optionalCommaStartLoc) this.unexpected(optionalCommaStartLoc);
          if (spreadStartLoc) this.unexpected(spreadStartLoc);
          this.checkExpressionErrors(refExpressionErrors, true);
          this.toReferencedListDeep(exprList, true);
          if (exprList.length > 1) {
            val = this.startNodeAt(innerStartLoc);
            val.expressions = exprList;
            this.finishNode(val, "SequenceExpression");
            this.resetEndLocation(val, innerEndLoc);
          } else {
            val = exprList[0];
          }
          return this.wrapParenthesis(startLoc, val);
        }
        wrapParenthesis(startLoc, expression) {
          if (!(this.optionFlags & 1024)) {
            this.addExtra(expression, "parenthesized", true);
            this.addExtra(expression, "parenStart", startLoc.index);
            this.takeSurroundingComments(expression, startLoc.index, this.state.lastTokEndLoc.index);
            return expression;
          }
          const parenExpression = this.startNodeAt(startLoc);
          parenExpression.expression = expression;
          return this.finishNode(parenExpression, "ParenthesizedExpression");
        }
        shouldParseArrow(params) {
          return !this.canInsertSemicolon();
        }
        parseArrow(node) {
          if (this.eat(19)) {
            return node;
          }
        }
        parseParenItem(node, startLoc) {
          return node;
        }
        parseNewOrNewTarget() {
          const node = this.startNode();
          this.next();
          if (this.match(16)) {
            const meta = this.createIdentifier(this.startNodeAtNode(node), "new");
            this.next();
            const metaProp = this.parseMetaProperty(node, meta, "target");
            if (!this.scope.allowNewTarget) {
              this.raise(Errors.UnexpectedNewTarget, metaProp);
            }
            return metaProp;
          }
          return this.parseNew(node);
        }
        parseNew(node) {
          this.parseNewCallee(node);
          if (this.eat(10)) {
            const args = this.parseExprList(11);
            this.toReferencedList(args);
            node.arguments = args;
          } else {
            node.arguments = [];
          }
          return this.finishNode(node, "NewExpression");
        }
        parseNewCallee(node) {
          const isImport = this.match(83);
          const callee = this.parseNoCallExpr();
          node.callee = callee;
          if (isImport && (callee.type === "Import" || callee.type === "ImportExpression")) {
            this.raise(Errors.ImportCallNotNewExpression, callee);
          }
        }
        parseTemplateElement(isTagged) {
          const {
            start,
            startLoc,
            end,
            value
          } = this.state;
          const elemStart = start + 1;
          const elem = this.startNodeAt(createPositionWithColumnOffset(startLoc, 1));
          if (value === null) {
            if (!isTagged) {
              this.raise(Errors.InvalidEscapeSequenceTemplate, createPositionWithColumnOffset(this.state.firstInvalidTemplateEscapePos, 1));
            }
          }
          const isTail = this.match(24);
          const endOffset = isTail ? -1 : -2;
          const elemEnd = end + endOffset;
          elem.value = {
            raw: this.input.slice(elemStart, elemEnd).replace(/\r\n?/g, "\n"),
            cooked: value === null ? null : value.slice(1, endOffset)
          };
          elem.tail = isTail;
          this.next();
          const finishedNode = this.finishNode(elem, "TemplateElement");
          this.resetEndLocation(finishedNode, createPositionWithColumnOffset(this.state.lastTokEndLoc, endOffset));
          return finishedNode;
        }
        parseTemplate(isTagged) {
          const node = this.startNode();
          let curElt = this.parseTemplateElement(isTagged);
          const quasis = [curElt];
          const substitutions = [];
          while (!curElt.tail) {
            substitutions.push(this.parseTemplateSubstitution());
            this.readTemplateContinuation();
            quasis.push(curElt = this.parseTemplateElement(isTagged));
          }
          node.expressions = substitutions;
          node.quasis = quasis;
          return this.finishNode(node, "TemplateLiteral");
        }
        parseTemplateSubstitution() {
          return this.parseExpression();
        }
        parseObjectLike(close, isPattern, isRecord, refExpressionErrors) {
          if (isRecord) {
            this.expectPlugin("recordAndTuple");
          }
          const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
          this.state.inFSharpPipelineDirectBody = false;
          let sawProto = false;
          let first = true;
          const node = this.startNode();
          node.properties = [];
          this.next();
          while (!this.match(close)) {
            if (first) {
              first = false;
            } else {
              this.expect(12);
              if (this.match(close)) {
                this.addTrailingCommaExtraToNode(node);
                break;
              }
            }
            let prop;
            if (isPattern) {
              prop = this.parseBindingProperty();
            } else {
              prop = this.parsePropertyDefinition(refExpressionErrors);
              sawProto = this.checkProto(prop, isRecord, sawProto, refExpressionErrors);
            }
            if (isRecord && !this.isObjectProperty(prop) && prop.type !== "SpreadElement") {
              this.raise(Errors.InvalidRecordProperty, prop);
            }
            if (prop.shorthand) {
              this.addExtra(prop, "shorthand", true);
            }
            node.properties.push(prop);
          }
          this.next();
          this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
          let type = "ObjectExpression";
          if (isPattern) {
            type = "ObjectPattern";
          } else if (isRecord) {
            type = "RecordExpression";
          }
          return this.finishNode(node, type);
        }
        addTrailingCommaExtraToNode(node) {
          this.addExtra(node, "trailingComma", this.state.lastTokStartLoc.index);
          this.addExtra(node, "trailingCommaLoc", this.state.lastTokStartLoc, false);
        }
        maybeAsyncOrAccessorProp(prop) {
          return !prop.computed && prop.key.type === "Identifier" && (this.isLiteralPropertyName() || this.match(0) || this.match(55));
        }
        parsePropertyDefinition(refExpressionErrors) {
          let decorators = [];
          if (this.match(26)) {
            if (this.hasPlugin("decorators")) {
              this.raise(Errors.UnsupportedPropertyDecorator, this.state.startLoc);
            }
            while (this.match(26)) {
              decorators.push(this.parseDecorator());
            }
          }
          const prop = this.startNode();
          let isAsync = false;
          let isAccessor = false;
          let startLoc;
          if (this.match(21)) {
            if (decorators.length) this.unexpected();
            return this.parseSpread();
          }
          if (decorators.length) {
            prop.decorators = decorators;
            decorators = [];
          }
          prop.method = false;
          if (refExpressionErrors) {
            startLoc = this.state.startLoc;
          }
          let isGenerator = this.eat(55);
          this.parsePropertyNamePrefixOperator(prop);
          const containsEsc = this.state.containsEsc;
          this.parsePropertyName(prop, refExpressionErrors);
          if (!isGenerator && !containsEsc && this.maybeAsyncOrAccessorProp(prop)) {
            const {
              key
            } = prop;
            const keyName = key.name;
            if (keyName === "async" && !this.hasPrecedingLineBreak()) {
              isAsync = true;
              this.resetPreviousNodeTrailingComments(key);
              isGenerator = this.eat(55);
              this.parsePropertyName(prop);
            }
            if (keyName === "get" || keyName === "set") {
              isAccessor = true;
              this.resetPreviousNodeTrailingComments(key);
              prop.kind = keyName;
              if (this.match(55)) {
                isGenerator = true;
                this.raise(Errors.AccessorIsGenerator, this.state.curPosition(), {
                  kind: keyName
                });
                this.next();
              }
              this.parsePropertyName(prop);
            }
          }
          return this.parseObjPropValue(prop, startLoc, isGenerator, isAsync, false, isAccessor, refExpressionErrors);
        }
        getGetterSetterExpectedParamCount(method) {
          return method.kind === "get" ? 0 : 1;
        }
        getObjectOrClassMethodParams(method) {
          return method.params;
        }
        checkGetterSetterParams(method) {
          var _params;
          const paramCount = this.getGetterSetterExpectedParamCount(method);
          const params = this.getObjectOrClassMethodParams(method);
          if (params.length !== paramCount) {
            this.raise(method.kind === "get" ? Errors.BadGetterArity : Errors.BadSetterArity, method);
          }
          if (method.kind === "set" && ((_params = params[params.length - 1]) == null ? void 0 : _params.type) === "RestElement") {
            this.raise(Errors.BadSetterRestParameter, method);
          }
        }
        parseObjectMethod(prop, isGenerator, isAsync, isPattern, isAccessor) {
          if (isAccessor) {
            const finishedProp = this.parseMethod(prop, isGenerator, false, false, false, "ObjectMethod");
            this.checkGetterSetterParams(finishedProp);
            return finishedProp;
          }
          if (isAsync || isGenerator || this.match(10)) {
            if (isPattern) this.unexpected();
            prop.kind = "method";
            prop.method = true;
            return this.parseMethod(prop, isGenerator, isAsync, false, false, "ObjectMethod");
          }
        }
        parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors) {
          prop.shorthand = false;
          if (this.eat(14)) {
            prop.value = isPattern ? this.parseMaybeDefault(this.state.startLoc) : this.parseMaybeAssignAllowInOrVoidPattern(8, refExpressionErrors);
            return this.finishObjectProperty(prop);
          }
          if (!prop.computed && prop.key.type === "Identifier") {
            this.checkReservedWord(prop.key.name, prop.key.loc.start, true, false);
            if (isPattern) {
              prop.value = this.parseMaybeDefault(startLoc, this.cloneIdentifier(prop.key));
            } else if (this.match(29)) {
              const shorthandAssignLoc = this.state.startLoc;
              if (refExpressionErrors != null) {
                if (refExpressionErrors.shorthandAssignLoc === null) {
                  refExpressionErrors.shorthandAssignLoc = shorthandAssignLoc;
                }
              } else {
                this.raise(Errors.InvalidCoverInitializedName, shorthandAssignLoc);
              }
              prop.value = this.parseMaybeDefault(startLoc, this.cloneIdentifier(prop.key));
            } else {
              prop.value = this.cloneIdentifier(prop.key);
            }
            prop.shorthand = true;
            return this.finishObjectProperty(prop);
          }
        }
        finishObjectProperty(node) {
          return this.finishNode(node, "ObjectProperty");
        }
        parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors) {
          const node = this.parseObjectMethod(prop, isGenerator, isAsync, isPattern, isAccessor) || this.parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors);
          if (!node) this.unexpected();
          return node;
        }
        parsePropertyName(prop, refExpressionErrors) {
          if (this.eat(0)) {
            prop.computed = true;
            prop.key = this.parseMaybeAssignAllowIn();
            this.expect(3);
          } else {
            const {
              type,
              value
            } = this.state;
            let key;
            if (tokenIsKeywordOrIdentifier(type)) {
              key = this.parseIdentifier(true);
            } else {
              switch (type) {
                case 135:
                  key = this.parseNumericLiteral(value);
                  break;
                case 134:
                  key = this.parseStringLiteral(value);
                  break;
                case 136:
                  key = this.parseBigIntLiteral(value);
                  break;
                case 139: {
                  const privateKeyLoc = this.state.startLoc;
                  if (refExpressionErrors != null) {
                    if (refExpressionErrors.privateKeyLoc === null) {
                      refExpressionErrors.privateKeyLoc = privateKeyLoc;
                    }
                  } else {
                    this.raise(Errors.UnexpectedPrivateField, privateKeyLoc);
                  }
                  key = this.parsePrivateName();
                  break;
                }
                default:
                  if (type === 137) {
                    key = this.parseDecimalLiteral(value);
                    break;
                  }
                  this.unexpected();
              }
            }
            prop.key = key;
            if (type !== 139) {
              prop.computed = false;
            }
          }
        }
        initFunction(node, isAsync) {
          node.id = null;
          node.generator = false;
          node.async = isAsync;
        }
        parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope = false) {
          this.initFunction(node, isAsync);
          node.generator = isGenerator;
          this.scope.enter(514 | 16 | (inClassScope ? 576 : 0) | (allowDirectSuper ? 32 : 0));
          this.prodParam.enter(functionFlags(isAsync, node.generator));
          this.parseFunctionParams(node, isConstructor);
          const finishedNode = this.parseFunctionBodyAndFinish(node, type, true);
          this.prodParam.exit();
          this.scope.exit();
          return finishedNode;
        }
        parseArrayLike(close, isTuple, refExpressionErrors) {
          if (isTuple) {
            this.expectPlugin("recordAndTuple");
          }
          const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
          this.state.inFSharpPipelineDirectBody = false;
          const node = this.startNode();
          this.next();
          node.elements = this.parseExprList(close, !isTuple, refExpressionErrors, node);
          this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
          return this.finishNode(node, isTuple ? "TupleExpression" : "ArrayExpression");
        }
        parseArrowExpression(node, params, isAsync, trailingCommaLoc) {
          this.scope.enter(514 | 4);
          let flags = functionFlags(isAsync, false);
          if (!this.match(5) && this.prodParam.hasIn) {
            flags |= 8;
          }
          this.prodParam.enter(flags);
          this.initFunction(node, isAsync);
          const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
          if (params) {
            this.state.maybeInArrowParameters = true;
            this.setArrowFunctionParameters(node, params, trailingCommaLoc);
          }
          this.state.maybeInArrowParameters = false;
          this.parseFunctionBody(node, true);
          this.prodParam.exit();
          this.scope.exit();
          this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
          return this.finishNode(node, "ArrowFunctionExpression");
        }
        setArrowFunctionParameters(node, params, trailingCommaLoc) {
          this.toAssignableList(params, trailingCommaLoc, false);
          node.params = params;
        }
        parseFunctionBodyAndFinish(node, type, isMethod = false) {
          this.parseFunctionBody(node, false, isMethod);
          return this.finishNode(node, type);
        }
        parseFunctionBody(node, allowExpression, isMethod = false) {
          const isExpression = allowExpression && !this.match(5);
          this.expressionScope.enter(newExpressionScope());
          if (isExpression) {
            node.body = this.parseMaybeAssign();
            this.checkParams(node, false, allowExpression, false);
          } else {
            const oldStrict = this.state.strict;
            const oldLabels = this.state.labels;
            this.state.labels = [];
            this.prodParam.enter(this.prodParam.currentFlags() | 4);
            node.body = this.parseBlock(true, false, (hasStrictModeDirective) => {
              const nonSimple = !this.isSimpleParamList(node.params);
              if (hasStrictModeDirective && nonSimple) {
                this.raise(Errors.IllegalLanguageModeDirective, (node.kind === "method" || node.kind === "constructor") && !!node.key ? node.key.loc.end : node);
              }
              const strictModeChanged = !oldStrict && this.state.strict;
              this.checkParams(node, !this.state.strict && !allowExpression && !isMethod && !nonSimple, allowExpression, strictModeChanged);
              if (this.state.strict && node.id) {
                this.checkIdentifier(node.id, 65, strictModeChanged);
              }
            });
            this.prodParam.exit();
            this.state.labels = oldLabels;
          }
          this.expressionScope.exit();
        }
        isSimpleParameter(node) {
          return node.type === "Identifier";
        }
        isSimpleParamList(params) {
          for (let i = 0, len = params.length; i < len; i++) {
            if (!this.isSimpleParameter(params[i])) return false;
          }
          return true;
        }
        checkParams(node, allowDuplicates, isArrowFunction, strictModeChanged = true) {
          const checkClashes = !allowDuplicates && /* @__PURE__ */ new Set();
          const formalParameters = {
            type: "FormalParameters"
          };
          for (const param of node.params) {
            this.checkLVal(param, formalParameters, 5, checkClashes, strictModeChanged);
          }
        }
        parseExprList(close, allowEmpty, refExpressionErrors, nodeForExtra) {
          const elts = [];
          let first = true;
          while (!this.eat(close)) {
            if (first) {
              first = false;
            } else {
              this.expect(12);
              if (this.match(close)) {
                if (nodeForExtra) {
                  this.addTrailingCommaExtraToNode(nodeForExtra);
                }
                this.next();
                break;
              }
            }
            elts.push(this.parseExprListItem(close, allowEmpty, refExpressionErrors));
          }
          return elts;
        }
        parseExprListItem(close, allowEmpty, refExpressionErrors, allowPlaceholder) {
          let elt;
          if (this.match(12)) {
            if (!allowEmpty) {
              this.raise(Errors.UnexpectedToken, this.state.curPosition(), {
                unexpected: ","
              });
            }
            elt = null;
          } else if (this.match(21)) {
            const spreadNodeStartLoc = this.state.startLoc;
            elt = this.parseParenItem(this.parseSpread(refExpressionErrors), spreadNodeStartLoc);
          } else if (this.match(17)) {
            this.expectPlugin("partialApplication");
            if (!allowPlaceholder) {
              this.raise(Errors.UnexpectedArgumentPlaceholder, this.state.startLoc);
            }
            const node = this.startNode();
            this.next();
            elt = this.finishNode(node, "ArgumentPlaceholder");
          } else {
            elt = this.parseMaybeAssignAllowInOrVoidPattern(close, refExpressionErrors, this.parseParenItem);
          }
          return elt;
        }
        parseIdentifier(liberal) {
          const node = this.startNode();
          const name = this.parseIdentifierName(liberal);
          return this.createIdentifier(node, name);
        }
        createIdentifier(node, name) {
          node.name = name;
          node.loc.identifierName = name;
          return this.finishNode(node, "Identifier");
        }
        createIdentifierAt(node, name, endLoc) {
          node.name = name;
          node.loc.identifierName = name;
          return this.finishNodeAt(node, "Identifier", endLoc);
        }
        parseIdentifierName(liberal) {
          let name;
          const {
            startLoc,
            type
          } = this.state;
          if (tokenIsKeywordOrIdentifier(type)) {
            name = this.state.value;
          } else {
            this.unexpected();
          }
          const tokenIsKeyword2 = tokenKeywordOrIdentifierIsKeyword(type);
          if (liberal) {
            if (tokenIsKeyword2) {
              this.replaceToken(132);
            }
          } else {
            this.checkReservedWord(name, startLoc, tokenIsKeyword2, false);
          }
          this.next();
          return name;
        }
        checkReservedWord(word, startLoc, checkKeywords, isBinding) {
          if (word.length > 10) {
            return;
          }
          if (!canBeReservedWord(word)) {
            return;
          }
          if (checkKeywords && isKeyword(word)) {
            this.raise(Errors.UnexpectedKeyword, startLoc, {
              keyword: word
            });
            return;
          }
          const reservedTest = !this.state.strict ? isReservedWord : isBinding ? isStrictBindReservedWord : isStrictReservedWord;
          if (reservedTest(word, this.inModule)) {
            this.raise(Errors.UnexpectedReservedWord, startLoc, {
              reservedWord: word
            });
            return;
          } else if (word === "yield") {
            if (this.prodParam.hasYield) {
              this.raise(Errors.YieldBindingIdentifier, startLoc);
              return;
            }
          } else if (word === "await") {
            if (this.prodParam.hasAwait) {
              this.raise(Errors.AwaitBindingIdentifier, startLoc);
              return;
            }
            if (this.scope.inStaticBlock) {
              this.raise(Errors.AwaitBindingIdentifierInStaticBlock, startLoc);
              return;
            }
            this.expressionScope.recordAsyncArrowParametersError(startLoc);
          } else if (word === "arguments") {
            if (this.scope.inClassAndNotInNonArrowFunction) {
              this.raise(Errors.ArgumentsInClass, startLoc);
              return;
            }
          }
        }
        recordAwaitIfAllowed() {
          const isAwaitAllowed = this.prodParam.hasAwait;
          if (isAwaitAllowed && !this.scope.inFunction) {
            this.state.hasTopLevelAwait = true;
          }
          return isAwaitAllowed;
        }
        parseAwait(startLoc) {
          const node = this.startNodeAt(startLoc);
          this.expressionScope.recordParameterInitializerError(Errors.AwaitExpressionFormalParameter, node);
          if (this.eat(55)) {
            this.raise(Errors.ObsoleteAwaitStar, node);
          }
          if (!this.scope.inFunction && !(this.optionFlags & 1)) {
            if (this.isAmbiguousPrefixOrIdentifier()) {
              this.ambiguousScriptDifferentAst = true;
            } else {
              this.sawUnambiguousESM = true;
            }
          }
          if (!this.state.soloAwait) {
            node.argument = this.parseMaybeUnary(null, true);
          }
          return this.finishNode(node, "AwaitExpression");
        }
        isAmbiguousPrefixOrIdentifier() {
          if (this.hasPrecedingLineBreak()) return true;
          const {
            type
          } = this.state;
          return type === 53 || type === 10 || type === 0 || tokenIsTemplate(type) || type === 102 && !this.state.containsEsc || type === 138 || type === 56 || this.hasPlugin("v8intrinsic") && type === 54;
        }
        parseYield(startLoc) {
          const node = this.startNodeAt(startLoc);
          this.expressionScope.recordParameterInitializerError(Errors.YieldInParameter, node);
          let delegating = false;
          let argument = null;
          if (!this.hasPrecedingLineBreak()) {
            delegating = this.eat(55);
            switch (this.state.type) {
              case 13:
              case 140:
              case 8:
              case 11:
              case 3:
              case 9:
              case 14:
              case 12:
                if (!delegating) break;
              default:
                argument = this.parseMaybeAssign();
            }
          }
          node.delegate = delegating;
          node.argument = argument;
          return this.finishNode(node, "YieldExpression");
        }
        parseImportCall(node) {
          this.next();
          node.source = this.parseMaybeAssignAllowIn();
          node.options = null;
          if (this.eat(12)) {
            if (!this.match(11)) {
              node.options = this.parseMaybeAssignAllowIn();
              if (this.eat(12)) {
                this.addTrailingCommaExtraToNode(node.options);
                if (!this.match(11)) {
                  do {
                    this.parseMaybeAssignAllowIn();
                  } while (this.eat(12) && !this.match(11));
                  this.raise(Errors.ImportCallArity, node);
                }
              }
            } else {
              this.addTrailingCommaExtraToNode(node.source);
            }
          }
          this.expect(11);
          return this.finishNode(node, "ImportExpression");
        }
        checkPipelineAtInfixOperator(left, leftStartLoc) {
          if (this.hasPlugin(["pipelineOperator", {
            proposal: "smart"
          }])) {
            if (left.type === "SequenceExpression") {
              this.raise(Errors.PipelineHeadSequenceExpression, leftStartLoc);
            }
          }
        }
        parseSmartPipelineBodyInStyle(childExpr, startLoc) {
          if (this.isSimpleReference(childExpr)) {
            const bodyNode = this.startNodeAt(startLoc);
            bodyNode.callee = childExpr;
            return this.finishNode(bodyNode, "PipelineBareFunction");
          } else {
            const bodyNode = this.startNodeAt(startLoc);
            this.checkSmartPipeTopicBodyEarlyErrors(startLoc);
            bodyNode.expression = childExpr;
            return this.finishNode(bodyNode, "PipelineTopicExpression");
          }
        }
        isSimpleReference(expression) {
          switch (expression.type) {
            case "MemberExpression":
              return !expression.computed && this.isSimpleReference(expression.object);
            case "Identifier":
              return true;
            default:
              return false;
          }
        }
        checkSmartPipeTopicBodyEarlyErrors(startLoc) {
          if (this.match(19)) {
            throw this.raise(Errors.PipelineBodyNoArrow, this.state.startLoc);
          }
          if (!this.topicReferenceWasUsedInCurrentContext()) {
            this.raise(Errors.PipelineTopicUnused, startLoc);
          }
        }
        withTopicBindingContext(callback) {
          const outerContextTopicState = this.state.topicContext;
          this.state.topicContext = {
            maxNumOfResolvableTopics: 1,
            maxTopicIndex: null
          };
          try {
            return callback();
          } finally {
            this.state.topicContext = outerContextTopicState;
          }
        }
        withSmartMixTopicForbiddingContext(callback) {
          if (this.hasPlugin(["pipelineOperator", {
            proposal: "smart"
          }])) {
            const outerContextTopicState = this.state.topicContext;
            this.state.topicContext = {
              maxNumOfResolvableTopics: 0,
              maxTopicIndex: null
            };
            try {
              return callback();
            } finally {
              this.state.topicContext = outerContextTopicState;
            }
          } else {
            return callback();
          }
        }
        withSoloAwaitPermittingContext(callback) {
          const outerContextSoloAwaitState = this.state.soloAwait;
          this.state.soloAwait = true;
          try {
            return callback();
          } finally {
            this.state.soloAwait = outerContextSoloAwaitState;
          }
        }
        allowInAnd(callback) {
          const flags = this.prodParam.currentFlags();
          const prodParamToSet = 8 & ~flags;
          if (prodParamToSet) {
            this.prodParam.enter(flags | 8);
            try {
              return callback();
            } finally {
              this.prodParam.exit();
            }
          }
          return callback();
        }
        disallowInAnd(callback) {
          const flags = this.prodParam.currentFlags();
          const prodParamToClear = 8 & flags;
          if (prodParamToClear) {
            this.prodParam.enter(flags & ~8);
            try {
              return callback();
            } finally {
              this.prodParam.exit();
            }
          }
          return callback();
        }
        registerTopicReference() {
          this.state.topicContext.maxTopicIndex = 0;
        }
        topicReferenceIsAllowedInCurrentContext() {
          return this.state.topicContext.maxNumOfResolvableTopics >= 1;
        }
        topicReferenceWasUsedInCurrentContext() {
          return this.state.topicContext.maxTopicIndex != null && this.state.topicContext.maxTopicIndex >= 0;
        }
        parseFSharpPipelineBody(prec) {
          const startLoc = this.state.startLoc;
          this.state.potentialArrowAt = this.state.start;
          const oldInFSharpPipelineDirectBody = this.state.inFSharpPipelineDirectBody;
          this.state.inFSharpPipelineDirectBody = true;
          const ret = this.parseExprOp(this.parseMaybeUnaryOrPrivate(), startLoc, prec);
          this.state.inFSharpPipelineDirectBody = oldInFSharpPipelineDirectBody;
          return ret;
        }
        parseModuleExpression() {
          this.expectPlugin("moduleBlocks");
          const node = this.startNode();
          this.next();
          if (!this.match(5)) {
            this.unexpected(null, 5);
          }
          const program = this.startNodeAt(this.state.endLoc);
          this.next();
          const revertScopes = this.initializeScopes(true);
          this.enterInitialScopes();
          try {
            node.body = this.parseProgram(program, 8, "module");
          } finally {
            revertScopes();
          }
          return this.finishNode(node, "ModuleExpression");
        }
        parseVoidPattern(refExpressionErrors) {
          this.expectPlugin("discardBinding");
          const node = this.startNode();
          if (refExpressionErrors != null) {
            refExpressionErrors.voidPatternLoc = this.state.startLoc;
          }
          this.next();
          return this.finishNode(node, "VoidPattern");
        }
        parseMaybeAssignAllowInOrVoidPattern(close, refExpressionErrors, afterLeftParse) {
          if (refExpressionErrors != null && this.match(88)) {
            const nextCode = this.lookaheadCharCode();
            if (nextCode === 44 || nextCode === (close === 3 ? 93 : close === 8 ? 125 : 41) || nextCode === 61) {
              return this.parseMaybeDefault(this.state.startLoc, this.parseVoidPattern(refExpressionErrors));
            }
          }
          return this.parseMaybeAssignAllowIn(refExpressionErrors, afterLeftParse);
        }
        parsePropertyNamePrefixOperator(prop) {
        }
      };
      var loopLabel = {
        kind: 1
      };
      var switchLabel = {
        kind: 2
      };
      var loneSurrogate = /[\uD800-\uDFFF]/u;
      var keywordRelationalOperator = /in(?:stanceof)?/y;
      function babel7CompatTokens(tokens, input, startIndex) {
        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];
          const {
            type
          } = token;
          if (typeof type === "number") {
            if (type === 139) {
              const {
                loc,
                start,
                value,
                end
              } = token;
              const hashEndPos = start + 1;
              const hashEndLoc = createPositionWithColumnOffset(loc.start, 1);
              tokens.splice(i, 1, new Token({
                type: getExportedToken(27),
                value: "#",
                start,
                end: hashEndPos,
                startLoc: loc.start,
                endLoc: hashEndLoc
              }), new Token({
                type: getExportedToken(132),
                value,
                start: hashEndPos,
                end,
                startLoc: hashEndLoc,
                endLoc: loc.end
              }));
              i++;
              continue;
            }
            if (tokenIsTemplate(type)) {
              const {
                loc,
                start,
                value,
                end
              } = token;
              const backquoteEnd = start + 1;
              const backquoteEndLoc = createPositionWithColumnOffset(loc.start, 1);
              let startToken;
              if (input.charCodeAt(start - startIndex) === 96) {
                startToken = new Token({
                  type: getExportedToken(22),
                  value: "`",
                  start,
                  end: backquoteEnd,
                  startLoc: loc.start,
                  endLoc: backquoteEndLoc
                });
              } else {
                startToken = new Token({
                  type: getExportedToken(8),
                  value: "}",
                  start,
                  end: backquoteEnd,
                  startLoc: loc.start,
                  endLoc: backquoteEndLoc
                });
              }
              let templateValue, templateElementEnd, templateElementEndLoc, endToken;
              if (type === 24) {
                templateElementEnd = end - 1;
                templateElementEndLoc = createPositionWithColumnOffset(loc.end, -1);
                templateValue = value === null ? null : value.slice(1, -1);
                endToken = new Token({
                  type: getExportedToken(22),
                  value: "`",
                  start: templateElementEnd,
                  end,
                  startLoc: templateElementEndLoc,
                  endLoc: loc.end
                });
              } else {
                templateElementEnd = end - 2;
                templateElementEndLoc = createPositionWithColumnOffset(loc.end, -2);
                templateValue = value === null ? null : value.slice(1, -2);
                endToken = new Token({
                  type: getExportedToken(23),
                  value: "${",
                  start: templateElementEnd,
                  end,
                  startLoc: templateElementEndLoc,
                  endLoc: loc.end
                });
              }
              tokens.splice(i, 1, startToken, new Token({
                type: getExportedToken(20),
                value: templateValue,
                start: backquoteEnd,
                end: templateElementEnd,
                startLoc: backquoteEndLoc,
                endLoc: templateElementEndLoc
              }), endToken);
              i += 2;
              continue;
            }
            token.type = getExportedToken(type);
          }
        }
        return tokens;
      }
      var StatementParser = class extends ExpressionParser {
        parseTopLevel(file, program) {
          file.program = this.parseProgram(program, 140, this.options.sourceType === "module" ? "module" : "script");
          file.comments = this.comments;
          if (this.optionFlags & 256) {
            file.tokens = babel7CompatTokens(this.tokens, this.input, this.startIndex);
          }
          return this.finishNode(file, "File");
        }
        parseProgram(program, end, sourceType) {
          program.sourceType = sourceType;
          program.interpreter = this.parseInterpreterDirective();
          this.parseBlockBody(program, true, true, end);
          if (this.inModule) {
            if (!(this.optionFlags & 64) && this.scope.undefinedExports.size > 0) {
              for (const [localName, at] of Array.from(this.scope.undefinedExports)) {
                this.raise(Errors.ModuleExportUndefined, at, {
                  localName
                });
              }
            }
            this.addExtra(program, "topLevelAwait", this.state.hasTopLevelAwait);
          }
          let finishedProgram;
          if (end === 140) {
            finishedProgram = this.finishNode(program, "Program");
          } else {
            finishedProgram = this.finishNodeAt(program, "Program", createPositionWithColumnOffset(this.state.startLoc, -1));
          }
          return finishedProgram;
        }
        stmtToDirective(stmt) {
          const directive = this.castNodeTo(stmt, "Directive");
          const directiveLiteral = this.castNodeTo(stmt.expression, "DirectiveLiteral");
          const expressionValue = directiveLiteral.value;
          const raw = this.input.slice(this.offsetToSourcePos(directiveLiteral.start), this.offsetToSourcePos(directiveLiteral.end));
          const val = directiveLiteral.value = raw.slice(1, -1);
          this.addExtra(directiveLiteral, "raw", raw);
          this.addExtra(directiveLiteral, "rawValue", val);
          this.addExtra(directiveLiteral, "expressionValue", expressionValue);
          directive.value = directiveLiteral;
          delete stmt.expression;
          return directive;
        }
        parseInterpreterDirective() {
          if (!this.match(28)) {
            return null;
          }
          const node = this.startNode();
          node.value = this.state.value;
          this.next();
          return this.finishNode(node, "InterpreterDirective");
        }
        isLet() {
          if (!this.isContextual(100)) {
            return false;
          }
          return this.hasFollowingBindingAtom();
        }
        isUsing() {
          if (!this.isContextual(107)) {
            return false;
          }
          return this.nextTokenIsIdentifierOnSameLine();
        }
        isForUsing() {
          if (!this.isContextual(107)) {
            return false;
          }
          const next = this.nextTokenInLineStart();
          const nextCh = this.codePointAtPos(next);
          if (this.isUnparsedContextual(next, "of")) {
            const nextCharAfterOf = this.lookaheadCharCodeSince(next + 2);
            if (nextCharAfterOf !== 61 && nextCharAfterOf !== 58 && nextCharAfterOf !== 59) {
              return false;
            }
          }
          if (this.chStartsBindingIdentifier(nextCh, next) || this.isUnparsedContextual(next, "void")) {
            return true;
          }
          return false;
        }
        nextTokenIsIdentifierOnSameLine() {
          const next = this.nextTokenInLineStart();
          const nextCh = this.codePointAtPos(next);
          return this.chStartsBindingIdentifier(nextCh, next);
        }
        isAwaitUsing() {
          if (!this.isContextual(96)) {
            return false;
          }
          let next = this.nextTokenInLineStart();
          if (this.isUnparsedContextual(next, "using")) {
            next = this.nextTokenInLineStartSince(next + 5);
            const nextCh = this.codePointAtPos(next);
            if (this.chStartsBindingIdentifier(nextCh, next)) {
              return true;
            }
          }
          return false;
        }
        chStartsBindingIdentifier(ch, pos) {
          if (isIdentifierStart(ch)) {
            keywordRelationalOperator.lastIndex = pos;
            if (keywordRelationalOperator.test(this.input)) {
              const endCh = this.codePointAtPos(keywordRelationalOperator.lastIndex);
              if (!isIdentifierChar(endCh) && endCh !== 92) {
                return false;
              }
            }
            return true;
          } else if (ch === 92) {
            return true;
          } else {
            return false;
          }
        }
        chStartsBindingPattern(ch) {
          return ch === 91 || ch === 123;
        }
        hasFollowingBindingAtom() {
          const next = this.nextTokenStart();
          const nextCh = this.codePointAtPos(next);
          return this.chStartsBindingPattern(nextCh) || this.chStartsBindingIdentifier(nextCh, next);
        }
        hasInLineFollowingBindingIdentifierOrBrace() {
          const next = this.nextTokenInLineStart();
          const nextCh = this.codePointAtPos(next);
          return nextCh === 123 || this.chStartsBindingIdentifier(nextCh, next);
        }
        allowsUsing() {
          return (this.scope.inModule || !this.scope.inTopLevel) && !this.scope.inBareCaseStatement;
        }
        parseModuleItem() {
          return this.parseStatementLike(1 | 2 | 4 | 8);
        }
        parseStatementListItem() {
          return this.parseStatementLike(2 | 4 | (!this.options.annexB || this.state.strict ? 0 : 8));
        }
        parseStatementOrSloppyAnnexBFunctionDeclaration(allowLabeledFunction = false) {
          let flags = 0;
          if (this.options.annexB && !this.state.strict) {
            flags |= 4;
            if (allowLabeledFunction) {
              flags |= 8;
            }
          }
          return this.parseStatementLike(flags);
        }
        parseStatement() {
          return this.parseStatementLike(0);
        }
        parseStatementLike(flags) {
          let decorators = null;
          if (this.match(26)) {
            decorators = this.parseDecorators(true);
          }
          return this.parseStatementContent(flags, decorators);
        }
        parseStatementContent(flags, decorators) {
          const startType = this.state.type;
          const node = this.startNode();
          const allowDeclaration = !!(flags & 2);
          const allowFunctionDeclaration = !!(flags & 4);
          const topLevel = flags & 1;
          switch (startType) {
            case 60:
              return this.parseBreakContinueStatement(node, true);
            case 63:
              return this.parseBreakContinueStatement(node, false);
            case 64:
              return this.parseDebuggerStatement(node);
            case 90:
              return this.parseDoWhileStatement(node);
            case 91:
              return this.parseForStatement(node);
            case 68:
              if (this.lookaheadCharCode() === 46) break;
              if (!allowFunctionDeclaration) {
                this.raise(this.state.strict ? Errors.StrictFunction : this.options.annexB ? Errors.SloppyFunctionAnnexB : Errors.SloppyFunction, this.state.startLoc);
              }
              return this.parseFunctionStatement(node, false, !allowDeclaration && allowFunctionDeclaration);
            case 80:
              if (!allowDeclaration) this.unexpected();
              return this.parseClass(this.maybeTakeDecorators(decorators, node), true);
            case 69:
              return this.parseIfStatement(node);
            case 70:
              return this.parseReturnStatement(node);
            case 71:
              return this.parseSwitchStatement(node);
            case 72:
              return this.parseThrowStatement(node);
            case 73:
              return this.parseTryStatement(node);
            case 96:
              if (this.isAwaitUsing()) {
                if (!this.allowsUsing()) {
                  this.raise(Errors.UnexpectedUsingDeclaration, node);
                } else if (!allowDeclaration) {
                  this.raise(Errors.UnexpectedLexicalDeclaration, node);
                } else if (!this.recordAwaitIfAllowed()) {
                  this.raise(Errors.AwaitUsingNotInAsyncContext, node);
                }
                this.next();
                return this.parseVarStatement(node, "await using");
              }
              break;
            case 107:
              if (this.state.containsEsc || !this.hasInLineFollowingBindingIdentifierOrBrace()) {
                break;
              }
              if (!this.allowsUsing()) {
                this.raise(Errors.UnexpectedUsingDeclaration, this.state.startLoc);
              } else if (!allowDeclaration) {
                this.raise(Errors.UnexpectedLexicalDeclaration, this.state.startLoc);
              }
              return this.parseVarStatement(node, "using");
            case 100: {
              if (this.state.containsEsc) {
                break;
              }
              const next = this.nextTokenStart();
              const nextCh = this.codePointAtPos(next);
              if (nextCh !== 91) {
                if (!allowDeclaration && this.hasFollowingLineBreak()) break;
                if (!this.chStartsBindingIdentifier(nextCh, next) && nextCh !== 123) {
                  break;
                }
              }
            }
            case 75: {
              if (!allowDeclaration) {
                this.raise(Errors.UnexpectedLexicalDeclaration, this.state.startLoc);
              }
            }
            case 74: {
              const kind = this.state.value;
              return this.parseVarStatement(node, kind);
            }
            case 92:
              return this.parseWhileStatement(node);
            case 76:
              return this.parseWithStatement(node);
            case 5:
              return this.parseBlock();
            case 13:
              return this.parseEmptyStatement(node);
            case 83: {
              const nextTokenCharCode = this.lookaheadCharCode();
              if (nextTokenCharCode === 40 || nextTokenCharCode === 46) {
                break;
              }
            }
            case 82: {
              if (!(this.optionFlags & 8) && !topLevel) {
                this.raise(Errors.UnexpectedImportExport, this.state.startLoc);
              }
              this.next();
              let result;
              if (startType === 83) {
                result = this.parseImport(node);
              } else {
                result = this.parseExport(node, decorators);
              }
              this.assertModuleNodeAllowed(result);
              return result;
            }
            default: {
              if (this.isAsyncFunction()) {
                if (!allowDeclaration) {
                  this.raise(Errors.AsyncFunctionInSingleStatementContext, this.state.startLoc);
                }
                this.next();
                return this.parseFunctionStatement(node, true, !allowDeclaration && allowFunctionDeclaration);
              }
            }
          }
          const maybeName = this.state.value;
          const expr = this.parseExpression();
          if (tokenIsIdentifier(startType) && expr.type === "Identifier" && this.eat(14)) {
            return this.parseLabeledStatement(node, maybeName, expr, flags);
          } else {
            return this.parseExpressionStatement(node, expr, decorators);
          }
        }
        assertModuleNodeAllowed(node) {
          if (!(this.optionFlags & 8) && !this.inModule) {
            this.raise(Errors.ImportOutsideModule, node);
          }
        }
        decoratorsEnabledBeforeExport() {
          if (this.hasPlugin("decorators-legacy")) return true;
          return this.hasPlugin("decorators") && this.getPluginOption("decorators", "decoratorsBeforeExport") !== false;
        }
        maybeTakeDecorators(maybeDecorators, classNode, exportNode) {
          if (maybeDecorators) {
            var _classNode$decorators;
            if ((_classNode$decorators = classNode.decorators) != null && _classNode$decorators.length) {
              if (typeof this.getPluginOption("decorators", "decoratorsBeforeExport") !== "boolean") {
                this.raise(Errors.DecoratorsBeforeAfterExport, classNode.decorators[0]);
              }
              classNode.decorators.unshift(...maybeDecorators);
            } else {
              classNode.decorators = maybeDecorators;
            }
            this.resetStartLocationFromNode(classNode, maybeDecorators[0]);
            if (exportNode) this.resetStartLocationFromNode(exportNode, classNode);
          }
          return classNode;
        }
        canHaveLeadingDecorator() {
          return this.match(80);
        }
        parseDecorators(allowExport) {
          const decorators = [];
          do {
            decorators.push(this.parseDecorator());
          } while (this.match(26));
          if (this.match(82)) {
            if (!allowExport) {
              this.unexpected();
            }
            if (!this.decoratorsEnabledBeforeExport()) {
              this.raise(Errors.DecoratorExportClass, this.state.startLoc);
            }
          } else if (!this.canHaveLeadingDecorator()) {
            throw this.raise(Errors.UnexpectedLeadingDecorator, this.state.startLoc);
          }
          return decorators;
        }
        parseDecorator() {
          this.expectOnePlugin(["decorators", "decorators-legacy"]);
          const node = this.startNode();
          this.next();
          if (this.hasPlugin("decorators")) {
            const startLoc = this.state.startLoc;
            let expr;
            if (this.match(10)) {
              const startLoc2 = this.state.startLoc;
              this.next();
              expr = this.parseExpression();
              this.expect(11);
              expr = this.wrapParenthesis(startLoc2, expr);
              const paramsStartLoc = this.state.startLoc;
              node.expression = this.parseMaybeDecoratorArguments(expr, startLoc2);
              if (this.getPluginOption("decorators", "allowCallParenthesized") === false && node.expression !== expr) {
                this.raise(Errors.DecoratorArgumentsOutsideParentheses, paramsStartLoc);
              }
            } else {
              expr = this.parseIdentifier(false);
              while (this.eat(16)) {
                const node2 = this.startNodeAt(startLoc);
                node2.object = expr;
                if (this.match(139)) {
                  this.classScope.usePrivateName(this.state.value, this.state.startLoc);
                  node2.property = this.parsePrivateName();
                } else {
                  node2.property = this.parseIdentifier(true);
                }
                node2.computed = false;
                expr = this.finishNode(node2, "MemberExpression");
              }
              node.expression = this.parseMaybeDecoratorArguments(expr, startLoc);
            }
          } else {
            node.expression = this.parseExprSubscripts();
          }
          return this.finishNode(node, "Decorator");
        }
        parseMaybeDecoratorArguments(expr, startLoc) {
          if (this.eat(10)) {
            const node = this.startNodeAt(startLoc);
            node.callee = expr;
            node.arguments = this.parseCallExpressionArguments();
            this.toReferencedList(node.arguments);
            return this.finishNode(node, "CallExpression");
          }
          return expr;
        }
        parseBreakContinueStatement(node, isBreak) {
          this.next();
          if (this.isLineTerminator()) {
            node.label = null;
          } else {
            node.label = this.parseIdentifier();
            this.semicolon();
          }
          this.verifyBreakContinue(node, isBreak);
          return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
        }
        verifyBreakContinue(node, isBreak) {
          let i;
          for (i = 0; i < this.state.labels.length; ++i) {
            const lab = this.state.labels[i];
            if (node.label == null || lab.name === node.label.name) {
              if (lab.kind != null && (isBreak || lab.kind === 1)) {
                break;
              }
              if (node.label && isBreak) break;
            }
          }
          if (i === this.state.labels.length) {
            const type = isBreak ? "BreakStatement" : "ContinueStatement";
            this.raise(Errors.IllegalBreakContinue, node, {
              type
            });
          }
        }
        parseDebuggerStatement(node) {
          this.next();
          this.semicolon();
          return this.finishNode(node, "DebuggerStatement");
        }
        parseHeaderExpression() {
          this.expect(10);
          const val = this.parseExpression();
          this.expect(11);
          return val;
        }
        parseDoWhileStatement(node) {
          this.next();
          this.state.labels.push(loopLabel);
          node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
          this.state.labels.pop();
          this.expect(92);
          node.test = this.parseHeaderExpression();
          this.eat(13);
          return this.finishNode(node, "DoWhileStatement");
        }
        parseForStatement(node) {
          this.next();
          this.state.labels.push(loopLabel);
          let awaitAt = null;
          if (this.isContextual(96) && this.recordAwaitIfAllowed()) {
            awaitAt = this.state.startLoc;
            this.next();
          }
          this.scope.enter(0);
          this.expect(10);
          if (this.match(13)) {
            if (awaitAt !== null) {
              this.unexpected(awaitAt);
            }
            return this.parseFor(node, null);
          }
          const startsWithLet = this.isContextual(100);
          {
            const startsWithAwaitUsing = this.isAwaitUsing();
            const starsWithUsingDeclaration = startsWithAwaitUsing || this.isForUsing();
            const isLetOrUsing = startsWithLet && this.hasFollowingBindingAtom() || starsWithUsingDeclaration;
            if (this.match(74) || this.match(75) || isLetOrUsing) {
              const initNode = this.startNode();
              let kind;
              if (startsWithAwaitUsing) {
                kind = "await using";
                if (!this.recordAwaitIfAllowed()) {
                  this.raise(Errors.AwaitUsingNotInAsyncContext, this.state.startLoc);
                }
                this.next();
              } else {
                kind = this.state.value;
              }
              this.next();
              this.parseVar(initNode, true, kind);
              const init2 = this.finishNode(initNode, "VariableDeclaration");
              const isForIn = this.match(58);
              if (isForIn && starsWithUsingDeclaration) {
                this.raise(Errors.ForInUsing, init2);
              }
              if ((isForIn || this.isContextual(102)) && init2.declarations.length === 1) {
                return this.parseForIn(node, init2, awaitAt);
              }
              if (awaitAt !== null) {
                this.unexpected(awaitAt);
              }
              return this.parseFor(node, init2);
            }
          }
          const startsWithAsync = this.isContextual(95);
          const refExpressionErrors = new ExpressionErrors();
          const init = this.parseExpression(true, refExpressionErrors);
          const isForOf = this.isContextual(102);
          if (isForOf) {
            if (startsWithLet) {
              this.raise(Errors.ForOfLet, init);
            }
            if (awaitAt === null && startsWithAsync && init.type === "Identifier") {
              this.raise(Errors.ForOfAsync, init);
            }
          }
          if (isForOf || this.match(58)) {
            this.checkDestructuringPrivate(refExpressionErrors);
            this.toAssignable(init, true);
            const type = isForOf ? "ForOfStatement" : "ForInStatement";
            this.checkLVal(init, {
              type
            });
            return this.parseForIn(node, init, awaitAt);
          } else {
            this.checkExpressionErrors(refExpressionErrors, true);
          }
          if (awaitAt !== null) {
            this.unexpected(awaitAt);
          }
          return this.parseFor(node, init);
        }
        parseFunctionStatement(node, isAsync, isHangingDeclaration) {
          this.next();
          return this.parseFunction(node, 1 | (isHangingDeclaration ? 2 : 0) | (isAsync ? 8 : 0));
        }
        parseIfStatement(node) {
          this.next();
          node.test = this.parseHeaderExpression();
          node.consequent = this.parseStatementOrSloppyAnnexBFunctionDeclaration();
          node.alternate = this.eat(66) ? this.parseStatementOrSloppyAnnexBFunctionDeclaration() : null;
          return this.finishNode(node, "IfStatement");
        }
        parseReturnStatement(node) {
          if (!this.prodParam.hasReturn) {
            this.raise(Errors.IllegalReturn, this.state.startLoc);
          }
          this.next();
          if (this.isLineTerminator()) {
            node.argument = null;
          } else {
            node.argument = this.parseExpression();
            this.semicolon();
          }
          return this.finishNode(node, "ReturnStatement");
        }
        parseSwitchStatement(node) {
          this.next();
          node.discriminant = this.parseHeaderExpression();
          const cases = node.cases = [];
          this.expect(5);
          this.state.labels.push(switchLabel);
          this.scope.enter(256);
          let cur;
          for (let sawDefault; !this.match(8); ) {
            if (this.match(61) || this.match(65)) {
              const isCase = this.match(61);
              if (cur) this.finishNode(cur, "SwitchCase");
              cases.push(cur = this.startNode());
              cur.consequent = [];
              this.next();
              if (isCase) {
                cur.test = this.parseExpression();
              } else {
                if (sawDefault) {
                  this.raise(Errors.MultipleDefaultsInSwitch, this.state.lastTokStartLoc);
                }
                sawDefault = true;
                cur.test = null;
              }
              this.expect(14);
            } else {
              if (cur) {
                cur.consequent.push(this.parseStatementListItem());
              } else {
                this.unexpected();
              }
            }
          }
          this.scope.exit();
          if (cur) this.finishNode(cur, "SwitchCase");
          this.next();
          this.state.labels.pop();
          return this.finishNode(node, "SwitchStatement");
        }
        parseThrowStatement(node) {
          this.next();
          if (this.hasPrecedingLineBreak()) {
            this.raise(Errors.NewlineAfterThrow, this.state.lastTokEndLoc);
          }
          node.argument = this.parseExpression();
          this.semicolon();
          return this.finishNode(node, "ThrowStatement");
        }
        parseCatchClauseParam() {
          const param = this.parseBindingAtom();
          this.scope.enter(this.options.annexB && param.type === "Identifier" ? 8 : 0);
          this.checkLVal(param, {
            type: "CatchClause"
          }, 9);
          return param;
        }
        parseTryStatement(node) {
          this.next();
          node.block = this.parseBlock();
          node.handler = null;
          if (this.match(62)) {
            const clause = this.startNode();
            this.next();
            if (this.match(10)) {
              this.expect(10);
              clause.param = this.parseCatchClauseParam();
              this.expect(11);
            } else {
              clause.param = null;
              this.scope.enter(0);
            }
            clause.body = this.withSmartMixTopicForbiddingContext(() => this.parseBlock(false, false));
            this.scope.exit();
            node.handler = this.finishNode(clause, "CatchClause");
          }
          node.finalizer = this.eat(67) ? this.parseBlock() : null;
          if (!node.handler && !node.finalizer) {
            this.raise(Errors.NoCatchOrFinally, node);
          }
          return this.finishNode(node, "TryStatement");
        }
        parseVarStatement(node, kind, allowMissingInitializer = false) {
          this.next();
          this.parseVar(node, false, kind, allowMissingInitializer);
          this.semicolon();
          return this.finishNode(node, "VariableDeclaration");
        }
        parseWhileStatement(node) {
          this.next();
          node.test = this.parseHeaderExpression();
          this.state.labels.push(loopLabel);
          node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
          this.state.labels.pop();
          return this.finishNode(node, "WhileStatement");
        }
        parseWithStatement(node) {
          if (this.state.strict) {
            this.raise(Errors.StrictWith, this.state.startLoc);
          }
          this.next();
          node.object = this.parseHeaderExpression();
          node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
          return this.finishNode(node, "WithStatement");
        }
        parseEmptyStatement(node) {
          this.next();
          return this.finishNode(node, "EmptyStatement");
        }
        parseLabeledStatement(node, maybeName, expr, flags) {
          for (const label of this.state.labels) {
            if (label.name === maybeName) {
              this.raise(Errors.LabelRedeclaration, expr, {
                labelName: maybeName
              });
            }
          }
          const kind = tokenIsLoop(this.state.type) ? 1 : this.match(71) ? 2 : null;
          for (let i = this.state.labels.length - 1; i >= 0; i--) {
            const label = this.state.labels[i];
            if (label.statementStart === node.start) {
              label.statementStart = this.sourceToOffsetPos(this.state.start);
              label.kind = kind;
            } else {
              break;
            }
          }
          this.state.labels.push({
            name: maybeName,
            kind,
            statementStart: this.sourceToOffsetPos(this.state.start)
          });
          node.body = flags & 8 ? this.parseStatementOrSloppyAnnexBFunctionDeclaration(true) : this.parseStatement();
          this.state.labels.pop();
          node.label = expr;
          return this.finishNode(node, "LabeledStatement");
        }
        parseExpressionStatement(node, expr, decorators) {
          node.expression = expr;
          this.semicolon();
          return this.finishNode(node, "ExpressionStatement");
        }
        parseBlock(allowDirectives = false, createNewLexicalScope = true, afterBlockParse) {
          const node = this.startNode();
          if (allowDirectives) {
            this.state.strictErrors.clear();
          }
          this.expect(5);
          if (createNewLexicalScope) {
            this.scope.enter(0);
          }
          this.parseBlockBody(node, allowDirectives, false, 8, afterBlockParse);
          if (createNewLexicalScope) {
            this.scope.exit();
          }
          return this.finishNode(node, "BlockStatement");
        }
        isValidDirective(stmt) {
          return stmt.type === "ExpressionStatement" && stmt.expression.type === "StringLiteral" && !stmt.expression.extra.parenthesized;
        }
        parseBlockBody(node, allowDirectives, topLevel, end, afterBlockParse) {
          const body = node.body = [];
          const directives = node.directives = [];
          this.parseBlockOrModuleBlockBody(body, allowDirectives ? directives : void 0, topLevel, end, afterBlockParse);
        }
        parseBlockOrModuleBlockBody(body, directives, topLevel, end, afterBlockParse) {
          const oldStrict = this.state.strict;
          let hasStrictModeDirective = false;
          let parsedNonDirective = false;
          while (!this.match(end)) {
            const stmt = topLevel ? this.parseModuleItem() : this.parseStatementListItem();
            if (directives && !parsedNonDirective) {
              if (this.isValidDirective(stmt)) {
                const directive = this.stmtToDirective(stmt);
                directives.push(directive);
                if (!hasStrictModeDirective && directive.value.value === "use strict") {
                  hasStrictModeDirective = true;
                  this.setStrict(true);
                }
                continue;
              }
              parsedNonDirective = true;
              this.state.strictErrors.clear();
            }
            body.push(stmt);
          }
          afterBlockParse == null || afterBlockParse.call(this, hasStrictModeDirective);
          if (!oldStrict) {
            this.setStrict(false);
          }
          this.next();
        }
        parseFor(node, init) {
          node.init = init;
          this.semicolon(false);
          node.test = this.match(13) ? null : this.parseExpression();
          this.semicolon(false);
          node.update = this.match(11) ? null : this.parseExpression();
          this.expect(11);
          node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
          this.scope.exit();
          this.state.labels.pop();
          return this.finishNode(node, "ForStatement");
        }
        parseForIn(node, init, awaitAt) {
          const isForIn = this.match(58);
          this.next();
          if (isForIn) {
            if (awaitAt !== null) this.unexpected(awaitAt);
          } else {
            node.await = awaitAt !== null;
          }
          if (init.type === "VariableDeclaration" && init.declarations[0].init != null && (!isForIn || !this.options.annexB || this.state.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")) {
            this.raise(Errors.ForInOfLoopInitializer, init, {
              type: isForIn ? "ForInStatement" : "ForOfStatement"
            });
          }
          if (init.type === "AssignmentPattern") {
            this.raise(Errors.InvalidLhs, init, {
              ancestor: {
                type: "ForStatement"
              }
            });
          }
          node.left = init;
          node.right = isForIn ? this.parseExpression() : this.parseMaybeAssignAllowIn();
          this.expect(11);
          node.body = this.withSmartMixTopicForbiddingContext(() => this.parseStatement());
          this.scope.exit();
          this.state.labels.pop();
          return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement");
        }
        parseVar(node, isFor, kind, allowMissingInitializer = false) {
          const declarations = node.declarations = [];
          node.kind = kind;
          for (; ; ) {
            const decl = this.startNode();
            this.parseVarId(decl, kind);
            decl.init = !this.eat(29) ? null : isFor ? this.parseMaybeAssignDisallowIn() : this.parseMaybeAssignAllowIn();
            if (decl.init === null && !allowMissingInitializer) {
              if (decl.id.type !== "Identifier" && !(isFor && (this.match(58) || this.isContextual(102)))) {
                this.raise(Errors.DeclarationMissingInitializer, this.state.lastTokEndLoc, {
                  kind: "destructuring"
                });
              } else if ((kind === "const" || kind === "using" || kind === "await using") && !(this.match(58) || this.isContextual(102))) {
                this.raise(Errors.DeclarationMissingInitializer, this.state.lastTokEndLoc, {
                  kind
                });
              }
            }
            declarations.push(this.finishNode(decl, "VariableDeclarator"));
            if (!this.eat(12)) break;
          }
          return node;
        }
        parseVarId(decl, kind) {
          const id = this.parseBindingAtom();
          if (kind === "using" || kind === "await using") {
            if (id.type === "ArrayPattern" || id.type === "ObjectPattern") {
              this.raise(Errors.UsingDeclarationHasBindingPattern, id.loc.start);
            }
          } else {
            if (id.type === "VoidPattern") {
              this.raise(Errors.UnexpectedVoidPattern, id.loc.start);
            }
          }
          this.checkLVal(id, {
            type: "VariableDeclarator"
          }, kind === "var" ? 5 : 8201);
          decl.id = id;
        }
        parseAsyncFunctionExpression(node) {
          return this.parseFunction(node, 8);
        }
        parseFunction(node, flags = 0) {
          const hangingDeclaration = flags & 2;
          const isDeclaration = !!(flags & 1);
          const requireId = isDeclaration && !(flags & 4);
          const isAsync = !!(flags & 8);
          this.initFunction(node, isAsync);
          if (this.match(55)) {
            if (hangingDeclaration) {
              this.raise(Errors.GeneratorInSingleStatementContext, this.state.startLoc);
            }
            this.next();
            node.generator = true;
          }
          if (isDeclaration) {
            node.id = this.parseFunctionId(requireId);
          }
          const oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
          this.state.maybeInArrowParameters = false;
          this.scope.enter(514);
          this.prodParam.enter(functionFlags(isAsync, node.generator));
          if (!isDeclaration) {
            node.id = this.parseFunctionId();
          }
          this.parseFunctionParams(node, false);
          this.withSmartMixTopicForbiddingContext(() => {
            this.parseFunctionBodyAndFinish(node, isDeclaration ? "FunctionDeclaration" : "FunctionExpression");
          });
          this.prodParam.exit();
          this.scope.exit();
          if (isDeclaration && !hangingDeclaration) {
            this.registerFunctionStatementId(node);
          }
          this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
          return node;
        }
        parseFunctionId(requireId) {
          return requireId || tokenIsIdentifier(this.state.type) ? this.parseIdentifier() : null;
        }
        parseFunctionParams(node, isConstructor) {
          this.expect(10);
          this.expressionScope.enter(newParameterDeclarationScope());
          node.params = this.parseBindingList(11, 41, 2 | (isConstructor ? 4 : 0));
          this.expressionScope.exit();
        }
        registerFunctionStatementId(node) {
          if (!node.id) return;
          this.scope.declareName(node.id.name, !this.options.annexB || this.state.strict || node.generator || node.async ? this.scope.treatFunctionsAsVar ? 5 : 8201 : 17, node.id.loc.start);
        }
        parseClass(node, isStatement, optionalId) {
          this.next();
          const oldStrict = this.state.strict;
          this.state.strict = true;
          this.parseClassId(node, isStatement, optionalId);
          this.parseClassSuper(node);
          node.body = this.parseClassBody(!!node.superClass, oldStrict);
          return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
        }
        isClassProperty() {
          return this.match(29) || this.match(13) || this.match(8);
        }
        isClassMethod() {
          return this.match(10);
        }
        nameIsConstructor(key) {
          return key.type === "Identifier" && key.name === "constructor" || key.type === "StringLiteral" && key.value === "constructor";
        }
        isNonstaticConstructor(method) {
          return !method.computed && !method.static && this.nameIsConstructor(method.key);
        }
        parseClassBody(hadSuperClass, oldStrict) {
          this.classScope.enter();
          const state = {
            hadConstructor: false,
            hadSuperClass
          };
          let decorators = [];
          const classBody = this.startNode();
          classBody.body = [];
          this.expect(5);
          this.withSmartMixTopicForbiddingContext(() => {
            while (!this.match(8)) {
              if (this.eat(13)) {
                if (decorators.length > 0) {
                  throw this.raise(Errors.DecoratorSemicolon, this.state.lastTokEndLoc);
                }
                continue;
              }
              if (this.match(26)) {
                decorators.push(this.parseDecorator());
                continue;
              }
              const member = this.startNode();
              if (decorators.length) {
                member.decorators = decorators;
                this.resetStartLocationFromNode(member, decorators[0]);
                decorators = [];
              }
              this.parseClassMember(classBody, member, state);
              if (member.kind === "constructor" && member.decorators && member.decorators.length > 0) {
                this.raise(Errors.DecoratorConstructor, member);
              }
            }
          });
          this.state.strict = oldStrict;
          this.next();
          if (decorators.length) {
            throw this.raise(Errors.TrailingDecorator, this.state.startLoc);
          }
          this.classScope.exit();
          return this.finishNode(classBody, "ClassBody");
        }
        parseClassMemberFromModifier(classBody, member) {
          const key = this.parseIdentifier(true);
          if (this.isClassMethod()) {
            const method = member;
            method.kind = "method";
            method.computed = false;
            method.key = key;
            method.static = false;
            this.pushClassMethod(classBody, method, false, false, false, false);
            return true;
          } else if (this.isClassProperty()) {
            const prop = member;
            prop.computed = false;
            prop.key = key;
            prop.static = false;
            classBody.body.push(this.parseClassProperty(prop));
            return true;
          }
          this.resetPreviousNodeTrailingComments(key);
          return false;
        }
        parseClassMember(classBody, member, state) {
          const isStatic = this.isContextual(106);
          if (isStatic) {
            if (this.parseClassMemberFromModifier(classBody, member)) {
              return;
            }
            if (this.eat(5)) {
              this.parseClassStaticBlock(classBody, member);
              return;
            }
          }
          this.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
        }
        parseClassMemberWithIsStatic(classBody, member, state, isStatic) {
          const publicMethod = member;
          const privateMethod = member;
          const publicProp = member;
          const privateProp = member;
          const accessorProp = member;
          const method = publicMethod;
          const publicMember = publicMethod;
          member.static = isStatic;
          this.parsePropertyNamePrefixOperator(member);
          if (this.eat(55)) {
            method.kind = "method";
            const isPrivateName = this.match(139);
            this.parseClassElementName(method);
            this.parsePostMemberNameModifiers(method);
            if (isPrivateName) {
              this.pushClassPrivateMethod(classBody, privateMethod, true, false);
              return;
            }
            if (this.isNonstaticConstructor(publicMethod)) {
              this.raise(Errors.ConstructorIsGenerator, publicMethod.key);
            }
            this.pushClassMethod(classBody, publicMethod, true, false, false, false);
            return;
          }
          const isContextual = !this.state.containsEsc && tokenIsIdentifier(this.state.type);
          const key = this.parseClassElementName(member);
          const maybeContextualKw = isContextual ? key.name : null;
          const isPrivate = this.isPrivateName(key);
          const maybeQuestionTokenStartLoc = this.state.startLoc;
          this.parsePostMemberNameModifiers(publicMember);
          if (this.isClassMethod()) {
            method.kind = "method";
            if (isPrivate) {
              this.pushClassPrivateMethod(classBody, privateMethod, false, false);
              return;
            }
            const isConstructor = this.isNonstaticConstructor(publicMethod);
            let allowsDirectSuper = false;
            if (isConstructor) {
              publicMethod.kind = "constructor";
              if (state.hadConstructor && !this.hasPlugin("typescript")) {
                this.raise(Errors.DuplicateConstructor, key);
              }
              if (isConstructor && this.hasPlugin("typescript") && member.override) {
                this.raise(Errors.OverrideOnConstructor, key);
              }
              state.hadConstructor = true;
              allowsDirectSuper = state.hadSuperClass;
            }
            this.pushClassMethod(classBody, publicMethod, false, false, isConstructor, allowsDirectSuper);
          } else if (this.isClassProperty()) {
            if (isPrivate) {
              this.pushClassPrivateProperty(classBody, privateProp);
            } else {
              this.pushClassProperty(classBody, publicProp);
            }
          } else if (maybeContextualKw === "async" && !this.isLineTerminator()) {
            this.resetPreviousNodeTrailingComments(key);
            const isGenerator = this.eat(55);
            if (publicMember.optional) {
              this.unexpected(maybeQuestionTokenStartLoc);
            }
            method.kind = "method";
            const isPrivate2 = this.match(139);
            this.parseClassElementName(method);
            this.parsePostMemberNameModifiers(publicMember);
            if (isPrivate2) {
              this.pushClassPrivateMethod(classBody, privateMethod, isGenerator, true);
            } else {
              if (this.isNonstaticConstructor(publicMethod)) {
                this.raise(Errors.ConstructorIsAsync, publicMethod.key);
              }
              this.pushClassMethod(classBody, publicMethod, isGenerator, true, false, false);
            }
          } else if ((maybeContextualKw === "get" || maybeContextualKw === "set") && !(this.match(55) && this.isLineTerminator())) {
            this.resetPreviousNodeTrailingComments(key);
            method.kind = maybeContextualKw;
            const isPrivate2 = this.match(139);
            this.parseClassElementName(publicMethod);
            if (isPrivate2) {
              this.pushClassPrivateMethod(classBody, privateMethod, false, false);
            } else {
              if (this.isNonstaticConstructor(publicMethod)) {
                this.raise(Errors.ConstructorIsAccessor, publicMethod.key);
              }
              this.pushClassMethod(classBody, publicMethod, false, false, false, false);
            }
            this.checkGetterSetterParams(publicMethod);
          } else if (maybeContextualKw === "accessor" && !this.isLineTerminator()) {
            this.expectPlugin("decoratorAutoAccessors");
            this.resetPreviousNodeTrailingComments(key);
            const isPrivate2 = this.match(139);
            this.parseClassElementName(publicProp);
            this.pushClassAccessorProperty(classBody, accessorProp, isPrivate2);
          } else if (this.isLineTerminator()) {
            if (isPrivate) {
              this.pushClassPrivateProperty(classBody, privateProp);
            } else {
              this.pushClassProperty(classBody, publicProp);
            }
          } else {
            this.unexpected();
          }
        }
        parseClassElementName(member) {
          const {
            type,
            value
          } = this.state;
          if ((type === 132 || type === 134) && member.static && value === "prototype") {
            this.raise(Errors.StaticPrototype, this.state.startLoc);
          }
          if (type === 139) {
            if (value === "constructor") {
              this.raise(Errors.ConstructorClassPrivateField, this.state.startLoc);
            }
            const key = this.parsePrivateName();
            member.key = key;
            return key;
          }
          this.parsePropertyName(member);
          return member.key;
        }
        parseClassStaticBlock(classBody, member) {
          var _member$decorators;
          this.scope.enter(576 | 128 | 16);
          const oldLabels = this.state.labels;
          this.state.labels = [];
          this.prodParam.enter(0);
          const body = member.body = [];
          this.parseBlockOrModuleBlockBody(body, void 0, false, 8);
          this.prodParam.exit();
          this.scope.exit();
          this.state.labels = oldLabels;
          classBody.body.push(this.finishNode(member, "StaticBlock"));
          if ((_member$decorators = member.decorators) != null && _member$decorators.length) {
            this.raise(Errors.DecoratorStaticBlock, member);
          }
        }
        pushClassProperty(classBody, prop) {
          if (!prop.computed && this.nameIsConstructor(prop.key)) {
            this.raise(Errors.ConstructorClassField, prop.key);
          }
          classBody.body.push(this.parseClassProperty(prop));
        }
        pushClassPrivateProperty(classBody, prop) {
          const node = this.parseClassPrivateProperty(prop);
          classBody.body.push(node);
          this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), 0, node.key.loc.start);
        }
        pushClassAccessorProperty(classBody, prop, isPrivate) {
          if (!isPrivate && !prop.computed && this.nameIsConstructor(prop.key)) {
            this.raise(Errors.ConstructorClassField, prop.key);
          }
          const node = this.parseClassAccessorProperty(prop);
          classBody.body.push(node);
          if (isPrivate) {
            this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), 0, node.key.loc.start);
          }
        }
        pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper) {
          classBody.body.push(this.parseMethod(method, isGenerator, isAsync, isConstructor, allowsDirectSuper, "ClassMethod", true));
        }
        pushClassPrivateMethod(classBody, method, isGenerator, isAsync) {
          const node = this.parseMethod(method, isGenerator, isAsync, false, false, "ClassPrivateMethod", true);
          classBody.body.push(node);
          const kind = node.kind === "get" ? node.static ? 6 : 2 : node.kind === "set" ? node.static ? 5 : 1 : 0;
          this.declareClassPrivateMethodInScope(node, kind);
        }
        declareClassPrivateMethodInScope(node, kind) {
          this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), kind, node.key.loc.start);
        }
        parsePostMemberNameModifiers(methodOrProp) {
        }
        parseClassPrivateProperty(node) {
          this.parseInitializer(node);
          this.semicolon();
          return this.finishNode(node, "ClassPrivateProperty");
        }
        parseClassProperty(node) {
          this.parseInitializer(node);
          this.semicolon();
          return this.finishNode(node, "ClassProperty");
        }
        parseClassAccessorProperty(node) {
          this.parseInitializer(node);
          this.semicolon();
          return this.finishNode(node, "ClassAccessorProperty");
        }
        parseInitializer(node) {
          this.scope.enter(576 | 16);
          this.expressionScope.enter(newExpressionScope());
          this.prodParam.enter(0);
          node.value = this.eat(29) ? this.parseMaybeAssignAllowIn() : null;
          this.expressionScope.exit();
          this.prodParam.exit();
          this.scope.exit();
        }
        parseClassId(node, isStatement, optionalId, bindingType = 8331) {
          if (tokenIsIdentifier(this.state.type)) {
            node.id = this.parseIdentifier();
            if (isStatement) {
              this.declareNameFromIdentifier(node.id, bindingType);
            }
          } else {
            if (optionalId || !isStatement) {
              node.id = null;
            } else {
              throw this.raise(Errors.MissingClassName, this.state.startLoc);
            }
          }
        }
        parseClassSuper(node) {
          node.superClass = this.eat(81) ? this.parseExprSubscripts() : null;
        }
        parseExport(node, decorators) {
          const maybeDefaultIdentifier = this.parseMaybeImportPhase(node, true);
          const hasDefault = this.maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier);
          const parseAfterDefault = !hasDefault || this.eat(12);
          const hasStar = parseAfterDefault && this.eatExportStar(node);
          const hasNamespace = hasStar && this.maybeParseExportNamespaceSpecifier(node);
          const parseAfterNamespace = parseAfterDefault && (!hasNamespace || this.eat(12));
          const isFromRequired = hasDefault || hasStar;
          if (hasStar && !hasNamespace) {
            if (hasDefault) this.unexpected();
            if (decorators) {
              throw this.raise(Errors.UnsupportedDecoratorExport, node);
            }
            this.parseExportFrom(node, true);
            this.sawUnambiguousESM = true;
            return this.finishNode(node, "ExportAllDeclaration");
          }
          const hasSpecifiers = this.maybeParseExportNamedSpecifiers(node);
          if (hasDefault && parseAfterDefault && !hasStar && !hasSpecifiers) {
            this.unexpected(null, 5);
          }
          if (hasNamespace && parseAfterNamespace) {
            this.unexpected(null, 98);
          }
          let hasDeclaration;
          if (isFromRequired || hasSpecifiers) {
            hasDeclaration = false;
            if (decorators) {
              throw this.raise(Errors.UnsupportedDecoratorExport, node);
            }
            this.parseExportFrom(node, isFromRequired);
          } else {
            hasDeclaration = this.maybeParseExportDeclaration(node);
          }
          if (isFromRequired || hasSpecifiers || hasDeclaration) {
            var _node2$declaration;
            const node2 = node;
            this.checkExport(node2, true, false, !!node2.source);
            if (((_node2$declaration = node2.declaration) == null ? void 0 : _node2$declaration.type) === "ClassDeclaration") {
              this.maybeTakeDecorators(decorators, node2.declaration, node2);
            } else if (decorators) {
              throw this.raise(Errors.UnsupportedDecoratorExport, node);
            }
            this.sawUnambiguousESM = true;
            return this.finishNode(node2, "ExportNamedDeclaration");
          }
          if (this.eat(65)) {
            const node2 = node;
            const decl = this.parseExportDefaultExpression();
            node2.declaration = decl;
            if (decl.type === "ClassDeclaration") {
              this.maybeTakeDecorators(decorators, decl, node2);
            } else if (decorators) {
              throw this.raise(Errors.UnsupportedDecoratorExport, node);
            }
            this.checkExport(node2, true, true);
            this.sawUnambiguousESM = true;
            return this.finishNode(node2, "ExportDefaultDeclaration");
          }
          throw this.unexpected(null, 5);
        }
        eatExportStar(node) {
          return this.eat(55);
        }
        maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier) {
          if (maybeDefaultIdentifier || this.isExportDefaultSpecifier()) {
            this.expectPlugin("exportDefaultFrom", maybeDefaultIdentifier == null ? void 0 : maybeDefaultIdentifier.loc.start);
            const id = maybeDefaultIdentifier || this.parseIdentifier(true);
            const specifier = this.startNodeAtNode(id);
            specifier.exported = id;
            node.specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
            return true;
          }
          return false;
        }
        maybeParseExportNamespaceSpecifier(node) {
          if (this.isContextual(93)) {
            var _ref, _ref$specifiers;
            (_ref$specifiers = (_ref = node).specifiers) != null ? _ref$specifiers : _ref.specifiers = [];
            const specifier = this.startNodeAt(this.state.lastTokStartLoc);
            this.next();
            specifier.exported = this.parseModuleExportName();
            node.specifiers.push(this.finishNode(specifier, "ExportNamespaceSpecifier"));
            return true;
          }
          return false;
        }
        maybeParseExportNamedSpecifiers(node) {
          if (this.match(5)) {
            const node2 = node;
            if (!node2.specifiers) node2.specifiers = [];
            const isTypeExport = node2.exportKind === "type";
            node2.specifiers.push(...this.parseExportSpecifiers(isTypeExport));
            node2.source = null;
            if (this.hasPlugin("importAssertions")) {
              node2.assertions = [];
            } else {
              node2.attributes = [];
            }
            node2.declaration = null;
            return true;
          }
          return false;
        }
        maybeParseExportDeclaration(node) {
          if (this.shouldParseExportDeclaration()) {
            node.specifiers = [];
            node.source = null;
            if (this.hasPlugin("importAssertions")) {
              node.assertions = [];
            } else {
              node.attributes = [];
            }
            node.declaration = this.parseExportDeclaration(node);
            return true;
          }
          return false;
        }
        isAsyncFunction() {
          if (!this.isContextual(95)) return false;
          const next = this.nextTokenInLineStart();
          return this.isUnparsedContextual(next, "function");
        }
        parseExportDefaultExpression() {
          const expr = this.startNode();
          if (this.match(68)) {
            this.next();
            return this.parseFunction(expr, 1 | 4);
          } else if (this.isAsyncFunction()) {
            this.next();
            this.next();
            return this.parseFunction(expr, 1 | 4 | 8);
          }
          if (this.match(80)) {
            return this.parseClass(expr, true, true);
          }
          if (this.match(26)) {
            if (this.hasPlugin("decorators") && this.getPluginOption("decorators", "decoratorsBeforeExport") === true) {
              this.raise(Errors.DecoratorBeforeExport, this.state.startLoc);
            }
            return this.parseClass(this.maybeTakeDecorators(this.parseDecorators(false), this.startNode()), true, true);
          }
          if (this.match(75) || this.match(74) || this.isLet() || this.isUsing() || this.isAwaitUsing()) {
            throw this.raise(Errors.UnsupportedDefaultExport, this.state.startLoc);
          }
          const res = this.parseMaybeAssignAllowIn();
          this.semicolon();
          return res;
        }
        parseExportDeclaration(node) {
          if (this.match(80)) {
            const node2 = this.parseClass(this.startNode(), true, false);
            return node2;
          }
          return this.parseStatementListItem();
        }
        isExportDefaultSpecifier() {
          const {
            type
          } = this.state;
          if (tokenIsIdentifier(type)) {
            if (type === 95 && !this.state.containsEsc || type === 100) {
              return false;
            }
            if ((type === 130 || type === 129) && !this.state.containsEsc) {
              const next2 = this.nextTokenStart();
              const nextChar = this.input.charCodeAt(next2);
              if (nextChar === 123 || this.chStartsBindingIdentifier(nextChar, next2) && !this.input.startsWith("from", next2)) {
                this.expectOnePlugin(["flow", "typescript"]);
                return false;
              }
            }
          } else if (!this.match(65)) {
            return false;
          }
          const next = this.nextTokenStart();
          const hasFrom = this.isUnparsedContextual(next, "from");
          if (this.input.charCodeAt(next) === 44 || tokenIsIdentifier(this.state.type) && hasFrom) {
            return true;
          }
          if (this.match(65) && hasFrom) {
            const nextAfterFrom = this.input.charCodeAt(this.nextTokenStartSince(next + 4));
            return nextAfterFrom === 34 || nextAfterFrom === 39;
          }
          return false;
        }
        parseExportFrom(node, expect) {
          if (this.eatContextual(98)) {
            node.source = this.parseImportSource();
            this.checkExport(node);
            this.maybeParseImportAttributes(node);
            this.checkJSONModuleImport(node);
          } else if (expect) {
            this.unexpected();
          }
          this.semicolon();
        }
        shouldParseExportDeclaration() {
          const {
            type
          } = this.state;
          if (type === 26) {
            this.expectOnePlugin(["decorators", "decorators-legacy"]);
            if (this.hasPlugin("decorators")) {
              if (this.getPluginOption("decorators", "decoratorsBeforeExport") === true) {
                this.raise(Errors.DecoratorBeforeExport, this.state.startLoc);
              }
              return true;
            }
          }
          if (this.isUsing()) {
            this.raise(Errors.UsingDeclarationExport, this.state.startLoc);
            return true;
          }
          if (this.isAwaitUsing()) {
            this.raise(Errors.UsingDeclarationExport, this.state.startLoc);
            return true;
          }
          return type === 74 || type === 75 || type === 68 || type === 80 || this.isLet() || this.isAsyncFunction();
        }
        checkExport(node, checkNames, isDefault, isFrom) {
          if (checkNames) {
            var _node$specifiers;
            if (isDefault) {
              this.checkDuplicateExports(node, "default");
              if (this.hasPlugin("exportDefaultFrom")) {
                var _declaration$extra;
                const declaration = node.declaration;
                if (declaration.type === "Identifier" && declaration.name === "from" && declaration.end - declaration.start === 4 && !((_declaration$extra = declaration.extra) != null && _declaration$extra.parenthesized)) {
                  this.raise(Errors.ExportDefaultFromAsIdentifier, declaration);
                }
              }
            } else if ((_node$specifiers = node.specifiers) != null && _node$specifiers.length) {
              for (const specifier of node.specifiers) {
                const {
                  exported
                } = specifier;
                const exportName = exported.type === "Identifier" ? exported.name : exported.value;
                this.checkDuplicateExports(specifier, exportName);
                if (!isFrom && specifier.local) {
                  const {
                    local
                  } = specifier;
                  if (local.type !== "Identifier") {
                    this.raise(Errors.ExportBindingIsString, specifier, {
                      localName: local.value,
                      exportName
                    });
                  } else {
                    this.checkReservedWord(local.name, local.loc.start, true, false);
                    this.scope.checkLocalExport(local);
                  }
                }
              }
            } else if (node.declaration) {
              const decl = node.declaration;
              if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
                const {
                  id
                } = decl;
                if (!id) throw new Error("Assertion failure");
                this.checkDuplicateExports(node, id.name);
              } else if (decl.type === "VariableDeclaration") {
                for (const declaration of decl.declarations) {
                  this.checkDeclaration(declaration.id);
                }
              }
            }
          }
        }
        checkDeclaration(node) {
          if (node.type === "Identifier") {
            this.checkDuplicateExports(node, node.name);
          } else if (node.type === "ObjectPattern") {
            for (const prop of node.properties) {
              this.checkDeclaration(prop);
            }
          } else if (node.type === "ArrayPattern") {
            for (const elem of node.elements) {
              if (elem) {
                this.checkDeclaration(elem);
              }
            }
          } else if (node.type === "ObjectProperty") {
            this.checkDeclaration(node.value);
          } else if (node.type === "RestElement") {
            this.checkDeclaration(node.argument);
          } else if (node.type === "AssignmentPattern") {
            this.checkDeclaration(node.left);
          }
        }
        checkDuplicateExports(node, exportName) {
          if (this.exportedIdentifiers.has(exportName)) {
            if (exportName === "default") {
              this.raise(Errors.DuplicateDefaultExport, node);
            } else {
              this.raise(Errors.DuplicateExport, node, {
                exportName
              });
            }
          }
          this.exportedIdentifiers.add(exportName);
        }
        parseExportSpecifiers(isInTypeExport) {
          const nodes = [];
          let first = true;
          this.expect(5);
          while (!this.eat(8)) {
            if (first) {
              first = false;
            } else {
              this.expect(12);
              if (this.eat(8)) break;
            }
            const isMaybeTypeOnly = this.isContextual(130);
            const isString = this.match(134);
            const node = this.startNode();
            node.local = this.parseModuleExportName();
            nodes.push(this.parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly));
          }
          return nodes;
        }
        parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly) {
          if (this.eatContextual(93)) {
            node.exported = this.parseModuleExportName();
          } else if (isString) {
            node.exported = this.cloneStringLiteral(node.local);
          } else if (!node.exported) {
            node.exported = this.cloneIdentifier(node.local);
          }
          return this.finishNode(node, "ExportSpecifier");
        }
        parseModuleExportName() {
          if (this.match(134)) {
            const result = this.parseStringLiteral(this.state.value);
            const surrogate = loneSurrogate.exec(result.value);
            if (surrogate) {
              this.raise(Errors.ModuleExportNameHasLoneSurrogate, result, {
                surrogateCharCode: surrogate[0].charCodeAt(0)
              });
            }
            return result;
          }
          return this.parseIdentifier(true);
        }
        isJSONModuleImport(node) {
          if (node.assertions != null) {
            return node.assertions.some(({
              key,
              value
            }) => {
              return value.value === "json" && (key.type === "Identifier" ? key.name === "type" : key.value === "type");
            });
          }
          return false;
        }
        checkImportReflection(node) {
          const {
            specifiers
          } = node;
          const singleBindingType = specifiers.length === 1 ? specifiers[0].type : null;
          if (node.phase === "source") {
            if (singleBindingType !== "ImportDefaultSpecifier") {
              this.raise(Errors.SourcePhaseImportRequiresDefault, specifiers[0].loc.start);
            }
          } else if (node.phase === "defer") {
            if (singleBindingType !== "ImportNamespaceSpecifier") {
              this.raise(Errors.DeferImportRequiresNamespace, specifiers[0].loc.start);
            }
          } else if (node.module) {
            var _node$assertions;
            if (singleBindingType !== "ImportDefaultSpecifier") {
              this.raise(Errors.ImportReflectionNotBinding, specifiers[0].loc.start);
            }
            if (((_node$assertions = node.assertions) == null ? void 0 : _node$assertions.length) > 0) {
              this.raise(Errors.ImportReflectionHasAssertion, specifiers[0].loc.start);
            }
          }
        }
        checkJSONModuleImport(node) {
          if (this.isJSONModuleImport(node) && node.type !== "ExportAllDeclaration") {
            const {
              specifiers
            } = node;
            if (specifiers != null) {
              const nonDefaultNamedSpecifier = specifiers.find((specifier) => {
                let imported;
                if (specifier.type === "ExportSpecifier") {
                  imported = specifier.local;
                } else if (specifier.type === "ImportSpecifier") {
                  imported = specifier.imported;
                }
                if (imported !== void 0) {
                  return imported.type === "Identifier" ? imported.name !== "default" : imported.value !== "default";
                }
              });
              if (nonDefaultNamedSpecifier !== void 0) {
                this.raise(Errors.ImportJSONBindingNotDefault, nonDefaultNamedSpecifier.loc.start);
              }
            }
          }
        }
        isPotentialImportPhase(isExport) {
          if (isExport) return false;
          return this.isContextual(105) || this.isContextual(97) || this.isContextual(127);
        }
        applyImportPhase(node, isExport, phase, loc) {
          if (isExport) {
            return;
          }
          if (phase === "module") {
            this.expectPlugin("importReflection", loc);
            node.module = true;
          } else if (this.hasPlugin("importReflection")) {
            node.module = false;
          }
          if (phase === "source") {
            this.expectPlugin("sourcePhaseImports", loc);
            node.phase = "source";
          } else if (phase === "defer") {
            this.expectPlugin("deferredImportEvaluation", loc);
            node.phase = "defer";
          } else if (this.hasPlugin("sourcePhaseImports")) {
            node.phase = null;
          }
        }
        parseMaybeImportPhase(node, isExport) {
          if (!this.isPotentialImportPhase(isExport)) {
            this.applyImportPhase(node, isExport, null);
            return null;
          }
          const phaseIdentifier = this.startNode();
          const phaseIdentifierName = this.parseIdentifierName(true);
          const {
            type
          } = this.state;
          const isImportPhase = tokenIsKeywordOrIdentifier(type) ? type !== 98 || this.lookaheadCharCode() === 102 : type !== 12;
          if (isImportPhase) {
            this.applyImportPhase(node, isExport, phaseIdentifierName, phaseIdentifier.loc.start);
            return null;
          } else {
            this.applyImportPhase(node, isExport, null);
            return this.createIdentifier(phaseIdentifier, phaseIdentifierName);
          }
        }
        isPrecedingIdImportPhase(phase) {
          const {
            type
          } = this.state;
          return tokenIsIdentifier(type) ? type !== 98 || this.lookaheadCharCode() === 102 : type !== 12;
        }
        parseImport(node) {
          if (this.match(134)) {
            return this.parseImportSourceAndAttributes(node);
          }
          return this.parseImportSpecifiersAndAfter(node, this.parseMaybeImportPhase(node, false));
        }
        parseImportSpecifiersAndAfter(node, maybeDefaultIdentifier) {
          node.specifiers = [];
          const hasDefault = this.maybeParseDefaultImportSpecifier(node, maybeDefaultIdentifier);
          const parseNext = !hasDefault || this.eat(12);
          const hasStar = parseNext && this.maybeParseStarImportSpecifier(node);
          if (parseNext && !hasStar) this.parseNamedImportSpecifiers(node);
          this.expectContextual(98);
          return this.parseImportSourceAndAttributes(node);
        }
        parseImportSourceAndAttributes(node) {
          var _node$specifiers2;
          (_node$specifiers2 = node.specifiers) != null ? _node$specifiers2 : node.specifiers = [];
          node.source = this.parseImportSource();
          this.maybeParseImportAttributes(node);
          this.checkImportReflection(node);
          this.checkJSONModuleImport(node);
          this.semicolon();
          this.sawUnambiguousESM = true;
          return this.finishNode(node, "ImportDeclaration");
        }
        parseImportSource() {
          if (!this.match(134)) this.unexpected();
          return this.parseExprAtom();
        }
        parseImportSpecifierLocal(node, specifier, type) {
          specifier.local = this.parseIdentifier();
          node.specifiers.push(this.finishImportSpecifier(specifier, type));
        }
        finishImportSpecifier(specifier, type, bindingType = 8201) {
          this.checkLVal(specifier.local, {
            type
          }, bindingType);
          return this.finishNode(specifier, type);
        }
        parseImportAttributes() {
          this.expect(5);
          const attrs = [];
          const attrNames = /* @__PURE__ */ new Set();
          do {
            if (this.match(8)) {
              break;
            }
            const node = this.startNode();
            const keyName = this.state.value;
            if (attrNames.has(keyName)) {
              this.raise(Errors.ModuleAttributesWithDuplicateKeys, this.state.startLoc, {
                key: keyName
              });
            }
            attrNames.add(keyName);
            if (this.match(134)) {
              node.key = this.parseStringLiteral(keyName);
            } else {
              node.key = this.parseIdentifier(true);
            }
            this.expect(14);
            if (!this.match(134)) {
              throw this.raise(Errors.ModuleAttributeInvalidValue, this.state.startLoc);
            }
            node.value = this.parseStringLiteral(this.state.value);
            attrs.push(this.finishNode(node, "ImportAttribute"));
          } while (this.eat(12));
          this.expect(8);
          return attrs;
        }
        parseModuleAttributes() {
          const attrs = [];
          const attributes = /* @__PURE__ */ new Set();
          do {
            const node = this.startNode();
            node.key = this.parseIdentifier(true);
            if (node.key.name !== "type") {
              this.raise(Errors.ModuleAttributeDifferentFromType, node.key);
            }
            if (attributes.has(node.key.name)) {
              this.raise(Errors.ModuleAttributesWithDuplicateKeys, node.key, {
                key: node.key.name
              });
            }
            attributes.add(node.key.name);
            this.expect(14);
            if (!this.match(134)) {
              throw this.raise(Errors.ModuleAttributeInvalidValue, this.state.startLoc);
            }
            node.value = this.parseStringLiteral(this.state.value);
            attrs.push(this.finishNode(node, "ImportAttribute"));
          } while (this.eat(12));
          return attrs;
        }
        maybeParseImportAttributes(node) {
          let attributes;
          var useWith = false;
          if (this.match(76)) {
            if (this.hasPrecedingLineBreak() && this.lookaheadCharCode() === 40) {
              return;
            }
            this.next();
            if (this.hasPlugin("moduleAttributes")) {
              attributes = this.parseModuleAttributes();
              this.addExtra(node, "deprecatedWithLegacySyntax", true);
            } else {
              attributes = this.parseImportAttributes();
            }
            useWith = true;
          } else if (this.isContextual(94) && !this.hasPrecedingLineBreak()) {
            if (!this.hasPlugin("deprecatedImportAssert") && !this.hasPlugin("importAssertions")) {
              this.raise(Errors.ImportAttributesUseAssert, this.state.startLoc);
            }
            if (!this.hasPlugin("importAssertions")) {
              this.addExtra(node, "deprecatedAssertSyntax", true);
            }
            this.next();
            attributes = this.parseImportAttributes();
          } else {
            attributes = [];
          }
          if (!useWith && this.hasPlugin("importAssertions")) {
            node.assertions = attributes;
          } else {
            node.attributes = attributes;
          }
        }
        maybeParseDefaultImportSpecifier(node, maybeDefaultIdentifier) {
          if (maybeDefaultIdentifier) {
            const specifier = this.startNodeAtNode(maybeDefaultIdentifier);
            specifier.local = maybeDefaultIdentifier;
            node.specifiers.push(this.finishImportSpecifier(specifier, "ImportDefaultSpecifier"));
            return true;
          } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
            this.parseImportSpecifierLocal(node, this.startNode(), "ImportDefaultSpecifier");
            return true;
          }
          return false;
        }
        maybeParseStarImportSpecifier(node) {
          if (this.match(55)) {
            const specifier = this.startNode();
            this.next();
            this.expectContextual(93);
            this.parseImportSpecifierLocal(node, specifier, "ImportNamespaceSpecifier");
            return true;
          }
          return false;
        }
        parseNamedImportSpecifiers(node) {
          let first = true;
          this.expect(5);
          while (!this.eat(8)) {
            if (first) {
              first = false;
            } else {
              if (this.eat(14)) {
                throw this.raise(Errors.DestructureNamedImport, this.state.startLoc);
              }
              this.expect(12);
              if (this.eat(8)) break;
            }
            const specifier = this.startNode();
            const importedIsString = this.match(134);
            const isMaybeTypeOnly = this.isContextual(130);
            specifier.imported = this.parseModuleExportName();
            const importSpecifier = this.parseImportSpecifier(specifier, importedIsString, node.importKind === "type" || node.importKind === "typeof", isMaybeTypeOnly, void 0);
            node.specifiers.push(importSpecifier);
          }
        }
        parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly, bindingType) {
          if (this.eatContextual(93)) {
            specifier.local = this.parseIdentifier();
          } else {
            const {
              imported
            } = specifier;
            if (importedIsString) {
              throw this.raise(Errors.ImportBindingIsString, specifier, {
                importName: imported.value
              });
            }
            this.checkReservedWord(imported.name, specifier.loc.start, true, true);
            if (!specifier.local) {
              specifier.local = this.cloneIdentifier(imported);
            }
          }
          return this.finishImportSpecifier(specifier, "ImportSpecifier", bindingType);
        }
        isThisParam(param) {
          return param.type === "Identifier" && param.name === "this";
        }
      };
      var Parser = class extends StatementParser {
        constructor(options, input, pluginsMap) {
          const normalizedOptions = getOptions(options);
          super(normalizedOptions, input);
          this.options = normalizedOptions;
          this.initializeScopes();
          this.plugins = pluginsMap;
          this.filename = normalizedOptions.sourceFilename;
          this.startIndex = normalizedOptions.startIndex;
          let optionFlags = 0;
          if (normalizedOptions.allowAwaitOutsideFunction) {
            optionFlags |= 1;
          }
          if (normalizedOptions.allowReturnOutsideFunction) {
            optionFlags |= 2;
          }
          if (normalizedOptions.allowImportExportEverywhere) {
            optionFlags |= 8;
          }
          if (normalizedOptions.allowSuperOutsideMethod) {
            optionFlags |= 16;
          }
          if (normalizedOptions.allowUndeclaredExports) {
            optionFlags |= 64;
          }
          if (normalizedOptions.allowNewTargetOutsideFunction) {
            optionFlags |= 4;
          }
          if (normalizedOptions.allowYieldOutsideFunction) {
            optionFlags |= 32;
          }
          if (normalizedOptions.ranges) {
            optionFlags |= 128;
          }
          if (normalizedOptions.tokens) {
            optionFlags |= 256;
          }
          if (normalizedOptions.createImportExpressions) {
            optionFlags |= 512;
          }
          if (normalizedOptions.createParenthesizedExpressions) {
            optionFlags |= 1024;
          }
          if (normalizedOptions.errorRecovery) {
            optionFlags |= 2048;
          }
          if (normalizedOptions.attachComment) {
            optionFlags |= 4096;
          }
          if (normalizedOptions.annexB) {
            optionFlags |= 8192;
          }
          this.optionFlags = optionFlags;
        }
        getScopeHandler() {
          return ScopeHandler;
        }
        parse() {
          this.enterInitialScopes();
          const file = this.startNode();
          const program = this.startNode();
          this.nextToken();
          file.errors = null;
          const result = this.parseTopLevel(file, program);
          result.errors = this.state.errors;
          result.comments.length = this.state.commentsLen;
          return result;
        }
      };
      function parse2(input, options) {
        var _options;
        if (((_options = options) == null ? void 0 : _options.sourceType) === "unambiguous") {
          options = Object.assign({}, options);
          try {
            options.sourceType = "module";
            const parser = getParser(options, input);
            const ast = parser.parse();
            if (parser.sawUnambiguousESM) {
              return ast;
            }
            if (parser.ambiguousScriptDifferentAst) {
              try {
                options.sourceType = "script";
                return getParser(options, input).parse();
              } catch (_unused) {
              }
            } else {
              ast.program.sourceType = "script";
            }
            return ast;
          } catch (moduleError) {
            try {
              options.sourceType = "script";
              return getParser(options, input).parse();
            } catch (_unused2) {
            }
            throw moduleError;
          }
        } else {
          return getParser(options, input).parse();
        }
      }
      function parseExpression(input, options) {
        const parser = getParser(options, input);
        if (parser.options.strictMode) {
          parser.state.strict = true;
        }
        return parser.getExpression();
      }
      function generateExportedTokenTypes(internalTokenTypes) {
        const tokenTypes2 = {};
        for (const typeName of Object.keys(internalTokenTypes)) {
          tokenTypes2[typeName] = getExportedToken(internalTokenTypes[typeName]);
        }
        return tokenTypes2;
      }
      var tokTypes = generateExportedTokenTypes(tt);
      function getParser(options, input) {
        let cls = Parser;
        const pluginsMap = /* @__PURE__ */ new Map();
        if (options != null && options.plugins) {
          for (const plugin of options.plugins) {
            let name, opts;
            if (typeof plugin === "string") {
              name = plugin;
            } else {
              [name, opts] = plugin;
            }
            if (!pluginsMap.has(name)) {
              pluginsMap.set(name, opts || {});
            }
          }
          validatePlugins(pluginsMap);
          cls = getParserClass(pluginsMap);
        }
        return new cls(options, input, pluginsMap);
      }
      var parserClassCache = /* @__PURE__ */ new Map();
      function getParserClass(pluginsMap) {
        const pluginList = [];
        for (const name of mixinPluginNames) {
          if (pluginsMap.has(name)) {
            pluginList.push(name);
          }
        }
        const key = pluginList.join("|");
        let cls = parserClassCache.get(key);
        if (!cls) {
          cls = Parser;
          for (const plugin of pluginList) {
            cls = mixinPlugins[plugin](cls);
          }
          parserClassCache.set(key, cls);
        }
        return cls;
      }
      exports.parse = parse2;
      exports.parseExpression = parseExpression;
      exports.tokTypes = tokTypes;
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

  // node_modules/estraverse/estraverse.js
  var require_estraverse = __commonJS({
    "node_modules/estraverse/estraverse.js"(exports) {
      (function clone(exports2) {
        "use strict";
        var Syntax4, VisitorOption, VisitorKeys, BREAK, SKIP, REMOVE;
        function deepCopy(obj) {
          var ret = {}, key, val;
          for (key in obj) {
            if (obj.hasOwnProperty(key)) {
              val = obj[key];
              if (typeof val === "object" && val !== null) {
                ret[key] = deepCopy(val);
              } else {
                ret[key] = val;
              }
            }
          }
          return ret;
        }
        function upperBound(array, func) {
          var diff, len, i, current;
          len = array.length;
          i = 0;
          while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
              len = diff;
            } else {
              i = current + 1;
              len -= diff + 1;
            }
          }
          return i;
        }
        Syntax4 = {
          AssignmentExpression: "AssignmentExpression",
          AssignmentPattern: "AssignmentPattern",
          ArrayExpression: "ArrayExpression",
          ArrayPattern: "ArrayPattern",
          ArrowFunctionExpression: "ArrowFunctionExpression",
          AwaitExpression: "AwaitExpression",
          // CAUTION: It's deferred to ES7.
          BlockStatement: "BlockStatement",
          BinaryExpression: "BinaryExpression",
          BreakStatement: "BreakStatement",
          CallExpression: "CallExpression",
          CatchClause: "CatchClause",
          ChainExpression: "ChainExpression",
          ClassBody: "ClassBody",
          ClassDeclaration: "ClassDeclaration",
          ClassExpression: "ClassExpression",
          ComprehensionBlock: "ComprehensionBlock",
          // CAUTION: It's deferred to ES7.
          ComprehensionExpression: "ComprehensionExpression",
          // CAUTION: It's deferred to ES7.
          ConditionalExpression: "ConditionalExpression",
          ContinueStatement: "ContinueStatement",
          DebuggerStatement: "DebuggerStatement",
          DirectiveStatement: "DirectiveStatement",
          DoWhileStatement: "DoWhileStatement",
          EmptyStatement: "EmptyStatement",
          ExportAllDeclaration: "ExportAllDeclaration",
          ExportDefaultDeclaration: "ExportDefaultDeclaration",
          ExportNamedDeclaration: "ExportNamedDeclaration",
          ExportSpecifier: "ExportSpecifier",
          ExpressionStatement: "ExpressionStatement",
          ForStatement: "ForStatement",
          ForInStatement: "ForInStatement",
          ForOfStatement: "ForOfStatement",
          FunctionDeclaration: "FunctionDeclaration",
          FunctionExpression: "FunctionExpression",
          GeneratorExpression: "GeneratorExpression",
          // CAUTION: It's deferred to ES7.
          Identifier: "Identifier",
          IfStatement: "IfStatement",
          ImportExpression: "ImportExpression",
          ImportDeclaration: "ImportDeclaration",
          ImportDefaultSpecifier: "ImportDefaultSpecifier",
          ImportNamespaceSpecifier: "ImportNamespaceSpecifier",
          ImportSpecifier: "ImportSpecifier",
          Literal: "Literal",
          LabeledStatement: "LabeledStatement",
          LogicalExpression: "LogicalExpression",
          MemberExpression: "MemberExpression",
          MetaProperty: "MetaProperty",
          MethodDefinition: "MethodDefinition",
          ModuleSpecifier: "ModuleSpecifier",
          NewExpression: "NewExpression",
          ObjectExpression: "ObjectExpression",
          ObjectPattern: "ObjectPattern",
          PrivateIdentifier: "PrivateIdentifier",
          Program: "Program",
          Property: "Property",
          PropertyDefinition: "PropertyDefinition",
          RestElement: "RestElement",
          ReturnStatement: "ReturnStatement",
          SequenceExpression: "SequenceExpression",
          SpreadElement: "SpreadElement",
          Super: "Super",
          SwitchStatement: "SwitchStatement",
          SwitchCase: "SwitchCase",
          TaggedTemplateExpression: "TaggedTemplateExpression",
          TemplateElement: "TemplateElement",
          TemplateLiteral: "TemplateLiteral",
          ThisExpression: "ThisExpression",
          ThrowStatement: "ThrowStatement",
          TryStatement: "TryStatement",
          UnaryExpression: "UnaryExpression",
          UpdateExpression: "UpdateExpression",
          VariableDeclaration: "VariableDeclaration",
          VariableDeclarator: "VariableDeclarator",
          WhileStatement: "WhileStatement",
          WithStatement: "WithStatement",
          YieldExpression: "YieldExpression"
        };
        VisitorKeys = {
          AssignmentExpression: ["left", "right"],
          AssignmentPattern: ["left", "right"],
          ArrayExpression: ["elements"],
          ArrayPattern: ["elements"],
          ArrowFunctionExpression: ["params", "body"],
          AwaitExpression: ["argument"],
          // CAUTION: It's deferred to ES7.
          BlockStatement: ["body"],
          BinaryExpression: ["left", "right"],
          BreakStatement: ["label"],
          CallExpression: ["callee", "arguments"],
          CatchClause: ["param", "body"],
          ChainExpression: ["expression"],
          ClassBody: ["body"],
          ClassDeclaration: ["id", "superClass", "body"],
          ClassExpression: ["id", "superClass", "body"],
          ComprehensionBlock: ["left", "right"],
          // CAUTION: It's deferred to ES7.
          ComprehensionExpression: ["blocks", "filter", "body"],
          // CAUTION: It's deferred to ES7.
          ConditionalExpression: ["test", "consequent", "alternate"],
          ContinueStatement: ["label"],
          DebuggerStatement: [],
          DirectiveStatement: [],
          DoWhileStatement: ["body", "test"],
          EmptyStatement: [],
          ExportAllDeclaration: ["source"],
          ExportDefaultDeclaration: ["declaration"],
          ExportNamedDeclaration: ["declaration", "specifiers", "source"],
          ExportSpecifier: ["exported", "local"],
          ExpressionStatement: ["expression"],
          ForStatement: ["init", "test", "update", "body"],
          ForInStatement: ["left", "right", "body"],
          ForOfStatement: ["left", "right", "body"],
          FunctionDeclaration: ["id", "params", "body"],
          FunctionExpression: ["id", "params", "body"],
          GeneratorExpression: ["blocks", "filter", "body"],
          // CAUTION: It's deferred to ES7.
          Identifier: [],
          IfStatement: ["test", "consequent", "alternate"],
          ImportExpression: ["source"],
          ImportDeclaration: ["specifiers", "source"],
          ImportDefaultSpecifier: ["local"],
          ImportNamespaceSpecifier: ["local"],
          ImportSpecifier: ["imported", "local"],
          Literal: [],
          LabeledStatement: ["label", "body"],
          LogicalExpression: ["left", "right"],
          MemberExpression: ["object", "property"],
          MetaProperty: ["meta", "property"],
          MethodDefinition: ["key", "value"],
          ModuleSpecifier: [],
          NewExpression: ["callee", "arguments"],
          ObjectExpression: ["properties"],
          ObjectPattern: ["properties"],
          PrivateIdentifier: [],
          Program: ["body"],
          Property: ["key", "value"],
          PropertyDefinition: ["key", "value"],
          RestElement: ["argument"],
          ReturnStatement: ["argument"],
          SequenceExpression: ["expressions"],
          SpreadElement: ["argument"],
          Super: [],
          SwitchStatement: ["discriminant", "cases"],
          SwitchCase: ["test", "consequent"],
          TaggedTemplateExpression: ["tag", "quasi"],
          TemplateElement: [],
          TemplateLiteral: ["quasis", "expressions"],
          ThisExpression: [],
          ThrowStatement: ["argument"],
          TryStatement: ["block", "handler", "finalizer"],
          UnaryExpression: ["argument"],
          UpdateExpression: ["argument"],
          VariableDeclaration: ["declarations"],
          VariableDeclarator: ["id", "init"],
          WhileStatement: ["test", "body"],
          WithStatement: ["object", "body"],
          YieldExpression: ["argument"]
        };
        BREAK = {};
        SKIP = {};
        REMOVE = {};
        VisitorOption = {
          Break: BREAK,
          Skip: SKIP,
          Remove: REMOVE
        };
        function Reference2(parent, key) {
          this.parent = parent;
          this.key = key;
        }
        Reference2.prototype.replace = function replace2(node) {
          this.parent[this.key] = node;
        };
        Reference2.prototype.remove = function remove() {
          if (Array.isArray(this.parent)) {
            this.parent.splice(this.key, 1);
            return true;
          } else {
            this.replace(null);
            return false;
          }
        };
        function Element(node, path, wrap, ref) {
          this.node = node;
          this.path = path;
          this.wrap = wrap;
          this.ref = ref;
        }
        function Controller() {
        }
        Controller.prototype.path = function path() {
          var i, iz, j, jz, result, element;
          function addToPath(result2, path2) {
            if (Array.isArray(path2)) {
              for (j = 0, jz = path2.length; j < jz; ++j) {
                result2.push(path2[j]);
              }
            } else {
              result2.push(path2);
            }
          }
          if (!this.__current.path) {
            return null;
          }
          result = [];
          for (i = 2, iz = this.__leavelist.length; i < iz; ++i) {
            element = this.__leavelist[i];
            addToPath(result, element.path);
          }
          addToPath(result, this.__current.path);
          return result;
        };
        Controller.prototype.type = function() {
          var node = this.current();
          return node.type || this.__current.wrap;
        };
        Controller.prototype.parents = function parents() {
          var i, iz, result;
          result = [];
          for (i = 1, iz = this.__leavelist.length; i < iz; ++i) {
            result.push(this.__leavelist[i].node);
          }
          return result;
        };
        Controller.prototype.current = function current() {
          return this.__current.node;
        };
        Controller.prototype.__execute = function __execute(callback, element) {
          var previous, result;
          result = void 0;
          previous = this.__current;
          this.__current = element;
          this.__state = null;
          if (callback) {
            result = callback.call(this, element.node, this.__leavelist[this.__leavelist.length - 1].node);
          }
          this.__current = previous;
          return result;
        };
        Controller.prototype.notify = function notify(flag) {
          this.__state = flag;
        };
        Controller.prototype.skip = function() {
          this.notify(SKIP);
        };
        Controller.prototype["break"] = function() {
          this.notify(BREAK);
        };
        Controller.prototype.remove = function() {
          this.notify(REMOVE);
        };
        Controller.prototype.__initialize = function(root, visitor) {
          this.visitor = visitor;
          this.root = root;
          this.__worklist = [];
          this.__leavelist = [];
          this.__current = null;
          this.__state = null;
          this.__fallback = null;
          if (visitor.fallback === "iteration") {
            this.__fallback = Object.keys;
          } else if (typeof visitor.fallback === "function") {
            this.__fallback = visitor.fallback;
          }
          this.__keys = VisitorKeys;
          if (visitor.keys) {
            this.__keys = Object.assign(Object.create(this.__keys), visitor.keys);
          }
        };
        function isNode(node) {
          if (node == null) {
            return false;
          }
          return typeof node === "object" && typeof node.type === "string";
        }
        function isProperty(nodeType, key) {
          return (nodeType === Syntax4.ObjectExpression || nodeType === Syntax4.ObjectPattern) && "properties" === key;
        }
        function candidateExistsInLeaveList(leavelist, candidate) {
          for (var i = leavelist.length - 1; i >= 0; --i) {
            if (leavelist[i].node === candidate) {
              return true;
            }
          }
          return false;
        }
        Controller.prototype.traverse = function traverse2(root, visitor) {
          var worklist, leavelist, element, node, nodeType, ret, key, current, current2, candidates, candidate, sentinel;
          this.__initialize(root, visitor);
          sentinel = {};
          worklist = this.__worklist;
          leavelist = this.__leavelist;
          worklist.push(new Element(root, null, null, null));
          leavelist.push(new Element(null, null, null, null));
          while (worklist.length) {
            element = worklist.pop();
            if (element === sentinel) {
              element = leavelist.pop();
              ret = this.__execute(visitor.leave, element);
              if (this.__state === BREAK || ret === BREAK) {
                return;
              }
              continue;
            }
            if (element.node) {
              ret = this.__execute(visitor.enter, element);
              if (this.__state === BREAK || ret === BREAK) {
                return;
              }
              worklist.push(sentinel);
              leavelist.push(element);
              if (this.__state === SKIP || ret === SKIP) {
                continue;
              }
              node = element.node;
              nodeType = node.type || element.wrap;
              candidates = this.__keys[nodeType];
              if (!candidates) {
                if (this.__fallback) {
                  candidates = this.__fallback(node);
                } else {
                  throw new Error("Unknown node type " + nodeType + ".");
                }
              }
              current = candidates.length;
              while ((current -= 1) >= 0) {
                key = candidates[current];
                candidate = node[key];
                if (!candidate) {
                  continue;
                }
                if (Array.isArray(candidate)) {
                  current2 = candidate.length;
                  while ((current2 -= 1) >= 0) {
                    if (!candidate[current2]) {
                      continue;
                    }
                    if (candidateExistsInLeaveList(leavelist, candidate[current2])) {
                      continue;
                    }
                    if (isProperty(nodeType, candidates[current])) {
                      element = new Element(candidate[current2], [key, current2], "Property", null);
                    } else if (isNode(candidate[current2])) {
                      element = new Element(candidate[current2], [key, current2], null, null);
                    } else {
                      continue;
                    }
                    worklist.push(element);
                  }
                } else if (isNode(candidate)) {
                  if (candidateExistsInLeaveList(leavelist, candidate)) {
                    continue;
                  }
                  worklist.push(new Element(candidate, key, null, null));
                }
              }
            }
          }
        };
        Controller.prototype.replace = function replace2(root, visitor) {
          var worklist, leavelist, node, nodeType, target, element, current, current2, candidates, candidate, sentinel, outer, key;
          function removeElem(element2) {
            var i, key2, nextElem, parent;
            if (element2.ref.remove()) {
              key2 = element2.ref.key;
              parent = element2.ref.parent;
              i = worklist.length;
              while (i--) {
                nextElem = worklist[i];
                if (nextElem.ref && nextElem.ref.parent === parent) {
                  if (nextElem.ref.key < key2) {
                    break;
                  }
                  --nextElem.ref.key;
                }
              }
            }
          }
          this.__initialize(root, visitor);
          sentinel = {};
          worklist = this.__worklist;
          leavelist = this.__leavelist;
          outer = {
            root
          };
          element = new Element(root, null, null, new Reference2(outer, "root"));
          worklist.push(element);
          leavelist.push(element);
          while (worklist.length) {
            element = worklist.pop();
            if (element === sentinel) {
              element = leavelist.pop();
              target = this.__execute(visitor.leave, element);
              if (target !== void 0 && target !== BREAK && target !== SKIP && target !== REMOVE) {
                element.ref.replace(target);
              }
              if (this.__state === REMOVE || target === REMOVE) {
                removeElem(element);
              }
              if (this.__state === BREAK || target === BREAK) {
                return outer.root;
              }
              continue;
            }
            target = this.__execute(visitor.enter, element);
            if (target !== void 0 && target !== BREAK && target !== SKIP && target !== REMOVE) {
              element.ref.replace(target);
              element.node = target;
            }
            if (this.__state === REMOVE || target === REMOVE) {
              removeElem(element);
              element.node = null;
            }
            if (this.__state === BREAK || target === BREAK) {
              return outer.root;
            }
            node = element.node;
            if (!node) {
              continue;
            }
            worklist.push(sentinel);
            leavelist.push(element);
            if (this.__state === SKIP || target === SKIP) {
              continue;
            }
            nodeType = node.type || element.wrap;
            candidates = this.__keys[nodeType];
            if (!candidates) {
              if (this.__fallback) {
                candidates = this.__fallback(node);
              } else {
                throw new Error("Unknown node type " + nodeType + ".");
              }
            }
            current = candidates.length;
            while ((current -= 1) >= 0) {
              key = candidates[current];
              candidate = node[key];
              if (!candidate) {
                continue;
              }
              if (Array.isArray(candidate)) {
                current2 = candidate.length;
                while ((current2 -= 1) >= 0) {
                  if (!candidate[current2]) {
                    continue;
                  }
                  if (isProperty(nodeType, candidates[current])) {
                    element = new Element(candidate[current2], [key, current2], "Property", new Reference2(candidate, current2));
                  } else if (isNode(candidate[current2])) {
                    element = new Element(candidate[current2], [key, current2], null, new Reference2(candidate, current2));
                  } else {
                    continue;
                  }
                  worklist.push(element);
                }
              } else if (isNode(candidate)) {
                worklist.push(new Element(candidate, key, null, new Reference2(node, key)));
              }
            }
          }
          return outer.root;
        };
        function traverse(root, visitor) {
          var controller = new Controller();
          return controller.traverse(root, visitor);
        }
        function replace(root, visitor) {
          var controller = new Controller();
          return controller.replace(root, visitor);
        }
        function extendCommentRange(comment, tokens) {
          var target;
          target = upperBound(tokens, function search(token) {
            return token.range[0] > comment.range[0];
          });
          comment.extendedRange = [comment.range[0], comment.range[1]];
          if (target !== tokens.length) {
            comment.extendedRange[1] = tokens[target].range[0];
          }
          target -= 1;
          if (target >= 0) {
            comment.extendedRange[0] = tokens[target].range[1];
          }
          return comment;
        }
        function attachComments(tree, providedComments, tokens) {
          var comments = [], comment, len, i, cursor;
          if (!tree.range) {
            throw new Error("attachComments needs range information");
          }
          if (!tokens.length) {
            if (providedComments.length) {
              for (i = 0, len = providedComments.length; i < len; i += 1) {
                comment = deepCopy(providedComments[i]);
                comment.extendedRange = [0, tree.range[0]];
                comments.push(comment);
              }
              tree.leadingComments = comments;
            }
            return tree;
          }
          for (i = 0, len = providedComments.length; i < len; i += 1) {
            comments.push(extendCommentRange(deepCopy(providedComments[i]), tokens));
          }
          cursor = 0;
          traverse(tree, {
            enter: function(node) {
              var comment2;
              while (cursor < comments.length) {
                comment2 = comments[cursor];
                if (comment2.extendedRange[1] > node.range[0]) {
                  break;
                }
                if (comment2.extendedRange[1] === node.range[0]) {
                  if (!node.leadingComments) {
                    node.leadingComments = [];
                  }
                  node.leadingComments.push(comment2);
                  comments.splice(cursor, 1);
                } else {
                  cursor += 1;
                }
              }
              if (cursor === comments.length) {
                return VisitorOption.Break;
              }
              if (comments[cursor].extendedRange[0] > node.range[1]) {
                return VisitorOption.Skip;
              }
            }
          });
          cursor = 0;
          traverse(tree, {
            leave: function(node) {
              var comment2;
              while (cursor < comments.length) {
                comment2 = comments[cursor];
                if (node.range[1] < comment2.extendedRange[0]) {
                  break;
                }
                if (node.range[1] === comment2.extendedRange[0]) {
                  if (!node.trailingComments) {
                    node.trailingComments = [];
                  }
                  node.trailingComments.push(comment2);
                  comments.splice(cursor, 1);
                } else {
                  cursor += 1;
                }
              }
              if (cursor === comments.length) {
                return VisitorOption.Break;
              }
              if (comments[cursor].extendedRange[0] > node.range[1]) {
                return VisitorOption.Skip;
              }
            }
          });
          return tree;
        }
        exports2.Syntax = Syntax4;
        exports2.traverse = traverse;
        exports2.replace = replace;
        exports2.attachComments = attachComments;
        exports2.VisitorKeys = VisitorKeys;
        exports2.VisitorOption = VisitorOption;
        exports2.Controller = Controller;
        exports2.cloneEnvironment = function() {
          return clone({});
        };
        return exports2;
      })(exports);
    }
  });

  // ../../node_modules/esrecurse/node_modules/estraverse/estraverse.js
  var require_estraverse2 = __commonJS({
    "../../node_modules/esrecurse/node_modules/estraverse/estraverse.js"(exports) {
      (function clone(exports2) {
        "use strict";
        var Syntax4, VisitorOption, VisitorKeys, BREAK, SKIP, REMOVE;
        function deepCopy(obj) {
          var ret = {}, key, val;
          for (key in obj) {
            if (obj.hasOwnProperty(key)) {
              val = obj[key];
              if (typeof val === "object" && val !== null) {
                ret[key] = deepCopy(val);
              } else {
                ret[key] = val;
              }
            }
          }
          return ret;
        }
        function upperBound(array, func) {
          var diff, len, i, current;
          len = array.length;
          i = 0;
          while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
              len = diff;
            } else {
              i = current + 1;
              len -= diff + 1;
            }
          }
          return i;
        }
        Syntax4 = {
          AssignmentExpression: "AssignmentExpression",
          AssignmentPattern: "AssignmentPattern",
          ArrayExpression: "ArrayExpression",
          ArrayPattern: "ArrayPattern",
          ArrowFunctionExpression: "ArrowFunctionExpression",
          AwaitExpression: "AwaitExpression",
          // CAUTION: It's deferred to ES7.
          BlockStatement: "BlockStatement",
          BinaryExpression: "BinaryExpression",
          BreakStatement: "BreakStatement",
          CallExpression: "CallExpression",
          CatchClause: "CatchClause",
          ChainExpression: "ChainExpression",
          ClassBody: "ClassBody",
          ClassDeclaration: "ClassDeclaration",
          ClassExpression: "ClassExpression",
          ComprehensionBlock: "ComprehensionBlock",
          // CAUTION: It's deferred to ES7.
          ComprehensionExpression: "ComprehensionExpression",
          // CAUTION: It's deferred to ES7.
          ConditionalExpression: "ConditionalExpression",
          ContinueStatement: "ContinueStatement",
          DebuggerStatement: "DebuggerStatement",
          DirectiveStatement: "DirectiveStatement",
          DoWhileStatement: "DoWhileStatement",
          EmptyStatement: "EmptyStatement",
          ExportAllDeclaration: "ExportAllDeclaration",
          ExportDefaultDeclaration: "ExportDefaultDeclaration",
          ExportNamedDeclaration: "ExportNamedDeclaration",
          ExportSpecifier: "ExportSpecifier",
          ExpressionStatement: "ExpressionStatement",
          ForStatement: "ForStatement",
          ForInStatement: "ForInStatement",
          ForOfStatement: "ForOfStatement",
          FunctionDeclaration: "FunctionDeclaration",
          FunctionExpression: "FunctionExpression",
          GeneratorExpression: "GeneratorExpression",
          // CAUTION: It's deferred to ES7.
          Identifier: "Identifier",
          IfStatement: "IfStatement",
          ImportExpression: "ImportExpression",
          ImportDeclaration: "ImportDeclaration",
          ImportDefaultSpecifier: "ImportDefaultSpecifier",
          ImportNamespaceSpecifier: "ImportNamespaceSpecifier",
          ImportSpecifier: "ImportSpecifier",
          Literal: "Literal",
          LabeledStatement: "LabeledStatement",
          LogicalExpression: "LogicalExpression",
          MemberExpression: "MemberExpression",
          MetaProperty: "MetaProperty",
          MethodDefinition: "MethodDefinition",
          ModuleSpecifier: "ModuleSpecifier",
          NewExpression: "NewExpression",
          ObjectExpression: "ObjectExpression",
          ObjectPattern: "ObjectPattern",
          PrivateIdentifier: "PrivateIdentifier",
          Program: "Program",
          Property: "Property",
          PropertyDefinition: "PropertyDefinition",
          RestElement: "RestElement",
          ReturnStatement: "ReturnStatement",
          SequenceExpression: "SequenceExpression",
          SpreadElement: "SpreadElement",
          Super: "Super",
          SwitchStatement: "SwitchStatement",
          SwitchCase: "SwitchCase",
          TaggedTemplateExpression: "TaggedTemplateExpression",
          TemplateElement: "TemplateElement",
          TemplateLiteral: "TemplateLiteral",
          ThisExpression: "ThisExpression",
          ThrowStatement: "ThrowStatement",
          TryStatement: "TryStatement",
          UnaryExpression: "UnaryExpression",
          UpdateExpression: "UpdateExpression",
          VariableDeclaration: "VariableDeclaration",
          VariableDeclarator: "VariableDeclarator",
          WhileStatement: "WhileStatement",
          WithStatement: "WithStatement",
          YieldExpression: "YieldExpression"
        };
        VisitorKeys = {
          AssignmentExpression: ["left", "right"],
          AssignmentPattern: ["left", "right"],
          ArrayExpression: ["elements"],
          ArrayPattern: ["elements"],
          ArrowFunctionExpression: ["params", "body"],
          AwaitExpression: ["argument"],
          // CAUTION: It's deferred to ES7.
          BlockStatement: ["body"],
          BinaryExpression: ["left", "right"],
          BreakStatement: ["label"],
          CallExpression: ["callee", "arguments"],
          CatchClause: ["param", "body"],
          ChainExpression: ["expression"],
          ClassBody: ["body"],
          ClassDeclaration: ["id", "superClass", "body"],
          ClassExpression: ["id", "superClass", "body"],
          ComprehensionBlock: ["left", "right"],
          // CAUTION: It's deferred to ES7.
          ComprehensionExpression: ["blocks", "filter", "body"],
          // CAUTION: It's deferred to ES7.
          ConditionalExpression: ["test", "consequent", "alternate"],
          ContinueStatement: ["label"],
          DebuggerStatement: [],
          DirectiveStatement: [],
          DoWhileStatement: ["body", "test"],
          EmptyStatement: [],
          ExportAllDeclaration: ["source"],
          ExportDefaultDeclaration: ["declaration"],
          ExportNamedDeclaration: ["declaration", "specifiers", "source"],
          ExportSpecifier: ["exported", "local"],
          ExpressionStatement: ["expression"],
          ForStatement: ["init", "test", "update", "body"],
          ForInStatement: ["left", "right", "body"],
          ForOfStatement: ["left", "right", "body"],
          FunctionDeclaration: ["id", "params", "body"],
          FunctionExpression: ["id", "params", "body"],
          GeneratorExpression: ["blocks", "filter", "body"],
          // CAUTION: It's deferred to ES7.
          Identifier: [],
          IfStatement: ["test", "consequent", "alternate"],
          ImportExpression: ["source"],
          ImportDeclaration: ["specifiers", "source"],
          ImportDefaultSpecifier: ["local"],
          ImportNamespaceSpecifier: ["local"],
          ImportSpecifier: ["imported", "local"],
          Literal: [],
          LabeledStatement: ["label", "body"],
          LogicalExpression: ["left", "right"],
          MemberExpression: ["object", "property"],
          MetaProperty: ["meta", "property"],
          MethodDefinition: ["key", "value"],
          ModuleSpecifier: [],
          NewExpression: ["callee", "arguments"],
          ObjectExpression: ["properties"],
          ObjectPattern: ["properties"],
          PrivateIdentifier: [],
          Program: ["body"],
          Property: ["key", "value"],
          PropertyDefinition: ["key", "value"],
          RestElement: ["argument"],
          ReturnStatement: ["argument"],
          SequenceExpression: ["expressions"],
          SpreadElement: ["argument"],
          Super: [],
          SwitchStatement: ["discriminant", "cases"],
          SwitchCase: ["test", "consequent"],
          TaggedTemplateExpression: ["tag", "quasi"],
          TemplateElement: [],
          TemplateLiteral: ["quasis", "expressions"],
          ThisExpression: [],
          ThrowStatement: ["argument"],
          TryStatement: ["block", "handler", "finalizer"],
          UnaryExpression: ["argument"],
          UpdateExpression: ["argument"],
          VariableDeclaration: ["declarations"],
          VariableDeclarator: ["id", "init"],
          WhileStatement: ["test", "body"],
          WithStatement: ["object", "body"],
          YieldExpression: ["argument"]
        };
        BREAK = {};
        SKIP = {};
        REMOVE = {};
        VisitorOption = {
          Break: BREAK,
          Skip: SKIP,
          Remove: REMOVE
        };
        function Reference2(parent, key) {
          this.parent = parent;
          this.key = key;
        }
        Reference2.prototype.replace = function replace2(node) {
          this.parent[this.key] = node;
        };
        Reference2.prototype.remove = function remove() {
          if (Array.isArray(this.parent)) {
            this.parent.splice(this.key, 1);
            return true;
          } else {
            this.replace(null);
            return false;
          }
        };
        function Element(node, path, wrap, ref) {
          this.node = node;
          this.path = path;
          this.wrap = wrap;
          this.ref = ref;
        }
        function Controller() {
        }
        Controller.prototype.path = function path() {
          var i, iz, j, jz, result, element;
          function addToPath(result2, path2) {
            if (Array.isArray(path2)) {
              for (j = 0, jz = path2.length; j < jz; ++j) {
                result2.push(path2[j]);
              }
            } else {
              result2.push(path2);
            }
          }
          if (!this.__current.path) {
            return null;
          }
          result = [];
          for (i = 2, iz = this.__leavelist.length; i < iz; ++i) {
            element = this.__leavelist[i];
            addToPath(result, element.path);
          }
          addToPath(result, this.__current.path);
          return result;
        };
        Controller.prototype.type = function() {
          var node = this.current();
          return node.type || this.__current.wrap;
        };
        Controller.prototype.parents = function parents() {
          var i, iz, result;
          result = [];
          for (i = 1, iz = this.__leavelist.length; i < iz; ++i) {
            result.push(this.__leavelist[i].node);
          }
          return result;
        };
        Controller.prototype.current = function current() {
          return this.__current.node;
        };
        Controller.prototype.__execute = function __execute(callback, element) {
          var previous, result;
          result = void 0;
          previous = this.__current;
          this.__current = element;
          this.__state = null;
          if (callback) {
            result = callback.call(this, element.node, this.__leavelist[this.__leavelist.length - 1].node);
          }
          this.__current = previous;
          return result;
        };
        Controller.prototype.notify = function notify(flag) {
          this.__state = flag;
        };
        Controller.prototype.skip = function() {
          this.notify(SKIP);
        };
        Controller.prototype["break"] = function() {
          this.notify(BREAK);
        };
        Controller.prototype.remove = function() {
          this.notify(REMOVE);
        };
        Controller.prototype.__initialize = function(root, visitor) {
          this.visitor = visitor;
          this.root = root;
          this.__worklist = [];
          this.__leavelist = [];
          this.__current = null;
          this.__state = null;
          this.__fallback = null;
          if (visitor.fallback === "iteration") {
            this.__fallback = Object.keys;
          } else if (typeof visitor.fallback === "function") {
            this.__fallback = visitor.fallback;
          }
          this.__keys = VisitorKeys;
          if (visitor.keys) {
            this.__keys = Object.assign(Object.create(this.__keys), visitor.keys);
          }
        };
        function isNode(node) {
          if (node == null) {
            return false;
          }
          return typeof node === "object" && typeof node.type === "string";
        }
        function isProperty(nodeType, key) {
          return (nodeType === Syntax4.ObjectExpression || nodeType === Syntax4.ObjectPattern) && "properties" === key;
        }
        function candidateExistsInLeaveList(leavelist, candidate) {
          for (var i = leavelist.length - 1; i >= 0; --i) {
            if (leavelist[i].node === candidate) {
              return true;
            }
          }
          return false;
        }
        Controller.prototype.traverse = function traverse2(root, visitor) {
          var worklist, leavelist, element, node, nodeType, ret, key, current, current2, candidates, candidate, sentinel;
          this.__initialize(root, visitor);
          sentinel = {};
          worklist = this.__worklist;
          leavelist = this.__leavelist;
          worklist.push(new Element(root, null, null, null));
          leavelist.push(new Element(null, null, null, null));
          while (worklist.length) {
            element = worklist.pop();
            if (element === sentinel) {
              element = leavelist.pop();
              ret = this.__execute(visitor.leave, element);
              if (this.__state === BREAK || ret === BREAK) {
                return;
              }
              continue;
            }
            if (element.node) {
              ret = this.__execute(visitor.enter, element);
              if (this.__state === BREAK || ret === BREAK) {
                return;
              }
              worklist.push(sentinel);
              leavelist.push(element);
              if (this.__state === SKIP || ret === SKIP) {
                continue;
              }
              node = element.node;
              nodeType = node.type || element.wrap;
              candidates = this.__keys[nodeType];
              if (!candidates) {
                if (this.__fallback) {
                  candidates = this.__fallback(node);
                } else {
                  throw new Error("Unknown node type " + nodeType + ".");
                }
              }
              current = candidates.length;
              while ((current -= 1) >= 0) {
                key = candidates[current];
                candidate = node[key];
                if (!candidate) {
                  continue;
                }
                if (Array.isArray(candidate)) {
                  current2 = candidate.length;
                  while ((current2 -= 1) >= 0) {
                    if (!candidate[current2]) {
                      continue;
                    }
                    if (candidateExistsInLeaveList(leavelist, candidate[current2])) {
                      continue;
                    }
                    if (isProperty(nodeType, candidates[current])) {
                      element = new Element(candidate[current2], [key, current2], "Property", null);
                    } else if (isNode(candidate[current2])) {
                      element = new Element(candidate[current2], [key, current2], null, null);
                    } else {
                      continue;
                    }
                    worklist.push(element);
                  }
                } else if (isNode(candidate)) {
                  if (candidateExistsInLeaveList(leavelist, candidate)) {
                    continue;
                  }
                  worklist.push(new Element(candidate, key, null, null));
                }
              }
            }
          }
        };
        Controller.prototype.replace = function replace2(root, visitor) {
          var worklist, leavelist, node, nodeType, target, element, current, current2, candidates, candidate, sentinel, outer, key;
          function removeElem(element2) {
            var i, key2, nextElem, parent;
            if (element2.ref.remove()) {
              key2 = element2.ref.key;
              parent = element2.ref.parent;
              i = worklist.length;
              while (i--) {
                nextElem = worklist[i];
                if (nextElem.ref && nextElem.ref.parent === parent) {
                  if (nextElem.ref.key < key2) {
                    break;
                  }
                  --nextElem.ref.key;
                }
              }
            }
          }
          this.__initialize(root, visitor);
          sentinel = {};
          worklist = this.__worklist;
          leavelist = this.__leavelist;
          outer = {
            root
          };
          element = new Element(root, null, null, new Reference2(outer, "root"));
          worklist.push(element);
          leavelist.push(element);
          while (worklist.length) {
            element = worklist.pop();
            if (element === sentinel) {
              element = leavelist.pop();
              target = this.__execute(visitor.leave, element);
              if (target !== void 0 && target !== BREAK && target !== SKIP && target !== REMOVE) {
                element.ref.replace(target);
              }
              if (this.__state === REMOVE || target === REMOVE) {
                removeElem(element);
              }
              if (this.__state === BREAK || target === BREAK) {
                return outer.root;
              }
              continue;
            }
            target = this.__execute(visitor.enter, element);
            if (target !== void 0 && target !== BREAK && target !== SKIP && target !== REMOVE) {
              element.ref.replace(target);
              element.node = target;
            }
            if (this.__state === REMOVE || target === REMOVE) {
              removeElem(element);
              element.node = null;
            }
            if (this.__state === BREAK || target === BREAK) {
              return outer.root;
            }
            node = element.node;
            if (!node) {
              continue;
            }
            worklist.push(sentinel);
            leavelist.push(element);
            if (this.__state === SKIP || target === SKIP) {
              continue;
            }
            nodeType = node.type || element.wrap;
            candidates = this.__keys[nodeType];
            if (!candidates) {
              if (this.__fallback) {
                candidates = this.__fallback(node);
              } else {
                throw new Error("Unknown node type " + nodeType + ".");
              }
            }
            current = candidates.length;
            while ((current -= 1) >= 0) {
              key = candidates[current];
              candidate = node[key];
              if (!candidate) {
                continue;
              }
              if (Array.isArray(candidate)) {
                current2 = candidate.length;
                while ((current2 -= 1) >= 0) {
                  if (!candidate[current2]) {
                    continue;
                  }
                  if (isProperty(nodeType, candidates[current])) {
                    element = new Element(candidate[current2], [key, current2], "Property", new Reference2(candidate, current2));
                  } else if (isNode(candidate[current2])) {
                    element = new Element(candidate[current2], [key, current2], null, new Reference2(candidate, current2));
                  } else {
                    continue;
                  }
                  worklist.push(element);
                }
              } else if (isNode(candidate)) {
                worklist.push(new Element(candidate, key, null, new Reference2(node, key)));
              }
            }
          }
          return outer.root;
        };
        function traverse(root, visitor) {
          var controller = new Controller();
          return controller.traverse(root, visitor);
        }
        function replace(root, visitor) {
          var controller = new Controller();
          return controller.replace(root, visitor);
        }
        function extendCommentRange(comment, tokens) {
          var target;
          target = upperBound(tokens, function search(token) {
            return token.range[0] > comment.range[0];
          });
          comment.extendedRange = [comment.range[0], comment.range[1]];
          if (target !== tokens.length) {
            comment.extendedRange[1] = tokens[target].range[0];
          }
          target -= 1;
          if (target >= 0) {
            comment.extendedRange[0] = tokens[target].range[1];
          }
          return comment;
        }
        function attachComments(tree, providedComments, tokens) {
          var comments = [], comment, len, i, cursor;
          if (!tree.range) {
            throw new Error("attachComments needs range information");
          }
          if (!tokens.length) {
            if (providedComments.length) {
              for (i = 0, len = providedComments.length; i < len; i += 1) {
                comment = deepCopy(providedComments[i]);
                comment.extendedRange = [0, tree.range[0]];
                comments.push(comment);
              }
              tree.leadingComments = comments;
            }
            return tree;
          }
          for (i = 0, len = providedComments.length; i < len; i += 1) {
            comments.push(extendCommentRange(deepCopy(providedComments[i]), tokens));
          }
          cursor = 0;
          traverse(tree, {
            enter: function(node) {
              var comment2;
              while (cursor < comments.length) {
                comment2 = comments[cursor];
                if (comment2.extendedRange[1] > node.range[0]) {
                  break;
                }
                if (comment2.extendedRange[1] === node.range[0]) {
                  if (!node.leadingComments) {
                    node.leadingComments = [];
                  }
                  node.leadingComments.push(comment2);
                  comments.splice(cursor, 1);
                } else {
                  cursor += 1;
                }
              }
              if (cursor === comments.length) {
                return VisitorOption.Break;
              }
              if (comments[cursor].extendedRange[0] > node.range[1]) {
                return VisitorOption.Skip;
              }
            }
          });
          cursor = 0;
          traverse(tree, {
            leave: function(node) {
              var comment2;
              while (cursor < comments.length) {
                comment2 = comments[cursor];
                if (node.range[1] < comment2.extendedRange[0]) {
                  break;
                }
                if (node.range[1] === comment2.extendedRange[0]) {
                  if (!node.trailingComments) {
                    node.trailingComments = [];
                  }
                  node.trailingComments.push(comment2);
                  comments.splice(cursor, 1);
                } else {
                  cursor += 1;
                }
              }
              if (cursor === comments.length) {
                return VisitorOption.Break;
              }
              if (comments[cursor].extendedRange[0] > node.range[1]) {
                return VisitorOption.Skip;
              }
            }
          });
          return tree;
        }
        exports2.Syntax = Syntax4;
        exports2.traverse = traverse;
        exports2.replace = replace;
        exports2.attachComments = attachComments;
        exports2.VisitorKeys = VisitorKeys;
        exports2.VisitorOption = VisitorOption;
        exports2.Controller = Controller;
        exports2.cloneEnvironment = function() {
          return clone({});
        };
        return exports2;
      })(exports);
    }
  });

  // ../../node_modules/esrecurse/package.json
  var require_package = __commonJS({
    "../../node_modules/esrecurse/package.json"(exports, module) {
      module.exports = {
        name: "esrecurse",
        description: "ECMAScript AST recursive visitor",
        homepage: "https://github.com/estools/esrecurse",
        main: "esrecurse.js",
        version: "4.3.0",
        engines: {
          node: ">=4.0"
        },
        maintainers: [
          {
            name: "Yusuke Suzuki",
            email: "utatane.tea@gmail.com",
            web: "https://github.com/Constellation"
          }
        ],
        repository: {
          type: "git",
          url: "https://github.com/estools/esrecurse.git"
        },
        dependencies: {
          estraverse: "^5.2.0"
        },
        devDependencies: {
          "babel-cli": "^6.24.1",
          "babel-eslint": "^7.2.3",
          "babel-preset-es2015": "^6.24.1",
          "babel-register": "^6.24.1",
          chai: "^4.0.2",
          esprima: "^4.0.0",
          gulp: "^3.9.0",
          "gulp-bump": "^2.7.0",
          "gulp-eslint": "^4.0.0",
          "gulp-filter": "^5.0.0",
          "gulp-git": "^2.4.1",
          "gulp-mocha": "^4.3.1",
          "gulp-tag-version": "^1.2.1",
          jsdoc: "^3.3.0-alpha10",
          minimist: "^1.1.0"
        },
        license: "BSD-2-Clause",
        scripts: {
          test: "gulp travis",
          "unit-test": "gulp test",
          lint: "gulp lint"
        },
        babel: {
          presets: [
            "es2015"
          ]
        }
      };
    }
  });

  // ../../node_modules/esrecurse/esrecurse.js
  var require_esrecurse = __commonJS({
    "../../node_modules/esrecurse/esrecurse.js"(exports) {
      (function() {
        "use strict";
        var estraverse4 = require_estraverse2();
        function isNode(node) {
          if (node == null) {
            return false;
          }
          return typeof node === "object" && typeof node.type === "string";
        }
        function isProperty(nodeType, key) {
          return (nodeType === estraverse4.Syntax.ObjectExpression || nodeType === estraverse4.Syntax.ObjectPattern) && key === "properties";
        }
        function Visitor(visitor, options) {
          options = options || {};
          this.__visitor = visitor || this;
          this.__childVisitorKeys = options.childVisitorKeys ? Object.assign({}, estraverse4.VisitorKeys, options.childVisitorKeys) : estraverse4.VisitorKeys;
          if (options.fallback === "iteration") {
            this.__fallback = Object.keys;
          } else if (typeof options.fallback === "function") {
            this.__fallback = options.fallback;
          }
        }
        Visitor.prototype.visitChildren = function(node) {
          var type, children, i, iz, j, jz, child;
          if (node == null) {
            return;
          }
          type = node.type || estraverse4.Syntax.Property;
          children = this.__childVisitorKeys[type];
          if (!children) {
            if (this.__fallback) {
              children = this.__fallback(node);
            } else {
              throw new Error("Unknown node type " + type + ".");
            }
          }
          for (i = 0, iz = children.length; i < iz; ++i) {
            child = node[children[i]];
            if (child) {
              if (Array.isArray(child)) {
                for (j = 0, jz = child.length; j < jz; ++j) {
                  if (child[j]) {
                    if (isNode(child[j]) || isProperty(type, children[i])) {
                      this.visit(child[j]);
                    }
                  }
                }
              } else if (isNode(child)) {
                this.visit(child);
              }
            }
          }
        };
        Visitor.prototype.visit = function(node) {
          var type;
          if (node == null) {
            return;
          }
          type = node.type || estraverse4.Syntax.Property;
          if (this.__visitor[type]) {
            this.__visitor[type].call(this, node);
            return;
          }
          this.visitChildren(node);
        };
        exports.version = require_package().version;
        exports.Visitor = Visitor;
        exports.visit = function(node, visitor, options) {
          var v = new Visitor(visitor, options);
          v.visit(node);
        };
      })();
    }
  });

  // ../../node_modules/globals/globals.json
  var require_globals = __commonJS({
    "../../node_modules/globals/globals.json"(exports, module) {
      module.exports = {
        builtin: {
          AggregateError: false,
          Array: false,
          ArrayBuffer: false,
          Atomics: false,
          BigInt: false,
          BigInt64Array: false,
          BigUint64Array: false,
          Boolean: false,
          constructor: false,
          DataView: false,
          Date: false,
          decodeURI: false,
          decodeURIComponent: false,
          encodeURI: false,
          encodeURIComponent: false,
          Error: false,
          escape: false,
          eval: false,
          EvalError: false,
          FinalizationRegistry: false,
          Float32Array: false,
          Float64Array: false,
          Function: false,
          globalThis: false,
          hasOwnProperty: false,
          Infinity: false,
          Int16Array: false,
          Int32Array: false,
          Int8Array: false,
          isFinite: false,
          isNaN: false,
          isPrototypeOf: false,
          JSON: false,
          Map: false,
          Math: false,
          NaN: false,
          Number: false,
          Object: false,
          parseFloat: false,
          parseInt: false,
          Promise: false,
          propertyIsEnumerable: false,
          Proxy: false,
          RangeError: false,
          ReferenceError: false,
          Reflect: false,
          RegExp: false,
          Set: false,
          SharedArrayBuffer: false,
          String: false,
          Symbol: false,
          SyntaxError: false,
          toLocaleString: false,
          toString: false,
          TypeError: false,
          Uint16Array: false,
          Uint32Array: false,
          Uint8Array: false,
          Uint8ClampedArray: false,
          undefined: false,
          unescape: false,
          URIError: false,
          valueOf: false,
          WeakMap: false,
          WeakRef: false,
          WeakSet: false
        },
        es5: {
          Array: false,
          Boolean: false,
          constructor: false,
          Date: false,
          decodeURI: false,
          decodeURIComponent: false,
          encodeURI: false,
          encodeURIComponent: false,
          Error: false,
          escape: false,
          eval: false,
          EvalError: false,
          Function: false,
          hasOwnProperty: false,
          Infinity: false,
          isFinite: false,
          isNaN: false,
          isPrototypeOf: false,
          JSON: false,
          Math: false,
          NaN: false,
          Number: false,
          Object: false,
          parseFloat: false,
          parseInt: false,
          propertyIsEnumerable: false,
          RangeError: false,
          ReferenceError: false,
          RegExp: false,
          String: false,
          SyntaxError: false,
          toLocaleString: false,
          toString: false,
          TypeError: false,
          undefined: false,
          unescape: false,
          URIError: false,
          valueOf: false
        },
        es2015: {
          Array: false,
          ArrayBuffer: false,
          Boolean: false,
          constructor: false,
          DataView: false,
          Date: false,
          decodeURI: false,
          decodeURIComponent: false,
          encodeURI: false,
          encodeURIComponent: false,
          Error: false,
          escape: false,
          eval: false,
          EvalError: false,
          Float32Array: false,
          Float64Array: false,
          Function: false,
          hasOwnProperty: false,
          Infinity: false,
          Int16Array: false,
          Int32Array: false,
          Int8Array: false,
          isFinite: false,
          isNaN: false,
          isPrototypeOf: false,
          JSON: false,
          Map: false,
          Math: false,
          NaN: false,
          Number: false,
          Object: false,
          parseFloat: false,
          parseInt: false,
          Promise: false,
          propertyIsEnumerable: false,
          Proxy: false,
          RangeError: false,
          ReferenceError: false,
          Reflect: false,
          RegExp: false,
          Set: false,
          String: false,
          Symbol: false,
          SyntaxError: false,
          toLocaleString: false,
          toString: false,
          TypeError: false,
          Uint16Array: false,
          Uint32Array: false,
          Uint8Array: false,
          Uint8ClampedArray: false,
          undefined: false,
          unescape: false,
          URIError: false,
          valueOf: false,
          WeakMap: false,
          WeakSet: false
        },
        es2017: {
          Array: false,
          ArrayBuffer: false,
          Atomics: false,
          Boolean: false,
          constructor: false,
          DataView: false,
          Date: false,
          decodeURI: false,
          decodeURIComponent: false,
          encodeURI: false,
          encodeURIComponent: false,
          Error: false,
          escape: false,
          eval: false,
          EvalError: false,
          Float32Array: false,
          Float64Array: false,
          Function: false,
          hasOwnProperty: false,
          Infinity: false,
          Int16Array: false,
          Int32Array: false,
          Int8Array: false,
          isFinite: false,
          isNaN: false,
          isPrototypeOf: false,
          JSON: false,
          Map: false,
          Math: false,
          NaN: false,
          Number: false,
          Object: false,
          parseFloat: false,
          parseInt: false,
          Promise: false,
          propertyIsEnumerable: false,
          Proxy: false,
          RangeError: false,
          ReferenceError: false,
          Reflect: false,
          RegExp: false,
          Set: false,
          SharedArrayBuffer: false,
          String: false,
          Symbol: false,
          SyntaxError: false,
          toLocaleString: false,
          toString: false,
          TypeError: false,
          Uint16Array: false,
          Uint32Array: false,
          Uint8Array: false,
          Uint8ClampedArray: false,
          undefined: false,
          unescape: false,
          URIError: false,
          valueOf: false,
          WeakMap: false,
          WeakSet: false
        },
        es2020: {
          Array: false,
          ArrayBuffer: false,
          Atomics: false,
          BigInt: false,
          BigInt64Array: false,
          BigUint64Array: false,
          Boolean: false,
          constructor: false,
          DataView: false,
          Date: false,
          decodeURI: false,
          decodeURIComponent: false,
          encodeURI: false,
          encodeURIComponent: false,
          Error: false,
          escape: false,
          eval: false,
          EvalError: false,
          Float32Array: false,
          Float64Array: false,
          Function: false,
          globalThis: false,
          hasOwnProperty: false,
          Infinity: false,
          Int16Array: false,
          Int32Array: false,
          Int8Array: false,
          isFinite: false,
          isNaN: false,
          isPrototypeOf: false,
          JSON: false,
          Map: false,
          Math: false,
          NaN: false,
          Number: false,
          Object: false,
          parseFloat: false,
          parseInt: false,
          Promise: false,
          propertyIsEnumerable: false,
          Proxy: false,
          RangeError: false,
          ReferenceError: false,
          Reflect: false,
          RegExp: false,
          Set: false,
          SharedArrayBuffer: false,
          String: false,
          Symbol: false,
          SyntaxError: false,
          toLocaleString: false,
          toString: false,
          TypeError: false,
          Uint16Array: false,
          Uint32Array: false,
          Uint8Array: false,
          Uint8ClampedArray: false,
          undefined: false,
          unescape: false,
          URIError: false,
          valueOf: false,
          WeakMap: false,
          WeakSet: false
        },
        es2021: {
          AggregateError: false,
          Array: false,
          ArrayBuffer: false,
          Atomics: false,
          BigInt: false,
          BigInt64Array: false,
          BigUint64Array: false,
          Boolean: false,
          constructor: false,
          DataView: false,
          Date: false,
          decodeURI: false,
          decodeURIComponent: false,
          encodeURI: false,
          encodeURIComponent: false,
          Error: false,
          escape: false,
          eval: false,
          EvalError: false,
          FinalizationRegistry: false,
          Float32Array: false,
          Float64Array: false,
          Function: false,
          globalThis: false,
          hasOwnProperty: false,
          Infinity: false,
          Int16Array: false,
          Int32Array: false,
          Int8Array: false,
          isFinite: false,
          isNaN: false,
          isPrototypeOf: false,
          JSON: false,
          Map: false,
          Math: false,
          NaN: false,
          Number: false,
          Object: false,
          parseFloat: false,
          parseInt: false,
          Promise: false,
          propertyIsEnumerable: false,
          Proxy: false,
          RangeError: false,
          ReferenceError: false,
          Reflect: false,
          RegExp: false,
          Set: false,
          SharedArrayBuffer: false,
          String: false,
          Symbol: false,
          SyntaxError: false,
          toLocaleString: false,
          toString: false,
          TypeError: false,
          Uint16Array: false,
          Uint32Array: false,
          Uint8Array: false,
          Uint8ClampedArray: false,
          undefined: false,
          unescape: false,
          URIError: false,
          valueOf: false,
          WeakMap: false,
          WeakRef: false,
          WeakSet: false
        },
        browser: {
          AbortController: false,
          AbortSignal: false,
          addEventListener: false,
          alert: false,
          AnalyserNode: false,
          Animation: false,
          AnimationEffectReadOnly: false,
          AnimationEffectTiming: false,
          AnimationEffectTimingReadOnly: false,
          AnimationEvent: false,
          AnimationPlaybackEvent: false,
          AnimationTimeline: false,
          applicationCache: false,
          ApplicationCache: false,
          ApplicationCacheErrorEvent: false,
          atob: false,
          Attr: false,
          Audio: false,
          AudioBuffer: false,
          AudioBufferSourceNode: false,
          AudioContext: false,
          AudioDestinationNode: false,
          AudioListener: false,
          AudioNode: false,
          AudioParam: false,
          AudioProcessingEvent: false,
          AudioScheduledSourceNode: false,
          AudioWorkletGlobalScope: false,
          AudioWorkletNode: false,
          AudioWorkletProcessor: false,
          BarProp: false,
          BaseAudioContext: false,
          BatteryManager: false,
          BeforeUnloadEvent: false,
          BiquadFilterNode: false,
          Blob: false,
          BlobEvent: false,
          blur: false,
          BroadcastChannel: false,
          btoa: false,
          BudgetService: false,
          ByteLengthQueuingStrategy: false,
          Cache: false,
          caches: false,
          CacheStorage: false,
          cancelAnimationFrame: false,
          cancelIdleCallback: false,
          CanvasCaptureMediaStreamTrack: false,
          CanvasGradient: false,
          CanvasPattern: false,
          CanvasRenderingContext2D: false,
          ChannelMergerNode: false,
          ChannelSplitterNode: false,
          CharacterData: false,
          clearInterval: false,
          clearTimeout: false,
          clientInformation: false,
          ClipboardEvent: false,
          ClipboardItem: false,
          close: false,
          closed: false,
          CloseEvent: false,
          Comment: false,
          CompositionEvent: false,
          CompressionStream: false,
          confirm: false,
          console: false,
          ConstantSourceNode: false,
          ConvolverNode: false,
          CountQueuingStrategy: false,
          createImageBitmap: false,
          Credential: false,
          CredentialsContainer: false,
          crypto: false,
          Crypto: false,
          CryptoKey: false,
          CSS: false,
          CSSConditionRule: false,
          CSSFontFaceRule: false,
          CSSGroupingRule: false,
          CSSImportRule: false,
          CSSKeyframeRule: false,
          CSSKeyframesRule: false,
          CSSMatrixComponent: false,
          CSSMediaRule: false,
          CSSNamespaceRule: false,
          CSSPageRule: false,
          CSSPerspective: false,
          CSSRotate: false,
          CSSRule: false,
          CSSRuleList: false,
          CSSScale: false,
          CSSSkew: false,
          CSSSkewX: false,
          CSSSkewY: false,
          CSSStyleDeclaration: false,
          CSSStyleRule: false,
          CSSStyleSheet: false,
          CSSSupportsRule: false,
          CSSTransformValue: false,
          CSSTranslate: false,
          CustomElementRegistry: false,
          customElements: false,
          CustomEvent: false,
          DataTransfer: false,
          DataTransferItem: false,
          DataTransferItemList: false,
          DecompressionStream: false,
          defaultstatus: false,
          defaultStatus: false,
          DelayNode: false,
          DeviceMotionEvent: false,
          DeviceOrientationEvent: false,
          devicePixelRatio: false,
          dispatchEvent: false,
          document: false,
          Document: false,
          DocumentFragment: false,
          DocumentType: false,
          DOMError: false,
          DOMException: false,
          DOMImplementation: false,
          DOMMatrix: false,
          DOMMatrixReadOnly: false,
          DOMParser: false,
          DOMPoint: false,
          DOMPointReadOnly: false,
          DOMQuad: false,
          DOMRect: false,
          DOMRectList: false,
          DOMRectReadOnly: false,
          DOMStringList: false,
          DOMStringMap: false,
          DOMTokenList: false,
          DragEvent: false,
          DynamicsCompressorNode: false,
          Element: false,
          ErrorEvent: false,
          event: false,
          Event: false,
          EventSource: false,
          EventTarget: false,
          external: false,
          fetch: false,
          File: false,
          FileList: false,
          FileReader: false,
          find: false,
          focus: false,
          FocusEvent: false,
          FontFace: false,
          FontFaceSetLoadEvent: false,
          FormData: false,
          FormDataEvent: false,
          frameElement: false,
          frames: false,
          GainNode: false,
          Gamepad: false,
          GamepadButton: false,
          GamepadEvent: false,
          getComputedStyle: false,
          getSelection: false,
          HashChangeEvent: false,
          Headers: false,
          history: false,
          History: false,
          HTMLAllCollection: false,
          HTMLAnchorElement: false,
          HTMLAreaElement: false,
          HTMLAudioElement: false,
          HTMLBaseElement: false,
          HTMLBodyElement: false,
          HTMLBRElement: false,
          HTMLButtonElement: false,
          HTMLCanvasElement: false,
          HTMLCollection: false,
          HTMLContentElement: false,
          HTMLDataElement: false,
          HTMLDataListElement: false,
          HTMLDetailsElement: false,
          HTMLDialogElement: false,
          HTMLDirectoryElement: false,
          HTMLDivElement: false,
          HTMLDListElement: false,
          HTMLDocument: false,
          HTMLElement: false,
          HTMLEmbedElement: false,
          HTMLFieldSetElement: false,
          HTMLFontElement: false,
          HTMLFormControlsCollection: false,
          HTMLFormElement: false,
          HTMLFrameElement: false,
          HTMLFrameSetElement: false,
          HTMLHeadElement: false,
          HTMLHeadingElement: false,
          HTMLHRElement: false,
          HTMLHtmlElement: false,
          HTMLIFrameElement: false,
          HTMLImageElement: false,
          HTMLInputElement: false,
          HTMLLabelElement: false,
          HTMLLegendElement: false,
          HTMLLIElement: false,
          HTMLLinkElement: false,
          HTMLMapElement: false,
          HTMLMarqueeElement: false,
          HTMLMediaElement: false,
          HTMLMenuElement: false,
          HTMLMetaElement: false,
          HTMLMeterElement: false,
          HTMLModElement: false,
          HTMLObjectElement: false,
          HTMLOListElement: false,
          HTMLOptGroupElement: false,
          HTMLOptionElement: false,
          HTMLOptionsCollection: false,
          HTMLOutputElement: false,
          HTMLParagraphElement: false,
          HTMLParamElement: false,
          HTMLPictureElement: false,
          HTMLPreElement: false,
          HTMLProgressElement: false,
          HTMLQuoteElement: false,
          HTMLScriptElement: false,
          HTMLSelectElement: false,
          HTMLShadowElement: false,
          HTMLSlotElement: false,
          HTMLSourceElement: false,
          HTMLSpanElement: false,
          HTMLStyleElement: false,
          HTMLTableCaptionElement: false,
          HTMLTableCellElement: false,
          HTMLTableColElement: false,
          HTMLTableElement: false,
          HTMLTableRowElement: false,
          HTMLTableSectionElement: false,
          HTMLTemplateElement: false,
          HTMLTextAreaElement: false,
          HTMLTimeElement: false,
          HTMLTitleElement: false,
          HTMLTrackElement: false,
          HTMLUListElement: false,
          HTMLUnknownElement: false,
          HTMLVideoElement: false,
          IDBCursor: false,
          IDBCursorWithValue: false,
          IDBDatabase: false,
          IDBFactory: false,
          IDBIndex: false,
          IDBKeyRange: false,
          IDBObjectStore: false,
          IDBOpenDBRequest: false,
          IDBRequest: false,
          IDBTransaction: false,
          IDBVersionChangeEvent: false,
          IdleDeadline: false,
          IIRFilterNode: false,
          Image: false,
          ImageBitmap: false,
          ImageBitmapRenderingContext: false,
          ImageCapture: false,
          ImageData: false,
          indexedDB: false,
          innerHeight: false,
          innerWidth: false,
          InputEvent: false,
          IntersectionObserver: false,
          IntersectionObserverEntry: false,
          Intl: false,
          isSecureContext: false,
          KeyboardEvent: false,
          KeyframeEffect: false,
          KeyframeEffectReadOnly: false,
          length: false,
          localStorage: false,
          location: true,
          Location: false,
          locationbar: false,
          matchMedia: false,
          MediaDeviceInfo: false,
          MediaDevices: false,
          MediaElementAudioSourceNode: false,
          MediaEncryptedEvent: false,
          MediaError: false,
          MediaKeyMessageEvent: false,
          MediaKeySession: false,
          MediaKeyStatusMap: false,
          MediaKeySystemAccess: false,
          MediaList: false,
          MediaMetadata: false,
          MediaQueryList: false,
          MediaQueryListEvent: false,
          MediaRecorder: false,
          MediaSettingsRange: false,
          MediaSource: false,
          MediaStream: false,
          MediaStreamAudioDestinationNode: false,
          MediaStreamAudioSourceNode: false,
          MediaStreamConstraints: false,
          MediaStreamEvent: false,
          MediaStreamTrack: false,
          MediaStreamTrackEvent: false,
          menubar: false,
          MessageChannel: false,
          MessageEvent: false,
          MessagePort: false,
          MIDIAccess: false,
          MIDIConnectionEvent: false,
          MIDIInput: false,
          MIDIInputMap: false,
          MIDIMessageEvent: false,
          MIDIOutput: false,
          MIDIOutputMap: false,
          MIDIPort: false,
          MimeType: false,
          MimeTypeArray: false,
          MouseEvent: false,
          moveBy: false,
          moveTo: false,
          MutationEvent: false,
          MutationObserver: false,
          MutationRecord: false,
          name: false,
          NamedNodeMap: false,
          NavigationPreloadManager: false,
          navigator: false,
          Navigator: false,
          NavigatorUAData: false,
          NetworkInformation: false,
          Node: false,
          NodeFilter: false,
          NodeIterator: false,
          NodeList: false,
          Notification: false,
          OfflineAudioCompletionEvent: false,
          OfflineAudioContext: false,
          offscreenBuffering: false,
          OffscreenCanvas: true,
          OffscreenCanvasRenderingContext2D: false,
          onabort: true,
          onafterprint: true,
          onanimationend: true,
          onanimationiteration: true,
          onanimationstart: true,
          onappinstalled: true,
          onauxclick: true,
          onbeforeinstallprompt: true,
          onbeforeprint: true,
          onbeforeunload: true,
          onblur: true,
          oncancel: true,
          oncanplay: true,
          oncanplaythrough: true,
          onchange: true,
          onclick: true,
          onclose: true,
          oncontextmenu: true,
          oncuechange: true,
          ondblclick: true,
          ondevicemotion: true,
          ondeviceorientation: true,
          ondeviceorientationabsolute: true,
          ondrag: true,
          ondragend: true,
          ondragenter: true,
          ondragleave: true,
          ondragover: true,
          ondragstart: true,
          ondrop: true,
          ondurationchange: true,
          onemptied: true,
          onended: true,
          onerror: true,
          onfocus: true,
          ongotpointercapture: true,
          onhashchange: true,
          oninput: true,
          oninvalid: true,
          onkeydown: true,
          onkeypress: true,
          onkeyup: true,
          onlanguagechange: true,
          onload: true,
          onloadeddata: true,
          onloadedmetadata: true,
          onloadstart: true,
          onlostpointercapture: true,
          onmessage: true,
          onmessageerror: true,
          onmousedown: true,
          onmouseenter: true,
          onmouseleave: true,
          onmousemove: true,
          onmouseout: true,
          onmouseover: true,
          onmouseup: true,
          onmousewheel: true,
          onoffline: true,
          ononline: true,
          onpagehide: true,
          onpageshow: true,
          onpause: true,
          onplay: true,
          onplaying: true,
          onpointercancel: true,
          onpointerdown: true,
          onpointerenter: true,
          onpointerleave: true,
          onpointermove: true,
          onpointerout: true,
          onpointerover: true,
          onpointerup: true,
          onpopstate: true,
          onprogress: true,
          onratechange: true,
          onrejectionhandled: true,
          onreset: true,
          onresize: true,
          onscroll: true,
          onsearch: true,
          onseeked: true,
          onseeking: true,
          onselect: true,
          onstalled: true,
          onstorage: true,
          onsubmit: true,
          onsuspend: true,
          ontimeupdate: true,
          ontoggle: true,
          ontransitionend: true,
          onunhandledrejection: true,
          onunload: true,
          onvolumechange: true,
          onwaiting: true,
          onwheel: true,
          open: false,
          openDatabase: false,
          opener: false,
          Option: false,
          origin: false,
          OscillatorNode: false,
          outerHeight: false,
          outerWidth: false,
          OverconstrainedError: false,
          PageTransitionEvent: false,
          pageXOffset: false,
          pageYOffset: false,
          PannerNode: false,
          parent: false,
          Path2D: false,
          PaymentAddress: false,
          PaymentRequest: false,
          PaymentRequestUpdateEvent: false,
          PaymentResponse: false,
          performance: false,
          Performance: false,
          PerformanceEntry: false,
          PerformanceLongTaskTiming: false,
          PerformanceMark: false,
          PerformanceMeasure: false,
          PerformanceNavigation: false,
          PerformanceNavigationTiming: false,
          PerformanceObserver: false,
          PerformanceObserverEntryList: false,
          PerformancePaintTiming: false,
          PerformanceResourceTiming: false,
          PerformanceTiming: false,
          PeriodicWave: false,
          Permissions: false,
          PermissionStatus: false,
          personalbar: false,
          PhotoCapabilities: false,
          Plugin: false,
          PluginArray: false,
          PointerEvent: false,
          PopStateEvent: false,
          postMessage: false,
          Presentation: false,
          PresentationAvailability: false,
          PresentationConnection: false,
          PresentationConnectionAvailableEvent: false,
          PresentationConnectionCloseEvent: false,
          PresentationConnectionList: false,
          PresentationReceiver: false,
          PresentationRequest: false,
          print: false,
          ProcessingInstruction: false,
          ProgressEvent: false,
          PromiseRejectionEvent: false,
          prompt: false,
          PushManager: false,
          PushSubscription: false,
          PushSubscriptionOptions: false,
          queueMicrotask: false,
          RadioNodeList: false,
          Range: false,
          ReadableByteStreamController: false,
          ReadableStream: false,
          ReadableStreamBYOBReader: false,
          ReadableStreamBYOBRequest: false,
          ReadableStreamDefaultController: false,
          ReadableStreamDefaultReader: false,
          registerProcessor: false,
          RemotePlayback: false,
          removeEventListener: false,
          reportError: false,
          Request: false,
          requestAnimationFrame: false,
          requestIdleCallback: false,
          resizeBy: false,
          ResizeObserver: false,
          ResizeObserverEntry: false,
          resizeTo: false,
          Response: false,
          RTCCertificate: false,
          RTCDataChannel: false,
          RTCDataChannelEvent: false,
          RTCDtlsTransport: false,
          RTCIceCandidate: false,
          RTCIceGatherer: false,
          RTCIceTransport: false,
          RTCPeerConnection: false,
          RTCPeerConnectionIceEvent: false,
          RTCRtpContributingSource: false,
          RTCRtpReceiver: false,
          RTCRtpSender: false,
          RTCSctpTransport: false,
          RTCSessionDescription: false,
          RTCStatsReport: false,
          RTCTrackEvent: false,
          screen: false,
          Screen: false,
          screenLeft: false,
          ScreenOrientation: false,
          screenTop: false,
          screenX: false,
          screenY: false,
          ScriptProcessorNode: false,
          scroll: false,
          scrollbars: false,
          scrollBy: false,
          scrollTo: false,
          scrollX: false,
          scrollY: false,
          SecurityPolicyViolationEvent: false,
          Selection: false,
          self: false,
          ServiceWorker: false,
          ServiceWorkerContainer: false,
          ServiceWorkerRegistration: false,
          sessionStorage: false,
          setInterval: false,
          setTimeout: false,
          ShadowRoot: false,
          SharedWorker: false,
          SourceBuffer: false,
          SourceBufferList: false,
          speechSynthesis: false,
          SpeechSynthesisEvent: false,
          SpeechSynthesisUtterance: false,
          StaticRange: false,
          status: false,
          statusbar: false,
          StereoPannerNode: false,
          stop: false,
          Storage: false,
          StorageEvent: false,
          StorageManager: false,
          structuredClone: false,
          styleMedia: false,
          StyleSheet: false,
          StyleSheetList: false,
          SubmitEvent: false,
          SubtleCrypto: false,
          SVGAElement: false,
          SVGAngle: false,
          SVGAnimatedAngle: false,
          SVGAnimatedBoolean: false,
          SVGAnimatedEnumeration: false,
          SVGAnimatedInteger: false,
          SVGAnimatedLength: false,
          SVGAnimatedLengthList: false,
          SVGAnimatedNumber: false,
          SVGAnimatedNumberList: false,
          SVGAnimatedPreserveAspectRatio: false,
          SVGAnimatedRect: false,
          SVGAnimatedString: false,
          SVGAnimatedTransformList: false,
          SVGAnimateElement: false,
          SVGAnimateMotionElement: false,
          SVGAnimateTransformElement: false,
          SVGAnimationElement: false,
          SVGCircleElement: false,
          SVGClipPathElement: false,
          SVGComponentTransferFunctionElement: false,
          SVGDefsElement: false,
          SVGDescElement: false,
          SVGDiscardElement: false,
          SVGElement: false,
          SVGEllipseElement: false,
          SVGFEBlendElement: false,
          SVGFEColorMatrixElement: false,
          SVGFEComponentTransferElement: false,
          SVGFECompositeElement: false,
          SVGFEConvolveMatrixElement: false,
          SVGFEDiffuseLightingElement: false,
          SVGFEDisplacementMapElement: false,
          SVGFEDistantLightElement: false,
          SVGFEDropShadowElement: false,
          SVGFEFloodElement: false,
          SVGFEFuncAElement: false,
          SVGFEFuncBElement: false,
          SVGFEFuncGElement: false,
          SVGFEFuncRElement: false,
          SVGFEGaussianBlurElement: false,
          SVGFEImageElement: false,
          SVGFEMergeElement: false,
          SVGFEMergeNodeElement: false,
          SVGFEMorphologyElement: false,
          SVGFEOffsetElement: false,
          SVGFEPointLightElement: false,
          SVGFESpecularLightingElement: false,
          SVGFESpotLightElement: false,
          SVGFETileElement: false,
          SVGFETurbulenceElement: false,
          SVGFilterElement: false,
          SVGForeignObjectElement: false,
          SVGGElement: false,
          SVGGeometryElement: false,
          SVGGradientElement: false,
          SVGGraphicsElement: false,
          SVGImageElement: false,
          SVGLength: false,
          SVGLengthList: false,
          SVGLinearGradientElement: false,
          SVGLineElement: false,
          SVGMarkerElement: false,
          SVGMaskElement: false,
          SVGMatrix: false,
          SVGMetadataElement: false,
          SVGMPathElement: false,
          SVGNumber: false,
          SVGNumberList: false,
          SVGPathElement: false,
          SVGPatternElement: false,
          SVGPoint: false,
          SVGPointList: false,
          SVGPolygonElement: false,
          SVGPolylineElement: false,
          SVGPreserveAspectRatio: false,
          SVGRadialGradientElement: false,
          SVGRect: false,
          SVGRectElement: false,
          SVGScriptElement: false,
          SVGSetElement: false,
          SVGStopElement: false,
          SVGStringList: false,
          SVGStyleElement: false,
          SVGSVGElement: false,
          SVGSwitchElement: false,
          SVGSymbolElement: false,
          SVGTextContentElement: false,
          SVGTextElement: false,
          SVGTextPathElement: false,
          SVGTextPositioningElement: false,
          SVGTitleElement: false,
          SVGTransform: false,
          SVGTransformList: false,
          SVGTSpanElement: false,
          SVGUnitTypes: false,
          SVGUseElement: false,
          SVGViewElement: false,
          TaskAttributionTiming: false,
          Text: false,
          TextDecoder: false,
          TextDecoderStream: false,
          TextEncoder: false,
          TextEncoderStream: false,
          TextEvent: false,
          TextMetrics: false,
          TextTrack: false,
          TextTrackCue: false,
          TextTrackCueList: false,
          TextTrackList: false,
          TimeRanges: false,
          ToggleEvent: false,
          toolbar: false,
          top: false,
          Touch: false,
          TouchEvent: false,
          TouchList: false,
          TrackEvent: false,
          TransformStream: false,
          TransformStreamDefaultController: false,
          TransitionEvent: false,
          TreeWalker: false,
          UIEvent: false,
          URL: false,
          URLSearchParams: false,
          ValidityState: false,
          visualViewport: false,
          VisualViewport: false,
          VTTCue: false,
          WaveShaperNode: false,
          WebAssembly: false,
          WebGL2RenderingContext: false,
          WebGLActiveInfo: false,
          WebGLBuffer: false,
          WebGLContextEvent: false,
          WebGLFramebuffer: false,
          WebGLProgram: false,
          WebGLQuery: false,
          WebGLRenderbuffer: false,
          WebGLRenderingContext: false,
          WebGLSampler: false,
          WebGLShader: false,
          WebGLShaderPrecisionFormat: false,
          WebGLSync: false,
          WebGLTexture: false,
          WebGLTransformFeedback: false,
          WebGLUniformLocation: false,
          WebGLVertexArrayObject: false,
          WebSocket: false,
          WheelEvent: false,
          window: false,
          Window: false,
          Worker: false,
          WritableStream: false,
          WritableStreamDefaultController: false,
          WritableStreamDefaultWriter: false,
          XMLDocument: false,
          XMLHttpRequest: false,
          XMLHttpRequestEventTarget: false,
          XMLHttpRequestUpload: false,
          XMLSerializer: false,
          XPathEvaluator: false,
          XPathExpression: false,
          XPathResult: false,
          XRAnchor: false,
          XRBoundedReferenceSpace: false,
          XRCPUDepthInformation: false,
          XRDepthInformation: false,
          XRFrame: false,
          XRInputSource: false,
          XRInputSourceArray: false,
          XRInputSourceEvent: false,
          XRInputSourcesChangeEvent: false,
          XRPose: false,
          XRReferenceSpace: false,
          XRReferenceSpaceEvent: false,
          XRRenderState: false,
          XRRigidTransform: false,
          XRSession: false,
          XRSessionEvent: false,
          XRSpace: false,
          XRSystem: false,
          XRView: false,
          XRViewerPose: false,
          XRViewport: false,
          XRWebGLBinding: false,
          XRWebGLDepthInformation: false,
          XRWebGLLayer: false,
          XSLTProcessor: false
        },
        worker: {
          addEventListener: false,
          applicationCache: false,
          atob: false,
          Blob: false,
          BroadcastChannel: false,
          btoa: false,
          ByteLengthQueuingStrategy: false,
          Cache: false,
          caches: false,
          clearInterval: false,
          clearTimeout: false,
          close: true,
          CompressionStream: false,
          console: false,
          CountQueuingStrategy: false,
          crypto: false,
          Crypto: false,
          CryptoKey: false,
          CustomEvent: false,
          DecompressionStream: false,
          ErrorEvent: false,
          Event: false,
          fetch: false,
          File: false,
          FileReaderSync: false,
          FormData: false,
          Headers: false,
          IDBCursor: false,
          IDBCursorWithValue: false,
          IDBDatabase: false,
          IDBFactory: false,
          IDBIndex: false,
          IDBKeyRange: false,
          IDBObjectStore: false,
          IDBOpenDBRequest: false,
          IDBRequest: false,
          IDBTransaction: false,
          IDBVersionChangeEvent: false,
          ImageData: false,
          importScripts: true,
          indexedDB: false,
          location: false,
          MessageChannel: false,
          MessageEvent: false,
          MessagePort: false,
          name: false,
          navigator: false,
          Notification: false,
          onclose: true,
          onconnect: true,
          onerror: true,
          onlanguagechange: true,
          onmessage: true,
          onoffline: true,
          ononline: true,
          onrejectionhandled: true,
          onunhandledrejection: true,
          performance: false,
          Performance: false,
          PerformanceEntry: false,
          PerformanceMark: false,
          PerformanceMeasure: false,
          PerformanceNavigation: false,
          PerformanceObserver: false,
          PerformanceObserverEntryList: false,
          PerformanceResourceTiming: false,
          PerformanceTiming: false,
          postMessage: true,
          Promise: false,
          queueMicrotask: false,
          ReadableByteStreamController: false,
          ReadableStream: false,
          ReadableStreamBYOBReader: false,
          ReadableStreamBYOBRequest: false,
          ReadableStreamDefaultController: false,
          ReadableStreamDefaultReader: false,
          removeEventListener: false,
          reportError: false,
          Request: false,
          Response: false,
          self: true,
          ServiceWorkerRegistration: false,
          setInterval: false,
          setTimeout: false,
          SubtleCrypto: false,
          TextDecoder: false,
          TextDecoderStream: false,
          TextEncoder: false,
          TextEncoderStream: false,
          TransformStream: false,
          TransformStreamDefaultController: false,
          URL: false,
          URLSearchParams: false,
          WebAssembly: false,
          WebSocket: false,
          Worker: false,
          WorkerGlobalScope: false,
          WritableStream: false,
          WritableStreamDefaultController: false,
          WritableStreamDefaultWriter: false,
          XMLHttpRequest: false
        },
        node: {
          __dirname: false,
          __filename: false,
          AbortController: false,
          AbortSignal: false,
          atob: false,
          Blob: false,
          BroadcastChannel: false,
          btoa: false,
          Buffer: false,
          ByteLengthQueuingStrategy: false,
          clearImmediate: false,
          clearInterval: false,
          clearTimeout: false,
          CompressionStream: false,
          console: false,
          CountQueuingStrategy: false,
          crypto: false,
          Crypto: false,
          CryptoKey: false,
          CustomEvent: false,
          DecompressionStream: false,
          DOMException: false,
          Event: false,
          EventTarget: false,
          exports: true,
          fetch: false,
          File: false,
          FormData: false,
          global: false,
          Headers: false,
          Intl: false,
          MessageChannel: false,
          MessageEvent: false,
          MessagePort: false,
          module: false,
          performance: false,
          PerformanceEntry: false,
          PerformanceMark: false,
          PerformanceMeasure: false,
          PerformanceObserver: false,
          PerformanceObserverEntryList: false,
          PerformanceResourceTiming: false,
          process: false,
          queueMicrotask: false,
          ReadableByteStreamController: false,
          ReadableStream: false,
          ReadableStreamBYOBReader: false,
          ReadableStreamBYOBRequest: false,
          ReadableStreamDefaultController: false,
          ReadableStreamDefaultReader: false,
          Request: false,
          require: false,
          Response: false,
          setImmediate: false,
          setInterval: false,
          setTimeout: false,
          structuredClone: false,
          SubtleCrypto: false,
          TextDecoder: false,
          TextDecoderStream: false,
          TextEncoder: false,
          TextEncoderStream: false,
          TransformStream: false,
          TransformStreamDefaultController: false,
          URL: false,
          URLSearchParams: false,
          WebAssembly: false,
          WritableStream: false,
          WritableStreamDefaultController: false,
          WritableStreamDefaultWriter: false
        },
        nodeBuiltin: {
          AbortController: false,
          AbortSignal: false,
          atob: false,
          Blob: false,
          BroadcastChannel: false,
          btoa: false,
          Buffer: false,
          ByteLengthQueuingStrategy: false,
          clearImmediate: false,
          clearInterval: false,
          clearTimeout: false,
          CompressionStream: false,
          console: false,
          CountQueuingStrategy: false,
          crypto: false,
          Crypto: false,
          CryptoKey: false,
          CustomEvent: false,
          DecompressionStream: false,
          DOMException: false,
          Event: false,
          EventTarget: false,
          fetch: false,
          File: false,
          FormData: false,
          global: false,
          Headers: false,
          Intl: false,
          MessageChannel: false,
          MessageEvent: false,
          MessagePort: false,
          performance: false,
          PerformanceEntry: false,
          PerformanceMark: false,
          PerformanceMeasure: false,
          PerformanceObserver: false,
          PerformanceObserverEntryList: false,
          PerformanceResourceTiming: false,
          process: false,
          queueMicrotask: false,
          ReadableByteStreamController: false,
          ReadableStream: false,
          ReadableStreamBYOBReader: false,
          ReadableStreamBYOBRequest: false,
          ReadableStreamDefaultController: false,
          ReadableStreamDefaultReader: false,
          Request: false,
          Response: false,
          setImmediate: false,
          setInterval: false,
          setTimeout: false,
          structuredClone: false,
          SubtleCrypto: false,
          TextDecoder: false,
          TextDecoderStream: false,
          TextEncoder: false,
          TextEncoderStream: false,
          TransformStream: false,
          TransformStreamDefaultController: false,
          URL: false,
          URLSearchParams: false,
          WebAssembly: false,
          WritableStream: false,
          WritableStreamDefaultController: false,
          WritableStreamDefaultWriter: false
        },
        commonjs: {
          exports: true,
          global: false,
          module: false,
          require: false
        },
        amd: {
          define: false,
          require: false
        },
        mocha: {
          after: false,
          afterEach: false,
          before: false,
          beforeEach: false,
          context: false,
          describe: false,
          it: false,
          mocha: false,
          run: false,
          setup: false,
          specify: false,
          suite: false,
          suiteSetup: false,
          suiteTeardown: false,
          teardown: false,
          test: false,
          xcontext: false,
          xdescribe: false,
          xit: false,
          xspecify: false
        },
        jasmine: {
          afterAll: false,
          afterEach: false,
          beforeAll: false,
          beforeEach: false,
          describe: false,
          expect: false,
          expectAsync: false,
          fail: false,
          fdescribe: false,
          fit: false,
          it: false,
          jasmine: false,
          pending: false,
          runs: false,
          spyOn: false,
          spyOnAllFunctions: false,
          spyOnProperty: false,
          waits: false,
          waitsFor: false,
          xdescribe: false,
          xit: false
        },
        jest: {
          afterAll: false,
          afterEach: false,
          beforeAll: false,
          beforeEach: false,
          describe: false,
          expect: false,
          fdescribe: false,
          fit: false,
          it: false,
          jest: false,
          pit: false,
          require: false,
          test: false,
          xdescribe: false,
          xit: false,
          xtest: false
        },
        qunit: {
          asyncTest: false,
          deepEqual: false,
          equal: false,
          expect: false,
          module: false,
          notDeepEqual: false,
          notEqual: false,
          notOk: false,
          notPropEqual: false,
          notStrictEqual: false,
          ok: false,
          propEqual: false,
          QUnit: false,
          raises: false,
          start: false,
          stop: false,
          strictEqual: false,
          test: false,
          throws: false
        },
        phantomjs: {
          console: true,
          exports: true,
          phantom: true,
          require: true,
          WebPage: true
        },
        couch: {
          emit: false,
          exports: false,
          getRow: false,
          log: false,
          module: false,
          provides: false,
          require: false,
          respond: false,
          send: false,
          start: false,
          sum: false
        },
        rhino: {
          defineClass: false,
          deserialize: false,
          gc: false,
          help: false,
          importClass: false,
          importPackage: false,
          java: false,
          load: false,
          loadClass: false,
          Packages: false,
          print: false,
          quit: false,
          readFile: false,
          readUrl: false,
          runCommand: false,
          seal: false,
          serialize: false,
          spawn: false,
          sync: false,
          toint32: false,
          version: false
        },
        nashorn: {
          __DIR__: false,
          __FILE__: false,
          __LINE__: false,
          com: false,
          edu: false,
          exit: false,
          java: false,
          Java: false,
          javafx: false,
          JavaImporter: false,
          javax: false,
          JSAdapter: false,
          load: false,
          loadWithNewGlobal: false,
          org: false,
          Packages: false,
          print: false,
          quit: false
        },
        wsh: {
          ActiveXObject: false,
          CollectGarbage: false,
          Debug: false,
          Enumerator: false,
          GetObject: false,
          RuntimeObject: false,
          ScriptEngine: false,
          ScriptEngineBuildVersion: false,
          ScriptEngineMajorVersion: false,
          ScriptEngineMinorVersion: false,
          VBArray: false,
          WScript: false,
          WSH: false
        },
        jquery: {
          $: false,
          jQuery: false
        },
        yui: {
          YAHOO: false,
          YAHOO_config: false,
          YUI: false,
          YUI_config: false
        },
        shelljs: {
          cat: false,
          cd: false,
          chmod: false,
          config: false,
          cp: false,
          dirs: false,
          echo: false,
          env: false,
          error: false,
          exec: false,
          exit: false,
          find: false,
          grep: false,
          ln: false,
          ls: false,
          mkdir: false,
          mv: false,
          popd: false,
          pushd: false,
          pwd: false,
          rm: false,
          sed: false,
          set: false,
          target: false,
          tempdir: false,
          test: false,
          touch: false,
          which: false
        },
        prototypejs: {
          $: false,
          $$: false,
          $A: false,
          $break: false,
          $continue: false,
          $F: false,
          $H: false,
          $R: false,
          $w: false,
          Abstract: false,
          Ajax: false,
          Autocompleter: false,
          Builder: false,
          Class: false,
          Control: false,
          Draggable: false,
          Draggables: false,
          Droppables: false,
          Effect: false,
          Element: false,
          Enumerable: false,
          Event: false,
          Field: false,
          Form: false,
          Hash: false,
          Insertion: false,
          ObjectRange: false,
          PeriodicalExecuter: false,
          Position: false,
          Prototype: false,
          Scriptaculous: false,
          Selector: false,
          Sortable: false,
          SortableObserver: false,
          Sound: false,
          Template: false,
          Toggle: false,
          Try: false
        },
        meteor: {
          $: false,
          Accounts: false,
          AccountsClient: false,
          AccountsCommon: false,
          AccountsServer: false,
          App: false,
          Assets: false,
          Blaze: false,
          check: false,
          Cordova: false,
          DDP: false,
          DDPRateLimiter: false,
          DDPServer: false,
          Deps: false,
          EJSON: false,
          Email: false,
          HTTP: false,
          Log: false,
          Match: false,
          Meteor: false,
          Mongo: false,
          MongoInternals: false,
          Npm: false,
          Package: false,
          Plugin: false,
          process: false,
          Random: false,
          ReactiveDict: false,
          ReactiveVar: false,
          Router: false,
          ServiceConfiguration: false,
          Session: false,
          share: false,
          Spacebars: false,
          Template: false,
          Tinytest: false,
          Tracker: false,
          UI: false,
          Utils: false,
          WebApp: false,
          WebAppInternals: false
        },
        mongo: {
          _isWindows: false,
          _rand: false,
          BulkWriteResult: false,
          cat: false,
          cd: false,
          connect: false,
          db: false,
          getHostName: false,
          getMemInfo: false,
          hostname: false,
          ISODate: false,
          listFiles: false,
          load: false,
          ls: false,
          md5sumFile: false,
          mkdir: false,
          Mongo: false,
          NumberInt: false,
          NumberLong: false,
          ObjectId: false,
          PlanCache: false,
          print: false,
          printjson: false,
          pwd: false,
          quit: false,
          removeFile: false,
          rs: false,
          sh: false,
          UUID: false,
          version: false,
          WriteResult: false
        },
        applescript: {
          $: false,
          Application: false,
          Automation: false,
          console: false,
          delay: false,
          Library: false,
          ObjC: false,
          ObjectSpecifier: false,
          Path: false,
          Progress: false,
          Ref: false
        },
        serviceworker: {
          addEventListener: false,
          applicationCache: false,
          atob: false,
          Blob: false,
          BroadcastChannel: false,
          btoa: false,
          ByteLengthQueuingStrategy: false,
          Cache: false,
          caches: false,
          CacheStorage: false,
          clearInterval: false,
          clearTimeout: false,
          Client: false,
          clients: false,
          Clients: false,
          close: true,
          CompressionStream: false,
          console: false,
          CountQueuingStrategy: false,
          crypto: false,
          Crypto: false,
          CryptoKey: false,
          CustomEvent: false,
          DecompressionStream: false,
          ErrorEvent: false,
          Event: false,
          ExtendableEvent: false,
          ExtendableMessageEvent: false,
          fetch: false,
          FetchEvent: false,
          File: false,
          FileReaderSync: false,
          FormData: false,
          Headers: false,
          IDBCursor: false,
          IDBCursorWithValue: false,
          IDBDatabase: false,
          IDBFactory: false,
          IDBIndex: false,
          IDBKeyRange: false,
          IDBObjectStore: false,
          IDBOpenDBRequest: false,
          IDBRequest: false,
          IDBTransaction: false,
          IDBVersionChangeEvent: false,
          ImageData: false,
          importScripts: false,
          indexedDB: false,
          location: false,
          MessageChannel: false,
          MessageEvent: false,
          MessagePort: false,
          name: false,
          navigator: false,
          Notification: false,
          onclose: true,
          onconnect: true,
          onerror: true,
          onfetch: true,
          oninstall: true,
          onlanguagechange: true,
          onmessage: true,
          onmessageerror: true,
          onnotificationclick: true,
          onnotificationclose: true,
          onoffline: true,
          ononline: true,
          onpush: true,
          onpushsubscriptionchange: true,
          onrejectionhandled: true,
          onsync: true,
          onunhandledrejection: true,
          performance: false,
          Performance: false,
          PerformanceEntry: false,
          PerformanceMark: false,
          PerformanceMeasure: false,
          PerformanceNavigation: false,
          PerformanceObserver: false,
          PerformanceObserverEntryList: false,
          PerformanceResourceTiming: false,
          PerformanceTiming: false,
          postMessage: true,
          Promise: false,
          queueMicrotask: false,
          ReadableByteStreamController: false,
          ReadableStream: false,
          ReadableStreamBYOBReader: false,
          ReadableStreamBYOBRequest: false,
          ReadableStreamDefaultController: false,
          ReadableStreamDefaultReader: false,
          registration: false,
          removeEventListener: false,
          Request: false,
          Response: false,
          self: false,
          ServiceWorker: false,
          ServiceWorkerContainer: false,
          ServiceWorkerGlobalScope: false,
          ServiceWorkerMessageEvent: false,
          ServiceWorkerRegistration: false,
          setInterval: false,
          setTimeout: false,
          skipWaiting: false,
          SubtleCrypto: false,
          TextDecoder: false,
          TextDecoderStream: false,
          TextEncoder: false,
          TextEncoderStream: false,
          TransformStream: false,
          TransformStreamDefaultController: false,
          URL: false,
          URLSearchParams: false,
          WebAssembly: false,
          WebSocket: false,
          WindowClient: false,
          Worker: false,
          WorkerGlobalScope: false,
          WritableStream: false,
          WritableStreamDefaultController: false,
          WritableStreamDefaultWriter: false,
          XMLHttpRequest: false
        },
        atomtest: {
          advanceClock: false,
          atom: false,
          fakeClearInterval: false,
          fakeClearTimeout: false,
          fakeSetInterval: false,
          fakeSetTimeout: false,
          resetTimeouts: false,
          waitsForPromise: false
        },
        embertest: {
          andThen: false,
          click: false,
          currentPath: false,
          currentRouteName: false,
          currentURL: false,
          fillIn: false,
          find: false,
          findAll: false,
          findWithAssert: false,
          keyEvent: false,
          pauseTest: false,
          resumeTest: false,
          triggerEvent: false,
          visit: false,
          wait: false
        },
        protractor: {
          $: false,
          $$: false,
          browser: false,
          by: false,
          By: false,
          DartObject: false,
          element: false,
          protractor: false
        },
        "shared-node-browser": {
          AbortController: false,
          AbortSignal: false,
          atob: false,
          Blob: false,
          BroadcastChannel: false,
          btoa: false,
          ByteLengthQueuingStrategy: false,
          clearInterval: false,
          clearTimeout: false,
          CompressionStream: false,
          console: false,
          CountQueuingStrategy: false,
          crypto: false,
          Crypto: false,
          CryptoKey: false,
          CustomEvent: false,
          DecompressionStream: false,
          DOMException: false,
          Event: false,
          EventTarget: false,
          fetch: false,
          File: false,
          FormData: false,
          Headers: false,
          Intl: false,
          MessageChannel: false,
          MessageEvent: false,
          MessagePort: false,
          performance: false,
          PerformanceEntry: false,
          PerformanceMark: false,
          PerformanceMeasure: false,
          PerformanceObserver: false,
          PerformanceObserverEntryList: false,
          PerformanceResourceTiming: false,
          queueMicrotask: false,
          ReadableByteStreamController: false,
          ReadableStream: false,
          ReadableStreamBYOBReader: false,
          ReadableStreamBYOBRequest: false,
          ReadableStreamDefaultController: false,
          ReadableStreamDefaultReader: false,
          Request: false,
          Response: false,
          setInterval: false,
          setTimeout: false,
          structuredClone: false,
          SubtleCrypto: false,
          TextDecoder: false,
          TextDecoderStream: false,
          TextEncoder: false,
          TextEncoderStream: false,
          TransformStream: false,
          TransformStreamDefaultController: false,
          URL: false,
          URLSearchParams: false,
          WebAssembly: false,
          WritableStream: false,
          WritableStreamDefaultController: false,
          WritableStreamDefaultWriter: false
        },
        webextensions: {
          browser: false,
          chrome: false,
          opr: false
        },
        greasemonkey: {
          cloneInto: false,
          createObjectIn: false,
          exportFunction: false,
          GM: false,
          GM_addElement: false,
          GM_addStyle: false,
          GM_addValueChangeListener: false,
          GM_deleteValue: false,
          GM_download: false,
          GM_getResourceText: false,
          GM_getResourceURL: false,
          GM_getTab: false,
          GM_getTabs: false,
          GM_getValue: false,
          GM_info: false,
          GM_listValues: false,
          GM_log: false,
          GM_notification: false,
          GM_openInTab: false,
          GM_registerMenuCommand: false,
          GM_removeValueChangeListener: false,
          GM_saveTab: false,
          GM_setClipboard: false,
          GM_setValue: false,
          GM_unregisterMenuCommand: false,
          GM_xmlhttpRequest: false,
          unsafeWindow: false
        },
        devtools: {
          $: false,
          $_: false,
          $$: false,
          $0: false,
          $1: false,
          $2: false,
          $3: false,
          $4: false,
          $x: false,
          chrome: false,
          clear: false,
          copy: false,
          debug: false,
          dir: false,
          dirxml: false,
          getEventListeners: false,
          inspect: false,
          keys: false,
          monitor: false,
          monitorEvents: false,
          profile: false,
          profileEnd: false,
          queryObjects: false,
          table: false,
          undebug: false,
          unmonitor: false,
          unmonitorEvents: false,
          values: false
        }
      };
    }
  });

  // ../../node_modules/globals/index.js
  var require_globals2 = __commonJS({
    "../../node_modules/globals/index.js"(exports, module) {
      "use strict";
      module.exports = require_globals();
    }
  });

  // src/workers/javascript-worker.ts
  var javascript_worker_exports = {};
  __export(javascript_worker_exports, {
    JavaScriptWorker: () => JavaScriptWorker
  });
  var import_parser = __toESM(require_lib());

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

  // node_modules/eslint-scope/lib/assert.js
  function assert(condition, message = "Assertion failed.") {
    if (!condition) {
      throw new Error(message);
    }
  }

  // node_modules/eslint-scope/lib/scope.js
  var import_estraverse = __toESM(require_estraverse(), 1);

  // node_modules/eslint-scope/lib/reference.js
  var READ = 1;
  var WRITE = 2;
  var RW = READ | WRITE;
  var Reference = class _Reference {
    constructor(ident, scope, flag, writeExpr, maybeImplicitGlobal, partial, init) {
      this.identifier = ident;
      this.from = scope;
      this.tainted = false;
      this.resolved = null;
      this.flag = flag;
      if (this.isWrite()) {
        this.writeExpr = writeExpr;
        this.partial = partial;
        this.init = init;
      }
      this.__maybeImplicitGlobal = maybeImplicitGlobal;
    }
    /**
     * Whether the reference is static.
     * @function Reference#isStatic
     * @returns {boolean} static
     */
    isStatic() {
      return !this.tainted && !!this.resolved && this.resolved.scope.isStatic();
    }
    /**
     * Whether the reference is writeable.
     * @function Reference#isWrite
     * @returns {boolean} write
     */
    isWrite() {
      return !!(this.flag & _Reference.WRITE);
    }
    /**
     * Whether the reference is readable.
     * @function Reference#isRead
     * @returns {boolean} read
     */
    isRead() {
      return !!(this.flag & _Reference.READ);
    }
    /**
     * Whether the reference is read-only.
     * @function Reference#isReadOnly
     * @returns {boolean} read only
     */
    isReadOnly() {
      return this.flag === _Reference.READ;
    }
    /**
     * Whether the reference is write-only.
     * @function Reference#isWriteOnly
     * @returns {boolean} write only
     */
    isWriteOnly() {
      return this.flag === _Reference.WRITE;
    }
    /**
     * Whether the reference is read-write.
     * @function Reference#isReadWrite
     * @returns {boolean} read write
     */
    isReadWrite() {
      return this.flag === _Reference.RW;
    }
  };
  Reference.READ = READ;
  Reference.WRITE = WRITE;
  Reference.RW = RW;
  var reference_default = Reference;

  // node_modules/eslint-scope/lib/variable.js
  var Variable = class {
    constructor(name, scope) {
      this.name = name;
      this.identifiers = [];
      this.references = [];
      this.defs = [];
      this.tainted = false;
      this.stack = true;
      this.scope = scope;
    }
  };
  Variable.CatchClause = "CatchClause";
  Variable.Parameter = "Parameter";
  Variable.FunctionName = "FunctionName";
  Variable.ClassName = "ClassName";
  Variable.Variable = "Variable";
  Variable.ImportBinding = "ImportBinding";
  Variable.ImplicitGlobalVariable = "ImplicitGlobalVariable";
  var variable_default = Variable;

  // node_modules/eslint-scope/lib/definition.js
  var Definition = class {
    constructor(type, name, node, parent, index, kind) {
      this.type = type;
      this.name = name;
      this.node = node;
      this.parent = parent;
      this.index = index;
      this.kind = kind;
    }
  };
  var ParameterDefinition = class extends Definition {
    constructor(name, node, index, rest) {
      super(variable_default.Parameter, name, node, null, index, null);
      this.rest = rest;
    }
  };

  // node_modules/eslint-scope/lib/scope.js
  var { Syntax } = import_estraverse.default;
  function isStrictScope(scope, block, isMethodDefinition) {
    let body;
    if (scope.upper && scope.upper.isStrict) {
      return true;
    }
    if (isMethodDefinition) {
      return true;
    }
    if (scope.type === "class" || scope.type === "module") {
      return true;
    }
    if (scope.type === "block" || scope.type === "switch") {
      return false;
    }
    if (scope.type === "function") {
      if (block.type === Syntax.ArrowFunctionExpression && // @ts-ignore -- when block is ArrowFunctionExpression
      block.body.type !== Syntax.BlockStatement) {
        return false;
      }
      if (block.type === Syntax.Program) {
        body = block;
      } else {
        body = block.body;
      }
      if (!body) {
        return false;
      }
    } else if (scope.type === "global") {
      body = block;
    } else {
      return false;
    }
    for (let i = 0, iz = body.body.length; i < iz; ++i) {
      const stmt = body.body[i];
      if (typeof stmt.directive !== "string") {
        break;
      }
      if (stmt.directive === "use strict") {
        return true;
      }
    }
    return false;
  }
  function registerScope(scopeManager, scope) {
    scopeManager.scopes.push(scope);
    const scopes = scopeManager.__nodeToScope.get(scope.block);
    if (scopes) {
      scopes.push(scope);
    } else {
      scopeManager.__nodeToScope.set(scope.block, [scope]);
    }
  }
  var Scope = class {
    constructor(scopeManager, type, upperScope, block, isMethodDefinition) {
      this.type = type;
      this.set = /* @__PURE__ */ new Map();
      this.taints = /* @__PURE__ */ new Map();
      this.dynamic = this.type === "global" || this.type === "with";
      this.block = block;
      this.through = [];
      this.variables = [];
      this.references = [];
      this.variableScope = this.type === "global" || this.type === "module" || this.type === "function" || this.type === "class-field-initializer" || this.type === "class-static-block" ? this : upperScope.variableScope;
      this.functionExpressionScope = /** @type {any} */
      false;
      this.directCallToEvalScope = false;
      this.thisFound = false;
      this.__left = [];
      this.upper = upperScope;
      this.isStrict = scopeManager.isStrictModeSupported() ? isStrictScope(this, block, isMethodDefinition) : false;
      this.childScopes = [];
      if (this.upper) {
        this.upper.childScopes.push(this);
      }
      this.__declaredVariables = scopeManager.__declaredVariables;
      registerScope(scopeManager, this);
    }
    __shouldStaticallyClose(scopeManager) {
      return !this.dynamic || scopeManager.__isOptimistic() || this.type === "global";
    }
    __staticCloseRef(ref) {
      if (!this.__resolve(ref)) {
        this.__delegateToUpperScope(ref);
      }
    }
    __dynamicCloseRef(ref) {
      let current = this;
      do {
        current.through.push(ref);
        current = current.upper;
      } while (current);
    }
    __close(scopeManager) {
      let closeRef;
      if (this.__shouldStaticallyClose(scopeManager)) {
        closeRef = this.__staticCloseRef;
      } else {
        closeRef = this.__dynamicCloseRef;
      }
      for (let i = 0, iz = this.__left.length; i < iz; ++i) {
        const ref = this.__left[i];
        closeRef.call(this, ref);
      }
      this.__left = null;
      return this.upper;
    }
    // To override by function scopes.
    // References in default parameters isn't resolved to variables which are in their function body.
    // eslint-disable-next-line class-methods-use-this, no-unused-vars  -- Desired as instance method with signature
    __isValidResolution(ref, variable) {
      return true;
    }
    __resolve(ref) {
      const name = ref.identifier.name;
      if (!this.set.has(name)) {
        return false;
      }
      const variable = this.set.get(name);
      if (!this.__isValidResolution(ref, variable)) {
        return false;
      }
      variable.references.push(ref);
      variable.stack = variable.stack && ref.from.variableScope === this.variableScope;
      if (ref.tainted) {
        variable.tainted = true;
        this.taints.set(variable.name, true);
      }
      ref.resolved = variable;
      return true;
    }
    __delegateToUpperScope(ref) {
      if (this.upper) {
        this.upper.__left.push(ref);
      }
      this.through.push(ref);
    }
    __addDeclaredVariablesOfNode(variable, node) {
      if (node === null || node === void 0) {
        return;
      }
      let variables = this.__declaredVariables.get(node);
      if (variables === null || variables === void 0) {
        variables = [];
        this.__declaredVariables.set(node, variables);
      }
      if (!variables.includes(variable)) {
        variables.push(variable);
      }
    }
    __defineGeneric(name, set, variables, node, def) {
      let variable;
      variable = set.get(name);
      if (!variable) {
        variable = new variable_default(name, this);
        set.set(name, variable);
        variables.push(variable);
      }
      if (def) {
        variable.defs.push(def);
        this.__addDeclaredVariablesOfNode(variable, def.node);
        this.__addDeclaredVariablesOfNode(variable, def.parent);
      }
      if (node) {
        variable.identifiers.push(node);
      }
    }
    __define(node, def) {
      if (node && node.type === Syntax.Identifier) {
        this.__defineGeneric(
          node.name,
          this.set,
          this.variables,
          node,
          def
        );
      }
    }
    __referencing(node, assign, writeExpr, maybeImplicitGlobal, partial, init) {
      if (!node || node.type !== Syntax.Identifier && node.type !== "JSXIdentifier") {
        return;
      }
      if (node.name === "super") {
        return;
      }
      const ref = new reference_default(
        node,
        this,
        assign || reference_default.READ,
        writeExpr,
        maybeImplicitGlobal,
        !!partial,
        !!init
      );
      this.references.push(ref);
      this.__left.push(ref);
    }
    __detectEval() {
      let current = this;
      this.directCallToEvalScope = true;
      do {
        current.dynamic = true;
        current = current.upper;
      } while (current);
    }
    __detectThis() {
      this.thisFound = true;
    }
    __isClosed() {
      return this.__left === null;
    }
    /**
     * returns resolved {Reference}
     * @function Scope#resolve
     * @param {ESTree.Identifier} ident identifier to be resolved.
     * @returns {?Reference} reference
     */
    resolve(ident) {
      let ref, i, iz;
      assert(this.__isClosed(), "Scope should be closed.");
      assert(
        ident.type === Syntax.Identifier,
        "Target should be identifier."
      );
      for (i = 0, iz = this.references.length; i < iz; ++i) {
        ref = this.references[i];
        if (ref.identifier === ident) {
          return ref;
        }
      }
      return null;
    }
    /**
     * returns this scope is static
     * @function Scope#isStatic
     * @returns {boolean} static
     */
    isStatic() {
      return !this.dynamic;
    }
    /**
     * returns this scope has materialized arguments
     * @function Scope#isArgumentsMaterialized
     * @returns {any} arguments materialized
     */
    // eslint-disable-next-line class-methods-use-this -- Desired as instance method
    isArgumentsMaterialized() {
      return true;
    }
    /**
     * returns this scope has materialized `this` reference
     * @function Scope#isThisMaterialized
     * @returns {any} this materialized
     */
    // eslint-disable-next-line class-methods-use-this -- Desired as instance method
    isThisMaterialized() {
      return true;
    }
    isUsedName(name) {
      if (this.set.has(name)) {
        return true;
      }
      for (let i = 0, iz = this.through.length; i < iz; ++i) {
        if (this.through[i].identifier.name === name) {
          return true;
        }
      }
      return false;
    }
  };
  var GlobalScope = class extends Scope {
    constructor(scopeManager, block) {
      super(scopeManager, "global", null, block, false);
      this.implicit = {
        set: /* @__PURE__ */ new Map(),
        /** @type {Variable[]} */
        variables: [],
        /**
         * List of {@link Reference}s that are left to be resolved (i.e. which
         * need to be linked to the variable they refer to).
         * @member {Reference[]} Scope#implicit#left
         * @type {Reference[]}
         */
        left: []
      };
    }
    __close(scopeManager) {
      const implicit = [];
      for (let i = 0, iz = this.__left.length; i < iz; ++i) {
        const ref = this.__left[i];
        if (ref.__maybeImplicitGlobal && !this.set.has(ref.identifier.name)) {
          implicit.push(ref.__maybeImplicitGlobal);
        }
      }
      for (let i = 0, iz = implicit.length; i < iz; ++i) {
        const info = implicit[i];
        this.__defineImplicit(
          info.pattern,
          new Definition(
            variable_default.ImplicitGlobalVariable,
            info.pattern,
            info.node,
            null,
            null,
            null
          )
        );
      }
      super.__close(scopeManager);
      this.implicit.left = [...this.through];
      return null;
    }
    __defineImplicit(node, def) {
      if (node && node.type === Syntax.Identifier) {
        this.__defineGeneric(
          node.name,
          this.implicit.set,
          this.implicit.variables,
          node,
          def
        );
      }
    }
    __addVariables(names) {
      for (const name of names) {
        this.__defineGeneric(name, this.set, this.variables, null, null);
      }
      const namesSet = new Set(names);
      this.through = this.through.filter((reference) => {
        const name = reference.identifier.name;
        if (namesSet.has(name)) {
          const variable = this.set.get(name);
          reference.resolved = variable;
          variable.references.push(reference);
          return false;
        }
        return true;
      });
      this.implicit.variables = this.implicit.variables.filter((variable) => {
        const name = variable.name;
        if (namesSet.has(name)) {
          this.implicit.set.delete(name);
          return false;
        }
        return true;
      });
      this.implicit.left = this.implicit.left.filter(
        (reference) => !namesSet.has(reference.identifier.name)
      );
    }
  };
  var ModuleScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "module", upperScope, block, false);
    }
  };
  var FunctionExpressionNameScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(
        scopeManager,
        "function-expression-name",
        upperScope,
        block,
        false
      );
      this.__define(
        block.id,
        new Definition(
          variable_default.FunctionName,
          block.id,
          block,
          null,
          null,
          null
        )
      );
      this.functionExpressionScope = /** @type {const} */
      true;
    }
  };
  var CatchScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "catch", upperScope, block, false);
    }
  };
  var WithScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "with", upperScope, block, false);
    }
    __close(scopeManager) {
      if (this.__shouldStaticallyClose(scopeManager)) {
        return super.__close(scopeManager);
      }
      for (let i = 0, iz = this.__left.length; i < iz; ++i) {
        const ref = this.__left[i];
        ref.tainted = true;
        this.__delegateToUpperScope(ref);
      }
      this.__left = null;
      return this.upper;
    }
  };
  var BlockScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "block", upperScope, block, false);
    }
  };
  var SwitchScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "switch", upperScope, block, false);
    }
  };
  var FunctionScope = class extends Scope {
    constructor(scopeManager, upperScope, block, isMethodDefinition) {
      super(scopeManager, "function", upperScope, block, isMethodDefinition);
      if (this.block.type !== Syntax.ArrowFunctionExpression) {
        this.__defineArguments();
      }
    }
    isArgumentsMaterialized() {
      if (this.block.type === Syntax.ArrowFunctionExpression) {
        return false;
      }
      if (!this.isStatic()) {
        return true;
      }
      const variable = this.set.get("arguments");
      assert(variable, "Always have arguments variable.");
      return variable.tainted || variable.references.length !== 0;
    }
    isThisMaterialized() {
      if (!this.isStatic()) {
        return true;
      }
      return this.thisFound;
    }
    __defineArguments() {
      this.__defineGeneric("arguments", this.set, this.variables, null, null);
      this.taints.set("arguments", true);
    }
    // References in default parameters isn't resolved to variables which are in their function body.
    //     const x = 1
    //     function f(a = x) { // This `x` is resolved to the `x` in the outer scope.
    //         const x = 2
    //         console.log(a)
    //     }
    __isValidResolution(ref, variable) {
      if (this.block.type === "Program") {
        return true;
      }
      const bodyStart = this.block.body.range[0];
      return !(variable.scope === this && ref.identifier.range[0] < bodyStart && // the reference is in the parameter part.
      variable.defs.every((d) => d.name.range[0] >= bodyStart));
    }
  };
  var ForScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "for", upperScope, block, false);
    }
  };
  var ClassScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "class", upperScope, block, false);
    }
  };
  var ClassFieldInitializerScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "class-field-initializer", upperScope, block, true);
    }
  };
  var ClassStaticBlockScope = class extends Scope {
    constructor(scopeManager, upperScope, block) {
      super(scopeManager, "class-static-block", upperScope, block, true);
    }
  };

  // node_modules/eslint-scope/lib/scope-manager.js
  var ScopeManager = class {
    constructor(options) {
      this.scopes = [];
      this.globalScope = null;
      this.__nodeToScope = /* @__PURE__ */ new WeakMap();
      this.__currentScope = null;
      this.__options = options;
      this.__declaredVariables = /* @__PURE__ */ new WeakMap();
    }
    __isOptimistic() {
      return this.__options.optimistic;
    }
    __ignoreEval() {
      return this.__options.ignoreEval;
    }
    __isJSXEnabled() {
      return this.__options.jsx === true;
    }
    isGlobalReturn() {
      return this.__options.nodejsScope || this.__options.sourceType === "commonjs";
    }
    isModule() {
      return this.__options.sourceType === "module";
    }
    isImpliedStrict() {
      return !!this.__options.impliedStrict;
    }
    isStrictModeSupported() {
      return this.__options.ecmaVersion >= 5;
    }
    // Returns appropriate scope for this node.
    __get(node) {
      return this.__nodeToScope.get(node);
    }
    /**
     * Get variables that are declared by the node.
     *
     * "are declared by the node" means the node is same as `Variable.defs[].node` or `Variable.defs[].parent`.
     * If the node declares nothing, this method returns an empty array.
     * CAUTION: This API is experimental. See https://github.com/estools/escope/pull/69 for more details.
     * @param {ESTree.Node} node a node to get.
     * @returns {Variable[]} variables that declared by the node.
     */
    getDeclaredVariables(node) {
      return this.__declaredVariables.get(node) || [];
    }
    /**
     * acquire scope from node.
     * @function ScopeManager#acquire
     * @param {ESTree.Node} node node for the acquired scope.
     * @param {?boolean} [inner=false] look up the most inner scope, default value is false.
     * @returns {Scope?} Scope from node
     */
    acquire(node, inner) {
      function predicate(testScope) {
        if (testScope.type === "function" && testScope.functionExpressionScope) {
          return false;
        }
        return true;
      }
      const scopes = this.__get(node);
      if (!scopes || scopes.length === 0) {
        return null;
      }
      if (scopes.length === 1) {
        return scopes[0];
      }
      if (inner) {
        for (let i = scopes.length - 1; i >= 0; --i) {
          const scope = scopes[i];
          if (predicate(scope)) {
            return scope;
          }
        }
      } else {
        for (let i = 0, iz = scopes.length; i < iz; ++i) {
          const scope = scopes[i];
          if (predicate(scope)) {
            return scope;
          }
        }
      }
      return null;
    }
    /**
     * acquire all scopes from node.
     * @function ScopeManager#acquireAll
     * @param {ESTree.Node} node node for the acquired scope.
     * @returns {Scope[]?} Scope array
     */
    acquireAll(node) {
      return this.__get(node);
    }
    /**
     * release the node.
     * @function ScopeManager#release
     * @param {ESTree.Node} node releasing node.
     * @param {?boolean} [inner=false] look up the most inner scope, default value is false.
     * @returns {Scope?} upper scope for the node.
     */
    release(node, inner) {
      const scopes = this.__get(node);
      if (scopes && scopes.length) {
        const scope = scopes[0].upper;
        if (!scope) {
          return null;
        }
        return this.acquire(scope.block, inner);
      }
      return null;
    }
    /**
     * Add global variables and resolve their references.
     * @function ScopeManager#addGlobals
     * @param {string[]} names Names of global variables to add.
     * @returns {void}
     */
    addGlobals(names) {
      this.globalScope.__addVariables(names);
    }
    attach() {
    }
    // eslint-disable-line class-methods-use-this -- Desired as instance method
    detach() {
    }
    // eslint-disable-line class-methods-use-this -- Desired as instance method
    __nestScope(scope) {
      if (scope instanceof GlobalScope) {
        assert(this.__currentScope === null);
        this.globalScope = scope;
      }
      this.__currentScope = scope;
      return scope;
    }
    __nestGlobalScope(node) {
      return this.__nestScope(new GlobalScope(this, node));
    }
    __nestBlockScope(node) {
      return this.__nestScope(
        new BlockScope(this, this.__currentScope, node)
      );
    }
    __nestFunctionScope(node, isMethodDefinition) {
      return this.__nestScope(
        new FunctionScope(
          this,
          this.__currentScope,
          node,
          isMethodDefinition
        )
      );
    }
    __nestForScope(node) {
      return this.__nestScope(new ForScope(this, this.__currentScope, node));
    }
    __nestCatchScope(node) {
      return this.__nestScope(
        new CatchScope(this, this.__currentScope, node)
      );
    }
    __nestWithScope(node) {
      return this.__nestScope(new WithScope(this, this.__currentScope, node));
    }
    __nestClassScope(node) {
      return this.__nestScope(
        new ClassScope(this, this.__currentScope, node)
      );
    }
    __nestClassFieldInitializerScope(node) {
      return this.__nestScope(
        new ClassFieldInitializerScope(this, this.__currentScope, node)
      );
    }
    __nestClassStaticBlockScope(node) {
      return this.__nestScope(
        new ClassStaticBlockScope(this, this.__currentScope, node)
      );
    }
    __nestSwitchScope(node) {
      return this.__nestScope(
        new SwitchScope(this, this.__currentScope, node)
      );
    }
    __nestModuleScope(node) {
      return this.__nestScope(
        new ModuleScope(this, this.__currentScope, node)
      );
    }
    __nestFunctionExpressionNameScope(node) {
      return this.__nestScope(
        new FunctionExpressionNameScope(this, this.__currentScope, node)
      );
    }
    __isES6() {
      return this.__options.ecmaVersion >= 6;
    }
  };
  var scope_manager_default = ScopeManager;

  // node_modules/eslint-scope/lib/referencer.js
  var import_estraverse3 = __toESM(require_estraverse(), 1);
  var import_esrecurse2 = __toESM(require_esrecurse(), 1);

  // node_modules/eslint-scope/lib/pattern-visitor.js
  var import_estraverse2 = __toESM(require_estraverse(), 1);
  var import_esrecurse = __toESM(require_esrecurse(), 1);
  var { Syntax: Syntax2 } = import_estraverse2.default;
  function getLast(xs) {
    return xs.at(-1) || null;
  }
  var PatternVisitor = class extends import_esrecurse.default.Visitor {
    static isPattern(node) {
      const nodeType = node.type;
      return nodeType === Syntax2.Identifier || nodeType === Syntax2.ObjectPattern || nodeType === Syntax2.ArrayPattern || nodeType === Syntax2.SpreadElement || nodeType === Syntax2.RestElement || nodeType === Syntax2.AssignmentPattern;
    }
    constructor(options, rootPattern, callback) {
      super(null, options);
      this.rootPattern = rootPattern;
      this.callback = callback;
      this.assignments = [];
      this.rightHandNodes = [];
      this.restElements = [];
    }
    Identifier(pattern) {
      const lastRestElement = getLast(this.restElements);
      this.callback(pattern, {
        topLevel: pattern === this.rootPattern,
        rest: lastRestElement !== null && lastRestElement !== void 0 && lastRestElement.argument === pattern,
        assignments: this.assignments
      });
    }
    Property(property) {
      if (property.computed) {
        this.rightHandNodes.push(property.key);
      }
      this.visit(property.value);
    }
    ArrayPattern(pattern) {
      for (let i = 0, iz = pattern.elements.length; i < iz; ++i) {
        const element = pattern.elements[i];
        this.visit(element);
      }
    }
    AssignmentPattern(pattern) {
      this.assignments.push(pattern);
      this.visit(pattern.left);
      this.rightHandNodes.push(pattern.right);
      this.assignments.pop();
    }
    RestElement(pattern) {
      this.restElements.push(pattern);
      this.visit(pattern.argument);
      this.restElements.pop();
    }
    MemberExpression(node) {
      if (node.computed) {
        this.rightHandNodes.push(node.property);
      }
      this.rightHandNodes.push(node.object);
    }
    //
    // ForInStatement.left and AssignmentExpression.left are LeftHandSideExpression.
    // By spec, LeftHandSideExpression is Pattern or MemberExpression.
    //   (see also: https://github.com/estree/estree/pull/20#issuecomment-74584758)
    // But espree 2.0 parses to ArrayExpression, ObjectExpression, etc...
    //
    SpreadElement(node) {
      this.visit(node.argument);
    }
    ArrayExpression(node) {
      node.elements.forEach(this.visit, this);
    }
    AssignmentExpression(node) {
      this.assignments.push(node);
      this.visit(node.left);
      this.rightHandNodes.push(node.right);
      this.assignments.pop();
    }
    CallExpression(node) {
      node.arguments.forEach((a) => {
        this.rightHandNodes.push(a);
      });
      this.visit(node.callee);
    }
  };
  var pattern_visitor_default = PatternVisitor;

  // node_modules/eslint-scope/lib/referencer.js
  var { Syntax: Syntax3 } = import_estraverse3.default;
  function traverseIdentifierInPattern(options, rootPattern, referencer, callback) {
    const visitor = new pattern_visitor_default(options, rootPattern, callback);
    visitor.visit(rootPattern);
    if (referencer !== null && referencer !== void 0) {
      visitor.rightHandNodes.forEach(referencer.visit, referencer);
    }
  }
  var Importer = class extends import_esrecurse2.default.Visitor {
    constructor(declaration, referencer) {
      super(null, referencer.options);
      this.declaration = declaration;
      this.referencer = referencer;
    }
    visitImport(id, specifier) {
      this.referencer.visitPattern(id, (pattern) => {
        this.referencer.currentScope().__define(
          pattern,
          new Definition(
            variable_default.ImportBinding,
            pattern,
            specifier,
            this.declaration,
            null,
            null
          )
        );
      });
    }
    ImportNamespaceSpecifier(node) {
      const local = node.local || node.id;
      if (local) {
        this.visitImport(local, node);
      }
    }
    ImportDefaultSpecifier(node) {
      const local = node.local || node.id;
      this.visitImport(local, node);
    }
    ImportSpecifier(node) {
      const local = node.local || node.id;
      if (node.name) {
        this.visitImport(node.name, node);
      } else {
        this.visitImport(local, node);
      }
    }
  };
  var Referencer = class extends import_esrecurse2.default.Visitor {
    constructor(options, scopeManager) {
      super(null, options);
      this.options = options;
      this.scopeManager = scopeManager;
      this.parent = null;
      this.isInnerMethodDefinition = false;
    }
    currentScope() {
      return this.scopeManager.__currentScope;
    }
    close(node) {
      while (this.currentScope() && node === this.currentScope().block) {
        this.scopeManager.__currentScope = this.currentScope().__close(
          this.scopeManager
        );
      }
    }
    pushInnerMethodDefinition(isInnerMethodDefinition) {
      const previous = this.isInnerMethodDefinition;
      this.isInnerMethodDefinition = isInnerMethodDefinition;
      return previous;
    }
    popInnerMethodDefinition(isInnerMethodDefinition) {
      this.isInnerMethodDefinition = isInnerMethodDefinition;
    }
    referencingDefaultValue(pattern, assignments, maybeImplicitGlobal, init) {
      const scope = this.currentScope();
      assignments.forEach((assignment) => {
        scope.__referencing(
          pattern,
          reference_default.WRITE,
          assignment.right,
          maybeImplicitGlobal,
          pattern !== assignment.left,
          init
        );
      });
    }
    visitPattern(node, options, callback) {
      let visitPatternOptions = options;
      let visitPatternCallback = callback;
      if (typeof options === "function") {
        visitPatternCallback = options;
        visitPatternOptions = { processRightHandNodes: false };
      }
      traverseIdentifierInPattern(
        this.options,
        node,
        visitPatternOptions.processRightHandNodes ? this : null,
        visitPatternCallback
      );
    }
    visitFunction(node) {
      let i, iz;
      if (node.type === Syntax3.FunctionDeclaration) {
        this.currentScope().__define(
          node.id,
          new Definition(
            variable_default.FunctionName,
            node.id,
            node,
            null,
            null,
            null
          )
        );
      }
      if (node.type === Syntax3.FunctionExpression && node.id) {
        this.scopeManager.__nestFunctionExpressionNameScope(node);
      }
      this.scopeManager.__nestFunctionScope(
        node,
        this.isInnerMethodDefinition
      );
      const that = this;
      function visitPatternCallback(pattern, info) {
        that.currentScope().__define(
          pattern,
          new ParameterDefinition(pattern, node, i, info.rest)
        );
        that.referencingDefaultValue(pattern, info.assignments, null, true);
      }
      for (i = 0, iz = node.params.length; i < iz; ++i) {
        this.visitPattern(
          node.params[i],
          { processRightHandNodes: true },
          visitPatternCallback
        );
      }
      if (node.rest) {
        this.visitPattern(
          {
            type: "RestElement",
            argument: node.rest
          },
          (pattern) => {
            this.currentScope().__define(
              pattern,
              new ParameterDefinition(
                pattern,
                node,
                node.params.length,
                true
              )
            );
          }
        );
      }
      if (node.body) {
        if (node.body.type === Syntax3.BlockStatement) {
          this.visitChildren(node.body);
        } else {
          this.visit(node.body);
        }
      }
      this.close(node);
    }
    visitClass(node) {
      if (node.type === Syntax3.ClassDeclaration) {
        this.currentScope().__define(
          node.id,
          new Definition(
            variable_default.ClassName,
            node.id,
            node,
            null,
            null,
            null
          )
        );
      }
      this.scopeManager.__nestClassScope(node);
      if (node.id) {
        this.currentScope().__define(
          node.id,
          new Definition(variable_default.ClassName, node.id, node)
        );
      }
      this.visit(node.superClass);
      this.visit(node.body);
      this.close(node);
    }
    visitProperty(node) {
      let previous;
      if (node.computed) {
        this.visit(node.key);
      }
      const isMethodDefinition = node.type === Syntax3.MethodDefinition;
      if (isMethodDefinition) {
        previous = this.pushInnerMethodDefinition(true);
      }
      this.visit(node.value);
      if (isMethodDefinition) {
        this.popInnerMethodDefinition(previous);
      }
    }
    visitForIn(node) {
      if (node.left.type === Syntax3.VariableDeclaration && node.left.kind !== "var") {
        this.scopeManager.__nestForScope(node);
      }
      if (node.left.type === Syntax3.VariableDeclaration) {
        this.visit(node.left);
        this.visitPattern(node.left.declarations[0].id, (pattern) => {
          this.currentScope().__referencing(
            pattern,
            reference_default.WRITE,
            node.right,
            null,
            true,
            true
          );
        });
      } else {
        this.visitPattern(
          node.left,
          { processRightHandNodes: true },
          (pattern, info) => {
            let maybeImplicitGlobal = null;
            if (!this.currentScope().isStrict) {
              maybeImplicitGlobal = {
                pattern,
                node
              };
            }
            this.referencingDefaultValue(
              pattern,
              info.assignments,
              maybeImplicitGlobal,
              false
            );
            this.currentScope().__referencing(
              pattern,
              reference_default.WRITE,
              node.right,
              maybeImplicitGlobal,
              true,
              false
            );
          }
        );
      }
      this.visit(node.right);
      this.visit(node.body);
      this.close(node);
    }
    visitVariableDeclaration(variableTargetScope, type, node, index) {
      const decl = node.declarations[index];
      const init = decl.init;
      this.visitPattern(
        decl.id,
        { processRightHandNodes: true },
        (pattern, info) => {
          variableTargetScope.__define(
            pattern,
            new Definition(type, pattern, decl, node, index, node.kind)
          );
          this.referencingDefaultValue(
            pattern,
            info.assignments,
            null,
            true
          );
          if (init) {
            this.currentScope().__referencing(
              pattern,
              reference_default.WRITE,
              init,
              null,
              !info.topLevel,
              true
            );
          }
        }
      );
    }
    AssignmentExpression(node) {
      if (pattern_visitor_default.isPattern(node.left)) {
        if (node.operator === "=") {
          this.visitPattern(
            node.left,
            { processRightHandNodes: true },
            (pattern, info) => {
              let maybeImplicitGlobal = null;
              if (!this.currentScope().isStrict) {
                maybeImplicitGlobal = {
                  pattern,
                  node
                };
              }
              this.referencingDefaultValue(
                pattern,
                info.assignments,
                maybeImplicitGlobal,
                false
              );
              this.currentScope().__referencing(
                pattern,
                reference_default.WRITE,
                node.right,
                maybeImplicitGlobal,
                !info.topLevel,
                false
              );
            }
          );
        } else {
          this.currentScope().__referencing(
            node.left,
            reference_default.RW,
            node.right
          );
        }
      } else {
        this.visit(node.left);
      }
      this.visit(node.right);
    }
    CatchClause(node) {
      this.scopeManager.__nestCatchScope(node);
      this.visitPattern(
        node.param,
        { processRightHandNodes: true },
        (pattern, info) => {
          this.currentScope().__define(
            pattern,
            new Definition(
              variable_default.CatchClause,
              pattern,
              node,
              null,
              null,
              null
            )
          );
          this.referencingDefaultValue(
            pattern,
            info.assignments,
            null,
            true
          );
        }
      );
      this.visit(node.body);
      this.close(node);
    }
    Program(node) {
      this.scopeManager.__nestGlobalScope(node);
      if (this.scopeManager.isGlobalReturn()) {
        this.currentScope().isStrict = false;
        this.scopeManager.__nestFunctionScope(node, false);
      }
      if (this.scopeManager.__isES6() && this.scopeManager.isModule()) {
        this.scopeManager.__nestModuleScope(node);
      }
      if (this.scopeManager.isStrictModeSupported() && this.scopeManager.isImpliedStrict()) {
        this.currentScope().isStrict = true;
      }
      this.visitChildren(node);
      this.close(node);
    }
    Identifier(node) {
      this.currentScope().__referencing(node);
    }
    // eslint-disable-next-line class-methods-use-this -- Desired as instance method
    PrivateIdentifier() {
    }
    UpdateExpression(node) {
      if (pattern_visitor_default.isPattern(node.argument)) {
        this.currentScope().__referencing(
          node.argument,
          reference_default.RW,
          null
        );
      } else {
        this.visitChildren(node);
      }
    }
    MemberExpression(node) {
      this.visit(node.object);
      if (node.computed) {
        this.visit(node.property);
      }
    }
    Property(node) {
      this.visitProperty(node);
    }
    PropertyDefinition(node) {
      const { computed, key, value } = node;
      if (computed) {
        this.visit(key);
      }
      if (value) {
        this.scopeManager.__nestClassFieldInitializerScope(value);
        this.visit(value);
        this.close(value);
      }
    }
    StaticBlock(node) {
      this.scopeManager.__nestClassStaticBlockScope(node);
      this.visitChildren(node);
      this.close(node);
    }
    MethodDefinition(node) {
      this.visitProperty(node);
    }
    BreakStatement() {
    }
    // eslint-disable-line class-methods-use-this -- Desired as instance method
    ContinueStatement() {
    }
    // eslint-disable-line class-methods-use-this -- Desired as instance method
    LabeledStatement(node) {
      this.visit(node.body);
    }
    ForStatement(node) {
      if (node.init && node.init.type === Syntax3.VariableDeclaration && node.init.kind !== "var") {
        this.scopeManager.__nestForScope(node);
      }
      this.visitChildren(node);
      this.close(node);
    }
    ClassExpression(node) {
      this.visitClass(node);
    }
    ClassDeclaration(node) {
      this.visitClass(node);
    }
    CallExpression(node) {
      if (!this.scopeManager.__ignoreEval() && node.callee.type === Syntax3.Identifier && node.callee.name === "eval") {
        this.currentScope().variableScope.__detectEval();
      }
      this.visitChildren(node);
    }
    BlockStatement(node) {
      if (this.scopeManager.__isES6()) {
        this.scopeManager.__nestBlockScope(node);
      }
      this.visitChildren(node);
      this.close(node);
    }
    ThisExpression() {
      this.currentScope().variableScope.__detectThis();
    }
    WithStatement(node) {
      this.visit(node.object);
      this.scopeManager.__nestWithScope(node);
      this.visit(node.body);
      this.close(node);
    }
    VariableDeclaration(node) {
      const variableTargetScope = node.kind === "var" ? this.currentScope().variableScope : this.currentScope();
      for (let i = 0, iz = node.declarations.length; i < iz; ++i) {
        const decl = node.declarations[i];
        this.visitVariableDeclaration(
          variableTargetScope,
          variable_default.Variable,
          node,
          i
        );
        if (decl.init) {
          this.visit(decl.init);
        }
      }
    }
    // sec 13.11.8
    SwitchStatement(node) {
      this.visit(node.discriminant);
      if (this.scopeManager.__isES6()) {
        this.scopeManager.__nestSwitchScope(node);
      }
      for (let i = 0, iz = node.cases.length; i < iz; ++i) {
        this.visit(node.cases[i]);
      }
      this.close(node);
    }
    FunctionDeclaration(node) {
      this.visitFunction(node);
    }
    FunctionExpression(node) {
      this.visitFunction(node);
    }
    ForOfStatement(node) {
      this.visitForIn(node);
    }
    ForInStatement(node) {
      this.visitForIn(node);
    }
    ArrowFunctionExpression(node) {
      this.visitFunction(node);
    }
    ImportDeclaration(node) {
      assert(
        this.scopeManager.__isES6() && this.scopeManager.isModule(),
        "ImportDeclaration should appear when the mode is ES6 and in the module context."
      );
      const importer = new Importer(node, this);
      importer.visit(node);
    }
    visitExportDeclaration(node) {
      if (node.source) {
        return;
      }
      if (node.declaration) {
        this.visit(node.declaration);
        return;
      }
      this.visitChildren(node);
    }
    // TODO: ExportDeclaration doesn't exist. for bc?
    ExportDeclaration(node) {
      this.visitExportDeclaration(node);
    }
    ExportAllDeclaration(node) {
      this.visitExportDeclaration(node);
    }
    ExportDefaultDeclaration(node) {
      this.visitExportDeclaration(node);
    }
    ExportNamedDeclaration(node) {
      this.visitExportDeclaration(node);
    }
    ExportSpecifier(node) {
      const local = node.id || node.local;
      this.visit(local);
    }
    // eslint-disable-next-line class-methods-use-this -- Desired as instance method
    MetaProperty() {
    }
    JSXIdentifier(node) {
      if (this.scopeManager.__isJSXEnabled() && node.name !== "this") {
        this.currentScope().__referencing(node);
      }
    }
    JSXMemberExpression(node) {
      this.visit(node.object);
    }
    JSXElement(node) {
      if (this.scopeManager.__isJSXEnabled()) {
        this.visit(node.openingElement);
        node.children.forEach(this.visit, this);
      } else {
        this.visitChildren(node);
      }
    }
    JSXOpeningElement(node) {
      if (this.scopeManager.__isJSXEnabled()) {
        const nameNode = node.name;
        const isComponentName = nameNode.type === "JSXIdentifier" && nameNode.name[0].toUpperCase() === nameNode.name[0];
        const isComponent = isComponentName || nameNode.type === "JSXMemberExpression";
        if (isComponent) {
          this.visit(nameNode);
        }
      }
      node.attributes.forEach(this.visit, this);
    }
    JSXAttribute(node) {
      if (node.value) {
        this.visit(node.value);
      }
    }
    JSXExpressionContainer(node) {
      this.visit(node.expression);
    }
    JSXNamespacedName(node) {
      this.visit(node.namespace);
      this.visit(node.name);
    }
  };
  var referencer_default = Referencer;

  // node_modules/eslint-scope/lib/index.js
  function defaultOptions() {
    return {
      optimistic: false,
      nodejsScope: false,
      impliedStrict: false,
      sourceType: "script",
      // one of ['script', 'module', 'commonjs']
      ecmaVersion: 5,
      childVisitorKeys: null,
      fallback: "iteration"
    };
  }
  function updateDeeply(target, override) {
    function isHashObject(value) {
      return typeof value === "object" && value instanceof Object && !(value instanceof Array) && !(value instanceof RegExp);
    }
    for (const key in override) {
      if (Object.hasOwn(override, key)) {
        const val = override[key];
        if (isHashObject(val)) {
          if (isHashObject(target[key])) {
            updateDeeply(target[key], val);
          } else {
            target[key] = updateDeeply({}, val);
          }
        } else {
          target[key] = val;
        }
      }
    }
    return target;
  }
  function analyze(tree, providedOptions) {
    const options = updateDeeply(defaultOptions(), providedOptions);
    const scopeManager = new scope_manager_default(options);
    const referencer = new referencer_default(options, scopeManager);
    referencer.visit(tree);
    assert(
      scopeManager.__currentScope === null,
      "currentScope should be null."
    );
    return scopeManager;
  }

  // src/workers/eslint-rules/ast-utils.js
  var anyFunctionPattern = /^(?:Function(?:Declaration|Expression)|ArrowFunctionExpression)$/u;
  var anyLoopPattern = /^(?:DoWhile|For|ForIn|ForOf|While)Statement$/u;
  var LOGICAL_ASSIGNMENT_OPERATORS = /* @__PURE__ */ new Set(["&&=", "||=", "??="]);
  function isFunction(node) {
    return Boolean(node && anyFunctionPattern.test(node.type));
  }
  function isInLoop(node) {
    for (let currentNode = node; currentNode && !isFunction(currentNode); currentNode = currentNode.parent) {
      if (isLoop(currentNode)) {
        return true;
      }
    }
    return false;
  }
  function isLoop(node) {
    return Boolean(node && anyLoopPattern.test(node.type));
  }
  function getUpperFunction(node) {
    for (let currentNode = node; currentNode; currentNode = currentNode.parent) {
      if (anyFunctionPattern.test(currentNode.type)) {
        return currentNode;
      }
    }
    return null;
  }
  function isLogicalAssignmentOperator(operator) {
    return LOGICAL_ASSIGNMENT_OPERATORS.has(operator);
  }
  function interpolate(text, data) {
    if (!data) {
      return text;
    }
    return text.replace(/\{\{([^{}]+)\}\}/g, (_, name) => {
      name = name.trim();
      return name in data ? String(data[name]) : `{{${name}}}`;
    });
  }

  // src/workers/eslint-rules/no-unused-vars.js
  var STATEMENT_TYPE = /(?:Statement|Declaration)$/u;
  function collectUnusedVariables(scope, unusedVars, scopeManager) {
    const variables = scope.variables;
    const childScopes = scope.childScopes;
    let i, l;
    for (i = 0, l = variables.length; i < l; ++i) {
      const variable = variables[i];
      if (scope.type === "class" && scope.block.id === variable.identifiers[0]) {
        continue;
      }
      if (scope.functionExpressionScope) {
        continue;
      }
      if (scope.type === "function" && variable.name === "arguments" && variable.identifiers.length === 0) {
        continue;
      }
      const def = variable.defs[0];
      if (def) {
        const type = def.type;
        if (type === "Parameter") {
          if ((def.node.parent.type === "Property" || def.node.parent.type === "MethodDefinition") && def.node.parent.kind === "set") {
            continue;
          }
          if (isFunction(def.name.parent) && !isAfterLastUsedArg(variable, scopeManager)) {
            continue;
          }
        }
      }
      if (!isUsedVariable(variable) && !isExported(variable) && !hasRestSpreadSibling(variable)) {
        unusedVars.push(variable);
      }
    }
    for (i = 0, l = childScopes.length; i < l; ++i) {
      collectUnusedVariables(childScopes[i], unusedVars, scopeManager);
    }
    return unusedVars;
  }
  function isAfterLastUsedArg(variable, scopeManager) {
    const def = variable.defs[0];
    const params = scopeManager.getDeclaredVariables(def.node);
    const posteriorParams = params.slice(params.indexOf(variable) + 1);
    return !posteriorParams.some(
      (v) => v.references.length > 0
      /*|| v.eslintUsed*/
    );
  }
  function isUsedVariable(variable) {
    const functionNodes = getFunctionDefinitions(variable);
    const isFunctionDefinition = functionNodes.length > 0;
    let rhsNode = null;
    return variable.references.some((ref) => {
      if (isForInOfRef(ref)) {
        return true;
      }
      const forItself = isReadForItself(ref, rhsNode);
      rhsNode = getRhsNode(ref, rhsNode);
      return isReadRef(ref) && !forItself && !(isFunctionDefinition && isSelfReference(ref, functionNodes));
    });
  }
  function getFunctionDefinitions(variable) {
    const functionDefinitions = [];
    variable.defs.forEach((def) => {
      const {
        type,
        node
      } = def;
      if (type === "FunctionName") {
        functionDefinitions.push(node);
      }
      if (type === "Variable" && node.init && (node.init.type === "FunctionExpression" || node.init.type === "ArrowFunctionExpression")) {
        functionDefinitions.push(node.init);
      }
    });
    return functionDefinitions;
  }
  function isForInOfRef(ref) {
    let target = ref.identifier.parent;
    if (target.type === "VariableDeclarator") {
      target = target.parent.parent;
    }
    if (target.type !== "ForInStatement" && target.type !== "ForOfStatement") {
      return false;
    }
    if (target.body.type === "BlockStatement") {
      target = target.body.body[0];
    } else {
      target = target.body;
    }
    if (!target) {
      return false;
    }
    return target.type === "ReturnStatement";
  }
  function isReadForItself(ref, rhsNode) {
    const id = ref.identifier;
    const parent = id.parent;
    return ref.isRead() && // self update. e.g. `a += 1`, `a++`
    (parent.type === "AssignmentExpression" && parent.left === id && isUnusedExpression(parent) && !isLogicalAssignmentOperator(parent.operator) || parent.type === "UpdateExpression" && isUnusedExpression(parent) || // in RHS of an assignment for itself. e.g. `a = a + 1`
    rhsNode && isInside(id, rhsNode) && !isInsideOfStorableFunction(id, rhsNode));
  }
  function getRhsNode(ref, prevRhsNode) {
    const id = ref.identifier;
    const parent = id.parent;
    const refScope = ref.from.variableScope;
    const varScope = ref.resolved.scope.variableScope;
    const canBeUsedLater = refScope !== varScope || isInLoop(id);
    if (prevRhsNode && isInside(id, prevRhsNode)) {
      return prevRhsNode;
    }
    if (parent.type === "AssignmentExpression" && isUnusedExpression(parent) && id === parent.left && !canBeUsedLater) {
      return parent.right;
    }
    return null;
  }
  function isReadRef(ref) {
    return ref.isRead();
  }
  function isSelfReference(ref, nodes) {
    let scope = ref.from;
    while (scope) {
      if (nodes.includes(scope.block)) {
        return true;
      }
      scope = scope.upper;
    }
    return false;
  }
  function isUnusedExpression(node) {
    const parent = node.parent;
    if (parent.type === "ExpressionStatement") {
      return true;
    }
    if (parent.type === "SequenceExpression") {
      const isLastExpression = parent.expressions.at(-1) === node;
      if (!isLastExpression) {
        return true;
      }
      return isUnusedExpression(parent);
    }
    return false;
  }
  function isInside(inner, outer) {
    return inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
  }
  function isInsideOfStorableFunction(id, rhsNode) {
    const funcNode = getUpperFunction(id);
    return funcNode && isInside(funcNode, rhsNode) && isStorableFunction(funcNode, rhsNode);
  }
  function isStorableFunction(funcNode, rhsNode) {
    let node = funcNode;
    let parent = funcNode.parent;
    while (parent && isInside(parent, rhsNode)) {
      switch (parent.type) {
        case "SequenceExpression":
          if (parent.expressions.at(-1) !== node) {
            return false;
          }
          break;
        case "CallExpression":
        case "NewExpression":
          return parent.callee !== node;
        case "AssignmentExpression":
        case "TaggedTemplateExpression":
        case "YieldExpression":
          return true;
        default:
          if (STATEMENT_TYPE.test(parent.type)) {
            return true;
          }
      }
      node = parent;
      parent = parent.parent;
    }
    return false;
  }
  function isExported(variable) {
    const definition = variable.defs[0];
    if (definition) {
      let node = definition.node;
      if (node.type === "VariableDeclarator") {
        node = node.parent;
      } else if (definition.type === "Parameter") {
        return false;
      }
      return node.parent.type.indexOf("Export") === 0;
    }
    return false;
  }
  function hasRestSpreadSibling(variable) {
    return false;
  }
  function getAssignedMessageData(unusedVar) {
    const def = unusedVar.defs && unusedVar.defs[0];
    let additionalMessageData = "";
    if (def) {
      const [variableDescription, pattern] = getVariableDescription(defToVariableType(def));
      if (pattern && variableDescription) {
        additionalMessageData = `. Allowed unused ${variableDescription} must match ${pattern}`;
      }
    }
    return {
      varName: unusedVar.name,
      action: "assigned a value",
      additional: additionalMessageData
    };
  }
  function getVariableDescription(variableType) {
    let pattern;
    let variableDescription;
    switch (variableType) {
      case "array-destructure":
        variableDescription = "elements of array destructuring";
        break;
      case "catch-clause":
        variableDescription = "caught errors";
        break;
      case "parameter":
        variableDescription = "args";
        break;
      case "variable":
        variableDescription = "vars";
        break;
      default:
        throw new Error(`Unexpected variable type: ${variableType}`);
    }
    return [variableDescription, pattern];
  }
  function defToVariableType(def) {
    switch (def.type) {
      case "CatchClause":
        return "catch-clause";
      case "Parameter":
        return "parameter";
      default:
        return "variable";
    }
  }
  function getDefinedMessageData(unusedVar) {
    const def = unusedVar.defs && unusedVar.defs[0];
    let additionalMessageData = "";
    if (def) {
      const [variableDescription, pattern] = getVariableDescription(defToVariableType(def));
      if (pattern && variableDescription) {
        additionalMessageData = `. Allowed unused ${variableDescription} must match ${pattern}`;
      }
    }
    return {
      varName: unusedVar.name,
      action: "defined",
      additional: additionalMessageData
    };
  }
  function toUnusedVarAnnotation(unusedVar) {
    var _a, _b;
    const node = (_a = unusedVar.identifiers) == null ? void 0 : _a[0];
    if (!((_b = node == null ? void 0 : node.loc) == null ? void 0 : _b.start)) {
      return null;
    }
    const data = unusedVar.references.some((ref) => ref.isWrite()) ? getAssignedMessageData(unusedVar) : getDefinedMessageData(unusedVar);
    return {
      row: node.loc.start.line - 1,
      column: node.loc.start.column,
      text: interpolate(UNUSED_VAR_MESSAGE, data),
      type: "info"
    };
  }
  var UNUSED_VAR_MESSAGE = "'{{varName}}' is {{action}} but never used{{additional}}.";
  function getAnnotations(scope, scopeManager) {
    var unusedVars = collectUnusedVariables(scope, [], scopeManager);
    var annotations = [];
    for (let i = 0, l = unusedVars.length; i < l; ++i) {
      const unusedVar = unusedVars[i];
      if (unusedVar.defs.length > 0) {
        const writeReferences = unusedVar.references.filter(
          (ref) => ref.isWrite() && ref.from.variableScope === unusedVar.scope.variableScope
        );
        let referenceToReport;
        if (writeReferences.length > 0) {
          referenceToReport = writeReferences.at(-1);
        }
        var transpiled = toUnusedVarAnnotation(unusedVar);
        if (transpiled) {
          annotations.push(toUnusedVarAnnotation(unusedVar));
        }
      }
    }
    return annotations;
  }

  // src/workers/eslint-rules/no-undef.js
  function getAnnotations2(scope, scopeManager) {
    const globalScope = scope;
    if (!globalScope) {
      return [];
    }
    return globalScope.through.map((ref) => {
      const identifier = ref.identifier;
      if (!identifier.loc) {
        return;
      }
      return {
        row: identifier.loc.start.line - 1,
        column: identifier.loc.start.column,
        text: interpolate("'{{name}}' is not defined.", identifier),
        type: "warning"
      };
    }).filter(Boolean);
  }

  // src/workers/eslint-rules/scopes-analyzer.ts
  var import_globals = __toESM(require_globals2());
  var DEFAULT_GLOBALS = __spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues({}, import_globals.default.browser), import_globals.default.node), import_globals.default.amd), import_globals.default.mocha), import_globals.default.es2015), import_globals.default.builtin);
  var ScopesAnalyzer = class {
    constructor(options) {
      this.options = options;
    }
    setOptions(options) {
      this.options = options;
    }
    analyze(program) {
      var _a, _b, _c, _d;
      attachParents(program);
      var annotations = [];
      this.scopeManager = analyze(program, {
        ignoreEval: true,
        nodejsScope: !!((_b = (_a = this.options.parserOptions) == null ? void 0 : _a.ecmaFeatures) == null ? void 0 : _b.globalReturn),
        impliedStrict: !!((_d = (_c = this.options.parserOptions) == null ? void 0 : _c.ecmaFeatures) == null ? void 0 : _d.impliedStrict),
        ecmaVersion: this.options.ecmaVersion || 2022,
        sourceType: this.options.sourceType === "commonjs" ? "commonjs" : program.sourceType,
        jsx: isJsxEnabled(this.options)
      });
      this.finalize();
      var scope = this.getScope(this.scopeManager.scopes[0]);
      if (this.options["no-unused-vars"]) {
        if (this.scopeManager.scopes && this.scopeManager.scopes.length > 0) {
          annotations = [...annotations, ...getAnnotations(scope, this.scopeManager)];
        }
      }
      if (this.options["no-undef"]) {
        if (this.scopeManager.scopes && this.scopeManager.scopes.length > 0) {
          annotations = [...annotations, ...getAnnotations2(scope, this.scopeManager)];
        }
      }
      return annotations;
    }
    getScope(currentNode) {
      if (!currentNode) {
        throw new TypeError("Missing required argument: node.");
      }
      const inner = currentNode.type !== "Program";
      for (let node = currentNode; node; node = node.parent) {
        const scope = this.scopeManager.acquire(node, inner);
        if (scope) {
          if (scope.type === "function-expression-name") {
            return scope.childScopes[0];
          }
          return scope;
        }
      }
      return this.scopeManager.scopes[0];
    }
    finalize() {
      const globalScope = this.scopeManager.scopes[0];
      const globals2 = resolveGlobalsFromOptions(this.options);
      addDeclaredGlobals(this.scopeManager, globals2);
      markExportedVariables(globalScope, {});
    }
  };
  function attachParents(node, parent = null) {
    if (!node || typeof node !== "object") {
      return;
    }
    Object.defineProperty(node, "parent", {
      value: parent,
      writable: true,
      configurable: true,
      enumerable: false
    });
    for (const key of Object.keys(node)) {
      if (key === "parent") {
        continue;
      }
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object" && typeof child.type === "string") {
            attachParents(child, node);
          }
        }
      } else if (value && typeof value === "object" && typeof value.type === "string") {
        attachParents(value, node);
      }
    }
  }
  function addDeclaredGlobals(scopeManager, configGlobals = /* @__PURE__ */ Object.create(null)) {
    const finalGlobals = __spreadValues({ __proto__: null }, configGlobals);
    const names = Object.keys(finalGlobals).filter(
      (name) => finalGlobals[name] !== "off"
    );
    scopeManager.addGlobals(names);
    const globalScope = scopeManager.scopes[0];
    for (const name of names) {
      const variable = globalScope.set.get(name);
      variable.eslintImplicitGlobalSetting = configGlobals[name];
      variable.eslintExplicitGlobal = false;
      variable.eslintExplicitGlobalComments = void 0;
      variable.writeable = finalGlobals[name] === "writable";
    }
  }
  function resolveGlobalsFromOptions(options) {
    const resolvedGlobals = __spreadValues({}, DEFAULT_GLOBALS);
    const env = __spreadValues({}, options.env);
    for (const [envName, enabled] of Object.entries(env)) {
      if (!enabled) {
        continue;
      }
      const globalsForEnv = import_globals.default[envName];
      if (!globalsForEnv || typeof globalsForEnv !== "object") {
        continue;
      }
      Object.assign(resolvedGlobals, globalsForEnv);
    }
    if (options.sourceType === "commonjs") {
      Object.assign(resolvedGlobals, import_globals.default.commonjs);
    }
    if (options.globals) {
      Object.assign(resolvedGlobals, options.globals);
    }
    return resolvedGlobals;
  }
  function isJsxEnabled(options) {
    var _a, _b, _c, _d;
    return (_d = (_c = options.jsx) != null ? _c : (_b = (_a = options.parserOptions) == null ? void 0 : _a.ecmaFeatures) == null ? void 0 : _b.jsx) != null ? _d : true;
  }
  function markExportedVariables(globalScope, variables) {
    Object.keys(variables).forEach((name) => {
      const variable = globalScope.set.get(name);
      if (variable) {
        variable.eslintUsed = true;
        variable.eslintExported = true;
      }
    });
  }

  // src/workers/javascript-worker.ts
  var import_globals2 = __toESM(require_globals2());
  var DEFAULT_OPTIONS = {
    "no-unused-vars": true,
    "no-undef": true,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: {
        globalReturn: true,
        jsx: true,
        experimentalObjectRestSpread: true
      },
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true
    },
    globals: __spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues({}, import_globals2.default.browser), import_globals2.default.node), import_globals2.default.amd), import_globals2.default.mocha), import_globals2.default.es2015), import_globals2.default.builtin),
    jsx: true
  };
  var JavaScriptWorker = class extends Mirror {
    constructor(sender) {
      super(sender);
      this.setTimeout(500);
      this.setOptions();
      this.analyzer = new ScopesAnalyzer(this.options);
    }
    setOptions(options) {
      var _a, _b;
      this.options = __spreadProps(__spreadValues(__spreadValues({}, DEFAULT_OPTIONS), options), {
        parserOptions: __spreadProps(__spreadValues(__spreadValues({}, DEFAULT_OPTIONS.parserOptions), options == null ? void 0 : options.parserOptions), {
          ecmaFeatures: __spreadValues(__spreadValues({}, (_a = DEFAULT_OPTIONS.parserOptions) == null ? void 0 : _a.ecmaFeatures), (_b = options == null ? void 0 : options.parserOptions) == null ? void 0 : _b.ecmaFeatures)
        }),
        globals: __spreadValues(__spreadValues({}, DEFAULT_OPTIONS.globals), options == null ? void 0 : options.globals),
        env: __spreadValues({}, options == null ? void 0 : options.env)
      });
      if (this.analyzer) {
        this.analyzer.setOptions(this.options);
      }
    }
    onUpdate() {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      var value = this.doc.getValue();
      var errors = [];
      let ast;
      try {
        var plugins = ["estree"];
        if ((_c = this.options.jsx) != null ? _c : (_b = (_a = this.options.parserOptions) == null ? void 0 : _a.ecmaFeatures) == null ? void 0 : _b.jsx) {
          plugins.push("jsx");
        }
        const parserOptions = {
          sourceType: this.options.sourceType,
          errorRecovery: true,
          plugins,
          ranges: true,
          strictMode: true
        };
        if (((_d = this.options.parserOptions) == null ? void 0 : _d.allowImportExportEverywhere) !== void 0) {
          parserOptions.allowImportExportEverywhere = this.options.parserOptions.allowImportExportEverywhere;
        }
        if (this.options.sourceType !== "commonjs" && ((_e = this.options.parserOptions) == null ? void 0 : _e.allowAwaitOutsideFunction) !== void 0) {
          parserOptions.allowAwaitOutsideFunction = this.options.parserOptions.allowAwaitOutsideFunction;
        }
        if (this.options.sourceType !== "commonjs" && ((_g = (_f = this.options.parserOptions) == null ? void 0 : _f.ecmaFeatures) == null ? void 0 : _g.globalReturn)) {
          parserOptions.allowReturnOutsideFunction = true;
        }
        ast = (0, import_parser.parse)(value, parserOptions);
        errors = (_h = ast.errors) == null ? void 0 : _h.map((err) => ({
          row: err.loc.line - 1,
          column: err.loc.column,
          text: err.message,
          type: "error"
        }));
      } catch (e) {
        if (e instanceof SyntaxError) {
          var syntaxError = {
            row: e.loc.line - 1,
            column: e.loc.column,
            text: e.message,
            type: "error"
          };
          errors.push(syntaxError);
        } else {
          console.error(e);
        }
      }
      try {
        if (ast && ast.program) {
          const result = this.analyzer.analyze(ast.program);
          errors = [...errors, ...result];
        }
      } catch (e) {
        console.warn(e);
      }
      this.sender.emit("annotate", errors);
    }
  };
  return __toCommonJS(javascript_worker_exports);
})();
aceLegacyWorkerModule = aceLegacyWorkerModule.default || aceLegacyWorkerModule;

exports.JavaScriptWorker = aceLegacyWorkerModule.JavaScriptWorker;
});
