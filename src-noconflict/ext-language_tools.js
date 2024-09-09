ace.define("ace/snippets",[], function(require, exports, module){"use strict";
var dom = require("./lib/dom");
var oop = require("./lib/oop");
var EventEmitter = require("./lib/event_emitter").EventEmitter;
var lang = require("./lib/lang");
var Range = require("./range").Range;
var RangeList = require("./range_list").RangeList;
var HashHandler = require("./keyboard/hash_handler").HashHandler;
var Tokenizer = require("./tokenizer").Tokenizer;
var clipboard = require("./clipboard");
var VARIABLES = {
    CURRENT_WORD: function (editor) {
        return editor.session.getTextRange(editor.session.getWordRange());
    },
    SELECTION: function (editor, name, indentation) {
        var text = editor.session.getTextRange();
        if (indentation)
            return text.replace(/\n\r?([ \t]*\S)/g, "\n" + indentation + "$1");
        return text;
    },
    CURRENT_LINE: function (editor) {
        return editor.session.getLine(editor.getCursorPosition().row);
    },
    PREV_LINE: function (editor) {
        return editor.session.getLine(editor.getCursorPosition().row - 1);
    },
    LINE_INDEX: function (editor) {
        return editor.getCursorPosition().row;
    },
    LINE_NUMBER: function (editor) {
        return editor.getCursorPosition().row + 1;
    },
    SOFT_TABS: function (editor) {
        return editor.session.getUseSoftTabs() ? "YES" : "NO";
    },
    TAB_SIZE: function (editor) {
        return editor.session.getTabSize();
    },
    CLIPBOARD: function (editor) {
        return clipboard.getText && clipboard.getText();
    },
    FILENAME: function (editor) {
        return /[^/\\]*$/.exec(this.FILEPATH(editor))[0];
    },
    FILENAME_BASE: function (editor) {
        return /[^/\\]*$/.exec(this.FILEPATH(editor))[0].replace(/\.[^.]*$/, "");
    },
    DIRECTORY: function (editor) {
        return this.FILEPATH(editor).replace(/[^/\\]*$/, "");
    },
    FILEPATH: function (editor) { return "/not implemented.txt"; },
    WORKSPACE_NAME: function () { return "Unknown"; },
    FULLNAME: function () { return "Unknown"; },
    BLOCK_COMMENT_START: function (editor) {
        var mode = editor.session.$mode || {};
        return mode.blockComment && mode.blockComment.start || "";
    },
    BLOCK_COMMENT_END: function (editor) {
        var mode = editor.session.$mode || {};
        return mode.blockComment && mode.blockComment.end || "";
    },
    LINE_COMMENT: function (editor) {
        var mode = editor.session.$mode || {};
        return mode.lineCommentStart || "";
    },
    CURRENT_YEAR: date.bind(null, { year: "numeric" }),
    CURRENT_YEAR_SHORT: date.bind(null, { year: "2-digit" }),
    CURRENT_MONTH: date.bind(null, { month: "numeric" }),
    CURRENT_MONTH_NAME: date.bind(null, { month: "long" }),
    CURRENT_MONTH_NAME_SHORT: date.bind(null, { month: "short" }),
    CURRENT_DATE: date.bind(null, { day: "2-digit" }),
    CURRENT_DAY_NAME: date.bind(null, { weekday: "long" }),
    CURRENT_DAY_NAME_SHORT: date.bind(null, { weekday: "short" }),
    CURRENT_HOUR: date.bind(null, { hour: "2-digit", hour12: false }),
    CURRENT_MINUTE: date.bind(null, { minute: "2-digit" }),
    CURRENT_SECOND: date.bind(null, { second: "2-digit" })
};
VARIABLES.SELECTED_TEXT = VARIABLES.SELECTION;
function date(dateFormat) {
    var str = new Date().toLocaleString("en-us", dateFormat);
    return str.length == 1 ? "0" + str : str;
}
var SnippetManager = /** @class */ (function () {
    function SnippetManager() {
        this.snippetMap = {};
        this.snippetNameMap = {};
        this.variables = VARIABLES;
    }
    SnippetManager.prototype.getTokenizer = function () {
        return SnippetManager["$tokenizer"] || this.createTokenizer();
    };
    SnippetManager.prototype.createTokenizer = function () {
        function TabstopToken(str) {
            str = str.substr(1);
            if (/^\d+$/.test(str))
                return [{ tabstopId: parseInt(str, 10) }];
            return [{ text: str }];
        }
        function escape(ch) {
            return "(?:[^\\\\" + ch + "]|\\\\.)";
        }
        var formatMatcher = {
            regex: "/(" + escape("/") + "+)/",
            onMatch: function (val, state, stack) {
                var ts = stack[0];
                ts.fmtString = true;
                ts.guard = val.slice(1, -1);
                ts.flag = "";
                return "";
            },
            next: "formatString"
        };
        SnippetManager["$tokenizer"] = new Tokenizer({
            start: [
                { regex: /\\./, onMatch: function (val, state, stack) {
                        var ch = val[1];
                        if (ch == "}" && stack.length) {
                            val = ch;
                        }
                        else if ("`$\\".indexOf(ch) != -1) {
                            val = ch;
                        }
                        return [val];
                    } },
                { regex: /}/, onMatch: function (val, state, stack) {
                        return [stack.length ? stack.shift() : val];
                    } },
                { regex: /\$(?:\d+|\w+)/, onMatch: TabstopToken },
                { regex: /\$\{[\dA-Z_a-z]+/, onMatch: function (str, state, stack) {
                        var t = TabstopToken(str.substr(1));
                        stack.unshift(t[0]);
                        return t;
                    }, next: "snippetVar" },
                { regex: /\n/, token: "newline", merge: false }
            ],
            snippetVar: [
                { regex: "\\|" + escape("\\|") + "*\\|", onMatch: function (val, state, stack) {
                        var choices = val.slice(1, -1).replace(/\\[,|\\]|,/g, function (operator) {
                            return operator.length == 2 ? operator[1] : "\x00";
                        }).split("\x00").map(function (value) {
                            return { value: value };
                        });
                        stack[0].choices = choices;
                        return [choices[0]];
                    }, next: "start" },
                formatMatcher,
                { regex: "([^:}\\\\]|\\\\.)*:?", token: "", next: "start" }
            ],
            formatString: [
                { regex: /:/, onMatch: function (val, state, stack) {
                        if (stack.length && stack[0].expectElse) {
                            stack[0].expectElse = false;
                            stack[0].ifEnd = { elseEnd: stack[0] };
                            return [stack[0].ifEnd];
                        }
                        return ":";
                    } },
                { regex: /\\./, onMatch: function (val, state, stack) {
                        var ch = val[1];
                        if (ch == "}" && stack.length)
                            val = ch;
                        else if ("`$\\".indexOf(ch) != -1)
                            val = ch;
                        else if (ch == "n")
                            val = "\n";
                        else if (ch == "t")
                            val = "\t";
                        else if ("ulULE".indexOf(ch) != -1)
                            val = { changeCase: ch, local: ch > "a" };
                        return [val];
                    } },
                { regex: "/\\w*}", onMatch: function (val, state, stack) {
                        var next = stack.shift();
                        if (next)
                            next.flag = val.slice(1, -1);
                        this.next = next && next.tabstopId ? "start" : "";
                        return [next || val];
                    }, next: "start" },
                { regex: /\$(?:\d+|\w+)/, onMatch: function (val, state, stack) {
                        return [{ text: val.slice(1) }];
                    } },
                { regex: /\${\w+/, onMatch: function (val, state, stack) {
                        var token = { text: val.slice(2) };
                        stack.unshift(token);
                        return [token];
                    }, next: "formatStringVar" },
                { regex: /\n/, token: "newline", merge: false },
                { regex: /}/, onMatch: function (val, state, stack) {
                        var next = stack.shift();
                        this.next = next && next.tabstopId ? "start" : "";
                        return [next || val];
                    }, next: "start" }
            ],
            formatStringVar: [
                { regex: /:\/\w+}/, onMatch: function (val, state, stack) {
                        var ts = stack[0];
                        ts.formatFunction = val.slice(2, -1);
                        return [stack.shift()];
                    }, next: "formatString" },
                formatMatcher,
                { regex: /:[\?\-+]?/, onMatch: function (val, state, stack) {
                        if (val[1] == "+")
                            stack[0].ifEnd = stack[0];
                        if (val[1] == "?")
                            stack[0].expectElse = true;
                    }, next: "formatString" },
                { regex: "([^:}\\\\]|\\\\.)*:?", token: "", next: "formatString" }
            ]
        });
        return SnippetManager["$tokenizer"];
    };
    SnippetManager.prototype.tokenizeTmSnippet = function (str, startState) {
        return this.getTokenizer().getLineTokens(str, startState).tokens.map(function (x) {
            return x.value || x;
        });
    };
    SnippetManager.prototype.getVariableValue = function (editor, name, indentation) {
        if (/^\d+$/.test(name))
            return (this.variables.__ || {})[name] || "";
        if (/^[A-Z]\d+$/.test(name))
            return (this.variables[name[0] + "__"] || {})[name.substr(1)] || "";
        name = name.replace(/^TM_/, "");
        if (!this.variables.hasOwnProperty(name))
            return "";
        var value = this.variables[name];
        if (typeof value == "function")
            value = this.variables[name](editor, name, indentation);
        return value == null ? "" : value;
    };
    SnippetManager.prototype.tmStrFormat = function (str, ch, editor) {
        if (!ch.fmt)
            return str;
        var flag = ch.flag || "";
        var re = ch.guard;
        re = new RegExp(re, flag.replace(/[^gim]/g, ""));
        var fmtTokens = typeof ch.fmt == "string" ? this.tokenizeTmSnippet(ch.fmt, "formatString") : ch.fmt;
        var _self = this;
        var formatted = str.replace(re, function () {
            var oldArgs = _self.variables.__;
            _self.variables.__ = [].slice.call(arguments);
            var fmtParts = _self.resolveVariables(fmtTokens, editor);
            var gChangeCase = "E";
            for (var i = 0; i < fmtParts.length; i++) {
                var ch = fmtParts[i];
                if (typeof ch == "object") {
                    fmtParts[i] = "";
                    if (ch.changeCase && ch.local) {
                        var next = fmtParts[i + 1];
                        if (next && typeof next == "string") {
                            if (ch.changeCase == "u")
                                fmtParts[i] = next[0].toUpperCase();
                            else
                                fmtParts[i] = next[0].toLowerCase();
                            fmtParts[i + 1] = next.substr(1);
                        }
                    }
                    else if (ch.changeCase) {
                        gChangeCase = ch.changeCase;
                    }
                }
                else if (gChangeCase == "U") {
                    fmtParts[i] = ch.toUpperCase();
                }
                else if (gChangeCase == "L") {
                    fmtParts[i] = ch.toLowerCase();
                }
            }
            _self.variables.__ = oldArgs;
            return fmtParts.join("");
        });
        return formatted;
    };
    SnippetManager.prototype.tmFormatFunction = function (str, ch, editor) {
        if (ch.formatFunction == "upcase")
            return str.toUpperCase();
        if (ch.formatFunction == "downcase")
            return str.toLowerCase();
        return str;
    };
    SnippetManager.prototype.resolveVariables = function (snippet, editor) {
        var result = [];
        var indentation = "";
        var afterNewLine = true;
        for (var i = 0; i < snippet.length; i++) {
            var ch = snippet[i];
            if (typeof ch == "string") {
                result.push(ch);
                if (ch == "\n") {
                    afterNewLine = true;
                    indentation = "";
                }
                else if (afterNewLine) {
                    indentation = /^\t*/.exec(ch)[0];
                    afterNewLine = /\S/.test(ch);
                }
                continue;
            }
            if (!ch)
                continue;
            afterNewLine = false;
            if (ch.fmtString) {
                var j = snippet.indexOf(ch, i + 1);
                if (j == -1)
                    j = snippet.length;
                ch.fmt = snippet.slice(i + 1, j);
                i = j;
            }
            if (ch.text) {
                var value = this.getVariableValue(editor, ch.text, indentation) + "";
                if (ch.fmtString)
                    value = this.tmStrFormat(value, ch, editor);
                if (ch.formatFunction)
                    value = this.tmFormatFunction(value, ch, editor);
                if (value && !ch.ifEnd) {
                    result.push(value);
                    gotoNext(ch);
                }
                else if (!value && ch.ifEnd) {
                    gotoNext(ch.ifEnd);
                }
            }
            else if (ch.elseEnd) {
                gotoNext(ch.elseEnd);
            }
            else if (ch.tabstopId != null) {
                result.push(ch);
            }
            else if (ch.changeCase != null) {
                result.push(ch);
            }
        }
        function gotoNext(ch) {
            var i1 = snippet.indexOf(ch, i + 1);
            if (i1 != -1)
                i = i1;
        }
        return result;
    };
    SnippetManager.prototype.getDisplayTextForSnippet = function (editor, snippetText) {
        var processedSnippet = processSnippetText.call(this, editor, snippetText);
        return processedSnippet.text;
    };
    SnippetManager.prototype.insertSnippetForSelection = function (editor, snippetText, options) {
        if (options === void 0) { options = {}; }
        var processedSnippet = processSnippetText.call(this, editor, snippetText, options);
        var range = editor.getSelectionRange();
        var end = editor.session.replace(range, processedSnippet.text);
        var tabstopManager = new TabstopManager(editor);
        var selectionId = editor.inVirtualSelectionMode && editor.selection.index;
        tabstopManager.addTabstops(processedSnippet.tabstops, range.start, end, selectionId);
    };
    SnippetManager.prototype.insertSnippet = function (editor, snippetText, options) {
        if (options === void 0) { options = {}; }
        var self = this;
        if (editor.inVirtualSelectionMode)
            return self.insertSnippetForSelection(editor, snippetText, options);
        editor.forEachSelection(function () {
            self.insertSnippetForSelection(editor, snippetText, options);
        }, null, { keepOrder: true });
        if (editor.tabstopManager)
            editor.tabstopManager.tabNext();
    };
    SnippetManager.prototype.$getScope = function (editor) {
        var scope = editor.session.$mode.$id || "";
        scope = scope.split("/").pop();
        if (scope === "html" || scope === "php") {
            if (scope === "php" && !editor.session.$mode.inlinePhp)
                scope = "html";
            var c = editor.getCursorPosition();
            var state = editor.session.getState(c.row);
            if (typeof state === "object") {
                state = state[0];
            }
            if (state.substring) {
                if (state.substring(0, 3) == "js-")
                    scope = "javascript";
                else if (state.substring(0, 4) == "css-")
                    scope = "css";
                else if (state.substring(0, 4) == "php-")
                    scope = "php";
            }
        }
        return scope;
    };
    SnippetManager.prototype.getActiveScopes = function (editor) {
        var scope = this.$getScope(editor);
        var scopes = [scope];
        var snippetMap = this.snippetMap;
        if (snippetMap[scope] && snippetMap[scope].includeScopes) {
            scopes.push.apply(scopes, snippetMap[scope].includeScopes);
        }
        scopes.push("_");
        return scopes;
    };
    SnippetManager.prototype.expandWithTab = function (editor, options) {
        var self = this;
        var result = editor.forEachSelection(function () {
            return self.expandSnippetForSelection(editor, options);
        }, null, { keepOrder: true });
        if (result && editor.tabstopManager)
            editor.tabstopManager.tabNext();
        return result;
    };
    SnippetManager.prototype.expandSnippetForSelection = function (editor, options) {
        var cursor = editor.getCursorPosition();
        var line = editor.session.getLine(cursor.row);
        var before = line.substring(0, cursor.column);
        var after = line.substr(cursor.column);
        var snippetMap = this.snippetMap;
        var snippet;
        this.getActiveScopes(editor).some(function (scope) {
            var snippets = snippetMap[scope];
            if (snippets)
                snippet = this.findMatchingSnippet(snippets, before, after);
            return !!snippet;
        }, this);
        if (!snippet)
            return false;
        if (options && options.dryRun)
            return true;
        editor.session.doc.removeInLine(cursor.row, cursor.column - snippet.replaceBefore.length, cursor.column + snippet.replaceAfter.length);
        this.variables.M__ = snippet.matchBefore;
        this.variables.T__ = snippet.matchAfter;
        this.insertSnippetForSelection(editor, snippet.content);
        this.variables.M__ = this.variables.T__ = null;
        return true;
    };
    SnippetManager.prototype.findMatchingSnippet = function (snippetList, before, after) {
        for (var i = snippetList.length; i--;) {
            var s = snippetList[i];
            if (s.startRe && !s.startRe.test(before))
                continue;
            if (s.endRe && !s.endRe.test(after))
                continue;
            if (!s.startRe && !s.endRe)
                continue;
            s.matchBefore = s.startRe ? s.startRe.exec(before) : [""];
            s.matchAfter = s.endRe ? s.endRe.exec(after) : [""];
            s.replaceBefore = s.triggerRe ? s.triggerRe.exec(before)[0] : "";
            s.replaceAfter = s.endTriggerRe ? s.endTriggerRe.exec(after)[0] : "";
            return s;
        }
    };
    SnippetManager.prototype.register = function (snippets, scope) {
        var snippetMap = this.snippetMap;
        var snippetNameMap = this.snippetNameMap;
        var self = this;
        if (!snippets)
            snippets = [];
        function wrapRegexp(src) {
            if (src && !/^\^?\(.*\)\$?$|^\\b$/.test(src))
                src = "(?:" + src + ")";
            return src || "";
        }
        function guardedRegexp(re, guard, opening) {
            re = wrapRegexp(re);
            guard = wrapRegexp(guard);
            if (opening) {
                re = guard + re;
                if (re && re[re.length - 1] != "$")
                    re = re + "$";
            }
            else {
                re = re + guard;
                if (re && re[0] != "^")
                    re = "^" + re;
            }
            return new RegExp(re);
        }
        function addSnippet(s) {
            if (!s.scope)
                s.scope = scope || "_";
            scope = s.scope;
            if (!snippetMap[scope]) {
                snippetMap[scope] = [];
                snippetNameMap[scope] = {};
            }
            var map = snippetNameMap[scope];
            if (s.name) {
                var old = map[s.name];
                if (old)
                    self.unregister(old);
                map[s.name] = s;
            }
            snippetMap[scope].push(s);
            if (s.prefix)
                s.tabTrigger = s.prefix;
            if (!s.content && s.body)
                s.content = Array.isArray(s.body) ? s.body.join("\n") : s.body;
            if (s.tabTrigger && !s.trigger) {
                if (!s.guard && /^\w/.test(s.tabTrigger))
                    s.guard = "\\b";
                s.trigger = lang.escapeRegExp(s.tabTrigger);
            }
            if (!s.trigger && !s.guard && !s.endTrigger && !s.endGuard)
                return;
            s.startRe = guardedRegexp(s.trigger, s.guard, true);
            s.triggerRe = new RegExp(s.trigger);
            s.endRe = guardedRegexp(s.endTrigger, s.endGuard, true);
            s.endTriggerRe = new RegExp(s.endTrigger);
        }
        if (Array.isArray(snippets)) {
            snippets.forEach(addSnippet);
        }
        else {
            Object.keys(snippets).forEach(function (key) {
                addSnippet(snippets[key]);
            });
        }
        this._signal("registerSnippets", { scope: scope });
    };
    SnippetManager.prototype.unregister = function (snippets, scope) {
        var snippetMap = this.snippetMap;
        var snippetNameMap = this.snippetNameMap;
        function removeSnippet(s) {
            var nameMap = snippetNameMap[s.scope || scope];
            if (nameMap && nameMap[s.name]) {
                delete nameMap[s.name];
                var map = snippetMap[s.scope || scope];
                var i = map && map.indexOf(s);
                if (i >= 0)
                    map.splice(i, 1);
            }
        }
        if (snippets.content)
            removeSnippet(snippets);
        else if (Array.isArray(snippets))
            snippets.forEach(removeSnippet);
    };
    SnippetManager.prototype.parseSnippetFile = function (str) {
        str = str.replace(/\r/g, "");
        var list = [], /**@type{Snippet}*/ snippet = {};
        var re = /^#.*|^({[\s\S]*})\s*$|^(\S+) (.*)$|^((?:\n*\t.*)+)/gm;
        var m;
        while (m = re.exec(str)) {
            if (m[1]) {
                try {
                    snippet = JSON.parse(m[1]);
                    list.push(snippet);
                }
                catch (e) { }
            }
            if (m[4]) {
                snippet.content = m[4].replace(/^\t/gm, "");
                list.push(snippet);
                snippet = {};
            }
            else {
                var key = m[2], val = m[3];
                if (key == "regex") {
                    var guardRe = /\/((?:[^\/\\]|\\.)*)|$/g;
                    snippet.guard = guardRe.exec(val)[1];
                    snippet.trigger = guardRe.exec(val)[1];
                    snippet.endTrigger = guardRe.exec(val)[1];
                    snippet.endGuard = guardRe.exec(val)[1];
                }
                else if (key == "snippet") {
                    snippet.tabTrigger = val.match(/^\S*/)[0];
                    if (!snippet.name)
                        snippet.name = val;
                }
                else if (key) {
                    snippet[key] = val;
                }
            }
        }
        return list;
    };
    SnippetManager.prototype.getSnippetByName = function (name, editor) {
        var snippetMap = this.snippetNameMap;
        var snippet;
        this.getActiveScopes(editor).some(function (scope) {
            var snippets = snippetMap[scope];
            if (snippets)
                snippet = snippets[name];
            return !!snippet;
        }, this);
        return snippet;
    };
    return SnippetManager;
}());
oop.implement(SnippetManager.prototype, EventEmitter);
var processSnippetText = function (editor, snippetText, options) {
    if (options === void 0) { options = {}; }
    var cursor = editor.getCursorPosition();
    var line = editor.session.getLine(cursor.row);
    var tabString = editor.session.getTabString();
    var indentString = line.match(/^\s*/)[0];
    if (cursor.column < indentString.length)
        indentString = indentString.slice(0, cursor.column);
    snippetText = snippetText.replace(/\r/g, "");
    var tokens = this.tokenizeTmSnippet(snippetText);
    tokens = this.resolveVariables(tokens, editor);
    tokens = tokens.map(function (x) {
        if (x == "\n" && !options.excludeExtraIndent)
            return x + indentString;
        if (typeof x == "string")
            return x.replace(/\t/g, tabString);
        return x;
    });
    var tabstops = [];
    tokens.forEach(function (p, i) {
        if (typeof p != "object")
            return;
        var id = p.tabstopId;
        var ts = tabstops[id];
        if (!ts) {
            ts = tabstops[id] = [];
            ts.index = id;
            ts.value = "";
            ts.parents = {};
        }
        if (ts.indexOf(p) !== -1)
            return;
        if (p.choices && !ts.choices)
            ts.choices = p.choices;
        ts.push(p);
        var i1 = tokens.indexOf(p, i + 1);
        if (i1 === -1)
            return;
        var value = tokens.slice(i + 1, i1);
        var isNested = value.some(function (t) { return typeof t === "object"; });
        if (isNested && !ts.value) {
            ts.value = value;
        }
        else if (value.length && (!ts.value || typeof ts.value !== "string")) {
            ts.value = value.join("");
        }
    });
    tabstops.forEach(function (ts) { ts.length = 0; });
    var expanding = {};
    function copyValue(val) {
        var copy = [];
        for (var i = 0; i < val.length; i++) {
            var p = val[i];
            if (typeof p == "object") {
                if (expanding[p.tabstopId])
                    continue;
                var j = val.lastIndexOf(p, i - 1);
                p = copy[j] || { tabstopId: p.tabstopId };
            }
            copy[i] = p;
        }
        return copy;
    }
    for (var i = 0; i < tokens.length; i++) {
        var p = tokens[i];
        if (typeof p != "object")
            continue;
        var id = p.tabstopId;
        var ts = tabstops[id];
        var i1 = tokens.indexOf(p, i + 1);
        if (expanding[id]) {
            if (expanding[id] === p) {
                delete expanding[id];
                Object.keys(expanding).forEach(function (parentId) {
                    ts.parents[parentId] = true;
                });
            }
            continue;
        }
        expanding[id] = p;
        var value = ts.value;
        if (typeof value !== "string")
            value = copyValue(value);
        else if (p.fmt)
            value = this.tmStrFormat(value, p, editor);
        tokens.splice.apply(tokens, [i + 1, Math.max(0, i1 - i)].concat(value, p));
        if (ts.indexOf(p) === -1)
            ts.push(p);
    }
    var row = 0, column = 0;
    var text = "";
    tokens.forEach(function (t) {
        if (typeof t === "string") {
            var lines = t.split("\n");
            if (lines.length > 1) {
                column = lines[lines.length - 1].length;
                row += lines.length - 1;
            }
            else
                column += t.length;
            text += t;
        }
        else if (t) {
            if (!t.start)
                t.start = { row: row, column: column };
            else
                t.end = { row: row, column: column };
        }
    });
    return {
        text: text,
        tabstops: tabstops,
        tokens: tokens
    };
};
var TabstopManager = /** @class */ (function () {
    function TabstopManager(editor) {
        this.index = 0;
        this.ranges = [];
        this.tabstops = [];
        if (editor.tabstopManager)
            return editor.tabstopManager;
        editor.tabstopManager = this;
        this.$onChange = this.onChange.bind(this);
        this.$onChangeSelection = lang.delayedCall(this.onChangeSelection.bind(this)).schedule;
        this.$onChangeSession = this.onChangeSession.bind(this);
        this.$onAfterExec = this.onAfterExec.bind(this);
        this.attach(editor);
    }
    TabstopManager.prototype.attach = function (editor) {
        this.$openTabstops = null;
        this.selectedTabstop = null;
        this.editor = editor;
        this.session = editor.session;
        this.editor.on("change", this.$onChange);
        this.editor.on("changeSelection", this.$onChangeSelection);
        this.editor.on("changeSession", this.$onChangeSession);
        this.editor.commands.on("afterExec", this.$onAfterExec);
        this.editor.keyBinding.addKeyboardHandler(this.keyboardHandler);
    };
    TabstopManager.prototype.detach = function () {
        this.tabstops.forEach(this.removeTabstopMarkers, this);
        this.ranges.length = 0;
        this.tabstops.length = 0;
        this.selectedTabstop = null;
        this.editor.off("change", this.$onChange);
        this.editor.off("changeSelection", this.$onChangeSelection);
        this.editor.off("changeSession", this.$onChangeSession);
        this.editor.commands.off("afterExec", this.$onAfterExec);
        this.editor.keyBinding.removeKeyboardHandler(this.keyboardHandler);
        this.editor.tabstopManager = null;
        this.session = null;
        this.editor = null;
    };
    TabstopManager.prototype.onChange = function (delta) {
        var isRemove = delta.action[0] == "r";
        var selectedTabstop = this.selectedTabstop || {};
        var parents = selectedTabstop.parents || {};
        var tabstops = this.tabstops.slice();
        for (var i = 0; i < tabstops.length; i++) {
            var ts = tabstops[i];
            var active = ts == selectedTabstop || parents[ts.index];
            ts.rangeList.$bias = active ? 0 : 1;
            if (delta.action == "remove" && ts !== selectedTabstop) {
                var parentActive = ts.parents && ts.parents[selectedTabstop.index];
                var startIndex = ts.rangeList.pointIndex(delta.start, parentActive);
                startIndex = startIndex < 0 ? -startIndex - 1 : startIndex + 1;
                var endIndex = ts.rangeList.pointIndex(delta.end, parentActive);
                endIndex = endIndex < 0 ? -endIndex - 1 : endIndex - 1;
                var toRemove = ts.rangeList.ranges.slice(startIndex, endIndex);
                for (var j = 0; j < toRemove.length; j++)
                    this.removeRange(toRemove[j]);
            }
            ts.rangeList.$onChange(delta);
        }
        var session = this.session;
        if (!this.$inChange && isRemove && session.getLength() == 1 && !session.getValue())
            this.detach();
    };
    TabstopManager.prototype.updateLinkedFields = function () {
        var ts = this.selectedTabstop;
        if (!ts || !ts.hasLinkedRanges || !ts.firstNonLinked)
            return;
        this.$inChange = true;
        var session = this.session;
        var text = session.getTextRange(ts.firstNonLinked);
        for (var i = 0; i < ts.length; i++) {
            var range = ts[i];
            if (!range.linked)
                continue;
            var original = range.original;
            var fmt = exports.snippetManager.tmStrFormat(text, original, this.editor);
            session.replace(range, fmt);
        }
        this.$inChange = false;
    };
    TabstopManager.prototype.onAfterExec = function (e) {
        if (e.command && !e.command.readOnly)
            this.updateLinkedFields();
    };
    TabstopManager.prototype.onChangeSelection = function () {
        if (!this.editor)
            return;
        var lead = this.editor.selection.lead;
        var anchor = this.editor.selection.anchor;
        var isEmpty = this.editor.selection.isEmpty();
        for (var i = 0; i < this.ranges.length; i++) {
            if (this.ranges[i].linked)
                continue;
            var containsLead = this.ranges[i].contains(lead.row, lead.column);
            var containsAnchor = isEmpty || this.ranges[i].contains(anchor.row, anchor.column);
            if (containsLead && containsAnchor)
                return;
        }
        this.detach();
    };
    TabstopManager.prototype.onChangeSession = function () {
        this.detach();
    };
    TabstopManager.prototype.tabNext = function (dir) {
        var max = this.tabstops.length;
        var index = this.index + (dir || 1);
        index = Math.min(Math.max(index, 1), max);
        if (index == max)
            index = 0;
        this.selectTabstop(index);
        this.updateTabstopMarkers();
        if (index === 0) {
            this.detach();
        }
    };
    TabstopManager.prototype.selectTabstop = function (index) {
        this.$openTabstops = null;
        var ts = this.tabstops[this.index];
        if (ts)
            this.addTabstopMarkers(ts);
        this.index = index;
        ts = this.tabstops[this.index];
        if (!ts || !ts.length)
            return;
        this.selectedTabstop = ts;
        var range = ts.firstNonLinked || ts;
        if (ts.choices)
            range.cursor = range.start;
        if (!this.editor.inVirtualSelectionMode) {
            var sel = this.editor.multiSelect;
            sel.toSingleRange(range);
            for (var i = 0; i < ts.length; i++) {
                if (ts.hasLinkedRanges && ts[i].linked)
                    continue;
                sel.addRange(ts[i].clone(), true);
            }
        }
        else {
            this.editor.selection.fromOrientedRange(range);
        }
        this.editor.keyBinding.addKeyboardHandler(this.keyboardHandler);
        if (this.selectedTabstop && this.selectedTabstop.choices)
            this.editor.execCommand("startAutocomplete", { matches: this.selectedTabstop.choices });
    };
    TabstopManager.prototype.addTabstops = function (tabstops, start, end) {
        var useLink = this.useLink || !this.editor.getOption("enableMultiselect");
        if (!this.$openTabstops)
            this.$openTabstops = [];
        if (!tabstops[0]) {
            var p = Range.fromPoints(end, end);
            moveRelative(p.start, start);
            moveRelative(p.end, start);
            tabstops[0] = [p];
            tabstops[0].index = 0;
        }
        var i = this.index;
        var arg = [i + 1, 0];
        var ranges = this.ranges;
        var snippetId = this.snippetId = (this.snippetId || 0) + 1;
        tabstops.forEach(function (ts, index) {
            var dest = this.$openTabstops[index] || ts;
            dest.snippetId = snippetId;
            for (var i = 0; i < ts.length; i++) {
                var p = ts[i];
                var range = Range.fromPoints(p.start, p.end || p.start);
                movePoint(range.start, start);
                movePoint(range.end, start);
                range.original = p;
                range.tabstop = dest;
                ranges.push(range);
                if (dest != ts)
                    dest.unshift(range);
                else
                    dest[i] = range;
                if (p.fmtString || (dest.firstNonLinked && useLink)) {
                    range.linked = true;
                    dest.hasLinkedRanges = true;
                }
                else if (!dest.firstNonLinked)
                    dest.firstNonLinked = range;
            }
            if (!dest.firstNonLinked)
                dest.hasLinkedRanges = false;
            if (dest === ts) {
                arg.push(dest);
                this.$openTabstops[index] = dest;
            }
            this.addTabstopMarkers(dest);
            dest.rangeList = dest.rangeList || new RangeList();
            dest.rangeList.$bias = 0;
            dest.rangeList.addList(dest);
        }, this);
        if (arg.length > 2) {
            if (this.tabstops.length)
                arg.push(arg.splice(2, 1)[0]);
            this.tabstops.splice.apply(this.tabstops, arg);
        }
    };
    TabstopManager.prototype.addTabstopMarkers = function (ts) {
        var session = this.session;
        ts.forEach(function (range) {
            if (!range.markerId)
                range.markerId = session.addMarker(range, "ace_snippet-marker", "text");
        });
    };
    TabstopManager.prototype.removeTabstopMarkers = function (ts) {
        var session = this.session;
        ts.forEach(function (range) {
            session.removeMarker(range.markerId);
            range.markerId = null;
        });
    };
    TabstopManager.prototype.updateTabstopMarkers = function () {
        if (!this.selectedTabstop)
            return;
        var currentSnippetId = this.selectedTabstop.snippetId;
        if (this.selectedTabstop.index === 0) {
            currentSnippetId--;
        }
        this.tabstops.forEach(function (ts) {
            if (ts.snippetId === currentSnippetId)
                this.addTabstopMarkers(ts);
            else
                this.removeTabstopMarkers(ts);
        }, this);
    };
    TabstopManager.prototype.removeRange = function (range) {
        var i = range.tabstop.indexOf(range);
        if (i != -1)
            range.tabstop.splice(i, 1);
        i = this.ranges.indexOf(range);
        if (i != -1)
            this.ranges.splice(i, 1);
        i = range.tabstop.rangeList.ranges.indexOf(range);
        if (i != -1)
            range.tabstop.splice(i, 1);
        this.session.removeMarker(range.markerId);
        if (!range.tabstop.length) {
            i = this.tabstops.indexOf(range.tabstop);
            if (i != -1)
                this.tabstops.splice(i, 1);
            if (!this.tabstops.length)
                this.detach();
        }
    };
    return TabstopManager;
}());
TabstopManager.prototype.keyboardHandler = new HashHandler();
TabstopManager.prototype.keyboardHandler.bindKeys({
    "Tab": function (editor) {
        if (exports.snippetManager && exports.snippetManager.expandWithTab(editor))
            return;
        editor.tabstopManager.tabNext(1);
        editor.renderer.scrollCursorIntoView();
    },
    "Shift-Tab": function (editor) {
        editor.tabstopManager.tabNext(-1);
        editor.renderer.scrollCursorIntoView();
    },
    "Esc": function (editor) {
        editor.tabstopManager.detach();
    }
});
var movePoint = function (point, diff) {
    if (point.row == 0)
        point.column += diff.column;
    point.row += diff.row;
};
var moveRelative = function (point, start) {
    if (point.row == start.row)
        point.column -= start.column;
    point.row -= start.row;
};
dom.importCssString("\n.ace_snippet-marker {\n    -moz-box-sizing: border-box;\n    box-sizing: border-box;\n    background: rgba(194, 193, 208, 0.09);\n    border: 1px dotted rgba(211, 208, 235, 0.62);\n    position: absolute;\n}", "snippets.css", false);
exports.snippetManager = new SnippetManager();
var Editor = require("./editor").Editor;
(function () {
    this.insertSnippet = function (content, options) {
        return exports.snippetManager.insertSnippet(this, content, options);
    };
    this.expandSnippet = function (options) {
        return exports.snippetManager.expandWithTab(this, options);
    };
}).call(Editor.prototype);

});

