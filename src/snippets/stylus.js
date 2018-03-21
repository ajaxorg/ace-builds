define("ace/snippets/stylus",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "stylus";

});
                (function() {
                    window.require(["ace/snippets/stylus"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            