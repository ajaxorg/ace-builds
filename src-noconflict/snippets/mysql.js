ace.define("ace/snippets/mysql",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "mysql";

});
                (function() {
                    ace.require(["ace/snippets/mysql"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            