ace.define("ace/autocomplete/popup",[], function(require, exports, module){"use strict";
var Renderer = require("../virtual_renderer").VirtualRenderer;
var Editor = require("../editor").Editor;
var Range = require("../range").Range;
var event = require("../lib/event");
var lang = require("../lib/lang");
var dom = require("../lib/dom");
var nls = require("../config").nls;
var userAgent = require("./../lib/useragent");
var getAriaId = function (index) {
    return "suggest-aria-id:".concat(index);
};
var popupAriaRole = userAgent.isSafari ? "menu" : "listbox";
var optionAriaRole = userAgent.isSafari ? "menuitem" : "option";
var ariaActiveState = userAgent.isSafari ? "aria-current" : "aria-selected";
var $singleLineEditor = function (el) {
    var renderer = new Renderer(el);
    renderer.$maxLines = 4;
    var editor = new Editor(renderer);
    editor.setHighlightActiveLine(false);
    editor.setShowPrintMargin(false);
    editor.renderer.setShowGutter(false);
    editor.renderer.setHighlightGutterLine(false);
    editor.$mouseHandler.$focusTimeout = 0;
    editor.$highlightTagPending = true;
    return editor;
};
var AcePopup = /** @class */ (function () {
    function AcePopup(parentNode) {
        var el = dom.createElement("div");
        var popup = $singleLineEditor(el);
        if (parentNode) {
            parentNode.appendChild(el);
        }
        el.style.display = "none";
        popup.renderer.content.style.cursor = "default";
        popup.renderer.setStyle("ace_autocomplete");
        popup.renderer.$textLayer.element.setAttribute("role", popupAriaRole);
        popup.renderer.$textLayer.element.setAttribute("aria-roledescription", nls("autocomplete.popup.aria-roledescription", "Autocomplete suggestions"));
        popup.renderer.$textLayer.element.setAttribute("aria-label", nls("autocomplete.popup.aria-label", "Autocomplete suggestions"));
        popup.renderer.textarea.setAttribute("aria-hidden", "true");
        popup.setOption("displayIndentGuides", false);
        popup.setOption("dragDelay", 150);
        var noop = function () { };
        popup.focus = noop;
        popup.$isFocused = true;
        popup.renderer.$cursorLayer.restartTimer = noop;
        popup.renderer.$cursorLayer.element.style.opacity = "0";
        popup.renderer.$maxLines = 8;
        popup.renderer.$keepTextAreaAtCursor = false;
        popup.setHighlightActiveLine(false);
        popup.session.highlight("");
        popup.session.$searchHighlight.clazz = "ace_highlight-marker";
        popup.on("mousedown", function (e) {
            var pos = e.getDocumentPosition();
            popup.selection.moveToPosition(pos);
            selectionMarker.start.row = selectionMarker.end.row = pos.row;
            e.stop();
        });
        var lastMouseEvent;
        var hoverMarker = new Range(-1, 0, -1, Infinity);
        var selectionMarker = new Range(-1, 0, -1, Infinity);
        selectionMarker.id = popup.session.addMarker(selectionMarker, "ace_active-line", "fullLine");
        popup.setSelectOnHover = function (val) {
            if (!val) {
                hoverMarker.id = popup.session.addMarker(hoverMarker, "ace_line-hover", "fullLine");
            }
            else if (hoverMarker.id) {
                popup.session.removeMarker(hoverMarker.id);
                hoverMarker.id = null;
            }
        };
        popup.setSelectOnHover(false);
        popup.on("mousemove", function (e) {
            if (!lastMouseEvent) {
                lastMouseEvent = e;
                return;
            }
            if (lastMouseEvent.x == e.x && lastMouseEvent.y == e.y) {
                return;
            }
            lastMouseEvent = e;
            lastMouseEvent.scrollTop = popup.renderer.scrollTop;
            popup.isMouseOver = true;
            var row = lastMouseEvent.getDocumentPosition().row;
            if (hoverMarker.start.row != row) {
                if (!hoverMarker.id)
                    popup.setRow(row);
                setHoverMarker(row);
            }
        });
        popup.renderer.on("beforeRender", function () {
            if (lastMouseEvent && hoverMarker.start.row != -1) {
                lastMouseEvent.$pos = null;
                var row = lastMouseEvent.getDocumentPosition().row;
                if (!hoverMarker.id)
                    popup.setRow(row);
                setHoverMarker(row, true);
            }
        });
        popup.renderer.on("afterRender", function () {
            var row = popup.getRow();
            var t = popup.renderer.$textLayer;
            var selected = /** @type {HTMLElement|null} */ (t.element.childNodes[row - t.config.firstRow]);
            var el = document.activeElement; // Active element is textarea of main editor
            if (selected !== popup.selectedNode && popup.selectedNode) {
                dom.removeCssClass(popup.selectedNode, "ace_selected");
                el.removeAttribute("aria-activedescendant");
                popup.selectedNode.removeAttribute(ariaActiveState);
                popup.selectedNode.removeAttribute("id");
            }
            popup.selectedNode = selected;
            if (selected) {
                dom.addCssClass(selected, "ace_selected");
                var ariaId = getAriaId(row);
                selected.id = ariaId;
                t.element.setAttribute("aria-activedescendant", ariaId);
                el.setAttribute("aria-activedescendant", ariaId);
                selected.setAttribute("role", optionAriaRole);
                selected.setAttribute("aria-roledescription", nls("autocomplete.popup.item.aria-roledescription", "item"));
                selected.setAttribute("aria-label", popup.getData(row).caption || popup.getData(row).value);
                selected.setAttribute("aria-setsize", popup.data.length);
                selected.setAttribute("aria-posinset", row + 1);
                selected.setAttribute("aria-describedby", "doc-tooltip");
                selected.setAttribute(ariaActiveState, "true");
            }
        });
        var hideHoverMarker = function () { setHoverMarker(-1); };
        var setHoverMarker = function (row, suppressRedraw) {
            if (row !== hoverMarker.start.row) {
                hoverMarker.start.row = hoverMarker.end.row = row;
                if (!suppressRedraw)
                    popup.session._emit("changeBackMarker");
                popup._emit("changeHoverMarker");
            }
        };
        popup.getHoveredRow = function () {
            return hoverMarker.start.row;
        };
        event.addListener(popup.container, "mouseout", function () {
            popup.isMouseOver = false;
            hideHoverMarker();
        });
        popup.on("hide", hideHoverMarker);
        popup.on("changeSelection", hideHoverMarker);
        popup.session.doc.getLength = function () {
            return popup.data.length;
        };
        popup.session.doc.getLine = function (i) {
            var data = popup.data[i];
            if (typeof data == "string")
                return data;
            return (data && data.value) || "";
        };
        var bgTokenizer = popup.session.bgTokenizer;
        bgTokenizer.$tokenizeRow = function (row) {
            var data = popup.data[row];
            var tokens = [];
            if (!data)
                return tokens;
            if (typeof data == "string")
                data = { value: data };
            var caption = data.caption || data.value || data.name;
            function addToken(value, className) {
                value && tokens.push({
                    type: (data.className || "") + (className || ""),
                    value: value
                });
            }
            var lower = caption.toLowerCase();
            var filterText = (popup.filterText || "").toLowerCase();
            var lastIndex = 0;
            var lastI = 0;
            for (var i = 0; i <= filterText.length; i++) {
                if (i != lastI && (data.matchMask & (1 << i) || i == filterText.length)) {
                    var sub = filterText.slice(lastI, i);
                    lastI = i;
                    var index = lower.indexOf(sub, lastIndex);
                    if (index == -1)
                        continue;
                    addToken(caption.slice(lastIndex, index), "");
                    lastIndex = index + sub.length;
                    addToken(caption.slice(index, lastIndex), "completion-highlight");
                }
            }
            addToken(caption.slice(lastIndex, caption.length), "");
            tokens.push({ type: "completion-spacer", value: " " });
            if (data.meta)
                tokens.push({ type: "completion-meta", value: data.meta });
            if (data.message)
                tokens.push({ type: "completion-message", value: data.message });
            return tokens;
        };
        bgTokenizer.$updateOnChange = noop;
        bgTokenizer.start = noop;
        popup.session.$computeWidth = function () {
            return this.screenWidth = 0;
        };
        popup.isOpen = false;
        popup.isTopdown = false;
        popup.autoSelect = true;
        popup.filterText = "";
        popup.isMouseOver = false;
        popup.data = [];
        popup.setData = function (list, filterText) {
            popup.filterText = filterText || "";
            popup.setValue(lang.stringRepeat("\n", list.length), -1);
            popup.data = list || [];
            popup.setRow(0);
        };
        popup.getData = function (row) {
            return popup.data[row];
        };
        popup.getRow = function () {
            return selectionMarker.start.row;
        };
        popup.setRow = function (line) {
            line = Math.max(this.autoSelect ? 0 : -1, Math.min(this.data.length - 1, line));
            if (selectionMarker.start.row != line) {
                popup.selection.clearSelection();
                selectionMarker.start.row = selectionMarker.end.row = line || 0;
                popup.session._emit("changeBackMarker");
                popup.moveCursorTo(line || 0, 0);
                if (popup.isOpen)
                    popup._signal("select");
            }
        };
        popup.on("changeSelection", function () {
            if (popup.isOpen)
                popup.setRow(popup.selection.lead.row);
            popup.renderer.scrollCursorIntoView();
        });
        popup.hide = function () {
            this.container.style.display = "none";
            popup.anchorPos = null;
            popup.anchor = null;
            if (popup.isOpen) {
                popup.isOpen = false;
                this._signal("hide");
            }
        };
        popup.tryShow = function (pos, lineHeight, anchor, forceShow) {
            if (!forceShow && popup.isOpen && popup.anchorPos && popup.anchor &&
                popup.anchorPos.top === pos.top && popup.anchorPos.left === pos.left &&
                popup.anchor === anchor) {
                return true;
            }
            var el = this.container;
            var screenHeight = window.innerHeight;
            var screenWidth = window.innerWidth;
            var renderer = this.renderer;
            var maxH = renderer.$maxLines * lineHeight * 1.4;
            var dims = { top: 0, bottom: 0, left: 0 };
            var spaceBelow = screenHeight - pos.top - 3 * this.$borderSize - lineHeight;
            var spaceAbove = pos.top - 3 * this.$borderSize;
            if (!anchor) {
                if (spaceAbove <= spaceBelow || spaceBelow >= maxH) {
                    anchor = "bottom";
                }
                else {
                    anchor = "top";
                }
            }
            if (anchor === "top") {
                dims.bottom = pos.top - this.$borderSize;
                dims.top = dims.bottom - maxH;
            }
            else if (anchor === "bottom") {
                dims.top = pos.top + lineHeight + this.$borderSize;
                dims.bottom = dims.top + maxH;
            }
            var fitsX = dims.top >= 0 && dims.bottom <= screenHeight;
            if (!forceShow && !fitsX) {
                return false;
            }
            if (!fitsX) {
                if (anchor === "top") {
                    renderer.$maxPixelHeight = spaceAbove;
                }
                else {
                    renderer.$maxPixelHeight = spaceBelow;
                }
            }
            else {
                renderer.$maxPixelHeight = null;
            }
            if (anchor === "top") {
                el.style.top = "";
                el.style.bottom = (screenHeight - dims.bottom) + "px";
                popup.isTopdown = false;
            }
            else {
                el.style.top = dims.top + "px";
                el.style.bottom = "";
                popup.isTopdown = true;
            }
            el.style.display = "";
            var left = pos.left;
            if (left + el.offsetWidth > screenWidth)
                left = screenWidth - el.offsetWidth;
            el.style.left = left + "px";
            el.style.right = "";
            if (!popup.isOpen) {
                popup.isOpen = true;
                this._signal("show");
                lastMouseEvent = null;
            }
            popup.anchorPos = pos;
            popup.anchor = anchor;
            return true;
        };
        popup.show = function (pos, lineHeight, topdownOnly) {
            this.tryShow(pos, lineHeight, topdownOnly ? "bottom" : undefined, true);
        };
        popup.goTo = function (where) {
            var row = this.getRow();
            var max = this.session.getLength() - 1;
            switch (where) {
                case "up":
                    row = row <= 0 ? max : row - 1;
                    break;
                case "down":
                    row = row >= max ? -1 : row + 1;
                    break;
                case "start":
                    row = 0;
                    break;
                case "end":
                    row = max;
                    break;
            }
            this.setRow(row);
        };
        popup.getTextLeftOffset = function () {
            return this.$borderSize + this.renderer.$padding + this.$imageSize;
        };
        popup.$imageSize = 0;
        popup.$borderSize = 1;
        return popup;
    }
    return AcePopup;
}());
dom.importCssString("\n.ace_editor.ace_autocomplete .ace_marker-layer .ace_active-line {\n    background-color: #CAD6FA;\n    z-index: 1;\n}\n.ace_dark.ace_editor.ace_autocomplete .ace_marker-layer .ace_active-line {\n    background-color: #3a674e;\n}\n.ace_editor.ace_autocomplete .ace_line-hover {\n    border: 1px solid #abbffe;\n    margin-top: -1px;\n    background: rgba(233,233,253,0.4);\n    position: absolute;\n    z-index: 2;\n}\n.ace_dark.ace_editor.ace_autocomplete .ace_line-hover {\n    border: 1px solid rgba(109, 150, 13, 0.8);\n    background: rgba(58, 103, 78, 0.62);\n}\n.ace_completion-meta {\n    opacity: 0.5;\n    margin-left: 0.9em;\n}\n.ace_completion-message {\n    margin-left: 0.9em;\n    color: blue;\n}\n.ace_editor.ace_autocomplete .ace_completion-highlight{\n    color: #2d69c7;\n}\n.ace_dark.ace_editor.ace_autocomplete .ace_completion-highlight{\n    color: #93ca12;\n}\n.ace_editor.ace_autocomplete {\n    width: 300px;\n    z-index: 200000;\n    border: 1px lightgray solid;\n    position: fixed;\n    box-shadow: 2px 3px 5px rgba(0,0,0,.2);\n    line-height: 1.4;\n    background: #fefefe;\n    color: #111;\n}\n.ace_dark.ace_editor.ace_autocomplete {\n    border: 1px #484747 solid;\n    box-shadow: 2px 3px 5px rgba(0, 0, 0, 0.51);\n    line-height: 1.4;\n    background: #25282c;\n    color: #c1c1c1;\n}\n.ace_autocomplete .ace_text-layer  {\n    width: calc(100% - 8px);\n}\n.ace_autocomplete .ace_line {\n    display: flex;\n    align-items: center;\n}\n.ace_autocomplete .ace_line > * {\n    min-width: 0;\n    flex: 0 0 auto;\n}\n.ace_autocomplete .ace_line .ace_ {\n    flex: 0 1 auto;\n    overflow: hidden;\n    text-overflow: ellipsis;\n}\n.ace_autocomplete .ace_completion-spacer {\n    flex: 1;\n}\n.ace_autocomplete.ace_loading:after  {\n    content: \"\";\n    position: absolute;\n    top: 0px;\n    height: 2px;\n    width: 8%;\n    background: blue;\n    z-index: 100;\n    animation: ace_progress 3s infinite linear;\n    animation-delay: 300ms;\n    transform: translateX(-100%) scaleX(1);\n}\n@keyframes ace_progress {\n    0% { transform: translateX(-100%) scaleX(1) }\n    50% { transform: translateX(625%) scaleX(2) } \n    100% { transform: translateX(1500%) scaleX(3) } \n}\n@media (prefers-reduced-motion) {\n    .ace_autocomplete.ace_loading:after {\n        transform: translateX(625%) scaleX(2);\n        animation: none;\n     }\n}\n", "autocompletion.css", false);
exports.AcePopup = AcePopup;
exports.$singleLineEditor = $singleLineEditor;
exports.getAriaId = getAriaId;

});

