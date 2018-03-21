define("ace/snippets/mask",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "mask";

});
                (function() {
                    window.require(["ace/snippets/mask"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            