ace.define("ace/mode/jinja_completions",[], function(require, exports, module){"use strict";
var TokenIterator = require("../token_iterator").TokenIterator;
var jinjaFilters = [
    "abs", "float", "lower", "round", "tojson", "attr",
    "forceescape", "map", "safe", "trim", "batch", "format",
    "max", "select", "truncate", "capitalize", "groupby", "min",
    "selectattr", "unique", "center", "indent", "pprint", "slice",
    "upper", "default", "int", "random", "sort", "urlencode",
    "dictsort", "join", "reject", "string", "urlize", "escape",
    "last", "rejectattr", "striptags", "wordcount", "filesizeformat",
    "length", "replace", "sum", "wordwrap", "first", "list", "reverse",
    "title", "xmlattr"
];
var JinjaCompletions = function () {
};
(function () {
    this.getCompletions = function (keywordList, state, session, pos, prefix) {
        var token = session.getTokenAt(pos.row, pos.column);
        if (!token)
            return [];
        if (this.mayBeJinjaKeyword(token)) {
            return this.getKeywordCompletions(keywordList, state, session, pos, prefix);
        }
        if (this.mayBeJinjaFilter(token)) {
            return this.getFilterCompletions(state, session, pos, prefix);
        }
        if (this.mayBeJinjaVariable(token)) {
            return this.getVariableCompletions(state, session, pos, prefix);
        }
        return [];
    };
    this.mayBeJinjaKeyword = function (token) {
        return token.type === "meta.scope.jinja.tag";
    };
    this.mayBeJinjaFilter = function (token) {
        return token.type === "support.function.other.jinja.filter";
    };
    this.mayBeJinjaVariable = function (token) {
        return token.type === "variable";
    };
    this.getKeywordCompletions = function (keywordList, state, session, pos, prefix) {
        return keywordList.map(function (keyword) {
            return {
                caption: keyword,
                snippet: keyword,
                meta: "keyword",
                score: 1000000
            };
        });
    };
    this.getFilterCompletions = function (state, session, pos, prefix) {
        return jinjaFilters.map(function (filter) {
            return {
                caption: filter,
                snippet: filter,
                meta: "filter",
                score: 1000000
            };
        });
    };
    this.getVariableCompletions = function (state, session, pos, prefix) {
        return [
            { caption: "loop", snippet: "loop", meta: "Nunjucks loop object", score: 1000000 },
            { caption: "super", snippet: "super()", meta: "Nunjucks super function", score: 1000000 }
        ];
    };
}).call(JinjaCompletions.prototype);
exports.JinjaCompletions = JinjaCompletions;

});

