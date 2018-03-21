ace.define("ace/snippets/praat",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "praat";

});
                (function() {
                    ace.require(["ace/snippets/praat"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            