ace.define("ace/autocomplete/inline_screenreader",[], function(require, exports, module){"use strict";
var AceInlineScreenReader = /** @class */ (function () {
    function AceInlineScreenReader(editor) {
        this.editor = editor;
        this.screenReaderDiv = document.createElement("div");
        this.screenReaderDiv.classList.add("ace_screenreader-only");
        this.editor.container.appendChild(this.screenReaderDiv);
    }
    AceInlineScreenReader.prototype.setScreenReaderContent = function (content) {
        if (!this.popup && this.editor.completer && /**@type{import("../autocomplete").Autocomplete}*/ (this.editor.completer).popup) {
            this.popup = /**@type{import("../autocomplete").Autocomplete}*/ (this.editor.completer).popup;
            this.popup.renderer.on("afterRender", function () {
                var row = this.popup.getRow();
                var t = this.popup.renderer.$textLayer;
                var selected = t.element.childNodes[row - t.config.firstRow];
                if (selected) {
                    var idString = "doc-tooltip ";
                    for (var lineIndex = 0; lineIndex < this._lines.length; lineIndex++) {
                        idString += "ace-inline-screenreader-line-".concat(lineIndex, " ");
                    }
                    selected.setAttribute("aria-describedby", idString);
                }
            }.bind(this));
        }
        while (this.screenReaderDiv.firstChild) {
            this.screenReaderDiv.removeChild(this.screenReaderDiv.firstChild);
        }
        this._lines = content.split(/\r\n|\r|\n/);
        var codeElement = this.createCodeBlock();
        this.screenReaderDiv.appendChild(codeElement);
    };
    AceInlineScreenReader.prototype.destroy = function () {
        this.screenReaderDiv.remove();
    };
    AceInlineScreenReader.prototype.createCodeBlock = function () {
        var container = document.createElement("pre");
        container.setAttribute("id", "ace-inline-screenreader");
        for (var lineIndex = 0; lineIndex < this._lines.length; lineIndex++) {
            var codeElement = document.createElement("code");
            codeElement.setAttribute("id", "ace-inline-screenreader-line-".concat(lineIndex));
            var line = document.createTextNode(this._lines[lineIndex]);
            codeElement.appendChild(line);
            container.appendChild(codeElement);
        }
        return container;
    };
    return AceInlineScreenReader;
}());
exports.AceInlineScreenReader = AceInlineScreenReader;

});

