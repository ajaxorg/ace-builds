ace.define("ace/snippets/livescript",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "livescript";

});
                (function() {
                    ace.require(["ace/snippets/livescript"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            