ace.define("ace/mode/css_highlight_rules",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var lang = require("../lib/lang");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var supportType = exports.supportType = "align-content|align-items|align-self|all|animation|animation-delay|animation-direction|animation-duration|animation-fill-mode|animation-iteration-count|animation-name|animation-play-state|animation-timing-function|backface-visibility|background|background-attachment|background-blend-mode|background-clip|background-color|background-image|background-origin|background-position|background-repeat|background-size|border|border-bottom|border-bottom-color|border-bottom-left-radius|border-bottom-right-radius|border-bottom-style|border-bottom-width|border-collapse|border-color|border-image|border-image-outset|border-image-repeat|border-image-slice|border-image-source|border-image-width|border-left|border-left-color|border-left-style|border-left-width|border-radius|border-right|border-right-color|border-right-style|border-right-width|border-spacing|border-style|border-top|border-top-color|border-top-left-radius|border-top-right-radius|border-top-style|border-top-width|border-width|bottom|box-shadow|box-sizing|caption-side|clear|clip|color|column-count|column-fill|column-gap|column-rule|column-rule-color|column-rule-style|column-rule-width|column-span|column-width|columns|content|counter-increment|counter-reset|cursor|direction|display|empty-cells|filter|flex|flex-basis|flex-direction|flex-flow|flex-grow|flex-shrink|flex-wrap|float|font|font-family|font-size|font-size-adjust|font-stretch|font-style|font-variant|font-weight|hanging-punctuation|height|justify-content|left|letter-spacing|line-height|list-style|list-style-image|list-style-position|list-style-type|margin|margin-bottom|margin-left|margin-right|margin-top|max-height|max-width|max-zoom|min-height|min-width|min-zoom|nav-down|nav-index|nav-left|nav-right|nav-up|opacity|order|outline|outline-color|outline-offset|outline-style|outline-width|overflow|overflow-x|overflow-y|padding|padding-bottom|padding-left|padding-right|padding-top|page-break-after|page-break-before|page-break-inside|perspective|perspective-origin|position|quotes|resize|right|tab-size|table-layout|text-align|text-align-last|text-decoration|text-decoration-color|text-decoration-line|text-decoration-style|text-indent|text-justify|text-overflow|text-shadow|text-transform|top|transform|transform-origin|transform-style|transition|transition-delay|transition-duration|transition-property|transition-timing-function|unicode-bidi|user-select|user-zoom|vertical-align|visibility|white-space|width|word-break|word-spacing|word-wrap|z-index";
var supportFunction = exports.supportFunction = "rgb|rgba|url|attr|counter|counters";
var supportConstant = exports.supportConstant = "absolute|after-edge|after|all-scroll|all|alphabetic|always|antialiased|armenian|auto|avoid-column|avoid-page|avoid|balance|baseline|before-edge|before|below|bidi-override|block-line-height|block|bold|bolder|border-box|both|bottom|box|break-all|break-word|capitalize|caps-height|caption|center|central|char|circle|cjk-ideographic|clone|close-quote|col-resize|collapse|column|consider-shifts|contain|content-box|cover|crosshair|cubic-bezier|dashed|decimal-leading-zero|decimal|default|disabled|disc|disregard-shifts|distribute-all-lines|distribute-letter|distribute-space|distribute|dotted|double|e-resize|ease-in|ease-in-out|ease-out|ease|ellipsis|end|exclude-ruby|flex-end|flex-start|fill|fixed|georgian|glyphs|grid-height|groove|hand|hanging|hebrew|help|hidden|hiragana-iroha|hiragana|horizontal|icon|ideograph-alpha|ideograph-numeric|ideograph-parenthesis|ideograph-space|ideographic|inactive|include-ruby|inherit|initial|inline-block|inline-box|inline-line-height|inline-table|inline|inset|inside|inter-ideograph|inter-word|invert|italic|justify|katakana-iroha|katakana|keep-all|last|left|lighter|line-edge|line-through|line|linear|list-item|local|loose|lower-alpha|lower-greek|lower-latin|lower-roman|lowercase|lr-tb|ltr|mathematical|max-height|max-size|medium|menu|message-box|middle|move|n-resize|ne-resize|newspaper|no-change|no-close-quote|no-drop|no-open-quote|no-repeat|none|normal|not-allowed|nowrap|nw-resize|oblique|open-quote|outset|outside|overline|padding-box|page|pointer|pre-line|pre-wrap|pre|preserve-3d|progress|relative|repeat-x|repeat-y|repeat|replaced|reset-size|ridge|right|round|row-resize|rtl|s-resize|scroll|se-resize|separate|slice|small-caps|small-caption|solid|space|square|start|static|status-bar|step-end|step-start|steps|stretch|strict|sub|super|sw-resize|table-caption|table-cell|table-column-group|table-column|table-footer-group|table-header-group|table-row-group|table-row|table|tb-rl|text-after-edge|text-before-edge|text-bottom|text-size|text-top|text|thick|thin|transparent|underline|upper-alpha|upper-latin|upper-roman|uppercase|use-script|vertical-ideographic|vertical-text|visible|w-resize|wait|whitespace|z-index|zero|zoom";
var supportConstantColor = exports.supportConstantColor = "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";
var supportConstantFonts = exports.supportConstantFonts = "arial|century|comic|courier|cursive|fantasy|garamond|georgia|helvetica|impact|lucida|symbol|system|tahoma|times|trebuchet|utopia|verdana|webdings|sans-serif|serif|monospace";
var numRe = exports.numRe = "\\-?(?:(?:[0-9]+(?:\\.[0-9]+)?)|(?:\\.[0-9]+))";
var pseudoElements = exports.pseudoElements = "(\\:+)\\b(after|before|first-letter|first-line|moz-selection|selection)\\b";
var pseudoClasses = exports.pseudoClasses = "(:)\\b(active|checked|disabled|empty|enabled|first-child|first-of-type|focus|hover|indeterminate|invalid|last-child|last-of-type|link|not|nth-child|nth-last-child|nth-last-of-type|nth-of-type|only-child|only-of-type|required|root|target|valid|visited)\\b";
var CssHighlightRules = function () {
    var keywordMapper = this.createKeywordMapper({
        "support.function": supportFunction,
        "support.constant": supportConstant,
        "support.type": supportType,
        "support.constant.color": supportConstantColor,
        "support.constant.fonts": supportConstantFonts
    }, "text", true);
    this.$rules = {
        "start": [{
                include: ["strings", "url", "comments"]
            }, {
                token: "paren.lparen",
                regex: "\\{",
                next: "ruleset"
            }, {
                token: "paren.rparen",
                regex: "\\}"
            }, {
                token: "string",
                regex: "@(?!viewport)",
                next: "media"
            }, {
                token: "keyword",
                regex: "#[a-z0-9-_]+"
            }, {
                token: "keyword",
                regex: "%"
            }, {
                token: "variable",
                regex: "\\.[a-z0-9-_]+"
            }, {
                token: "string",
                regex: ":[a-z0-9-_]+"
            }, {
                token: "constant.numeric",
                regex: numRe
            }, {
                token: "constant",
                regex: "[a-z0-9-_]+"
            }, {
                caseInsensitive: true
            }],
        "media": [{
                include: ["strings", "url", "comments"]
            }, {
                token: "paren.lparen",
                regex: "\\{",
                next: "start"
            }, {
                token: "paren.rparen",
                regex: "\\}",
                next: "start"
            }, {
                token: "string",
                regex: ";",
                next: "start"
            }, {
                token: "keyword",
                regex: "(?:media|supports|document|charset|import|namespace|media|supports|document"
                    + "|page|font|keyframes|viewport|counter-style|font-feature-values"
                    + "|swash|ornaments|annotation|stylistic|styleset|character-variant)"
            }],
        "comments": [{
                token: "comment", // multi line comment
                regex: "\\/\\*",
                push: [{
                        token: "comment",
                        regex: "\\*\\/",
                        next: "pop"
                    }, {
                        defaultToken: "comment"
                    }]
            }],
        "ruleset": [{
                regex: "-(webkit|ms|moz|o)-",
                token: "text"
            }, {
                token: "punctuation.operator",
                regex: "[:;]"
            }, {
                token: "paren.rparen",
                regex: "\\}",
                next: "start"
            }, {
                include: ["strings", "url", "comments"]
            }, {
                token: ["constant.numeric", "keyword"],
                regex: "(" + numRe + ")(ch|cm|deg|em|ex|fr|gd|grad|Hz|in|kHz|mm|ms|pc|pt|px|rad|rem|s|turn|vh|vmax|vmin|vm|vw|%)"
            }, {
                token: "constant.numeric",
                regex: numRe
            }, {
                token: "constant.numeric", // hex6 color
                regex: "#[a-f0-9]{6}"
            }, {
                token: "constant.numeric", // hex3 color
                regex: "#[a-f0-9]{3}"
            }, {
                token: ["punctuation", "entity.other.attribute-name.pseudo-element.css"],
                regex: pseudoElements
            }, {
                token: ["punctuation", "entity.other.attribute-name.pseudo-class.css"],
                regex: pseudoClasses
            }, {
                include: "url"
            }, {
                token: keywordMapper,
                regex: "\\-?[a-zA-Z_][a-zA-Z0-9_\\-]*"
            }, {
                token: "paren.lparen",
                regex: "\\{"
            }, {
                caseInsensitive: true
            }],
        url: [{
                token: "support.function",
                regex: "(?:url(:?-prefix)?|domain|regexp)\\(",
                push: [{
                        token: "support.function",
                        regex: "\\)",
                        next: "pop"
                    }, {
                        defaultToken: "string"
                    }]
            }],
        strings: [{
                token: "string.start",
                regex: "'",
                push: [{
                        token: "string.end",
                        regex: "'|$",
                        next: "pop"
                    }, {
                        include: "escapes"
                    }, {
                        token: "constant.language.escape",
                        regex: /\\$/,
                        consumeLineEnd: true
                    }, {
                        defaultToken: "string"
                    }]
            }, {
                token: "string.start",
                regex: '"',
                push: [{
                        token: "string.end",
                        regex: '"|$',
                        next: "pop"
                    }, {
                        include: "escapes"
                    }, {
                        token: "constant.language.escape",
                        regex: /\\$/,
                        consumeLineEnd: true
                    }, {
                        defaultToken: "string"
                    }]
            }],
        escapes: [{
                token: "constant.language.escape",
                regex: /\\([a-fA-F\d]{1,6}|[^a-fA-F\d])/
            }]
    };
    this.normalizeRules();
};
oop.inherits(CssHighlightRules, TextHighlightRules);
exports.CssHighlightRules = CssHighlightRules;

});

