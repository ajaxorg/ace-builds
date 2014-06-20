define("ace/ext/switch",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.commonPatterns = [
    ["first", "last"],
    ["true", "false"],
    ["yes", "no"],
    ["width", "height"],
    [["top", "bottom"], ["right", "left"]],
    ["on", "off"],
    ["x", "y"],
    ["&&", "||"],
    ["==", "!="],
    {
        match: function() {
              
        },
        replace: function() {
              
        },
    },  
    ["get", "set"],
    ["max", "min"],
    ["horizontal", "vertical"],
    ["show", "hide"],
    ["add", "remove"],
    ["up", "down"],
    ["before", "after"],
    ["even", "odd"],
    ["inside", "outside"],
    ["next", "previous"],
    ["increase", "decrease"],
    ["attach", "detach"],
];

exports.switchWord = function(editor) {
    var pos = editor.selection.getCursorPosition();
    var line = editor.session.getLine(pos.row);
    var wordRange = editor.selection.getWordRange();
    var word = editor.session.getTextRange(wordRange);
    var subWord = 1
    
    var patterns = exports.commonPatterns.concat(editor.session.$mode.switchPatterns || []);
    for (var i = 0; i < patterns.length; i++) {
        
    }
}





});
;
                (function() {
                    window.require(["ace/ext/switch"], function() {});
                })();
            