/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Ajax.org Code Editor (ACE).
 *
 * The Initial Developer of the Original Code is
 * Ajax.org B.V.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

define('ace/mode/diff', ['require', 'exports', 'module' , 'ace/lib/oop', 'ace/mode/text', 'ace/tokenizer', 'ace/mode/diff_highlight_rules', 'ace/mode/folding/diff'], function(require, exports, module) {


var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var Tokenizer = require("../tokenizer").Tokenizer;
var HighlightRules = require("./diff_highlight_rules").DiffHighlightRules;
var FoldMode = require("./folding/diff").FoldMode;

var Mode = function() {
    this.$tokenizer = new Tokenizer(new HighlightRules().getRules(), "i");
    this.foldingRules = new FoldMode(["diff", "index", "\\+{3}", "@@|\\*{5}"], "i");
};
oop.inherits(Mode, TextMode);

(function() {

}).call(Mode.prototype);

exports.Mode = Mode;

});

define('ace/mode/diff_highlight_rules', ['require', 'exports', 'module' , 'ace/lib/oop', 'ace/mode/text_highlight_rules'], function(require, exports, module) {


var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

var DiffHighlightRules = function() {
    // regexp must not have capturing parentheses. Use (?:) instead.
    // regexps are ordered -> the first match is used

    this.$rules = {
        "start" : [{
                "regex": "^(?:\\*{15}|={67}|-{3}|\\+{3})$",
                "token": "punctuation.definition.separator.diff",
                "name": "keyword"
            }, { //diff.range.unified
                "regex": "^(@@)(\\s*.+?\\s*)(@@)(.*)$",
                "token": [
                    "constant",
                    "constant.numeric",
                    "constant",
                    "comment.doc.tag"
                ]
            }, { //diff.range.normal
                "regex": "^(\\d+)([,\\d]+)(a|d|c)(\\d+)([,\\d]+)(.*)$",
                "token": [
                    "constant.numeric",
                    "punctuation.definition.range.diff",
                    "constant.function",
                    "constant.numeric",
                    "punctuation.definition.range.diff",
                    "invalid"
                ],
                "name": "meta."
            }, {
                "regex": "^(?:(\\-{3}|\\+{3}|\\*{3})( .+))$",
                "token": [
                    "constant.numeric",
                    "meta.tag"
                ]
            }, { // added
                "regex": "^([!+>])(.*?)(\\s*)$",
                "token": [
                    "support.constant",
                    "text",
                    "invalid"
                ],
            }, { // removed
                "regex": "^([<\\-])(.*?)(\\s*)$",
                "token": [
                    "support.function",
                    "string",
                    "invalid"
                ],
            }, {
                "regex": "^(diff)(\\s+--\\w+)?(.+?)( .+)?$",
                "token": ["variable", "variable", "keyword", "variable"]
            }, {
                "regex": "^Index.+$",
                "token": "variable"
            }, {
                "regex": "^(.*?)(\\s*)$",
                "token": ["invisible", "invalid"]
            }
        ]
    };
};

oop.inherits(DiffHighlightRules, TextHighlightRules);

exports.DiffHighlightRules = DiffHighlightRules;
});

define('ace/mode/folding/diff', ['require', 'exports', 'module' , 'ace/lib/oop', 'ace/mode/folding/fold_mode', 'ace/range'], function(require, exports, module) {


var oop = require("../../lib/oop");
var BaseFoldMode = require("./fold_mode").FoldMode;
var Range = require("../../range").Range;

var FoldMode = exports.FoldMode = function(levels, flag) {
	this.regExpList = levels;
	this.flag = flag;
	this.foldingStartMarker = RegExp("^(" + levels.join("|") + ")", this.flag);
};
oop.inherits(FoldMode, BaseFoldMode);

(function() {
    this.getFoldWidgetRange = function(session, foldStyle, row) {
        var line = session.getLine(row);
        var start = {row: row, column: line.length};

        var regList = this.regExpList;
        for (var i = 1; i <= regList.length; i++) {
            var re = RegExp("^(" + regList.slice(0, i).join("|") + ")", this.flag);
            if (re.test(line))
                break;
        }

        for (var l = session.getLength(); ++row < l; ) {
            line = session.getLine(row);
            if (re.test(line))
                break
        }
		if (row == start.row + 1)
			return;
        return  Range.fromPoints(start, {row: row - 1, column: line.length});
    };

}).call(FoldMode.prototype);

});

define('ace/mode/folding/fold_mode', ['require', 'exports', 'module' , 'ace/range'], function(require, exports, module) {


var Range = require("../../range").Range;

var FoldMode = exports.FoldMode = function() {};

(function() {

    this.foldingStartMarker = null;
    this.foldingStopMarker = null;

    // must return "" if there's no fold, to enable caching
    this.getFoldWidget = function(session, foldStyle, row) {
        var line = session.getLine(row);
        if (this.foldingStartMarker.test(line))
            return "start";
        if (foldStyle == "markbeginend"
                && this.foldingStopMarker
                && this.foldingStopMarker.test(line))
            return "end";
        return "";
    };
    
    this.getFoldWidgetRange = function(session, foldStyle, row) {
        return null;
    };

    this.indentationBlock = function(session, row, column) {
        var re = /^\s*/;
        var startRow = row;
        var endRow = row;
        var line = session.getLine(row);
        var startColumn = column || line.length;
        var startLevel = line.match(re)[0].length;
        var maxRow = session.getLength()
        
        while (++row < maxRow) {
            line = session.getLine(row);
            var level = line.match(re)[0].length;

            if (level == line.length)
                continue;

            if (level <= startLevel)
                break;

            endRow = row;
        }

        if (endRow > startRow) {
            var endColumn = session.getLine(endRow).length;
            return new Range(startRow, startColumn, endRow, endColumn);
        }
    };

    this.openingBracketBlock = function(session, bracket, row, column, typeRe, allowBlankLine) {
        var start = {row: row, column: column + 1};
        var end = session.$findClosingBracket(bracket, start, typeRe, allowBlankLine);
        if (!end)
            return;

        var fw = session.foldWidgets[end.row];
        if (fw == null)
            fw = this.getFoldWidget(session, end.row);

        if (fw == "start") {
            end.row --;
            end.column = session.getLine(end.row).length;
        }
        return Range.fromPoints(start, end);
    };

}).call(FoldMode.prototype);

});
