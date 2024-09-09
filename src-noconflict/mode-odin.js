ace.define("ace/mode/doc_comment_highlight_rules",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var DocCommentHighlightRules = function () {
    this.$rules = {
        "start": [
            {
                token: "comment.doc.tag",
                regex: "@\\w+(?=\\s|$)"
            }, DocCommentHighlightRules.getTagRule(), {
                defaultToken: "comment.doc.body",
                caseInsensitive: true
            }
        ]
    };
};
oop.inherits(DocCommentHighlightRules, TextHighlightRules);
DocCommentHighlightRules.getTagRule = function (start) {
    return {
        token: "comment.doc.tag.storage.type",
        regex: "\\b(?:TODO|FIXME|XXX|HACK)\\b"
    };
};
DocCommentHighlightRules.getStartRule = function (start) {
    return {
        token: "comment.doc", // doc comment
        regex: /\/\*\*(?!\/)/,
        next: start
    };
};
DocCommentHighlightRules.getEndRule = function (start) {
    return {
        token: "comment.doc", // closing comment
        regex: "\\*\\/",
        next: start
    };
};
exports.DocCommentHighlightRules = DocCommentHighlightRules;

});

ace.define("ace/mode/odin_highlight_rules",[], function(require, exports, module){var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var oop = require("../lib/oop");
var DocCommentHighlightRules = require("./doc_comment_highlight_rules").DocCommentHighlightRules;
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var OdinHighlightRules = function () {
    var keywords = "using|transmute|cast|distinct|opaque|where|" +
        "struct|enum|union|bit_field|bit_set|" +
        "if|when|else|do|switch|case|break|fallthrough|" +
        "size_of|offset_of|type_info_if|typeid_of|type_of|align_of|" +
        "or_return|or_else|inline|no_inline|" +
        "import|package|foreign|defer|auto_cast|map|matrix|proc|" +
        "for|continue|not_in|in";
    var cartesian = function () {
        var a = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            a[_i] = arguments[_i];
        }
        return a
            .reduce(function (a, b) { return a.flatMap(function (d) { return b.map(function (e) { return [d, e].flat(); }); }); })
            .map(function (parts) { return parts.join(""); });
    };
    var builtinTypes = __spreadArray(__spreadArray(__spreadArray(__spreadArray([
        "int",
        "uint",
        "uintptr",
        "typeid",
        "rawptr",
        "string",
        "cstring",
        "i8",
        "u8",
        "any",
        "byte",
        "rune",
        "bool",
        "b8",
        "b16",
        "b32",
        "b64"
    ], __read(cartesian(["i", "u"], ["16", "32", "64", "128"], ["", "le", "be"])), false), __read(cartesian(["f"], ["16", "32", "64"], ["", "le", "be"])), false), __read(cartesian(["complex"], ["32", "64", "128"])), false), __read(cartesian(["quaternion"], ["64", "128", "256"])), false).join("|");
    var operators = [
        "\\*",
        "/",
        "%",
        "%%",
        "<<",
        ">>",
        "&",
        "&~",
        "\\+",
        "\\-",
        "~",
        "\\|",
        ">",
        "<",
        "<=",
        ">=",
        "==",
        "!="
    ]
        .concat(":")
        .map(function (operator) { return operator + "="; })
        .concat("=", ":=", "::", "->", "\\^", "&", ":")
        .join("|");
    var builtinFunctions = "new|cap|copy|panic|len|make|delete|append|free";
    var builtinConstants = "nil|true|false";
    var keywordMapper = this.createKeywordMapper({
        keyword: keywords,
        "constant.language": builtinConstants,
        "support.function": builtinFunctions,
        "support.type": builtinTypes
    }, "");
    var stringEscapeRe = "\\\\(?:[0-7]{3}|x\\h{2}|u{4}|U\\h{6}|[abfnrtv'\"\\\\])".replace(/\\h/g, "[a-fA-F\\d]");
    this.$rules = {
        start: [
            {
                token: "comment",
                regex: /\/\/.*$/
            },
            DocCommentHighlightRules.getStartRule("doc-start"),
            {
                token: "comment.start", // multi line comment
                regex: "\\/\\*",
                next: "comment"
            },
            {
                token: "string", // single line
                regex: /"(?:[^"\\]|\\.)*?"/
            },
            {
                token: "string", // raw
                regex: "`",
                next: "bqstring"
            },
            {
                token: "support.constant",
                regex: /#[a-z_]+/
            },
            {
                token: "constant.numeric", // rune
                regex: "'(?:[^\\'\uD800-\uDBFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|" +
                    stringEscapeRe.replace('"', "") +
                    ")'"
            },
            {
                token: "constant.numeric", // hex
                regex: "0[xX][0-9a-fA-F]+\\b"
            },
            {
                token: "constant.numeric", // float
                regex: "[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?\\b"
            },
            {
                token: [
                    "entity.name.function",
                    "text",
                    "keyword.operator",
                    "text",
                    "keyword"
                ],
                regex: "([a-zA-Z_$][a-zA-Z0-9_$]*)(\\s+)(::)(\\s+)(proc)\\b"
            },
            {
                token: function (val) {
                    if (val[val.length - 1] == "(") {
                        return [
                            {
                                type: keywordMapper(val.slice(0, -1)) || "support.function",
                                value: val.slice(0, -1)
                            },
                            {
                                type: "paren.lparen",
                                value: val.slice(-1)
                            }
                        ];
                    }
                    return keywordMapper(val) || "identifier";
                },
                regex: "[a-zA-Z_$][a-zA-Z0-9_$]*\\b\\(?"
            },
            {
                token: "keyword.operator",
                regex: operators
            },
            {
                token: "punctuation.operator",
                regex: "\\?|\\,|\\;|\\."
            },
            {
                token: "paren.lparen",
                regex: "[[({]"
            },
            {
                token: "paren.rparen",
                regex: "[\\])}]"
            },
            {
                token: "text",
                regex: "\\s+"
            }
        ],
        comment: [
            {
                token: "comment.end",
                regex: "\\*\\/",
                next: "start"
            },
            {
                defaultToken: "comment"
            }
        ],
        bqstring: [
            {
                token: "string",
                regex: "`",
                next: "start"
            },
            {
                defaultToken: "string"
            }
        ]
    };
    this.embedRules(DocCommentHighlightRules, "doc-", [
        DocCommentHighlightRules.getEndRule("start")
    ]);
};
oop.inherits(OdinHighlightRules, TextHighlightRules);
exports.OdinHighlightRules = OdinHighlightRules;

});

