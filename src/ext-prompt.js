define("ace/ext/prompt",["require","exports","module","ace/lib/lang","ace/lib/dom","ace/lib/event","ace/edit_session","ace/undomanager","ace/virtual_renderer","ace/editor","ace/multi_select"], function(require, exports, module) {
"use strict";

var lang = require("../lib/lang");
var dom = require("ace/lib/dom");
var event = require("ace/lib/event");

var EditSession = require("ace/edit_session").EditSession;
var UndoManager = require("ace/undomanager").UndoManager;
var Renderer = require("ace/virtual_renderer").VirtualRenderer;
var Editor = require("ace/editor").Editor;
var MultiSelect = require("ace/multi_select").MultiSelect;
function screenToTextCoordinates(x, y) {
    var pos = this.pixelToScreenCoordinates(x, y);
    return this.session.screenToDocumentPosition(
        Math.min(this.session.getScreenLength() - 1, Math.max(pos.row, 0)),
        Math.max(pos.column, 0)
    );
}

exports.singleLineEditor = function(el) {
    var renderer = new Renderer();
    renderer.container.style.overflow = "hidden";
    renderer.screenToTextCoordinates = screenToTextCoordinates;
    renderer.setStyle("ace_one-line");
    var editor = new Editor(renderer);
    editor.session.setUndoManager(new UndoManager());
    editor.setOptions({
        showPrintMargin: false,
        showGutter: false,
        highlightGutterLine: false,
        focusWaitTimout: 0,
        maxLines: 4
    });
    return editor;
};

});
;
                (function() {
                    window.require(["ace/ext/prompt"], function() {});
                })();
            