ace.define("ace/autocomplete/inline",[], function(require, exports, module){"use strict";
var snippetManager = require("../snippets").snippetManager;
var AceInlineScreenReader = require("./inline_screenreader").AceInlineScreenReader;
var AceInline = /** @class */ (function () {
    function AceInline() {
        this.editor = null;
    }
    AceInline.prototype.show = function (editor, completion, prefix) {
        prefix = prefix || "";
        if (editor && this.editor && this.editor !== editor) {
            this.hide();
            this.editor = null;
            this.inlineScreenReader = null;
        }
        if (!editor || !completion) {
            return false;
        }
        if (!this.inlineScreenReader) {
            this.inlineScreenReader = new AceInlineScreenReader(editor);
        }
        var displayText = completion.snippet ? snippetManager.getDisplayTextForSnippet(editor, completion.snippet) : completion.value;
        if (completion.hideInlinePreview || !displayText || !displayText.startsWith(prefix)) {
            return false;
        }
        this.editor = editor;
        this.inlineScreenReader.setScreenReaderContent(displayText);
        displayText = displayText.slice(prefix.length);
        if (displayText === "") {
            editor.removeGhostText();
        }
        else {
            editor.setGhostText(displayText);
        }
        return true;
    };
    AceInline.prototype.isOpen = function () {
        if (!this.editor) {
            return false;
        }
        return !!this.editor.renderer.$ghostText;
    };
    AceInline.prototype.hide = function () {
        if (!this.editor) {
            return false;
        }
        this.editor.removeGhostText();
        return true;
    };
    AceInline.prototype.destroy = function () {
        this.hide();
        this.editor = null;
        if (this.inlineScreenReader) {
            this.inlineScreenReader.destroy();
            this.inlineScreenReader = null;
        }
    };
    return AceInline;
}());
exports.AceInline = AceInline;

});

