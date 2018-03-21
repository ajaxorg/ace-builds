ace.define("ace/snippets/xml",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "xml";

});
                (function() {
                    ace.require(["ace/snippets/xml"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            