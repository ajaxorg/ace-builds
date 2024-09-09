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

ace.define("ace/mode/behaviour/xml",[], function(require, exports, module){"use strict";
var oop = require("../../lib/oop");
var Behaviour = require("../behaviour").Behaviour;
var TokenIterator = require("../../token_iterator").TokenIterator;
function is(token, type) {
    return token && token.type.lastIndexOf(type + ".xml") > -1;
}
var XmlBehaviour = function () {
    this.add("string_dquotes", "insertion", function (state, action, editor, session, text) {
        if (text == '"' || text == "'") {
            var quote = text;
            var selected = session.doc.getTextRange(editor.getSelectionRange());
            if (selected !== "" && selected !== "'" && selected != '"' && editor.getWrapBehavioursEnabled()) {
                return {
                    text: quote + selected + quote,
                    selection: false
                };
            }
            var cursor = editor.getCursorPosition();
            var line = session.doc.getLine(cursor.row);
            var rightChar = line.substring(cursor.column, cursor.column + 1);
            var iterator = new TokenIterator(session, cursor.row, cursor.column);
            var token = iterator.getCurrentToken();
            if (rightChar == quote && (is(token, "attribute-value") || is(token, "string"))) {
                return {
                    text: "",
                    selection: [1, 1]
                };
            }
            if (!token)
                token = iterator.stepBackward();
            if (!token)
                return;
            while (is(token, "tag-whitespace") || is(token, "whitespace")) {
                token = iterator.stepBackward();
            }
            var rightSpace = !rightChar || rightChar.match(/\s/);
            if (is(token, "attribute-equals") && (rightSpace || rightChar == '>') || (is(token, "decl-attribute-equals") && (rightSpace || rightChar == '?'))) {
                return {
                    text: quote + quote,
                    selection: [1, 1]
                };
            }
        }
    });
    this.add("string_dquotes", "deletion", function (state, action, editor, session, range) {
        var selected = session.doc.getTextRange(range);
        if (!range.isMultiLine() && (selected == '"' || selected == "'")) {
            var line = session.doc.getLine(range.start.row);
            var rightChar = line.substring(range.start.column + 1, range.start.column + 2);
            if (rightChar == selected) {
                range.end.column++;
                return range;
            }
        }
    });
    this.add("autoclosing", "insertion", function (state, action, editor, session, text) {
        if (text == '>') {
            var position = editor.getSelectionRange().start;
            var iterator = new TokenIterator(session, position.row, position.column);
            var token = iterator.getCurrentToken() || iterator.stepBackward();
            if (!token || !(is(token, "tag-name") || is(token, "tag-whitespace") || is(token, "attribute-name") || is(token, "attribute-equals") || is(token, "attribute-value")))
                return;
            if (is(token, "reference.attribute-value"))
                return;
            if (is(token, "attribute-value")) {
                var tokenEndColumn = iterator.getCurrentTokenColumn() + token.value.length;
                if (position.column < tokenEndColumn)
                    return;
                if (position.column == tokenEndColumn) {
                    var nextToken = iterator.stepForward();
                    if (nextToken && is(nextToken, "attribute-value"))
                        return;
                    iterator.stepBackward();
                }
            }
            if (/^\s*>/.test(session.getLine(position.row).slice(position.column)))
                return;
            while (!is(token, "tag-name")) {
                token = iterator.stepBackward();
                if (token.value == "<") {
                    token = iterator.stepForward();
                    break;
                }
            }
            var tokenRow = iterator.getCurrentTokenRow();
            var tokenColumn = iterator.getCurrentTokenColumn();
            if (is(iterator.stepBackward(), "end-tag-open"))
                return;
            var element = token.value;
            if (tokenRow == position.row)
                element = element.substring(0, position.column - tokenColumn);
            if (this.voidElements && this.voidElements.hasOwnProperty(element.toLowerCase()))
                return;
            return {
                text: ">" + "</" + element + ">",
                selection: [1, 1]
            };
        }
    });
    this.add("autoindent", "insertion", function (state, action, editor, session, text) {
        if (text == "\n") {
            var cursor = editor.getCursorPosition();
            var line = session.getLine(cursor.row);
            var iterator = new TokenIterator(session, cursor.row, cursor.column);
            var token = iterator.getCurrentToken();
            if (is(token, "") && token.type.indexOf("tag-close") !== -1) {
                if (token.value == "/>")
                    return;
                while (token && token.type.indexOf("tag-name") === -1) {
                    token = iterator.stepBackward();
                }
                if (!token) {
                    return;
                }
                var tag = token.value;
                var row = iterator.getCurrentTokenRow();
                token = iterator.stepBackward();
                if (!token || token.type.indexOf("end-tag") !== -1) {
                    return;
                }
                if (this.voidElements && !this.voidElements[tag] || !this.voidElements) {
                    var nextToken = session.getTokenAt(cursor.row, cursor.column + 1);
                    var line = session.getLine(row);
                    var nextIndent = this.$getIndent(line);
                    var indent = nextIndent + session.getTabString();
                    if (nextToken && nextToken.value === "</") {
                        return {
                            text: "\n" + indent + "\n" + nextIndent,
                            selection: [1, indent.length, 1, indent.length]
                        };
                    }
                    else {
                        return {
                            text: "\n" + indent
                        };
                    }
                }
            }
        }
    });
};
oop.inherits(XmlBehaviour, Behaviour);
exports.XmlBehaviour = XmlBehaviour;

});