ace.define("ace/mode/jsdoc_comment_highlight_rules",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var JsDocCommentHighlightRules = function () {
    this.$rules = {
        "start": [
            {
                token: ["comment.doc.tag", "comment.doc.text", "lparen.doc"],
                regex: "(@(?:param|member|typedef|property|namespace|var|const|callback))(\\s*)({)",
                push: [
                    {
                        token: "lparen.doc",
                        regex: "{",
                        push: [
                            {
                                include: "doc-syntax"
                            }, {
                                token: "rparen.doc",
                                regex: "}|(?=$)",
                                next: "pop"
                            }
                        ]
                    }, {
                        token: ["rparen.doc", "text.doc", "variable.parameter.doc", "lparen.doc", "variable.parameter.doc", "rparen.doc"],
                        regex: /(})(\s*)(?:([\w=:\/\.]+)|(?:(\[)([\w=:\/\.\-\'\" ]+)(\])))/,
                        next: "pop"
                    }, {
                        token: "rparen.doc",
                        regex: "}|(?=$)",
                        next: "pop"
                    }, {
                        include: "doc-syntax"
                    }, {
                        defaultToken: "text.doc"
                    }
                ]
            }, {
                token: ["comment.doc.tag", "text.doc", "lparen.doc"],
                regex: "(@(?:returns?|yields|type|this|suppress|public|protected|private|package|modifies|"
                    + "implements|external|exception|throws|enum|define|extends))(\\s*)({)",
                push: [
                    {
                        token: "lparen.doc",
                        regex: "{",
                        push: [
                            {
                                include: "doc-syntax"
                            }, {
                                token: "rparen.doc",
                                regex: "}|(?=$)",
                                next: "pop"
                            }
                        ]
                    }, {
                        token: "rparen.doc",
                        regex: "}|(?=$)",
                        next: "pop"
                    }, {
                        include: "doc-syntax"
                    }, {
                        defaultToken: "text.doc"
                    }
                ]
            }, {
                token: ["comment.doc.tag", "text.doc", "variable.parameter.doc"],
                regex: "(@(?:alias|memberof|instance|module|name|lends|namespace|external|this|template|"
                    + "requires|param|implements|function|extends|typedef|mixes|constructor|var|"
                    + "memberof\\!|event|listens|exports|class|constructs|interface|emits|fires|"
                    + "throws|const|callback|borrows|augments))(\\s+)(\\w[\\w#\.:\/~\"\\-]*)?"
            }, {
                token: ["comment.doc.tag", "text.doc", "variable.parameter.doc"],
                regex: "(@method)(\\s+)(\\w[\\w\.\\(\\)]*)"
            }, {
                token: "comment.doc.tag",
                regex: "@access\\s+(?:private|public|protected)"
            }, {
                token: "comment.doc.tag",
                regex: "@kind\\s+(?:class|constant|event|external|file|function|member|mixin|module|namespace|typedef)"
            }, {
                token: "comment.doc.tag",
                regex: "@\\w+(?=\\s|$)"
            },
            JsDocCommentHighlightRules.getTagRule(),
            {
                defaultToken: "comment.doc.body",
                caseInsensitive: true
            }
        ],
        "doc-syntax": [{
                token: "operator.doc",
                regex: /[|:]/
            }, {
                token: "paren.doc",
                regex: /[\[\]]/
            }]
    };
    this.normalizeRules();
};
oop.inherits(JsDocCommentHighlightRules, TextHighlightRules);
JsDocCommentHighlightRules.getTagRule = function (start) {
    return {
        token: "comment.doc.tag.storage.type",
        regex: "\\b(?:TODO|FIXME|XXX|HACK)\\b"
    };
};
JsDocCommentHighlightRules.getStartRule = function (start) {
    return {
        token: "comment.doc", // doc comment
        regex: /\/\*\*(?!\/)/,
        next: start
    };
};
JsDocCommentHighlightRules.getEndRule = function (start) {
    return {
        token: "comment.doc", // closing comment
        regex: "\\*\\/",
        next: start
    };
};
exports.JsDocCommentHighlightRules = JsDocCommentHighlightRules;

});

ace.define("ace/mode/javascript_highlight_rules",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var DocCommentHighlightRules = require("./jsdoc_comment_highlight_rules").JsDocCommentHighlightRules;
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var identifierRe = "[a-zA-Z\\$_\u00a1-\uffff][a-zA-Z\\d\\$_\u00a1-\uffff]*";
var JavaScriptHighlightRules = function (options) {
    var keywords = {
        "variable.language": "Array|Boolean|Date|Function|Iterator|Number|Object|RegExp|String|Proxy|Symbol|" + // Constructors
            "Namespace|QName|XML|XMLList|" + // E4X
            "ArrayBuffer|Float32Array|Float64Array|Int16Array|Int32Array|Int8Array|" +
            "Uint16Array|Uint32Array|Uint8Array|Uint8ClampedArray|" +
            "Error|EvalError|InternalError|RangeError|ReferenceError|StopIteration|" + // Errors
            "SyntaxError|TypeError|URIError|" +
            "decodeURI|decodeURIComponent|encodeURI|encodeURIComponent|eval|isFinite|" + // Non-constructor functions
            "isNaN|parseFloat|parseInt|" +
            "JSON|Math|" + // Other
            "this|arguments|prototype|window|document", // Pseudo
        "keyword": "const|yield|import|get|set|async|await|" +
            "break|case|catch|continue|default|delete|do|else|finally|for|" +
            "if|in|of|instanceof|new|return|switch|throw|try|typeof|let|var|while|with|debugger|" +
            "__parent__|__count__|escape|unescape|with|__proto__|" +
            "class|enum|extends|super|export|implements|private|public|interface|package|protected|static|constructor",
        "storage.type": "const|let|var|function",
        "constant.language": "null|Infinity|NaN|undefined",
        "support.function": "alert",
        "constant.language.boolean": "true|false"
    };
    var keywordMapper = this.createKeywordMapper(keywords, "identifier");
    var kwBeforeRe = "case|do|else|finally|in|instanceof|return|throw|try|typeof|yield|void";
    var escapedRe = "\\\\(?:x[0-9a-fA-F]{2}|" + // hex
        "u[0-9a-fA-F]{4}|" + // unicode
        "u{[0-9a-fA-F]{1,6}}|" + // es6 unicode
        "[0-2][0-7]{0,2}|" + // oct
        "3[0-7][0-7]?|" + // oct
        "[4-7][0-7]?|" + //oct
        ".)";
    var anonymousFunctionRe = "(function)(\\s*)(\\*?)";
    var functionCallStartRule = {
        token: ["identifier", "text", "paren.lparen"],
        regex: "(\\b(?!" + Object.values(keywords).join("|") + "\\b)" + identifierRe + ")(\\s*)(\\()"
    };
    this.$rules = {
        "no_regex": [
            DocCommentHighlightRules.getStartRule("doc-start"),
            comments("no_regex"),
            functionCallStartRule,
            {
                token: "string",
                regex: "'(?=.)",
                next: "qstring"
            }, {
                token: "string",
                regex: '"(?=.)',
                next: "qqstring"
            }, {
                token: "constant.numeric", // hexadecimal, octal and binary
                regex: /0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)\b/
            }, {
                token: "constant.numeric", // decimal integers and floats
                regex: /(?:\d\d*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+\b)?/
            }, {
                token: [
                    "entity.name.function", "text", "keyword.operator", "text", "storage.type",
                    "text", "storage.type", "text", "paren.lparen"
                ],
                regex: "(" + identifierRe + ")(\\s*)(=)(\\s*)" + anonymousFunctionRe + "(\\s*)(\\()",
                next: "function_arguments"
            }, {
                token: [
                    "storage.type", "text", "storage.type", "text", "text", "entity.name.function", "text", "paren.lparen"
                ],
                regex: "(function)(?:(?:(\\s*)(\\*)(\\s*))|(\\s+))(" + identifierRe + ")(\\s*)(\\()",
                next: "function_arguments"
            }, {
                token: [
                    "entity.name.function", "text", "punctuation.operator",
                    "text", "storage.type", "text", "storage.type", "text", "paren.lparen"
                ],
                regex: "(" + identifierRe + ")(\\s*)(:)(\\s*)" + anonymousFunctionRe + "(\\s*)(\\()",
                next: "function_arguments"
            }, {
                token: [
                    "text", "text", "storage.type", "text", "storage.type", "text", "paren.lparen"
                ],
                regex: "(:)(\\s*)" + anonymousFunctionRe + "(\\s*)(\\()",
                next: "function_arguments"
            }, {
                token: "keyword",
                regex: "from(?=\\s*('|\"))"
            }, {
                token: "keyword",
                regex: "(?:" + kwBeforeRe + ")\\b",
                next: "start"
            }, {
                token: "support.constant",
                regex: /that\b/
            }, {
                token: ["storage.type", "punctuation.operator", "support.function.firebug"],
                regex: /(console)(\.)(warn|info|log|error|debug|time|trace|timeEnd|assert)\b/
            }, {
                token: keywordMapper,
                regex: identifierRe
            }, {
                token: "punctuation.operator",
                regex: /[.](?![.])/,
                next: "property"
            }, {
                token: "storage.type",
                regex: /=>/,
                next: "start"
            }, {
                token: "keyword.operator",
                regex: /--|\+\+|\.{3}|===|==|=|!=|!==|<+=?|>+=?|!|&&|\|\||\?:|[!$%&*+\-~\/^]=?/,
                next: "start"
            }, {
                token: "punctuation.operator",
                regex: /[?:,;.]/,
                next: "start"
            }, {
                token: "paren.lparen",
                regex: /[\[({]/,
                next: "start"
            }, {
                token: "paren.rparen",
                regex: /[\])}]/
            }, {
                token: "comment",
                regex: /^#!.*$/
            }
        ],
        property: [{
                token: "text",
                regex: "\\s+"
            }, {
                token: "keyword.operator",
                regex: /=/
            }, {
                token: [
                    "storage.type", "text", "storage.type", "text", "paren.lparen"
                ],
                regex: anonymousFunctionRe + "(\\s*)(\\()",
                next: "function_arguments"
            }, {
                token: [
                    "storage.type", "text", "storage.type", "text", "text", "entity.name.function", "text", "paren.lparen"
                ],
                regex: "(function)(?:(?:(\\s*)(\\*)(\\s*))|(\\s+))(\\w+)(\\s*)(\\()",
                next: "function_arguments"
            }, {
                token: "punctuation.operator",
                regex: /[.](?![.])/
            }, {
                token: "support.function",
                regex: "prototype"
            }, {
                token: "support.function",
                regex: /(s(?:h(?:ift|ow(?:Mod(?:elessDialog|alDialog)|Help))|croll(?:X|By(?:Pages|Lines)?|Y|To)?|t(?:op|rike)|i(?:n|zeToContent|debar|gnText)|ort|u(?:p|b(?:str(?:ing)?)?)|pli(?:ce|t)|e(?:nd|t(?:Re(?:sizable|questHeader)|M(?:i(?:nutes|lliseconds)|onth)|Seconds|Ho(?:tKeys|urs)|Year|Cursor|Time(?:out)?|Interval|ZOptions|Date|UTC(?:M(?:i(?:nutes|lliseconds)|onth)|Seconds|Hours|Date|FullYear)|FullYear|Active)|arch)|qrt|lice|avePreferences|mall)|h(?:ome|andleEvent)|navigate|c(?:har(?:CodeAt|At)|o(?:s|n(?:cat|textual|firm)|mpile)|eil|lear(?:Timeout|Interval)?|a(?:ptureEvents|ll)|reate(?:StyleSheet|Popup|EventObject))|t(?:o(?:GMTString|S(?:tring|ource)|U(?:TCString|pperCase)|Lo(?:caleString|werCase))|est|a(?:n|int(?:Enabled)?))|i(?:s(?:NaN|Finite)|ndexOf|talics)|d(?:isableExternalCapture|ump|etachEvent)|u(?:n(?:shift|taint|escape|watch)|pdateCommands)|j(?:oin|avaEnabled)|p(?:o(?:p|w)|ush|lugins.refresh|a(?:ddings|rse(?:Int|Float)?)|r(?:int|ompt|eference))|e(?:scape|nableExternalCapture|val|lementFromPoint|x(?:p|ec(?:Script|Command)?))|valueOf|UTC|queryCommand(?:State|Indeterm|Enabled|Value)|f(?:i(?:nd|lter|le(?:ModifiedDate|Size|CreatedDate|UpdatedDate)|xed)|o(?:nt(?:size|color)|rward|rEach)|loor|romCharCode)|watch|l(?:ink|o(?:ad|g)|astIndexOf)|a(?:sin|nchor|cos|t(?:tachEvent|ob|an(?:2)?)|pply|lert|b(?:s|ort))|r(?:ou(?:nd|teEvents)|e(?:size(?:By|To)|calc|turnValue|place|verse|l(?:oad|ease(?:Capture|Events)))|andom)|g(?:o|et(?:ResponseHeader|M(?:i(?:nutes|lliseconds)|onth)|Se(?:conds|lection)|Hours|Year|Time(?:zoneOffset)?|Da(?:y|te)|UTC(?:M(?:i(?:nutes|lliseconds)|onth)|Seconds|Hours|Da(?:y|te)|FullYear)|FullYear|A(?:ttention|llResponseHeaders)))|m(?:in|ove(?:B(?:y|elow)|To(?:Absolute)?|Above)|ergeAttributes|a(?:tch|rgins|x))|b(?:toa|ig|o(?:ld|rderWidths)|link|ack))\b(?=\()/
            }, {
                token: "support.function.dom",
                regex: /(s(?:ub(?:stringData|mit)|plitText|e(?:t(?:NamedItem|Attribute(?:Node)?)|lect))|has(?:ChildNodes|Feature)|namedItem|c(?:l(?:ick|o(?:se|neNode))|reate(?:C(?:omment|DATASection|aption)|T(?:Head|extNode|Foot)|DocumentFragment|ProcessingInstruction|E(?:ntityReference|lement)|Attribute))|tabIndex|i(?:nsert(?:Row|Before|Cell|Data)|tem)|open|delete(?:Row|C(?:ell|aption)|T(?:Head|Foot)|Data)|focus|write(?:ln)?|a(?:dd|ppend(?:Child|Data))|re(?:set|place(?:Child|Data)|move(?:NamedItem|Child|Attribute(?:Node)?)?)|get(?:NamedItem|Element(?:sBy(?:Name|TagName|ClassName)|ById)|Attribute(?:Node)?)|blur)\b(?=\()/
            }, {
                token: "support.constant",
                regex: /(s(?:ystemLanguage|cr(?:ipts|ollbars|een(?:X|Y|Top|Left))|t(?:yle(?:Sheets)?|atus(?:Text|bar)?)|ibling(?:Below|Above)|ource|uffixes|e(?:curity(?:Policy)?|l(?:ection|f)))|h(?:istory|ost(?:name)?|as(?:h|Focus))|y|X(?:MLDocument|SLDocument)|n(?:ext|ame(?:space(?:s|URI)|Prop))|M(?:IN_VALUE|AX_VALUE)|c(?:haracterSet|o(?:n(?:structor|trollers)|okieEnabled|lorDepth|mp(?:onents|lete))|urrent|puClass|l(?:i(?:p(?:boardData)?|entInformation)|osed|asses)|alle(?:e|r)|rypto)|t(?:o(?:olbar|p)|ext(?:Transform|Indent|Decoration|Align)|ags)|SQRT(?:1_2|2)|i(?:n(?:ner(?:Height|Width)|put)|ds|gnoreCase)|zIndex|o(?:scpu|n(?:readystatechange|Line)|uter(?:Height|Width)|p(?:sProfile|ener)|ffscreenBuffering)|NEGATIVE_INFINITY|d(?:i(?:splay|alog(?:Height|Top|Width|Left|Arguments)|rectories)|e(?:scription|fault(?:Status|Ch(?:ecked|arset)|View)))|u(?:ser(?:Profile|Language|Agent)|n(?:iqueID|defined)|pdateInterval)|_content|p(?:ixelDepth|ort|ersonalbar|kcs11|l(?:ugins|atform)|a(?:thname|dding(?:Right|Bottom|Top|Left)|rent(?:Window|Layer)?|ge(?:X(?:Offset)?|Y(?:Offset)?))|r(?:o(?:to(?:col|type)|duct(?:Sub)?|mpter)|e(?:vious|fix)))|e(?:n(?:coding|abledPlugin)|x(?:ternal|pando)|mbeds)|v(?:isibility|endor(?:Sub)?|Linkcolor)|URLUnencoded|P(?:I|OSITIVE_INFINITY)|f(?:ilename|o(?:nt(?:Size|Family|Weight)|rmName)|rame(?:s|Element)|gColor)|E|whiteSpace|l(?:i(?:stStyleType|n(?:eHeight|kColor))|o(?:ca(?:tion(?:bar)?|lName)|wsrc)|e(?:ngth|ft(?:Context)?)|a(?:st(?:M(?:odified|atch)|Index|Paren)|yer(?:s|X)|nguage))|a(?:pp(?:MinorVersion|Name|Co(?:deName|re)|Version)|vail(?:Height|Top|Width|Left)|ll|r(?:ity|guments)|Linkcolor|bove)|r(?:ight(?:Context)?|e(?:sponse(?:XML|Text)|adyState))|global|x|m(?:imeTypes|ultiline|enubar|argin(?:Right|Bottom|Top|Left))|L(?:N(?:10|2)|OG(?:10E|2E))|b(?:o(?:ttom|rder(?:Width|RightWidth|BottomWidth|Style|Color|TopWidth|LeftWidth))|ufferDepth|elow|ackground(?:Color|Image)))\b/
            }, {
                token: "identifier",
                regex: identifierRe
            }, {
                regex: "",
                token: "empty",
                next: "no_regex"
            }
        ],
        "start": [
            DocCommentHighlightRules.getStartRule("doc-start"),
            comments("start"),
            {
                token: "string.regexp",
                regex: "\\/",
                next: "regex"
            }, {
                token: "text",
                regex: "\\s+|^$",
                next: "start"
            }, {
                token: "empty",
                regex: "",
                next: "no_regex"
            }
        ],
        "regex": [
            {
                token: "regexp.keyword.operator",
                regex: "\\\\(?:u[\\da-fA-F]{4}|x[\\da-fA-F]{2}|.)"
            }, {
                token: "string.regexp",
                regex: "/[sxngimy]*",
                next: "no_regex"
            }, {
                token: "invalid",
                regex: /\{\d+\b,?\d*\}[+*]|[+*$^?][+*]|[$^][?]|\?{3,}/
            }, {
                token: "constant.language.escape",
                regex: /\(\?[:=!]|\)|\{\d+\b,?\d*\}|[+*]\?|[()$^+*?.]/
            }, {
                token: "constant.language.delimiter",
                regex: /\|/
            }, {
                token: "constant.language.escape",
                regex: /\[\^?/,
                next: "regex_character_class"
            }, {
                token: "empty",
                regex: "$",
                next: "no_regex"
            }, {
                defaultToken: "string.regexp"
            }
        ],
        "regex_character_class": [
            {
                token: "regexp.charclass.keyword.operator",
                regex: "\\\\(?:u[\\da-fA-F]{4}|x[\\da-fA-F]{2}|.)"
            }, {
                token: "constant.language.escape",
                regex: "]",
                next: "regex"
            }, {
                token: "constant.language.escape",
                regex: "-"
            }, {
                token: "empty",
                regex: "$",
                next: "no_regex"
            }, {
                defaultToken: "string.regexp.charachterclass"
            }
        ],
        "default_parameter": [
            {
                token: "string",
                regex: "'(?=.)",
                push: [
                    {
                        token: "string",
                        regex: "'|$",
                        next: "pop"
                    }, {
                        include: "qstring"
                    }
                ]
            }, {
                token: "string",
                regex: '"(?=.)',
                push: [
                    {
                        token: "string",
                        regex: '"|$',
                        next: "pop"
                    }, {
                        include: "qqstring"
                    }
                ]
            }, {
                token: "constant.language",
                regex: "null|Infinity|NaN|undefined"
            }, {
                token: "constant.numeric", // hexadecimal, octal and binary
                regex: /0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)\b/
            }, {
                token: "constant.numeric", // decimal integers and floats
                regex: /(?:\d\d*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+\b)?/
            }, {
                token: "punctuation.operator",
                regex: ",",
                next: "function_arguments"
            }, {
                token: "text",
                regex: "\\s+"
            }, {
                token: "punctuation.operator",
                regex: "$"
            }, {
                token: "empty",
                regex: "",
                next: "no_regex"
            }
        ],
        "function_arguments": [
            comments("function_arguments"),
            {
                token: "variable.parameter",
                regex: identifierRe
            }, {
                token: "punctuation.operator",
                regex: ","
            }, {
                token: "text",
                regex: "\\s+"
            }, {
                token: "punctuation.operator",
                regex: "$"
            }, {
                token: "empty",
                regex: "",
                next: "no_regex"
            }
        ],
        "qqstring": [
            {
                token: "constant.language.escape",
                regex: escapedRe
            }, {
                token: "string",
                regex: "\\\\$",
                consumeLineEnd: true
            }, {
                token: "string",
                regex: '"|$',
                next: "no_regex"
            }, {
                defaultToken: "string"
            }
        ],
        "qstring": [
            {
                token: "constant.language.escape",
                regex: escapedRe
            }, {
                token: "string",
                regex: "\\\\$",
                consumeLineEnd: true
            }, {
                token: "string",
                regex: "'|$",
                next: "no_regex"
            }, {
                defaultToken: "string"
            }
        ]
    };
    if (!options || !options.noES6) {
        this.$rules.no_regex.unshift({
            regex: "[{}]", onMatch: function (val, state, stack) {
                this.next = val == "{" ? this.nextState : "";
                if (val == "{" && stack.length) {
                    stack.unshift("start", state);
                }
                else if (val == "}" && stack.length) {
                    stack.shift();
                    this.next = stack.shift();
                    if (this.next.indexOf("string") != -1 || this.next.indexOf("jsx") != -1)
                        return "paren.quasi.end";
                }
                return val == "{" ? "paren.lparen" : "paren.rparen";
            },
            nextState: "start"
        }, {
            token: "string.quasi.start",
            regex: /`/,
            push: [{
                    token: "constant.language.escape",
                    regex: escapedRe
                }, {
                    token: "paren.quasi.start",
                    regex: /\${/,
                    push: "start"
                }, {
                    token: "string.quasi.end",
                    regex: /`/,
                    next: "pop"
                }, {
                    defaultToken: "string.quasi"
                }]
        }, {
            token: ["variable.parameter", "text"],
            regex: "(" + identifierRe + ")(\\s*)(?=\\=>)"
        }, {
            token: "paren.lparen",
            regex: "(\\()(?=[^\\(]+\\s*=>)",
            next: "function_arguments"
        }, {
            token: "variable.language",
            regex: "(?:(?:(?:Weak)?(?:Set|Map))|Promise)\\b"
        });
        this.$rules["function_arguments"].unshift({
            token: "keyword.operator",
            regex: "=",
            next: "default_parameter"
        }, {
            token: "keyword.operator",
            regex: "\\.{3}"
        });
        this.$rules["property"].unshift({
            token: "support.function",
            regex: "(findIndex|repeat|startsWith|endsWith|includes|isSafeInteger|trunc|cbrt|log2|log10|sign|then|catch|"
                + "finally|resolve|reject|race|any|all|allSettled|keys|entries|isInteger)\\b(?=\\()"
        }, {
            token: "constant.language",
            regex: "(?:MAX_SAFE_INTEGER|MIN_SAFE_INTEGER|EPSILON)\\b"
        });
        if (!options || options.jsx != false)
            JSX.call(this);
    }
    this.embedRules(DocCommentHighlightRules, "doc-", [DocCommentHighlightRules.getEndRule("no_regex")]);
    this.normalizeRules();
};
oop.inherits(JavaScriptHighlightRules, TextHighlightRules);
function JSX() {
    var tagRegex = identifierRe.replace("\\d", "\\d\\-");
    var jsxTag = {
        onMatch: function (val, state, stack) {
            var offset = val.charAt(1) == "/" ? 2 : 1;
            if (offset == 1) {
                if (state != this.nextState)
                    stack.unshift(this.next, this.nextState, 0);
                else
                    stack.unshift(this.next);
                stack[2]++;
            }
            else if (offset == 2) {
                if (state == this.nextState) {
                    stack[1]--;
                    if (!stack[1] || stack[1] < 0) {
                        stack.shift();
                        stack.shift();
                    }
                }
            }
            return [{
                    type: "meta.tag.punctuation." + (offset == 1 ? "" : "end-") + "tag-open.xml",
                    value: val.slice(0, offset)
                }, {
                    type: "meta.tag.tag-name.xml",
                    value: val.substr(offset)
                }];
        },
        regex: "</?(?:" + tagRegex + "|(?=>))",
        next: "jsxAttributes",
        nextState: "jsx"
    };
    this.$rules.start.unshift(jsxTag);
    var jsxJsRule = {
        regex: "{",
        token: "paren.quasi.start",
        push: "start"
    };
    this.$rules.jsx = [
        jsxJsRule,
        jsxTag,
        { include: "reference" }, { defaultToken: "string.xml" }
    ];
    this.$rules.jsxAttributes = [{
            token: "meta.tag.punctuation.tag-close.xml",
            regex: "/?>",
            onMatch: function (value, currentState, stack) {
                if (currentState == stack[0])
                    stack.shift();
                if (value.length == 2) {
                    if (stack[0] == this.nextState)
                        stack[1]--;
                    if (!stack[1] || stack[1] < 0) {
                        stack.splice(0, 2);
                    }
                }
                this.next = stack[0] || "start";
                return [{ type: this.token, value: value }];
            },
            nextState: "jsx"
        },
        jsxJsRule,
        comments("jsxAttributes"),
        {
            token: "entity.other.attribute-name.xml",
            regex: tagRegex
        }, {
            token: "keyword.operator.attribute-equals.xml",
            regex: "="
        }, {
            token: "text.tag-whitespace.xml",
            regex: "\\s+"
        }, {
            token: "string.attribute-value.xml",
            regex: "'",
            stateName: "jsx_attr_q",
            push: [
                { token: "string.attribute-value.xml", regex: "'", next: "pop" },
                { include: "reference" },
                { defaultToken: "string.attribute-value.xml" }
            ]
        }, {
            token: "string.attribute-value.xml",
            regex: '"',
            stateName: "jsx_attr_qq",
            push: [
                { token: "string.attribute-value.xml", regex: '"', next: "pop" },
                { include: "reference" },
                { defaultToken: "string.attribute-value.xml" }
            ]
        },
        jsxTag
    ];
    this.$rules.reference = [{
            token: "constant.language.escape.reference.xml",
            regex: "(?:&#[0-9]+;)|(?:&#x[0-9a-fA-F]+;)|(?:&[a-zA-Z0-9_:\\.-]+;)"
        }];
}
function comments(next) {
    return [
        {
            token: "comment", // multi line comment
            regex: /\/\*/,
            next: [
                DocCommentHighlightRules.getTagRule(),
                { token: "comment", regex: "\\*\\/", next: next || "pop" },
                { defaultToken: "comment", caseInsensitive: true }
            ]
        }, {
            token: "comment",
            regex: "\\/\\/",
            next: [
                DocCommentHighlightRules.getTagRule(),
                { token: "comment", regex: "$|^", next: next || "pop" },
                { defaultToken: "comment", caseInsensitive: true }
            ]
        }
    ];
}
exports.JavaScriptHighlightRules = JavaScriptHighlightRules;

});

ace.define("ace/mode/xml_highlight_rules",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var XmlHighlightRules = function (normalize) {
    var tagRegex = "[_:a-zA-Z\xc0-\uffff][-_:.a-zA-Z0-9\xc0-\uffff]*";
    this.$rules = {
        start: [
            { token: "string.cdata.xml", regex: "<\\!\\[CDATA\\[", next: "cdata" },
            {
                token: ["punctuation.instruction.xml", "keyword.instruction.xml"],
                regex: "(<\\?)(" + tagRegex + ")", next: "processing_instruction"
            },
            { token: "comment.start.xml", regex: "<\\!--", next: "comment" },
            {
                token: ["xml-pe.doctype.xml", "xml-pe.doctype.xml"],
                regex: "(<\\!)(DOCTYPE)(?=[\\s])", next: "doctype", caseInsensitive: true
            },
            { include: "tag" },
            { token: "text.end-tag-open.xml", regex: "</" },
            { token: "text.tag-open.xml", regex: "<" },
            { include: "reference" },
            { defaultToken: "text.xml" }
        ],
        processing_instruction: [{
                token: "entity.other.attribute-name.decl-attribute-name.xml",
                regex: tagRegex
            }, {
                token: "keyword.operator.decl-attribute-equals.xml",
                regex: "="
            }, {
                include: "whitespace"
            }, {
                include: "string"
            }, {
                token: "punctuation.xml-decl.xml",
                regex: "\\?>",
                next: "start"
            }],
        doctype: [
            { include: "whitespace" },
            { include: "string" },
            { token: "xml-pe.doctype.xml", regex: ">", next: "start" },
            { token: "xml-pe.xml", regex: "[-_a-zA-Z0-9:]+" },
            { token: "punctuation.int-subset", regex: "\\[", push: "int_subset" }
        ],
        int_subset: [{
                token: "text.xml",
                regex: "\\s+"
            }, {
                token: "punctuation.int-subset.xml",
                regex: "]",
                next: "pop"
            }, {
                token: ["punctuation.markup-decl.xml", "keyword.markup-decl.xml"],
                regex: "(<\\!)(" + tagRegex + ")",
                push: [{
                        token: "text",
                        regex: "\\s+"
                    },
                    {
                        token: "punctuation.markup-decl.xml",
                        regex: ">",
                        next: "pop"
                    },
                    { include: "string" }]
            }],
        cdata: [
            { token: "string.cdata.xml", regex: "\\]\\]>", next: "start" },
            { token: "text.xml", regex: "\\s+" },
            { token: "text.xml", regex: "(?:[^\\]]|\\](?!\\]>))+" }
        ],
        comment: [
            { token: "comment.end.xml", regex: "-->", next: "start" },
            { defaultToken: "comment.xml" }
        ],
        reference: [{
                token: "constant.language.escape.reference.xml",
                regex: "(?:&#[0-9]+;)|(?:&#x[0-9a-fA-F]+;)|(?:&[a-zA-Z0-9_:\\.-]+;)"
            }],
        attr_reference: [{
                token: "constant.language.escape.reference.attribute-value.xml",
                regex: "(?:&#[0-9]+;)|(?:&#x[0-9a-fA-F]+;)|(?:&[a-zA-Z0-9_:\\.-]+;)"
            }],
        tag: [{
                token: ["meta.tag.punctuation.tag-open.xml", "meta.tag.punctuation.end-tag-open.xml", "meta.tag.tag-name.xml"],
                regex: "(?:(<)|(</))((?:" + tagRegex + ":)?" + tagRegex + ")",
                next: [
                    { include: "attributes" },
                    { token: "meta.tag.punctuation.tag-close.xml", regex: "/?>", next: "start" }
                ]
            }],
        tag_whitespace: [
            { token: "text.tag-whitespace.xml", regex: "\\s+" }
        ],
        whitespace: [
            { token: "text.whitespace.xml", regex: "\\s+" }
        ],
        string: [{
                token: "string.xml",
                regex: "'",
                push: [
                    { token: "string.xml", regex: "'", next: "pop" },
                    { defaultToken: "string.xml" }
                ]
            }, {
                token: "string.xml",
                regex: '"',
                push: [
                    { token: "string.xml", regex: '"', next: "pop" },
                    { defaultToken: "string.xml" }
                ]
            }],
        attributes: [{
                token: "entity.other.attribute-name.xml",
                regex: tagRegex
            }, {
                token: "keyword.operator.attribute-equals.xml",
                regex: "="
            }, {
                include: "tag_whitespace"
            }, {
                include: "attribute_value"
            }],
        attribute_value: [{
                token: "string.attribute-value.xml",
                regex: "'",
                push: [
                    { token: "string.attribute-value.xml", regex: "'", next: "pop" },
                    { include: "attr_reference" },
                    { defaultToken: "string.attribute-value.xml" }
                ]
            }, {
                token: "string.attribute-value.xml",
                regex: '"',
                push: [
                    { token: "string.attribute-value.xml", regex: '"', next: "pop" },
                    { include: "attr_reference" },
                    { defaultToken: "string.attribute-value.xml" }
                ]
            }]
    };
    if (this.constructor === XmlHighlightRules)
        this.normalizeRules();
};
(function () {
    this.embedTagRules = function (HighlightRules, prefix, tag) {
        this.$rules.tag.unshift({
            token: ["meta.tag.punctuation.tag-open.xml", "meta.tag." + tag + ".tag-name.xml"],
            regex: "(<)(" + tag + "(?=\\s|>|$))",
            next: [
                { include: "attributes" },
                { token: "meta.tag.punctuation.tag-close.xml", regex: "/?>", next: prefix + "start" }
            ]
        });
        this.$rules[tag + "-end"] = [
            { include: "attributes" },
            { token: "meta.tag.punctuation.tag-close.xml", regex: "/?>", next: "start",
                onMatch: function (value, currentState, stack) {
                    stack.splice(0);
                    return this.token;
                } }
        ];
        this.embedRules(HighlightRules, prefix, [{
                token: ["meta.tag.punctuation.end-tag-open.xml", "meta.tag." + tag + ".tag-name.xml"],
                regex: "(</)(" + tag + "(?=\\s|>|$))",
                next: tag + "-end"
            }, {
                token: "string.cdata.xml",
                regex: "<\\!\\[CDATA\\["
            }, {
                token: "string.cdata.xml",
                regex: "\\]\\]>"
            }]);
    };
}).call(TextHighlightRules.prototype);
oop.inherits(XmlHighlightRules, TextHighlightRules);
exports.XmlHighlightRules = XmlHighlightRules;

});