ace.define("ace/autocomplete/util",[], function(require, exports, module){"use strict";
exports.parForEach = function (array, fn, callback) {
    var completed = 0;
    var arLength = array.length;
    if (arLength === 0)
        callback();
    for (var i = 0; i < arLength; i++) {
        fn(array[i], function (result, err) {
            completed++;
            if (completed === arLength)
                callback(result, err);
        });
    }
};
var ID_REGEX = /[a-zA-Z_0-9\$\-\u00A2-\u2000\u2070-\uFFFF]/;
exports.retrievePrecedingIdentifier = function (text, pos, regex) {
    regex = regex || ID_REGEX;
    var buf = [];
    for (var i = pos - 1; i >= 0; i--) {
        if (regex.test(text[i]))
            buf.push(text[i]);
        else
            break;
    }
    return buf.reverse().join("");
};
exports.retrieveFollowingIdentifier = function (text, pos, regex) {
    regex = regex || ID_REGEX;
    var buf = [];
    for (var i = pos; i < text.length; i++) {
        if (regex.test(text[i]))
            buf.push(text[i]);
        else
            break;
    }
    return buf;
};
exports.getCompletionPrefix = function (editor) {
    var pos = editor.getCursorPosition();
    var line = editor.session.getLine(pos.row);
    var prefix;
    editor.completers.forEach(function (completer) {
        if (completer.identifierRegexps) {
            completer.identifierRegexps.forEach(function (identifierRegex) {
                if (!prefix && identifierRegex)
                    prefix = this.retrievePrecedingIdentifier(line, pos.column, identifierRegex);
            }.bind(this));
        }
    }.bind(this));
    return prefix || this.retrievePrecedingIdentifier(line, pos.column);
};
exports.triggerAutocomplete = function (editor, previousChar) {
    var previousChar = previousChar == null
        ? editor.session.getPrecedingCharacter()
        : previousChar;
    return editor.completers.some(function (completer) {
        if (completer.triggerCharacters && Array.isArray(completer.triggerCharacters)) {
            return completer.triggerCharacters.includes(previousChar);
        }
    });
};

});