ace.define("ace/mode/behaviour/javascript",[], function(require, exports, module){"use strict";
var oop = require("../../lib/oop");
var TokenIterator = require("../../token_iterator").TokenIterator;
var CstyleBehaviour = require("../behaviour/cstyle").CstyleBehaviour;
var XmlBehaviour = require("../behaviour/xml").XmlBehaviour;
var JavaScriptBehaviour = function () {
    var xmlBehaviours = new XmlBehaviour({ closeCurlyBraces: true }).getBehaviours();
    this.addBehaviours(xmlBehaviours);
    this.inherit(CstyleBehaviour);
    this.add("autoclosing-fragment", "insertion", function (state, action, editor, session, text) {
        if (text == '>') {
            var position = editor.getSelectionRange().start;
            var iterator = new TokenIterator(session, position.row, position.column);
            var token = iterator.getCurrentToken() || iterator.stepBackward();
            if (!token)
                return;
            if (token.value == '<') {
                return {
                    text: "></>",
                    selection: [1, 1]
                };
            }
        }
    });
};
oop.inherits(JavaScriptBehaviour, CstyleBehaviour);
exports.JavaScriptBehaviour = JavaScriptBehaviour;

});

ace.define("ace/mode/folding/xml",[], function(require, exports, module){"use strict";
var oop = require("../../lib/oop");
var Range = require("../../range").Range;
var BaseFoldMode = require("./fold_mode").FoldMode;
var FoldMode = exports.FoldMode = function (voidElements, optionalEndTags) {
    BaseFoldMode.call(this);
    this.voidElements = voidElements || {};
    this.optionalEndTags = oop.mixin({}, this.voidElements);
    if (optionalEndTags)
        oop.mixin(this.optionalEndTags, optionalEndTags);
};
oop.inherits(FoldMode, BaseFoldMode);
var Tag = function () {
    this.tagName = "";
    this.closing = false;
    this.selfClosing = false;
    this.start = { row: 0, column: 0 };
    this.end = { row: 0, column: 0 };
};
function is(token, type) {
    return token.type.lastIndexOf(type + ".xml") > -1;
}
(function () {
    this.getFoldWidget = function (session, foldStyle, row) {
        var tag = this._getFirstTagInLine(session, row);
        if (!tag)
            return this.getCommentFoldWidget(session, row);
        if (tag.closing || (!tag.tagName && tag.selfClosing))
            return foldStyle === "markbeginend" ? "end" : "";
        if (!tag.tagName || tag.selfClosing || this.voidElements.hasOwnProperty(tag.tagName.toLowerCase()))
            return "";
        if (this._findEndTagInLine(session, row, tag.tagName, tag.end.column))
            return "";
        return "start";
    };
    this.getCommentFoldWidget = function (session, row) {
        if (/comment/.test(session.getState(row)) && /<!-/.test(session.getLine(row)))
            return "start";
        return "";
    };
    this._getFirstTagInLine = function (session, row) {
        var tokens = session.getTokens(row);
        var tag = new Tag();
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (is(token, "tag-open")) {
                tag.end.column = tag.start.column + token.value.length;
                tag.closing = is(token, "end-tag-open");
                token = tokens[++i];
                if (!token)
                    return null;
                tag.tagName = token.value;
                if (token.value === "") { //skip empty tag name token for fragment
                    token = tokens[++i];
                    if (!token)
                        return null;
                    tag.tagName = token.value;
                }
                tag.end.column += token.value.length;
                for (i++; i < tokens.length; i++) {
                    token = tokens[i];
                    tag.end.column += token.value.length;
                    if (is(token, "tag-close")) {
                        tag.selfClosing = token.value == '/>';
                        break;
                    }
                }
                return tag;
            }
            else if (is(token, "tag-close")) {
                tag.selfClosing = token.value == '/>';
                return tag;
            }
            tag.start.column += token.value.length;
        }
        return null;
    };
    this._findEndTagInLine = function (session, row, tagName, startColumn) {
        var tokens = session.getTokens(row);
        var column = 0;
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            column += token.value.length;
            if (column < startColumn - 1)
                continue;
            if (is(token, "end-tag-open")) {
                token = tokens[i + 1];
                if (is(token, "tag-name") && token.value === "") {
                    token = tokens[i + 2];
                }
                if (token && token.value == tagName)
                    return true;
            }
        }
        return false;
    };
    this.getFoldWidgetRange = function (session, foldStyle, row) {
        var firstTag = this._getFirstTagInLine(session, row);
        if (!firstTag) {
            return this.getCommentFoldWidget(session, row) && session.getCommentFoldRange(row, session.getLine(row).length);
        }
        var tags = session.getMatchingTags({ row: row, column: 0 });
        if (tags) {
            return new Range(tags.openTag.end.row, tags.openTag.end.column, tags.closeTag.start.row, tags.closeTag.start.column);
        }
    };
}).call(FoldMode.prototype);

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

