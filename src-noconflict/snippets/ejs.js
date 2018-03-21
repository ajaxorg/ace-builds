ace.define("ace/snippets/ejs",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "ejs";

});
                (function() {
                    ace.require(["ace/snippets/ejs"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            