ace.define("ace/mode/matching_brace_outdent",[], function(require, exports, module){"use strict";
var Range = require("../range").Range;
var MatchingBraceOutdent = function () { };
(function () {
    this.checkOutdent = function (line, input) {
        if (!/^\s+$/.test(line))
            return false;
        return /^\s*\}/.test(input);
    };
    this.autoOutdent = function (doc, row) {
        var line = doc.getLine(row);
        var match = line.match(/^(\s*\})/);
        if (!match)
            return 0;
        var column = match[1].length;
        var openBracePos = doc.findMatchingBracket({ row: row, column: column });
        if (!openBracePos || openBracePos.row == row)
            return 0;
        var indent = this.$getIndent(doc.getLine(openBracePos.row));
        doc.replace(new Range(row, 0, row, column - 1), indent);
    };
    this.$getIndent = function (line) {
        return line.match(/^\s*/)[0];
    };
}).call(MatchingBraceOutdent.prototype);
exports.MatchingBraceOutdent = MatchingBraceOutdent;

});

ace.define("ace/mode/folding/cstyle",[], function(require, exports, module){"use strict";
var oop = require("../../lib/oop");
var Range = require("../../range").Range;
var BaseFoldMode = require("./fold_mode").FoldMode;
var FoldMode = exports.FoldMode = function (commentRegex) {
    if (commentRegex) {
        this.foldingStartMarker = new RegExp(this.foldingStartMarker.source.replace(/\|[^|]*?$/, "|" + commentRegex.start));
        this.foldingStopMarker = new RegExp(this.foldingStopMarker.source.replace(/\|[^|]*?$/, "|" + commentRegex.end));
    }
};
oop.inherits(FoldMode, BaseFoldMode);
(function () {
    this.foldingStartMarker = /([\{\[\(])[^\}\]\)]*$|^\s*(\/\*)/;
    this.foldingStopMarker = /^[^\[\{\(]*([\}\]\)])|^[\s\*]*(\*\/)/;
    this.singleLineBlockCommentRe = /^\s*(\/\*).*\*\/\s*$/;
    this.tripleStarBlockCommentRe = /^\s*(\/\*\*\*).*\*\/\s*$/;
    this.startRegionRe = /^\s*(\/\*|\/\/)#?region\b/;
    this._getFoldWidgetBase = this.getFoldWidget;
    this.getFoldWidget = function (session, foldStyle, row) {
        var line = session.getLine(row);
        if (this.singleLineBlockCommentRe.test(line)) {
            if (!this.startRegionRe.test(line) && !this.tripleStarBlockCommentRe.test(line))
                return "";
        }
        var fw = this._getFoldWidgetBase(session, foldStyle, row);
        if (!fw && this.startRegionRe.test(line))
            return "start"; // lineCommentRegionStart
        return fw;
    };
    this.getFoldWidgetRange = function (session, foldStyle, row, forceMultiline) {
        var line = session.getLine(row);
        if (this.startRegionRe.test(line))
            return this.getCommentRegionBlock(session, line, row);
        var match = line.match(this.foldingStartMarker);
        if (match) {
            var i = match.index;
            if (match[1])
                return this.openingBracketBlock(session, match[1], row, i);
            var range = session.getCommentFoldRange(row, i + match[0].length, 1);
            if (range && !range.isMultiLine()) {
                if (forceMultiline) {
                    range = this.getSectionRange(session, row);
                }
                else if (foldStyle != "all")
                    range = null;
            }
            return range;
        }
        if (foldStyle === "markbegin")
            return;
        var match = line.match(this.foldingStopMarker);
        if (match) {
            var i = match.index + match[0].length;
            if (match[1])
                return this.closingBracketBlock(session, match[1], row, i);
            return session.getCommentFoldRange(row, i, -1);
        }
    };
    this.getSectionRange = function (session, row) {
        var line = session.getLine(row);
        var startIndent = line.search(/\S/);
        var startRow = row;
        var startColumn = line.length;
        row = row + 1;
        var endRow = row;
        var maxRow = session.getLength();
        while (++row < maxRow) {
            line = session.getLine(row);
            var indent = line.search(/\S/);
            if (indent === -1)
                continue;
            if (startIndent > indent)
                break;
            var subRange = this.getFoldWidgetRange(session, "all", row);
            if (subRange) {
                if (subRange.start.row <= startRow) {
                    break;
                }
                else if (subRange.isMultiLine()) {
                    row = subRange.end.row;
                }
                else if (startIndent == indent) {
                    break;
                }
            }
            endRow = row;
        }
        return new Range(startRow, startColumn, endRow, session.getLine(endRow).length);
    };
    this.getCommentRegionBlock = function (session, line, row) {
        var startColumn = line.search(/\s*$/);
        var maxRow = session.getLength();
        var startRow = row;
        var re = /^\s*(?:\/\*|\/\/|--)#?(end)?region\b/;
        var depth = 1;
        while (++row < maxRow) {
            line = session.getLine(row);
            var m = re.exec(line);
            if (!m)
                continue;
            if (m[1])
                depth--;
            else
                depth++;
            if (!depth)
                break;
        }
        var endRow = row;
        if (endRow > startRow) {
            return new Range(startRow, startColumn, endRow, line.length);
        }
    };
}).call(FoldMode.prototype);

});