ace.define("ace/mode/html_highlight_rules",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var lang = require("../lib/lang");
var CssHighlightRules = require("./css_highlight_rules").CssHighlightRules;
var JavaScriptHighlightRules = require("./javascript_highlight_rules").JavaScriptHighlightRules;
var XmlHighlightRules = require("./xml_highlight_rules").XmlHighlightRules;
var tagMap = lang.createMap({
    a: 'anchor',
    button: 'form',
    form: 'form',
    img: 'image',
    input: 'form',
    label: 'form',
    option: 'form',
    script: 'script',
    select: 'form',
    textarea: 'form',
    style: 'style',
    table: 'table',
    tbody: 'table',
    td: 'table',
    tfoot: 'table',
    th: 'table',
    tr: 'table'
});
var HtmlHighlightRules = function () {
    XmlHighlightRules.call(this);
    this.addRules({
        attributes: [{
                include: "tag_whitespace"
            }, {
                token: "entity.other.attribute-name.xml",
                regex: "[-_a-zA-Z0-9:.]+"
            }, {
                token: "keyword.operator.attribute-equals.xml",
                regex: "=",
                push: [{
                        include: "tag_whitespace"
                    }, {
                        token: "string.unquoted.attribute-value.html",
                        regex: "[^<>='\"`\\s]+",
                        next: "pop"
                    }, {
                        token: "empty",
                        regex: "",
                        next: "pop"
                    }]
            }, {
                include: "attribute_value"
            }],
        tag: [{
                token: function (start, tag) {
                    var group = tagMap[tag];
                    return ["meta.tag.punctuation." + (start == "<" ? "" : "end-") + "tag-open.xml",
                        "meta.tag" + (group ? "." + group : "") + ".tag-name.xml"];
                },
                regex: "(</?)([-_a-zA-Z0-9:.]+)",
                next: "tag_stuff"
            }],
        tag_stuff: [
            { include: "attributes" },
            { token: "meta.tag.punctuation.tag-close.xml", regex: "/?>", next: "start" }
        ]
    });
    this.embedTagRules(CssHighlightRules, "css-", "style");
    this.embedTagRules(new JavaScriptHighlightRules({ jsx: false }).getRules(), "js-", "script");
    if (this.constructor === HtmlHighlightRules)
        this.normalizeRules();
};
oop.inherits(HtmlHighlightRules, XmlHighlightRules);
exports.HtmlHighlightRules = HtmlHighlightRules;

});

