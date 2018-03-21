ace.define("ace/snippets/sass",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "sass";

});
                (function() {
                    ace.require(["ace/snippets/sass"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            