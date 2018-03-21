ace.define("ace/snippets/toml",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "toml";

});
                (function() {
                    ace.require(["ace/snippets/toml"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            