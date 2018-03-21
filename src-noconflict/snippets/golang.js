ace.define("ace/snippets/golang",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "golang";

});
                (function() {
                    ace.require(["ace/snippets/golang"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            