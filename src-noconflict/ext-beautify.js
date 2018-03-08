ace.define("ace/ext/beautify",["require","exports","module","ace/token_iterator"], function(require, exports, module) {
"use strict";
var TokenIterator = require("../token_iterator").TokenIterator;

function is(token, type) {
    return token.type.lastIndexOf(type + ".xml") > -1;
}
exports.singletonTags = ["area", "base", "br", "col", "command", "embed", "hr", "html", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"];
exports.blockTags = ["article", "aside", "blockquote", "body", "div", "dl", "fieldset", "footer", "form", "head", "header", "html", "nav", "ol", "p", "script", "section", "style", "table", "tbody", "tfoot", "thead", "ul"];

exports.beautify = function(session) {
    var iterator = new TokenIterator(session, 0, 0);
    var token = iterator.getCurrentToken();
    var tabString = session.getTabString();
    var singletonTags = exports.singletonTags;
    var blockTags = exports.blockTags;
    var nextToken;
    var breakBefore = false;
    var code = "";
    var value = "";
    var tagName = "";
    var indent = 0;
    var inBlock = false;
    var inComment = false;
    var inCase = false;
    var onCaseLine = false;
    var row;
    var curRow = 0;
    var rowsToAdd = 0;
    var rowTokens = [];
    var abort = false;
    var i;
    var indentNextLine = false;

    while (token !== null) {
        value = token.value;
        curRow = iterator.getCurrentTokenRow();
        rowTokens = iterator.$rowTokens;
        nextToken = iterator.stepForward();
        if (is(token, "tag-open") && value === "<" && nextToken)
            inBlock = (blockTags.indexOf(nextToken.value) !== -1);
        if (is(token, "comment.start")) {
            inComment = true;
            inBlock = true;
        } else if (is(token, "comment.end")) {
            inComment = false;
            inBlock = false;
        }
        if (is(token, "tag-open") && value === "</") {
            if (is(token, "tag-open") && value === "</" && inBlock && !breakBefore)
                rowsToAdd++;

            indent--;
            inBlock = false;
        }
        onCaseLine = false;
        if (token.type === "keyword" && value.match(/^(case|default)$/)) {
            onCaseLine = true;
            inCase = true;
        } else if (token.type === "keyword" && value === "break")
            inCase = false;
        if (curRow != row) {
            rowsToAdd = curRow;

            if (row)
                rowsToAdd -= row;
        }

        if (rowsToAdd) {
            code = code.trimRight();
            for (; rowsToAdd > 0; rowsToAdd--)
                code += "\n";

            breakBefore = true;
            if (!inComment)
               value = value.trimLeft();
        }

        if (value) {
            if (token.type === "keyword" && value.match(/^(if|else|elseif|for|while|switch)$/)) {
                value += " ";
                nextToken.value = nextToken.value.trim();
                if (!breakBefore && token.type === "keyword" && value.trim().match(/^(else|elseif)$/)) {
                    code = code.trimRight();
                    value = " "+value;
                }
            } else if (token.type === "paren.lparen") {
                nextToken.value = nextToken.value.trim();
                if (value.substr(-1) === "{") {
                    code = code.replace(/ +$/, "");
                    value = value + " ";
                }
                if (value.substr(0, 1) === "{" && !code.match(/\s$/))
                    value = " " + value;
            } else if (token.type === "paren.rparen") {
                code = code.replace(/ +$/, "");
                if (value.substr(0, 1) === "}" && !code.match(/\s$/))
                    value = " " + value;
            } else if ((token.type === "keyword.operator" || token.type === "keyword") && value.match(/^(=|==|===|!=|!==|&&|\|\||and|or|xor|\+=|.=|>|>=|<|<=)$/)) {
                code = code.trimRight();
                value = " " + value + " ";
                nextToken.value = nextToken.value.trim();
            } else if (token.type === "support.php_tag" && value === "?>" && !breakBefore) {
                code = code.trimRight();
                value = " " + value;
            }
            if (curRow != row && rowTokens) {
                abort = false;
                for (i = 0; i<rowTokens.length && !abort; i++) {
                    if (rowTokens[i].type == "paren.rparen") {
                        indent--;
                        abort = true;
                    } else if (rowTokens[i].type == "paren.lparen")
                        abort = true;
                }
            }
            if (breakBefore && !is(token, "comment")) {
                var count = indent;
                if (inCase && !onCaseLine)
                    count++;

                if (indentNextLine) {
                    count++;
                    indentNextLine = false;
                }

                for (i = 0; i < count; i++)
                    code += tabString;
            }
            if (curRow != row && rowTokens) {
                indentNextLine = null;
                abort = false;
                for (i = rowTokens.length-1; i>=0 && !abort; i--) {
                    if (rowTokens[i].type == "paren.rparen") {
                        abort = true;
                    } else if (rowTokens[i].type == "paren.lparen") {
                        indent++;
                        indentNextLine = false;
                        abort = true;
                    }
                }
            }
            if (indentNextLine !== false && token.type === "keyword" && value.trim().match(/^(if|else|elseif|for|while)$/))
                indentNextLine = true;
            code += value;
            breakBefore = false;
            if ((is(token, "tag-close") && (inBlock || blockTags.indexOf(tagName) !== -1)) || (is(token, "doctype") && value==">")) {
                if (inBlock && nextToken && nextToken.value === "</")
                    rowsToAdd--;
                else
                    rowsToAdd++;
            }
            if (is(token, "tag-open") && value === "<" && singletonTags.indexOf(nextToken.value) === -1)
                indent++;
            if (is(token, "tag-name"))
                tagName = value;

            if (is(token, "tag-close") && value === "/>" && singletonTags.indexOf(tagName) === -1)
                indent--;

            row = curRow;
        }

        token = nextToken;
    }

    code = code.trim();
    session.doc.setValue(code);
};

exports.commands = [{
    name: "beautify",
    exec: function(editor) {
        exports.beautify(editor.session);
    },
    bindKey: "Ctrl-Shift-B"
}];

});
                (function() {
                    ace.require(["ace/ext/beautify"], function() {});
                })();
            