ace.define("ace/mode/jinja_highlight_rules",[], function(require, exports, module){/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2012, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */
"use strict";
var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var HtmlHighlightRules = require("./html_highlight_rules").HtmlHighlightRules;
var JinjaHighlightRules = function () {
    HtmlHighlightRules.call(this);
    var statementsKeywordMap = {
        "keyword.control.jinja.tag": ("block|endblock|extends|if|endif|elif|for|endfor|asyncEach|" +
            "endeach|include|asyncAll|endall|macro|endmacro|set|" +
            "endset|ignore missing|as|from|raw|verbatim|filter|endfilter"),
    };
    var keywordMapper = this.createKeywordMapper(statementsKeywordMap, "meta.scope.jinja.tag");
    this.$rules["start"].unshift({
        token: [
            "meta.jinja.delimiter.tag",
            "comment.block.jinja.raw",
            "keyword.control.jinja",
            "comment.block.jinja.raw",
            "meta.jinja.delimiter.tag"
        ],
        regex: /({%)(\s*)(raw)(\s*)(%})/,
        push: [{
                token: [
                    "meta.jinja.delimiter.tag",
                    "comment.block.jinja.raw",
                    "keyword.control.jinja",
                    "comment.block.jinja.raw",
                    "meta.jinja.delimiter.tag"
                ],
                regex: /({%)(\s*)(endraw)(\s*)(%})/,
                next: "pop"
            }, {
                defaultToken: "comment.block.jinja.raw"
            }]
    }, {
        include: "jinja#comments"
    }, {
        token: "variable.meta.jinja.delimiter",
        regex: /{{-?/,
        push: [{
                token: "variable.meta.jinja.delimiter",
                regex: /-?}}/,
                next: "pop"
            }, {
                include: "jinja#expression"
            }, {
                defaultToken: "variable.meta.scope.jinja"
            }]
    }, {
        token: "comment.jinja.delimiter.tag",
        regex: /({%-?)/,
        push: [{
                token: "comment.jinja.delimiter.tag",
                regex: /(-?%})/,
                next: "pop"
            }, {
                include: "jinja#statement"
            }, {
                defaultToken: "meta.scope.jinja.tag"
            }]
    });
    this.addRules({
        "jinja#comments": [{
                start: /{#-?/,
                token: "comment.block.jinja",
                end: /-?#}/,
            }],
        "jinja#statement": [{
                token: [
                    "text",
                    "keyword.control.jinja",
                    "text",
                    "variable.other.jinja.block"
                ],
                regex: /(\s*\b)(block)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)\b/
            }, {
                token: [
                    "text",
                    "keyword.control.jinja",
                    "text",
                    "variable.other.jinja.filter"
                ],
                regex: /(\s*\b)(filter)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)\b/
            }, {
                token: [
                    "text",
                    "keyword.control.jinja",
                    "text",
                    "variable.other.jinja.extend"
                ],
                regex: /(\s*\b)(extend)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)\b/
            }, {
                token: [
                    "text",
                    "keyword.control.jinja",
                    "text",
                    "variable.other.jinja.includ"
                ],
                regex: /(\s*\b)(include)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)\b/
            }, {
                token: [
                    "text",
                    "keyword.control.jinja",
                    "text",
                    "variable.other.jinja.macro"
                ],
                regex: /(\s*\b)(macro)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)\b/
            }, {
                token: [
                    "text",
                    "keyword.control.jinja",
                    "text",
                    "variable.other.jinja.set"
                ],
                regex: /(\s*\b)(set)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)\b/
            }, {
                token: keywordMapper,
                regex: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/
            }, {
                include: "jinja#expression"
            }],
        "jinja#expression": [{
                token: [
                    "text",
                    "keyword.control.jinja",
                    "text",
                    "variable.other.jinja.test"
                ],
                regex: /(\s*\b)(is)(\s+)([a-zA-Z_][a-zA-Z0-9_]*)\b/
            }, {
                token: "keyword.control.jinja",
                regex: /\b(?:and|else|if|in|import|not|or|recursive|with(?:out)?\s+context)\b/
            }, {
                token: "constant.language.jinja",
                regex: /\b(?:true|false|none)\b/
            }, {
                token: "variable.language.jinja",
                regex: /\b(?:loop|super|self|varargs|kwargs)\b/
            }, {
                token: "keyword.operator.arithmetic.jinja",
                regex: /\+|\-|\*\*|\*|\/\/|\/|%/
            }, {
                token: [
                    "punctuation.other.jinja",
                    "support.function.other.jinja.filter"
                ],
                regex: /(\|\s*)([a-zA-Z_][a-zA-Z0-9_]*)/
            }, {
                token: [
                    "punctuation.other.jinja",
                    "variable.other.jinja.attribute"
                ],
                regex: /(\.)([a-zA-Z_][a-zA-Z0-9_]*)/
            }, {
                token: "variable.other.jinja",
                regex: /[a-zA-Z_][a-zA-Z0-9_]*/
            }, {
                token: "punctuation.other.jinja",
                regex: /\[/,
                push: [{
                        token: "punctuation.other.jinja",
                        regex: /\]/,
                        next: "pop"
                    }, {
                        include: "jinja#expression"
                    }]
            }, {
                token: "punctuation.other.jinja",
                regex: /\(/,
                push: [{
                        token: "punctuation.other.jinja",
                        regex: /\)/,
                        next: "pop"
                    }, {
                        include: "jinja#expression"
                    }]
            }, {
                token: "punctuation.other.jinja",
                regex: /\{/,
                push: [{
                        token: "punctuation.other.jinja",
                        regex: /\}/,
                        next: "pop"
                    }, {
                        include: "jinja#expression"
                    }]
            }, {
                token: "punctuation.other.jinja",
                regex: /\.|:|\||,/
            }, {
                token: "keyword.operator.comparison.jinja",
                regex: /==|<=|=>|<|>|!=/
            }, {
                token: "keyword.operator.assignment.jinja",
                regex: /=/
            }, {
                token: "punctuation.definition.string.begin.jinja",
                regex: /"/,
                push: [{
                        token: "punctuation.definition.string.end.jinja",
                        regex: /"/,
                        next: "pop"
                    }, {
                        include: "jinja#string"
                    }, {
                        defaultToken: "string.quoted.double.jinja"
                    }]
            }, {
                token: "punctuation.definition.string.begin.jinja",
                regex: /'/,
                push: [{
                        token: "punctuation.definition.string.end.jinja",
                        regex: /'/,
                        next: "pop"
                    }, {
                        include: "jinja#string"
                    }, {
                        defaultToken: "string.quoted.single.jinja"
                    }]
            }, {
                token: "punctuation.definition.regexp.begin.jinja",
                regex: /@\//,
                push: [{
                        token: "punctuation.definition.regexp.end.jinja",
                        regex: /\//,
                        next: "pop"
                    }, {
                        include: "jinja#simple_escapes"
                    }, {
                        defaultToken: "string.regexp.jinja"
                    }]
            }],
        "jinja#escaped_char": [{
                token: "constant.character.escape.hex.jinja",
                regex: /\\x[0-9A-F]{2}/
            }],
        "jinja#escaped_unicode_char": [{
                token: [
                    "constant.character.escape.unicode.16-bit-hex.jinja",
                    "constant.character.escape.unicode.32-bit-hex.jinja",
                    "constant.character.escape.unicode.name.jinja"
                ],
                regex: /(\\U[0-9A-Fa-f]{8})|(\\u[0-9A-Fa-f]{4})|(\\N\{[a-zA-Z ]+\})/
            }],
        "jinja#simple_escapes": [{
                token: [
                    "constant.character.escape.newline.jinja",
                    "constant.character.escape.backlash.jinja",
                    "constant.character.escape.double-quote.jinja",
                    "constant.character.escape.single-quote.jinja",
                    "constant.character.escape.bell.jinja",
                    "constant.character.escape.backspace.jinja",
                    "constant.character.escape.formfeed.jinja",
                    "constant.character.escape.linefeed.jinja",
                    "constant.character.escape.return.jinja",
                    "constant.character.escape.tab.jinja",
                    "constant.character.escape.vertical-tab.jinja"
                ],
                regex: /(\\$)|(\\\\)|(\\\")|(\\')|(\\a)|(\\b)|(\\f)|(\\n)|(\\r)|(\\t)|(\\v)/
            }],
        "jinja#string": [{
                include: "jinja#simple_escapes"
            }, {
                include: "jinja#escaped_char"
            }, {
                include: "jinja#escaped_unicode_char"
            }]
    });
    this.normalizeRules();
};
JinjaHighlightRules.metaData = {
    name: "jinja",
    scopeName: "source.jinja",
    comment: "Jinja Templates",
    foldingStartMarker: "({%\\s*(block|filter|for|if|macro|raw))",
    foldingStopMarker: "({%\\s*(endblock|endfilter|endfor|endif|endmacro|endraw)\\s*%})"
};
oop.inherits(JinjaHighlightRules, TextHighlightRules);
exports.JinjaHighlightRules = JinjaHighlightRules;

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

ace.define("ace/mode/jinja",[], function(require, exports, module){/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2012, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */
"use strict";
var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var JinjaCompletions = require("./jinja_completions").JinjaCompletions;
var JinjaHighlightRules = require("./jinja_highlight_rules").JinjaHighlightRules;
var FoldMode = require("./folding/cstyle").FoldMode;
var Mode = function () {
    this.$completer = new JinjaCompletions();
    this.HighlightRules = JinjaHighlightRules;
    this.foldingRules = new FoldMode();
};
oop.inherits(Mode, TextMode);
(function () {
    this.getCompletions = function (state, session, pos, prefix) {
        return this.$completer.getCompletions(this.$highlightRules.$keywordList, state, session, pos, prefix);
    };
    this.$id = "ace/mode/jinja";
}).call(Mode.prototype);
exports.Mode = Mode;

});                (function() {
                    ace.require(["ace/mode/jinja"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            