ace.define("ace/mode/folding/javascript",[], function(require, exports, module){"use strict";
var oop = require("../../lib/oop");
var XmlFoldMode = require("./xml").FoldMode;
var CFoldMode = require("./cstyle").FoldMode;
var FoldMode = exports.FoldMode = function (commentRegex) {
    if (commentRegex) {
        this.foldingStartMarker = new RegExp(this.foldingStartMarker.source.replace(/\|[^|]*?$/, "|" + commentRegex.start));
        this.foldingStopMarker = new RegExp(this.foldingStopMarker.source.replace(/\|[^|]*?$/, "|" + commentRegex.end));
    }
    this.xmlFoldMode = new XmlFoldMode();
};
oop.inherits(FoldMode, CFoldMode);
(function () {
    this.getFoldWidgetRangeBase = this.getFoldWidgetRange;
    this.getFoldWidgetBase = this.getFoldWidget;
    this.getFoldWidget = function (session, foldStyle, row) {
        var fw = this.getFoldWidgetBase(session, foldStyle, row);
        if (!fw) {
            return this.xmlFoldMode.getFoldWidget(session, foldStyle, row);
        }
        return fw;
    };
    this.getFoldWidgetRange = function (session, foldStyle, row, forceMultiline) {
        var range = this.getFoldWidgetRangeBase(session, foldStyle, row, forceMultiline);
        if (range)
            return range;
        return this.xmlFoldMode.getFoldWidgetRange(session, foldStyle, row);
    };
}).call(FoldMode.prototype);

});