ace.define("ace/mode/odin",[], function(require, exports, module){var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var OdinHighlightRules = require("./odin_highlight_rules").OdinHighlightRules;
var MatchingBraceOutdent = require("./matching_brace_outdent").MatchingBraceOutdent;
var CStyleFoldMode = require("./folding/cstyle").FoldMode;
var Mode = function () {
    this.HighlightRules = OdinHighlightRules;
    this.$outdent = new MatchingBraceOutdent();
    this.foldingRules = new CStyleFoldMode();
    this.$behaviour = this.$defaultBehaviour;
};
oop.inherits(Mode, TextMode);
(function () {
    this.lineCommentStart = "//";
    this.blockComment = { start: "/*", end: "*/" };
    this.getNextLineIndent = function (state, line, tab) {
        var indent = this.$getIndent(line);
        var tokenizedLine = this.getTokenizer().getLineTokens(line, state);
        var tokens = tokenizedLine.tokens;
        if (tokens.length && tokens[tokens.length - 1].type == "comment") {
            return indent;
        }
        if (state == "start") {
            var match = line.match(/^.*[\{\(\[:]\s*$/);
            if (match) {
                indent += tab;
            }
        }
        return indent;
    }; //end getNextLineIndent
    this.checkOutdent = function (state, line, input) {
        return this.$outdent.checkOutdent(line, input);
    };
    this.autoOutdent = function (state, doc, row) {
        this.$outdent.autoOutdent(doc, row);
    };
    this.$id = "ace/mode/odin";
}).call(Mode.prototype);
exports.Mode = Mode;

});                (function() {
                    ace.require(["ace/mode/odin"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            