ace.define("ace/snippets/text",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "text";

});
                (function() {
                    ace.require(["ace/snippets/text"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            