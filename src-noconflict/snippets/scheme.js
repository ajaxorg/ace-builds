ace.define("ace/snippets/scheme",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "scheme";

});
                (function() {
                    ace.require(["ace/snippets/scheme"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            