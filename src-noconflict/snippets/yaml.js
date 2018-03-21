ace.define("ace/snippets/yaml",[], function(require, exports, module) {
"use strict";

exports.snippetText = "";
exports.scope = "yaml";

});
                (function() {
                    ace.require(["ace/snippets/yaml"], function(m) {
                        if (typeof module == "object") {
                            module.exports = m;
                        }
                    });
                })();
            