ace.define("ace/autocomplete",[], function(require, exports, module){"use strict";
var HashHandler = require("./keyboard/hash_handler").HashHandler;
var AcePopup = require("./autocomplete/popup").AcePopup;
var AceInline = require("./autocomplete/inline").AceInline;
var getAriaId = require("./autocomplete/popup").getAriaId;
var util = require("./autocomplete/util");
var lang = require("./lib/lang");
var dom = require("./lib/dom");
var snippetManager = require("./snippets").snippetManager;
var config = require("./config");
var event = require("./lib/event");
var preventParentScroll = require("./lib/scroll").preventParentScroll;
var destroyCompleter = function (e, editor) {
    editor.completer && editor.completer.destroy();
};
var Autocomplete = /** @class */ (function () {
    function Autocomplete() {
        this.autoInsert = false;
        this.autoSelect = true;
        this.autoShown = false;
        this.exactMatch = false;
        this.inlineEnabled = false;
        this.keyboardHandler = new HashHandler();
        this.keyboardHandler.bindKeys(this.commands);
        this.parentNode = null;
        this.setSelectOnHover = false;
        this.hasSeen = new Set();
        this.showLoadingState = false;
        this.stickySelectionDelay = 500;
        this.blurListener = this.blurListener.bind(this);
        this.changeListener = this.changeListener.bind(this);
        this.mousedownListener = this.mousedownListener.bind(this);
        this.mousewheelListener = this.mousewheelListener.bind(this);
        this.onLayoutChange = this.onLayoutChange.bind(this);
        this.changeTimer = lang.delayedCall(function () {
            this.updateCompletions(true);
        }.bind(this));
        this.tooltipTimer = lang.delayedCall(this.updateDocTooltip.bind(this), 50);
        this.popupTimer = lang.delayedCall(this.$updatePopupPosition.bind(this), 50);
        this.stickySelectionTimer = lang.delayedCall(function () {
            this.stickySelection = true;
        }.bind(this), this.stickySelectionDelay);
        this.$firstOpenTimer = lang.delayedCall(/**@this{Autocomplete}*/ function () {
            var initialPosition = this.completionProvider && this.completionProvider.initialPosition;
            if (this.autoShown || (this.popup && this.popup.isOpen) || !initialPosition || this.editor.completers.length === 0)
                return;
            this.completions = new FilteredList(Autocomplete.completionsForLoading);
            this.openPopup(this.editor, initialPosition.prefix, false);
            this.popup.renderer.setStyle("ace_loading", true);
        }.bind(this), this.stickySelectionDelay);
    }
    Object.defineProperty(Autocomplete, "completionsForLoading", {
        get: function () {
            return [{
                    caption: config.nls("autocomplete.loading", "Loading..."),
                    value: ""
                }];
        },
        enumerable: false,
        configurable: true
    });
    Autocomplete.prototype.$init = function () {
        this.popup = new AcePopup(this.parentNode || document.body || document.documentElement);
        this.popup.on("click", function (e) {
            this.insertMatch();
            e.stop();
        }.bind(this));
        this.popup.focus = this.editor.focus.bind(this.editor);
        this.popup.on("show", this.$onPopupShow.bind(this));
        this.popup.on("hide", this.$onHidePopup.bind(this));
        this.popup.on("select", this.$onPopupChange.bind(this));
        event.addListener(this.popup.container, "mouseout", this.mouseOutListener.bind(this));
        this.popup.on("changeHoverMarker", this.tooltipTimer.bind(null, null));
        this.popup.renderer.on("afterRender", this.$onPopupRender.bind(this));
        return this.popup;
    };
    Autocomplete.prototype.$initInline = function () {
        if (!this.inlineEnabled || this.inlineRenderer)
            return;
        this.inlineRenderer = new AceInline();
        return this.inlineRenderer;
    };
    Autocomplete.prototype.getPopup = function () {
        return this.popup || this.$init();
    };
    Autocomplete.prototype.$onHidePopup = function () {
        if (this.inlineRenderer) {
            this.inlineRenderer.hide();
        }
        this.hideDocTooltip();
        this.stickySelectionTimer.cancel();
        this.popupTimer.cancel();
        this.stickySelection = false;
    };
    Autocomplete.prototype.$seen = function (completion) {
        if (!this.hasSeen.has(completion) && completion && completion.completer && completion.completer.onSeen && typeof completion.completer.onSeen === "function") {
            completion.completer.onSeen(this.editor, completion);
            this.hasSeen.add(completion);
        }
    };
    Autocomplete.prototype.$onPopupChange = function (hide) {
        if (this.inlineRenderer && this.inlineEnabled) {
            var completion = hide ? null : this.popup.getData(this.popup.getRow());
            this.$updateGhostText(completion);
            if (this.popup.isMouseOver && this.setSelectOnHover) {
                this.tooltipTimer.call(null, null);
                return;
            }
            this.popupTimer.schedule();
            this.tooltipTimer.schedule();
        }
        else {
            this.popupTimer.call(null, null);
            this.tooltipTimer.call(null, null);
        }
    };
    Autocomplete.prototype.$updateGhostText = function (completion) {
        var row = this.base.row;
        var column = this.base.column;
        var cursorColumn = this.editor.getCursorPosition().column;
        var prefix = this.editor.session.getLine(row).slice(column, cursorColumn);
        if (!this.inlineRenderer.show(this.editor, completion, prefix)) {
            this.inlineRenderer.hide();
        }
        else {
            this.$seen(completion);
        }
    };
    Autocomplete.prototype.$onPopupRender = function () {
        var inlineEnabled = this.inlineRenderer && this.inlineEnabled;
        if (this.completions && this.completions.filtered && this.completions.filtered.length > 0) {
            for (var i = this.popup.getFirstVisibleRow(); i <= this.popup.getLastVisibleRow(); i++) {
                var completion = this.popup.getData(i);
                if (completion && (!inlineEnabled || completion.hideInlinePreview)) {
                    this.$seen(completion);
                }
            }
        }
    };
    Autocomplete.prototype.$onPopupShow = function (hide) {
        this.$onPopupChange(hide);
        this.stickySelection = false;
        if (this.stickySelectionDelay >= 0)
            this.stickySelectionTimer.schedule(this.stickySelectionDelay);
    };
    Autocomplete.prototype.observeLayoutChanges = function () {
        if (this.$elements || !this.editor)
            return;
        window.addEventListener("resize", this.onLayoutChange, { passive: true });
        window.addEventListener("wheel", this.mousewheelListener);
        var el = this.editor.container.parentNode;
        var elements = [];
        while (el) {
            elements.push(el);
            el.addEventListener("scroll", this.onLayoutChange, { passive: true });
            el = el.parentNode;
        }
        this.$elements = elements;
    };
    Autocomplete.prototype.unObserveLayoutChanges = function () {
        var _this = this;
        window.removeEventListener("resize", this.onLayoutChange, { passive: true });
        window.removeEventListener("wheel", this.mousewheelListener);
        this.$elements && this.$elements.forEach(function (el) {
            el.removeEventListener("scroll", _this.onLayoutChange, { passive: true });
        });
        this.$elements = null;
    };
    Autocomplete.prototype.onLayoutChange = function () {
        if (!this.popup.isOpen)
            return this.unObserveLayoutChanges();
        this.$updatePopupPosition();
        this.updateDocTooltip();
    };
    Autocomplete.prototype.$updatePopupPosition = function () {
        var editor = this.editor;
        var renderer = editor.renderer;
        var lineHeight = renderer.layerConfig.lineHeight;
        var pos = renderer.$cursorLayer.getPixelPosition(this.base, true);
        pos.left -= this.popup.getTextLeftOffset();
        var rect = editor.container.getBoundingClientRect();
        pos.top += rect.top - renderer.layerConfig.offset;
        pos.left += rect.left - editor.renderer.scrollLeft;
        pos.left += renderer.gutterWidth;
        var posGhostText = {
            top: pos.top,
            left: pos.left
        };
        if (renderer.$ghostText && renderer.$ghostTextWidget) {
            if (this.base.row === renderer.$ghostText.position.row) {
                posGhostText.top += renderer.$ghostTextWidget.el.offsetHeight;
            }
        }
        var editorContainerBottom = editor.container.getBoundingClientRect().bottom - lineHeight;
        var lowestPosition = editorContainerBottom < posGhostText.top ?
            { top: editorContainerBottom, left: posGhostText.left } :
            posGhostText;
        if (this.popup.tryShow(lowestPosition, lineHeight, "bottom")) {
            return;
        }
        if (this.popup.tryShow(pos, lineHeight, "top")) {
            return;
        }
        this.popup.show(pos, lineHeight);
    };
    Autocomplete.prototype.openPopup = function (editor, prefix, keepPopupPosition) {
        this.$firstOpenTimer.cancel();
        if (!this.popup)
            this.$init();
        if (this.inlineEnabled && !this.inlineRenderer)
            this.$initInline();
        this.popup.autoSelect = this.autoSelect;
        this.popup.setSelectOnHover(this.setSelectOnHover);
        var oldRow = this.popup.getRow();
        var previousSelectedItem = this.popup.data[oldRow];
        this.popup.setData(this.completions.filtered, this.completions.filterText);
        if (this.editor.textInput.setAriaOptions) {
            this.editor.textInput.setAriaOptions({
                activeDescendant: getAriaId(this.popup.getRow()),
                inline: this.inlineEnabled
            });
        }
        editor.keyBinding.addKeyboardHandler(this.keyboardHandler);
        var newRow;
        if (this.stickySelection)
            newRow = this.popup.data.indexOf(previousSelectedItem);
        if (!newRow || newRow === -1)
            newRow = 0;
        this.popup.setRow(this.autoSelect ? newRow : -1);
        if (newRow === oldRow && previousSelectedItem !== this.completions.filtered[newRow])
            this.$onPopupChange();
        var inlineEnabled = this.inlineRenderer && this.inlineEnabled;
        if (newRow === oldRow && inlineEnabled) {
            var completion = this.popup.getData(this.popup.getRow());
            this.$updateGhostText(completion);
        }
        if (!keepPopupPosition) {
            this.popup.setTheme(editor.getTheme());
            this.popup.setFontSize(editor.getFontSize());
            this.$updatePopupPosition();
            if (this.tooltipNode) {
                this.updateDocTooltip();
            }
        }
        this.changeTimer.cancel();
        this.observeLayoutChanges();
    };
    Autocomplete.prototype.detach = function () {
        if (this.editor) {
            this.editor.keyBinding.removeKeyboardHandler(this.keyboardHandler);
            this.editor.off("changeSelection", this.changeListener);
            this.editor.off("blur", this.blurListener);
            this.editor.off("mousedown", this.mousedownListener);
            this.editor.off("mousewheel", this.mousewheelListener);
        }
        this.$firstOpenTimer.cancel();
        this.changeTimer.cancel();
        this.hideDocTooltip();
        if (this.completionProvider) {
            this.completionProvider.detach();
        }
        if (this.popup && this.popup.isOpen)
            this.popup.hide();
        if (this.popup && this.popup.renderer) {
            this.popup.renderer.off("afterRender", this.$onPopupRender);
        }
        if (this.base)
            this.base.detach();
        this.activated = false;
        this.completionProvider = this.completions = this.base = null;
        this.unObserveLayoutChanges();
    };
    Autocomplete.prototype.changeListener = function (e) {
        var cursor = this.editor.selection.lead;
        if (cursor.row != this.base.row || cursor.column < this.base.column) {
            this.detach();
        }
        if (this.activated)
            this.changeTimer.schedule();
        else
            this.detach();
    };
    Autocomplete.prototype.blurListener = function (e) {
        var el = document.activeElement;
        var text = this.editor.textInput.getElement();
        var fromTooltip = e.relatedTarget && this.tooltipNode && this.tooltipNode.contains(e.relatedTarget);
        var container = this.popup && this.popup.container;
        if (el != text && el.parentNode != container && !fromTooltip
            && el != this.tooltipNode && e.relatedTarget != text) {
            this.detach();
        }
    };
    Autocomplete.prototype.mousedownListener = function (e) {
        this.detach();
    };
    Autocomplete.prototype.mousewheelListener = function (e) {
        if (this.popup && !this.popup.isMouseOver)
            this.detach();
    };
    Autocomplete.prototype.mouseOutListener = function (e) {
        if (this.popup.isOpen)
            this.$updatePopupPosition();
    };
    Autocomplete.prototype.goTo = function (where) {
        this.popup.goTo(where);
    };
    Autocomplete.prototype.insertMatch = function (data, options) {
        if (!data)
            data = this.popup.getData(this.popup.getRow());
        if (!data)
            return false;
        if (data.value === "") // Explicitly given nothing to insert, e.g. "No suggestion state"
            return this.detach();
        var completions = this.completions;
        var result = this.getCompletionProvider().insertMatch(this.editor, data, completions.filterText, options);
        if (this.completions == completions)
            this.detach();
        return result;
    };
    Autocomplete.prototype.showPopup = function (editor, options) {
        if (this.editor)
            this.detach();
        this.activated = true;
        this.editor = editor;
        if (editor.completer != this) {
            if (editor.completer)
                editor.completer.detach();
            editor.completer = this;
        }
        editor.on("changeSelection", this.changeListener);
        editor.on("blur", this.blurListener);
        editor.on("mousedown", this.mousedownListener);
        editor.on("mousewheel", this.mousewheelListener);
        this.updateCompletions(false, options);
    };
    Autocomplete.prototype.getCompletionProvider = function (initialPosition) {
        if (!this.completionProvider)
            this.completionProvider = new CompletionProvider(initialPosition);
        return this.completionProvider;
    };
    Autocomplete.prototype.gatherCompletions = function (editor, callback) {
        return this.getCompletionProvider().gatherCompletions(editor, callback);
    };
    Autocomplete.prototype.updateCompletions = function (keepPopupPosition, options) {
        if (keepPopupPosition && this.base && this.completions) {
            var pos = this.editor.getCursorPosition();
            var prefix = this.editor.session.getTextRange({ start: this.base, end: pos });
            if (prefix == this.completions.filterText)
                return;
            this.completions.setFilter(prefix);
            if (!this.completions.filtered.length)
                return this.detach();
            if (this.completions.filtered.length == 1
                && this.completions.filtered[0].value == prefix
                && !this.completions.filtered[0].snippet)
                return this.detach();
            this.openPopup(this.editor, prefix, keepPopupPosition);
            return;
        }
        if (options && options.matches) {
            var pos = this.editor.getSelectionRange().start;
            this.base = this.editor.session.doc.createAnchor(pos.row, pos.column);
            this.base.$insertRight = true;
            this.completions = new FilteredList(options.matches);
            this.getCompletionProvider().completions = this.completions;
            return this.openPopup(this.editor, "", keepPopupPosition);
        }
        var session = this.editor.getSession();
        var pos = this.editor.getCursorPosition();
        var prefix = util.getCompletionPrefix(this.editor);
        this.base = session.doc.createAnchor(pos.row, pos.column - prefix.length);
        this.base.$insertRight = true;
        var completionOptions = {
            exactMatch: this.exactMatch,
            ignoreCaption: this.ignoreCaption
        };
        this.getCompletionProvider({
            prefix: prefix,
            pos: pos
        }).provideCompletions(this.editor, completionOptions, 
        function (err, completions, finished) {
            var filtered = completions.filtered;
            var prefix = util.getCompletionPrefix(this.editor);
            this.$firstOpenTimer.cancel();
            if (finished) {
                if (!filtered.length) {
                    var emptyMessage = !this.autoShown && this.emptyMessage;
                    if (typeof emptyMessage == "function")
                        emptyMessage = this.emptyMessage(prefix);
                    if (emptyMessage) {
                        var completionsForEmpty = [{
                                caption: emptyMessage,
                                value: ""
                            }
                        ];
                        this.completions = new FilteredList(completionsForEmpty);
                        this.openPopup(this.editor, prefix, keepPopupPosition);
                        this.popup.renderer.setStyle("ace_loading", false);
                        this.popup.renderer.setStyle("ace_empty-message", true);
                        return;
                    }
                    return this.detach();
                }
                if (filtered.length == 1 && filtered[0].value == prefix
                    && !filtered[0].snippet)
                    return this.detach();
                if (this.autoInsert && !this.autoShown && filtered.length == 1)
                    return this.insertMatch(filtered[0]);
            }
            this.completions = !finished && this.showLoadingState ?
                new FilteredList(Autocomplete.completionsForLoading.concat(filtered), completions.filterText) :
                completions;
            this.openPopup(this.editor, prefix, keepPopupPosition);
            this.popup.renderer.setStyle("ace_empty-message", false);
            this.popup.renderer.setStyle("ace_loading", !finished);
        }.bind(this));
        if (this.showLoadingState && !this.autoShown && !(this.popup && this.popup.isOpen)) {
            this.$firstOpenTimer.delay(this.stickySelectionDelay / 2);
        }
    };
    Autocomplete.prototype.cancelContextMenu = function () {
        this.editor.$mouseHandler.cancelContextMenu();
    };
    Autocomplete.prototype.updateDocTooltip = function () {
        var popup = this.popup;
        var all = this.completions.filtered;
        var selected = all && (all[popup.getHoveredRow()] || all[popup.getRow()]);
        var doc = null;
        if (!selected || !this.editor || !this.popup.isOpen)
            return this.hideDocTooltip();
        var completersLength = this.editor.completers.length;
        for (var i = 0; i < completersLength; i++) {
            var completer = this.editor.completers[i];
            if (completer.getDocTooltip && selected.completerId === completer.id) {
                doc = completer.getDocTooltip(selected);
                break;
            }
        }
        if (!doc && typeof selected != "string")
            doc = selected;
        if (typeof doc == "string")
            doc = { docText: doc };
        if (!doc || !(doc.docHTML || doc.docText))
            return this.hideDocTooltip();
        this.showDocTooltip(doc);
    };
    Autocomplete.prototype.showDocTooltip = function (item) {
        if (!this.tooltipNode) {
            this.tooltipNode = dom.createElement("div");
            this.tooltipNode.style.margin = "0";
            this.tooltipNode.style.pointerEvents = "auto";
            this.tooltipNode.style.overscrollBehavior = "contain";
            this.tooltipNode.tabIndex = -1;
            this.tooltipNode.onblur = this.blurListener.bind(this);
            this.tooltipNode.onclick = this.onTooltipClick.bind(this);
            this.tooltipNode.id = "doc-tooltip";
            this.tooltipNode.setAttribute("role", "tooltip");
            this.tooltipNode.addEventListener("wheel", preventParentScroll);
        }
        var theme = this.editor.renderer.theme;
        this.tooltipNode.className = "ace_tooltip ace_doc-tooltip " +
            (theme.isDark ? "ace_dark " : "") + (theme.cssClass || "");
        var tooltipNode = this.tooltipNode;
        if (item.docHTML) {
            tooltipNode.innerHTML = item.docHTML;
        }
        else if (item.docText) {
            tooltipNode.textContent = item.docText;
        }
        if (!tooltipNode.parentNode)
            this.popup.container.appendChild(this.tooltipNode);
        var popup = this.popup;
        var rect = popup.container.getBoundingClientRect();
        tooltipNode.style.top = popup.container.style.top;
        tooltipNode.style.bottom = popup.container.style.bottom;
        tooltipNode.style.display = "block";
        if (window.innerWidth - rect.right < 320) {
            if (rect.left < 320) {
                if (popup.isTopdown) {
                    tooltipNode.style.top = rect.bottom + "px";
                    tooltipNode.style.left = rect.left + "px";
                    tooltipNode.style.right = "";
                    tooltipNode.style.bottom = "";
                }
                else {
                    tooltipNode.style.top = popup.container.offsetTop - tooltipNode.offsetHeight + "px";
                    tooltipNode.style.left = rect.left + "px";
                    tooltipNode.style.right = "";
                    tooltipNode.style.bottom = "";
                }
            }
            else {
                tooltipNode.style.right = window.innerWidth - rect.left + "px";
                tooltipNode.style.left = "";
            }
        }
        else {
            tooltipNode.style.left = (rect.right + 1) + "px";
            tooltipNode.style.right = "";
        }
    };
    Autocomplete.prototype.hideDocTooltip = function () {
        this.tooltipTimer.cancel();
        if (!this.tooltipNode)
            return;
        var el = this.tooltipNode;
        if (!this.editor.isFocused() && document.activeElement == el)
            this.editor.focus();
        this.tooltipNode = null;
        if (el.parentNode)
            el.parentNode.removeChild(el);
    };
    Autocomplete.prototype.onTooltipClick = function (e) {
        var a = e.target;
        while (a && a != this.tooltipNode) {
            if (a.nodeName == "A" && a.href) {
                a.rel = "noreferrer";
                a.target = "_blank";
                break;
            }
            a = a.parentNode;
        }
    };
    Autocomplete.prototype.destroy = function () {
        this.detach();
        if (this.popup) {
            this.popup.destroy();
            var el = this.popup.container;
            if (el && el.parentNode)
                el.parentNode.removeChild(el);
        }
        if (this.editor && this.editor.completer == this) {
            this.editor.off("destroy", destroyCompleter);
            this.editor.completer = null;
        }
        this.inlineRenderer = this.popup = this.editor = null;
    };
    return Autocomplete;
}());
Autocomplete.prototype.commands = {
    "Up": function (editor) { editor.completer.goTo("up"); },
    "Down": function (editor) { editor.completer.goTo("down"); },
    "Ctrl-Up|Ctrl-Home": function (editor) { editor.completer.goTo("start"); },
    "Ctrl-Down|Ctrl-End": function (editor) { editor.completer.goTo("end"); },
    "Esc": function (editor) { editor.completer.detach(); },
    "Return": function (editor) { return editor.completer.insertMatch(); },
    "Shift-Return": function (editor) { editor.completer.insertMatch(null, { deleteSuffix: true }); },
    "Tab": function (editor) {
        var result = editor.completer.insertMatch();
        if (!result && !editor.tabstopManager)
            editor.completer.goTo("down");
        else
            return result;
    },
    "Backspace": function (editor) {
        editor.execCommand("backspace");
        var prefix = util.getCompletionPrefix(editor);
        if (!prefix && editor.completer)
            editor.completer.detach();
    },
    "PageUp": function (editor) { editor.completer.popup.gotoPageUp(); },
    "PageDown": function (editor) { editor.completer.popup.gotoPageDown(); }
};
Autocomplete.for = function (editor) {
    if (editor.completer instanceof Autocomplete) {
        return editor.completer;
    }
    if (editor.completer) {
        editor.completer.destroy();
        editor.completer = null;
    }
    if (config.get("sharedPopups")) {
        if (!Autocomplete["$sharedInstance"])
            Autocomplete["$sharedInstance"] = new Autocomplete();
        editor.completer = Autocomplete["$sharedInstance"];
    }
    else {
        editor.completer = new Autocomplete();
        editor.once("destroy", destroyCompleter);
    }
    return editor.completer;
};
Autocomplete.startCommand = {
    name: "startAutocomplete",
    exec: function (editor, options) {
        var completer = Autocomplete.for(editor);
        completer.autoInsert = false;
        completer.autoSelect = true;
        completer.autoShown = false;
        completer.showPopup(editor, options);
        completer.cancelContextMenu();
    },
    bindKey: "Ctrl-Space|Ctrl-Shift-Space|Alt-Space"
};
var CompletionProvider = /** @class */ (function () {
    function CompletionProvider(initialPosition) {
        this.initialPosition = initialPosition;
        this.active = true;
    }
    CompletionProvider.prototype.insertByIndex = function (editor, index, options) {
        if (!this.completions || !this.completions.filtered) {
            return false;
        }
        return this.insertMatch(editor, this.completions.filtered[index], options);
    };
    CompletionProvider.prototype.insertMatch = function (editor, data, options) {
        if (!data)
            return false;
        editor.startOperation({ command: { name: "insertMatch" } });
        if (data.completer && data.completer.insertMatch) {
            data.completer.insertMatch(editor, data);
        }
        else {
            if (!this.completions)
                return false;
            var replaceBefore = this.completions.filterText.length;
            var replaceAfter = 0;
            if (data.range && data.range.start.row === data.range.end.row) {
                replaceBefore -= this.initialPosition.prefix.length;
                replaceBefore += this.initialPosition.pos.column - data.range.start.column;
                replaceAfter += data.range.end.column - this.initialPosition.pos.column;
            }
            if (replaceBefore || replaceAfter) {
                var ranges;
                if (editor.selection.getAllRanges) {
                    ranges = editor.selection.getAllRanges();
                }
                else {
                    ranges = [editor.getSelectionRange()];
                }
                for (var i = 0, range; range = ranges[i]; i++) {
                    range.start.column -= replaceBefore;
                    range.end.column += replaceAfter;
                    editor.session.remove(range);
                }
            }
            if (data.snippet) {
                snippetManager.insertSnippet(editor, data.snippet);
            }
            else {
                this.$insertString(editor, data);
            }
            if (data.completer && data.completer.onInsert && typeof data.completer.onInsert == "function") {
                data.completer.onInsert(editor, data);
            }
            if (data.command && data.command === "startAutocomplete") {
                editor.execCommand(data.command);
            }
        }
        editor.endOperation();
        return true;
    };
    CompletionProvider.prototype.$insertString = function (editor, data) {
        var text = data.value || data;
        editor.execCommand("insertstring", text);
    };
    CompletionProvider.prototype.gatherCompletions = function (editor, callback) {
        var session = editor.getSession();
        var pos = editor.getCursorPosition();
        var prefix = util.getCompletionPrefix(editor);
        var matches = [];
        this.completers = editor.completers;
        var total = editor.completers.length;
        editor.completers.forEach(function (completer, i) {
            completer.getCompletions(editor, session, pos, prefix, function (err, results) {
                if (completer.hideInlinePreview)
                    results = results.map(function (result) {
                        return Object.assign(result, { hideInlinePreview: completer.hideInlinePreview });
                    });
                if (!err && results)
                    matches = matches.concat(results);
                callback(null, {
                    prefix: util.getCompletionPrefix(editor),
                    matches: matches,
                    finished: (--total === 0)
                });
            });
        });
        return true;
    };
    CompletionProvider.prototype.provideCompletions = function (editor, options, callback) {
        var processResults = function (results) {
            var prefix = results.prefix;
            var matches = results.matches;
            this.completions = new FilteredList(matches);
            if (options.exactMatch)
                this.completions.exactMatch = true;
            if (options.ignoreCaption)
                this.completions.ignoreCaption = true;
            this.completions.setFilter(prefix);
            if (results.finished || this.completions.filtered.length)
                callback(null, this.completions, results.finished);
        }.bind(this);
        var isImmediate = true;
        var immediateResults = null;
        this.gatherCompletions(editor, function (err, results) {
            if (!this.active) {
                return;
            }
            if (err) {
                callback(err, [], true);
                this.detach();
            }
            var prefix = results.prefix;
            if (prefix.indexOf(results.prefix) !== 0)
                return;
            if (isImmediate) {
                immediateResults = results;
                return;
            }
            processResults(results);
        }.bind(this));
        isImmediate = false;
        if (immediateResults) {
            var results = immediateResults;
            immediateResults = null;
            processResults(results);
        }
    };
    CompletionProvider.prototype.detach = function () {
        this.active = false;
        this.completers && this.completers.forEach(function (completer) {
            if (typeof completer.cancel === "function") {
                completer.cancel();
            }
        });
    };
    return CompletionProvider;
}());
var FilteredList = /** @class */ (function () {
    function FilteredList(array, filterText) {
        this.all = array;
        this.filtered = array;
        this.filterText = filterText || "";
        this.exactMatch = false;
        this.ignoreCaption = false;
    }
    FilteredList.prototype.setFilter = function (str) {
        if (str.length > this.filterText && str.lastIndexOf(this.filterText, 0) === 0)
            var matches = this.filtered;
        else
            var matches = this.all;
        this.filterText = str;
        matches = this.filterCompletions(matches, this.filterText);
        matches = matches.sort(function (a, b) {
            return b.exactMatch - a.exactMatch || b.$score - a.$score
                || (a.caption || a.value).localeCompare(b.caption || b.value);
        });
        var prev = null;
        matches = matches.filter(function (item) {
            var caption = item.snippet || item.caption || item.value;
            if (caption === prev)
                return false;
            prev = caption;
            return true;
        });
        this.filtered = matches;
    };
    FilteredList.prototype.filterCompletions = function (items, needle) {
        var results = [];
        var upper = needle.toUpperCase();
        var lower = needle.toLowerCase();
        loop: for (var i = 0, item; item = items[i]; i++) {
            var caption = (!this.ignoreCaption && item.caption) || item.value || item.snippet;
            if (!caption)
                continue;
            var lastIndex = -1;
            var matchMask = 0;
            var penalty = 0;
            var index, distance;
            if (this.exactMatch) {
                if (needle !== caption.substr(0, needle.length))
                    continue loop;
            }
            else {
                var fullMatchIndex = caption.toLowerCase().indexOf(lower);
                if (fullMatchIndex > -1) {
                    penalty = fullMatchIndex;
                }
                else {
                    for (var j = 0; j < needle.length; j++) {
                        var i1 = caption.indexOf(lower[j], lastIndex + 1);
                        var i2 = caption.indexOf(upper[j], lastIndex + 1);
                        index = (i1 >= 0) ? ((i2 < 0 || i1 < i2) ? i1 : i2) : i2;
                        if (index < 0)
                            continue loop;
                        distance = index - lastIndex - 1;
                        if (distance > 0) {
                            if (lastIndex === -1)
                                penalty += 10;
                            penalty += distance;
                            matchMask = matchMask | (1 << j);
                        }
                        lastIndex = index;
                    }
                }
            }
            item.matchMask = matchMask;
            item.exactMatch = penalty ? 0 : 1;
            item.$score = (item.score || 0) - penalty;
            results.push(item);
        }
        return results;
    };
    return FilteredList;
}());
exports.Autocomplete = Autocomplete;
exports.CompletionProvider = CompletionProvider;
exports.FilteredList = FilteredList;

});

