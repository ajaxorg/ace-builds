define("ace/mode/css_highlight_rules",["require","exports","module","ace/lib/oop","ace/lib/lang","ace/mode/text_highlight_rules"], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var lang = require("../lib/lang");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
var supportType = exports.supportType = "-moz-float-edge|-moz-force-broken-image-icon|-moz-image-region|-moz-orient|-moz-user-focus|-moz-user-input|-webkit-border-before|-webkit-box-reflect|-webkit-line-clamp|-webkit-mask-box-image|-webkit-mask-composite|-webkit-mask-position-x|-webkit-mask-position-y|-webkit-mask-repeat-x|-webkit-mask-repeat-y|-webkit-overflow-scrolling|-webkit-tap-highlight-color|-webkit-text-fill-color|-webkit-text-security|-webkit-text-stroke|-webkit-text-stroke-color|-webkit-text-stroke-width|-webkit-touch-callout|accent-color|align-content|align-items|align-self|all|animation|animation-composition|animation-delay|animation-direction|animation-duration|animation-fill-mode|animation-iteration-count|animation-name|animation-play-state|animation-timing-function|appearance|aspect-ratio|backdrop-filter|backface-visibility|background|background-attachment|background-blend-mode|background-clip|background-color|background-image|background-origin|background-position|background-position-x|background-position-y|background-repeat|background-size|block-size|border|border-block|border-block-color|border-block-end|border-block-end-color|border-block-end-style|border-block-end-width|border-block-start|border-block-start-color|border-block-start-style|border-block-start-width|border-block-style|border-block-width|border-bottom|border-bottom-color|border-bottom-left-radius|border-bottom-right-radius|border-bottom-style|border-bottom-width|border-collapse|border-color|border-end-end-radius|border-end-start-radius|border-image|border-image-outset|border-image-repeat|border-image-slice|border-image-source|border-image-width|border-inline|border-inline-color|border-inline-end|border-inline-end-color|border-inline-end-style|border-inline-end-width|border-inline-start|border-inline-start-color|border-inline-start-style|border-inline-start-width|border-inline-style|border-inline-width|border-left|border-left-color|border-left-style|border-left-width|border-radius|border-right|border-right-color|border-right-style|border-right-width|border-spacing|border-start-end-radius|border-start-start-radius|border-style|border-top|border-top-color|border-top-left-radius|border-top-right-radius|border-top-style|border-top-width|border-width|bottom|box-align|box-decoration-break|box-direction|box-flex|box-flex-group|box-lines|box-ordinal-group|box-orient|box-pack|box-shadow|box-sizing|break-after|break-before|break-inside|caption-side|caret-color|clear|clip|clip-path|color|color-interpolation|color-scheme|column-count|column-fill|column-gap|column-rule|column-rule-color|column-rule-style|column-rule-width|column-span|column-width|columns|contain|contain-intrinsic-block-size|contain-intrinsic-height|contain-intrinsic-inline-size|contain-intrinsic-size|contain-intrinsic-width|container|container-name|container-type|content|counter-increment|counter-reset|counter-set|cursor|direction|display|empty-cells|field-sizing|filter|flex|flex-basis|flex-direction|flex-flow|flex-grow|flex-shrink|flex-wrap|float|font|font-family|font-feature-settings|font-kerning|font-language-override|font-optical-sizing|font-palette|font-size|font-size-adjust|font-smooth|font-stretch|font-style|font-synthesis|font-synthesis-position|font-synthesis-small-caps|font-synthesis-style|font-synthesis-weight|font-variant|font-variant-alternates|font-variant-caps|font-variant-east-asian|font-variant-emoji|font-variant-ligatures|font-variant-numeric|font-variant-position|font-variation-settings|font-weight|forced-color-adjust|gap|grid|grid-area|grid-auto-columns|grid-auto-flow|grid-auto-rows|grid-column|grid-column-end|grid-column-start|grid-row|grid-row-end|grid-row-start|grid-template|grid-template-areas|grid-template-columns|grid-template-rows|hanging-punctuation|height|hyphenate-character|hyphenate-limit-chars|hyphens|image-orientation|image-rendering|inline-size|inset|inset-block|inset-block-end|inset-block-start|inset-inline|inset-inline-end|inset-inline-start|isolation|justify-content|justify-items|justify-self|left|letter-spacing|line-break|line-height|list-style|list-style-image|list-style-position|list-style-type|margin|margin-block|margin-block-end|margin-block-start|margin-bottom|margin-inline|margin-inline-end|margin-inline-start|margin-left|margin-right|margin-top|mask|mask-border|mask-border-mode|mask-border-outset|mask-border-repeat|mask-border-slice|mask-border-source|mask-border-width|mask-clip|mask-composite|mask-image|mask-mode|mask-origin|mask-position|mask-repeat|mask-size|mask-type|math-depth|math-style|max-block-size|max-height|max-inline-size|max-width|min-block-size|min-height|min-inline-size|min-width|mix-blend-mode|object-fit|object-position|offset|offset-anchor|offset-distance|offset-path|offset-position|offset-rotate|opacity|order|orphans|outline|outline-color|outline-offset|outline-style|outline-width|overflow|overflow-anchor|overflow-block|overflow-clip-margin|overflow-inline|overflow-wrap|overflow-x|overflow-y|overscroll-behavior|overscroll-behavior-block|overscroll-behavior-inline|overscroll-behavior-x|overscroll-behavior-y|padding|padding-block|padding-block-end|padding-block-start|padding-bottom|padding-inline|padding-inline-end|padding-inline-start|padding-left|padding-right|padding-top|page|page-break-after|page-break-before|page-break-inside|paint-order|perspective|perspective-origin|place-content|place-items|place-self|pointer-events|position|print-color-adjust|quotes|resize|right|rotate|row-gap|ruby-position|scale|scroll-behavior|scroll-margin|scroll-margin-block|scroll-margin-block-end|scroll-margin-block-start|scroll-margin-bottom|scroll-margin-inline|scroll-margin-inline-end|scroll-margin-inline-start|scroll-margin-left|scroll-margin-right|scroll-margin-top|scroll-padding|scroll-padding-block|scroll-padding-block-end|scroll-padding-block-start|scroll-padding-bottom|scroll-padding-inline|scroll-padding-inline-end|scroll-padding-inline-start|scroll-padding-left|scroll-padding-right|scroll-padding-top|scroll-snap-align|scroll-snap-stop|scroll-snap-type|scrollbar-color|scrollbar-gutter|scrollbar-width|shape-image-threshold|shape-margin|shape-outside|tab-size|table-layout|text-align|text-align-last|text-combine-upright|text-decoration|text-decoration-color|text-decoration-line|text-decoration-skip-ink|text-decoration-style|text-decoration-thickness|text-emphasis|text-emphasis-color|text-emphasis-position|text-emphasis-style|text-indent|text-justify|text-orientation|text-overflow|text-rendering|text-shadow|text-transform|text-underline-offset|text-underline-position|text-wrap|text-wrap-mode|text-wrap-style|top|touch-action|transform|transform-box|transform-origin|transform-style|transition|transition-behavior|transition-delay|transition-duration|transition-property|transition-timing-function|translate|unicode-bidi|user-modify|user-select|vertical-align|visibility|white-space|white-space-collapse|widows|width|will-change|word-break|word-spacing|writing-mode|z-index|zoom";
var supportFunction = exports.supportFunction = "-moz-image-rect|abs|acos|asin|atan|atan2|attr|blur|brightness|calc|circle|clamp|color-mix|color|conic-gradient|contrast|cos|counter|counters|cross-fade|device-cmyk|drop-shadow|ellipse|env|exp|fit-content|grayscale|hsl|hue-rotate|hwb|hypot|image-set|image|inset|invert|lab|lch|light-dark|linear-gradient|log|matrix|matrix3d|max|min|minmax|mod|oklab|oklch|opacity|paint|path|perspective|polygon|pow|radial-gradient|ray|rect|rem|repeat|repeating-conic-gradient|repeating-linear-gradient|repeating-radial-gradient|rgb|rotate|rotate3d|rotateX|rotateY|rotateZ|round|saturate|scale|scale3d|scaleX|scaleY|scaleZ|sepia|shape|sign|sin|skew|skewX|skewY|sqrt|symbols|tan|translate|translate3d|translateX|translateY|translateZ|url|var|xywh";
var supportConstant = exports.supportConstant = "absolute|after-edge|after|all-scroll|all|alphabetic|always|antialiased|armenian|auto|avoid-column|avoid-page|avoid|balance|baseline|before-edge|before|below|bidi-override|block-line-height|block|bold|bolder|border-box|both|bottom|box|break-all|break-word|capitalize|caps-height|caption|center|central|char|circle|cjk-ideographic|clone|close-quote|col-resize|collapse|column|consider-shifts|contain|content-box|cover|crosshair|cubic-bezier|dashed|decimal-leading-zero|decimal|default|disabled|disc|disregard-shifts|distribute-all-lines|distribute-letter|distribute-space|distribute|dotted|double|e-resize|ease-in|ease-in-out|ease-out|ease|ellipsis|end|exclude-ruby|flex-end|flex-start|fill|fixed|georgian|glyphs|grid-height|groove|hand|hanging|hebrew|help|hidden|hiragana-iroha|hiragana|horizontal|icon|ideograph-alpha|ideograph-numeric|ideograph-parenthesis|ideograph-space|ideographic|inactive|include-ruby|inherit|initial|inline-block|inline-box|inline-line-height|inline-table|inline|inset|inside|inter-ideograph|inter-word|invert|italic|justify|katakana-iroha|katakana|keep-all|last|left|lighter|line-edge|line-through|line|linear|list-item|local|loose|lower-alpha|lower-greek|lower-latin|lower-roman|lowercase|lr-tb|ltr|mathematical|max-height|max-size|medium|menu|message-box|middle|move|n-resize|ne-resize|newspaper|no-change|no-close-quote|no-drop|no-open-quote|no-repeat|none|normal|not-allowed|nowrap|nw-resize|oblique|open-quote|outset|outside|overline|padding-box|page|pointer|pre-line|pre-wrap|pre|preserve-3d|progress|relative|repeat-x|repeat-y|repeat|replaced|reset-size|ridge|right|round|row-resize|rtl|s-resize|scroll|se-resize|separate|slice|small-caps|small-caption|solid|space|square|start|static|status-bar|step-end|step-start|steps|stretch|strict|sub|super|sw-resize|table-caption|table-cell|table-column-group|table-column|table-footer-group|table-header-group|table-row-group|table-row|table|tb-rl|text-after-edge|text-before-edge|text-bottom|text-size|text-top|text|thick|thin|underline|upper-alpha|upper-latin|upper-roman|uppercase|use-script|vertical-ideographic|vertical-text|visible|w-resize|wait|whitespace|z-index|zero|zoom";
var supportConstantColor = exports.supportConstantColor = "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|transparent|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";
var supportConstantFonts = exports.supportConstantFonts = "cursive|emoji|fangsong|fantasy|math|monospace|sans-serif|serif|system-ui|ui-monospace|ui-rounded|ui-sans-serif|ui-serif";
var numRe = exports.numRe = "\\-?(?:(?:[0-9]+(?:\\.[0-9]+)?)|(?:\\.[0-9]+))";
var pseudoElements = exports.pseudoElements = "(\\:+)\\b(-moz-color-swatch|-moz-list-bullet|-moz-list-number|-moz-page|-moz-page-sequence|-moz-progress-bar|-moz-range-progress|-moz-range-thumb|-moz-range-track|-moz-scrolled-page-sequence|-webkit-inner-spin-button|-webkit-meter-bar|-webkit-meter-even-less-good-value|-webkit-meter-inner-element|-webkit-meter-optimum-value|-webkit-meter-suboptimum-value|-webkit-progress-bar|-webkit-progress-inner-element|-webkit-progress-value|-webkit-scrollbar|-webkit-search-cancel-button|-webkit-search-results-button|after|backdrop|before|cue|cue-region|file-selector-button|first-letter|first-line|grammar-error|highlight|marker|part|placeholder|selection|slotted|spelling-error)\\b";
var pseudoClasses = exports.pseudoClasses = "(:)\\b(-moz-broken|-moz-drag-over|-moz-first-node|-moz-handler-blocked|-moz-handler-crashed|-moz-handler-disabled|-moz-last-node|-moz-loading|-moz-locale-dir|-moz-only-whitespace|-moz-submit-invalid|-moz-suppressed|-moz-user-disabled|-moz-window-inactive|active|any-link|autofill|buffering|checked|current|default|defined|dir|disabled|empty|enabled|first|first-child|first-of-type|focus|focus-visible|focus-within|fullscreen|future|has|host|host-context|host|hover|in-range|indeterminate|invalid|is|lang|last-child|last-of-type|left|link|local-link|modal|muted|not|nth-child|nth-last-child|nth-last-of-type|nth-of-type|only-child|only-of-type|optional|out-of-range|past|paused|picture-in-picture|placeholder-shown|playing|popover-open|read-only|read-write|required|right|root|scope|seeking|stalled|target|user-invalid|user-valid|valid|visited|volume-locked|where)\\b";
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
                regex: "(?:annotation|character-variant|charset|color-profile|container|counter-style|document|font|font-face|font-feature-values|font-palette-values|import|keyframes|layer|media|namespace|ornaments|page|property|scope|styleset|stylistic|supports|swash|viewport)"
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
                regex: "(" + numRe + ")(%|Q|cap|ch|cm|cqb|cqh|cqi|cqmax|cqmin|cqw|deg|dpcm|dpi|dppx|dvb|dvh|dvi|dvmax|dvmin|dvw|em|ex|fr|grad|ic|in|lh|lvb|lvh|lvi|lvmax|lvmin|lvw|mm|ms|pc|pt|px|rad|rcap|rch|rem|rex|ric|rlh|s|svb|svh|svi|svmax|svmin|svw|turn|vb|vh|vi|vm|vmax|vmin|vw|x)"
            }, {
                token: "constant.numeric",
                regex: numRe
            }, {
                token: "constant.numeric",
                regex: "#[a-f0-9]{3}([a-f0-9]{1})?([a-f0-9]{2}){0,2}"
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

define("ace/mode/matching_brace_outdent",["require","exports","module","ace/range"], function(require, exports, module){"use strict";
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

define("ace/mode/css_completions",["require","exports","module"], function(require, exports, module){"use strict";
var propertyMap = {
    "background": { "#$0": 1 },
    "background-color": { "#$0": 1, "transparent": 1, "fixed": 1 },
    "background-image": { "url('/$0')": 1 },
    "background-repeat": { "repeat": 1, "repeat-x": 1, "repeat-y": 1, "no-repeat": 1, "inherit": 1 },
    "background-position": { "bottom": 2, "center": 2, "left": 2, "right": 2, "top": 2, "inherit": 2 },
    "background-attachment": { "scroll": 1, "fixed": 1 },
    "background-size": { "cover": 1, "contain": 1 },
    "background-clip": { "border-box": 1, "padding-box": 1, "content-box": 1 },
    "background-origin": { "border-box": 1, "padding-box": 1, "content-box": 1 },
    "border": { "solid $0": 1, "dashed $0": 1, "dotted $0": 1, "#$0": 1 },
    "border-color": { "#$0": 1 },
    "border-style": { "solid": 2, "dashed": 2, "dotted": 2, "double": 2, "groove": 2, "hidden": 2, "inherit": 2, "inset": 2, "none": 2, "outset": 2, "ridged": 2 },
    "border-collapse": { "collapse": 1, "separate": 1 },
    "bottom": { "px": 1, "em": 1, "%": 1 },
    "clear": { "left": 1, "right": 1, "both": 1, "none": 1 },
    "color": { "#$0": 1, "rgb(#$00,0,0)": 1 },
    "cursor": { "default": 1, "pointer": 1, "move": 1, "text": 1, "wait": 1, "help": 1, "progress": 1, "n-resize": 1, "ne-resize": 1, "e-resize": 1, "se-resize": 1, "s-resize": 1, "sw-resize": 1, "w-resize": 1, "nw-resize": 1 },
    "display": { "none": 1, "block": 1, "inline": 1, "inline-block": 1, "table-cell": 1 },
    "empty-cells": { "show": 1, "hide": 1 },
    "float": { "left": 1, "right": 1, "none": 1 },
    "font-family": { "Arial": 2, "Comic Sans MS": 2, "Consolas": 2, "Courier New": 2, "Courier": 2, "Georgia": 2, "Monospace": 2, "Sans-Serif": 2, "Segoe UI": 2, "Tahoma": 2, "Times New Roman": 2, "Trebuchet MS": 2, "Verdana": 1 },
    "font-size": { "px": 1, "em": 1, "%": 1 },
    "font-weight": { "bold": 1, "normal": 1 },
    "font-style": { "italic": 1, "normal": 1 },
    "font-variant": { "normal": 1, "small-caps": 1 },
    "height": { "px": 1, "em": 1, "%": 1 },
    "left": { "px": 1, "em": 1, "%": 1 },
    "letter-spacing": { "normal": 1 },
    "line-height": { "normal": 1 },
    "list-style-type": { "none": 1, "disc": 1, "circle": 1, "square": 1, "decimal": 1, "decimal-leading-zero": 1, "lower-roman": 1, "upper-roman": 1, "lower-greek": 1, "lower-latin": 1, "upper-latin": 1, "georgian": 1, "lower-alpha": 1, "upper-alpha": 1 },
    "margin": { "px": 1, "em": 1, "%": 1 },
    "margin-right": { "px": 1, "em": 1, "%": 1 },
    "margin-left": { "px": 1, "em": 1, "%": 1 },
    "margin-top": { "px": 1, "em": 1, "%": 1 },
    "margin-bottom": { "px": 1, "em": 1, "%": 1 },
    "max-height": { "px": 1, "em": 1, "%": 1 },
    "max-width": { "px": 1, "em": 1, "%": 1 },
    "min-height": { "px": 1, "em": 1, "%": 1 },
    "min-width": { "px": 1, "em": 1, "%": 1 },
    "overflow": { "hidden": 1, "visible": 1, "auto": 1, "scroll": 1 },
    "overflow-x": { "hidden": 1, "visible": 1, "auto": 1, "scroll": 1 },
    "overflow-y": { "hidden": 1, "visible": 1, "auto": 1, "scroll": 1 },
    "padding": { "px": 1, "em": 1, "%": 1 },
    "padding-top": { "px": 1, "em": 1, "%": 1 },
    "padding-right": { "px": 1, "em": 1, "%": 1 },
    "padding-bottom": { "px": 1, "em": 1, "%": 1 },
    "padding-left": { "px": 1, "em": 1, "%": 1 },
    "page-break-after": { "auto": 1, "always": 1, "avoid": 1, "left": 1, "right": 1 },
    "page-break-before": { "auto": 1, "always": 1, "avoid": 1, "left": 1, "right": 1 },
    "position": { "absolute": 1, "relative": 1, "fixed": 1, "static": 1 },
    "right": { "px": 1, "em": 1, "%": 1 },
    "table-layout": { "fixed": 1, "auto": 1 },
    "text-decoration": { "none": 1, "underline": 1, "line-through": 1, "blink": 1 },
    "text-align": { "left": 1, "right": 1, "center": 1, "justify": 1 },
    "text-transform": { "capitalize": 1, "uppercase": 1, "lowercase": 1, "none": 1 },
    "top": { "px": 1, "em": 1, "%": 1 },
    "vertical-align": { "top": 1, "bottom": 1 },
    "visibility": { "hidden": 1, "visible": 1 },
    "white-space": { "nowrap": 1, "normal": 1, "pre": 1, "pre-line": 1, "pre-wrap": 1 },
    "width": { "px": 1, "em": 1, "%": 1 },
    "word-spacing": { "normal": 1 },
    "filter": { "alpha(opacity=$0100)": 1 },
    "text-shadow": { "$02px 2px 2px #777": 1 },
    "text-overflow": { "ellipsis-word": 1, "clip": 1, "ellipsis": 1 },
    "-moz-border-radius": 1,
    "-moz-border-radius-topright": 1,
    "-moz-border-radius-bottomright": 1,
    "-moz-border-radius-topleft": 1,
    "-moz-border-radius-bottomleft": 1,
    "-webkit-border-radius": 1,
    "-webkit-border-top-right-radius": 1,
    "-webkit-border-top-left-radius": 1,
    "-webkit-border-bottom-right-radius": 1,
    "-webkit-border-bottom-left-radius": 1,
    "-moz-box-shadow": 1,
    "-webkit-box-shadow": 1,
    "transform": { "rotate($00deg)": 1, "skew($00deg)": 1 },
    "-moz-transform": { "rotate($00deg)": 1, "skew($00deg)": 1 },
    "-webkit-transform": { "rotate($00deg)": 1, "skew($00deg)": 1 }
};
var CssCompletions = function () {
};
(function () {
    this.completionsDefined = false;
    this.defineCompletions = function () {
        if (document) {
            var style = document.createElement('c').style;
            for (var i in style) {
                if (typeof style[i] !== 'string')
                    continue;
                var name = i.replace(/[A-Z]/g, function (x) {
                    return '-' + x.toLowerCase();
                });
                if (!propertyMap.hasOwnProperty(name))
                    propertyMap[name] = 1;
            }
        }
        this.completionsDefined = true;
    };
    this.getCompletions = function (state, session, pos, prefix) {
        if (!this.completionsDefined) {
            this.defineCompletions();
        }
        if (state === 'ruleset' || session.$mode.$id == "ace/mode/scss") {
            var line = session.getLine(pos.row).substr(0, pos.column);
            var inParens = /\([^)]*$/.test(line);
            if (inParens) {
                line = line.substr(line.lastIndexOf('(') + 1);
            }
            if (/:[^;]+$/.test(line)) {
                /([\w\-]+):[^:]*$/.test(line);
                return this.getPropertyValueCompletions(state, session, pos, prefix);
            }
            else {
                return this.getPropertyCompletions(state, session, pos, prefix, inParens);
            }
        }
        return [];
    };
    this.getPropertyCompletions = function (state, session, pos, prefix, skipSemicolon) {
        skipSemicolon = skipSemicolon || false;
        var properties = Object.keys(propertyMap);
        return properties.map(function (property) {
            return {
                caption: property,
                snippet: property + ': $0' + (skipSemicolon ? '' : ';'),
                meta: "property",
                score: 1000000
            };
        });
    };
    this.getPropertyValueCompletions = function (state, session, pos, prefix) {
        var line = session.getLine(pos.row).substr(0, pos.column);
        var property = (/([\w\-]+):[^:]*$/.exec(line) || {})[1];
        if (!property)
            return [];
        var values = [];
        if (property in propertyMap && typeof propertyMap[property] === "object") {
            values = Object.keys(propertyMap[property]);
        }
        return values.map(function (value) {
            return {
                caption: value,
                snippet: value,
                meta: "property value",
                score: 1000000
            };
        });
    };
}).call(CssCompletions.prototype);
exports.CssCompletions = CssCompletions;

});

define("ace/mode/behaviour/css",["require","exports","module","ace/lib/oop","ace/mode/behaviour","ace/mode/behaviour/cstyle","ace/token_iterator"], function(require, exports, module){"use strict";
var oop = require("../../lib/oop");
var Behaviour = require("../behaviour").Behaviour;
var CstyleBehaviour = require("./cstyle").CstyleBehaviour;
var TokenIterator = require("../../token_iterator").TokenIterator;
var CssBehaviour = function () {
    this.inherit(CstyleBehaviour);
    this.add("colon", "insertion", function (state, action, editor, session, text) {
        if (text === ':' && editor.selection.isEmpty()) {
            var cursor = editor.getCursorPosition();
            var iterator = new TokenIterator(session, cursor.row, cursor.column);
            var token = iterator.getCurrentToken();
            if (token && token.value.match(/\s+/)) {
                token = iterator.stepBackward();
            }
            if (token && token.type === 'support.type') {
                var line = session.doc.getLine(cursor.row);
                var rightChar = line.substring(cursor.column, cursor.column + 1);
                if (rightChar === ':') {
                    return {
                        text: '',
                        selection: [1, 1]
                    };
                }
                if (/^(\s+[^;]|\s*$)/.test(line.substring(cursor.column))) {
                    return {
                        text: ':;',
                        selection: [1, 1]
                    };
                }
            }
        }
    });
    this.add("colon", "deletion", function (state, action, editor, session, range) {
        var selected = session.doc.getTextRange(range);
        if (!range.isMultiLine() && selected === ':') {
            var cursor = editor.getCursorPosition();
            var iterator = new TokenIterator(session, cursor.row, cursor.column);
            var token = iterator.getCurrentToken();
            if (token && token.value.match(/\s+/)) {
                token = iterator.stepBackward();
            }
            if (token && token.type === 'support.type') {
                var line = session.doc.getLine(range.start.row);
                var rightChar = line.substring(range.end.column, range.end.column + 1);
                if (rightChar === ';') {
                    range.end.column++;
                    return range;
                }
            }
        }
    });
    this.add("semicolon", "insertion", function (state, action, editor, session, text) {
        if (text === ';' && editor.selection.isEmpty()) {
            var cursor = editor.getCursorPosition();
            var line = session.doc.getLine(cursor.row);
            var rightChar = line.substring(cursor.column, cursor.column + 1);
            if (rightChar === ';') {
                return {
                    text: '',
                    selection: [1, 1]
                };
            }
        }
    });
    this.add("!important", "insertion", function (state, action, editor, session, text) {
        if (text === '!' && editor.selection.isEmpty()) {
            var cursor = editor.getCursorPosition();
            var line = session.doc.getLine(cursor.row);
            if (/^\s*(;|}|$)/.test(line.substring(cursor.column))) {
                return {
                    text: '!important',
                    selection: [10, 10]
                };
            }
        }
    });
};
oop.inherits(CssBehaviour, CstyleBehaviour);
exports.CssBehaviour = CssBehaviour;

});

define("ace/mode/folding/cstyle",["require","exports","module","ace/lib/oop","ace/range","ace/mode/folding/fold_mode"], function(require, exports, module){"use strict";
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

define("ace/mode/css",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/css_highlight_rules","ace/mode/matching_brace_outdent","ace/worker/worker_client","ace/mode/css_completions","ace/mode/behaviour/css","ace/mode/folding/cstyle"], function(require, exports, module){"use strict";
var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var CssHighlightRules = require("./css_highlight_rules").CssHighlightRules;
var MatchingBraceOutdent = require("./matching_brace_outdent").MatchingBraceOutdent;
var WorkerClient = require("../worker/worker_client").WorkerClient;
var CssCompletions = require("./css_completions").CssCompletions;
var CssBehaviour = require("./behaviour/css").CssBehaviour;
var CStyleFoldMode = require("./folding/cstyle").FoldMode;
var Mode = function () {
    this.HighlightRules = CssHighlightRules;
    this.$outdent = new MatchingBraceOutdent();
    this.$behaviour = new CssBehaviour();
    this.$completer = new CssCompletions();
    this.foldingRules = new CStyleFoldMode();
};
oop.inherits(Mode, TextMode);
(function () {
    this.foldingRules = "cStyle";
    this.blockComment = { start: "/*", end: "*/" };
    this.getNextLineIndent = function (state, line, tab) {
        var indent = this.$getIndent(line);
        var tokens = this.getTokenizer().getLineTokens(line, state).tokens;
        if (tokens.length && tokens[tokens.length - 1].type == "comment") {
            return indent;
        }
        var match = line.match(/^.*\{\s*$/);
        if (match) {
            indent += tab;
        }
        return indent;
    };
    this.checkOutdent = function (state, line, input) {
        return this.$outdent.checkOutdent(line, input);
    };
    this.autoOutdent = function (state, doc, row) {
        this.$outdent.autoOutdent(doc, row);
    };
    this.getCompletions = function (state, session, pos, prefix) {
        return this.$completer.getCompletions(state, session, pos, prefix);
    };
    this.createWorker = function (session) {
        var worker = new WorkerClient(["ace"], "ace/mode/css_worker", "Worker");
        worker.attachToDocument(session.getDocument());
        worker.on("annotate", function (e) {
            session.setAnnotations(e.data);
        });
        worker.on("terminate", function () {
            session.clearAnnotations();
        });
        return worker;
    };
    this.$id = "ace/mode/css";
    this.snippetFileId = "ace/snippets/css";
}).call(Mode.prototype);
exports.Mode = Mode;

});                (function() {
                    window.require(["ace/mode/css"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            