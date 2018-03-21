ace.define("ace/snippets/dot",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "dot";

});
                (function() {
                    ace.require(["ace/snippets/dot"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            