ace.define("ace/mode/javascript",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var JavaScriptHighlightRules = require("./javascript_highlight_rules").JavaScriptHighlightRules;
var MatchingBraceOutdent = require("./matching_brace_outdent").MatchingBraceOutdent;
var WorkerClient = require("../worker/worker_client").WorkerClient;
var JavaScriptBehaviour = require("./behaviour/javascript").JavaScriptBehaviour;
var JavaScriptFoldMode = require("./folding/javascript").FoldMode;
var Mode = function () {
    this.HighlightRules = JavaScriptHighlightRules;
    this.$outdent = new MatchingBraceOutdent();
    this.$behaviour = new JavaScriptBehaviour();
    this.foldingRules = new JavaScriptFoldMode();
};
oop.inherits(Mode, TextMode);
(function () {
    this.lineCommentStart = "//";
    this.blockComment = { start: "/*", end: "*/" };
    this.$quotes = { '"': '"', "'": "'", "`": "`" };
    this.$pairQuotesAfter = {
        "`": /\w/
    };
    this.getNextLineIndent = function (state, line, tab) {
        var indent = this.$getIndent(line);
        var tokenizedLine = this.getTokenizer().getLineTokens(line, state);
        var tokens = tokenizedLine.tokens;
        var endState = tokenizedLine.state;
        if (tokens.length && tokens[tokens.length - 1].type == "comment") {
            return indent;
        }
        if (state == "start" || state == "no_regex") {
            var match = line.match(/^.*(?:\bcase\b.*:|[\{\(\[])\s*$/);
            if (match) {
                indent += tab;
            }
        }
        else if (state == "doc-start") {
            if (endState == "start" || endState == "no_regex") {
                return "";
            }
        }
        return indent;
    };
    this.checkOutdent = function (state, line, input) {
        return this.$outdent.checkOutdent(line, input);
    };
    this.autoOutdent = function (state, doc, row) {
        this.$outdent.autoOutdent(doc, row);
    };
    this.createWorker = function (session) {
        var worker = new WorkerClient(["ace"], "ace/mode/javascript_worker", "JavaScriptWorker");
        worker.attachToDocument(session.getDocument());
        worker.on("annotate", function (results) {
            session.setAnnotations(results.data);
        });
        worker.on("terminate", function () {
            session.clearAnnotations();
        });
        return worker;
    };
    this.$id = "ace/mode/javascript";
    this.snippetFileId = "ace/snippets/javascript";
}).call(Mode.prototype);
exports.Mode = Mode;

});

ace.define("ace/mode/gobstones_highlight_rules",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var GobstonesHighlightRules = function () {
    var definitions = {
        standard: "program|procedure|function|interactive|return|let",
        type: "type|is|variant|record|field|case"
    };
    var control = {
        commands: {
            repetitions: "repeat|while|foreach|in",
            alternatives: "if|elseif|else|switch"
        },
        expressions: {
            alternatives: "choose|when|otherwise|matching|select|on"
        }
    };
    var values = {
        colors: "Verde|Rojo|Azul|Negro",
        cardinals: "Norte|Sur|Este|Oeste",
        booleans: "True|False",
        numbers: /([-]?)([0-9]+)\b/,
        strings: '["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]'
    };
    var primitives = {
        commands: "Poner|Sacar|Mover|IrAlBorde|VaciarTablero|BOOM",
        expressions: "nroBolitas|hayBolitas|puedeMover|" +
            "siguiente|previo|opuesto|" +
            "minBool|maxBool|minDir|maxDir|minColor|maxColor|" +
            "primero|sinElPrimero|esVacía|" +
            "boom",
        keys: "K_A|K_B|K_C|K_D|K_E|K_F|K_G|K_G|K_H|K_I|K_J|K_K|K_L|K_M|K_N|K_Ñ|" +
            "K_O|K_P|K_Q|K_R|K_S|K_T|K_U|K_V|K_W|K_X|K_Y|K_Z|" +
            "K_0|K_1|K_2|K_3|K_4|K_5|K_6|K_7|K_8|K_9|" +
            "K_F1|K_F2|K_F3|K_F4|K_F5|K_F6|K_F7|K_F8|K_F9|K_F10|K_F11|K_12|" +
            "K_UP|K_DOWN|K_LEFT|K_RIGHT|K_RETURN|K_BACKSPACE|K_TAB|K_SPACE|K_ESCAPE" +
            "K_CTRL_A|K_CTRL_B|K_CTRL_C|K_CTRL_D|K_CTRL_E|K_CTRL_F|K_CTRL_G|K_CTRL_G|" +
            "K_CTRL_H|K_CTRL_I|K_CTRL_J|K_CTRL_K|K_CTRL_L|K_CTRL_M|K_CTRL_N|K_CTRL_Ñ|" +
            "K_CTRL_O|K_CTRL_P|K_CTRL_Q|K_CTRL_R|K_CTRL_S|K_CTRL_T|K_CTRL_U|K_CTRL_V|" +
            "K_CTRL_W|K_CTRL_X|K_CTRL_Y|K_CTRL_Z|" +
            "K_CTRL_0|K_CTRL_1|K_CTRL_2|K_CTRL_3|K_CTRL_4|K_CTRL_5|K_CTRL_6|K_CTRL_7|K_CTRL_8|K_CTRL_9|" +
            "K_CTRL_F1|K_CTRL_F2|K_CTRL_F3|K_CTRL_F4|K_CTRL_F5|K_CTRL_F6|K_CTRL_F7|" +
            "K_CTRL_F8|K_CTRL_F9|K_CTRL_F10|K_CTRL_F11|K_CTRL_F12|" +
            "K_CTRL_UP|K_CTRL_DOWN|K_CTRL_LEFT|K_CTRL_RIGHT|K_CTRL_RETURN|" +
            "K_CTRL_BACKSPACE|K_CTRL_TAB|K_CTRL_SPACE|K_CTRL_ESCAPE" +
            "K_ALT_A|K_ALT_B|K_ALT_C|K_ALT_D|K_ALT_E|K_ALT_F|K_ALT_G|K_ALT_G|K_ALT_H|" +
            "K_ALT_I|K_ALT_J|K_ALT_K|K_ALT_L|K_ALT_M|K_ALT_N|K_ALT_Ñ|K_ALT_O|K_ALT_P|" +
            "K_ALT_Q|K_ALT_R|K_ALT_S|K_ALT_T|K_ALT_U|K_ALT_V|K_ALT_W|K_ALT_X|K_ALT_Y|K_ALT_Z|" +
            "K_ALT_0|K_ALT_1|K_ALT_2|K_ALT_3|K_ALT_4|K_ALT_5|K_ALT_6|K_ALT_7|K_ALT_8|K_ALT_9|" +
            "K_ALT_F1|K_ALT_F2|K_ALT_F3|K_ALT_F4|K_ALT_F5|K_ALT_F6|K_ALT_F7|K_ALT_F8|" +
            "K_ALT_F9|K_ALT_F10|K_ALT_F11|K_ALT_F12|" +
            "K_ALT_UP|K_ALT_DOWN|K_ALT_LEFT|K_ALT_RIGHT|K_ALT_RETURN|K_ALT_BACKSPACE|" +
            "K_ALT_TAB|K_ALT_SPACE|K_ALT_ESCAPE" +
            "K_SHIFT_A|K_SHIFT_B|K_SHIFT_C|K_SHIFT_D|K_SHIFT_E|K_SHIFT_F|K_SHIFT_G|" +
            "K_SHIFT_G|K_SHIFT_H|K_SHIFT_I|K_SHIFT_J|K_SHIFT_K|K_SHIFT_L|K_SHIFT_M|" +
            "K_SHIFT_N|K_SHIFT_Ñ|K_SHIFT_O|K_SHIFT_P|K_SHIFT_Q|K_SHIFT_R|K_SHIFT_S|" +
            "K_SHIFT_T|K_SHIFT_U|K_SHIFT_V|K_SHIFT_W|K_SHIFT_X|K_SHIFT_Y|K_SHIFT_Z|" +
            "K_SHIFT_0|K_SHIFT_1|K_SHIFT_2|K_SHIFT_3|K_SHIFT_4|K_SHIFT_5|K_SHIFT_6|" +
            "K_SHIFT_7|K_SHIFT_8|K_SHIFT_9|" +
            "K_SHIFT_F1|K_SHIFT_F2|K_SHIFT_F3|K_SHIFT_F4|K_SHIFT_F5|K_SHIFT_F6|" +
            "K_SHIFT_F7|K_SHIFT_F8|K_SHIFT_F9|K_SHIFT_F10|K_SHIFT_F11|K_SHIFT_F12|" +
            "K_SHIFT_UP|K_SHIFT_DOWN|K_SHIFT_LEFT|K_SHIFT_RIGHT|K_SHIFT_RETURN|" +
            "K_SHIFT_BACKSPACE|K_SHIFT_TAB|K_SHIFT_SPACE|K_SHIFT_ESCAPE" +
            "K_CTRL_ALT_A|K_CTRL_ALT_B|K_CTRL_ALT_C|K_CTRL_ALT_D|K_CTRL_ALT_E|" +
            "K_CTRL_ALT_F|K_CTRL_ALT_G|K_CTRL_ALT_G|K_CTRL_ALT_H|K_CTRL_ALT_I|" +
            "K_CTRL_ALT_J|K_CTRL_ALT_K|K_CTRL_ALT_L|K_CTRL_ALT_M|K_CTRL_ALT_N|" +
            "K_CTRL_ALT_Ñ|K_CTRL_ALT_O|K_CTRL_ALT_P|K_CTRL_ALT_Q|K_CTRL_ALT_R|" +
            "K_CTRL_ALT_S|K_CTRL_ALT_T|K_CTRL_ALT_U|K_CTRL_ALT_V|K_CTRL_ALT_W|" +
            "K_CTRL_ALT_X|K_CTRL_ALT_Y|K_CTRL_ALT_Z|" +
            "K_CTRL_ALT_0|K_CTRL_ALT_1|K_CTRL_ALT_2|K_CTRL_ALT_3|K_CTRL_ALT_4|" +
            "K_CTRL_ALT_5|K_CTRL_ALT_6|K_CTRL_ALT_7|K_CTRL_ALT_8|K_CTRL_ALT_9|" +
            "K_CTRL_ALT_F1|K_CTRL_ALT_F2|K_CTRL_ALT_F3|K_CTRL_ALT_F4|K_CTRL_ALT_F5|" +
            "K_CTRL_ALT_F6|K_CTRL_ALT_F7|K_CTRL_ALT_F8|K_CTRL_ALT_F9|K_CTRL_ALT_F10|" +
            "K_CTRL_ALT_F11|K_CTRL_ALT_F12|" +
            "K_CTRL_ALT_UP|K_CTRL_ALT_DOWN|K_CTRL_ALT_LEFT|K_CTRL_ALT_RIGHT|" +
            "K_CTRL_ALT_RETURN|K_CTRL_ALT_BACKSPACE|K_CTRL_ALT_TAB|K_CTRL_ALT_SPACE|K_CTRL_ALT_ESCAPE" +
            "K_CTRL_SHIFT_A|K_CTRL_SHIFT_B|K_CTRL_SHIFT_C|K_CTRL_SHIFT_D|K_CTRL_SHIFT_E|" +
            "K_CTRL_SHIFT_F|K_CTRL_SHIFT_G|K_CTRL_SHIFT_G|K_CTRL_SHIFT_H|K_CTRL_SHIFT_I|" +
            "K_CTRL_SHIFT_J|K_CTRL_SHIFT_K|K_CTRL_SHIFT_L|K_CTRL_SHIFT_M|K_CTRL_SHIFT_N|" +
            "K_CTRL_SHIFT_Ñ|K_CTRL_SHIFT_O|K_CTRL_SHIFT_P|K_CTRL_SHIFT_Q|K_CTRL_SHIFT_R|" +
            "K_CTRL_SHIFT_S|K_CTRL_SHIFT_T|K_CTRL_SHIFT_U|K_CTRL_SHIFT_V|K_CTRL_SHIFT_W|" +
            "K_CTRL_SHIFT_X|K_CTRL_SHIFT_Y|K_CTRL_SHIFT_Z|" +
            "K_CTRL_SHIFT_0|K_CTRL_SHIFT_1|K_CTRL_SHIFT_2|K_CTRL_SHIFT_3|K_CTRL_SHIFT_4|" +
            "K_CTRL_SHIFT_5|K_CTRL_SHIFT_6|K_CTRL_SHIFT_7|K_CTRL_SHIFT_8|K_CTRL_SHIFT_9|" +
            "K_CTRL_SHIFT_F1|K_CTRL_SHIFT_F2|K_CTRL_SHIFT_F3|K_CTRL_SHIFT_F4|" +
            "K_CTRL_SHIFT_F5|K_CTRL_SHIFT_F6|K_CTRL_SHIFT_F7|K_CTRL_SHIFT_F8|" +
            "K_CTRL_SHIFT_9|K_CTRL_SHIFT_10|K_CTRL_SHIFT_11|K_CTRL_SHIFT_12|" +
            "K_CTRL_SHIFT_UP|K_CTRL_SHIFT_DOWN|K_CTRL_SHIFT_LEFT|K_CTRL_SHIFT_RIGHT|" +
            "K_CTRL_SHIFT_RETURN|K_CTRL_SHIFT_BACKSPACE|K_CTRL_SHIFT_TAB|" +
            "K_CTRL_SHIFT_SPACE|K_CTRL_SHIFT_ESCAPE" +
            "K_ALT_SHIFT_A|K_ALT_SHIFT_B|K_ALT_SHIFT_C|K_ALT_SHIFT_D|K_ALT_SHIFT_E|" +
            "K_ALT_SHIFT_F|K_ALT_SHIFT_G|K_ALT_SHIFT_G|K_ALT_SHIFT_H|K_ALT_SHIFT_I|" +
            "K_ALT_SHIFT_J|K_ALT_SHIFT_K|K_ALT_SHIFT_L|K_ALT_SHIFT_M|K_ALT_SHIFT_N|" +
            "K_ALT_SHIFT_Ñ|K_ALT_SHIFT_O|K_ALT_SHIFT_P|K_ALT_SHIFT_Q|K_ALT_SHIFT_R|" +
            "K_ALT_SHIFT_S|K_ALT_SHIFT_T|K_ALT_SHIFT_U|K_ALT_SHIFT_V|K_ALT_SHIFT_W|" +
            "K_ALT_SHIFT_X|K_ALT_SHIFT_Y|K_ALT_SHIFT_Z|" +
            "K_ALT_SHIFT_0|K_ALT_SHIFT_1|K_ALT_SHIFT_2|K_ALT_SHIFT_3|K_ALT_SHIFT_4|" +
            "K_ALT_SHIFT_5|K_ALT_SHIFT_6|K_ALT_SHIFT_7|K_ALT_SHIFT_8|K_ALT_SHIFT_9|" +
            "K_ALT_SHIFT_F1|K_ALT_SHIFT_F2|K_ALT_SHIFT_F3|K_ALT_SHIFT_F4|" +
            "K_ALT_SHIFT_F5|K_ALT_SHIFT_F6|K_ALT_SHIFT_F7|K_ALT_SHIFT_F8|" +
            "K_ALT_SHIFT_9|K_ALT_SHIFT_10|K_ALT_SHIFT_11|K_ALT_SHIFT_12|" +
            "K_ALT_SHIFT_UP|K_ALT_SHIFT_DOWN|K_ALT_SHIFT_LEFT|K_ALT_SHIFT_RIGHT|" +
            "K_ALT_SHIFT_RETURN|K_ALT_SHIFT_BACKSPACE|K_ALT_SHIFT_TAB|K_ALT_SHIFT_SPACE|" +
            "K_ALT_SHIFT_ESCAPE" +
            "K_CTRL_ALT_SHIFT_A|K_CTRL_ALT_SHIFT_B|K_CTRL_ALT_SHIFT_C|K_CTRL_ALT_SHIFT_D|" +
            "K_CTRL_ALT_SHIFT_E|K_CTRL_ALT_SHIFT_F|K_CTRL_ALT_SHIFT_G|K_CTRL_ALT_SHIFT_G|" +
            "K_CTRL_ALT_SHIFT_H|K_CTRL_ALT_SHIFT_I|K_CTRL_ALT_SHIFT_J|K_CTRL_ALT_SHIFT_K|" +
            "K_CTRL_ALT_SHIFT_L|K_CTRL_ALT_SHIFT_M|K_CTRL_ALT_SHIFT_N|K_CTRL_ALT_SHIFT_Ñ|" +
            "K_CTRL_ALT_SHIFT_O|K_CTRL_ALT_SHIFT_P|K_CTRL_ALT_SHIFT_Q|K_CTRL_ALT_SHIFT_R|" +
            "K_CTRL_ALT_SHIFT_S|K_CTRL_ALT_SHIFT_T|K_CTRL_ALT_SHIFT_U|K_CTRL_ALT_SHIFT_V|" +
            "K_CTRL_ALT_SHIFT_W|K_CTRL_ALT_SHIFT_X|K_CTRL_ALT_SHIFT_Y|K_CTRL_ALT_SHIFT_Z|" +
            "K_CTRL_ALT_SHIFT_0|K_CTRL_ALT_SHIFT_1|K_CTRL_ALT_SHIFT_2|K_CTRL_ALT_SHIFT_3|" +
            "K_CTRL_ALT_SHIFT_4|K_CTRL_ALT_SHIFT_5|K_CTRL_ALT_SHIFT_6|K_CTRL_ALT_SHIFT_7|" +
            "K_CTRL_ALT_SHIFT_8|K_CTRL_ALT_SHIFT_9|" +
            "K_CTRL_ALT_SHIFT_F1|K_CTRL_ALT_SHIFT_F2|K_CTRL_ALT_SHIFT_F3|K_CTRL_ALT_SHIFT_F4|" +
            "K_CTRL_ALT_SHIFT_F5|K_CTRL_ALT_SHIFT_F6|K_CTRL_ALT_SHIFT_F7|K_CTRL_ALT_SHIFT_F8|" +
            "K_CTRL_ALT_SHIFT_F9|K_CTRL_ALT_SHIFT_F10|K_CTRL_ALT_SHIFT_F11|K_CTRL_ALT_SHIFT_F12|" +
            "K_CTRL_ALT_SHIFT_UP|K_CTRL_ALT_SHIFT_DOWN|K_CTRL_ALT_SHIFT_LEFT|K_CTRL_ALT_SHIFT_RIGHT|" +
            "K_CTRL_ALT_SHIFT_RETURN|K_CTRL_ALT_SHIFT_BACKSPACE|K_CTRL_ALT_SHIFT_TAB|" +
            "K_CTRL_ALT_SHIFT_SPACE|K_CTRL_ALT_SHIFT_ESCAPE"
    };
    var operations = {
        commands: ":=",
        expressions: {
            numeric: "\\+|\\-|\\*|\\^|div|mod",
            comparison: ">=|<=|==|\\/=|>|<",
            boolean: "\\|\\||&&|not",
            other: "\\+\\+|<\\-|\\[|\\]|\\_|\\->"
        }
    };
    var comments = {
        line: {
            double_slash: "\\/\\/.*$",
            double_dash: "\\-\\-.*$",
            number_sign: "#.*$"
        },
        block: { start: "\\/\\*", end: "\\*\\/" },
        block_alt: { start: "\\{\\-", end: "\\-\\}" }
    };
    this.$rules = {
        "start": [
            {
                token: "comment.line.double-slash.gobstones",
                regex: comments.line.double_slash
            },
            {
                token: "comment.line.double-dash.gobstones",
                regex: comments.line.double_dash
            },
            {
                token: "comment.line.number-sign.gobstones",
                regex: comments.line.number_sign
            },
            {
                token: "comment.block.dash-asterisc.gobstones",
                regex: comments.block.start,
                next: "block_comment_end"
            },
            {
                token: "comment.block.brace-dash.gobstones",
                regex: comments.block_alt.start,
                next: "block_comment_alt_end"
            },
            {
                token: "constant.numeric.gobstones",
                regex: values.numbers
            },
            {
                token: "string.quoted.double.gobstones",
                regex: values.strings
            },
            {
                token: "keyword.operator.other.gobstones",
                regex: operations.expressions.other
            },
            {
                token: "keyword.operator.numeric.gobstones",
                regex: operations.expressions.numeric
            },
            {
                token: "keyword.operator.compare.gobstones",
                regex: operations.expressions.comparison
            },
            {
                token: "keyword.operator.boolean.gobstones",
                regex: operations.expressions.boolean
            },
            {
                token: this.createKeywordMapper({
                    "storage.type.definitions.gobstones": definitions.standard,
                    "storage.type.types.gobstones": definitions.type,
                    "keyword.control.commands.repetitions.gobstones": control.commands.repetitions,
                    "keyword.control.commands.alternatives.gobstones": control.commands.alternatives,
                    "keyword.control.expressions.alternatives.gobstones": control.expressions.alternatives,
                    "constant.language.colors.gobstones": values.colors,
                    "constant.language.cardinals.gobstones": values.cardinals,
                    "constant.language.boolean.gobstones": values.booleans,
                    "support.function.gobstones": primitives.commands,
                    "support.variable.gobstones": primitives.expressions,
                    "variable.language.gobstones": primitives.keys
                }, "identifier.gobstones"),
                regex: "[a-zA-Z_$][a-zA-Z0-9_$]*\\b"
            },
            {
                token: "comma.gobstones",
                regex: ","
            },
            {
                token: "semicolon.gobstones",
                regex: ";"
            },
            {
                token: "lparen",
                regex: "[[({]"
            },
            {
                token: "rparen",
                regex: "[\\])}]"
            },
            {
                token: "text",
                regex: "\\s+"
            }
        ],
        "block_comment_end": [{
                token: "comment.block.dash-asterisc.gobstones",
                regex: comments.block.end,
                next: "start"
            }, {
                defaultToken: "comment.block.dash-asterisc.gobstones"
            }
        ],
        "block_comment_alt_end": [{
                token: "comment.block.brace-dash.gobstones",
                regex: comments.block_alt.end,
                next: "start"
            }, {
                defaultToken: "comment.block.brace-dash.gobstones"
            }
        ]
    };
};
oop.inherits(GobstonesHighlightRules, TextHighlightRules);
exports.GobstonesHighlightRules = GobstonesHighlightRules;

});

ace.define("ace/mode/gobstones",[], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var JavaScriptMode = require("./javascript").Mode;
var GobstonesHighlightRules = require("./gobstones_highlight_rules").GobstonesHighlightRules;
var Mode = function () {
    JavaScriptMode.call(this);
    this.HighlightRules = GobstonesHighlightRules;
    this.$behaviour = this.$defaultBehaviour;
};
oop.inherits(Mode, JavaScriptMode);
(function () {
    this.createWorker = function () {
        return null;
    };
    this.$id = "ace/mode/gobstones";
    this.snippetFileId = "ace/snippets/gobstones";
}).call(Mode.prototype);
exports.Mode = Mode;

});                (function() {
                    ace.require(["ace/mode/gobstones"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            