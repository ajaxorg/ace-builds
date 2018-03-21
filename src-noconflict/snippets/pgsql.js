ace.define("ace/snippets/pgsql",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "pgsql";

});
                (function() {
                    ace.require(["ace/snippets/pgsql"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            