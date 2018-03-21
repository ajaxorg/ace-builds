define("ace/snippets/forth",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "forth";

});
                (function() {
                    window.require(["ace/snippets/forth"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            