ace.define("ace/autocomplete/text_completer",[], function(require, exports, module){var Range = require("../range").Range;
var splitRegex = /[^a-zA-Z_0-9\$\-\u00C0-\u1FFF\u2C00-\uD7FF\w]+/;
function getWordIndex(doc, pos) {
    var textBefore = doc.getTextRange(Range.fromPoints({
        row: 0,
        column: 0
    }, pos));
    return textBefore.split(splitRegex).length - 1;
}
function wordDistance(doc, pos) {
    var prefixPos = getWordIndex(doc, pos);
    var words = doc.getValue().split(splitRegex);
    var wordScores = Object.create(null);
    var currentWord = words[prefixPos];
    words.forEach(function (word, idx) {
        if (!word || word === currentWord)
            return;
        var distance = Math.abs(prefixPos - idx);
        var score = words.length - distance;
        if (wordScores[word]) {
            wordScores[word] = Math.max(score, wordScores[word]);
        }
        else {
            wordScores[word] = score;
        }
    });
    return wordScores;
}
exports.getCompletions = function (editor, session, pos, prefix, callback) {
    var wordScore = wordDistance(session, pos);
    var wordList = Object.keys(wordScore);
    callback(null, wordList.map(function (word) {
        return {
            caption: word,
            value: word,
            score: wordScore[word],
            meta: "local"
        };
    }));
};

});

