ace.define("ace/snippets/ftl",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "ftl";

});
                (function() {
                    ace.require(["ace/snippets/ftl"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            