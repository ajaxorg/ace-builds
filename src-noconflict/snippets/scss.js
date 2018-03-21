ace.define("ace/snippets/scss",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "scss";

});
                (function() {
                    ace.require(["ace/snippets/scss"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            