ace.define("ace/snippets/rdoc",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "rdoc";

});
                (function() {
                    ace.require(["ace/snippets/rdoc"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            