ace.define("ace/ext/language_tools",[], function(require, exports, module){"use strict";
var snippetManager = require("../snippets").snippetManager;
var Autocomplete = require("../autocomplete").Autocomplete;
var config = require("../config");
var lang = require("../lib/lang");
var util = require("../autocomplete/util");
var textCompleter = require("../autocomplete/text_completer");
var keyWordCompleter = {
    getCompletions: function (editor, session, pos, prefix, callback) {
        if (session.$mode.completer) {
            return session.$mode.completer.getCompletions(editor, session, pos, prefix, callback);
        }
        var state = editor.session.getState(pos.row);
        var completions = session.$mode.getCompletions(state, session, pos, prefix);
        completions = completions.map(function (el) {
            el.completerId = keyWordCompleter.id;
            return el;
        });
        callback(null, completions);
    },
    id: "keywordCompleter"
};
var transformSnippetTooltip = function (str) {
    var record = {};
    return str.replace(/\${(\d+)(:(.*?))?}/g, function (_, p1, p2, p3) {
        return (record[p1] = p3 || '');
    }).replace(/\$(\d+?)/g, function (_, p1) {
        return record[p1];
    });
};
var snippetCompleter = {
    getCompletions: function (editor, session, pos, prefix, callback) {
        var scopes = [];
        var token = session.getTokenAt(pos.row, pos.column);
        if (token && token.type.match(/(tag-name|tag-open|tag-whitespace|attribute-name|attribute-value)\.xml$/))
            scopes.push('html-tag');
        else
            scopes = snippetManager.getActiveScopes(editor);
        var snippetMap = snippetManager.snippetMap;
        var completions = [];
        scopes.forEach(function (scope) {
            var snippets = snippetMap[scope] || [];
            for (var i = snippets.length; i--;) {
                var s = snippets[i];
                var caption = s.name || s.tabTrigger;
                if (!caption)
                    continue;
                completions.push({
                    caption: caption,
                    snippet: s.content,
                    meta: s.tabTrigger && !s.name ? s.tabTrigger + "\u21E5 " : "snippet",
                    completerId: snippetCompleter.id
                });
            }
        }, this);
        callback(null, completions);
    },
    getDocTooltip: function (item) {
        if (item.snippet && !item.docHTML) {
            item.docHTML = [
                "<b>", lang.escapeHTML(item.caption), "</b>", "<hr></hr>",
                lang.escapeHTML(transformSnippetTooltip(item.snippet))
            ].join("");
        }
    },
    id: "snippetCompleter"
};
var completers = [snippetCompleter, textCompleter, keyWordCompleter];
exports.setCompleters = function (val) {
    completers.length = 0;
    if (val)
        completers.push.apply(completers, val);
};
exports.addCompleter = function (completer) {
    completers.push(completer);
};
exports.textCompleter = textCompleter;
exports.keyWordCompleter = keyWordCompleter;
exports.snippetCompleter = snippetCompleter;
var expandSnippet = {
    name: "expandSnippet",
    exec: function (editor) {
        return snippetManager.expandWithTab(editor);
    },
    bindKey: "Tab"
};
var onChangeMode = function (e, editor) {
    loadSnippetsForMode(editor.session.$mode);
};
var loadSnippetsForMode = function (mode) {
    if (typeof mode == "string")
        mode = config.$modes[mode];
    if (!mode)
        return;
    if (!snippetManager.files)
        snippetManager.files = {};
    loadSnippetFile(mode.$id, mode.snippetFileId);
    if (mode.modes)
        mode.modes.forEach(loadSnippetsForMode);
};
var loadSnippetFile = function (id, snippetFilePath) {
    if (!snippetFilePath || !id || snippetManager.files[id])
        return;
    snippetManager.files[id] = {};
    config.loadModule(snippetFilePath, function (m) {
        if (!m)
            return;
        snippetManager.files[id] = m;
        if (!m.snippets && m.snippetText)
            m.snippets = snippetManager.parseSnippetFile(m.snippetText);
        snippetManager.register(m.snippets || [], m.scope);
        if (m.includeScopes) {
            snippetManager.snippetMap[m.scope].includeScopes = m.includeScopes;
            m.includeScopes.forEach(function (x) {
                loadSnippetsForMode("ace/mode/" + x);
            });
        }
    });
};
var doLiveAutocomplete = function (e) {
    var editor = e.editor;
    var hasCompleter = editor.completer && editor.completer.activated;
    if (e.command.name === "backspace") {
        if (hasCompleter && !util.getCompletionPrefix(editor))
            editor.completer.detach();
    }
    else if (e.command.name === "insertstring" && !hasCompleter) {
        lastExecEvent = e;
        var delay = e.editor.$liveAutocompletionDelay;
        if (delay) {
            liveAutocompleteTimer.delay(delay);
        }
        else {
            showLiveAutocomplete(e);
        }
    }
};
var lastExecEvent;
var liveAutocompleteTimer = lang.delayedCall(function () {
    showLiveAutocomplete(lastExecEvent);
}, 0);
var showLiveAutocomplete = function (e) {
    var editor = e.editor;
    var prefix = util.getCompletionPrefix(editor);
    var previousChar = e.args;
    var triggerAutocomplete = util.triggerAutocomplete(editor, previousChar);
    if (prefix && prefix.length >= editor.$liveAutocompletionThreshold || triggerAutocomplete) {
        var completer = Autocomplete.for(editor);
        completer.autoShown = true;
        completer.showPopup(editor);
    }
};
var Editor = require("../editor").Editor;
require("../config").defineOptions(Editor.prototype, "editor", {
    enableBasicAutocompletion: {
        set: function (val) {
            if (val) {
                if (!this.completers)
                    this.completers = Array.isArray(val) ? val : completers;
                this.commands.addCommand(Autocomplete.startCommand);
            }
            else {
                this.commands.removeCommand(Autocomplete.startCommand);
            }
        },
        value: false
    },
    enableLiveAutocompletion: {
        set: function (val) {
            if (val) {
                if (!this.completers)
                    this.completers = Array.isArray(val) ? val : completers;
                this.commands.on('afterExec', doLiveAutocomplete);
            }
            else {
                this.commands.off('afterExec', doLiveAutocomplete);
            }
        },
        value: false
    },
    liveAutocompletionDelay: {
        initialValue: 0
    },
    liveAutocompletionThreshold: {
        initialValue: 0
    },
    enableSnippets: {
        set: function (val) {
            if (val) {
                this.commands.addCommand(expandSnippet);
                this.on("changeMode", onChangeMode);
                onChangeMode(null, this);
            }
            else {
                this.commands.removeCommand(expandSnippet);
                this.off("changeMode", onChangeMode);
            }
        },
        value: false
    }
});

});                (function() {
                    ace.require(["ace/ext/language_tools"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            